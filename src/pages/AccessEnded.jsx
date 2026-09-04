import { UserX, LogOut } from 'lucide-react'
import useAuthStore from '../store/authStore'

// What a person sees once their employment record is marked terminated.
//
// Migration 51 enforces this in get_user_company_id, the function about a hundred RLS
// policies resolve tenant scope through — the same lever suspension uses. That is the
// right place for it, and it takes the explanation with it: an ex-employee can read
// neither their own employee row nor their user_roles row, so without this screen they
// get an app full of empty pages, or worse, the "your login is not linked to an employee
// record" message, which is not true and tells them to ask HR to finish setting them up.
//
// Two things this page will not do.
//
// It does not say why. A termination can be a resignation, a redundancy or a dismissal,
// and the reason is between the person and their employer — the app has no business
// characterising it, and guessing wrong here would be worse than saying nothing.
//
// It does not point at BYOND support. This is not a billing problem and support cannot
// discuss somebody's employment with them. The only useful address is their own HR.

export default function AccessEnded() {
  const workspace = useAuthStore((s) => s.workspace)
  const signOut = useAuthStore((s) => s.signOut)
  const company = workspace?.company_name

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[#F5F5F0] dark:bg-[#0F0F0F]">
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] p-6 sm:p-8">
        <div className="w-14 h-14 rounded-full bg-[#A0A0A0]/15 flex items-center justify-center mb-5">
          <UserX size={28} className="text-[#666666] dark:text-[#A0A0A0]" />
        </div>

        <h1 className="text-xl font-bold text-[#1A1A1A] dark:text-white">Your access has ended</h1>
        {company && (
          <p className="text-sm font-semibold text-[#666666] dark:text-[#A0A0A0] mt-1">{company}</p>
        )}

        <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-4">
          This account no longer has access to the workspace because the employment record
          attached to it has been closed.
        </p>

        <div className="mt-6 pt-5 border-t border-[#E8E8E8] dark:border-[#2A2A2A] space-y-3">
          <p className="text-sm text-[#1A1A1A] dark:text-white">
            Your records have not been deleted. {company ?? 'Your employer'} keeps your
            attendance, leave and performance history for as long as the law requires.
          </p>
          <p className="text-sm text-[#666666] dark:text-[#A0A0A0]">
            If you need a copy of anything, or you think this is a mistake, speak to HR
            at {company ?? 'your company'}. They can restore access, and they are the only
            ones who can — BYOND cannot change an employment record on your behalf.
          </p>
        </div>

        {/* Without this the page is a dead end: the session is still valid, so signing in
            as somebody else is impossible until it expires. */}
        <button
          onClick={signOut}
          className="mt-6 inline-flex items-center gap-1.5 text-xs font-semibold text-[#666666] dark:text-[#A0A0A0] hover:text-[#00A57D] dark:hover:text-[#00D4A0]"
        >
          <LogOut size={13} /> Sign out
        </button>
      </div>
    </div>
  )
}
