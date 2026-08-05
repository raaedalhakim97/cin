import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { Mail, Lock, Eye, EyeOff, Loader2, AlertCircle } from 'lucide-react'
import supabase from '../services/supabase'
import useAuthStore from '../store/authStore'
import { logLoginAttempt, getActiveSessionCount } from '../services/sessionService'
import Logo from '../components/Logo'

const MAX_CONCURRENT_SESSIONS = 2

export default function Login() {
  const navigate = useNavigate()
  const registerSession = useAuthStore((s) => s.registerSession)
  const loadProfile = useAuthStore((s) => s.loadProfile)
  const { register, handleSubmit, formState: { errors } } = useForm()
  const [serverError, setServerError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const onSubmit = async ({ email, password }) => {
    setLoading(true)
    setServerError('')

    // Attempt sign-in
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    // Log the attempt regardless of outcome
    await logLoginAttempt(email, !error)

    if (error) {
      setServerError(error.message)
      setLoading(false)
      return
    }

    // Check concurrent session limit
    const activeCount = await getActiveSessionCount()
    if (activeCount >= MAX_CONCURRENT_SESSIONS) {
      await supabase.auth.signOut()
      setServerError(
        `Maximum ${MAX_CONCURRENT_SESSIONS} concurrent sessions allowed. ` +
        'Please sign out from another device first.'
      )
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
    <div className="min-h-screen flex items-center justify-center p-4 bg-[#F5F5F0] dark:bg-[#0F0F0F]">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex justify-center mb-4">
            <Logo size="md" variant="light" className="dark:hidden" />
            <Logo size="md" variant="dark" className="hidden dark:inline-flex" />
          </div>
          <h1 className="text-2xl font-bold text-[#1A1A1A] dark:text-white">
            Welcome back
          </h1>
          <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1">
            Sign in to BYOND HR
          </p>
        </div>

        {/* Card */}
        <div className="rounded-xl p-8 bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">

            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-[#1A1A1A] dark:text-white mb-1.5">
                Email
              </label>
              <div className="relative">
                <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#AAAAAA] dark:text-[#555555] pointer-events-none" />
                <input
                  type="email"
                  placeholder="you@company.com"
                  className={`w-full pl-9 pr-4 py-2.5 rounded-lg text-sm bg-[#F5F5F0] dark:bg-[#0F0F0F] text-[#1A1A1A] dark:text-white placeholder-[#AAAAAA] dark:placeholder-[#555555] border focus:outline-none focus:border-[#00D4A0] transition-colors ${
                    errors.email
                      ? 'border-[#FF4D4D]'
                      : 'border-[#E8E8E8] dark:border-[#2A2A2A]'
                  }`}
                  {...register('email', {
                    required: 'Email is required',
                    pattern: { value: /\S+@\S+\.\S+/, message: 'Invalid email address' },
                  })}
                />
              </div>
              {errors.email && (
                <p className="text-xs mt-1 text-[#FF4D4D]">{errors.email.message}</p>
              )}
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
                  placeholder="••••••••"
                  className={`w-full pl-9 pr-10 py-2.5 rounded-lg text-sm bg-[#F5F5F0] dark:bg-[#0F0F0F] text-[#1A1A1A] dark:text-white placeholder-[#AAAAAA] dark:placeholder-[#555555] border focus:outline-none focus:border-[#00D4A0] transition-colors ${
                    errors.password
                      ? 'border-[#FF4D4D]'
                      : 'border-[#E8E8E8] dark:border-[#2A2A2A]'
                  }`}
                  {...register('password', { required: 'Password is required' })}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#AAAAAA] dark:text-[#555555] hover:text-[#666666] dark:hover:text-[#A0A0A0] transition-colors"
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              {errors.password && (
                <p className="text-xs mt-1 text-[#FF4D4D]">{errors.password.message}</p>
              )}
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
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-[#AAAAAA] dark:text-[#555555] mt-6">
          BYOND by SERVA &mdash; HR Platform
        </p>
      </div>
    </div>
  )
}
