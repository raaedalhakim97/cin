import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Users,
  BarChart3,
  AlertTriangle,
  Inbox,
  ArrowRight,
  ShieldCheck,
  FileCheck2,
  FileText,
  Activity,
  CheckCircle2,
  XCircle,
  CalendarClock,
  UserX,
} from 'lucide-react'
import supabase from '../../services/supabase'
import { FEATURES } from '../../data/features'
import useAuthStore from '../../store/authStore'
import { localDateStr } from '../../utils/exportHelpers'
import StatCard from '../../components/dashboard/StatCard'
import TrendChart from '../../components/dashboard/TrendChart'
import LatestNewsWidget from '../../components/dashboard/LatestNewsWidget'
import { SkeletonBlock } from '../../components/Skeleton'

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

function num(v) { return Number(v || 0) }
function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0 }

// audit_logs.action is a plain 'INSERT'/'UPDATE'/'DELETE' verb, and table_name is a
// separate column — not a single 'table.ACTION' string as originally described. Adapted
// to what the schema actually has, confirmed live via Supabase MCP.
//
// 'wps_sif_generated' is deliberately still absent from this list. generate_wps_sif now
// has a caller (Payroll > Bank File) and does write that audit row, but it writes one on
// every attempt including the ones that come back with validation errors. Surfacing those
// here would fill the activity feed with "someone checked whether payroll was ready",
// which is noise, not activity. Revisit if the row ever records success separately.
// payroll_runs stays in the list: with payroll postponed nothing writes to it, so it
// contributes nothing rather than needing to be removed and remembered later.
const ACTIVITY_TABLES = ['kpi_scores', 'payroll_runs', 'user_roles']

const ACTIVITY_LABEL = {
  kpi_scores:   'KPI score recorded',
  payroll_runs: 'Payroll run created',
  user_roles:   'User role assigned',
}

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime()
  const hr = Math.floor(diffMs / 3600000)
  if (hr < 1) return 'just now'
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  return `${day}d ago`
}

// "Missing payment details" means the bank cannot be paid for this person: no labour card,
// or no IBAN and routing code. Since migration 52 the bank fields live on employee_pay, so
// a person with no pay row at all is missing them too — which the old `iban.is.null` filter
// could not express once the column had gone.
function countMissingPayDetails(rows) {
  return (rows ?? []).filter((e) => {
    const pay = (Array.isArray(e.employee_pay) ? e.employee_pay[0] : e.employee_pay) ?? {}
    return !e.labour_card_number || !pay.iban || !pay.agent_bank_routing_code
  }).length
}

