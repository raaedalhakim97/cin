import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, BellRing, CheckCircle2, ChevronRight, Loader2, X } from 'lucide-react'
import supabase from '../../services/supabase'

// The pop-up in front of every review-cycle step.
//
// Each step closes the one before it for good, so before HR presses it they are told, by
// name, who has not finished: which people have not rated themselves, which managers
// still have people to rate and who, who has no manager at all, and who is about to be
// published without a rating. Then what continuing will mean for those people — and a
// button to nudge them instead.
//
// When nothing is outstanding it is still a confirmation, just a calm one: these steps
// cannot be undone, and a one-line "are you ready" costs less than a quarter closed by a
// stray tap.

const NEXT = {
  draft:          { title: 'Open self-assessment', does: 'Everyone can rate themselves, and each person is notified.' },
  self_review:    { title: 'Close self-assessment and open manager review', does: 'Self-assessments lock for good. Managers are notified and can start rating their people.' },
  manager_review: { title: 'Calculate the scores', does: 'Manager ratings lock and every score is calculated. Nobody sees them until you publish.' },
  calculated:     { title: 'Publish to employees', does: 'Every employee is notified with their result. This is final.' },
}

const MAX_NAMES = 6

function Names({ list }) {
  const shown = list.slice(0, MAX_NAMES)
  const more = list.length - shown.length
  return (
    <span className="text-[#1A1A1A] dark:text-white">
      {shown.join(', ')}{more > 0 ? ` and ${more} more` : ''}
    </span>
  )
}

function fmtDay(s) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
}

function daysFromToday(s) {
  const [y, m, d] = s.split('-').map(Number)
  const t = new Date(); t.setHours(0, 0, 0, 0)
  return Math.round((new Date(y, m - 1, d) - t) / 86400000)
}

// What is still open at this step, as warning blocks. Empty when the step is clean.
function warningsFor(r) {
  const out = []
  if (r.status === 'self_review') {
    const canDo = r.self_missing.filter((p) => p.can_login).map((p) => p.name)
    const cannot = r.self_missing.filter((p) => !p.can_login).map((p) => p.name)
    if (canDo.length) out.push({
      key: 'self',
      head: `${canDo.length} ${canDo.length === 1 ? 'person hasn\'t' : 'people haven\'t'} rated themselves`,
      names: canDo,
      then: 'If you continue, they lose the chance until next quarter and are scored without the self part.',
    })
    if (cannot.length) out.push({
      key: 'nologin',
      head: `${cannot.length} can't self-assess — no login`,
      names: cannot,
      then: 'They were never able to. Send them an invite if they should be taking part.',
    })
  }
  if (r.status === 'manager_review') {
    for (const m of r.managers) out.push({
      key: `m-${m.name}`,
      head: `${m.name} hasn't finished — ${m.pending} of ${m.total} still to rate`,
      names: m.names,
    })
    if (r.no_manager.length) out.push({
      key: 'nomgr',
      head: `${r.no_manager.length} ${r.no_manager.length === 1 ? 'person has' : 'people have'} no manager — yours to rate`,
      names: r.no_manager,
      then: 'Rate them in Team Review, or give them a manager in Employees → Managers & teams.',
    })
    if (out.length) out[out.length - 1].then = (out[out.length - 1].then ? out[out.length - 1].then + ' ' : '')
      + 'Anyone left unrated is scored on less of their quarter, and below half of it they get no rating at all.'
  }
  if (r.status === 'calculated' && r.unrated.length) out.push({
    key: 'unrated',
    head: `${r.unrated.length} ${r.unrated.length === 1 ? 'person' : 'people'} will be published with no rating`,
    names: r.unrated.map((u) => `${u.name} (${Number(u.coverage ?? 0)}% rated)`),
    then: 'Less than half of their quarter was assessed. Each will be told so, and that their manager or HR can explain what is missing.',
  })
  return out
}

function deadlineNote(r) {
  const due = r.status === 'self_review' ? r.self_due : r.status === 'manager_review' ? r.manager_due : null
  if (!due) return null
  const d = daysFromToday(due)
  if (d > 0) return `The deadline is ${fmtDay(due)} — ${d} day${d === 1 ? '' : 's'} away. You'd be closing early.`
  if (d === 0) return `The deadline is today.`
  return `The deadline was ${fmtDay(due)}.`
}

