-- Three corrections to the operator console's readers, all found while building the
-- company file page.
--
-- 1. `position` is a reserved word in a RETURNS TABLE signature — legal as a column
--    in CREATE TABLE, a syntax error in a function's result columns. Renamed while
--    company_contacts was still empty rather than leaving a column that needs
--    quoting in half the places it is used.
--
-- 2. platform_company_access under-reported administrators, and contradicted the
--    overview on the same screen: the table said "3 owners", the panel showed one
--    name. It joined employees on user_roles.employee_id, which is an optional
--    convenience column and was NULL on 6 of 9 rows. The dependable link is
--    employees.user_id — what authStore and every RLS policy use to resolve a person
--    from a session.
--
--    Now a LEFT JOIN, deliberately: an administrator with no employee record still
--    appears, because that state is worth seeing. It is exactly the "your login is
--    not linked to an employee record" wall a customer hits, and a console that
--    hides it makes that support call harder rather than easier.
--
-- 3. Company-scoped documents were invisible to an operator. hr_documents already
--    supports scope='company' with employee_id NULL — the trade licence, the VAT
--    certificate, the signed contract — but its policies are tenant-scoped, so a
--    platform owner saw none of them.

ALTER TABLE public.company_contacts RENAME COLUMN position TO position_title;

DROP FUNCTION IF EXISTS public.platform_company_access(uuid);

CREATE OR REPLACE FUNCTION public.platform_company_access(p_company_id uuid)
RETURNS TABLE (
  invite_id      uuid,
  kind           text,
  role           text,
  full_name      text,
  position_title text,
  email          text,
  status         text,
  since          timestamptz
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
  SELECT NULL::uuid,
         'active'::text,
         ur.role,
         coalesce(e.full_name, '(no employee record)'),
         e.job_title,
         coalesce(e.email, u.email),
         coalesce(e.status, 'unlinked'),
         ur.assigned_at
    FROM user_roles ur
    LEFT JOIN employees e ON e.user_id = ur.user_id AND e.company_id = ur.company_id
    LEFT JOIN auth.users u ON u.id = ur.user_id
   WHERE ur.company_id = p_company_id
     AND ur.role IN ('super_admin', 'hr_manager', 'admin')
  UNION ALL
  SELECT i.id,
         'pending'::text,
         i.role,
         coalesce(e.full_name, '(not yet created)'),
         e.job_title,
         i.email,
         i.status,
         i.created_at
    FROM employee_invites i
    LEFT JOIN employees e ON e.id = i.employee_id
   WHERE i.company_id = p_company_id
     AND i.status = 'pending'
     AND i.role IN ('super_admin', 'hr_manager', 'admin')
  ORDER BY 2, 3;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.platform_company_access(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.platform_company_access(uuid) TO authenticated;

-- Metadata only, deliberately: never storage_path. Knowing a document exists and
-- being able to open it are different permissions — the path is what a signed URL
-- is minted from — and BYOND does not need the second one to run the platform.
CREATE OR REPLACE FUNCTION public.platform_company_documents(p_company_id uuid)
RETURNS TABLE (
  id           uuid,
  label        text,
  file_name    text,
  mime_type    text,
  size_bytes   bigint,
  issue_date   date,
  expiry_date  date,
  status       text,
  uploaded_at  timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_platform_owner((SELECT auth.uid())) THEN
    RAISE EXCEPTION 'Only BYOND platform owners can list company documents';
  END IF;

  RETURN QUERY
  SELECT d.id, dt.label, d.file_name, d.mime_type, d.file_size_bytes::bigint,
         d.issue_date, d.expiry_date, d.status, d.uploaded_at
    FROM hr_documents d
    LEFT JOIN document_types dt ON dt.id = d.document_type_id
   WHERE d.company_id = p_company_id
     AND d.scope = 'company'
   ORDER BY d.uploaded_at DESC;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.platform_company_documents(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.platform_company_documents(uuid) TO authenticated;

-- Verification: the overview's owner count and the access list must not disagree by
-- more than the ops-coordinator rows, and neither reader may be reachable by anon.
SELECT 'anon can call access (must be false)' AS check,
       has_function_privilege('anon','public.platform_company_access(uuid)','EXECUTE')::text AS value
UNION ALL
SELECT 'anon can call documents (must be false)',
       has_function_privilege('anon','public.platform_company_documents(uuid)','EXECUTE')::text
UNION ALL
SELECT 'user_roles rows with NULL employee_id (why the join changed)',
       (SELECT count(*)::text FROM user_roles WHERE employee_id IS NULL);
