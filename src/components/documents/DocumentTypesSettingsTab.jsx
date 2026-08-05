import { useCallback, useEffect, useState } from 'react'
import { Plus, Pencil, ChevronUp, ChevronDown, X, Check, Loader2, Building2, Users } from 'lucide-react'
import supabase from '../../services/supabase'

const INPUT =
  'w-full px-3.5 py-2.5 text-sm rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0] transition-colors'

const SELECT = INPUT

// Mirrors the document_types_category_check CHECK constraint.
const CATEGORY_OPTIONS = ['identity', 'visa', 'labour', 'health', 'insurance', 'education', 'legal', 'contract', 'other']

function slugify(label) {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

// ─── Add / Edit modal ───────────────────────────────────────────────────────

function TypeModal({ existing, scopeLocked, existingCodes, companyId, nextSortOrder, onClose, onSaved, showToast }) {
  const isEdit = !!existing
  const [label, setLabel] = useState(existing?.label ?? '')
  const [category, setCategory] = useState(existing?.category ?? 'other')
  const [isRequired, setIsRequired] = useState(existing?.is_required ?? false)
  const [hasExpiry, setHasExpiry] = useState(existing?.has_expiry ?? true)
  const [alertDays, setAlertDays] = useState(existing?.default_alert_days ?? 30)
  const [active, setActive] = useState(existing?.active ?? true)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setFormError('')
    if (!label.trim()) { setFormError('Label is required'); return }
    const days = Number(alertDays)
    if (!Number.isFinite(days) || days < 1 || days > 365) { setFormError('Alert days must be between 1 and 365'); return }

    setSaving(true)
    if (isEdit) {
      // Only label/required/alert_days/active are editable on an existing
      // type — scope/category/has_expiry stay fixed once documents may
      // already reference this type.
      const { error } = await supabase
        .from('document_types')
        .update({ label: label.trim(), is_required: isRequired, default_alert_days: days, active })
        .eq('id', existing.id)
      setSaving(false)
      if (error) {
        console.error('[DocumentTypesSettingsTab] update failed', error)
        showToast('error', 'Something went wrong saving this document type. Please try again.')
        return
      }
      showToast('success', 'Document type updated')
    } else {
      let code = slugify(label)
      let suffix = 2
      while (existingCodes.has(code)) { code = `${slugify(label)}_${suffix}`; suffix += 1 }

      const { error } = await supabase.from('document_types').insert({
        company_id: companyId,
        code,
        label: label.trim(),
        scope: scopeLocked,
        category,
        is_required: isRequired,
        has_expiry: hasExpiry,
        default_alert_days: days,
        active: true,
        sort_order: nextSortOrder,
      })
      setSaving(false)
      if (error) {
        console.error('[DocumentTypesSettingsTab] insert failed', error)
        showToast('error', 'Something went wrong adding this document type. Please try again.')
        return
      }
      showToast('success', 'Document type added')
    }
    onSaved()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm bg-white dark:bg-[#1E1E1E] rounded-2xl border border-[#E8E8E8] dark:border-[#2A2A2A] shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
          <h2 className="text-base font-bold text-[#1A1A1A] dark:text-white">
            {isEdit ? 'Edit' : 'Add'} {scopeLocked === 'company' || existing?.scope === 'company' ? 'Company' : 'Employee'} Document Type
          </h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-[#666666] dark:text-[#A0A0A0] hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Label</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Trade Licence" className={INPUT} required />
          </div>

          {!isEdit && (
            <div>
              <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className={SELECT}>
                {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Alert Days Before Expiry</label>
            <input type="number" min={1} max={365} value={alertDays} onChange={(e) => setAlertDays(e.target.value)} className={INPUT} required />
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer">
            <input type="checkbox" checked={isRequired} onChange={(e) => setIsRequired(e.target.checked)} className="accent-[#00D4A0]" />
            <span className="text-sm text-[#1A1A1A] dark:text-white">Required</span>
          </label>

          {!isEdit && (
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input type="checkbox" checked={hasExpiry} onChange={(e) => setHasExpiry(e.target.checked)} className="accent-[#00D4A0]" />
              <span className="text-sm text-[#1A1A1A] dark:text-white">Has an expiry date</span>
            </label>
          )}

          {isEdit && (
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="accent-[#00D4A0]" />
              <span className="text-sm text-[#1A1A1A] dark:text-white">Active</span>
            </label>
          )}

          {formError && <p className="text-xs text-[#FF4D4D]">{formError}</p>}

          <button
            type="submit" disabled={saving}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Type'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── List section ────────────────────────────────────────────────────────────

function TypeRow({ type, onEdit, onMoveUp, onMoveDown, isFirst, isLast }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border bg-[#F5F5F0] dark:bg-[#252525] border-[#E8E8E8] dark:border-[#2A2A2A]">
      <div className="flex flex-col shrink-0">
        <button onClick={onMoveUp} disabled={isFirst} className="disabled:opacity-30 text-[#666666] dark:text-[#A0A0A0] hover:text-[#00D4A0] transition-colors">
          <ChevronUp size={14} />
        </button>
        <button onClick={onMoveDown} disabled={isLast} className="disabled:opacity-30 text-[#666666] dark:text-[#A0A0A0] hover:text-[#00D4A0] transition-colors">
          <ChevronDown size={14} />
        </button>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white truncate">
          {type.label}
          {type.is_required && <span className="ml-1.5 text-[10px] font-semibold text-[#FF4D4D]">Required</span>}
        </p>
        <p className="text-xs text-[#666666] dark:text-[#A0A0A0] capitalize">
          {type.category} · Alert {type.default_alert_days}d before expiry{!type.has_expiry ? ' · No expiry' : ''}
        </p>
      </div>
      <span className={`px-2.5 py-1 rounded-full text-[10px] font-semibold shrink-0 ${type.active ? 'bg-[#00D4A0]/10 text-[#00D4A0]' : 'bg-[#A0A0A0]/10 text-[#666666] dark:text-[#A0A0A0]'}`}>
        {type.active ? 'Active' : 'Inactive'}
      </span>
      <button onClick={onEdit} className="text-[#666666] dark:text-[#A0A0A0] hover:text-[#00D4A0] shrink-0 transition-colors">
        <Pencil size={13} />
      </button>
    </div>
  )
}

function Section({ title, icon: Icon, types, onAdd, onEdit, onMove }) {
  return (
    <div className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#00D4A0]/10 flex items-center justify-center">
            <Icon size={15} className="text-[#00D4A0]" />
          </div>
          <h3 className="text-base font-semibold text-[#1A1A1A] dark:text-white">{title}</h3>
        </div>
        <button onClick={onAdd} className="flex items-center gap-1.5 text-xs font-semibold text-[#00D4A0] hover:underline">
          <Plus size={12} /> Add
        </button>
      </div>

      {types.length === 0 ? (
        <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">No document types yet.</p>
      ) : (
        <div className="space-y-2">
          {types.map((t, i) => (
            <TypeRow
              key={t.id}
              type={t}
              onEdit={() => onEdit(t)}
              onMoveUp={() => onMove(i, -1)}
              onMoveDown={() => onMove(i, 1)}
              isFirst={i === 0}
              isLast={i === types.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main export ─────────────────────────────────────────────────────────────

export default function DocumentTypesSettingsTab({ companyId, showToast }) {
  const [types, setTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null) // { existing? , scopeLocked? }

  const fetchTypes = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('document_types').select('*').order('scope').order('sort_order')
    setTypes(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchTypes() }, [fetchTypes])

  const companyTypes = types.filter((t) => t.scope === 'company')
  const employeeTypes = types.filter((t) => t.scope === 'employee')
  const existingCodes = new Set(types.map((t) => t.code))

  async function swapSortOrder(list, index, dir) {
    const other = list[index + dir]
    const current = list[index]
    if (!other) return
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from('document_types').update({ sort_order: other.sort_order }).eq('id', current.id),
      supabase.from('document_types').update({ sort_order: current.sort_order }).eq('id', other.id),
    ])
    if (e1 || e2) {
      console.error('[DocumentTypesSettingsTab] reorder failed', e1 || e2)
      showToast('error', 'Something went wrong reordering. Please try again.')
      return
    }
    fetchTypes()
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 size={20} className="animate-spin text-[#00D4A0]" />
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <Section
        title="Company Documents"
        icon={Building2}
        types={companyTypes}
        onAdd={() => setModal({ scopeLocked: 'company' })}
        onEdit={(t) => setModal({ existing: t })}
        onMove={(i, dir) => swapSortOrder(companyTypes, i, dir)}
      />
      <Section
        title="Employee Documents"
        icon={Users}
        types={employeeTypes}
        onAdd={() => setModal({ scopeLocked: 'employee' })}
        onEdit={(t) => setModal({ existing: t })}
        onMove={(i, dir) => swapSortOrder(employeeTypes, i, dir)}
      />

      {modal && (
        <TypeModal
          existing={modal.existing}
          scopeLocked={modal.scopeLocked ?? modal.existing?.scope}
          existingCodes={existingCodes}
          companyId={companyId}
          nextSortOrder={(modal.scopeLocked === 'company' ? companyTypes.length : employeeTypes.length) * 10 + 100}
          onClose={() => setModal(null)}
          onSaved={fetchTypes}
          showToast={showToast}
        />
      )}
    </div>
  )
}
