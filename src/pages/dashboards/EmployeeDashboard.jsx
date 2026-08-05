import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CalendarCheck,
  CalendarOff,
  CreditCard,
  ClipboardCheck,
  Wallet,
  BarChart3,
  Target,
  FileText,
  CalendarClock,
} from 'lucide-react'
import supabase from '../../services/supabase'
import useAuthStore from '../../store/authStore'
import { localDateStr } from '../../utils/exportHelpers'
import StatCard from '../../components/dashboard/StatCard'
import LatestNewsWidget from '../../components/dashboard/LatestNewsWidget'
import { SkeletonBlock } from '../../components/Skeleton'

// Mirrors KPI.jsx's RATING_META — duplicated locally per this codebase's
// established per-file convention for small display-only lookup maps.
const RATING_META = {
  'Exceptional':        { cls: 'bg-[#A78BFA]/10 text-[#A78BFA]' },
  'High Performer':     { cls: 'bg-[#00D4A0]/10 text-[#00D4A0]' },
  'Meets Expectations': { cls: 'bg-[#4D9FFF]/10 text-[#4D9FFF]' },
  'Needs Improvement':  { cls: 'bg-[#FF8C42]/10 text-[#FF8C42]' },
  'Unsatisfactory':     { cls: 'bg-[#FF4D4D]/10 text-[#FF4D4D]' },
}
const NOT_RATED_META = { cls: 'bg-[#A0A0A0]/10 text-[#666666] dark:text-[#A0A0A0]' }

const QUICK_ACTIONS = [
  { label: 'Clock in/out', icon: CalendarCheck, to: '/attendance' },
  { label: 'Request leave', icon: CalendarOff, to: '/leave' },
  { label: 'View payslip', icon: CreditCard, to: '/payroll' },
]

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtShiftTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

