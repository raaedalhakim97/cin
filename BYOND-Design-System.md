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
