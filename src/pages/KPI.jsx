import { useEffect, useState, useCallback } from 'react'
import {
  AlertTriangle,
  AlignLeft,
  Calendar,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Filter,
  Gauge,
  Gift,
  History,
  Info,
  Loader2,
  Lock,
  Pencil,
  ShieldAlert,
  Target,
  Trophy,
  Users,
  X,
} from 'lucide-react'
import supabase from '../services/supabase'
import useAuthStore from '../store/authStore'
import Sidebar from '../components/layout/Sidebar'
import Header from '../components/layout/Header'
import HowCalculatedPopover from '../components/kpi/HowCalculatedPopover'
import PDPTab from '../components/kpi/PDPTab'
import ReviewCyclesTab from '../components/kpi/ReviewCyclesTab'
import SelfReviewCard from '../components/kpi/SelfReviewCard'
import ToastComp, { useToast } from '../components/Toast'
import { SkeletonBlock } from '../components/Skeleton'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function periodLabel(year, month) {
  return `${MONTHS[month - 1]} ${year}`
}

// Evaluation-cycle math — mirrors the DB's is_evaluation_month(p_month) RPC,
// computed client-side per the migration 28 spec: ((month - anchor) % freq +
// freq) % freq === 0. Cycle repeats every calendar year off the anchor month,
// so it only ever depends on the month, never the year.
function isEvaluationMonth(month, freq = 6, anchor = 6) {
  const f = freq || 6
  const a = anchor || 6
  return ((month - a) % f + f) % f === 0
}

// Smallest (year, month) strictly after the given one that's an evaluation
// month — used to render "Next evaluation: <Month Year>" on locked states.
function nextEvaluationMonth(year, month, freq = 6, anchor = 6) {
  for (let i = 1; i <= 12; i++) {
    const raw = month - 1 + i
    const m = (raw % 12) + 1
    const y = year + Math.floor(raw / 12)
    if (isEvaluationMonth(m, freq, anchor)) return { year: y, month: m }
  }
  return { year, month } // unreachable — freq is always one of 1/3/6/12
}

function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

function num(v) {
  return Number(v || 0)
}

// Mirrors the DB's compute_kpi_total — used client-side only to preview a total
// before a write; total_score itself is always computed by the trigger.
//
// Renormalises over the components that exist, as the trigger does since the
// fix_kpi_partial_evaluation migration. A null component means "not evaluated"
// and is excluded rather than counted as zero; a 0 is a real score and counts.
// Fallback weights, used only until a row's own weights_used is available.
// The real weights live in kpi_settings and are per-company, so anything
// hardcoded here is a guess about someone else's configuration — the DB
// stamps the weights it actually used onto every row, and those win.
const DEFAULT_WEIGHTS = {
  attendance_score: 30,
  behavior_score: 25,
  achievement_score: 20,
  manager_score: 15,
  self_score: 10,
  reliability_score: 0,
}

const COMPONENT_KEYS = Object.keys(DEFAULT_WEIGHTS)

// weights_used keys drop the `_score` suffix.
function weightsFor(row) {
  const used = row?.weights_used
  if (!used) return DEFAULT_WEIGHTS
  const out = {}
  for (const key of COMPONENT_KEYS) {
    const recorded = used[key.replace(/_score$/, '')]
    out[key] = recorded == null ? DEFAULT_WEIGHTS[key] : Number(recorded)
  }
  return out
}

function computeWeightedTotal(row) {
  const weights = weightsFor(row)
  let numerator = 0
  let weight = 0
  for (const key of COMPONENT_KEYS) {
    const w = weights[key]
    if (!w || row?.[key] == null) continue
    numerator += num(row[key]) * w
    weight += w
  }
  return weight > 0 ? numerator / weight : 0
}

// How much of the assessment exists, as the DB records it in weights_used.
function coverageOf(row) {
  const recorded = row?.weights_used?.coverage_pct
  if (recorded != null) return Number(recorded)
  const weights = weightsFor(row)
  const total = COMPONENT_KEYS.reduce((sum, key) => sum + weights[key], 0)
  const covered = COMPONENT_KEYS.reduce(
    (sum, key) => (row?.[key] == null || !weights[key] ? sum : sum + weights[key]),
    0
  )
  return total > 0 ? Math.round((covered * 1000) / total) / 10 : 0
}

// Mirrors the DB's compute_kpi_rating(score) — the canonical rating calculator
// used by the kpi_adjustment_apply trigger. Keep these thresholds in sync with
// that function; it's the single source of truth per the policy handbook.
function computeRating(score) {
  if (score >= 90) return 'Exceptional'
  if (score >= 75) return 'High Performer'
  if (score >= 60) return 'Meets Expectations'
  if (score >= 45) return 'Needs Improvement'
  return 'Unsatisfactory'
}
// ─── Constants ────────────────────────────────────────────────────────────────

const TEAM_ROLES = new Set(['super_admin', 'hr_manager', 'department_manager'])
const WARN_ROLES = new Set(['super_admin', 'hr_manager'])

// Who proposed this warning. A rule-generated recommendation has
// recommended_by NULL — attributing it to "manager" would tell HR a human
// judged this when nothing of the sort happened, and that changes how it
// should be reviewed.
function recSource(rec) {
  if (rec?.source === 'rule') return 'the attendance rules'
  return rec?.manager?.full_name ?? 'a manager'
}

// `weight` here is only the label's fallback — the real figure comes from the
// row's weights_used via weightsFor(). `auto` marks components the system
// derives from attendance rather than a person scoring them.
const COMPONENTS = [
  { key: 'attendance_score',  label: 'Attendance',          weight: 30, auto: true,
    note: 'Auto-calculated from attendance' },
  { key: 'reliability_score', label: 'Hours Completed',     weight: 0,  auto: true,
    note: 'Auto-calculated: time worked vs time scheduled' },
  { key: 'behavior_score',    label: 'Behavior',            weight: 25 },
  { key: 'achievement_score', label: 'Achievement',         weight: 20 },
  { key: 'manager_score',     label: 'Manager Evaluation',  weight: 15 },
  { key: 'self_score',        label: 'Self Evaluation',     weight: 10 },
]

// Mirrors calculate_attendance_score() — the DB averages one of these per-day
// points across the month to produce attendance_score automatically.
const ATTENDANCE_SCORE_GUIDE = [
  { status: 'Present',               points: 100 },
  { status: 'Late (minor)',          points: 85 },
  { status: 'Late (moderate)',       points: 70 },
  { status: 'Late (major)',          points: 50 },
  { status: 'Absent (unauthorized)', points: 0 },
  // Approved absence is excluded from the average entirely — taking leave you
  // are entitled to should not move a performance score. It used to score 80,
  // which quietly penalised anyone who used their allowance.
  { status: 'Absent (approved)',     points: 'not counted' },
]

const RATING_META = {
  'Exceptional':          { cls: 'bg-[#A78BFA]/10 text-[#A78BFA]', hex: '#A78BFA' },
  'High Performer':       { cls: 'bg-[#00D4A0]/10 text-[#00D4A0]', hex: '#00D4A0' },
  'Meets Expectations':   { cls: 'bg-[#4D9FFF]/10 text-[#4D9FFF]', hex: '#4D9FFF' },
  'Needs Improvement':    { cls: 'bg-[#FF8C42]/10 text-[#FF8C42]', hex: '#FF8C42' },
  'Unsatisfactory':       { cls: 'bg-[#FF4D4D]/10 text-[#FF4D4D]', hex: '#FF4D4D' },
}
const NOT_RATED_META = { cls: 'bg-[#A0A0A0]/10 text-[#666666] dark:text-[#A0A0A0]', hex: '#A0A0A0' }

function getRatingMeta(rating) {
  return RATING_META[rating] ?? NOT_RATED_META
}

