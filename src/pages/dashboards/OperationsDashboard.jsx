import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, ListChecks, UserX, FileWarning, ArrowRight, Plus, Settings2, Calendar } from 'lucide-react'
import supabase from '../../services/supabase'
import useAuthStore from '../../store/authStore'
import { localDateStr } from '../../utils/exportHelpers'
import StatCard from '../../components/dashboard/StatCard'
import LatestNewsWidget from '../../components/dashboard/LatestNewsWidget'
import ShiftModal from '../../components/schedule/ShiftModal'
import { SkeletonBlock } from '../../components/Skeleton'
import ToastComp, { useToast } from '../../components/Toast'

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
}

// Dashboard for the 'admin' role (session 36–37) — an operational role
// between hr_manager and employee, focused on shift scheduling. Same
// shell/component vocabulary as ManagerDashboard.jsx, but every panel here
// is scheduling-first per the task's explicit instruction.
export default function OperationsDashboard() {
  const employee = useAuthStore(s => s.employee)
  const companyId = useAuthStore(s => s.companyId)

  const [loading, setLoading] = useState(true)
  const [todayShifts, setTodayShifts] = useState([])
  const [pendingCount, setPendingCount] = useState(0)
  const [noShowCount, setNoShowCount] = useState(0)
  const [docsNeedingRenewal, setDocsNeedingRenewal] = useState(0)
  const [showAddShift, setShowAddShift] = useState(false)
  const { toast, showToast } = useToast()

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const today = localDateStr()
    const in7 = localDateStr(new Date(Date.now() + 7 * 86400000))
    const ago7 = localDateStr(new Date(Date.now() - 7 * 86400000))

    const [
      { data: todayRows },
      { count: pending },
      { count: noShows },
      { data: complianceRows },
    ] = await Promise.all([
      supabase.from('today_schedule').select('*').order('start_at'),
      supabase.from('shifts').select('id', { count: 'exact', head: true })
        .eq('status', 'scheduled').gte('shift_date', today).lte('shift_date', in7),
      supabase.from('shifts').select('id', { count: 'exact', head: true })
        .eq('status', 'no_show').gte('shift_date', ago7).lte('shift_date', today),
      // employee_compliance_status inherits hr_documents RLS (SECURITY
      // INVOKER) — migration 38 extended hr_documents_select to 'admin',
      // so this now reads real data for this role (was empty before; see
      // the resolved Known Gaps row from the prior session).
      supabase.from('employee_compliance_status').select('employee_id').in('compliance_status', ['missing', 'expired']),
    ])

    setTodayShifts(todayRows ?? [])
    setPendingCount(pending ?? 0)
    setNoShowCount(noShows ?? 0)
    setDocsNeedingRenewal(new Set((complianceRows ?? []).map(r => r.employee_id)).size)
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

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
        <StatCard icon={ListChecks} label="Pending Schedule Tasks" value={pendingCount ? String(pendingCount) : null} tone={pendingCount ? 'orange' : 'neutral'} />
        <StatCard icon={CalendarClock} label="Today's Shifts" value={String(todayShifts.length)} tone="mint" />
        <StatCard icon={UserX} label="No-Shows (7 days)" value={noShowCount ? String(noShowCount) : null} tone={noShowCount ? 'red' : 'neutral'} />
        <StatCard icon={FileWarning} label="Documents Needing Renewal" value={String(docsNeedingRenewal)} tone={docsNeedingRenewal ? 'orange' : 'neutral'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Today's shifts overview */}
        <div className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-[#1A1A1A] dark:text-white">Today's Shifts</h2>
            <Link to="/schedule?tab=today" className="text-xs text-[#00D4A0] hover:underline flex items-center gap-1">
              View all <ArrowRight size={11} />
            </Link>
          </div>
          {todayShifts.length === 0 ? (
            <div className="flex flex-col items-center py-10 gap-2">
              <Calendar size={22} className="text-[#AAAAAA] dark:text-[#555555]" />
              <p className="text-sm text-[#666666] dark:text-[#A0A0A0]">No shifts scheduled today</p>
            </div>
          ) : (
            <div className="space-y-1">
              {todayShifts.slice(0, 6).map(s => (
                <div key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-[#00D4A0] flex items-center justify-center text-white text-xs font-semibold shrink-0">
                      {initials(s.full_name)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#1A1A1A] dark:text-white truncate">{s.full_name}</p>
                      <p className="text-xs text-[#666666] dark:text-[#A0A0A0] truncate">{s.template_name ?? 'Custom'} · {fmtTime(s.start_at)}–{fmtTime(s.end_at)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
          <h2 className="text-base font-semibold text-[#1A1A1A] dark:text-white mb-5">Quick Actions</h2>
          <div className="grid grid-cols-3 gap-3">
            <button onClick={() => setShowAddShift(true)} className="flex flex-col items-center gap-2 cursor-pointer group">
              <div className="w-12 h-12 rounded-xl bg-[#00D4A0]/10 flex items-center justify-center group-hover:bg-[#00D4A0]/20 transition-colors">
                <Plus size={20} className="text-[#00D4A0]" />
              </div>
              <span className="text-xs text-center text-[#666666] dark:text-[#A0A0A0]">Add Shift</span>
            </button>
            <Link to="/schedule" className="flex flex-col items-center gap-2 cursor-pointer group">
              <div className="w-12 h-12 rounded-xl bg-[#4D9FFF]/10 flex items-center justify-center group-hover:bg-[#4D9FFF]/20 transition-colors">
                <Calendar size={20} className="text-[#4D9FFF]" />
              </div>
              <span className="text-xs text-center text-[#666666] dark:text-[#A0A0A0]">Full Schedule</span>
            </Link>
            <Link to="/schedule/templates" className="flex flex-col items-center gap-2 cursor-pointer group">
              <div className="w-12 h-12 rounded-xl bg-[#A78BFA]/10 flex items-center justify-center group-hover:bg-[#A78BFA]/20 transition-colors">
                <Settings2 size={20} className="text-[#A78BFA]" />
              </div>
              <span className="text-xs text-center text-[#666666] dark:text-[#A0A0A0]">Templates</span>
            </Link>
          </div>
        </div>
      </div>

      <LatestNewsWidget />

      {showAddShift && (
        <ShiftModal
          shift={null}
          initialDate={localDateStr()}
          companyId={companyId}
          currentEmployeeId={employee?.id}
          onClose={() => setShowAddShift(false)}
          onSaved={fetchAll}
          showToast={showToast}
        />
      )}

      <ToastComp toast={toast} />
    </div>
  )
}
