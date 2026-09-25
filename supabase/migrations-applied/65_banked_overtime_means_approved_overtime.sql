-- The overtime logic check, made real.
--
-- attendance carries overtime_approved (default false) and approved_by — the schema was
-- built for overtime to be acknowledged before it counts. Nothing ever set the flag, and
-- my_overtime_hours (migration 64) summed everything regardless, so the "banked" figure
-- counted overtime no one had approved. This migration makes banked mean approved, adds the
-- act of approving, and caps the number so a miscalculation cannot bank an impossible day.
--
-- What was NOT wrong, on inspection, and worth recording so it is not re-litigated: an
-- employee cannot fabricate their own overtime. ab_attendance_guard forces overtime_hours,
-- overtime_approved and approved_by back to their old values on a self-update, and to
-- null/false on a self-insert, and it computes overtime from the punch against the schedule.
-- The hours are real; the missing piece was only the approval gate on the count.
--
-- Applied to production 2026-09-25 and verified: max overtime now 24 (was 53.92), the total
-- function counts approved rows only, and banked reads 0 until an approver acts.

-- 1. Banked overtime is approved overtime.
CREATE OR REPLACE FUNCTION public.my_overtime_hours(p_year integer)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(a.overtime_hours), 0)
    FROM attendance a
    JOIN employees e ON e.id = a.employee_id
   WHERE e.user_id = (SELECT auth.uid())
     AND a.overtime_approved IS TRUE
     AND EXTRACT(YEAR FROM a.date) = p_year;
$function$;

COMMENT ON FUNCTION public.my_overtime_hours(integer) IS
  'Total APPROVED overtime hours the calling user has banked in a year. Unapproved overtime does not count. A record, not a payment.';

-- 2. A day cannot hold more than 24 hours. A tiny trigger fires right after
--    ab_attendance_guard and clamps whatever it produced into [0, 24].
CREATE OR REPLACE FUNCTION public.clamp_overtime_hours()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.overtime_hours IS NOT NULL THEN
    NEW.overtime_hours := LEAST(24, GREATEST(0, NEW.overtime_hours));
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.clamp_overtime_hours() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER ac_clamp_overtime_hours
  BEFORE INSERT OR UPDATE ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.clamp_overtime_hours();

UPDATE public.attendance SET overtime_hours = 24 WHERE overtime_hours > 24;

-- 3. The act that was missing. HR or the employee's own manager may stamp approval;
--    approved_by comes from auth.uid(), never the client. SECURITY DEFINER because a manager
--    has no direct UPDATE on attendance (att_update is HR only) — the checks inside replace
--    the RLS a definer bypasses.
CREATE OR REPLACE FUNCTION public.approve_overtime(p_attendance_id uuid, p_approved boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid          uuid := (SELECT auth.uid());
  v_role         text;
  v_company      uuid;
  v_emp          uuid;
  v_row_company  uuid;
  v_approver_emp uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Access denied: authentication required';
  END IF;

  v_role    := get_user_role(v_uid);
  v_company := get_user_company_id(v_uid);

  SELECT employee_id, company_id INTO v_emp, v_row_company
  FROM attendance WHERE id = p_attendance_id;

  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'That attendance record does not exist';
  END IF;

  IF v_row_company IS DISTINCT FROM v_company THEN
    RAISE EXCEPTION 'Access denied: cross-company operation not permitted';
  END IF;

  IF NOT (v_role IN ('super_admin', 'hr_manager') OR public.manages_employee(v_emp)) THEN
    RAISE EXCEPTION 'Access denied: only HR or the employee''s manager may approve overtime';
  END IF;

  v_approver_emp := get_user_employee_id(v_uid);

  UPDATE attendance
     SET overtime_approved = p_approved,
         approved_by       = CASE WHEN p_approved THEN v_approver_emp ELSE NULL END
   WHERE id = p_attendance_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.approve_overtime(uuid, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.approve_overtime(uuid, boolean) TO authenticated;