export default function AdminDashboard() {
  const companyId = useAuthStore(s => s.companyId)
  // 'none' means BYOND produces no bank salary file for this country, so the UAE
  // payroll-file widgets below have nothing to report on. Missing rather than empty:
  // an empty card still asks a question the company cannot answer.
  const hasBankFile = (useAuthStore(s => s.countryRules?.payment_file) ?? 'none') !== 'none'

  const [loading, setLoading] = useState(true)
  const [totalEmployees, setTotalEmployees] = useState(0)
  const [kpiScores, setKpiScores] = useState([])
  const [employeeIds, setEmployeeIds] = useState([])
  const [newLeadsCount, setNewLeadsCount] = useState(0)
  const [wps, setWps] = useState({ mol: false, bankRouting: false })
  const [activity, setActivity] = useState([])
  const [docsExpiringCount, setDocsExpiringCount] = useState(0)
  const [complianceExtra, setComplianceExtra] = useState({ dsrPending: 0, consentThisMonth: 0, missingWps: 0 })
  const [todayShiftsCount, setTodayShiftsCount] = useState(0)
  const [noShowCount, setNoShowCount] = useState(0)

  async function fetchAll() {
    setLoading(true)
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

    const [
      { data: emps },
      { data: scoreRows },
      { count: leadsCount },
      { data: companyRow },
      { data: auditRows },
      { count: dsrPendingCount },
      { count: consentCount },
      { data: payDetailRows },
      { count: docsExpiring },
      { count: todayShifts },
      { count: noShows },
    ] = await Promise.all([
      supabase.from('employees').select('id'),
      supabase.from('kpi_scores').select('employee_id, period_year, period_month, total_score, attendance_score, achievement_score'),
      supabase.from('demo_requests').select('id', { count: 'exact', head: true }).eq('status', 'new'),
      companyId
        ? supabase.from('company').select('mol_establishment_id, employer_bank_routing_code').eq('id', companyId).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from('audit_logs').select('table_name, action, user_id, created_at')
        .in('table_name', ACTIVITY_TABLES).eq('action', 'INSERT')
        .order('created_at', { ascending: false }).limit(5),
      supabase.from('data_subject_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('consent_records').select('id', { count: 'exact', head: true }).gte('created_at', monthStart),
      // Was one query against employees; iban and the routing code moved to employee_pay in
      // migration 52, and a missing pay row counts as missing details just as a null column
      // did. Counted here as "people with no bank details on file", which is what the card
      // has always meant.
      supabase.from('employees').select('id, labour_card_number, employee_pay!employee_pay_employee_id_fkey(iban, agent_bank_routing_code)')
        .neq('status', 'terminated'),
      supabase.from('hr_documents_with_status').select('id', { count: 'exact', head: true })
        .in('expiry_status', ['expiring_soon', 'expiring_critical']),
      supabase.from('today_schedule').select('id', { count: 'exact', head: true }),
      supabase.from('shifts').select('id', { count: 'exact', head: true })
        .eq('status', 'no_show').gte('shift_date', localDateStr(new Date(Date.now() - 7 * 86400000))).lte('shift_date', localDateStr()),
    ])

    setTotalEmployees(emps?.length ?? 0)
    setEmployeeIds((emps ?? []).map(e => e.id))
    setKpiScores(scoreRows ?? [])
    setNewLeadsCount(leadsCount ?? 0)
    setWps({ mol: !!companyRow?.mol_establishment_id, bankRouting: !!companyRow?.employer_bank_routing_code })
    setComplianceExtra({
      dsrPending: dsrPendingCount ?? 0,
      consentThisMonth: consentCount ?? 0,
      missingWps: countMissingPayDetails(payDetailRows),
    })

    // Best-effort name lookup — audit_logs.user_id references auth.users,
    // not employees directly, so resolve display names via a separate query
    // rather than assuming a PostgREST-embeddable FK exists between them.
    const userIds = [...new Set((auditRows ?? []).map(r => r.user_id).filter(Boolean))]
    let namesByUser = {}
    if (userIds.length) {
      const { data: actorRows } = await supabase.from('employees').select('user_id, full_name').in('user_id', userIds)
      namesByUser = Object.fromEntries((actorRows ?? []).map(r => [r.user_id, r.full_name]))
    }
    setActivity((auditRows ?? []).map(r => ({ ...r, actorName: namesByUser[r.user_id] ?? null })))
    setDocsExpiringCount(docsExpiring ?? 0)
    setTodayShiftsCount(todayShifts ?? 0)
    setNoShowCount(noShows ?? 0)

    setLoading(false)
  }

  useEffect(() => { fetchAll() }, [companyId])

  const latestByEmployee = useMemo(() => {
    return employeeIds.map(id => {
      const rows = kpiScores.filter(s => s.employee_id === id)
      if (!rows.length) return null
      const isAfter = (a, b) => a.period_year > b.period_year || (a.period_year === b.period_year && a.period_month > b.period_month)
      return rows.reduce((best, s) => (!best || isAfter(s, best)) ? s : best, null)
    }).filter(Boolean)
  }, [employeeIds, kpiScores])

  const companyAvgKpi = latestByEmployee.length ? avg(latestByEmployee.map(r => num(r.total_score))) : null
  const atRiskCount = latestByEmployee.filter(r => num(r.total_score) < 60).length

  // Group all company kpi_scores by calendar month, keeping only the most
  // recent period_year present per month — mirrors TeamAnalytics.jsx's
  // trendData exactly (12-point, most-recent-year-per-month cycle).
  const trendData = useMemo(() => {
    const yearByMonth = {}
    kpiScores.forEach(s => {
      const m = s.period_month
      if (yearByMonth[m] == null || s.period_year > yearByMonth[m]) yearByMonth[m] = s.period_year
    })
    const buckets = {}
    kpiScores.forEach(s => {
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
  }, [kpiScores])

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {[0, 1, 2, 3, 4].map(i => <SkeletonBlock key={i} className="h-19" />)}
        </div>
        <SkeletonBlock className="h-64" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SkeletonBlock className="h-56" />
          <SkeletonBlock className="h-56" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard icon={Users} label="Total Employees" value={String(totalEmployees)} tone="neutral" />
        <StatCard icon={BarChart3} label="Team Avg KPI" value={companyAvgKpi != null ? companyAvgKpi.toFixed(1) : null} tone="purple" />
        <StatCard icon={AlertTriangle} label="At-Risk Employees" value={String(atRiskCount)} tone={atRiskCount ? 'red' : 'neutral'} />
        <StatCard icon={Inbox} label="New Demo Requests" value={String(newLeadsCount)} tone={newLeadsCount ? 'orange' : 'neutral'} />
        <Link to="/documents?tab=expiry" className="block">
          <StatCard icon={FileText} label="Documents Expiring (30 days)" value={String(docsExpiringCount)} tone={docsExpiringCount ? 'orange' : 'neutral'} />
        </Link>
      </div>

      {/* Company KPI trend */}
      <div className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-[#1A1A1A] dark:text-white">Company KPI Trend</h2>
          <Link to="/team-analytics" className="text-xs text-[#00D4A0] hover:underline flex items-center gap-1">
            Full analytics <ArrowRight size={11} />
          </Link>
        </div>
        {trendData.length === 0 ? (
          <div className="flex flex-col items-center py-10 gap-2">
            <BarChart3 size={22} className="text-[#AAAAAA] dark:text-[#555555]" />
            <p className="text-sm text-[#666666] dark:text-[#A0A0A0]">No KPI history yet</p>
          </div>
        ) : (
          <>
            <TrendChart data={trendData} />
            <div className="flex gap-4 text-xs text-[#666666] dark:text-[#9A9A9A] mt-2.5">
              <span className="inline-flex items-center gap-1.5"><i className="w-4.5 h-0.75 rounded-sm inline-block bg-[#00D4A0]" />Team average</span>
              <span className="inline-flex items-center gap-1.5"><i className="w-4.5 h-0.75 rounded-sm inline-block bg-[#4DA6FF]" />Attendance</span>
              <span className="inline-flex items-center gap-1.5"><i className="w-4.5 h-0.75 rounded-sm inline-block bg-[#FFB020]" />Achievement</span>
            </div>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Compliance snapshot */}
        <div className="space-y-4">
          <p className="text-xs font-semibold tracking-widest text-[#AAAAAA] dark:text-[#555555] uppercase">
            Compliance Snapshot
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <StatCard icon={FileCheck2} label="DSR Pending" value={String(complianceExtra.dsrPending)} tone={complianceExtra.dsrPending ? 'orange' : 'neutral'} />
            <StatCard icon={ShieldCheck} label="Consent This Month" value={String(complianceExtra.consentThisMonth)} tone="mint" />
            {/* Both of these are artefacts of one country's salary transfer scheme. The
                stat counts employees missing a labour card, IBAN and agent routing code;
                the card checks a MOHRE establishment ID. A company in a country BYOND
                generates no bank file for has none of those, and showing it a permanent
                red count of "missing" documents it will never possess is the country mix
                this release exists to remove. country_rules.payment_file decides. */}
            {hasBankFile && FEATURES.payroll && (
              <>
                <StatCard icon={AlertTriangle} label="Missing Payment Details" value={String(complianceExtra.missingWps)} tone={complianceExtra.missingWps ? 'red' : 'neutral'} />
                <div className="flex flex-col gap-2.5 p-5 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
                  <p className="text-xs font-medium text-[#666666] dark:text-[#A0A0A0]">Payroll File Readiness</p>
                  <div className="flex items-center gap-2 text-sm">
                    {wps.mol ? <CheckCircle2 size={14} className="text-[#00D4A0]" /> : <XCircle size={14} className="text-[#FF4D4D]" />}
                    <span className="text-[#1A1A1A] dark:text-white">MOL Establishment ID</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    {wps.bankRouting ? <CheckCircle2 size={14} className="text-[#00D4A0]" /> : <XCircle size={14} className="text-[#FF4D4D]" />}
                    <span className="text-[#1A1A1A] dark:text-white">Employer Bank Routing Code</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Recent activity */}
        <div className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
          <h2 className="text-base font-semibold text-[#1A1A1A] dark:text-white mb-4">Recent Activity</h2>
          {activity.length === 0 ? (
            <div className="flex flex-col items-center py-10 gap-2">
              <Activity size={22} className="text-[#AAAAAA] dark:text-[#555555]" />
              <p className="text-sm text-[#666666] dark:text-[#A0A0A0]">No recent activity</p>
            </div>
          ) : (
            <div className="space-y-1">
              {activity.map((row, i) => (
                <div key={i} className="flex items-center gap-3 py-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#00D4A0]/10 flex items-center justify-center shrink-0">
                    <Activity size={14} className="text-[#00D4A0]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[#1A1A1A] dark:text-white truncate">
                      {ACTIVITY_LABEL[row.table_name] ?? `${row.table_name} ${row.action.toLowerCase()}`}
                    </p>
                    <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">
                      {row.actorName ?? 'System'} · {timeAgo(row.created_at)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Scheduling snapshot */}
      <div>
        <p className="text-xs font-semibold tracking-widest text-[#AAAAAA] dark:text-[#555555] uppercase mb-3">
          Scheduling Snapshot
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Link to="/schedule?tab=today" className="block">
            <StatCard icon={CalendarClock} label="Today's Shifts" value={String(todayShiftsCount)} tone="mint" />
          </Link>
          <Link to="/schedule" className="block">
            <StatCard icon={UserX} label="No-Shows This Week" value={String(noShowCount)} tone={noShowCount ? 'red' : 'neutral'} />
          </Link>
        </div>
      </div>

      <LatestNewsWidget />
    </div>
  )
}
