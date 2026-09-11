# Deploying BYOND

Supabase hosts the **backend only**. There are three things to deploy:

| Piece | Where | Status |
|---|---|---|
| Database, auth, storage | Supabase `BYOND-hr-eu` (`ududaetdwoqtchkvqewv`, `eu-central-1`, Frankfurt) | live |
| Web app (Vite/React SPA) | Vercel / Netlify / Cloudflare Pages | not deployed |
| Mobile app (Expo) | EAS build → App Store / Play | not deployed |

---

## Steps that need your credentials

I cannot do these — they need dashboard access or accounts I do not hold.

### 1. Wire the web app to the live project

`.env` currently points at `placeholder.supabase.co`, so the web app is not
connected to anything. Copy `.env.example` to `.env` and fill in:

- `VITE_SUPABASE_URL` — `https://ududaetdwoqtchkvqewv.supabase.co`
  (Frankfurt. The old Mumbai project `rxkgnbvjywiqkgbbypfs` still exists as a
  fallback and is roughly 20 migrations behind — pointing at it gives you a
  working-looking app on a schema with no country packs and no leave policy
  tables.)
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

### 4. Set a real backup — DONE

Solved, and worth recording how, because the words matter. An encrypted nightly
`pg_dump` runs to Raaed's own Hetzner server via a systemd timer, and it has
been restored into a throwaway Postgres container and checked for row counts,
RLS policies and every table having RLS on. A backup nobody has restored is a
guess.

`ops/verify-restore.sh` runs that drill and refuses to pass a dump older than
48 hours, so a dead timer shows up as a failure rather than as a green result on
a three-week-old file.

Ongoing duty: pull the repo on that server after any change to the ops scripts,
then `sudo ./ops/verify-restore.sh`.

### 5. Delete the test accounts

Six `@byond-test.com` accounts exist for role testing — one per role
(`super_admin`, `hr_manager`, `admin`, `department_manager`, `employee`,
`read_only`). Remove them before a real customer touches the system.

**Never write their password in this repository.** An earlier revision of this
file printed it here, and the repository was public at the time, which
published a working `super_admin` credential for the live database. It was
rotated on 6 August 2026 and the old value is dead; the login history showed no
use of it by anyone but the owner. Keep the current password in a password
manager, not in git.

---

## Content Security Policy

`vercel.json` ships the headers that cannot break anything. CSP is deliberately
**not** included, because a wrong one breaks the app in ways that are painful to
debug in production. Add it in two stages:

First, report-only, and watch the browser console for a week:

```
Content-Security-Policy-Report-Only:
  default-src 'self';
  connect-src 'self' https://ududaetdwoqtchkvqewv.supabase.co wss://ududaetdwoqtchkvqewv.supabase.co;
  img-src 'self' data: blob: https://ududaetdwoqtchkvqewv.supabase.co;
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
- [x] All **45** public tables have RLS enabled with at least one policy
      (re-measured 27 Aug 2026: 45 tables, 45 with RLS on, 0 with RLS on and no
      policy. It said 36 when the audit was first written — the number grows, so
      re-measure rather than trusting this line)
- [x] No table leaks any row to an unauthenticated caller
- [x] `anon` holds exactly one table privilege: INSERT on `demo_requests`
- [x] `TRUNCATE` and `TRIGGER` revoked from `anon` and `authenticated`
- [x] Default privileges fixed, so new tables do not re-inherit them
- [x] No source maps in the production build
- [x] Security headers configured (`vercel.json`)

Settled since:

- [x] Backup that has been restored at least once — nightly, encrypted, on our
      own hardware, with a 48-hour staleness gate
- [x] Region decision — Frankfurt, `eu-central-1`

Still open:

- [ ] `.env` pointed at the live project
- [ ] Custom SMTP — parked with the domain decision
- [ ] Leaked-password protection — still off, confirmed by the security advisor
- [ ] Test accounts removed — all six still present, six of ten auth users
- [ ] **Storage policies** — `storage.objects` has RLS on and zero policies
      while the upload code claims the first path segment is checked against the
      caller's company. Written as `supabase/migrations-pending/37_*.sql`; must
      be applied through Storage → Policies in the dashboard, because
      `storage.objects` is owned by `supabase_storage_admin` and `postgres` is
      neither superuser nor a member, so `CREATE POLICY` is refused even in the
      Dashboard SQL editor.
- [ ] Error monitoring — none at all, so a customer's bug reaches you only if
      they tell you
- [ ] Billing — no payment provider in the codebase
- [x] 41 missing foreign-key indexes — added in migration 38; all 100 foreign
      keys in the schema now have a supporting index, guarded by assertion 83
- [ ] `audit_logs` retention policy — it is the fastest-growing table

---

## The region question — answered

Kept for the reasoning, not as an open question.

The project started in `ap-south-1` (Mumbai). UAE PDPL (Federal Decree-Law
45/2021) restricts transferring personal data outside the UAE without adequate
protection or specific safeguards, and India is not covered by a UAE adequacy
determination. The data includes Emirates ID numbers, IBANs and salaries.

A Supabase project's region cannot be changed after creation, so the move meant
a new project and a full data migration — done while it was 17 MB and nobody was
paying, which is the only time that is cheap.

Production is now **Frankfurt, `eu-central-1`**, with backups in Nuremberg. The
Mumbai project has deliberately not been deleted: it is the fallback if
something about Frankfurt turns out to be wrong. It is also roughly 20
migrations behind and must never be connected to.

One consequence worth remembering: restoring that dump into a fresh Supabase
project lands with the *target* project's default privileges, because
`backup-supabase.sh` dumps `--no-privileges`. Run
`ops/post-restore-grants.sql` and then `supabase/tests/guarantees.sql`
afterwards — that is exactly the state the Frankfurt migration was first found
in.
