import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

// Keeps an open tab on the version that is actually deployed.
//
// A single-page app loads its code once and then never again: signing out and in, moving
// between pages, even leaving the phone overnight all keep running whatever was loaded
// first. Measured on production: a phone tab opened before a deploy was still making the
// old version's requests the next afternoon, across three different logins, so none of
// that day's features existed for it — the new page guides looked broken when they had
// simply never been downloaded.
//
// So the tab asks /version.json (written by the build, never cached) what is live, when
// it comes back to the foreground and every few minutes. If it is behind, it reloads at
// the next page change — the moment the person has just asked for a new screen anyway,
// so nothing half-typed on the current one is thrown away. On the login screen there is
// nothing to lose, so it reloads straight away.

const RUNNING = __BUILD_SHA__
const CHECK_EVERY_MS = 5 * 60 * 1000
const MIN_GAP_MS = 60 * 1000
const RELOADED_FOR = 'byond-reloaded-for'

const SAFE_TO_RELOAD_NOW = new Set(['/login', '/signup', '/'])

async function latestSha() {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return null
    const body = await res.json()
    return typeof body?.sha === 'string' ? body.sha : null
  } catch {
    return null   // offline or blocked: stay on what we have
  }
}

function reloadFor(sha) {
  // One reload per deployed version. If the CDN is still handing out the old page for a
  // moment, a second reload would not help and a loop would be far worse than waiting.
  try {
    if (sessionStorage.getItem(RELOADED_FOR) === sha) return
    sessionStorage.setItem(RELOADED_FOR, sha)
  } catch { /* storage blocked: reload once anyway */ }
  window.location.reload()
}

export default function VersionWatcher() {
  const { pathname } = useLocation()
  const staleFor = useRef(null)
  const lastCheck = useRef(0)
  const firstPath = useRef(true)

  // Asks what is live, at most once a minute. Kept in a ref so the page-change effect
  // below can call the same function.
  const check = useRef(async () => {
    if (RUNNING === 'dev') return
    if (Date.now() - lastCheck.current < MIN_GAP_MS) return
    lastCheck.current = Date.now()
    const sha = await latestSha()
    if (!sha || sha === RUNNING) return
    staleFor.current = sha
    if (SAFE_TO_RELOAD_NOW.has(window.location.pathname)) reloadFor(sha)
  })

  // Watch for a newer deploy.
  useEffect(() => {
    if (RUNNING === 'dev') return undefined
    const run = () => check.current()
    const onVisible = () => { if (document.visibilityState === 'visible') run() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    const timer = setInterval(run, CHECK_EVERY_MS)
    const first = setTimeout(run, 5000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      clearInterval(timer)
      clearTimeout(first)
    }
  }, [])

  // Swap to the new version on the next page change — and use the change as a moment to
  // ask, so someone who taps around without ever leaving the tab is caught too.
  useEffect(() => {
    if (firstPath.current) { firstPath.current = false; return }
    if (staleFor.current) reloadFor(staleFor.current)
    else check.current()
  }, [pathname])

  return null
}
