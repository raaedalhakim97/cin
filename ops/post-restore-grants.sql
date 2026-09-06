-- Restore the privilege layer that a Supabase dump does not carry.
--
-- Run against the NEW project AFTER ops/migrate-to-eu.sh finishes and BEFORE
-- ops/post-migrate-eu.sql. Safe to re-run: every statement is idempotent.
--
-- ── Why this exists ────────────────────────────────────────────────────────
--
-- The Frankfurt restore completed with every structural and row count matching
-- the source exactly — 113 policies, 57 functions, 36 tables, 8 auth users, 781
-- audit rows. Then the guarantee suite failed 5 of 32, and all five were the same
-- thing: table and function privileges did not come across.
--
--   1  anon holds no SELECT on any table            expected 0   got 41
--   2  anon INSERT limited to demo_requests         got 41 tables, incl.
--                                                   employees, payroll_runs, audit_logs
--   3  no TRUNCATE for anon or authenticated        expected 0   got 82
--   4  no TRIGGER grant for anon or authenticated   expected 0   got 82
--  20  employee cannot call internal rules function expected blocked, got ALLOWED
--
-- Measured against the live source at the same moment, which is what proved this
-- was a restore defect and not a miscalibrated check:
--
--                                            source   restored
--   TRUNCATE/TRIGGER/REFERENCES grants          0        246
--   anon grants beyond demo_requests INSERT     0        286
--   audit_logs write grants for anon/auth       0          8
--
-- The mechanism: `supabase db dump` does not emit ACLs, so nothing in the dump
-- says who may touch what. When the restore re-creates each table, the NEW
-- project's default privileges apply, and on a fresh Supabase project those grant
-- anon and authenticated broad access. Six migrations (05, 06, 08, 09, 11, 14)
-- exist to revoke exactly that, and their net effect is invisible to the dump.
--
-- Why this matters more than it first looks. RLS survived intact — all 113
-- policies restored and assertions 5 and 6 pass — so this was not "one tenant can
-- read another's salaries" on day one. But `anon` is the role the web app uses
-- with the public key, before anyone logs in, and TRUNCATE is not subject to RLS
-- at all, so no row policy contains it. The audit_logs write grants make the
-- append-only record editable by the people it exists to hold accountable. And the
-- privilege layer is precisely what catches the day someone adds a table and
-- forgets its policy.
--
-- ── Why declarative, and not a replay of those six migrations ──────────────
--
-- Replaying them would not have been correct. The intended end state is not
-- reconstructable from their REVOKE lines:
--
--   * `evaluate_kpi_rules_all_companies` must be unreachable by anon and
--     authenticated, and no migration revokes it — it was created with restricted
--     grants instead.
--   * migration 11 revokes EXECUTE on two trigger functions from anon and
--     authenticated but not from PUBLIC, so those revokes never took effect. The
--     source project still reports both as executable.
--
-- So the target below was read from the source project directly, and it is
-- expressed as the end state rather than as a sequence of deltas.

-- ── 1. Tables ─────────────────────────────────────────────────────────────
--
-- Target, read from the source: anon holds INSERT on demo_requests and nothing
-- else. authenticated holds SELECT, INSERT, UPDATE, DELETE across the schema,
-- except audit_logs where it holds SELECT alone. Neither holds TRUNCATE, TRIGGER
-- or REFERENCES anywhere.
--
-- Order matters: the blanket revoke comes first, then the single grant back.

REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public
  FROM anon, authenticated;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
GRANT INSERT ON TABLE public.demo_requests TO anon;

-- Stated rather than assumed. The restore does grant these, but this file has to
-- describe the whole end state to be worth re-running.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;

-- Migration 14: the audit trail is append-only, written only by the SECURITY
-- DEFINER trigger. It needs no end-user write grant, and with one, any signed-in
-- user can rewrite the record of what happened.
REVOKE INSERT, UPDATE, DELETE ON public.audit_logs FROM authenticated;

-- Migration 16: notifications are written only by notify_employee, which is SECURITY
-- DEFINER. With INSERT, a signed-in user could manufacture a notification that appears
-- to come from HR; with DELETE they could remove one they had been sent. The blanket
-- GRANT above hands back both, which is exactly why this revoke follows it.
REVOKE INSERT, DELETE ON public.notifications FROM authenticated;
REVOKE ALL ON public.notifications FROM anon;

-- ── 2. Default privileges ─────────────────────────────────────────────────
--
-- Without these the next table anyone creates arrives with the same over-broad
-- grants, and this whole file has to be run again.

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon;

-- supabase_admin is platform-reserved and postgres is not a superuser, so this
-- pair cannot be executed by anyone running this file — the same limitation that
-- stopped roles.sql restoring until it was handled. Attempted and tolerated rather
-- than omitted, so that it starts working by itself if Supabase ever grants it.
DO $$
BEGIN
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public '
       || 'REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM anon, authenticated';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public '
       || 'REVOKE ALL ON TABLES FROM anon';
  RAISE NOTICE 'supabase_admin default privileges tightened';
EXCEPTION
  WHEN insufficient_privilege OR reserved_name THEN
    RAISE NOTICE 'skipped supabase_admin default privileges: %', SQLERRM;
    RAISE NOTICE 'expected — that role is platform-reserved. Tables created BY '
                 'supabase_admin may still arrive over-granted; tables created by '
                 'postgres, which is everything in a migration, are covered above.';
END $$;

