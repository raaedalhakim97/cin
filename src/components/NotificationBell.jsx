import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bell, Loader2, Clock, UserX, CalendarClock, CalendarOff,
  Newspaper, Umbrella, CheckCheck, TimerOff, ClipboardList, Award,
} from 'lucide-react'
import supabase from '../services/supabase'

// The bell. Reads notifications, shows how many are unread, and marks them read.
//
// No filter on employee_id anywhere in here, deliberately. The RLS policy on
// notifications already restricts every SELECT to the caller's own rows, so adding a
// client-side filter would be a second copy of a rule that has to agree with the
// first. If the two ever disagreed, the client would be the one that looked right.
//
// Polling rather than a realtime subscription. Realtime would be tidier, but it needs
// the table added to a publication and a socket held open per user, and the whole
// value here is "you find out within a minute or so" rather than "instantly". A
// 60-second poll delivers that with nothing to keep working.

const KIND_META = {
  attendance_late:             { icon: Clock,         tint: 'text-[#FF8C42]' },
  attendance_absent:           { icon: UserX,         tint: 'text-[#FF4D4D]' },
  attendance_missing_clockout: { icon: TimerOff,      tint: 'text-[#FF8C42]' },
  attendance_team_late:        { icon: Clock,         tint: 'text-[#FF8C42]' },
  feed_post:                   { icon: Newspaper,     tint: 'text-[#4D9FFF]' },
  leave_submitted:             { icon: Umbrella,      tint: 'text-[#4D9FFF]' },
  leave_manager_approved:      { icon: Umbrella,      tint: 'text-[#00D4A0]' },
  leave_approved:              { icon: Umbrella,      tint: 'text-[#00D4A0]' },
  leave_rejected:              { icon: Umbrella,      tint: 'text-[#FF4D4D]' },
  leave_cancelled:             { icon: Umbrella,      tint: 'text-[#A0A0A0]' },
  shift_published:             { icon: CalendarClock, tint: 'text-[#00D4A0]' },
  shift_day_off:               { icon: CalendarOff,   tint: 'text-[#4D9FFF]' },
  review_self_open:            { icon: ClipboardList, tint: 'text-[#4D9FFF]' },
  review_self_due:             { icon: ClipboardList, tint: 'text-[#FF8C42]' },
  review_manager_open:         { icon: ClipboardList, tint: 'text-[#4D9FFF]' },
  review_manager_due:          { icon: ClipboardList, tint: 'text-[#FF8C42]' },
  review_published:            { icon: Award,         tint: 'text-[#00D4A0]' },
}

