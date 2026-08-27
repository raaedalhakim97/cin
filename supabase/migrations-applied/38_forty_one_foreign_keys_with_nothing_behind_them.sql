-- 41 foreign keys had no index on the referencing side.
--
-- Postgres indexes the referenced side automatically — it has to, the target must be
-- unique — and never the referencing side. So every one of these was a sequential scan
-- waiting to happen, in two situations:
--
--   1. Any query filtering or joining on the column.
--   2. Any DELETE or UPDATE of the parent row. Postgres must prove no child references
--      it, and with no index that proof is a full scan of the child table.
--
-- Invisible at 17 employees and 2 companies. The reason to do it now is that it is free
-- now: creating an index on an empty table is instant, and on a busy one it is a
-- maintenance window.
--
-- Confirmed against pg_constraint rather than taken from the linter's summary — the query
-- below finds foreign keys whose columns are not the leading columns of any index, and it
-- returned exactly the same 41 the Supabase performance advisor reports.
--
-- ── On CONCURRENTLY ────────────────────────────────────────────────────────
-- These are plain CREATE INDEX, which takes an ACCESS EXCLUSIVE lock for the duration.
-- At this size the duration is milliseconds. If this migration is ever replayed against a
-- database with real volume, convert them to CREATE INDEX CONCURRENTLY and run them
-- outside a transaction — apply_migration wraps everything in one, and CONCURRENTLY
-- cannot run inside a transaction block.
--
-- ── What this migration deliberately does not do ───────────────────────────
-- The same advisor reports 14 unused indexes. They are not touched. "Unused" on a
-- database with 17 employees and almost no traffic means "nobody has run that query yet",
-- not "this index is waste" — dropping an index because a nearly-idle system has not
-- needed it is how you find out in production which query depended on it.

-- ── 1. Tenant scoping ──────────────────────────────────────────────────────
-- company_id is the column every RLS policy on these tables filters by, via
-- get_user_company_id. Every read any user makes of these tables goes through it, so
-- these are the eight that matter most.
CREATE INDEX IF NOT EXISTS idx_feed_comments_company_id           ON public.feed_comments (company_id);
CREATE INDEX IF NOT EXISTS idx_feed_reactions_company_id          ON public.feed_reactions (company_id);
CREATE INDEX IF NOT EXISTS idx_kpi_reviews_company_id             ON public.kpi_reviews (company_id);
CREATE INDEX IF NOT EXISTS idx_notifications_company_id           ON public.notifications (company_id);
CREATE INDEX IF NOT EXISTS idx_pdp_actions_company_id             ON public.pdp_actions (company_id);
CREATE INDEX IF NOT EXISTS idx_pdp_plans_company_id               ON public.pdp_plans (company_id);
CREATE INDEX IF NOT EXISTS idx_pdp_progress_company_id            ON public.pdp_progress (company_id);
CREATE INDEX IF NOT EXISTS idx_warning_recommendations_company_id ON public.warning_recommendations (company_id);

-- ── 2. Which person the row is about ───────────────────────────────────────
-- The second axis every screen filters on: one employee's feed, one employee's plan, one
-- employee's invite. Also the columns anonymize_employee has to walk.
CREATE INDEX IF NOT EXISTS idx_employee_invites_employee_id    ON public.employee_invites (employee_id);
CREATE INDEX IF NOT EXISTS idx_feed_comments_employee_id       ON public.feed_comments (employee_id);
CREATE INDEX IF NOT EXISTS idx_feed_reactions_employee_id      ON public.feed_reactions (employee_id);
CREATE INDEX IF NOT EXISTS idx_feed_posts_author_employee_id   ON public.feed_posts (author_employee_id);
CREATE INDEX IF NOT EXISTS idx_pdp_plans_employee_id           ON public.pdp_plans (employee_id);
CREATE INDEX IF NOT EXISTS idx_kpi_reviews_manager_employee_id ON public.kpi_reviews (manager_employee_id);

