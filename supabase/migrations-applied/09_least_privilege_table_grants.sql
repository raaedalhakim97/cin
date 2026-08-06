-- Remove privileges that RLS cannot govern, and stop them coming back.
--
-- Measured during the hosting audit: anon, authenticated AND service_role each
-- held all seven table privileges on all 41 tables — including TRUNCATE. This
-- is Supabase's shipped default for the public schema (pg_default_acl grants
-- `arwdDxtm` to anon and authenticated), not a mistake anyone made, and the
-- platform's position is that RLS is the protection.
--
-- But RLS governs SELECT/INSERT/UPDATE/DELETE only. It does NOT govern
-- TRUNCATE. Demonstrated in a rolled-back transaction:
--
--     SET ROLE anon; TRUNCATE attendance CASCADE;   -- succeeded, 0 rows left
--
-- No policy can stop that.
--
-- Reachability, stated honestly: PostgREST never emits TRUNCATE, so this was
-- not exploitable through the normal API. What it cost was defence-in-depth —
-- any SQL injection or unsafe dynamic SQL in a SECURITY DEFINER function turns
-- from "contained" into "total data loss"; the read_only role's guarantee was
-- void at the database level; and audit_logs was destroyable by the very party
-- being audited. TRIGGER is the same shape: it would let a client attach its
-- own trigger and subvert the attendance/leave/review guards added earlier.
--
-- service_role is deliberately untouched. It is the server-side key that
-- bypasses RLS by design; narrowing it would break backups and admin tooling.
--
-- Verified after applying:
--   anon TRUNCATE attendance          -> permission denied
--   authenticated TRUNCATE payroll    -> permission denied
--   anon insert into demo_requests    -> works (the public demo form)
--   authenticated ordinary reads      -> work
--   brand-new table                   -> inherits neither TRUNCATE nor TRIGGER

-- 1. Existing tables.
REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

-- 2. Future tables. Without this the next CREATE TABLE re-grants TRUNCATE —
--    which is exactly how kpi_rules picked it up in migration 08 despite that
--    migration granting only SELECT/INSERT/UPDATE/DELETE. Two grantors define
--    defaults here and supabase_admin's may not be alterable from this role,
--    so each is attempted independently rather than aborting the migration.
DO $$
BEGIN
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM anon, authenticated;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'could not alter default privileges for postgres';
END $$;

DO $$
BEGIN
  ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
    REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM anon, authenticated;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'could not alter default privileges for supabase_admin — expected';
END $$;

-- 3. anon needs no table access at all.
--    Checked against every signed-out code path: Landing and Login touch no
--    table; AcceptInvite goes through the get_invite_preview RPC; login
--    logging goes through log_login_attempt. Both are SECURITY DEFINER and
--    need no table grant. The one exception is the public demo form
--    (src/pages/Demo.jsx), which inserts into demo_requests under the existing
--    demo_requests_public_insert policy. That file already avoids chaining
--    .select() precisely because anon cannot read the table back — so INSERT
--    alone is sufficient and no RETURNING is issued.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
GRANT INSERT ON TABLE public.demo_requests TO anon;

DO $$
BEGIN
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE ALL ON TABLES FROM anon;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'could not alter anon default table privileges';
END $$;
