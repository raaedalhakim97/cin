-- Finding 5 from the audit, and it is mine. Migrations 48 and 50 moved responsibility from
-- "the manager of your department" to "the manager HR named for you" — Aisha can approve
-- Khalid's leave even though he sits in Admin and she does not. The notification that tells
-- her there IS leave to approve never moved. It still asks the department question:
--
--     IF r.role = 'department_manager'
--        AND p_department_id IS NOT NULL
--        AND r.department_id IS DISTINCT FROM p_department_id THEN CONTINUE;
--
-- So Khalid submits, the only person who can act on it is filtered out for being in the
-- wrong department, and the request sits in a queue nobody was told about. The permission
-- and the notification disagreed, and the notification is the half a person actually sees.
-- A request that waits three days because the approver was never told is indistinguishable,
-- to the employee, from a system that does not work.
--
-- Nothing in production has reports_to set yet, so nobody has been affected. That is luck
-- about timing, not a reason to leave it: the first time Raaed uses the feature the two
-- migrations were written for, it would have failed quietly in exactly this way.
--
-- ── One rule, asked from both ends ─────────────────────────────────────────
--
-- manages_employee answers "may I, the person signed in, act on this employee?" — it reads
-- auth.uid() and returns a boolean. A notification needs the opposite direction: given this
-- employee, who are the managers? Nobody is signed in; a trigger is running.
--
-- Writing that rule a second time is how the two ends drift apart, which is the whole
-- reason this migration exists. So the rule moves down one level into manager_covers,
-- which names both sides and knows nothing about who is signed in. manages_employee calls
-- it with the caller as the manager; the notifier calls it with each candidate recipient.
-- One rule, two directions, one place to change it.
--
-- manager_covers deliberately does not check status or role. It answers a question about
-- responsibility, not about eligibility: whether a terminated manager should be notified is
-- the notifier's business (it already filters to active employees with a login), and
-- whether a role is allowed to manage is manages_employee's (a department_manager reaches
-- this branch, an employee never does). Folding either into the predicate would make the
-- two callers disagree about what they were asking.

-- ── The rule ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.manager_covers(
  p_manager_employee uuid,
  p_employee         uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM employees target
      JOIN employees mgr ON mgr.id = p_manager_employee
     WHERE target.id = p_employee
       AND mgr.company_id = target.company_id
       -- Nobody manages themselves. This is what stopped a manager signing off their own
       -- leave request in migration 50, and it has to stay in the rule, not in a caller.
       AND mgr.id IS DISTINCT FROM target.id
       AND CASE
             -- HR has named this person's manager. Then only they have them, and the
             -- department is irrelevant — that is the multi-unit case from migration 48.
             WHEN target.reports_to IS NOT NULL THEN target.reports_to = mgr.id
             ELSE target.department_id IS NOT NULL
              AND (
                    target.department_id = mgr.department_id
                 OR EXISTS (SELECT 1 FROM departments d
                             WHERE d.id = target.department_id
                               AND d.manager_id = mgr.id)
                  )
           END
  );
$function$;

COMMENT ON FUNCTION public.manager_covers(uuid, uuid) IS
  'Is this manager responsible for this employee? Named manager if HR set one, else same department or named manager of that department. Never yourself. Says nothing about role, status or who is signed in - manages_employee decides that for the caller, and notify_roles for a recipient.';

REVOKE EXECUTE ON FUNCTION public.manager_covers(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.manager_covers(uuid, uuid) TO authenticated;

-- ── The caller's end, now delegating ───────────────────────────────────────
--
-- Identical behaviour to migration 50. The department_manager branch is the only thing
-- that changed, and it changed into a call rather than a copy. The LEFT JOIN still supplies
-- me.id, and when there is no employee record for the signed-in user it is NULL, which
-- manager_covers reads as no match — the same answer the inline version gave.
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
             WHEN 'department_manager' THEN public.manager_covers(me.id, target.id)
             ELSE false
           END
  );
$function$;

