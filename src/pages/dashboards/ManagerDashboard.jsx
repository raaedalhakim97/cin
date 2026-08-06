import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Users, UserCheck, CalendarOff, BarChart3, ArrowRight } from 'lucide-react'
import supabase from '../../services/supabase'
import useAuthStore from '../../store/authStore'
import { localDateStr } from '../../utils/exportHelpers'
import StatCard from '../../components/dashboard/StatCard'
import TrendChart from '../../components/dashboard/TrendChart'
import { SkeletonBlock } from '../../components/Skeleton'

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

const ATTENDANCE_LABEL = {
  present:              { label: 'Present', cls: 'bg-[#00D4A0]/10 text-[#00D4A0]' },
  late_minor:           { label: 'Late', cls: 'bg-[#FF8C42]/10 text-[#FF8C42]' },
  late_moderate:        { label: 'Late', cls: 'bg-[#FF8C42]/10 text-[#FF8C42]' },
  late_major:           { label: 'Late', cls: 'bg-[#FF8C42]/10 text-[#FF8C42]' },
  absent_approved:      { label: 'On Leave', cls: 'bg-[#4D9FFF]/10 text-[#4D9FFF]' },
  absent_unauthorized:  { label: 'Absent', cls: 'bg-[#FF4D4D]/10 text-[#FF4D4D]' },
}
const NOT_CLOCKED_IN = { label: 'Not Clocked In', cls: 'bg-[#A0A0A0]/10 text-[#666666] dark:text-[#A0A0A0]' }

function num(v) { return Number(v || 0) }
function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0 }

