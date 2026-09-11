import { useCallback, useEffect, useState } from 'react'
import supabase from '../../services/supabase'

// The employee's own photo, in the employee-photos bucket.
//
// ── Why there is no photo_url in the database ──────────────────────────────
//
// employees.photo_url exists and stays unused, because emp_update grants UPDATE to
// super_admin and hr_manager only. An employee cannot write their own row, so they could
// not record where their own photo went.
//
// The obvious fix — let people update their own employees row — is a bad one. RLS decides
// which ROWS you may write, never which COLUMNS, which is the lesson migration 52 was
// built on. A policy saying "you may update your own record" would also let somebody
// change their own job title, hire date, classification and status. Closing that again
// would need a column guard trigger, which is real machinery for a profile picture.
//
// So the path is a convention instead of a stored value:
//
//     employee-photos/{company_id}/{employee_id}/avatar
//
// Nothing has to be written down, because the path is derivable from who you are. The
// storage policies from migration 37 already say who may write there: your own folder, or
// anyone's if you are HR. Whether a photo exists is answered by asking for it.
//
// ── Signed, not public ─────────────────────────────────────────────────────
//
// The bucket is private. A face is personal data under both PDPL and GDPR, and a public
// bucket hands out a URL that works forever — including after the person leaves. Reads go
// through a short-lived signed URL, exactly as HR documents do. A new signed URL is a new
// URL, so a replaced photo is never served from cache.

const BUCKET = 'employee-photos'
const SIGNED_FOR = 60 * 30 // half an hour; long enough to sit on the page, short enough to expire

export const MAX_BYTES = 2 * 1024 * 1024
export const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp']

export function photoPath(companyId, employeeId) {
  if (!companyId || !employeeId) return null
  return `${companyId}/${employeeId}/avatar`
}

export default function useProfilePhoto(companyId, employeeId) {
  const [url, setUrl] = useState(null)
  const [busy, setBusy] = useState(false)
  const path = photoPath(companyId, employeeId)

  const refresh = useCallback(async () => {
    if (!path) return
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_FOR)
    // A missing object is the normal case, not a fault — most people have no photo. It is
    // not logged, because an error line per page load for the expected state trains people
    // to ignore the console.
    setUrl(error ? null : data?.signedUrl ?? null)
  }, [path])

  useEffect(() => { refresh() }, [refresh])

  // Returns an error message for the caller to show, or null on success.
  const upload = useCallback(async (file) => {
    if (!path || !file) return 'No file selected.'
    if (!ACCEPTED.includes(file.type)) return 'Use a JPEG, PNG or WebP image.'
    if (file.size > MAX_BYTES) return 'That image is larger than 2 MB. Try a smaller one.'

    setBusy(true)
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      upsert: true,          // one path per person: a new photo replaces the old one
      contentType: file.type,
      cacheControl: '3600',
    })
    if (error) {
      setBusy(false)
      console.error('[useProfilePhoto] upload failed', error)
      return 'Something went wrong uploading your photo. Please try again.'
    }
    await refresh()
    setBusy(false)
    return null
  }, [path, refresh])

  const remove = useCallback(async () => {
    if (!path) return 'Nothing to remove.'
    setBusy(true)
    const { error } = await supabase.storage.from(BUCKET).remove([path])
    setBusy(false)
    if (error) {
      console.error('[useProfilePhoto] remove failed', error)
      return 'Something went wrong removing your photo. Please try again.'
    }
    setUrl(null)
    return null
  }, [path])

  return { url, busy, upload, remove }
}
