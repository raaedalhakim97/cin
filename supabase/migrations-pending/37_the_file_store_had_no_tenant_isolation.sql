-- ⚠️  NOT APPLIED. This is the one migration in this repo that cannot be applied from
--     a database connection, and it is in migrations-pending rather than
--     migrations-applied for that reason.
--
--     Attempting it returns:
--
--         ERROR: 42501: must be owner of table objects
--
--     storage.objects is owned by supabase_storage_admin. Supabase's `postgres` role is
--     not a superuser (rolsuper = false) and is not a member of that role
--     (pg_has_role(..., 'supabase_storage_admin', 'MEMBER') = false), and CREATE POLICY
--     requires ownership. The Dashboard SQL editor connects as the same `postgres` role,
--     so it fails there too.
--
--     TO APPLY — Supabase Dashboard, and only from there:
--
--       1. Storage → Policies → hr-documents → New policy, four times (SELECT, INSERT,
--          UPDATE, DELETE), pasting the USING / WITH CHECK expressions below.
--       2. Storage → New bucket → 'employee-photos'. Private. 2 MB limit. Allowed MIME
--          types image/jpeg, image/png, image/webp.
--       3. Storage → Policies → employee-photos → New policy, four times, same way.
--
--     Then tell me and I will verify the policies landed and finish the photo upload,
--     which is deliberately not built until this bucket has isolation.
--
-- ────────────────────────────────────────────────────────────────────────────

-- storage.objects had row level security enabled and not a single policy on it.
--
-- Found while starting work on employee photo upload, by checking what protects the
-- bucket the photos would live in.
--
-- ── What was measured ──────────────────────────────────────────────────────
--
--   storage.objects   rls_enabled = true, policies = 0, force_rls = false,
--                     owner = supabase_storage_admin
--   bucket            'hr-documents', public = false, no size limit, no mime allowlist
--   contents          one real file, at
--                     {company_id}/employee/{doc_id}/BYOND-HR_Access_Control_Standard.pdf
--
-- UploadDocumentModal.jsx says, in a comment beside the upload call:
--
--     "upload to the tenant-isolated path — storage RLS checks the
--      first path segment against the caller's company_id"
--
-- There were no policies. Nothing checked the first path segment, or any other part of
-- the path, because there was nothing to do the checking. Whatever has been protecting
-- those files, it is not the mechanism the code says it is — and that bucket is where
-- passports, national IDs and residence visas go.
--
-- I could not test the storage HTTP API from the build container: egress to
-- *.supabase.co is blocked by the proxy, and the storage service is reached over HTTPS
-- rather than SQL. So this migration states what is certain and does not guess at the
-- rest. What is certain: policy-based isolation cannot exist with zero policies, and
-- after this migration it does exist.
--
-- If the storage service turns out to bypass these policies as the table owner, they
-- cost nothing and the picture is unchanged. If it respects them — which is the
-- documented behaviour — this closes a cross-tenant read of every HR document on the
-- platform. Either way the comment in the code becomes true.

-- ── hr-documents ───────────────────────────────────────────────────────────
-- Path convention, set by UploadDocumentModal.jsx:
--   {company_id}/{scope}/{document_id}/{filename}
-- so folder segment 1 is the tenant, and that is the whole of the check.

DROP POLICY IF EXISTS hr_documents_objects_read   ON storage.objects;
DROP POLICY IF EXISTS hr_documents_objects_insert ON storage.objects;
DROP POLICY IF EXISTS hr_documents_objects_update ON storage.objects;
DROP POLICY IF EXISTS hr_documents_objects_delete ON storage.objects;

CREATE POLICY hr_documents_objects_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'hr-documents'
    AND (storage.foldername(name))[1] = public.get_user_company_id((SELECT auth.uid()))::text
  );

CREATE POLICY hr_documents_objects_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'hr-documents'
    AND (storage.foldername(name))[1] = public.get_user_company_id((SELECT auth.uid()))::text
  );

