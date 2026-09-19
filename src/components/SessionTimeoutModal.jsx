import { useEffect, useRef, useState, useCallback } from 'react'
import { Clock, LogOut, RefreshCw } from 'lucide-react'
import { useSessionTimeout } from '../hooks/useSessionTimeout'
import useAuthStore from '../store/authStore'

const WARN_SECONDS = 5 * 60  // 5 minutes to act before forced logout

export default function SessionTimeoutModal() {
  const signOut = useAuthStore((s) => s.signOut)
  const [showModal, setShowModal] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(WARN_SECONDS)
  const stayRef = useRef(null)

  const startCountdown = useCallback(() => {
    setSecondsLeft(WARN_SECONDS)
    setShowModal(true)
  }, [])

  const handleTimeout = useCallback(() => {
    setShowModal(false)
    signOut()
  }, [signOut])

  const handleStayLoggedIn = useCallback(() => {
    setShowModal(false)
    setSecondsLeft(WARN_SECONDS)
  }, [])

  const { resetActivity } = useSessionTimeout({
    onWarn: startCountdown,
    onTimeout: handleTimeout,
  })

  // Countdown timer while modal is visible
  useEffect(() => {
    if (!showModal) return

    const id = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(id)
          handleTimeout()
          return 0
        }
        return s - 1
      })
    }, 1000)

    return () => clearInterval(id)
  }, [showModal, handleTimeout])

  // Focus the safe action when the modal appears. It only appears after a stretch of
  // inactivity, so there is nobody mid-sentence to interrupt — and putting focus on
  // "Stay logged in" means the reflexive keypress of somebody coming back to their desk
  // keeps them signed in rather than ending the session they were trying to save.
  useEffect(() => {
    if (showModal) stayRef.current?.focus()
  }, [showModal])

  const mins = String(Math.floor(secondsLeft / 60)).padStart(2, '0')
  const secs = String(secondsLeft % 60).padStart(2, '0')

  if (!showModal) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="timeout-title"
        aria-describedby="timeout-body"
        className="w-full max-w-sm rounded-xl p-6 shadow-2xl
                   bg-white dark:bg-[#1E1E1E]
                   border border-[#E8E8E8] dark:border-[#2A2A2A]"
      >

        {/* Icon */}
        <div className="flex items-center justify-center mb-4">
          <div className="w-14 h-14 rounded-full bg-[#FF8C42]/10 flex items-center justify-center">
            <Clock size={28} className="text-[#B45309] dark:text-[#FF8C42]" aria-hidden="true" />
          </div>
        </div>

        {/* Title */}
        <h2
          id="timeout-title"
          className="text-lg font-semibold text-center mb-1 text-[#1A1A1A] dark:text-white"
        >
          Session Expiring Soon
        </h2>
        <p
          id="timeout-body"
          className="text-sm text-center mb-5 text-[#666666] dark:text-[#A0A0A0]"
        >
          You've been inactive. For your security, you'll be logged out automatically.
        </p>

        {/* Countdown.
            #FF8C42 is the amber this app uses for "you need to do something", but on a
            white card it sits near 2.4:1 — and this number is the whole point of the
            dialog, not decoration. Light mode gets a darker amber that clears 4.5:1;
            dark mode keeps the original, which is already well clear against #1E1E1E.

            aria-live so a screen reader is told the time is running out. "off" would
            leave somebody who cannot see the number with a dialog that silently signs
            them out mid-read; "polite" waits for a gap rather than interrupting. */}
        <div className="flex items-center justify-center mb-6">
          <span
            aria-live="polite"
            className="text-4xl font-bold tabular-nums text-[#B45309] dark:text-[#FF8C42]"
          >
            {mins}:{secs}
          </span>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            ref={stayRef}
            type="button"
            onClick={() => { handleStayLoggedIn(); resetActivity() }}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg
                       text-sm font-semibold transition-colors
                       bg-[#00D4A0] hover:bg-[#00B589] text-[#062B22]"
          >
            <RefreshCw size={15} aria-hidden="true" />
            Stay logged in
          </button>
          {/* One hover colour, not two. This carried `hover:text-white` AND
              `hover:text-danger` on the same element, which is not a cascade
              question the class order can settle — Tailwind emits its own order, so
              which one won was an accident of the build. */}
          <button
            type="button"
            onClick={handleTimeout}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg
                       text-sm font-semibold border transition-colors
                       border-[#E8E8E8] dark:border-[#2A2A2A]
                       text-[#666666] dark:text-[#A0A0A0]
                       hover:border-danger hover:text-danger"
          >
            <LogOut size={15} aria-hidden="true" />
            Logout
          </button>
        </div>
      </div>
    </div>
  )
}
