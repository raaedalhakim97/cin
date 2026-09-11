-- Migration 48 made a named manager reach across departments and it did not work. Found
-- by running it, not by reading it:
--
--   Omar rates Khalid (named to him): 0 rows, manager_level null
--
-- kpi_manages_employee said yes. The write policy on kpi_review_lines asks
-- kpi_manages_employee, and it said yes too. But that policy asks its question through an
-- EXISTS on kpi_reviews — and kpi_reviews carries its own RLS, which a policy expression
-- does not get to skip:
--
--   kpi_reviews_select ... employee_id IN (SELECT id FROM employees
--                                          WHERE department_id = get_user_department_id(...))
--
-- Khalid is in Operations, Omar is in Sales, so the review row was invisible and the EXISTS
-- found nothing. Zero rows updated, no error — the worst shape of failure, because the
-- screen would have said "Saved".
--
-- Migration 44 left these two policies alone precisely BECAUSE they already had a
-- department clause and therefore looked correct. They were correct for the rule at the
-- time and became the one place still enforcing it after the rule changed. Two lessons
-- worth the comment: a permission that spans tables is only as wide as the narrowest policy
-- on the path, and "this one already looks right" is how the old rule survives.
--
-- So the department test is replaced by the predicate in all three places a manager acts on
-- someone's performance: reading the review, writing it, and recommending a warning.

DROP POLICY IF EXISTS kpi_reviews_select ON public.kpi_reviews;
CREATE POLICY kpi_reviews_select ON public.kpi_reviews
  FOR SELECT TO authenticated
  USING (
    company_id = get_user_company_id((SELECT auth.uid()))
    AND (
      -- read_only is the auditor's seat: sees the company, changes nothing.
      get_user_role((SELECT auth.uid())) IN ('super_admin', 'hr_manager', 'read_only')
      OR employee_id = get_user_employee_id((SELECT auth.uid()))
      OR public.kpi_manages_employee(employee_id)
    )
  );

DROP POLICY IF EXISTS kpi_reviews_manager_update ON public.kpi_reviews;
CREATE POLICY kpi_reviews_manager_update ON public.kpi_reviews
  FOR UPDATE TO authenticated
  USING (
    company_id = get_user_company_id((SELECT auth.uid()))
    AND get_user_role((SELECT auth.uid())) = 'department_manager'
    AND public.kpi_manages_employee(employee_id)
  );

-- Recommending a warning is the same authority as rating: it is a statement about somebody
-- performance, and it goes to HR either way. A multi-unit manager who can rate Khalid but
-- cannot flag a problem with him has half a manager's job.
DROP POLICY IF EXISTS warn_rec_mgr_insert ON public.warning_recommendations;
CREATE POLICY warn_rec_mgr_insert ON public.warning_recommendations
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = get_user_company_id((SELECT auth.uid()))
    AND get_user_role((SELECT auth.uid())) = 'department_manager'
    AND recommended_by = get_user_employee_id((SELECT auth.uid()))
    AND public.kpi_manages_employee(employee_id)
  );

-- ── Still on the department, still deliberately ────────────────────────────
--   leave_mgr_update      approving paid time off
--   payroll_mgr_select    seeing a payroll run
--   hr_documents_select   reading somebody's file
--
-- Each of those is a decision with money or privacy attached, and widening them should be
-- something Raaed asks for, not something that arrives as a side effect of a performance
-- change. They are listed here so the next person can see the line was drawn on purpose.
