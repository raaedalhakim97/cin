import { create } from 'zustand'

// Mobile off-canvas sidebar state — shared between Header (hamburger button)
// and Sidebar (the drawer itself), which are siblings rendered separately by
// every page rather than a shared layout wrapper.
const useUiStore = create((set) => ({
  mobileNavOpen: false,
  openMobileNav: () => set({ mobileNavOpen: true }),
  closeMobileNav: () => set({ mobileNavOpen: false }),
  toggleMobileNav: () => set((s) => ({ mobileNavOpen: !s.mobileNavOpen })),
}))

export default useUiStore
