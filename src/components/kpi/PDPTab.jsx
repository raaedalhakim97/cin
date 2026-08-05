import { useCallback, useEffect, useState } from 'react'
import {
  Target, Plus, X, Loader2, Check, ChevronDown, ChevronRight,
  Calendar, Trash2, Users2, User,
} from 'lucide-react'
import supabase from '../../services/supabase'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function num(v) {
  return Number(v || 0)
}

function localDateStr(d = new Date()) {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ─── Constants ────────────────────────────────────────────────────────────────

const FOCUS_COMPONENTS = [
  { key: 'attendance', label: 'Attendance', col: 'attendance_score' },
  { key: 'behavior', label: 'Behavior', col: 'behavior_score' },
  { key: 'achievement', label: 'Achievement', col: 'achievement_score' },
  { key: 'manager', label: 'Manager Evaluation', col: 'manager_score' },
  { key: 'self', label: 'Self Evaluation', col: 'self_score' },
  { key: 'overall', label: 'Overall Score', col: 'total_score' },
]
function focusMeta(key) {
  return FOCUS_COMPONENTS.find(f => f.key === key) ?? { key, label: key, col: 'total_score' }
}

const ACTION_TYPES = [
  { value: 'training', label: 'Training' },
  { value: 'course', label: 'Course' },
  { value: 'mentoring', label: 'Mentoring' },
  { value: 'project', label: 'Project' },
  { value: 'shadowing', label: 'Shadowing' },
  { value: 'other', label: 'Other' },
]
function actionTypeLabel(v) {
  return ACTION_TYPES.find(t => t.value === v)?.label ?? v
}

const STATUS_META = {
  active: { label: 'Active', cls: 'bg-[#00D4A0]/10 text-[#00D4A0]' },
  completed: { label: 'Completed', cls: 'bg-[#4D9FFF]/10 text-[#4D9FFF]' },
  cancelled: { label: 'Cancelled', cls: 'bg-[#A0A0A0]/10 text-[#666666] dark:text-[#A0A0A0]' },
}

const INPUT =
  'w-full px-3.5 py-2.5 text-sm rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0] transition-colors'

const SELECT =
  'px-3.5 py-2.5 text-sm rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0] transition-colors'

// ─── Micro-components ─────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex justify-center py-16">
      <Loader2 size={20} className="animate-spin text-[#00D4A0]" />
    </div>
  )
}

