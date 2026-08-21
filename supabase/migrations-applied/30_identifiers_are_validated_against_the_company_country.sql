-- Internationalisation, part 1: the schema physically refused non-UAE people.
--
--   employees_iban_format  CHECK (iban ~ '^AE[0-9]{21}$')
--
-- An IBAN is an international standard whose first two characters are the country.
-- Pinning them to 'AE' means a Saudi, Egyptian, Jordanian or British employee cannot be
-- stored — not "displays oddly", cannot be stored. Four sibling constraints did the same
-- for the labour card (14 digits), the two bank routing codes (9 digits) and the labour
-- ministry establishment id (13 digits). All five are real UAE formats; none of them is
-- a fact about employment.
--
-- The instruction was to remove the UAE assumptions and keep the regulations, and those
-- are not in conflict: a UAE company should still be held to UAE formats, because a
-- malformed IBAN there means a failed salary transfer. So the rules move from the table
-- to the company's country. A CHECK constraint cannot read another table, so this is a
-- trigger.
--
-- Everywhere else the generic ISO 13616 shape applies: two letters, two check digits,
-- up to thirty alphanumerics. That still catches a typo or a phone number pasted into
-- the wrong box; it just stops pretending every country is this one.
--
-- Verified after applying:
--   Saudi company + employee with IBAN SA03… and work permit 'WP-2026-88123' — stored.
--   The same Saudi IBAN on a UAE company's employee — refused, naming the expected shape.

CREATE OR REPLACE FUNCTION public.is_uae_country(p_country text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT lower(coalesce(p_country, '')) IN ('uae', 'ae', 'united arab emirates', 'u.a.e.', 'u.a.e');
$function$;

CREATE OR REPLACE FUNCTION public.employee_identifiers_fit_the_country()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_country text;
  v_uae     boolean;
BEGIN
  SELECT c.country INTO v_country FROM company c WHERE c.id = NEW.company_id;
  v_uae := public.is_uae_country(v_country);

  IF NEW.iban IS NOT NULL THEN
    IF v_uae THEN
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
  IF v_uae THEN
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

ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_iban_format;
ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_labour_card_format;
ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_agent_routing_format;

DROP TRIGGER IF EXISTS ab_employee_identifiers ON public.employees;
CREATE TRIGGER ab_employee_identifiers
  BEFORE INSERT OR UPDATE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.employee_identifiers_fit_the_country();

-- Same treatment for the two company-level identifiers. Both are UAE labour-ministry
-- and banking artefacts; neither exists in Nigeria, Saudi or anywhere else in that form.
CREATE OR REPLACE FUNCTION public.company_identifiers_fit_the_country()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF public.is_uae_country(NEW.country) THEN
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

ALTER TABLE public.company DROP CONSTRAINT IF EXISTS company_mol_establishment_id_format;
ALTER TABLE public.company DROP CONSTRAINT IF EXISTS company_employer_bank_routing_format;

DROP TRIGGER IF EXISTS ab_company_identifiers ON public.company;
CREATE TRIGGER ab_company_identifiers
  BEFORE INSERT OR UPDATE ON public.company
  FOR EACH ROW EXECUTE FUNCTION public.company_identifiers_fit_the_country();
