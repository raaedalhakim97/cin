import { create } from 'zustand'
import supabase from '../lib/supabase'

// The unread count behind the bell badge.
//
// This is a store rather than local state inside Screen for the same reason the
// drawer's open state is: expo-router keeps every visited tab mounted, so several
// Screens — and therefore several TopBars — exist at once. With a count per
// Screen, reading your notifications would clear the badge on the tab you were
// standing on and leave it stale on the other four until each was re-focused.
// One number, one place, every bell agrees.
//
// No filter on employee_id, deliberately, and the same reasoning as the web
// bell: the RLS policy on notifications already restricts every SELECT to the
// caller's own rows. A client-side filter would be a second copy of that rule
// which has to agree with the first, and if the two ever disagreed the client is
// the one that would look correct.
const useNotificationStore = create((set) => ({
  unread: 0,

  // A HEAD request with an exact count — it never transfers the rows, so it is
  // cheap enough to run on every screen focus and on a timer.
  refresh: async () => {
    const { count, error } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .is('read_at', null)

    // Leave the previous number alone on a failure. Zeroing it would announce
    // "nothing to see" on a dropped connection, which is the one wrong answer:
    // a stale count is recoverable, a false all-clear is not.
    if (error) {
      console.error('[notifications] unread count failed', error)
      return
    }
    set({ unread: count ?? 0 })
  },

  // Called on sign-out. Without this the previous user's count sits on the bell
  // until the next successful refresh.
  reset: () => set({ unread: 0 }),
}))

export default useNotificationStore
