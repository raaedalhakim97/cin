# Security review — 22 September 2026

An adversarial pass over BYOND's real database, prompted by "try to hack it." Read as an
attacker: where can someone with a valid login — or no login — reach data they should not?

**Scope and method.** The live app is not reachable from the review environment (egress
policy blocks `*.supabase.co` and `*.vercel.app`), so this was done against the actual
Postgres project through the Supabase admin connection: every RLS policy, every
`SECURITY DEFINER` function's authorisation guard, the grants to the `anon` and
`authenticated` roles, and the shape of the privileged RPCs. No production personal data was
read or copied; findings about people's records are drawn from the *policies that govern
them*, verified with counts and booleans, not by pulling anyone's row.

## The short version

The tenant isolation is sound. Every table has RLS, no policy is `USING (true)` for tenant
data, every `SECURITY DEFINER` function pins its `search_path`, and every privileged RPC
checks the caller before it acts. The one real hole is **column-level**, not row-level, and
it is the exact shape of a bug this codebase has fixed once before.

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | **High** | `national_id` / `labour_card_number` returned raw by the API to roles that only mask them in the browser | **Fixed** — migrations 61–62, moved to a gated `employee_identifiers` table |
| 2 | Medium | `payroll_runs` select policy granted to `PUBLIC`, not `authenticated` | **Fixed** — migration 60 |
| 3 | Medium | Leaked-password protection is off | Open — Raaed's dashboard toggle |
| 4 | Low | `demo_requests` allows unauthenticated INSERT with no rate limit | Open |

> **`phone` reconsidered.** The first draft grouped `phone` with the identity numbers. It was
> left on `employees`: a colleague's work phone number is contact information, not an identity
> document, and managers legitimately need it. Only `national_id` and `labour_card_number`
> moved.

## What is already strong (verified, not assumed)

- **Every table in `public` has RLS enabled.** No missing-RLS gap — the classic
  multi-tenant breach — exists. The only `USING (true)` policies are on `country_rules` and
  `country_leave_rules`, which are shared reference data (labour-law facts), correctly
  world-readable.
- **All 57 `SECURITY DEFINER` functions pin `search_path`.** None can be hijacked by a
  caller shadowing a table or function name. This is the subtle one most projects miss;
  BYOND gets it right everywhere.
- **Pay lives in its own table** (`employee_pay`), gated to `super_admin`/`hr_manager` or
  the employee themselves — not as columns on `employees`. Salary is not reachable by a
  colleague.
- **Every `platform_*` function checks `is_platform_owner()` internally.** A regular
  employee cannot call `platform_set_plan`, `platform_create_company` or
  `platform_revoke_invite` via the REST RPC endpoint and have it do anything — the function
  refuses before acting. `export_employee_data` and `anonymize_employee` likewise check
  authentication, block cross-company access, and check role, in that order.
- **Invite tokens are 64 characters.** Brute-forcing a pending invite is infeasible.
- **`log_login_attempt` is hardened**: it validates the email shape and silently drops
  after 20 attempts per address per minute, so it cannot be used to flood the table.

That is a genuinely defensible core. The findings below are the edges.

## Finding 1 (High) — identity numbers are masked in the browser but not by the API

**The bug.** RLS decides which *rows* a caller sees, never which *columns*. The
`employees` table carries `national_id` (Emirates ID), `labour_card_number` and `phone`
alongside the harmless columns. Its select policy, `emp_select`, grants the whole row to:

- `super_admin`, `hr_manager`, `admin`, `read_only` — any row in the company;
- `department_manager` — rows in their department or reporting to them;
- everyone — their own row.

The app masks these values in the UI (`src/utils/security.js`: `maskNationalId`,
`maskDocumentNumber`) and keeps them out of the client store (`SENSITIVE_FIELDS`,
`sanitizeEmployee`). **But masking is JavaScript.** The REST API sits underneath it. Anyone
with a valid token in one of those roles can call

```
GET /rest/v1/employees?select=full_name,national_id,labour_card_number,phone
```

and receive the real values for every colleague the policy lets them see — dots on the
screen, plaintext on the wire.

**Who can exploit it, realistically.** This is not a stranger. It is:

- a `read_only` account — created for an auditor or a viewer — pulling every employee's
  Emirates ID and labour-card number for the whole company;
