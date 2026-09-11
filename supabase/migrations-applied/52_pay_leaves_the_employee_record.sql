-- Finding 1 of the logic audit, and the one the payroll switch could not fix.
--
-- Measured on production with the company's own "managers can see salaries" setting OFF:
--
--   Omar (department manager)  read basic_salary for 2 of his team
--   read_only (the auditor)    read all 12 salaries
--   admin (operations)         read all 12 salaries
--
-- That setting guards payroll_runs. Salary was never only in payroll_runs — it sat on the
-- employee record, and emp_select hands the whole row to super_admin, hr_manager, admin and
-- read_only, plus a manager's own team. Row-level security decides which ROWS you may read
-- and never which COLUMNS, so anyone entitled to an employee's row was entitled to their
-- pay. Switching payroll off in the app did not touch it: these columns are read by the
-- employee record screen, not only by the payroll page.
--
-- ── Why a table and not a permission ───────────────────────────────────────
--
-- Postgres can revoke a column from a role — but every signed-in user connects as the same
-- database role, `authenticated`, and who they are is decided inside the policies by
-- get_user_role(). A column grant cannot tell HR from an auditor, because to Postgres they
-- are the same role. The only way to express "HR yes, auditor no" is to put the data in a
-- table whose policies can ask the question.
--
--   employee_pay   basic_salary, the three allowances, bank_account, iban, routing code
--
-- Read: HR, the owner, and the person themselves. Write: HR and the owner — not the
-- employee, because your own salary is the one field you must not be able to edit.
--
-- ── Two things this migration got wrong on the way in ──────────────────────
--
-- Both worth recording, because both were caught by running it rather than reading it.
--
-- 1. It moved basic_salary and missed housing_allowance, transport_allowance and
--    other_allowance — equally pay, and equally readable. Found when updating the payroll
--    screen, which selects all four together. The grep that found the columns to move
--    searched for salary/bank/iban/national and an allowance is none of those words.
--
-- 2. The table was created with employee_id as its primary key, and the shared audit
--    trigger log_sensitive_changes() writes NEW.id. Every UPDATE failed with "record new
--    has no field id". So employee_pay takes the same shape as every other table here —
--    a surrogate id, with employee_id unique — rather than the audit trigger learning
--    about a special case.
--
-- ── What deliberately does NOT move ────────────────────────────────────────
--
-- national_id and labour_card_number stay on employees. They are identity documents rather
-- than pay, and operations ('admin') handles visas and permits as its job — this finding
-- was about compensation. That leaves an auditor able to read a national ID, which is a
-- smaller and different question, and Raaed's to answer rather than this migration's. The
-- mechanism to move them later is now three lines.

