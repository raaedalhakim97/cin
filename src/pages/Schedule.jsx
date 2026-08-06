import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Calendar, ChevronLeft, ChevronRight, Plus, Send, Loader2, Settings2,
  Grid3x3, ListChecks, LayoutGrid, Moon,
} from 'lucide-react'
import supabase from '../services/supabase'
import useAuthStore from '../store/authStore'
import Sidebar from '../components/layout/Sidebar'
import Header from '../components/layout/Header'
import EmptyState from '../components/EmptyState'
import ToastComp, { useToast } from '../components/Toast'
import { SkeletonBlock } from '../components/Skeleton'
import ShiftModal from '../components/schedule/ShiftModal'

const DAY_LABELS_BY_START = {
  0: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  1: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
}

const STATUS_META = {
  scheduled: { label: 'Draft',     cls: 'bg-[#A0A0A0]/10 text-[#666666] dark:text-[#A0A0A0]' },
  published: { label: 'Published', cls: 'bg-[#00D4A0]/10 text-[#00D4A0]' },
  completed: { label: 'Completed', cls: 'bg-[#4D9FFF]/10 text-[#4D9FFF]' },
  no_show:   { label: 'No-Show',   cls: 'bg-[#FF4D4D]/10 text-[#FF4D4D]' },
  cancelled: { label: 'Cancelled', cls: 'bg-[#A0A0A0]/10 text-[#666666] dark:text-[#A0A0A0]' },
}

function localDateStr(d) {
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return localDateStr(d)
}

// Start of the week containing `dateStr`, respecting the company's
// configured week_starts_on (0=Sunday..6=Saturday). Falls back to Monday
// (1) while shift_settings hasn't loaded yet.
function weekStartFor(dateStr, weekStartsOn = 1) {
  const d = new Date(dateStr + 'T00:00:00')
  const diff = (d.getDay() - weekStartsOn + 7) % 7
  d.setDate(d.getDate() - diff)
  return localDateStr(d)
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function fmtDayLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
}

// ─── Shift pill ───────────────────────────────────────────────────────────────