-- ── 3. Functions ──────────────────────────────────────────────────────────
--
-- These are exactly the functions the source project denies to both anon and
-- authenticated: 26 from the original audit, plus the eight notification internals
-- added by migrations 16 and 17. The remaining 32 are deliberately left alone — they
-- include get_user_role and get_user_company_id, which RLS policy expressions call as
-- the querying user, so revoking those would not harden anything. It would take the
-- application down completely.
--
-- 34 + 32 = 66, the full function count, so this is a partition of the schema rather
-- than a sample of it. If that sum stops matching, a function has been added without
-- anyone deciding which side of the line it belongs on, and the safe reading is that
-- it is reachable by every signed-in user.
--
-- PUBLIC is included because a grant to PUBLIC is why several of these are
-- reachable at all after a restore; revoking only from anon and authenticated
-- would leave them callable.

-- Every trigger function, swept rather than listed.
--
-- The named list below was written when the schema had 66 functions and has been going
-- stale ever since: this session alone added a dozen trigger functions (the KPI scorecard
-- guards, the review stage guard, the reports_to sanity check, the pay-table country
-- check, the session closer on termination), and every one of them would have had to be
-- remembered here. A function that returns `trigger` is never called by a client — it is
-- called by the table it is attached to — so the rule is the same for all of them and does
-- not need a list to maintain.
DO $sweep$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prorettype = 'pg_catalog.trigger'::regtype
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
  END LOOP;
END $sweep$;

REVOKE ALL ON FUNCTION public.apply_kpi_adjustment() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attendance_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.auto_post_reward_achievement() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.autolink_attendance_to_shift() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_leave_entitlement() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_expired_sessions() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compute_kpi_total() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_test_company(p_company_id uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.evaluate_kpi_rules_all_companies(p_year integer, p_month integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.evaluate_kpi_rules_for_company(p_company_id uuid, p_year integer, p_month integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.generate_emp_code() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kpi_review_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_sensitive_changes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.maintain_leave_balance() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.on_company_created_seed_kpi() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.onboard_company(p_company_name text, p_country text, p_currency text, p_timezone text, p_admin_user_id uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recalculate_all_attendance_scores() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seed_default_document_types(p_company_id uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seed_default_kpi_adjustment_types(p_company_id uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.snapshot_pdp_progress() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_attendance_score() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_kpi_adjustment_type() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_leave_transition() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_payroll_transition() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_shift() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_employee(uuid,uuid,text,text,text,text,text,uuid,interval) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notifications_only_read_at_is_editable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_roles(uuid,text[],text,text,text,text,text,uuid,uuid,uuid,interval,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_attendance_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_feed_post() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_leave_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_shift_published() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_missing_clockouts() FROM PUBLIC, anon, authenticated;

-- ── 4. Verification ───────────────────────────────────────────────────────
--
-- Every one of these must read 0. They are the same four counts that were
-- 246 / 286 / 8 / 26 immediately after the restore.

SELECT 'anon/authenticated TRUNCATE, TRIGGER, REFERENCES (want 0)' AS check,
       count(*)::text AS value
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')
  AND privilege_type IN ('TRUNCATE', 'TRIGGER', 'REFERENCES')
UNION ALL
SELECT 'anon grants beyond demo_requests INSERT (want 0)', count(*)::text
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND grantee = 'anon'
  AND NOT (table_name = 'demo_requests' AND privilege_type = 'INSERT')
UNION ALL
SELECT 'audit_logs write grants for anon/authenticated (want 0)', count(*)::text
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'audit_logs'
  AND grantee IN ('anon', 'authenticated')
  AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
UNION ALL
-- The sweep's own check, and the one that stays true as functions are added.
SELECT 'trigger functions reachable by anon/authenticated (want 0)', count(*)::text
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prorettype = 'pg_catalog.trigger'::regtype
  AND (has_function_privilege('anon', p.oid, 'EXECUTE')
    OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
UNION ALL
SELECT 'internal functions reachable by anon/authenticated (want 0)', count(*)::text
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'apply_kpi_adjustment','attendance_guard','auto_post_reward_achievement',
    'autolink_attendance_to_shift','check_leave_entitlement','cleanup_expired_sessions',
    'compute_kpi_total','delete_test_company','evaluate_kpi_rules_all_companies',
    'evaluate_kpi_rules_for_company','generate_emp_code','kpi_review_guard',
    'log_sensitive_changes','maintain_leave_balance','on_company_created_seed_kpi',
    'onboard_company','recalculate_all_attendance_scores','seed_default_document_types',
    'seed_default_kpi_adjustment_types','snapshot_pdp_progress','sync_attendance_score',
    'update_updated_at','validate_kpi_adjustment_type','validate_leave_transition',
    'validate_payroll_transition','validate_shift',
    'notify_employee','notifications_only_read_at_is_editable',
    'notify_roles','notify_attendance_change','notify_feed_post',
    'notify_leave_change','notify_shift_published','notify_missing_clockouts')
  AND (has_function_privilege('anon', p.oid, 'EXECUTE')
    OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
UNION ALL
-- Must stay reachable. RLS policy expressions call these as the querying user, so
-- a 0 here means the application is broken, not hardened.
SELECT 'get_user_role/company_id executable by authenticated (want 2)', count(*)::text
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('get_user_role', 'get_user_company_id')
  AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
UNION ALL
-- Same reason, one layer up. These are the predicates the KPI, leave, payroll and document
-- policies are written in terms of; a restore that leaves them unreachable does not fail
-- loudly, it just returns nobody's rows to everybody.
SELECT 'responsibility predicates executable by authenticated (want 5)', count(*)::text
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('manages_employee', 'kpi_manages_employee', 'manager_covers',
                    'employee_managers', 'get_user_employee_id')
  AND has_function_privilege('authenticated', p.oid, 'EXECUTE');
