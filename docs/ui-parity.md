# Cross-platform UI parity

The web app and the mobile app are the same product. A person who uses both should
not have to learn two vocabularies or two visual languages.

This file is the contract. Both platforms mirror it: `src/data/vocabulary.js` on
web, `mobile/src/lib/vocabulary.js` on mobile. Change this file and both, in the
same session.

## Canonical vocabulary

One name per concept, used in navigation, screen titles, buttons and quick
actions. Where a name previously differed, the shorter and plainer one won —
mobile tiles and tab bars truncate at 390px, and a label that fits everywhere is
worth more than a more formal one that doesn't.

| Concept | Canonical | Was on web | Was on mobile |
|---|---|---|---|
| Landing screen after sign-in | **Home** | Dashboard | Home |
| Own record | **My profile** | My Profile | Profile |
| Employee directory | **Employees** | Employees | — |
| Clock in / out and history | **Attendance** | Attendance | Attendance / Work |
| Leave balance and requests | **Leave** | Leave | Leave |
| Payslips and payroll runs | **Payroll** | Payroll | Payslips |
| Scores and evaluation | **KPI** | KPI Scores | KPI / Performance |
| Company-wide performance | **Team analytics** | Team Analytics | — |
| HR document store | **Documents** | HR Documents | Documents |
| Shift planning | **Schedule** | Schedule | Shift schedule |
| Own published shifts | **My schedule** | My Schedule | My schedule |
| Company announcements | **News** | News Feed | Announcements |
| Roles and permissions | **Access** | Permissions | Access & permissions |
| Configuration | **Settings** | Settings | Settings |
| Approvals queue | **Approvals** | — | Leave approvals |
| Ops surface | **Operations** | — | Operations |

`KPI` rather than `Performance`: it fits a 390px tab bar without truncating, the
route is `/kpi` on both platforms, and the handbook uses the term throughout
(Art. 14, "KPI Scoring System").

`News` rather than `Announcements`: same reason — it fits a 96px quick-action tile
on one line.

## Shared visual tokens

Already aligned, recorded here so they stay that way. Source of truth is
`BYOND-Design-System.md`; `mobile/src/theme.js` and the web's Tailwind classes
both express these.

| Token | Value | Web | Mobile |
|---|---|---|---|
| Accent | `#00D4A0` | `[#00D4A0]` | `brand.mint` |
| Accent hover | `#00B589` | `[#00B589]` | `brand.mintHover` |
| On-accent text | `#062B22` | — | `brand.onMint` |
| Page ground (light) | `#F5F5F0` | `bg-[#F5F5F0]` | `light.bg` |
| Page ground (dark) | `#0F0F0F` | `dark:bg-[#0F0F0F]` | `dark.bg` |
| Surface (light/dark) | `#FFFFFF` / `#1E1E1E` | same | `surface` |
| Border (light/dark) | `#E8E8E8` / `#2A2A2A` | same | `border` |
| Danger | `#FF4D4D` | same | `semantic.danger` |
| Warning | `#FF8C42` | same | `semantic.warning` |
| Info | `#4D9FFF` | same | `semantic.info` |
| Purple | `#A78BFA` | same | `semantic.purple` |
| Card radius | 12px | `rounded-xl` | `radius.md` |
| Control radius | 8px | `rounded-lg` | `radius.sm` |
| Pill radius | full | `rounded-full` | `radius.pill` |

Rating vocabulary and colours are already identical on both platforms and match
Art. 14's bands: Exceptional (purple), High Performer (mint), Meets Expectations
(info), Needs Improvement (warning), Unsatisfactory (danger). A null rating renders
as "Not yet rated" on both, which the KPI coverage change made reachable.

## Differences that are intentional

Not everything should match. These differ because the platforms differ, not
because they drifted:

- **Navigation shape.** Web uses a persistent left sidebar; mobile uses a bottom
  tab bar of five plus a drawer. A sidebar on a phone wastes the width, and a tab
  bar on a desktop wastes the height.
- **Chrome colour.** Mobile's top bar and drawer are dark in both themes, which is
  what frames the light content on a small screen. The web's header sits on the
  page surface instead.
- **Quick actions.** Mobile puts a scrolling tile row on Home because reaching a
  destination costs more taps on a phone. The web's sidebar already exposes every
  destination at once.
- **Masking and reveal.** Both mask salary by default, but the web's reveal control
  is per-row in a table; mobile expands a card. Same rule, different affordance.

## Known gaps, tracked not fixed

Feature parity is not the same as visual parity, and these are still one-sided:

- Web has no "my access" view for non-owners; mobile shows every role what its
  own role grants. The web's `/permissions` is `super_admin`-only.
- Web has no Operations surface for the `admin` role.
- Mobile has no employee directory, team analytics, payroll run, or document
  management — those are deliberately desktop-first for now.
- Web hardcodes `AED` in four files; mobile reads `company.currency` throughout.
