-- D3. login_attempts_insert re-evaluated auth.role() once per row.
--
--   WITH CHECK (auth.role() = ANY (ARRAY['authenticated', 'anon']))
--
-- auth.role() reads a setting that cannot change during a statement, but Postgres does
-- not know that, so it calls the function for every row the statement touches instead of
-- once. Wrapping it in a scalar subquery turns it into an InitPlan: evaluated once, then
-- treated as a constant.
--
-- The sibling policy on the same table already does this —
--   login_attempts_select USING (get_user_role((SELECT auth.uid())) = 'super_admin')
-- — so this is a single missed spot rather than a pattern, which is also why it is the
-- only auth_rls_initplan finding on the whole database.
--
-- The predicate itself is unchanged: still "the caller is a signed-in user or an
-- anonymous one", which is what lets log_login_attempt record a failed sign-in before
-- anybody is signed in. Only when the question gets asked changes.

DROP POLICY IF EXISTS login_attempts_insert ON public.login_attempts;

CREATE POLICY login_attempts_insert ON public.login_attempts
  FOR INSERT
  WITH CHECK ((SELECT auth.role()) = ANY (ARRAY['authenticated'::text, 'anon'::text]));

-- ── D2, and why it is not in this migration ────────────────────────────────
--
-- The performance advisor reports 38 "multiple permissive policies" findings, and I
-- repeated that number in the checklist and in docs/going-live.md. It is inflated, and
-- the correction matters more than the finding.
--
-- The advisor counts one finding per (table, role, action). A single overlapping pair of
-- policies written `TO public` is therefore counted once for every role in the database.
-- Expanding 'ALL' into its four actions and treating a public policy as applying to every
-- grantee — which is what the advisor does — the real number of overlapping
-- (table, action, role) combinations is 29, and they are two distinct shapes:
--
--   ~18  "X_select + X_write", where X_write is FOR ALL. A FOR ALL policy covers SELECT,
--        so both are evaluated on every read. In each case the write policy's SELECT
--        grant is a strict subset of the read policy's — read allows the whole company,
--        write allows HR within the same company — so the overlap costs an evaluation
--        and grants nothing extra.
--
--   ~11  genuinely different write rules OR'd together: attendance UPDATE
--        (att_self_update + att_update), leave_requests UPDATE (three policies),
--        kpi_reviews UPDATE (three), kpi_scores INSERT and UPDATE, pdp_actions UPDATE.
--
-- Neither is being changed, for different reasons.
--
-- The first group could be fixed mechanically by replacing each FOR ALL write policy with
-- separate FOR INSERT / FOR UPDATE / FOR DELETE policies. That halves the policies
-- evaluated on the hot path — SELECT — and is semantically identical. But it means
-- rewriting the security policies of eighteen tables on a live multi-tenant database
-- holding real employees' salaries and national IDs, for a gain that is unmeasurable at
-- 17 employees and modest even at scale. The missing foreign-key indexes fixed in
-- migration 38 were the real performance problem on this database. This is worth doing
-- when there is a measured problem, one table at a time, with the guarantee suite run
-- between each.
--
-- The second group should not be merged at all. Each of those policies currently states
-- one intelligible rule — "you may update your own row", "a manager may update their
-- team's" — and collapsing them into a single OR predicate would make the rules harder to
-- read in exchange for one fewer policy evaluation. Security rules earn their keep by
-- being obvious. That is a trade in the wrong direction.
