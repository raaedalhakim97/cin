-- Leave balances: make them atomic, authoritative, and impossible to overdraw
-- by accident.
--
-- Measured (BYOND production, 6 Aug 2026): one employee's annual balance is
-- entitled 21 / used 34 = -13 days. A 32-day annual request was submitted and
-- approved against a 21-day entitlement with nothing objecting. The web shows
-- "Exceeded" on the balance card only after the fact.
--
-- Two separate defects produced that:
--   1. Nothing checks the balance at submission time.
--   2. Both clients maintained used_days with a read-then-write from the
--      browser (SELECT used_days, then UPDATE used_days = value + n). Two
--      concurrent requests lose one increment, and because leave_balances is
--      writable by the employee, the same call with a negative delta hands
--      days back.
--
-- Both are fixed by moving the arithmetic into the database, where the row is
-- locked for the duration of the statement and the caller cannot choose the
-- delta. src/pages/Leave.jsx and mobile/src/lib/leave.js no longer touch
-- used_days at all — leaving those in place would double-count.

CREATE OR REPLACE FUNCTION public.maintain_leave_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  -- A request in one of these states is holding days; anything else has
  -- released them.
  v_live      constant text[] := ARRAY['pending', 'manager_approved', 'approved'];
  v_was_live  boolean := false;
  v_is_live   boolean := false;
  v_delta     numeric := 0;
  v_row       record;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_was_live := OLD.status = ANY (v_live); END IF;
  IF TG_OP <> 'DELETE' THEN v_is_live  := NEW.status = ANY (v_live); END IF;

  IF TG_OP = 'UPDATE' AND v_was_live = v_is_live
     AND NEW.days_requested IS NOT DISTINCT FROM OLD.days_requested THEN
    RETURN NEW;
  END IF;

  IF v_was_live THEN v_delta := v_delta - COALESCE(OLD.days_requested, 0); END IF;
  IF v_is_live  THEN v_delta := v_delta + COALESCE(NEW.days_requested, 0); END IF;

  IF v_delta <> 0 THEN
    SELECT * INTO v_row
      FROM leave_balances
     WHERE employee_id = COALESCE(NEW.employee_id, OLD.employee_id)
       AND leave_type  = COALESCE(NEW.leave_type,  OLD.leave_type)
       AND year = EXTRACT(YEAR FROM COALESCE(NEW.start_date, OLD.start_date))::int
     FOR UPDATE;

    -- No balance row means this leave type isn't tracked for this employee
    -- (marriage, hajj and bereavement are provisioned per-event, not
    -- annually). Nothing to hold, nothing to check.
    IF FOUND THEN
      UPDATE leave_balances
         SET used_days = GREATEST(0, used_days + v_delta)
       WHERE id = v_row.id;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ab_maintain_leave_balance ON public.leave_requests;
CREATE TRIGGER ab_maintain_leave_balance
  AFTER INSERT OR UPDATE OR DELETE ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.maintain_leave_balance();

-- Entitlement check at submission. HR and super_admin are exempt: recording
-- unpaid leave, or leave carried by an agreement outside the annual
-- allowance, is a legitimate thing for them to do deliberately. An employee
-- submitting for themselves is not doing that.
CREATE OR REPLACE FUNCTION public.check_leave_entitlement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid       uuid := (SELECT auth.uid());
  v_role      text;
  v_bal       record;
  v_remaining numeric;
BEGIN
  IF v_uid IS NULL THEN RETURN NEW; END IF;
  v_role := get_user_role(v_uid);
  IF v_role IN ('super_admin', 'hr_manager') THEN RETURN NEW; END IF;

  SELECT * INTO v_bal
    FROM leave_balances
   WHERE employee_id = NEW.employee_id
     AND leave_type  = NEW.leave_type
     AND year = EXTRACT(YEAR FROM NEW.start_date)::int;

  IF NOT FOUND THEN RETURN NEW; END IF;

  v_remaining := v_bal.entitled_days - v_bal.used_days;
  IF NEW.days_requested > v_remaining THEN
    RAISE EXCEPTION 'Not enough % leave: % day(s) requested, % remaining of % entitled. Ask HR to record this as unpaid or special leave.',
      NEW.leave_type, NEW.days_requested, GREATEST(0, v_remaining)::int, v_bal.entitled_days::int
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS aa_check_leave_entitlement ON public.leave_requests;
CREATE TRIGGER aa_check_leave_entitlement
  BEFORE INSERT ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.check_leave_entitlement();
