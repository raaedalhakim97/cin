import { useCallback, useEffect, useState } from 'react'
import { Loader2, Save, Sliders, Info, X, RefreshCw, Newspaper, CalendarClock } from 'lucide-react'
import supabase from '../../services/supabase'
import AdjustmentTypesManager from './AdjustmentTypesManager'
import { SkeletonBlock } from '../Skeleton'

const INPUT =
  'w-full px-3.5 py-2.5 text-sm rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0] transition-colors'

const WEIGHT_FIELDS = [
  { key: 'weight_attendance', label: 'Attendance' },
  { key: 'weight_behavior', label: 'Behavior' },
  { key: 'weight_achievement', label: 'Achievement' },
  { key: 'weight_manager', label: 'Manager Evaluation' },
  { key: 'weight_self', label: 'Self Evaluation' },
]

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const FREQ_OPTIONS = [
  { value: 1, label: 'Monthly' },
  { value: 3, label: 'Quarterly' },
  { value: 6, label: 'Semi-annual' },
  { value: 12, label: 'Annual' },
]

// Mirrors the DB's is_evaluation_month(p_month) RPC and the same helper in
// KPI.jsx — duplicated per this codebase's per-file convention for small
// pure helpers rather than sharing a module.
function isEvaluationMonth(month, freq = 6, anchor = 6) {
  const f = freq || 6
  const a = anchor || 6
  return ((month - a) % f + f) % f === 0
}

