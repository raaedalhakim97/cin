// Canonical user-facing names, shared in intent with the web app's
// src/data/vocabulary.js. Both mirror docs/ui-parity.md — change all three in the
// same session.
//
// The point is that someone who uses the web app and the phone app sees the same
// word for the same thing. Where the two platforms previously disagreed, the
// shorter name won: mobile tab bars and 96px quick-action tiles truncate at
// 390px, and a label that fits everywhere beats a more formal one that wraps
// mid-word.

export const NAV = {
  home: 'Home',
  profile: 'My profile',
  employees: 'Employees',
  attendance: 'Attendance',
  leave: 'Leave',
  payroll: 'Payroll',
  // 'KPI' not 'Performance': fits the tab bar, matches the /kpi route on both
  // platforms, and is the term the handbook uses throughout (Art. 14).
  kpi: 'KPI',
  teamAnalytics: 'Team analytics',
  documents: 'Documents',
  schedule: 'Schedule',
  mySchedule: 'My schedule',
  // 'News' not 'Announcements': fits a quick-action tile on one line.
  news: 'News',
  access: 'Access',
  settings: 'Settings',
  approvals: 'Approvals',
  operations: 'Operations',
  signOut: 'Sign out',
}

// Short forms for the bottom tab bar only, where five labels share 390px.
// Anything longer than about eight characters truncates.
export const TAB = {
  home: NAV.home,
  attendance: 'Attend',
  leave: NAV.leave,
  kpi: NAV.kpi,
  profile: 'Profile',
}
