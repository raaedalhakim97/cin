-- F-02, closed properly now that a company has a leave policy to close it against.
--
-- check_leave_entitlement looked up the employee's balance and, finding none, returned
-- "allowed". 13 of 14 active employees had no balance row, so every one of them could be
-- approved for any number of days and nothing was deducted. Missing data was being read
-- as permission — the defect this whole audit was looking for.
--
-- It could not be fixed before now without inventing a number. With company_leave_
-- policies in place there is a real answer to fall back to, and where there is no policy
-- the honest answer is to refuse and say why.
--
-- (The eligibility rule written here is corrected in migration 33 — twice.)

CREATE OR REPLACE FUNCTION public.ensure_leave_balance(
  p_employee_id uuid, p_leave_type text, p_year integer
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_emp record; v_policy record; v_id uuid;
BEGIN
  SELECT id INTO v_id FROM leave_balances
   WHERE employee_id = p_employee_id AND leave_type = p_leave_type AND year = p_year;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  SELECT e.id, e.company_id, e.hire_date INTO v_emp FROM employees e WHERE e.id = p_employee_id;
  IF v_emp.id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_policy FROM company_leave_policies
   WHERE company_id = v_emp.company_id AND leave_type = p_leave_type;

  -- No policy: nothing to create. The caller decides what that means; it must not mean
  -- "unlimited".
  IF v_policy.id IS NULL THEN RETURN NULL; END IF;
  -- Granted per event rather than held as a balance — these were never the problem.
  IF v_policy.accrual = 'per_event' THEN RETURN NULL; END IF;

  INSERT INTO leave_balances (employee_id, company_id, year, leave_type, entitled_days, used_days)
  VALUES (
    p_employee_id, v_emp.company_id, p_year, p_leave_type,
    CASE
      WHEN v_emp.hire_date IS NOT NULL
       AND v_emp.hire_date > (make_date(p_year, 12, 31) - (v_policy.min_service_months || ' months')::interval)
      THEN 0
      ELSE coalesce(v_policy.days_per_year, 0)
    END,
    0
  )
  ON CONFLICT (employee_id, year, leave_type) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM leave_balances
     WHERE employee_id = p_employee_id AND leave_type = p_leave_type AND year = p_year;
  END IF;
  RETURN v_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.ensure_leave_balance(uuid, text, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ensure_leave_balance(uuid, text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.check_leave_entitlement()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_role text; v_bal record; v_policy record; v_remaining numeric;
  v_year integer := EXTRACT(YEAR FROM NEW.start_date)::int;
BEGIN
  IF v_uid IS NULL THEN RETURN NEW; END IF;
  v_role := get_user_role(v_uid);
  -- HR and the owner may still record leave the balance does not cover — unpaid leave, a
  -- negotiated exception, a correction. That was always deliberate.
  IF v_role IN ('super_admin', 'hr_manager') THEN RETURN NEW; END IF;

  SELECT * INTO v_policy FROM company_leave_policies
   WHERE company_id = (SELECT company_id FROM employees WHERE id = NEW.employee_id)
     AND leave_type = NEW.leave_type;

  IF v_policy.id IS NOT NULL AND v_policy.accrual = 'per_event' THEN RETURN NEW; END IF;

  -- The case that used to mean "allowed" and now means "we do not know what you are
  -- entitled to" — which is the truth, and is HR's to fix.
  IF v_policy.id IS NULL THEN
    RAISE EXCEPTION 'No % leave policy is set for this company, so entitlement cannot be checked. Ask HR to set it in Settings, or to record this leave for you.',
      NEW.leave_type USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.ensure_leave_balance(NEW.employee_id, NEW.leave_type, v_year);

  SELECT * INTO v_bal FROM leave_balances
   WHERE employee_id = NEW.employee_id AND leave_type = NEW.leave_type AND year = v_year;
  IF v_bal.id IS NULL THEN RETURN NEW; END IF;

  v_remaining := v_bal.entitled_days - v_bal.used_days;
  IF NEW.days_requested > v_remaining THEN
    RAISE EXCEPTION 'Not enough % leave: % day(s) requested, % remaining of % entitled. Ask HR to record this as unpaid or special leave.',
      NEW.leave_type, NEW.days_requested, GREATEST(0, v_remaining)::int, v_bal.entitled_days::int
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

-- Backfill: every active employee gets the balance rows their company policy owes them.
DO $$
DECLARE r record; v_year integer := EXTRACT(YEAR FROM current_date)::int;
BEGIN
  FOR r IN
    SELECT e.id AS employee_id, p.leave_type
      FROM employees e
      JOIN company_leave_policies p ON p.company_id = e.company_id
     WHERE e.status = 'active' AND p.accrual <> 'per_event'
  LOOP
    PERFORM public.ensure_leave_balance(r.employee_id, r.leave_type, v_year);
  END LOOP;
END $$;

-- Verified after applying, as a real employee two days into the job:
--   30 days of annual leave  -> refused, "0 remaining of 0 entitled"
--   emergency leave          -> refused, "No emergency leave policy is set"
