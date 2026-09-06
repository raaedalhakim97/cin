-- Finding 8 of the audit said the admin role can write HR documents, as though that were a
-- hole. It is not. BYOND-HR_Access_Control_Standard.md §3 grants admin F on "HR documents
-- (all)" in writing. The database is doing what the Standard says. The finding was wrong,
-- and the useful thing was not to fix it but to ask the question it should have asked:
-- where else do the Standard and the database disagree, in either direction?
--
-- Comparing §3's thirty-eight rows against the live policies turned up seven divergences.
-- Two of them are the same bug the last five migrations have been closing, so they are
-- fixed here. The rest are decisions, not defects, and are recorded at the bottom for
-- Raaed rather than changed behind her.
--
-- ── 1. A department manager could see the whole company's attendance ───────
--
-- §3 "Attendance (others)": department_manager is B — team only. att_select put
-- department_manager in a flat role list, so the scoping was never applied. Measured on
-- production before this migration: Omar manages Sales, and could read 24 attendance rows
-- belonging to six people, none of them in Sales — Finance, HR, IT and Operations,
-- including the HR manager's own record and the owner's sixteen days.
--
-- This is exactly the shape of the leave hole from migration 50 and the kpi_scores hole
-- beside it: a role list where a responsibility question belonged. Attendance is also the
-- input to the attendance_pct metric, so it is somebody's performance history, not just a
-- list of times.
--
-- ── 2. The named manager could not see the roster ──────────────────────────
--
-- shifts_select scoped department managers by comparing department ids directly, which was
-- correct until migration 48 introduced a named manager who may sit elsewhere. Aisha can
-- review Khalid, approve his leave, see his pay run and read his file, and could not see
-- the shift she is approving that leave against. Same predicate, same answer as everywhere
-- else now.
--
-- ── On performance ─────────────────────────────────────────────────────────
--
-- manages_employee is STABLE and reads three small tables, but a policy predicate is
-- evaluated per candidate row, so a company with years of punches will want an index-backed
-- rewrite here rather than a function call. Worth saying plainly: this is correct before it
-- is fast, and at demo scale — 24 rows — the difference is unmeasurable. The note is for
-- whoever profiles it at ten thousand.

-- ── Attendance ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS att_select ON public.attendance;
CREATE POLICY att_select ON public.attendance
  FOR SELECT TO authenticated
  USING (
    company_id = get_user_company_id((SELECT auth.uid()))
    AND (
      -- read_only is left in deliberately. See the open questions at the bottom: §3 says
      -- no access, the app was built to give it access, and which one is wrong is not a
      -- decision to make inside a migration.
      get_user_role((SELECT auth.uid())) IN ('super_admin', 'hr_manager', 'read_only')
      OR employee_id = get_user_employee_id((SELECT auth.uid()))
      OR public.manages_employee(employee_id)
    )
  );

-- attendance_admin_select is untouched: §3 gives admin R on other people's attendance and
-- that is what it grants. It stays a separate policy because it grants read and nothing
-- else, which is easier to see from a second policy than from a fourth branch above.

-- ── Shifts ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS shifts_select ON public.shifts;
CREATE POLICY shifts_select ON public.shifts
  FOR SELECT TO authenticated
  USING (
    company_id = get_user_company_id((SELECT auth.uid()))
    AND (
      get_user_role((SELECT auth.uid())) IN ('super_admin', 'hr_manager', 'admin')
      OR public.manages_employee(employee_id)
      -- An employee sees their own roster once it is published. A draft is a plan, and
      -- being told about a plan that changes twice before Monday is worse than not being
      -- told — this is the same reason notify_shift_published only fires on publish.
      OR (status IN ('published', 'completed', 'no_show')
          AND employee_id = get_user_employee_id((SELECT auth.uid())))
    )
  );

-- ── The five divergences NOT changed here ──────────────────────────────────
--
-- Each of these is a question for Raaed, not a defect. Recorded so the comparison does not
-- have to be done a third time.
--
-- a. read_only and other people's attendance. §3 says – (no access). The database grants
--    it and Attendance.jsx grants it deliberately, with a comment saying the page "just
--    never offered it, so operations could see today and nothing else". §3 also gives
--    read_only R on employee records, departments and payroll, so an auditor who may read
--    a payslip but not a punch is an odd shape — it looks more like §3 is out of date than
--    like the code is wrong. Unchanged, because narrowing an auditor's sight lines is a
--    business decision.
--
-- b. read_only and the shift schedule. The mirror image: §3 says R, the database grants
--    nothing. Unchanged, because widening access is the direction that needs asking first.
--
-- c. department_manager and HR documents. §3 says B (read/write). They have read, scoped
--    correctly through manages_employee since migration 50, and no write at all. Adding
--    write would let a manager file — and delete — documents on their team's personal
--    records. That is a real capability with a real blast radius, and it should be turned
--    on because Raaed wants it, not because a table cell says B.
--
-- d. hr_manager deleting an employee. §3 says F, which includes delete; emp_delete is
--    super_admin only. This looks deliberate and right: anonymize_employee exists precisely
--    so that leaving a company does not erase the record of having worked there, and a
--    hard delete would take the attendance, leave and review history with it.
--
-- e. department_manager and shift templates. §3 says –, shift_templates_select is company
--    -wide. Templates are patterns like "Morning 08:00-16:00" with no personal data in
--    them, and a manager who can see the roster but not the shape of a shift would be a
--    strange thing to build. Trivial either way.
