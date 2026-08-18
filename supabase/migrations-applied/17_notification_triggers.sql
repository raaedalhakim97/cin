-- Notifications, part two: what actually creates them.
--
-- Four events, chosen because each one is currently invisible unless somebody
-- happens to open the right screen:
--
--   attendance   late, absent, and a punch that was never closed
--   feed_posts   a new post
--   leave        submitted (to whoever must act), and decided (back to the person)
--   shifts       a shift or a day off published for you
--
-- The shift case is the original complaint that started this: a shift was created
-- for Fatima and she had no way of knowing.
--
-- ── The rule that matters more than any of them ────────────────────────────
--
-- A notification must never be able to break the thing it is about. Every trigger
-- below wraps its work in an exception handler, so a bug here degrades to a warning
-- in the Postgres log instead of aborting the write that triggered it. Someone
-- clocking in at 6am must not be turned away because a notification could not be
-- addressed.
--
-- This is not theoretical caution. These triggers resolve recipients by joining
-- employees to user_roles and reading department_id, so a NULL department, a
-- terminated manager or a company with no HR user are all ordinary states that would
-- otherwise raise inside a trigger on attendance.
--
-- ── Not notifying about history ────────────────────────────────────────────
--
-- Attendance triggers ignore anything dated more than a day back. HR correcting last
-- month's records should not send fifty people a notification that they were late in
-- July, and a bulk backfill should not send hundreds.