CREATE TABLE IF NOT EXISTS public.employee_pay (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id uuid NOT NULL UNIQUE REFERENCES public.employees(id) ON DELETE CASCADE,
  -- Denormalised so a policy can scope by tenant without joining employees. Joining it
  -- would make this table's visibility depend on emp_select, which is the policy that
  -- caused the problem.
  company_id  uuid NOT NULL REFERENCES public.company(id) ON DELETE CASCADE,
  basic_salary        numeric(12,2),
  housing_allowance   numeric(12,2),
  transport_allowance numeric(12,2),
  other_allowance     numeric(12,2),
  bank_account text,
  iban text,
  agent_bank_routing_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employee_pay_company_id ON public.employee_pay (company_id);

CREATE TRIGGER employee_pay_updated_at BEFORE UPDATE ON public.employee_pay
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER audit_employee_pay
  AFTER INSERT OR UPDATE OR DELETE ON public.employee_pay
  FOR EACH ROW EXECUTE FUNCTION public.log_sensitive_changes();

-- Move what is there. A row is created for anyone who has any of the seven values, so
-- nothing is lost and nobody gains an empty row that claims we hold pay data for them.
-- Measured after this ran: 17 rows, 17 with a salary, 16 with allowances, 2 with a bank
-- account — matching the source exactly.
INSERT INTO public.employee_pay
  (employee_id, company_id, basic_salary, housing_allowance, transport_allowance,
   other_allowance, bank_account, iban, agent_bank_routing_code)
SELECT e.id, e.company_id, e.basic_salary, e.housing_allowance, e.transport_allowance,
       e.other_allowance, e.bank_account, e.iban, e.agent_bank_routing_code
  FROM public.employees e
 WHERE e.basic_salary IS NOT NULL OR e.housing_allowance IS NOT NULL
    OR e.transport_allowance IS NOT NULL OR e.other_allowance IS NOT NULL
    OR e.bank_account IS NOT NULL OR e.iban IS NOT NULL
    OR e.agent_bank_routing_code IS NOT NULL
ON CONFLICT (employee_id) DO NOTHING;

ALTER TABLE public.employee_pay ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.employee_pay FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_pay TO authenticated;

-- The employee's own row is included because it is their pay: the mobile profile shows it
-- to them, and a product that hides someone's own salary from them is absurd.
CREATE POLICY employee_pay_select ON public.employee_pay
  FOR SELECT TO authenticated
  USING (
    company_id = get_user_company_id((SELECT auth.uid()))
    AND (
      get_user_role((SELECT auth.uid())) IN ('super_admin', 'hr_manager')
      OR employee_id = get_user_employee_id((SELECT auth.uid()))
    )
  );

CREATE POLICY employee_pay_write ON public.employee_pay
  FOR ALL TO authenticated
  USING (company_id = get_user_company_id((SELECT auth.uid()))
         AND get_user_role((SELECT auth.uid())) IN ('super_admin', 'hr_manager'))
  WITH CHECK (company_id = get_user_company_id((SELECT auth.uid()))
              AND get_user_role((SELECT auth.uid())) IN ('super_admin', 'hr_manager'));

-- ── The country validation follows its columns ─────────────────────────────
-- employee_identifiers_fit_the_country validated three things: the IBAN, the bank routing
-- code and the labour card. Two have moved, so the check splits — the same rules, asked
-- where the data now lives.
CREATE OR REPLACE FUNCTION public.employee_pay_fits_the_country()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_code text;
BEGIN
  SELECT c.country INTO v_code FROM company c WHERE c.id = NEW.company_id;

  IF NEW.iban IS NOT NULL THEN
    IF v_code = 'AE' THEN
      IF NEW.iban !~ '^AE[0-9]{21}$' THEN
        RAISE EXCEPTION 'A UAE IBAN is AE followed by 21 digits. Got % characters.', length(NEW.iban)
          USING ERRCODE = 'P0001';
      END IF;
    ELSIF NEW.iban !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$' THEN
      RAISE EXCEPTION 'That does not look like an IBAN: two country letters, two check digits, then the account.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.agent_bank_routing_code IS NOT NULL THEN
    IF v_code = 'AE' THEN
      IF NEW.agent_bank_routing_code !~ '^[0-9]{9}$' THEN
        RAISE EXCEPTION 'A UAE routing code is 9 digits.' USING ERRCODE = 'P0001';
      END IF;
    ELSIF length(NEW.agent_bank_routing_code) > 20 THEN
      RAISE EXCEPTION 'Bank routing code is too long (max 20 characters).' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER ab_employee_pay_identifiers
  BEFORE INSERT OR UPDATE ON public.employee_pay
  FOR EACH ROW EXECUTE FUNCTION public.employee_pay_fits_the_country();

-- And what is left on employees is the work permit alone.
CREATE OR REPLACE FUNCTION public.employee_identifiers_fit_the_country()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_code text;
BEGIN
  SELECT c.country INTO v_code FROM company c WHERE c.id = NEW.company_id;

  IF NEW.labour_card_number IS NOT NULL THEN
    IF v_code = 'AE' THEN
      IF NEW.labour_card_number !~ '^[0-9]{14}$' THEN
        RAISE EXCEPTION 'A UAE labour card number is 14 digits.' USING ERRCODE = 'P0001';
      END IF;
    ELSIF length(NEW.labour_card_number) > 40 THEN
      RAISE EXCEPTION 'Work permit number is too long (max 40 characters).' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ── The two functions that read the banking details ────────────────────────
-- The bank file. One join changes; every rule about what makes a file valid is untouched.
-- LEFT JOIN, not JOIN: somebody with no pay row has no IBAN, and the loop already reports
-- that as a named error. An inner join would drop them from the file AND from the errors,
-- which is how a person misses a payday quietly.
CREATE OR REPLACE FUNCTION public.generate_wps_sif(p_year integer, p_month integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_company_id uuid;
  v_company record;
  v_payment_file text;
  v_errors text[] := '{}';
  v_edr jsonb := '[]'::jsonb;
  v_total numeric := 0;
  v_count integer := 0;
  v_draft_count integer := 0;
  v_now timestamptz := now();
  r record;
BEGIN
  SELECT company_id INTO v_company_id
  FROM user_roles
  WHERE user_id = v_uid
    AND role IN ('super_admin', 'hr_manager')
  LIMIT 1;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Access denied: WPS SIF generation requires super_admin or hr_manager role';
  END IF;

  IF p_month IS NULL OR p_month NOT BETWEEN 1 AND 12 OR p_year IS NULL OR p_year < 2020 THEN
    RAISE EXCEPTION 'Invalid period: year=%, month=%', p_year, p_month;
  END IF;

  SELECT * INTO v_company FROM company WHERE id = v_company_id;

  SELECT payment_file INTO v_payment_file
    FROM country_rules WHERE code = v_company.country;

  IF v_payment_file IS DISTINCT FROM 'uae_wps_sif' THEN
    RETURN jsonb_build_object(
      'valid', false,
      'unsupported_country', true,
      'country', v_company.country,
      'payment_file', coalesce(v_payment_file, 'none'),
      'errors', to_jsonb(ARRAY[
        format('BYOND does not generate a bank salary transfer file for %s. Export the payroll run instead — the figures are the same, the file format is not.',
               coalesce((SELECT name FROM country_rules WHERE code = v_company.country), v_company.country))
      ])
    );
  END IF;

  -- ::text on both. Without it this is read as array concatenation.
  IF v_company.mol_establishment_id IS NULL THEN
    v_errors := v_errors || 'Company: MOL establishment ID missing'::text;
  END IF;
  IF v_company.employer_bank_routing_code IS NULL THEN
    v_errors := v_errors || 'Company: employer bank routing code missing'::text;
  END IF;

  SELECT count(*) INTO v_draft_count
  FROM payroll_runs
  WHERE company_id = v_company_id
    AND period_year = p_year AND period_month = p_month
    AND status = 'draft';

  FOR r IN
    SELECT pr.*, e.full_name, e.labour_card_number,
           p.iban, p.agent_bank_routing_code
    FROM payroll_runs pr
    JOIN employees e ON e.id = pr.employee_id
    LEFT JOIN employee_pay p ON p.employee_id = e.id
    WHERE pr.company_id = v_company_id
      AND pr.period_year = p_year
      AND pr.period_month = p_month
      AND pr.status IN ('approved', 'paid')
    ORDER BY e.full_name
  LOOP
    IF r.labour_card_number IS NULL THEN
      v_errors := v_errors || format('%s: labour card number missing', r.full_name);
    END IF;
    IF r.iban IS NULL THEN
      v_errors := v_errors || format('%s: IBAN missing', r.full_name);
    END IF;
    IF r.agent_bank_routing_code IS NULL THEN
      v_errors := v_errors || format('%s: agent bank routing code missing', r.full_name);
    END IF;
    IF r.days_on_pay IS NULL THEN
      v_errors := v_errors || format('%s: days on pay missing on payroll run', r.full_name);
    END IF;
    IF r.fixed_income IS NULL OR r.variable_income IS NULL THEN
      v_errors := v_errors || format('%s: fixed/variable income split missing on payroll run', r.full_name);
    END IF;

    v_count := v_count + 1;
    v_total := v_total + COALESCE(r.net_salary, 0);

    v_edr := v_edr || jsonb_build_object(
      'record_type', 'EDR',
      'employee_unique_id', r.labour_card_number,
      'agent_routing_code', r.agent_bank_routing_code,
      'iban', r.iban,
      'pay_start_date', to_char(make_date(p_year, p_month, 1), 'YYYY-MM-DD'),
      'pay_end_date', to_char((make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date, 'YYYY-MM-DD'),
      'days_on_pay', r.days_on_pay,
      'net_salary', r.net_salary,
      'fixed_income', r.fixed_income,
      'variable_income', r.variable_income,
      'leave_days', COALESCE(r.leave_days, 0)
    );
  END LOOP;

  IF v_count = 0 THEN
    v_errors := v_errors || format('No approved/paid payroll runs found for %s-%s', p_year, lpad(p_month::text, 2, '0'));
  END IF;

  INSERT INTO audit_logs (user_id, action, table_name, new_data, company_id)
  VALUES (
    v_uid, 'wps_sif_generated', 'payroll_runs',
    jsonb_build_object('period_year', p_year, 'period_month', p_month,
                       'record_count', v_count, 'valid', cardinality(v_errors) = 0),
    v_company_id
  );

  IF cardinality(v_errors) > 0 THEN
    RETURN jsonb_build_object('valid', false, 'errors', to_jsonb(v_errors),
                              'draft_runs_excluded', v_draft_count);
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'draft_runs_excluded', v_draft_count,
    'edr', v_edr,
    'scr', jsonb_build_object(
      'record_type', 'SCR',
      'employer_mol_id', v_company.mol_establishment_id,
      'employer_bank_routing_code', v_company.employer_bank_routing_code,
      'file_creation_date', to_char(v_now, 'YYYY-MM-DD'),
      'file_creation_time', to_char(v_now, 'HH24MI'),
      'salary_month', lpad(p_month::text, 2, '0') || p_year::text,
      'edr_count', v_count,
      'total_salary', v_total,
      'currency', v_company.currency,
      'reference', 'BYOND-' || p_year::text || lpad(p_month::text, 2, '0')
    )
  );
END;
$function$;

-- Erasure. The banking details it used to null on employees are nulled where they now
-- live. basic_salary is left alone, exactly as before: it is a tax record, and the note
-- this function returns has always said payroll data is retained and de-identified rather
-- than deleted.
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

  v_anon_id := 'ANON-' || substr(md5(p_employee_id::text), 1, 8);

  UPDATE employees SET
    full_name = v_anon_id,
    email = v_anon_id || '@anonymized.local',
    phone = NULL,
    national_id = NULL,
    photo_url = NULL,
    labour_card_number = NULL,
    job_description = NULL,
    status = 'terminated'
  WHERE id = p_employee_id;

  UPDATE employee_pay SET
    bank_account = NULL,
    iban = NULL,
    agent_bank_routing_code = NULL
  WHERE employee_id = p_employee_id;

  UPDATE leave_requests SET
    reason = '[ANONYMIZED]',
    rejection_reason = CASE WHEN rejection_reason IS NOT NULL THEN '[ANONYMIZED]' ELSE NULL END
  WHERE employee_id = p_employee_id;

  UPDATE kpi_scores SET notes = NULL WHERE employee_id = p_employee_id;
  UPDATE kpi_adjustments SET reason = '[ANONYMIZED]' WHERE employee_id = p_employee_id;

  UPDATE attendance SET
    notes = NULL,
    clock_in_lat = NULL, clock_in_lng = NULL,
    clock_out_lat = NULL, clock_out_lng = NULL
  WHERE employee_id = p_employee_id;

  -- NOTE: payroll_runs are NOT deleted — retained per tax law, but they no longer link to
  -- an identifiable person (the name is scrubbed above).

  INSERT INTO audit_logs (user_id, employee_id, company_id, action, table_name, record_id)
  VALUES (v_uid, p_employee_id, v_emp_company, 'DATA_ERASURE_PDPL', 'employees', p_employee_id);

  RETURN jsonb_build_object(
    'status', 'anonymized',
    'anonymous_id', v_anon_id,
    'employee_id', p_employee_id,
    'anonymized_at', NOW(),
    'note', 'PII scrubbed. Payroll/tax records retained per labour law but de-identified.'
  );
END;
$function$;

-- ── And the columns go ─────────────────────────────────────────────────────
-- Last, so everything above is already reading the new home before the old one disappears.
-- Until this statement runs the data exists in two places and the leak is still open; the
-- release that contains the client change has to go out with it, not after it.
ALTER TABLE public.employees
  DROP COLUMN IF EXISTS basic_salary,
  DROP COLUMN IF EXISTS housing_allowance,
  DROP COLUMN IF EXISTS transport_allowance,
  DROP COLUMN IF EXISTS other_allowance,
  DROP COLUMN IF EXISTS bank_account,
  DROP COLUMN IF EXISTS iban,
  DROP COLUMN IF EXISTS agent_bank_routing_code;
