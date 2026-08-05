import { useCallback, useEffect, useState } from 'react'
import { FileText, Upload, RefreshCw, Download, Loader2 } from 'lucide-react'
import supabase from '../../services/supabase'
import { maskDocumentNumber } from '../../utils/security'
import { SkeletonBlock } from '../Skeleton'
import UploadDocumentModal from './UploadDocumentModal'

// Mirrors hr_documents_with_status.expiry_status — duplicated locally per
// this codebase's established per-file convention for small display-only
// lookup maps (see EmployeeDashboard.jsx's RATING_META).
const EXPIRY_META = {
  valid:             { label: 'Valid',              cls: 'bg-[#00D4A0]/10 text-[#00D4A0]' },
  expiring_soon:     { label: 'Expiring Soon',       cls: 'bg-[#FF8C42]/10 text-[#FF8C42]' },
  expiring_critical: { label: 'Expiring Critical',   cls: 'bg-[#FF4D4D]/10 text-[#FF4D4D]' },
  expired:           { label: 'Expired',             cls: 'bg-[#FF4D4D]/10 text-[#FF4D4D]' },
  no_expiry:         { label: 'No Expiry',           cls: 'bg-[#4D9FFF]/10 text-[#4D9FFF]' },
  missing:           { label: 'Missing',             cls: 'bg-[#A0A0A0]/10 text-[#666666] dark:text-[#A0A0A0]' },
}

function formatDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function TypeCard({ type, doc, canManage, onUpload, onDownload, downloading }) {
  const missing = !doc && type.is_required
  const meta = doc ? EXPIRY_META[doc.expiry_status] : (missing ? EXPIRY_META.missing : null)

  return (
    <div
      className={`p-5 rounded-xl bg-white dark:bg-[#1E1E1E] border ${
        missing ? 'border-[#FF4D4D]/40' : 'border-[#E8E8E8] dark:border-[#2A2A2A]'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-[#00D4A0]/10 flex items-center justify-center shrink-0">
            <FileText size={16} className="text-[#00D4A0]" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white truncate">{type.label}</p>
            <p className="text-xs text-[#666666] dark:text-[#A0A0A0] capitalize">
              {type.category}{type.is_required ? ' · Required' : ''}
            </p>
          </div>
        </div>
        {meta && (
          <span className={`shrink-0 px-2.5 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${meta.cls}`}>
            {meta.label}
          </span>
        )}
      </div>

      {doc ? (
        <div className="space-y-1 mb-4 text-xs text-[#666666] dark:text-[#A0A0A0]">
          {doc.document_number && (
            <p>No. <span className="font-mono text-[#1A1A1A] dark:text-white">{maskDocumentNumber(doc.document_number)}</span></p>
          )}
          <p>{doc.expiry_date ? `Expires ${formatDate(doc.expiry_date)}` : 'No expiry date'}</p>
        </div>
      ) : (
        <p className="text-xs text-[#AAAAAA] dark:text-[#555555] mb-4">Not uploaded yet</p>
      )}

      <div className="flex items-center gap-2">
        {doc && (
          <button
            onClick={() => onDownload(doc)}
            disabled={downloading}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-[#666666] dark:text-[#A0A0A0] border border-[#E8E8E8] dark:border-[#2A2A2A] hover:text-[#1A1A1A] dark:hover:text-white hover:border-[#00D4A0]/40 disabled:opacity-50 transition-colors"
          >
            {downloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} View
          </button>
        )}
        {canManage && (
          <button
            onClick={onUpload}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] transition-colors"
          >
            {doc ? <RefreshCw size={12} /> : <Upload size={12} />} {doc ? 'Replace' : 'Upload'}
          </button>
        )}
      </div>
    </div>
  )
}

// Shared by Documents.jsx (Company + Employee tabs) and EmployeeDetail.jsx's
// Documents tab — one card per active document_type for the given scope,
// even when nothing has been uploaded yet, so missing required docs are
// visible rather than just absent from the list.
export default function DocumentTypeGrid({ scope, employeeId, companyId, currentEmployeeId, canManage, showToast }) {
  const [types, setTypes] = useState([])
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalTypeId, setModalTypeId] = useState(null)
  const [downloadingId, setDownloadingId] = useState(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    let docsQuery = supabase.from('hr_documents_with_status').select('*').eq('scope', scope)
    docsQuery = scope === 'employee' ? docsQuery.eq('employee_id', employeeId) : docsQuery.is('employee_id', null)

    const [{ data: typeRows }, { data: docRows }] = await Promise.all([
      supabase.from('document_types').select('*').eq('scope', scope).eq('active', true).order('sort_order'),
      docsQuery,
    ])
    setTypes(typeRows ?? [])
    setDocs(docRows ?? [])
    setLoading(false)
  }, [scope, employeeId])

  useEffect(() => {
    if (scope === 'employee' && !employeeId) {
      setTypes([])
      setDocs([])
      setLoading(false)
      return
    }
    fetchData()
  }, [fetchData, scope, employeeId])

  async function handleDownload(doc) {
    setDownloadingId(doc.id)
    const { data, error } = await supabase.storage.from('hr-documents').createSignedUrl(doc.storage_path, 60)
    setDownloadingId(null)
    if (error || !data?.signedUrl) {
      console.error('[DocumentTypeGrid] createSignedUrl failed', error)
      showToast('error', 'Something went wrong opening this document. Please try again.')
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  if (scope === 'employee' && !employeeId) return null

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 animate-pulse">
        {[0, 1, 2, 3, 4, 5].map((i) => <SkeletonBlock key={i} className="h-40" />)}
      </div>
    )
  }

  const existingDocsByType = Object.fromEntries(docs.map((d) => [d.document_type_id, d]))
  const modalType = modalTypeId ? types.find((t) => t.id === modalTypeId) ?? null : null

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {types.map((type) => (
        <TypeCard
          key={type.id}
          type={type}
          doc={existingDocsByType[type.id] ?? null}
          canManage={canManage}
          onUpload={() => setModalTypeId(type.id)}
          onDownload={handleDownload}
          downloading={downloadingId === (existingDocsByType[type.id]?.id)}
        />
      ))}

      {modalType && (
        <UploadDocumentModal
          allTypes={types}
          existingDocsByType={existingDocsByType}
          initialTypeId={modalType.id}
          scope={scope}
          employeeId={employeeId}
          companyId={companyId}
          currentEmployeeId={currentEmployeeId}
          onClose={() => setModalTypeId(null)}
          onUploaded={fetchData}
          showToast={showToast}
        />
      )}
    </div>
  )
}
