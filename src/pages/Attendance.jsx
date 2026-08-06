import { useEffect, useState, useCallback } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Timer,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  X,
  Save,
  Edit3,
  FileSpreadsheet,
  MapPin,
} from 'lucide-react'
import supabase from '../services/supabase'
import useAuthStore from '../store/authStore'
import { exportToExcel } from '../utils/exportHelpers'
import Sidebar from '../components/layout/Sidebar'
import Header from '../components/layout/Header'
import ToastComp, { useToast } from '../components/Toast'
import { SkeletonBlock } from '../components/Skeleton'

// ─── Constants ────────────────────────────────────────────────────────────────

const DAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// Every string used here is a literal so Tailwind picks them up at build time
const STATUS_META = {
  present:             { label: 'Present',                dot: 'bg-[#00D4A0]', badge: 'bg-[#00D4A0]/10 text-[#00D4A0]',  cell: 'bg-[#00D4A0]/10 dark:bg-[#00D4A0]/20' },
  late_minor:          { label: 'Late (≤30 min)',         dot: 'bg-[#FF8C42]', badge: 'bg-[#FF8C42]/10 text-[#FF8C42]',  cell: 'bg-[#FF8C42]/10 dark:bg-[#FF8C42]/15' },
  late_moderate:       { label: 'Late (≤60 min)',         dot: 'bg-[#FF8C42]', badge: 'bg-[#FF8C42]/15 text-[#FF8C42]',  cell: 'bg-[#FF8C42]/15 dark:bg-[#FF8C42]/20' },
  late_major:          { label: 'Late (>60 min)',         dot: 'bg-[#FF8C42]', badge: 'bg-[#FF8C42]/20 text-[#FF8C42]',  cell: 'bg-[#FF8C42]/20 dark:bg-[#FF8C42]/25' },
  absent_approved:     { label: 'Absent (Approved)',      dot: 'bg-[#4D9FFF]', badge: 'bg-[#4D9FFF]/10 text-[#4D9FFF]',  cell: 'bg-[#4D9FFF]/10 dark:bg-[#4D9FFF]/15' },
  absent_unauthorized: { label: 'Absent (Unauthorized)',  dot: 'bg-[#FF4D4D]', badge: 'bg-[#FF4D4D]/10 text-[#FF4D4D]',  cell: 'bg-[#FF4D4D]/10 dark:bg-[#FF4D4D]/15' },
}

const STATUS_OPTIONS = [
  { value: 'present',             label: 'Present' },
  { value: 'late_minor',          label: 'Late (≤30 min)' },
  { value: 'late_moderate',       label: 'Late (≤60 min)' },
  { value: 'late_major',          label: 'Late (>60 min)' },
  { value: 'absent_approved',     label: 'Absent (Approved)' },
  { value: 'absent_unauthorized', label: 'Absent (Unauthorized)' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Returns local YYYY-MM-DD — avoids UTC-shift bugs
function localDateStr(d) {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
}

function formatTime(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
}

function hoursWorked(clockIn, clockOut) {
  if (!clockIn || !clockOut) return 0
  return (new Date(clockOut) - new Date(clockIn)) / 3600000
}

// Wraps navigator.geolocation.getCurrentPosition in a Promise. Used by both
// clockIn()/clockOut() below — when shift_settings.require_gps_clock_in is
// on, a rejection here blocks the action entirely; when it's off, the
// caller catches the rejection and proceeds without coordinates.
function getGpsPosition(timeout = 10000) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by this browser.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos.coords),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout, maximumAge: 0 }
    )
  })
}

// Haversine, metres. Mirrors public.distance_metres() in the database. The
// trigger is the authority — it re-measures every punch and can reject it —
// but checking here first means the error names a distance the person can act
// on instead of a failed request.
function distanceMetres(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 6371000 * 2 * Math.asin(Math.sqrt(a))
}

// Nearest active work location to a fix. Null when the company hasn't defined
// any — no locations means no fence, in the browser and in the trigger alike.
function nearestLocation(coords, locations) {
  if (!coords || !locations?.length) return null
  let best = null
  for (const l of locations) {
    const d = distanceMetres(coords.latitude, coords.longitude, l.latitude, l.longitude)
    if (!best || d < best.distance) best = { location: l, distance: d, within: d <= l.radius_metres }
  }
  return best
}

// Late/present classification, shared by the shift-linked and fixed-time
// fallback paths in clockIn() below — only the expected start instant and
// grace period differ between the two.
function classifyClockIn(now, expectedStart, graceMinutes) {
  const diffMin = (now - expectedStart) / 60000
  if (diffMin <= graceMinutes) return 'present'
  const lateMin = diffMin - graceMinutes
  if (lateMin <= 30) return 'late_minor'
  if (lateMin <= 60) return 'late_moderate'
  return 'late_major'
}

function fmtShiftLabel(shift) {
  if (!shift) return null
  const time = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
  const name = shift.shift_templates?.name
  return `${name ? `${name} ` : ''}${time(shift.start_at)}–${time(shift.end_at)}`
}

function fmtHours(h) {
  if (h <= 0) return '0h'
  const hrs = Math.floor(h)
  const min = Math.round((h - hrs) * 60)
  return min === 0 ? `${hrs}h` : `${hrs}h ${min}m`
}

// Convert ISO → datetime-local input value (in local time)
function toInputDT(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16)
}

