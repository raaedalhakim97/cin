import { create } from 'zustand'

// Personal / Manager mode, the pattern from the reference app's drawer: one
// account, two surfaces. In Personal mode the app is strictly about your own
// record; switching to Manager turns Home into the team view and reveals the
// approvals queue.
//
// This is a presentation switch only — it never grants permission. What a
// manager can actually do is decided by role in authStore and enforced by RLS;
// Manager mode is simply hidden entirely from anyone whose role can't use it.
const useModeStore = create((set) => ({
  mode: 'personal',
  setMode: (mode) => set({ mode: mode === 'manager' ? 'manager' : 'personal' }),
  toggle: () => set((s) => ({ mode: s.mode === 'manager' ? 'personal' : 'manager' })),
}))

export default useModeStore
