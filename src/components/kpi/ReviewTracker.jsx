import { useEffect, useState } from 'react'
import { CalendarClock, Check, ChevronDown, ChevronRight, Info } from 'lucide-react'
import supabase from '../../services/supabase'

// The quarterly review, at a glance, for whoever is looking.
//
// Sits above the KPI tabs from the moment HR opens a quarter until a week after it
// is published. It answers three questions in this order: where is the quarter,
// how long is left, and what do *I* have to do — then, folded away, how the whole
// thing works. The last part matters as much as the countdown: a review people do
// not understand gets filled in carelessly or not at all.
//
// Every number here comes from rows the viewer can already read. RLS limits
// kpi_reviews to the viewer's own review, plus their team for a manager, plus the
// whole company for HR — so the same query gives each role the right count with no
// role logic of its own.

const STEPS = [
  { id: 'self_review',    label: 'Self-assessment' },
  { id: 'manager_review', label: 'Manager review' },
  { id: 'calculated',     label: 'Calculated' },
  { id: 'published',      label: 'Published' },
]

const HR_ROLES = new Set(['super_admin', 'hr_manager'])
const SHOW_AFTER_PUBLISH_DAYS = 7

function parseDay(s) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function today() {
  const n = new Date()
  return new Date(n.getFullYear(), n.getMonth(), n.getDate())
}

function daysUntil(dayStr) {
  return Math.round((parseDay(dayStr) - today()) / 86400000)
}

