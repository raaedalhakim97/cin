-- F-11. early_minutes is recomputed by the server whenever a scheduled end can be
-- resolved — from the shift, or failing that from the company's working hours. When
-- neither resolved, the whole block was skipped and whatever value arrived from the
-- client was stored unchallenged. Unknown is the correct answer and the column already
-- accepts it.
--
-- Considered and rejected: revoking column-level INSERT/UPDATE on the derived columns
-- (early_minutes, the distance and location columns) from `authenticated`. It is the
-- better shape — a derived column no client should ever write — but a column REVOKE
-- does not override the existing table-level grant, so it would mean dismantling the
-- table grant and re-granting an explicit column list. Getting that list wrong means
-- nobody can clock in. Not worth it for a low-severity fix; worth revisiting when the
-- attendance schema is next opened.
--
-- The body below is unchanged from the version it replaces apart from the ELSE on the
-- scheduled-end branch, near the end.

CREATE OR REPLACE FUNCTION public.attendance_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid        uuid := (SELECT auth.uid());
  v_role       text;
  v_is_hr      boolean := false;
  v_is_self    boolean := false;
  v_settings   record;
  v_loc        record;
  v_sched_end  timestamptz;
  v_ot_from    timestamptz;
  v_has_locs   boolean;
  v_exp_start  timestamptz;
  v_grace      int;
  v_diff_min   numeric;
  v_late_min   numeric;
