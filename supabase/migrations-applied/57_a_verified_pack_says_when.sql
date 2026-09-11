-- Thirteen country packs, one person maintaining them, and no way to tell a pack that was
-- checked last month from one that was checked before the law changed.
--
-- The verification idea is already here and already honest: country_rules.verified defaults
-- to false, an unverified pack seeds nothing, LeavePolicySettingsTab tells the company so
-- in plain words, and PlatformCountries says outright that a country should be marked
-- verified "when someone has read the statute, not when the row looks full". That is a
-- better starting point than most products have.
--
-- What it cannot express is time. verified is a boolean. AE is true, with a note naming
-- Federal Decree-Law 33/2021, and nothing anywhere records when anybody last read it. The
-- UAE amended that law in 2022 and added unemployment insurance after; Saudi amended its
-- labour law in 2024. A boolean cannot go stale, so a pack verified once stays "verified"
-- for as long as the row exists, and the first sign that it drifted is a customer with a
-- wrong gratuity calculation — which arrives as a complaint, not as a warning.
--
-- ── What this adds ─────────────────────────────────────────────────────────
--
--   verified_on  date  — when a person last read the statute
--   source_url   text  — the statute they read, so the next person can check the same thing
--
-- and a trigger that makes the date impossible to forget: marking a pack verified stamps
-- today if no date was given, and un-verifying clears it. A nullable column beside a
-- boolean is a column that drifts from it; a column the schema fills in does not.
--
-- ── Not a nag ──────────────────────────────────────────────────────────────
--
-- Nothing here blocks anything, expires a pack, or hides a country. A twelve-month-old
-- verification is not wrong — most labour codes go years without amendment. It is
-- unreviewed, which is a different word, and the only correct response to it is a person
-- deciding whether to look. So this makes the age visible and stops there.

ALTER TABLE public.country_rules
  ADD COLUMN IF NOT EXISTS verified_on date,
  ADD COLUMN IF NOT EXISTS source_url  text;

COMMENT ON COLUMN public.country_rules.verified_on IS
  'The day a person last read the statute this pack claims to follow. Stamped automatically when verified is turned on, cleared when it is turned off.';
COMMENT ON COLUMN public.country_rules.source_url IS
  'Where that statute can be read. Not decoration - it is what makes the next check cheaper than the first.';

-- The one verified pack predates this column. updated_at is the closest honest answer to
-- "when was it last touched", and saying 26 August is better than saying nothing; a wrong
-- date would be worse than both, which is why it is not backdated to the law's own year.
UPDATE public.country_rules
   SET verified_on = updated_at::date
 WHERE verified AND verified_on IS NULL;

ALTER TABLE public.country_rules
  DROP CONSTRAINT IF EXISTS country_rules_verified_has_a_date;
ALTER TABLE public.country_rules
  ADD CONSTRAINT country_rules_verified_has_a_date
  CHECK (NOT verified OR verified_on IS NOT NULL);

ALTER TABLE public.country_rules
  DROP CONSTRAINT IF EXISTS country_rules_source_is_a_url;
ALTER TABLE public.country_rules
  ADD CONSTRAINT country_rules_source_is_a_url
  CHECK (source_url IS NULL OR source_url ~ '^https?://');

-- ── The date fills itself in ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.country_rule_verification_is_dated()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT NEW.verified THEN
    -- An unverified pack has no verification date. Keeping the old one would let a pack
    -- read "unverified, last checked in March", which invites somebody to trust it.
    NEW.verified_on := NULL;
    RETURN NEW;
  END IF;

  -- Turning verification on without saying when means today, because the person doing it
  -- is the person who just read the statute. An explicit date is kept: backdating to the
  -- day the reading actually happened is legitimate, and lying about it gains nothing.
  IF NEW.verified_on IS NULL THEN
    NEW.verified_on := current_date;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS aa_country_rule_verification ON public.country_rules;
CREATE TRIGGER aa_country_rule_verification
  BEFORE INSERT OR UPDATE ON public.country_rules
  FOR EACH ROW EXECUTE FUNCTION public.country_rule_verification_is_dated();

REVOKE ALL ON FUNCTION public.country_rule_verification_is_dated()
  FROM PUBLIC, anon, authenticated;

-- ── What is due a second look ──────────────────────────────────────────────
--
-- security_invoker so the company count is the caller's own view of the world rather than
-- the definer's. On the platform screen that is every company; for anyone else it is
-- theirs, which is the right answer to "who is relying on this pack" from where they sit.
CREATE OR REPLACE VIEW public.country_rules_due_review
WITH (security_invoker = true) AS
SELECT cr.code,
       cr.name,
       cr.verified_on,
       (CURRENT_DATE - cr.verified_on) AS days_since_check,
       cr.source_url,
       (SELECT count(*) FROM company c WHERE c.country = cr.code) AS companies_relying_on_it
  FROM public.country_rules cr
 WHERE cr.verified
   AND cr.verified_on < CURRENT_DATE - INTERVAL '12 months';

COMMENT ON VIEW public.country_rules_due_review IS
  'Verified country packs nobody has re-read in a year, and how many companies are being measured against each. Advisory only - nothing expires and nothing is blocked.';

GRANT SELECT ON public.country_rules_due_review TO authenticated;
