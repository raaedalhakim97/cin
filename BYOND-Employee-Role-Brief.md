# BYOND HR — Employee-Role Brief

**Purpose of this document:** a self-contained briefing for a session that has never seen this codebase, focused entirely on what a user with `role = 'employee'` sees and can do in the BYOND HR web app (React + Vite + Tailwind + Zustand + Supabase). Compiled read-only from `BYOND-Design-System.md` and `BYOND-HR_Handover_v1.md` plus direct source reads of every employee-facing file. No code was changed to produce this.

**Platform in one line:** BYOND HR is a multi-tenant HR SaaS (UAE + Nigeria SME focus) on React/Vite/Tailwind/Zustand + Supabase (Postgres, RLS-enforced). 6 roles exist: `super_admin`, `hr_manager`, `department_manager`, `admin`, `employee`, `read_only`. This brief covers `employee` only, noting where a shared page's behavior differs by role for context.

**Standing caveat that applies to everything below:** per the handover's own Known Gaps log, there has historically been only one real login in the dev database (a `super_admin`), and later sessions added one test account per role but **no passwords/browser-automation access ever existed** to click-test any of it. Every behavior described here is "code path complete, read from source," not "confirmed working by clicking through the app as an employee." Treat this brief as accurate to the code, not as a QA sign-off.

---

## 1. Design System — verbatim dump of `BYOND-Design-System.md`

*(Reproduced in full, unmodified, version 1.1 — 2026-07-12, session 33. This is the complete file, not an excerpt.)*

---

# BYOND-hr Design System
**Version 1.1 — 2026-07-12 (session 33)**
**Rule: Claude Code must read this file before building ANY UI component.**

---

## 🎨 Brand Identity

| Property | Value |
|---|---|
| **Brand Name** | BYOND HR |
| **Tagline** | Every talent is understood, cared for, and empowered to perform beyond. |
| **Design Style** | Modern, minimal, professional. Clean cards, bold numbers, clear hierarchy. |
| **Modes** | Light + Dark (both supported — user toggleable) |

---

## 🌈 Color Palette

### Primary
| Name | Hex | Usage |
|---|---|---|
| **Mint Green** | `#00D4A0` | Primary accent, buttons, active states, badges, progress bars, links |
| **Mint Hover** | `#00B589` | Hover state for primary elements |
| **Mint Light** | `#E6FBF6` | Light mode backgrounds for highlighted cards |

### Dark Mode
| Name | Hex | Usage |
|---|---|---|
| **BG Primary** | `#0F0F0F` | Main page background |
| **BG Secondary** | `#1A1A1A` | Sidebar, top bar |
| **BG Card** | `#1E1E1E` | Cards, modals, panels |
| **BG Card Hover** | `#252525` | Card hover state |
| **Border** | `#2A2A2A` | Card borders, dividers |
| **Text Primary** | `#FFFFFF` | Headings, important text |
| **Text Secondary** | `#A0A0A0` | Labels, captions, metadata |
| **Text Muted** | `#555555` | Disabled, placeholder text |

### Light Mode
| Name | Hex | Usage |
|---|---|---|
| **BG Primary** | `#F5F5F0` | Main page background (warm white) |
| **BG Secondary** | `#FFFFFF` | Sidebar, top bar |
| **BG Card** | `#FFFFFF` | Cards, modals, panels |
| **BG Card Hover** | `#F9F9F7` | Card hover state |
| **Border** | `#E8E8E8` | Card borders, dividers |
| **Text Primary** | `#1A1A1A` | Headings, important text |
| **Text Secondary** | `#666666` | Labels, captions, metadata |
| **Text Muted** | `#AAAAAA` | Disabled, placeholder text |

### Status Colors
| Name | Hex | Usage |
|---|---|---|
| **Success / On Time** | `#00D4A0` | Present, approved, paid, on track |
| **Warning / Pending** | `#FF8C42` | Pending approval, late minor, draft |
| **Danger / Absent** | `#FF4D4D` | Absent unauthorized, rejected, overdue |
| **Info / Blue** | `#4D9FFF` | Informational, tasks, neutral status |
| **Purple** | `#A78BFA` | KPI scores, performance highlights |

---

## 🔤 Typography

### Font Family
```css
font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
```
Install: `npm install @fontsource/inter`
Import in index.css: `@import '@fontsource/inter';`

### Type Scale
| Name | Size | Weight | Usage |
|---|---|---|---|
| **Display** | 32px / 2rem | 700 | Page hero numbers (salary, score) |
| **H1** | 24px / 1.5rem | 700 | Page titles |
| **H2** | 20px / 1.25rem | 600 | Section headings, card titles |
| **H3** | 16px / 1rem | 600 | Sub-section, form labels |
| **Body** | 14px / 0.875rem | 400 | Default body text |
| **Small** | 12px / 0.75rem | 400 | Captions, metadata, badges |
| **Tiny** | 11px / 0.6875rem | 400 | Timestamps, helper text |

---

## 📐 Spacing & Layout

### Spacing Scale (use Tailwind classes)
| Token | Value | Tailwind |
|---|---|---|
| xs | 4px | `p-1` / `gap-1` |
| sm | 8px | `p-2` / `gap-2` |
| md | 16px | `p-4` / `gap-4` |
| lg | 24px | `p-6` / `gap-6` |
| xl | 32px | `p-8` / `gap-8` |
| 2xl | 48px | `p-12` / `gap-12` |

### Border Radius
| Element | Radius | Tailwind |
|---|---|---|
| Cards | 12px | `rounded-xl` |
| Buttons | 8px | `rounded-lg` |
| Inputs | 8px | `rounded-lg` |
| Badges/Pills | 999px | `rounded-full` |
| Avatars | 50% | `rounded-full` |
| Icons in boxes | 10px | `rounded-xl` |

### Web Layout (Desktop)
```
┌─────────────────────────────────────────────────┐
│  SIDEBAR (240px fixed)  │  MAIN CONTENT (flex-1) │
│                         │  ┌─ HEADER (64px) ────┐│
│  Logo                   │  │ Page title + user  ││
│  Nav items              │  └────────────────────┘│
│  - Dashboard            │  ┌─ PAGE CONTENT ─────┐│
│  - Employees            │  │ padding: 24px      ││
│  - Attendance           │  │                    ││
│  - Leave                │  │                    ││
│  - Payroll              │  └────────────────────┘│
│  - KPI                  │                        │
│  - Settings             │                        │
└─────────────────────────────────────────────────┘
```

---

## 🧩 Component Library

**Use: shadcn/ui + Tailwind CSS**
Install: `npx shadcn@latest init`

This gives us: Dialog, Dropdown, Select, Table, Toast, Tooltip, Tabs — all unstyled and fully customizable to match BYOND design.

---

## 🔧 Core Components

### 1. Avatar
```jsx
// Initials avatar with mint green background
<div className="w-10 h-10 rounded-full bg-[#00D4A0] flex items-center justify-center">
  <span className="text-white font-semibold text-sm">SA</span>
</div>
```

### 2. Status Badge / Pill
```jsx
// Checked In
<span className="px-3 py-1 rounded-full text-xs font-semibold bg-[#00D4A0] text-white">
  Checked In
</span>

// Pending
<span className="px-3 py-1 rounded-full text-xs font-semibold bg-[#FF8C42] text-white">
  Pending
</span>

// Absent
<span className="px-3 py-1 rounded-full text-xs font-semibold bg-[#FF4D4D] text-white">
  Absent
</span>
```

