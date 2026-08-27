import { useMemo, useState } from 'react'
import { Check, Ban, Info, PanelsTopLeft, Route as RouteIcon } from 'lucide-react'
import { ROLES, ROLE_LABELS } from '../../data/accessMatrix'
import { NAV_ITEMS, visibleNavFor, routeAccessFor } from '../../data/navigation'

// What a role actually sees when they sign in.
//
// The matrix above this on /permissions answers "what is this role allowed to do with the
// data" — that comes from the Access Control Standard and is enforced by row level
// security. This answers a different and more everyday question: "which pages appear in
// their sidebar, and which ones bounce them to /unauthorized".
//
// Both lists are computed by the same functions Sidebar.jsx and App.jsx use, imported from
// data/navigation.js. That is the whole reason this could be built honestly: a preview
// assembled from a second copy of the rules would drift, and a permissions screen that is
// subtly wrong is worse than one that admits it does not know.

// Platform ownership is a flag on user_roles, not a seventh role — someone holds it in
// addition to being a super_admin. It is offered here as its own option because its effect
// is total: it replaces the entire sidebar rather than adding to it.
const PLATFORM = '__platform_owner__'

const OPTIONS = [
  ...ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] })),
  { value: PLATFORM, label: 'Platform owner' },
]

export default function RolePreview() {
  const [selected, setSelected] = useState('employee')

  const isPlatformOwner = selected === PLATFORM
  const role = isPlatformOwner ? 'super_admin' : selected

  const nav = useMemo(
    () => visibleNavFor({ role, isPlatformOwner }),
    [role, isPlatformOwner],
  )
  const { allowed, denied } = useMemo(
    () => routeAccessFor({ role, isPlatformOwner }),
    [role, isPlatformOwner],
  )

  // Pages reachable by URL that never appear in the sidebar — the ones a role can open
  // from a link but would not find by looking. /employees/new is the clearest: an admin
  // sees the Employees link, and cannot add anybody.
  const navPaths = new Set(nav.map((n) => n.path))
  const unlisted = allowed.filter((r) => !navPaths.has(r.path))

  const label = isPlatformOwner ? 'A platform owner' : `A ${ROLE_LABELS[selected]}`

  return (
    <div className="p-5 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">

      <div className="flex items-center gap-2.5 mb-1">
        <PanelsTopLeft size={15} className="text-[#00D4A0]" />
        <h2 className="text-base font-semibold text-[#1A1A1A] dark:text-white">Role preview</h2>
      </div>
      <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mb-4">
        The screens each role sees, taken from the same definitions the app itself obeys.
      </p>

      {/* Role picker */}
      <div className="flex flex-wrap gap-1.5 mb-5">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => setSelected(o.value)}
            aria-pressed={selected === o.value}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              selected === o.value
                ? 'bg-[#00D4A0]/10 text-[#00D4A0]'
                : 'text-[#666666] dark:text-[#A0A0A0] border border-[#E8E8E8] dark:border-[#2A2A2A] hover:text-[#1A1A1A] dark:hover:text-white'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {isPlatformOwner && (
        <p className="flex items-start gap-2 text-xs text-[#666666] dark:text-[#A0A0A0] mb-4 p-3 rounded-lg bg-[#4D9FFF]/[0.06] border border-[#4D9FFF]/20">
          <Info size={13} className="text-[#4D9FFF] shrink-0 mt-0.5" />
          Platform ownership is a flag held <em>in addition</em> to a role, not a seventh
          role. It replaces the sidebar rather than extending it: someone who runs BYOND is
          not staff at one of its companies, so attendance, payroll and the employee list
          are not theirs to look at.
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Sidebar they get */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[#666666] dark:text-[#A0A0A0] mb-2.5">
            {label} sees this menu
          </p>
          <div className="rounded-lg border border-[#E8E8E8] dark:border-[#2A2A2A] overflow-hidden">
            {nav.map(({ label: itemLabel, icon: Icon, path }) => (
              <div
                key={path}
                className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-[#1A1A1A] dark:text-white border-b border-[#E8E8E8] dark:border-[#2A2A2A] last:border-0"
              >
                <Icon size={14} className="text-[#00D4A0] shrink-0" />
                {itemLabel}
              </div>
            ))}
          </div>
          <p className="text-xs text-[#AAAAAA] dark:text-[#555555] mt-2">
            {nav.length} of {NAV_ITEMS.length} menu items
          </p>
        </div>

        {/* What they cannot reach */}
        <div className="space-y-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[#666666] dark:text-[#A0A0A0] mb-2.5">
              Sent away from
            </p>
            {denied.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-[#00D4A0]">
                <Check size={14} /> Nothing — this role reaches every page.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {denied.map((r) => (
                  <span
                    key={r.path}
                    title={r.path}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-[#FF4D4D]/[0.08] text-[#FF4D4D]"
                  >
                    <Ban size={11} />
                    {r.label}
                  </span>
                ))}
              </div>
            )}
          </div>

          {unlisted.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[#666666] dark:text-[#A0A0A0] mb-2.5">
                Can open, but has no menu link
              </p>
              <div className="flex flex-wrap gap-1.5">
                {unlisted.map((r) => (
                  <span
                    key={r.path}
                    title={r.path}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-[#FF8C42]/[0.08] text-[#FF8C42]"
                  >
                    <RouteIcon size={11} />
                    {r.label}
                  </span>
                ))}
              </div>
              <p className="text-xs text-[#AAAAAA] dark:text-[#555555] mt-2">
                Reached from a link elsewhere in the app rather than the menu — an employee
                record opened from the list, for instance.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* The thing this screen must not be mistaken for */}
      <p className="flex items-start gap-2 text-xs text-[#666666] dark:text-[#A0A0A0] mt-5 pt-4 border-t border-[#E8E8E8] dark:border-[#2A2A2A]">
        <Info size={13} className="shrink-0 mt-0.5" />
        <span>
          This is navigation, not the security boundary. Hiding a menu link is a courtesy;
          what actually stops someone reading another company's data is row level security
          in the database, which applies whatever URL they type. The matrix below is the
          part that describes those rules.
        </span>
      </p>
    </div>
  )
}
