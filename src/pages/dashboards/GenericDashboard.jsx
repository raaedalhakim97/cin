import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Clock,
  Timer,
  CheckCircle2,
  Briefcase,
  Building2,
  CalendarDays,
  MapPin,
} from 'lucide-react'
import supabase from '../../services/supabase'
import { localDateStr } from '../../utils/exportHelpers'
import StatCard from '../../components/dashboard/StatCard'
import LatestNewsWidget from '../../components/dashboard/LatestNewsWidget'
import { SkeletonBlock } from '../../components/Skeleton'

// Moved out of Dashboard.jsx as-is (session 32) — this is now the fallback
// view for roles the role-aware dashboards don't cover yet: `read_only` and
// any unrecognized role. Greeting header and the "account not linked"
// notice moved up to Dashboard.jsx's dispatcher, since those are shared by
// every role, not specific to this one.

const statusBadge = {
  active:     'bg-[#00D4A0]/10 text-[#00D4A0]',
  on_leave:   'bg-[#FF8C42]/10 text-[#FF8C42]',
  suspended:  'bg-[#FF4D4D]/10 text-[#FF4D4D]',
  terminated: 'bg-[#555555]/20 text-[#A0A0A0]',
}

const classificationLabel = {
  full_time_permanent: 'Full-Time Permanent',
  full_time_contract:  'Full-Time Contract',
  part_time:           'Part-Time',
  intern:              'Intern',
  contractor:          'Contractor',
}

function formatTime(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
}

function formatDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function calcDuration(inIso, outIso) {
  const ms = new Date(outIso) - new Date(inIso)
  const h  = Math.floor(ms / 3600000)
  const m  = Math.floor((ms % 3600000) / 60000)
  return `${h}h ${m}m`
}

