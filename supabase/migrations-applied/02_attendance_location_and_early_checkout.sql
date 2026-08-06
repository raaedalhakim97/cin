-- Attendance: approved work locations, early-checkout detection, and the
-- integrity gaps the live data exposed.
--
-- Measured facts this migration responds to (BYOND production, 6 Aug 2026):
--
--   * shift_settings.require_gps_clock_in was ON for both tenants, but there
--     were no geofence columns anywhere in the schema. GPS was *captured*
--     (4 of 18 rows have clock_in_lat) and never *checked* against anything.
--     "Clock in at the allowed location" did not exist.
--
--   * 9 of 18 attendance rows fall on days the employee had approved leave,
--     scored `present` or `late_major`. validate_shift() refuses to schedule
--     over approved leave; clock-in never looked.
--
--   * overtime_hours is not derived from the clock at all. A 07:24→15:20
--     day (7h56m) carried 7.00 overtime hours; a 22:52→next-day-22:15 row
--     (23h23m) carried 0.00. Every value in the column is hand-entered.
--
--   * attendance has table-wide UPDATE granted to `authenticated` (all 19
--     columns) and att_self_update lets an employee write their own row for
--     today. RLS is row-level, so nothing stopped an employee rewriting
--     their own `late_major` to `present`, or awarding themselves overtime —
--     status feeds 30% of the KPI and overtime feeds payroll.
--
--   * sync_attendance_score() still seeds behavior_score/achievement_score
--     as literal 0 on INSERT, which re-creates for every new month exactly
--     the "unevaluated reads as zero" bug that 01_fix_kpi_partial_evaluation
--     was written to remove.

-- ── 1. Company timezone ─────────────────────────────────────────────────────
-- company.work_start_time / work_end_time are bare `time` values. To compare
-- them against a timestamptz clock-out you have to know which day-boundary
-- they belong to. The web app resolves this in the browser's local zone; the
-- database had no way to. Defaulted to the handbook's home jurisdiction —
-- a tenant operating elsewhere must have this set correctly.
ALTER TABLE public.company
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Dubai';

COMMENT ON COLUMN public.company.timezone IS
  'IANA zone used to anchor work_start_time/work_end_time to a real instant. Must match the tenant''s operating location.';

-- ── 2. Approved work locations ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.work_locations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.company(id) ON DELETE CASCADE,
  name           text NOT NULL,
  latitude       double precision NOT NULL CHECK (latitude  BETWEEN  -90 AND  90),
  longitude      double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  radius_metres  integer NOT NULL DEFAULT 200 CHECK (radius_metres BETWEEN 25 AND 20000),
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

CREATE INDEX IF NOT EXISTS work_locations_company_active_idx
  ON public.work_locations (company_id) WHERE active;

ALTER TABLE public.work_locations ENABLE ROW LEVEL SECURITY;

-- Everyone in the tenant can read them: the employee's phone needs the
-- coordinates to tell them *where* they have to be before they walk there.
DROP POLICY IF EXISTS work_locations_select ON public.work_locations;
CREATE POLICY work_locations_select ON public.work_locations
  FOR SELECT TO authenticated
  USING (company_id = get_user_company_id((SELECT auth.uid())));

-- Same writer set as shift_settings — defining where work counts as attended
-- is an HR policy decision, not an operational one.
DROP POLICY IF EXISTS work_locations_write ON public.work_locations;
CREATE POLICY work_locations_write ON public.work_locations
  FOR ALL TO authenticated
  USING (company_id = get_user_company_id((SELECT auth.uid()))
         AND get_user_role((SELECT auth.uid())) = ANY (ARRAY['super_admin','hr_manager']))
  WITH CHECK (company_id = get_user_company_id((SELECT auth.uid()))
              AND get_user_role((SELECT auth.uid())) = ANY (ARRAY['super_admin','hr_manager']));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_locations TO authenticated;

-- ── 3. Settings ─────────────────────────────────────────────────────────────
ALTER TABLE public.shift_settings
  ADD COLUMN IF NOT EXISTS enforce_geofence            boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS early_checkout_grace_minutes integer NOT NULL DEFAULT 5
    CHECK (early_checkout_grace_minutes BETWEEN 0 AND 120);

