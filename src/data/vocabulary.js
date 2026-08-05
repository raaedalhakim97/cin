// Canonical user-facing names, shared in intent with the mobile app's
// mobile/src/lib/vocabulary.js. Both mirror docs/ui-parity.md — change all three
// in the same session.
//
// The point is that someone who uses the web app and the phone app sees the same
// word for the same thing. Several of these were previously longer here than on
// mobile ("Dashboard", "KPI Scores", "News Feed", "HR Documents",
// "Permissions"); the shorter name won, because mobile tab bars and quick-action
// tiles truncate and a label that fits everywhere beats a more formal one that
// wraps.

export const NAV = {
  home: 'Home',
  profile: 'My profile',
  employees: 'Employees',
  attendance: 'Attendance',
  leave: 'Leave',
  payroll: 'Payroll',
  // 'KPI' not 'KPI Scores' or 'Performance': the route is /kpi on both platforms
  // and the handbook uses the term throughout (Art. 14).
  kpi: 'KPI',
  teamAnalytics: 'Team analytics',
  documents: 'Documents',
  schedule: 'Schedule',
  mySchedule: 'My schedule',
  news: 'News',
  access: 'Access',
  settings: 'Settings',
  approvals: 'Approvals',
  operations: 'Operations',
  leads: 'Leads',
  signOut: 'Sign out',
}
