-- Provisioning: how BYOND hands a new customer a company and an owner account.
--
-- Until now there was no supported path. Every company and every owner account in
-- this database was created by someone editing it directly, which is fine once and
-- is not a product. This is the base for the operator console's other half —
-- "companies and access giving".
--
-- The shape: a platform owner creates the tenant and issues an invite for its
-- first super_admin. The customer's CEO opens the link, sets their own password,
-- and from that moment administers their own company — hiring, HR, payroll, all of
-- it — without BYOND touching their staff data. That is the division we want:
-- BYOND grants access, tenants operate.
--
-- ── The constraint being widened, and why that is safe ──────────────────────
--
-- employee_invites_role_check excluded 'super_admin', so a super_admin invite
-- could not exist even in principle. That guard is correct for the tenant path: it
-- stops an hr_manager minting an owner and escalating their own company. But it
-- also made provisioning impossible, because a new customer's first account has to
-- be an owner — there is nobody above them to promote them.
--
-- So the constraint is widened by exactly one value, and the protection is kept
-- where it actually matters: create_employee_invite — the function tenants call —
-- still refuses super_admin outright. It is untouched by this migration. The only
-- way to mint an owner invite is platform_create_company below, whose first act is
-- to refuse anyone who is not a platform owner.
--
-- Net effect on a tenant's powers: none. An hr_manager can invite exactly what they
-- could invite before.

ALTER TABLE public.employee_invites DROP CONSTRAINT IF EXISTS employee_invites_role_check;
ALTER TABLE public.employee_invites ADD  CONSTRAINT employee_invites_role_check
  CHECK (role = ANY (ARRAY[
    'super_admin',        -- platform-owner provisioning only; see above
    'hr_manager', 'department_manager', 'employee', 'read_only', 'admin'
  ]));

