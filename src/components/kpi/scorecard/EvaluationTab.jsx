import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, Check, ClipboardCheck, Gauge, Loader2, Lock, MessageSquare, Quote,
  Sparkles, TrendingUp, Users,
} from 'lucide-react'
import supabase from '../../../services/supabase'
import { LEVELS, LEVEL_BY_NUMBER, levelHex } from './levels'
import { bandFor, employeeAdvice, managerAdvice } from './advice'

// The evaluation itself: both sides rate the same criteria, the manager's rating is the
// score, and the employee's is what makes it a conversation instead of a grade.
//
// Two rules this screen mirrors rather than invents:
//
//   · A rating is a sentence, not a number. Picking a level shows the sentences the company
//     wrote for that level, and the chosen one is copied onto the review — so when HR edits
//     the wording next June, what this employee was told in March still reads the way it did.
//   · The manager's rating is not shown to the employee until the quarter is published.
//     This is a screen rule, not a database one: the row is readable either way. It exists
//     so nobody reads a half-finished judgement of themselves, and it is the honest place
//     for it, because hiding it in the database would also hide it from the manager.

const INPUT =
  'w-full px-3.5 py-2.5 text-sm rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0] transition-colors'

// The client-side mirror of kpi_manages_employee (migration 44). The database is the
// authority; this only decides what to draw.
function canRate(review, me, role) {
  if (!me) return false
  if (review.employee_id === me.id) return false      // nobody rates themselves
  if (role === 'super_admin' || role === 'hr_manager') return true
  if (role === 'department_manager') {
    return !!review.department_id && review.department_id === me.department_id
  }
  return false
}

function ScoreRing({ score, size = 132 }) {
  const stroke = 11
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, Number(score ?? 0))) / 100
  const band = bandFor(score == null ? null : Number(score))
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none"
                className="stroke-[#E8E8E8] dark:stroke-[#2A2A2A]" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={band.hex} strokeWidth={stroke} fill="none"
                strokeDasharray={c} strokeDashoffset={c * (1 - pct)} strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold text-[#1A1A1A] dark:text-white">
          {score == null ? '—' : Math.round(Number(score))}
        </span>
        <span className="text-[11px] text-[#666666] dark:text-[#A0A0A0]">/ 100</span>
      </div>
    </div>
  )
}

function LevelPicker({ value, onChange, disabled }) {
  return (
    <div className="grid grid-cols-5 gap-1.5">
      {LEVELS.map((l) => {
        const on = value === l.level
        return (
          <button
            key={l.level} type="button" disabled={disabled}
            onClick={() => onChange(on ? null : l.level)}
            title={l.label}
            className={`px-1 py-2 rounded-lg text-[11px] font-semibold border transition-colors disabled:cursor-not-allowed ${
              on ? 'text-white border-transparent' : 'text-[#666666] dark:text-[#A0A0A0] border-[#E8E8E8] dark:border-[#2A2A2A]'
            } ${disabled && !on ? 'opacity-40' : ''} ${!on && !disabled ? 'hover:border-[#00D4A0]/40' : ''}`}
            style={on ? { backgroundColor: l.hex } : undefined}
          >
            {l.short}
          </button>
        )
      })}
    </div>
  )
}

