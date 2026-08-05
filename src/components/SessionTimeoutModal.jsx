import { useEffect, useState, useCallback } from 'react'
import { Clock, LogOut, RefreshCw } from 'lucide-react'
import { useSessionTimeout } from '../hooks/useSessionTimeout'
import useAuthStore from '../store/authStore'

const WARN_SECONDS = 5 * 60  // 5 minutes to act before forced logout

export default function SessionTimeoutModal() {
  const signOut = useAuthStore((s) => s.signOut)
  const [showModal, setShowModal] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(WARN_SECONDS)
  const countdownRef = { current: null }

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

  const mins = String(Math.floor(secondsLeft / 60)).padStart(2, '0')
  const secs = String(secondsLeft % 60).padStart(2, '0')

  if (!showModal) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl border border-[#2A2A2A] bg-[#1E1E1E] p-6 shadow-2xl">

        {/* Icon */}
        <div className="flex items-center justify-center mb-4">
          <div className="w-14 h-14 rounded-full bg-[#FF8C42]/10 flex items-center justify-center">
            <Clock size={28} className="text-[#FF8C42]" />
          </div>
        </div>

        {/* Title */}
        <h2 className="text-lg font-semibold text-white text-center mb-1">
          Session Expiring Soon
        </h2>
        <p className="text-sm text-[#A0A0A0] text-center mb-5">
          You've been inactive. For your security, you'll be logged out automatically.
        </p>

        {/* Countdown */}
        <div className="flex items-center justify-center mb-6">
          <span className="text-4xl font-bold text-[#FF8C42] tabular-nums">
            {mins}:{secs}
          </span>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={() => { handleStayLoggedIn(); resetActivity() }}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold bg-[#00D4A0] hover:bg-[#00B589] text-white transition-colors"
          >
            <RefreshCw size={15} />
            Stay logged in
          </button>
          <button
            onClick={handleTimeout}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold border border-[#2A2A2A] text-[#A0A0A0] hover:text-white hover:border-[#FF4D4D] hover:text-[#FF4D4D] transition-colors"
          >
            <LogOut size={15} />
            Logout
          </button>
        </div>
      </div>
    </div>
  )
}
