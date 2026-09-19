import { useEffect, useRef } from 'react'
import { LogOut } from 'lucide-react'

// A confirmation on sign-out, which is not as obviously correct as it sounds.
//
// Signing out is a SECURITY action. On a reception desk or a shop-floor PC, the gap
// between "I am leaving" and "I am out" should be as short as it can be, and a dialog
// somebody walks away from leaves them signed in — the opposite of what they intended.
// That is why Gmail, Slack and most HR products do not confirm it: it is reversible,
// and friction in front of it has a real cost.
//
// It is here because the other side is real too. "Sign out" sits at the foot of the
// sidebar, one row below the last nav item, in a product full of long forms — adding an
// employee, writing an appraisal, filing a leave request. A mis-tap there discards
// everything typed and there is no recovery. (A comment in Sidebar.jsx used to call it
// "the one control nobody clicks by accident". Raaed clicked it by accident.)
//
// So the design answers both: it cannot be dismissed by accident, and it cannot slow
// anybody down who meant it.
//
//   · Focus lands on "Stay signed in", never on the sign-out button. A stray Enter or
//     Space — the keys somebody is most likely to hit right after clicking — cancels.
//   · Escape cancels. So does clicking the backdrop.
//   · Sign out is one key away regardless: Tab, Enter. Nobody is trapped here.
//
// The button shapes are the ones SessionTimeoutModal already uses for this same choice:
// staying is the filled mint action, leaving is the outlined one. Two dialogs offering
// the same decision should not disagree about which button is which.
export default function SignOutDialog({ onConfirm, onCancel }) {
  const stayRef = useRef(null)

  useEffect(() => {
    stayRef.current?.focus()

    function onKey(e) {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div
      // Above the sidebar, which is z-50 — this is opened FROM the sidebar, so anything
      // lower renders underneath the thing that launched it.
      className="fixed inset-0 z-[60] flex items-center justify-center p-4
                 bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="signout-title"
        aria-describedby="signout-body"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl p-6 shadow-2xl
                   bg-white dark:bg-[#1E1E1E]
                   border border-[#E8E8E8] dark:border-[#2A2A2A]"
      >
        <div className="flex items-center justify-center mb-4">
          <div className="w-14 h-14 rounded-full bg-[#FF8C42]/10 flex items-center justify-center">
            <LogOut size={26} className="text-[#FF8C42]" aria-hidden="true" />
          </div>
        </div>

        <h2
          id="signout-title"
          className="text-lg font-semibold text-center mb-1 text-[#1A1A1A] dark:text-white"
        >
          Sign out of BYOND?
        </h2>
        {/* Says what is actually at stake. "Are you sure?" asks a question the person
            cannot answer without knowing the cost, and the cost here is unsaved work. */}
        <p
          id="signout-body"
          className="text-sm text-center mb-6 text-[#666666] dark:text-[#A0A0A0] text-pretty"
        >
          Anything you have typed and not saved will be lost. You will need your password
          to sign back in.
        </p>

        <div className="flex gap-3">
          <button
            ref={stayRef}
            type="button"
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors
                       bg-[#00D4A0] hover:bg-[#00B589] text-[#062B22]"
          >
            Stay signed in
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg
                       text-sm font-semibold border transition-colors
                       border-[#E8E8E8] dark:border-[#2A2A2A]
                       text-[#666666] dark:text-[#A0A0A0]
                       hover:border-[#FF4D4D] hover:text-[#FF4D4D]"
          >
            <LogOut size={15} aria-hidden="true" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
