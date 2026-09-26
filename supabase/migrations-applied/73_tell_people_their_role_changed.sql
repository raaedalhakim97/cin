-- Tell someone when their role changes.
--
-- A promotion made on Managers & teams used to arrive silently: the person's menu grew
-- new pages the next time they loaded the app, with nothing saying why. set_employee_role
-- now sends them a notification in plain words — what they can do now, and that each new
-- page has a short guide. The app also re-reads the role while open (RoleWatcher.jsx), so
-- the new pages appear without signing out.
--
-- Applied in two steps on production (the first with a one-minute dedupe window, which
-- the test below this change caught swallowing a quick undo); this file is the end state.
--
-- The notification is inside its own exception block: failing to notify must never undo
-- the role change it is reporting.

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_check CHECK (
  kind = ANY (ARRAY[
    'attendance_late', 'attendance_absent', 'attendance_missing_clockout',
    'attendance_team_late', 'feed_post',
    'leave_submitted', 'leave_manager_approved', 'leave_approved',
    'leave_rejected', 'leave_cancelled',
    'shift_published', 'shift_day_off',
    'review_self_open', 'review_self_due', 'review_manager_open',
    'review_manager_due', 'review_published',
    'review_team_heads_up',
    'review_hr_self_ready', 'review_hr_manager_ready', 'review_hr_publish_ready',
    'role_changed'
  ])
);

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

  -- Tell them. A new role changes what their app shows, and finding a new menu with no
  -- word of why is how people conclude something broke.
  BEGIN
    PERFORM notify_employee(v_company, v_target.id, 'role_changed',
      CASE p_role
        WHEN 'department_manager' THEN 'You''re now a manager'
        WHEN 'hr_manager'         THEN 'You''re now an HR manager'
        WHEN 'super_admin'        THEN 'You''re now an owner of this account'
        WHEN 'admin'              THEN 'You''re now an admin'
        WHEN 'read_only'          THEN 'Your account is now read-only'
        ELSE 'Your role has changed to employee'
      END,
      CASE p_role
        WHEN 'department_manager' THEN 'You can now see your team''s attendance, give the first approval on their leave, and rate them in the quarterly review. A short guide will walk you through each page the first time.'
        WHEN 'hr_manager'         THEN 'You can now manage the whole company''s people, leave, attendance and reviews. A short guide will walk you through each page the first time.'
        WHEN 'super_admin'        THEN 'You have full control of the account, including roles and company settings.'
        WHEN 'admin'              THEN 'You can now run schedules and documents, and view company records.'
        WHEN 'read_only'          THEN 'You can view company records but not change them.'
        ELSE CASE WHEN v_current = 'department_manager'
                  THEN 'You no longer manage a team. Your own records are unchanged.'
                  ELSE 'Your own records are unchanged.' END
      END,
      -- No dedupe window: every change is news. With one, a promotion undone a minute
      -- later would leave the person told only that they were promoted.
      '/dashboard', 'employees', v_target.id, NULL);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'set_employee_role: notification failed for %: %', v_target.id, SQLERRM;
  END;

  RETURN p_role;
END;
$function$;
