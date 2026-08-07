import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Lock, Eye, EyeOff, Loader2, AlertCircle, MailCheck, ShieldOff } from 'lucide-react'
import supabase from '../services/supabase'
import useAuthStore from '../store/authStore'
import Logo from '../components/Logo'
import { savePendingInviteToken, acceptEmployeeInvite, INVITE_ROLE_LABEL } from '../utils/invite'

const INVALID_REASON_MESSAGE = {
  not_found: "This invite link isn't valid.",
  expired: 'This invite has expired. Ask your HR team to send you a new one.',
  accepted: 'This invite has already been used.',
  revoked: 'This invite has been revoked.',
}

function Shell({ children }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[#F5F5F0] dark:bg-[#0F0F0F]">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="inline-flex justify-center mb-4">
            <Link to="/" aria-label="BYOND home">
              <Logo size="md" />
            </Link>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

export default function AcceptInvite() {
  const { token } = useParams()
  const navigate = useNavigate()
  const loadProfile = useAuthStore((s) => s.loadProfile)

  const [previewState, setPreviewState] = useState('loading') // 'loading' | 'valid' | 'invalid'
  const [preview, setPreview] = useState(null) // { company_name, role, email }
  const [invalidReason, setInvalidReason] = useState('not_found')

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState('')
  const [step, setStep] = useState('form') // 'form' | 'check-email'

  useEffect(() => {
    let cancelled = false
    supabase.rpc('get_invite_preview', { p_token: token }).then(({ data, error }) => {
      if (cancelled) return
      if (error || !data?.valid) {
        if (error) console.error('[AcceptInvite] get_invite_preview failed', error)
        setInvalidReason(data?.reason ?? 'not_found')
        setPreviewState('invalid')
        return
      }
      setPreview(data)
      setPreviewState('valid')
    })
    return () => { cancelled = true }
  }, [token])

  async function onSubmit(e) {
    e.preventDefault()
    setServerError('')
    if (password.length < 8) { setServerError('Password must be at least 8 characters'); return }
    if (password !== confirmPassword) { setServerError('Passwords do not match'); return }

    setSubmitting(true)
    const { data, error } = await supabase.auth.signUp({ email: preview.email, password })

    if (error) {
      setServerError(error.message)
      setSubmitting(false)
      return
    }

    if (data.session) {
      const { error: acceptError } = await acceptEmployeeInvite(supabase, token)
      if (acceptError) {
        // accept_employee_invite's exceptions are hand-written for end users
        // (e.g. "This invite has expired", "This invite was issued for a
        // different email address") — shown verbatim, same as the shift
        // module's DB validation messages, rather than a generic fallback.
        console.error('[AcceptInvite] accept_employee_invite failed', acceptError)
        setServerError(acceptError.message)
        setSubmitting(false)
        return
      }
      await loadProfile(data.session)
      navigate('/dashboard')
      return
    }

    // Email confirmation is ON — no session yet. accept_employee_invite runs
    // on this user's first authenticated visit instead (see App.jsx).
    savePendingInviteToken(token)
    setStep('check-email')
    setSubmitting(false)
  }

  if (previewState === 'loading') {
    return (
      <Shell>
        <div className="flex justify-center py-12">
          <Loader2 size={24} className="animate-spin text-[#00D4A0]" />
        </div>
      </Shell>
    )
  }

  if (previewState === 'invalid') {
    return (
      <Shell>
        <div className="rounded-xl p-8 bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] text-center">
          <div className="w-12 h-12 rounded-xl bg-[#FF4D4D]/10 flex items-center justify-center mx-auto mb-4">
            <ShieldOff size={22} className="text-[#FF4D4D]" />
          </div>
          <h1 className="text-lg font-bold text-[#1A1A1A] dark:text-white">Invite not available</h1>
          <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-2">
            {INVALID_REASON_MESSAGE[invalidReason] ?? INVALID_REASON_MESSAGE.not_found}
          </p>
          <Link to="/login" className="inline-block mt-6 text-sm text-[#00D4A0] hover:underline">
            Back to log in
          </Link>
        </div>
      </Shell>
    )
  }

  if (step === 'check-email') {
    return (
      <Shell>
        <div className="rounded-xl p-8 bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] text-center">
          <div className="w-12 h-12 rounded-xl bg-[#00D4A0]/10 flex items-center justify-center mx-auto mb-4">
            <MailCheck size={22} className="text-[#00D4A0]" />
          </div>
          <h1 className="text-lg font-bold text-[#1A1A1A] dark:text-white">Check your email to confirm</h1>
          <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-2">
            We sent a confirmation link to <span className="font-medium text-[#1A1A1A] dark:text-white">{preview.email}</span>.
            Once confirmed, log in and your account will be linked to {preview.company_name} automatically.
          </p>
          <Link to="/login" className="inline-block mt-6 text-sm text-[#00D4A0] hover:underline">
            Back to log in
          </Link>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <div className="text-center mb-6">
        <h1 className="text-xl font-bold text-[#1A1A1A] dark:text-white">
          You've been invited to join {preview.company_name}
        </h1>
        <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1">
          as {INVITE_ROLE_LABEL[preview.role] ?? preview.role}
        </p>
      </div>

      <div className="rounded-xl p-8 bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
        <form onSubmit={onSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-[#1A1A1A] dark:text-white mb-1.5">Email</label>
            <input
              type="email"
              value={preview.email}
              readOnly
              disabled
              className="w-full px-3.5 py-2.5 rounded-lg text-sm bg-[#F5F5F0] dark:bg-[#0F0F0F] text-[#666666] dark:text-[#A0A0A0] border border-[#E8E8E8] dark:border-[#2A2A2A] cursor-not-allowed"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[#1A1A1A] dark:text-white mb-1.5">Password</label>
            <div className="relative">
              <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#AAAAAA] dark:text-[#555555] pointer-events-none" />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-9 pr-10 py-2.5 rounded-lg text-sm bg-[#F5F5F0] dark:bg-[#0F0F0F] text-[#1A1A1A] dark:text-white placeholder-[#AAAAAA] dark:placeholder-[#555555] border border-[#E8E8E8] dark:border-[#2A2A2A] focus:outline-none focus:border-[#00D4A0] transition-colors"
                required
                minLength={8}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#AAAAAA] dark:text-[#555555] hover:text-[#666666] dark:hover:text-[#A0A0A0] transition-colors"
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#1A1A1A] dark:text-white mb-1.5">Confirm Password</label>
            <div className="relative">
              <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#AAAAAA] dark:text-[#555555] pointer-events-none" />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Re-enter your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 rounded-lg text-sm bg-[#F5F5F0] dark:bg-[#0F0F0F] text-[#1A1A1A] dark:text-white placeholder-[#AAAAAA] dark:placeholder-[#555555] border border-[#E8E8E8] dark:border-[#2A2A2A] focus:outline-none focus:border-[#00D4A0] transition-colors"
                required
              />
            </div>
          </div>

          {serverError && (
            <div className="flex items-start gap-2 px-4 py-3 rounded-lg text-sm text-[#FF4D4D] bg-[#FF4D4D]/10 border border-[#FF4D4D]/20">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              {serverError}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors"
          >
            {submitting && <Loader2 size={15} className="animate-spin" />}
            {submitting ? 'Setting up your account…' : 'Accept Invite & Sign In'}
          </button>
        </form>
      </div>

      <p className="text-center text-xs text-[#AAAAAA] dark:text-[#555555] mt-6">
        Already have an account? <Link to="/login" className="text-[#00D4A0] hover:underline">Log in</Link>
      </p>
    </Shell>
  )
}