-- Both sides on UPDATE: USING decides which rows you may touch, WITH CHECK decides what
-- they may become. Without the second, a caller could move a file out of their own
-- company's folder and into someone else's.
CREATE POLICY hr_documents_objects_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'hr-documents'
    AND (storage.foldername(name))[1] = public.get_user_company_id((SELECT auth.uid()))::text
  )
  WITH CHECK (
    bucket_id = 'hr-documents'
    AND (storage.foldername(name))[1] = public.get_user_company_id((SELECT auth.uid()))::text
  );

CREATE POLICY hr_documents_objects_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'hr-documents'
    AND (storage.foldername(name))[1] = public.get_user_company_id((SELECT auth.uid()))::text
  );

-- ── employee-photos ────────────────────────────────────────────────────────
-- A new bucket for the profile photo upload that Profile.jsx has been promising and
-- not delivering ("Photo uploads aren't available yet"). Created with its limits and
-- its policies in the same migration, so it never exists in the unprotected state the
-- documents bucket has been in.
--
-- Private, not public. A face is personal data under both PDPL and GDPR, and a public
-- bucket means anyone holding the URL can see it forever, including after the person
-- leaves. Reads go through a signed URL, exactly as HR documents do.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'employee-photos', 'employee-photos', false,
  2097152,                                            -- 2 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']      -- enforced by storage, not by the browser
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Path convention: {company_id}/{employee_id}/{filename}
DROP POLICY IF EXISTS employee_photos_read   ON storage.objects;
DROP POLICY IF EXISTS employee_photos_write  ON storage.objects;
DROP POLICY IF EXISTS employee_photos_update ON storage.objects;
DROP POLICY IF EXISTS employee_photos_delete ON storage.objects;

-- Anyone in the company may see a colleague's photo. That is the point of a photo in an
-- HR directory, and it is the same scope the employee list already has.
CREATE POLICY employee_photos_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'employee-photos'
    AND (storage.foldername(name))[1] = public.get_user_company_id((SELECT auth.uid()))::text
  );

-- Writing is narrower than reading: your own photo, or anyone's if you are HR. A
-- department manager may see the directory but has no business replacing someone's face.
CREATE POLICY employee_photos_write ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'employee-photos'
    AND (storage.foldername(name))[1] = public.get_user_company_id((SELECT auth.uid()))::text
    AND (
      (storage.foldername(name))[2] = (
        SELECT e.id::text FROM public.employees e WHERE e.user_id = (SELECT auth.uid())
      )
      OR public.get_user_role((SELECT auth.uid())) IN ('super_admin', 'hr_manager')
    )
  );

CREATE POLICY employee_photos_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'employee-photos'
    AND (storage.foldername(name))[1] = public.get_user_company_id((SELECT auth.uid()))::text
    AND (
      (storage.foldername(name))[2] = (
        SELECT e.id::text FROM public.employees e WHERE e.user_id = (SELECT auth.uid())
      )
      OR public.get_user_role((SELECT auth.uid())) IN ('super_admin', 'hr_manager')
    )
  )
  WITH CHECK (
    bucket_id = 'employee-photos'
    AND (storage.foldername(name))[1] = public.get_user_company_id((SELECT auth.uid()))::text
    AND (
      (storage.foldername(name))[2] = (
        SELECT e.id::text FROM public.employees e WHERE e.user_id = (SELECT auth.uid())
      )
      OR public.get_user_role((SELECT auth.uid())) IN ('super_admin', 'hr_manager')
    )
  );

CREATE POLICY employee_photos_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'employee-photos'
    AND (storage.foldername(name))[1] = public.get_user_company_id((SELECT auth.uid()))::text
    AND (
      (storage.foldername(name))[2] = (
        SELECT e.id::text FROM public.employees e WHERE e.user_id = (SELECT auth.uid())
      )
      OR public.get_user_role((SELECT auth.uid())) IN ('super_admin', 'hr_manager')
    )
  );

-- ── A limit the documents bucket still lacks ───────────────────────────────
-- hr-documents has no size limit and no mime allowlist, so it will accept a 5 GB file
-- of any type. Left alone here rather than changed in the same migration as the policy
-- work: tightening it is a product decision about what a customer may upload, not a
-- security fix, and it belongs in a change where that decision is the subject.
COMMENT ON TABLE storage.objects IS
  'Tenant isolation for hr-documents and employee-photos is enforced by the policies added in migration 37, keyed on the first path segment being the company id.';
