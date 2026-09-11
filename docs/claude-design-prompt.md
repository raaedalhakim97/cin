# Claude Design prompt — BYOND

Paste the block below into Claude Design. It carries the real design system out of this
repo, so the output matches the app instead of a generic dashboard look.

Swap the **Screens to redesign** list for whatever you want examples of. Keep everything
else — especially the "What must not change" section, which is what stops a design tool
inventing features BYOND does not have.

---

```
You are redesigning screens for BYOND, a multi-tenant HR platform used by small and
medium businesses internationally — Gulf, Africa, South Asia, UK. The users are HR
managers, department managers, business owners and ordinary employees. Many are on
phones. Many are not native English speakers. Nobody using this is a designer.

This is a VISUAL redesign of screens that already exist and already work. Produce
artboards showing what they should look like — not new features.

## The design system, taken from the live code — use these exact values

Font: Inter (400, 500, 600, 700). System sans fallback.

Colours — light mode:
  #F5F5F0  page background
  #FFFFFF  card / surface
  #E8E8E8  borders
  #1A1A1A  primary text
  #666666  secondary text
  #AAAAAA  placeholder / tertiary

Colours — dark mode:
  #0F0F0F  page background
  #1E1E1E  card / surface
  #1A1A1A  sidebar surface
  #252525  input background
  #2A2A2A  borders
  #FFFFFF  primary text
  #A0A0A0  secondary text
  #555555  placeholder / tertiary

Accent and status — identical in both modes:
  #00D4A0  primary / mint — the brand colour, used for actions, active states, success
  #00B589  primary hover
  #FF4D4D  error / destructive
  #FF8C42  warning / trial / attention
  #4D9FFF  informational
  #A78BFA  secondary accent, used sparingly

Tinted states are the accent at 10% over the surface, with the accent as the text
colour — e.g. an active tab is background #00D4A0 at 10%, text #00D4A0. Badges and
inline alerts follow the same rule with their own colour.

Shape and spacing:
  Cards            rounded-xl (12px), 1px border, padding 24px, NO drop shadows
  Inputs, buttons  rounded-lg (8px)
  Badges, pills    fully rounded
  Page padding     16px mobile / 24px tablet / 32px desktop
  Card gap         24px
  Icons            Lucide, 13–18px, usually 15px, accent-coloured when meaningful

Type scale:
  Page title       24px bold
  Section heading  16px semibold
  Body             14px
  Meta / hint      12px
  Micro            11px

Layout shell — every signed-in screen has this and it does not change:
  Fixed left sidebar, 240px, white / #1A1A1A dark, 1px right border. Collapses to an
  off-canvas drawer below 1024px.
  Header bar across the top of the content area.
  Content area: max-width where it helps readability, page padding as above.

Component patterns already in use — match them:
  Card        rounded-xl, bg surface, 1px border, p-24
  Input       full width, 10px vertical padding, rounded-lg, input-background fill,
              1px border, border turns #00D4A0 on focus, no glow, no ring
  Button      primary is solid #00D4A0 with white text; secondary is bordered on
              surface; destructive is #FF4D4D. All rounded-lg, 14px semibold.
  Tabs        pill row inside a bordered container, active pill is accent-at-10%
  Toast       bottom-right, accent-tinted, icon + one line of text
  Empty state icon, one line saying what is missing, one action

Both light and dark must be shown. Dark is not an afterthought — a large share of use
is at night on a phone.

Accessibility is a hard requirement, not a nice-to-have:
  Text contrast at least 4.5:1 against its background. #00D4A0 on white FAILS this for
  body text — use it for fills, borders and large text, and darken it for small text
  on light backgrounds.
  Never use colour alone to carry meaning — pair it with an icon or a word.
  Visible focus states on every interactive element.
  Respect prefers-reduced-motion; no essential information conveyed by animation.

## What must not change — this is the important part

Every screen already works and is wired to a Postgres database with row-level security
and a lot of business logic. The redesign may re-arrange, re-style, group, and improve
hierarchy. It may NOT:

- Remove any field, action, or piece of information that is on the screen today
- Invent a field, metric, chart, or action that does not exist
- Change what any role can see or do
- Change wording that states a legal or regulatory fact
- Introduce a feature that would need new data to fill it

If a screen looks empty or unbalanced, the answer is better hierarchy and spacing, not
a new widget with invented content. Placeholder metrics that do not exist in the product
are worse than an honest empty state.

## Every screen must show its real states, not just the happy path

For each screen, show:
  1. Loaded with typical data
  2. Loading (skeleton, matching the real layout)
  3. Empty — a new workspace on day one, before anything has been entered
  4. Error or restricted, where that screen has one
  5. Mobile, at 390px wide

The empty state matters most. Every BYOND customer sees it first, and today it is the
weakest part of the product.

Also design for real data, not tidy data: long names, Arabic names, a 40-person table,
a job title that runs to three words, a salary figure with thousands separators, a
country that is not the UAE.

## Screens to redesign

[ REPLACE THIS LIST — pick two or three to start, so you can judge the direction
  before committing to the whole app ]

  /dashboard   the landing screen after sign-in; varies by role
  /employees   the staff list; a table that must survive 40+ rows on a phone
  /profile     an employee's own record: their details, documents, privacy controls,
               and password
  /settings    six admin-only tabs, currently a wall of toggles with no hierarchy
  /leave       requesting leave and approving it
  /attendance  clock-in and clock-out records

## What to produce

One artboard per screen per state, laid out on a single canvas, grouped by screen and
labelled. Light and dark side by side.

For each screen, add a short note saying what specifically was wrong with the old
layout and what the change is meant to fix. I want to judge the reasoning, not just
the pixels.
```

---

## Notes for later

- Do **not** give any design tool a login to the live app. Frankfurt holds real employee
  records — national IDs, IBANs, salaries — and the repo already contains the complete
  design as JSX and Tailwind classes, so a login buys screenshots of what the tool can
  already read. `Login.jsx` also caps concurrent sessions at 2, so a tool signing in as
  you can lock you out of your own account.
- If live authenticated screens are genuinely needed, make a throwaway `read_only`
  account on BYOND Test Co, never a real one, and rotate it afterwards.
