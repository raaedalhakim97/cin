-- BYOND's file on each customer: contacts, contract, payments, action plans and
-- support history.
--
-- The important distinction, and the reason this is five new tables rather than
-- columns on `company`: there are two kinds of record about a tenant, and they have
-- opposite audiences.
--
--   The tenant's own records      their trade licence, their staff, their punches.
--                                 The tenant owns these and must see them.
--                                 Already handled: hr_documents supports
--                                 scope='company' with employee_id NULL, and its
--                                 policies already let the tenant read its own.
--
--   BYOND's records ABOUT them    what they pay, what the contract says, what we
--                                 said on the phone, what we plan to do about the
--                                 fact they have stopped clocking in.
--                                 The tenant must NOT see these.
--
-- Everything in this migration is the second kind. So the policies are not
-- tenant-scoped at all — they are `is_platform_owner(auth.uid())` and nothing else.
-- A customer's own super_admin gets no access to their own row here, which is
-- deliberate: an internal note saying "chasing payment, considering suspension" is
-- not something the customer reads over our shoulder.
--
-- No SECURITY DEFINER anywhere here, unlike the platform_* read functions. Those
-- needed it because they aggregate across tenant tables whose RLS would otherwise
-- hide the rows. These tables have no tenant-scoped policy to work around, so plain
-- RLS is enough and the client can read and write them directly. Fewer definer
-- functions is strictly better: each one is a place where RLS does not apply.
--
-- What this migration deliberately does NOT do: decide what BYOND charges. Amounts
-- are stored as entered, never computed. A pricing model invented here would be
-- wrong and would then be load-bearing.

-- ── 1. Who to call ───────────────────────────────────────────────────────────
-- Separate from employees on purpose. The person who signs the contract or pays
-- the invoice is often not an employee in the HR system at all — an owner, an
-- external accountant, a PRO handling the labour file.
CREATE TABLE IF NOT EXISTS public.company_contacts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.company(id) ON DELETE CASCADE,
  full_name   text NOT NULL,
  -- Renamed to position_title in migration 23: `position` is legal here but a
  -- syntax error in a RETURNS TABLE signature, which the console's readers need.
  position    text,
  phone       text,
  email       text,
  -- Exactly one primary contact per company, enforced by the partial unique index
  -- below rather than by hoping the UI behaves.
  is_primary  boolean NOT NULL DEFAULT false,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS company_contacts_one_primary
  ON public.company_contacts (company_id) WHERE is_primary;

-- ── 2. The contract with BYOND ───────────────────────────────────────────────
-- One row per company, so it is a settings row rather than a history. Renewals
-- overwrite the dates; the audit trail carries what changed.
CREATE TABLE IF NOT EXISTS public.company_contracts (
  company_id     uuid PRIMARY KEY REFERENCES public.company(id) ON DELETE CASCADE,
  status         text NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','sent','signed','expired','terminated')),
  signed_at      date,
  starts_on      date,
  ends_on        date,
  -- Months of notice either side must give. Stored because it decides whether a
  -- company asking to leave today can actually leave today.
  notice_days    integer,
  auto_renew     boolean NOT NULL DEFAULT false,
  -- What they agreed to pay, as agreed. Never derived.
  monthly_fee    numeric(12,2),
  currency       text,
  seats_included integer,
  -- The signed PDF lives in hr_documents with scope='company'; this points at it
  -- rather than duplicating the file.
  document_id    uuid REFERENCES public.hr_documents(id) ON DELETE SET NULL,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_contracts_dates CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);

