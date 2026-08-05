import { useState, useCallback } from 'react'
import { Check, AlertTriangle } from 'lucide-react'

// Bottom-right toast, mint on success / red on error, auto-dismisses.
// Usage: const { toast, showToast } = useToast(); ...<Toast toast={toast} />
export function useToast() {
  const [toast, setToast] = useState(null)

  const showToast = useCallback((type, msg) => {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 3500)
  }, [])

  return { toast, showToast }
}

export default function Toast({ toast }) {
  if (!toast) return null
  const isOk = toast.type === 'success'
  return (
    <div
      role="status"
      className={`fixed bottom-6 right-6 z-[60] flex items-center gap-3 px-5 py-3.5 rounded-xl border shadow-xl text-sm font-semibold max-w-sm ${
        isOk
          ? 'bg-[#00D4A0]/10 border-[#00D4A0]/30 text-[#00D4A0]'
          : 'bg-[#FF4D4D]/10 border-[#FF4D4D]/30 text-[#FF4D4D]'
      }`}
    >
      {isOk ? <Check size={15} className="shrink-0" /> : <AlertTriangle size={15} className="shrink-0" />}
      {toast.msg}
    </div>
  )
}