- a `department_manager` doing the same for their whole team;
- and `admin`, which the access standard already scopes tightly for HR documents but which
  here can read identity numbers company-wide.

For a UAE HR product this is the most sensitive class of data there is. Emirates ID and
labour-card numbers are exactly what a PDPL/GDPR notification is written about.

**Why it is the migration-52 bug again.** Migration 52 split *salary* out of `employees`
into `employee_pay` for precisely this reason: a policy cannot hide a column, only a row, so
the only way to stop the wrong role reading pay was to put pay somewhere their policy does
not reach. Identity numbers were left behind. The fix is the same move, already proven in
this codebase.

**Recommended fix.** Move `national_id` and `labour_card_number` into a sibling table —
`employee_identifiers` — with the same policy shape as `employee_pay`: readable only by
`super_admin`, `hr_manager`, or the employee themselves. `phone` is a judgement call; it is
less sensitive, but if managers do not need it, it belongs there too.

- Pro: consistent with the existing pattern; the client `sanitizeEmployee` already knows how
  to strip a nested table (`employee_pay`), so the same guard covers `employee_identifiers`
  with a one-line addition.
- Con: a migration plus every read of `national_id` moves to the new table. Bounded — the
  UI already routes these through the mask helpers, so the call sites are findable.

A lighter alternative — a masking view plus revoking direct table SELECT from the exposed
roles — is possible but fights RLS and column grants at once, and leaves the raw table one
policy edit away from re-exposure. The table split is cleaner and matches what is already
here.

## Finding 2 (Medium) — a payroll policy is scoped to PUBLIC, not authenticated

`payroll_runs` has two select policies. `payroll_mgr_select` is correctly on
`authenticated`. The other, `payroll_select`, is granted to the **`PUBLIC`** pseudo-role,
which includes `anon` — every other policy in the schema names `authenticated`.

It is **not currently exploitable**: the policy's `USING` clause requires
`company_id = get_user_company_id(auth.uid())`, and for an anonymous caller `auth.uid()` is
null, so the comparison yields nothing. The gate holds — but it holds because the *filter*
fails closed for anon, not because the *role list* excludes anon. That is one refactor of a
helper away from becoming a company-wide payroll leak to unauthenticated callers.

**Fix.** Change `payroll_select` to target `authenticated`, matching every other policy. One
statement, no behaviour change for real users, removes the latent footgun.

## Finding 3 (Medium) — leaked-password protection is disabled

Supabase Auth can reject passwords found in the HaveIBeenPwned breach corpus. It is off
(security advisor `auth_leaked_password_protection`). Now that the database holds a third
party's employee records, a customer's owner choosing "Password123" is a risk you carry, not
just them. One toggle in **Auth → Policies**. No code.

## Finding 4 (Low) — anonymous demo requests have no throttle

`demo_requests` grants INSERT to `anon` (the public "book a demo" form). Reads are
`authenticated`-only, so this is not a data leak — anon cannot read back what it writes. But
an unauthenticated, unlimited write is a spam and storage vector: a script can fill the
table. Options, cheapest first: accept it (currently 2 rows, low value target); add a
per-window cap the way `log_login_attempt` already does for its table; or put a captcha on
the form. Not urgent, worth knowing.

## Two things this review did not cover

- **The application layer in depth.** This looked at the database, which is where a
  multi-tenant breach actually succeeds or fails. It did not fuzz the React app, test the
  auth redirect flow, or probe the Vercel edge — the egress policy blocked reaching the live
  site. Those are worth a separate pass.
- **Rate limiting on auth itself.** `log_login_attempt` logs and self-throttles, but the
  actual `signInWithPassword` throttle is Supabase's, not visible from here. Worth
  confirming the project's auth rate-limit settings are not on the defaults.

## Suggested order

1. **Finding 3** now — one toggle, and it is the cheapest risk reduction available.
2. **Finding 2** — one policy statement, removes a latent unauthenticated-read footgun.
3. **Finding 1** — the real work, and the one that matters: get identity numbers off the
   wire for roles that should only ever see them masked.
4. **Finding 4** — whenever.

None of these is a live, currently-exploitable breach by a stranger. Finding 1 is a real
exposure to *insiders* — the read-only auditor, the department manager — and for the data
it exposes, that is enough to fix properly.