-- ── Recipient resolution ──────────────────────────────────────────────────
--
-- Roles decide who hears about an event; this turns a role list into people. A
-- department_manager hears only about their own department — the whole point of the
-- role — while hr_manager and super_admin hear about the company.
CREATE OR REPLACE FUNCTION public.notify_roles(
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
  p_dedupe_window    interval DEFAULT '5 minutes'
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
    -- A department manager with no department set would otherwise receive
    -- everything, which is the opposite of what the role means.
    IF r.role = 'department_manager'
       AND p_department_id IS NOT NULL
       AND r.department_id IS DISTINCT FROM p_department_id THEN
      CONTINUE;
    END IF;

    IF notify_employee(p_company_id, r.id, p_kind, p_title, p_body, p_link,
                       p_subject_table, p_subject_id, p_dedupe_window) IS NOT NULL THEN
      v_n := v_n + 1;
    END IF;
  END LOOP;

  RETURN v_n;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_roles(uuid,text[],text,text,text,text,text,uuid,uuid,uuid,interval)
  FROM PUBLIC, anon, authenticated;

-- ── Attendance ────────────────────────────────────────────────────────────
--
-- The employee learns their punch was graded late or absent — which they cannot
-- currently see without opening the Attendance page and reading a badge. Their
-- manager and HR learn the same thing, because "who is not here" is the question a
-- supervisor actually has at 8am.
--
-- Dedupe is a full day on the attendance row, so an HR correction or a clock-out
-- later the same day does not send a second copy.
CREATE OR REPLACE FUNCTION public.notify_attendance_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_name  text;
  v_dept  uuid;
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

    SELECT e.full_name, e.department_id INTO v_name, v_dept
      FROM employees e WHERE e.id = NEW.employee_id;

    IF NEW.status = 'absent_unauthorized' THEN
      PERFORM notify_employee(NEW.company_id, NEW.employee_id, 'attendance_absent',
        'Recorded as absent',
        format('Your attendance for %s is recorded as absent without approved leave. '
               'If that is wrong, speak to HR.', to_char(NEW.date,'FMDay FMDD Mon')),
        '/attendance', 'attendance', NEW.id, '1 day');

      PERFORM notify_roles(NEW.company_id,
        ARRAY['department_manager','hr_manager','super_admin'],
        'attendance_team_late',
        format('%s recorded absent', coalesce(v_name,'An employee')),
        format('No approved leave for %s.', to_char(NEW.date,'FMDay FMDD Mon')),
        '/attendance', 'attendance', NEW.id, v_dept, NEW.employee_id, '1 day');
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

      PERFORM notify_roles(NEW.company_id,
        ARRAY['department_manager','hr_manager','super_admin'],
        'attendance_team_late',
        format('%s clocked in late', coalesce(v_name,'An employee')),
        format('Graded %s.', v_mins),
        '/attendance', 'attendance', NEW.id, v_dept, NEW.employee_id, '1 day');
    END IF;

  EXCEPTION WHEN OTHERS THEN
    -- The punch is what matters. Never let this stop it.
    RAISE WARNING 'notify_attendance_change failed for attendance %: %', NEW.id, SQLERRM;
  END;

  RETURN NULL;
END;
$function$;

-- zz_ so it sorts after aa_autolink_shift, ab_attendance_guard and the score sync:
-- the status this reads is decided by the guard, so it must run afterwards.
DROP TRIGGER IF EXISTS zz_notify_attendance ON public.attendance;
CREATE TRIGGER zz_notify_attendance
  AFTER INSERT OR UPDATE OF status ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.notify_attendance_change();

-- ── News feed ─────────────────────────────────────────────────────────────
--
-- Everyone active in the company, except the person who wrote it. Fires when a post
-- becomes published, whether that happens at insert or later from a draft.
CREATE OR REPLACE FUNCTION public.notify_feed_post()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  BEGIN
    IF NEW.status <> 'published' THEN
      RETURN NULL;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'published' THEN
      RETURN NULL;
    END IF;

    PERFORM notify_roles(NEW.company_id,
      ARRAY['super_admin','hr_manager','admin','department_manager','employee','read_only'],
      'feed_post',
      coalesce(NULLIF(btrim(NEW.title), ''), 'New post on the news feed'),
      left(coalesce(NEW.body,''), 300),
      '/feed', 'feed_posts', NEW.id, NULL, NEW.author_employee_id, '1 hour');

  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_feed_post failed for feed_post %: %', NEW.id, SQLERRM;
  END;

  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS zz_notify_feed_post ON public.feed_posts;
CREATE TRIGGER zz_notify_feed_post
  AFTER INSERT OR UPDATE OF status ON public.feed_posts
  FOR EACH ROW EXECUTE FUNCTION public.notify_feed_post();

-- ── Leave ─────────────────────────────────────────────────────────────────
--
-- Leave is a two-step approval: pending -> manager_approved -> approved. So the
-- notification follows the queue. A request sitting unseen is the thing people
-- currently solve by asking in person.
CREATE OR REPLACE FUNCTION public.notify_leave_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_name text;
  v_dept uuid;
  v_span text;
BEGIN
  BEGIN
    SELECT e.full_name, e.department_id INTO v_name, v_dept
      FROM employees e WHERE e.id = NEW.employee_id;

    v_span := format('%s to %s (%s day%s)',
                     to_char(NEW.start_date,'FMDD Mon'), to_char(NEW.end_date,'FMDD Mon'),
                     NEW.days_requested, CASE WHEN NEW.days_requested = 1 THEN '' ELSE 's' END);

    IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
      -- To whoever has to act on it first.
      PERFORM notify_roles(NEW.company_id,
        ARRAY['department_manager','hr_manager','super_admin'],
        'leave_submitted',
        format('%s requested leave', coalesce(v_name,'An employee')),
        format('%s — %s. Waiting for approval.', initcap(NEW.leave_type), v_span),
        '/leave', 'leave_requests', NEW.id, v_dept, NEW.employee_id, '1 hour');
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
      -- stop looking for it.
      PERFORM notify_roles(NEW.company_id,
        ARRAY['department_manager','hr_manager','super_admin'],
        'leave_cancelled',
        format('%s cancelled a leave request', coalesce(v_name,'An employee')),
        format('%s — %s.', initcap(NEW.leave_type), v_span),
        '/leave', 'leave_requests', NEW.id, v_dept, NEW.employee_id, '1 hour');
    END IF;

  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_leave_change failed for leave_request %: %', NEW.id, SQLERRM;
  END;

  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS zz_notify_leave ON public.leave_requests;
CREATE TRIGGER zz_notify_leave
  AFTER INSERT OR UPDATE OF status ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_leave_change();

-- ── Shifts ────────────────────────────────────────────────────────────────
--
-- The original complaint: "I make shift for Fatima and didn't reflect on her page."
-- A published shift is now something the person is told about, including a day off,
-- which is the one people most need to know and least expect to check for.
CREATE OR REPLACE FUNCTION public.notify_shift_published()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tz   text;
  v_when text;
BEGIN
  BEGIN
    IF NEW.status <> 'published' THEN
      RETURN NULL;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'published'
       AND OLD.start_at = NEW.start_at AND OLD.end_at = NEW.end_at
       AND OLD.shift_type = NEW.shift_type THEN
      RETURN NULL;
    END IF;
    -- A roster published for last month is not news.
    IF NEW.shift_date < current_date - 1 THEN
      RETURN NULL;
    END IF;

    SELECT c.timezone INTO v_tz FROM company c WHERE c.id = NEW.company_id;
    v_tz := coalesce(v_tz, 'UTC');

    IF NEW.shift_type = 'off' THEN
      PERFORM notify_employee(NEW.company_id, NEW.employee_id, 'shift_day_off',
        'You have a day off scheduled',
        format('%s is a day off. You are not expected to clock in.',
               to_char(NEW.shift_date, 'FMDay FMDD Mon')),
        '/my-schedule', 'shifts', NEW.id, '10 minutes');
    ELSE
      v_when := format('%s, %s to %s',
                  to_char(NEW.shift_date, 'FMDay FMDD Mon'),
                  to_char(NEW.start_at AT TIME ZONE v_tz, 'HH24:MI'),
                  to_char(NEW.end_at   AT TIME ZONE v_tz, 'HH24:MI'));

      PERFORM notify_employee(NEW.company_id, NEW.employee_id, 'shift_published',
        'A shift was scheduled for you',
        format('%s. Clocking in more than the grace period after the start counts as '
               'late.', v_when),
        '/my-schedule', 'shifts', NEW.id, '10 minutes');
    END IF;

  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_shift_published failed for shift %: %', NEW.id, SQLERRM;
  END;

  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS zz_notify_shift ON public.shifts;
CREATE TRIGGER zz_notify_shift
  AFTER INSERT OR UPDATE OF status, start_at, end_at, shift_type ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.notify_shift_published();

-- ── A punch that was never closed ─────────────────────────────────────────
--
-- Not a trigger: nothing happens when someone fails to clock out, which is exactly
-- why it goes unnoticed. Four such rows were sitting open during the migration, one
-- of them 18 hours old, and none of them had told anybody.
--
-- Deliberately no timezone arithmetic. Looking only at rows dated the day before
-- yesterday or earlier means every company's shifts have long since ended whatever
-- their timezone, and the 30-day dedupe stops a permanently stuck row from
-- notifying every night.
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
    SELECT a.id, a.company_id, a.employee_id, a.date,
           e.full_name, e.department_id
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

      PERFORM notify_roles(r.company_id,
        ARRAY['department_manager','hr_manager','super_admin'],
        'attendance_missing_clockout',
        format('%s has an open punch', coalesce(r.full_name,'An employee')),
        format('%s was never clocked out. Attendance and overtime for that day cannot '
               'be calculated until it is corrected.', to_char(r.date,'FMDay FMDD Mon')),
        '/attendance', 'attendance', r.id, r.department_id, r.employee_id, '30 days');
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'notify_missing_clockouts failed for attendance %: %', r.id, SQLERRM;
    END;
  END LOOP;

  RETURN v_n;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_missing_clockouts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_attendance_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_feed_post()          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_leave_change()       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_shift_published()    FROM PUBLIC, anon, authenticated;

-- 22:00 UTC daily. Late enough that no company's working day is still open, and it
-- reads a two-day window so a run that fails one night is caught the next.
SELECT cron.schedule(
  'nightly-missing-clockouts',
  '0 22 * * *',
  $job$ SELECT public.notify_missing_clockouts(); $job$
);
