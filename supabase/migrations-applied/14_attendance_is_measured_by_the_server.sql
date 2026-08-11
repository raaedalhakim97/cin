-- Attendance was scored by the browser, and the audit trail could not be read.
--
-- Asked to confirm attendance is "saved and tracked for audit purposes as per
-- the shift", I checked the live database rather than the code path. The shift
-- linkage itself is sound: aa_autolink_shift attaches every punch that has a
-- matching published work shift, and 0 rows were found unlinked where a shift
-- existed. What is not sound is that almost nothing about a punch was actually
-- established by the server.
--
-- Four findings, all verified against the live database, all the same shape:
-- the browser was the only thing enforcing a rule the record depends on.
--
--   1. The lateness grade was self-reported. Nothing server-side derived
--      `status`; the client computed it (classifyClockIn in Attendance.jsx and
--      mobile/src/lib/attendance.js) and the database stored whatever arrived.
--      Proven as employee Hassan Ali, not as service role:
--
--        insert into attendance (..., clock_in 11:11, status 'present')
--        -- accepted, against an 08:00 company start
--
--      Anyone with a session and the anon key could grade their own lateness.
--
--   2. The punch times were self-reported too, so even a server-derived grade
--      would have been derived from a client-supplied clock. Worse on UPDATE:
--      the self-write branch froze status, overtime and approvals to OLD, but
--      not clock_out — and early_minutes is recomputed from clock_out. So an
--      employee who left at 14:00 could move their clock_out to the scheduled
--      17:00 and take early_minutes to 0.
--
--   3. `require_gps_clock_in` did nothing. No server function referenced the
--      column at all; the coordinates-required check was gated on
--      enforce_geofence, which is off by default while require_gps_clock_in
--      defaults to true. A company reading its own settings screen saw a
--      protection it did not have — the same class of defect migration 11
--      fixed for the geofence.
--
--   4. The audit trail was unreadable and forgeable. log_sensitive_changes
--      never set company_id, and audit_select requires
--      company_id = get_user_company_id(...). 760 of 774 rows had it NULL, and
--      all 61 attendance rows did. Impersonating HR manager Mariam Saleh:
--
--        audit_rows_visible: 0    attendance_audit_visible: 0
--
--      An 8-month trail existed that no HR manager could see a single row of.
--      And `audit_insert` permitted any authenticated user to write arbitrary
--      rows: as Hassan Ali I inserted an audit entry attributed to the HR
--      manager. (My first attempt appeared to be refused — that was RETURNING
--      tripping the SELECT policy, not the insert being blocked. Without
--      RETURNING it succeeded.)
--
-- Overtime is not a money leak today: payroll_runs.overtime_pay is generated
-- at 0 and entered by hand, so attendance.overtime_hours never reaches a
-- payslip on its own. It is still a reported figure, and it is now derived
-- from timestamps the server stamped rather than ones the client chose.

-- ---------------------------------------------------------------------------
-- 1. The server stamps the punch and grades the lateness.
-- ---------------------------------------------------------------------------
--
-- Unchanged from the previous version: the HR/manager path, the approved-leave
-- override, distance stamping, the geofence refusals, early_minutes, and the
-- overtime window from migration 04. A manager or HR user keeps full manual
-- control of status and overtime, because their edits are the authority and
-- are themselves audited.
--
-- What changes applies only when the writer is the employee themself and is
-- not HR — the one case where the subject of the record is also its author.

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
    -- NEW.shift_id is already resolved when we read it.
    --
    -- The two grace periods are deliberately different sources and stay that
    -- way: a shift-linked punch uses shift_settings.late_grace_minutes, and
    -- the fixed-hours fallback uses kpi_settings.late_grace_minutes, which is
    -- the grace period that existed before shifts did.
    --
    -- One intentional divergence from the browser: the fallback expected start
    -- is read in the company's timezone, where the client used the device's.
    -- For a UAE company on UAE devices these agree; where they disagree the
    -- company's own timezone is the defensible one.
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
          -- Arriving early is not lateness. This is why the 2026-08-07 row
          -- that prompted the check reads 'present' for a 00:13 clock-in
          -- against an 09:00 start: it was 527 minutes early, not late.
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
    END IF;
  ELSE
    NEW.early_minutes := NULL;
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. The audit trail records which company it belongs to.
-- ---------------------------------------------------------------------------
--
-- Without this the trail is invisible to the only people entitled to read it.
-- employee_id is filled on the same principle: an auditor asking "what
-- happened to this person's records" should not have to grep jsonb.

CREATE OR REPLACE FUNCTION public.log_sensitive_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row      jsonb := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_company  uuid;
  v_employee uuid;
