-- Raaed said go, so the named manager from migration 48 now reaches the three things that
-- were deliberately left behind: approving leave, seeing a payroll run, and reading
-- somebody's file. A multi-unit manager who can review Khalid but cannot approve his
-- holiday is not managing him.
--
-- ── One name for the question ──────────────────────────────────────────────
--
-- The predicate was called kpi_manages_employee because performance was the only thing it
-- governed. It is about to decide who signs off paid time off, where "kpi" is actively
-- misleading. So the logic moves to manages_employee, and kpi_manages_employee becomes a
-- one-line alias.
--
-- The alias is not laziness: nine policies and three functions from migrations 44 to 49
-- call it, and retyping nine policy expressions to rename a function is how a policy gets
-- subtly changed while nobody is looking at that part of the diff. One implementation, one
-- alias, and the next migration that touches those policies can switch the call.
--
-- ── Three real holes found while reading these ─────────────────────────────
--
-- 1. leave_update grants a department_manager UPDATE on EVERY leave request in the
--    company. leave_mgr_update, which carefully restricts them to their own department,
--    adds nothing at all — permissive policies are ORed, so the wide one wins. The only
--    thing standing between a manager and someone else's leave row was
--    validate_leave_transition, which polices the STATUS and nothing else: the dates, the
--    reason and the day count were all editable on anybody's request, in any department.
--
-- 2. validate_leave_transition compares the employee's department to the caller's and
--    never checks whether they are the same person, so a department_manager could give
--    first-step approval to their OWN leave request. HR still had to give the final
--    approval, so this was not a way to award yourself holiday — but the first signature
--    on your own request is exactly the thing the two-step design exists to prevent.
--    manages_employee excludes self, so switching to it closes this without a special case.
--
-- 3. kpi_select, kpi_insert and kpi_update on kpi_scores give a department_manager the
--    whole company. Two screens carry a client-side filter to compensate, both with a
--    comment saying so, and one of them says outright that it "is the only scoping that
--    exists at all for this role". A filter in JavaScript is not a permission: it decides
--    what is drawn, not what the API returns. Fixed here, and the two filters come out.

-- ── The predicate, renamed ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.manages_employee(p_employee_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM employees target
      LEFT JOIN employees me ON me.user_id = (SELECT auth.uid())
     WHERE target.id = p_employee_id
       AND target.company_id = get_user_company_id((SELECT auth.uid()))
       AND CASE get_user_role((SELECT auth.uid()))
             -- The owner answers to nobody, including on their own review.
             WHEN 'super_admin' THEN true
             -- HR covers the whole company but not themselves; the owner does theirs.
             WHEN 'hr_manager'  THEN target.id IS DISTINCT FROM me.id
             WHEN 'department_manager' THEN
                  target.id IS DISTINCT FROM me.id
              AND CASE
                    -- HR has named this person's manager. Only they have them.
                    WHEN target.reports_to IS NOT NULL THEN target.reports_to = me.id
                    ELSE target.department_id IS NOT NULL
                     AND (
                           target.department_id = me.department_id
                        OR EXISTS (SELECT 1 FROM departments d
                                    WHERE d.id = target.department_id
                                      AND d.manager_id = me.id)
                         )
                  END
             ELSE false
           END
  );
$function$;

COMMENT ON FUNCTION public.manages_employee(uuid) IS
  'Whose work this person is responsible for: rating it, approving their leave, seeing their pay run, reading their file. Owner: anyone. HR: anyone but themselves. Department manager: whoever HR named them for, else their own department - never themselves. Everyone else: nobody.';

