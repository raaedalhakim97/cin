-- Three places that still answered as though every customer were in the UAE. Migration
-- 34 made company.country trustworthy; this spends it.
--
-- (Migration 36 fixes a bug this file inherited: generate_wps_sif's body is reproduced
-- here faithfully, including two string appends that raise 22P02. Testing the country
-- gate below is what surfaced it.)
--
-- ── 1. currency and timezone had the same shape country did ────────────────
--
--   currency  text NULL DEFAULT 'AED'
--   timezone  text NULL DEFAULT 'Asia/Dubai'
--
-- timezone is the dangerous one. Migration 27 derives an attendance row's date from
-- company.timezone, so a Kenyan company that never set one has every clock-in near
-- midnight filed under the wrong day — Dubai's day. Nobody would report that as a bug;
-- they would report that attendance "looks a bit off sometimes".
--
-- Both now come from the country pack when the caller does not supply them, and neither
-- may be null. The country is already known and validated by the time this runs.
--
-- ── 2. seed_default_document_types handed the UAE list to everyone ─────────
--
-- Its own comments said so: "(UAE mandatory for SMEs)", "(UAE mandatory)". A company in
-- Nairobi got Emirates ID, MOHRE Establishment Card, ILOE Insurance and Tenancy Contract
-- (Ejari) as required document slots, and permanent red compliance warnings for never
-- filling them in.
--
-- Split into a universal set plus UAE extras. The universal set uses generic codes with
-- the label taken from country_rules.identity_label / permit_label — which is the design
-- already stated in migration 31 ("The columns are national_id and labour_card_number
-- everywhere; only the label changes") and which nothing had read until now. So an AE
-- company sees "Emirates ID" and a Kenyan one sees "National ID", on the same code.
--
-- is_required is tied to `verified`. We only know which documents a country's law demands
-- where somebody has checked the labour code, so an unverified country gets exactly one
-- required document — the employment contract, which every employer everywhere has — and
-- the rest as optional slots HR can promote. Marking a UK company's national ID required
-- would be the same guess as inventing its leave entitlement, and the UK has no national
-- ID card at all.
--
-- Existing companies are untouched: both hold the original 20 types and one uploaded
-- document hangs off them. This changes what a NEW company is given.
--
-- ── 3. generate_wps_sif never asked which country it was building for ──────
--
-- It is reachable by any hr_manager or super_admin on any company. Called by a Kenyan
-- workspace it demands a MOL establishment ID, a labour card number and an agent bank
-- routing code — three UAE documents that do not exist in Kenya — and reports their
-- absence as validation errors, as though the customer had forgotten to fill something
-- in. Fill them in anyway and it emits a UAE WPS SIF structure that no Kenyan bank
-- accepts.
--
-- country_rules.payment_file was added in migration 31 to decide exactly this and has
-- been read by nothing since. Now it gates the function.

-- ── 1. Currency and timezone follow the country ────────────────────────────
CREATE OR REPLACE FUNCTION public.company_country_is_a_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_code text;
  v_rule record;
BEGIN
  IF NEW.country IS NULL OR btrim(NEW.country) = '' THEN
    RAISE EXCEPTION 'A company needs a country — it decides leave entitlement, currency and working week.'
      USING ERRCODE = 'P0001';
  END IF;

  v_code := public.resolve_country_code(NEW.country);

  IF v_code IS NULL THEN
    RAISE EXCEPTION 'BYOND has no country on file matching %. Add it under Platform > Countries first.', NEW.country
      USING ERRCODE = 'P0001';
  END IF;

  NEW.country := v_code;

  -- Only when the caller did not choose. A company that has set its own currency in
  -- Settings keeps it — the pack is a starting point, not a correction.
  IF NEW.currency IS NULL OR NEW.timezone IS NULL THEN
    SELECT currency, default_timezone INTO v_rule FROM country_rules WHERE code = v_code;
    NEW.currency := coalesce(NEW.currency, v_rule.currency);
    NEW.timezone := coalesce(NEW.timezone, v_rule.default_timezone);
  END IF;

  RETURN NEW;
END;
$function$;

-- The trigger fires on UPDATE OF country only, so an UPDATE that nulls the currency
-- without touching the country would not be caught by it. NOT NULL is what actually
-- holds the line; the trigger is only there to save callers from having to know.
DROP TRIGGER IF EXISTS a0_company_country_code ON public.company;
CREATE TRIGGER a0_company_country_code
  BEFORE INSERT OR UPDATE OF country, currency, timezone ON public.company
  FOR EACH ROW EXECUTE FUNCTION public.company_country_is_a_code();

-- Backfill anything null before the constraint, from the country rather than from Dubai.
UPDATE public.company c
   SET currency = coalesce(c.currency, cr.currency),
       timezone = coalesce(c.timezone, cr.default_timezone)
  FROM public.country_rules cr
 WHERE cr.code = c.country
   AND (c.currency IS NULL OR c.timezone IS NULL);

ALTER TABLE public.company ALTER COLUMN currency DROP DEFAULT;
ALTER TABLE public.company ALTER COLUMN timezone DROP DEFAULT;
ALTER TABLE public.company ALTER COLUMN currency SET NOT NULL;
ALTER TABLE public.company ALTER COLUMN timezone SET NOT NULL;

-- ── 2. Document types follow the country ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.seed_default_document_types(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_code     text;
  v_identity text;
  v_permit   text;
  v_verified boolean;
BEGIN
  SELECT c.country, cr.identity_label, cr.permit_label, cr.verified
    INTO v_code, v_identity, v_permit, v_verified
    FROM company c
    JOIN country_rules cr ON cr.code = c.country
   WHERE c.id = p_company_id;

  IF v_code IS NULL THEN
    RETURN;   -- no country, no defaults. company_country_is_a_code makes this unreachable.
  END IF;

  -- Universal. Every employer anywhere has these, or has the option of them.
  INSERT INTO document_types
    (company_id, code, label, scope, category, is_required, has_expiry, default_alert_days, sort_order)
  SELECT p_company_id, d.code,
         CASE d.code
           WHEN 'national_id'  THEN coalesce(v_identity, 'National ID')
           WHEN 'work_permit'  THEN coalesce(v_permit,   'Work permit')
           ELSE d.label
         END,
         d.scope, d.category,
         -- Required only where a human has verified the country's labour code, except the
         -- employment contract, which needs no jurisdiction to justify it.
         (d.req_if_verified AND coalesce(v_verified, false)) OR d.always_required,
         d.has_expiry, d.alert_days, d.sort_order
    FROM (VALUES
      ('business_registration', 'Business Registration',        'company',  'legal',     true,  false, true,  60,  1),
      ('tax_registration',      'Tax Registration Certificate', 'company',  'legal',     false, false, false, 30,  2),
      ('passport',              'Passport',                     'employee', 'identity',  true,  false, true,  90, 10),
      ('national_id',           'National ID',                  'employee', 'identity',  true,  false, true,  30, 11),
      ('work_permit',           'Work permit',                  'employee', 'labour',    true,  false, true,  60, 13),
      ('health_insurance',      'Health Insurance',             'employee', 'insurance', true,  false, true,  30, 14),
      ('employment_contract',   'Employment Contract',          'employee', 'contract',  false, true,  false, 30, 16),
      ('driving_licence',       'Driving Licence',              'employee', 'identity',  false, false, true,  60, 18),
      ('educational_cert',      'Educational Certificate',      'employee', 'education', false, false, false, 30, 19),
      ('offer_letter',          'Offer Letter',                 'employee', 'contract',  false, false, false, 30, 20),
      ('nda',                   'NDA / Confidentiality',        'employee', 'legal',     false, false, false, 30, 21),
      ('resignation',           'Resignation Letter',           'employee', 'legal',     false, false, false, 30, 22),
      ('warning_letter',        'Warning Letter',               'employee', 'legal',     false, false, false, 30, 23)
    ) AS d(code, label, scope, category, req_if_verified, always_required, has_expiry, alert_days, sort_order)
  ON CONFLICT (company_id, code) DO NOTHING;

  -- UAE extras. Only for AE, and only because AE is the one labour code this product has
  -- actually been built against. When a second country is verified, the right move is a
  -- country_document_types table alongside country_leave_rules — building it now would be
  -- a reference table with one country in it and a guess in the others.
  IF v_code = 'AE' THEN
    INSERT INTO document_types
      (company_id, code, label, scope, category, is_required, has_expiry, default_alert_days, sort_order)
    VALUES
      (p_company_id, 'trade_licence',      'Trade Licence',              'company',  'legal',     true,  true,  60,  3),
      (p_company_id, 'vat_certificate',    'VAT Registration Certificate','company', 'legal',     true,  false, 30,  4),
      (p_company_id, 'moi_establishment',  'MOHRE Establishment Card',   'company',  'labour',    true,  true,  60,  5),
      (p_company_id, 'tenancy_contract',   'Tenancy Contract (Ejari)',   'company',  'legal',     true,  true,  60,  6),
      (p_company_id, 'wps_agreement',      'WPS Agreement',              'company',  'labour',    true,  false, 30,  7),
      (p_company_id, 'chamber_membership', 'Chamber of Commerce',        'company',  'legal',     false, true,  60,  8),
      (p_company_id, 'residence_visa',     'Residence Visa',             'employee', 'visa',      true,  true,  60, 12),
      (p_company_id, 'iloe_insurance',     'ILOE Insurance',             'employee', 'insurance', true,  true,  30, 15),
      (p_company_id, 'ohc',                'Occupational Health Card',   'employee', 'health',    false, true,  30, 17)
    ON CONFLICT (company_id, code) DO NOTHING;
  END IF;
END;
$function$;

-- ── 3. The salary transfer file asks which country first ───────────────────
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
  -- Authorization: super_admin or hr_manager only
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

  -- Before anything else: is a WPS SIF even the right artefact for this company? Asking
  -- afterwards produces the worst possible output — a list of missing UAE documents
  -- presented to someone in a country that does not issue them.
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

  IF v_company.mol_establishment_id IS NULL THEN
    v_errors := v_errors || 'Company: MOL establishment ID missing';
  END IF;
  IF v_company.employer_bank_routing_code IS NULL THEN
    v_errors := v_errors || 'Company: employer bank routing code missing';
  END IF;

  -- Drafts are never included in a compliance file
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

  -- Audit trail (function must be VOLATILE for this write)
  INSERT INTO audit_logs (user_id, action, table_name, new_data, company_id)
  VALUES (
    v_uid,
    'wps_sif_generated',
    'payroll_runs',
    jsonb_build_object(
      'period_year', p_year,
      'period_month', p_month,
      'record_count', v_count,
      'valid', cardinality(v_errors) = 0
    ),
    v_company_id
  );

  IF cardinality(v_errors) > 0 THEN
    RETURN jsonb_build_object(
      'valid', false,
      'errors', to_jsonb(v_errors),
      'draft_runs_excluded', v_draft_count
    );
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
      -- company.currency is NOT NULL as of this migration and comes from the country
      -- pack, so the old COALESCE(..., 'AED') is gone. It would only ever have fired for
      -- a company whose currency was unset, and answering "AED" for that company was the
      -- bug, not the safety net.
      'currency', v_company.currency,
      'reference', 'BYOND-' || p_year::text || lpad(p_month::text, 2, '0')
    )
  );
END;
$function$;
