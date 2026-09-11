-- Finding 3 from the logic audit: terminating an employee did not end their access.
--
-- Nothing in the schema or the app looked at employees.status when deciding what a signed-in
-- person may do. Access comes from a user_roles row, and terminating somebody does not touch
-- it — so an ex-employee kept their login, their team's data, their own payslip and their
-- notifications until a human remembered to go and delete the role by hand.
--
-- Nobody terminated in production has a login today, so nothing was exposed. The mechanism
-- was simply absent, which is the kind of gap that gets discovered on the day it matters.
--
-- ── Where to enforce it ────────────────────────────────────────────────────
--
-- In get_user_company_id, the function about a hundred policies resolve tenant scope
-- through. This is the same lever migration 25 used for suspension, and for the same
-- reason: a rule enforced in one function that everything already asks cannot be forgotten
-- by the next table somebody adds. The alternative — deleting the user_roles row — throws
-- away the person's role, so a termination entered by mistake cannot simply be undone.
--
-- ── First, make 'terminated' mean something ────────────────────────────────
--
-- employees.status had no CHECK constraint at all: it is free text, and the three values in
-- production ('active', 'invited', 'terminated') are a convention rather than a rule. That
-- was survivable while nothing read the column. It is not survivable now that this exact
-- string is what ends someone's access — 'Terminated' with a capital T would look right in
-- every list and revoke nothing.
ALTER TABLE public.employees
  DROP CONSTRAINT IF EXISTS employees_status;
ALTER TABLE public.employees
  ADD CONSTRAINT employees_status CHECK (status IN ('active', 'invited', 'terminated'));

-- ── The gate ───────────────────────────────────────────────────────────────
-- Read as: this company grants access if its plan is live AND the caller is not a
-- terminated employee of it. The NOT EXISTS is deliberately narrow — a login with no
-- employee row at all (an operator, an account invited before its record was created)
-- is unaffected, because there is no employment to have ended.
CREATE OR REPLACE FUNCTION public.get_user_company_id(uid uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT ur.company_id
    FROM user_roles ur
    JOIN company c ON c.id = ur.company_id
   WHERE ur.user_id = uid
     AND c.plan IN ('trial', 'active')
     AND NOT EXISTS (
       SELECT 1 FROM employees e
        WHERE e.user_id = uid
          AND e.company_id = ur.company_id
          AND e.status = 'terminated'
     )
   LIMIT 1;
$function$;

COMMENT ON FUNCTION public.get_user_company_id(uuid) IS
  'Tenant scope, and the one place two kinds of access-ending are enforced: a company whose plan has stopped granting access, and an employee who has been terminated. Around a hundred policies resolve through this, which is why both rules live here.';

-- ── And say which of the two it is ─────────────────────────────────────────
-- my_workspace() is the reader that still answers when the gate is shut. It already lets a
-- suspended company see why; without the employment status a terminated person and an
-- account that was never linked to an employee record look identical from the app, and both
-- would be told "your login is not linked to an employee record" — which is not true and
-- not actionable.
--
-- Dropped and recreated rather than replaced: the return type gains a column.
DROP FUNCTION IF EXISTS public.my_workspace();
CREATE OR REPLACE FUNCTION public.my_workspace()
RETURNS TABLE(company_id uuid, company_name text, plan text, plan_note text,
              plan_changed_at timestamptz, role text, employee_id uuid,
              platform_owner boolean, employment_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Access denied: authentication required';
  END IF;

  RETURN QUERY
  SELECT c.id, c.name, c.plan, c.plan_note, c.plan_changed_at,
         ur.role,
         (SELECT e.id FROM employees e
           WHERE e.user_id = v_uid AND e.company_id = ur.company_id LIMIT 1),
         coalesce(ur.is_platform_owner, false),
         (SELECT e.status FROM employees e
           WHERE e.user_id = v_uid AND e.company_id = ur.company_id LIMIT 1)
    FROM user_roles ur
    JOIN company c ON c.id = ur.company_id
   WHERE ur.user_id = v_uid
   LIMIT 1;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.my_workspace() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.my_workspace() TO authenticated;

-- ── Close the sessions too ─────────────────────────────────────────────────
-- The gate above takes effect on the very next query, whatever token the browser is
-- holding, so this is not what does the locking. It is here so the session list stops
-- claiming an ex-employee is signed in on three devices, and so anything that counts
-- active sessions counts the truth.
CREATE OR REPLACE FUNCTION public.end_sessions_on_termination()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'terminated' AND OLD.status IS DISTINCT FROM 'terminated'
     AND NEW.user_id IS NOT NULL THEN
    UPDATE user_sessions
       SET is_active = false, expires_at = LEAST(COALESCE(expires_at, now()), now())
     WHERE user_id = NEW.user_id AND is_active;
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS zz_end_sessions_on_termination ON public.employees;
CREATE TRIGGER zz_end_sessions_on_termination
  AFTER UPDATE OF status ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.end_sessions_on_termination();

-- ── What termination deliberately does NOT do ──────────────────────────────
-- It leaves every record in place: attendance, leave, payslips, reviews, documents. An
-- employment record has to outlive the employment — it is what answers a labour claim two
-- years later — and the retention rules in data_retention_policies are where deletion is
-- decided, not here.
--
-- It also does not touch user_roles, so restoring someone is one status change back to
-- 'active' and their role is exactly as it was.
