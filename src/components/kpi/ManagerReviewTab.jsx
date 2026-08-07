import { useEffect, useState } from 'react'
import { Users, Loader2, Lock, CheckCircle2, AlertCircle, Info } from 'lucide-react'
import supabase from '../../services/supabase'

// Where a manager scores their team for the quarter.
//
// This is the step that was missing. A cycle could be opened, employees could
// self-assess, and HR could advance the stage to `manager_review` — and then
// nothing, because no screen ever wrote kpi_reviews.manager_score. The stage
// existed, the database guard enforced it, and the cycle simply stalled.
//
// Everything about who may write what is decided by the database, not here:
//
//   * RLS scopes the rows. A department_manager selects and updates only their
//     own department; HR sees the whole company. So this queries the cycle
//     plainly and shows whatever comes back — no client-side filtering to get
//     wrong, and no way for this screen to widen someone's access.
//   * kpi_review_guard decides the columns and the stage. A manager may write
//     manager_score, behavior_score, achievement_score and manager_comment,
//     and only while the cycle is at manager_review. It stamps
//     manager_submitted_at and manager_employee_id itself.
//
// The form mirrors those rules rather than inventing its own. If a field is not
// shown as editable here, a write would have been reverted anyway.

const SCORES = [
  { key: 'manager_score',     label: 'Overall',     hint: 'Your judgement of the quarter as a whole' },
  { key: 'behavior_score',    label: 'Behaviour',   hint: 'Conduct, collaboration, reliability with people' },
  { key: 'achievement_score', label: 'Achievement', hint: 'Delivery against what the quarter asked for' },
]

const STAGE_NOTE = {
  self_review: 'Employees are still self-assessing. You can score once HR closes self-assessment.',
  calculated:  'Scores have been calculated. Manager input is closed for this quarter.',
  published:   'This quarter is published. Manager input is closed.',
}

function scoreOrEmpty(v) {
  return v == null ? '' : String(v)
}