// One side of one criterion — the level, the sentence, and the note.
function RatingSide({ title, level, anchorId, note, anchors, editable, onSave, saving, lockNote }) {
  // Initialised from props once and never synced back by an effect. The caller keys this
  // component on the row's updated_at, so a save that changes the saved values remounts it
  // with the new ones — which is the same result without a render cascade.
  const [draftLevel, setDraftLevel] = useState(level ?? null)
  const [draftAnchor, setDraftAnchor] = useState(anchorId ?? null)
  const [draftNote, setDraftNote] = useState(note ?? '')

  const dirty = draftLevel !== (level ?? null)
    || draftAnchor !== (anchorId ?? null)
    || draftNote !== (note ?? '')
  const forLevel = anchors.filter((a) => a.level === draftLevel)

  if (!editable) {
    return (
      <div className="p-3.5 rounded-xl bg-[#F5F5F0] dark:bg-[#252525]">
        <p className="text-[11px] font-semibold text-[#666666] dark:text-[#A0A0A0] uppercase tracking-wide mb-2">{title}</p>
        {lockNote ? (
          <p className="flex items-center gap-1.5 text-xs text-[#AAAAAA] dark:text-[#555555]">
            <Lock size={11} /> {lockNote}
          </p>
        ) : level == null ? (
          <p className="text-xs text-[#AAAAAA] dark:text-[#555555]">Not rated.</p>
        ) : (
          <>
            <p className="text-sm font-semibold" style={{ color: levelHex(level) }}>
              {LEVEL_BY_NUMBER[level]?.label}
            </p>
            {anchors.find((a) => a.id === anchorId)?.comment && (
              <p className="text-xs text-[#1A1A1A] dark:text-white mt-1.5 italic">
                “{anchors.find((a) => a.id === anchorId).comment}”
              </p>
            )}
            {note && <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-1.5">{note}</p>}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="p-3.5 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
      <p className="text-[11px] font-semibold text-[#666666] dark:text-[#A0A0A0] uppercase tracking-wide mb-2">{title}</p>
      <LevelPicker value={draftLevel} onChange={(l) => { setDraftLevel(l); setDraftAnchor(null) }} />

      {draftLevel != null && (
        <div className="mt-3 space-y-1.5">
          {forLevel.length === 0 ? (
            <p className="text-[11px] text-[#FF8C42]">
              Nobody has written what this level means for this criterion yet. HR can add it in Criteria.
            </p>
          ) : forLevel.map((a) => (
            <button
              key={a.id} type="button" onClick={() => setDraftAnchor(draftAnchor === a.id ? null : a.id)}
              className={`w-full flex items-start gap-2 px-3 py-2 rounded-lg text-left text-xs transition-colors border ${
                draftAnchor === a.id
                  ? 'border-[#00D4A0] bg-[#00D4A0]/5 text-[#1A1A1A] dark:text-white'
                  : 'border-[#E8E8E8] dark:border-[#2A2A2A] text-[#666666] dark:text-[#A0A0A0] hover:border-[#00D4A0]/40'
              }`}
            >
              <Check size={12} className={`shrink-0 mt-0.5 ${draftAnchor === a.id ? 'text-[#00D4A0]' : 'opacity-0'}`} />
              {a.comment}
            </button>
          ))}
        </div>
      )}

      <textarea
        rows={2} value={draftNote} onChange={(e) => setDraftNote(e.target.value)}
        placeholder="Anything to add, in your own words (optional)"
        className={`${INPUT} mt-3 text-xs resize-none`}
      />

      <button
        type="button" disabled={!dirty || saving}
        onClick={() => onSave({
          level: draftLevel,
          anchorId: draftAnchor,
          anchorText: anchors.find((a) => a.id === draftAnchor)?.comment ?? null,
          note: draftNote.trim() || null,
        })}
        className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-40 transition-colors"
      >
        {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
        {dirty ? 'Save' : 'Saved'}
      </button>
    </div>
  )
}

function AdviceBlock({ title, icon: Icon, lines }) {
  if (lines.length === 0) return null
  return (
    <div className="p-5 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
      <div className="flex items-center gap-2 mb-3">
        <Icon size={15} className="text-[#00D4A0]" />
        <h3 className="text-sm font-bold text-[#1A1A1A] dark:text-white">{title}</h3>
      </div>
      <div className="space-y-2.5">
        {lines.map((l, i) => {
          if (l.tone === 'quote') {
            return (
              <div key={i} className="pl-3 border-l-2 border-[#00D4A0]/40">
                {l.label && <p className="text-[11px] font-semibold text-[#666666] dark:text-[#A0A0A0] mb-0.5">{l.label}</p>}
                <p className="text-sm text-[#1A1A1A] dark:text-white italic flex gap-1.5">
                  <Quote size={12} className="text-[#00D4A0] shrink-0 mt-1" />{l.text}
                </p>
              </div>
            )
          }
          const cls = l.tone === 'headline'
            ? 'text-base font-bold text-[#1A1A1A] dark:text-white'
            : l.tone === 'fix' ? 'text-sm text-[#FF8C42]'
            : l.tone === 'warn' ? 'text-sm text-[#9B5DE5]'
            : l.tone === 'grow' ? 'text-sm text-[#00D4A0]'
            : 'text-sm text-[#666666] dark:text-[#A0A0A0]'
          return <p key={i} className={cls}>{l.text}</p>
        })}
      </div>
    </div>
  )
}

// ─── The tab ──────────────────────────────────────────────────────────────────

export default function EvaluationTab({ me, role, showToast }) {
  const [cycles, setCycles] = useState([])
  const [cycleId, setCycleId] = useState('')
  const [reviews, setReviews] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [lines, setLines] = useState([])
  const [anchors, setAnchors] = useState([])
  const [report, setReport] = useState({ score: null, coverage: 0, opportunities: [], disagreements: [] })
  const [loading, setLoading] = useState(true)
  const [loadingReview, setLoadingReview] = useState(false)
  const [savingKey, setSavingKey] = useState(null)

  // Cycles
  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data, error } = await supabase.from('kpi_review_cycles')
        .select('*').order('period_year', { ascending: false })
        .order('period_quarter', { ascending: false }).limit(8)
      if (cancelled) return
      if (error) console.error('[EvaluationTab] cycles failed', error)
      setCycles(data ?? [])
      setCycleId((data ?? [])[0]?.id ?? '')
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [])

  const cycle = cycles.find((c) => c.id === cycleId) ?? null

  // Reviews inside the chosen cycle. RLS already limits this to the caller's own review
  // plus anyone they manage, so there is no client-side filter here to get out of step
  // with the database.
  const loadReviews = useCallback(async () => {
    if (!cycleId) { setReviews([]); return }
    const { data, error } = await supabase.from('kpi_reviews')
      .select('id, employee_id, employees!kpi_reviews_employee_id_fkey(full_name, job_title, department_id, departments!employees_department_id_fkey(name))')
      .eq('cycle_id', cycleId)
    if (error) {
      console.error('[EvaluationTab] reviews failed', error)
      setReviews([])
      return
    }
    const mapped = (data ?? []).map((r) => ({
      id: r.id,
      employee_id: r.employee_id,
      name: r.employees?.full_name ?? 'Unknown',
      job_title: r.employees?.job_title ?? null,
      department_id: r.employees?.department_id ?? null,
      department: r.employees?.departments?.name ?? null,
    }))
    mapped.sort((a, b) => {
      const mineA = a.employee_id === me?.id ? 0 : 1
      const mineB = b.employee_id === me?.id ? 0 : 1
      return mineA - mineB || a.name.localeCompare(b.name)
    })
    setReviews(mapped)
    setSelectedId((prev) => (mapped.some((r) => r.id === prev) ? prev : mapped[0]?.id ?? ''))
  }, [cycleId, me])

  useEffect(() => { loadReviews() }, [loadReviews])

  const selected = reviews.find((r) => r.id === selectedId) ?? null
  const isMine = selected?.employee_id === me?.id
  const iRate = selected ? canRate(selected, me, role) : false
  const published = cycle?.status === 'published'
  const selfOpen = cycle?.status === 'self_review'
  const managerOpen = cycle?.status === 'manager_review'
  // The subject sees the manager's side and the score only once the quarter is published.
  const showManagerSide = !isMine || published

  const loadReview = useCallback(async () => {
    if (!selectedId) { setLines([]); return }
    setLoadingReview(true)
    const { data: lineRows, error } = await supabase.from('kpi_review_lines')
      .select('*').eq('review_id', selectedId).order('weight', { ascending: false })
    if (error) console.error('[EvaluationTab] lines failed', error)
    const rows = lineRows ?? []
    setLines(rows)

    const defIds = [...new Set(rows.map((l) => l.definition_id))]
    const [{ data: anchorRows }, score, opps, dis] = await Promise.all([
      defIds.length
        ? supabase.from('kpi_anchors').select('*').in('definition_id', defIds).eq('active', true)
            .order('level').order('sort_order')
        : Promise.resolve({ data: [] }),
      supabase.rpc('kpi_review_score', { p_review_id: selectedId }),
      supabase.rpc('kpi_review_opportunities', { p_review_id: selectedId }),
      supabase.rpc('kpi_review_disagreements', { p_review_id: selectedId }),
    ])
    setAnchors(anchorRows ?? [])
    const s = score.data?.[0] ?? null
    setReport({
      score: s?.total ?? null,
      coverage: Number(s?.coverage_pct ?? 0),
      opportunities: opps.data ?? [],
      disagreements: dis.data ?? [],
    })
    setLoadingReview(false)
  }, [selectedId])

  useEffect(() => { loadReview() }, [loadReview])

  async function saveSide(line, side, payload) {
    const key = `${line.id}-${side}`
    setSavingKey(key)
    const patch = side === 'self'
      ? {
          self_level: payload.level,
          self_anchor_id: payload.anchorId,
          self_anchor_text: payload.anchorText,
          self_note: payload.note,
        }
      : {
          manager_level: payload.level,
          manager_anchor_id: payload.anchorId,
          manager_anchor_text: payload.anchorText,
          manager_note: payload.note,
        }
    const { error } = await supabase.from('kpi_review_lines').update(patch).eq('id', line.id)
    setSavingKey(null)
    if (error) {
      console.error('[EvaluationTab] save failed', error)
      showToast('error', error.message)
      return
    }
    loadReview()
  }

  const advice = useMemo(() => {
    if (!selected) return []
    return isMine && !iRate
      ? employeeAdvice({
          score: showManagerSide ? report.score : null,
          coverage: report.coverage,
          opportunities: showManagerSide ? report.opportunities : [],
          name: selected.name,
        })
      : managerAdvice({
          score: report.score,
          coverage: report.coverage,
          opportunities: report.opportunities,
          disagreements: report.disagreements,
          name: selected.name.split(' ')[0],
        })
  }, [selected, isMine, iRate, report, showManagerSide])

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 size={20} className="animate-spin text-[#00D4A0]" /></div>
  }

  if (cycles.length === 0) {
    return (
      <div className="p-8 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] text-center max-w-xl">
        <ClipboardCheck size={20} className="mx-auto text-[#AAAAAA] dark:text-[#555555] mb-2" />
        <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white">No review cycle has been opened</p>
        <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-1">
          HR opens a quarter in Review Cycles. Opening it creates everyone's review and copies
          their approved scorecard into it.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <select value={cycleId} onChange={(e) => setCycleId(e.target.value)} className={`${INPUT} w-auto`}>
          {cycles.map((c) => (
            <option key={c.id} value={c.id}>{c.period_year} Q{c.period_quarter}</option>
          ))}
        </select>
        {cycle && (
          <span className="text-xs text-[#666666] dark:text-[#A0A0A0]">
            {selfOpen && 'Self-assessment is open.'}
            {managerOpen && 'Managers are rating now. Self-assessment is closed.'}
            {cycle.status === 'calculated' && 'Scores calculated, not yet published.'}
            {published && 'Published.'}
            {cycle.status === 'draft' && 'Not open yet.'}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[16rem_1fr] gap-5 items-start">
        {/* Who */}
        <div className="rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#E8E8E8] dark:border-[#2A2A2A] flex items-center gap-2">
            <Users size={14} className="text-[#666666] dark:text-[#A0A0A0]" />
            <p className="text-xs font-semibold text-[#1A1A1A] dark:text-white">
              {reviews.length} review{reviews.length === 1 ? '' : 's'}
            </p>
          </div>
          <div className="max-h-[28rem] overflow-y-auto divide-y divide-[#E8E8E8] dark:divide-[#2A2A2A]">
            {reviews.map((r) => (
              <button
                key={r.id} type="button" onClick={() => setSelectedId(r.id)}
                className={`w-full px-4 py-3 text-left transition-colors ${
                  selectedId === r.id ? 'bg-[#00D4A0]/10' : 'hover:bg-[#F5F5F0] dark:hover:bg-[#252525]'
                }`}
              >
                <p className={`text-sm truncate ${selectedId === r.id ? 'font-bold text-[#00D4A0]' : 'font-semibold text-[#1A1A1A] dark:text-white'}`}>
                  {r.employee_id === me?.id ? 'You' : r.name}
                </p>
                <p className="text-[11px] text-[#666666] dark:text-[#A0A0A0] truncate">
                  {r.department ?? 'No department'}{r.job_title ? ` · ${r.job_title}` : ''}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* The review */}
        <div className="space-y-5 min-w-0">
          {loadingReview ? (
            <div className="flex justify-center py-16"><Loader2 size={20} className="animate-spin text-[#00D4A0]" /></div>
          ) : !selected ? (
            <div className="p-8 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] text-center">
              <p className="text-sm text-[#666666] dark:text-[#A0A0A0]">Nothing to review in this quarter.</p>
            </div>
          ) : lines.length === 0 ? (
            <div className="p-8 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
              <div className="flex items-start gap-2.5">
                <AlertTriangle size={16} className="text-[#FF8C42] shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white">
                    No criteria on this review
                  </p>
                  <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-1 max-w-lg">
                    {isMine ? 'You have' : `${selected.name} has`} no approved scorecard in effect, so
                    there is nothing to be measured against. Scoring someone against nothing is the
                    one thing this system will not do — assign a scorecard first, then reopen the review.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Score + advice */}
              <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-5 items-stretch">
                <div className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] flex flex-col items-center justify-center gap-3">
                  <ScoreRing score={showManagerSide ? report.score : null} />
                  <span className="px-2.5 py-1 rounded-full text-xs font-semibold"
                        style={{ backgroundColor: `${bandFor(showManagerSide && report.score != null ? Number(report.score) : null).hex}1A`,
                                 color: bandFor(showManagerSide && report.score != null ? Number(report.score) : null).hex }}>
                    {bandFor(showManagerSide && report.score != null ? Number(report.score) : null).label}
                  </span>
                  {showManagerSide ? (
                    <p className="text-[11px] text-[#666666] dark:text-[#A0A0A0] text-center">
                      {report.coverage}% of the scorecard rated
                    </p>
                  ) : (
                    <p className="text-[11px] text-[#666666] dark:text-[#A0A0A0] text-center max-w-[10rem]">
                      Your score appears when the quarter is published.
                    </p>
                  )}
                </div>

                <AdviceBlock
                  title={isMine && !iRate ? 'Where you stand' : `Reading ${selected.name.split(' ')[0]}'s quarter`}
                  icon={isMine && !iRate ? TrendingUp : Sparkles}
                  lines={advice}
                />
              </div>

              {/* What to work on */}
              {showManagerSide && report.opportunities.length > 0 && (
                <div className="rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
                    <h3 className="text-sm font-bold text-[#1A1A1A] dark:text-white">What to work on, in order</h3>
                    <p className="text-[11px] text-[#666666] dark:text-[#A0A0A0] mt-0.5">
                      Anything below the standard comes first, however heavily weighted the rest is.
                    </p>
                  </div>
                  <div className="divide-y divide-[#E8E8E8] dark:divide-[#2A2A2A]">
                    {report.opportunities.map((o) => (
                      <div key={o.definition_id} className="px-5 py-3.5 flex items-start gap-3">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold shrink-0 mt-0.5 ${
                          o.band === 'shortfall' ? 'bg-[#FF8C42]/10 text-[#FF8C42]' : 'bg-[#00D4A0]/10 text-[#00D4A0]'
                        }`}>
                          {o.band === 'shortfall' ? 'below standard' : 'room to grow'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white">
                            {o.definition_name}
                            <span className="ml-2 text-xs font-normal text-[#666666] dark:text-[#A0A0A0]">
                              {LEVEL_BY_NUMBER[o.current_level]?.short} → {LEVEL_BY_NUMBER[o.target_level]?.short}
                            </span>
                          </p>
                          {o.target_anchor && (
                            <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-0.5 italic">“{o.target_anchor}”</p>
                          )}
                        </div>
                        <span className="text-sm font-bold text-[#1A1A1A] dark:text-white shrink-0">
                          +{Number(o.points_at_stake).toFixed(1)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* The criteria */}
              <div className="space-y-4">
                {lines.map((line) => {
                  const lineAnchors = anchors.filter((a) => a.definition_id === line.definition_id)
                  const auto = line.source === 'automated'
                  return (
                    <div key={line.id} className="rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] overflow-hidden">
                      <div className="px-5 py-3.5 flex items-center justify-between gap-3 border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
                        <div className="flex items-center gap-2 min-w-0">
                          <p className="text-sm font-bold text-[#1A1A1A] dark:text-white truncate">{line.definition_name}</p>
                          {auto && (
                            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#4D9FFF]/10 text-[#4D9FFF] shrink-0">
                              <Gauge size={10} /> automatic
                            </span>
                          )}
                        </div>
                        <span className="text-xs font-semibold text-[#666666] dark:text-[#A0A0A0] shrink-0">
                          {Number(line.weight)}% of the score
                        </span>
                      </div>

                      {auto ? (
                        <div className="px-5 py-4">
                          <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">
                            {line.auto_value == null
                              ? 'No measurement recorded for this period yet, so it is unrated. Nothing is assumed in either direction.'
                              : `Measured ${Number(line.auto_value)} — ${LEVEL_BY_NUMBER[line.final_level]?.label ?? 'below every threshold, so unrated'}.`}
                          </p>
                        </div>
                      ) : (
                        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                          <RatingSide
                            key={`self-${line.id}-${line.updated_at}`}
                            title={isMine ? 'Your own rating' : 'Their own rating'}
                            level={line.self_level} anchorId={line.self_anchor_id}
                            note={line.self_note} anchors={lineAnchors}
                            editable={isMine && selfOpen}
                            lockNote={!isMine && line.self_level == null && !selfOpen ? 'They did not self-assess.' : null}
                            saving={savingKey === `${line.id}-self`}
                            onSave={(p) => saveSide(line, 'self', p)}
                          />
                          <RatingSide
                            key={`mgr-${line.id}-${line.updated_at}`}
                            title="Manager's rating — this is the score"
                            level={showManagerSide ? line.manager_level : null}
                            anchorId={showManagerSide ? line.manager_anchor_id : null}
                            note={showManagerSide ? line.manager_note : null}
                            anchors={lineAnchors}
                            editable={iRate && managerOpen}
                            lockNote={!showManagerSide ? 'Visible when the quarter is published.' : null}
                            saving={savingKey === `${line.id}-manager`}
                            onSave={(p) => saveSide(line, 'manager', p)}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Where the two accounts differ */}
              {showManagerSide && report.disagreements.length > 0 && (
                <div className="p-5 rounded-xl bg-[#9B5DE5]/5 border border-[#9B5DE5]/20">
                  <div className="flex items-center gap-2 mb-2">
                    <MessageSquare size={15} className="text-[#9B5DE5]" />
                    <h3 className="text-sm font-bold text-[#9B5DE5]">Worth talking about before this is signed off</h3>
                  </div>
                  <div className="space-y-1.5">
                    {report.disagreements.map((d) => (
                      <p key={d.definition_id} className="text-xs text-[#1A1A1A] dark:text-white">
                        <span className="font-semibold">{d.definition_name}</span>
                        {' — '}
                        {isMine ? 'you said' : 'they said'} {LEVEL_BY_NUMBER[d.self_level]?.short.toLowerCase()},
                        {' '}the manager said {LEVEL_BY_NUMBER[d.manager_level]?.short.toLowerCase()}.
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
