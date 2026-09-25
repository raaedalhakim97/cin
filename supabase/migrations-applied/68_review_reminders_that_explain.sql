-- Quarterly review reminders that arrive at the right moments and explain the system.
--
-- Migration 56 made the review talk at all: a notification when each stage opens, and a
-- nightly reminder in the two days before a deadline. Three gaps remained:
--
--   1. Two days is too late to plan and too narrow to notice. A two-week window got one
--      nudge at the very end.
--   2. Nobody told HR when a stage was ready to move on. Every stage transition is a
--      button HR has to press, and the system knew when the moment had come — everyone
--      done, or the deadline passed — but kept it to itself.
--   3. Managers heard nothing until their own stage opened, so the first they knew of a
--      quarter's review was a list of people to score by Thursday.
--
-- ── The cadence ────────────────────────────────────────────────────────────
--
-- A person who still has something to do hears on these days, and only these:
--
--   stage opens · 7 days before · 3 days · 1 day · the day itself · 1 day after
--
-- One overdue notice, not a daily one: after that HR is told and it is theirs to chase.
-- With no deadline set, once a week while the stage is open. Each message carries a
-- different piece of how the review works, so someone who reads every reminder ends the
-- quarter understanding the whole thing — not reading the same sentence five times.
--
-- The dedupe windows stay just under a day for people (so the 04:00 job is never
-- suppressed by its own previous run) and just under three days for HR (so "ready to move
-- on" repeats every third day until acted on, rather than every morning).

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_check CHECK (
  kind = ANY (ARRAY[
    'attendance_late', 'attendance_absent', 'attendance_missing_clockout',
    'attendance_team_late', 'feed_post',
    'leave_submitted', 'leave_manager_approved', 'leave_approved',
    'leave_rejected', 'leave_cancelled',
    'shift_published', 'shift_day_off',
    'review_self_open', 'review_self_due', 'review_manager_open',
    'review_manager_due', 'review_published',
    'review_team_heads_up',
    'review_hr_self_ready', 'review_hr_manager_ready', 'review_hr_publish_ready'
  ])
);

-- ── Stage changes: say what the step is, not only that it exists ───────────
CREATE OR REPLACE FUNCTION public.notify_review_cycle_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r        record;
  v_period text;
  v_total  integer;
  v_w_self integer;
  v_w_mgr  integer;
BEGIN
  BEGIN
    IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
      RETURN NULL;
    END IF;

    v_period := format('%s Q%s', NEW.period_year, NEW.period_quarter);
    SELECT COALESCE(s.weight_self, 10),
           COALESCE(s.weight_behavior, 25) + COALESCE(s.weight_achievement, 20) + COALESCE(s.weight_manager, 15)
      INTO v_w_self, v_w_mgr
      FROM kpi_settings s WHERE s.company_id = NEW.company_id;
    v_w_self := COALESCE(v_w_self, 10);
    v_w_mgr  := COALESCE(v_w_mgr, 60);

    IF NEW.status = 'self_review' THEN
      FOR r IN SELECT rv.employee_id FROM kpi_reviews rv WHERE rv.cycle_id = NEW.id LOOP
        PERFORM notify_employee(NEW.company_id, r.employee_id, 'review_self_open',
          format('Your %s self-assessment is open', v_period),
          format('Give your quarter one score out of 100. It counts for %s%% of your result, '
                 'and you submit it once — then it locks until next quarter.%s',
                 v_w_self,
                 CASE WHEN NEW.self_due IS NOT NULL
                      THEN format(' Due %s.', to_char(NEW.self_due, 'FMDD Mon')) ELSE '' END),
          '/kpi', 'kpi_review_cycles', NEW.id, '1 day');
      END LOOP;

      -- Managers hear at the start too, so their own stage is not a surprise.
      FOR r IN
        SELECT mgr.id AS mgr_emp, count(*) AS n
          FROM kpi_reviews rv
          JOIN employees mgr
            ON mgr.company_id = NEW.company_id AND mgr.status = 'active' AND mgr.user_id IS NOT NULL
          JOIN user_roles ur ON ur.user_id = mgr.user_id AND ur.role = 'department_manager'
         WHERE rv.cycle_id = NEW.id
           AND public.manager_covers(mgr.id, rv.employee_id)
         GROUP BY mgr.id
      LOOP
        PERFORM notify_employee(NEW.company_id, r.mgr_emp, 'review_team_heads_up',
          format('%s review has started for your team', v_period),
          format('Your %s team member%s rate themselves first%s. Then it''s your turn: behavior, '
                 'achievement and an overall score — %s%% of each person''s result.',
                 r.n, CASE WHEN r.n = 1 THEN '' ELSE 's' END,
                 CASE WHEN NEW.self_due IS NOT NULL
                      THEN format(', until %s', to_char(NEW.self_due, 'FMDD Mon')) ELSE '' END,
                 v_w_mgr),
          '/kpi', 'kpi_review_cycles', NEW.id, '1 day');
      END LOOP;

    ELSIF NEW.status = 'manager_review' THEN
      FOR r IN
        SELECT mgr.id AS mgr_emp, count(*) AS n
          FROM kpi_reviews rv
          JOIN employees mgr
            ON mgr.company_id = NEW.company_id AND mgr.status = 'active' AND mgr.user_id IS NOT NULL
          JOIN user_roles ur ON ur.user_id = mgr.user_id AND ur.role = 'department_manager'
         WHERE rv.cycle_id = NEW.id
           AND public.manager_covers(mgr.id, rv.employee_id)
         GROUP BY mgr.id
      LOOP
        PERFORM notify_employee(NEW.company_id, r.mgr_emp, 'review_manager_open',
          format('%s: %s review%s waiting for you',
                 v_period, r.n, CASE WHEN r.n = 1 THEN '' ELSE 's' END),
          format('Self-assessments are closed. Rate each person on behavior, achievement and '
                 'overall — you''ll see what they said about themselves, but you can''t change it.%s',
                 CASE WHEN NEW.manager_due IS NOT NULL
                      THEN format(' Due %s.', to_char(NEW.manager_due, 'FMDD Mon')) ELSE '' END),
          '/kpi', 'kpi_review_cycles', NEW.id, '1 day');
      END LOOP;

      SELECT count(*) INTO v_total FROM kpi_reviews rv WHERE rv.cycle_id = NEW.id;
      PERFORM notify_roles(
        p_company_id    => NEW.company_id,
        p_roles         => ARRAY['hr_manager','super_admin'],
        p_kind          => 'review_manager_open',
        p_title         => format('%s manager review is open', v_period),
        p_body          => format('%s review%s in this cycle. Anyone without a named '
                                  'manager is yours to score.',
                                  v_total, CASE WHEN v_total = 1 THEN '' ELSE 's' END),
        p_link          => '/kpi',
        p_subject_table => 'kpi_review_cycles',
        p_subject_id    => NEW.id,
        p_dedupe_window => '1 day');

    ELSIF NEW.status = 'published' THEN
      FOR r IN
        SELECT rv.employee_id, rv.final_score, rv.rating, rv.coverage_pct
          FROM kpi_reviews rv WHERE rv.cycle_id = NEW.id
      LOOP
        PERFORM notify_employee(NEW.company_id, r.employee_id, 'review_published',
          format('Your %s review is ready', v_period),
          CASE WHEN r.rating IS NOT NULL
               THEN format('%s out of 100 — %s. Open your scorecard to see how it was '
                           'made up.', r.final_score, r.rating)
               ELSE format('Not enough of this quarter was assessed to give a rating '
                           '(%s%% covered). Your manager or HR can say what is missing.',
                           coalesce(r.coverage_pct, 0))
          END,
          '/kpi', 'kpi_review_cycles', NEW.id, '1 day');
      END LOOP;
    END IF;

  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_review_cycle_change failed for cycle %: %', NEW.id, SQLERRM;
  END;

  RETURN NULL;
END;
$function$;

-- ── The nightly job ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_review_deadlines()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r      record;
  v_n    integer := 0;
  v_p    text;
  v_when text;
BEGIN
  -- 1. Employees who have not rated themselves.
  FOR r IN
    SELECT c.id AS cycle_id, c.company_id, c.period_year, c.period_quarter, c.self_due,
           rv.employee_id,
           c.self_due - current_date AS left_days,
           COALESCE(s.weight_self, 10) AS w_self
      FROM kpi_review_cycles c
      JOIN kpi_reviews rv ON rv.cycle_id = c.id
      LEFT JOIN kpi_settings s ON s.company_id = c.company_id
     WHERE c.status = 'self_review'
       AND rv.self_submitted_at IS NULL
       AND COALESCE(c.opened_at, c.created_at)::date < current_date   -- the open notice covers day one
       AND (   (c.self_due IS NOT NULL AND c.self_due - current_date IN (7, 3, 1, 0, -1))
            OR (c.self_due IS NULL AND (current_date - COALESCE(c.opened_at, c.created_at)::date) % 7 = 0))
  LOOP
    BEGIN
      v_p := format('%s Q%s', r.period_year, r.period_quarter);
      IF notify_employee(r.company_id, r.employee_id, 'review_self_due',
           CASE r.left_days
             WHEN 7  THEN format('One week left to rate yourself for %s', v_p)
             WHEN 3  THEN format('3 days left to rate yourself for %s', v_p)
             WHEN 1  THEN format('Your %s self-assessment is due tomorrow', v_p)
             WHEN 0  THEN format('Your %s self-assessment is due today', v_p)
             WHEN -1 THEN format('Your %s self-assessment is overdue', v_p)
             ELSE format('Your %s self-assessment is still open', v_p)
           END,
           CASE r.left_days
             WHEN 7  THEN format('One score out of 100 for your quarter. It counts for %s%% of your '
                                 'result, and you submit it once.', r.w_self)
             WHEN 3  THEN 'You go first so your own view is on record. Your manager rates you '
                          'afterwards and can''t change what you wrote.'
             WHEN 1  THEN format('If it closes empty, that %s%% isn''t counted — you''re scored on '
                                 'less of your quarter than everyone else.', r.w_self)
             WHEN 0  THEN 'It takes a couple of minutes: one score and an optional note for your manager.'
             WHEN -1 THEN 'HR hasn''t closed it yet, so you can still submit. This is the last reminder.'
             ELSE format('One score out of 100, submitted once. It counts for %s%% of your quarter.', r.w_self)
           END,
           '/kpi', 'kpi_review_cycles', r.cycle_id, '20 hours') IS NOT NULL THEN
        v_n := v_n + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'notify_review_deadlines (self) failed for cycle %: %', r.cycle_id, SQLERRM;
    END;
  END LOOP;

  -- 2. Managers, the day before their team's self-assessment closes: your turn is next.
  FOR r IN
    SELECT c.id AS cycle_id, c.company_id, c.period_year, c.period_quarter, c.self_due,
           mgr.id AS mgr_emp, count(*) AS n,
           count(*) FILTER (WHERE rv.self_submitted_at IS NOT NULL) AS done
      FROM kpi_review_cycles c
      JOIN kpi_reviews rv ON rv.cycle_id = c.id
      JOIN employees mgr
        ON mgr.company_id = c.company_id AND mgr.status = 'active' AND mgr.user_id IS NOT NULL
      JOIN user_roles ur ON ur.user_id = mgr.user_id AND ur.role = 'department_manager'
     WHERE c.status = 'self_review'
       AND c.self_due IS NOT NULL
       AND c.self_due - current_date = 1
       AND public.manager_covers(mgr.id, rv.employee_id)
     GROUP BY c.id, c.company_id, c.period_year, c.period_quarter, c.self_due, mgr.id
  LOOP
    BEGIN
      IF notify_employee(r.company_id, r.mgr_emp, 'review_team_heads_up',
           format('%s: your ratings open after tomorrow', format('%s Q%s', r.period_year, r.period_quarter)),
           format('%s of %s on your team have rated themselves. When self-assessment closes, '
                  'HR opens manager review and you''ll get a list of who to rate.', r.done, r.n),
           '/kpi', 'kpi_review_cycles', r.cycle_id, '20 hours') IS NOT NULL THEN
        v_n := v_n + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'notify_review_deadlines (heads-up) failed for cycle %: %', r.cycle_id, SQLERRM;
    END;
  END LOOP;

  -- 3. Managers with team reviews still to rate.
  FOR r IN
    SELECT c.id AS cycle_id, c.company_id, c.period_year, c.period_quarter, c.manager_due,
           mgr.id AS mgr_emp,
           c.manager_due - current_date AS left_days,
           count(*) AS n,
           count(*) FILTER (WHERE rv.manager_submitted_at IS NULL) AS pending
      FROM kpi_review_cycles c
      JOIN kpi_reviews rv ON rv.cycle_id = c.id
      JOIN employees mgr
        ON mgr.company_id = c.company_id AND mgr.status = 'active' AND mgr.user_id IS NOT NULL
      JOIN user_roles ur ON ur.user_id = mgr.user_id AND ur.role = 'department_manager'
     WHERE c.status = 'manager_review'
       AND c.updated_at::date < current_date                           -- the open notice covers day one
       AND (   (c.manager_due IS NOT NULL AND c.manager_due - current_date IN (7, 3, 1, 0, -1))
            OR (c.manager_due IS NULL AND (current_date - c.updated_at::date) % 7 = 0))
       AND public.manager_covers(mgr.id, rv.employee_id)
     GROUP BY c.id, c.company_id, c.period_year, c.period_quarter, c.manager_due, c.updated_at, mgr.id
    HAVING count(*) FILTER (WHERE rv.manager_submitted_at IS NULL) > 0
  LOOP
    BEGIN
      v_p := format('%s Q%s', r.period_year, r.period_quarter);
      v_when := CASE r.left_days
                  WHEN 7  THEN 'one week to go'
                  WHEN 3  THEN '3 days to go'
                  WHEN 1  THEN 'due tomorrow'
                  WHEN 0  THEN 'due today'
                  WHEN -1 THEN 'overdue'
                  ELSE 'still open' END;
      IF notify_employee(r.company_id, r.mgr_emp, 'review_manager_due',
           format('%s: %s of %s team review%s left, %s', v_p, r.pending, r.n,
                  CASE WHEN r.n = 1 THEN '' ELSE 's' END, v_when),
           CASE r.left_days
             WHEN 7  THEN 'Rate each person on behavior, achievement and overall. Their own '
                          'self-assessment is shown next to yours so you can see where you differ.'
             WHEN 3  THEN 'Where you and the employee are two levels apart, say why in the note. '
                          'That gap is the most useful thing a review can surface.'
             WHEN 1  THEN 'A review left blank isn''t a neutral score. That weight drops out, and '
                          'the person is rated on less of their work than everyone else.'
             WHEN 0  THEN 'Anything not rated today goes into the calculation empty.'
             WHEN -1 THEN 'HR is waiting on these to calculate the quarter. This is the last reminder.'
             ELSE 'Rate each person on behavior, achievement and overall in Team Review.'
           END,
           '/kpi', 'kpi_review_cycles', r.cycle_id, '20 hours') IS NOT NULL THEN
        v_n := v_n + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'notify_review_deadlines (manager) failed for cycle %: %', r.cycle_id, SQLERRM;
    END;
  END LOOP;

  -- 4. HR: a stage is ready to move on. Everyone who can be done is done, or the deadline
  --    has passed. People with no login cannot self-assess, so they do not hold it up.
  FOR r IN
    SELECT c.id AS cycle_id, c.company_id, c.period_year, c.period_quarter, c.status,
           c.self_due, c.manager_due, c.updated_at,
           count(*) AS total,
           count(*) FILTER (WHERE e.user_id IS NOT NULL AND e.status = 'active') AS can_self,
           count(*) FILTER (WHERE rv.self_submitted_at IS NOT NULL) AS self_done,
           count(*) FILTER (WHERE rv.manager_submitted_at IS NOT NULL) AS mgr_done
      FROM kpi_review_cycles c
      JOIN kpi_reviews rv ON rv.cycle_id = c.id
      JOIN employees e ON e.id = rv.employee_id
     WHERE c.status IN ('self_review', 'manager_review', 'calculated')
     GROUP BY c.id
  LOOP
    BEGIN
      v_p := format('%s Q%s', r.period_year, r.period_quarter);

      IF r.status = 'self_review'
         AND ((r.self_done >= r.can_self AND r.can_self > 0)
              OR (r.self_due IS NOT NULL AND r.self_due < current_date)) THEN
        v_n := v_n + notify_roles(
          p_company_id => r.company_id, p_roles => ARRAY['hr_manager','super_admin'],
          p_kind => 'review_hr_self_ready',
          p_title => CASE WHEN r.self_done >= r.can_self
                          THEN format('%s: everyone has self-assessed', v_p)
                          ELSE format('%s: the self-assessment deadline has passed', v_p) END,
          p_body => format('%s of %s submitted. Move the quarter to manager review in KPI → Review '
                           'Cycles when you''re ready; anyone who didn''t submit is scored without '
                           'the self part.%s',
                           r.self_done, r.can_self,
                           CASE WHEN r.total > r.can_self
                                THEN format(' %s %s no login, so couldn''t self-assess.',
                                            r.total - r.can_self,
                                            CASE WHEN r.total - r.can_self = 1 THEN 'has' ELSE 'have' END)
                                ELSE '' END),
          p_link => '/kpi', p_subject_table => 'kpi_review_cycles', p_subject_id => r.cycle_id,
          p_dedupe_window => '2 days 20 hours');

      ELSIF r.status = 'manager_review'
         AND ((r.mgr_done >= r.total AND r.total > 0)
              OR (r.manager_due IS NOT NULL AND r.manager_due < current_date)) THEN
        v_n := v_n + notify_roles(
          p_company_id => r.company_id, p_roles => ARRAY['hr_manager','super_admin'],
          p_kind => 'review_hr_manager_ready',
          p_title => CASE WHEN r.mgr_done >= r.total
                          THEN format('%s: every manager review is in', v_p)
                          ELSE format('%s: the manager review deadline has passed', v_p) END,
          p_body => format('%s of %s rated. Calculate the scores in KPI → Review Cycles. Nobody sees '
                           'them until you publish, and anyone with too little rated gets no rating '
                           'rather than a guessed one.', r.mgr_done, r.total),
          p_link => '/kpi', p_subject_table => 'kpi_review_cycles', p_subject_id => r.cycle_id,
          p_dedupe_window => '2 days 20 hours');

      ELSIF r.status = 'calculated' AND r.updated_at < now() - interval '1 day' THEN
        v_n := v_n + notify_roles(
          p_company_id => r.company_id, p_roles => ARRAY['hr_manager','super_admin'],
          p_kind => 'review_hr_publish_ready',
          p_title => format('%s scores are waiting to be published', v_p),
          p_body => 'They''re calculated, but employees can''t see them yet. Check them and publish '
                    '— each person is notified with their result.',
          p_link => '/kpi', p_subject_table => 'kpi_review_cycles', p_subject_id => r.cycle_id,
          p_dedupe_window => '2 days 20 hours');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'notify_review_deadlines (hr) failed for cycle %: %', r.cycle_id, SQLERRM;
    END;
  END LOOP;

  RETURN v_n;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_review_cycle_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_review_deadlines()    FROM PUBLIC, anon, authenticated;