### 3. Stat Card (2-col grid)
```jsx
<div className="bg-[#1E1E1E] rounded-xl p-4 border border-[#2A2A2A]">
  <p className="text-xs text-[#A0A0A0] mb-1">Attendance</p>
  <p className="text-lg font-bold text-white">On time</p>
  <span className="text-xs text-[#00D4A0]">● Present</span>
</div>
```

### 4. Primary Button
```jsx
<button className="w-full bg-[#00D4A0] hover:bg-[#00B589] text-white font-semibold py-3 px-6 rounded-lg transition-colors duration-200">
  Sign In
</button>
```

### 5. Input Field
```jsx
<input
  className="w-full bg-[#1E1E1E] border border-[#2A2A2A] text-white placeholder-[#555] rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-[#00D4A0] transition-colors"
  placeholder="Email address"
/>
```

### 6. Card Container
```jsx
<div className="bg-[#1E1E1E] border border-[#2A2A2A] rounded-xl p-6">
  {/* content */}
</div>
```

### 7. Sidebar Nav Item
```jsx
// Active
<div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-[#00D4A0]/10 text-[#00D4A0] font-medium">
  <Icon size={18} />
  <span>Dashboard</span>
</div>

// Inactive
<div className="flex items-center gap-3 px-4 py-3 rounded-lg text-[#A0A0A0] hover:bg-[#252525] hover:text-white transition-colors cursor-pointer">
  <Icon size={18} />
  <span>Employees</span>
</div>
```

### 8. Quick Action Button
```jsx
<div className="flex flex-col items-center gap-2 cursor-pointer group">
  <div className="w-12 h-12 rounded-xl bg-[#00D4A0]/10 flex items-center justify-center group-hover:bg-[#00D4A0]/20 transition-colors">
    <Icon size={20} className="text-[#00D4A0]" />
  </div>
  <span className="text-xs text-[#A0A0A0]">Request Leave</span>
</div>
```

### 9. Section Header
```jsx
<div className="flex items-center justify-between mb-4">
  <h2 className="text-base font-semibold text-white">Announcements</h2>
  <button className="text-xs text-[#00D4A0] hover:underline">View all</button>
</div>
```

### 10. Data Table Row
```jsx
<tr className="border-b border-[#2A2A2A] hover:bg-[#252525] transition-colors">
  <td className="py-3 px-4 text-sm text-white">Ahmed Al Rashidi</td>
  <td className="py-3 px-4 text-sm text-[#A0A0A0]">Engineering</td>
  <td className="py-3 px-4">
    <span className="px-2 py-1 rounded-full text-xs bg-[#00D4A0]/10 text-[#00D4A0]">Active</span>
  </td>
</tr>
```

### 11. Empty State (session 33)
Centered muted icon, headline, one-line hint, mint CTA **only** when there's a useful action — no CTA for passive empty states (e.g. "No news yet"). Shared component: `src/components/EmptyState.jsx`.
```jsx
import EmptyState from '../components/EmptyState'
import { Inbox } from 'lucide-react'

<EmptyState
  icon={Inbox}
  title="No leave requests yet"
  hint="Your requests will appear here once submitted."
  action={{ label: 'Request leave', onClick: () => setShowRequestModal(true) }} // omit for passive empty states
/>
```

### 12. Skeleton Loader (session 33)
Pulsing card/row placeholders matching the real content's shape — not a bare spinner. Spinners (`Loader2` + `animate-spin`) are reserved for button-level "Saving…" states inside a form. Shared primitives: `src/components/Skeleton.jsx`.
```jsx
import { SkeletonBlock, SkeletonRow } from '../components/Skeleton'

{loading ? (
  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse">
    {[0, 1, 2, 3].map(i => <SkeletonBlock key={i} className="h-24" />)}
  </div>
) : (
  /* real content */
)}
```

### 13. Toast (session 33)
Bottom-right, mint on success / red on error, auto-dismisses after 3.5s. Shared: `src/components/Toast.jsx` (`useToast()` hook + `<Toast>` render component) — import this instead of re-declaring a local `Toast`/`showToast` pair.
```jsx
import Toast, { useToast } from '../components/Toast'

const { toast, showToast } = useToast()
// on success:  showToast('success', 'Saved')
// on failure:  console.error('[Page] X failed', error); showToast('error', 'Something went wrong. Please try again.')
// render once, at the end of the page: <Toast toast={toast} />
```
Never pass a raw Supabase/Postgres `error.message` into `showToast` or a banner — log the real error to `console.error()` and show a fixed, friendly string instead.

### 14. Mobile Nav (session 33)
`Sidebar.jsx` is `lg:`-permanent, off-canvas below `lg:` — driven by `src/store/uiStore.js` (`mobileNavOpen`), toggled by a hamburger button in `Header.jsx`. Every authenticated page's shell wrapper must use `lg:ml-60` (not a bare `ml-60`) and `p-4 sm:p-6 lg:p-8` (not a bare `p-8`) so content doesn't get pushed off-screen when the sidebar is off-canvas:
```jsx
<div className="flex min-h-screen bg-[#F5F5F0] dark:bg-[#0F0F0F]">
  <Sidebar />
  <div className="flex-1 flex flex-col lg:ml-60">
    <Header />
    <main className="flex-1 p-4 sm:p-6 lg:p-8">{/* page content */}</main>
  </div>
</div>
```
Wide tables need either a mobile card-list view (`md:hidden` card rows / `hidden md:block` table — see `EmployeeList.jsx`) or, at minimum, an `overflow-x-auto` wrapper around the `<table>` so it scrolls within its own card instead of pushing the whole page into horizontal scroll.

---

## 🌙 Dark / Light Mode Implementation

Use Tailwind's `dark:` prefix + class strategy:

**tailwind.config.js:**
```js
module.exports = {
  darkMode: 'class',
  // ...
}
```

**Toggle in Zustand store:**
```js
// src/store/themeStore.js
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const useThemeStore = create(persist(
  (set) => ({
    isDark: true, // default dark
    toggle: () => set((s) => ({ isDark: !s.isDark })),
  }),
  { name: 'byond-theme' }
))
```

**Apply in App.jsx:**
```jsx
const { isDark } = useThemeStore()
return (
  <div className={isDark ? 'dark' : ''}>
    <div className="min-h-screen bg-[#F5F5F0] dark:bg-[#0F0F0F]">
      {/* app */}
    </div>
  </div>
)
```

---

## 📱 Screens & Pages Reference