export default function ReviewStepDialog({ cycle, onConfirm, onCancel, showToast }) {
  const [state, setState] = useState({ loading: true, data: null, error: null })
  const [reminding, setReminding] = useState(false)
  const [reminded, setReminded] = useState(null)
  const cancelRef = useRef(null)
  const next = NEXT[cycle.status]

  useEffect(() => {
    let cancelled = false
    supabase.rpc('review_cycle_readiness', { p_cycle_id: cycle.id }).then(({ data, error }) => {
      if (cancelled) return
      if (error) console.error('[ReviewStepDialog] readiness failed', error)
      setState({ loading: false, data: data ?? null, error })
    })
    return () => { cancelled = true }
  }, [cycle.id])

  useEffect(() => {
    cancelRef.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  async function remind() {
    setReminding(true)
    const { data, error } = await supabase.rpc('remind_review_stragglers', { p_cycle_id: cycle.id })
    setReminding(false)
    if (error) {
      console.error('[ReviewStepDialog] remind failed', error)
      showToast('error', 'Could not send the reminders. Please try again.')
      return
    }
    setReminded(data ?? 0)
    showToast('success', data > 0
      ? `Reminder sent to ${data} ${data === 1 ? 'person' : 'people'}`
      : 'Everyone left was already reminded in the last 12 hours')
  }

  const warnings = state.data ? warningsFor(state.data) : []
  const note = state.data ? deadlineNote(state.data) : null
  const canRemind = ['self_review', 'manager_review'].includes(cycle.status) && warnings.length > 0
  const period = `${cycle.period_year} Q${cycle.period_quarter}`

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:p-4 bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <div
        role="dialog" aria-modal="true" aria-labelledby="step-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-lg max-h-[90dvh] flex flex-col rounded-t-3xl sm:rounded-2xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] shadow-2xl"
      >
        <div className="flex items-start gap-3 p-5 sm:p-6 pb-3">
          <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${
            warnings.length ? 'bg-[#FF8C42]/10' : 'bg-[#00D4A0]/10'}`}>
            {warnings.length
              ? <AlertTriangle size={20} className="text-[#C2410C] dark:text-[#FF8C42]" />
              : <CheckCircle2 size={20} className="text-accent" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-[#666666] dark:text-[#A0A0A0]">{period} review</p>
            <h2 id="step-title" className="text-lg font-bold text-[#1A1A1A] dark:text-white">{next?.title}?</h2>
          </div>
          <button type="button" onClick={onCancel} aria-label="Close"
            className="w-9 h-9 rounded-full flex items-center justify-center text-[#666666] dark:text-[#A0A0A0] hover:bg-[#F5F5F0] dark:hover:bg-[#252525]">
            <X size={17} />
          </button>
        </div>

        <div className="px-5 sm:px-6 overflow-y-auto flex-1 space-y-3">
          <p className="text-sm text-[#1A1A1A] dark:text-white">{next?.does}</p>

          {state.loading && (
            <p className="flex items-center gap-2 text-sm text-[#666666] dark:text-[#A0A0A0]">
              <Loader2 size={14} className="animate-spin" /> Checking who has finished…
            </p>
          )}

          {state.error && (
            <p className="text-sm text-danger">Couldn't check who has finished. You can still continue, but you're doing it blind.</p>
          )}

          {note && <p className="text-sm text-[#666666] dark:text-[#A0A0A0]">{note}</p>}

          {!state.loading && !state.error && warnings.length === 0 && (
            <p className="flex items-center gap-2 text-sm font-semibold text-accent">
              <CheckCircle2 size={15} /> Everyone has finished this step.
            </p>
          )}

          {warnings.map((w) => (
            <div key={w.key} className="p-3.5 rounded-xl bg-[#FF8C42]/10 border border-[#FF8C42]/25">
              <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white">{w.head}</p>
              {w.names?.length > 0 && (
                <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1"><Names list={w.names} /></p>
              )}
              {w.then && <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-2">{w.then}</p>}
            </div>
          ))}

          {reminded != null && (
            <p className="flex items-center gap-2 text-sm text-accent">
              <BellRing size={14} /> {reminded > 0 ? `Reminded ${reminded}. Give them some time before continuing.` : 'They were all reminded in the last 12 hours.'}
            </p>
          )}
        </div>

        <div className="flex flex-col-reverse sm:flex-row gap-2 sm:gap-3 p-5 sm:p-6 pt-4 pb-[max(20px,env(safe-area-inset-bottom))] sm:pb-6">
          <button ref={cancelRef} type="button" onClick={onCancel}
            className="flex-1 h-11 rounded-xl text-sm font-semibold text-[#1A1A1A] dark:text-white border border-[#E8E8E8] dark:border-[#2A2A2A] hover:bg-[#F5F5F0] dark:hover:bg-[#252525] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4A0]/60">
            Not yet
          </button>
          {canRemind && (
            <button type="button" onClick={remind} disabled={reminding || reminded != null}
              className="flex-1 h-11 flex items-center justify-center gap-2 rounded-xl text-sm font-semibold text-[#062B22] bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60">
              {reminding ? <Loader2 size={14} className="animate-spin" /> : <BellRing size={14} />}
              Remind them
            </button>
          )}
          <button type="button" onClick={onConfirm} disabled={state.loading}
            className={`flex-1 h-11 flex items-center justify-center gap-1.5 rounded-xl text-sm font-semibold disabled:opacity-60 ${
              warnings.length
                ? 'text-[#C2410C] dark:text-[#FF8C42] border border-[#FF8C42]/50 hover:bg-[#FF8C42]/10'
                : 'text-[#062B22] bg-[#00D4A0] hover:bg-[#00B589]'}`}>
            {warnings.length ? 'Continue anyway' : 'Continue'} <ChevronRight size={15} />
          </button>
        </div>
      </div>
    </div>
  )
}
