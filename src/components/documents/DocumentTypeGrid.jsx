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
  valid:             { label: 'Valid',              cls: 'bg-[#00D4A0]/10 text-accent' },
  expiring_soon:     { label: 'Expiring Soon',       cls: 'bg-[#FF8C42]/10 text-[#FF8C42]' },
  expiring_critical: { label: 'Expiring Critical',   cls: 'bg-danger/10 text-danger' },
  expired:           { label: 'Expired',             cls: 'bg-danger/10 text-danger' },
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
        missing ? 'border-danger/40' : 'border-[#E8E8E8] dark:border-[#2A2A2A]'
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
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-[#062B22] bg-[#00D4A0] hover:bg-[#00B589] transition-colors"
          >
            {doc ? <RefreshCw size={12} /> : <Upload size={12} />} {doc ? 'Replace' : 'Upload'}
          </button>
        )}
      </div>
    </div>
  )
}

// The compact card /profile uses. Same data, a quarter of the height.
//
// The full card spends most of its height on a category line ("identity · Required") that
// is a filing concern rather than the employee's, and on two full-width buttons. What the
// person wants from their own profile is whether the document is on file and, if it
// expires, when — so the card carries that, and the actions ride on the card itself.
//
// canManage is passed through rather than assumed false. /profile hardcoded false until
// Raaed found she could not add her own passport on her own profile while being able to
// add it from her employee record two screens away; hr_documents_write has always allowed
// her. An ordinary employee still gets no controls, because the policy does not list them.
//
// Deliberately not a separate component file. It shares EXPIRY_META and formatDate with
// the full card, and two documents-status vocabularies that could drift apart is exactly
// the kind of duplication this codebase keeps removing.
function CompactTypeCard({ type, doc, canManage, onUpload, onDownload, downloading }) {
  const onFile = Boolean(doc)
  const missing = !doc && type.is_required

  const status = doc
    ? doc.expiry_date
      ? `Expires ${formatDate(doc.expiry_date)}`
      : 'On file'
    : missing
      ? 'Required — not on file'
      : 'Not on file'

  // One tap does the obvious thing: open it if it is there, add it if it is not and you
  // are allowed to. A card that is neither openable nor uploadable is inert on purpose —
  // it still reports the gap, which is most of its job.
  const primary = doc ? () => onDownload(doc) : (canManage ? onUpload : null)

  const Element = primary ? 'button' : 'div'

  return (
    <Element
      {...(primary
        ? {
            onClick: primary,
            disabled: downloading,
            title: doc ? `Open ${type.label}` : `Upload ${type.label}`,
            type: 'button',
          }
        : {})}
      className={`w-full text-left p-4 rounded-xl bg-white dark:bg-[#1E1E1E] border transition-colors ${
        missing ? 'border-danger/40' : 'border-[#E8E8E8] dark:border-[#2A2A2A]'
      } ${primary ? 'hover:border-[#00D4A0]/40 cursor-pointer' : ''} disabled:opacity-60`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white truncate">{type.label}</p>
        {downloading ? (
          <Loader2 size={12} className="animate-spin text-[#00D4A0] shrink-0 mt-1" />
        ) : !doc && canManage ? (
          <Upload size={12} className="text-[#00D4A0] shrink-0 mt-1" />
        ) : (
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${
              onFile ? 'bg-[#00D4A0]' : missing ? 'bg-danger' : 'bg-[#A0A0A0]/50'
            }`}
          />
        )}
      </div>
      <p
        className={`text-xs mt-1 truncate ${
          missing ? 'text-danger' : 'text-[#666666] dark:text-[#A0A0A0]'
        }`}
      >
        {status}
      </p>

      {/* Replacing is a second action, so it gets a second control rather than stealing
          the tap that opens the document. */}
      {doc && canManage && (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); onUpload() }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onUpload() } }}
          className="inline-flex items-center gap-1 mt-2 text-[11px] text-[#666666] dark:text-[#A0A0A0]
                     hover:text-[#00806A] dark:hover:text-[#00D4A0] transition-colors cursor-pointer"
        >
          <RefreshCw size={10} /> Replace
        </span>
      )}
    </Element>
  )
}

// Shared by Documents.jsx (Company + Employee tabs), EmployeeDetail.jsx's
// Documents tab and /profile — one card per active document_type for the given
// scope, even when nothing has been uploaded yet, so missing required docs are
// visible rather than just absent from the list.
//
// variant 'compact' is the read-only presentation /profile uses. onSummary reports
// { total, onFile } after every fetch so the caller can show a count without running the
// same two queries a second time — the identity band's DOCUMENTS fact is that number, and
// a page that asked the database twice for one figure could show two different answers.
export default function DocumentTypeGrid({
  scope, employeeId, companyId, currentEmployeeId, canManage, showToast,
  variant = 'full', onSummary,
}) {
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
    const t = typeRows ?? []
    const d = docRows ?? []
    setTypes(t)
    setDocs(d)
    setLoading(false)

    // Counted against the type list rather than against docs.length: a document whose
    // type has since been deactivated still has a row, and counting it would report more
    // documents on file than the grid draws.
    const byType = new Set(d.map((r) => r.document_type_id))
    onSummary?.({
      total: t.length,
      onFile: t.filter((ty) => byType.has(ty.id)).length,
    })
    // onSummary is a dependency, so a caller passing an inline arrow would re-run this
    // fetch on every render of its parent — a query loop, since the summary sets state up
    // there. Callers pass a useCallback-stable function; /profile does.
  }, [scope, employeeId, onSummary])

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

  const compact = variant === 'compact'

  if (loading) {
    return (
      <div
        className={`grid gap-4 animate-pulse ${
          compact
            ? 'grid-cols-2 lg:grid-cols-4'
            : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
        }`}
      >
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <SkeletonBlock key={i} className={compact ? 'h-20' : 'h-40'} />
        ))}
      </div>
    )
  }

  const existingDocsByType = Object.fromEntries(docs.map((d) => [d.document_type_id, d]))
  const modalType = modalTypeId ? types.find((t) => t.id === modalTypeId) ?? null : null

  return (
    <div
      className={`grid gap-4 ${
        compact ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
      }`}
    >
      {types.map((type) => {
        const doc = existingDocsByType[type.id] ?? null
        const downloading = downloadingId === doc?.id
        return compact ? (
          <CompactTypeCard
            key={type.id}
            type={type}
            doc={doc}
            canManage={canManage}
            onUpload={() => setModalTypeId(type.id)}
            onDownload={handleDownload}
            downloading={downloading}
          />
        ) : (
          <TypeCard
            key={type.id}
            type={type}
            doc={doc}
            canManage={canManage}
            onUpload={() => setModalTypeId(type.id)}
            onDownload={handleDownload}
            downloading={downloading}
          />
        )
      })}

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
