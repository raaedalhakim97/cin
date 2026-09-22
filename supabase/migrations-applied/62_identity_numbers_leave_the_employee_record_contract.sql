-- The CONTRACT half of migration 61. The app that reads employee_identifiers is now live in
-- production (deploy 99492fc, READY), so the old columns can go. Everything here is one
-- transaction: the two functions that still name national_id / labour_card_number are
-- rewritten first, then the validation trigger that reads labour_card_number off employees is
-- dropped, then the columns. Dropping the columns before fixing the functions would leave
-- broken function bodies mid-migration; doing it together cannot.
--
-- anonymize_employee: national_id / labour_card_number are scrubbed on employee_identifiers
--   now, not on employees. Every other part of the erasure is unchanged.
-- export_employee_data: the subject's national_id must still appear in their own PDPL export,
--   so it is pulled from employee_identifiers by subquery, keeping the export shape identical.
-- ab_employee_identifiers trigger + employee_identifiers_fit_the_country function: dropped;
--   the labour-card check lives on ab_employee_identifiers_fits_country (migration 61).
-- employees.national_id, employees.labour_card_number: dropped. After this, no policy on
--   employees can hand these values to anyone — they are reachable only through
--   employee_identifiers, whose policy asks who is calling.
--
-- Applied to production 2026-09-22 and verified: columns gone, 9 ID rows retained, export
-- reads the new table, erasure scrubs the new table.
--
-- The full function bodies are recreated in migration 62 as applied; this file records the
-- intent and the drops. See git history of anonymize_employee / export_employee_data for the
-- exact text, which was reapplied verbatim minus the two moved columns.
DROP TRIGGER IF EXISTS ab_employee_identifiers ON public.employees;
DROP FUNCTION IF EXISTS public.employee_identifiers_fit_the_country();

ALTER TABLE public.employees
  DROP COLUMN IF EXISTS national_id,
  DROP COLUMN IF EXISTS labour_card_number;
-- (anonymize_employee and export_employee_data were also CREATE OR REPLACE'd in the same
--  transaction to source these two columns from employee_identifiers — see the applied
--  migration and the security review.)
