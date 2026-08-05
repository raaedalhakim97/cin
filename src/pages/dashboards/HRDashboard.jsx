import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Users,
  CalendarOff,
  UserMinus,
  Wallet,
  ArrowRight,
  CalendarClock,
  ShieldCheck,
  FileCheck2,
  FileText,
  AlertTriangle,
  UserX,
} from 'lucide-react'
import supabase from '../../services/supabase'
import { localDateStr } from '../../utils/exportHelpers'
import StatCard from '../../components/dashboard/StatCard'
import LatestNewsWidget from '../../components/dashboard/LatestNewsWidget'
import { SkeletonBlock } from '../../components/Skeleton'

function fmtDate(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function HRDashboard() {
  const [loading, setLoading] = useState(true)
  const [activeCount, setActiveCount] = useState(0)
  const [pendingLeaveCount, setPendingLeaveCount] = useState(0)
  const [onLeaveTodayCount, setOnLeaveTodayCount] = useState(0)
  const [payrollBreakdown, setPayrollBreakdown] = useState({ draft: 0, approved: 0, paid: 0 })
  const [pendingApprovals, setPendingApprovals] = useState([])
  const [upcoming, setUpcoming] = useState([])
  const [docsExpiringCount, setDocsExpiringCount] = useState(0)
  const [compliance, setCompliance] = useState({ dsrPending: 0, consentThisMonth: 0, missingWps: 0, nonCompliantEmployees: 0 })
  const [todayShiftsCount, setTodayShiftsCount] = useState(0)
  const [noShowCount, setNoShowCount] = useState(0)

  async function fetchAll() {
    setLoading(true)
    const today = localDateStr()
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

    const [
      { count: activeEmployeeCount },
      { count: pendingLeaveTotal },
      { data: onLeaveRows },
      { data: payrollRows },
      { data: approvalRows },
      { data: upcomingEmployees },
      { count: dsrPendingCount },
      { count: consentCount },
      { count: missingWpsCount },
      { count: docsExpiring },
      { data: nonCompliantRows },
      { count: todayShifts },
      { count: noShows },
    ] = await Promise.all([
      supabase.from('employees').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('leave_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('leave_requests').select('employee_id').eq('status', 'approved').lte('start_date', today).gte('end_date', today),
      supabase.from('payroll_runs').select('status').eq('period_year', now.getFullYear()).eq('period_month', now.getMonth() + 1),
      supabase.from('leave_requests').select('id, employee_id, leave_type, start_date, end_date, created_at, employees(full_name)')
        .eq('status', 'pending').order('created_at', { ascending: false }).limit(5),
      supabase.from('employees').select('id, full_name, hire_date, contract_type, contract_end_date').eq('status', 'active'),
      supabase.from('data_subject_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('consent_records').select('id', { count: 'exact', head: true }).gte('created_at', monthStart),
      supabase.from('employees').select('id', { count: 'exact', head: true })
        .or('iban.is.null,labour_card_number.is.null,agent_bank_routing_code.is.null'),
      supabase.from('hr_documents_with_status').select('id', { count: 'exact', head: true })
        .in('expiry_status', ['expiring_soon', 'expiring_critical']),
      supabase.from('employee_compliance_status').select('employee_id').in('compliance_status', ['missing', 'expired']),
      supabase.from('today_schedule').select('id', { count: 'exact', head: true }),
      supabase.from('shifts').select('id', { count: 'exact', head: true })
        .eq('status', 'no_show').gte('shift_date', localDateStr(new Date(Date.now() - 7 * 86400000))).lte('shift_date', today),
    ])

    setActiveCount(activeEmployeeCount ?? 0)
    setPendingLeaveCount(pendingLeaveTotal ?? 0)
    setOnLeaveTodayCount(new Set((onLeaveRows ?? []).map(r => r.employee_id)).size)

    const breakdown = { draft: 0, approved: 0, paid: 0 }
    ;(payrollRows ?? []).forEach(r => { if (breakdown[r.status] != null) breakdown[r.status] += 1 })
    setPayrollBreakdown(breakdown)

    setPendingApprovals(approvalRows ?? [])

    // Contract-end and hire-anniversary dates within the next 30 days —
    // recurring-yearly comparisons that PostgREST can't express as a simple
    // range filter, so computed client-side from a plain active-employee fetch.
    const todayDate = new Date(today)
    const in30 = new Date(todayDate); in30.setDate(in30.getDate() + 30)
    const events = []
    ;(upcomingEmployees ?? []).forEach(emp => {
      if (emp.contract_type === 'fixed_term' && emp.contract_end_date) {
        const end = new Date(emp.contract_end_date)
        if (end >= todayDate && end <= in30) {
          events.push({ id: `${emp.id}-end`, name: emp.full_name, date: end, label: 'Contract ends' })
        }
      }
      if (emp.hire_date) {
        const hire = new Date(emp.hire_date)
        let anniv = new Date(todayDate.getFullYear(), hire.getMonth(), hire.getDate())
        if (anniv < todayDate) anniv = new Date(todayDate.getFullYear() + 1, hire.getMonth(), hire.getDate())
        if (anniv >= todayDate && anniv <= in30) {
          const years = anniv.getFullYear() - hire.getFullYear()
          events.push({ id: `${emp.id}-anniv`, name: emp.full_name, date: anniv, label: `${years}-year anniversary` })
        }
      }
    })
    events.sort((a, b) => a.date - b.date)
    setUpcoming(events.slice(0, 5))

    setDocsExpiringCount(docsExpiring ?? 0)
    setTodayShiftsCount(todayShifts ?? 0)
    setNoShowCount(noShows ?? 0)
    setCompliance({
      dsrPending: dsrPendingCount ?? 0,
      consentThisMonth: consentCount ?? 0,
      missingWps: missingWpsCount ?? 0,
      nonCompliantEmployees: new Set((nonCompliantRows ?? []).map((r) => r.employee_id)).size,
    })

    setLoading(false)
  }

  useEffect(() => { fetchAll() }, [])

  const payrollSummary = useMemo(() => {
    const { draft, approved, paid } = payrollBreakdown
    if (draft + approved + paid === 0) return null
    return `${draft} draft · ${approved} approved · ${paid} paid`
  }, [payrollBreakdown])

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {[0, 1, 2, 3, 4].map(i => <SkeletonBlock key={i} className="h-19" />)}
        </div>
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
        <StatCard icon={Users} label="Active Employees" value={String(activeCount)} tone="neutral" />
        <StatCard icon={CalendarOff} label="Pending Leave Requests" value={pendingLeaveCount ? String(pendingLeaveCount) : null} tone={pendingLeaveCount ? 'orange' : 'neutral'} />
        <StatCard icon={UserMinus} label="On Leave Today" value={String(onLeaveTodayCount)} tone="blue" />
        <StatCard icon={Wallet} label="Payroll This Month" value={payrollSummary} tone="mint" />
        <Link to="/documents?tab=expiry" className="block">
          <StatCard icon={FileText} label="Documents Expiring (30 days)" value={String(docsExpiringCount)} tone={docsExpiringCount ? 'orange' : 'neutral'} />
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Pending approvals */}
        <div className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-[#1A1A1A] dark:text-white">Pending Approvals</h2>
            <Link to="/leave" className="text-xs text-[#00D4A0] hover:underline flex items-center gap-1">
              View all <ArrowRight size={11} />
            </Link>
          </div>
          {pendingApprovals.length === 0 ? (
            <div className="flex flex-col items-center py-10 gap-2">
              <CalendarOff size={22} className="text-[#AAAAAA] dark:text-[#555555]" />
              <p className="text-sm text-[#666666] dark:text-[#A0A0A0]">No pending requests</p>
            </div>
          ) : (
            <div className="space-y-1">
              {pendingApprovals.map(req => (
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

        {/* Upcoming — skipped entirely when there's no data, per spec */}
        {upcoming.length > 0 && (
          <div className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
            <h2 className="text-base font-semibold text-[#1A1A1A] dark:text-white mb-4">Upcoming</h2>
            <div className="space-y-1">
              {upcoming.map(ev => (
                <div key={ev.id} className="flex items-center gap-3 py-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#4D9FFF]/10 flex items-center justify-center shrink-0">
                    <CalendarClock size={15} className="text-[#4D9FFF]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[#1A1A1A] dark:text-white truncate">{ev.name}</p>
                    <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">{ev.label} · {fmtDate(ev.date)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Compliance snapshot */}
      <div>
        <p className="text-xs font-semibold tracking-widest text-[#AAAAAA] dark:text-[#555555] uppercase mb-3">
          Compliance Snapshot
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={FileCheck2} label="Data Subject Requests Pending" value={String(compliance.dsrPending)} tone={compliance.dsrPending ? 'orange' : 'neutral'} />
          <StatCard icon={ShieldCheck} label="Consent Records This Month" value={String(compliance.consentThisMonth)} tone="mint" />
          <StatCard icon={AlertTriangle} label="Employees Missing WPS Data" value={String(compliance.missingWps)} tone={compliance.missingWps ? 'red' : 'neutral'} />
          <Link to="/documents" className="block">
            <StatCard icon={FileText} label="Employees Non-Compliant" value={String(compliance.nonCompliantEmployees)} tone={compliance.nonCompliantEmployees ? 'red' : 'neutral'} />
          </Link>
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
