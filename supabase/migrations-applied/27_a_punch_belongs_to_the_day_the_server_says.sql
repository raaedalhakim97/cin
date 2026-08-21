-- F-04. attendance_guard is careful about time and careless about date.
--
-- For a self-service punch it overwrites clock_in/clock_out with now(), and on UPDATE
-- it refuses to let either move — but `date` arrives from the client and is never
-- checked. Lateness is then graded against
--
--   (NEW.date::timestamp + c.work_start_time) AT TIME ZONE c.timezone
--
-- so a date one day ahead makes any arrival look early and stores 'present'; one day
-- behind stores 'late_major'. A phone with a wrong clock writes a disciplinary record.
--
-- The fix lives in the autolink trigger rather than in attendance_guard because of
-- trigger order: aa_autolink_shift runs first and resolves the shift BY DATE.
-- Correcting the date afterwards would leave the punch linked to the wrong day's shift
-- and then graded against it. Both concerns answer the same question — which day is
-- this punch? — so they belong together, and this trigger already runs first by
-- construction rather than by a naming trick that a collation change could undo.
--
-- HR is deliberately exempt: back-filling a punch for a past date is a normal
-- correction, and it is audited.

CREATE OR REPLACE FUNCTION public.autolink_attendance_to_shift()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid      uuid := (SELECT auth.uid());
  v_role     text;
  v_is_hr    boolean := false;
  v_is_self  boolean := false;
  v_tz       text;
BEGIN
  IF TG_OP = 'INSERT' AND v_uid IS NOT NULL THEN
    v_role   := get_user_role(v_uid);
    v_is_hr  := v_role IN ('super_admin', 'hr_manager');
    v_is_self := EXISTS (
      SELECT 1 FROM employees WHERE id = NEW.employee_id AND user_id = v_uid
    );

    IF v_is_self AND NOT v_is_hr THEN
      SELECT c.timezone INTO v_tz FROM company c WHERE c.id = NEW.company_id;
      -- The company's calendar day, not the device's. A punch at 00:30 in Dubai is
      -- the 21st here and the 20th in UTC; the roster and the working day are the
      -- company's, so the company's timezone decides.
      IF v_tz IS NOT NULL THEN
        NEW.date := (now() AT TIME ZONE v_tz)::date;
      END IF;
    END IF;
  END IF;

  IF NEW.shift_id IS NULL AND NEW.date IS NOT NULL THEN
    SELECT id INTO NEW.shift_id FROM shifts
    WHERE employee_id = NEW.employee_id
      AND shift_date = NEW.date
      AND shift_type = 'work'
      AND status IN ('published','completed')
    ORDER BY start_at LIMIT 1;
  END IF;

  RETURN NEW;
END $function$;

-- Verification, run after applying: a self-service punch inserted with
-- `current_date - 3` was stored as the company's own today.
--
--  stored_date | company_today | utc_today  | corrected
--  2026-08-21  | 2026-08-21    | 2026-08-21 | t
