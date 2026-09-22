-- Finding 1 of the September security review (docs/security-review-2026-09.md), and the move
-- migration 52 said would one day be "three lines". It is more than three, because
-- national_id and labour_card_number are read by the GDPR export and erasure functions and
-- written by employee creation, and all of that has to keep working. So this is the EXPAND
-- half of an expand/contract: it creates the new home and copies the data, changing nothing
-- that already reads the old columns. The CONTRACT half (migration 62) drops the old
-- columns, and only runs once the app that reads the new table is deployed.
--
-- ── The hole ───────────────────────────────────────────────────────────────
--
-- RLS decides rows, never columns. national_id (Emirates ID) and labour_card_number sat on
-- employees, whose emp_select policy hands the whole row to read_only, admin and a
-- department_manager's team. The app masks them in JavaScript, but the REST API underneath
-- returns them raw: a read_only auditor could GET /rest/v1/employees?select=national_id for
-- the whole company. Exactly the shape of the salary leak migration 52 fixed, for identity
-- documents instead of pay.
--
-- ── Who may read the new table ─────────────────────────────────────────────
--
-- super_admin, hr_manager, admin, and the person themselves. admin (operations) is included
-- deliberately: it administers visas, work permits and identity documents as its job — the
-- same reasoning migration 52 used to leave these columns with operations in the first
-- place — and the completeness dashboards read labour_card_number as an admin/HR task. What
-- this REMOVES is read_only and department_manager, which is the reported exposure.
--
-- Applied to production 2026-09-22; the copy was verified lossless (9 source rows, 9 copied,
-- 0 value mismatches on either column).

CREATE TABLE IF NOT EXISTS public.employee_identifiers (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id uuid NOT NULL UNIQUE REFERENCES public.employees(id) ON DELETE CASCADE,
  company_id  uuid NOT NULL REFERENCES public.company(id) ON DELETE CASCADE,
  national_id        text,
  labour_card_number text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employee_identifiers_company_id
  ON public.employee_identifiers (company_id);

CREATE TRIGGER employee_identifiers_updated_at BEFORE UPDATE ON public.employee_identifiers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER audit_employee_identifiers
  AFTER INSERT OR UPDATE OR DELETE ON public.employee_identifiers
  FOR EACH ROW EXECUTE FUNCTION public.log_sensitive_changes();

INSERT INTO public.employee_identifiers (employee_id, company_id, national_id, labour_card_number)
SELECT e.id, e.company_id, e.national_id, e.labour_card_number
  FROM public.employees e
 WHERE e.national_id IS NOT NULL OR e.labour_card_number IS NOT NULL
ON CONFLICT (employee_id) DO NOTHING;

ALTER TABLE public.employee_identifiers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.employee_identifiers FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_identifiers TO authenticated;

CREATE POLICY employee_identifiers_select ON public.employee_identifiers
  FOR SELECT TO authenticated
  USING (
    company_id = get_user_company_id((SELECT auth.uid()))
    AND (
      get_user_role((SELECT auth.uid())) IN ('super_admin', 'hr_manager', 'admin')
      OR employee_id = get_user_employee_id((SELECT auth.uid()))
    )
  );

CREATE POLICY employee_identifiers_write ON public.employee_identifiers
  FOR ALL TO authenticated
  USING (company_id = get_user_company_id((SELECT auth.uid()))
         AND get_user_role((SELECT auth.uid())) IN ('super_admin', 'hr_manager', 'admin'))
  WITH CHECK (company_id = get_user_company_id((SELECT auth.uid()))
              AND get_user_role((SELECT auth.uid())) IN ('super_admin', 'hr_manager', 'admin'));

CREATE OR REPLACE FUNCTION public.employee_identifiers_row_fits_country()
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

CREATE TRIGGER ab_employee_identifiers_fits_country
  BEFORE INSERT OR UPDATE ON public.employee_identifiers
  FOR EACH ROW EXECUTE FUNCTION public.employee_identifiers_row_fits_country();