BEGIN
  IF v_uid IS NOT NULL THEN
    v_role    := get_user_role(v_uid);
    v_is_hr   := v_role IN ('super_admin', 'hr_manager');
    v_is_self := EXISTS (SELECT 1 FROM employees WHERE id = NEW.employee_id AND user_id = v_uid);
  END IF;

  SELECT * INTO v_settings FROM shift_settings WHERE company_id = NEW.company_id;
  SELECT EXISTS (SELECT 1 FROM work_locations WHERE company_id = NEW.company_id AND active)
    INTO v_has_locs;

  IF v_is_self AND NOT v_is_hr THEN
    IF TG_OP = 'UPDATE' THEN
      NEW.status            := OLD.status;
      NEW.overtime_hours    := OLD.overtime_hours;
      NEW.overtime_approved := OLD.overtime_approved;
      NEW.approved_by       := OLD.approved_by;
      NEW.employee_id       := OLD.employee_id;
      NEW.date              := OLD.date;

      -- A punch is a fact about when a request reached the server, so the
      -- server decides it. The clock-in is already history and cannot move;
      -- the clock-out can only be set once, at the moment it happens. Without
      -- this, moving clock_out silently rewrites early_minutes.
      NEW.clock_in := OLD.clock_in;
      IF OLD.clock_out IS NULL AND NEW.clock_out IS NOT NULL THEN
        NEW.clock_out := now();
      ELSE
        NEW.clock_out := OLD.clock_out;
      END IF;
    ELSE
      NEW.overtime_hours    := NULL;
      NEW.overtime_approved := false;
      NEW.approved_by       := NULL;

      IF NEW.clock_in  IS NOT NULL THEN NEW.clock_in  := now(); END IF;
      IF NEW.clock_out IS NOT NULL THEN NEW.clock_out := now(); END IF;
    END IF;

    -- Grade the lateness here rather than trusting the value that arrived.
    -- Both clients compute the same thing for their own display; this is what
    -- gets stored. aa_autolink_shift is named to sort before this trigger, so
    -- NEW.shift_id is already resolved when we read it — and since the F-04 fix
    -- it has also already replaced a client-supplied date with the company's own
    -- calendar day, which is what makes the fallback below trustworthy.
    IF TG_OP = 'INSERT' AND NEW.clock_in IS NOT NULL THEN
      SELECT s.start_at INTO v_exp_start FROM shifts s WHERE s.id = NEW.shift_id;

      IF v_exp_start IS NOT NULL THEN
        v_grace := COALESCE(v_settings.late_grace_minutes, 15);
      ELSE
        SELECT (NEW.date::timestamp + c.work_start_time) AT TIME ZONE c.timezone
          INTO v_exp_start
          FROM company c WHERE c.id = NEW.company_id;
        SELECT COALESCE(k.late_grace_minutes, 15) INTO v_grace
          FROM kpi_settings k WHERE k.company_id = NEW.company_id;
        v_grace := COALESCE(v_grace, 15);
      END IF;

      IF v_exp_start IS NOT NULL THEN
        v_diff_min := EXTRACT(epoch FROM (NEW.clock_in - v_exp_start)) / 60;
        IF v_diff_min <= v_grace THEN
          -- Arriving early is not lateness.
          NEW.status := 'present';
        ELSE
          v_late_min := v_diff_min - v_grace;
          NEW.status := CASE
            WHEN v_late_min <= 30 THEN 'late_minor'
            WHEN v_late_min <= 60 THEN 'late_moderate'
            ELSE 'late_major'
          END;
        END IF;
      END IF;
    END IF;
  END IF;

  IF NOT v_is_hr AND EXISTS (
    SELECT 1 FROM leave_requests l
    WHERE l.employee_id = NEW.employee_id
      AND l.status = 'approved'
      AND NEW.date BETWEEN l.start_date AND l.end_date
  ) THEN
    NEW.status := 'absent_approved';
  END IF;

  IF v_has_locs AND NEW.clock_in_lat IS NOT NULL AND NEW.clock_in_lng IS NOT NULL THEN
    SELECT w.id, w.name, w.radius_metres,
           distance_metres(NEW.clock_in_lat, NEW.clock_in_lng, w.latitude, w.longitude) AS d
      INTO v_loc
      FROM work_locations w
     WHERE w.company_id = NEW.company_id AND w.active
     ORDER BY d LIMIT 1;

    NEW.clock_in_location_id := v_loc.id;
    NEW.clock_in_distance_m  := round(v_loc.d::numeric, 1);

    IF COALESCE(v_settings.enforce_geofence, false) AND v_is_self AND NOT v_is_hr
       AND v_loc.d > v_loc.radius_metres THEN
      RAISE EXCEPTION 'Clock-in blocked: you are %m from %, which accepts clock-in within %m.',
        round(v_loc.d)::int, v_loc.name, v_loc.radius_metres USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_has_locs AND NEW.clock_out_lat IS NOT NULL AND NEW.clock_out_lng IS NOT NULL THEN
    SELECT w.id, w.name, w.radius_metres,
           distance_metres(NEW.clock_out_lat, NEW.clock_out_lng, w.latitude, w.longitude) AS d
      INTO v_loc
      FROM work_locations w
     WHERE w.company_id = NEW.company_id AND w.active
     ORDER BY d LIMIT 1;

    NEW.clock_out_location_id := v_loc.id;
    NEW.clock_out_distance_m  := round(v_loc.d::numeric, 1);

    IF COALESCE(v_settings.enforce_geofence, false) AND v_is_self AND NOT v_is_hr
       AND v_loc.d > v_loc.radius_metres THEN
      RAISE EXCEPTION 'Clock-out blocked: you are %m from %, which accepts clock-out within %m.',
        round(v_loc.d)::int, v_loc.name, v_loc.radius_metres USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Coordinates are required when the company asked for them, and separately
  -- when a fence has to be evaluated. require_gps_clock_in stands on its own:
  -- it means "every punch carries a fix", which is meaningful before any site
  -- has been drawn, so it is not gated on v_has_locs. The fence branch is,
  -- because with no sites there is nothing to be inside or outside of.
  IF v_is_self AND NOT v_is_hr
     AND ( COALESCE(v_settings.require_gps_clock_in, false)
           OR (COALESCE(v_settings.enforce_geofence, false) AND v_has_locs) ) THEN
    IF NEW.clock_in IS NOT NULL AND NEW.clock_in_lat IS NULL THEN
      RAISE EXCEPTION 'Clock-in blocked: location sharing is required at this company.'
        USING ERRCODE = 'P0001';
    END IF;
    IF NEW.clock_out IS NOT NULL AND NEW.clock_out_lat IS NULL THEN
      RAISE EXCEPTION 'Clock-out blocked: location sharing is required at this company.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

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

      -- Overtime is the worked interval that falls after the scheduled end,
      -- never the whole gap between that end and the clock-out.
      v_ot_from := GREATEST(NEW.clock_in, v_sched_end);

      IF (TG_OP = 'INSERT' AND COALESCE(NEW.overtime_hours, 0) = 0)
         OR (TG_OP = 'UPDATE' AND NEW.overtime_hours IS NOT DISTINCT FROM OLD.overtime_hours) THEN
        NEW.overtime_hours := round(
          GREATEST(0, EXTRACT(epoch FROM (NEW.clock_out - v_ot_from)) / 3600)::numeric, 2
        );
      END IF;
    ELSE
      -- F-11: no shift and no company working hours means there is nothing to be
      -- early against. Before this, the client's number survived unchallenged.
      NEW.early_minutes := NULL;
    END IF;
  ELSE
    NEW.early_minutes := NULL;
  END IF;

  RETURN NEW;
END;
$function$;
