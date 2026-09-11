-- company.country becomes an ISO 3166-1 alpha-2 code with a foreign key, instead of
-- free text with a default of 'UAE'.
--
-- ── What was actually wrong ─────────────────────────────────────────────────
--
-- Measured on production before this ran:
--
--   country text DEFAULT 'UAE'::text, nullable, and NO constraint of any kind.
--   Both real companies held the literal string 'UAE'.
--
-- Three consequences, in ascending order of how quietly they fail:
--
-- 1. A company created without naming a country silently became UAE, and then
--    inherited UAE labour law. A wrong answer delivered with total confidence.
--
-- 2. Migration 31's seeder matched country to a pack with
--      upper(c.country) = cr.code OR lower(c.country) = lower(cr.name)
--        OR (is_uae_country(c.country) AND cr.code = 'AE')
--    Note that for the data we actually have, the first two are both FALSE —
--    upper('UAE') is not 'AE', and lower('UAE') is not 'united arab emirates'.
--    The ONLY reason leave policies ever got seeded is the third clause. The
--    matcher looked general and was in fact a UAE special case with two dead
--    branches in front of it.
--
-- 3. 'UAE', 'uae', 'U.A.E.' and a trailing space are four different countries
--    to a text column, and each one silently skips the Emirates ID and IBAN
--    format checks in migration 30, since those gate on is_uae_country().
--
-- ── The fix ────────────────────────────────────────────────────────────────
--
-- One representation, validated at the only door into the table. After this,
-- company.country is always exactly two uppercase letters that exist in
-- country_rules — enforced by a foreign key, not by hoping callers behave.
--
-- What this migration deliberately does NOT do, so the gap is on the record
-- rather than forgotten: onboard_company, self_onboard_company and
-- platform_create_company still declare p_country DEFAULT 'UAE'. Both real
-- callers (Signup.jsx and Platform.jsx) always pass a country explicitly, so
-- the default is unreachable from the app; rewriting three large function
-- bodies to close a door nothing walks through was not worth the risk in the
-- same change as the column conversion. The resolver below normalises whatever
-- they pass, so 'UAE' still lands as 'AE'.

-- ── 1. Aliases, so the resolver has something to work with ─────────────────
-- Real input is 'UAE', 'U.A.E.', 'KSA', 'UK'. Countries have common names that
-- are neither their ISO code nor their formal name, and pretending otherwise is
-- what produced the dead branches above.
ALTER TABLE public.country_rules
  ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.country_rules.aliases IS
  'Lowercase alternative spellings accepted by resolve_country_code(). Not display text.';

UPDATE public.country_rules
   SET aliases = ARRAY['uae', 'u.a.e.', 'u.a.e', 'emirates', 'united arab emirates']
 WHERE code = 'AE';

-- ── 2. The countries the signup form already offers ────────────────────────
-- src/utils/onboarding.js has offered 13 countries since the UAE-only defaults
-- were removed. Twelve of them had no row here, so a foreign key would have
-- refused every company outside the UAE.
--
-- Every one of these lands with verified = false, which under migration 31's
-- rule means it seeds NO leave policy. That is the point: currency, timezone
-- and weekend are operational defaults a company can change in Settings, and
-- carry no legal claim. Leave entitlement is a legal claim, so it stays absent
-- until a human verifies the labour code and records the citation.
--
-- weekend_days here is a starting default, not an assertion about law. Nothing
-- consumes it for leave arithmetic today — only the operator console displays
-- it — and whoever verifies a country confirms it then. Without this, all
-- twelve would have inherited the table default of Friday+Saturday, which is
-- wrong for the United Kingdom in a way nobody would notice until payroll.
--
-- identity_label and permit_label are left at their generic defaults on
-- purpose. 'National ID' is true everywhere; guessing the local name of a
-- document is exactly the kind of confident detail this product is removing.
INSERT INTO public.country_rules
  (code, name, currency, default_timezone, weekend_days, payment_file, verified, aliases)
