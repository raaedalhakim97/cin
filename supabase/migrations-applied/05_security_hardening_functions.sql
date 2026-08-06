-- Security hardening pass.
--
-- Correction to an earlier claim in this session: generate_wps_sif,
-- recompute_kpi_totals, anonymize_employee and export_employee_data were
-- reported as unguarded. They are not — each carries an explicit role check.
-- The genuinely open entry point was log_login_attempt.
--
-- 1. Trigger functions must not be callable as RPCs. Every pre-existing
--    trigger function already had EXECUTE revoked; the three added by
--    migrations 02-03 did not, which put them on /rest/v1/rpc/. Calling one
--    would error (no TG_ context), but an exposed SECURITY DEFINER entry
--    point is not something to leave lying around. This is cleanup of a
--    regression introduced by this session's own work.
--
-- 2. distance_metres was created without a fixed search_path. It is pure
--    arithmetic, but an unqualified search_path on a function called from
--    inside a SECURITY DEFINER trigger is exactly the shape that gets
--    exploited by a shadowing function in a writable schema.
--
-- 3. log_login_attempt has to stay anon-callable — a failed sign-in happens
--    before there is a session — but as written it was an unauthenticated,
--    unvalidated, unbounded INSERT. Anyone could fill login_attempts with
--    arbitrary strings, drown real lockout signal in noise, or use it as
--    free storage. It now validates shape and caps one address at 20 writes
--    per minute. The cap returns quietly rather than raising: the caller is
--    a login form, and an attacker learning "you are being rate limited" is
--    worth more to them than a login page that behaves identically either
--    way is worth to us.
--    Verified: 50 calls in one transaction stored 20; malformed, over-length
--    and NULL addresses stored nothing.

REVOKE ALL ON FUNCTION public.attendance_guard()        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_leave_entitlement() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.maintain_leave_balance()  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.distance_metres(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
) RETURNS double precision
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT 6371000 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$function$;

CREATE OR REPLACE FUNCTION public.log_login_attempt(p_email text, p_success boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_email  text := lower(trim(p_email));
  v_recent integer;
BEGIN
  -- Shape check. Not full RFC 5322 — just enough that the column holds
  -- something that could be an address rather than an arbitrary payload.
  IF v_email IS NULL OR length(v_email) < 3 OR length(v_email) > 254
     OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RETURN;
  END IF;

  SELECT count(*) INTO v_recent
  FROM login_attempts
  WHERE email = v_email
    AND attempted_at > now() - interval '1 minute';

  IF v_recent >= 20 THEN
    RETURN;
  END IF;

  INSERT INTO login_attempts (email, success) VALUES (v_email, p_success);
END;
$function$;
