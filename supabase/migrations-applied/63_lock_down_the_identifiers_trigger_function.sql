-- employee_identifiers_row_fits_country is a trigger function — it only ever runs as a
-- BEFORE trigger, where it reads NEW. Called as an RPC it has no NEW and is useless, but by
-- default CREATE FUNCTION grants EXECUTE to PUBLIC, so the security advisor flagged it as
-- callable by anon and authenticated over /rest/v1/rpc. migration 52's equivalent
-- (employee_pay_fits_the_country) has EXECUTE revoked; this matches it. The trigger keeps
-- firing regardless — trigger execution does not consult EXECUTE privileges.
--
-- Applied to production 2026-09-22.
REVOKE EXECUTE ON FUNCTION public.employee_identifiers_row_fits_country() FROM PUBLIC, anon, authenticated;