function fmtDay(dayStr) {
  return parseDay(dayStr).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

// The date the current stage is working towards, if HR set one.
function stageDue(cycle) {
  if (cycle.status === 'self_review') return cycle.self_due
  if (cycle.status === 'manager_review') return cycle.manager_due
  return null
}

// Where the current stage started, for the progress bar. Only the cycle's opening is
// stored, so manager review is measured from the self-assessment deadline — which is
// when it is meant to begin.
function stageStart(cycle) {
  if (cycle.status === 'self_review') return cycle.opened_at?.slice(0, 10) ?? null
  if (cycle.status === 'manager_review') return cycle.self_due
  return null
}

function Countdown({ cycle }) {
  const due = stageDue(cycle)
  if (cycle.status === 'calculated') {
    return <p className="text-sm font-semibold text-[#9B5DE5]">Waiting to be published</p>
  }
  if (cycle.status === 'published') {
    return <p className="text-sm font-semibold text-accent">Results are out</p>
  }
  if (!due) {
    return <p className="text-sm font-semibold text-[#666666] dark:text-[#A0A0A0]">No deadline set</p>
  }
  const left = daysUntil(due)
  const text = left > 1 ? `${left} days left`
    : left === 1 ? 'Due tomorrow'
    : left === 0 ? 'Due today'
    : `${plural(-left, 'day')} overdue`
  const tone = left < 0 ? 'text-danger' : left <= 2 ? 'text-[#C2410C] dark:text-[#FF8C42]' : 'text-[#1A1A1A] dark:text-white'
  return (
    <div className="text-right">
      <p className={`text-2xl font-bold leading-none ${tone}`}>{text}</p>
      <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-1">Deadline {fmtDay(due)}</p>
    </div>
  )
}

function ProgressBar({ cycle }) {
  const start = stageStart(cycle)
  const due = stageDue(cycle)
  if (!start || !due) return null
  const total = (parseDay(due) - parseDay(start)) / 86400000
  const gone = (today() - parseDay(start)) / 86400000
  const pct = total > 0 ? Math.min(100, Math.max(0, (gone / total) * 100)) : 100
  const left = daysUntil(due)
  const fill = left < 0 ? 'bg-danger' : left <= 2 ? 'bg-[#FF8C42]' : 'bg-[#00D4A0]'
  return (
    <div className="h-1.5 rounded-full bg-[#F5F5F0] dark:bg-[#252525] overflow-hidden mt-4"
         role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}
         aria-label="Time used in this stage">
      <div className={`h-full rounded-full ${fill}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

function Stepper({ cycle }) {
  const at = STEPS.findIndex((s) => s.id === cycle.status)
  const dateFor = { self_review: cycle.self_due, manager_review: cycle.manager_due }
  return (
    <ol className="grid grid-cols-4 gap-2 mt-5">
      {STEPS.map((s, i) => {
        const done = i < at || cycle.status === 'published'
        const current = i === at && cycle.status !== 'published'
        return (
          <li key={s.id} className="min-w-0">
            <div className={`h-1 rounded-full mb-2 ${done ? 'bg-[#00D4A0]' : current ? 'bg-[#4D9FFF]' : 'bg-[#E8E8E8] dark:bg-[#2A2A2A]'}`} />
            <p className={`flex items-start gap-1 text-[11px] sm:text-xs font-semibold leading-tight ${
              current ? 'text-[#1A1A1A] dark:text-white' : 'text-[#666666] dark:text-[#A0A0A0]'}`}>
              {done && <Check size={12} className="text-accent shrink-0 mt-px" />}
              {s.label}
            </p>
            {dateFor[s.id] && (
              <p className="text-[11px] text-[#666666] dark:text-[#A0A0A0]">by {fmtDay(dateFor[s.id])}</p>
            )}
          </li>
        )
      })}
    </ol>
  )
}

// What this person should do right now, one line each for the hats they wear.
function actionsFor({ cycle, role, me, team, all, weights, canSeeAll }) {
  const out = []
  const selfDue = cycle.self_due ? fmtDay(cycle.self_due) : null
  const mine = me

  if (mine) {
    if (cycle.status === 'self_review' && !mine.self_submitted_at) {
      out.push({
        key: 'me', tone: 'todo',
        text: `Rate yourself for the quarter — one score out of 100. It counts for ${weights.self}% of your result, and you submit it once.`,
        cta: { label: 'Rate myself', go: 'self' },
      })
    } else if (cycle.status === 'self_review') {
      out.push({
        key: 'me', tone: 'done',
        text: `You've rated yourself. Next, your manager rates you${selfDue ? ` after ${selfDue}` : ''}. They can't change what you wrote.`,
      })
    } else if (cycle.status === 'manager_review') {
      out.push({ key: 'me', tone: 'wait', text: 'Your manager is rating you now. You\'ll be notified when your result is published.' })
    } else if (cycle.status === 'calculated') {
      out.push({ key: 'me', tone: 'wait', text: 'Your score is calculated. HR will publish it soon and you\'ll get a notification.' })
    } else if (cycle.status === 'published') {
      out.push({ key: 'me', tone: 'done', text: 'Your result is ready — open Evaluation to see your score and how it was made up.', cta: { label: 'See my result', go: 'evaluation' } })
    }
  }

  if (role === 'department_manager' && team.length > 0) {
    const selfDone = team.filter((r) => r.self_submitted_at).length
    const mgrLeft = team.filter((r) => !r.manager_submitted_at).length
    if (cycle.status === 'self_review') {
      out.push({
        key: 'team', tone: 'wait',
        text: `Your team: ${selfDone} of ${team.length} have rated themselves. Your turn starts when self-assessment closes${selfDue ? ` (${selfDue})` : ''} — you'll rate each person on behavior, achievement and overall.`,
      })
    } else if (cycle.status === 'manager_review') {
      out.push(mgrLeft > 0
        ? {
            key: 'team', tone: 'todo',
            text: `${mgrLeft} of ${team.length} team reviews left. Your ratings make up ${weights.behavior + weights.achievement + weights.manager}% of each person's score — a blank one isn't zero, it drops out.`,
            cta: { label: 'Go to Team Review', go: 'team-review' },
          }
        : { key: 'team', tone: 'done', text: `All ${team.length} team reviews are done. HR calculates the quarter next.` })
    }
  }

  if (canSeeAll && HR_ROLES.has(role) && all.length > 0) {
    const selfDone = all.filter((r) => r.self_submitted_at).length
    const mgrDone = all.filter((r) => r.manager_submitted_at).length
    const due = stageDue(cycle)
    const passed = due ? daysUntil(due) < 0 : false
    if (cycle.status === 'self_review') {
      const ready = selfDone === all.length || passed
      out.push({
        key: 'hr', tone: ready ? 'todo' : 'wait',
        text: ready
          ? `${selfDone} of ${all.length} have self-assessed${passed ? ' and the deadline has passed' : ''}. When you're ready, move the quarter to manager review.`
          : `Company: ${selfDone} of ${all.length} have self-assessed. People who haven't are reminded automatically.`,
        cta: ready ? { label: 'Open Review Cycles', go: 'reviews' } : null,
      })
    } else if (cycle.status === 'manager_review') {
      const ready = mgrDone === all.length || passed
      out.push({
        key: 'hr', tone: ready ? 'todo' : 'wait',
        text: ready
          ? `${mgrDone} of ${all.length} are manager-rated${passed ? ' and the deadline has passed' : ''}. You can calculate the scores.`
          : `Company: ${mgrDone} of ${all.length} manager-rated. Managers with reviews left are reminded automatically. Anyone without a manager is yours to rate.`,
        cta: ready ? { label: 'Open Review Cycles', go: 'reviews' } : { label: 'Team Review', go: 'team-review' },
      })
    } else if (cycle.status === 'calculated') {
      out.push({
        key: 'hr', tone: 'todo',
        text: 'Scores are calculated but nobody can see them yet. Check them, then publish — every employee is notified with their result.',
        cta: { label: 'Open Review Cycles', go: 'reviews' },
      })
    }
  }

  return out
}