COMMENT ON COLUMN public.shift_settings.enforce_geofence IS
  'ON: a self-service clock-in/out outside every active work_location radius is rejected. OFF: the distance is still measured and stored, but nothing is blocked.';

-- ── 4. Attendance: measured location and early-checkout columns ─────────────
ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS clock_in_location_id  uuid REFERENCES public.work_locations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS clock_out_location_id uuid REFERENCES public.work_locations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS clock_in_distance_m   numeric(10,1),
  ADD COLUMN IF NOT EXISTS clock_out_distance_m  numeric(10,1),
  ADD COLUMN IF NOT EXISTS early_minutes         integer,
  ADD COLUMN IF NOT EXISTS early_reason          text;

COMMENT ON COLUMN public.attendance.early_minutes IS
  'Minutes between clock_out and the scheduled end of the day (linked shift end_at, else company work_end_time in company.timezone). 0 when the employee stayed to the end.';

-- ── 5. Distance helper ──────────────────────────────────────────────────────
-- Haversine on a spherical earth. Accurate to ~0.5% — far inside the
-- resolution of a phone GPS fix, and it avoids taking a PostGIS dependency
-- for one distance comparison.
CREATE OR REPLACE FUNCTION public.distance_metres(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
) RETURNS double precision
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT 6371000 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;

-- ── 6. The guard ────────────────────────────────────────────────────────────
-- Named `ab_` so it fires after `aa_autolink_shift`, which is what populates
-- NEW.shift_id — the scheduled end time this function needs.
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
      -- attendance.overtime_hours carries DEFAULT 0, so on INSERT it is never
      -- NULL: 0 and NULL both mean "nobody has said anything about overtime".
      IF (TG_OP = 'INSERT' AND COALESCE(NEW.overtime_hours, 0) = 0)
         OR (TG_OP = 'UPDATE' AND NEW.overtime_hours IS NOT DISTINCT FROM OLD.overtime_hours) THEN
        NEW.overtime_hours := round(
          GREATEST(0, EXTRACT(epoch FROM (NEW.clock_out - v_sched_end)) / 3600)::numeric, 2
        );
      END IF;
    END IF;
  ELSE
    NEW.early_minutes := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ab_attendance_guard ON public.attendance;
CREATE TRIGGER ab_attendance_guard
  BEFORE INSERT OR UPDATE ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.attendance_guard();

-- ── 7. Stop re-seeding the KPI zeros ────────────────────────────────────────
-- Identical to the live definition apart from the two literal 0s, which
-- become NULL: "not evaluated" and "evaluated at zero" are different claims
-- and 01_fix_kpi_partial_evaluation made the columns able to say so.
CREATE OR REPLACE FUNCTION public.sync_attendance_score()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_year INT; v_month INT; v_emp_id UUID; v_company_id UUID; v_new_score NUMERIC(5,2);
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_emp_id     := OLD.employee_id;
    v_year       := EXTRACT(YEAR  FROM OLD.date)::INT;
    v_month      := EXTRACT(MONTH FROM OLD.date)::INT;
    v_company_id := OLD.company_id;
  ELSE
    v_emp_id     := NEW.employee_id;
    v_year       := EXTRACT(YEAR  FROM NEW.date)::INT;
    v_month      := EXTRACT(MONTH FROM NEW.date)::INT;
    v_company_id := NEW.company_id;
  END IF;

  v_new_score := calculate_attendance_score(v_emp_id, v_year, v_month, v_company_id);

  INSERT INTO kpi_scores (
    employee_id, company_id, period_year, period_month,
    attendance_score, behavior_score, achievement_score, manager_score, self_score
  ) VALUES (
    v_emp_id, v_company_id, v_year, v_month, v_new_score, NULL, NULL, NULL, NULL
  )
  ON CONFLICT (employee_id, period_year, period_month)
  DO UPDATE SET attendance_score = v_new_score;
  -- total/rating/bonus handled by aa_compute_kpi_total trigger

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