-- ── Provisioning ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.platform_create_company(
  p_company_name  text,
  p_ceo_full_name text,
  p_ceo_email     text,
  p_country       text DEFAULT 'UAE',
  p_currency      text DEFAULT 'AED',
  p_timezone      text DEFAULT 'Asia/Dubai',
  p_trial_months  integer DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid        uuid := (SELECT auth.uid());
  v_company_id uuid;
  v_employee_id uuid;
  v_dept_hr    uuid;
  v_token      text;
  v_email      text := lower(btrim(coalesce(p_ceo_email, '')));
  v_name       text := btrim(coalesce(p_company_name, ''));
  v_ceo        text := btrim(coalesce(p_ceo_full_name, ''));
BEGIN
  -- Refusal first, before anything is read or written. SECURITY DEFINER means RLS
  -- does not apply in here, so this is the access control rather than a filter.
  IF NOT public.is_platform_owner(v_uid) THEN
    RAISE EXCEPTION 'Only BYOND platform owners can create a company';
  END IF;

  IF v_name = ''  THEN RAISE EXCEPTION 'Company name is required'; END IF;
  IF v_ceo  = ''  THEN RAISE EXCEPTION 'The owner''s full name is required'; END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'A valid email address is required for the owner';
  END IF;
  IF p_trial_months IS NULL OR p_trial_months < 0 OR p_trial_months > 24 THEN
    RAISE EXCEPTION 'Trial length must be between 0 and 24 months';
  END IF;

  -- Caught here rather than at the invite link. accept_employee_invite refuses an
  -- account that already belongs to a company (user_roles is UNIQUE on user_id), so
  -- without this check the CEO would only discover the problem after setting a
  -- password — by which point they have an orphan account and we have a company
  -- nobody can administer.
  IF EXISTS (
    SELECT 1 FROM auth.users u JOIN user_roles ur ON ur.user_id = u.id
    WHERE lower(u.email) = v_email
  ) THEN
    RAISE EXCEPTION 'That email already administers a company on BYOND. One account belongs to one company.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM employee_invites WHERE lower(email) = v_email AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'An invite is already pending for that email. Revoke it first, or resend the existing link.';
  END IF;

  -- kpi_settings, shift_settings, document types and adjustment types are seeded by
  -- the on_company_created_seed_kpi trigger, so they are deliberately absent here.
  --
  -- plan and trial_ends_at are BOTH set. A company created by the older
  -- onboard_company() got neither, which is how BYOND Test Co ended up on
  -- plan 'trial' with trial_ends_at NULL — a trial that never expires, invisible
  -- until the operator console started flagging it.
  INSERT INTO company (name, country, currency, timezone, plan, trial_ends_at, created_via)
  VALUES (v_name, p_country, p_currency, p_timezone,
          CASE WHEN p_trial_months = 0 THEN 'active' ELSE 'trial' END,
          CASE WHEN p_trial_months = 0 THEN NULL
               ELSE now() + (p_trial_months || ' months')::interval END,
          -- 'admin' is the existing vocabulary for "an operator made this", per
          -- company_created_via_check, which allows admin/self_signup/demo. I first
          -- wrote 'platform' and the insert was refused — reusing the constraint's
          -- own words beats widening a second constraint to say the same thing.
          'admin')
  RETURNING id INTO v_company_id;

  INSERT INTO departments (name, company_id) VALUES
    ('Human Resources', v_company_id),
    ('Operations',      v_company_id),
    ('Finance',         v_company_id),
    ('Sales',           v_company_id),
    ('Technology',      v_company_id);

  SELECT id INTO v_dept_hr FROM departments
   WHERE company_id = v_company_id AND name = 'Human Resources';

  INSERT INTO employees (company_id, full_name, email, job_title, department_id,
                         hire_date, status)
  VALUES (v_company_id, v_ceo, v_email, 'Owner', v_dept_hr, CURRENT_DATE, 'invited')
  RETURNING id INTO v_employee_id;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  -- created_by is left NULL on purpose: it is a FK to employees, and a platform
  -- owner has no employee record inside the company they just created. Writing
  -- their own employee id from another company would attribute the invite to a
  -- person who does not work there.
  INSERT INTO employee_invites (company_id, employee_id, role, email, token)
  VALUES (v_company_id, v_employee_id, 'super_admin', v_email, v_token);

  RETURN jsonb_build_object(
    'company_id',      v_company_id,
    'company_name',    v_name,
    'employee_id',     v_employee_id,
    'owner_email',     v_email,
    'invite_token',    v_token,
    'invite_path',     '/invite/' || v_token,
    'expires_in_days', 7,
    'plan',            CASE WHEN p_trial_months = 0 THEN 'active' ELSE 'trial' END
  );
END;
$function$;

-- ── Seeing and withdrawing what was granted ─────────────────────────────────
--
-- "Access giving" needs a view of what has been given, or it is a write-only
-- feature. This is the one place the console touches a person's name and email,
-- and it is scoped to people who can ADMINISTER a company — never the staff list.
-- A platform owner still cannot see who works at a customer, what they earn, or
-- when they clocked in.
CREATE OR REPLACE FUNCTION public.platform_company_access(p_company_id uuid)
RETURNS TABLE (
  -- The invite's id, NULL for someone who has already accepted. Needed because
  -- revoking is done from this list, and a list you cannot act on is a report.
  -- The first version omitted it, which made platform_revoke_invite unreachable
  -- from the console it exists to serve.
  invite_id   uuid,
  kind        text,     -- 'active' | 'pending'
  role        text,
  full_name   text,
  email       text,
  status      text,
  since       timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_platform_owner((SELECT auth.uid())) THEN
    RAISE EXCEPTION 'Only BYOND platform owners can view company access';
  END IF;

  RETURN QUERY
  SELECT NULL::uuid, 'active'::text, ur.role, e.full_name, e.email, e.status, ur.assigned_at
    FROM user_roles ur
    JOIN employees e ON e.id = ur.employee_id
   WHERE ur.company_id = p_company_id
     AND ur.role IN ('super_admin', 'hr_manager', 'admin')
  UNION ALL
  SELECT i.id, 'pending'::text, i.role, e.full_name, i.email, i.status, i.created_at
    FROM employee_invites i
    LEFT JOIN employees e ON e.id = i.employee_id
   WHERE i.company_id = p_company_id
     AND i.status = 'pending'
     AND i.role IN ('super_admin', 'hr_manager', 'admin')
  ORDER BY 1, 2;
END;
$function$;

CREATE OR REPLACE FUNCTION public.platform_revoke_invite(p_invite_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_n integer;
BEGIN
  IF NOT public.is_platform_owner((SELECT auth.uid())) THEN
    RAISE EXCEPTION 'Only BYOND platform owners can revoke an invite';
  END IF;

  UPDATE employee_invites SET status = 'revoked'
   WHERE id = p_invite_id AND status = 'pending';
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- Reported rather than silently succeeding. An UPDATE that matched nothing
  -- returns success in Postgres, so without this a revoke of an already-accepted
  -- invite would look like it worked.
  IF v_n = 0 THEN
    RAISE EXCEPTION 'That invite is not pending — it may already be accepted, revoked or expired';
  END IF;

  RETURN jsonb_build_object('revoked', true);
END;
$function$;

-- anon has no business with any of these. authenticated keeps EXECUTE because a
-- platform owner is an ordinary authenticated user and the refusal inside each
-- function is what separates them.
REVOKE EXECUTE ON FUNCTION public.platform_create_company(text,text,text,text,text,text,integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.platform_company_access(uuid)  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.platform_revoke_invite(uuid)   FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.platform_create_company(text,text,text,text,text,text,integer) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.platform_company_access(uuid)  TO authenticated;
GRANT  EXECUTE ON FUNCTION public.platform_revoke_invite(uuid)   TO authenticated;

-- Verification.
SELECT 'super_admin now allowed by invite CHECK' AS check,
       (pg_get_constraintdef(c.oid) ~ 'super_admin')::text AS value
FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
WHERE t.relname = 'employee_invites' AND c.conname = 'employee_invites_role_check'
UNION ALL
-- The tenant path must be unchanged: create_employee_invite still refuses it.
SELECT 'create_employee_invite still refuses super_admin',
       (p.prosrc ~ 'Invalid role for invite')::text
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'create_employee_invite'
UNION ALL
SELECT 'anon can call platform_create_company (must be false)',
       has_function_privilege('anon',
         'public.platform_create_company(text,text,text,text,text,text,integer)', 'EXECUTE')::text;
