import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import supabase from '../services/supabase'
import useAuthStore from '../store/authStore'

// Keeps the signed-in person's role current while the app is open.
//
// The role is read once at sign-in and kept in the store; the menu, the routes and the
// page guides all follow it. So when the owner promotes someone on Managers & teams, that
// person's open app went on showing an employee's menu until they signed out — the
// notification said "you're now a manager" and the app disagreed.
//
// This re-reads the person's own user_roles row (RLS lets anyone read their own) when the
// app comes back to the foreground, on page changes and every two minutes, at most once
// a minute. If it has changed, the whole profile is reloaded, and everything that depends
// on the role redraws: new menu items appear, a page they may no longer open sends them
// on, and the new role's guides show once. The database never trusted the stale copy —
// every policy reads the role from the table — so this is about what the screen shows.

const CHECK_EVERY_MS = 2 * 60 * 1000
const MIN_GAP_MS = 60 * 1000

export default function RoleWatcher() {
  const { pathname } = useLocation()
  const session = useAuthStore((s) => s.session)
  const role = useAuthStore((s) => s.role)
  const loadProfile = useAuthStore((s) => s.loadProfile)

  // The latest values, for callbacks that outlive a render.
  const latest = useRef({ session, role, loadProfile })
  useEffect(() => { latest.current = { session, role, loadProfile } }, [session, role, loadProfile])

  const lastCheck = useRef(0)
  const check = useRef(async () => {
    const { session: s, role: r, loadProfile: reload } = latest.current
    if (!s?.user?.id || !r) return
    if (Date.now() - lastCheck.current < MIN_GAP_MS) return
    lastCheck.current = Date.now()
    const { data, error } = await supabase
      .from('user_roles').select('role').eq('user_id', s.user.id).maybeSingle()
    if (error || !data) return
    if (data.role !== latest.current.role) await reload(latest.current.session)
  })

  useEffect(() => {
    const run = () => check.current()
    const onVisible = () => { if (document.visibilityState === 'visible') run() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    const timer = setInterval(run, CHECK_EVERY_MS)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      clearInterval(timer)
    }
  }, [])

  useEffect(() => { check.current() }, [pathname])

  return null
}