*(Updated session 33 to match `App.jsx`'s actual `<Routes>` — this table had drifted: `/` had been the app dashboard, is now the public Landing page; `/dashboard` (the real authenticated entry) plus `/signup`, `/demo`, `/leads`, `/team-analytics`, `/news` were missing entirely.)*

*(Handover note, not part of the original file: as of session 44's audit this table is stale again — `/profile`, `/documents`, `/schedule`, `/schedule/templates`, `/my-schedule`, `/invite/:token` are missing entirely, and `/employees`/`/employees/:id`'s listed roles are missing `admin`. Reproduced here exactly as it stands in the file, uncorrected, per "verbatim.")*

| Screen | Route | Role Access | Status |
|---|---|---|---|
| Landing | `/` | Public — no auth guard, never calls Supabase. Logged-in sessions are redirected to `/dashboard` | ✅ Built |
| Login | `/login` | Public | ✅ Built |
| Signup | `/signup` | Public | ✅ Built |
| Demo request | `/demo` | Public | ✅ Built |
| Unauthorized | `/unauthorized` | Public (shown after a role-guard redirect) | ✅ Built |
| Dashboard | `/dashboard` | All authenticated — role-dispatched (`Dashboard.jsx` renders one of `EmployeeDashboard`/`ManagerDashboard`/`HRDashboard`/`AdminDashboard`/`GenericDashboard` by role) | ✅ Built |
| Attendance | `/attendance` | All authenticated (own) | ✅ Built |
| Leave | `/leave` | All authenticated | ✅ Built |
| KPI | `/kpi` | All authenticated | ✅ Built |
| News Feed | `/news` | All authenticated | ✅ Built |
| Team Analytics | `/team-analytics` | super_admin, hr_manager | ✅ Built |
| Employee List | `/employees` | super_admin, hr_manager | ✅ Built |
| Add Employee | `/employees/new` | super_admin, hr_manager | ✅ Built |
| Employee Detail | `/employees/:id` | super_admin, hr_manager, department_manager | ✅ Built |
| Payroll | `/payroll` | All authenticated (own payslip); Payroll Run + Summary tabs role-gated in-page | ✅ Built |
| Settings | `/settings` | All authenticated (My Privacy & Data tab); other 3 tabs role-gated in-page | ✅ Built |
| Leads | `/leads` | super_admin only (route-guard convenience, not real tenant isolation) | ✅ Built |

---

## 🗂️ Folder Structure Convention

```
src/
├── assets/          ← Logo, images, icons
├── components/
│   ├── layout/      ← Sidebar (mobile off-canvas drawer), Header (hamburger + toolbar)
│   ├── EmptyState.jsx, Skeleton.jsx, Toast.jsx  ← Shared session-33 patterns — see 11–13 above
│   └── [feature]/   ← Feature-specific components
├── pages/           ← One file per route
├── services/        ← supabase.js + API helpers
├── store/           ← Zustand stores (authStore, themeStore)
├── hooks/           ← Custom hooks (useEmployees, useAttendance etc.)
├── utils/           ← Formatters, date helpers, constants
├── App.jsx
├── main.jsx
└── index.css
```

---

## ✅ Rules for Claude Code

1. **Always read** `BYOND-HR_Handover_v1.md` AND `BYOND-Design-System.md` before building
2. **Always use** the exact hex colors from this document — no Tailwind default colors (no `blue-500`, `green-400` etc.)
3. **Default to dark mode** — build dark first, add `dark:` variants for light
4. **No inline styles** — Tailwind classes only
5. **No placeholder/lorem ipsum** — use realistic HR data for mocks
6. **Icons** — use `lucide-react` only (`npm install lucide-react`)
7. **Consistent border radius** — cards `rounded-xl`, buttons `rounded-lg`, pills `rounded-full`
8. **Always update** `BYOND-HR_Handover_v1.md` at end of every session
9. **Use the shared patterns** (session 33) — `EmptyState`/`Skeleton`/`Toast` from `src/components/`, never re-declare a local copy; every page shell uses `lg:ml-60` + `p-4 sm:p-6 lg:p-8`, not a bare `ml-60`/`p-8`, so the mobile nav drawer works; never show a raw Supabase/Postgres error to a user — `console.error()` the real one, show a friendly fixed string

---

*BYOND-hr Design System v1.1 — Confidential — Internal Use Only*

---

*(End of verbatim dump.)*

---

## 2. Employee-Role Screens

Every authenticated page shares the same shell: `Sidebar` (permanent ≥`lg`, off-canvas drawer below it) + `Header` (hamburger + toolbar) + `<main>`. Every one of the 8 pages below has an **"account not linked" guard**: if the logged-in Supabase Auth user has no matching `employees` row (`user_id` FK unset), the page renders Sidebar+Header plus a single amber/orange warning box (icon `AlertTriangle`) instead of any content. Copy varies slightly by page (noted per-screen below) but the pattern is identical everywhere.

An `employee` role never sees management/admin surfaces on any of these pages — no employee picker, no team tabs, no approve buttons. Where a page has role-gated tabs (Leave, Payroll, KPI), employee-role gating is called out explicitly.

### 2.1 Dashboard (`/dashboard`)

`Dashboard.jsx` is a pure **role-dispatch shell**, rendered once regardless of role: Sidebar + Header + `GreetingHeader` (time-of-day greeting + first name + 👋, full date below), then it branches:
- `authLoading` → a 4-card/2-panel skeleton (`DashboardSkeleton`, locally defined in `Dashboard.jsx`) — note this skeleton shape does **not** match `EmployeeDashboard`'s own skeleton (6 cards, 1/2-col split), so there's a visible layout jump between the auth-loading skeleton and the dashboard's own data-loading skeleton.
- `!employee` → **"Account not linked"** / *"Your login ({email}) is not linked to an employee record yet. Please contact your HR manager to complete setup."*
- `role === 'employee'` → renders `<EmployeeDashboard />`

**`EmployeeDashboard.jsx` content, top to bottom:**

1. **Stats row** (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-6`) — 6 `StatCard`s:
   - **Today's Status** — "Not clocked in" / "Clocked in" / "Clocked out"
   - **Today's Shift** — "Day off" if an OFF-type shift exists today; else `"{start}–{end} (template name)"` in 24h format; else `'—'`
   - **Leave Balance** — `"{remaining} days"` or `'—'`
   - **Latest KPI Score** — score to 1 decimal + rating pill, or `'—'`
   - **Active Development Plans** — count, or `'—'`
   - **My Documents** — `"{valid} / {total} valid"`, orange-toned if `valid < total`
2. **Two-column body** (`lg:grid-cols-3`):
   - **Left column:**
     - **Quick Actions** card — 3 icon links: "Clock in/out" → `/attendance`, "Request leave" → `/leave`, "View payslip" → `/payroll`. Pure navigation, no writes.
     - **Latest News widget** (shared component, also used on other role dashboards) — heading + "View all" → `/news`; shows up to 3 most recent published posts (colored category dot, title, author or "BYOND HR" + `BadgeCheck` for system posts, relative time). Each post row links to `/news` generically — **not a deep link to the specific post**.
   - **Right column:**
     - **Development Plans** card — list of the employee's own `active`-status PDP plans: title, target date, and (if baseline/target scores are both set) a Baseline/Current/Target progress bar; otherwise "No baseline/target score set for this plan yet."

**Actions available:** 3 Quick Action links (navigation only), "View all" → `/news`, "Start one on the KPI page" link inside the empty Development Plans state → `/kpi`. Nothing on this page writes to the database — it's entirely read-only display.

**Loading state:** full 6-card + 2-panel pulsing skeleton (`animate-pulse`, `SkeletonBlock`s).

**Empty states:**
- Development Plans: `Target` icon, "No active development plans", "Start one on the KPI page" link.
- Every `StatCard` individually falls back to `'—'` when its value is falsy — the dashboard has no page-level empty state beyond that.

**Error state:** **none.** All 6 parallel fetches (plus a conditional 7th) discard Supabase errors — a failed query silently renders the same as "no data yet," with no console log, no toast, no banner.

### 2.2 Profile (`/profile`)

All-role, read-only "my details" page, added in migration 42 specifically so `employee` (which lost `/employees` and `/settings` access) still has somewhere to see their own record.

**Content, top to bottom:**
1. **Identity + Details grid** (`lg:grid-cols-3`):
   - **Identity card**: large initials avatar (no photo upload — see "What's Thin"), full name, job title (or "No title set"), and an `emp_code` pill if set. A disabled camera badge shows *"Photo upload isn't available yet — using your initials for now."* on click.
   - **Employment card**: Employee Code, Job Title, Department, Hire Date — each falls back to `'—'` if unset.
   - **Job Description card**: free text, or *"No job description set yet — ask HR to add one."*
2. **My Documents** — embeds the shared `DocumentTypeGrid` component (`scope="employee"`, `canManage={false}`) — an employee can view/upload their own HR documents (passport, Emirates ID, contract, etc.) but cannot manage others' or edit the document-type catalog.
3. **Privacy & Data section** (`PrivacyDataSection`, local to this file):
   - **Download My Data** — button calls the `export_employee_data` RPC and downloads a JSON file (PDPL Right to Access).
   - **Consent Management** — one row per 6 fixed consent types (Employee Handbook, Privacy Policy, Data Processing, Application Terms, GPS Tracking, Biometric Data), each showing given/withdrawn/undecided status and a Give/Withdraw button. Every toggle is an **insert**, never an update — an append-only consent ledger.
   - **Submit a Data Request** — form for Rectification/Erasure/Portability/Restriction/Objection (Access is excluded, since Download My Data covers it) + a "Your Requests" history list with due-date/overdue tracking (30-day SLA).
   - **Contact line** — a `mailto:` link to `company.privacy_contact_email`, shown only if the company has configured one; omitted entirely otherwise (not a placeholder).

**"Account not linked" copy:** *"Your login is not linked to an employee record. Contact HR to complete setup."* (no email shown here, unlike the Dashboard's version).

**Loading states:** consent list and request list each show their own small spinner independently; no page-level skeleton (the page renders immediately off whatever `employee` is already in the auth store).

**Empty states:** "No decision recorded yet" per unconsidered consent type; "Your Requests" list is simply omitted (no message) if empty.

**Error state:** every write (download, consent toggle, submit request) shows a friendly toast + `console.error`; reads fail silently to empty lists.

### 2.3 Attendance (`/attendance`) — including the clock-in/out flow

**Page layout:**
1. Header: title "Attendance", subtitle "Your attendance record" (own record — an employee never sees the HR employee-picker/export controls, those are `canAdmin`-gated to `super_admin`/`hr_manager`), month navigator (`‹ Month Year ›`).
2. **Today card** (left): Clock In / Clock Out times, a live `HH:MM:SS` elapsed timer while clocked in, total hours once both are set, a status badge, and the **Clock In / Clock Out button**.
3. **This Week card** (right): Days Present / Hours Worked / OT Hours stat tiles + a 7-day dot strip (Mon–Sun).
4. **Month calendar grid** below — one cell per day, colored dot per status, a small blue GPS pin icon (hover tooltip: *"Clocked in near {lat}, {lng}"*) on any day where `clock_in_lat` was captured. For an employee this grid is **view-only** — day-click-to-edit is `canEdit`-gated to admin roles.

**Status classification** (`STATUS_META`): `present`, `late_minor` ("Late (≤30 min)"), `late_moderate` ("Late (≤60 min)"), `late_major` ("Late (>60 min)"), `absent_approved`, `absent_unauthorized`. Only the first four are ever set automatically by clock-in — the two `absent_*` statuses are **only ever set by an HR/admin manual override**; there is no automatic "mark absent if never clocked in" job visible client-side.

#### The clock-in flow, step by step

Settings loaded on mount govern the whole flow: `shift_settings.late_grace_minutes`/`require_shift_to_clock_in`/`require_gps_clock_in`, `kpi_settings.late_grace_minutes`, `company.work_start_time`.

1. **Pre-gate check** (only for the employee's own record): if `shift_settings.require_shift_to_clock_in` is on (default **off**) and there's no published `work`-type shift for the employee today, the Clock In button is disabled and an orange notice shows either **"Today is your scheduled day off."** (an OFF-type shift exists) or **"No scheduled shift today — contact your manager."** (nothing scheduled at all).
2. Clicking **Clock In**:
   - `role === 'read_only'` → silent no-op (button is hidden for that role anyway; irrelevant to `employee`).
   - GPS is **always attempted first** via `navigator.geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000, maximumAge: 0 })` — a 10-second timeout.
     - If `shift_settings.require_gps_clock_in` is **true** (the default) and geolocation fails/denies/times out/is unsupported: clock-in is **fully blocked**, nothing is written, error shown: **"Location access is required to clock in. Please enable location permissions for this site and try again."**
     - If that setting is **false**: the failure is swallowed and the insert proceeds with `null` lat/lng.
   - **No geofencing exists anywhere** — there is no work-location table, no radius/distance math, no "too far away" error. GPS is captured purely as a permission gate + an informational map pin on the calendar, despite the column names (`clock_in_lat/lng`) suggesting a proximity check was intended.
   - A same-day published `work`-type shift is looked up (read-only, for classification purposes only) to determine the expected start time and which grace-period setting applies.
   - **Late classification**: `diffMin = (now − expectedStart) / 60000`; `≤ grace` → `present`; `≤ grace+30` → `late_minor`; `≤ grace+60` → `late_moderate`; else `late_major`. If a shift was found, `expectedStart` = the shift's start and grace = `shift_settings.late_grace_minutes`; otherwise `expectedStart` = today at `company.work_start_time` and grace = `kpi_settings.late_grace_minutes` (two separate, intentionally-different grace settings — see "What's Thin").
   - **Insert**: `attendance {company_id, employee_id, date, clock_in, status, clock_in_lat, clock_in_lng}`.
   - On DB error: **"Something went wrong clocking in. Please try again."**
3. **Clock Out** follows the identical GPS pattern (error text: *"Location access is required to clock out..."*) and does `attendance.update({clock_out, clock_out_lat, clock_out_lng}).eq('id', todayRecord.id)`.

**Loading states:** Today card and calendar each show their own pulsing skeleton while fetching. Button-level: "Clocking in…"/"Clocking out…" spinner while in flight.

**Empty state:** calendar cells with no record just show a plain gray dot (legend labels it "No record"); no dedicated empty-state component on this page.

**Error states (exact copy):**
- *"Location access is required to clock in. Please enable location permissions for this site and try again."*
- *"Location access is required to clock out. Please enable location permissions for this site and try again."*
- *"Today is your scheduled day off."* / *"No scheduled shift today — contact your manager."*
- *"Something went wrong clocking in. Please try again."*
- *"Something went wrong clocking out. Please try again."*
- Account-not-linked: **"Your login is not linked to an employee record. Contact HR to complete setup."**

### 2.4 Leave (`/leave`)

Three tabs: **My Leave** (all roles), **Team Requests** (`super_admin`/`hr_manager`/`department_manager` only — **not visible to `employee`**), **Calendar** (all roles). "Request Leave" button in the header is hidden only for `read_only`, so an `employee` always sees it.

**My Leave tab, top to bottom:**
1. Summary row: Pending / Approved / Rejected / Total Requests counts.
2. **Leave Balances — {year}** — one `BalanceCard` per each of 9 leave types (annual, sick, emergency, marriage, paternity, maternity, hajj, bereavement, study), always rendered even for types with no balance row (shows 0/0). Progress bar = used/entitled%, "Exceeded" label if remaining < 0.
3. **Request History** table — Type / From / To / Days / Status (via a 3-stage `LeaveStageTimeline`: Requested → Manager → HR) / a **Cancel** button on the requester's own rows while `status === 'pending'`.

**Leave types:** annual, sick, emergency, marriage, paternity, maternity, hajj, bereavement, study.

#### The leave request flow, end to end

1. **Request Leave** opens a modal: Leave Type select, From/To date inputs (To auto-bumps to stay ≥ From), a live "N day(s) requested" pill, and a required Reason textarea.
2. Client validation: both dates required; end ≥ start; reason non-blank. **No balance-sufficiency check** — a request can be submitted even past the remaining balance (the balance card will simply show "Exceeded" afterward).
3. **Submit** inserts `leave_requests {company_id, employee_id, leave_type, start_date, end_date, days_requested, reason, status: 'pending'}`.
4. **Immediately on success** (before final approval), the app **optimistically decrements** `leave_balances.used_days` by the day count for that employee/type/year. If no balance row exists yet for that type/year, this step is a **silent no-op** — no row is created, no error shown (see "What's Thin").
5. Toast: **"Leave request submitted successfully"**; on failure: **"Something went wrong submitting your request. Please try again."**

**Approval is a two-step workflow** (`pending → manager_approved → approved`, DB-trigger-enforced via `aa_leave_transition`):
- A `department_manager` approving a `pending` request moves it to `manager_approved` ("Approve (Step 1)").
- `hr_manager`/`super_admin` approving (from either `pending` or `manager_approved`) moves it straight to `approved` ("Final Approve") — this lets HR finalize directly for teams with no manager.
- Rejection can happen from either step by the appropriate role.
- **An `employee` cannot approve or reject anyone's leave** — confirmed: `canManage` (which gates the whole Team Requests tab) is `{super_admin, hr_manager, department_manager}` only; `employee` is never in that set.

**Cancel / withdraw:** the requester can cancel **their own** request, but **only while it is still `status === 'pending'`** — once a department manager gives step-1 approval, the Cancel button disappears (the employee cannot self-withdraw past that point). Cancelling reverts the balance deduction the same way reject does. This previously had a real RLS gap (an `employee`'s own `UPDATE` on `leave_requests` had no grant at all) — **fixed by migration 44** (`leave_self_update` policy), confirmed live in the session-44/45 audits; the Cancel button now genuinely works for a plain `employee`.

**Calendar tab:** month grid, up to 2 leave "chips" per day + "+N more"; a non-HR viewer (including `employee`) sees only **their own** approved leave, labeled by leave type (HR/super_admin see everyone's, labeled by first name).

**Loading/empty/error states:**
- No employee record: *"Your login is not linked to an employee record. Contact HR to complete setup."*
- No requests yet: `CalendarDays` icon, **"No leave requests yet"** / *"Your requests will appear here once submitted"* + a "Request Leave" CTA.
- Submit failure: *"Something went wrong submitting your request. Please try again."*
- Cancel failure (RLS silently matched 0 rows, no thrown error): *"Could not cancel this request. Please contact HR."*
- Approve/reject/cancel DB-trigger errors are shown **verbatim** via `error.message` (not applicable to a plain employee, who never sees the approve/reject controls).

### 2.5 Payroll (`/payroll`)

Tabs: **My Payslip** (all roles — this is the *only* tab an `employee` ever sees), **Payroll Run** (`super_admin`/`hr_manager` only), **Summary** (`super_admin`/`hr_manager`/`read_only` only). Both `employee` and `department_manager` are excluded from Run and Summary — a department manager gets **no team-payroll visibility at all** in this codebase today, same as a plain employee.

**My Payslip tab, top to bottom:**
1. **Current Period card** — if a `payroll_runs` row exists for the current month: header band (period label, "Paid on {date}" if paid, status pill Draft/Approved/Paid, a Reveal/Hide amounts eye toggle), a 3-column Gross/Deductions/Net row, an Earnings Breakdown column (Basic/Housing/Transport/Other/Overtime/Bonus), a Deductions Breakdown column, and a **Download Payslip** button (renders a PDF client-side via `@react-pdf/renderer` and triggers a browser download — no server round trip, no `payslip_url` storage; regenerated fresh every click). If no run exists yet: empty variant — mint `Wallet` icon, **"No payslip yet for this period"** / *"Your payslip will appear here once payroll has been run."*
2. **Previous Months** table — Period / Gross / Net (both **always masked** here, `'•••,••• AED'`, with no way to reveal in this list view — must open a row) / Status; clicking a row opens a detail modal with its own independent reveal toggle.

**Amounts are masked by default everywhere** (`maskSalary()` → literal `'•••,••• AED'`, a constant string, not a partial reveal) — the employee must click the eye icon per-card/per-modal to see real numbers.

**What an employee can/cannot see:** only their **own** payslips, filtered by `employee_id` — there is no UI path to another employee's payroll data. They cannot see or run the company payroll cycle, cannot approve/mark-paid, and cannot see company-wide cost summaries.

**Loading:** two stacked skeleton blocks. **Empty:** "No payslip yet for this period" (current) / "No previous payslips on record" (history). **Error:** PDF generation failure → *"Something went wrong generating the payslip PDF. Please try again."*

### 2.6 KPI (`/kpi`)

Tabs: **My KPI**, **History** (both all-roles), **Team KPI** and **Warnings & Rewards** (`super_admin`/`hr_manager`/`department_manager` for Team KPI, `super_admin`/`hr_manager` only for Warnings — **neither visible to `employee`**), **Development Plans** (all roles, via `PDPTab`, with `canManage=false` for employee — own-plan view only).

**My KPI tab — how score/breakdown/rating are presented:**
- **Left "gauge card"**: period label (e.g. "August 2026"), an "Evaluation window open" green pill if the current month is an evaluation month, a circular SVG **ring gauge** (176px, animated arc) with the rounded score in the center and "/ 100" below, a **rating badge** pill (colored per rating, or **"Not Yet Rated"** gray if no row exists yet), a "Bonus Eligible" green line + Gift icon if applicable, and a **"How is this calculated?"** link that opens a breakdown popover.
- **Right "Score Breakdown" card**: one bar per component — **Attendance (30%)**, **Behavior (25%)**, **Achievement (20%)**, **Manager Evaluation (15%)**, **Self Evaluation (10%)** — each showing `"{weight}% weight · {value}/100"` and a horizontal progress bar. Attendance carries an extra green *"Auto-calculated from attendance"* note and an info-icon tooltip listing the per-status point table (Present=100, Late minor=85, Late moderate=70, Late major=50, Absent approved=80, Absent unauthorized=0).
- **Rating thresholds** (mirrors a DB function): ≥90 Exceptional (purple) · ≥75 High Performer (green) · ≥60 Meets Expectations (blue) · ≥45 Needs Improvement (orange) · <45 Unsatisfactory (red) · no row → "Not Yet Rated" (gray).
- **Self-evaluation section**, below the grid: during an evaluation month (company-configurable cadence, e.g. every June/December by default), an `employee` sees an editable form — a 0–100 slider (**contributes 10% of the total**) + optional comments, "Submit Self-Evaluation"/"Update Self-Evaluation". Outside an evaluation month: a locked panel — *"Self-evaluation is only open during evaluation months."* + "Next evaluation: {Month Year}"; if a prior self-score exists, a footnote explains it's carried forward.

**History tab:** a hand-rolled SVG trend line (no chart library) of `total_score` over time, plus a full month-by-month table (Attendance/Behavior/Achievement/Manager/Self/Total/Rating/Bonus columns), each Total cell with its own "How is this calculated?" popover. Empty state: *"No KPI history yet — scores will appear here once your first month is evaluated."*

**Every action an `employee` has on this page:** switch tabs (My KPI / History / Development Plans only — Team KPI and Warnings & Rewards never render for this role); during an eval month, drag the self-score slider, type comments, submit; open/close the "How is this calculated?" popover; in Development Plans, mark their own action items complete (cannot create/manage plans for others).

**Account-not-linked copy:** *"Your login is not linked to an employee record, so no KPI data can be shown. Contact HR to complete setup."*

### 2.7 My Schedule (`/my-schedule`)

Read-only weekly shift view, own shifts only — no create/edit capability anywhere on this page (that lives in the admin-only `/schedule` + `ShiftModal`, which an `employee` never reaches).

**Content:** week navigator (`‹ / ›` + a "Today" reset link when off the current week), then one card per day (Mon→Sun, or per the company's configured `week_starts_on`):
- No shift that day → muted **"No shift scheduled"**.
- OFF-type entry → `Moon` icon + **"Day off"**.
- Normal shift → time range (e.g. "09:00 AM – 05:00 PM"), template name if any, optional notes, and a status pill: `published` → "Scheduled" (mint), `completed` → "Completed" (blue), `no_show` → "No-Show" (red). Draft (`scheduled`-status) shifts are **never visible** to an employee — enforced by RLS, not a client-side filter, so there's no code path that could accidentally leak an unpublished shift here.

**Loading:** 7 pulsing skeleton rows. **Empty (whole week has zero shifts):** `Calendar` icon, **"No shifts scheduled this week"** / *"Published shifts assigned to you will show up here."* **Error:** none — a failed fetch silently renders identically to "no shifts this week," with no console log or banner.

### 2.8 News Feed (`/news`)

All-role page; an `employee` can post only if `employees.can_post_feed` is explicitly granted by HR (the default composer roles are `super_admin`/`hr_manager`/`department_manager` — a plain employee is **not** in that set unless individually flagged).

**Content, top to bottom:**
1. Header: "News Feed" + subtitle; a "New Post" button only if the viewer can post.
2. Category filter chips: All / Announcements / News / Achievements / Training / Policy.
3. **Your Drafts** section — only for users who can post and have drafts.
4. **Feed** — pinned posts first, then reverse-chronological. Each `PostCard`: pin badge if pinned, avatar (system `BadgeCheck` + "BYOND HR" for DB-generated posts, or the author's initials), category tag, title, body, a 4-reaction bar (Like/Celebrate/Support/Insightful — **disabled entirely for `read_only`, not relevant to `employee`**), and a comment toggle with inline comment thread (post/edit/delete own comments; editing swaps to an inline input, Enter saves, Escape cancels).

**Every action available to a plain `employee` (assuming default, non-`can_post_feed` grant):** filter by category, react to any post (Like/Celebrate/Support/Insightful — toggling the same reaction again removes it; picking a different one swaps it), expand comments, post/edit/delete their own comments (delete on others' comments requires moderator role, which `employee` doesn't have).

**Empty states:** no posts at all → `Newspaper` icon, **"No posts yet"** / *"Check back soon for company updates"* (non-poster copy); filtered to an empty category → **"Nothing here yet"**; no comments on a post → *"No comments yet — be the first to reply."*

**Error handling:** this page is the most defensive of the employee-facing screens — every write (react, comment, edit, delete) shows a specific toast (e.g. *"Something went wrong saving your reaction. Please try again."*) plus a matching `console.error`. Reads still fail silently to empty lists.

**Account-not-linked copy:** *"Your login is not linked to an employee record. Contact HR to complete setup."* (no email shown, unlike Dashboard's version — a minor copy inconsistency across the app).

---

## 3. Shared Patterns

### `authStore.js` (Zustand, `src/store/authStore.js`)

**State shape:**
```js
{
  session: null,       // Supabase auth session object
  employee: null,      // sanitized `employees` row — see SAFE_SELECT below
  role: null,           // plain string: super_admin | hr_manager | department_manager | admin | employee | read_only
  companyId: null,      // tenant scope
  company: null,         // { id, name, plan, trial_ends_at, created_via, privacy_contact_email } | null
  sessionToken: null,     // Supabase access_token — in-memory only, never persisted by this store
  loading: true,
}
```
- `employee` is fetched via a restricted **`SAFE_SELECT`** column list that explicitly excludes salary/bank/national_id: `id, user_id, full_name, email, phone, photo_url, job_title, department_id, classification, contract_type, hire_date, status, can_post_feed, emp_code, job_description, departments!employees_department_id_fkey(name)`.
- **`init()`**: reads any existing Supabase session, calls `loadProfile`, and subscribes to `onAuthStateChange` (returns the subscription so `App.jsx` can unsubscribe on unmount, deliberately avoiding a StrictMode double-listener bug).
- **`loadProfile(session)`**: fetches `employees` (SAFE_SELECT) + `user_roles.{role, company_id}` + `company` in sequence, then `sanitizeEmployee()`s the result as a defense-in-depth pass (belt-and-suspenders on top of `SAFE_SELECT` already excluding sensitive fields) before writing to state.
- **`registerSession(accessToken)`**: calls `createUserSession()` (see below), stores the token.
- **`signOut()`**: ends the server-tracked session row **before** calling Supabase's own `auth.signOut()`, then clears every field.
- No role-checking helper methods exist on the store — every consuming page does its own ad hoc `Set` of allowed roles (e.g. `TEAM_ROLES`, `WARN_ROLES` in `KPI.jsx`).

### Session timeout & concurrent sessions

- **`useSessionTimeout({ onWarn, onTimeout })`** (`src/hooks/useSessionTimeout.js`): pure client-side wall-clock idle tracker. Listens for `mousemove/keydown/mousedown/touchstart/scroll/click`, polls every **30 seconds**. Fires `onWarn` once at **25 minutes** idle, fires `onTimeout` at **30 minutes** idle (and keeps firing every subsequent poll if the caller doesn't actually end the session). Renders no UI itself — `SessionTimeoutModal.jsx` (not read in detail for this brief) is presumably the consumer that shows the countdown + "Stay logged in" button.
- **Separately**, the DB-tracked `user_sessions` table gives each session its **own 30-minute `expires_at`**, set via `createUserSession()`. This is a second, independent 30-minute timer that the client-side hook does not reconcile against.
- **`sessionService.js`** (`src/services/sessionService.js`) wraps 4 RPCs, no direct table queries: `logLoginAttempt(email, success)`, `getActiveSessionCount()` (returns `0` on error), `createUserSession(token)` (sets `expires_at = now + 30min`), `endUserSession(token)`. Actual concurrency enforcement (max 2 active sessions per the handover's DB docs) lives server-side in these RPCs — nothing in the read files directly blocks a 3rd login client-side, though `Login.jsx` (not read for this brief) is documented elsewhere as calling `get_active_session_count()` post-login.

### `security.js` masking helpers (`src/utils/security.js`)

| Function | Signature | Behavior |
|---|---|---|
| `maskBankAccount` | `() => string` | Always returns the constant `'•••• •••• •••• ••••'` — no partial reveal, ignores input. |
| `maskSalary` | `() => string` | Always returns the constant `'•••,••• AED'` — currency hardcoded to AED regardless of company. |
| `maskNationalId` | `(id) => string` | `'••••'` if missing/short; otherwise `'••••••' + id.slice(-4)` (last 4 chars visible). |
| `maskDocumentNumber` | `(num) => string` | Identical shape to `maskNationalId`. |
| `sanitizeEmployee` | `(employee) => object\|null` | Strips `SENSITIVE_FIELDS` (`basic_salary, housing_allowance, transport_allowance, other_allowance, bank_account, national_id`) from a shallow copy. Used by `authStore.loadProfile`. |

### `localDateStr()`

Returns local `YYYY-MM-DD` (deliberately **not** `toISOString().slice(0,10)`, to avoid the classic UTC-shift-by-one-day bug near midnight). The **canonical exported version** lives in `src/utils/exportHelpers.js` with a default parameter (`d = new Date()`); it is independently **re-implemented locally, without a default parameter, in at least 9 other files** (`Attendance.jsx`, `Leave.jsx`, `Payroll.jsx`, `Profile.jsx`, `EmployeeDetail.jsx`, `MySchedule.jsx`, `Schedule.jsx`, `ShiftModal.jsx`, `PDPTab.jsx`). Calling one of those local copies with **no argument** throws (`Cannot read properties of undefined`) — only the two files that actually `import` from `exportHelpers.js` (`Documents.jsx`, `EmployeeList.jsx`) can safely call it bare. `KPI.jsx` doesn't use this helper at all (it has its own `periodLabel(year, month)`).

### Other shared utilities/components an employee-facing page depends on

- **`EmptyState.jsx`** / **`Skeleton.jsx`** (`SkeletonBlock`, `SkeletonRow`) / **`Toast.jsx`** (`useToast()` + `<Toast>`) — see Design System items 11–13 above; used consistently across Dashboard/Attendance/Leave/Payroll/KPI/MySchedule/NewsFeed, with two known exceptions (`EmployeeDetail.jsx` and `PDPTab.jsx` locally re-implement a divergent empty-state instead of importing the shared one — an HR/admin-facing file, not employee-facing, but worth knowing the shared component isn't universally used).
- **`accessMatrix.js`** (`src/data/accessMatrix.js`) — a 38-row static reference table (`ROLES`, `ROLE_LABELS`, `LEGEND` [F/W/O/B/R/-], `ACCESS_MATRIX`) mirroring `BYOND-HR_Access_Control_Standard.md §3`, rendered on a `/permissions` page (not covered in this brief since it's not an `employee`-reachable route in the audited role list, though the matrix itself documents what `employee` can/cannot do across every module). Declared as needing to be kept in sync with the Standard doc by hand — nothing enforces that automatically.
- **`PayslipPDF.jsx`** — the `@react-pdf/renderer` document used by Payroll's Download button; duplicates (does not import) `Payroll.jsx`'s own `computeGross`/`computeNet`/`fmtMoney`/`periodLabel` helpers.

---

## 4. Data Calls — per employee screen

### Dashboard (`EmployeeDashboard.jsx`)
All fired in parallel on mount / `employee?.id` change, **no error handling on any of them**:
| Table/View | Op | Columns | Filters |
|---|---|---|---|
| `attendance` | select | `clock_in, clock_out` | `.eq('employee_id', id).eq('date', today).maybeSingle()` |
| `leave_balances` | select | `remaining_days` | `.eq('employee_id', id).eq('year', currentYear)` |
| `kpi_scores` | select | `total_score, rating, period_year, period_month` | `.eq('employee_id', id).order(year desc).order(month desc).limit(1)` |
| `pdp_plans` | select | `id, title, focus_component, baseline_score, target_score, target_date` | `.eq('employee_id', id).eq('status','active')` |
| `employee_compliance_status` (view) | select | `compliance_status` | `.eq('employee_id', id)` |
| `today_schedule` (view) | select | `start_at, end_at, template_name, shift_type` | `.eq('employee_id', id).order('start_at').limit(1).maybeSingle()` |
| `pdp_progress` | select (conditional, if plans exist) | `plan_id, score, period_year, period_month` | `.in('plan_id', planIds).order(year).order(month)` |

### Attendance (`Attendance.jsx`)
| Table | Op | Columns | Filters |
|---|---|---|---|
| `shift_settings` | select | `late_grace_minutes, require_shift_to_clock_in, require_gps_clock_in` | `.eq('company_id', companyId).maybeSingle()` |
| `kpi_settings` | select | `late_grace_minutes` | `.eq('company_id', companyId).maybeSingle()` |
| `company` | select | `work_start_time` | `.eq('id', companyId).maybeSingle()` |
| `shifts` | select | `id, shift_type, status` | `.eq('employee_id', id).eq('shift_date', today).neq('status','cancelled')` (gate check) |
| `attendance` | select | `*` | `.eq('employee_id', id).gte('date', monthStart).lte('date', monthEnd)` (calendar) |
| `attendance` | select | `*, shifts(start_at, end_at, shift_templates(name))` | `.eq('employee_id', id).gte('date', weekStart).lte('date', weekEnd)` (today+week) |
| `shifts` | select | `id, start_at` | `.eq('employee_id', id).eq('shift_date', today).eq('shift_type','work').in('status', ['published','completed']).order('start_at').limit(1).maybeSingle()` (classify) |
| `attendance` | **insert** | `company_id, employee_id, date, clock_in, status, clock_in_lat, clock_in_lng` | — (Clock In) |
| `attendance` | **update** | `clock_out, clock_out_lat, clock_out_lng` | `.eq('id', todayRecordId)` (Clock Out) |

### Leave (`Leave.jsx`) — My Leave tab + Calendar tab only (Team Requests not reachable)
| Table | Op | Columns | Filters |
|---|---|---|---|
| `leave_balances` | select | `*` | `.eq('employee_id', id).eq('year', currentYear)` |
| `leave_requests` | select | `*` | `.eq('employee_id', id).order('created_at', desc)` |
| `leave_requests` | select (calendar) | `*` | `.eq('status','approved').eq('employee_id', id).gte/lte(month range)` |
| `leave_requests` | **insert** | `company_id, employee_id, leave_type, start_date, end_date, days_requested, reason, status:'pending'` | — |
| `leave_balances` | select then **update** | `used_days += days` | by employee/type/year (submit) |
| `leave_requests` | **update** | `{status:'cancelled'}` | `.eq('id', reqId).select().maybeSingle()` (Cancel) |
| `leave_balances` | select then **update** | `used_days -= days` (floored at 0) | by employee/type/year (after cancel) |

### Payroll (`Payroll.jsx`) — My Payslip tab only
| Table | Op | Columns | Filters |
|---|---|---|---|
| `payroll_runs` | select | `*` | `.eq('employee_id', id).order(year desc).order(month desc)` |
| `company` | select | `name, country, currency` | `.eq('id', companyId).single()` (for PDF) |

### KPI (`KPI.jsx`) — My KPI + History tabs only
| Table | Op | Columns | Filters |
|---|---|---|---|
| `kpi_settings` | select | `evaluation_frequency_months, evaluation_anchor_month` | `.maybeSingle()` |
| `kpi_scores` | select | `*` | `.eq('employee_id', id).eq('period_year', y).eq('period_month', m).maybeSingle()` (My KPI) |
| `kpi_scores` | **update** or **insert** | `self_score, notes` (update) / `company_id, employee_id, period_year, period_month, self_score, notes` (insert) | self-eval submit |
| `kpi_scores` | select | `*` | `.eq('employee_id', id).order(year asc).order(month asc)` (History) |

### My Schedule (`MySchedule.jsx`)
| Table | Op | Columns | Filters |
|---|---|---|---|
| `shift_settings` | select | `week_starts_on` | `.eq('company_id', companyId).maybeSingle()` |
| `shifts` | select | `id, shift_date, start_at, end_at, break_minutes, status, notes, shift_type, shift_templates(name, color)` | `.eq('employee_id', id).gte/lte(week range).order('start_at')` — relies entirely on RLS to hide draft (`scheduled`-status) shifts, no client-side status filter |

### News Feed (`NewsFeed.jsx`)
| Table | Op | Columns | Filters |
|---|---|---|---|
| `feed_posts` | select | `*, employees(full_name)` | `.eq('status','published').order('pinned' desc).order('published_at' desc)` — **no `.limit()`, fetches every published post ever** |
| `feed_reactions` | select | `id, post_id, employee_id, reaction` | `.in('post_id', visibleIds)` |
| `feed_comments` | select | `id, post_id` (counts only) | `.in('post_id', visibleIds)` |
| `feed_comments` | select (on expand) | `*, employees(full_name)` | `.eq('post_id', id).order('created_at' asc)` |
| `feed_reactions` | **insert**/**delete** | `company_id, post_id, employee_id, reaction` | react/un-react/switch (delete-then-insert, not atomic) |
| `feed_comments` | **insert**/**update**/**delete** | `company_id, post_id, employee_id, body` | post/edit/delete own comment |

---

## 5. What's Thin

Ranked by how directly it affects an `employee` user. All of this is drawn from the handover's own Known Gaps log and two internal audits (session 44 functional audit, session 45 confirmation audit vs. the Access Control Standard) plus bugs surfaced during this brief's own source reads — none of it is speculation.

### 🔴 Most severe: clock-out silently does nothing for a plain employee
`attendance`'s `att_update` RLS policy is `USING (role IN ('super_admin', 'hr_manager'))` **only** — there is no "own record" branch at all. `Attendance.jsx`'s `clockOut()` runs `supabase.from('attendance').update(...).eq('id', todayRecord.id)`, which for an `employee` (or `department_manager`/`admin`/`read_only`) matches **zero rows** — Postgres/PostgREST returns success (200, 0 rows affected) with **no error**, so the UI has no way to detect the failure. Confirmed live via `pg_policies` in the session-45 audit and flagged as the single most consequential finding in that pass. **This needs a DB migration** (a new `att_self_update` policy mirroring `leave_self_update`'s shape) before employee-role clock-out can work at all in production — not a frontend fix.

### No geofencing despite capturing GPS
Both `require_gps_clock_in`'s permission gate and the calendar's map-pin display work as described, but there is no work-location table, no distance/radius math, and no "too far from the office" error anywhere in the codebase — GPS is purely a permission check + informational marker, not a location-validation mechanism, despite the column names (`clock_in_lat/lng`) and the settings copy ("Require GPS to Clock In") implying stricter enforcement.

### Dashboard shows less than the design implies
`EmployeeDashboard.jsx` only ever selects/renders `total_score`, never the per-component breakdown (`attendance_score` etc.) — that only exists on the HR-facing `EmployeeDetail.jsx`. Confirmed as a real (if minor) gap in the session-44 flow audit.

### Silent failure is the dominant error-handling pattern for reads
Every read-only fetch across Dashboard, Attendance's calendar, My Schedule, and KPI's My KPI/History tabs discards the Supabase `error` and falls back to an empty/zero state — a network failure, an RLS denial, and "genuinely no data yet" are all visually indistinguishable to the employee. Writes are much better handled (toast + `console.error` on Leave, Payroll, NewsFeed, Profile) — reads are the weak spot everywhere.

### Leave balance edge cases
If an employee requests a leave type they have no `leave_balances` row for yet, the optimistic decrement on submit (and the revert on cancel/reject) is a **silent no-op** — the request still submits successfully, but the balance card for that type keeps showing 0/0 forever, with no error or auto-created row.

### KPI evaluation window is frontend-only
The self-eval form/lock is a UI convenience — nothing at the RLS/trigger level stops a direct write to `self_score` outside an evaluation month. Not something an `employee` can normally trigger through the UI, but worth knowing this isn't a real security boundary.

### Never click-tested as `employee` in a real browser
Per the handover's own Known Gaps log (session 32, "only one real login exists," still true through at least session 45 for actual credentialed browser testing): every behavior in this brief is verified by direct source reading and (where noted) live RLS/trigger confirmation via Supabase MCP — **not** by an actual employee logging in and clicking through. Treat anything not explicitly marked "confirmed live" as code-path-complete rather than QA-verified.

### Smaller, lower-priority items
- **No pagination** on the News Feed's post fetch — every published post ever created loads on every visit.
- **`StatCard`'s `value || '—'` fallback** would incorrectly render `'—'` for a legitimate numeric `0` — current callers avoid this by pre-formatting to strings, but it's a latent footgun in the shared component.
- **Dead hover affordance**: Attendance's calendar-cell edit-pencil icon uses `group-hover:opacity-100` but the parent never gets the Tailwind `group` class, so it never actually appears (harmless — the cell is admin-only anyway, not employee-reachable).
- **No idempotency guard** against a double clock-in/out race (e.g. two browser tabs) — the UI relies purely on the last-fetched `clockedIn`/`clockedOut` booleans to hide the wrong button.
- **Profile photo upload is not built** — explicitly deferred per the task that built `Profile.jsx`; the camera badge is permanently disabled with a "not available yet" tooltip.
- **Two independent 30-minute session timers** exist (the client-side idle hook and the DB's `user_sessions.expires_at`) that are never reconciled against each other.
- **Bundle size**: no code-splitting anywhere in the app — every employee-facing page (KPI.jsx is the single largest file in the app at 1,638 lines) ships in one 826 KB gzip bundle regardless of route, over half of which (`@react-pdf/renderer`) is only used by Payroll's Download button. Not employee-specific, but affects every employee page load.