-- ── 3. What they owe and what they have paid ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.company_invoices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.company(id) ON DELETE CASCADE,
  reference     text,
  -- The period being billed, as a date range the human recognises.
  period_start  date,
  period_end    date,
  amount        numeric(12,2) NOT NULL,
  currency      text NOT NULL,
  issued_on     date NOT NULL DEFAULT CURRENT_DATE,
  due_on        date,
  paid_on       date,
  status        text NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','sent','paid','overdue','void','refunded')),
  method        text,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- A paid invoice without a payment date, or a date without the status, is the
  -- kind of half-entered row that makes a payments list untrustworthy.
  CONSTRAINT company_invoices_paid_has_date
    CHECK ((status = 'paid') = (paid_on IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS company_invoices_company_status
  ON public.company_invoices (company_id, status);

-- ── 4. Action plans ──────────────────────────────────────────────────────────
-- What BYOND intends to do about this customer. The console already says a tenant
-- has not clocked in for 22 days; this is where "and here is what we are doing
-- about it" lives, so the observation does not evaporate.
CREATE TABLE IF NOT EXISTS public.company_action_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.company(id) ON DELETE CASCADE,
  title       text NOT NULL,
  detail      text,
  status      text NOT NULL DEFAULT 'open'
              CHECK (status IN ('open','in_progress','blocked','done','cancelled')),
  priority    text NOT NULL DEFAULT 'normal'
              CHECK (priority IN ('low','normal','high','urgent')),
  due_on      date,
  -- Which BYOND owner is carrying it. auth.users, not employees: platform owners
  -- are not staff at any tenant.
  owner_user  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  done_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_action_items_done_has_date
    CHECK ((status = 'done') = (done_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS company_action_items_open
  ON public.company_action_items (company_id, status) WHERE status <> 'done';

-- ── 5. Support history ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.company_support_tickets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.company(id) ON DELETE CASCADE,
  subject      text NOT NULL,
  detail       text,
  -- How they reached us. Recorded because "they said it on WhatsApp" is the real
  -- answer most of the time and pretending otherwise loses the history.
  channel      text NOT NULL DEFAULT 'whatsapp'
               CHECK (channel IN ('whatsapp','phone','email','in_person','other')),
  status       text NOT NULL DEFAULT 'open'
               CHECK (status IN ('open','waiting_on_customer','resolved','closed')),
  priority     text NOT NULL DEFAULT 'normal'
               CHECK (priority IN ('low','normal','high','urgent')),
  raised_by    text,
  handled_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolution   text,
  opened_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_support_resolved_has_date
    CHECK ((status IN ('resolved','closed')) = (resolved_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS company_support_open
  ON public.company_support_tickets (company_id, status) WHERE status IN ('open','waiting_on_customer');

-- ── RLS: platform owners only, on all five ──────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['company_contacts','company_contracts','company_invoices',
                           'company_action_items','company_support_tickets']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- One policy for everything. Not four near-identical ones: the rule is the
    -- same for reading and writing, and splitting it invites the copies to drift.
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_platform_only', t);
    EXECUTE format($p$
      CREATE POLICY %I ON public.%I
        FOR ALL TO authenticated
        USING (public.is_platform_owner((SELECT auth.uid())))
        WITH CHECK (public.is_platform_owner((SELECT auth.uid())))
    $p$, t || '_platform_only', t);

    -- anon has no business here at any level. authenticated needs the table grant
    -- for the policy above to have anything to filter.
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);

    -- updated_at maintained by the existing trigger function rather than by each
    -- caller remembering to set it.
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON public.%I', t);
    EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I
                      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at()', t);
  END LOOP;
END $$;

-- ── Server status, honestly ──────────────────────────────────────────────────
-- There is no per-company server. Every tenant shares one Postgres and one
-- Supabase project, so a per-row "server health" gauge would be the same number
-- repeated down the page while implying otherwise.
--
-- What is genuinely per-tenant is footprint: how much of the shared database this
-- customer occupies. That is the number that matters when one tenant's growth
-- starts affecting everyone, and it is the honest thing to put under that heading.
CREATE OR REPLACE FUNCTION public.platform_company_footprint(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT public.is_platform_owner((SELECT auth.uid())) THEN
    RAISE EXCEPTION 'Only BYOND platform owners can read company footprint';
  END IF;

  SELECT jsonb_build_object(
    'employees',   (SELECT count(*) FROM employees        WHERE company_id = p_company_id),
    'attendance',  (SELECT count(*) FROM attendance       WHERE company_id = p_company_id),
    'leave',       (SELECT count(*) FROM leave_requests   WHERE company_id = p_company_id),
    'payroll',     (SELECT count(*) FROM payroll_runs     WHERE company_id = p_company_id),
    'kpi_scores',  (SELECT count(*) FROM kpi_scores       WHERE company_id = p_company_id),
    'documents',   (SELECT count(*) FROM hr_documents     WHERE company_id = p_company_id),
    'shifts',      (SELECT count(*) FROM shifts           WHERE company_id = p_company_id),
    'audit_rows',  (SELECT count(*) FROM audit_logs       WHERE company_id = p_company_id),
    'storage_bytes', (SELECT coalesce(sum(file_size_bytes),0) FROM hr_documents WHERE company_id = p_company_id)
  ) INTO v;
  RETURN v;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.platform_company_footprint(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.platform_company_footprint(uuid) TO authenticated;

-- ── Verification ────────────────────────────────────────────────────────────
SELECT c.relname AS table,
       c.relrowsecurity AS rls_on,
       (SELECT count(*) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname) AS policies,
       has_table_privilege('anon', 'public.'||c.relname, 'SELECT') AS anon_can_read
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public'
  AND c.relname IN ('company_contacts','company_contracts','company_invoices',
                    'company_action_items','company_support_tickets')
ORDER BY c.relname;