export default function ManagerReviewTab({ role, showToast }) {
  const [state, setState] = useState({ loading: true, cycle: null, rows: [] })
  const [drafts, setDrafts] = useState({})
  const [savingId, setSavingId] = useState(null)
  // Reload counter rather than an exported load(): calling a setState-bearing
  // callback straight from an effect body cascades renders. Same shape as
  // SelfReviewCard, so both review surfaces refresh the same way.
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function load() {
      // Most recent cycle, same selection the other review surfaces use so all
      // three agree about which quarter is "current".
      const { data: cycles, error: cErr } = await supabase
        .from('kpi_review_cycles')
        .select('*')
        .order('period_year', { ascending: false })
        .order('period_quarter', { ascending: false })
        .limit(1)

      if (cancelled) return
      if (cErr) {
        console.error('[ManagerReviewTab] cycle load failed', cErr)
        setState({ loading: false, cycle: null, rows: [] })
        return
      }
      const cycle = cycles?.[0] ?? null
      if (!cycle) { setState({ loading: false, cycle: null, rows: [] }); return }

      // kpi_reviews has two foreign keys to employees — employee_id and
      // manager_employee_id — so the embed has to name which one, or PostgREST
      // refuses the request as ambiguous rather than picking for us.
      const { data: rows, error: rErr } = await supabase
        .from('kpi_reviews')
        .select(`
          id, employee_id, self_score, self_comment, self_submitted_at,
          manager_score, behavior_score, achievement_score, manager_comment,
          manager_submitted_at,
          employees!kpi_reviews_employee_id_fkey ( full_name, job_title, emp_code )
        `)
        .eq('cycle_id', cycle.id)

      if (cancelled) return
      if (rErr) {
        console.error('[ManagerReviewTab] review load failed', rErr)
        setState({ loading: false, cycle, rows: [] })
        return
      }

      const sorted = (rows ?? []).slice().sort((a, b) =>
        (a.employees?.full_name ?? '').localeCompare(b.employees?.full_name ?? ''))

      setDrafts(Object.fromEntries(sorted.map((r) => [r.id, {
        manager_score:     scoreOrEmpty(r.manager_score),
        behavior_score:    scoreOrEmpty(r.behavior_score),
        achievement_score: scoreOrEmpty(r.achievement_score),
        manager_comment:   r.manager_comment ?? '',
      }])))
      setState({ loading: false, cycle, rows: sorted })
    }

    load()
    return () => { cancelled = true }
  }, [reloadKey])

  const { loading, cycle, rows } = state

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[#666666] dark:text-[#A0A0A0]">
        <Loader2 size={15} className="animate-spin" /> Loading reviews…
      </div>
    )
  }

  if (!cycle) {
    return (
      <div className="p-6 rounded-2xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
        <p className="text-sm text-[#666666] dark:text-[#A0A0A0]">
          No review cycle has been opened yet. HR opens one from the Review Cycles tab.
        </p>
      </div>
    )
  }

  // HR may correct at any stage — that is the guard's rule, so it is this
  // screen's rule too. A department manager writes only during manager_review.
  const isHR = role === 'super_admin' || role === 'hr_manager'
  const open = cycle.status === 'manager_review' || isHR
  const scored = rows.filter((r) => r.manager_submitted_at).length

  function setDraft(id, key, value) {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], [key]: value } }))
  }

  async function save(row) {
    const d = drafts[row.id] ?? {}
    const payload = {}

    for (const { key, label } of SCORES) {
      const raw = String(d[key] ?? '').trim()
      if (raw === '') { payload[key] = null; continue }
      const n = Number(raw)
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        showToast('error', `${label} must be a number between 0 and 100.`)
        return
      }
      payload[key] = n
    }
    payload.manager_comment = d.manager_comment?.trim() || null

    // Only the four columns a manager owns are sent. The guard would revert
    // anything else, and sending fields you cannot set turns a rule you are
    // obeying into a failure that reads like a bug.
    setSavingId(row.id)
    const { error } = await supabase.from('kpi_reviews').update(payload).eq('id', row.id)
    setSavingId(null)

    if (error) {
      console.error('[ManagerReviewTab] save failed', error)
      showToast('error', error.message?.startsWith('Manager review is not open')
        ? error.message
        : 'Something went wrong saving this review. Please try again.')
      return
    }
    showToast('success', `Saved ${row.employees?.full_name ?? 'review'}`)
    setReloadKey((k) => k + 1)
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h2 className="text-base font-bold text-[#1A1A1A] dark:text-white">
            Team review — {cycle.period_year} Q{cycle.period_quarter}
          </h2>
          <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-1">
            {scored} of {rows.length} scored
            {cycle.manager_due && open && (
              <> · due {new Date(cycle.manager_due + 'T00:00:00').toLocaleDateString('en-US', { day: 'numeric', month: 'long' })}</>
            )}
          </p>
        </div>
        {isHR && cycle.status !== 'manager_review' && (
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#4D9FFF]/10 text-[#4D9FFF]">
            <Info size={13} /> HR override — cycle is {cycle.status.replace('_', ' ')}
          </span>
        )}
      </div>

      {!open && (
        <div className="flex items-start gap-2 px-3.5 py-3 mb-5 rounded-lg bg-[#F5F5F0] dark:bg-[#252525]">
          <Lock size={13} className="text-[#666666] dark:text-[#A0A0A0] shrink-0 mt-0.5" />
          <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">
            {STAGE_NOTE[cycle.status] ?? 'Manager review is not open for this quarter.'}
          </p>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="p-6 rounded-2xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
          <p className="text-sm text-[#666666] dark:text-[#A0A0A0]">
            Nobody to review in this cycle. Managers see only their own department.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {rows.map((r) => {
            const d = drafts[r.id] ?? {}
            const done = !!r.manager_submitted_at
            return (
              <div
                key={r.id}
                className="p-5 rounded-2xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#1A1A1A] dark:text-white">
                      {r.employees?.full_name ?? 'Unknown'}
                    </p>
                    <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">
                      {[r.employees?.emp_code, r.employees?.job_title].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </div>
                  {done && (
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-[#00D4A0]">
                      <CheckCircle2 size={13} /> Scored
                    </span>
                  )}
                </div>

                {/* Their own view of the quarter, read-only. A manager cannot
                    change what an employee said about themselves — the guard
                    reverts it — so it is shown as context, not as a field. */}
                <div className="mt-3.5 px-3.5 py-3 rounded-lg bg-[#F5F5F0] dark:bg-[#252525]">
                  {r.self_submitted_at ? (
                    <>
                      <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">
                        They scored themselves{' '}
                        <span className="font-bold text-[#1A1A1A] dark:text-white">
                          {Number(r.self_score).toFixed(0)}/100
                        </span>
                      </p>
                      {r.self_comment && (
                        <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-1.5 italic">
                          “{r.self_comment}”
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="flex items-center gap-1.5 text-xs text-[#666666] dark:text-[#A0A0A0]">
                      <AlertCircle size={12} className="shrink-0" />
                      No self-assessment submitted. Score on what you observed.
                    </p>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap gap-3">
                  {SCORES.map(({ key, label, hint }) => (
                    <div key={key}>
                      <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1" title={hint}>
                        {label}
                      </label>
                      <input
                        type="number" min={0} max={100} disabled={!open}
                        value={d[key] ?? ''}
                        onChange={(e) => setDraft(r.id, key, e.target.value)}
                        placeholder="—"
                        className="w-24 px-3.5 py-2.5 text-sm rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white disabled:opacity-50 focus:outline-none focus:border-[#00D4A0]"
                      />
                    </div>
                  ))}

                  <div className="flex-1 min-w-[220px]">
                    <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">
                      Comment{' '}
                      <span className="font-normal text-[#AAAAAA] dark:text-[#555555]">
                        (the employee sees this once published)
                      </span>
                    </label>
                    <input
                      type="text" maxLength={2000} disabled={!open}
                      value={d.manager_comment ?? ''}
                      onChange={(e) => setDraft(r.id, 'manager_comment', e.target.value)}
                      className="w-full px-3.5 py-2.5 text-sm rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white disabled:opacity-50 focus:outline-none focus:border-[#00D4A0]"
                    />
                  </div>

                  <div className="flex items-end">
                    <button
                      type="button" onClick={() => save(r)} disabled={!open || savingId === r.id}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors"
                    >
                      {savingId === r.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                      {done ? 'Update' : 'Save'}
                    </button>
                  </div>
                </div>

                {done && (
                  <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-3">
                    Submitted {new Date(r.manager_submitted_at).toLocaleString('en-US', {
                      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                    })}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}

      <p className="flex items-start gap-2 text-xs text-[#666666] dark:text-[#A0A0A0] mt-5 max-w-2xl">
        <Users size={13} className="shrink-0 mt-0.5" />
        Leave a score blank if you have nothing to judge it on. A blank is recorded as
        &quot;not assessed&quot; and is left out of the calculation — it is not a zero.
      </p>
    </div>
  )
}