// Matches newsTimeAgo in LatestNewsWidget rather than inventing a second format,
// so two lists on the same screen do not describe the same moment differently.
function timeAgo(iso) {
  if (!iso) return ''
  const diffMs = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diffMs / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function NotificationBell() {
  const navigate = useNavigate()
  const [open, setOpen]     = useState(false)
  // null means "never loaded", which is the only state that shows a spinner. On a
  // reopen the previous list stays visible while the refetch lands, so the panel does
  // not flash empty every time it is opened — and it keeps setState out of the effect
  // body, which react-hooks/set-state-in-effect rightly objects to.
  const [rows, setRows]     = useState(null)
  const [unread, setUnread] = useState(0)
  const [reloadKey, setReloadKey] = useState(0)
  // Horizontal correction, in px, so a right-aligned panel cannot hang off the left
  // edge of a narrow screen. The bell is not the rightmost thing in the header — the
  // avatar is — so on a phone a 352px panel anchored to the bell's right edge starts
  // at a negative x and gets clipped. Measured at open rather than guessed in CSS,
  // because it depends on how wide the name beside the avatar happens to be.
  const [nudge, setNudge] = useState(0)
  const wrapRef = useRef(null)

  const refresh = useCallback(() => setReloadKey(k => k + 1), [])

  // The unread count is a HEAD request with an exact count — it never transfers the
  // rows, so it stays cheap on a 60-second timer.
  useEffect(() => {
    let cancelled = false

    async function load() {
      const { count } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .is('read_at', null)
      if (!cancelled) setUnread(count ?? 0)
    }

    load()
    const timer = setInterval(load, 60000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [reloadKey])

  // The list itself is only fetched when the panel is actually open.
  useEffect(() => {
    if (!open) return
    let cancelled = false

    supabase
      .from('notifications')
      .select('id, kind, title, body, link, read_at, created_at')
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) console.error('[NotificationBell] load failed', error)
        setRows(data ?? [])
      })

    return () => { cancelled = true }
  }, [open, reloadKey])

  // Keep the panel on screen. Same maths as the CSS width below, so the two cannot
  // drift: 22rem wide, or the viewport less a 1rem gutter each side, whichever is
  // smaller. If right-aligning would start it left of the gutter, shift it back.
  const fit = useCallback(() => {
    const el = wrapRef.current
    if (!el) return
    const gutter = 16
    const rect = el.getBoundingClientRect()
    const width = Math.min(352, window.innerWidth - gutter * 2)
    const wouldStartAt = rect.right - width
    setNudge(wouldStartAt < gutter ? Math.ceil(gutter - wouldStartAt) : 0)
  }, [])

  // Close on outside click and on Escape, and re-fit on resize. A panel that traps
  // you is worse than no panel, particularly on a phone where there is no obvious
  // way out.
  useEffect(() => {
    if (!open) return
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', fit)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', fit)
    }
  }, [open, fit])

  async function openOne(row) {
    setOpen(false)

    // Mark read before navigating, but do not let a failure here swallow the tap —
    // going where the person asked matters more than the read flag.
    if (!row.read_at) {
      const { error } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', row.id)
      if (error) console.error('[NotificationBell] mark read failed', error)
      else refresh()
    }

    if (row.link) navigate(row.link)
  }

  async function markAllRead() {
    // One statement rather than one request per row. The function runs as the caller,
    // so RLS keeps it to their own notifications.
    const { error } = await supabase.rpc('mark_notifications_read')
    if (error) console.error('[NotificationBell] mark all read failed', error)
    refresh()
  }

  const label = unread > 0
    ? `Notifications, ${unread} unread`
    : 'Notifications'

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => { if (!open) fit(); setOpen(o => !o) }}
        className="relative w-9 h-9 rounded-lg flex items-center justify-center text-[#666666] dark:text-[#A0A0A0] hover:bg-[#F5F5F0] dark:hover:bg-[#252525] hover:text-[#1A1A1A] dark:hover:text-white transition-colors"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <Bell size={17} />
        {unread > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[17px] h-[17px] px-1 rounded-full bg-[#FF4D4D] text-white text-[10px] font-bold flex items-center justify-center"
            aria-hidden="true"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-[min(22rem,calc(100vw-2rem))] max-h-[70vh] flex flex-col rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] shadow-lg z-50"
          style={nudge ? { transform: `translateX(${nudge}px)` } : undefined}
          role="dialog"
          aria-label="Notifications"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
            <h2 className="text-sm font-semibold text-[#1A1A1A] dark:text-white">Notifications</h2>
            {unread > 0 && (
              <button
                onClick={markAllRead}
                className="flex items-center gap-1.5 text-xs font-semibold text-[#00D4A0] hover:underline"
              >
                <CheckCheck size={13} /> Mark all read
              </button>
            )}
          </div>

          <div className="overflow-y-auto">
            {rows === null ? (
              <div className="flex justify-center py-10">
                <Loader2 size={18} className="animate-spin text-[#00D4A0]" />
              </div>
            ) : rows.length === 0 ? (
              <p className="px-4 py-10 text-sm text-center text-[#666666] dark:text-[#A0A0A0]">
                Nothing yet. You will hear about shifts, leave and your attendance here.
              </p>
            ) : (
              <ul className="divide-y divide-[#E8E8E8] dark:divide-[#2A2A2A]">
                {rows.map((r) => {
                  const meta = KIND_META[r.kind] ?? { icon: Bell, tint: 'text-[#A0A0A0]' }
                  const Icon = meta.icon
                  return (
                    <li key={r.id}>
                      <button
                        onClick={() => openOne(r)}
                        className={`w-full text-left flex gap-3 px-4 py-3 hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors ${
                          r.read_at ? '' : 'bg-[#00D4A0]/[0.04]'
                        }`}
                      >
                        <Icon size={16} className={`${meta.tint} shrink-0 mt-0.5`} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline gap-2">
                            <span className={`text-sm min-w-0 ${
                              r.read_at
                                ? 'text-[#666666] dark:text-[#A0A0A0]'
                                : 'font-semibold text-[#1A1A1A] dark:text-white'
                            }`}>
                              {r.title}
                            </span>
                            <span className="ml-auto shrink-0 text-[11px] text-[#AAAAAA] dark:text-[#555555]">
                              {timeAgo(r.created_at)}
                            </span>
                          </span>
                          {r.body && (
                            <span className="block mt-0.5 text-xs text-[#666666] dark:text-[#A0A0A0] line-clamp-2">
                              {r.body}
                            </span>
                          )}
                        </span>
                        {!r.read_at && (
                          <span
                            className="w-2 h-2 rounded-full bg-[#00D4A0] shrink-0 mt-1.5"
                            aria-label="Unread"
                          />
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