// Warning/reward point values used to come from hardcoded WARNING_LEVELS/
// REWARD_TYPES constants here — as of the kpi_adjustment_types table
// (migration 24-25) they're configurable per company and fetched live in
// WarningsRewardsTab below, so every label/points lookup goes through the
// fetched type list instead.

const INPUT =
  'w-full px-3.5 py-2.5 text-sm rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0] transition-colors'

const SELECT =
  'px-3.5 py-2.5 text-sm rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0] transition-colors'

// ─── Micro-components ─────────────────────────────────────────────────────────

function AccountNotLinked() {
  return (
    <div className="flex items-start gap-3 p-5 rounded-xl bg-[#FF8C42]/10 border border-[#FF8C42]/20 max-w-lg">
      <AlertTriangle size={18} className="text-[#FF8C42] shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-semibold text-[#FF8C42]">Account not linked</p>
        <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1">
          Your login is not linked to an employee record, so no KPI data can be shown. Contact HR to complete setup.
        </p>
      </div>
    </div>
  )
}

function Spinner() {
  return (
    <div className="space-y-4 animate-pulse max-w-5xl">
      <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-6">
        <SkeletonBlock className="h-64 w-full lg:w-64" />
        <SkeletonBlock className="h-64" />
      </div>
    </div>
  )
}

