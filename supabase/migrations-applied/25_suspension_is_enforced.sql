-- Suspension was a word in the Terms and a colour in the console. Nothing enforced
-- it, and after migration 21 nothing could even set it.
--
-- Terms.jsx: "if you do not, access to the workspace is suspended."
-- Landing.jsx: "the workspace is suspended rather than deleted".
-- company_plan_check has allowed 'suspended' since the first migration.
--
-- What was missing: a way to set the plan (migration 21 shipped
-- platform_create_company, platform_company_access and platform_revoke_invite —
-- platform_set_plan was described in a pull request and never written), anything in
-- the database that treats a suspended company differently, and any way for the
-- people on the other side of it to find out what happened.
--
-- ── Where enforcement goes ─────────────────────────────────────────────────────
--
-- get_user_company_id(uid) is called by 100 RLS policies. It is the single place
-- every tenant-scoped read and write resolves "which company is this person in", so
-- it is the one change that cannot be routed around: no policy, and no future
-- policy, can accidentally miss the check. Returning NULL there turns every
-- `company_id = get_user_company_id(...)` comparison into NULL, which is not TRUE,
-- which is a denial.
--
-- The cost of choosing that choke point is that it takes the explanation with it.
-- A suspended tenant cannot read `company` (company_select_own goes through this
-- helper) and cannot read their own `user_roles` row either (roles_select does too),
-- so the client learns nothing except that everything is empty — indistinguishable
-- from the "your login is not linked to an employee record" wall, and a mystery to
-- the person looking at it. So the explanation is deliberately moved out of RLS and
-- into my_workspace(), a definer function that reports only the caller's own
-- workspace and works regardless of plan. Enforcement and explanation must not
-- share a mechanism, or one of them takes the other down.
--
-- Deliberately NOT enforced here: trial expiry. trial_ends_at passing does not
-- suspend anything. There is no scheduled job to do it, and an automatic lockout on
-- a date nobody confirmed is exactly the behaviour a small business should never get
-- from its HR system. Suspension is an act by a person, recorded with their name.

-- ── 1. The plan becomes a decision with an author ──────────────────────────────

ALTER TABLE public.company
  ADD COLUMN IF NOT EXISTS plan_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS plan_changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Shown to the tenant on the suspended screen, so it is written for them and not
  -- for us: "Invoice 3 unpaid since 12 July — contact accounts@byond.ae", not
  -- "chase Raaed". The console labels the field accordingly.
  ADD COLUMN IF NOT EXISTS plan_note text;

COMMENT ON COLUMN public.company.plan_note IS
  'Operator note shown to the workspace itself on the suspended screen. Never internal.';

-- ── 2. Setting it ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.platform_set_plan(
  p_company_id uuid,
  p_plan       text,
  p_note       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid  uuid := (SELECT auth.uid());
  v_old  text;
  v_name text;
BEGIN
  -- SECURITY DEFINER means RLS does not apply inside this function, so this check
  -- is not the first line of defence — it is the only one.
  IF NOT public.is_platform_owner(v_uid) THEN
    RAISE EXCEPTION 'Only BYOND platform owners can change a company plan';
  END IF;

  IF p_plan IS NULL OR p_plan NOT IN ('trial', 'active', 'suspended', 'cancelled') THEN
    RAISE EXCEPTION 'Unknown plan: %', coalesce(p_plan, 'null');
  END IF;

  SELECT plan, name INTO v_old, v_name FROM company WHERE id = p_company_id;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'No such company';
  END IF;

  UPDATE company
     SET plan            = p_plan,
         plan_note       = nullif(btrim(coalesce(p_note, '')), ''),
         plan_changed_at = now(),
         plan_changed_by = v_uid
   WHERE id = p_company_id;

  -- Written against the tenant's own company_id, not BYOND's: this is a thing that
  -- happened to them, and it is the record they are entitled to see.
  INSERT INTO audit_logs (user_id, company_id, action, table_name, record_id, old_data, new_data)
  VALUES (v_uid, p_company_id, 'COMPANY_PLAN_CHANGED', 'company', p_company_id,
          jsonb_build_object('plan', v_old),
          jsonb_build_object('plan', p_plan, 'note', nullif(btrim(coalesce(p_note, '')), '')));

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'company',    v_name,
    'was',        v_old,
    'plan',       p_plan,
    'note',       nullif(btrim(coalesce(p_note, '')), ''),
    'changed_at', now()
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.platform_set_plan(uuid, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.platform_set_plan(uuid, text, text) TO authenticated;

-- ── 3. Enforcing it ──────────────────────────────────────────────────────────

-- The whole of suspension, in one JOIN. Kept as a plain SQL STABLE function so
-- Postgres can still inline it into the 100 policies that call it; the added work is
-- a primary-key lookup on a table with as many rows as BYOND has customers.
--
-- 'trial' and 'active' grant access. 'suspended' and 'cancelled' do not — cancelled
-- is included because a workspace nobody is paying for and nobody intends to return
-- to should not be quietly readable; the rows are retained, the door is shut.
CREATE OR REPLACE FUNCTION public.get_user_company_id(uid uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT ur.company_id
    FROM user_roles ur
    JOIN company c ON c.id = ur.company_id
   WHERE ur.user_id = uid
     AND c.plan IN ('trial', 'active')
   LIMIT 1;
$function$;

-- ── 4. Explaining it ─────────────────────────────────────────────────────────

-- The caller's own workspace, and nothing else. No argument to pass — migration 18's
-- lesson: a definer function that takes the id of the thing you want is a function
-- that has to defend that argument. This one derives everything from auth.uid(), so
-- there is nothing to defend and no cross-tenant shape it can be asked for.
--
-- Reads user_roles and company directly rather than through get_user_company_id,
-- which is the entire point: it has to answer while the gate is shut.
CREATE OR REPLACE FUNCTION public.my_workspace()
RETURNS TABLE (
  company_id        uuid,
  company_name      text,
  plan              text,
  plan_note         text,
  plan_changed_at   timestamptz,
  role              text,
  employee_id       uuid,
  platform_owner    boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Access denied: authentication required';
  END IF;

  RETURN QUERY
  SELECT c.id, c.name, c.plan, c.plan_note, c.plan_changed_at,
         ur.role,
         (SELECT e.id FROM employees e
           WHERE e.user_id = v_uid AND e.company_id = ur.company_id LIMIT 1),
         coalesce(ur.is_platform_owner, false)
    FROM user_roles ur
    JOIN company c ON c.id = ur.company_id
   WHERE ur.user_id = v_uid
   LIMIT 1;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.my_workspace() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.my_workspace() TO authenticated;

-- ── Verification ─────────────────────────────────────────────────────────────
-- Run as a real tenant super_admin before and after, expecting identical counts for
-- a company whose plan grants access, and zeroes for one that does not. Measured on
-- production inside a transaction that rolled back, so no customer was suspended to
-- test it.
SELECT 'anon can set a plan (must be false)' AS check,
       has_function_privilege('anon', 'public.platform_set_plan(uuid,text,text)', 'EXECUTE')::text AS value
UNION ALL
SELECT 'anon can read its own workspace (must be false)',
       has_function_privilege('anon', 'public.my_workspace()', 'EXECUTE')::text
UNION ALL
SELECT 'policies routed through get_user_company_id',
       (SELECT count(*)::text FROM pg_policies
         WHERE schemaname = 'public'
           AND coalesce(qual, '') || coalesce(with_check, '') LIKE '%get_user_company_id%');
