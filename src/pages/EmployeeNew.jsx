import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { ArrowLeft, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react'
import supabase from '../services/supabase'
import useAuthStore from '../store/authStore'
import Sidebar from '../components/layout/Sidebar'
import Header from '../components/layout/Header'

const CLASSIFICATION_OPTIONS = [
  { value: 'full_time_permanent', label: 'Full-Time Permanent' },
  { value: 'full_time_contract',  label: 'Full-Time Contract' },
  { value: 'part_time',           label: 'Part-Time' },
  { value: 'intern',              label: 'Intern' },
  { value: 'contractor',          label: 'Contractor' },
]

const CONTRACT_TYPE_OPTIONS = [
  { value: 'indefinite',  label: 'Indefinite' },
  { value: 'fixed_term',  label: 'Fixed Term' },
]

// ─── Reusable field wrapper ───────────────────────────────────────────────────
function Field({ label, required, error, hint, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-[#1A1A1A] dark:text-white">
        {label}{required && <span className="text-[#FF4D4D] ml-0.5">*</span>}
      </label>
      {children}
      {hint  && <p className="text-xs text-[#AAAAAA] dark:text-[#555555]">{hint}</p>}
      {error && <p className="text-xs text-[#FF4D4D]">{error}</p>}
    </div>
  )
}

// ─── Reusable input ───────────────────────────────────────────────────────────
function Input({ className = '', ...props }) {
  return (
    <input
      {...props}
      className={`w-full px-3.5 py-2.5 text-sm rounded-lg bg-white dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white placeholder-[#AAAAAA] dark:placeholder-[#555555] focus:outline-none focus:border-[#00D4A0] transition-colors ${className}`}
    />
  )
}

// ─── Reusable select ─────────────────────────────────────────────────────────
function StyledSelect({ className = '', children, ...props }) {
  return (
    <select
      {...props}
      className={`w-full px-3.5 py-2.5 text-sm rounded-lg bg-white dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0] transition-colors ${className}`}
    >
      {children}
    </select>
  )
}

// ─── Reusable textarea ────────────────────────────────────────────────────────
function Textarea({ className = '', ...props }) {
  return (
    <textarea
      {...props}
      className={`w-full px-3.5 py-2.5 text-sm rounded-lg bg-white dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white placeholder-[#AAAAAA] dark:placeholder-[#555555] focus:outline-none focus:border-[#00D4A0] transition-colors resize-y ${className}`}
    />
  )
}

// ─── Section card ─────────────────────────────────────────────────────────────
function Section({ title, children }) {
  return (
    <section className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] space-y-5">
      <h2 className="text-base font-semibold text-[#1A1A1A] dark:text-white">{title}</h2>
      {children}
    </section>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function EmployeeNew() {
  const navigate    = useNavigate()
  const companyId   = useAuthStore((s) => s.companyId)
  const currency    = useAuthStore((s) => s.company?.currency) ?? 'AED'
  const [departments, setDepartments] = useState([])
  const [submitting,  setSubmitting]  = useState(false)
  const [serverError, setServerError] = useState('')
  const [success,     setSuccess]     = useState(false)

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm({
    defaultValues: {
      contract_type:  'indefinite',
      classification: 'full_time_permanent',
    },
  })

  const contractType = watch('contract_type')

  // Clear the server error banner as soon as the user starts fixing the form
  useEffect(() => {
    const sub = watch(() => serverError && setServerError(''))
    return () => sub.unsubscribe()
  }, [watch, serverError])

  useEffect(() => {
    supabase
      .from('departments')
      .select('id, name')
      .order('name')
      .then(({ data }) => setDepartments(data ?? []))
  }, [])

  async function onSubmit(values) {
    setSubmitting(true)
    setServerError('')

    // Trimmed on the way in. Saved raw, a name pasted with a trailing space became
    // a record that the anonymize dialog could never match, so the employee could
    // not be erased on request. create_employee_invite already btrims for the same
    // reason; this is the direct-creation path catching up.
    const clean = (v) => {
      const t = typeof v === 'string' ? v.trim() : v
      return t === '' ? null : t
    }

    const payload = {
      company_id:          companyId,
      full_name:           clean(values.full_name),
      email:               clean(values.email),
      phone:               clean(values.phone),
      national_id:         clean(values.national_id),
      job_title:           clean(values.job_title),
      job_description:     clean(values.job_description),
      interview_score:     values.interview_score !== '' && values.interview_score != null ? Number(values.interview_score) : null,
      department_id:       values.department_id    || null,
      classification:      values.classification,
      contract_type:       values.contract_type,
      contract_end_date:   values.contract_type === 'fixed_term' ? (values.contract_end_date || null) : null,
      hire_date:           values.hire_date,
      probation_end_date:  values.probation_end_date || null,
      basic_salary:        values.basic_salary        ? parseFloat(values.basic_salary)        : null,
      housing_allowance:   values.housing_allowance   ? parseFloat(values.housing_allowance)   : null,
      transport_allowance: values.transport_allowance ? parseFloat(values.transport_allowance) : null,
      other_allowance:     values.other_allowance     ? parseFloat(values.other_allowance)     : null,
      bank_account:        values.bank_account || null,
      // Profile-first invite flow (migration 42) — every employee created
      // from this form starts as 'invited', never 'active'. emp_code is
      // never set here — the aa_emp_code DB trigger assigns it on insert.
      status:              'invited',
    }

    const { data, error } = await supabase
      .from('employees')
      .insert(payload)
      .select('id')
      .single()

    if (error) {
      console.error('[EmployeeNew] insert failed', error)
      setServerError('Something went wrong saving this employee. Please check the fields and try again.')
      setSubmitting(false)
    } else {
      setSuccess(true)
      setTimeout(() => navigate(`/employees/${data.id}`), 1200)
    }
  }

  return (
    <div className="flex min-h-screen bg-[#F5F5F0] dark:bg-[#0F0F0F]">
      <Sidebar />

      <div className="flex-1 min-w-0 flex flex-col lg:ml-60">
        <Header />

        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <div className="max-w-3xl">

            {/* Page header */}
            <div className="flex items-center gap-4 mb-8">
              <Link
                to="/employees"
                className="w-9 h-9 rounded-lg flex items-center justify-center bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#666666] dark:text-[#A0A0A0] hover:text-[#1A1A1A] dark:hover:text-white transition-colors"
              >
                <ArrowLeft size={16} />
              </Link>
              <div>
                <h1 className="text-2xl font-bold text-[#1A1A1A] dark:text-white">Add Employee</h1>
                <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-0.5">
                  Build the full profile now — you'll generate their invite link from the detail page next
                </p>
              </div>
            </div>

            {/* Success banner */}
            {success && (
              <div className="flex items-center gap-3 p-4 rounded-xl bg-[#00D4A0]/10 border border-[#00D4A0]/20 mb-6">
                <CheckCircle2 size={18} className="text-[#00D4A0] shrink-0" />
                <p className="text-sm font-medium text-[#00D4A0]">Profile saved! Redirecting…</p>
              </div>
            )}

            {/* Error banner */}
            {serverError && (
              <div className="flex items-start gap-3 p-4 rounded-xl bg-[#FF4D4D]/10 border border-[#FF4D4D]/20 mb-6">
                <AlertTriangle size={18} className="text-[#FF4D4D] shrink-0 mt-0.5" />
                <p className="text-sm text-[#FF4D4D]">{serverError}</p>
              </div>
            )}

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">

              {/* ── Personal information ──────────────────────────────────── */}
              <Section title="Personal Information">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div className="col-span-2">
                    <Field label="Full Name" required error={errors.full_name?.message}>
                      <Input
                        {...register('full_name', { required: 'Full name is required' })}
                        placeholder="Ahmed Al Rashidi"
                      />
                    </Field>
                  </div>
                  <Field label="Email" required error={errors.email?.message}>
                    <Input
                      {...register('email', {
                        required: 'Email is required',
                        pattern: { value: /^\S+@\S+\.\S+$/, message: 'Invalid email address' },
                      })}
                      type="email"
                      placeholder="ahmed@company.com"
                    />
                  </Field>
                  <Field label="Phone">
                    <Input {...register('phone')} placeholder="+971 50 123 4567" />
                  </Field>
                  <Field
                    label="National ID"
                    hint="Stored encrypted — displayed masked to all users"
                  >
                    <Input {...register('national_id')} placeholder="784-1990-1234567-1" />
                  </Field>
                </div>
              </Section>

              {/* ── Employment ───────────────────────────────────────────── */}
              <Section title="Employment">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <Field label="Job Title">
                    <Input {...register('job_title')} placeholder="Software Engineer" />
                  </Field>
                  <Field label="Department">
                    <StyledSelect {...register('department_id')}>
                      <option value="">Select department</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </StyledSelect>
                  </Field>
                  <Field label="Classification">
                    <StyledSelect {...register('classification')}>
                      {CLASSIFICATION_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </StyledSelect>
                  </Field>
                  <Field label="Contract Type">
                    <StyledSelect {...register('contract_type')}>
                      {CONTRACT_TYPE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </StyledSelect>
                  </Field>
                  <Field label="Hire Date" required error={errors.hire_date?.message}>
                    <Input
                      {...register('hire_date', { required: 'Hire date is required' })}
                      type="date"
                    />
                  </Field>
                  {contractType === 'fixed_term' && (
                    <Field label="Contract End Date">
                      <Input {...register('contract_end_date')} type="date" />
                    </Field>
                  )}
                  <Field label="Probation End Date">
                    <Input {...register('probation_end_date')} type="date" />
                  </Field>
                </div>
              </Section>

              {/* ── Hiring details ───────────────────────────────────────── */}
              <Section title="Hiring Details">
                <Field label="Job Description" hint="Shown to the manager scoring this employee's evaluations, and to the employee on their own profile">
                  <Textarea
                    {...register('job_description')}
                    rows={4}
                    placeholder="Key responsibilities, reporting line, expectations for this role…"
                  />
                </Field>
                <Field
                  label="Interview Score"
                  error={errors.interview_score?.message}
                  hint="Becomes this new hire's starting KPI baseline (manager score) once they accept their invite"
                >
                  <Input
                    {...register('interview_score', {
                      min: { value: 0, message: 'Must be between 0 and 100' },
                      max: { value: 100, message: 'Must be between 0 and 100' },
                    })}
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    placeholder="0–100"
                  />
                </Field>
              </Section>

              {/* ── Compensation ─────────────────────────────────────────── */}
              <Section title="Compensation">
                <p className="text-xs text-[#AAAAAA] dark:text-[#555555] -mt-2">
                  Salary values are stored securely and displayed masked to authorized users.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <Field label={`Basic Salary (${currency})`}>
                    <Input
                      {...register('basic_salary')}
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="15000"
                    />
                  </Field>
                  <Field label={`Housing Allowance (${currency})`}>
                    <Input
                      {...register('housing_allowance')}
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="5000"
                    />
                  </Field>
                  <Field label={`Transport Allowance (${currency})`}>
                    <Input
                      {...register('transport_allowance')}
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="1500"
                    />
                  </Field>
                  <Field label={`Other Allowance (${currency})`}>
                    <Input
                      {...register('other_allowance')}
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0"
                    />
                  </Field>
                </div>
              </Section>

              {/* ── Banking ──────────────────────────────────────────────── */}
              <Section title="Banking">
                <Field
                  label="Bank Account (IBAN)"
                  hint="Stored securely — displayed masked to all users"
                >
                  <Input
                    {...register('bank_account')}
                    placeholder="AE07 0331 2345 6789 0123 456"
                  />
                </Field>
              </Section>

              {/* ── Actions ──────────────────────────────────────────────── */}
              <div className="flex items-center justify-end gap-3 pb-8">
                <Link
                  to="/employees"
                  className="px-5 py-2.5 rounded-lg text-sm font-semibold text-[#666666] dark:text-[#A0A0A0] bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] hover:text-[#1A1A1A] dark:hover:text-white transition-colors"
                >
                  Cancel
                </Link>
                <button
                  type="submit"
                  disabled={submitting || success}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors"
                >
                  {submitting && <Loader2 size={15} className="animate-spin" />}
                  {submitting ? 'Saving…' : 'Save Profile'}
                </button>
              </div>
            </form>
          </div>
        </main>
      </div>
    </div>
  )
}
