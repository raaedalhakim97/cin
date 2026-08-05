import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'

const url = process.env.EXPO_PUBLIC_SUPABASE_URL
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

// The web app calls createClient() with whatever env holds and white-screens on
// a missing value (services/supabase.js). Fail loudly here instead — a bad build
// should be obvious at startup, not a blank screen after login.
if (!url || !anonKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Copy mobile/.env.example to mobile/.env and fill both in.'
  )
}

const supabase = createClient(url, anonKey, {
  auth: {
    // AsyncStorage keeps the session across app restarts; detectSessionInUrl is
    // a browser-only concern and breaks on native if left on.
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})

export default supabase
