-- The free trial becomes a full quarter.
--
-- A business decision, but it has to land here first. self_onboard_company set
-- `now() + interval '14 days'` and its own comment said "matching marketing
-- promise". Changing the website to say "free quarter" without changing this
-- would make the marketing site untrue again — and this time in the one place a
-- customer can check it themselves, on the banner counting down their own trial.
--
-- Three months rather than 90 days: a quarter is the unit the product already
-- thinks in. Review cycles are quarterly, so a company that signs up gets far
-- enough to open a cycle, have people self-assess, have managers score, and see
-- a published result. That is the thing worth evaluating, and a fortnight does
-- not reach it.
--
-- Only the trial length changes. Everything else in the function is untouched.

CREATE OR REPLACE FUNCTION public.self_onboard_company(
  p_company_name text,
  p_full_name text,
  p_country text DEFAULT 'UAE'::text,
  p_currency text DEFAULT 'AED'::text,
  p_timezone text DEFAULT 'Asia/Dubai'::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_email text;
  v_company_id uuid;
  v_dept_hr uuid;
BEGIN
  -- Must be authenticated
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to create a company';
  END IF;

  -- One company per user — blocks tenant spam and re-provisioning
  IF EXISTS (SELECT 1 FROM user_roles WHERE user_id = v_uid) THEN
    RAISE EXCEPTION 'This account already belongs to a company';
  END IF;

  IF p_company_name IS NULL OR btrim(p_company_name) = '' THEN
    RAISE EXCEPTION 'Company name is required';
  END IF;
  IF p_full_name IS NULL OR btrim(p_full_name) = '' THEN
    RAISE EXCEPTION 'Your full name is required';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  -- Provision company. One quarter free, matching what the site promises —
  -- long enough to run a complete review cycle and judge the product on it.
  INSERT INTO company (name, country, currency, timezone, plan, trial_ends_at, created_via)
  VALUES (btrim(p_company_name), p_country, p_currency, p_timezone,
          'trial', now() + interval '3 months', 'self_signup')
  RETURNING id INTO v_company_id;

  -- Default departments
  INSERT INTO departments (name, company_id) VALUES
    ('Human Resources', v_company_id),
    ('Operations', v_company_id),
    ('Finance', v_company_id),
    ('Sales', v_company_id),
    ('Technology', v_company_id)
  RETURNING id INTO v_dept_hr;

  SELECT id INTO v_dept_hr FROM departments
  WHERE company_id = v_company_id AND name = 'Human Resources';

  -- Caller becomes super_admin of their own company
  INSERT INTO user_roles (user_id, role, company_id)
  VALUES (v_uid, 'super_admin', v_company_id);

  -- Create their employee record so the app has a profile to work with
  INSERT INTO employees (company_id, user_id, full_name, email, job_title,
                         department_id, hire_date, status)
  VALUES (v_company_id, v_uid, btrim(p_full_name), v_email, 'Administrator',
          v_dept_hr, CURRENT_DATE, 'active');

  -- kpi_settings + adjustment types are auto-seeded by company_seed_kpi trigger

  RETURN v_company_id;
END;
$function$;
