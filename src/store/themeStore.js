import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const useThemeStore = create(persist(
  (set) => ({
    isDark: true,
    toggle: () => set((s) => ({ isDark: !s.isDark })),
  }),
  { name: 'byond-theme' }
))

export default useThemeStore
