import { useState } from 'react'
import { X, Loader2, Upload as UploadIcon, AlertTriangle, FileText } from 'lucide-react'
import supabase from '../../services/supabase'

const ACCEPTED_MIME = ['application/pdf', 'image/jpeg', 'image/png']
const MAX_BYTES = 10 * 1024 * 1024

const INPUT =
  'w-full px-3.5 py-2.5 text-sm rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0] transition-colors'

const SELECT = INPUT

// Keeps only characters PostgREST/storage paths handle safely — the sanitized
// name becomes part of the storage_path, not just a display label.
function sanitizeFilename(name) {
  return name.trim().replace(/[^a-zA-Z0-9._-]+/g, '_')
}

// Steps 1–4 from the handover contract: insert a placeholder row (to get an
// id), upload to `{company_id}/{scope}/{document_id}/{filename}`, write the
// real storage_path back, then supersede the prior doc of the same type (if
// any). Any failure after the placeholder insert rolls it back so no
// orphaned metadata row is left pointing at a file that was never uploaded.
export default function UploadDocumentModal({
  allTypes,
  existingDocsByType,
  initialTypeId,
  scope,
  employeeId,
  companyId,
  currentEmployeeId,
  onClose,
  onUploaded,
  showToast,
}) {
  const [typeId, setTypeId] = useState(initialTypeId ?? '')
  const [issueDate, setIssueDate] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [documentNumber, setDocumentNumber] = useState('')
  const [notes, setNotes] = useState('')
  const [file, setFile] = useState(null)
  const [fileError, setFileError] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const selectedType = allTypes.find((t) => t.id === typeId) ?? null
  const existingDoc = typeId ? existingDocsByType[typeId] ?? null : null

  function handleFileChange(e) {
    const f = e.target.files?.[0] ?? null
    setFileError('')
    if (!f) {
      setFile(null)
      return
    }
    if (!ACCEPTED_MIME.includes(f.type)) {
      setFileError('Only PDF, JPG, or PNG files are allowed')
      setFile(null)
      return
    }
    if (f.size > MAX_BYTES) {
      setFileError('File must be 10MB or smaller')
      setFile(null)
      return
    }
    setFile(f)
  }

  async function submit(e) {
    e.preventDefault()
    setFormError('')
    if (!typeId) {
      setFormError('Select a document type')
      return
    }
    if (!file) {
      setFormError('Choose a file to upload')
      return
    }
    if (expiryDate && issueDate && expiryDate < issueDate) {
      setFormError('Expiry date must be on or after the issue date')
      return
    }

    setSaving(true)

    // Step 1: placeholder row — needed to get the document id the storage
    // path is keyed on.
    const { data: inserted, error: insertError } = await supabase
      .from('hr_documents')
      .insert({
        company_id: companyId,
        document_type_id: typeId,
        scope,
        employee_id: scope === 'employee' ? employeeId : null,
        storage_path: 'pending',
        file_name: file.name,
        file_size_bytes: file.size,
        mime_type: file.type,
        document_number: documentNumber.trim() || null,
        issue_date: issueDate || null,
        expiry_date: expiryDate || null,
        notes: notes.trim() || null,
        uploaded_by: currentEmployeeId,
      })
      .select('id')
      .single()

    if (insertError || !inserted) {
      console.error('[UploadDocumentModal] placeholder insert failed', insertError)
      setSaving(false)
      showToast('error', 'Something went wrong starting this upload. Please try again.')
      return
    }

    const newId = inserted.id

    try {
      // Step 2: upload to the tenant-isolated path — storage RLS checks the
      // first path segment against the caller's company_id.
      const path = `${companyId}/${scope}/${newId}/${sanitizeFilename(file.name)}`
      const { error: uploadError } = await supabase.storage
        .from('hr-documents')
        .upload(path, file, { contentType: file.type, upsert: false })
      if (uploadError) throw uploadError

      // Step 3: point the row at the real path.
      const { error: pathError } = await supabase
        .from('hr_documents')
        .update({ storage_path: path })
        .eq('id', newId)
      if (pathError) throw pathError

      // Step 4: supersede the prior doc of this type/scope/employee, if any.
      if (existingDoc) {
        const { error: supersedeError } = await supabase
          .from('hr_documents')
          .update({ status: 'superseded' })
          .eq('id', existingDoc.id)
        if (supersedeError) throw supersedeError

        const { error: linkError } = await supabase
          .from('hr_documents')
          .update({ supersedes_id: existingDoc.id, version: (existingDoc.version ?? 1) + 1 })
          .eq('id', newId)
        if (linkError) throw linkError
      }

      showToast('success', existingDoc ? 'Document replaced' : 'Document uploaded')
      onUploaded()
      onClose()
    } catch (err) {
      console.error('[UploadDocumentModal] upload flow failed', err)
      await supabase.from('hr_documents').delete().eq('id', newId)
      showToast('error', 'Something went wrong uploading this document. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md bg-white dark:bg-[#1E1E1E] rounded-2xl border border-[#E8E8E8] dark:border-[#2A2A2A] shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#00D4A0]/10 flex items-center justify-center shrink-0">
              <FileText size={16} className="text-[#00D4A0]" />
            </div>
            <h2 className="text-base font-bold text-[#1A1A1A] dark:text-white">
              {existingDoc ? 'Replace Document' : 'Upload Document'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-[#666666] dark:text-[#A0A0A0] hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Document Type</label>
            <select value={typeId} onChange={(e) => setTypeId(e.target.value)} className={SELECT} required>
              <option value="" disabled>Select a document type…</option>
              {allTypes.map((t) => (
                <option key={t.id} value={t.id}>{t.label}{t.is_required ? ' (Required)' : ''}</option>
              ))}
            </select>
            {existingDoc && (
              <p className="text-xs text-[#FF8C42] mt-1.5">
                A document already exists for this type — uploading will supersede it.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Issue Date</label>
              <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className={INPUT} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">
                Expiry Date {selectedType && !selectedType.has_expiry && <span className="font-normal text-[#AAAAAA] dark:text-[#555555]">(n/a)</span>}
              </label>
              <input
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                disabled={selectedType ? !selectedType.has_expiry : false}
                className={`${INPUT} disabled:opacity-50`}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Document Number</label>
            <input
              type="text"
              value={documentNumber}
              onChange={(e) => setDocumentNumber(e.target.value)}
              placeholder="e.g. passport / permit number"
              className={INPUT}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={2000}
              className={`${INPUT} resize-none`}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">File</label>
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              onChange={handleFileChange}
              className="w-full text-sm text-[#666666] dark:text-[#A0A0A0] file:mr-3 file:px-3.5 file:py-2 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-[#00D4A0]/10 file:text-[#00D4A0] hover:file:bg-[#00D4A0]/20 file:cursor-pointer cursor-pointer"
            />
            <p className="text-[10px] text-[#AAAAAA] dark:text-[#555555] mt-1">PDF, JPG, or PNG · Max 10MB</p>
            {fileError && (
              <p className="flex items-center gap-1.5 text-xs text-[#FF4D4D] mt-1.5">
                <AlertTriangle size={12} className="shrink-0" /> {fileError}
              </p>
            )}
          </div>

          {formError && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-[#FF4D4D]/10 border border-[#FF4D4D]/20 text-sm text-[#FF4D4D]">
              <AlertTriangle size={13} className="shrink-0" /> {formError}
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <UploadIcon size={14} />}
            {saving ? 'Uploading…' : existingDoc ? 'Replace Document' : 'Upload Document'}
          </button>
        </form>
      </div>
    </div>
  )
}