VALUES
  ('SA', 'Saudi Arabia',   'SAR', 'Asia/Riyadh',    '{5,6}', 'none', false, ARRAY['ksa','saudi','saudi arabia','kingdom of saudi arabia']),
  ('QA', 'Qatar',          'QAR', 'Asia/Qatar',     '{5,6}', 'none', false, ARRAY['qatar']),
  ('KW', 'Kuwait',         'KWD', 'Asia/Kuwait',    '{5,6}', 'none', false, ARRAY['kuwait']),
  ('BH', 'Bahrain',        'BHD', 'Asia/Bahrain',   '{5,6}', 'none', false, ARRAY['bahrain']),
  ('OM', 'Oman',           'OMR', 'Asia/Muscat',    '{5,6}', 'none', false, ARRAY['oman','sultanate of oman']),
  ('JO', 'Jordan',         'JOD', 'Asia/Amman',     '{5,6}', 'none', false, ARRAY['jordan']),
  ('EG', 'Egypt',          'EGP', 'Africa/Cairo',   '{5,6}', 'none', false, ARRAY['egypt']),
  ('NG', 'Nigeria',        'NGN', 'Africa/Lagos',   '{6,0}', 'none', false, ARRAY['nigeria']),
  ('KE', 'Kenya',          'KES', 'Africa/Nairobi', '{6,0}', 'none', false, ARRAY['kenya']),
  ('IN', 'India',          'INR', 'Asia/Kolkata',   '{6,0}', 'none', false, ARRAY['india']),
  ('PK', 'Pakistan',       'PKR', 'Asia/Karachi',   '{6,0}', 'none', false, ARRAY['pakistan']),
  ('GB', 'United Kingdom', 'GBP', 'Europe/London',  '{6,0}', 'none', false, ARRAY['uk','gb','britain','great britain','england','united kingdom'])
ON CONFLICT (code) DO NOTHING;

