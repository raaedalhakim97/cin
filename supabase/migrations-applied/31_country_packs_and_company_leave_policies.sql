-- Country packs: the shape a workspace inherits from where it operates, and the
-- per-company policy it can then depart from.
--
--   country_rules           one row per country. Reference data, operator-maintained.
--   country_leave_rules     what that country's law entitles people to.
--   company_leave_policies  what THIS company grants. Seeded from the country, then
--                           owned by the company — the law is the floor, not the value.
--
-- Two levels because "the country's rules" and "this company's rules" are different
-- facts, and conflating them is how HR software ends up unable to express "we give 25
-- days, which is more than the law requires".
--
-- ── The rule that governs this whole feature ────────────────────────────────
--
-- Nothing in here may guess. A pack that invents "21 days in Egypt" is the same class of
-- defect as a KPI score invented for someone with no data, except this one is quoted in
-- a labour dispute. So every country row carries `verified`, every leave rule carries
-- `legal_reference`, an unverified country seeds NOTHING, and only the UAE is seeded
-- here — it is the only labour code this system has actually been built against.
--
-- (Migration 33 corrects one row in this file where I broke that rule myself.)

CREATE TABLE IF NOT EXISTS public.country_rules (
  code             text PRIMARY KEY,          -- ISO 3166-1 alpha-2
  name             text NOT NULL,
  currency         text NOT NULL,
  default_timezone text NOT NULL,
  -- 0 = Sunday … 6 = Saturday. The Gulf working week is Mon–Fri in some countries and
  -- Sun–Thu in others; leave arithmetic cannot be right without knowing which.
  weekend_days     smallint[] NOT NULL DEFAULT '{5,6}',
  -- Which salary transfer file this country's banks expect. 'none' is honest: it means
  -- payroll exports a generic CSV rather than pretending to produce a regulated file.
  payment_file     text NOT NULL DEFAULT 'none',
  -- What the identity and work-authorisation fields are CALLED here. The columns are
  -- national_id and labour_card_number everywhere; only the label changes.
  identity_label   text NOT NULL DEFAULT 'National ID',
  permit_label     text NOT NULL DEFAULT 'Work permit',
  verified         boolean NOT NULL DEFAULT false,
  verified_note    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT country_rules_code_format CHECK (code ~ '^[A-Z]{2}$'),
  CONSTRAINT country_rules_payment_file CHECK (payment_file IN ('none', 'uae_wps_sif'))
);

CREATE TABLE IF NOT EXISTS public.country_leave_rules (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  country_code       text NOT NULL REFERENCES public.country_rules(code) ON DELETE CASCADE,
  leave_type         text NOT NULL,
  days_per_year      numeric(5,1),
  -- 'annual'    the full entitlement exists from the eligibility date
  -- 'monthly'   accrues per month of service
  -- 'per_event' granted when the event happens, not held as a balance
  accrual            text NOT NULL DEFAULT 'annual',
  min_service_months integer NOT NULL DEFAULT 0,
  legal_reference    text NOT NULL,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (country_code, leave_type),
  CONSTRAINT country_leave_type CHECK (leave_type IN
    ('annual','sick','emergency','marriage','paternity','maternity','hajj','bereavement','study')),
  CONSTRAINT country_leave_accrual CHECK (accrual IN ('annual','monthly','per_event'))
);

CREATE TABLE IF NOT EXISTS public.company_leave_policies (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id         uuid NOT NULL REFERENCES public.company(id) ON DELETE CASCADE,
  leave_type         text NOT NULL,
  days_per_year      numeric(5,1),
  accrual            text NOT NULL DEFAULT 'annual',
  min_service_months integer NOT NULL DEFAULT 0,
  -- Where this row came from, so HR can see what they inherited and what they changed.
  source             text NOT NULL DEFAULT 'company',
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, leave_type),
  CONSTRAINT company_leave_type CHECK (leave_type IN
    ('annual','sick','emergency','marriage','paternity','maternity','hajj','bereavement','study')),
  CONSTRAINT company_leave_accrual CHECK (accrual IN ('annual','monthly','per_event')),
  CONSTRAINT company_leave_source CHECK (source IN ('country_pack','company')),
  CONSTRAINT company_leave_days_sane CHECK (days_per_year IS NULL OR (days_per_year >= 0 AND days_per_year <= 365))
);

CREATE TRIGGER country_rules_updated_at BEFORE UPDATE ON public.country_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER company_leave_policies_updated_at BEFORE UPDATE ON public.company_leave_policies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ── Access ──────────────────────────────────────────────────────────────────
ALTER TABLE public.country_rules       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.country_leave_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_leave_policies ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.country_rules, public.country_leave_rules, public.company_leave_policies FROM anon;
GRANT SELECT ON public.country_rules, public.country_leave_rules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_leave_policies TO authenticated;

CREATE POLICY country_rules_read ON public.country_rules
  FOR SELECT TO authenticated USING (true);
CREATE POLICY country_rules_write ON public.country_rules
  FOR ALL TO authenticated USING (is_platform_owner((SELECT auth.uid())))
  WITH CHECK (is_platform_owner((SELECT auth.uid())));