const TONE = {
  todo: 'bg-[#4D9FFF]/10 text-[#1A1A1A] dark:text-white',
  wait: 'bg-[#F5F5F0] dark:bg-[#252525] text-[#1A1A1A] dark:text-white',
  done: 'bg-[#00D4A0]/10 text-[#1A1A1A] dark:text-white',
}

export default function ReviewTracker({ employeeId, role, refreshKey, onGo }) {
  const [data, setData] = useState(null)
  const [explain, setExplain] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data: cycles, error } = await supabase
        .from('kpi_review_cycles')
        .select('id, period_year, period_quarter, status, self_due, manager_due, opened_at, published_at')
        .order('period_year', { ascending: false })
        .order('period_quarter', { ascending: false })
        .limit(4)
      if (cancelled) return
      if (error) { console.error('[ReviewTracker] cycles failed', error); setData(null); return }

      // The quarter still in progress, else one published in the last week.
      const cutoff = Date.now() - SHOW_AFTER_PUBLISH_DAYS * 86400000
      const cycle = (cycles ?? []).find((c) => c.status !== 'published' && c.status !== 'draft')
        ?? (cycles ?? []).find((c) => c.status === 'published' && c.published_at && new Date(c.published_at).getTime() > cutoff)
      if (!cycle) { setData(null); return }

      const [{ data: rows }, { data: settings }] = await Promise.all([
        supabase.from('kpi_reviews')
          .select('employee_id, self_submitted_at, manager_submitted_at')
          .eq('cycle_id', cycle.id),
        supabase.from('kpi_settings')
          .select('weight_attendance, weight_behavior, weight_achievement, weight_manager, weight_self, weight_reliability')
          .maybeSingle(),
      ])
      if (cancelled) return
      setData({ cycle, rows: rows ?? [], settings: settings ?? {} })
    }
    load()
    return () => { cancelled = true }
  }, [employeeId, refreshKey])

  if (!data) return null
  const { cycle, rows, settings } = data

  const weights = {
    attendance:  settings.weight_attendance ?? 30,
    behavior:    settings.weight_behavior ?? 25,
    achievement: settings.weight_achievement ?? 20,
    manager:     settings.weight_manager ?? 15,
    self:        settings.weight_self ?? 10,
    reliability: settings.weight_reliability ?? 0,
  }
  const me = rows.find((r) => r.employee_id === employeeId) ?? null
  const others = rows.filter((r) => r.employee_id !== employeeId)
  const actions = actionsFor({
    cycle, role, me, team: others, all: rows, weights, canSeeAll: HR_ROLES.has(role),
  })

  const weightLine = [
    ['Attendance', weights.attendance], ['Hours completed', weights.reliability],
    ['Behavior', weights.behavior], ['Achievement', weights.achievement],
    ['Manager overall', weights.manager], ['Self', weights.self],
  ].filter(([, w]) => w > 0).map(([l, w]) => `${l} ${w}%`).join(' · ')

  return (
    <section data-tour="kpi-tracker" className="p-5 sm:p-6 rounded-2xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] mb-6 max-w-5xl"
             aria-label="Quarterly review progress">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-[#4D9FFF]/10 flex items-center justify-center shrink-0">
            <CalendarClock size={16} className="text-[#4D9FFF]" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-[#1A1A1A] dark:text-white">
              {cycle.period_year} Q{cycle.period_quarter} review
            </h2>
            <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">
              Step {Math.max(1, STEPS.findIndex((s) => s.id === cycle.status) + 1)} of {STEPS.length}: {STEPS.find((s) => s.id === cycle.status)?.label}
            </p>
          </div>
        </div>
        <Countdown cycle={cycle} />
      </div>

      <ProgressBar cycle={cycle} />
      <Stepper cycle={cycle} />

      {actions.length > 0 && (
        <div className="mt-5 space-y-2">
          {actions.map((a) => (
            <div key={a.key} className={`flex flex-wrap items-center gap-3 px-3.5 py-3 rounded-lg ${TONE[a.tone]}`}>
              {a.tone === 'done' && <Check size={14} className="text-accent shrink-0" />}
              <p className="text-sm flex-1 min-w-[200px]">{a.text}</p>
              {a.cta && (
                <button
                  type="button" onClick={() => onGo?.(a.cta.go)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-semibold text-[#062B22] bg-[#00D4A0] hover:bg-[#00B589] transition-colors shrink-0"
                >
                  {a.cta.label} <ChevronRight size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <button
        type="button" onClick={() => setExplain((v) => !v)} aria-expanded={explain}
        className="flex items-center gap-1.5 mt-4 text-xs font-semibold text-[#666666] dark:text-[#A0A0A0] hover:text-[#1A1A1A] dark:hover:text-white"
      >
        <Info size={13} /> How the quarterly review works
        <ChevronDown size={13} className={`transition-transform ${explain ? 'rotate-180' : ''}`} />
      </button>

      {explain && (
        <ul className="mt-3 space-y-2 text-sm text-[#1A1A1A] dark:text-white max-w-2xl list-disc pl-5">
          <li><strong>You go first.</strong> Everyone rates their own quarter before anyone else does, so your view is on record. You submit it once and it locks until next quarter.</li>
          <li><strong>Then your manager.</strong> They rate behavior, achievement and an overall score. They see what you wrote but can&apos;t change it.</li>
          <li><strong>Attendance is automatic.</strong> It comes from your clock-ins. Nobody types it in.</li>
          <li><strong>How it adds up:</strong> {weightLine}.</li>
          <li><strong>Blank isn&apos;t zero.</strong> A part nobody filled in drops out of the total. But a quarter needs at least half of its weight rated to get a rating at all.</li>
          <li><strong>Reminders.</strong> You&apos;re notified when a step opens, then 7, 3 and 1 day before its deadline and on the day, but only while you still have something to do.</li>
        </ul>
      )}
    </section>
  )
}