-- ── 3. The resolver ────────────────────────────────────────────────────────
-- One place that turns anything a human or an old row might hold into a code,
-- and returns NULL rather than a guess when it cannot. NULL is the useful
-- answer here: the caller raises, and nobody gets quietly filed under AE.
CREATE OR REPLACE FUNCTION public.resolve_country_code(p_input text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT cr.code
    FROM country_rules cr
   WHERE upper(btrim(coalesce(p_input, ''))) = cr.code
      OR lower(btrim(coalesce(p_input, ''))) = lower(cr.name)
      OR lower(btrim(coalesce(p_input, ''))) = ANY (SELECT lower(x) FROM unnest(cr.aliases) AS x)
   -- An exact code match wins, so a country whose alias collides with another
   -- country's code can never shadow it.
   ORDER BY (upper(btrim(coalesce(p_input, ''))) = cr.code) DESC
   LIMIT 1;
$function$;

REVOKE EXECUTE ON FUNCTION public.resolve_country_code(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.resolve_country_code(text) TO authenticated;

-- ── 4. Backfill, and refuse to continue if anything cannot be resolved ─────
-- Two rows today, both 'UAE'. The guard matters anyway: this migration must not
-- be the thing that invents a country for a row it did not understand.
UPDATE public.company
   SET country = public.resolve_country_code(country)
 WHERE public.resolve_country_code(country) IS NOT NULL
   AND country IS DISTINCT FROM public.resolve_country_code(country);

DO $$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(format('%s => %L', id, country), ', ')
    INTO v_bad
    FROM public.company
   WHERE country IS NULL OR country !~ '^[A-Z]{2}$';

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to add the constraint: these companies hold a country this migration could not resolve to an ISO code: %. Add the country to country_rules (or an alias for it) and re-run.', v_bad;
  END IF;
END $$;

-- ── 5. Make the column incapable of holding anything else ──────────────────
-- The default goes first and does not come back. A company with no stated
-- country is a question for a human, not a silent UAE.
ALTER TABLE public.company ALTER COLUMN country DROP DEFAULT;
ALTER TABLE public.company ALTER COLUMN country SET NOT NULL;

ALTER TABLE public.company
  DROP CONSTRAINT IF EXISTS company_country_is_iso_code;
ALTER TABLE public.company
  ADD CONSTRAINT company_country_is_iso_code CHECK (country ~ '^[A-Z]{2}$');

-- RESTRICT, not CASCADE: deleting a country out from under a live workspace
-- should fail loudly in the operator console, not orphan a tenant.
ALTER TABLE public.company
  DROP CONSTRAINT IF EXISTS company_country_fk;
ALTER TABLE public.company
  ADD CONSTRAINT company_country_fk
  FOREIGN KEY (country) REFERENCES public.country_rules(code) ON DELETE RESTRICT;

COMMENT ON COLUMN public.company.country IS
  'ISO 3166-1 alpha-2, FK to country_rules.code. Display the name from country_rules, never this.';

-- ── 6. Normalise at the door ───────────────────────────────────────────────
-- The foreign key would reject 'UAE' outright. That is correct but unkind: the
-- three onboarding RPCs still pass labels, and so will any operator typing into
-- SQL. Resolve first, then let the FK guard what is left.
CREATE OR REPLACE FUNCTION public.company_country_is_a_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_code text;
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
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS a0_company_country_code ON public.company;
-- Named to sort ahead of ab_company_identifiers (migration 30). BEFORE triggers
-- fire in name order, and that one now compares country to 'AE', so it has to
-- see the normalised value. 'a0' < 'ab' in every collation that matters here
-- because both are ASCII, and a digit sorts below a letter.
CREATE TRIGGER a0_company_country_code
  BEFORE INSERT OR UPDATE OF country ON public.company
  FOR EACH ROW EXECUTE FUNCTION public.company_country_is_a_code();

-- ── 7. The seeder stops pretending to be general ───────────────────────────
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
  -- company.country IS the code now, so this is a lookup rather than three
  -- guesses in a trench coat.
  SELECT c.country INTO v_code FROM company c WHERE c.id = p_company_id;

  IF v_code IS NULL OR NOT EXISTS (
    SELECT 1 FROM country_rules WHERE code = v_code AND verified
  ) THEN
    -- Unverified country: seed nothing, so the app can say "we have no leave
    -- rules on file for this country yet" — true, and better than a number
    -- nobody can source in a labour dispute.
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

-- ── 8. The identifier checks compare a code, not a spelling ────────────────
-- Same rules as migration 30. The only change is what decides "is this the UAE",
-- which is now a two-letter equality instead of a five-way string match.
CREATE OR REPLACE FUNCTION public.company_identifiers_fit_the_country()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.country = 'AE' THEN
    IF NEW.mol_establishment_id IS NOT NULL AND NEW.mol_establishment_id !~ '^[0-9]{13}$' THEN
      RAISE EXCEPTION 'A UAE MOHRE establishment ID is 13 digits.' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.employer_bank_routing_code IS NOT NULL AND NEW.employer_bank_routing_code !~ '^[0-9]{9}$' THEN
      RAISE EXCEPTION 'A UAE routing code is 9 digits.' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    IF NEW.mol_establishment_id IS NOT NULL AND length(NEW.mol_establishment_id) > 40 THEN
      RAISE EXCEPTION 'Employer registration number is too long (max 40 characters).' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.employer_bank_routing_code IS NOT NULL AND length(NEW.employer_bank_routing_code) > 20 THEN
      RAISE EXCEPTION 'Bank routing code is too long (max 20 characters).' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

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

  -- The work permit and the bank routing code have no international standard at all, so
  -- outside the UAE they are recorded as the country issues them. Bounded, not shaped.
  IF v_code = 'AE' THEN
    IF NEW.labour_card_number IS NOT NULL AND NEW.labour_card_number !~ '^[0-9]{14}$' THEN
      RAISE EXCEPTION 'A UAE labour card number is 14 digits.' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.agent_bank_routing_code IS NOT NULL AND NEW.agent_bank_routing_code !~ '^[0-9]{9}$' THEN
      RAISE EXCEPTION 'A UAE routing code is 9 digits.' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    IF NEW.labour_card_number IS NOT NULL AND length(NEW.labour_card_number) > 40 THEN
      RAISE EXCEPTION 'Work permit number is too long (max 40 characters).' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.agent_bank_routing_code IS NOT NULL AND length(NEW.agent_bank_routing_code) > 20 THEN
      RAISE EXCEPTION 'Bank routing code is too long (max 20 characters).' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ── 9. Retire the fuzzy matcher ────────────────────────────────────────────
-- Its three remaining callers are all rewritten above. Leaving it in place is
-- an invitation to compare free text to a country again, which is the bug this
-- migration exists to remove.
DROP FUNCTION IF EXISTS public.is_uae_country(text);
