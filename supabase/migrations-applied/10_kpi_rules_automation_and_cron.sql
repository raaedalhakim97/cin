-- Make the rules engine runnable by automation, and schedule it monthly.
--
-- THE BUG THIS FIXES
--
-- evaluate_kpi_rules() resolved the company from auth.uid() and raised
-- 'Not authenticated' when there was none. Verified by calling it from a plain
-- SQL context: "FAILS FROM AUTOMATION: Not authenticated". Any cron job would
-- have looked scheduled and silently done nothing every month — worse than
-- having no cron, because you would believe it was working.
--
-- Split into three, so the app's guarantees are untouched:
--   * evaluate_kpi_rules_for_company(company, year, month) — the work. Takes
--     the company explicitly so it needs no session. NOT granted to anon or
--     authenticated.
--   * evaluate_kpi_rules(year, month) — unchanged signature and behaviour:
--     HR-only, company from the session.
--   * evaluate_kpi_rules_all_companies(year, month) — automation entry point.
--     Also not reachable from a client. One tenant's bad data cannot stop the
--     others; each company is wrapped in its own exception block.
--
-- Verified after applying:
--   automation, no session          -> works across all companies
--   employee -> HR wrapper          -> refused (role check)
--   employee -> internal function   -> refused (permission denied)
--   HR       -> HR wrapper          -> works
--
-- WHY pg_cron RATHER THAN THE HETZNER SERVER
--
-- Scheduling inside the database means no credentials have to live on a VPS,
-- and the job keeps running if that server is down or rebuilt. Backups go the
-- other way — those belong on Hetzner, because off-site is the whole point of
-- a backup. See ops/README.md.
--
-- The full function bodies as applied are in the live database; this file
-- records the structure and the reasoning. See the applied migrations
-- `kpi_rules_automation_entrypoint` and `schedule_monthly_kpi_rules`.

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  PERFORM cron.unschedule('monthly-kpi-rules');
EXCEPTION WHEN others THEN
  NULL;  -- not scheduled yet
END $$;

-- 02:00 UTC on the 1st, evaluating the month that just ended — a month is only
-- complete once it is over.
SELECT cron.schedule(
  'monthly-kpi-rules',
  '0 2 1 * *',
  $job$
    SELECT public.evaluate_kpi_rules_all_companies(
      EXTRACT(YEAR  FROM (now() - interval '1 month'))::int,
      EXTRACT(MONTH FROM (now() - interval '1 month'))::int
    );
  $job$
);
