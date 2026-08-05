import { create } from 'zustand'

// Which surface the app is showing: your own record, or the second surface your
// role grants. The pattern is from the reference app's Personal/Manager switch,
// but which second surface exists depends on the role —
// lib/permissions.js secondMode() decides:
//
//   super_admin, hr_manager, department_manager → 'manager' (approvals, team)
//   admin                                      → 'ops' (shifts, documents)
//   employee, read_only                        → none; single surface
//
// This is a presentation switch only. It never grants permission: what a user
// can actually do comes from role via capabilities(), and is enforced by RLS.
const useModeStore = create((set) => ({
  mode: 'personal',

  // Guarded so a role can never sit in a surface it doesn't have — e.g. after
  // switching accounts in a demo build.
  setMode: (mode, allowed) => {
    if (mode === 'personal') return set({ mode: 'personal' })
    if (mode && mode === allowed) return set({ mode })
    return set({ mode: 'personal' })
  },

  reset: () => set({ mode: 'personal' }),
}))

export default useModeStore
