// Sensitive-data masking utilities — never display raw values in UI

export const maskBankAccount = () => '•••• •••• •••• ••••'

export const maskSalary = () => '•••,•••'

export const maskNationalId = (id) => {
  if (!id || id.length < 4) return '••••'
  return `••••••${id.slice(-4)}`
}

export const maskDocumentNumber = (num) => {
  if (!num || num.length < 4) return '••••'
  return `••••••${num.slice(-4)}`
}

// Fields that must never be stored client-side (Zustand, localStorage, sessionStorage)
export const SENSITIVE_FIELDS = [
  'basic_salary',
  'housing_allowance',
  'transport_allowance',
  'other_allowance',
  'bank_account',
  'national_id',
]

// Strips all sensitive fields from an employee object before it enters the store
export function sanitizeEmployee(employee) {
  if (!employee) return null
  const safe = { ...employee }
  SENSITIVE_FIELDS.forEach((field) => delete safe[field])
  return safe
}