// ─── Attendance Card ──────────────────────────────────────────────────────────
// This card shows today's punch and sends you to the Attendance page to make
// one. It used to clock in and out inline, and that duplicate was wrong in
// ways that were invisible until the server started checking:
//
//   * it sent no coordinates, so once require_gps_clock_in was enforced in the
//     database (migration 14) every clock-in from here would be refused;
//   * it hardcoded status 'present', so nobody clocking in from the dashboard
//     was ever recorded as late;
//   * it never looked for today's shift, so the punch was not measured against
//     one, and require_shift_to_clock_in was not applied;
//   * it had no geofence handling and no early-checkout reason prompt.
//
// The Attendance page does all of that already. Rather than grow a second
// implementation that has to be kept in step with it, this links there — which
// is what the mobile home screen has always done. One clock-in path, one place
// for the rules to live.
//
// `canClockInOut` no longer excludes read_only: that role describes what someone
// may see, not whether they work a shift.
function AttendanceCard({ employee, canClockInOut }) {
  const [attendance,    setAttendance]    = useState(null)
  const [loadingRecord, setLoadingRecord] = useState(true)

  const today = localDateStr()

  // Read-only now, so there is nothing to refetch after — which lets the query
  // live inside the effect instead of in a function the effect reaches upwards
  // for. `cancelled` covers the employee changing while a request is in flight.
  useEffect(() => {
    let cancelled = false
    supabase
      .from('attendance')
      .select('*')
      .eq('employee_id', employee.id)
      .eq('date', today)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setAttendance(data)
        setLoadingRecord(false)
      })
    return () => { cancelled = true }
  }, [employee.id, today])

  const clockedIn  = !!attendance?.clock_in
  const clockedOut = !!attendance?.clock_out

  return (
    <div className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-base font-semibold text-[#1A1A1A] dark:text-white">
            Today's Attendance
          </h2>
          <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-0.5">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <CalendarDays size={18} className="text-[#AAAAAA] dark:text-[#555555]" />
      </div>

      {loadingRecord ? (
        <div className="space-y-3 animate-pulse">
          <div className="grid grid-cols-2 gap-3">
            <SkeletonBlock className="h-16" />
            <SkeletonBlock className="h-16" />
          </div>
          <SkeletonBlock className="h-11" />
        </div>
      ) : (
        <>
          {/* Clock In / Clock Out time boxes */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className={`p-4 rounded-xl border ${
              clockedIn
                ? 'bg-[#00D4A0]/10 border-[#00D4A0]/20'
                : 'bg-[#F5F5F0] dark:bg-[#0F0F0F] border-[#E8E8E8] dark:border-[#2A2A2A]'
            }`}>
              <p className="text-xs font-medium text-[#666666] dark:text-[#A0A0A0] mb-1">Clock In</p>
              <p className={`text-lg font-bold ${clockedIn ? 'text-[#00D4A0]' : 'text-[#AAAAAA] dark:text-[#555555]'}`}>
                {formatTime(attendance?.clock_in) ?? '--:--'}
              </p>
            </div>
            <div className={`p-4 rounded-xl border ${
              clockedOut
                ? 'bg-[#FF4D4D]/10 border-[#FF4D4D]/20'
                : 'bg-[#F5F5F0] dark:bg-[#0F0F0F] border-[#E8E8E8] dark:border-[#2A2A2A]'
            }`}>
              <p className="text-xs font-medium text-[#666666] dark:text-[#A0A0A0] mb-1">Clock Out</p>
              <p className={`text-lg font-bold ${clockedOut ? 'text-[#FF4D4D]' : 'text-[#AAAAAA] dark:text-[#555555]'}`}>
                {formatTime(attendance?.clock_out) ?? '--:--'}
              </p>
            </div>
          </div>

          {/* Duration */}
          {clockedIn && clockedOut && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl mb-4 bg-[#00D4A0]/10 border border-[#00D4A0]/20">
              <CheckCircle2 size={15} className="text-[#00D4A0]" />
              <span className="text-sm font-medium text-[#00D4A0]">
                Total: {calcDuration(attendance.clock_in, attendance.clock_out)}
              </span>
            </div>
          )}

          {/* The button goes to the Attendance page, where the clock-in flow
              lives — location, today's shift and the geofence are all handled
              there, and doing it in two places is what broke this card. */}
          {canClockInOut && !clockedIn && (
            <Link
              to="/attendance"
              className="w-full flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] transition-colors"
            >
              <Clock size={15} /> Clock In
            </Link>
          )}

          {canClockInOut && clockedIn && !clockedOut && (
            <Link
              to="/attendance"
              className="w-full flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-semibold text-white bg-[#FF4D4D] hover:bg-[#E04040] transition-colors"
            >
              <Timer size={15} /> Clock Out
            </Link>
          )}

          {clockedIn && clockedOut && (
            <div className="flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-semibold bg-[#00D4A0]/10 text-[#00D4A0]">
              <CheckCircle2 size={15} />
              Day complete
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Dashboard Body ───────────────────────────────────────────────────────────
export default function GenericDashboard({ employee }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

      {/* Left column */}
      <div className="lg:col-span-1 space-y-6">
        <AttendanceCard employee={employee} canClockInOut />

        {/* Profile card */}
        <div className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-14 h-14 rounded-full bg-[#00D4A0] flex items-center justify-center text-white text-xl font-bold shrink-0">
              {employee.full_name?.[0]?.toUpperCase()}
            </div>
            <div>
              <h2 className="text-base font-semibold text-[#1A1A1A] dark:text-white">
                {employee.full_name}
              </h2>
              <p className="text-sm text-[#666666] dark:text-[#A0A0A0]">
                {employee.job_title || 'No title set'}
              </p>
              {employee.status && (
                <span className={`inline-block mt-1.5 text-xs font-semibold px-3 py-1 rounded-full ${statusBadge[employee.status] ?? 'bg-[#E8E8E8] dark:bg-[#2A2A2A] text-[#666666] dark:text-[#A0A0A0]'}`}>
                  {employee.status.replace('_', ' ')}
                </span>
              )}
            </div>
          </div>
          <p className="text-xs text-[#AAAAAA] dark:text-[#555555]">{employee.email}</p>
        </div>

        <LatestNewsWidget />
      </div>

      {/* Right column — employment stats */}
      <div className="lg:col-span-2 space-y-4">
        <p className="text-xs font-semibold tracking-widest text-[#AAAAAA] dark:text-[#555555] uppercase">
          Employment Details
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <StatCard
            icon={Building2}
            label="Department"
            value={employee.departments?.name}
            accent
          />
          <StatCard
            icon={Briefcase}
            label="Classification"
            value={classificationLabel[employee.classification]}
          />
          <StatCard
            icon={CalendarDays}
            label="Hire Date"
            value={formatDate(employee.hire_date)}
          />
          <StatCard
            icon={CalendarDays}
            label="Probation Ends"
            value={formatDate(employee.probation_end_date)}
          />
          <StatCard
            icon={MapPin}
            label="Contract Type"
            value={employee.contract_type === 'indefinite' ? 'Indefinite' : 'Fixed Term'}
          />
          {employee.contract_type === 'fixed_term' && (
            <StatCard
              icon={CalendarDays}
              label="Contract End"
              value={formatDate(employee.contract_end_date)}
            />
          )}
        </div>
      </div>
    </div>
  )
}
