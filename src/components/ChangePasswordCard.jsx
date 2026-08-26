import { useState } from 'react'
import { Eye, EyeOff, KeyRound, Loader2, Lock } from 'lucide-react'
import supabase from '../services/supabase'
import useAuthStore from '../store/authStore'
import { endUserSession } from '../services/sessionService'

// Changing your own password. Lives on /profile rather than /settings because
// every Settings tab is admin-only, and this has to be reachable by an employee
// and a read_only account too.
//
// Deliberately NOT gated on having a linked employee record: an auth user whose
// profile was never linked still has a password, and is exactly the person most
// likely to need to change it.

const INPUT =
  'w-full pl-9 pr-10 py-2.5 rounded-lg text-sm bg-[#F5F5F0] dark:bg-[#0F0F0F] text-[#1A1A1A] dark:text-white ' +
  'placeholder-[#AAAAAA] dark:placeholder-[#555555] border border-[#E8E8E8] dark:border-[#2A2A2A] ' +
  'focus:outline-none focus:border-[#00D4A0] transition-colors'

// Matches Signup.jsx. Supabase's own floor is lower, so this is the binding
// constraint in practice — keep the two in step if either moves.
const MIN_LENGTH = 8

function PasswordField({ id, label, value, onChange, placeholder, autoComplete }) {
  const [visible, setVisible] = useState(false)
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-[#1A1A1A] dark:text-white mb-1.5">
        {label}
      </label>
      <div className="relative">
        <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#AAAAAA] dark:text-[#555555] pointer-events-none" />
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className={INPUT}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[#AAAAAA] dark:text-[#555555] hover:text-[#666666] dark:hover:text-[#A0A0A0] transition-colors"
        >
          {visible ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
    </div>
  )
}

export default function ChangePasswordCard({ showToast }) {
  const sessionToken   = useAuthStore((s) => s.sessionToken)
  const registerSession = useAuthStore((s) => s.registerSession)

  const [current, setCurrent] = useState('')
  const [next, setNext]       = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError]     = useState('')
  const [saving, setSaving]   = useState(false)

  function clear() {
    setCurrent('')
    setNext('')
    setConfirm('')
  }

  async function onSubmit(e) {
    e.preventDefault()
    setError('')

    if (!current)                 return setError('Enter your current password')
    if (next.length < MIN_LENGTH) return setError(`New password must be at least ${MIN_LENGTH} characters`)
    if (next !== confirm)         return setError('The two new passwords do not match')
    if (next === current)         return setError('Your new password must be different from your current one')

    setSaving(true)

    const { data: userData } = await supabase.auth.getUser()
    const email = userData?.user?.email
    if (!email) {
      setSaving(false)
      return setError('Could not read your account. Sign out and back in, then try again.')
    }

    // Supabase's updateUser() will change a password on the strength of a valid
    // session alone — it never asks for the old one. That means a stolen session
    // could lock the real owner out of their own account. So prove the current
    // password first. A failed attempt here does not disturb the live session.
    const { error: reauthError } = await supabase.auth.signInWithPassword({ email, password: current })
    if (reauthError) {
      setSaving(false)
      return setError('Current password is incorrect')
    }

    const { error: updateError } = await supabase.auth.updateUser({ password: next })
    if (updateError) {
      setSaving(false)
      return setError(updateError.message || 'Could not change your password. Please try again.')
    }

    // The whole point of changing a password is usually that someone else has it.
    // Leaving their session alive would defeat the exercise. 'others' revokes every
    // session but this one and fires no sign-out event here, so the user stays put.
    await supabase.auth.signOut({ scope: 'others' })

    // Re-authenticating minted a new access token, so the row this device holds in
    // user_sessions now points at a token that no longer exists. Retire the old row
    // and register the live one, or the concurrent-session count drifts upward and
    // starts refusing logins the user is entitled to.
    //
    // Other devices keep their user_sessions rows until they expire. Those rows are
    // cosmetic at this point — the tokens behind them were revoked above.
    const { data: sessionData } = await supabase.auth.getSession()
    const freshToken = sessionData?.session?.access_token
    if (freshToken && freshToken !== sessionToken) {
      if (sessionToken) await endUserSession(sessionToken)
      await registerSession(freshToken)
    }

    setSaving(false)
    clear()
    showToast('success', 'Password changed — any other devices have been signed out')
  }

  return (
    <div className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
      <div className="flex items-center gap-2.5 mb-1">
        <KeyRound size={15} className="text-[#00D4A0]" />
        <h3 className="text-base font-semibold text-[#1A1A1A] dark:text-white">Password</h3>
      </div>
      <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mb-5">
        Changing your password signs you out everywhere else.
      </p>

      <form onSubmit={onSubmit} className="space-y-4 max-w-sm">
        <PasswordField
          id="current-password"
          label="Current password"
          value={current}
          onChange={setCurrent}
          placeholder="Your password today"
          autoComplete="current-password"
        />
        <PasswordField
          id="new-password"
          label="New password"
          value={next}
          onChange={setNext}
          placeholder={`At least ${MIN_LENGTH} characters`}
          autoComplete="new-password"
        />
        <PasswordField
          id="confirm-password"
          label="Confirm new password"
          value={confirm}
          onChange={setConfirm}
          placeholder="Type it once more"
          autoComplete="new-password"
        />

        {error && <p className="text-xs text-[#FF4D4D]">{error}</p>}

        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold bg-[#00D4A0] text-white hover:bg-[#00BE90] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving && <Loader2 size={15} className="animate-spin" />}
          {saving ? 'Changing…' : 'Change password'}
        </button>
      </form>
    </div>
  )
}
