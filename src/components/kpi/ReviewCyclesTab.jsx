import { useEffect, useState } from 'react'
import { CalendarClock, ChevronRight, Loader2, Lock, Play, Users, CheckCircle2, AlertTriangle } from 'lucide-react'
import supabase from '../../services/supabase'

// HR's control panel for the quarterly review cycle.
//
// The cycle is a one-way state machine, and each transition closes the previous
// stage for writing — that is what makes "employee rates, then manager rates"
// a rule rather than a label. Nothing here can skip a stage or go backwards,
// because advance_kpi_review_cycle() only ever moves forward by one.
//
// Without this screen no cycle can be opened at all, which means no employee
// can ever self-assess. It is the entry point to the whole workflow.

const STAGES = [
  { id: 'draft',          label: 'Draft',           blurb: 'Created but not open to anyone.' },
  { id: 'self_review',    label: 'Self-assessment', blurb: 'Employees can score themselves. Nobody else can write.' },
  { id: 'manager_review', label: 'Manager review',  blurb: 'Managers score their team. Self scores are locked.' },
  { id: 'calculated',     label: 'Calculated',      blurb: 'Scores computed from the quarter. Not yet visible to employees.' },
  { id: 'published',      label: 'Published',       blurb: 'Visible to employees. Final.' },
]

const NEXT_LABEL = {
  draft:          'Open self-assessment',
  self_review:    'Close self-assessment, open manager review',
  manager_review: 'Calculate scores',
  calculated:     'Publish to employees',
}

function quarterOf(date) {
  return Math.floor(date.getMonth() / 3) + 1
}

