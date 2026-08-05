import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, AlertCircle } from 'lucide-react'
import supabase from '../services/supabase'
import Sidebar from '../components/layout/Sidebar'
import Header from '../components/layout/Header'
import TrendChart from '../components/dashboard/TrendChart'
import { SkeletonBlock } from '../components/Skeleton'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

function num(v) {
  return Number(v || 0)
}

function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
}

function joinNames(names) {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

// Mirrors the DB's is_evaluation_month(p_month) RPC and the same helper
// duplicated in KPI.jsx/KpiConfigTab.jsx — per this codebase's per-file
// small-helper convention rather than a shared module.
function isEvaluationMonth(month, freq = 6, anchor = 6) {
  const f = freq || 6
  const a = anchor || 6
  return ((month - a) % f + f) % f === 0
}

function scoreColor(score) {
  if (score >= 90) return '#00D4A0'
  if (score >= 75) return '#4DA6FF'
  if (score >= 60) return '#FFB020'
  return '#FF4D4D'
}

// Mirrors team_analytics.html's pillClass() exactly for the 4 ratings it
// covers; Unsatisfactory is mapped to the same red "needs attention" style
// as Needs Improvement (the mockup's seed data had no Unsatisfactory rows,
// so it silently fell back to the amber Meets-Expectations pill — not
// something worth reproducing on a real management dashboard).
const RATING_PILL = {
  'Exceptional':        'bg-[#00D4A0]/[0.14] text-[#00D4A0]',
  'High Performer':     'bg-[#4DA6FF]/[0.14] text-[#4DA6FF]',
  'Meets Expectations': 'bg-[#FFB020]/[0.14] text-[#FFB020]',
  'Needs Improvement':  'bg-[#FF4D4D]/[0.16] text-[#FF4D4D]',
  'Unsatisfactory':     'bg-[#FF4D4D]/[0.16] text-[#FF4D4D]',
}
function pillClass(rating) {
  return RATING_PILL[rating] ?? RATING_PILL['Meets Expectations']
}

// ─── Micro-components ─────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map(i => <SkeletonBlock key={i} className="h-24" />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[1.55fr_1fr] gap-4">
        <SkeletonBlock className="h-64" />
        <SkeletonBlock className="h-64" />
      </div>
      <SkeletonBlock className="h-48" />
    </div>
  )
}

function StatCard({ label, val, suffix, note, up }) {
  return (
    <div className="p-5 rounded-2xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2E2E2E]">
      <p className="text-xs uppercase tracking-wide text-[#666666] dark:text-[#9A9A9A] font-semibold">{label}</p>
      <p className="text-[32px] font-bold mt-2 tracking-tight text-[#1A1A1A] dark:text-white">
        {val}
        {suffix && <span className="text-[15px] font-medium text-[#AAAAAA] dark:text-[#6B6B6B] ml-1">{suffix}</span>}
      </p>
      <p className={`text-[13px] font-semibold mt-1.5 ${up ? 'text-[#00D4A0]' : 'text-[#FF4D4D]'}`}>{note}</p>
    </div>
  )
}

