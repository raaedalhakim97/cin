import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle, Check, ChevronRight, Loader2, Lock, RotateCcw, ShieldCheck, Users,
} from 'lucide-react'
import supabase from '../../../services/supabase'
import { weightVerdict } from './levels'

// Who is measured against which scorecard, and where somebody has departed from it.
//
// Assigning an approved template needs no further sign-off — that is what approving the
// template bought. Changing one person's weights does: the override flips the scorecard to
// "exception" and sends it to HR and then the owner. The rule is "follow the standard
// freely, deviating needs a signature", which puts the scrutiny exactly where the risk is.

const INPUT =
  'w-full px-3.5 py-2.5 text-sm rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0] transition-colors'

const STATUS_META = {
  active:        { label: 'In effect',         cls: 'bg-[#00D4A0]/10 text-[#00D4A0]' },
  pending_hr:    { label: 'Exception — with HR', cls: 'bg-[#FF8C42]/10 text-[#FF8C42]' },
  pending_owner: { label: 'Exception — with the owner', cls: 'bg-[#9B5DE5]/10 text-[#9B5DE5]' },
  archived:      { label: 'Replaced',          cls: 'bg-[#A0A0A0]/15 text-[#666666] dark:text-[#A0A0A0]' },
}

// The client-side mirror of kpi_manages_employee. It exists to explain, not to enforce:
// the database refuses the write either way, but a greyed-out row with a reason teaches
// the rule and a row that fails on click does not.
function manageReason(target, me, role) {
  if (role === 'super_admin') return null
  if (target.id === me?.id) {
    return role === 'hr_manager' ? 'The owner handles your scorecard.' : 'HR handles your scorecard.'
  }
  if (role === 'hr_manager') return null
  if (role === 'department_manager') {
    if (!target.department_id || target.department_id !== me?.department_id) {
      return 'Another department — their own manager or HR handles this.'
    }
    return null
  }
  return 'You cannot change scorecards.'
}

// ─── One person's weights ─────────────────────────────────────────────────────