function RatingBadge({ rating, className = '' }) {
  const meta = getRatingMeta(rating)
  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${meta.cls} ${className}`}>
      {rating ?? 'Not Yet Rated'}
    </span>
  )
}

function EvalBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-[#00D4A0]/10 text-[#00D4A0]">
      <span className="w-1.5 h-1.5 rounded-full bg-[#00D4A0]" />
      Evaluation window open
    </span>
  )
}

function ScoreGauge({ score, color, size = 176 }) {
  const stroke = 14
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, score)) / 100
  const offset = c * (1 - pct)
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2} cy={size / 2} r={r}
          strokeWidth={stroke} fill="none"
          className="stroke-[#E8E8E8] dark:stroke-[#2A2A2A]"
        />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-bold text-[#1A1A1A] dark:text-white">{Math.round(score)}</span>
        <span className="text-xs text-[#666666] dark:text-[#A0A0A0]">/ 100</span>
      </div>
    </div>
  )
}

function AttendanceScoreTooltip() {
  return (
    <div className="relative inline-flex group">
      <Info size={12} className="text-[#AAAAAA] dark:text-[#555555] hover:text-[#00D4A0] transition-colors cursor-help" />
      <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-2 opacity-0 group-hover:opacity-100 transition-opacity z-20 w-64 p-3 rounded-lg bg-[#1A1A1A] border border-[#2A2A2A] shadow-xl">
        <p className="text-[11px] font-semibold text-white mb-1.5">Attendance scoring (per day)</p>
        <div className="space-y-1">
          {ATTENDANCE_SCORE_GUIDE.map(g => (
            <div key={g.status} className="flex items-center justify-between text-[11px]">
              <span className="text-[#A0A0A0]">{g.status}</span>
              <span className="font-semibold text-white">{typeof g.points === 'number' ? `${g.points} pts` : g.points}</span>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-[#A0A0A0] mt-1.5 pt-1.5 border-t border-[#2A2A2A]">Monthly average, calculated automatically.</p>
      </div>
    </div>
  )
}

// `note` is the one-line explanation under an auto-derived component, and
// `tooltip` its optional detail popover. They are per-component because the
// attendance point table explains attendance only — showing it against
// reliability would describe the wrong calculation.
function ComponentBar({ label, weight, value, auto = false, note, tooltip }) {
  const pct = Math.max(0, Math.min(100, num(value)))
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5 text-sm">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-[#1A1A1A] dark:text-white">{label}</span>
          {tooltip}
        </div>
        <span className="text-xs text-[#666666] dark:text-[#A0A0A0]">
          {/* A zero weight is not "0% of your score" — it means the component is
              measured and shown but does not count toward the total yet. */}
          {weight > 0 ? `${weight}% weight · ` : 'not scored · '}
          <span className="font-semibold text-[#1A1A1A] dark:text-white">{pct.toFixed(0)}</span>/100
        </span>
      </div>
      {auto && note && (
        <p className="text-[11px] text-[#00D4A0] mb-1.5">{note}</p>
      )}
      <div className="h-2.5 bg-[#F0F0F0] dark:bg-[#2A2A2A] rounded-full overflow-hidden">
        <div className="h-full bg-[#00D4A0] rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// ─── Trend Chart ──────────────────────────────────────────────────────────────

function TrendChart({ data }) {
  const width = 720, height = 220
  const padding = { top: 20, right: 20, bottom: 28, left: 32 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom

  const points = data.map((d, i) => {
    const x = padding.left + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW)
    const y = padding.top + innerH - (num(d.total_score) / 100) * innerH
    return { x, y, d }
  })
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')

  return (
    <div className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ minWidth: 480 }}>
        {[0, 25, 50, 75, 100].map(v => {
          const y = padding.top + innerH - (v / 100) * innerH
          return (
            <g key={v}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} className="stroke-[#E8E8E8] dark:stroke-[#2A2A2A]" strokeWidth={1} />
              <text x={padding.left - 8} y={y + 3} textAnchor="end" fontSize={10} className="fill-[#666666] dark:fill-[#A0A0A0]">{v}</text>
            </g>
          )
        })}
        <path d={pathD} fill="none" stroke="#00D4A0" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={4} fill="#00D4A0" />
            <text x={p.x} y={height - 8} textAnchor="middle" fontSize={10} className="fill-[#666666] dark:fill-[#A0A0A0]">
              {MONTHS[p.d.period_month - 1].slice(0, 3)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}

// ─── My KPI Tab ───────────────────────────────────────────────────────────────

function MyKPITab({ employee, companyId, showToast, evalFreq, evalAnchor, role }) {
  const now = new Date()
  const curY = now.getFullYear()
  const curM = now.getMonth() + 1
  const isEval = isEvaluationMonth(curM, evalFreq, evalAnchor)
  // Migration 46 (make_read_only_role_truly_read_only) — kpi_self_eval_insert/
  // update RLS now excludes read_only. Hide the form rather than let it 400.
  const canSelfEval = role !== 'read_only'
  const nextEval = nextEvaluationMonth(curY, curM, evalFreq, evalAnchor)

  const [row, setRow] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selfScore, setSelfScore] = useState(50)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  // manager_score/self_score carry-forward is handled by the DB's
  // aa_compute_kpi_total trigger — this is a plain read.
  const fetchRow = useCallback(async () => {
    if (!employee?.id) { setLoading(false); return }
    setLoading(true)
    const { data } = await supabase
      .from('kpi_scores')
      .select('*')
      .eq('employee_id', employee.id)
      .eq('period_year', curY)
      .eq('period_month', curM)
      .maybeSingle()
    setRow(data ?? null)
    setSelfScore(data?.self_score ?? 50)
    setNotes(data?.notes ?? '')
    setLoading(false)
  }, [employee, curY, curM])

  useEffect(() => { fetchRow() }, [fetchRow])

  async function submitSelfEval(e) {
    e.preventDefault()
    if (!employee?.id || !canSelfEval) return
    setSaving(true)
    const { error } = row
      ? await supabase.from('kpi_scores').update({ self_score: selfScore, notes }).eq('id', row.id)
      : await supabase.from('kpi_scores').insert({
          company_id: companyId,
          employee_id: employee.id,
          period_year: curY,
          period_month: curM,
          self_score: selfScore,
          notes,
        })
    setSaving(false)
    if (error) {
      console.error('[KPI] submitSelfEval failed', error)
      showToast('error', 'Something went wrong saving your self-evaluation. Please try again.')
      return
    }
    showToast('success', row ? 'Self-evaluation updated' : 'Self-evaluation submitted')
    fetchRow()
  }

  if (!employee) return <AccountNotLinked />
  if (loading) return <Spinner />

  const total = row ? num(row.total_score) : 0
  const ratingLabel = row?.rating ?? null
  const meta = getRatingMeta(ratingLabel)
  const hasSubmittedSelf = row?.self_score != null

  return (
    <div className="space-y-8 max-w-5xl">
      {/* The quarterly self-assessment. Renders nothing unless HR has opened a
          cycle, so it cannot invite a write the database would reject. */}
      <SelfReviewCard employeeId={employee?.id} showToast={showToast} />

      <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-6 items-stretch">
        {/* Gauge card */}
        <div className="p-8 rounded-2xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] flex flex-col items-center justify-center gap-4">
          <p className="text-xs uppercase tracking-wide text-[#666666] dark:text-[#A0A0A0] font-semibold">{periodLabel(curY, curM)}</p>
          {isEval && <EvalBadge />}
          <ScoreGauge score={total} color={meta.hex} />
          <RatingBadge rating={ratingLabel} />
          {row && coverageOf(row) < 100 && (
            <p className="text-xs text-center text-[#666666] dark:text-[#A0A0A0] max-w-[16rem]">
              Based on {coverageOf(row)}% of the assessment.
              {ratingLabel ? '' : ' A rating is held back until more of it is complete.'}
            </p>
          )}
          {row?.bonus_eligible && (
            <span className="flex items-center gap-1.5 text-xs text-[#00D4A0] font-semibold">
              <Gift size={13} /> Bonus Eligible
            </span>
          )}
          {row && <HowCalculatedPopover row={row} />}
        </div>

        {/* Breakdown */}
        <div className="p-6 rounded-2xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
          <h2 className="text-base font-bold text-[#1A1A1A] dark:text-white mb-5">Score Breakdown</h2>
          <div className="space-y-5">
            {COMPONENTS.map(c => {
              const w = weightsFor(row)[c.key]
              // A component carrying no weight is measured but not scored.
              // Hide it entirely when there is also nothing to show.
              if (!w && row?.[c.key] == null) return null
              return (
                <ComponentBar
                  key={c.key} label={c.label} weight={w} value={row?.[c.key]} auto={c.auto}
                  note={c.note}
                  tooltip={c.key === 'attendance_score' ? <AttendanceScoreTooltip /> : null}
                />
              )
            })}
          </div>
        </div>
      </div>

      {/* Self-evaluation form — only open during an evaluation month, and never for read_only */}
      {isEval && canSelfEval ? (
        <div className="p-6 rounded-2xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] max-w-2xl">
          <h2 className="text-base font-bold text-[#1A1A1A] dark:text-white">Self-Evaluation — {periodLabel(curY, curM)}</h2>
          <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-1 mb-5">
            Rate your own performance this month. This contributes 10% to your total score.
          </p>
          <form onSubmit={submitSelfEval} className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold text-[#1A1A1A] dark:text-white">Self Score</label>
                <span className="text-lg font-bold text-[#00D4A0]">{selfScore}</span>
              </div>
              <input
                type="range" min={0} max={100} value={selfScore}
                onChange={e => setSelfScore(Number(e.target.value))}
                className="w-full accent-[#00D4A0]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Comments (optional)</label>
              <textarea
                rows={3} value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="What went well this month? What could improve?"
                className={INPUT}
              />
            </div>
            <button
              type="submit" disabled={saving}
              className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {saving ? 'Saving…' : hasSubmittedSelf ? 'Update Self-Evaluation' : 'Submit Self-Evaluation'}
            </button>
          </form>
        </div>
      ) : (
        <div className="p-6 rounded-2xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] max-w-2xl">
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-8 h-8 rounded-lg bg-[#A0A0A0]/10 flex items-center justify-center shrink-0">
              <Lock size={14} className="text-[#666666] dark:text-[#A0A0A0]" />
            </div>
            <h2 className="text-base font-bold text-[#1A1A1A] dark:text-white">Self-Evaluation — {periodLabel(curY, curM)}</h2>
          </div>
          <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-2">
            {canSelfEval
              ? 'Self-evaluation is only open during evaluation months.'
              : 'Read-only accounts cannot submit a self-evaluation.'}
          </p>
          {canSelfEval && (
            <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white mt-3">
              Next evaluation: {periodLabel(nextEval.year, nextEval.month)}
            </p>
          )}
          {row?.self_score != null && (
            <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-3 pt-3 border-t border-[#E8E8E8] dark:border-[#2A2A2A]">
              Your current self score ({num(row.self_score).toFixed(0)}) is carried forward from your last evaluation.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── History Tab ──────────────────────────────────────────────────────────────

function HistoryTab({ employee }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      if (!employee?.id) { setLoading(false); return }
      setLoading(true)
      const { data } = await supabase
        .from('kpi_scores')
        .select('*')
        .eq('employee_id', employee.id)
        .order('period_year', { ascending: true })
        .order('period_month', { ascending: true })
      setRows(data ?? [])
      setLoading(false)
    }
    load()
  }, [employee])

  if (!employee) return <AccountNotLinked />
  if (loading) return <Spinner />
  if (rows.length === 0) {
    return (
      <div className="p-10 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] text-center">
        <p className="text-sm text-[#666666] dark:text-[#A0A0A0]">No KPI history yet — scores will appear here once your first month is evaluated.</p>
      </div>
    )
  }

  const tableRows = [...rows].reverse()

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-base font-bold text-[#1A1A1A] dark:text-white mb-4">Score Trend</h2>
        <TrendChart data={rows} />
      </section>

      <section>
        <h2 className="text-base font-bold text-[#1A1A1A] dark:text-white mb-4">Monthly History</h2>
        <div className="rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
                {['Period', 'Attendance', 'Behavior', 'Achievement', 'Manager', 'Self', 'Total', 'Rating', 'Bonus'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[#666666] dark:text-[#A0A0A0] uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8E8E8] dark:divide-[#2A2A2A]">
              {tableRows.map(r => (
                <tr key={r.id} className="hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors">
                  <td className="px-4 py-3.5 font-semibold text-[#1A1A1A] dark:text-white whitespace-nowrap">{periodLabel(r.period_year, r.period_month)}</td>
                  <td className="px-4 py-3.5 text-[#666666] dark:text-[#A0A0A0]">{num(r.attendance_score).toFixed(0)}</td>
                  <td className="px-4 py-3.5 text-[#666666] dark:text-[#A0A0A0]">{num(r.behavior_score).toFixed(0)}</td>
                  <td className="px-4 py-3.5 text-[#666666] dark:text-[#A0A0A0]">{num(r.achievement_score).toFixed(0)}</td>
                  <td className="px-4 py-3.5 text-[#666666] dark:text-[#A0A0A0]">{num(r.manager_score).toFixed(0)}</td>
                  <td className="px-4 py-3.5 text-[#666666] dark:text-[#A0A0A0]">{num(r.self_score).toFixed(0)}</td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-[#1A1A1A] dark:text-white">{num(r.total_score).toFixed(1)}</span>
                      <HowCalculatedPopover row={r} compact />
                    </div>
                  </td>
                  <td className="px-4 py-3.5"><RatingBadge rating={r.rating} /></td>
                  <td className="px-4 py-3.5">
                    {r.bonus_eligible
                      ? <span className="flex items-center gap-1 text-xs text-[#00D4A0] font-semibold"><Gift size={12} /> Yes</span>
                      : <span className="text-xs text-[#AAAAAA] dark:text-[#555555]">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

// ─── Manager Score Modal ──────────────────────────────────────────────────────

function ManagerScoreModal({ emp, row, period, onClose, onSave }) {
  const [score, setScore] = useState(row?.manager_score ?? 50)
  const [saving, setSaving] = useState(false)
  const [expectationsOpen, setExpectationsOpen] = useState(false)

  const preview = { ...(row ?? {}), manager_score: score }
  const total = computeWeightedTotal(preview)
  const rating = computeRating(total)

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    const ok = await onSave(Number(score))
    setSaving(false)
    if (ok) onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-[#1E1E1E] rounded-2xl border border-[#E8E8E8] dark:border-[#2A2A2A] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
          <div>
            <h2 className="text-base font-bold text-[#1A1A1A] dark:text-white">Manager Score</h2>
            <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-0.5">{emp.full_name} · {periodLabel(period.year, period.month)}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-[#666666] dark:text-[#A0A0A0] hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-5">
          {/* Role expectations — collapsible, so scores are given against the job's own rubric */}
          {emp.job_description?.trim() && (
            <div className="rounded-xl border border-[#E8E8E8] dark:border-[#2A2A2A] overflow-hidden">
              <button
                type="button"
                onClick={() => setExpectationsOpen(v => !v)}
                className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 bg-[#F5F5F0] dark:bg-[#252525] text-left"
              >
                <span className="flex items-center gap-2 text-xs font-semibold text-[#1A1A1A] dark:text-white">
                  <AlignLeft size={13} className="text-[#00D4A0]" /> Role Expectations
                </span>
                {expectationsOpen ? <ChevronUp size={14} className="text-[#666666] dark:text-[#A0A0A0]" /> : <ChevronDown size={14} className="text-[#666666] dark:text-[#A0A0A0]" />}
              </button>
              {expectationsOpen && (
                <p className="px-3.5 py-3 text-xs text-[#666666] dark:text-[#A0A0A0] whitespace-pre-wrap border-t border-[#E8E8E8] dark:border-[#2A2A2A]">
                  {emp.job_description}
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 text-xs">
            {COMPONENTS.filter(c => c.key !== 'manager_score').map(c => (
              <div key={c.key} className="p-2.5 rounded-lg bg-[#F5F5F0] dark:bg-[#252525]">
                <p className="text-[#666666] dark:text-[#A0A0A0]">{c.label}</p>
                <p className="font-semibold text-[#1A1A1A] dark:text-white">{num(row?.[c.key]).toFixed(0)} / 100</p>
              </div>
            ))}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-semibold text-[#1A1A1A] dark:text-white">Manager Score (15% weight)</label>
              <span className="text-lg font-bold text-[#00D4A0]">{score}</span>
            </div>
            <input
              type="range" min={0} max={100} value={score}
              onChange={e => setScore(Number(e.target.value))}
              className="w-full accent-[#00D4A0]"
            />
          </div>

          <div className="p-3.5 rounded-xl bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] flex items-center justify-between">
            <div>
              <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">Projected Total</p>
              <p className="text-xl font-bold text-[#1A1A1A] dark:text-white">{total.toFixed(1)}</p>
            </div>
            <RatingBadge rating={rating} />
          </div>

          <button
            type="submit" disabled={saving}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {saving ? 'Saving…' : 'Save Manager Score'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── Recommend Warning Modal (department_manager) ─────────────────────────────

// Migration 43 — department_manager can't issue a warning directly
// (kpi_adjustments write access stays HR/super_admin only); instead they
// submit a `warning_recommendations` row for HR to approve or reject.
// `employees` here is already RLS-scoped to the manager's own department
// (emp_select's migration-42 department_manager clause), so no client-side
// filtering is needed to keep this to "own team" — the warn_rec_mgr_insert
// RLS WITH CHECK enforces the same boundary server-side regardless.
function RecommendWarningModal({ employees, companyId, recommenderId, onClose, onSaved, showToast }) {
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? '')
  const [level, setLevel] = useState(1)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e) {
    e.preventDefault()
    setErr('')
    if (!employeeId) { setErr('Select an employee'); return }
    if (reason.trim().length < 5) { setErr('Reason must be at least 5 characters'); return }
    setSaving(true)
    const { error } = await supabase.from('warning_recommendations').insert({
      company_id: companyId,
      employee_id: employeeId,
      recommended_by: recommenderId,
      warning_level: level,
      reason: reason.trim(),
    })
    setSaving(false)
    if (error) {
      console.error('[RecommendWarningModal] insert failed', error)
      setErr(error.message)
      return
    }
    showToast('success', 'Warning recommendation sent to HR')
    onSaved()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-[#1E1E1E] rounded-2xl border border-[#E8E8E8] dark:border-[#2A2A2A] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#FF8C42]/10 flex items-center justify-center">
              <ShieldAlert size={15} className="text-[#FF8C42]" />
            </div>
            <h2 className="text-base font-bold text-[#1A1A1A] dark:text-white">Recommend Warning</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-[#666666] dark:text-[#A0A0A0] hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          <p className="text-xs text-[#666666] dark:text-[#A0A0A0] -mt-1">
            HR reviews every recommendation before a warning is actually issued.
          </p>

          <div>
            <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Employee</label>
            <select value={employeeId} onChange={e => setEmployeeId(e.target.value)} className={INPUT} required>
              <option value="" disabled>Select employee…</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-2">Warning Level</label>
            <div className="grid grid-cols-3 gap-2">
              {[1, 2, 3].map(l => (
                <button
                  key={l} type="button" onClick={() => setLevel(l)}
                  className={`px-3 py-2.5 rounded-lg text-sm font-semibold border transition-colors ${
                    level === l
                      ? 'bg-[#FF8C42]/10 border-[#FF8C42] text-[#FF8C42]'
                      : 'border-[#E8E8E8] dark:border-[#2A2A2A] text-[#666666] dark:text-[#A0A0A0] hover:border-[#FF8C42]/40'
                  }`}
                >
                  Level {l}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Reason</label>
            <textarea
              rows={3} value={reason} onChange={e => setReason(e.target.value)}
              placeholder="Describe the incident or policy breach…"
              className={INPUT} required
            />
          </div>

          {err && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-[#FF4D4D]/10 border border-[#FF4D4D]/20 text-sm text-[#FF4D4D]">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              {err}
            </div>
          )}

          <button
            type="submit" disabled={saving}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#FF8C42] hover:bg-[#F07830] disabled:opacity-60 transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <ShieldAlert size={14} />}
            {saving ? 'Sending…' : 'Send Recommendation'}
          </button>
        </form>
      </div>
    </div>
  )
}

const REC_STATUS_META = {
  pending:  { label: 'Pending Review', cls: 'bg-[#FEE440]/15 text-[#A89200] dark:text-[#FEE440]' },
  approved: { label: 'Approved',       cls: 'bg-[#00D4A0]/10 text-[#00D4A0]' },
  rejected: { label: 'Rejected',       cls: 'bg-[#FF4D4D]/10 text-[#FF4D4D]' },
}

// ─── Team KPI Tab ─────────────────────────────────────────────────────────────

function TeamKPITab({ companyId, showToast, evalFreq, evalAnchor, role, issuerId, managerDeptId }) {
  const now = new Date()
  const [period, setPeriod] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 })
  const [employees, setEmployees] = useState([])
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalTarget, setModalTarget] = useState(null)
  const [showRecommendModal, setShowRecommendModal] = useState(false)
  const [myRecs, setMyRecs] = useState([])

  const isManager = role === 'department_manager'

  const isEval = isEvaluationMonth(period.month, evalFreq, evalAnchor)
  const nextEval = nextEvaluationMonth(period.year, period.month, evalFreq, evalAnchor)

  const fetchMyRecs = useCallback(async () => {
    if (!isManager) return
    const { data } = await supabase
      .from('warning_recommendations')
      .select('*, employees!warning_recommendations_employee_id_fkey(full_name)')
      .order('created_at', { ascending: false })
    setMyRecs(data ?? [])
  }, [isManager])

  useEffect(() => { fetchMyRecs() }, [fetchMyRecs])

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [{ data: emps }, { data: scoreRows }] = await Promise.all([
      supabase
        .from('employees')
        .select('id, full_name, job_title, job_description, department_id, status, departments!employees_department_id_fkey(name)')
        .neq('status', 'terminated')
        .order('full_name'),
      supabase
        .from('kpi_scores')
        .select('*')
        .eq('period_year', period.year)
        .eq('period_month', period.month),
    ])
    // Confirmation audit (2026-07-19) — kpi_scores/emp_select RLS grants
    // department_manager company-wide read here (unlike leave_select, which
    // Leave.jsx's Team Requests tab already compensates for the same way),
    // so without this filter every department manager saw and could score
    // the entire company roster, not just their own team. Client-side only,
    // mirrors Leave.jsx's `role === 'department_manager'` filter exactly.
    const scoped = role === 'department_manager'
      ? (emps ?? []).filter(e => e.department_id === managerDeptId)
      : (emps ?? [])
    setEmployees(scoped)
    setRows(scoreRows ?? [])
    setLoading(false)
  }, [period.year, period.month, role, managerDeptId])

  useEffect(() => { fetchData() }, [fetchData])

  const rowByEmp = Object.fromEntries(rows.map(r => [r.employee_id, r]))
  const merged = employees.map(emp => ({ emp, row: rowByEmp[emp.id] ?? null }))
  const sorted = [...merged].sort((a, b) => {
    const ta = a.row ? num(a.row.total_score) : -1
    const tb = b.row ? num(b.row.total_score) : -1
    return tb - ta
  })

  async function saveManagerScore(emp, row, managerScore) {
    // rating and bonus_eligible are owned by the compute_kpi_total trigger, which
    // withholds a rating when too little of the assessment exists. Sending them
    // from here would be overwritten anyway, and would misrepresent the rule.
    const { error } = row
      ? await supabase.from('kpi_scores').update({ manager_score: managerScore }).eq('id', row.id)
      : await supabase.from('kpi_scores').insert({
          company_id: companyId,
          employee_id: emp.id,
          period_year: period.year,
          period_month: period.month,
          manager_score: managerScore,
        })

    if (error) {
      console.error('[KPI] saveManagerScore failed', error)
      showToast('error', 'Something went wrong saving this manager score. Please try again.')
      return false
    }
    showToast('success', `Manager score saved for ${emp.full_name}`)
    await fetchData()
    return true
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 p-5 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
        <div className="flex items-center gap-3">
          <Calendar size={16} className="text-[#00D4A0]" />
          <select value={period.month} onChange={e => setPeriod(p => ({ ...p, month: Number(e.target.value) }))} className={SELECT}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select value={period.year} onChange={e => setPeriod(p => ({ ...p, year: Number(e.target.value) }))} className={SELECT}>
            {[now.getFullYear(), now.getFullYear() - 1].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          {!loading && (
            <span className="text-xs text-[#666666] dark:text-[#A0A0A0] ml-1">
              {rows.length} / {employees.length} evaluated
            </span>
          )}
          {isEval && <EvalBadge />}
        </div>
        {isManager && (
          <button
            onClick={() => setShowRecommendModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#FF8C42] hover:bg-[#F07830] transition-colors"
          >
            <ShieldAlert size={14} /> Recommend Warning
          </button>
        )}
      </div>

      {!isEval && (
        <div className="flex items-center gap-3 px-5 py-3.5 rounded-xl bg-[#A0A0A0]/10 border border-[#E8E8E8] dark:border-[#2A2A2A]">
          <Lock size={15} className="text-[#666666] dark:text-[#A0A0A0] shrink-0" />
          <p className="text-sm text-[#666666] dark:text-[#A0A0A0]">
            Manager scoring is closed for {periodLabel(period.year, period.month)}. Next evaluation:{' '}
            <span className="font-semibold text-[#1A1A1A] dark:text-white">{periodLabel(nextEval.year, nextEval.month)}</span>
          </p>
        </div>
      )}

      <div className="rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] overflow-hidden">
        {loading ? <Spinner /> : sorted.length === 0 ? (
          <div className="flex flex-col items-center py-16">
            <Users size={22} className="text-[#AAAAAA] dark:text-[#555555] mb-2" />
            <p className="text-sm text-[#666666] dark:text-[#A0A0A0]">No employees found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
                {['Rank', 'Employee', 'Department', 'Total Score', 'Rating', 'Manager Score', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[#666666] dark:text-[#A0A0A0] uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8E8E8] dark:divide-[#2A2A2A]">
              {sorted.map(({ emp, row }, i) => (
                <tr key={emp.id} className="hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors">
                  <td className="px-4 py-3.5">
                    {i < 3 && row ? (
                      <Trophy size={15} className={i === 0 ? 'text-[#FFD700]' : i === 1 ? 'text-[#C0C0C0]' : 'text-[#CD7F32]'} />
                    ) : (
                      <span className="text-xs text-[#AAAAAA] dark:text-[#555555]">{i + 1}</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-[#00D4A0]/10 flex items-center justify-center text-[#00D4A0] text-xs font-bold shrink-0">
                        {initials(emp.full_name)}
                      </div>
                      <div>
                        <p className="font-semibold text-[#1A1A1A] dark:text-white">{emp.full_name}</p>
                        <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">{emp.job_title || '—'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-[#666666] dark:text-[#A0A0A0]">{emp.departments?.name ?? '—'}</td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-[#1A1A1A] dark:text-white">{row ? num(row.total_score).toFixed(1) : '—'}</span>
                      {row && <HowCalculatedPopover row={row} compact />}
                    </div>
                  </td>
                  <td className="px-4 py-3.5"><RatingBadge rating={row?.rating} /></td>
                  <td className="px-4 py-3.5 text-[#666666] dark:text-[#A0A0A0]">{row?.manager_score != null ? num(row.manager_score).toFixed(0) : '—'}</td>
                  <td className="px-4 py-3.5">
                    {isEval ? (
                      <button
                        onClick={() => setModalTarget({ emp, row })}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] transition-colors"
                      >
                        <Pencil size={11} /> Score
                      </button>
                    ) : (
                      <span className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#AAAAAA] dark:text-[#555555]">
                        <Lock size={11} /> Locked
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {/* My warning recommendations — department_manager only */}
      {isManager && myRecs.length > 0 && (
        <div className="rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
            <h3 className="text-sm font-semibold text-[#1A1A1A] dark:text-white">My Warning Recommendations</h3>
          </div>
          <div className="divide-y divide-[#E8E8E8] dark:divide-[#2A2A2A]">
            {myRecs.map(rec => {
              const meta = REC_STATUS_META[rec.status] ?? REC_STATUS_META.pending
              return (
                <div key={rec.id} className="flex items-center gap-4 px-5 py-3.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white truncate">
                      {rec.employees?.full_name ?? 'Unknown'} <span className="font-normal text-[#666666] dark:text-[#A0A0A0]">· Level {rec.warning_level}</span>
                    </p>
                    <p className="text-xs text-[#666666] dark:text-[#A0A0A0] truncate" title={rec.reason}>{rec.reason}</p>
                    {rec.status === 'rejected' && rec.review_note && (
                      <p className="text-xs text-[#FF4D4D] mt-0.5 truncate" title={rec.review_note}>HR note: {rec.review_note}</p>
                    )}
                  </div>
                  <span className={`shrink-0 px-2.5 py-0.5 rounded-full text-xs font-semibold ${meta.cls}`}>{meta.label}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {modalTarget && (
        <ManagerScoreModal
          emp={modalTarget.emp}
          row={modalTarget.row}
          period={period}
          onClose={() => setModalTarget(null)}
          onSave={(score) => saveManagerScore(modalTarget.emp, modalTarget.row, score)}
        />
      )}

      {showRecommendModal && (
        <RecommendWarningModal
          employees={employees}
          companyId={companyId}
          recommenderId={issuerId}
          onClose={() => setShowRecommendModal(false)}
          onSaved={fetchMyRecs}
          showToast={showToast}
        />
      )}
    </div>
  )
}

// ─── Issue Warning Modal ──────────────────────────────────────────────────────

// `initial` (optional, migration 43; RPC path added migration 47): prefills
// from a manager's warning_recommendations row being approved —
// { employeeId, employeeName, warningLevel, reason, managerName,
// recommendationId }. When `recommendationId` is set, this modal calls the
// atomic `approve_warning_recommendation()` RPC (issues the kpi_adjustment
// AND marks the recommendation approved in one transaction — points are
// resolved server-side from the company's configured kpi_adjustment_types
// by warning_level, not from anything editable here) instead of the old
// two-write client-side flow. Employee/level/reason are shown read-only in
// this mode since the RPC ignores form input for them and always uses the
// original recommendation's values — only the period and an optional review
// note are actually sent.
function IssueWarningModal({ employees, warningTypes, companyId, issuerId, initial, onClose, onSaved, showToast }) {
  const now = new Date()
  const isApprovingRec = !!initial?.recommendationId
  const [employeeId, setEmployeeId] = useState(initial?.employeeId ?? employees[0]?.id ?? '')
  const [typeId, setTypeId] = useState(
    (initial?.warningLevel && warningTypes.find(w => w.warning_level === initial.warningLevel)?.id) ?? warningTypes[0]?.id ?? ''
  )
  const [reason, setReason] = useState(initial?.reason ?? '')
  const [reviewNote, setReviewNote] = useState('')
  const [period, setPeriod] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 })
  const [saving, setSaving] = useState(false)

  const selectedType = warningTypes.find(w => w.id === typeId)

  async function submit(e) {
    e.preventDefault()
    setSaving(true)

    if (isApprovingRec) {
      const { error } = await supabase.rpc('approve_warning_recommendation', {
        p_recommendation_id: initial.recommendationId,
        p_period_year: period.year,
        p_period_month: period.month,
        p_review_note: reviewNote.trim() || null,
      })
      setSaving(false)
      if (error) {
        console.error('[KPI] approve_warning_recommendation failed', error)
        showToast('error', error.message)
        return
      }
      showToast('success', 'Warning issued')
      onSaved()
      onClose()
      return
    }

    if (!employeeId || !selectedType || !reason.trim()) { showToast('error', 'Select an employee, a warning type, and enter a reason'); setSaving(false); return }
    const { error } = await supabase.from('kpi_adjustments').insert({
      company_id: companyId,
      employee_id: employeeId,
      issued_by: issuerId,
      type: 'warning',
      warning_level: selectedType.warning_level,
      points_adjustment: selectedType.points,
      reason: reason.trim(),
      period_year: period.year,
      period_month: period.month,
    })
    setSaving(false)
    if (error) {
      console.error('[KPI] IssueWarningModal submit failed', error)
      showToast('error', 'Something went wrong issuing this warning. Please try again.')
      return
    }
    showToast('success', 'Warning issued')
    onSaved()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-[#1E1E1E] rounded-2xl border border-[#E8E8E8] dark:border-[#2A2A2A] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#FF8C42]/10 flex items-center justify-center">
              <ShieldAlert size={15} className="text-[#FF8C42]" />
            </div>
            <h2 className="text-base font-bold text-[#1A1A1A] dark:text-white">Issue Warning</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-[#666666] dark:text-[#A0A0A0] hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          {isApprovingRec ? (
            <div className="p-3.5 rounded-xl bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A]">
              <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white">{initial.employeeName ?? 'Employee'}</p>
              <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-0.5">
                Level {initial.warningLevel} · recommended by {initial.managerName ?? 'manager'}
              </p>
              <p className="text-xs text-[#1A1A1A] dark:text-white mt-2 whitespace-pre-wrap">{initial.reason}</p>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Employee</label>
                <select value={employeeId} onChange={e => setEmployeeId(e.target.value)} className={INPUT} required>
                  <option value="" disabled>Select employee…</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-2">Warning Type</label>
                {warningTypes.length === 0 ? (
                  <p className="text-xs text-[#FF4D4D]">No active warning types configured — ask a super admin to add one in Settings → KPI Configuration.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {warningTypes.map(w => (
                      <button
                        key={w.id} type="button" onClick={() => setTypeId(w.id)}
                        className={`px-3 py-2.5 rounded-lg text-sm font-semibold border transition-colors text-left ${
                          typeId === w.id
                            ? 'bg-[#FF8C42]/10 border-[#FF8C42] text-[#FF8C42]'
                            : 'border-[#E8E8E8] dark:border-[#2A2A2A] text-[#666666] dark:text-[#A0A0A0] hover:border-[#FF8C42]/40'
                        }`}
                      >
                        {w.label}
                        <span className="block text-xs font-normal mt-0.5">Level {w.warning_level} · {w.points} pts</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Period</label>
            <div className="flex gap-2">
              <select value={period.month} onChange={e => setPeriod(p => ({ ...p, month: Number(e.target.value) }))} className={`${SELECT} flex-1`}>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
              <select value={period.year} onChange={e => setPeriod(p => ({ ...p, year: Number(e.target.value) }))} className={SELECT}>
                {[now.getFullYear(), now.getFullYear() - 1].map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>

          {isApprovingRec ? (
            <div>
              <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Review Note (optional)</label>
              <textarea
                rows={2} value={reviewNote} onChange={e => setReviewNote(e.target.value)}
                placeholder="Shown to the recommending manager…"
                className={INPUT}
              />
            </div>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Reason</label>
              <textarea
                rows={3} value={reason} onChange={e => setReason(e.target.value)}
                placeholder="Describe the incident or policy breach…"
                className={INPUT} required
              />
            </div>
          )}

          <button
            type="submit" disabled={saving || (!isApprovingRec && !selectedType)}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#FF8C42] hover:bg-[#F07830] disabled:opacity-60 transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <ShieldAlert size={14} />}
            {saving ? 'Saving…' : 'Issue Warning'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── Grant Reward Modal ───────────────────────────────────────────────────────

function GrantRewardModal({ employees, rewardTypes, companyId, issuerId, onClose, onSaved, showToast }) {
  const now = new Date()
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? '')
  const [typeId, setTypeId] = useState(rewardTypes[0]?.id ?? '')
  const [reason, setReason] = useState('')
  const [period, setPeriod] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 })
  const [saving, setSaving] = useState(false)

  const selectedType = rewardTypes.find(r => r.id === typeId)

  async function submit(e) {
    e.preventDefault()
    if (!employeeId || !selectedType || !reason.trim()) { showToast('error', 'Select an employee, a reward type, and enter a reason'); return }
    setSaving(true)
    const { error } = await supabase.from('kpi_adjustments').insert({
      company_id: companyId,
      employee_id: employeeId,
      issued_by: issuerId,
      type: 'reward',
      reward_type: selectedType.code,
      points_adjustment: selectedType.points,
      reason: reason.trim(),
      period_year: period.year,
      period_month: period.month,
    })
    setSaving(false)
    if (error) {
      console.error('[KPI] GrantRewardModal submit failed', error)
      showToast('error', 'Something went wrong granting this reward. Please try again.')
      return
    }
    showToast('success', 'Reward granted')
    onSaved()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-[#1E1E1E] rounded-2xl border border-[#E8E8E8] dark:border-[#2A2A2A] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#00D4A0]/10 flex items-center justify-center">
              <Gift size={15} className="text-[#00D4A0]" />
            </div>
            <h2 className="text-base font-bold text-[#1A1A1A] dark:text-white">Grant Reward</h2>
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
            <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Reward</label>
            {rewardTypes.length === 0 ? (
              <p className="text-xs text-[#FF4D4D]">No active reward types configured — ask a super admin to add one in Settings → KPI Configuration.</p>
            ) : (
              <select value={typeId} onChange={e => setTypeId(e.target.value)} className={INPUT}>
                {rewardTypes.map(r => (
                  <option key={r.id} value={r.id}>{r.label} (+{r.points} pts)</option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Period</label>
            <div className="flex gap-2">
              <select value={period.month} onChange={e => setPeriod(p => ({ ...p, month: Number(e.target.value) }))} className={`${SELECT} flex-1`}>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
              <select value={period.year} onChange={e => setPeriod(p => ({ ...p, year: Number(e.target.value) }))} className={SELECT}>
                {[now.getFullYear(), now.getFullYear() - 1].map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Reason</label>
            <textarea
              rows={3} value={reason} onChange={e => setReason(e.target.value)}
              placeholder="Why does this employee deserve recognition?"
              className={INPUT} required
            />
          </div>

          <button
            type="submit" disabled={saving || !selectedType}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Gift size={14} />}
            {saving ? 'Saving…' : 'Grant Reward'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── Warnings & Rewards Tab ───────────────────────────────────────────────────

function WarningsRewardsTab({ companyId, issuerId, showToast }) {
  const [employees, setEmployees] = useState([])
  const [rows, setRows] = useState([])
  const [adjTypes, setAdjTypes] = useState([])
  const [recs, setRecs] = useState([])
  const [loading, setLoading] = useState(true)
  const [showWarningModal, setShowWarningModal] = useState(false)
  const [warningModalInitial, setWarningModalInitial] = useState(null)
  const [showRewardModal, setShowRewardModal] = useState(false)
  const [rejectRecTarget, setRejectRecTarget] = useState(null)
  const [typeFilter, setTypeFilter] = useState('all')
  const [empFilter, setEmpFilter] = useState('all')

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [{ data: emps }, { data: adjRows }, { data: types }, { data: recRows }] = await Promise.all([
      supabase.from('employees').select('id, full_name').neq('status', 'terminated').order('full_name'),
      supabase.from('kpi_adjustments').select('*').order('created_at', { ascending: false }),
      supabase.from('kpi_adjustment_types').select('*').order('sort_order'),
      supabase
        .from('warning_recommendations')
        .select('*, employees!warning_recommendations_employee_id_fkey(full_name), manager:employees!warning_recommendations_recommended_by_fkey(full_name)')
        .eq('status', 'pending')
        .order('created_at', { ascending: true }),
    ])
    setEmployees(emps ?? [])
    setRows(adjRows ?? [])
    setAdjTypes(types ?? [])
    setRecs(recRows ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  function approveRec(rec) {
    setWarningModalInitial({
      employeeId: rec.employee_id,
      employeeName: rec.employees?.full_name,
      warningLevel: rec.warning_level,
      reason: rec.reason,
      managerName: recSource(rec),
      recommendationId: rec.id,
    })
    setShowWarningModal(true)
  }

  async function rejectRec(rec, note) {
    const { error } = await supabase
      .from('warning_recommendations')
      .update({ status: 'rejected', reviewed_by: issuerId, reviewed_at: new Date().toISOString(), review_note: note })
      .eq('id', rec.id)
    if (error) {
      console.error('[KPI] rejectRec failed', error)
      showToast('error', 'Something went wrong rejecting this recommendation. Please try again.')
      return
    }
    showToast('success', 'Recommendation rejected')
    setRejectRecTarget(null)
    await fetchData()
  }

  const employeeMap = Object.fromEntries(employees.map(e => [e.id, e.full_name]))
  const filtered = rows.filter(r =>
    (typeFilter === 'all' || r.type === typeFilter) &&
    (empFilter === 'all' || r.employee_id === empFilter)
  )

  // Every adjustment type (active + inactive) — used only to resolve labels
  // for past kpi_adjustments rows, even if the type has since been retired.
  const warningLabelByLevel = Object.fromEntries(
    adjTypes.filter(t => t.kind === 'warning').map(t => [t.warning_level, t.label])
  )
  const rewardLabelByCode = Object.fromEntries(
    adjTypes.filter(t => t.kind === 'reward').map(t => [t.code, t.label])
  )
  function warningLabel(level) {
    return warningLabelByLevel[level] ?? `Level ${level}`
  }
  function rewardLabel(code) {
    return rewardLabelByCode[code] ?? code
  }

  // Active-only, sorted — what the issue forms offer.
  const activeWarningTypes = adjTypes.filter(t => t.kind === 'warning' && t.active)
  const activeRewardTypes = adjTypes.filter(t => t.kind === 'reward' && t.active)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 p-5 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
        <div>
          <h2 className="text-base font-bold text-[#1A1A1A] dark:text-white">Warnings & Rewards</h2>
          <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-0.5">Both directly adjust an employee's KPI points for the selected period.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setWarningModalInitial(null); setShowWarningModal(true) }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#FF8C42] hover:bg-[#F07830] transition-colors"
          >
            <ShieldAlert size={14} /> Issue Warning
          </button>
          <button
            onClick={() => setShowRewardModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] transition-colors"
          >
            <Gift size={14} /> Grant Reward
          </button>
        </div>
      </div>

      {/* Manager warning recommendations awaiting HR review (migration 43) */}
      {recs.length > 0 && (
        <div className="rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#FF8C42]/30 overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
            <ShieldAlert size={15} className="text-[#FF8C42]" />
            <h3 className="text-sm font-semibold text-[#1A1A1A] dark:text-white">Recommendations</h3>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FF8C42] text-white">{recs.length}</span>
          </div>
          <div className="divide-y divide-[#E8E8E8] dark:divide-[#2A2A2A]">
            {recs.map(rec => (
              <div key={rec.id} className="flex items-center gap-4 px-5 py-3.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white">
                    {rec.employees?.full_name ?? 'Unknown'} <span className="font-normal text-[#666666] dark:text-[#A0A0A0]">· Level {rec.warning_level} · from {recSource(rec)}</span>
                  </p>
                  <p className="text-xs text-[#666666] dark:text-[#A0A0A0] truncate" title={rec.reason}>{rec.reason}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => approveRec(rec)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] transition-colors"
                  >
                    <Check size={11} /> Approve
                  </button>
                  <button
                    onClick={() => setRejectRecTarget(rec)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#FF4D4D] hover:bg-[#E04040] transition-colors"
                  >
                    <X size={11} /> Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Filter size={14} className="text-[#666666] dark:text-[#A0A0A0]" />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className={SELECT}>
          <option value="all">All Types</option>
          <option value="warning">Warnings</option>
          <option value="reward">Rewards</option>
        </select>
        <select value={empFilter} onChange={e => setEmpFilter(e.target.value)} className={SELECT}>
          <option value="all">All Employees</option>
          {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
        </select>
        {!loading && (
          <span className="text-xs text-[#666666] dark:text-[#A0A0A0]">
            {filtered.length} record{filtered.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div className="rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] overflow-hidden overflow-x-auto">
        {loading ? <Spinner /> : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-16">
            <ShieldAlert size={22} className="text-[#AAAAAA] dark:text-[#555555] mb-2" />
            <p className="text-sm text-[#666666] dark:text-[#A0A0A0]">No warnings or rewards recorded yet</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
                {['Date', 'Employee', 'Type', 'Detail', 'Points', 'Period', 'Reason', 'Issued By'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[#666666] dark:text-[#A0A0A0] uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8E8E8] dark:divide-[#2A2A2A]">
              {filtered.map(r => {
                const pts = num(r.points_adjustment)
                const isWarning = r.type === 'warning'
                return (
                  <tr key={r.id} className="hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors">
                    <td className="px-4 py-3.5 text-[#666666] dark:text-[#A0A0A0] whitespace-nowrap">
                      {new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td className="px-4 py-3.5 font-semibold text-[#1A1A1A] dark:text-white whitespace-nowrap">
                      {employeeMap[r.employee_id] ?? '—'}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                        isWarning ? 'bg-[#FF8C42]/10 text-[#FF8C42]' : 'bg-[#00D4A0]/10 text-[#00D4A0]'
                      }`}>
                        {isWarning ? 'Warning' : 'Reward'}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-[#666666] dark:text-[#A0A0A0] whitespace-nowrap">
                      {isWarning ? warningLabel(r.warning_level) : rewardLabel(r.reward_type)}
                    </td>
                    <td className={`px-4 py-3.5 font-bold whitespace-nowrap ${pts >= 0 ? 'text-[#00D4A0]' : 'text-[#FF4D4D]'}`}>
                      {pts >= 0 ? '+' : ''}{pts}
                    </td>
                    <td className="px-4 py-3.5 text-[#666666] dark:text-[#A0A0A0] whitespace-nowrap">{periodLabel(r.period_year, r.period_month)}</td>
                    <td className="px-4 py-3.5 text-[#666666] dark:text-[#A0A0A0] max-w-xs truncate" title={r.reason}>{r.reason}</td>
                    <td className="px-4 py-3.5 text-[#666666] dark:text-[#A0A0A0] whitespace-nowrap">{employeeMap[r.issued_by] ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {showWarningModal && (
        <IssueWarningModal
          employees={employees} warningTypes={activeWarningTypes} companyId={companyId} issuerId={issuerId}
          initial={warningModalInitial}
          onClose={() => { setShowWarningModal(false); setWarningModalInitial(null) }} onSaved={fetchData} showToast={showToast}
        />
      )}
      {showRewardModal && (
        <GrantRewardModal
          employees={employees} rewardTypes={activeRewardTypes} companyId={companyId} issuerId={issuerId}
          onClose={() => setShowRewardModal(false)} onSaved={fetchData} showToast={showToast}
        />
      )}
      {rejectRecTarget && (
        <RejectRecommendationModal
          rec={rejectRecTarget}
          onClose={() => setRejectRecTarget(null)}
          onConfirm={rejectRec}
        />
      )}
    </div>
  )
}