-- ── Who to tell ────────────────────────────────────────────────────────────
--
-- The recipient's end. Returns employee ids, not user ids, because that is what the
-- notification tables key on and what the caller is already looping over.
CREATE OR REPLACE FUNCTION public.employee_managers(p_employee_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT mgr.id
    FROM employees target
    JOIN employees mgr ON mgr.company_id = target.company_id
   WHERE target.id = p_employee_id
     AND public.manager_covers(mgr.id, target.id);
$function$;

COMMENT ON FUNCTION public.employee_managers(uuid) IS
  'Every employee responsible for this one, by the same rule manages_employee applies to the signed-in user. Does not filter by role or status - a caller that needs "who should be told" must still ask whether they are an active department_manager with a login.';

REVOKE EXECUTE ON FUNCTION public.employee_managers(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.employee_managers(uuid) TO authenticated;

-- ── The notifier ───────────────────────────────────────────────────────────
--
-- p_subject_employee is new and is the person the event is ABOUT. When it is given, a
-- department_manager is a recipient if they are responsible for that person — named
-- manager, own department, or manager of their department — and the department argument is
-- not consulted at all, because "HR named someone else" has to beat "we share a floor".
--
-- p_department_id stays for the events that are not about a particular employee. Dropping
-- it would leave a company-wide announcement with no way to reach one department.
--
-- The signature gains an argument, so the eleven-argument version is dropped rather than
-- replaced. Every existing positional call still resolves — the new argument defaults to
-- NULL and the old behaviour is exactly the NULL branch — but they are all updated below
-- anyway, because a call site that silently keeps the old behaviour is the bug this
-- migration is fixing.
DROP FUNCTION IF EXISTS public.notify_roles(
  uuid, text[], text, text, text, text, text, uuid, uuid, uuid, interval);

CREATE FUNCTION public.notify_roles(
  p_company_id       uuid,
  p_roles            text[],
  p_kind             text,
  p_title            text,
  p_body             text DEFAULT NULL,
  p_link             text DEFAULT NULL,
  p_subject_table    text DEFAULT NULL,
  p_subject_id       uuid DEFAULT NULL,
  p_department_id    uuid DEFAULT NULL,
  p_exclude_employee uuid DEFAULT NULL,
  p_dedupe_window    interval DEFAULT '5 minutes',
  p_subject_employee uuid DEFAULT NULL
) RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r     record;
  v_n   integer := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT e.id, e.department_id, ur.role
      FROM employees e
      JOIN user_roles ur ON ur.user_id = e.user_id
     WHERE e.company_id = p_company_id
       AND e.status = 'active'
       AND e.user_id IS NOT NULL
       AND ur.role = ANY(p_roles)
       AND (p_exclude_employee IS NULL OR e.id <> p_exclude_employee)
  LOOP
    IF r.role = 'department_manager' THEN
      IF p_subject_employee IS NOT NULL THEN
        -- The event is about a person. Responsibility decides, not the org chart.
        IF NOT public.manager_covers(r.id, p_subject_employee) THEN
          CONTINUE;
        END IF;
      ELSIF p_department_id IS NOT NULL
            AND r.department_id IS DISTINCT FROM p_department_id THEN
        -- A department-scoped announcement. A manager with no department set would
        -- otherwise receive everything, which is the opposite of what the role means.
        CONTINUE;
      END IF;
    END IF;

    IF notify_employee(p_company_id, r.id, p_kind, p_title, p_body, p_link,
                       p_subject_table, p_subject_id, p_dedupe_window) IS NOT NULL THEN
      v_n := v_n + 1;
    END IF;
  END LOOP;

  RETURN v_n;
END;
$function$;

COMMENT ON FUNCTION public.notify_roles(uuid,text[],text,text,text,text,text,uuid,uuid,uuid,interval,uuid) IS
  'Turns a role list into recipients. hr_manager and super_admin hear about the company. A department_manager hears about the people they are responsible for when p_subject_employee names one, else about their own department.';

REVOKE ALL ON FUNCTION public.notify_roles(
  uuid,text[],text,text,text,text,text,uuid,uuid,uuid,interval,uuid)
  FROM PUBLIC, anon, authenticated;

-- ── The three call sites that are about a person ───────────────────────────
--
-- Named arguments from here on. Eleven positional arguments where the ninth and tenth are
-- both uuids is how the wrong one gets passed, and a twelfth would not have helped.

CREATE OR REPLACE FUNCTION public.notify_attendance_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_name  text;
  v_mins  text;
BEGIN
  BEGIN
    -- History is not news.
    IF NEW.date < current_date - 1 THEN
      RETURN NULL;
    END IF;

    -- Only when the grade is worth telling someone about, and only when it changed.
    IF NEW.status NOT IN ('late_minor','late_moderate','late_major','absent_unauthorized') THEN
      RETURN NULL;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN
      RETURN NULL;
    END IF;

    SELECT e.full_name INTO v_name FROM employees e WHERE e.id = NEW.employee_id;

    IF NEW.status = 'absent_unauthorized' THEN
      PERFORM notify_employee(NEW.company_id, NEW.employee_id, 'attendance_absent',
        'Recorded as absent',
        format('Your attendance for %s is recorded as absent without approved leave. '
               'If that is wrong, speak to HR.', to_char(NEW.date,'FMDay FMDD Mon')),
        '/attendance', 'attendance', NEW.id, '1 day');

      PERFORM notify_roles(
        p_company_id       => NEW.company_id,
        p_roles            => ARRAY['department_manager','hr_manager','super_admin'],
        p_kind             => 'attendance_team_late',
        p_title            => format('%s recorded absent', coalesce(v_name,'An employee')),
        p_body             => format('No approved leave for %s.', to_char(NEW.date,'FMDay FMDD Mon')),
        p_link             => '/attendance',
        p_subject_table    => 'attendance',
        p_subject_id       => NEW.id,
        p_exclude_employee => NEW.employee_id,
        p_dedupe_window    => '1 day',
        p_subject_employee => NEW.employee_id);
    ELSE
      v_mins := CASE NEW.status
                  WHEN 'late_minor'    THEN 'up to 30 minutes late'
                  WHEN 'late_moderate' THEN 'between 30 and 60 minutes late'
                  ELSE                      'more than an hour late'
                END;

      PERFORM notify_employee(NEW.company_id, NEW.employee_id, 'attendance_late',
        'Your clock-in was recorded as late',
        format('Today''s punch is graded %s. Attendance is 30%% of your KPI, so it is '
               'worth checking the record is right.', v_mins),
        '/attendance', 'attendance', NEW.id, '1 day');

      PERFORM notify_roles(
        p_company_id       => NEW.company_id,
        p_roles            => ARRAY['department_manager','hr_manager','super_admin'],
        p_kind             => 'attendance_team_late',
        p_title            => format('%s clocked in late', coalesce(v_name,'An employee')),
        p_body             => format('Graded %s.', v_mins),
        p_link             => '/attendance',
        p_subject_table    => 'attendance',
        p_subject_id       => NEW.id,
        p_exclude_employee => NEW.employee_id,
        p_dedupe_window    => '1 day',
        p_subject_employee => NEW.employee_id);
    END IF;

  EXCEPTION WHEN OTHERS THEN
    -- The punch is what matters. Never let this stop it.
    RAISE WARNING 'notify_attendance_change failed for attendance %: %', NEW.id, SQLERRM;
  END;

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_leave_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_name text;
  v_span text;
BEGIN
  BEGIN
    SELECT e.full_name INTO v_name FROM employees e WHERE e.id = NEW.employee_id;

    v_span := format('%s to %s (%s day%s)',
                     to_char(NEW.start_date,'FMDD Mon'), to_char(NEW.end_date,'FMDD Mon'),
                     NEW.days_requested, CASE WHEN NEW.days_requested = 1 THEN '' ELSE 's' END);

    IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
      -- To whoever has to act on it first — which, since migration 50, is whoever may
      -- actually update the row. This is the notification the audit found missing.
      PERFORM notify_roles(
        p_company_id       => NEW.company_id,
        p_roles            => ARRAY['department_manager','hr_manager','super_admin'],
        p_kind             => 'leave_submitted',
        p_title            => format('%s requested leave', coalesce(v_name,'An employee')),
        p_body             => format('%s — %s. Waiting for approval.',
                                     initcap(NEW.leave_type), v_span),
        p_link             => '/leave',
        p_subject_table    => 'leave_requests',
        p_subject_id       => NEW.id,
        p_exclude_employee => NEW.employee_id,
        p_dedupe_window    => '1 hour',
        p_subject_employee => NEW.employee_id);
      RETURN NULL;
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
      RETURN NULL;
    END IF;

    IF NEW.status = 'manager_approved' THEN
      -- Past the manager, now HR's queue. The employee is told it moved rather than
      -- being left to guess whether anything happened.
      PERFORM notify_roles(NEW.company_id, ARRAY['hr_manager','super_admin'],
        'leave_manager_approved',
        format('%s: leave approved by manager', coalesce(v_name,'An employee')),
        format('%s — %s. Needs final approval.', initcap(NEW.leave_type), v_span),
        '/leave', 'leave_requests', NEW.id, NULL, NULL, '1 hour');

      PERFORM notify_employee(NEW.company_id, NEW.employee_id, 'leave_manager_approved',
        'Your manager approved your leave',
        format('%s — %s. Now waiting for HR.', initcap(NEW.leave_type), v_span),
        '/leave', 'leave_requests', NEW.id, '1 hour');

    ELSIF NEW.status = 'approved' THEN
      PERFORM notify_employee(NEW.company_id, NEW.employee_id, 'leave_approved',
        'Your leave was approved',
        format('%s — %s.', initcap(NEW.leave_type), v_span),
        '/leave', 'leave_requests', NEW.id, '1 hour');

    ELSIF NEW.status = 'rejected' THEN
      PERFORM notify_employee(NEW.company_id, NEW.employee_id, 'leave_rejected',
        'Your leave request was declined',
        format('%s — %s.%s', initcap(NEW.leave_type), v_span,
               CASE WHEN NULLIF(btrim(coalesce(NEW.rejection_reason,'')),'') IS NOT NULL
                    THEN ' Reason: ' || NEW.rejection_reason ELSE '' END),
        '/leave', 'leave_requests', NEW.id, '1 hour');

    ELSIF NEW.status = 'cancelled' THEN
      -- Cancelling frees the days again, so whoever was going to approve it should
      -- stop looking for it — the same people who were told about it in the first place.
      PERFORM notify_roles(
        p_company_id       => NEW.company_id,
        p_roles            => ARRAY['department_manager','hr_manager','super_admin'],
        p_kind             => 'leave_cancelled',
        p_title            => format('%s cancelled a leave request',
                                     coalesce(v_name,'An employee')),
        p_body             => format('%s — %s.', initcap(NEW.leave_type), v_span),
        p_link             => '/leave',
        p_subject_table    => 'leave_requests',
        p_subject_id       => NEW.id,
        p_exclude_employee => NEW.employee_id,
        p_dedupe_window    => '1 hour',
        p_subject_employee => NEW.employee_id);
    END IF;

  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_leave_change failed for leave_request %: %', NEW.id, SQLERRM;
  END;

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_missing_clockouts()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r   record;
  v_n integer := 0;
BEGIN
  FOR r IN
    SELECT a.id, a.company_id, a.employee_id, a.date, e.full_name
      FROM attendance a
      JOIN employees e ON e.id = a.employee_id
     WHERE a.clock_in IS NOT NULL
       AND a.clock_out IS NULL
       AND a.date <= current_date - 1
       AND a.date >= current_date - 14
  LOOP
    BEGIN
      IF notify_employee(r.company_id, r.employee_id, 'attendance_missing_clockout',
           'You never clocked out',
           format('Your punch for %s has no clock-out, so no hours were counted for '
                  'that day. Ask HR to correct it.', to_char(r.date,'FMDay FMDD Mon')),
           '/attendance', 'attendance', r.id, '30 days') IS NOT NULL THEN
        v_n := v_n + 1;
      END IF;

      PERFORM notify_roles(
        p_company_id       => r.company_id,
        p_roles            => ARRAY['department_manager','hr_manager','super_admin'],
        p_kind             => 'attendance_missing_clockout',
        p_title            => format('%s has an open punch', coalesce(r.full_name,'An employee')),
        p_body             => format('%s was never clocked out. Attendance and overtime '
                                     'for that day cannot be calculated until it is '
                                     'corrected.', to_char(r.date,'FMDay FMDD Mon')),
        p_link             => '/attendance',
        p_subject_table    => 'attendance',
        p_subject_id       => r.id,
        p_exclude_employee => r.employee_id,
        p_dedupe_window    => '30 days',
        p_subject_employee => r.employee_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'notify_missing_clockouts failed for attendance %: %', r.id, SQLERRM;
    END;
  END LOOP;

  RETURN v_n;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_attendance_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_leave_change()      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_missing_clockouts() FROM PUBLIC, anon, authenticated;

-- ── The one the audit got wrong ────────────────────────────────────────────
--
-- Finding 9 said notify_missing_clockouts is never called. It is: cron job 3,
-- 'nightly-missing-clockouts', 22:00 daily, active, and eighteen successful runs on record
-- with the most recent last night. The other two jobs — the monthly KPI rules and the
-- session cleanup — have also run and succeeded. Nothing to fix; recorded here so the
-- finding is not investigated a second time.
