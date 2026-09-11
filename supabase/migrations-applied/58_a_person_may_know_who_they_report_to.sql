-- The redesigned /profile shows "Operations — Khalid Nasser's team" under the department.
-- An employee cannot read that today, and the reason is a policy working correctly.
--
-- emp_select lets role 'employee' read exactly one row: their own. That is right — an
-- ordinary employee has no business reading the company's staff list. But it also means
-- the one name they have the clearest claim to, the person who approves their leave and
-- writes their review, is unreadable to them. The manager can see the employee; the
-- employee cannot see the manager.
--
-- So: a narrow SECURITY DEFINER reader that answers one question about the caller and
-- returns two columns of it. The same shape as my_workspace() from migration 25, and for
-- the same reason — a question a person may ask about themselves, which the row policy
-- cannot express because the answer lives in somebody else's row.
--
-- ── Which manager ──────────────────────────────────────────────────────────
--
-- Not employee_managers(). That function answers "who is responsible for this person" and
-- correctly returns EVERY department_manager sharing their department, because for
-- permissions any of them may act. "Whose team am I on" is a different question with one
-- answer, so this uses the narrower rule:
--
--   the manager HR named for me, if they named one   (employees.reports_to)
--   otherwise the head of my department               (departments.manager_id)
--
-- A colleague who merely holds the department_manager role is not my manager, and a line
-- on my own profile saying they are would be wrong in a way the employee would notice
-- first. Where neither is set the function returns nothing and the line is omitted —
-- which is the case for every employee on production today, since reports_to and
-- departments.manager_id are both unset company-wide.

CREATE OR REPLACE FUNCTION public.my_manager()
RETURNS TABLE (manager_name text, manager_job_title text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT mgr.full_name, mgr.job_title
    FROM employees me
    JOIN employees mgr
      ON mgr.id = COALESCE(
           me.reports_to,
           (SELECT d.manager_id FROM departments d WHERE d.id = me.department_id))
   WHERE me.user_id = (SELECT auth.uid())
     AND me.status <> 'terminated'
     AND mgr.company_id = me.company_id
     AND mgr.id IS DISTINCT FROM me.id
   LIMIT 1;
$function$;

COMMENT ON FUNCTION public.my_manager() IS
  'The caller''s own manager, by name and job title: the one HR named for them, else the head of their department. Returns no row when neither is set, or when the caller has no employee record. Reads nothing else about that person - not their email, not their pay, not their record.';

REVOKE EXECUTE ON FUNCTION public.my_manager() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.my_manager() TO authenticated;

-- Two columns, deliberately. A SECURITY DEFINER function is a hole punched through RLS and
-- the only thing that keeps it safe is how little it returns: a name and a job title, about
-- one person, chosen by a rule the caller cannot influence. No id is returned, so it cannot
-- be used to walk to another record; no email, so it cannot be used to harvest contacts.
-- Anything added here later should have to justify itself against that sentence.
