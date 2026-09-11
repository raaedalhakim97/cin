-- generate_wps_sif raised `malformed array literal` in exactly the situation it was
-- written to handle gracefully.
--
-- Found by calling it, not by reading it. Migration 35 added a country gate to this
-- function and I verified that gate by borrowing a real super_admin session and asking
-- for August 2026. The country gate worked. The call then died here:
--
--   v_errors text[] := '{}';
--   ...
--   v_errors := v_errors || 'Company: MOL establishment ID missing';
--
--   ERROR: 22P02 malformed array literal: "Company: MOL establishment ID missing"
--   DETAIL: Array value must start with "{" or dimension information.
--
-- Postgres offers both `anyarray || anyelement` and `anyarray || anyarray`. Against an
-- untyped string literal it picks the array-to-array form, then tries to parse the
-- sentence as an array literal and fails. This is not new — it predates migration 35,
-- which reproduced the body faithfully including this. It has been live the whole time.
--
-- The reason nobody hit it: this function has no caller in the web app. AdminDashboard.jsx
-- still says "WPS export isn't built yet". So the first real user of the payroll export
-- would have met a Postgres type error instead of "your establishment ID is missing".
--
-- Only the two bare literals are affected. Every other line appends format(...), which
-- returns text explicitly and resolves to the element form correctly — which is why the
-- per-employee validations were fine and only the two company-level ones broke.
--
-- Both companies on production have mol_establishment_id NULL, so this fired on the
-- first honest attempt.

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

  -- Migration 35: is a WPS SIF even the right artefact here? Asking afterwards produces
  -- a list of missing UAE documents shown to someone in a country that does not issue
  -- them.
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

  -- ::text on both. Without it Postgres reads `text[] || <untyped literal>` as array
  -- concatenation and tries to parse the sentence as an array.
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
    SELECT pr.*, e.full_name, e.labour_card_number, e.iban, e.agent_bank_routing_code
    FROM payroll_runs pr
    JOIN employees e ON e.id = pr.employee_id
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
