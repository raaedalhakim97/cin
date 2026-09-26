-- Changing someone's role from inside the app — for the owner, and only through here.
--
-- Until now a role could only be chosen once, on the invite. Promoting an existing
-- employee to manager meant editing the database by hand, so most companies simply had
-- no managers: measured on production, 9 of 11 people in the review cycle had nobody
-- to rate them. The Managers & teams page calls this to make someone a manager (or
-- anything else) and to take it away again.
--
-- Migration 71 removed direct writes to user_roles, so this is the only door, and it
-- checks what a door should:
--   · the caller is the company's super_admin
--   · the person belongs to the same company and has a login (a role without an account
--     is meaningless — the invite sets it for people who have not joined yet)
--   · nobody changes their own role (the owner cannot lock themselves out by accident)
--   · the last super_admin cannot be demoted
--   · platform ownership is never touched here

CREATE OR REPLACE FUNCTION public.set_employee_role(p_employee_id uuid, p_role text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid     uuid := (SELECT auth.uid());
  v_company uuid;
  v_me      uuid;
  v_target  record;
  v_current text;
BEGIN
  IF get_user_role(v_uid) <> 'super_admin' THEN
    RAISE EXCEPTION 'Only the account owner (super admin) can change roles' USING ERRCODE = '42501';
  END IF;
  IF p_role NOT IN ('employee', 'department_manager', 'hr_manager', 'admin', 'read_only', 'super_admin') THEN
    RAISE EXCEPTION 'Unknown role: %', p_role;
  END IF;

  v_company := get_user_company_id(v_uid);
  SELECT id INTO v_me FROM employees WHERE user_id = v_uid LIMIT 1;

  SELECT e.id, e.full_name, e.user_id INTO v_target
    FROM employees e WHERE e.id = p_employee_id AND e.company_id = v_company;
  IF v_target.id IS NULL THEN RAISE EXCEPTION 'Employee not found'; END IF;
  IF v_target.user_id IS NULL THEN
    RAISE EXCEPTION '% has not joined yet. Choose their role on the invite instead.', v_target.full_name;
  END IF;
  IF v_target.user_id = v_uid THEN
    RAISE EXCEPTION 'You can''t change your own role.';
  END IF;

  SELECT role INTO v_current FROM user_roles WHERE user_id = v_target.user_id AND company_id = v_company;
  IF v_current IS NULL THEN RAISE EXCEPTION '% has no role in this company', v_target.full_name; END IF;
  IF v_current = p_role THEN RETURN p_role; END IF;

  IF v_current = 'super_admin' AND (
       SELECT count(*) FROM user_roles WHERE company_id = v_company AND role = 'super_admin') <= 1 THEN
    RAISE EXCEPTION 'The company needs at least one super admin.';
  END IF;

  UPDATE user_roles
     SET role = p_role, assigned_by = v_uid, assigned_at = now()
   WHERE user_id = v_target.user_id AND company_id = v_company;

  RETURN p_role;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_employee_role(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_employee_role(uuid, text) TO authenticated;
