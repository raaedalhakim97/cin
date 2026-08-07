-- Run against the NEW Frankfurt project after ops/migrate-to-eu.sh finishes.
--
-- A database dump carries schemas, tables, data, policies, functions and
-- triggers. It does not carry the pg_cron schedule: `cron.job` lives in the
-- cron schema, which the dump excludes. Restore the database without this and
-- everything looks correct — the rules engine is present, callable and
-- healthy — while the monthly run that is supposed to invoke it silently never
-- happens. Nobody notices until a month of awards and warnings is missing.
--
-- Captured from ap-south-1 before the move:
--   jobid 1  schedule "0 2 1 * *"  jobname "monthly-kpi-rules"  active true

-- 1. pg_cron must exist before a job can be scheduled. On Supabase it installs
--    into pg_catalog rather than a schema of its own.
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. Recreate the schedule. cron.schedule() upserts on job name, so re-running
--    this file does not stack duplicate jobs.
--
--    02:00 on the 1st, evaluating the month that just ended. The *_all_companies
--    variant is the one to call from cron: the plain evaluate_kpi_rules() reads
--    the caller's company from their JWT, and cron has no JWT, so it raised
--    "Not authenticated" and did nothing.
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

-- 3. Verification. Compare these against the old project before switching the
--    app over. Expected at time of capture: 104 policies, 44 functions,
--    32 tables, 8 auth users, 16 employees, 1 cron job.
SELECT 'cron jobs'    AS item, count(*)::text AS value FROM cron.job
UNION ALL SELECT 'rls policies', count(*)::text FROM pg_policies WHERE schemaname = 'public'
UNION ALL SELECT 'functions',    count(*)::text FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
UNION ALL SELECT 'tables',       count(*)::text FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
UNION ALL SELECT 'auth users',   count(*)::text FROM auth.users
UNION ALL SELECT 'employees',    count(*)::text FROM employees
UNION ALL SELECT 'companies',    count(*)::text FROM company;

-- 4. The grants from migration 09 are the ones most likely to be quietly lost,
--    because a restore re-creates tables and default privileges can put them
--    back. Both counts must be 0.
SELECT 'anon/authenticated TRUNCATE grants (must be 0)' AS check,
       count(*)::text AS value
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated')
  AND privilege_type IN ('TRUNCATE', 'TRIGGER', 'REFERENCES')
UNION ALL
SELECT 'anon table grants beyond demo_requests INSERT (must be 0)',
       count(*)::text
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee = 'anon'
  AND NOT (table_name = 'demo_requests' AND privilege_type = 'INSERT');
