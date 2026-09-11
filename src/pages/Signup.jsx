import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { Mail, Lock, Eye, EyeOff, Loader2, AlertCircle, User, Building2, Sparkles, MailCheck } from 'lucide-react'
import supabase from '../services/supabase'
import { authErrorMessage } from '../utils/authErrors'
import useAuthStore from '../store/authStore'
import Logo from '../components/Logo'
import {
  savePendingSignup,
  runSelfOnboard,
  clearPendingSignup,
  isAlreadyOnboardedError,
  countryDefaultsFor,
  COUNTRY_OPTIONS,
} from '../utils/onboarding'

export default function Signup() {
  const navigate = useNavigate()
  const loadProfile = useAuthStore((s) => s.loadProfile)
  const { register, handleSubmit, formState: { errors } } = useForm()
  const [serverError, setServerError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [step, setStep] = useState('form') // 'form' | 'check-email'
  const [submittedEmail, setSubmittedEmail] = useState('')

  const onSubmit = async ({ fullName, email, password, companyName, country }) => {
    setLoading(true)
    setServerError('')

    // No fallback to the UAE. The select can only offer countries we know, so a miss
    // here means the list and this lookup have drifted apart — which is a bug to say
    // out loud, not one to paper over by pricing the company in dirhams.
    const countryDefaults = countryDefaultsFor(country)
    if (!countryDefaults) {
      console.error('[Signup] no defaults on file for country', country)
      setServerError('That country is not supported yet. Please pick another.')
      setLoading(false)
      return
    }

    const pending = {
      companyName,
      fullName,
      country,
      currency: countryDefaults.currency,
      timezone: countryDefaults.timezone,
    }
    // Saved before signUp() so App.jsx's bootstrap effect can pick this up
    // and retry on a later authenticated visit even if the immediate path
    // below never completes (e.g. email confirmation is required, or the
    // tab closes before the RPC call resolves).
    savePendingSignup(pending)

    const { data, error } = await supabase.auth.signUp({ email, password })

    if (error) {
      console.error('[Signup] signUp failed', error.code, error)
      setServerError(authErrorMessage(error))
      setLoading(false)
      return
    }

    if (data.session) {
      const { error: rpcError } = await runSelfOnboard(supabase, pending)

      if (rpcError) {
        if (isAlreadyOnboardedError(rpcError)) {
          clearPendingSignup()
          navigate('/login')
          return
        }
        console.error('[Signup] runSelfOnboard failed', rpcError)
        setServerError('Something went wrong setting up your workspace. Please try again.')
        setLoading(false)
        return
      }

      clearPendingSignup()
      await loadProfile(data.session)
      navigate('/dashboard')
      return
    }

    // Email confirmation is ON — no session yet. self_onboard_company runs
    // on this user's first authenticated visit instead (see App.jsx).
    setSubmittedEmail(email)
    setStep('check-email')
    setLoading(false)
  }

  if (step === 'check-email') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[#F5F5F0] dark:bg-[#0F0F0F]">
        <div className="w-full max-w-sm text-center">
          <div className="inline-flex justify-center mb-4">
            <Link to="/" aria-label="BYOND home">
              <Logo size="md" />
            </Link>
          </div>
          <div className="rounded-xl p-8 bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
            <div className="w-12 h-12 rounded-xl bg-[#00D4A0]/10 flex items-center justify-center mx-auto mb-4">
              <MailCheck size={22} className="text-[#00D4A0]" />
            </div>
            <h1 className="text-xl font-bold text-[#1A1A1A] dark:text-white">Check your email to activate</h1>
            <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-2">
              We sent a confirmation link to <span className="font-medium text-[#1A1A1A] dark:text-white">{submittedEmail}</span>.
              Your free quarter and company workspace will be set up as soon as you confirm and log in.
            </p>
            <Link
              to="/login"
              className="inline-block mt-6 text-sm text-[#00D4A0] hover:underline"
            >
              Back to log in
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 py-10 bg-[#F5F5F0] dark:bg-[#0F0F0F]">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="text-center mb-6">
          <div className="inline-flex justify-center mb-4">
            <Link to="/" aria-label="BYOND home">
              <Logo size="md" />
            </Link>
          </div>
          <h1 className="text-2xl font-bold text-[#1A1A1A] dark:text-white">
            Create your workspace
          </h1>
          <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1">
            Set up BYOND HR for your team
          </p>
          <div className="inline-flex items-center gap-1.5 mt-4 px-3 py-1.5 rounded-full bg-[#00D4A0]/10 text-xs font-semibold text-[#00D4A0]">
            <Sparkles size={13} />
            One full quarter free — no credit card required
          </div>
        </div>

        {/* Card */}
        <div className="rounded-xl p-8 bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">

            {/* Full name */}
            <div>
              <label className="block text-sm font-medium text-[#1A1A1A] dark:text-white mb-1.5">
                Full name
              </label>
              <div className="relative">
                <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#AAAAAA] dark:text-[#555555] pointer-events-none" />
                <input
                  type="text"
                  placeholder="Sara Al Mansoori"
                  className={`w-full pl-9 pr-4 py-2.5 rounded-lg text-sm bg-[#F5F5F0] dark:bg-[#0F0F0F] text-[#1A1A1A] dark:text-white placeholder-[#AAAAAA] dark:placeholder-[#555555] border focus:outline-none focus:border-[#00D4A0] transition-colors ${
                    errors.fullName ? 'border-[#FF4D4D]' : 'border-[#E8E8E8] dark:border-[#2A2A2A]'
                  }`}
                  {...register('fullName', { required: 'Full name is required' })}
                />
              </div>
              {errors.fullName && <p className="text-xs mt-1 text-[#FF4D4D]">{errors.fullName.message}</p>}
            </div>

            {/* Work email */}
            <div>
              <label className="block text-sm font-medium text-[#1A1A1A] dark:text-white mb-1.5">
                Work email
              </label>
              <div className="relative">
                <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#AAAAAA] dark:text-[#555555] pointer-events-none" />
                <input
                  type="email"
                  placeholder="you@company.com"
                  className={`w-full pl-9 pr-4 py-2.5 rounded-lg text-sm bg-[#F5F5F0] dark:bg-[#0F0F0F] text-[#1A1A1A] dark:text-white placeholder-[#AAAAAA] dark:placeholder-[#555555] border focus:outline-none focus:border-[#00D4A0] transition-colors ${
                    errors.email ? 'border-[#FF4D4D]' : 'border-[#E8E8E8] dark:border-[#2A2A2A]'
                  }`}
                  {...register('email', {
                    required: 'Email is required',
                    pattern: { value: /\S+@\S+\.\S+/, message: 'Invalid email address' },
                  })}
                />
              </div>
              {errors.email && <p className="text-xs mt-1 text-[#FF4D4D]">{errors.email.message}</p>}
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-[#1A1A1A] dark:text-white mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#AAAAAA] dark:text-[#555555] pointer-events-none" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="At least 8 characters"
                  className={`w-full pl-9 pr-10 py-2.5 rounded-lg text-sm bg-[#F5F5F0] dark:bg-[#0F0F0F] text-[#1A1A1A] dark:text-white placeholder-[#AAAAAA] dark:placeholder-[#555555] border focus:outline-none focus:border-[#00D4A0] transition-colors ${
                    errors.password ? 'border-[#FF4D4D]' : 'border-[#E8E8E8] dark:border-[#2A2A2A]'
                  }`}
                  {...register('password', {
                    required: 'Password is required',
                    minLength: { value: 8, message: 'Password must be at least 8 characters' },
                  })}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#AAAAAA] dark:text-[#555555] hover:text-[#666666] dark:hover:text-[#A0A0A0] transition-colors"
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              {errors.password && <p className="text-xs mt-1 text-[#FF4D4D]">{errors.password.message}</p>}
            </div>

            {/* Company name */}
            <div>
              <label className="block text-sm font-medium text-[#1A1A1A] dark:text-white mb-1.5">
                Company name
              </label>
              <div className="relative">
                <Building2 size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#AAAAAA] dark:text-[#555555] pointer-events-none" />
                <input
                  type="text"
                  placeholder="Your company"
                  className={`w-full pl-9 pr-4 py-2.5 rounded-lg text-sm bg-[#F5F5F0] dark:bg-[#0F0F0F] text-[#1A1A1A] dark:text-white placeholder-[#AAAAAA] dark:placeholder-[#555555] border focus:outline-none focus:border-[#00D4A0] transition-colors ${
                    errors.companyName ? 'border-[#FF4D4D]' : 'border-[#E8E8E8] dark:border-[#2A2A2A]'
                  }`}
                  {...register('companyName', { required: 'Company name is required' })}
                />
              </div>
              {errors.companyName && <p className="text-xs mt-1 text-[#FF4D4D]">{errors.companyName.message}</p>}
            </div>

            {/* Country */}
            <div>
              <label className="block text-sm font-medium text-[#1A1A1A] dark:text-white mb-1.5">
                Country
              </label>
              <select
                defaultValue="AE"
                className="w-full px-4 py-2.5 rounded-lg text-sm bg-[#F5F5F0] dark:bg-[#0F0F0F] text-[#1A1A1A] dark:text-white border border-[#E8E8E8] dark:border-[#2A2A2A] focus:outline-none focus:border-[#00D4A0] transition-colors"
                {...register('country', { required: true })}
              >
                {COUNTRY_OPTIONS.map(({ code, name }) => (
                  <option key={code} value={code}>{name}</option>
                ))}
              </select>
            </div>

            {/* Server error */}
            {serverError && (
              <div className="flex items-start gap-2 px-4 py-3 rounded-lg text-sm text-[#FF4D4D] bg-[#FF4D4D]/10 border border-[#FF4D4D]/20">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                {serverError}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors"
            >
              {loading && <Loader2 size={15} className="animate-spin" />}
              {loading ? 'Creating your workspace…' : 'Start free trial'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-[#AAAAAA] dark:text-[#555555] mt-6">
          Already have an account?{' '}
          <Link to="/login" className="text-[#00D4A0] hover:underline">Log in</Link>
        </p>
      </div>
    </div>
  )
}
