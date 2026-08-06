import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'

const KEY = 'byond.theme'

// Three settings rather than two: an explicit light or dark choice, plus
// 'system' for whoever wants the OS to decide. Light is the default because the
// app's content surfaces are designed light-first; the resolver in
// components/ui.jsx turns 'system' into an actual value.
const VALID = ['light', 'dark', 'system']

const useThemeStore = create((set) => ({
  preference: 'light',
  hydrated: false,

  // Called once at startup. Until it resolves the app renders light, which
  // matches the default and avoids a flash of the wrong theme.
  hydrate: async () => {
    try {
      const stored = await AsyncStorage.getItem(KEY)
      if (stored && VALID.includes(stored)) set({ preference: stored })
    } catch (err) {
      console.warn('[themeStore] could not read stored preference', err?.message)
    }
    set({ hydrated: true })
  },

  setPreference: (preference) => {
    if (!VALID.includes(preference)) return
    set({ preference })
    AsyncStorage.setItem(KEY, preference).catch((err) =>
      console.warn('[themeStore] could not persist preference', err?.message)
    )
  },
}))

export default useThemeStore