function ScorecardDetail({ scorecard, role, onChanged, showToast }) {
  const [weights, setWeights] = useState([])
  const [names, setNames] = useState({})
  const [templateLines, setTemplateLines] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: w }, { data: tl }] = await Promise.all([
      supabase.rpc('employee_scorecard_weights', { p_scorecard_id: scorecard.id }),
      supabase.from('kpi_template_lines')
        .select('definition_id, weight, kpi_definitions!kpi_template_lines_definition_id_fkey(name)')
        .eq('template_id', scorecard.template_id),
    ])
    setWeights(w ?? [])
    setTemplateLines(tl ?? [])
    setNames(Object.fromEntries((tl ?? []).map((l) => [l.definition_id, l.kpi_definitions?.name ?? '—'])))
    setLoading(false)
  }, [scorecard.id, scorecard.template_id])

  useEffect(() => { load() }, [load])

  const total = weights.reduce((s, w) => s + Number(w.weight), 0)
  const verdict = weightVerdict(total)

  async function override(definitionId, value) {
    const weight = Number(value)
    const standard = Number(templateLines.find((l) => l.definition_id === definitionId)?.weight ?? 0)
    if (!Number.isFinite(weight) || weight <= 0 || weight > 100) return
    setBusy(true)
    const { error } = weight === standard
      // Back to the standard means the departure is gone, so the override row goes too.
      // The trigger still re-checks the scorecard, which is why this does not silently
      // leave it flagged as an exception forever.
      ? await supabase.from('employee_scorecard_overrides').delete()
          .eq('scorecard_id', scorecard.id).eq('definition_id', definitionId)
      : await supabase.from('employee_scorecard_overrides')
          .upsert({ scorecard_id: scorecard.id, definition_id: definitionId, weight },
                  { onConflict: 'scorecard_id,definition_id' })
    setBusy(false)
    if (error) {
      console.error('[Assignments] override failed', error)
      showToast('error', error.message)
      return
    }
    load(); onChanged()
  }

  async function move(to) {
    setBusy(true)
    const { error } = await supabase.from('employee_scorecards').update({ status: to }).eq('id', scorecard.id)
    setBusy(false)
    if (error) {
      console.error('[Assignments] transition failed', error)
      showToast('error', error.message)
      return
    }
    showToast('success', to === 'active' ? 'Approved. This scorecard is now in effect.' : 'Sent on for approval.')
    onChanged()
  }

  if (loading) {
    return <div className="px-5 py-5 flex justify-center"><Loader2 size={16} className="animate-spin text-[#00D4A0]" /></div>
  }

  const isOwner = role === 'super_admin'
  const isHr = role === 'hr_manager'
  const pending = scorecard.status === 'pending_hr' || scorecard.status === 'pending_owner'

  return (
    <div className="px-5 pb-5 pt-4 border-t border-[#E8E8E8] dark:border-[#2A2A2A] space-y-3">
      {weights.map((w) => {
        const standard = Number(templateLines.find((l) => l.definition_id === w.definition_id)?.weight ?? 0)
        const changed = Number(w.weight) !== standard
        return (
          <div key={w.definition_id} className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-[#1A1A1A] dark:text-white truncate">{names[w.definition_id] ?? '—'}</p>
              {changed && (
                <p className="text-[11px] text-[#FF8C42]">standard is {standard}%</p>
              )}
            </div>
            <input
              type="number" min={1} max={100} defaultValue={Number(w.weight)}
              onBlur={(e) => override(w.definition_id, e.target.value)}
              disabled={busy}
              className={`w-20 px-2.5 py-1.5 text-sm rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0] shrink-0 ${
                changed ? 'border-[#FF8C42]/50' : 'border-[#E8E8E8] dark:border-[#2A2A2A]'
              }`}
            />
          </div>
        )
      })}

      <div className={`flex items-center gap-2 px-3.5 py-2.5 rounded-lg text-xs font-semibold ${
        verdict.ok ? 'bg-[#00D4A0]/10 text-[#00D4A0]' : 'bg-[#FF8C42]/10 text-[#FF8C42]'
      }`}>
        {verdict.ok ? <Check size={13} /> : <AlertTriangle size={13} />}
        {total}% — {verdict.text}
        {!verdict.ok && ' The database will not approve it until it is exactly 100.'}
      </div>

      {pending && (
        <div className="flex flex-wrap gap-2">
          {scorecard.status === 'pending_hr' && isHr && (
            <button
              type="button" onClick={() => move('pending_owner')} disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors"
            >
              <ShieldCheck size={12} /> Approve as HR
            </button>
          )}
          {isOwner && (
            <button
              type="button" onClick={() => move('active')} disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors"
            >
              <ShieldCheck size={12} /> Approve and put in effect
            </button>
          )}
          {!isOwner && !(scorecard.status === 'pending_hr' && isHr) && (
            <p className="flex items-center gap-1.5 text-xs text-[#666666] dark:text-[#A0A0A0]">
              <Lock size={11} />
              {scorecard.status === 'pending_hr'
                ? 'Waiting for HR to approve this departure from the standard.'
                : 'Waiting for the owner to approve this departure from the standard.'}
            </p>
          )}
        </div>
      )}

      {scorecard.is_exception && scorecard.status === 'active' && (
        <p className="text-[11px] text-[#666666] dark:text-[#A0A0A0]">
          Approved exception. Changing a weight again sends it back round.
        </p>
      )}
    </div>
  )
}

// ─── The roster ───────────────────────────────────────────────────────────────

