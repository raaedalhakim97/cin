-- Overtime must be bounded by time actually worked.
--
-- 02 computed overtime as clock_out - scheduled_end, which is only right when
-- the employee was present for the whole scheduled day. Recomputing the live
-- rows exposed it immediately: a record clocking in at 19:54:02 and out at
-- 19:54:06 — four seconds — was awarded 6.90 overtime hours, because 19:54 is
-- 6.9 hours past a 17:00 finish. Two other seconds-long punches got 1.69 and
-- 6.98.
--
-- The overtime portion is the part of the *worked interval* falling after the
-- scheduled end: clock_out - GREATEST(clock_in, scheduled_end). Someone who
-- starts after their day was due to end has all of their (short) worked time
-- counted; nobody is paid for hours they were not present for.
--
-- Only the overtime branch of attendance_guard() differs from 02; the rest of
-- the function is reproduced unchanged so this file replays standalone.
-- See the applied migration `fix_overtime_bounded_by_worked_time` for the
-- full body as it exists in the database.

CREATE OR REPLACE FUNCTION public.attendance_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid       uuid := (SELECT auth.uid());
  v_role      text;
  v_is_hr     boolean := false;
  v_is_self   boolean := false;
  v_settings  record;
  v_loc       record;
  v_sched_end timestamptz;
  v_ot_from   timestamptz;
  v_has_locs  boolean;
