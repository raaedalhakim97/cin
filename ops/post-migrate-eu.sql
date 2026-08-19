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
--    app over.
--
--    Read from eu-central-1 after migration 16, on 19 August 2026:
--
--      rls policies 115   functions 66   tables 37
--      auth users     8   employees 16   companies 2   cron jobs 2
--
--    Those structural numbers moved with migrations 16 and 17, which added the
--    notifications table, its two policies, and nine functions. Two cron jobs now:
--    the monthly KPI run and the nightly open-punch sweep. If you are verifying
--    a restore of a dump taken BEFORE that migration, expect 113 / 57 / 36 instead —
--    the numbers describe the schema, so they change whenever the schema does.
--
--    Row counts move as the product is used, so treat those two as "the same as
--    the old project right now", not as fixed numbers. The structural three —
--    policies, functions, tables — must match exactly. A restore that drops a
--    policy leaves a table readable by the wrong tenant, and nothing about the
--    app looks broken.
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
  AND NOT (table_name = 'demo_requests' AND privilege_type = 'INSERT')
UNION ALL
-- Migration 14 revoked these so the audit trail is append-only-by-trigger. A
-- restore re-creates the table, and default privileges can hand them straight
-- back — at which point any signed-in user can write or delete entries in the
-- record of what happened, which is the one table that has to be trustworthy.
SELECT 'audit_logs write grants for anon/authenticated (must be 0)',
       count(*)::text
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'audit_logs'
  AND grantee IN ('anon', 'authenticated')
  AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
UNION ALL
-- Migration 15: read_only must still be able to finish its own clock-out and
-- cancel its own pending leave. If a restore brings back an older policy body,
-- the button works and the update silently touches zero rows.
SELECT 'self-service policies excluding read_only (must be 0)',
       count(*)::text
FROM pg_policies
WHERE schemaname = 'public'
  AND policyname IN ('att_self_update', 'leave_self_update')
  AND qual LIKE '%read_only%'
UNION ALL
-- Migration 16: notifications are written only by notify_employee, which is SECURITY
-- DEFINER. With INSERT a signed-in user could manufacture a notification that appears
-- to come from HR, and with DELETE they could remove one they had been sent.
SELECT 'notifications write grants for anon/authenticated (must be 0)',
       count(*)::text
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'notifications'
  AND grantee IN ('anon', 'authenticated')
  AND privilege_type IN ('INSERT', 'DELETE')
UNION ALL
SELECT 'notify_employee reachable by anon/authenticated (must be 0)',
       count(*)::text
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('notify_employee', 'notifications_only_read_at_is_editable')
  AND (has_function_privilege('anon', p.oid, 'EXECUTE')
    OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));

-- 5. Then run the full guarantee suite against this project. It is the real
--    verification — 43 assertions covering tenant isolation, attendance
--    integrity, the audit trail and the geofence — and it rolls back everything
--    it writes, so it is safe to run here:
--
--      psql -v ON_ERROR_STOP=1 "$NEW_DB_URL" -f supabase/tests/guarantees.sql
--
--    Assertion 22 ("monthly rules job scheduled and active") is the one that
--    fails if step 2 above was skipped, which is exactly the silent failure this
--    file exists to prevent.
