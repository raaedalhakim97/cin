import { useEffect, useRef, useCallback } from 'react'

const WARNING_MS = 25 * 60 * 1000  // 25 minutes idle → show warning
const TIMEOUT_MS = 30 * 60 * 1000  // 30 minutes idle → force logout
const CHECK_INTERVAL_MS = 30_000   // poll every 30 seconds

export function useSessionTimeout({ onWarn, onTimeout }) {
  const lastActivity = useRef(Date.now())
  const warned = useRef(false)

  const resetActivity = useCallback(() => {
    lastActivity.current = Date.now()
    warned.current = false
  }, [])

  useEffect(() => {
    const events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll', 'click']
    events.forEach((e) => window.addEventListener(e, resetActivity, { passive: true }))

    const interval = setInterval(() => {
      const idle = Date.now() - lastActivity.current

      if (idle >= TIMEOUT_MS) {
        onTimeout()
      } else if (idle >= WARNING_MS && !warned.current) {
        warned.current = true
        onWarn()
      }
    }, CHECK_INTERVAL_MS)

    return () => {
      events.forEach((e) => window.removeEventListener(e, resetActivity))
      clearInterval(interval)
    }
  }, [onWarn, onTimeout, resetActivity])

  return { resetActivity }
}
