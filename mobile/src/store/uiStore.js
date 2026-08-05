import { create } from 'zustand'

// Drawer open state lives here so exactly one AppDrawer is mounted, at the root.
// It used to be local state inside Screen, which meant every tab rendered its
// own <Modal>; after visiting a few tabs the stacked, closed modals still
// intercepted touches and the hamburger stopped responding.
const useUiStore = create((set) => ({
  drawerOpen: false,
  openDrawer: () => set({ drawerOpen: true }),
  closeDrawer: () => set({ drawerOpen: false }),
}))

export default useUiStore