BEGIN
  IF v_uid IS NOT NULL THEN
    v_role    := get_user_role(v_uid);
    v_is_hr   := v_role IN ('super_admin', 'hr_manager');
    v_is_self := EXISTS (SELECT 1 FROM employees WHERE id = NEW.employee_id AND user_id = v_uid);
  END IF;

  SELECT * INTO v_settings FROM shift_settings WHERE company_id = NEW.company_id;
  SELECT EXISTS (SELECT 1 FROM work_locations WHERE company_id = NEW.company_id AND active)
    INTO v_has_locs;

  -- 6a. Self-service writes cannot touch pay- or KPI-bearing fields.
  --     att_self_update exists so an employee can stamp their own clock_out;
  --     it is not a licence to restate the day. On UPDATE these revert to
  --     whatever the row already held, silently — an employee editing their
  --     own record simply cannot move them.
  IF v_is_self AND NOT v_is_hr THEN
    IF TG_OP = 'UPDATE' THEN
      NEW.status            := OLD.status;
      NEW.overtime_hours    := OLD.overtime_hours;
      NEW.overtime_approved := OLD.overtime_approved;
      NEW.approved_by       := OLD.approved_by;
      NEW.employee_id       := OLD.employee_id;
      NEW.date              := OLD.date;
    ELSE
      -- On the first punch of the day the client still classifies lateness
      -- (it is the only party that knows the device's timezone), but it has
      -- no business asserting overtime or approval.
      NEW.overtime_hours    := NULL;
      NEW.overtime_approved := false;
      NEW.approved_by       := NULL;
    END IF;
  END IF;

  -- 6b. A day covered by approved leave is approved absence, whatever the
  --     clock says. validate_shift() already refuses to *schedule* over
  --     approved leave; this closes the same hole on the attendance side.
  --     HR keeps the override — they can also just cancel the leave.
  IF NOT v_is_hr AND EXISTS (
    SELECT 1 FROM leave_requests l
    WHERE l.employee_id = NEW.employee_id
      AND l.status = 'approved'
      AND NEW.date BETWEEN l.start_date AND l.end_date
  ) THEN
    NEW.status := 'absent_approved';
  END IF;

  -- 6c. Location. Measured whenever coordinates arrive and the tenant has
  --     defined somewhere to measure against; enforced only when asked.
  IF v_has_locs AND NEW.clock_in_lat IS NOT NULL AND NEW.clock_in_lng IS NOT NULL THEN
    SELECT w.id, w.name, w.radius_metres,
           distance_metres(NEW.clock_in_lat, NEW.clock_in_lng, w.latitude, w.longitude) AS d
      INTO v_loc
      FROM work_locations w
     WHERE w.company_id = NEW.company_id AND w.active
     ORDER BY d
     LIMIT 1;

    NEW.clock_in_location_id := v_loc.id;
    NEW.clock_in_distance_m  := round(v_loc.d::numeric, 1);

    IF COALESCE(v_settings.enforce_geofence, false) AND v_is_self AND NOT v_is_hr
       AND v_loc.d > v_loc.radius_metres THEN
      RAISE EXCEPTION 'Clock-in blocked: you are %m from %, which accepts clock-in within %m.',
        round(v_loc.d)::int, v_loc.name, v_loc.radius_metres
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_has_locs AND NEW.clock_out_lat IS NOT NULL AND NEW.clock_out_lng IS NOT NULL THEN
    SELECT w.id, w.name, w.radius_metres,
           distance_metres(NEW.clock_out_lat, NEW.clock_out_lng, w.latitude, w.longitude) AS d
      INTO v_loc
      FROM work_locations w
     WHERE w.company_id = NEW.company_id AND w.active
     ORDER BY d
     LIMIT 1;

    NEW.clock_out_location_id := v_loc.id;
    NEW.clock_out_distance_m  := round(v_loc.d::numeric, 1);

    IF COALESCE(v_settings.enforce_geofence, false) AND v_is_self AND NOT v_is_hr
       AND v_loc.d > v_loc.radius_metres THEN
      RAISE EXCEPTION 'Clock-out blocked: you are %m from %, which accepts clock-out within %m.',
        round(v_loc.d)::int, v_loc.name, v_loc.radius_metres
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Enforcing the fence means coordinates are mandatory, not optional —
  -- otherwise "deny location permission" is a way around the fence.
  IF COALESCE(v_settings.enforce_geofence, false) AND v_has_locs AND v_is_self AND NOT v_is_hr THEN
    IF NEW.clock_in IS NOT NULL AND NEW.clock_in_lat IS NULL THEN
      RAISE EXCEPTION 'Clock-in blocked: location sharing is required at this company.'
        USING ERRCODE = 'P0001';
    END IF;
    IF NEW.clock_out IS NOT NULL AND NEW.clock_out_lat IS NULL THEN
      RAISE EXCEPTION 'Clock-out blocked: location sharing is required at this company.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- 6d. Derived: how early the day ended, and real overtime.
  IF NEW.clock_in IS NOT NULL AND NEW.clock_out IS NOT NULL THEN
    SELECT s.end_at INTO v_sched_end FROM shifts s WHERE s.id = NEW.shift_id;

    IF v_sched_end IS NULL THEN
      SELECT (NEW.date::timestamp + c.work_end_time) AT TIME ZONE c.timezone
        INTO v_sched_end
        FROM company c WHERE c.id = NEW.company_id;
    END IF;

    IF v_sched_end IS NOT NULL THEN
      NEW.early_minutes := GREATEST(
        0, ceil(EXTRACT(epoch FROM (v_sched_end - NEW.clock_out)) / 60)
      )::int;

      -- Only fill overtime the writer did not state themselves, so an HR
      -- override in the attendance modal still wins.
      -- Overtime is the worked interval that falls after the scheduled end,
      -- never the whole gap between that end and the clock-out.
      v_ot_from := GREATEST(NEW.clock_in, v_sched_end);

      -- attendance.overtime_hours carries DEFAULT 0, so on INSERT it is never
      -- NULL: 0 and NULL both mean "nobody has said anything about overtime".
      IF (TG_OP = 'INSERT' AND COALESCE(NEW.overtime_hours, 0) = 0)
         OR (TG_OP = 'UPDATE' AND NEW.overtime_hours IS NOT DISTINCT FROM OLD.overtime_hours) THEN
        NEW.overtime_hours := round(
          GREATEST(0, EXTRACT(epoch FROM (NEW.clock_out - v_ot_from)) / 3600)::numeric, 2
        );
      END IF;
    END IF;
  ELSE
    NEW.early_minutes := NULL;
  END IF;

  RETURN NEW;
END;
$$;

