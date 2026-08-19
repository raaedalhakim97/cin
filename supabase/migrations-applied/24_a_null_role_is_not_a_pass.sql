-- Two PDPL functions treated "no caller" as "authorised caller", and one of them
-- was reachable without logging in at all.
--
-- Found while wiring suspension: every SECURITY DEFINER function that acts on the
-- caller's company had to be read to see which ones suspension would need to stop.
-- Two of them refuse nobody.
--
-- The idiom is the bug:
--
--   v_caller_role    := get_user_role(auth.uid());        -- NULL when unlinked
--   v_caller_company := get_user_company_id(auth.uid());  -- NULL when unlinked
--   IF v_caller_company != v_emp_company THEN RAISE ... END IF;
--   IF v_caller_role   != 'super_admin'  THEN RAISE ... END IF;
--
-- `NULL != 'super_admin'` is NULL, not true, and `IF NULL THEN` does not fire. So a
-- caller with no user_roles row passes both guards and reaches the body. The same
-- applies to `v_caller_role NOT IN (...)`. Elsewhere in the schema that pattern is
-- harmless because the next statement is company-scoped and finds nothing — these
-- two functions take the employee id straight from the argument and never scope by
-- company again, so nothing downstream catches it.
--
-- Measured, not reasoned about. As the `anon` role, with no JWT, on production:
--
--   SET LOCAL ROLE anon;
--   SELECT export_employee_data('<an employee id>')->'personal_information';
--   -- {"email":"...","full_name":"Yusuf Karim","job_title":"Operations Officer",
--   --  "hire_date":"2025-01-01","national_id":null,...}
--
-- The full return value also carries payroll (gross_salary, net_salary), leave
-- reasons, attendance GPS-adjacent records and consent history, for any employee id
-- in any company. anonymize_employee was not probed, because the probe would have
-- scrubbed a real person's record — but it has the same two guards and no other
-- company check, so an unauthenticated caller could terminate and blank any
-- employee row in the database.
--
-- Two fixes, because either alone leaves a hole:
--
--   1. Refuse on NULL explicitly. This is the real fix — it also closes the
--      authenticated-but-unlinked caller, which is not a hypothetical state: it is
--      the "your login is not linked to an employee record" wall a real account hit
--      in this project, and 6 of 9 user_roles rows have a NULL employee_id.
--
--   2. Revoke EXECUTE from anon on every definer function that needs to know who is
--      calling. A function that begins by asking who the caller is has no anon use
--      case, and migration 18 already established that these helpers are not a
--      public API. get_invite_preview and log_login_attempt keep anon deliberately:
--      the invite landing page and a failed-login audit both happen before a
--      session exists.
--
-- Bodies below are unchanged apart from the guard prologue.