-- ── 3. Genuine joins and lookups ───────────────────────────────────────────
-- Followed in ordinary use: which location a punch happened at, which template a shift
-- came from, which document a contract points to, which version a document supersedes.
--
-- company.country is new as of migration 34 and is the parent side of a lookup that runs
-- on every login now that authStore reads the country pack.
CREATE INDEX IF NOT EXISTS idx_attendance_clock_in_location_id  ON public.attendance (clock_in_location_id);
CREATE INDEX IF NOT EXISTS idx_attendance_clock_out_location_id ON public.attendance (clock_out_location_id);
CREATE INDEX IF NOT EXISTS idx_company_country                  ON public.company (country);
CREATE INDEX IF NOT EXISTS idx_company_contracts_document_id    ON public.company_contracts (document_id);
CREATE INDEX IF NOT EXISTS idx_hr_documents_supersedes_id       ON public.hr_documents (supersedes_id);
CREATE INDEX IF NOT EXISTS idx_pdp_actions_plan_id              ON public.pdp_actions (plan_id);
CREATE INDEX IF NOT EXISTS idx_shifts_template_id               ON public.shifts (template_id);

-- ── 4. Who did it ──────────────────────────────────────────────────────────
-- Twenty columns recording which person approved, created, uploaded or reviewed a row.
-- Almost nothing filters on them, so on its own that would be a weak reason to index.
--
-- The real reason is deletion. These all reference employees or auth.users, and this
-- product deletes people: anonymize_employee exists for PDPL and GDPR erasure, employees
-- get terminated, and platform accounts get removed. Every one of those operations makes
-- Postgres prove no child row still points at the departing person — twenty sequential
-- scans, on a request that is already sensitive and already slow, and one that a customer
-- is legally entitled to have completed.
CREATE INDEX IF NOT EXISTS idx_attendance_approved_by                  ON public.attendance (approved_by);
CREATE INDEX IF NOT EXISTS idx_company_plan_changed_by                 ON public.company (plan_changed_by);
CREATE INDEX IF NOT EXISTS idx_company_action_items_created_by         ON public.company_action_items (created_by);
CREATE INDEX IF NOT EXISTS idx_company_action_items_owner_user         ON public.company_action_items (owner_user);
CREATE INDEX IF NOT EXISTS idx_company_support_tickets_handled_by      ON public.company_support_tickets (handled_by);
CREATE INDEX IF NOT EXISTS idx_data_subject_requests_handled_by        ON public.data_subject_requests (handled_by);
CREATE INDEX IF NOT EXISTS idx_employee_invites_created_by            ON public.employee_invites (created_by);
CREATE INDEX IF NOT EXISTS idx_hr_documents_uploaded_by               ON public.hr_documents (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_kpi_adjustments_issued_by              ON public.kpi_adjustments (issued_by);
CREATE INDEX IF NOT EXISTS idx_kpi_review_cycles_opened_by            ON public.kpi_review_cycles (opened_by);
CREATE INDEX IF NOT EXISTS idx_kpi_review_cycles_published_by         ON public.kpi_review_cycles (published_by);
CREATE INDEX IF NOT EXISTS idx_kpi_scores_evaluated_by                ON public.kpi_scores (evaluated_by);
CREATE INDEX IF NOT EXISTS idx_leave_requests_manager_reviewed_by     ON public.leave_requests (manager_reviewed_by);
CREATE INDEX IF NOT EXISTS idx_leave_requests_reviewed_by             ON public.leave_requests (reviewed_by);
CREATE INDEX IF NOT EXISTS idx_notifications_actor_user_id            ON public.notifications (actor_user_id);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_approved_by               ON public.payroll_runs (approved_by);
CREATE INDEX IF NOT EXISTS idx_shifts_created_by                      ON public.shifts (created_by);
CREATE INDEX IF NOT EXISTS idx_user_roles_assigned_by                 ON public.user_roles (assigned_by);
CREATE INDEX IF NOT EXISTS idx_warning_recommendations_recommended_by ON public.warning_recommendations (recommended_by);
CREATE INDEX IF NOT EXISTS idx_warning_recommendations_reviewed_by    ON public.warning_recommendations (reviewed_by);
