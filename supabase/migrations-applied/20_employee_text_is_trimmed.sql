-- Padding whitespace in an employee's name made them impossible to erase.
--
-- The anonymize dialog asks you to type the employee's name to confirm, then
-- compared your trimmed input against the stored name untrimmed. For a row saved
-- as 'Eiad Said ' that comparison can never succeed: typing "Eiad Said" gives
-- "Eiad Said", and you cannot supply the trailing space either because the input
-- is trimmed first. The confirm button stays disabled forever.
--
-- That is the Right to Erasure path. A name pasted with a stray space therefore
-- meant a person could not be erased on request — a compliance failure that looks
-- like a stuck button.
--
-- Measured on Frankfurt before this migration:
--
--                   padded names   padded job titles
--   BYOND                      1                   1
--   BYOND Test Co              1                   2
--
-- Note the first row: this was not confined to the test tenant. One real employee
-- in the live company was un-erasable too.
--
-- The client is fixed separately (both sides trimmed, and the direct-creation form
-- now trims on save). This is the same fix one layer down, because the client is
-- not the only writer — the mobile app and the REST API reach these columns too,
-- and create_employee_invite has always btrimmed while EmployeeNew never did. A
-- trigger is the only place that covers all of them.

-- 1. Normalise what is already stored.
UPDATE employees SET
  full_name       = btrim(full_name),
  job_title       = nullif(btrim(coalesce(job_title,'')), ''),
  job_description = nullif(btrim(coalesce(job_description,'')), ''),
  email           = nullif(btrim(coalesce(email,'')), ''),
  phone           = nullif(btrim(coalesce(phone,'')), '')
WHERE full_name       <> btrim(full_name)
   OR job_title       <> btrim(job_title)
   OR job_description <> btrim(job_description)
   OR email           <> btrim(email)
   OR phone           <> btrim(phone);

-- 2. Stop it recurring, whatever writes the row.
--
-- Trim only. Deliberately NOT lowercasing email even though
-- create_employee_invite does, because silently changing the case of something
-- already stored is a different and more surprising change than removing padding
-- — that belongs in its own migration if it is wanted.
--
-- Empty strings collapse to NULL for the optional columns: '' and NULL both mean
-- "not provided", and two representations of the same absence is what makes
-- "job_title IS NULL" checks disagree with what the UI shows. full_name is NOT
-- NULL, so it is only trimmed.
CREATE OR REPLACE FUNCTION public.trim_employee_text()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.full_name       := btrim(NEW.full_name);
  NEW.job_title       := nullif(btrim(coalesce(NEW.job_title,'')), '');
  NEW.job_description := nullif(btrim(coalesce(NEW.job_description,'')), '');
  NEW.email           := nullif(btrim(coalesce(NEW.email,'')), '');
  NEW.phone           := nullif(btrim(coalesce(NEW.phone,'')), '');
  RETURN NEW;
END;
$function$;

-- Named to sort before the guards and audit triggers (aa_ prefix), so the values
-- they inspect and the values written to audit_logs are the trimmed ones. An audit
-- trail recording 'Eiad Said ' while the table holds 'Eiad Said' is a diff that
-- looks like a change nobody made.
DROP TRIGGER IF EXISTS aa_trim_employee_text ON public.employees;
CREATE TRIGGER aa_trim_employee_text
  BEFORE INSERT OR UPDATE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.trim_employee_text();

-- Verification. All three must be 0.
SELECT 'employees with padded full_name (must be 0)' AS check,
       count(*)::text AS value FROM employees WHERE full_name <> btrim(full_name)
UNION ALL
SELECT 'employees with padded job_title (must be 0)',
       count(*)::text FROM employees WHERE job_title <> btrim(job_title)
UNION ALL
SELECT 'employees with empty-string job_title (must be 0)',
       count(*)::text FROM employees WHERE job_title = '';