// Friendly labels for the known attendance point value keys — falls back to a
// title-cased version of the raw key for anything not in this map, since the
// jsonb shape is display-only and could grow without a frontend change.
const POINT_LABELS = {
  present: 'Present',
  late_minor: 'Late (minor)',
  late_moderate: 'Late (moderate)',
  late_major: 'Late (major)',
  absent_approved: 'Absent (approved)',
  absent_unauthorized: 'Absent (unauthorized)',
}
function pointLabel(key) {
  return POINT_LABELS[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function num(v) {
  return Number(v || 0)
}

function nowPeriod() {
  const d = new Date()
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

export default function KpiConfigTab({ companyId, showToast }) {
  const [row, setRow] = useState(null)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [recomputing, setRecomputing] = useState(false)
  const [showRecomputeBanner, setShowRecomputeBanner] = useState(false)
  const [togglingAutoPost, setTogglingAutoPost] = useState(false)
  const [savingEval, setSavingEval] = useState(false)

  const fetchSettings = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('kpi_settings').select('*').maybeSingle()
    setRow(data ?? null)
    if (data) {
      setForm({
        weight_attendance: data.weight_attendance,
        weight_behavior: data.weight_behavior,
        weight_achievement: data.weight_achievement,
        weight_manager: data.weight_manager,
        weight_self: data.weight_self,
        late_grace_minutes: data.late_grace_minutes,
        evaluation_frequency_months: data.evaluation_frequency_months ?? 6,
        evaluation_anchor_month: data.evaluation_anchor_month ?? 6,
      })
    }
    setLoading(false)
  }, [])

  async function saveEvalCycle(e) {
    e.preventDefault()
    setSavingEval(true)
    const { error } = await supabase
      .from('kpi_settings')
      .update({
        evaluation_frequency_months: form.evaluation_frequency_months,
        evaluation_anchor_month: form.evaluation_anchor_month,
      })
      .eq('id', row.id)
    setSavingEval(false)
    if (error) {
      console.error('[KpiConfigTab] saveEvalCycle failed', error)
      showToast('error', 'Something went wrong saving the evaluation cycle. Please try again.')
      return
    }
    showToast('success', 'Evaluation cycle saved')
    fetchSettings()
  }

  async function toggleAutoPostRewards() {
    if (!row) return
    setTogglingAutoPost(true)
    const next = !row.auto_post_rewards
    const { error } = await supabase
      .from('kpi_settings')
      .update({ auto_post_rewards: next })
      .eq('id', row.id)
    setTogglingAutoPost(false)
    if (error) {
      console.error('[KpiConfigTab] toggleAutoPostRewards failed', error)
      showToast('error', 'Something went wrong updating this setting. Please try again.')
      return
    }
    setRow(prev => ({ ...prev, auto_post_rewards: next }))
    showToast('success', next ? 'Rewards will auto-post to the feed' : 'Reward auto-posting turned off')
  }

  useEffect(() => { fetchSettings() }, [fetchSettings])

  if (loading) {
    return (
      <div className="space-y-4 max-w-4xl animate-pulse">
        <SkeletonBlock className="h-48" />
        <SkeletonBlock className="h-32" />
      </div>
    )
  }

  if (!row || !form) {
    return <p className="text-sm text-[#666666] dark:text-[#A0A0A0]">No KPI settings found for this company.</p>
  }

  const total = WEIGHT_FIELDS.reduce((sum, f) => sum + num(form[f.key]), 0)
  const isValid = total === 100

  const evalMonths = MONTHS.filter((_, i) =>
    isEvaluationMonth(i + 1, form.evaluation_frequency_months, form.evaluation_anchor_month)
  )

  function setWeight(key, val) {
    setForm(prev => ({ ...prev, [key]: Math.max(0, Math.min(100, Number(val) || 0)) }))
    setShowRecomputeBanner(false)
  }

  async function save(e) {
    e.preventDefault()
    if (!isValid) return
    setSaving(true)
    const { error } = await supabase
      .from('kpi_settings')
      .update({
        weight_attendance: form.weight_attendance,
        weight_behavior: form.weight_behavior,
        weight_achievement: form.weight_achievement,
        weight_manager: form.weight_manager,
        weight_self: form.weight_self,
        late_grace_minutes: form.late_grace_minutes,
      })
      .eq('id', row.id)
    setSaving(false)
    if (error) {
      console.error('[KpiConfigTab] save weights failed', error)
      showToast('error', 'Something went wrong saving KPI weights. Please try again.')
      return
    }
    showToast('success', 'KPI weights saved')
    setShowRecomputeBanner(true)
    fetchSettings()
  }

  async function recomputeCurrentMonth() {
    const { year, month } = nowPeriod()
    setRecomputing(true)
    const { error } = await supabase.rpc('recompute_kpi_totals', { p_year: year, p_month: month })
    setRecomputing(false)
    if (error) {
      console.error('[KpiConfigTab] recomputeCurrentMonth failed', error)
      showToast('error', 'Something went wrong recomputing totals. Please try again.')
      return
    }
    showToast('success', `Recomputed totals for ${year}-${String(month).padStart(2, '0')}`)
    setShowRecomputeBanner(false)
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Weights */}
      <form onSubmit={save} className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#00D4A0]/10 flex items-center justify-center">
              <Sliders size={15} className="text-[#00D4A0]" />
            </div>
            <h3 className="text-base font-semibold text-[#1A1A1A] dark:text-white">Score Weights</h3>
          </div>
          <span className={`px-3 py-1 rounded-full text-sm font-bold ${isValid ? 'bg-[#00D4A0]/10 text-[#00D4A0]' : 'bg-[#FF4D4D]/10 text-[#FF4D4D]'}`}>
            Total {total}%
          </span>
        </div>
        <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mb-5">
          How each KPI component contributes to the total score. Must add up to exactly 100%.
        </p>

        <div className="space-y-5">
          {WEIGHT_FIELDS.map(f => (
            <div key={f.key}>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-semibold text-[#1A1A1A] dark:text-white">{f.label}</label>
                <span className="text-sm font-bold text-[#00D4A0]">{form[f.key]}%</span>
              </div>
              <input
                type="range" min={0} max={100} value={form[f.key]}
                onChange={e => setWeight(f.key, e.target.value)}
                className="w-full accent-[#00D4A0]"
              />
            </div>
          ))}
        </div>

        <div className="mt-6 pt-6 border-t border-[#E8E8E8] dark:border-[#2A2A2A] grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
          <div>
            <label className="block text-sm font-semibold text-[#1A1A1A] dark:text-white mb-1.5">Late Grace Period (minutes)</label>
            <input
              type="number" min={0} value={form.late_grace_minutes}
              onChange={e => setForm(prev => ({ ...prev, late_grace_minutes: Number(e.target.value) || 0 }))}
              className={INPUT}
            />
          </div>
          <button
            type="submit" disabled={saving || !isValid}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-40 transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? 'Saving…' : 'Save Weights'}
          </button>
        </div>
        {!isValid && (
          <p className="text-xs text-[#FF4D4D] mt-2">Weights must total exactly 100% before saving.</p>
        )}
      </form>

      {/* Recompute banner */}
      {showRecomputeBanner && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-[#4D9FFF]/10 border border-[#4D9FFF]/20">
          <Info size={16} className="text-[#4D9FFF] shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white">Apply new weights to current month?</p>
            <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-0.5">
              This recomputes {nowPeriod().year}-{String(nowPeriod().month).padStart(2, '0')} totals using the weights you just saved. Past months are never touched.
            </p>
            <div className="flex items-center gap-3 mt-3">
              <button
                onClick={recomputeCurrentMonth} disabled={recomputing}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-white bg-[#4D9FFF] hover:bg-[#3D8FEF] disabled:opacity-60 transition-colors"
              >
                {recomputing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                {recomputing ? 'Applying…' : 'Apply to Current Month'}
              </button>
              <button onClick={() => setShowRecomputeBanner(false)} className="text-xs font-semibold text-[#666666] dark:text-[#A0A0A0] hover:text-[#1A1A1A] dark:hover:text-white transition-colors">
                Not now
              </button>
            </div>
          </div>
          <button onClick={() => setShowRecomputeBanner(false)} className="text-[#666666] dark:text-[#A0A0A0] hover:text-[#1A1A1A] dark:hover:text-white shrink-0">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Evaluation cycle */}
      <form onSubmit={saveEvalCycle} className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-8 h-8 rounded-lg bg-[#00D4A0]/10 flex items-center justify-center">
            <CalendarClock size={15} className="text-[#00D4A0]" />
          </div>
          <h3 className="text-base font-semibold text-[#1A1A1A] dark:text-white">Evaluation Cycle</h3>
        </div>
        <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mb-5">
          Self- and manager-evaluation forms only open during evaluation months. Outside that window, each employee's prior manager/self scores carry forward so totals stay fair between cycles.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-[#1A1A1A] dark:text-white mb-1.5">Frequency</label>
            <select
              value={form.evaluation_frequency_months}
              onChange={e => setForm(prev => ({ ...prev, evaluation_frequency_months: Number(e.target.value) }))}
              className={INPUT}
            >
              {FREQ_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-[#1A1A1A] dark:text-white mb-1.5">Anchor Month</label>
            <select
              value={form.evaluation_anchor_month}
              onChange={e => setForm(prev => ({ ...prev, evaluation_anchor_month: Number(e.target.value) }))}
              className={INPUT}
            >
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </div>
        </div>

        <div className="mt-4 p-3.5 rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A]">
          <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">
            Evaluation months this year:{' '}
            <span className="font-semibold text-[#1A1A1A] dark:text-white">
              {evalMonths.length ? evalMonths.join(', ') : 'None'}
            </span>
          </p>
        </div>

        <button
          type="submit" disabled={savingEval}
          className="mt-4 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors"
        >
          {savingEval ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {savingEval ? 'Saving…' : 'Save Evaluation Cycle'}
        </button>
      </form>

      {/* Feed automation */}
      <div className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
        <div className="flex items-center gap-4 flex-wrap justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#00D4A0]/10 flex items-center justify-center shrink-0">
              <Newspaper size={15} className="text-[#00D4A0]" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-[#1A1A1A] dark:text-white">Auto-post rewards to feed</h3>
              <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-0.5 max-w-md">
                When a reward is granted in Warnings &amp; Rewards, automatically create an achievement post on the News Feed.
              </p>
            </div>
          </div>
          <button
            onClick={toggleAutoPostRewards}
            disabled={togglingAutoPost}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold shrink-0 transition-colors disabled:opacity-60 ${
              row.auto_post_rewards ? 'bg-[#00D4A0]/10 text-[#00D4A0]' : 'bg-[#A0A0A0]/10 text-[#666666] dark:text-[#A0A0A0]'
            }`}
          >
            {togglingAutoPost ? <Loader2 size={12} className="animate-spin" /> : row.auto_post_rewards ? 'On' : 'Off'}
          </button>
        </div>
      </div>

      {/* Attendance point values — reference only */}
      <div className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
        <h3 className="text-base font-semibold text-[#1A1A1A] dark:text-white mb-1">Attendance Point Values</h3>
        <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mb-4">
          Reference only — attendance scoring is still calculated by the database and isn't editable here yet.
        </p>
        {row.attendance_point_values && Object.keys(row.attendance_point_values).length > 0 ? (
          <div className="rounded-lg border border-[#E8E8E8] dark:border-[#2A2A2A] overflow-hidden">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-[#E8E8E8] dark:divide-[#2A2A2A]">
                {Object.entries(row.attendance_point_values).map(([key, val]) => (
                  <tr key={key}>
                    <td className="px-4 py-2.5 text-[#1A1A1A] dark:text-white">{pointLabel(key)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-[#1A1A1A] dark:text-white">{val} pts</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">No attendance point values configured.</p>
        )}
      </div>

      {/* Adjustment types */}
      <div>
        <h3 className="text-base font-semibold text-[#1A1A1A] dark:text-white mb-1">Warning & Reward Types</h3>
        <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mb-4">
          These populate the options in KPI → Warnings & Rewards. Deactivate a type to hide it from that form without losing history.
        </p>
        <AdjustmentTypesManager companyId={companyId} showToast={showToast} />
      </div>
    </div>
  )
}
