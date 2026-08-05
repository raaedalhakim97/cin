import { useCallback, useEffect, useState } from 'react'
import { Gift, ShieldAlert, Plus, Pencil, X, Check, Loader2 } from 'lucide-react'
import supabase from '../../services/supabase'

const INPUT =
  'w-full px-3.5 py-2.5 text-sm rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0] transition-colors'

const SELECT = INPUT

function slugify(label) {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

// ─── Add / Edit modal ───────────────────────────────────────────────────────────

function TypeModal({ kind, existing, existingCodes, companyId, nextSortOrder, onClose, onSaved, showToast }) {
  const isEdit = !!existing
  const [label, setLabel] = useState(existing?.label ?? '')
  const [points, setPoints] = useState(existing?.points ?? (kind === 'reward' ? 5 : -3))
  const [warningLevel, setWarningLevel] = useState(existing?.warning_level ?? 1)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setFormError('')
    if (!label.trim()) { setFormError('Label is required'); return }
    if (kind === 'reward' && Number(points) <= 0) { setFormError('Reward points must be greater than 0'); return }
    if (kind === 'warning' && Number(points) >= 0) { setFormError('Warning points must be less than 0'); return }

    setSaving(true)
    if (isEdit) {
      const { error } = await supabase
        .from('kpi_adjustment_types')
        .update({
          label: label.trim(),
          points: Number(points),
          ...(kind === 'warning' ? { warning_level: Number(warningLevel) } : {}),
        })
        .eq('id', existing.id)
      setSaving(false)
      if (error) {
        console.error('[AdjustmentTypesManager] update failed', error)
        showToast('error', 'Something went wrong saving this type. Please try again.')
        return
      }
      showToast('success', 'Adjustment type updated')
    } else {
      let code = slugify(label)
      let suffix = 2
      while (existingCodes.has(code)) { code = `${slugify(label)}_${suffix}`; suffix += 1 }

      const { error } = await supabase.from('kpi_adjustment_types').insert({
        company_id: companyId,
        code,
        label: label.trim(),
        kind,
        points: Number(points),
        warning_level: kind === 'warning' ? Number(warningLevel) : null,
        active: true,
        sort_order: nextSortOrder,
      })
      setSaving(false)
      if (error) {
        console.error('[AdjustmentTypesManager] insert failed', error)
        showToast('error', 'Something went wrong adding this type. Please try again.')
        return
      }
      showToast('success', 'Adjustment type added')
    }
    onSaved()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm bg-white dark:bg-[#1E1E1E] rounded-2xl border border-[#E8E8E8] dark:border-[#2A2A2A] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
          <h2 className="text-base font-bold text-[#1A1A1A] dark:text-white">
            {isEdit ? 'Edit' : 'Add'} {kind === 'reward' ? 'Reward' : 'Warning'} Type
          </h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-[#666666] dark:text-[#A0A0A0] hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Label</label>
            <input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Customer Excellence" className={INPUT} required />
          </div>

          {kind === 'warning' && (
            <div>
              <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Warning Level</label>
              <select value={warningLevel} onChange={e => setWarningLevel(Number(e.target.value))} className={SELECT}>
                {[1, 2, 3].map(l => <option key={l} value={l}>Level {l}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">
              Points {kind === 'reward' ? '(must be greater than 0)' : '(must be less than 0)'}
            </label>
            <input type="number" value={points} onChange={e => setPoints(e.target.value)} className={INPUT} required />
          </div>

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

// ─── List section (rewards or warnings) ────────────────────────────────────────

function TypeList({ kind, types, onToggleActive, onEdit, onAddNew }) {
  const isReward = kind === 'reward'
  return (
    <div className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isReward ? 'bg-[#00D4A0]/10' : 'bg-[#FF8C42]/10'}`}>
            {isReward ? <Gift size={15} className="text-[#00D4A0]" /> : <ShieldAlert size={15} className="text-[#FF8C42]" />}
          </div>
          <h3 className="text-base font-semibold text-[#1A1A1A] dark:text-white">{isReward ? 'Rewards' : 'Warnings'}</h3>
        </div>
        <button onClick={onAddNew} className="flex items-center gap-1.5 text-xs font-semibold text-[#00D4A0] hover:underline">
          <Plus size={12} /> Add
        </button>
      </div>

      {types.length === 0 ? (
        <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">No {isReward ? 'reward' : 'warning'} types yet.</p>
      ) : (
        <div className="space-y-2">
          {types.map(t => (
            <div
              key={t.id}
              className={`flex items-center gap-3 p-3 rounded-lg border ${
                t.active ? 'bg-[#F5F5F0] dark:bg-[#252525] border-[#E8E8E8] dark:border-[#2A2A2A]' : 'bg-transparent border-dashed border-[#E8E8E8] dark:border-[#2A2A2A] opacity-60'
              }`}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white truncate">
                  {t.label}
                  {!isReward && <span className="ml-1.5 text-xs font-normal text-[#666666] dark:text-[#A0A0A0]">(Level {t.warning_level})</span>}
                </p>
                <p className="text-[10px] text-[#AAAAAA] dark:text-[#555555] font-mono">{t.code}</p>
              </div>
              <span className={`text-xs font-bold shrink-0 ${t.points >= 0 ? 'text-[#00D4A0]' : 'text-[#FF4D4D]'}`}>
                {t.points >= 0 ? '+' : ''}{t.points}
              </span>
              <button
                onClick={() => onToggleActive(t)}
                className={`px-2.5 py-1 rounded-full text-[10px] font-semibold shrink-0 transition-colors ${
                  t.active ? 'bg-[#00D4A0]/10 text-[#00D4A0]' : 'bg-[#A0A0A0]/10 text-[#666666] dark:text-[#A0A0A0]'
                }`}
              >
                {t.active ? 'Active' : 'Inactive'}
              </button>
              <button onClick={() => onEdit(t)} className="text-[#666666] dark:text-[#A0A0A0] hover:text-[#00D4A0] transition-colors shrink-0">
                <Pencil size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main export ─────────────────────────────────────────────────────────────

export default function AdjustmentTypesManager({ companyId, showToast }) {
  const [types, setTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null) // { kind, existing? }

  const fetchTypes = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('kpi_adjustment_types').select('*').order('sort_order')
    setTypes(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchTypes() }, [fetchTypes])

  async function toggleActive(type) {
    const { error } = await supabase.from('kpi_adjustment_types').update({ active: !type.active }).eq('id', type.id)
    if (error) {
      console.error('[AdjustmentTypesManager] toggleActive failed', error)
      showToast('error', 'Something went wrong updating this type. Please try again.')
      return
    }
    fetchTypes()
  }

  const rewardTypes = types.filter(t => t.kind === 'reward')
  const warningTypes = types.filter(t => t.kind === 'warning')
  const existingCodes = new Set(types.map(t => t.code))

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 size={20} className="animate-spin text-[#00D4A0]" />
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      <TypeList
        kind="reward" types={rewardTypes}
        onToggleActive={toggleActive}
        onEdit={t => setModal({ kind: 'reward', existing: t })}
        onAddNew={() => setModal({ kind: 'reward' })}
      />
      <TypeList
        kind="warning" types={warningTypes}
        onToggleActive={toggleActive}
        onEdit={t => setModal({ kind: 'warning', existing: t })}
        onAddNew={() => setModal({ kind: 'warning' })}
      />

      {modal && (
        <TypeModal
          kind={modal.kind}
          existing={modal.existing}
          existingCodes={existingCodes}
          companyId={companyId}
          nextSortOrder={types.length * 10}
          onClose={() => setModal(null)}
          onSaved={fetchTypes}
          showToast={showToast}
        />
      )}
    </div>
  )
}
