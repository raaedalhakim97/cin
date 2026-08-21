-- Three findings from the logic audit that share nothing except that each was a rule
-- everyone assumed was being applied, and none of them was.

-- ── F-08 · the session cleanup job was never scheduled ───────────────────────
--
-- cleanup_expired_sessions has existed and been correct all along. Nothing ever called
-- it: the database had exactly two cron jobs, the monthly KPI evaluation and the
-- nightly missing-clock-out sweep. 27 sessions were expired and still flagged active.
--
-- Correction to the audit as written: the audit said "the count shown is wrong". It is
-- not. Both get_active_session_count variants already filter on
-- `is_active AND expires_at > now()`, and the app only ever reads the count through
-- them, so the number a user sees was always right. What was wrong is the stored state
-- — 27 rows that any future query reading is_active on its own would have believed.
-- The fix is still worth making; the consequence was smaller than claimed.
--
-- 03:15 UTC is 07:15 in Dubai: after the working day starts, so a session that expired
-- overnight is tidied before anyone looks.
SELECT cron.schedule(
  'nightly-session-cleanup',
  '15 3 * * *',
  $$SELECT public.cleanup_expired_sessions();$$
);

-- Catch up on the 27 that accumulated while nothing was running.
SELECT public.cleanup_expired_sessions();

-- ── F-09 · days requested were unrelated to the dates requested ──────────────
--
-- Nothing linked days_requested to the span, and nothing required the range to run
-- forwards. The balance is deducted by days_requested while attendance excuses every
-- date in the range, so the two numbers were free to disagree.
--
-- Both constraints hold against every existing row (3 requests, 0 violations).
ALTER TABLE public.leave_requests
  ADD CONSTRAINT leave_dates_run_forwards
  CHECK (end_date >= start_date);

ALTER TABLE public.leave_requests
  ADD CONSTRAINT leave_days_fit_the_range
  CHECK (days_requested IS NULL
         OR (days_requested > 0 AND days_requested <= (end_date - start_date + 1)));

-- HONEST LIMIT, and it is the direction that matters more:
--
-- This closes over-claiming (10 days booked against a 2-day range — verified refused)
-- and reversed ranges. It does NOT close under-claiming — a 30-day range with 1 day
-- requested still costs one day of balance while excusing thirty days of attendance,
-- because 1 <= 30 satisfies the constraint.
--
-- That is deliberate, not an oversight: the correct rule is equality with the span
-- minus non-working days, and this product has no working-week calendar yet. In the
-- Gulf a Friday–Saturday weekend inside a leave range should not consume annual leave,
-- so asserting equality today would quietly overcharge every employee. F-09 therefore
-- stays open in the action plan, paired with the calendar decision.

-- ── F-03 · payroll arithmetic was never checked ──────────────────────────────
--
-- Every money column on a payroll run is typed by hand and nothing checked that they
-- add up. generate_wps_sif builds the bank file from these same numbers, so a payslip
-- and a bank transfer could disagree.
--
-- Enforced at the draft boundary rather than as a CHECK constraint, so a run can be
-- half-entered and saved while HR is working on it. Once it leaves draft it is a
-- statement about money owed, and it has to be internally consistent.
CREATE OR REPLACE FUNCTION public.validate_payroll_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_role text;
  v_caller_emp uuid;
  v_components numeric;
  v_expected_net numeric;
BEGIN
  IF v_uid IS NULL OR NEW.status = OLD.status THEN RETURN NEW; END IF;
  v_role := get_user_role(v_uid);
  SELECT id INTO v_caller_emp FROM employees WHERE user_id = v_uid LIMIT 1;

  IF OLD.status = 'draft' AND NEW.status = 'approved' THEN
    IF v_role <> 'super_admin' THEN
      RAISE EXCEPTION 'Payroll approval requires super admin (maker-checker: HR prepares, owner approves)';
    END IF;

    v_components := coalesce(NEW.basic_salary, 0) + coalesce(NEW.housing_allowance, 0)
                  + coalesce(NEW.transport_allowance, 0) + coalesce(NEW.other_allowance, 0)
                  + coalesce(NEW.overtime_pay, 0) + coalesce(NEW.performance_bonus, 0);

    IF coalesce(NEW.gross_salary, 0) <> v_components THEN
      RAISE EXCEPTION 'Payroll does not add up: gross is % but basic + allowances + overtime + bonus is %. Correct the figures before approving.',
        coalesce(NEW.gross_salary, 0), v_components USING ERRCODE = 'P0001';
    END IF;

    v_expected_net := coalesce(NEW.gross_salary, 0) - coalesce(NEW.deductions, 0);
    IF coalesce(NEW.net_salary, 0) <> v_expected_net THEN
      RAISE EXCEPTION 'Payroll does not add up: net is % but gross minus deductions is %. This is the figure that goes to the bank.',
        coalesce(NEW.net_salary, 0), v_expected_net USING ERRCODE = 'P0001';
    END IF;

    NEW.approved_by := COALESCE(NEW.approved_by, v_caller_emp);
    RETURN NEW;
  END IF;

  IF OLD.status = 'approved' AND NEW.status = 'paid' THEN
    IF v_role IN ('hr_manager','super_admin') THEN
      NEW.paid_at := COALESCE(NEW.paid_at, now());
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Only HR or super admin can mark payroll as paid';
  END IF;

  -- super_admin may send an approved run back to draft (corrections)
  IF OLD.status = 'approved' AND NEW.status = 'draft' AND v_role = 'super_admin' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid payroll status transition: % → %', OLD.status, NEW.status;
END $function$;

-- Verification, run after applying:
--   gross 7500 against components of 6500 → refused, naming both figures
--   gross 6500, net 6300, deductions 200  → approved, approver recorded
--   stale active sessions: 27 → 0
--   over-claimed leave (10 days on a 2-day range) → refused by check constraint
