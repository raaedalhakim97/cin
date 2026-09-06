-- Finding 4. The performance system never tells anybody anything.
--
-- Measured on production: the 2026 Q4 cycle has been open at self_review since 5 September
-- with twelve reviews in it and zero of them rated. Not because anyone refused — because no
-- employee has been told a self-assessment exists. There is no notification anywhere in the
-- review workflow: not when a cycle opens, not when it moves to manager review, not when it
-- is published and a person's score is finally visible to them.
--
-- The second half of the finding is quieter and slightly embarrassing: the deadline is
-- already built. kpi_review_cycles has self_due and manager_due, open_kpi_review_cycle takes
-- both as parameters, and SelfReviewCard and ManagerReviewTab both render "Due 15 October"
-- when they are set. Nothing has ever set them. The screen that opens a cycle sends only the
-- year and the quarter, so both columns are NULL on every cycle that exists, and the
-- deadline the UI was built to show has never once been shown. Fixed on the client side in
-- the same commit as this migration.
--
-- ── Why this is the same bug as finding 5 ──────────────────────────────────
--
-- Migration 54 fixed a leave request that waited because the approver was never told. This
-- is that shape again, one department over: an obligation the system knows about, held by a
-- person the system can name, who is never informed. Both are invisible in code review —
-- every function returns successfully — and both are obvious the moment you look at what
-- the data is doing. Twelve reviews, zero rated, is the same evidence as four open punches
-- that had told nobody.
--
-- ── The trigger is deferred, and that is deliberate ────────────────────────
--
-- open_kpi_review_cycle inserts the cycle first and the twelve reviews second. A normal
-- AFTER INSERT trigger on kpi_review_cycles therefore runs when the cycle has no reviews
-- yet, looks around at an empty table and notifies nobody — a bug that would have looked
-- exactly like this one. A DEFERRABLE INITIALLY DEFERRED constraint trigger runs at commit
-- instead, when the seeding is finished, and the same reasoning covers the publish step:
-- advance_kpi_review_cycle writes every final_score before it moves the cycle, and the
-- notification wants those scores.
--
-- ── Who hears what ─────────────────────────────────────────────────────────
--
--   self_review     every employee with a review    "your self-assessment is open"
--   manager_review  each manager, with a count      "4 reviews waiting for you"
--                   HR and the owner, with a total
--   published       every employee with a review    their score, or why there isn't one
--
-- Nothing fires when an individual employee submits their self-assessment. The manager
-- cannot act on it yet — kpi_review_line_stage_guard refuses manager scores until the cycle
-- reaches manager_review — so a notification then would be twelve interruptions about work
-- that cannot be started. Their cue is the stage change, which is when it becomes true.

-- ── The kinds have to be allowed before they can be sent ───────────────────
--
-- notifications.kind is a CHECK constraint, and every notify function swallows its own
-- exceptions so that a failed notification never breaks the punch or the leave request it
-- was reporting on. Those two facts together mean a kind missing from this list does not
-- error — it silently sends nothing, forever. Guarantee 114 exists because of that.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_check CHECK (
  kind = ANY (ARRAY[
    'attendance_late', 'attendance_absent', 'attendance_missing_clockout',
    'attendance_team_late', 'feed_post',
    'leave_submitted', 'leave_manager_approved', 'leave_approved',
    'leave_rejected', 'leave_cancelled',
    'shift_published', 'shift_day_off',
    'review_self_open', 'review_self_due', 'review_manager_open',
    'review_manager_due', 'review_published'
  ])
);

