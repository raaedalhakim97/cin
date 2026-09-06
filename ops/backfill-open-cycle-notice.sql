-- One-off. Tells the people in an already-open review cycle that it is open.
--
-- Migration 56 makes the notification fire when a cycle changes stage. A cycle that was
-- opened before that migration never had a stage change to fire on, so its people were
-- never told and never will be — the trigger has nothing left to react to. The 2026 Q4
-- cycle on production is exactly this: opened 5 September, twelve reviews, zero rated,
-- nobody informed.
--
-- Rather than shove the cycle backwards to 'draft' and forwards again to make the trigger
-- fire — which would write a false stage history and briefly close the cycle to the people
-- using it — this sends the same notification directly. The text is copied from
-- notify_review_cycle_change deliberately, so a person who was told by the backfill and a
-- person who was told by the trigger read the same sentence.
--
-- ── How to run ─────────────────────────────────────────────────────────────
--
--   psql "$PGURL" -v cycle="'<cycle-uuid>'" -f ops/backfill-open-cycle-notice.sql
--
-- Safe to re-run: notify_employee dedupes on (employee, kind, subject) within the window,
-- so a second run inside a day sends nothing. It also refuses anyone with no login or a
-- terminated record, which is why the count comes back lower than the number of reviews.
--
-- Not needed for any cycle opened after migration 56. This file stays in the repo as the
-- record of a one-off correction, not as part of the workflow.

BEGIN;

DO $$
DECLARE
  c   record;
  r   record;
  v_n integer := 0;
BEGIN
  SELECT * INTO c FROM kpi_review_cycles WHERE id = :cycle;

  IF c.id IS NULL THEN
    RAISE EXCEPTION 'No such review cycle';
  END IF;
  IF c.status <> 'self_review' THEN
    RAISE EXCEPTION 'Cycle is at %, not self_review — this script only covers the opening notice', c.status;
  END IF;

  FOR r IN SELECT rv.employee_id FROM kpi_reviews rv WHERE rv.cycle_id = c.id LOOP
    IF notify_employee(c.company_id, r.employee_id, 'review_self_open',
         format('Your %s Q%s self-assessment is open', c.period_year, c.period_quarter),
         CASE WHEN c.self_due IS NOT NULL
              THEN format('Score yourself against each criterion and say why. Due %s.',
                          to_char(c.self_due, 'FMDD Mon'))
              ELSE 'Score yourself against each criterion and say why.'
         END,
         '/kpi', 'kpi_review_cycles', c.id, '1 day') IS NOT NULL THEN
      v_n := v_n + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'told % of % people', v_n,
    (SELECT count(*) FROM kpi_reviews WHERE cycle_id = c.id);
END $$;

COMMIT;
