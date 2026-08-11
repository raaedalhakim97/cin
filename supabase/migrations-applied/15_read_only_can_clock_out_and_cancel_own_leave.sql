-- read_only could clock in but never clock out.
--
-- The instruction was explicit: "Who ever had read-only they can clock in and
-- out I am not asking they can edit only clock in and out and request leave
-- like normal employee". Last time I removed the read_only gates from
-- Attendance.jsx and Leave.jsx, and stopped there. The buttons appeared, and
-- the database still refused half of what they did.
--
-- Found by clocking Fatima Zahra (read_only) in and then out against the live
-- database. The clock-in succeeded. The clock-out silently did nothing:
--
--   read_only clock-out affected 0 row(s)
--
-- Silently, because an UPDATE that RLS filters to zero rows does not raise —
-- it reports success. So the app would have shown no error, and she would have
-- been left clocked in forever, accruing a shift that never ended.
--
-- Two policies carried the exclusion:
--
--   att_self_update    ... AND get_user_role(auth.uid()) <> 'read_only' ...
--   leave_self_update  ... AND get_user_role(auth.uid()) <> 'read_only' ...
--
-- The first is the clock-out. The second is cancelling one's own pending leave
-- request, which is part of requesting leave like a normal employee — the
-- client gate for it came off last time too.
--
-- Every other condition is kept exactly as it was, and that is what makes this
-- safe rather than a widening of read_only's powers:
--
--   * employee_id must be one of the caller's own employee rows, so this is
--     self-service only and read_only still cannot touch anybody else.
--   * company_id must match the caller's company, so tenant isolation holds.
--   * attendance: date = CURRENT_DATE, so yesterday cannot be rewritten.
--   * leave: status = 'pending', so an approved or rejected request is final.
--
-- read_only's read scope is untouched, and so is its inability to write any
-- record that is not its own. What changes is only that the role can now
-- finish the two self-service actions it was already able to start.
--
-- Note on what "clock out" can now do: attendance_guard (migration 14) stamps
-- the clock-out with the server's own clock and freezes status, overtime and
-- approvals to their previous values on any self-update. So granting this does
-- not let read_only — or any employee — choose when they left.

DROP POLICY IF EXISTS att_self_update ON public.attendance;

CREATE POLICY att_self_update ON public.attendance
  FOR UPDATE
  USING (
    company_id = get_user_company_id((SELECT auth.uid()))
    AND date = CURRENT_DATE
    AND employee_id IN (
      SELECT employees.id FROM employees
       WHERE employees.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    company_id = get_user_company_id((SELECT auth.uid()))
    AND employee_id IN (
      SELECT employees.id FROM employees
       WHERE employees.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS leave_self_update ON public.leave_requests;

CREATE POLICY leave_self_update ON public.leave_requests
  FOR UPDATE
  USING (
    company_id = get_user_company_id((SELECT auth.uid()))
    AND status = 'pending'
    AND employee_id IN (
      SELECT employees.id FROM employees
       WHERE employees.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    company_id = get_user_company_id((SELECT auth.uid()))
    AND employee_id IN (
      SELECT employees.id FROM employees
       WHERE employees.user_id = (SELECT auth.uid())
    )
  );