export default function ManagerDashboard() {
  const employee = useAuthStore(s => s.employee)

  const [loading, setLoading] = useState(true)
  const [team, setTeam] = useState([])
  const [attendanceToday, setAttendanceToday] = useState([])
  const [pendingLeave, setPendingLeave] = useState([])
  const [kpiScores, setKpiScores] = useState([])

  async function fetchAll() {
    if (!employee?.department_id) { setLoading(false); return }
    setLoading(true)
    const today = localDateStr()

    const { data: teamRows } = await supabase
      .from('employees')
      .select('id, full_name, job_title, status, emp_code')
      .eq('department_id', employee.department_id)
      .eq('status', 'active')
      .order('full_name')

    const teamIds = (teamRows ?? []).map(t => t.id)
    setTeam(teamRows ?? [])

    if (teamIds.length === 0) {
      setAttendanceToday([])
      setPendingLeave([])
      setKpiScores([])
      setLoading(false)
      return
    }

    const [{ data: attRows }, { data: leaveRows }, { data: scoreRows }] = await Promise.all([
      supabase.from('attendance').select('employee_id, status').in('employee_id', teamIds).eq('date', today),
      supabase.from('leave_requests').select('id, employee_id, leave_type, start_date, end_date, created_at, employees!leave_requests_employee_id_fkey(full_name)')
        .in('employee_id', teamIds).eq('status', 'pending').order('created_at', { ascending: false }),
      supabase.from('kpi_scores').select('employee_id, period_year, period_month, total_score').in('employee_id', teamIds),
    ])

    setAttendanceToday(attRows ?? [])
    setPendingLeave(leaveRows ?? [])
    setKpiScores(scoreRows ?? [])
    setLoading(false)
  }

  useEffect(() => { fetchAll() }, [employee?.department_id])

  const attendanceByEmployee = useMemo(() => {
    const map = {}
    attendanceToday.forEach(a => { map[a.employee_id] = a.status })
    return map
  }, [attendanceToday])

  const presentCount = useMemo(() =>
    attendanceToday.filter(a => a.status === 'present' || a.status?.startsWith('late_')).length,
  [attendanceToday])

  const latestByEmployee = useMemo(() => {
    return team.map(emp => {
      const rows = kpiScores.filter(s => s.employee_id === emp.id)
      if (!rows.length) return null
      const isAfter = (a, b) => a.period_year > b.period_year || (a.period_year === b.period_year && a.period_month > b.period_month)
      return rows.reduce((best, s) => (!best || isAfter(s, best)) ? s : best, null)
    }).filter(Boolean)
  }, [team, kpiScores])

  const teamAvgKpi = latestByEmployee.length ? avg(latestByEmployee.map(r => num(r.total_score))) : null

  // Last 6 populated (year, month) buckets across the team, chronological.
  const trendData = useMemo(() => {
    const buckets = {}
    kpiScores.forEach(s => {
      const key = `${s.period_year}-${s.period_month}`
      if (!buckets[key]) buckets[key] = { year: s.period_year, month: s.period_month, values: [] }
      if (s.total_score != null) buckets[key].values.push(Number(s.total_score))
    })
    return Object.values(buckets)
      .filter(b => b.values.length)
      .sort((a, b) => a.year - b.year || a.month - b.month)
      .slice(-6)
      .map(b => ({
        month: `${b.year}-${b.month}`,
        label: `${MONTHS[b.month - 1].slice(0, 3)} '${String(b.year).slice(-2)}`,
        team: avg(b.values),
      }))
  }, [kpiScores])

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map(i => <SkeletonBlock key={i} className="h-19" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SkeletonBlock className="h-64" />
          <SkeletonBlock className="h-64" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Team Size" value={String(team.length)} tone="neutral" />
        <StatCard icon={UserCheck} label="Present Today" value={team.length ? `${presentCount} / ${team.length}` : null} tone="mint" />
        <StatCard icon={CalendarOff} label="Pending Leave" value={pendingLeave.length ? String(pendingLeave.length) : null} tone={pendingLeave.length ? 'orange' : 'neutral'} />
        <StatCard icon={BarChart3} label="Team Avg KPI" value={teamAvgKpi != null ? teamAvgKpi.toFixed(1) : null} tone="purple" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Team today */}
        <div className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
          <h2 className="text-base font-semibold text-[#1A1A1A] dark:text-white mb-4">Team Today</h2>
          {team.length === 0 ? (
            <div className="flex flex-col items-center py-10 gap-2">
              <Users size={22} className="text-[#AAAAAA] dark:text-[#555555]" />
              <p className="text-sm text-[#666666] dark:text-[#A0A0A0]">No active team members yet</p>
            </div>
          ) : (
            <div className="space-y-1">
              {team.map(member => {
                const meta = ATTENDANCE_LABEL[attendanceByEmployee[member.id]] ?? NOT_CLOCKED_IN
                return (
                  <Link
                    key={member.id}
                    to={`/employees/${member.id}`}
                    className="flex items-center justify-between gap-3 py-2.5 px-2 -mx-2 rounded-lg hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-[#00D4A0] flex items-center justify-center text-white text-xs font-semibold shrink-0">
                        {member.full_name?.[0]?.toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[#1A1A1A] dark:text-white truncate">{member.full_name}</p>
                        <p className="text-xs text-[#666666] dark:text-[#A0A0A0] truncate">
                          {member.emp_code ? `${member.emp_code} · ` : ''}{member.job_title || '—'}
                        </p>
                      </div>
                    </div>
                    <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-semibold ${meta.cls}`}>{meta.label}</span>
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        {/* Pending approvals */}
        <div className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-[#1A1A1A] dark:text-white">Pending Approvals</h2>
            <Link to="/leave" className="text-xs text-[#00D4A0] hover:underline flex items-center gap-1">
              Review <ArrowRight size={11} />
            </Link>
          </div>
          {pendingLeave.length === 0 ? (
            <div className="flex flex-col items-center py-10 gap-2">
              <CalendarOff size={22} className="text-[#AAAAAA] dark:text-[#555555]" />
              <p className="text-sm text-[#666666] dark:text-[#A0A0A0]">No pending requests</p>
            </div>
          ) : (
            <div className="space-y-1">
              {pendingLeave.map(req => (
                <Link
                  key={req.id}
                  to="/leave"
                  className="flex items-center justify-between gap-3 py-2.5 px-2 -mx-2 rounded-lg hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[#1A1A1A] dark:text-white truncate">{req.employees?.full_name ?? 'Unknown'}</p>
                    <p className="text-xs text-[#666666] dark:text-[#A0A0A0] capitalize">{req.leave_type} · {req.start_date} → {req.end_date}</p>
                  </div>
                  <span className="shrink-0 px-2.5 py-1 rounded-full text-xs font-semibold bg-[#FF8C42]/10 text-[#FF8C42]">Pending</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Team KPI snapshot */}
      <div className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
        <h2 className="text-base font-semibold text-[#1A1A1A] dark:text-white mb-4">Team KPI Snapshot</h2>
        {trendData.length === 0 ? (
          <div className="flex flex-col items-center py-10 gap-2">
            <BarChart3 size={22} className="text-[#AAAAAA] dark:text-[#555555]" />
            <p className="text-sm text-[#666666] dark:text-[#A0A0A0]">No KPI history for your team yet</p>
          </div>
        ) : (
          <>
            <TrendChart data={trendData} lines={[{ key: 'team', color: '#00D4A0', width: 3.5, dot: true }]} />
            <div className="flex gap-4 text-xs text-[#666666] dark:text-[#9A9A9A] mt-2.5">
              <span className="inline-flex items-center gap-1.5"><i className="w-4.5 h-0.75 rounded-sm inline-block bg-[#00D4A0]" />Team average</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