// Hand-rolled SVG radar/pentagon — mirrors team_analytics.html's #radar
// chart (viewBox 300×260, 5 axes, 4 grid rings, mint fill+stroke polygon).
function RadarChart({ components }) {
  const keys = ['Attendance', 'Behavior', 'Achievement', 'Manager', 'Self']
  const cx = 150, cy = 128, R = 92
  const N = keys.length
  const ang = i => -Math.PI / 2 + (i / N) * 2 * Math.PI
  const rings = [0.25, 0.5, 0.75, 1]

  const vpts = keys.map((k, i) => {
    const f = Math.max(0, Math.min(100, components[k] ?? 0)) / 100
    return `${cx + Math.cos(ang(i)) * R * f},${cy + Math.sin(ang(i)) * R * f}`
  }).join(' ')

  return (
    <svg viewBox="0 0 300 260" className="w-full" style={{ height: 260 }}>
      {rings.map(f => {
        const pts = keys.map((_, i) => `${cx + Math.cos(ang(i)) * R * f},${cy + Math.sin(ang(i)) * R * f}`).join(' ')
        return <polygon key={f} points={pts} fill="none" className="stroke-[#E8E8E8] dark:stroke-[#2E2E2E]" strokeWidth={1} />
      })}
      {keys.map((k, i) => {
        const xx = cx + Math.cos(ang(i)) * R, yy = cy + Math.sin(ang(i)) * R
        const lx = cx + Math.cos(ang(i)) * (R + 20), ly = cy + Math.sin(ang(i)) * (R + 16)
        return (
          <g key={k}>
            <line x1={cx} y1={cy} x2={xx} y2={yy} className="stroke-[#E8E8E8] dark:stroke-[#2E2E2E]" strokeWidth={1} />
            <text x={lx} y={ly + 3} textAnchor="middle" fontSize={11} className="fill-[#666666] dark:fill-[#9A9A9A]">{k}</text>
            <text x={lx} y={ly + 16} textAnchor="middle" fontSize={11} fontWeight={600} fill="#00D4A0">
              {(components[k] ?? 0).toFixed(1)}
            </text>
          </g>
        )
      })}
      <polygon points={vpts} fill="rgba(0,212,160,.14)" stroke="#00D4A0" strokeWidth={2} />
    </svg>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TeamAnalytics() {
  const navigate = useNavigate()

  const [employees, setEmployees] = useState([])
  const [scores, setScores] = useState([])
  const [evalSettings, setEvalSettings] = useState({ freq: 6, anchor: 6 })
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setFetchError(false)
    const [{ data: emps, error: empsErr }, { data: scoreRows, error: scoresErr }, { data: settings }] = await Promise.all([
      supabase
        .from('employees')
        .select('id, full_name, job_title, department_id, status, departments!employees_department_id_fkey(name)')
        .neq('status', 'terminated')
        .order('full_name'),
      supabase.from('kpi_scores').select('*'),
      supabase.from('kpi_settings').select('evaluation_frequency_months, evaluation_anchor_month').maybeSingle(),
    ])
    if (empsErr || scoresErr) {
      console.error('[TeamAnalytics] load failed', empsErr || scoresErr)
      setFetchError(true)
      setLoading(false)
      return
    }
    setEmployees(emps ?? [])
    setScores(scoreRows ?? [])
    setEvalSettings({
      freq: settings?.evaluation_frequency_months ?? 6,
      anchor: settings?.evaluation_anchor_month ?? 6,
    })
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Each employee's own latest (and earliest) kpi_scores row — not a single
  // shared calendar month, since real employees can fall out of sync.
  const latestByEmployee = useMemo(() => {
    return employees.map(emp => {
      const empScores = scores.filter(s => s.employee_id === emp.id)
      if (!empScores.length) return null
      const isAfter = (a, b) => a.period_year > b.period_year || (a.period_year === b.period_year && a.period_month > b.period_month)
      const latest = empScores.reduce((best, s) => (!best || isAfter(s, best)) ? s : best, null)
      const earliest = empScores.reduce((best, s) => (!best || isAfter(best, s)) ? s : best, null)
      return { employee: emp, row: latest, earliest }
    }).filter(Boolean)
  }, [employees, scores])

  const roster = useMemo(() =>
    [...latestByEmployee].sort((a, b) => num(b.row.total_score) - num(a.row.total_score)),
  [latestByEmployee])

  const componentAverages = useMemo(() => {
    const rows = latestByEmployee.map(r => r.row)
    const avgOf = key => avg(rows.map(r => r[key]).filter(v => v != null).map(Number))
    return {
      Attendance: avgOf('attendance_score'),
      Behavior: avgOf('behavior_score'),
      Achievement: avgOf('achievement_score'),
      Manager: avgOf('manager_score'),
      Self: avgOf('self_score'),
    }
  }, [latestByEmployee])

  // Group ALL company kpi_scores by calendar month, using only the most
  // recent period_year present for that month, so the trend stays a clean
  // 12-point (or fewer) most-recent-year cycle as the app runs longer.
  const trendData = useMemo(() => {
    const yearByMonth = {}
    scores.forEach(s => {
      const m = s.period_month
      if (yearByMonth[m] == null || s.period_year > yearByMonth[m]) yearByMonth[m] = s.period_year
    })
    const buckets = {}
    scores.forEach(s => {
      if (s.period_year !== yearByMonth[s.period_month]) return
      const m = s.period_month
      if (!buckets[m]) buckets[m] = { total: [], att: [], ach: [] }
      if (s.total_score != null) buckets[m].total.push(Number(s.total_score))
      if (s.attendance_score != null) buckets[m].att.push(Number(s.attendance_score))
      if (s.achievement_score != null) buckets[m].ach.push(Number(s.achievement_score))
    })
    return Array.from({ length: 12 }, (_, i) => i + 1)
      .filter(m => buckets[m] && buckets[m].total.length)
      .map(m => ({
        month: m,
        label: MONTHS[m - 1].slice(0, 3),
        team: avg(buckets[m].total),
        att: avg(buckets[m].att),
        ach: avg(buckets[m].ach),
      }))
  }, [scores])

  // Strengths / watch areas — computed client-side per the spec's five
  // named signals each way, from the same fetched data above.
  const insights = useMemo(() => {
    const strengths = []
    const watch = []
    const { Attendance: avgAttendance, Achievement: avgAchievement, Manager: avgManager, Self: avgSelf } = componentAverages

    if (avgAttendance > 76) {
      strengths.push({
        color: '#00D4A0',
        title: 'Attendance is the anchor',
        desc: `Highest component at ${avgAttendance.toFixed(1)} — discipline is strong across the team.`,
      })
    }

    const janPoint = trendData.find(d => d.month === 1)
    const decPoint = trendData.find(d => d.month === 12)
    if (janPoint && decPoint && decPoint.team > janPoint.team) {
      strengths.push({
        color: '#00D4A0',
        title: 'Strong close to the year',
        desc: `Team average rose from ${janPoint.team.toFixed(1)} to ${decPoint.team.toFixed(1)} (+${(decPoint.team - janPoint.team).toFixed(1)}), led by late-year gains.`,
      })
    }

    const roleModels = latestByEmployee.filter(r => num(r.row.total_score) >= 90)
    if (roleModels.length > 0) {
      const names = roleModels.map(r => r.employee.full_name)
      strengths.push({
        color: '#00D4A0',
        title: roleModels.length > 1 ? 'Role models present' : 'A role model present',
        desc: `${joinNames(names)} ${roleModels.length > 1 ? 'are' : 'is'} Exceptional — natural mentor${roleModels.length > 1 ? 's' : ''} for the group.`,
      })
    }

    const turnarounds = latestByEmployee
      .filter(r => r.earliest && r.row.id !== r.earliest.id)
      .map(r => ({ ...r, improvement: num(r.row.total_score) - num(r.earliest.total_score) }))
      .filter(r => r.improvement > 15)
      .sort((a, b) => b.improvement - a.improvement)
    if (turnarounds.length > 0) {
      const best = turnarounds[0]
      strengths.push({
        color: '#4DA6FF',
        title: 'Turnaround in progress',
        desc: `${best.employee.full_name} improved by ${best.improvement.toFixed(1)} pts to ${num(best.row.total_score).toFixed(1)} — the development loop works.`,
      })
    }

    const atRiskEmps = latestByEmployee.filter(r => num(r.row.total_score) < 60)
    if (atRiskEmps.length > 0) {
      const names = atRiskEmps.map(r => r.employee.full_name)
      watch.push({
        color: '#FF4D4D',
        title: atRiskEmps.length > 1 ? `${atRiskEmps.length} people below 60` : 'One person below 60',
        desc: `${joinNames(names)} ${atRiskEmps.length > 1 ? 'are' : 'is'} in Needs Improvement — consider opening a Development Plan.`,
      })
    }

    if (avgAttendance - avgAchievement > 5) {
      watch.push({
        color: '#FFB020',
        title: 'Achievement lags',
        desc: `Lowest component at ${avgAchievement.toFixed(1)} — targets/milestones aren't being logged as rewards.`,
      })
    }

    let dipRange = null
    if (trendData.length >= 3) {
      const yearAvg = avg(trendData.map(d => d.team))
      for (let i = 0; i + 2 < trendData.length; i++) {
        const window = trendData.slice(i, i + 3)
        if (window.every(d => d.team < yearAvg)) { dipRange = window; break }
      }
      if (dipRange) {
        watch.push({
          color: '#FFB020',
          title: 'Mid-year dip',
          desc: `Team dropped across ${dipRange[0].label}–${dipRange[dipRange.length - 1].label} (avg ${avg(dipRange.map(d => d.team)).toFixed(1)} vs ${yearAvg.toFixed(1)} overall) before recovering — worth understanding why.`,
        })
      }
    }

    if (avgManager - avgSelf > 1) {
      watch.push({
        color: '#FFB020',
        title: 'Self scores trail manager',
        desc: `Self-evals (${avgSelf.toFixed(1)}) trail manager (${avgManager.toFixed(1)}) — some under-confidence to coach.`,
      })
    }

    return { strengths, watch, atRiskEmps, roleModels, avgAttendance, avgAchievement, dipRange }
  }, [latestByEmployee, trendData, componentAverages])

  const recommendations = useMemo(() => {
    const recs = []

    if (insights.atRiskEmps.length > 0) {
      const names = insights.atRiskEmps.map(r => r.employee.full_name)
      recs.push({
        title: 'Open Development Plans for at-risk staff',
        desc: <>Create Personal Development Plans for <strong>{joinNames(names)}</strong> with an achievement focus and a target improvement by the next evaluation.</>,
      })
    }
    if (insights.roleModels.length > 0 && insights.atRiskEmps.length > 0) {
      const mentorNames = insights.roleModels.map(r => r.employee.full_name)
      recs.push({
        title: 'Pair mentors with strugglers',
        desc: <>Match <strong>{joinNames(mentorNames)}</strong> as mentors for the team's at-risk staff — Development Plans already snapshot monthly progress automatically.</>,
      })
    }
    if (insights.avgAttendance - insights.avgAchievement > 5) {
      recs.push({
        title: 'Lift achievement across the board',
        desc: <>It's the weakest component. Encourage managers to log milestones as rewards in KPI → Warnings &amp; Rewards so achievement scores reflect real wins.</>,
      })
    }
    if (insights.dipRange) {
      const range = insights.dipRange
      recs.push({
        title: 'Investigate the mid-year dip',
        desc: <>{range[0].label}–{range[range.length - 1].label} softness shows across components. Cross-check against attendance and workload for that window.</>,
      })
    }

    const evalMonths = MONTHS.filter((_, i) => isEvaluationMonth(i + 1, evalSettings.freq, evalSettings.anchor))
    if (evalMonths.length > 0) {
      recs.push({
        title: 'Time recognition to the cycle',
        desc: <>With evaluations in <strong>{evalMonths.join(' & ')}</strong>, schedule reward posts and 1:1s just before each to reinforce momentum.</>,
      })
    }

    const fallback = [
      {
        title: 'Recognize consistent performers',
        desc: <>Keep spotlighting steady <strong>High Performer</strong> and <strong>Exceptional</strong> scorers on the News Feed to reinforce what good looks like.</>,
      },
      {
        title: 'Review mid-tier trajectories',
        desc: <>Check in with employees sitting in <strong>Meets Expectations</strong> — small nudges here often move the team average the most.</>,
      },
    ]
    let i = 0
    while (recs.length < 3 && i < fallback.length) { recs.push(fallback[i]); i++ }

    return recs.slice(0, 5).map((r, idx) => ({ ...r, n: idx + 1 }))
  }, [insights, evalSettings])

  // ── Top-level stats ─────────────────────────────────────────────────────────

  const teamAvg = avg(latestByEmployee.map(r => num(r.row.total_score)))
  const topPerformer = roster[0] ?? null
  const atRiskCount = latestByEmployee.filter(r => num(r.row.total_score) < 60).length
  const bonusEligibleCount = latestByEmployee.filter(r => r.row.bonus_eligible === true).length
  const yoyDiff = trendData.length >= 2 ? trendData[trendData.length - 1].team - trendData[0].team : null

  const stats = [
    {
      label: 'Team average', val: teamAvg.toFixed(1), suffix: '/100',
      note: yoyDiff == null ? 'Latest evaluated scores' : `${yoyDiff >= 0 ? '▲' : '▼'} ${Math.abs(yoyDiff).toFixed(1)} over the period`,
      up: yoyDiff == null || yoyDiff >= 0,
    },
    {
      label: 'Top performer', val: topPerformer ? num(topPerformer.row.total_score).toFixed(0) : '—', suffix: '',
      note: topPerformer?.employee.full_name ?? 'No data yet', up: true,
    },
    {
      label: 'At risk (<60)', val: atRiskCount, suffix: atRiskCount === 1 ? ' person' : ' people',
      note: 'need a Development Plan', up: false,
    },
    {
      label: 'Bonus eligible', val: bonusEligibleCount, suffix: ` of ${latestByEmployee.length}`,
      note: 'score ≥ 75', up: true,
    },
  ]

  const trendHint = trendData.length ? `monthly average · ${trendData[0].label}–${trendData[trendData.length - 1].label}` : 'monthly average'

  return (
    <div className="flex min-h-screen bg-[#F5F5F0] dark:bg-[#0F0F0F]">
      <Sidebar />

      <div className="flex-1 flex flex-col lg:ml-60">
        <Header />

        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <div className="mb-6">
            <p className="text-xs uppercase tracking-wide text-[#00D4A0] font-semibold">Super Admin · Performance</p>
            <h1 className="text-2xl font-bold text-[#1A1A1A] dark:text-white mt-1">Team Performance Analytics</h1>
            <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1">
              {latestByEmployee.length} employee{latestByEmployee.length !== 1 ? 's' : ''} evaluated · KPI history to date
            </p>
          </div>

          {loading ? <Spinner /> : fetchError ? (
            <div className="flex flex-col items-center text-center py-16 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2E2E2E]">
              <AlertCircle size={28} className="text-[#FF4D4D] mb-2" />
              <p className="text-sm font-medium text-[#1A1A1A] dark:text-white mb-3">Something went wrong loading team analytics.</p>
              <button
                onClick={load}
                className="bg-[#00D4A0] hover:bg-[#00B589] text-white font-semibold text-sm py-2 px-4 rounded-lg transition-colors"
              >
                Retry
              </button>
            </div>
          ) : latestByEmployee.length === 0 ? (
            <div className="flex flex-col items-center py-16 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2E2E2E]">
              <Users size={22} className="text-[#AAAAAA] dark:text-[#555555] mb-2" />
              <p className="text-sm text-[#666666] dark:text-[#A0A0A0]">No KPI scores recorded yet — analytics will populate once employees are evaluated.</p>
            </div>
          ) : (
            <>
              {/* Top stats row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                {stats.map(s => <StatCard key={s.label} {...s} />)}
              </div>

              {/* Trend + radar */}
              <div className="grid grid-cols-1 lg:grid-cols-[1.55fr_1fr] gap-4 mb-4">
                <div className="p-5 rounded-2xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2E2E2E]">
                  <div className="flex items-baseline justify-between mb-4">
                    <h3 className="text-base font-semibold text-[#1A1A1A] dark:text-white">Team score trend</h3>
                    <span className="text-xs text-[#AAAAAA] dark:text-[#6B6B6B]">{trendHint}</span>
                  </div>
                  {trendData.length ? (
                    <>
                      <TrendChart data={trendData} />
                      <div className="flex gap-4 text-xs text-[#666666] dark:text-[#9A9A9A] mt-2.5">
                        <span className="inline-flex items-center gap-1.5"><i className="w-[18px] h-[3px] rounded-sm inline-block" style={{ background: '#00D4A0' }} />Team average</span>
                        <span className="inline-flex items-center gap-1.5"><i className="w-[18px] h-[3px] rounded-sm inline-block" style={{ background: '#4DA6FF' }} />Attendance</span>
                        <span className="inline-flex items-center gap-1.5"><i className="w-[18px] h-[3px] rounded-sm inline-block" style={{ background: '#FFB020' }} />Achievement</span>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-[#666666] dark:text-[#A0A0A0] py-16 text-center">Not enough history yet to chart a trend.</p>
                  )}
                </div>

                <div className="p-5 rounded-2xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2E2E2E]">
                  <div className="flex items-baseline justify-between mb-4">
                    <h3 className="text-base font-semibold text-[#1A1A1A] dark:text-white">Where the team is strong</h3>
                    <span className="text-xs text-[#AAAAAA] dark:text-[#6B6B6B]">avg by component</span>
                  </div>
                  <RadarChart components={componentAverages} />
                </div>
              </div>

              {/* Roster */}
              <div className="p-5 rounded-2xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2E2E2E] mb-4">
                <div className="flex items-baseline justify-between mb-4">
                  <h3 className="text-base font-semibold text-[#1A1A1A] dark:text-white">Team roster</h3>
                  <span className="text-xs text-[#AAAAAA] dark:text-[#6B6B6B]">each employee's latest evaluation · sorted by score</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#E8E8E8] dark:border-[#2E2E2E]">
                        {['Employee', 'Department', 'Score', 'Performance', 'Rating'].map(h => (
                          <th key={h} className="px-3 py-2.5 text-left text-[11px] font-semibold text-[#AAAAAA] dark:text-[#6B6B6B] uppercase tracking-wide whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {roster.map(({ employee, row }) => {
                        const score = num(row.total_score)
                        const color = scoreColor(score)
                        return (
                          <tr
                            key={employee.id}
                            onClick={() => navigate(`/employees/${employee.id}`)}
                            className="border-b border-[#E8E8E8] dark:border-[#2E2E2E] last:border-0 hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors cursor-pointer"
                          >
                            <td className="px-3 py-3">
                              <div className="flex items-center gap-3">
                                <div
                                  className="w-[34px] h-[34px] rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                                  style={{ background: color, color: '#0A0A0A' }}
                                >
                                  {initials(employee.full_name)}
                                </div>
                                <div>
                                  <p className="font-semibold text-[#1A1A1A] dark:text-white">{employee.full_name}</p>
                                  <p className="text-xs text-[#AAAAAA] dark:text-[#6B6B6B]">{employee.job_title || '—'}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-3 text-[#666666] dark:text-[#9A9A9A] whitespace-nowrap">{employee.departments?.name ?? '—'}</td>
                            <td className="px-3 py-3">
                              <span className="font-bold tabular-nums" style={{ color }}>{score.toFixed(1)}</span>
                            </td>
                            <td className="px-3 py-3">
                              <div className="relative h-2 rounded-md bg-[#F0F0F0] dark:bg-[#242424] overflow-hidden min-w-[90px]">
                                <span className="absolute inset-y-0 left-0 rounded-md" style={{ width: `${Math.max(0, Math.min(100, score))}%`, background: color }} />
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <span className={`inline-block px-2.5 py-1 rounded-full text-[11.5px] font-semibold whitespace-nowrap ${pillClass(row.rating)}`}>
                                {row.rating ?? 'Not Rated'}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Strengths / watch areas */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                <div className="p-5 rounded-2xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2E2E2E]">
                  <div className="flex items-baseline justify-between mb-2">
                    <h3 className="text-base font-semibold text-[#1A1A1A] dark:text-white">Strengths</h3>
                    <span className="text-xs text-[#AAAAAA] dark:text-[#6B6B6B]">what's working</span>
                  </div>
                  {insights.strengths.length === 0 ? (
                    <p className="text-sm text-[#666666] dark:text-[#A0A0A0] py-6">No standout signals yet — check back after more evaluations.</p>
                  ) : (
                    <ul className="list-none p-0 m-0">
                      {insights.strengths.map((s, i) => (
                        <li key={i} className="flex gap-3 py-3 border-b border-[#E8E8E8] dark:border-[#2E2E2E] last:border-0">
                          <span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: s.color }} />
                          <div>
                            <p className="font-semibold text-sm text-[#1A1A1A] dark:text-white">{s.title}</p>
                            <p className="text-[13px] text-[#666666] dark:text-[#9A9A9A] mt-0.5">{s.desc}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="p-5 rounded-2xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2E2E2E]">
                  <div className="flex items-baseline justify-between mb-2">
                    <h3 className="text-base font-semibold text-[#1A1A1A] dark:text-white">Watch areas</h3>
                    <span className="text-xs text-[#AAAAAA] dark:text-[#6B6B6B]">needs attention</span>
                  </div>
                  {insights.watch.length === 0 ? (
                    <p className="text-sm text-[#666666] dark:text-[#A0A0A0] py-6">Nothing flagged — the team is tracking evenly right now.</p>
                  ) : (
                    <ul className="list-none p-0 m-0">
                      {insights.watch.map((w, i) => (
                        <li key={i} className="flex gap-3 py-3 border-b border-[#E8E8E8] dark:border-[#2E2E2E] last:border-0">
                          <span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: w.color }} />
                          <div>
                            <p className="font-semibold text-sm text-[#1A1A1A] dark:text-white">{w.title}</p>
                            <p className="text-[13px] text-[#666666] dark:text-[#9A9A9A] mt-0.5">{w.desc}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {/* Recommendations */}
              <div className="p-5 rounded-2xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2E2E2E]">
                <div className="flex items-baseline justify-between mb-2">
                  <h3 className="text-base font-semibold text-[#00D4A0]">How to improve the team</h3>
                  <span className="text-xs text-[#AAAAAA] dark:text-[#6B6B6B]">generated from the data above</span>
                </div>
                <div>
                  {recommendations.map(r => (
                    <div key={r.n} className="flex gap-3.5 py-3.5 border-b border-[#E8E8E8] dark:border-[#2E2E2E] last:border-0">
                      <div className="w-[26px] h-[26px] rounded-lg bg-[#00D4A0]/[0.14] text-[#00D4A0] flex items-center justify-center font-bold text-[13px] shrink-0">
                        {r.n}
                      </div>
                      <div>
                        <p className="font-semibold text-sm text-[#1A1A1A] dark:text-white">{r.title}</p>
                        <p className="text-[13px] text-[#666666] dark:text-[#9A9A9A] mt-0.5">{r.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
