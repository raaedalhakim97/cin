-- The operator console's one and only data source.
--
-- Everything else in this database answers "what may THIS company see". This
-- function deliberately answers across all of them, which makes it the single
-- most dangerous function in the schema and the reason it is written the way it
-- is.
--
-- Three rules it follows, and they are the whole design:
--
--   1. It refuses anyone who is not a platform owner. First statement, before a
--      single row is read. SECURITY DEFINER means RLS does not apply inside, so
--      this check IS the access control — there is no second line of defence.
--
--   2. It returns counts and dates. Never a name, never a salary, never a
--      national ID, never an email. A console that cannot read a salary cannot
--      leak one, and that property is worth more than any dashboard tile. If a
--      future column here would identify a person, it belongs in the tenant app,
--      not the console.
--
--   3. It is called with no arguments. Nothing about which company to read is
--      caller-supplied, so there is no argument to tamper with. That is the
--      lesson from migration 18, where two helpers took p_company_id and trusted
--      it: the arguments alone decided what was read, and anon could call them.
--
-- "Server health" is deliberately absent. All tenants share one Postgres and one
-- Supabase project, so there is no per-company server to report on — a single
-- number repeated down every row would imply otherwise. What varies per company
-- is activity, and that is what last_clock_in and clock_ins_30d measure: a tenant
-- with no punches in a month is dying, which is the signal actually worth having.

CREATE OR REPLACE FUNCTION public.platform_company_overview()
RETURNS TABLE (
  company_id        uuid,
  name              text,
  plan              text,
  country           text,
  currency          text,
  created_at        timestamptz,
  created_via       text,
  trial_ends_at     timestamptz,
  trial_days_left   integer,
  employees_total   integer,
  employees_active  integer,
  employees_invited integer,
  login_accounts    integer,
  owners            integer,
  last_clock_in     date,
  clock_ins_30d     integer,
  work_locations    integer,
  open_leave        integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Rule 1. Not a filter — a refusal. A caller who is not a platform owner gets
  -- an error, not an empty set, because an empty set is indistinguishable from
  -- "no companies yet" and would hide a broken permission check.
  IF NOT public.is_platform_owner((SELECT auth.uid())) THEN
    RAISE EXCEPTION 'Not a platform owner';
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.name,
    c.plan,
    c.country,
    c.currency,
    c.created_at,
    c.created_via,
    c.trial_ends_at,
    CASE WHEN c.trial_ends_at IS NULL THEN NULL
         ELSE GREATEST(0, (c.trial_ends_at::date - CURRENT_DATE))::integer END,

    (SELECT count(*)::integer FROM employees e WHERE e.company_id = c.id),
    (SELECT count(*)::integer FROM employees e WHERE e.company_id = c.id AND e.status = 'active'),
    (SELECT count(*)::integer FROM employees e WHERE e.company_id = c.id AND e.status = 'invited'),
    -- How many people can actually sign in. Diverges from employees_total when
    -- records exist that were never linked to an account, which is the state that
    -- produces "Account not linked" on someone's first login.
    (SELECT count(*)::integer FROM employees e WHERE e.company_id = c.id AND e.user_id IS NOT NULL),
    -- A tenant with zero owners cannot administer itself and will be in touch.
    (SELECT count(*)::integer FROM user_roles ur
      WHERE ur.company_id = c.id AND ur.role IN ('super_admin','hr_manager')),

    (SELECT max(a.date) FROM attendance a WHERE a.company_id = c.id),
    (SELECT count(*)::integer FROM attendance a
      WHERE a.company_id = c.id AND a.date >= CURRENT_DATE - 30),
    -- Zero means the geofence cannot be enforced however the setting is toggled,
    -- so clock_in_distance_m is null on every punch.
    (SELECT count(*)::integer FROM work_locations w WHERE w.company_id = c.id),
    (SELECT count(*)::integer FROM leave_requests l
      WHERE l.company_id = c.id AND l.status IN ('pending','manager_approved'))
  FROM company c
  ORDER BY c.name;
END;
$function$;

-- anon has no business here at all. authenticated must keep EXECUTE — a platform
-- owner is an ordinary authenticated user, and the refusal above is what
-- separates them. Revoking from authenticated would break the console rather
-- than harden it.
REVOKE EXECUTE ON FUNCTION public.platform_company_overview() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.platform_company_overview() FROM anon;
GRANT  EXECUTE ON FUNCTION public.platform_company_overview() TO authenticated;

-- Verification.
SELECT 'anon can call (must be false)' AS check,
       has_function_privilege('anon','public.platform_company_overview()','EXECUTE')::text AS value
UNION ALL
SELECT 'authenticated can call (must be true)',
       has_function_privilege('authenticated','public.platform_company_overview()','EXECUTE')::text
UNION ALL
-- Guards against the return type quietly gaining a personal-data column later.
SELECT 'personal-data columns in return type (must be 0)',
       (SELECT count(*)::text
        FROM unnest(string_to_array(pg_get_function_result(p.oid), ',')) AS col
        WHERE col ~* '(salary|national_id|bank_account|iban|passport|phone|email|full_name)')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public' AND p.proname='platform_company_overview';