export default function Assignments({ companyId, role, me, showToast }) {
  const [employees, setEmployees] = useState([])
  const [scorecards, setScorecards] = useState([])
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState(null)
  const [picking, setPicking] = useState({})
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    const [{ data: emps }, { data: cards }, { data: tpls }] = await Promise.all([
      supabase.from('employees')
        .select('id, full_name, job_title, department_id, departments!employees_department_id_fkey(name)')
        .neq('status', 'terminated').order('full_name'),
      supabase.from('employee_scorecards')
        .select('*, kpi_templates!employee_scorecards_template_id_fkey(name)')
        .neq('status', 'archived'),
      supabase.from('kpi_templates').select('id, name').eq('status', 'approved').order('name'),
    ])
    setEmployees(emps ?? [])
    setScorecards(cards ?? [])
    setTemplates(tpls ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function assign(employee) {
    const templateId = picking[employee.id]
    if (!templateId) { showToast('error', 'Pick a scorecard first.'); return }
    setBusyId(employee.id)
    const { error } = await supabase.from('employee_scorecards').insert({
      company_id: companyId,
      employee_id: employee.id,
      template_id: templateId,
      assigned_by: me?.id ?? null,
    })
    setBusyId(null)
    if (error) {
      console.error('[Assignments] assign failed', error)
      showToast('error', error.message)
      return
    }
    showToast('success', `${employee.full_name} is now measured on this scorecard.`)
    load()
  }

  async function replace(scorecard, employee) {
    setBusyId(employee.id)
    const { error } = await supabase.from('employee_scorecards')
      .update({ status: 'archived', effective_to: new Date().toISOString().slice(0, 10) })
      .eq('id', scorecard.id)
    setBusyId(null)
    if (error) {
      console.error('[Assignments] archive failed', error)
      showToast('error', error.message)
      return
    }
    load()
  }

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 size={20} className="animate-spin text-[#00D4A0]" /></div>
  }

  const byEmployee = Object.fromEntries(scorecards.map((s) => [s.employee_id, s]))
  const unassigned = employees.filter((e) => !byEmployee[e.id]).length

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <p className="text-xs text-[#666666] dark:text-[#A0A0A0] max-w-xl">
          Assigning an approved scorecard needs no further sign-off. Changing one person's
          weights does — it becomes an exception and goes to HR and then the owner.
        </p>
        {unassigned > 0 && (
          <span className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#FF8C42]/10 text-[#FF8C42] shrink-0">
            {unassigned} with no scorecard
          </span>
        )}
      </div>

      {templates.length === 0 && (
        <div className="flex items-start gap-2 px-4 py-3 rounded-xl bg-[#FF8C42]/10 border border-[#FF8C42]/20">
          <AlertTriangle size={14} className="text-[#FF8C42] shrink-0 mt-0.5" />
          <p className="text-xs text-[#FF8C42]">
            No approved scorecards yet, so nobody can be assigned one. Build one in the
            Scorecards tab and take it through approval first.
          </p>
        </div>
      )}

      {employees.length === 0 ? (
        <div className="p-8 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] text-center">
          <Users size={20} className="mx-auto text-[#AAAAAA] dark:text-[#555555] mb-2" />
          <p className="text-sm text-[#666666] dark:text-[#A0A0A0]">Nobody to assign.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {employees.map((emp) => {
            const card = byEmployee[emp.id]
            const reason = manageReason(emp, me, role)
            const open = openId === emp.id
            const meta = card ? (STATUS_META[card.status] ?? STATUS_META.active) : null

            return (
              <div key={emp.id} className={`rounded-xl bg-white dark:bg-[#1E1E1E] border ${
                open ? 'border-[#00D4A0]/40' : 'border-[#E8E8E8] dark:border-[#2A2A2A]'
              }`}>
                <div className="px-5 py-4">
                  <div className="flex items-center gap-3 flex-wrap">
                    <button
                      type="button"
                      onClick={() => card && setOpenId(open ? null : emp.id)}
                      className="flex-1 flex items-center gap-3 text-left min-w-0"
                    >
                      {card && (
                        <ChevronRight size={15} className={`text-[#666666] dark:text-[#A0A0A0] shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white truncate">{emp.full_name}</p>
                          {meta && <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${meta.cls}`}>{meta.label}</span>}
                        </div>
                        <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-0.5 truncate">
                          {emp.departments?.name ?? 'No department'}
                          {emp.job_title ? ` · ${emp.job_title}` : ''}
                          {card ? ` · ${card.kpi_templates?.name ?? 'scorecard'}` : ' · no scorecard'}
                        </p>
                      </div>
                    </button>

                    {reason ? (
                      <p className="text-xs text-[#AAAAAA] dark:text-[#555555] shrink-0 max-w-[16rem] text-right">{reason}</p>
                    ) : card ? (
                      (role === 'super_admin' || role === 'hr_manager') && (
                        <button
                          type="button" onClick={() => replace(card, emp)} disabled={busyId === emp.id}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#666666] dark:text-[#A0A0A0] border border-[#E8E8E8] dark:border-[#2A2A2A] hover:text-[#1A1A1A] dark:hover:text-white disabled:opacity-60 transition-colors shrink-0"
                        >
                          <RotateCcw size={12} /> Replace
                        </button>
                      )
                    ) : templates.length > 0 && (
                      <div className="flex gap-2 shrink-0">
                        <select
                          value={picking[emp.id] ?? ''}
                          onChange={(e) => setPicking((p) => ({ ...p, [emp.id]: e.target.value }))}
                          className={`${INPUT} w-48 py-1.5`}
                        >
                          <option value="">Choose scorecard…</option>
                          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                        <button
                          type="button" onClick={() => assign(emp)} disabled={busyId === emp.id}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors"
                        >
                          {busyId === emp.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Assign
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {open && card && (
                  <ScorecardDetail scorecard={card} role={role} onChanged={load} showToast={showToast} />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