function EmptyState({ title, subtitle }) {
  return (
    <div className="flex flex-col items-center py-16 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] text-center px-6">
      <div className="w-14 h-14 rounded-2xl bg-[#00D4A0]/10 flex items-center justify-center mb-3">
        <Target size={22} className="text-[#00D4A0]" />
      </div>
      <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white">{title}</p>
      {subtitle && <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-1 max-w-sm">{subtitle}</p>}
    </div>
  )
}

// ─── Progress chart (actual vs target) ─────────────────────────────────────────

function ProgressChart({ progress, target }) {
  if (progress.length === 0) {
    return (
      <div className="p-4 rounded-lg bg-[#F5F5F0] dark:bg-[#252525] text-center">
        <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">
          No progress recorded yet — this fills in automatically the next time a KPI score is saved for this employee.
        </p>
      </div>
    )
  }

  const width = 560, height = 160
  const padding = { top: 16, right: 16, bottom: 24, left: 28 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom

  const points = progress.map((p, i) => {
    const x = padding.left + (progress.length === 1 ? innerW / 2 : (i / (progress.length - 1)) * innerW)
    const y = padding.top + innerH - (Math.max(0, Math.min(100, num(p.score))) / 100) * innerH
    return { x, y, p }
  })
  const pathD = points.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`).join(' ')
  const targetY = padding.top + innerH - (Math.max(0, Math.min(100, num(target))) / 100) * innerH

  return (
    <div className="p-4 rounded-lg bg-[#F5F5F0] dark:bg-[#252525] overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ minWidth: 400 }}>
        {[0, 50, 100].map(v => {
          const y = padding.top + innerH - (v / 100) * innerH
          return (
            <g key={v}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} className="stroke-[#E8E8E8] dark:stroke-[#2A2A2A]" strokeWidth={1} />
              <text x={padding.left - 6} y={y + 3} textAnchor="end" fontSize={9} className="fill-[#666666] dark:fill-[#A0A0A0]">{v}</text>
            </g>
          )
        })}
        {/* Target line — dashed */}
        <line x1={padding.left} x2={width - padding.right} y1={targetY} y2={targetY} stroke="#A78BFA" strokeWidth={2} strokeDasharray="6 4" />
        {/* Actual line — solid mint */}
        <path d={pathD} fill="none" stroke="#00D4A0" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        {points.map((pt, i) => (
          <g key={i}>
            <circle cx={pt.x} cy={pt.y} r={3.5} fill="#00D4A0" />
            <text x={pt.x} y={height - 6} textAnchor="middle" fontSize={9} className="fill-[#666666] dark:fill-[#A0A0A0]">
              {MONTHS_SHORT[pt.p.period_month - 1]}
            </text>
          </g>
        ))}
      </svg>
      <div className="flex items-center gap-4 mt-1 text-[10px]">
        <span className="flex items-center gap-1.5 text-[#666666] dark:text-[#A0A0A0]"><span className="w-3 h-0.5 bg-[#00D4A0] inline-block" /> Actual</span>
        <span className="flex items-center gap-1.5 text-[#666666] dark:text-[#A0A0A0]"><span className="w-3 h-0.5 bg-[#A78BFA] inline-block" style={{ borderTop: '2px dashed #A78BFA', background: 'none' }} /> Target</span>
      </div>
    </div>
  )
}

// ─── Action checklist ──────────────────────────────────────────────────────────

function ActionChecklist({ actions, canToggle, onToggle }) {
  if (actions.length === 0) {
    return <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">No action items yet.</p>
  }
  const now = new Date()
  return (
    <div className="space-y-1.5">
      {actions.map(a => {
        const overdue = a.due_date && !a.completed && new Date(a.due_date) < now
        return (
          <label
            key={a.id}
            className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
              a.completed
                ? 'bg-[#00D4A0]/5 border-[#00D4A0]/20'
                : 'bg-[#F5F5F0] dark:bg-[#252525] border-[#E8E8E8] dark:border-[#2A2A2A]'
            } ${canToggle ? 'cursor-pointer' : ''}`}
          >
            <input
              type="checkbox"
              checked={a.completed}
              disabled={!canToggle}
              onChange={() => canToggle && onToggle(a)}
              className="mt-0.5 w-4 h-4 accent-[#00D4A0] shrink-0"
            />
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium ${a.completed ? 'text-[#666666] dark:text-[#A0A0A0] line-through' : 'text-[#1A1A1A] dark:text-white'}`}>
                {a.title}
              </p>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#4D9FFF]/10 text-[#4D9FFF] font-semibold">
                  {actionTypeLabel(a.action_type)}
                </span>
                {a.due_date && (
                  <span className={`text-[10px] flex items-center gap-1 ${overdue ? 'text-[#FF4D4D] font-semibold' : 'text-[#666666] dark:text-[#A0A0A0]'}`}>
                    <Calendar size={10} /> {fmtDate(a.due_date)}{overdue ? ' · overdue' : ''}
                  </span>
                )}
              </div>
            </div>
          </label>
        )
      })}
    </div>
  )
}

// ─── Add Action (inline, admin only) ───────────────────────────────────────────

function AddActionForm({ onAdd }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [actionType, setActionType] = useState('training')
  const [dueDate, setDueDate] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    const ok = await onAdd({ title: title.trim(), action_type: actionType, due_date: dueDate || null })
    setSaving(false)
    if (ok) {
      setTitle(''); setDueDate(''); setOpen(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button" onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs font-semibold text-[#00D4A0] hover:underline"
      >
        <Plus size={12} /> Add action
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="p-3 rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] space-y-2">
      <input
        value={title} onChange={e => setTitle(e.target.value)}
        placeholder="Action title…" className={INPUT} autoFocus
      />
      <div className="flex gap-2">
        <select value={actionType} onChange={e => setActionType(e.target.value)} className={`${SELECT} flex-1`}>
          {ACTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={SELECT} />
      </div>
      <div className="flex gap-2">
        <button
          type="submit" disabled={saving || !title.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors"
        >
          {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Add
        </button>
        <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#666666] dark:text-[#A0A0A0] hover:text-[#1A1A1A] dark:hover:text-white transition-colors">
          Cancel
        </button>
      </div>
    </form>
  )
}

// ─── Plan card ─────────────────────────────────────────────────────────────────

function PlanCard({ plan, companyId, canManage, isOwner, employeeName, showToast, onChanged }) {
  const [actions, setActions] = useState([])
  const [progress, setProgress] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchDetail = useCallback(async () => {
    setLoading(true)
    const [{ data: acts }, { data: prog }] = await Promise.all([
      supabase.from('pdp_actions').select('*').eq('plan_id', plan.id).order('due_date', { ascending: true, nullsFirst: false }),
      supabase.from('pdp_progress').select('*').eq('plan_id', plan.id).order('period_year').order('period_month'),
    ])
    setActions(acts ?? [])
    setProgress(prog ?? [])
    setLoading(false)
  }, [plan.id])

  useEffect(() => { fetchDetail() }, [fetchDetail])

  const canToggleActions = isOwner || canManage
  const current = progress.length ? num(progress[progress.length - 1].score) : num(plan.baseline_score)
  const baseline = num(plan.baseline_score)
  const target = num(plan.target_score)
  const span = target - baseline
  const progressPct = span === 0 ? 100 : Math.max(0, Math.min(100, ((current - baseline) / span) * 100))
  const meta = focusMeta(plan.focus_component)
  const statusMeta = STATUS_META[plan.status] ?? STATUS_META.active

  async function toggleAction(action) {
    if (!canToggleActions) return
    const { error } = await supabase.from('pdp_actions').update({ completed: !action.completed }).eq('id', action.id)
    if (error) {
      console.error('[PDPTab] toggleAction failed', error)
      showToast('error', 'Something went wrong updating this action. Please try again.')
      return
    }
    setActions(prev => prev.map(a => a.id === action.id ? { ...a, completed: !a.completed } : a))
  }

  async function addAction(values) {
    const { error } = await supabase.from('pdp_actions').insert({
      company_id: companyId,
      plan_id: plan.id,
      title: values.title,
      action_type: values.action_type,
      due_date: values.due_date,
      completed: false,
      notes: null,
    })
    if (error) {
      console.error('[PDPTab] addAction failed', error)
      showToast('error', 'Something went wrong adding this action. Please try again.')
      return false
    }
    fetchDetail()
    return true
  }

  async function changeStatus(newStatus) {
    const { error } = await supabase.from('pdp_plans').update({ status: newStatus }).eq('id', plan.id)
    if (error) {
      console.error('[PDPTab] changeStatus failed', error)
      showToast('error', 'Something went wrong updating this plan. Please try again.')
      return
    }
    showToast('success', `Plan marked ${newStatus}`)
    onChanged()
  }

  return (
    <div className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-bold text-[#1A1A1A] dark:text-white">{plan.title}</h3>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${statusMeta.cls}`}>{statusMeta.label}</span>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#A78BFA]/10 text-[#A78BFA]">{meta.label}</span>
          </div>
          {employeeName && (
            <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-1 flex items-center gap-1"><User size={11} /> {employeeName}</p>
          )}
          {plan.description && <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-2 max-w-xl">{plan.description}</p>}
        </div>

        {canManage && plan.status === 'active' && (
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => changeStatus('completed')}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#4D9FFF] border border-[#4D9FFF]/30 hover:bg-[#4D9FFF]/10 transition-colors"
            >
              Mark Completed
            </button>
            <button
              onClick={() => { if (confirm('Cancel this development plan? This cannot be undone.')) changeStatus('cancelled') }}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#FF4D4D] border border-[#FF4D4D]/30 hover:bg-[#FF4D4D]/10 transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Baseline → Current → Target */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="text-[#666666] dark:text-[#A0A0A0]">Baseline <span className="font-semibold text-[#1A1A1A] dark:text-white">{baseline.toFixed(0)}</span></span>
          <span className="text-[#00D4A0] font-semibold">Current {current.toFixed(0)}</span>
          <span className="text-[#666666] dark:text-[#A0A0A0]">Target <span className="font-semibold text-[#1A1A1A] dark:text-white">{target.toFixed(0)}</span></span>
        </div>
        <div className="h-2.5 bg-[#F0F0F0] dark:bg-[#2A2A2A] rounded-full overflow-hidden">
          <div className="h-full bg-[#00D4A0] rounded-full transition-all duration-500" style={{ width: `${progressPct}%` }} />
        </div>
        <p className="text-[10px] text-[#666666] dark:text-[#A0A0A0] mt-1">
          {fmtDate(plan.start_date)} → {fmtDate(plan.target_date)}
        </p>
      </div>

      {loading ? <Spinner /> : (
        <>
          <div className="mb-5">
            <p className="text-xs font-semibold text-[#1A1A1A] dark:text-white mb-2">Progress</p>
            <ProgressChart progress={progress} target={target} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-[#1A1A1A] dark:text-white">Action Items</p>
              {canManage && <AddActionForm onAdd={addAction} />}
            </div>
            <ActionChecklist actions={actions} canToggle={canToggleActions} onToggle={toggleAction} />
          </div>
        </>
      )}
    </div>
  )
}

// ─── Create Plan Modal ──────────────────────────────────────────────────────────

function CreatePlanModal({ employees, companyId, defaultEmployeeId, onClose, onCreated, showToast }) {
  const [employeeId, setEmployeeId] = useState(defaultEmployeeId ?? employees[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [focusComponent, setFocusComponent] = useState('overall')
  const [baselineScore, setBaselineScore] = useState(0)
  const [targetScore, setTargetScore] = useState(80)
  const [startDate, setStartDate] = useState(localDateStr())
  const [targetDate, setTargetDate] = useState('')
  const [actionDrafts, setActionDrafts] = useState([])
  const [fetchingBaseline, setFetchingBaseline] = useState(false)
  const [saving, setSaving] = useState(false)

  const fetchBaseline = useCallback(async () => {
    if (!employeeId) return
    setFetchingBaseline(true)
    const col = focusMeta(focusComponent).col
    const { data } = await supabase
      .from('kpi_scores')
      .select('*')
      .eq('employee_id', employeeId)
      .order('period_year', { ascending: false })
      .order('period_month', { ascending: false })
      .limit(1)
      .maybeSingle()
    setBaselineScore(data ? num(data[col]) : 0)
    setFetchingBaseline(false)
  }, [employeeId, focusComponent])

  useEffect(() => { fetchBaseline() }, [fetchBaseline])

  function addActionDraft() {
    setActionDrafts(prev => [...prev, { title: '', action_type: 'training', due_date: '' }])
  }
  function updateActionDraft(i, field, val) {
    setActionDrafts(prev => prev.map((d, idx) => idx === i ? { ...d, [field]: val } : d))
  }
  function removeActionDraft(i) {
    setActionDrafts(prev => prev.filter((_, idx) => idx !== i))
  }

  async function submit(e) {
    e.preventDefault()
    if (!employeeId || !title.trim() || !targetDate) {
      showToast('error', 'Employee, title, and target date are required')
      return
    }
    setSaving(true)
    const { data: newPlan, error } = await supabase.from('pdp_plans').insert({
      company_id: companyId,
      employee_id: employeeId,
      title: title.trim(),
      description: description.trim() || null,
      focus_component: focusComponent,
      baseline_score: baselineScore,
      target_score: targetScore,
      start_date: startDate,
      target_date: targetDate,
      status: 'active',
    }).select().single()

    if (error) {
      console.error('[PDPTab] create plan failed', error)
      setSaving(false)
      showToast('error', 'Something went wrong creating this plan. Please try again.')
      return
    }

    const validDrafts = actionDrafts.filter(d => d.title.trim())
    if (validDrafts.length > 0) {
      const { error: actionsError } = await supabase.from('pdp_actions').insert(
        validDrafts.map(d => ({
          company_id: companyId,
          plan_id: newPlan.id,
          title: d.title.trim(),
          action_type: d.action_type,
          due_date: d.due_date || null,
          completed: false,
          notes: null,
        }))
      )
      if (actionsError) showToast('error', `Plan created, but action items failed: ${actionsError.message}`)
    }

    setSaving(false)
    showToast('success', 'Development plan created')
    onCreated()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-lg my-8 bg-white dark:bg-[#1E1E1E] rounded-2xl border border-[#E8E8E8] dark:border-[#2A2A2A] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#00D4A0]/10 flex items-center justify-center">
              <Target size={15} className="text-[#00D4A0]" />
            </div>
            <h2 className="text-base font-bold text-[#1A1A1A] dark:text-white">New Development Plan</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-[#666666] dark:text-[#A0A0A0] hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Employee</label>
            <select value={employeeId} onChange={e => setEmployeeId(e.target.value)} className={INPUT} required>
              <option value="" disabled>Select employee…</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Improve Client Communication" className={INPUT} required />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Description</label>
            <textarea rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder="What is this plan aiming to improve?" className={INPUT} />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Focus Component</label>
            <select value={focusComponent} onChange={e => setFocusComponent(e.target.value)} className={INPUT}>
              {FOCUS_COMPONENTS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">
                Baseline Score {fetchingBaseline && <Loader2 size={10} className="inline animate-spin ml-1" />}
              </label>
              <input
                type="number" min={0} max={100} value={baselineScore}
                onChange={e => setBaselineScore(Number(e.target.value))} className={INPUT}
              />
              <p className="text-[10px] text-[#666666] dark:text-[#A0A0A0] mt-1">Auto-filled from latest KPI score</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Target Score</label>
              <input
                type="number" min={0} max={100} value={targetScore}
                onChange={e => setTargetScore(Number(e.target.value))} className={INPUT} required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Start Date</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={INPUT} required />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Target Date</label>
              <input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)} className={INPUT} required />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-[#1A1A1A] dark:text-white">Action Items <span className="font-normal text-[#666666] dark:text-[#A0A0A0]">(optional)</span></label>
              <button type="button" onClick={addActionDraft} className="flex items-center gap-1 text-xs font-semibold text-[#00D4A0] hover:underline">
                <Plus size={11} /> Add item
              </button>
            </div>
            <div className="space-y-2">
              {actionDrafts.map((d, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={d.title} onChange={e => updateActionDraft(i, 'title', e.target.value)}
                    placeholder="Action title…" className={`${INPUT} flex-1`}
                  />
                  <select value={d.action_type} onChange={e => updateActionDraft(i, 'action_type', e.target.value)} className={SELECT}>
                    {ACTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  <input type="date" value={d.due_date} onChange={e => updateActionDraft(i, 'due_date', e.target.value)} className={SELECT} />
                  <button type="button" onClick={() => removeActionDraft(i)} className="text-[#FF4D4D] shrink-0">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <button
            type="submit" disabled={saving}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {saving ? 'Creating…' : 'Create Plan'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── Main PDP Tab ───────────────────────────────────────────────────────────────

export default function PDPTab({ employee, companyId, canManage, showToast, role }) {
  // Migration 46 (make_read_only_role_truly_read_only) — pdp_actions_employee_complete
  // RLS now excludes read_only. `isOwner` below drives whether the "My
  // Development" checklist checkboxes are toggleable — false for read_only
  // hides/disables them rather than letting a click 400.
  const canCompleteOwnActions = role !== 'read_only'
  const [view, setView] = useState('mine')

  const [myPlans, setMyPlans] = useState([])
  const [loadingMine, setLoadingMine] = useState(true)
  const [showHistoryMine, setShowHistoryMine] = useState(false)

  const [employees, setEmployees] = useState([])
  const [allPlans, setAllPlans] = useState([])
  const [loadingManage, setLoadingManage] = useState(true)
  const [empFilter, setEmpFilter] = useState('all')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showHistoryManage, setShowHistoryManage] = useState(false)

  const fetchMine = useCallback(async () => {
    if (!employee?.id) { setLoadingMine(false); return }
    setLoadingMine(true)
    const { data } = await supabase
      .from('pdp_plans')
      .select('*')
      .eq('employee_id', employee.id)
      .order('created_at', { ascending: false })
    setMyPlans(data ?? [])
    setLoadingMine(false)
  }, [employee?.id])

  const fetchManage = useCallback(async () => {
    if (!canManage) { setLoadingManage(false); return }
    setLoadingManage(true)
    const [{ data: emps }, { data: plans }] = await Promise.all([
      supabase.from('employees').select('id, full_name').neq('status', 'terminated').order('full_name'),
      supabase.from('pdp_plans').select('*, employees(full_name)').order('created_at', { ascending: false }),
    ])
    setEmployees(emps ?? [])
    setAllPlans(plans ?? [])
    setLoadingManage(false)
  }, [canManage])

  useEffect(() => { fetchMine() }, [fetchMine])
  useEffect(() => { fetchManage() }, [fetchManage])

  if (!employee && !canManage) {
    return (
      <EmptyState
        title="Account not linked"
        subtitle="Your login is not linked to an employee record, so development plans aren't available. Contact HR to complete setup."
      />
    )
  }

  const activeMine = myPlans.filter(p => p.status === 'active')
  const historyMine = myPlans.filter(p => p.status !== 'active')

  const filteredManagePlans = empFilter === 'all' ? allPlans : allPlans.filter(p => p.employee_id === empFilter)
  const activeManage = filteredManagePlans.filter(p => p.status === 'active')
  const historyManage = filteredManagePlans.filter(p => p.status !== 'active')

  return (
    <div className="space-y-6 max-w-5xl">
      {canManage && (
        <div className="flex gap-1 p-1 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] w-fit">
          {[
            { id: 'mine', label: 'My Development', icon: User },
            { id: 'manage', label: 'Manage Plans', icon: Users2 },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setView(id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                view === id ? 'bg-[#00D4A0]/10 text-[#00D4A0]' : 'text-[#666666] dark:text-[#A0A0A0] hover:text-[#1A1A1A] dark:hover:text-white'
              }`}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
      )}

      {(!canManage || view === 'mine') && (
        <section className="space-y-4">
          {loadingMine ? <Spinner /> : (
            <>
              {activeMine.length === 0 ? (
                <EmptyState
                  title="No development plan yet"
                  subtitle="When HR sets up a growth plan for you, it'll show up here with your progress and action items."
                />
              ) : (
                <div className="space-y-5">
                  {activeMine.map(plan => (
                    <PlanCard
                      key={plan.id} plan={plan} companyId={companyId} canManage={false} isOwner={canCompleteOwnActions}
                      showToast={showToast} onChanged={fetchMine}
                    />
                  ))}
                </div>
              )}

              {historyMine.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowHistoryMine(s => !s)}
                    className="flex items-center gap-1.5 text-sm font-semibold text-[#666666] dark:text-[#A0A0A0] hover:text-[#1A1A1A] dark:hover:text-white transition-colors"
                  >
                    {showHistoryMine ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    Past Plans ({historyMine.length})
                  </button>
                  {showHistoryMine && (
                    <div className="space-y-5 mt-4">
                      {historyMine.map(plan => (
                        <PlanCard
                          key={plan.id} plan={plan} companyId={companyId} canManage={false} isOwner
                          showToast={showToast} onChanged={fetchMine}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {canManage && view === 'manage' && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 p-5 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
            <select value={empFilter} onChange={e => setEmpFilter(e.target.value)} className={SELECT}>
              <option value="all">All Employees</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] transition-colors"
            >
              <Plus size={14} /> New Development Plan
            </button>
          </div>

          {loadingManage ? <Spinner /> : (
            <>
              {activeManage.length === 0 ? (
                <EmptyState title="No active development plans" subtitle="Create one to start tracking an employee's growth toward a specific KPI component." />
              ) : (
                <div className="space-y-5">
                  {activeManage.map(plan => (
                    <PlanCard
                      key={plan.id} plan={plan} companyId={companyId} canManage
                      isOwner={plan.employee_id === employee?.id}
                      employeeName={plan.employees?.full_name}
                      showToast={showToast} onChanged={fetchManage}
                    />
                  ))}
                </div>
              )}

              {historyManage.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowHistoryManage(s => !s)}
                    className="flex items-center gap-1.5 text-sm font-semibold text-[#666666] dark:text-[#A0A0A0] hover:text-[#1A1A1A] dark:hover:text-white transition-colors"
                  >
                    {showHistoryManage ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    Completed / Cancelled ({historyManage.length})
                  </button>
                  {showHistoryManage && (
                    <div className="space-y-5 mt-4">
                      {historyManage.map(plan => (
                        <PlanCard
                          key={plan.id} plan={plan} companyId={companyId} canManage
                          isOwner={plan.employee_id === employee?.id}
                          employeeName={plan.employees?.full_name}
                          showToast={showToast} onChanged={fetchManage}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {showCreateModal && (
            <CreatePlanModal
              employees={employees} companyId={companyId}
              defaultEmployeeId={empFilter !== 'all' ? empFilter : undefined}
              onClose={() => setShowCreateModal(false)}
              onCreated={fetchManage}
              showToast={showToast}
            />
          )}
        </section>
      )}
    </div>
  )
}
