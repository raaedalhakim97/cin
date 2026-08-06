# Deploying BYOND

Supabase hosts the **backend only**. There are three things to deploy:

| Piece | Where | Status |
|---|---|---|
| Database, auth, storage | Supabase (`rxkgnbvjywiqkgbbypfs`, region `ap-south-1`) | live |
| Web app (Vite/React SPA) | Vercel / Netlify / Cloudflare Pages | not deployed |
| Mobile app (Expo) | EAS build → App Store / Play | not deployed |

---

## Steps that need your credentials

I cannot do these — they need dashboard access or accounts I do not hold.

### 1. Wire the web app to the live project

`.env` currently points at `placeholder.supabase.co`, so the web app is not
connected to anything. Copy `.env.example` to `.env` and fill in:

- `VITE_SUPABASE_URL` — `https://rxkgnbvjywiqkgbbypfs.supabase.co`
- `VITE_SUPABASE_ANON_KEY` — dashboard → Project Settings → API keys

Then set the same two variables in the hosting provider's environment settings.
They are public by design (see the comments in `.env.example`); the
service_role key must never appear in either place.

### 2. Custom SMTP — do this before inviting anyone

The built-in Supabase auth mailer is rate-limited to a handful of messages per
hour and is not intended for production. The entire onboarding flow is
invite-based (`create_employee_invite` → `get_invite_preview` →
`accept_employee_invite`), so onboarding a company of any size will stall
without this.

Dashboard → Authentication → Emails → SMTP Settings. Resend, SES and Postmark
all work on the Supabase free plan.

### 3. Turn on leaked-password protection

Dashboard → Authentication → Policies. Checks new passwords against
HaveIBeenPwned. This is the last remaining item on the Supabase security
advisor and no migration can reach it.

### 4. Set a real backup

The free plan has no automated daily backup and no point-in-time recovery.
For payroll and employment records that is the weakest point in the whole
setup. Either move to Pro (daily backups included) or schedule your own
`pg_dump` to storage you control — and restore it once to prove it works.

### 5. Delete the test accounts

Six accounts with the password `ByondTest#2026` exist for role testing
(`super_admin`, `hr_manager`, `admin`, `department_manager`, `employee`,
`read_only`). Remove or rotate them before a real customer touches the system.

---

## Content Security Policy

`vercel.json` ships the headers that cannot break anything. CSP is deliberately
**not** included, because a wrong one breaks the app in ways that are painful to
debug in production. Add it in two stages:

First, report-only, and watch the browser console for a week:

```
Content-Security-Policy-Report-Only:
  default-src 'self';
  connect-src 'self' https://rxkgnbvjywiqkgbbypfs.supabase.co wss://rxkgnbvjywiqkgbbypfs.supabase.co;
  img-src 'self' data: blob: https://rxkgnbvjywiqkgbbypfs.supabase.co;
  style-src 'self' 'unsafe-inline';
  font-src 'self' data:;
  script-src 'self';
  worker-src 'self' blob:;
  object-src 'none';
  base-uri 'self';
  frame-ancestors 'none'
```

Notes on why each loosening is there:
- `style-src 'unsafe-inline'` — Tailwind and `@react-pdf/renderer` inject styles.
- `worker-src blob:` — payslip PDF generation runs in a blob worker.
- `img-src` includes the Supabase host for employee photos in storage.
- `connect-src` needs `wss:` if you ever enable realtime.

Only once the console is clean, rename the header to
`Content-Security-Policy`.

---

## Pre-launch checklist

Verified as part of the hosting audit:

- [x] `.env` untracked and gitignored; no service_role key or JWT in git history
- [x] All 36 tables have RLS enabled with at least one policy
- [x] No table leaks any row to an unauthenticated caller
- [x] `anon` holds exactly one table privilege: INSERT on `demo_requests`
- [x] `TRUNCATE` and `TRIGGER` revoked from `anon` and `authenticated`
- [x] Default privileges fixed, so new tables do not re-inherit them
- [x] No source maps in the production build
- [x] Security headers configured (`vercel.json`)

Still open:

- [ ] `.env` pointed at the live project
- [ ] Custom SMTP
- [ ] Leaked-password protection
- [ ] Backup that has been restored at least once
- [ ] Test accounts removed
- [ ] Region decision (see below)
- [ ] `audit_logs` retention policy — it is the fastest-growing table

---

## The region question

The project is in `ap-south-1` (Mumbai). UAE PDPL (Federal Decree-Law 45/2021)
restricts transferring personal data outside the UAE without adequate
protection or specific safeguards, and India is not covered by a UAE adequacy
determination. The data includes Emirates ID numbers, IBANs and salaries.

**A Supabase project's region cannot be changed after creation.** Moving means
a new project and a full data migration. Today that is 17 MB, 15 employees and
no paying customers — it will never be cheaper. Worth a lawyer's opinion before
the first real tenant, not after.
