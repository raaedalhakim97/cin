import { useCallback, useEffect, useState } from 'react'
import { Calendar, ChevronLeft, ChevronRight, Clock, AlertTriangle, Moon } from 'lucide-react'
import supabase from '../services/supabase'
import useAuthStore from '../store/authStore'
import Sidebar from '../components/layout/Sidebar'
import Header from '../components/layout/Header'
import EmptyState from '../components/EmptyState'
import { SkeletonBlock } from '../components/Skeleton'

const STATUS_META = {
  published: { label: 'Scheduled', cls: 'bg-[#00D4A0]/10 text-[#00D4A0]' },
  completed: { label: 'Completed', cls: 'bg-[#4D9FFF]/10 text-[#4D9FFF]' },
  no_show:   { label: 'No-Show',   cls: 'bg-[#FF4D4D]/10 text-[#FF4D4D]' },
}

function localDateStr(d) {
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return localDateStr(d)
}

function weekStartFor(dateStr, weekStartsOn = 1) {
  const d = new Date(dateStr + 'T00:00:00')
  const diff = (d.getDay() - weekStartsOn + 7) % 7
  d.setDate(d.getDate() - diff)
  return localDateStr(d)
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
}

function fmtDay(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}

export default function MySchedule() {
  const employee = useAuthStore((s) => s.employee)
  const companyId = useAuthStore((s) => s.companyId)

  const [weekOffset, setWeekOffset] = useState(0)
  const [weekStartsOn, setWeekStartsOn] = useState(1)
  const [shifts, setShifts] = useState([])
  const [loading, setLoading] = useState(true)

  const todayStr = localDateStr(new Date())
  const anchor = weekStartFor(todayStr, weekStartsOn)
  const weekStart = addDays(anchor, weekOffset * 7)
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  useEffect(() => {
    if (!companyId) return
    supabase.from('shift_settings').select('week_starts_on').eq('company_id', companyId).maybeSingle()
      .then(({ data }) => { if (data) setWeekStartsOn(data.week_starts_on) })
  }, [companyId])

  const fetchShifts = useCallback(async () => {
    if (!employee?.id) { setLoading(false); return }
    setLoading(true)
    // RLS already limits a plain employee to their own published/completed/
    // no_show shifts (drafts are never visible to them) — no extra status
    // filter needed here.
    const { data } = await supabase
      .from('shifts')
      .select('id, shift_date, start_at, end_at, break_minutes, status, notes, shift_type, shift_templates(name, color)')
      .eq('employee_id', employee.id)
      .gte('shift_date', weekStart)
      .lte('shift_date', addDays(weekStart, 6))
      .order('start_at')
    setShifts(data ?? [])
    setLoading(false)
  }, [employee?.id, weekStart])

  useEffect(() => { fetchShifts() }, [fetchShifts])

  const shiftsByDay = {}
  shifts.forEach((s) => {
    if (!shiftsByDay[s.shift_date]) shiftsByDay[s.shift_date] = []
    shiftsByDay[s.shift_date].push(s)
  })

  return (
    <div className="flex min-h-screen bg-[#F5F5F0] dark:bg-[#0F0F0F]">
      <Sidebar />

      <div className="flex-1 flex flex-col lg:ml-60">
        <Header />

        <main className="flex-1 p-4 sm:p-6 lg:p-8">

          {!employee ? (
            <div className="flex items-start gap-3 p-5 rounded-xl bg-[#FF8C42]/10 border border-[#FF8C42]/20 max-w-lg">
              <AlertTriangle size={18} className="text-[#FF8C42] shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-[#FF8C42]">Account not linked</p>
                <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1">
                  Your login is not linked to an employee record, so no schedule can be shown. Contact HR to complete setup.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                <div>
                  <h1 className="text-2xl font-bold text-[#1A1A1A] dark:text-white">My Schedule</h1>
                  <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1">Your published shifts for the week</p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-0.5 bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] rounded-lg px-1">
                    <button onClick={() => setWeekOffset((w) => w - 1)} className="w-8 h-9 flex items-center justify-center text-[#666666] dark:text-[#A0A0A0] hover:text-[#1A1A1A] dark:hover:text-white transition-colors">
                      <ChevronLeft size={16} />
                    </button>
                    <span className="text-sm font-semibold text-[#1A1A1A] dark:text-white px-2 min-w-[150px] text-center">
                      {fmtDay(weekStart).split(',')[1]?.trim()} – {fmtDay(addDays(weekStart, 6)).split(',')[1]?.trim()}
                    </span>
                    <button onClick={() => setWeekOffset((w) => w + 1)} className="w-8 h-9 flex items-center justify-center text-[#666666] dark:text-[#A0A0A0] hover:text-[#1A1A1A] dark:hover:text-white transition-colors">
                      <ChevronRight size={16} />
                    </button>
                  </div>
                  {weekOffset !== 0 && (
                    <button onClick={() => setWeekOffset(0)} className="text-xs font-semibold text-[#00D4A0] hover:underline px-2">Today</button>
                  )}
                </div>
              </div>

              {loading ? (
                <div className="space-y-3 animate-pulse">
                  {[0, 1, 2, 3, 4, 5, 6].map((i) => <SkeletonBlock key={i} className="h-16" />)}
                </div>
              ) : shifts.length === 0 ? (
                <EmptyState icon={Calendar} title="No shifts scheduled this week" hint="Published shifts assigned to you will show up here." />
              ) : (
                <div className="space-y-3">
                  {days.map((d) => {
                    const dayShifts = shiftsByDay[d] ?? []
                    const isToday = d === todayStr
                    return (
                      <div
                        key={d}
                        className={`p-5 rounded-xl bg-white dark:bg-[#1E1E1E] border ${isToday ? 'border-[#00D4A0]/40' : 'border-[#E8E8E8] dark:border-[#2A2A2A]'}`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <p className={`text-sm font-semibold ${isToday ? 'text-[#00D4A0]' : 'text-[#1A1A1A] dark:text-white'}`}>{fmtDay(d)}</p>
                          {isToday && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#00D4A0]/10 text-[#00D4A0]">Today</span>}
                        </div>
                        {dayShifts.length === 0 ? (
                          <p className="text-xs text-[#AAAAAA] dark:text-[#555555]">No shift scheduled</p>
                        ) : (
                          <div className="space-y-2">
                            {dayShifts.map((s) => {
                              if (s.shift_type === 'off') {
                                return (
                                  <div key={s.id} className="flex items-center gap-2.5">
                                    <Moon size={14} className="text-[#A0A0A0] shrink-0" />
                                    <p className="text-sm font-semibold text-[#666666] dark:text-[#A0A0A0]">Day off</p>
                                  </div>
                                )
                              }
                              const meta = STATUS_META[s.status] ?? STATUS_META.published
                              return (
                                <div key={s.id} className="flex items-center justify-between gap-3">
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    <Clock size={14} className="text-[#00D4A0] shrink-0" />
                                    <div className="min-w-0">
                                      <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white truncate">
                                        {fmtTime(s.start_at)} – {fmtTime(s.end_at)}
                                        {s.shift_templates?.name && <span className="font-normal text-[#666666] dark:text-[#A0A0A0]"> · {s.shift_templates.name}</span>}
                                      </p>
                                      {s.notes && <p className="text-xs text-[#666666] dark:text-[#A0A0A0] truncate">{s.notes}</p>}
                                    </div>
                                  </div>
                                  <span className={`shrink-0 px-2.5 py-0.5 rounded-full text-xs font-semibold ${meta.cls}`}>{meta.label}</span>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  )
}
