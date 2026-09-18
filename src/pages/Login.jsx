import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { Mail, Lock, Eye, EyeOff, Loader2 } from 'lucide-react'
import supabase from '../services/supabase'
import useAuthStore from '../store/authStore'
import { logLoginAttempt, getActiveSessionCount } from '../services/sessionService'
import Logo from '../components/Logo'
import LoginIntro from '../components/login/LoginIntro'
import BrandPanel from '../components/login/BrandPanel'

const MAX_CONCURRENT_SESSIONS = 2

// Three tiers, because six different outcomes were all arriving in the same red box.
//
// Red is a claim about the person: your password was wrong. It is the right colour for
// exactly one of these outcomes. Amber says the credentials were fine and something else
// needs doing — wait, reconnect, sign out elsewhere, confirm an address. Blue says the
// fault is ours and there is nothing for them to fix.
//
// The distinction matters because red on a server fault sends somebody chasing the one
// thing that is not broken, and the two-session cap is the worst case of that: the
// password was correct, and the old page told them it was a failure.
const NOTICE = {
  credential: { ink: '#FF4D4D', tint: 'rgba(255,77,77,0.10)',   edge: 'rgba(255,77,77,0.22)',   mark: '!' },
  action:     { ink: '#FF8C42', tint: 'rgba(255,140,66,0.10)',  edge: 'rgba(255,140,66,0.24)',  mark: '!' },
  server:     { ink: '#4D9FFF', tint: 'rgba(77,159,255,0.10)',  edge: 'rgba(77,159,255,0.24)',  mark: 'i' },
}

// Never show the user a raw error body.
//
// supabase-js builds its message as msg || message || error_description ||
// error || JSON.stringify(body). When the auth service failed on accounts whose
// token columns were NULL, none of those keys were present, so the login form
// displayed the literal string "{}" — which tells the person signing in
// nothing, and told us nothing either until we read the database directly.
//
// Known causes get a plain sentence. Anything unrecognised says so honestly
// rather than pretending the credentials were wrong, because "wrong password"
// on a server fault sends people chasing the one thing that is not broken.
//
// The tone rides along with the sentence rather than being worked out again at the call
// site: whoever adds the next case here picks its colour in the same breath as its wording,
// which is the only way the two stay in step.
function loginNotice(error) {
  const raw = (error?.message ?? '').trim()

  if (/invalid login credentials/i.test(raw)) {
    return { tone: 'credential', message: 'Email or password is incorrect.' }
  }
  if (/email not confirmed/i.test(raw)) {
    return { tone: 'action', message: 'Confirm your email address before signing in.' }
  }
  if (/email logins are disabled/i.test(raw)) {
    return { tone: 'action', message: 'Email sign-in is turned off for this workspace.' }
  }
  if (/rate limit|too many requests/i.test(raw)) {
    return { tone: 'action', message: 'Too many attempts. Wait a minute and try again.' }
  }
  if (/failed to fetch|networkerror|load failed/i.test(raw)) {
    return {
      tone: 'action',
      message: 'Could not reach the server. Check your connection and try again.',
    }
  }

  // Empty, or a JSON blob rather than a sentence.
  if (!raw || raw.startsWith('{') || raw.startsWith('[')) {
    return {
      tone: 'server',
      message:
        'Sign-in failed on the server, not because of your password. ' +
        'Please try again, and tell your administrator if it keeps happening.',
    }
  }

  // Unrecognised. The one thing we know is that it is not a credential rejection, so it
  // does not get the colour that says it is.
  return { tone: 'server', message: raw }
}

function Notice({ tone, message }) {
  const t = NOTICE[tone] ?? NOTICE.server

  return (
    <div
      role="alert"
      className="flex items-start gap-[9px] px-[15px] py-[13px] rounded-lg border"
      style={{ background: t.tint, borderColor: t.edge }}
    >
      <span
        aria-hidden="true"
        className="w-4 h-4 mt-px shrink-0 rounded-full flex items-center justify-center
                   text-[11px] font-bold leading-none"
        style={{ color: t.ink, border: `1.5px solid ${t.ink}` }}
      >
        {t.mark}
      </span>
      <p className="text-[13px] leading-relaxed text-[#1A1A1A] dark:text-white text-pretty">
        {message}
      </p>
    </div>
  )
}

