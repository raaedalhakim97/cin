import { PauseCircle, Mail, LogOut } from 'lucide-react'
import useAuthStore from '../store/authStore'

// What a person sees when their company's plan stops granting access.
//
// Migration 25 enforces suspension in get_user_company_id, which every tenant RLS
// policy resolves through. That is the right place for it — nothing can route around
// it — but it takes the explanation with it: a suspended workspace can read neither
// its `company` row nor its own `user_roles` row, so without this screen the app is
// a set of empty pages with no reason given, indistinguishable from a bug.
//
// Everything on this page comes from my_workspace(), the one reader that answers
// while the gate is shut.
//
// The audience splits, and the split matters more than the wording. An owner can act
// — pay the invoice, call BYOND. An employee cannot, and telling them to contact
// BYOND about their employer's account sends them somewhere that will not help them
// and cannot legally discuss it. So they are told who can.

const SUPPORT = 'support@byondhr.com'

// 'cancelled' is a different sentence from 'suspended': one is a pause with an
// expectation of coming back, the other is closed. Both land here because both stop
// granting access, but a customer who cancelled deliberately should not be told to
// settle an invoice.
const COPY = {
  suspended: {
    title: 'This workspace is suspended',
    lead: 'Access is paused while the account is settled. Nothing has been deleted.',
    ownerAction: 'Contact BYOND to restore access.',
  },
  cancelled: {
    title: 'This workspace is closed',
    lead: 'The subscription has ended. Records are retained, not deleted.',
    ownerAction: 'Contact BYOND if you need it reopened, or need an export of your data.',
  },
}

const DATE = (d) =>
  d ? new Date(d).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' }) : null

// Who can actually do something about it. hr_manager is included because in a
// company small enough to be on a trial, HR and finance are often the same desk.
const CAN_ACT = ['super_admin', 'hr_manager']

export default function WorkspaceSuspended() {
  const workspace = useAuthStore((s) => s.workspace)
  const signOut = useAuthStore((s) => s.signOut)

  const copy = COPY[workspace?.plan] ?? COPY.suspended
  const company = workspace?.company_name
  const since = DATE(workspace?.plan_changed_at)
  const canAct = CAN_ACT.includes(workspace?.role)

  const subject = encodeURIComponent(`Workspace access — ${company ?? 'BYOND'}`)

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[#F5F5F0] dark:bg-[#0F0F0F]">
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] p-6 sm:p-8">
        <div className="w-14 h-14 rounded-full bg-[#FF8C42]/10 flex items-center justify-center mb-5">
          <PauseCircle size={28} className="text-[#FF8C42]" />
        </div>

        <h1 className="text-xl font-bold text-[#1A1A1A] dark:text-white">{copy.title}</h1>
        {company && (
          <p className="text-sm font-semibold text-[#666666] dark:text-[#A0A0A0] mt-1">
            {company}
            {since ? ` · since ${since}` : ''}
          </p>
        )}

        <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-4">{copy.lead}</p>

        {/* The operator's note. Written in the console under a label that says it is
            shown to the workspace, so it is safe to render verbatim — and it is
            usually the only sentence on this page that answers "why". */}
        {workspace?.plan_note && (
          <blockquote className="mt-4 px-4 py-3 rounded-lg text-sm text-[#1A1A1A] dark:text-white bg-[#F5F5F0] dark:bg-[#0F0F0F] border-l-2 border-[#FF8C42]">
            {workspace.plan_note}
          </blockquote>
        )}

        <div className="mt-6 pt-5 border-t border-[#E8E8E8] dark:border-[#2A2A2A]">
          {canAct ? (
            <>
              <p className="text-sm text-[#1A1A1A] dark:text-white font-semibold">{copy.ownerAction}</p>
              <a
                href={`mailto:${SUPPORT}?subject=${subject}`}
                className="mt-3 inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-[#0F0F0F] bg-[#00D4A0] hover:bg-[#00C090]"
              >
                <Mail size={15} /> Email {SUPPORT}
              </a>
            </>
          ) : (
            <p className="text-sm text-[#666666] dark:text-[#A0A0A0]">
              Your attendance, leave and payroll records are safe. Ask whoever manages
              BYOND at {company ?? 'your company'} — this is settled between them and BYOND, and
              support cannot discuss your employer&apos;s account with you.
            </p>
          )}
        </div>

        {/* Without this the page is a dead end: the session is valid, so signing in as
            somebody else is impossible until it expires. */}
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