-- ── The lifecycle ──────────────────────────────────────────────────────────
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
BEGIN
  BEGIN
    IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
      RETURN NULL;
    END IF;

    v_period := format('%s Q%s', NEW.period_year, NEW.period_quarter);

    IF NEW.status = 'self_review' THEN
      FOR r IN SELECT rv.employee_id FROM kpi_reviews rv WHERE rv.cycle_id = NEW.id LOOP
        PERFORM notify_employee(NEW.company_id, r.employee_id, 'review_self_open',
          format('Your %s self-assessment is open', v_period),
          CASE WHEN NEW.self_due IS NOT NULL
               THEN format('Score yourself against each criterion and say why. Due %s.',
                           to_char(NEW.self_due, 'FMDD Mon'))
               ELSE 'Score yourself against each criterion and say why.'
          END,
          '/kpi', 'kpi_review_cycles', NEW.id, '1 day');
      END LOOP;

    ELSIF NEW.status = 'manager_review' THEN
      -- One notification per manager, carrying how many people they are responsible for
      -- in this cycle. manager_covers is the same predicate the write policy uses, so the
      -- count is exactly the number of rows they will be able to score.
      FOR r IN
        SELECT mgr.id AS mgr_emp, count(*) AS n
          FROM kpi_reviews rv
          JOIN employees mgr
            ON mgr.company_id = NEW.company_id
           AND mgr.status = 'active'
           AND mgr.user_id IS NOT NULL
          JOIN user_roles ur ON ur.user_id = mgr.user_id AND ur.role = 'department_manager'
         WHERE rv.cycle_id = NEW.id
           AND public.manager_covers(mgr.id, rv.employee_id)
         GROUP BY mgr.id
      LOOP
        PERFORM notify_employee(NEW.company_id, r.mgr_emp, 'review_manager_open',
          format('%s: %s review%s waiting for you',
                 v_period, r.n, CASE WHEN r.n = 1 THEN '' ELSE 's' END),
          CASE WHEN NEW.manager_due IS NOT NULL
               THEN format('Self-assessments are closed and yours are open. Due %s.',
                           to_char(NEW.manager_due, 'FMDD Mon'))
               ELSE 'Self-assessments are closed and yours are open.'
          END,
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
               -- Saying "no rating" plainly beats showing a number that was never earned.
               -- kpi_rating_label is withheld below 50 percent coverage for that reason,
               -- and an employee is owed the reason rather than a blank.
               ELSE format('Not enough of this quarter was assessed to give a rating '
                           '(%s%% covered). Your manager or HR can say what is missing.',
                           coalesce(r.coverage_pct, 0))
          END,
          '/kpi', 'kpi_review_cycles', NEW.id, '1 day');
      END LOOP;
    END IF;

  EXCEPTION WHEN OTHERS THEN
    -- The cycle transition is what matters. Never let this stop it.
    RAISE WARNING 'notify_review_cycle_change failed for cycle %: %', NEW.id, SQLERRM;
  END;

  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS zz_notify_review_cycle ON public.kpi_review_cycles;
CREATE CONSTRAINT TRIGGER zz_notify_review_cycle
  AFTER INSERT OR UPDATE OF status ON public.kpi_review_cycles
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.notify_review_cycle_change();

