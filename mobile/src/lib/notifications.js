// Shared vocabulary for the notification list and the bell badge.
//
// The rows come from the `notifications` table, written by the triggers in
// migration 17. The web app has its own copy of this mapping in
// src/components/NotificationBell.jsx — the icon set differs (lucide there,
// Ionicons here) so the tables cannot be literally shared, but the tints are the
// same hexes and the twelve kinds are the same twelve. If a kind is added to the
// CHECK constraint, both tables need the new row.

import { brand, semantic } from '../theme'

// Every kind the CHECK constraint on notifications.kind allows. A kind with no
// entry here falls back to a plain bell rather than rendering blank, but that
// fallback is a bug to fix, not a feature — the constraint is the list.
export const KIND_META = {
  attendance_late:             { icon: 'time-outline',            tint: semantic.warning },
  attendance_absent:          { icon: 'person-remove-outline',   tint: semantic.danger },
  attendance_missing_clockout: { icon: 'timer-outline',           tint: semantic.warning },
  attendance_team_late:        { icon: 'people-outline',          tint: semantic.warning },
  feed_post:                   { icon: 'megaphone-outline',       tint: semantic.info },
  leave_submitted:             { icon: 'umbrella-outline',        tint: semantic.info },
  leave_manager_approved:      { icon: 'umbrella-outline',        tint: semantic.info },
  leave_approved:              { icon: 'umbrella-outline',        tint: brand.mint },
  leave_rejected:              { icon: 'umbrella-outline',        tint: semantic.danger },
  leave_cancelled:             { icon: 'umbrella-outline',        tint: '#A0A0A0' },
  shift_published:             { icon: 'calendar-number-outline', tint: brand.mint },
  shift_day_off:               { icon: 'calendar-clear-outline',  tint: semantic.info },
}

export function metaFor(kind) {
  return KIND_META[kind] ?? { icon: 'notifications-outline', tint: '#A0A0A0' }
}

// Matches the web bell's timeAgo, which in turn matches newsTimeAgo in
// LatestNewsWidget. Three lists on two platforms describing the same moment
// should not each pick their own wording.
export function timeAgo(iso) {
  if (!iso) return ''
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Where tapping a notification should go on the phone.
//
// notifications.link holds a WEB route — the triggers write '/attendance',
// '/leave', '/feed' and '/my-schedule', because one row has to serve both
// surfaces. Only two of those four exist on mobile under the same name, so the
// link cannot be handed to expo-router as-is: '/my-schedule' would push a route
// that does not exist, and the tap would do nothing.
//
// Routing is by kind rather than by link, because the link alone loses who the
// record belongs to. '/leave' is correct for both "your leave was approved" and
// "someone requested leave", but on mobile those are two different screens: your
// own requests are the Leave tab, and someone else's are the approvals queue.
//
// Two kinds are genuinely ambiguous. leave_manager_approved is sent to the
// employee AND to HR by the same trigger, and attendance_team_late is only
// meaningful to someone with a team. Both resolve on capability, which is the
// same thing the destination screen would enforce — so nobody is sent to a
// screen that would then refuse them.
export function mobileRoute(kind, caps) {
  switch (kind) {
    case 'attendance_late':
    case 'attendance_absent':
    case 'attendance_missing_clockout':
      return '/(tabs)/attendance'

    case 'attendance_team_late':
      return caps?.viewTeamAttendance ? '/approvals' : '/(tabs)/attendance'

    case 'feed_post':
      return '/feed'

    case 'leave_submitted':
    case 'leave_cancelled':
      return caps?.approveLeaveStep1 ? '/approvals' : '/(tabs)/leave'

    case 'leave_manager_approved':
      return caps?.approveLeaveFinal ? '/approvals' : '/(tabs)/leave'

    case 'leave_approved':
    case 'leave_rejected':
      return '/(tabs)/leave'

    // There is no schedule screen on mobile. Home is where a person sees today's
    // shift — it reads today_schedule and prints the template name and hours —
    // so that is the honest destination for a shift notification.
    case 'shift_published':
    case 'shift_day_off':
      return '/(tabs)/'

    default:
      return null
  }
}
