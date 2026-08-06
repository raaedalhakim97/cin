import { useState } from 'react'
import { ShieldCheck, Sparkles, X, Check, Minus } from 'lucide-react'
import Sidebar from '../components/layout/Sidebar'
import Header from '../components/layout/Header'
import { ROLES, ROLE_LABELS, LEGEND, ACCESS_MATRIX } from '../data/accessMatrix'

// Static documentation view only — no Supabase calls, no impersonation, no
// RLS bypass. Everything on this page is derived from accessMatrix.js.

const PILL_CLS = {
  F: 'bg-[#00D4A0]/10 text-[#00D4A0]',
  W: 'bg-[#4D9FFF]/10 text-[#4D9FFF]',
  O: 'bg-[#FF8C42]/10 text-[#FF8C42]',
  B: 'bg-[#FF8C42]/10 text-[#FF8C42]',
  R: 'bg-[#A0A0A0]/10 text-[#666666] dark:text-[#A0A0A0]',
  '-': '',
}

function Pill({ code, note }) {
  if (code === '-') {
    return (
      <span
        className="text-[#AAAAAA] dark:text-[#555555] text-sm select-none"
        title={note ? `No access — ${note}` : 'No access'}
      >
        –
      </span>
    )
  }
  return (
    <span
      className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${PILL_CLS[code]}`}
      title={note ? `${LEGEND[code]} — ${note}` : LEGEND[code]}
    >
      {code}
    </span>
  )
}

// ─── Focused single-role view ───────────────────────────────────────────────

function RoleFocusView({ role }) {
  const allowed = ACCESS_MATRIX.filter(row => row.access[role] !== '-')
  const denied = ACCESS_MATRIX.filter(row => row.access[role] === '-')

  return (
    <div className="rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] overflow-hidden">
      <div className="px-5 py-4 border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
        <h2 className="text-base font-semibold text-[#1A1A1A] dark:text-white">
          What can a {ROLE_LABELS[role]} do?
        </h2>
        <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-0.5">
          {allowed.length} allowed · {denied.length} denied, of {ACCESS_MATRIX.length} modules
        </p>
      </div>

      <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-[#E8E8E8] dark:divide-[#2A2A2A]">
        <div className="p-5">
          <div className="flex items-center gap-2 mb-3 text-xs font-semibold uppercase tracking-wide text-[#00D4A0]">
            <Check size={13} /> Allowed
          </div>
          <ul className="space-y-2">
            {allowed.map(row => (
              <li key={row.module} className="flex items-center justify-between gap-3">
                <span className="text-sm text-[#1A1A1A] dark:text-white">{row.module}</span>
                <Pill code={row.access[role]} note={row.notes?.[role]} />
              </li>
            ))}
          </ul>
        </div>

        <div className="p-5">
          <div className="flex items-center gap-2 mb-3 text-xs font-semibold uppercase tracking-wide text-[#666666] dark:text-[#A0A0A0]">
            <Minus size={13} /> Denied
          </div>
          <ul className="space-y-2">
            {denied.map(row => (
              <li key={row.module} className="text-sm text-[#666666] dark:text-[#A0A0A0]">
                {row.module}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

// ─── Full grid ───────────────────────────────────────────────────────────────

function MatrixGrid({ focusedRole, onToggleRole }) {
  return (
    <div className="hidden md:block rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
              <th className="px-4 py-3 text-left text-xs font-semibold text-[#666666] dark:text-[#A0A0A0] uppercase tracking-wide whitespace-nowrap">
                Module
              </th>
              {ROLES.map(role => (
                <th key={role} className="px-3 py-3 text-center whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => onToggleRole(role)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide transition-colors ${
                      focusedRole === role
                        ? 'bg-[#00D4A0]/10 text-[#00D4A0]'
                        : 'text-[#666666] dark:text-[#A0A0A0] hover:bg-[#F5F5F0] dark:hover:bg-[#252525]'
                    }`}
                    title={`Focus on ${ROLE_LABELS[role]}`}
                  >
                    {ROLE_LABELS[role]}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E8E8E8] dark:divide-[#2A2A2A]">
            {ACCESS_MATRIX.map(row => (
              <tr key={row.module} className="hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors">
                <td className="px-4 py-3">
                  <p className="text-sm font-medium text-[#1A1A1A] dark:text-white">{row.module}</p>
                  {row.rowNote && (
                    <p className="text-[11px] text-[#666666] dark:text-[#A0A0A0] mt-0.5">{row.rowNote}</p>
                  )}
                </td>
                {ROLES.map(role => (
                  <td
                    key={role}
                    className={`px-3 py-3 text-center transition-colors ${
                      focusedRole === role ? 'bg-[#00D4A0]/5' : ''
                    }`}
                  >
                    <Pill code={row.access[role]} note={row.notes?.[role]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Permissions() {
  const [focusedRole, setFocusedRole] = useState(null)
  const [mobileRole, setMobileRole] = useState(ROLES[0])

  function toggleRole(role) {
    setFocusedRole(current => (current === role ? null : role))
  }

  return (
    <div className="flex min-h-screen bg-[#F5F5F0] dark:bg-[#0F0F0F]">
      <Sidebar />

      <div className="flex-1 min-w-0 flex flex-col lg:ml-60">
        <Header />

        <main className="flex-1 p-4 sm:p-6 lg:p-8">

          {/* Page header */}
          <div className="mb-6">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-[#00D4A0]/10 flex items-center justify-center shrink-0">
                <ShieldCheck size={18} className="text-[#00D4A0]" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-[#1A1A1A] dark:text-white">Permissions</h1>
                <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-0.5">
                  What each of your company's 6 roles can access, module by module
                </p>
              </div>
            </div>
          </div>

          {/* Explainer + role-preview placeholder */}
          <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] mb-6">
            <p className="text-sm text-[#666666] dark:text-[#A0A0A0] max-w-2xl">
              This shows what each role is allowed to do, enforced at the database level.
              To preview a role's actual screens, <span className="font-medium text-[#1A1A1A] dark:text-white">role preview</span> is coming soon.
            </p>
            <button
              type="button"
              disabled
              title="Role preview — coming soon"
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-[#AAAAAA] dark:text-[#555555] border border-[#E8E8E8] dark:border-[#2A2A2A] cursor-not-allowed shrink-0"
            >
              <Sparkles size={14} />
              Role preview — coming soon
            </button>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 p-4 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] mb-6">
            {Object.entries(LEGEND).map(([code, label]) => (
              <div key={code} className="flex items-center gap-2">
                <Pill code={code} />
                <span className="text-xs text-[#666666] dark:text-[#A0A0A0]">{label}</span>
              </div>
            ))}
          </div>

          {/* Mobile: role picker → focused list only (6-column grid doesn't fit) */}
          <div className="md:hidden mb-6">
            <label className="block text-xs font-semibold text-[#666666] dark:text-[#A0A0A0] mb-1.5 uppercase tracking-wide">
              Choose a role
            </label>
            <select
              value={mobileRole}
              onChange={e => setMobileRole(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm rounded-lg bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0] transition-colors"
            >
              {ROLES.map(role => (
                <option key={role} value={role}>{ROLE_LABELS[role]}</option>
              ))}
            </select>
          </div>
          <div className="md:hidden">
            <RoleFocusView role={mobileRole} />
          </div>

          {/* Desktop: full grid, click a role header to focus it */}
          <MatrixGrid focusedRole={focusedRole} onToggleRole={toggleRole} />

          {focusedRole && (
            <div className="hidden md:block mt-6">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-[#666666] dark:text-[#A0A0A0]">Focused view</span>
                <button
                  type="button"
                  onClick={() => setFocusedRole(null)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-[#666666] dark:text-[#A0A0A0] hover:text-[#1A1A1A] dark:hover:text-white transition-colors"
                >
                  <X size={13} /> Back to full matrix
                </button>
              </div>
              <RoleFocusView role={focusedRole} />
            </div>
          )}

        </main>
      </div>
    </div>
  )
}