CREATE OR REPLACE FUNCTION public.export_employee_data(p_employee_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := (SELECT auth.uid());
  v_company_id UUID;
  v_caller_role TEXT;
  v_caller_company UUID;
  v_result JSONB;
BEGIN
  -- Ordered so that the cheapest and most absolute refusal comes first.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Access denied: authentication required';
  END IF;

  v_caller_role := get_user_role(v_uid);
  v_caller_company := get_user_company_id(v_uid);

  IF v_caller_company IS NULL THEN
    RAISE EXCEPTION 'Access denied: this account is not attached to a company';
  END IF;

  SELECT company_id INTO v_company_id
  FROM employees WHERE id = p_employee_id;

  -- IS DISTINCT FROM rather than != : a non-existent employee id leaves
  -- v_company_id NULL, and NULL != <uuid> would have been NULL — no refusal. The
  -- message stays the same for "other company" and "no such employee" on purpose;
  -- distinguishing them would confirm which ids exist.
  IF v_caller_company IS DISTINCT FROM v_company_id THEN
    RAISE EXCEPTION 'Access denied: cross-company data access not permitted';
  END IF;

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('super_admin', 'hr_manager') THEN
    IF NOT EXISTS (
      SELECT 1 FROM employees
      WHERE id = p_employee_id AND user_id = v_uid
    ) THEN
      RAISE EXCEPTION 'Access denied: you may only export your own data';
    END IF;
  END IF;

  SELECT jsonb_build_object(
    'export_metadata', jsonb_build_object(
      'generated_at', NOW(),
      'employee_id', p_employee_id,
      'export_type', 'PDPL Article 13 - Right to Access',
      'data_controller', (SELECT name FROM company WHERE id = v_company_id)
    ),
    'personal_information', (
      SELECT to_jsonb(e) FROM (
        SELECT full_name, email, phone, national_id,
               job_title, hire_date, classification, contract_type, status
        FROM employees WHERE id = p_employee_id
      ) e
    ),
    'employment_data', (
      SELECT to_jsonb(emp) FROM (
        SELECT e.hire_date, e.probation_end_date, e.contract_end_date,
               d.name as department
        FROM employees e
        LEFT JOIN departments d ON d.id = e.department_id
        WHERE e.id = p_employee_id
      ) emp
    ),
    'attendance_records', (
      SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb) FROM (
        SELECT date, clock_in, clock_out, status, overtime_hours
        FROM attendance WHERE employee_id = p_employee_id
        ORDER BY date DESC
      ) a
    ),
    'leave_records', (
      SELECT COALESCE(jsonb_agg(to_jsonb(l)), '[]'::jsonb) FROM (
        SELECT leave_type, start_date, end_date, days_requested, status, reason
        FROM leave_requests WHERE employee_id = p_employee_id
        ORDER BY start_date DESC
      ) l
    ),
    'leave_balances', (
      SELECT COALESCE(jsonb_agg(to_jsonb(lb)), '[]'::jsonb) FROM (
        SELECT year, leave_type, entitled_days, used_days, remaining_days
        FROM leave_balances WHERE employee_id = p_employee_id
      ) lb
    ),
    'performance_records', (
      SELECT COALESCE(jsonb_agg(to_jsonb(k)), '[]'::jsonb) FROM (
        SELECT period_year, period_month, total_score, rating, bonus_eligible
        FROM kpi_scores WHERE employee_id = p_employee_id
        ORDER BY period_year DESC, period_month DESC
      ) k
    ),
    'warnings_and_rewards', (
      SELECT COALESCE(jsonb_agg(to_jsonb(ka)), '[]'::jsonb) FROM (
        SELECT type, warning_level, reward_type, points_adjustment, reason,
               period_year, period_month, created_at
        FROM kpi_adjustments WHERE employee_id = p_employee_id
        ORDER BY created_at DESC
      ) ka
    ),
    'payroll_records', (
      SELECT COALESCE(jsonb_agg(to_jsonb(p)), '[]'::jsonb) FROM (
        SELECT period_year, period_month, gross_salary, net_salary, status
        FROM payroll_runs WHERE employee_id = p_employee_id
        ORDER BY period_year DESC, period_month DESC
      ) p
    ),
    'consent_history', (
      SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb) FROM (
        SELECT consent_type, policy_version, consented, consented_at, withdrawn_at
        FROM consent_records WHERE employee_id = p_employee_id
      ) c
    )
  ) INTO v_result;

  INSERT INTO audit_logs (user_id, employee_id, company_id, action, table_name, record_id)
  VALUES (v_uid, p_employee_id, v_company_id, 'DATA_EXPORT_PDPL_ACCESS', 'employees', p_employee_id);

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.anonymize_employee(p_employee_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := (SELECT auth.uid());
  v_caller_role TEXT;
  v_caller_company UUID;
  v_emp_company UUID;
  v_anon_id TEXT;
BEGIN
  -- Security: only a super_admin of the employee's own company may erase.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Access denied: authentication required';
  END IF;

  v_caller_role := get_user_role(v_uid);
  v_caller_company := get_user_company_id(v_uid);

  IF v_caller_company IS NULL THEN
    RAISE EXCEPTION 'Access denied: this account is not attached to a company';
  END IF;

  SELECT company_id INTO v_emp_company
  FROM employees WHERE id = p_employee_id;

  IF v_caller_company IS DISTINCT FROM v_emp_company THEN
    RAISE EXCEPTION 'Access denied: cross-company operation not permitted';
  END IF;

  IF v_caller_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Access denied: only super_admin may perform erasure';
  END IF;

  -- Generate anonymous identifier
  v_anon_id := 'ANON-' || substr(md5(p_employee_id::text), 1, 8);

  -- Anonymize the employee record — scrub all PII
  UPDATE employees SET
    full_name = v_anon_id,
    email = v_anon_id || '@anonymized.local',
    phone = NULL,
    national_id = NULL,
    photo_url = NULL,
    bank_account = NULL,
    -- added in migration 51: financial / identity fields from the WPS work
    iban = NULL,
    labour_card_number = NULL,
    agent_bank_routing_code = NULL,
    job_description = NULL,
    status = 'terminated'
  WHERE id = p_employee_id;

  -- Scrub leave request reasons (may contain personal/medical info)
  UPDATE leave_requests SET
    reason = '[ANONYMIZED]',
    rejection_reason = CASE WHEN rejection_reason IS NOT NULL THEN '[ANONYMIZED]' ELSE NULL END
  WHERE employee_id = p_employee_id;

  -- Scrub KPI notes
  UPDATE kpi_scores SET notes = NULL WHERE employee_id = p_employee_id;
  UPDATE kpi_adjustments SET reason = '[ANONYMIZED]' WHERE employee_id = p_employee_id;

  -- Scrub attendance notes/GPS
  UPDATE attendance SET
    notes = NULL,
    clock_in_lat = NULL, clock_in_lng = NULL,
    clock_out_lat = NULL, clock_out_lng = NULL
  WHERE employee_id = p_employee_id;

  -- NOTE: payroll_runs are NOT deleted — retained per UAE tax law
  -- but they no longer link to identifiable person (name scrubbed above)

  -- Log the erasure
  INSERT INTO audit_logs (user_id, employee_id, company_id, action, table_name, record_id)
  VALUES (v_uid, p_employee_id, v_emp_company, 'DATA_ERASURE_PDPL', 'employees', p_employee_id);

  RETURN jsonb_build_object(
    'status', 'anonymized',
    'anonymous_id', v_anon_id,
    'employee_id', p_employee_id,
    'anonymized_at', NOW(),
    'note', 'PII scrubbed. Payroll/tax records retained per UAE Labour Law but de-identified.'
  );
END;
$function$;

-- Every definer function whose first act is to ask who the caller is. None of them
-- can do anything useful for anon, and each one that reads or writes tenant data is
-- one NULL comparison away from doing it for a stranger.
REVOKE EXECUTE ON FUNCTION public.export_employee_data(uuid)                       FROM anon;
REVOKE EXECUTE ON FUNCTION public.anonymize_employee(uuid)                         FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_employee_invite(text, text, text, uuid, text, date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.generate_employee_invite(uuid, text)             FROM anon;
REVOKE EXECUTE ON FUNCTION public.accept_employee_invite(text)                     FROM anon;
REVOKE EXECUTE ON FUNCTION public.self_onboard_company(text, text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.advance_kpi_review_cycle(uuid)                   FROM anon;
REVOKE EXECUTE ON FUNCTION public.open_kpi_review_cycle(integer, integer, date, date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.approve_warning_recommendation(uuid, integer, integer, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.evaluate_kpi_rules(integer, integer)             FROM anon;
REVOKE EXECUTE ON FUNCTION public.recompute_kpi_totals(integer, integer)           FROM anon;
REVOKE EXECUTE ON FUNCTION public.generate_wps_sif(integer, integer)               FROM anon;
REVOKE EXECUTE ON FUNCTION public.calculate_attendance_score(uuid, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_user_session(text, timestamptz)           FROM anon;
REVOKE EXECUTE ON FUNCTION public.mark_session_inactive(text)                      FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_active_session_count(uuid)                   FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_active_session_count()                       FROM anon;

-- The five helpers that answer "who is this user" took a uid as an argument, so an
-- unauthenticated caller holding any user's UUID could ask which company they belong
-- to and what role they hold. anon has no legitimate caller for them: its only
-- privilege anywhere in the schema is INSERT on demo_requests (the landing page's
-- demo form), whose policy is `status = 'new'` and calls no helper. `authenticated`
-- must keep EXECUTE — RLS expressions are evaluated as the querying role, and the
-- 100 tenant policies go through get_user_company_id. Nested calls inside a
-- SECURITY DEFINER function are checked as the function owner, so get_invite_preview
-- keeps working for anon regardless of this.
REVOKE EXECUTE ON FUNCTION public.get_user_company_id(uuid)     FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_role(uuid)           FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_department_id(uuid)  FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_platform_owner(uuid)       FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_evaluation_month(integer)  FROM anon;

-- What deliberately keeps anon, stated here so a future reader does not "tidy" it:
--   get_invite_preview(text)          — the invite page renders before login
--   log_login_attempt(text, boolean)  — a failed login has no session to log with
--   compute_kpi_rating(numeric)       — pure arithmetic, touches no table
--   geofence_requires_a_location()    — trigger functions; anon has no DML on the
--   last_work_location_is_protected() — tables they guard, so they never fire for it
--
-- Verification. The first two must both be false; before this migration the export
-- probe above returned a real person's record. Measured after applying: the count
-- of definer functions reachable by anon went from 27 to 5, and all 5 are the list
-- immediately above.
SELECT 'anon can export employee data (must be false)' AS check,
       has_function_privilege('anon', 'public.export_employee_data(uuid)', 'EXECUTE')::text AS value
UNION ALL
SELECT 'anon can anonymize an employee (must be false)',
       has_function_privilege('anon', 'public.anonymize_employee(uuid)', 'EXECUTE')::text
UNION ALL
SELECT 'anon can still preview an invite (must be true)',
       has_function_privilege('anon', 'public.get_invite_preview(text)', 'EXECUTE')::text
UNION ALL
SELECT 'definer functions still reachable by anon',
       (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.prosecdef
           AND has_function_privilege('anon', p.oid, 'EXECUTE'));
