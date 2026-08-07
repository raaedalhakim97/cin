import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { Building2, User, Mail, Phone, Users, MessageSquare, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'
import supabase from '../services/supabase'
import Logo from '../components/Logo'

const EMPLOYEE_COUNT_OPTIONS = ['1-10', '11-50', '51-200', '200+']

export default function Demo() {
  const { register, handleSubmit, formState: { errors } } = useForm()
  const [serverError, setServerError] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const onSubmit = async ({ companyName, contactName, workEmail, phone, employeeCount, message }) => {
    setLoading(true)
    setServerError('')

    // Anonymous insert is allowed by RLS (status must be 'new'); anon
    // cannot read this table back, so no .select() is chained here.
    const { error } = await supabase.from('demo_requests').insert({
      company_name: companyName,
      contact_name: contactName,
      work_email: workEmail,
      phone: phone || null,
      employee_count: employeeCount,
      message: message || null,
      status: 'new',
    })

    if (error) {
      console.error('[Demo] submit failed', error)
      setServerError('Something went wrong sending your request. Please try again.')
      setLoading(false)
      return
    }

    setSubmitted(true)
    setLoading(false)
  }

  if (submitted) {
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
              <CheckCircle2 size={22} className="text-[#00D4A0]" />
            </div>
            <h1 className="text-xl font-bold text-[#1A1A1A] dark:text-white">Thanks — we'll be in touch</h1>
            <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-2">
              A member of our team will reach out within 24 hours to book your demo.
            </p>
            <Link to="/" className="inline-block mt-6 text-sm text-[#00D4A0] hover:underline">
              Back to home
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
            Book a demo
          </h1>
          <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1">
            We'll map your KPIs live and show you the dashboards
          </p>
        </div>

        {/* Card */}
        <div className="rounded-xl p-8 bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">

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

            {/* Contact name */}
            <div>
              <label className="block text-sm font-medium text-[#1A1A1A] dark:text-white mb-1.5">
                Contact name
              </label>
              <div className="relative">
                <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#AAAAAA] dark:text-[#555555] pointer-events-none" />
                <input
                  type="text"
                  placeholder="Sara Al Mansoori"
                  className={`w-full pl-9 pr-4 py-2.5 rounded-lg text-sm bg-[#F5F5F0] dark:bg-[#0F0F0F] text-[#1A1A1A] dark:text-white placeholder-[#AAAAAA] dark:placeholder-[#555555] border focus:outline-none focus:border-[#00D4A0] transition-colors ${
                    errors.contactName ? 'border-[#FF4D4D]' : 'border-[#E8E8E8] dark:border-[#2A2A2A]'
                  }`}
                  {...register('contactName', { required: 'Contact name is required' })}
                />
              </div>
              {errors.contactName && <p className="text-xs mt-1 text-[#FF4D4D]">{errors.contactName.message}</p>}
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
                    errors.workEmail ? 'border-[#FF4D4D]' : 'border-[#E8E8E8] dark:border-[#2A2A2A]'
                  }`}
                  {...register('workEmail', {
                    required: 'Work email is required',
                    pattern: { value: /\S+@\S+\.\S+/, message: 'Invalid email address' },
                  })}
                />
              </div>
              {errors.workEmail && <p className="text-xs mt-1 text-[#FF4D4D]">{errors.workEmail.message}</p>}
            </div>

            {/* Phone */}
            <div>
              <label className="block text-sm font-medium text-[#1A1A1A] dark:text-white mb-1.5">
                Phone <span className="text-[#AAAAAA] dark:text-[#555555] font-normal">(optional)</span>
              </label>
              <div className="relative">
                <Phone size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#AAAAAA] dark:text-[#555555] pointer-events-none" />
                <input
                  type="tel"
                  placeholder="+971 50 123 4567"
                  className="w-full pl-9 pr-4 py-2.5 rounded-lg text-sm bg-[#F5F5F0] dark:bg-[#0F0F0F] text-[#1A1A1A] dark:text-white placeholder-[#AAAAAA] dark:placeholder-[#555555] border border-[#E8E8E8] dark:border-[#2A2A2A] focus:outline-none focus:border-[#00D4A0] transition-colors"
                  {...register('phone')}
                />
              </div>
            </div>

            {/* Employee count */}
            <div>
              <label className="block text-sm font-medium text-[#1A1A1A] dark:text-white mb-1.5">
                Employee count
              </label>
              <div className="relative">
                <Users size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#AAAAAA] dark:text-[#555555] pointer-events-none" />
                <select
                  defaultValue=""
                  className={`w-full pl-9 pr-4 py-2.5 rounded-lg text-sm bg-[#F5F5F0] dark:bg-[#0F0F0F] text-[#1A1A1A] dark:text-white border focus:outline-none focus:border-[#00D4A0] transition-colors ${
                    errors.employeeCount ? 'border-[#FF4D4D]' : 'border-[#E8E8E8] dark:border-[#2A2A2A]'
                  }`}
                  {...register('employeeCount', { required: 'Employee count is required' })}
                >
                  <option value="" disabled>Select a range</option>
                  {EMPLOYEE_COUNT_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt} employees</option>
                  ))}
                </select>
              </div>
              {errors.employeeCount && <p className="text-xs mt-1 text-[#FF4D4D]">{errors.employeeCount.message}</p>}
            </div>

            {/* Message */}
            <div>
              <label className="block text-sm font-medium text-[#1A1A1A] dark:text-white mb-1.5">
                Message <span className="text-[#AAAAAA] dark:text-[#555555] font-normal">(optional)</span>
              </label>
              <div className="relative">
                <MessageSquare size={15} className="absolute left-3 top-3 text-[#AAAAAA] dark:text-[#555555] pointer-events-none" />
                <textarea
                  rows={3}
                  placeholder="What are you hoping to solve with BYOND?"
                  className="w-full pl-9 pr-4 py-2.5 rounded-lg text-sm bg-[#F5F5F0] dark:bg-[#0F0F0F] text-[#1A1A1A] dark:text-white placeholder-[#AAAAAA] dark:placeholder-[#555555] border border-[#E8E8E8] dark:border-[#2A2A2A] focus:outline-none focus:border-[#00D4A0] transition-colors resize-none"
                  {...register('message')}
                />
              </div>
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
              {loading ? 'Sending…' : 'Request demo'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-[#AAAAAA] dark:text-[#555555] mt-6">
          Prefer to jump right in?{' '}
          <Link to="/signup" className="text-[#00D4A0] hover:underline">Start a free trial</Link>
        </p>
      </div>
    </div>
  )
}