REVOKE EXECUTE ON FUNCTION public.manages_employee(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.manages_employee(uuid) TO authenticated;

-- The alias. Same question, older name, still called by nine policies.
CREATE OR REPLACE FUNCTION public.kpi_manages_employee(p_employee_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.manages_employee(p_employee_id);
$function$;

COMMENT ON FUNCTION public.kpi_manages_employee(uuid) IS
  'Alias for manages_employee, kept because migrations 44-49 wrote this name into nine policies. Prefer manages_employee in anything new.';

-- ── 1. Leave ───────────────────────────────────────────────────────────────
-- Reading. A department_manager stops seeing the whole company's requests, which is what
-- the two client-side filters were papering over.
DROP POLICY IF EXISTS leave_select ON public.leave_requests;
CREATE POLICY leave_select ON public.leave_requests
  FOR SELECT TO authenticated
  USING (
    company_id = get_user_company_id((SELECT auth.uid()))
    AND (
      get_user_role((SELECT auth.uid())) IN ('super_admin', 'hr_manager', 'read_only')
      OR employee_id = get_user_employee_id((SELECT auth.uid()))
      OR public.manages_employee(employee_id)
    )
  );

-- Writing. leave_update loses department_manager entirely — hole 1. Their route is
-- leave_mgr_update, which is now about the people they actually manage, and
-- validate_leave_transition still decides which status changes are legal.
DROP POLICY IF EXISTS leave_update ON public.leave_requests;
CREATE POLICY leave_update ON public.leave_requests
  FOR UPDATE TO authenticated
  USING (company_id = get_user_company_id((SELECT auth.uid()))
         AND get_user_role((SELECT auth.uid())) IN ('super_admin', 'hr_manager'));

DROP POLICY IF EXISTS leave_mgr_update ON public.leave_requests;
CREATE POLICY leave_mgr_update ON public.leave_requests
  FOR UPDATE TO authenticated
  USING (company_id = get_user_company_id((SELECT auth.uid()))
         AND get_user_role((SELECT auth.uid())) = 'department_manager'
         AND public.manages_employee(employee_id));

-- And the transition guard asks the same question — hole 2. The two department comparisons
-- become one predicate that also refuses your own request.
CREATE OR REPLACE FUNCTION public.validate_leave_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_role text;
  v_caller_emp uuid;
  v_mine boolean;
BEGIN
  -- Admin/maintenance contexts bypass
  IF v_uid IS NULL OR NEW.status = OLD.status THEN RETURN NEW; END IF;

  v_role := get_user_role(v_uid);
  v_caller_emp := get_user_employee_id(v_uid);
  -- "Somebody I am responsible for", which is never me.
  v_mine := public.manages_employee(NEW.employee_id);

  -- Employee may cancel their own pending request
  IF NEW.status = 'cancelled' THEN
    IF OLD.status = 'pending' AND NEW.employee_id = v_caller_emp THEN RETURN NEW; END IF;
    IF v_role IN ('hr_manager','super_admin') THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Only the requester (while pending) or HR can cancel a leave request';
  END IF;

  -- Step 1: pending → manager_approved, by the manager responsible for that employee
  IF OLD.status = 'pending' AND NEW.status = 'manager_approved' THEN
    IF v_role = 'department_manager' AND v_mine THEN
      NEW.manager_reviewed_by := v_caller_emp;
      NEW.manager_reviewed_at := now();
      RETURN NEW;
    END IF;
    IF v_role = 'department_manager' AND NEW.employee_id = v_caller_emp THEN
      RAISE EXCEPTION 'You cannot give the first approval to your own leave request. HR approves yours.';
    END IF;
    RAISE EXCEPTION 'Only the manager responsible for this employee can give first-step approval';
  END IF;

  -- Final approval: HR/super_admin, from manager_approved (or directly from
  -- pending — small teams without a manager still work)
  IF NEW.status = 'approved' AND OLD.status IN ('pending','manager_approved') THEN
    IF v_role IN ('hr_manager','super_admin') THEN
      NEW.reviewed_by := v_caller_emp;
      NEW.reviewed_at := now();
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Only HR or super admin can give final leave approval';
  END IF;

  -- Rejection: the responsible manager (from pending) or HR/super_admin any time
  IF NEW.status = 'rejected' THEN
    IF v_role IN ('hr_manager','super_admin') THEN
      NEW.reviewed_by := v_caller_emp; NEW.reviewed_at := now(); RETURN NEW;
    END IF;
    IF v_role = 'department_manager' AND OLD.status = 'pending' AND v_mine THEN
      NEW.manager_reviewed_by := v_caller_emp; NEW.manager_reviewed_at := now();
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'You are not authorized to reject this request';
  END IF;

  RAISE EXCEPTION 'Invalid leave status transition: % → %', OLD.status, NEW.status;
END $function$;

-- ── 2. Payroll ─────────────────────────────────────────────────────────────
-- manager_salary_visibility stays in front of everything: a company that has not turned it
-- on shows a manager no pay figures at all, named reports included.
DROP POLICY IF EXISTS payroll_mgr_select ON public.payroll_runs;
CREATE POLICY payroll_mgr_select ON public.payroll_runs
  FOR SELECT TO authenticated
  USING (
    company_id = get_user_company_id((SELECT auth.uid()))
    AND get_user_role((SELECT auth.uid())) = 'department_manager'
    AND (SELECT c.manager_salary_visibility FROM company c
          WHERE c.id = get_user_company_id((SELECT auth.uid())))
    AND public.manages_employee(employee_id)
  );

-- ── 3. Files ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS hr_documents_select ON public.hr_documents;
CREATE POLICY hr_documents_select ON public.hr_documents
  FOR SELECT TO authenticated
  USING (
    company_id = get_user_company_id((SELECT auth.uid()))
    AND (
      get_user_role((SELECT auth.uid())) IN ('super_admin', 'hr_manager', 'admin')
      -- Your own file, whatever your role.
      OR (scope = 'employee' AND employee_id = get_user_employee_id((SELECT auth.uid())))
      -- A manager reads the files of the people they are responsible for. Company-wide
      -- documents are not theirs to browse, which is why scope is still checked.
      OR (get_user_role((SELECT auth.uid())) = 'department_manager'
          AND scope = 'employee'
          AND public.manages_employee(employee_id))
    )
  );

-- ── 4. The monthly scores, where a JavaScript filter was the permission ────
DROP POLICY IF EXISTS kpi_select ON public.kpi_scores;
CREATE POLICY kpi_select ON public.kpi_scores
  FOR SELECT TO authenticated
  USING (
    company_id = get_user_company_id((SELECT auth.uid()))
    AND (
      get_user_role((SELECT auth.uid())) IN ('super_admin', 'hr_manager', 'read_only')
      OR employee_id = get_user_employee_id((SELECT auth.uid()))
      OR public.manages_employee(employee_id)
    )
  );

-- A manager's own row is not here on purpose: creating and editing their own
-- self-evaluation goes through kpi_self_eval_insert and kpi_self_eval_update, which every
-- role that is not read_only already has. What this stops is a manager writing a
-- manager_score for somebody who is not theirs.
DROP POLICY IF EXISTS kpi_insert ON public.kpi_scores;
CREATE POLICY kpi_insert ON public.kpi_scores
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = get_user_company_id((SELECT auth.uid()))
    AND (
      get_user_role((SELECT auth.uid())) IN ('super_admin', 'hr_manager')
      OR (get_user_role((SELECT auth.uid())) = 'department_manager'
          AND public.manages_employee(employee_id))
    )
  );

DROP POLICY IF EXISTS kpi_update ON public.kpi_scores;
CREATE POLICY kpi_update ON public.kpi_scores
  FOR UPDATE TO authenticated
  USING (
    company_id = get_user_company_id((SELECT auth.uid()))
    AND (
      get_user_role((SELECT auth.uid())) IN ('super_admin', 'hr_manager')
      OR (get_user_role((SELECT auth.uid())) = 'department_manager'
          AND public.manages_employee(employee_id))
    )
  );

-- ── Still on the department, and now the only one left ─────────────────────
-- emp_select keeps its department clause because migration 48 added the reports_to clause
-- alongside it, which is the same rule spelled out rather than the old one surviving. It is
-- written inline rather than through manages_employee for one reason: manages_employee
-- excludes yourself, and an employee reading their own row is the first thing that policy
-- has to allow.