function ShiftPill({ shift, empCode, onClick }) {
  // OFF entries (scheduled rest days, migration 39) render as a muted gray
  // pill with no times — start_at/end_at are just 00:00/23:59 placeholders
  // on these rows, not meaningful hours to show.
  if (shift.shift_type === 'off') {
    return (
      <button
        onClick={onClick}
        title={empCode || undefined}
        className="w-full text-left px-2 py-1.5 rounded-lg border text-[11px] font-semibold leading-tight mb-1 last:mb-0 transition-opacity hover:opacity-80 bg-[#A0A0A0]/10 border-[#A0A0A0]/30 text-[#666666] dark:text-[#A0A0A0]"
      >
        <div className="flex items-center justify-between gap-1">
          <span>OFF</span>
          {shift.status === 'scheduled' && <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-current opacity-60" title="Draft" />}
        </div>
      </button>
    )
  }

  const color = shift.color || '#00D4A0'
  // Overnight shift (confirmed supported, migration 38) — end lands on the
  // next calendar day from start. The cell it's rendered in is keyed by
  // shift_date (the start day), so a "+1d" hint keeps the end time from
  // reading as a same-day typo.
  const crossesMidnight = new Date(shift.end_at).toDateString() !== new Date(shift.start_at).toDateString()
  return (
    <button
      onClick={onClick}
      title={empCode || undefined}
      className="w-full text-left px-2 py-1.5 rounded-lg border text-[11px] font-semibold leading-tight mb-1 last:mb-0 transition-opacity hover:opacity-80"
      style={{ backgroundColor: `${color}1F`, borderColor: `${color}55`, color }}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="truncate">{fmtTime(shift.start_at)}–{fmtTime(shift.end_at)}{crossesMidnight ? ' (+1d)' : ''}</span>
        {shift.status === 'scheduled' && <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-current opacity-60" title="Draft" />}
      </div>
      {shift.template_name && <div className="truncate opacity-80 font-normal">{shift.template_name}</div>}
    </button>
  )
}

// ─── Week View tab ────────────────────────────────────────────────────────────

function WeekViewTab({ companyId, currentEmployeeId, shiftSettings, showToast }) {
  const [weekOffset, setWeekOffset] = useState(0)
  const [employees, setEmployees] = useState([])
  const [shifts, setShifts] = useState([])
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [modalState, setModalState] = useState(null) // { shift? , date?, employeeId? }

  const weekStartsOn = shiftSettings?.week_starts_on ?? 1
  const todayStr = localDateStr(new Date())
  const anchor = weekStartFor(todayStr, weekStartsOn)
  const weekStart = addDays(anchor, weekOffset * 7)
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const dayLabels = DAY_LABELS_BY_START[weekStartsOn] ?? DAY_LABELS_BY_START[1]

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [{ data: emps }, { data: shiftRows }] = await Promise.all([
      supabase.from('employees').select('id, full_name, job_title, emp_code').eq('status', 'active').order('full_name'),
      supabase
        .from('shifts')
        .select('id, employee_id, template_id, shift_date, start_at, end_at, status, shift_type, shift_templates(name, color)')
        .gte('shift_date', weekStart)
        .lte('shift_date', addDays(weekStart, 6))
        .neq('status', 'cancelled'),
    ])
    setEmployees(emps ?? [])
    setShifts((shiftRows ?? []).map((s) => ({
      ...s,
      template_name: s.shift_templates?.name ?? null,
      color: s.shift_templates?.color ?? null,
    })))
    setLoading(false)
  }, [weekStart])

  useEffect(() => { fetchData() }, [fetchData])

  async function publishWeek() {
    setPublishing(true)
    const draftIds = shifts.filter((s) => s.status === 'scheduled').map((s) => s.id)
    if (draftIds.length === 0) {
      showToast('error', 'No draft shifts to publish this week')
      setPublishing(false)
      return
    }
    const { error } = await supabase
      .from('shifts')
      .update({ status: 'published', published_at: new Date().toISOString() })
      .in('id', draftIds)
    setPublishing(false)
    if (error) {
      console.error('[Schedule] publishWeek failed', error)
      showToast('error', 'Something went wrong publishing this week. Please try again.')
      return
    }
    showToast('success', `Published ${draftIds.length} shift${draftIds.length !== 1 ? 's' : ''}`)
    fetchData()
  }

  const shiftsByEmpDay = useMemo(() => {
    const map = {}
    shifts.forEach((s) => {
      const key = `${s.employee_id}_${s.shift_date}`
      if (!map[key]) map[key] = []
      map[key].push(s)
    })
    return map
  }, [shifts])

  const draftCount = shifts.filter((s) => s.status === 'scheduled').length

  return (
    <div className="space-y-4">
      {/* Header controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] rounded-lg px-1">
            <button onClick={() => setWeekOffset((w) => w - 1)} className="w-8 h-9 flex items-center justify-center text-[#666666] dark:text-[#A0A0A0] hover:text-[#1A1A1A] dark:hover:text-white transition-colors">
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-semibold text-[#1A1A1A] dark:text-white px-2 min-w-[190px] text-center">
              {fmtDayLabel(weekStart)} – {fmtDayLabel(addDays(weekStart, 6))}
            </span>
            <button onClick={() => setWeekOffset((w) => w + 1)} className="w-8 h-9 flex items-center justify-center text-[#666666] dark:text-[#A0A0A0] hover:text-[#1A1A1A] dark:hover:text-white transition-colors">
              <ChevronRight size={16} />
            </button>
          </div>
          {weekOffset !== 0 && (
            <button onClick={() => setWeekOffset(0)} className="text-xs font-semibold text-[#00D4A0] hover:underline px-2">Today</button>
          )}
        </div>

        <button
          onClick={publishWeek}
          disabled={publishing || draftCount === 0}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-50 transition-colors"
        >
          {publishing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          Publish Week{draftCount > 0 ? ` (${draftCount})` : ''}
        </button>
      </div>

      {/* Grid */}
      <div className="rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] overflow-hidden">
        {loading ? (
          <div className="p-5 space-y-3 animate-pulse">
            {[0, 1, 2, 3, 4].map((i) => <SkeletonBlock key={i} className="h-14" />)}
          </div>
        ) : employees.length === 0 ? (
          <div className="py-4"><EmptyState icon={Calendar} title="No active employees" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
                  <th className="sticky left-0 bg-white dark:bg-[#1E1E1E] px-4 py-3 text-left text-xs font-semibold text-[#666666] dark:text-[#A0A0A0] uppercase tracking-wide min-w-[160px]">Employee</th>
                  {days.map((d, i) => (
                    <th key={d} className="px-2 py-3 text-center text-xs font-semibold text-[#666666] dark:text-[#A0A0A0] min-w-[140px]">
                      {dayLabels[i]}<br /><span className="font-normal opacity-70">{d.slice(5)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8E8E8] dark:divide-[#2A2A2A]">
                {employees.map((emp) => (
                  <tr key={emp.id}>
                    <td className="sticky left-0 bg-white dark:bg-[#1E1E1E] px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-[#00D4A0] flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                          {initials(emp.full_name)}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-[#1A1A1A] dark:text-white truncate text-xs">{emp.full_name}</p>
                          <p className="text-[10px] text-[#666666] dark:text-[#A0A0A0] truncate">
                            {emp.emp_code ? `${emp.emp_code} · ` : ''}{emp.job_title || '—'}
                          </p>
                        </div>
                      </div>
                    </td>
                    {days.map((d) => {
                      const cellShifts = shiftsByEmpDay[`${emp.id}_${d}`] ?? []
                      return (
                        <td key={d} className="px-2 py-2 align-top border-l border-[#E8E8E8] dark:border-[#2A2A2A]">
                          {cellShifts.map((s) => (
                            <ShiftPill key={s.id} shift={s} empCode={emp.emp_code} onClick={() => setModalState({ shift: s })} />
                          ))}
                          <button
                            onClick={() => setModalState({ date: d, employeeId: emp.id })}
                            className="w-full flex items-center justify-center py-1.5 rounded-lg text-[#AAAAAA] dark:text-[#555555] hover:text-[#00D4A0] hover:bg-[#00D4A0]/5 transition-colors"
                          >
                            <Plus size={13} />
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalState && (
        <ShiftModal
          shift={modalState.shift ?? null}
          initialDate={modalState.date}
          initialEmployeeId={modalState.employeeId}
          companyId={companyId}
          currentEmployeeId={currentEmployeeId}
          onClose={() => setModalState(null)}
          onSaved={fetchData}
          showToast={showToast}
        />
      )}
    </div>
  )
}

// ─── Today tab ────────────────────────────────────────────────────────────────

function TodayTab() {
  const [rows, setRows] = useState([])
  const [deptByEmployee, setDeptByEmployee] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [{ data: todayRows }, { data: empRows }] = await Promise.all([
        supabase.from('today_schedule').select('*').order('start_at'),
        supabase.from('employees').select('id, department_id, departments!employees_department_id_fkey(name)'),
      ])
      setRows(todayRows ?? [])
      setDeptByEmployee(Object.fromEntries((empRows ?? []).map((e) => [e.id, e.departments?.name ?? 'Unassigned'])))
      setLoading(false)
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        {[0, 1, 2].map((i) => <SkeletonBlock key={i} className="h-32" />)}
      </div>
    )
  }

  if (rows.length === 0) {
    return <EmptyState icon={Calendar} title="No shifts scheduled today" />
  }

  const grouped = {}
  rows.forEach((r) => {
    const dept = deptByEmployee[r.employee_id] ?? 'Unassigned'
    if (!grouped[dept]) grouped[dept] = []
    grouped[dept].push(r)
  })

  return (
    <div className="space-y-6">
      {Object.entries(grouped).map(([dept, deptRows]) => (
        <div key={dept} className="rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] overflow-hidden">
          <div className="px-5 py-3 border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
            <h3 className="text-sm font-semibold text-[#1A1A1A] dark:text-white">{dept}</h3>
          </div>
          <div className="divide-y divide-[#E8E8E8] dark:divide-[#2A2A2A]">
            {deptRows.map((r) => {
              const meta = STATUS_META[r.status] ?? STATUS_META.scheduled
              const isOff = r.shift_type === 'off'
              return (
                <div key={r.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${isOff ? 'bg-[#A0A0A0]/20 text-[#666666] dark:text-[#A0A0A0]' : 'bg-[#00D4A0] text-white'}`}>
                      {isOff ? <Moon size={14} /> : initials(r.full_name)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white truncate">{r.full_name}</p>
                      <p className="text-xs text-[#666666] dark:text-[#A0A0A0] truncate">
                        {isOff ? 'Day off' : `${r.template_name ?? 'Custom'} · ${fmtTime(r.start_at)}–${fmtTime(r.end_at)} · ${Number(r.net_hours).toFixed(1)}h`}
                      </p>
                    </div>
                  </div>
                  <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-semibold ${meta.cls}`}>{meta.label}</span>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Coverage tab ─────────────────────────────────────────────────────────────

function coverageTone(count) {
  if (count === 0) return 'bg-[#FF4D4D]/15 text-[#FF4D4D]'
  if (count <= 2) return 'bg-[#FF8C42]/15 text-[#FF8C42]'
  return 'bg-[#00D4A0]/15 text-[#00D4A0]'
}

function CoverageTab() {
  const [departments, setDepartments] = useState([])
  const [coverage, setCoverage] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [{ data: depts }, { data: covRows }] = await Promise.all([
        supabase.from('departments').select('id, name').order('name'),
        supabase.from('weekly_coverage').select('*'),
      ])
      setDepartments(depts ?? [])
      setCoverage(covRows ?? [])
      setLoading(false)
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        {[0, 1, 2, 3].map((i) => <SkeletonBlock key={i} className="h-12" />)}
      </div>
    )
  }

  // weekly_coverage spans CURRENT_DATE through CURRENT_DATE + 6 (7 days,
  // exclusive upper bound — fixed in migration 38, was 8 before). Render
  // whatever dates the view actually returns; fall back to a plain 7-day
  // window from today only when there's no coverage data at all yet.
  const dates = [...new Set(coverage.map((c) => c.shift_date))].sort()
  const todayStr = localDateStr(new Date())
  const columns = dates.length ? dates : Array.from({ length: 7 }, (_, i) => addDays(todayStr, i))

  const cellMap = {}
  coverage.forEach((c) => { cellMap[`${c.department_id}_${c.shift_date}`] = c })

  if (departments.length === 0) {
    return <EmptyState icon={LayoutGrid} title="No departments to show coverage for" />
  }

  return (
    <div className="rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
              <th className="sticky left-0 bg-white dark:bg-[#1E1E1E] px-4 py-3 text-left text-xs font-semibold text-[#666666] dark:text-[#A0A0A0] uppercase tracking-wide min-w-[160px]">Department</th>
              {columns.map((d) => (
                <th key={d} className="px-2 py-3 text-center text-xs font-semibold text-[#666666] dark:text-[#A0A0A0] min-w-[90px]">
                  {fmtDayLabel(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E8E8E8] dark:divide-[#2A2A2A]">
            {departments.map((dept) => (
              <tr key={dept.id}>
                <td className="sticky left-0 bg-white dark:bg-[#1E1E1E] px-4 py-2.5 font-semibold text-[#1A1A1A] dark:text-white text-xs">
                  {dept.name}
                </td>
                {columns.map((d) => {
                  const cell = cellMap[`${dept.id}_${d}`]
                  const count = cell?.scheduled_count ?? 0
                  return (
                    <td key={d} className="px-2 py-2 text-center border-l border-[#E8E8E8] dark:border-[#2A2A2A]">
                      <span className={`inline-flex flex-col items-center justify-center w-16 h-12 rounded-lg text-xs font-bold ${coverageTone(count)}`}>
                        {count}
                        {cell?.total_hours != null && <span className="text-[10px] font-normal opacity-80">{Number(cell.total_hours).toFixed(0)}h</span>}
                      </span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-4 px-5 py-3.5 border-t border-[#E8E8E8] dark:border-[#2A2A2A] text-xs text-[#666666] dark:text-[#A0A0A0]">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#FF4D4D]" />Empty</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#FF8C42]" />1–2 scheduled</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#00D4A0]" />3+ scheduled</span>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Schedule() {
  const employee = useAuthStore((s) => s.employee)
  const companyId = useAuthStore((s) => s.companyId)
  const [activeTab, setActiveTab] = useState('week')
  const [shiftSettings, setShiftSettings] = useState(null)
  const { toast, showToast } = useToast()

  useEffect(() => {
    if (!companyId) return
    supabase.from('shift_settings').select('*').eq('company_id', companyId).maybeSingle()
      .then(({ data }) => setShiftSettings(data))
  }, [companyId])

  const tabs = [
    { id: 'week', label: 'Week View', icon: Grid3x3 },
    { id: 'today', label: 'Today', icon: ListChecks },
    { id: 'coverage', label: 'Coverage', icon: LayoutGrid },
  ]

  return (
    <div className="flex min-h-screen bg-[#F5F5F0] dark:bg-[#0F0F0F]">
      <Sidebar />

      <div className="flex-1 min-w-0 flex flex-col lg:ml-60">
        <Header />

        <main className="flex-1 p-4 sm:p-6 lg:p-8">

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl font-bold text-[#1A1A1A] dark:text-white">Schedule</h1>
              <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1">
                Shift scheduling, today's coverage, and weekly staffing levels
              </p>
            </div>
            <Link
              to="/schedule/templates"
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white text-sm font-semibold hover:border-[#00D4A0]/40 transition-colors w-fit"
            >
              <Settings2 size={15} className="text-[#00D4A0]" />
              Shift Templates
            </Link>
          </div>

          <div className="flex gap-1 p-1 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] w-fit max-w-full mb-6 overflow-x-auto">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors ${
                  activeTab === id ? 'bg-[#00D4A0]/10 text-[#00D4A0]' : 'text-[#666666] dark:text-[#A0A0A0] hover:text-[#1A1A1A] dark:hover:text-white'
                }`}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>

          {activeTab === 'week' && (
            <WeekViewTab companyId={companyId} currentEmployeeId={employee?.id} shiftSettings={shiftSettings} showToast={showToast} />
          )}
          {activeTab === 'today' && <TodayTab />}
          {activeTab === 'coverage' && <CoverageTab />}
        </main>
      </div>

      <ToastComp toast={toast} />
    </div>
  )
}