BEGIN
  v_company := NULLIF(v_row->>'company_id', '')::uuid;
  IF v_company IS NULL AND TG_TABLE_NAME = 'company' THEN
    v_company := NULLIF(v_row->>'id', '')::uuid;
  END IF;
  -- Tables that carry no company of their own (user_roles, for one) are
  -- attributed to the company of whoever made the change. That is the tenant
  -- whose auditor needs to see it.
  IF v_company IS NULL THEN
    v_company := get_user_company_id(auth.uid());
  END IF;

  v_employee := NULLIF(v_row->>'employee_id', '')::uuid;
  IF v_employee IS NULL AND TG_TABLE_NAME = 'employees' THEN
    v_employee := NULLIF(v_row->>'id', '')::uuid;
  END IF;

  -- Both columns are foreign keys, and this trigger fires AFTER the change —
  -- so on a DELETE the row being described is already gone, and pointing at it
  -- would make the delete itself fail with a foreign key violation. Recording
  -- a deletion must never be the reason a deletion is impossible. The id is
  -- preserved in old_data regardless, which is what an auditor reads.
  IF v_company IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM company WHERE id = v_company) THEN
    v_company := NULL;
  END IF;
  IF v_employee IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM employees WHERE id = v_employee) THEN
    v_employee := NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_logs (user_id, action, table_name, record_id, new_data, company_id, employee_id)
    VALUES (auth.uid(), 'INSERT', TG_TABLE_NAME, NEW.id, v_row, v_company, v_employee);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_logs (user_id, action, table_name, record_id, old_data, new_data, company_id, employee_id)
    VALUES (auth.uid(), 'UPDATE', TG_TABLE_NAME, NEW.id, to_jsonb(OLD), to_jsonb(NEW), v_company, v_employee);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_logs (user_id, action, table_name, record_id, old_data, company_id, employee_id)
    VALUES (auth.uid(), 'DELETE', TG_TABLE_NAME, OLD.id, v_row, v_company, v_employee);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$function$;

-- Backfill the trail that already exists, so the history is readable and not
-- just everything from today onwards. Derived from the recorded row itself
-- where possible, and otherwise from the company of the user who acted.
--
-- Both columns are foreign keys, and an audit trail outlives what it
-- describes: the first attempt at this failed on an employees row that had
-- since been deleted, which is exactly the history an auditor most wants. So
-- each candidate is only written if the referenced row still exists, and the
-- jsonb payload keeps the original id either way.
UPDATE public.audit_logs a
   SET company_id = v.cid
  FROM (
    SELECT a2.id,
           COALESCE(
             NULLIF(a2.new_data->>'company_id', '')::uuid,
             NULLIF(a2.old_data->>'company_id', '')::uuid,
             CASE WHEN a2.table_name = 'company'
                  THEN COALESCE(NULLIF(a2.new_data->>'id', '')::uuid,
                                NULLIF(a2.old_data->>'id', '')::uuid) END,
             (SELECT e.company_id FROM employees e WHERE e.user_id = a2.user_id LIMIT 1)
           ) AS cid
      FROM public.audit_logs a2
     WHERE a2.company_id IS NULL
  ) v
 WHERE a.id = v.id
   AND v.cid IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.company c WHERE c.id = v.cid);

UPDATE public.audit_logs a
   SET employee_id = v.eid
  FROM (
    SELECT a2.id,
           COALESCE(
             NULLIF(a2.new_data->>'employee_id', '')::uuid,
             NULLIF(a2.old_data->>'employee_id', '')::uuid,
             CASE WHEN a2.table_name = 'employees'
                  THEN COALESCE(NULLIF(a2.new_data->>'id', '')::uuid,
                                NULLIF(a2.old_data->>'id', '')::uuid) END
           ) AS eid
      FROM public.audit_logs a2
     WHERE a2.employee_id IS NULL
  ) v
 WHERE a.id = v.id
   AND v.eid IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.employees e WHERE e.id = v.eid);

-- audit_select filters on company_id and the page orders by recency.
CREATE INDEX IF NOT EXISTS audit_logs_company_created_idx
  ON public.audit_logs (company_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 3. Only the trigger writes the audit trail.
-- ---------------------------------------------------------------------------
--
-- log_sensitive_changes is SECURITY DEFINER and both it and audit_logs are
-- owned by postgres, with RLS not forced — so the trigger inserts as the
-- owner and bypasses RLS entirely. The audit_insert policy was therefore
-- never needed to make auditing work. Its only effect was to let any signed-in
-- user write whatever they liked into the record of what happened, including
-- entries attributed to somebody else.
--
-- No application code inserts here; the only reader is the activity panel on
-- the admin dashboard.
DROP POLICY IF EXISTS audit_insert ON public.audit_logs;

-- Belt and braces. With no UPDATE or DELETE policy, RLS already refuses both,
-- but the grants stayed behind — which leaves the trail one accidentally
-- permissive policy away from being editable by the people it describes.
-- Taking the privileges away makes it append-only-by-trigger structurally
-- rather than by the absence of a policy.
REVOKE INSERT, UPDATE, DELETE ON public.audit_logs FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.audit_logs FROM anon;
