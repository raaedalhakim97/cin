import { useCallback, useEffect, useState } from 'react'
import { X, Loader2, Copy, Check, Ban, Inbox } from 'lucide-react'
import supabase from '../../services/supabase'
import { INVITE_ROLE_LABEL, inviteLinkFor } from '../../utils/invite'
import EmptyState from '../EmptyState'
import { SkeletonRow } from '../Skeleton'

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Pending Invites — visible to super_admin/hr_manager/admin (matches
// employee_invites_select RLS). Revoke is a write, so it's gated to
// super_admin/hr_manager only (employee_invites_write RLS excludes admin,
// same read-only pattern as the rest of the Employees module for that role).
export default function PendingInvitesModal({ canRevoke, onClose, showToast, onChanged }) {
  const [invites, setInvites] = useState([])
  const [loading, setLoading] = useState(true)
  const [revokingId, setRevokingId] = useState(null)
  const [copiedId, setCopiedId] = useState(null)

  const fetchInvites = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('employee_invites')
      .select('id, email, role, created_at, expires_at, token')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
    if (error) console.error('[PendingInvitesModal] fetch failed', error)
    setInvites(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchInvites() }, [fetchInvites])

  async function revoke(invite) {
    setRevokingId(invite.id)
    const { error } = await supabase.from('employee_invites').update({ status: 'revoked' }).eq('id', invite.id)
    setRevokingId(null)
    if (error) {
      console.error('[PendingInvitesModal] revoke failed', error)
      showToast('error', 'Something went wrong revoking this invite. Please try again.')
      return
    }
    showToast('success', 'Invite revoked')
    fetchInvites()
    onChanged()
  }

  async function copyLink(invite) {
    try {
      await navigator.clipboard.writeText(inviteLinkFor(invite.token))
      setCopiedId(invite.id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch (err) {
      console.error('[PendingInvitesModal] clipboard write failed', err)
      showToast('error', 'Could not copy the link — please try again.')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-white dark:bg-[#1E1E1E] rounded-2xl border border-[#E8E8E8] dark:border-[#2A2A2A] shadow-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E8E8E8] dark:border-[#2A2A2A] shrink-0">
          <h2 className="text-base font-bold text-[#1A1A1A] dark:text-white">Pending Invites</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-[#666666] dark:text-[#A0A0A0] hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto">
          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => <SkeletonRow key={i} className="h-14" />)}
            </div>
          ) : invites.length === 0 ? (
            <EmptyState icon={Inbox} title="No pending invites" hint="Invited employees who haven't signed in yet will show up here." />
          ) : (
            <div className="space-y-2">
              {invites.map((inv) => {
                const expired = new Date(inv.expires_at) < new Date()
                return (
                  <div key={inv.id} className="flex items-center gap-3 p-3 rounded-lg border bg-[#F5F5F0] dark:bg-[#252525] border-[#E8E8E8] dark:border-[#2A2A2A]">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white truncate">{inv.email}</p>
                      <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">
                        {INVITE_ROLE_LABEL[inv.role] ?? inv.role} · Sent {formatDate(inv.created_at)} ·{' '}
                        {expired ? <span className="text-[#FF4D4D] font-semibold">Expired</span> : `Expires ${formatDate(inv.expires_at)}`}
                      </p>
                    </div>
                    <button
                      onClick={() => copyLink(inv)}
                      title="Copy invite link"
                      className={`shrink-0 w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                        copiedId === inv.id ? 'text-[#00D4A0]' : 'text-[#666666] dark:text-[#A0A0A0] hover:text-[#00D4A0]'
                      }`}
                    >
                      {copiedId === inv.id ? <Check size={15} /> : <Copy size={15} />}
                    </button>
                    {canRevoke && (
                      <button
                        onClick={() => revoke(inv)}
                        disabled={revokingId === inv.id}
                        title="Revoke invite"
                        className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-[#666666] dark:text-[#A0A0A0] hover:text-[#FF4D4D] disabled:opacity-50 transition-colors"
                      >
                        {revokingId === inv.id ? <Loader2 size={15} className="animate-spin" /> : <Ban size={15} />}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