// ─── Reject Recommendation Modal ───────────────────────────────────────────────

function RejectRecommendationModal({ rec, onClose, onConfirm }) {
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    await onConfirm(rec, note.trim() || null)
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm bg-white dark:bg-[#1E1E1E] rounded-2xl border border-[#E8E8E8] dark:border-[#2A2A2A] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
          <h2 className="text-base font-bold text-[#1A1A1A] dark:text-white">Reject Recommendation</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-[#666666] dark:text-[#A0A0A0] hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          <div className="p-3.5 rounded-xl bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A]">
            <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white">{rec.employees?.full_name ?? 'Employee'}</p>
            <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-0.5">Level {rec.warning_level} · from {recSource(rec)}</p>
          </div>
          <div>
            <label className="block text-sm font-semibold text-[#1A1A1A] dark:text-white mb-1.5">Note (optional)</label>
            <textarea
              rows={3} value={note} onChange={e => setNote(e.target.value)}
              placeholder="Let the manager know why this wasn't approved…"
              className={`${INPUT} resize-none`}
            />
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold text-[#666666] dark:text-[#A0A0A0] border border-[#E8E8E8] dark:border-[#2A2A2A] hover:text-[#1A1A1A] dark:hover:text-white transition-colors">
              Cancel
            </button>
            <button
              type="submit" disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#FF4D4D] hover:bg-[#E04040] disabled:opacity-60 transition-colors"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
              {saving ? 'Rejecting…' : 'Confirm Reject'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function KPI() {
  const employee  = useAuthStore(s => s.employee)
  const role      = useAuthStore(s => s.role)
  const companyId = useAuthStore(s => s.companyId)

  const canTeam = TEAM_ROLES.has(role)
  const canWarn = WARN_ROLES.has(role)

  const [activeTab, setActiveTab] = useState('my-kpi')
  const { toast, showToast } = useToast()

  // Evaluation-cycle settings (migration 28) — fetched once here and passed
  // down to My KPI / Team KPI, since both gate their forms on it. Defaults
  // (6/6 = semi-annual, June anchor) match the DB column defaults, so the
  // brief window before this resolves still computes a sensible isEvalMonth.
  const [evalSettings, setEvalSettings] = useState({ freq: 6, anchor: 6 })
  useEffect(() => {
    async function loadEvalSettings() {
      const { data } = await supabase
        .from('kpi_settings')
        .select('evaluation_frequency_months, evaluation_anchor_month')
        .maybeSingle()
      if (data) {
        setEvalSettings({
          freq: data.evaluation_frequency_months ?? 6,
          anchor: data.evaluation_anchor_month ?? 6,
        })
      }
    }
    loadEvalSettings()
  }, [])

  const tabs = [
    { id: 'my-kpi', label: 'My KPI', icon: Gauge },
    { id: 'history', label: 'History', icon: History },
    ...(canTeam ? [{ id: 'team', label: 'Team KPI', icon: Users }] : []),
    ...(canWarn ? [{ id: 'warnings', label: 'Warnings & Rewards', icon: ShieldAlert }] : []),
    ...(canWarn ? [{ id: 'reviews', label: 'Review Cycles', icon: ClipboardCheck }] : []),
    { id: 'pdp', label: 'Development Plans', icon: Target },
  ]

  return (
    <div className="flex min-h-screen bg-[#F5F5F0] dark:bg-[#0F0F0F]">
      <Sidebar />

      <div className="flex-1 min-w-0 flex flex-col lg:ml-60">
        <Header />

        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-[#1A1A1A] dark:text-white">KPI & Performance</h1>
            <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1">
              Monthly scores, self-evaluation, team leaderboard, and performance history
            </p>
          </div>

          <div className="flex gap-1 p-1 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] w-fit mb-8 overflow-x-auto">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors ${
                  activeTab === id
                    ? 'bg-[#00D4A0]/10 text-[#00D4A0]'
                    : 'text-[#666666] dark:text-[#A0A0A0] hover:text-[#1A1A1A] dark:hover:text-white'
                }`}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>

          {activeTab === 'my-kpi' && (
            <MyKPITab
              employee={employee} companyId={companyId} showToast={showToast}
              evalFreq={evalSettings.freq} evalAnchor={evalSettings.anchor}
              role={role}
            />
          )}
          {activeTab === 'history' && (
            <HistoryTab employee={employee} />
          )}
          {activeTab === 'team' && canTeam && (
            <TeamKPITab
              companyId={companyId} showToast={showToast}
              evalFreq={evalSettings.freq} evalAnchor={evalSettings.anchor}
              role={role} issuerId={employee?.id} managerDeptId={employee?.department_id}
            />
          )}
          {activeTab === 'warnings' && canWarn && (
            <WarningsRewardsTab companyId={companyId} issuerId={employee?.id} showToast={showToast} />
          )}
          {activeTab === 'reviews' && canWarn && (
            <ReviewCyclesTab showToast={showToast} />
          )}
          {activeTab === 'pdp' && (
            <PDPTab employee={employee} companyId={companyId} canManage={canWarn} showToast={showToast} role={role} />
          )}
        </main>
      </div>

      <ToastComp toast={toast} />
    </div>
  )
}