CREATE POLICY country_leave_rules_read ON public.country_leave_rules
  FOR SELECT TO authenticated USING (true);
CREATE POLICY country_leave_rules_write ON public.country_leave_rules
  FOR ALL TO authenticated USING (is_platform_owner((SELECT auth.uid())))
  WITH CHECK (is_platform_owner((SELECT auth.uid())));

-- A company's own policy: everyone in the company may read it — an employee is entitled
-- to know how much leave they get — and only HR or the owner may change it.
CREATE POLICY company_leave_policies_read ON public.company_leave_policies
  FOR SELECT TO authenticated
  USING (company_id = get_user_company_id((SELECT auth.uid())));

CREATE POLICY company_leave_policies_write ON public.company_leave_policies
  FOR ALL TO authenticated
  USING (company_id = get_user_company_id((SELECT auth.uid()))
         AND get_user_role((SELECT auth.uid())) IN ('super_admin','hr_manager'))
  WITH CHECK (company_id = get_user_company_id((SELECT auth.uid()))
              AND get_user_role((SELECT auth.uid())) IN ('super_admin','hr_manager'));

-- ── The one pack we can stand behind ────────────────────────────────────────
INSERT INTO public.country_rules
  (code, name, currency, default_timezone, weekend_days, payment_file,
   identity_label, permit_label, verified, verified_note)
VALUES
  ('AE', 'United Arab Emirates', 'AED', 'Asia/Dubai', '{5,6}', 'uae_wps_sif',
   'Emirates ID', 'Labour card', true,
   'Federal Decree-Law 33/2021 and its Executive Regulations. This is the labour code the product was originally built against.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.country_leave_rules
  (country_code, leave_type, days_per_year, accrual, min_service_months, legal_reference, notes)
VALUES
  ('AE', 'annual', 30, 'annual', 12, 'Federal Decree-Law 33/2021, Art. 29',
   'Thirty calendar days a year after one year of service.'),
  ('AE', 'sick', 90, 'annual', 3, 'Federal Decree-Law 33/2021, Art. 31',
   'Ninety days per year after probation, staged 15 full / 30 half / 45 unpaid.'),
  ('AE', 'maternity', 60, 'per_event', 0, 'Federal Decree-Law 33/2021, Art. 30',
   'Sixty days: 45 at full pay, 15 at half pay.'),
  ('AE', 'paternity', 5, 'per_event', 0, 'Federal Decree-Law 33/2021, Art. 32',
   'Five working days, to be taken within six months of the birth.'),
  ('AE', 'bereavement', 5, 'per_event', 0, 'Federal Decree-Law 33/2021, Art. 32',
   'Five days for the death of a spouse; three days for a parent, child, sibling, grandparent or grandchild.'),
  ('AE', 'study', 10, 'annual', 24, 'Federal Decree-Law 33/2021, Art. 32',
   'Ten days a year for employees enrolled at an accredited institution in the UAE, after two years of service.')
ON CONFLICT (country_code, leave_type) DO NOTHING;

-- ── Seeding a company from its country ──────────────────────────────────────
-- Safe to call again: it never overwrites a policy the company has edited, because
-- `source` records who last decided.
CREATE OR REPLACE FUNCTION public.seed_company_leave_policies(p_company_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_code text;
  v_n    integer := 0;
BEGIN
  -- company.country holds a label, not a code, and will until that migration happens.
  -- Match on either, so this works before and after.
  SELECT cr.code INTO v_code
    FROM company c
    JOIN country_rules cr
      ON upper(c.country) = cr.code
      OR lower(c.country) = lower(cr.name)
      OR (public.is_uae_country(c.country) AND cr.code = 'AE')
   WHERE c.id = p_company_id
   LIMIT 1;

  -- Unknown or unverified country: seed nothing. HR sets the policy explicitly, and the
  -- app can say "we have no rules on file for this country yet" — which is true, and
  -- better than a number nobody can source.
  IF v_code IS NULL OR NOT EXISTS (
    SELECT 1 FROM country_rules WHERE code = v_code AND verified
  ) THEN
    RETURN 0;
  END IF;

  INSERT INTO company_leave_policies
    (company_id, leave_type, days_per_year, accrual, min_service_months, source, notes)
  SELECT p_company_id, r.leave_type, r.days_per_year, r.accrual, r.min_service_months,
         'country_pack', r.legal_reference
    FROM country_leave_rules r
   WHERE r.country_code = v_code
  ON CONFLICT (company_id, leave_type) DO NOTHING;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.seed_company_leave_policies(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.seed_company_leave_policies(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.on_company_created_seed_leave()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.seed_company_leave_policies(NEW.id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS company_seed_leave ON public.company;
CREATE TRIGGER company_seed_leave AFTER INSERT ON public.company
  FOR EACH ROW EXECUTE FUNCTION public.on_company_created_seed_leave();

-- Backfill the two companies that already exist.
SELECT public.seed_company_leave_policies(id) FROM public.company;

-- Verified after applying:
--   both existing companies received the 6 UAE rows, source 'country_pack';
--   a Nigerian company created in a rolled-back transaction received 0 rows,
--   because there is no verified pack for Nigeria and nothing was invented.