function StageBadge({ status }) {
  const map = {
    draft:          'bg-[#A0A0A0]/10 text-[#A0A0A0]',
    self_review:    'bg-[#4D9FFF]/10 text-[#4D9FFF]',
    manager_review: 'bg-[#FF8C42]/10 text-[#FF8C42]',
    calculated:     'bg-[#9B5DE5]/10 text-[#9B5DE5]',
    published:      'bg-[#00D4A0]/10 text-[#00D4A0]',
  }
  const stage = STAGES.find((s) => s.id === status)
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold shrink-0 ${map[status] ?? map.draft}`}>
      {stage?.label ?? status}
    </span>
  )
}

export default function ReviewCyclesTab({ showToast }) {
  const [cycles, setCycles] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [opening, setOpening] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  // The quarter that just ended is the one you normally review.
  const now = new Date()
  const prev = new Date(now.getFullYear(), now.getMonth() - 3, 1)
  const [year, setYear] = useState(prev.getFullYear())
  const [quarter, setQuarter] = useState(quarterOf(prev))

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data, error } = await supabase
        .from('kpi_review_cycles')
        .select('*')
        .order('period_year', { ascending: false })
        .order('period_quarter', { ascending: false })
      if (cancelled) return
      if (error) {
        console.error('[ReviewCyclesTab] load failed', error)
        setCycles([])
        setLoading(false)
        return
      }

      // Progress per cycle: how many people have actually filled their part in.
      const withCounts = await Promise.all(
        (data ?? []).map(async (c) => {
          const [total, selfDone, mgrDone] = await Promise.all([
            supabase.from('kpi_reviews').select('id', { count: 'exact', head: true }).eq('cycle_id', c.id),
            supabase.from('kpi_reviews').select('id', { count: 'exact', head: true }).eq('cycle_id', c.id).not('self_submitted_at', 'is', null),
            supabase.from('kpi_reviews').select('id', { count: 'exact', head: true }).eq('cycle_id', c.id).not('manager_submitted_at', 'is', null),
          ])
          return { ...c, total: total.count ?? 0, selfDone: selfDone.count ?? 0, mgrDone: mgrDone.count ?? 0 }
        })
      )
      if (cancelled) return
      setCycles(withCounts)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [reloadKey])

  const reload = () => setReloadKey((k) => k + 1)

  async function openCycle() {
    setOpening(true)
    const { data, error } = await supabase.rpc('open_kpi_review_cycle', {
      p_year: Number(year),
      p_quarter: Number(quarter),
    })
    setOpening(false)
    if (error) {
      console.error('[ReviewCyclesTab] open failed', error)
      // The function's own messages are already written for a person —
      // "A review cycle for 2026 Q2 already exists" needs no translation.
      showToast('error', error.message || 'Could not open the cycle.')
      return
    }
    showToast('success', `Self-assessment open for ${data?.employees ?? 0} employees`)
    reload()
  }

  async function advance(cycle) {
    setBusyId(cycle.id)
    const { data, error } = await supabase.rpc('advance_kpi_review_cycle', { p_cycle_id: cycle.id })
    setBusyId(null)
    if (error) {
      console.error('[ReviewCyclesTab] advance failed', error)
      showToast('error', error.message || 'Could not advance the cycle.')
      return
    }
    const stage = STAGES.find((s) => s.id === data?.status)
    showToast('success', `Now at: ${stage?.label ?? data?.status}`)
    reload()
  }

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 size={20} className="animate-spin text-[#00D4A0]" /></div>
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Open a new quarter */}
      <div className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-9 h-9 rounded-xl bg-[#00D4A0]/10 flex items-center justify-center shrink-0">
            <CalendarClock size={16} className="text-[#00D4A0]" />
          </div>
          <h3 className="text-base font-semibold text-[#1A1A1A] dark:text-white">Open a review cycle</h3>
        </div>
        <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mb-4 max-w-lg">
          Opening a quarter creates a review for every active employee and lets them start scoring
          themselves. Until you do this, nobody can self-assess.
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Year</label>
            <input
              type="number" min={2020} max={2100} value={year}
              onChange={(e) => setYear(e.target.value)}
              className="w-28 px-3.5 py-2.5 text-sm rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Quarter</label>
            <select
              value={quarter} onChange={(e) => setQuarter(e.target.value)}
              className="px-3.5 py-2.5 text-sm rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0]"
            >
              {[1, 2, 3, 4].map((q) => <option key={q} value={q}>Q{q}</option>)}
            </select>
          </div>
          <button
            type="button" onClick={openCycle} disabled={opening}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors"
          >
            {opening ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            Open cycle
          </button>
        </div>
      </div>

      {/* Existing cycles */}
      {cycles.length === 0 ? (
        <div className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
          <p className="text-sm text-[#666666] dark:text-[#A0A0A0]">
            No review cycles yet. Open one above to start the first quarterly review.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {cycles.map((c) => {
            const nextLabel = NEXT_LABEL[c.status]
            const stage = STAGES.find((s) => s.id === c.status)
            // Advancing out of self-review or manager review before people have
            // filled it in is allowed — sometimes a deadline is a deadline — but
            // it should be a deliberate choice, so say what will be lost.
            const selfIncomplete = c.status === 'self_review' && c.selfDone < c.total
            const mgrIncomplete = c.status === 'manager_review' && c.mgrDone < c.total

            return (
              <div key={c.id} className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2.5 mb-1">
                      <h4 className="text-base font-bold text-[#1A1A1A] dark:text-white">
                        {c.period_year} Q{c.period_quarter}
                      </h4>
                      <StageBadge status={c.status} />
                    </div>
                    <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">{stage?.blurb}</p>
                  </div>

                  {nextLabel ? (
                    <button
                      type="button" onClick={() => advance(c)} disabled={busyId === c.id}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-[#1A1A1A] dark:text-white border border-[#E8E8E8] dark:border-[#2A2A2A] hover:border-[#00D4A0]/40 disabled:opacity-60 transition-colors shrink-0"
                    >
                      {busyId === c.id ? <Loader2 size={14} className="animate-spin" /> : <ChevronRight size={14} />}
                      {nextLabel}
                    </button>
                  ) : (
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-[#00D4A0] shrink-0">
                      <Lock size={13} /> Final
                    </span>
                  )}
                </div>

                {/* Progress */}
                <div className="grid grid-cols-3 gap-3 mt-5">
                  <div className="px-3.5 py-3 rounded-lg bg-[#F5F5F0] dark:bg-[#252525]">
                    <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mb-0.5">Employees</p>
                    <p className="text-lg font-bold text-[#1A1A1A] dark:text-white flex items-center gap-1.5">
                      <Users size={14} className="text-[#666666] dark:text-[#A0A0A0]" />{c.total}
                    </p>
                  </div>
                  <div className="px-3.5 py-3 rounded-lg bg-[#F5F5F0] dark:bg-[#252525]">
                    <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mb-0.5">Self-assessed</p>
                    <p className={`text-lg font-bold ${c.selfDone === c.total && c.total > 0 ? 'text-[#00D4A0]' : 'text-[#1A1A1A] dark:text-white'}`}>
                      {c.selfDone}<span className="text-xs font-normal text-[#666666] dark:text-[#A0A0A0]"> / {c.total}</span>
                    </p>
                  </div>
                  <div className="px-3.5 py-3 rounded-lg bg-[#F5F5F0] dark:bg-[#252525]">
                    <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mb-0.5">Manager scored</p>
                    <p className={`text-lg font-bold ${c.mgrDone === c.total && c.total > 0 ? 'text-[#00D4A0]' : 'text-[#1A1A1A] dark:text-white'}`}>
                      {c.mgrDone}<span className="text-xs font-normal text-[#666666] dark:text-[#A0A0A0]"> / {c.total}</span>
                    </p>
                  </div>
                </div>

                {(selfIncomplete || mgrIncomplete) && (
                  <div className="flex items-start gap-2 mt-4 px-3.5 py-3 rounded-lg bg-[#FF8C42]/10 border border-[#FF8C42]/20">
                    <AlertTriangle size={13} className="text-[#FF8C42] shrink-0 mt-0.5" />
                    <p className="text-xs text-[#FF8C42]">
                      {selfIncomplete
                        ? `${c.total - c.selfDone} employee(s) have not self-assessed yet. Advancing locks them out of doing so — their score will simply be calculated without a self component.`
                        : `${c.total - c.mgrDone} employee(s) have no manager score yet. Advancing calculates their score without it, which may leave them below the coverage floor and therefore unrated.`}
                    </p>
                  </div>
                )}

                {c.status === 'published' && c.published_at && (
                  <p className="flex items-center gap-1.5 text-xs text-[#00D4A0] mt-4">
                    <CheckCircle2 size={13} />
                    Published {new Date(c.published_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
