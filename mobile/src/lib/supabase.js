import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'
import demoClient from './demo/client'

const url = process.env.EXPO_PUBLIC_SUPABASE_URL
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

// Demo mode is the default until a project is wired up: with no credentials the
// app runs against in-memory seed data so every screen is usable and reviewable.
// Setting both env vars switches to the real database — no screen changes, since
// the demo client implements the same surface.
//
// EXPO_PUBLIC_FORCE_DEMO=1 keeps demo mode on even when credentials exist, which
// is useful for screenshots and for showing the app without touching live data.
const forceDemo = process.env.EXPO_PUBLIC_FORCE_DEMO === '1'
const hasCredentials = Boolean(url && anonKey && !url.includes('placeholder'))

export const isDemo = forceDemo || !hasCredentials

const realClient = () =>
  createClient(url, anonKey, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      // Browser-only concern; leaving it on breaks native.
      detectSessionInUrl: false,
    },
  })

const supabase = isDemo ? demoClient : realClient()

if (isDemo) {
  console.log('[supabase] demo mode — in-memory seed data, no network calls')
}

export default supabase
