-- The two four-argument scoring helpers were reachable by anon.
--
-- Both are SECURITY DEFINER, which is correct — they are called from triggers
-- (sync_attendance_score) and from evaluate_kpi_rules_for_company, which run for
-- a company the caller may not belong to. Being SECURITY DEFINER means they run
-- as the owner and RLS does not apply to what they read.
--
-- What was wrong is that EXECUTE was granted to anon and authenticated. Both take
-- p_employee_id AND p_company_id as arguments and neither checks the caller: no
-- auth.uid(), no role test, no company test, no RAISE. So the arguments alone
-- decided what was read.
--
-- Measured on Frankfurt before this migration, as role anon with no JWT at all:
--
--   calculate_attendance_score(<employee>, 2026, 7, <company>)  -> 100
--   calculate_reliability_score(<employee>, 2026, 7, <company>) -> 99.54
--   SELECT ... FROM attendance                                  -> permission denied
--   SELECT ... FROM employees                                   -> permission denied
--
-- The tables were never readable. These functions were the way around them, which
-- makes this a tenant-isolation hole and, because the figures describe an
-- identified person, a personal-data one. An attacker needs the two UUIDs, so it
-- is not mass-harvestable, but anyone who has ever seen an API response or been
-- an admin in one tenant has UUIDs.
--
-- The fix is to stop publishing them. Nothing in the web or mobile client calls
-- either function — checked across src/, mobile/src/ and mobile/app/, where only
-- comments mention them. The three-argument overload of
-- calculate_attendance_score is the caller-facing one and stays: it reads the
-- company from auth.uid() rather than taking it as an argument.
--
-- Revoking does not break the internal callers. Inside a SECURITY DEFINER
-- function the effective user is the owner, so trigger and rules-engine calls are
-- checked against the owner's privileges, not the caller's.

REVOKE EXECUTE ON FUNCTION
  public.calculate_attendance_score(uuid, integer, integer, uuid)
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION
  public.calculate_reliability_score(uuid, integer, integer, uuid)
  FROM anon, authenticated;

-- Belt and braces: PUBLIC is the grant that makes a new function executable by
-- everyone by default, and it is the one people forget. Revoking it here means a
-- future CREATE OR REPLACE that resets privileges does not silently reopen this.
REVOKE EXECUTE ON FUNCTION
  public.calculate_attendance_score(uuid, integer, integer, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION
  public.calculate_reliability_score(uuid, integer, integer, uuid) FROM PUBLIC;

-- Verification. Both must be false for anon and for authenticated; the
-- three-argument overload must stay callable by authenticated, because the KPI
-- screen depends on it and a false there means the application is broken rather
-- than hardened.
SELECT 'anon can call 4-arg attendance score (must be false)' AS check,
       has_function_privilege('anon',
         'public.calculate_attendance_score(uuid,integer,integer,uuid)', 'EXECUTE')::text AS value
UNION ALL SELECT 'authenticated can call 4-arg attendance score (must be false)',
       has_function_privilege('authenticated',
         'public.calculate_attendance_score(uuid,integer,integer,uuid)', 'EXECUTE')::text
UNION ALL SELECT 'anon can call 4-arg reliability score (must be false)',
       has_function_privilege('anon',
         'public.calculate_reliability_score(uuid,integer,integer,uuid)', 'EXECUTE')::text
UNION ALL SELECT 'authenticated can call 4-arg reliability score (must be false)',
       has_function_privilege('authenticated',
         'public.calculate_reliability_score(uuid,integer,integer,uuid)', 'EXECUTE')::text
UNION ALL SELECT 'authenticated can still call 3-arg attendance score (must be true)',
       has_function_privilege('authenticated',
         'public.calculate_attendance_score(uuid,integer,integer)', 'EXECUTE')::text;