export default function EmployeeDashboard() {
  const employee = useAuthStore(s => s.employee)

  const [loading, setLoading] = useState(true)
  const [attendanceToday, setAttendanceToday] = useState(null)
  const [leaveRemaining, setLeaveRemaining] = useState(null)
  const [latestKpi, setLatestKpi] = useState(null)
  const [activePlans, setActivePlans] = useState([])
  const [planProgress, setPlanProgress] = useState({}) // plan_id -> latest score
  const [docCompliance, setDocCompliance] = useState(null) // { valid, total }
  const [todayShift, setTodayShift] = useState(null)

  async function fetchAll() {
    if (!employee?.id) { setLoading(false); return }
    setLoading(true)

    const today = localDateStr()
    const currentYear = new Date().getFullYear()

    const [
      { data: attendanceRow },
      { data: balances },
      { data: kpiRows },
      { data: plans },
      { data: complianceRows },
      { data: shiftRow },
    ] = await Promise.all([
      supabase.from('attendance').select('clock_in, clock_out').eq('employee_id', employee.id).eq('date', today).maybeSingle(),
      supabase.from('leave_balances').select('remaining_days').eq('employee_id', employee.id).eq('year', currentYear),
      supabase.from('kpi_scores').select('total_score, rating, period_year, period_month')
        .eq('employee_id', employee.id).order('period_year', { ascending: false }).order('period_month', { ascending: false }).limit(1),
      supabase.from('pdp_plans').select('id, title, focus_component, baseline_score, target_score, target_date')
        .eq('employee_id', employee.id).eq('status', 'active'),
      supabase.from('employee_compliance_status').select('compliance_status').eq('employee_id', employee.id),
      supabase.from('today_schedule').select('start_at, end_at, template_name, shift_type').eq('employee_id', employee.id).order('start_at').limit(1).maybeSingle(),
    ])

    setAttendanceToday(attendanceRow ?? null)
    setLeaveRemaining(balances && balances.length ? balances.reduce((sum, b) => sum + Number(b.remaining_days || 0), 0) : null)
    setLatestKpi(kpiRows && kpiRows.length ? kpiRows[0] : null)
    setActivePlans(plans ?? [])
    setDocCompliance(
      complianceRows && complianceRows.length
        ? { valid: complianceRows.filter((r) => r.compliance_status === 'valid').length, total: complianceRows.length }
        : null
    )
    setTodayShift(shiftRow ?? null)

    if (plans?.length) {
      const { data: progressRows } = await supabase
        .from('pdp_progress')
        .select('plan_id, score, period_year, period_month')
        .in('plan_id', plans.map(p => p.id))
        .order('period_year')
        .order('period_month')
      const latestByPlan = {}
      ;(progressRows ?? []).forEach(row => { latestByPlan[row.plan_id] = row.score })
      setPlanProgress(latestByPlan)
    } else {
      setPlanProgress({})
    }

    setLoading(false)
  }

  useEffect(() => { fetchAll() }, [employee?.id])

  const attendanceLabel = !attendanceToday
    ? 'Not clocked in'
    : attendanceToday.clock_in && !attendanceToday.clock_out
      ? 'Clocked in'
      : 'Clocked out'
  const attendanceTone = !attendanceToday ? 'neutral' : attendanceToday.clock_in && !attendanceToday.clock_out ? 'mint' : 'blue'

  const ratingMeta = latestKpi?.rating ? (RATING_META[latestKpi.rating] ?? NOT_RATED_META) : null

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
          {[0, 1, 2, 3, 4, 5].map(i => <SkeletonBlock key={i} className="h-19" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <SkeletonBlock className="h-64 lg:col-span-1" />
          <SkeletonBlock className="h-64 lg:col-span-2" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
        <StatCard icon={ClipboardCheck} label="Today's Status" value={attendanceLabel} tone={attendanceTone} />
        <StatCard
          icon={CalendarClock}
          label="Today's Shift"
          value={
            todayShift?.shift_type === 'off'
              ? 'Day off'
              : todayShift
                ? `${fmtShiftTime(todayShift.start_at)}–${fmtShiftTime(todayShift.end_at)}${todayShift.template_name ? ` (${todayShift.template_name})` : ''}`
                : null
          }
          tone={todayShift?.shift_type === 'off' ? 'blue' : todayShift ? 'mint' : 'neutral'}
        />
        <StatCard
          icon={Wallet}
          label="Leave Balance"
          value={leaveRemaining != null ? `${leaveRemaining} days` : null}
          tone="mint"
        />
        <StatCard
          icon={BarChart3}
          label="Latest KPI Score"
          value={latestKpi ? (
            <span className="inline-flex items-center gap-1.5">
              {Number(latestKpi.total_score).toFixed(1)}
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${(ratingMeta ?? NOT_RATED_META).cls}`}>
                {latestKpi.rating ?? 'Not rated'}
              </span>
            </span>
          ) : null}
          tone="purple"
        />
        <StatCard icon={Target} label="Active Development Plans" value={activePlans.length ? String(activePlans.length) : null} tone="blue" />
        <StatCard
          icon={FileText}
          label="My Documents"
          value={docCompliance ? `${docCompliance.valid} / ${docCompliance.total} valid` : null}
          tone={docCompliance && docCompliance.valid < docCompliance.total ? 'orange' : 'mint'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left: Quick actions + News */}
        <div className="lg:col-span-1 space-y-6">
          <div className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
            <h2 className="text-base font-semibold text-[#1A1A1A] dark:text-white mb-5">Quick Actions</h2>
            <div className="grid grid-cols-3 gap-3">
              {QUICK_ACTIONS.map(({ label, icon: Icon, to }) => (
                <Link key={to} to={to} className="flex flex-col items-center gap-2 cursor-pointer group">
                  <div className="w-12 h-12 rounded-xl bg-[#00D4A0]/10 flex items-center justify-center group-hover:bg-[#00D4A0]/20 transition-colors">
                    <Icon size={20} className="text-[#00D4A0]" />
                  </div>
                  <span className="text-xs text-center text-[#666666] dark:text-[#A0A0A0]">{label}</span>
                </Link>
              ))}
            </div>
          </div>

          <LatestNewsWidget />
        </div>

        {/* Right: Development plans */}
        <div className="lg:col-span-2">
          <div className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
            <h2 className="text-base font-semibold text-[#1A1A1A] dark:text-white mb-5">Development Plans</h2>

            {activePlans.length === 0 ? (
              <div className="flex flex-col items-center py-10 gap-2">
                <Target size={22} className="text-[#AAAAAA] dark:text-[#555555]" />
                <p className="text-sm text-[#666666] dark:text-[#A0A0A0]">No active development plans</p>
                <Link to="/kpi" className="text-xs text-[#00D4A0] hover:underline">Start one on the KPI page</Link>
              </div>
            ) : (
              <div className="space-y-5">
                {activePlans.map(plan => {
                  const baseline = Number(plan.baseline_score ?? 0)
                  const target = Number(plan.target_score ?? 0)
                  const current = planProgress[plan.id] != null ? Number(planProgress[plan.id]) : baseline
                  const span = target - baseline
                  const pct = span === 0 ? 100 : Math.max(0, Math.min(100, ((current - baseline) / span) * 100))
                  return (
                    <div key={plan.id}>
                      <div className="flex items-center justify-between text-sm mb-1.5">
                        <span className="font-medium text-[#1A1A1A] dark:text-white">{plan.title}</span>
                        <span className="text-xs text-[#666666] dark:text-[#A0A0A0]">Target {fmtDate(plan.target_date)}</span>
                      </div>
                      {plan.baseline_score != null && plan.target_score != null ? (
                        <>
                          <div className="flex items-center justify-between text-xs mb-1.5">
                            <span className="text-[#666666] dark:text-[#A0A0A0]">Baseline <span className="font-semibold text-[#1A1A1A] dark:text-white">{baseline.toFixed(0)}</span></span>
                            <span className="text-[#00D4A0] font-semibold">Current {current.toFixed(0)}</span>
                            <span className="text-[#666666] dark:text-[#A0A0A0]">Target <span className="font-semibold text-[#1A1A1A] dark:text-white">{target.toFixed(0)}</span></span>
                          </div>
                          <div className="h-2.5 bg-[#F0F0F0] dark:bg-[#2A2A2A] rounded-full overflow-hidden">
                            <div className="h-full bg-[#00D4A0] rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                          </div>
                        </>
                      ) : (
                        <p className="text-xs text-[#AAAAAA] dark:text-[#555555]">No baseline/target score set for this plan yet</p>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