// Monday of the week containing `date`
function weekStart(date = new Date()) {
  const d = new Date(date)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  d.setHours(0, 0, 0, 0)
  return d
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const meta = STATUS_META[status]
  if (!meta) return null
  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${meta.badge}`}>
      {meta.label}
    </span>
  )
}

// ─── Today Card ───────────────────────────────────────────────────────────────

function TodayCard({ record, loading, isOwnRecord, actionLoading, error, onClockIn, onClockOut, clockInBlocked, clockInBlockedReason }) {
  const [elapsed, setElapsed] = useState('')

  useEffect(() => {
    if (!record?.clock_in || record?.clock_out) { setElapsed(''); return }
    const tick = () => {
      const ms = Date.now() - new Date(record.clock_in)
      const h  = Math.floor(ms / 3600000)
      const m  = Math.floor((ms % 3600000) / 60000)
      const s  = Math.floor((ms % 60000) / 1000)
      setElapsed(
        `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      )
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [record?.clock_in, record?.clock_out])

  const clockedIn  = !!record?.clock_in
  const clockedOut = !!record?.clock_out
  const dayLabel   = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <div className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h2 className="text-base font-semibold text-[#1A1A1A] dark:text-white">Today</h2>
          <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-0.5">{dayLabel}</p>
        </div>
        {record?.status && <StatusBadge status={record.status} />}
      </div>

      {loading ? (
        <div className="space-y-4 animate-pulse">
          <div className="grid grid-cols-2 gap-3">
            <SkeletonBlock className="h-20" />
            <SkeletonBlock className="h-20" />
          </div>
          <SkeletonBlock className="h-12" />
        </div>
      ) : (
        <>
          {/* Clock-in / clock-out boxes */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className={`p-4 rounded-xl border ${
              clockedIn
                ? 'bg-[#00D4A0]/10 border-[#00D4A0]/20'
                : 'bg-[#F5F5F0] dark:bg-[#0F0F0F] border-[#E8E8E8] dark:border-[#2A2A2A]'
            }`}>
              <p className="text-xs font-medium text-[#666666] dark:text-[#A0A0A0] mb-1">Clock In</p>
              <p className={`text-xl font-bold ${clockedIn ? 'text-[#00D4A0]' : 'text-[#AAAAAA] dark:text-[#555555]'}`}>
                {formatTime(record?.clock_in) ?? '--:--'}
              </p>
              {clockedIn && record?.shifts && (
                <p className="text-[11px] text-[#666666] dark:text-[#A0A0A0] mt-1 truncate">
                  Shift: {fmtShiftLabel(record.shifts)}
                </p>
              )}
            </div>
            <div className={`p-4 rounded-xl border ${
              clockedOut
                ? 'bg-[#FF4D4D]/10 border-[#FF4D4D]/20'
                : 'bg-[#F5F5F0] dark:bg-[#0F0F0F] border-[#E8E8E8] dark:border-[#2A2A2A]'
            }`}>
              <p className="text-xs font-medium text-[#666666] dark:text-[#A0A0A0] mb-1">Clock Out</p>
              <p className={`text-xl font-bold ${clockedOut ? 'text-[#FF4D4D]' : 'text-[#AAAAAA] dark:text-[#555555]'}`}>
                {formatTime(record?.clock_out) ?? '--:--'}
              </p>
            </div>
          </div>

          {/* Live elapsed */}
          {clockedIn && !clockedOut && elapsed && (
            <div className="flex items-center justify-between px-4 py-3 rounded-xl mb-4 bg-[#00D4A0]/10 border border-[#00D4A0]/20">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#00D4A0] animate-pulse" />
                <span className="text-xs font-medium text-[#00D4A0]">Live</span>
              </div>
              <span className="text-lg font-bold text-[#00D4A0] font-mono tracking-widest">{elapsed}</span>
            </div>
          )}

          {/* Total hours (when complete) */}
          {clockedIn && clockedOut && (
            <div className="flex items-center justify-between px-4 py-3 rounded-xl mb-4 bg-[#00D4A0]/10 border border-[#00D4A0]/20">
              <span className="text-xs font-medium text-[#00D4A0]">Total hours</span>
              <span className="text-base font-bold text-[#00D4A0]">
                {fmtHours(hoursWorked(record.clock_in, record.clock_out))}
              </span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl mb-4 text-sm text-[#FF4D4D] bg-[#FF4D4D]/10 border border-[#FF4D4D]/20">
              <AlertTriangle size={14} className="shrink-0" />
              {error}
            </div>
          )}

          {/* Clock-in gate notice (migration 39 — shift_settings.require_shift_to_clock_in) */}
          {isOwnRecord && !clockedIn && clockInBlocked && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl mb-4 text-sm text-[#FF8C42] bg-[#FF8C42]/10 border border-[#FF8C42]/20">
              <AlertTriangle size={14} className="shrink-0" />
              {clockInBlockedReason}
            </div>
          )}

          {/* Clock actions — own record only */}
          {isOwnRecord && (
            <>
              {!clockedIn && (
                <button
                  onClick={onClockIn}
                  disabled={actionLoading || clockInBlocked}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors"
                >
                  {actionLoading ? <Loader2 size={15} className="animate-spin" /> : <Clock size={15} />}
                  {actionLoading ? 'Clocking in…' : 'Clock In'}
                </button>
              )}
              {clockedIn && !clockedOut && (
                <button
                  onClick={onClockOut}
                  disabled={actionLoading}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-semibold text-white bg-[#FF4D4D] hover:bg-[#E04040] disabled:opacity-60 transition-colors"
                >
                  {actionLoading ? <Loader2 size={15} className="animate-spin" /> : <Timer size={15} />}
                  {actionLoading ? 'Clocking out…' : 'Clock Out'}
                </button>
              )}
              {clockedIn && clockedOut && (
                <div className="flex items-center justify-center gap-2 py-3 rounded-lg bg-[#00D4A0]/10 text-sm font-semibold text-[#00D4A0]">
                  <CheckCircle2 size={15} />
                  Day complete
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

// ─── Attendance exceptions ────────────────────────────────────────────────────
// Records that can't be trusted as they stand. Before this existed they were
// invisible: a clock-in with no clock-out just sat in the table, counted by
// calculate_attendance_score as a normal present day, and nobody had a screen
// that would show it. Read for anyone who may read the roster; the Fix link
// only appears for the roles that may actually correct a record.
function AttendanceExceptions({ rows, loading, canEdit, onFix }) {
  if (loading) return <SkeletonBlock className="h-32 mb-6" />
  if (!rows.length) {
    return (
      <div className="flex items-center gap-2.5 px-4 py-3.5 rounded-xl mb-6 bg-[#00D4A0]/10 border border-[#00D4A0]/20">
        <CheckCircle2 size={15} className="text-[#00D4A0] shrink-0" />
        <p className="text-sm text-[#1A1A1A] dark:text-white">
          No attendance exceptions this month — every record has a clock-in and a clock-out.
        </p>
      </div>
    )
  }

  return (
    <div className="mb-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#FF8C42]/30 overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-3.5 bg-[#FF8C42]/10 border-b border-[#FF8C42]/20">
        <AlertTriangle size={15} className="text-[#FF8C42] shrink-0" />
        <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white">
          {rows.length} attendance {rows.length === 1 ? 'exception' : 'exceptions'} this month
        </p>
      </div>
      <div className="divide-y divide-[#E8E8E8] dark:divide-[#2A2A2A] max-h-72 overflow-y-auto">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-3 px-5 py-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white truncate">
                {r.employees?.full_name ?? 'Unknown'}
              </p>
              <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-0.5">
                {new Date(r.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' })}
                {' · '}{r.problem}
              </p>
            </div>
            {canEdit && (
              <button
                type="button"
                onClick={() => onFix(r)}
                className="shrink-0 px-3 py-1.5 rounded-md text-xs font-semibold text-[#00D4A0] border border-[#00D4A0]/30 hover:bg-[#00D4A0]/10 transition-colors"
              >
                Fix
              </button>
            )}
          </div>
        ))}
      </div>
      {!canEdit && (
        <p className="px-5 py-3 text-xs text-[#666666] dark:text-[#A0A0A0] border-t border-[#E8E8E8] dark:border-[#2A2A2A]">
          Your role can see these but not correct them — send them to HR.
        </p>
      )}
    </div>
  )
}

// ─── Early-checkout confirmation ──────────────────────────────────────────────
// Clocking out before the scheduled end is allowed — people leave early for
// good reasons — but it is never silent. The shortfall lands in
// attendance.early_minutes either way; the reason typed here is what makes it
// legible to whoever reads the record later.
function EarlyCheckoutModal({ prompt, saving, onCancel, onConfirm }) {
  const [reason, setReason] = useState('')
  if (!prompt) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <div
        className="w-full max-w-md bg-white dark:bg-[#1E1E1E] rounded-2xl border border-[#E8E8E8] dark:border-[#2A2A2A] shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-xl bg-[#FF8C42]/10 flex items-center justify-center shrink-0">
            <AlertTriangle size={16} className="text-[#FF8C42]" />
          </div>
          <h2 className="text-base font-bold text-[#1A1A1A] dark:text-white">
            Leaving {prompt.label} early
          </h2>
        </div>

        <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mb-4">
          {prompt.fromShift ? 'Your shift' : 'Your working day'} ends at {prompt.endLabel}. Clocking out now
          records the day as {prompt.label} short of the scheduled end.
        </p>

        <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1.5">
          Reason <span className="font-normal text-[#AAAAAA] dark:text-[#555555]">(optional)</span>
        </label>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={300}
          placeholder="e.g. medical appointment"
          className="w-full px-3.5 py-2.5 text-sm rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0] transition-colors"
        />

        <div className="flex gap-3 mt-5">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold text-[#1A1A1A] dark:text-white border border-[#E8E8E8] dark:border-[#2A2A2A] hover:border-[#00D4A0]/40 disabled:opacity-60 transition-colors"
          >
            Stay clocked in
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason)}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#FF8C42] hover:bg-[#E87A34] disabled:opacity-60 transition-colors"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            Clock out anyway
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Weekly Summary ───────────────────────────────────────────────────────────

function WeeklySummary({ records }) {
  const mon = weekStart()
  const sun = new Date(mon)
  sun.setDate(mon.getDate() + 6)
  sun.setHours(23, 59, 59, 999)

  const weekRecs = records.filter(r => {
    const d = new Date(r.date + 'T00:00:00')
    return d >= mon && d <= sun
  })

  const daysPresent  = weekRecs.filter(r => r.status && !r.status.startsWith('absent')).length
  const totalHours   = weekRecs.reduce((s, r) => s + hoursWorked(r.clock_in, r.clock_out), 0)
  const otHours      = weekRecs.reduce((s, r) => s + (r.overtime_hours ?? 0), 0)

  const monLabel = mon.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const sunLabel = sun.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  const todayStr = localDateStr(new Date())

  return (
    <div className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-base font-semibold text-[#1A1A1A] dark:text-white">This Week</h2>
        <span className="text-xs text-[#666666] dark:text-[#A0A0A0]">{monLabel} – {sunLabel}</span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { value: daysPresent,         label: 'Days Present' },
          { value: fmtHours(totalHours), label: 'Hours Worked' },
          { value: otHours > 0 ? fmtHours(otHours) : '0h', label: 'OT Hours' },
        ].map(({ value, label }) => (
          <div
            key={label}
            className="flex flex-col items-center p-4 rounded-xl bg-[#F5F5F0] dark:bg-[#0F0F0F] border border-[#E8E8E8] dark:border-[#2A2A2A]"
          >
            <p className="text-2xl font-bold text-[#1A1A1A] dark:text-white">{value}</p>
            <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-1 text-center">{label}</p>
          </div>
        ))}
      </div>

      {/* Day-by-day bar */}
      <div className="flex gap-1.5">
        {DAYS_SHORT.map((day, i) => {
          const d = new Date(mon)
          d.setDate(mon.getDate() + i)
          const ds   = localDateStr(d)
          const rec  = weekRecs.find(r => r.date === ds)
          const meta = rec?.status ? STATUS_META[rec.status] : null
          const isToday   = ds === todayStr
          const isFuture  = d > new Date()
          const isWeekend = i >= 5

          return (
            <div
              key={day}
              className={`flex-1 flex flex-col items-center gap-1.5 py-2.5 rounded-lg ${
                isToday
                  ? 'bg-[#00D4A0]/10 border border-[#00D4A0]/30'
                  : 'bg-[#F5F5F0] dark:bg-[#252525]'
              } ${isWeekend || isFuture ? 'opacity-50' : ''}`}
            >
              <p className={`text-[10px] font-semibold ${isToday ? 'text-[#00D4A0]' : 'text-[#666666] dark:text-[#A0A0A0]'}`}>
                {day}
              </p>
              <div className={`w-2 h-2 rounded-full ${meta ? meta.dot : 'bg-[#E8E8E8] dark:bg-[#2A2A2A]'}`} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Monthly Calendar ─────────────────────────────────────────────────────────

function CalendarGrid({ records, viewDate, loading, canEdit, onDayClick }) {
  const year  = viewDate.getFullYear()
  const month = viewDate.getMonth()

  const firstDay  = new Date(year, month, 1)
  const lastDayNum = new Date(year, month + 1, 0).getDate()
  const todayStr  = localDateStr(new Date())

  // Mon-first offset (0=Mon … 6=Sun)
  const startOffset = (firstDay.getDay() + 6) % 7

  // Build 6×7 grid (42 cells)
  const cells = Array.from({ length: 42 }, (_, i) => {
    const dayNum = i - startOffset + 1
    if (dayNum < 1 || dayNum > lastDayNum) return null
    const d       = new Date(year, month, dayNum)
    const dateStr = localDateStr(d)
    const isWeekend = d.getDay() === 0 || d.getDay() === 6
    const isToday   = dateStr === todayStr
    const isPast    = d <= new Date() || isToday
    const record    = records.find(r => r.date === dateStr) ?? null
    return { dayNum, dateStr, isWeekend, isToday, isPast, record }
  })

  return (
    <div className="rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] p-6">
      {/* Day headers */}
      <div className="grid grid-cols-7 mb-1">
        {DAYS_SHORT.map((d) => (
          <div key={d} className="text-center py-2 text-xs font-semibold text-[#666666] dark:text-[#A0A0A0]">
            {d}
          </div>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-7 gap-1 animate-pulse">
          {Array.from({ length: 35 }, (_, i) => (
            <div key={i} className="rounded-xl bg-[#F5F5F0] dark:bg-[#252525] min-h-14" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-1">
          {cells.map((cell, i) => {
            if (!cell) return <div key={`empty-${i}`} />

            const { dayNum, dateStr, isWeekend, isToday, isPast, record } = cell
            const meta = record?.status ? STATUS_META[record.status] : null
            const clickable = canEdit && isPast

            return (
              <div
                key={dateStr}
                onClick={() => clickable && onDayClick(cell)}
                className={[
                  'relative flex flex-col items-center justify-center rounded-xl min-h-[56px] py-2 select-none',
                  meta ? meta.cell : '',
                  isToday ? 'ring-2 ring-[#00D4A0] ring-offset-1 ring-offset-white dark:ring-offset-[#1E1E1E]' : '',
                  !meta && !isToday && isPast && !isWeekend ? 'bg-[#F5F5F0] dark:bg-[#252525]' : '',
                  !isPast ? 'opacity-30' : '',
                  isWeekend && !meta ? 'opacity-40' : '',
                  clickable ? 'cursor-pointer hover:opacity-80 transition-opacity' : '',
                ].filter(Boolean).join(' ')}
              >
                <span className={`text-sm font-semibold ${
                  isToday
                    ? 'text-[#00D4A0]'
                    : meta
                    ? 'text-[#1A1A1A] dark:text-white'
                    : 'text-[#666666] dark:text-[#A0A0A0]'
                }`}>
                  {dayNum}
                </span>

                {meta ? (
                  <div className={`w-1.5 h-1.5 rounded-full mt-1 ${meta.dot}`} />
                ) : isPast && !isWeekend ? (
                  <div className="w-1.5 h-1.5 rounded-full mt-1 bg-[#E8E8E8] dark:bg-[#333333]" />
                ) : null}

                {/* Edit icon hint on hover for canEdit */}
                {clickable && (
                  <Edit3
                    size={9}
                    className="absolute top-1.5 right-1.5 text-[#AAAAAA] dark:text-[#555555] opacity-0 group-hover:opacity-100"
                  />
                )}

                {/* GPS indicator — present whenever the clock-in captured coordinates */}
                {record?.clock_in_lat != null && (
                  <span
                    title={`Clocked in near ${Number(record.clock_in_lat).toFixed(5)}, ${Number(record.clock_in_lng).toFixed(5)}`}
                    className="absolute bottom-1 right-1 text-[#4D9FFF]"
                  >
                    <MapPin size={9} />
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-2 mt-5 pt-4 border-t border-[#E8E8E8] dark:border-[#2A2A2A]">
        {Object.entries(STATUS_META).map(([key, meta]) => (
          <div key={key} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-full ${meta.dot}`} />
            <span className="text-xs text-[#666666] dark:text-[#A0A0A0]">{meta.label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-[#E8E8E8] dark:bg-[#333333]" />
          <span className="text-xs text-[#666666] dark:text-[#A0A0A0]">No record</span>
        </div>
      </div>
    </div>
  )
}

// ─── Admin Override Modal ─────────────────────────────────────────────────────

function EditModal({ cell, onClose, onSave, saving }) {
  const { record, dateStr } = cell

  const [form, setForm] = useState({
    status:         record?.status         ?? 'present',
    clock_in:       toInputDT(record?.clock_in),
    clock_out:      toInputDT(record?.clock_out),
    overtime_hours: record?.overtime_hours?.toString() ?? '',
    notes:          record?.notes          ?? '',
  })
  const [err, setErr] = useState('')

  function set(field, val) {
    setForm(prev => ({ ...prev, [field]: val }))
    setErr('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setErr('')
    if (form.clock_in && form.clock_out) {
      if (new Date(form.clock_out) <= new Date(form.clock_in)) {
        setErr('Clock-out must be after clock-in.')
        return
      }
    }
    await onSave(dateStr, form, record?.id)
  }

  const dateLabel = new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })

  const inputCls =
    'w-full px-3.5 py-2.5 text-sm rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0] transition-colors'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white dark:bg-[#1E1E1E] rounded-xl border border-[#E8E8E8] dark:border-[#2A2A2A] shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
          <div>
            <h2 className="text-base font-semibold text-[#1A1A1A] dark:text-white">
              {record ? 'Edit Record' : 'Add Record'}
            </h2>
            <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-0.5">{dateLabel}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-[#666666] dark:text-[#A0A0A0] hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Status */}
          <div>
            <label className="text-sm font-medium text-[#1A1A1A] dark:text-white block mb-1.5">
              Status
            </label>
            <select
              value={form.status}
              onChange={e => set('status', e.target.value)}
              className={inputCls}
            >
              {STATUS_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Clock In / Clock Out */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-[#1A1A1A] dark:text-white block mb-1.5">
                Clock In
              </label>
              <input
                type="datetime-local"
                value={form.clock_in}
                onChange={e => set('clock_in', e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-[#1A1A1A] dark:text-white block mb-1.5">
                Clock Out
              </label>
              <input
                type="datetime-local"
                value={form.clock_out}
                onChange={e => set('clock_out', e.target.value)}
                className={inputCls}
              />
            </div>
          </div>

          {/* OT hours */}
          <div>
            <label className="text-sm font-medium text-[#1A1A1A] dark:text-white block mb-1.5">
              Overtime Hours
            </label>
            <input
              type="number"
              min="0"
              step="0.5"
              placeholder="0"
              value={form.overtime_hours}
              onChange={e => set('overtime_hours', e.target.value)}
              className={inputCls}
            />
          </div>

          {/* Notes */}
          <div>
            <label className="text-sm font-medium text-[#1A1A1A] dark:text-white block mb-1.5">
              Notes
            </label>
            <textarea
              rows={3}
              placeholder="Add a note…"
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              className={`${inputCls} resize-none`}
            />
          </div>

          {/* Validation error */}
          {err && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-[#FF4D4D]/10 border border-[#FF4D4D]/20 text-sm text-[#FF4D4D]">
              <AlertTriangle size={13} className="shrink-0" />
              {err}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold text-[#666666] dark:text-[#A0A0A0] border border-[#E8E8E8] dark:border-[#2A2A2A] hover:text-[#1A1A1A] dark:hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Attendance() {
  const employee  = useAuthStore(s => s.employee)
  const role      = useAuthStore(s => s.role)
  const companyId = useAuthStore(s => s.companyId)

  // Two different questions, previously answered by one flag.
  //
  // canAdmin is the *write* capability: correcting someone else's record.
  // §4.3 keeps that with HR — "the person who builds the schedule should
  // never also be able to falsify the clock-in it produces".
  //
  // canViewRoster is the *read* capability: looking up anyone's history and
  // exporting it. att_select / attendance_admin_select already grant that to
  // admin, department_manager and read_only in the database; the page just
  // never offered it, so operations could see today and nothing else.
  const canAdmin = role === 'super_admin' || role === 'hr_manager'
  const canViewRoster =
    canAdmin || role === 'admin' || role === 'department_manager' || role === 'read_only'

  // Which month is the calendar showing
  const now = new Date()
  const [viewDate, setViewDate] = useState(new Date(now.getFullYear(), now.getMonth(), 1))

  // Which employee are we viewing
  const [selectedEmpId, setSelectedEmpId] = useState(null)
  const [employees,     setEmployees]      = useState([])

  // Data
  const [monthRecords, setMonthRecords] = useState([])   // for the calendar
  const [todayRecord,  setTodayRecord]  = useState(null) // always today
  const [weekRecords,  setWeekRecords]  = useState([])   // always current week

  const [monthLoading,   setMonthLoading]   = useState(true)
  const [todayLoading,   setTodayLoading]   = useState(true)
  const [actionLoading,  setActionLoading]  = useState(false)
  const [clockError,     setClockError]     = useState('')
  // Non-null while the early-checkout confirmation is on screen.
  const [earlyPrompt,    setEarlyPrompt]    = useState(null)
  const [exceptions,     setExceptions]     = useState([])
  const [exceptionsLoading, setExceptionsLoading] = useState(true)

  const [editCell,    setEditCell]    = useState(null)
  const [modalSaving, setModalSaving] = useState(false)

  const [exportingAtt, setExportingAtt] = useState(false)
  const { toast, showToast } = useToast()

  // Late-classification inputs. Shift-linked clock-ins use
  // shift_settings.late_grace_minutes (new, per the shift-scheduling
  // migration); the fixed-time fallback (no shift for today) keeps using
  // kpi_settings.late_grace_minutes, the grace period that already existed
  // before shifts did — see the handover for why these two aren't unified.
  const [shiftLateGrace, setShiftLateGrace] = useState(15)
  const [kpiLateGrace,   setKpiLateGrace]   = useState(15)
  const [companyWorkStart, setCompanyWorkStart] = useState('08:00:00')
  const [requireShiftToClockIn, setRequireShiftToClockIn] = useState(false)
  // shift_settings.require_gps_clock_in (migration 42, default true). When
  // on, a denied/unavailable GPS lookup blocks clock-in/out outright; when
  // off, the app still attempts GPS (for the map-pin display below) but
  // proceeds without it on failure.
  const [requireGpsClockIn, setRequireGpsClockIn] = useState(true)
  // Geofence (work_locations + shift_settings.enforce_geofence). With no
  // locations defined the fence is inert everywhere, which is the default.
  const [workLocations, setWorkLocations] = useState([])
  const [enforceGeofence, setEnforceGeofence] = useState(false)
  const [earlyGrace, setEarlyGrace] = useState(5)
  const [companyWorkEnd, setCompanyWorkEnd] = useState('17:00:00')

  useEffect(() => {
    if (!companyId) return
    Promise.all([
      supabase.from('shift_settings').select('late_grace_minutes, require_shift_to_clock_in, require_gps_clock_in, enforce_geofence, early_checkout_grace_minutes').eq('company_id', companyId).maybeSingle(),
      supabase.from('kpi_settings').select('late_grace_minutes').eq('company_id', companyId).maybeSingle(),
      supabase.from('company').select('work_start_time, work_end_time').eq('id', companyId).maybeSingle(),
      supabase.from('work_locations').select('id, name, latitude, longitude, radius_metres').eq('company_id', companyId).eq('active', true),
    ]).then(([shiftRes, kpiRes, companyRes, locRes]) => {
      if (shiftRes.data) {
        setShiftLateGrace(shiftRes.data.late_grace_minutes)
        setRequireShiftToClockIn(!!shiftRes.data.require_shift_to_clock_in)
        setRequireGpsClockIn(!!shiftRes.data.require_gps_clock_in)
        setEnforceGeofence(!!shiftRes.data.enforce_geofence)
        setEarlyGrace(shiftRes.data.early_checkout_grace_minutes ?? 5)
      }
      if (kpiRes.data) setKpiLateGrace(kpiRes.data.late_grace_minutes)
      if (companyRes.data?.work_start_time) setCompanyWorkStart(companyRes.data.work_start_time)
      if (companyRes.data?.work_end_time) setCompanyWorkEnd(companyRes.data.work_end_time)
      setWorkLocations(locRes.data ?? [])
    })
  }, [companyId])

  const todayStr = localDateStr(now)

  // Clock-in gate (migration 39) — only meaningful when
  // shift_settings.require_shift_to_clock_in is on; otherwise clock-in stays
  // always allowed (existing fallback classification unchanged). Own record
  // only — HR/admin overriding someone else's attendance via the modal below
  // isn't affected by this gate.
  const [todayShiftRows, setTodayShiftRows] = useState([])
  const [gateLoading, setGateLoading] = useState(true)

  const fetchTodayShiftGate = useCallback(async (empId) => {
    if (!empId) { setGateLoading(false); return }
    setGateLoading(true)
    const { data } = await supabase
      .from('shifts')
      .select('id, shift_type, status')
      .eq('employee_id', empId)
      .eq('shift_date', todayStr)
      .neq('status', 'cancelled')
    setTodayShiftRows(data ?? [])
    setGateLoading(false)
  }, [todayStr])

  useEffect(() => {
    if (employee?.id) fetchTodayShiftGate(employee.id)
  }, [employee?.id, fetchTodayShiftGate])

  const offToday = todayShiftRows.some((s) => s.shift_type === 'off')
  const publishedWorkToday = todayShiftRows.some((s) => s.shift_type === 'work' && s.status === 'published')
  const clockInBlocked = requireShiftToClockIn && !publishedWorkToday
  const clockInBlockedReason = offToday
    ? 'Today is your scheduled day off.'
    : 'No scheduled shift today — contact your manager.'

  // Seed selected employee from authStore
  useEffect(() => {
    if (employee?.id) setSelectedEmpId(employee.id)
  }, [employee?.id])

  // Load employee list for HR dropdown
  useEffect(() => {
    if (!canViewRoster) return
    supabase
      .from('employees')
      .select('id, full_name')
      .order('full_name')
      .then(({ data }) => setEmployees(data ?? []))
  }, [canViewRoster])

  // Company-wide exceptions for the viewed month. A row is an exception when
  // it cannot be read as a finished day: a clock-in on a past date that was
  // never closed, or a record with no clock-in at all but a status that
  // calculate_attendance_score will happily average in.
  // Bumped after a correction lands, to re-run the query below.
  const [exceptionsKey, setExceptionsKey] = useState(0)
  const reloadExceptions = () => setExceptionsKey((k) => k + 1)

  useEffect(() => {
    // The panel isn't rendered for roles that can't read the roster, so the
    // loading flag it would set is never observed.
    if (!canViewRoster) return undefined
    let cancelled = false
    async function load() {
      const yr = viewDate.getFullYear()
      const mo = viewDate.getMonth()
      const { data, error } = await supabase
        .from('attendance')
        .select('id, date, clock_in, clock_out, status, employee_id, employees!attendance_employee_id_fkey(full_name)')
        .gte('date', localDateStr(new Date(yr, mo, 1)))
        .lte('date', localDateStr(new Date(yr, mo + 1, 0)))
        .order('date', { ascending: false })
      if (cancelled) return

      if (error) {
        console.error('[Attendance] exceptions query failed', error)
        setExceptions([])
        setExceptionsLoading(false)
        return
      }

      const today = localDateStr(new Date())
      setExceptions(
        (data ?? []).flatMap((r) => {
          if (!r.clock_in) return [{ ...r, problem: 'No clock-in recorded, but the day has a status' }]
          // Today's open record is just someone still at work.
          if (!r.clock_out && r.date < today) return [{ ...r, problem: 'Clocked in but never clocked out' }]
          return []
        })
      )
      setExceptionsLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [viewDate, canViewRoster, exceptionsKey])

  // Fetch month records when calendar month or employee changes
  const fetchMonth = useCallback(async (empId, vd) => {
    if (!empId) return
    setMonthLoading(true)
    const yr  = vd.getFullYear()
    const mo  = vd.getMonth()
    const { data } = await supabase
      .from('attendance')
      .select('*')
      .eq('employee_id', empId)
      .gte('date', localDateStr(new Date(yr, mo, 1)))
      .lte('date', localDateStr(new Date(yr, mo + 1, 0)))
    setMonthRecords(data ?? [])
    setMonthLoading(false)
  }, [])

  // Fetch today + current week records (independent of calendar month)
  const fetchTodayAndWeek = useCallback(async (empId) => {
    if (!empId) return
    setTodayLoading(true)
    const mon = weekStart()
    const sun = new Date(mon)
    sun.setDate(mon.getDate() + 6)
    const { data } = await supabase
      .from('attendance')
      .select('*, shifts(start_at, end_at, shift_templates(name))')
      .eq('employee_id', empId)
      .gte('date', localDateStr(mon))
      .lte('date', localDateStr(sun))
    const all = data ?? []
    setWeekRecords(all)
    setTodayRecord(all.find(r => r.date === todayStr) ?? null)
    setTodayLoading(false)
  }, [todayStr])

  useEffect(() => {
    if (selectedEmpId) fetchMonth(selectedEmpId, viewDate)
  }, [selectedEmpId, viewDate, fetchMonth])

  useEffect(() => {
    if (selectedEmpId) fetchTodayAndWeek(selectedEmpId)
  }, [selectedEmpId, fetchTodayAndWeek])

  // ── Clock actions ──────────────────────────────────────────────────────────
  const isCurrentMonth =
    viewDate.getMonth() === now.getMonth() && viewDate.getFullYear() === now.getFullYear()

  async function clockIn() {
    if (role === 'read_only') return
    if (clockInBlocked) { setClockError(clockInBlockedReason); return }
    setActionLoading(true)
    setClockError('')

    // GPS FIRST, per the task's explicit ordering. Required: a denied/failed
    // lookup blocks clock-in outright. Optional (default off): still
    // attempted so the map-pin display below has something to show, but a
    // failure here never blocks the clock-in itself.
    let lat = null, lng = null
    try {
      const coords = await getGpsPosition()
      lat = coords.latitude
      lng = coords.longitude
    } catch (err) {
      console.error('[Attendance] clockIn geolocation failed', err)
      // Enforcing the fence makes a fix mandatory whatever require_gps says —
      // otherwise "block location" would be the way around the fence.
      if (requireGpsClockIn || (enforceGeofence && workLocations.length)) {
        setClockError('Location access is required to clock in. Please enable location permissions for this site and try again.')
        setActionLoading(false)
        return
      }
    }

    if (enforceGeofence) {
      const near = nearestLocation(lat != null ? { latitude: lat, longitude: lng } : null, workLocations)
      if (near && !near.within) {
        setClockError(`You're ${Math.round(near.distance)}m from ${near.location.name}. Clock-in is only accepted within ${near.location.radius_metres}m.`)
        setActionLoading(false)
        return
      }
    }

    // Look up today's linked shift the same way the DB's aa_autolink_shift
    // trigger will (same-day, work, published/completed, earliest start) —
    // the trigger sets attendance.shift_id after this insert lands, so this
    // is read-only lookahead purely to classify the status value we send.
    // shift_type='work' matters here since migration 39 — an OFF entry can
    // also be 'published', and must never be mistaken for a work baseline.
    const { data: todayShift } = await supabase
      .from('shifts')
      .select('id, start_at')
      .eq('employee_id', employee.id)
      .eq('shift_date', todayStr)
      .eq('shift_type', 'work')
      .in('status', ['published', 'completed'])
      .order('start_at')
      .limit(1)
      .maybeSingle()

    const clockInAt = new Date()
    let expectedStart, graceMinutes
    if (todayShift) {
      expectedStart = new Date(todayShift.start_at)
      graceMinutes  = shiftLateGrace
    } else {
      const [h, m] = companyWorkStart.split(':').map(Number)
      expectedStart = new Date(clockInAt.getFullYear(), clockInAt.getMonth(), clockInAt.getDate(), h, m, 0, 0)
      graceMinutes  = kpiLateGrace
    }
    const status = classifyClockIn(clockInAt, expectedStart, graceMinutes)

    const { error } = await supabase.from('attendance').insert({
      company_id:  companyId,
      employee_id: employee.id,
      date:        todayStr,
      clock_in:    clockInAt.toISOString(),
      status,
      clock_in_lat: lat,
      clock_in_lng: lng,
    })
    if (error) {
      console.error('[Attendance] clockIn failed', error)
      // The attendance_guard trigger raises geofence refusals as P0001 with
      // text already written for the person reading it.
      setClockError(
        error.message?.startsWith('Clock-in blocked:')
          ? error.message
          : 'Something went wrong clocking in. Please try again.'
      )
    } else {
      await fetchTodayAndWeek(employee.id)
      if (isCurrentMonth) await fetchMonth(employee.id, viewDate)
    }
    setActionLoading(false)
  }

  // When is today supposed to finish? The linked shift's end_at when there is
  // one, otherwise the company's fixed hours read in the browser's timezone —
  // the same instant the DB derives from company.timezone.
  function scheduledEndToday() {
    const linked = todayRecord?.shifts?.end_at
    if (linked) return new Date(linked)
    const [h, m] = String(companyWorkEnd).split(':').map(Number)
    if (Number.isNaN(h)) return null
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m || 0, 0, 0)
  }

  // Pressing Clock Out never writes straight away: if the day isn't over yet
  // the employee is told how short they are and has to confirm.
  function requestClockOut() {
    if (role === 'read_only' || !todayRecord) return
    setClockError('')
    const end = scheduledEndToday()
    if (end) {
      const minutes = Math.ceil((end - new Date()) / 60000)
      if (minutes > earlyGrace) {
        const h = Math.floor(minutes / 60)
        setEarlyPrompt({
          minutes,
          label: h > 0 ? `${h}h ${minutes % 60}m` : `${minutes}m`,
          endLabel: end.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
          fromShift: !!todayRecord?.shifts?.end_at,
        })
        return
      }
    }
    clockOut(null)
  }

  async function clockOut(earlyReason) {
    if (role === 'read_only') return
    if (!todayRecord) return
    setActionLoading(true)
    setClockError('')

    // GPS FIRST — same required/optional split as clockIn() above.
    let lat = null, lng = null
    try {
      const coords = await getGpsPosition()
      lat = coords.latitude
      lng = coords.longitude
    } catch (err) {
      console.error('[Attendance] clockOut geolocation failed', err)
      if (requireGpsClockIn || (enforceGeofence && workLocations.length)) {
        setClockError('Location access is required to clock out. Please enable location permissions for this site and try again.')
        setActionLoading(false)
        setEarlyPrompt(null)
        return
      }
    }

    if (enforceGeofence) {
      const near = nearestLocation(lat != null ? { latitude: lat, longitude: lng } : null, workLocations)
      if (near && !near.within) {
        setClockError(`You're ${Math.round(near.distance)}m from ${near.location.name}. Clock-out is only accepted within ${near.location.radius_metres}m.`)
        setActionLoading(false)
        setEarlyPrompt(null)
        return
      }
    }

    const { error } = await supabase
      .from('attendance')
      .update({
        clock_out: new Date().toISOString(),
        clock_out_lat: lat,
        clock_out_lng: lng,
        early_reason: earlyReason?.trim() || null,
      })
      .eq('id', todayRecord.id)
    if (error) {
      console.error('[Attendance] clockOut failed', error)
      setClockError(
        error.message?.startsWith('Clock-out blocked:')
          ? error.message
          : 'Something went wrong clocking out. Please try again.'
      )
    } else {
      await fetchTodayAndWeek(employee.id)
      if (isCurrentMonth) await fetchMonth(employee.id, viewDate)
    }
    setEarlyPrompt(null)
    setActionLoading(false)
  }

  // ── Admin override save ───────────────────────────────────────────────────
  async function saveOverride(dateStr, form, existingId) {
    setModalSaving(true)
    const payload = {
      employee_id:    selectedEmpId,
      date:           dateStr,
      status:         form.status,
      clock_in:       form.clock_in  ? new Date(form.clock_in).toISOString()  : null,
      clock_out:      form.clock_out ? new Date(form.clock_out).toISOString() : null,
      overtime_hours: form.overtime_hours !== '' ? parseFloat(form.overtime_hours) : null,
      notes:          form.notes || null,
    }

    const { error } = existingId
      ? await supabase.from('attendance').update(payload).eq('id', existingId)
      : await supabase.from('attendance').insert({ ...payload, company_id: companyId })

    if (error) {
      console.error('[Attendance] saveOverride failed', error)
      showToast('error', 'Something went wrong saving this record. Please try again.')
    } else {
      await Promise.all([
        fetchMonth(selectedEmpId, viewDate),
        fetchTodayAndWeek(selectedEmpId),
      ])
      reloadExceptions()
      setEditCell(null)
      showToast('success', 'Attendance record saved')
    }
    setModalSaving(false)
  }

  // saveOverride writes employee_id: selectedEmpId, so fixing an exception
  // belonging to someone else has to move the page to that person first —
  // otherwise the correction would reassign their day to whoever happened to
  // be selected in the dropdown.
  function fixException(row) {
    setSelectedEmpId(row.employee_id)
    setViewDate(new Date(row.date + 'T00:00:00'))
    setEditCell({ dateStr: row.date, record: row })
  }

  // ── Export (admin only) — all employees' attendance for the viewed month ──
  async function handleExportAttendance() {
    setExportingAtt(true)
    const yr = viewDate.getFullYear()
    const mo = viewDate.getMonth()
    const { data, error } = await supabase
      .from('attendance')
      .select('date, clock_in, clock_out, status, overtime_hours, employees(full_name)')
      .gte('date', localDateStr(new Date(yr, mo, 1)))
      .lte('date', localDateStr(new Date(yr, mo + 1, 0)))
      .order('date')
    setExportingAtt(false)

    if (error) {
      console.error('[Attendance] handleExportAttendance failed', error)
      showToast('error', 'Something went wrong exporting attendance. Please try again.')
      return
    }

    const rows = (data ?? []).map(r => ({
      Employee:          r.employees?.full_name || '—',
      Date:              r.date,
      'Clock In':        formatTime(r.clock_in) || '—',
      'Clock Out':       formatTime(r.clock_out) || '—',
      Status:            STATUS_META[r.status]?.label ?? r.status ?? '—',
      'Overtime Hours':  Number(r.overtime_hours ?? 0),
    }))

    const monthName = viewDate.toLocaleDateString('en-US', { month: 'long' })
    const ok = exportToExcel(rows, `attendance-${monthName}-${yr}.xlsx`, 'Attendance', showToast)
    if (ok) showToast('success', 'Attendance exported to Excel')
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const isOwnRecord      = selectedEmpId === employee?.id
  // Migration 46 (make_read_only_role_truly_read_only) — read_only can still
  // view attendance but must not clock in/out. att_insert/att_update RLS
  // wasn't tightened for this specific case, so this is a frontend-only
  // gate — hide the controls rather than let a click round-trip into a
  // confusing failure.
  const canClockInOut    = isOwnRecord && role !== 'read_only'
  const selectedEmpName  = employees.find(e => e.id === selectedEmpId)?.full_name ?? ''
  const monthLabel       = viewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  // WeeklySummary needs week records combined with month records so we pass monthRecords
  // and derive the week inside the component — but today/week fetch already handles current week.
  // Pass weekRecords to WeeklySummary so it's always accurate.

  return (
    <div className="flex min-h-screen bg-[#F5F5F0] dark:bg-[#0F0F0F]">
      <Sidebar />

      <div className="flex-1 flex flex-col lg:ml-60">
        <Header />

        <main className="flex-1 p-4 sm:p-6 lg:p-8">

          {/* No employee record linked */}
          {!employee ? (
            <div className="flex items-start gap-3 p-5 rounded-xl bg-[#FF8C42]/10 border border-[#FF8C42]/20 max-w-lg">
              <AlertTriangle size={18} className="text-[#FF8C42] shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-[#FF8C42]">Account not linked</p>
                <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1">
                  Your login is not linked to an employee record. Contact HR to complete setup.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* ── Page header ────────────────────────────────────────────── */}
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-8">
                <div>
                  <h1 className="text-2xl font-bold text-[#1A1A1A] dark:text-white">Attendance</h1>
                  <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1">
                    {isOwnRecord
                      ? 'Your attendance record'
                      : selectedEmpName
                      ? `Viewing: ${selectedEmpName}`
                      : 'Select an employee'}
                  </p>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  {/* HR/Admin employee dropdown */}
                  {canViewRoster && employees.length > 0 && (
                    <select
                      value={selectedEmpId ?? ''}
                      onChange={e => setSelectedEmpId(e.target.value)}
                      className="px-3.5 py-2.5 text-sm rounded-lg bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0] transition-colors"
                    >
                      {employees.map(e => (
                        <option key={e.id} value={e.id}>{e.full_name}</option>
                      ))}
                    </select>
                  )}

                  {/* Month navigator */}
                  <div className="flex items-center gap-0.5 bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] rounded-lg px-1">
                    <button
                      onClick={() => setViewDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
                      className="w-8 h-9 flex items-center justify-center text-[#666666] dark:text-[#A0A0A0] hover:text-[#1A1A1A] dark:hover:text-white transition-colors"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <span className="text-sm font-semibold text-[#1A1A1A] dark:text-white px-2 min-w-[132px] text-center">
                      {monthLabel}
                    </span>
                    <button
                      onClick={() => setViewDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
                      className="w-8 h-9 flex items-center justify-center text-[#666666] dark:text-[#A0A0A0] hover:text-[#1A1A1A] dark:hover:text-white transition-colors"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>

                  {/* Export — anyone who may read the roster's attendance */}
                  {canViewRoster && (
                    <button
                      onClick={handleExportAttendance}
                      disabled={exportingAtt}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white text-sm font-semibold hover:border-[#00D4A0]/40 disabled:opacity-50 transition-colors"
                    >
                      {exportingAtt
                        ? <Loader2 size={15} className="animate-spin text-[#00D4A0]" />
                        : <FileSpreadsheet size={15} className="text-[#00D4A0]" />}
                      Export
                    </button>
                  )}
                </div>
              </div>

              {/* ── Top row: Today + Weekly Summary ───────────────────────── */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                <TodayCard
                  record={todayRecord}
                  loading={todayLoading || (isOwnRecord && gateLoading)}
                  isOwnRecord={canClockInOut}
                  actionLoading={actionLoading}
                  error={clockError}
                  onClockIn={clockIn}
                  onClockOut={requestClockOut}
                  clockInBlocked={canClockInOut && clockInBlocked}
                  clockInBlockedReason={clockInBlockedReason}
                />
                <WeeklySummary records={weekRecords} />
              </div>

              {canViewRoster && (
                <AttendanceExceptions
                  rows={exceptions}
                  loading={exceptionsLoading}
                  canEdit={canAdmin}
                  onFix={fixException}
                />
              )}

              {/* ── Monthly Calendar ───────────────────────────────────────── */}
              <CalendarGrid
                records={monthRecords}
                viewDate={viewDate}
                loading={monthLoading}
                canEdit={canAdmin}
                onDayClick={cell => setEditCell(cell)}
              />
            </>
          )}
        </main>
      </div>

      {/* Admin override modal */}
      {editCell && (
        <EditModal
          cell={editCell}
          onClose={() => setEditCell(null)}
          onSave={saveOverride}
          saving={modalSaving}
        />
      )}

      {/* Early-checkout confirmation. Keyed on the shortfall so reopening it
          after a cancel starts with an empty reason field. */}
      <EarlyCheckoutModal
        key={earlyPrompt?.minutes ?? 'none'}
        prompt={earlyPrompt}
        saving={actionLoading}
        onCancel={() => setEarlyPrompt(null)}
        onConfirm={clockOut}
      />

      <ToastComp toast={toast} />
    </div>
  )
}