// The bordered box is the control; the input inside it is bare. Doing it the other way —
// an input with its own border and an absolutely positioned icon on top — is what the old
// page did, and it meant the icon overlapped the text on a long address.
const FIELD_BOX =
  'flex items-center gap-[9px] px-3.5 py-3 lg:py-[11px] rounded-lg border transition-colors ' +
  'bg-[#F5F5F0] dark:bg-[#0F0F0F]'

const FIELD_INPUT =
  'flex-1 min-w-0 bg-transparent text-sm focus:outline-none ' +
  'text-[#1A1A1A] dark:text-white placeholder-[#6E6E6E] dark:placeholder-[#8A8A8A]'

// A field in error does not get the mint focus border, and that is the point rather than an
// omission. react-hook-form focuses the first invalid field on submit, so the two rules
// land on the same element at the same instant — and a variant beats a plain utility
// whatever order they are written in. The result was a mint box with "Email is required"
// under it in red, which is two answers to one question. Red holds until it is fixed.
function fieldBox(hasError) {
  return `${FIELD_BOX} ${
    hasError
      ? 'border-[#FF4D4D]'
      : 'border-[#E8E8E8] dark:border-[#2A2A2A] focus-within:border-[#00D4A0]'
  }`
}

export default function Login() {
  const navigate = useNavigate()
  const registerSession = useAuthStore((s) => s.registerSession)
  const loadProfile = useAuthStore((s) => s.loadProfile)
  const { register, handleSubmit, formState: { errors } } = useForm()
  const [notice, setNotice] = useState(null)
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const onSubmit = async ({ email, password }) => {
    setLoading(true)
    setNotice(null)

    // Attempt sign-in
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    // Log the attempt regardless of outcome
    await logLoginAttempt(email, !error)

    if (error) {
      // Keep the unmapped original in the console for whoever debugs it.
      console.error('[Login] sign-in failed', error)
      setNotice(loginNotice(error))
      setLoading(false)
      return
    }

    // Check concurrent session limit
    const activeCount = await getActiveSessionCount()
    if (activeCount >= MAX_CONCURRENT_SESSIONS) {
      await supabase.auth.signOut()
      // Amber, not red. The password was right; what is missing is a free slot.
      //
      // The design board proposed a "Sign out my other devices" button here. It is not
      // built: revoking user_sessions rows for somebody who is, at this instant, signed
      // out again is a backend change with a security shape of its own, not a piece of
      // this page. Until it exists, the sentence is the whole of the honest answer.
      setNotice({
        tone: 'action',
        message:
          `Maximum ${MAX_CONCURRENT_SESSIONS} concurrent sessions allowed. ` +
          'Please sign out from another device first.',
      })
      setLoading(false)
      return
    }

    // Register this session in user_sessions
    await registerSession(data.session.access_token)

    // Populate role/companyId/employee before navigating — onAuthStateChange
    // would eventually do this too, but asynchronously, which raced against the
    // navigate() below and could bounce PrivateRoute back to /login before the
    // store had a session.
    await loadProfile(data.session)

    navigate('/dashboard')
  }

  return (
    <LoginIntro>
      <div className="min-h-screen flex bg-[#F5F5F0] dark:bg-[#0F0F0F]">
        <BrandPanel />

        <div className="flex-1 min-w-0 flex items-center justify-center px-5 py-10 lg:p-11">
          <div className="w-full max-w-[400px]">

            {/* The panel cannot survive a phone, so below lg it collapses to the mark, the
                wordmark and the one line of the acronym the product already treats as its
                own. */}
            <div className="lg:hidden flex flex-col items-center gap-4 mb-7">
              <Logo size="xl" showWordmark={false} />
              <span className="text-2xl font-extrabold tracking-tight text-[#1A1A1A] dark:text-white">
                BY<span className="text-[#00D4A0]">O</span>ND
              </span>
              <div className="flex items-baseline gap-[9px]">
                <span className="text-[15px] font-extrabold text-[#00D4A0]">O</span>
                <span className="text-[13px] font-medium text-[#6E6E6E] dark:text-[#8A8A8A]">
                  Outstanding
                </span>
              </div>
            </div>

            <h1 className="text-2xl lg:text-[28px] font-bold tracking-tight text-center lg:text-left text-[#1A1A1A] dark:text-white">
              Welcome back
            </h1>
            <p className="mt-1.5 mb-7 text-[13px] lg:text-sm text-center lg:text-left text-[#6E6E6E] dark:text-[#A0A0A0]">
              Sign in to BYOND HR
            </p>

            <div className="p-5 lg:p-7 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
              <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-[18px] lg:gap-5">

                {/* Email */}
                <div>
                  <label
                    htmlFor="login-email"
                    className="block mb-[7px] text-[13px] font-medium text-[#1A1A1A] dark:text-white"
                  >
                    Email
                  </label>
                  <div className={fieldBox(Boolean(errors.email))}>
                    <Mail
                      size={15}
                      aria-hidden="true"
                      className="shrink-0 text-[#6E6E6E] dark:text-[#8A8A8A]"
                    />
                    <input
                      id="login-email"
                      type="email"
                      autoComplete="email"
                      placeholder="you@company.com"
                      className={FIELD_INPUT}
                      {...register('email', {
                        required: 'Email is required',
                        pattern: { value: /\S+@\S+\.\S+/, message: 'Invalid email address' },
                      })}
                    />
                  </div>
                  {errors.email && (
                    <p className="mt-1.5 text-xs text-[#FF4D4D]">{errors.email.message}</p>
                  )}
                </div>

                {/* Password */}
                <div>
                  <label
                    htmlFor="login-password"
                    className="block mb-[7px] text-[13px] font-medium text-[#1A1A1A] dark:text-white"
                  >
                    Password
                  </label>
                  <div className={fieldBox(Boolean(errors.password))}>
                    <Lock
                      size={15}
                      aria-hidden="true"
                      className="shrink-0 text-[#6E6E6E] dark:text-[#8A8A8A]"
                    />
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder="••••••••"
                      className={FIELD_INPUT}
                      {...register('password', { required: 'Password is required' })}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="shrink-0 text-[#6E6E6E] dark:text-[#8A8A8A]
                                 hover:text-[#1A1A1A] dark:hover:text-white transition-colors"
                    >
                      {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  {errors.password && (
                    <p className="mt-1.5 text-xs text-[#FF4D4D]">{errors.password.message}</p>
                  )}
                </div>

                {notice && <Notice tone={notice.tone} message={notice.message} />}

                {/* Ink is #062B22, not white. White on mint sits at about 2.0:1, which made
                    the one button on the page the least readable thing on it. */}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full min-h-[44px] flex items-center justify-center gap-[9px]
                             px-[18px] py-3 rounded-lg text-sm font-semibold text-[#062B22]
                             bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors"
                >
                  {loading && <Loader2 size={14} className="animate-spin" />}
                  {loading ? 'Signing in…' : 'Sign in'}
                </button>
              </form>
            </div>

            {/* The design board put "Forgot password?" on the label row. It is not here,
                because there is no password-reset route and no email service to carry one —
                the same reason invites are still handed over as links. A link promising a
                message that will never arrive is worse than no link. This sentence is what
                is actually true today, and it covers the person who never set a password as
                well as the one who forgot theirs. */}
            <p className="mt-5 text-xs leading-relaxed text-center lg:text-left text-[#6E6E6E] dark:text-[#8A8A8A] text-pretty">
              Forgotten your password, or never set one? Ask your HR team to send you an
              invite link — it sets a new password and signs you in.
            </p>

            <p className="lg:hidden mt-7 text-xs text-center text-[#6E6E6E] dark:text-[#8A8A8A]">
              BYOND by SERVA &mdash; HR Platform
            </p>

            {/* The build stamp, again, because the one in the sidebar is unreachable from
                here — this is the signed-out half of the product, and "is this even the new
                build?" is a question that gets asked about this page more than any other.
                Answering it required signing in, which is the wrong way round. */}
            <p
              title={`Built ${__BUILD_TIME__}`}
              className="mt-4 text-[10px] font-mono text-center lg:text-left
                         text-[#AAAAAA] dark:text-[#555555] select-all"
            >
              {__BUILD_SHA__}
            </p>
          </div>
        </div>
      </div>
    </LoginIntro>
  )
}