-- ── The deadline that was never shown ──────────────────────────────────────
--
-- Runs nightly. A reminder is only sent to somebody who still has the thing open, and only
-- once the due date is within two days — a deadline three weeks out is not news.
--
-- The dedupe window is 20 hours rather than a day so that a job running at the same clock
-- time every night is never suppressed by its own previous run. It also means somebody who
-- ignores the deadline is reminded once a day and not once an hour, which is the difference
-- between a reminder and a nag.
CREATE OR REPLACE FUNCTION public.notify_review_deadlines()
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
    SELECT c.id AS cycle_id, c.company_id, c.period_year, c.period_quarter, c.self_due,
           rv.employee_id
      FROM kpi_review_cycles c
      JOIN kpi_reviews rv ON rv.cycle_id = c.id
     WHERE c.status = 'self_review'
       AND c.self_due IS NOT NULL
       AND c.self_due <= current_date + 2
       AND rv.self_submitted_at IS NULL
  LOOP
    BEGIN
      IF notify_employee(r.company_id, r.employee_id, 'review_self_due',
           CASE WHEN r.self_due < current_date
                THEN format('Your %s Q%s self-assessment is overdue',
                            r.period_year, r.period_quarter)
                ELSE format('Your %s Q%s self-assessment is due %s',
                            r.period_year, r.period_quarter,
                            to_char(r.self_due, 'FMDD Mon'))
           END,
           'It takes a few minutes and it is the only part of your score you write '
           'yourself. If it closes empty, that weight is simply not counted.',
           '/kpi', 'kpi_review_cycles', r.cycle_id, '20 hours') IS NOT NULL THEN
        v_n := v_n + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'notify_review_deadlines (self) failed for cycle %: %', r.cycle_id, SQLERRM;
    END;
  END LOOP;

  FOR r IN
    SELECT c.id AS cycle_id, c.company_id, c.period_year, c.period_quarter, c.manager_due,
           mgr.id AS mgr_emp, count(*) AS n
      FROM kpi_review_cycles c
      JOIN kpi_reviews rv ON rv.cycle_id = c.id AND rv.manager_submitted_at IS NULL
      JOIN employees mgr
        ON mgr.company_id = c.company_id
       AND mgr.status = 'active'
       AND mgr.user_id IS NOT NULL
      JOIN user_roles ur ON ur.user_id = mgr.user_id AND ur.role = 'department_manager'
     WHERE c.status = 'manager_review'
       AND c.manager_due IS NOT NULL
       AND c.manager_due <= current_date + 2
       AND public.manager_covers(mgr.id, rv.employee_id)
     GROUP BY c.id, c.company_id, c.period_year, c.period_quarter, c.manager_due, mgr.id
  LOOP
    BEGIN
      IF notify_employee(r.company_id, r.mgr_emp, 'review_manager_due',
           CASE WHEN r.manager_due < current_date
                THEN format('%s Q%s: %s review%s overdue', r.period_year, r.period_quarter,
                            r.n, CASE WHEN r.n = 1 THEN ' is' ELSE 's are' END)
                ELSE format('%s Q%s: %s review%s due %s', r.period_year, r.period_quarter,
                            r.n, CASE WHEN r.n = 1 THEN ' is' ELSE 's are' END,
                            to_char(r.manager_due, 'FMDD Mon'))
           END,
           'A review left blank is not a neutral score — that weight drops out of the '
           'total, and the person is rated on less of their work than everyone else.',
           '/kpi', 'kpi_review_cycles', r.cycle_id, '20 hours') IS NOT NULL THEN
        v_n := v_n + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'notify_review_deadlines (manager) failed for cycle %: %', r.cycle_id, SQLERRM;
    END;
  END LOOP;

  RETURN v_n;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_review_cycle_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_review_deadlines()    FROM PUBLIC, anon, authenticated;

-- 04:00 UTC — eight in the morning in the Gulf, where the first customers are, and before
-- the working day starts in every other pack. The nightly clock-out job runs at 22:00 and
-- is about yesterday; this one is about today, so it belongs at the other end of the night.
SELECT cron.schedule(
  'daily-review-deadlines',
  '0 4 * * *',
  $job$ SELECT public.notify_review_deadlines(); $job$
);

-- ── Measured on production, each transition rolled back ────────────────────
--
-- Every path was run against the real cycles and then rolled back, because a notification
-- that fires for nobody looks identical in the code to one that fires for everybody.
--
--   self_review     8 employees told, of 12 reviews
--                   the other four have no login, so notify_employee refuses them —
--                   which is right: you cannot ask someone to fill in a form they
--                   have no way to open
--   manager_review  Omar, the Sales manager: "2026 Q4: 2 reviews waiting for you"
--                   Mariam and both owners: "12 reviews in this cycle"
--   published       all 8 with a login told; every one of them read
--                   "not enough of this quarter was assessed to give a rating"
--   self_due        8 reminders, "due 7 Sep"
--
-- The published line is worth reading twice. The Q3 cycle was published in August with
-- coverage between 0 and 30 percent, so not one person in the company has a rating for
-- last quarter. The 50 percent gate is doing its job — it refused to invent a number —
-- but nobody was ever told that either, which is the finding restating itself.

