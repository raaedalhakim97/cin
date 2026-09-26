-- A company's super_admin could make themselves a BYOND platform owner.
--
-- Found while building manager assignment. `authenticated` held table-level INSERT and
-- UPDATE on user_roles, every column included, and the roles_update policy only checks
-- that the row stays in the caller's company. So a tenant super_admin could run
--
--   UPDATE user_roles SET is_platform_owner = true WHERE user_id = auth.uid()
--
-- and is_platform_owner() would answer true — the operator console, every company's
-- file, platform_set_plan, all of it. Measured on production inside a rolled-back
-- transaction: rows=1, platform owner before=false after=true.
--
-- The app never writes user_roles from the browser. The three things that do —
-- accept_employee_invite, onboard_company, self_onboard_company — are SECURITY DEFINER
-- and run with the owner's privileges, so taking the privilege away from
-- `authenticated` removes nothing that works today. Role changes from the app go through
-- set_employee_role() (migration 72), which checks what it is allowed to change.
--
-- Two layers, so either alone would have stopped this:
--   1. No direct writes to user_roles from a signed-in session at all.
--   2. A trigger that refuses any change to is_platform_owner unless the person making it
--      is already a platform owner (or it is a maintenance path with no session).

REVOKE INSERT, UPDATE, DELETE ON public.user_roles FROM authenticated, anon;

CREATE OR REPLACE FUNCTION public.guard_platform_owner_flag()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN RETURN NEW; END IF;   -- migrations and service maintenance
  IF (TG_OP = 'INSERT' AND NEW.is_platform_owner)
     OR (TG_OP = 'UPDATE' AND NEW.is_platform_owner IS DISTINCT FROM OLD.is_platform_owner) THEN
    IF NOT public.is_platform_owner(v_uid) THEN
      RAISE EXCEPTION 'Only a BYOND platform owner can grant or remove platform ownership'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_platform_owner_flag() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS aa_guard_platform_owner_flag ON public.user_roles;
CREATE TRIGGER aa_guard_platform_owner_flag
  BEFORE INSERT OR UPDATE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.guard_platform_owner_flag();
