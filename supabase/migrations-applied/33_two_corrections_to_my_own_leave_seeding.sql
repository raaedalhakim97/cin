-- Two corrections to migrations 31 and 32, applied minutes later. Both are the same
-- mistake the audit was about, committed while fixing it, which is worth recording
-- rather than quietly patching.
--
-- ── 1. I invented a number and cited a law next to it ───────────────────────
--
-- The UAE sick leave row said min_service_months = 3, referenced Art. 31, and Art. 31
-- says no such thing: entitlement begins after the PROBATION PERIOD, whose length is a
-- term of the individual contract (up to six months). Three was a plausible-looking
-- guess sitting under a legal citation, which is worse than no rule at all — the
-- citation is what makes a reader stop checking.
--
-- employees.probation_end_date already exists and is the real answer, so eligibility for
-- sick leave now reads it. The pack row carries 0 months and says plainly that probation
-- governs.
--
-- ── 2. Eligibility was measured at the end of the year, not today ───────────
--
-- The seeding asked "will this person have enough service by 31 December?", so an
-- employee hired two days ago was granted a full year of sick leave immediately. It
-- should ask whether they are eligible NOW.
--
-- That creates a second problem the first version hid: someone who becomes eligible in
-- November needs their balance raised when they cross the threshold, and
-- ensure_leave_balance only ever created rows. It now tops up a row it previously wrote
-- as zero — and only one it wrote itself, so a figure HR has edited is never overwritten.

UPDATE public.country_leave_rules
   SET min_service_months = 0,
       notes = 'Ninety days per year, staged: first 15 at full pay, next 30 at half pay, final 45 unpaid. Entitlement begins after the probation period, which is a term of the individual contract rather than a fixed number of months — eligibility is taken from the employee''s probation end date. The staging is not modelled as separate balances yet; the figure is the total entitlement.'
 WHERE country_code = 'AE' AND leave_type = 'sick';

UPDATE public.country_leave_rules
   SET notes = 'Thirty calendar days a year after one year of service. The separate rule for six to twelve months of service — two working days per month — is NOT modelled yet: this row is the post-twelve-month entitlement only, and HR grants the partial year manually until partial accrual exists.'
 WHERE country_code = 'AE' AND leave_type = 'annual';

UPDATE public.company_leave_policies p
   SET min_service_months = 0, notes = r.notes
  FROM public.country_leave_rules r
 WHERE r.country_code = 'AE' AND r.leave_type = 'sick'
   AND p.leave_type = 'sick' AND p.source = 'country_pack';

CREATE OR REPLACE FUNCTION public.ensure_leave_balance(
  p_employee_id uuid, p_leave_type text, p_year integer
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_emp record; v_policy record; v_existing record;
  v_eligible boolean; v_entitled numeric; v_id uuid;
BEGIN
  SELECT e.id, e.company_id, e.hire_date, e.probation_end_date INTO v_emp
    FROM employees e WHERE e.id = p_employee_id;
  IF v_emp.id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_policy FROM company_leave_policies
   WHERE company_id = v_emp.company_id AND leave_type = p_leave_type;

  IF v_policy.id IS NULL OR v_policy.accrual = 'per_event' THEN RETURN NULL; END IF;

  -- Eligible as of today, not as of some point later in the year.
  --
  -- Sick leave hangs off probation rather than a month count, because that is what the
  -- statute says. An employee with no probation date recorded is treated as past it —
  -- the alternative is withholding sick leave over a missing field.
  IF p_leave_type = 'sick' THEN
    v_eligible := v_emp.probation_end_date IS NULL OR v_emp.probation_end_date <= current_date;
  ELSIF v_policy.min_service_months = 0 THEN
    v_eligible := true;
  ELSE
    v_eligible := v_emp.hire_date IS NOT NULL
              AND v_emp.hire_date <= (current_date - (v_policy.min_service_months || ' months')::interval);
  END IF;

  v_entitled := CASE WHEN v_eligible THEN coalesce(v_policy.days_per_year, 0) ELSE 0 END;

  SELECT * INTO v_existing FROM leave_balances
   WHERE employee_id = p_employee_id AND leave_type = p_leave_type AND year = p_year;

  IF v_existing.id IS NOT NULL THEN
    -- Top up a row this function wrote as zero, once the employee becomes eligible.
    -- entitled_days = 0 is the marker of an untouched not-yet-eligible row; anything
    -- else is a figure a person chose, and is left alone.
    IF v_existing.entitled_days = 0 AND v_entitled > 0 THEN
      UPDATE leave_balances SET entitled_days = v_entitled WHERE id = v_existing.id;
    END IF;
    RETURN v_existing.id;
  END IF;

  INSERT INTO leave_balances (employee_id, company_id, year, leave_type, entitled_days, used_days)
  VALUES (p_employee_id, v_emp.company_id, p_year, p_leave_type, v_entitled, 0)
  ON CONFLICT (employee_id, year, leave_type) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM leave_balances
     WHERE employee_id = p_employee_id AND leave_type = p_leave_type AND year = p_year;
  END IF;
  RETURN v_id;
END;
$function$;

-- Re-evaluate the balances the seeding created, now that the rule is right. Only rows
-- still sitting at the seeded value are touched.
UPDATE public.leave_balances b
   SET entitled_days = 0
  FROM public.employees e, public.company_leave_policies p
 WHERE b.employee_id = e.id
   AND p.company_id = e.company_id
   AND p.leave_type = b.leave_type
   AND b.leave_type = 'sick'
   AND b.used_days = 0
   AND b.entitled_days = coalesce(p.days_per_year, 0)
   AND e.probation_end_date IS NOT NULL
   AND e.probation_end_date > current_date;

-- Verified after applying:
--   Hkraaed, hired 2026-08-19, probation to 2026-09-23 -> annual 0, sick 0, study 0
--   Yusuf Karim, hired 2025-01-01, no probation date   -> annual 30, sick 90, study 0
--   (study is 0 because it needs 24 months and he has 19)
