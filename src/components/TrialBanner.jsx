import { useState } from 'react'
import { Sparkles, X } from 'lucide-react'
import useAuthStore from '../store/authStore'

const DISMISS_KEY = 'byond_trial_banner_dismissed'

export default function TrialBanner() {
  const company = useAuthStore((s) => s.company)
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(DISMISS_KEY) === '1')
  // Lazy initializer, not a direct Date.now() call in the render body — only
  // evaluated once per mount, which is precise enough for a "days remaining" display.
  const [now] = useState(() => Date.now())

  if (dismissed || company?.plan !== 'trial' || !company.trial_ends_at) return null

  const daysRemaining = Math.ceil(
    (new Date(company.trial_ends_at).getTime() - now) / (1000 * 60 * 60 * 24)
  )

  function handleDismiss() {
    sessionStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
  }

  return (
    <div className="flex items-center justify-between gap-3 px-6 py-2 bg-[#00D4A0]/10 border-b border-[#00D4A0]/20">
      <div className="flex items-center gap-2 text-sm font-medium text-[#00B589] dark:text-[#00D4A0]">
        <Sparkles size={14} className="shrink-0" />
        {daysRemaining > 0
          ? `Trial — ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining`
          : 'Your trial has ended'}
      </div>
      <button
        onClick={handleDismiss}
        aria-label="Dismiss"
        className="text-[#00B589] dark:text-[#00D4A0] hover:opacity-70 transition-opacity"
      >
        <X size={14} />
      </button>
    </div>
  )
}
