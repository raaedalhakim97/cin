# Going live — step by step

Written for someone who has not done this before. Follow it in order. Nothing
here needs Android Studio, a server, or any HTTPS certificate work.

---

## Read this first: two things that will trip you up

**1. `main` is behind the working branch — check by how much, do not assume.**

This section used to say `main` had only the original 3 commits. That is no
longer true: PR #40 merged the branch into `main`, so `main` carries the work up
to "Pin is_uae_country's search_path". Development has continued on
`claude/cin-repo-code-review-j3zlww` since, so `main` is behind again.

Vercel and most hosts deploy `main` by default, so find out where you stand
before deploying rather than trusting a number written in a document:

```bash
git fetch origin
git log --oneline origin/main -1                  # what main has
git rev-list --count origin/main..origin/claude/cin-repo-code-review-j3zlww
```

If that count is not zero, either merge the branch into `main` or point your
host at the branch (Part 1, Step 6). Merging into `main` is your call, not mine
— say the word and I will open the PR.

**2. You never touch HTTPS.**

Vercel, Netlify and Cloudflare Pages all issue and renew the certificate
automatically, free, including on your own domain. There is no step where you
buy or install one. If you find yourself reading about certificates, you have
wandered off the path.

---

## Part 1 — Web app live with HTTPS (about 10 minutes)

### Step 1: get your two Supabase values

Supabase dashboard → your project → **Project Settings** (gear icon) →
**API keys**.

Copy these two:

> **Two projects exist. Pick the right one.**
>
> | Name | Region | Ref | Use it? |
> |---|---|---|---|
> | `BYOND-hr-eu` | Frankfurt, `eu-central-1` | `ududaetdwoqtchkvqewv` | **Yes — this is production** |
> | `BYOND-hr` | Mumbai, `ap-south-1` | `rxkgnbvjywiqkgbbypfs` | No. Stale fallback, roughly 20 migrations behind |
>
> An earlier revision of this document used the Mumbai URL as its example, which
> is how you deploy a working-looking app against a schema that is missing
> country packs, the leave policy tables and half the audit fixes.

| What | Looks like |
|---|---|
| Project URL | `https://ududaetdwoqtchkvqewv.supabase.co` |
| Publishable / anon key | a long string starting `sb_publishable_` or `eyJ...` |

Both of these are **safe to be public** — they ship inside the app that runs in
people's browsers either way. What must never leave the dashboard is the
**service_role** key. If you ever paste that into the app, rotate it.

### Step 2: sign up for Vercel

1. Go to `vercel.com` → **Sign Up** → **Continue with GitHub**
2. Authorise it to see your repositories

### Step 3: import the project

1. **Add New** → **Project**
2. Find `cin` in the list → **Import**
3. Vercel will detect Vite automatically. Leave the build settings alone —
   `vercel.json` in the repo already sets the build command, output directory,
   the single-page-app routing, and the security headers.

### Step 4: add the two environment variables

Still on the import screen, expand **Environment Variables** and add:

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | the Project URL from step 1 |
| `VITE_SUPABASE_ANON_KEY` | the publishable key from step 1 |

These must be set here, not just in your local `.env` — your local file is
gitignored and Vercel never sees it. If you forget this step the site will
load and then fail to sign anyone in.

### Step 5: deploy

Click **Deploy**. Two or three minutes later you get a live URL like
`byond-hr.vercel.app`, already on HTTPS.

### Step 6: check the production branch

Vercel → your project → **Settings** → **Git** → **Production Branch**.

If you merged to `main` in the section above, leave it as `main`. If you did
not, set it to `claude/cin-repo-code-review-j3zlww` — otherwise you are
deploying the old code.

### Step 7 (optional): your own domain

Settings → **Domains** → add `app.yourdomain.com`. Vercel shows you the DNS
record to create at your registrar. The certificate appears by itself within a
few minutes of the DNS resolving.

### Step 8: tell Supabase about the new address

Supabase dashboard → **Authentication** → **URL Configuration**:

- **Site URL**: your Vercel URL (or custom domain)
- **Redirect URLs**: add the same URL plus `/**`

Skip this and password-reset and invite links will send people to the wrong
place. This is the most commonly missed step of the whole process.

---

## Part 2 — Android APK (about 20 minutes, mostly waiting)

The build happens on Expo's servers. You do not need Android Studio, a JDK, or
a fast computer.

### Step 1: install the build tool

```bash
npm install -g eas-cli
```

### Step 2: make an Expo account and log in

```bash
eas login
```

Sign up at `expo.dev` first if you have not.

### Step 3: fill in your Supabase values

Open `mobile/eas.json`. In both the `preview` and `production` sections, fill
in the two empty strings with the same values from Part 1 Step 1:

```json
"env": {
  "EXPO_PUBLIC_SUPABASE_URL": "https://ududaetdwoqtchkvqewv.supabase.co",
  "EXPO_PUBLIC_SUPABASE_ANON_KEY": "sb_publishable_..."
}
```

They go here rather than in `mobile/.env` because EAS builds from your Git
repository and `.env` is gitignored — the build server would never see it. It
is safe to commit these two; they are the same public values that already ship
inside the app bundle.

### Step 4: link the project

```bash
cd mobile
eas init
```

This attaches the folder to a project on your Expo account.

### Step 5: build the APK

```bash
eas build --platform android --profile preview
```

Two things will happen the first time:

- **"Generate a new Android Keystore?"** → answer **Yes**. This is the signing
  key for your app; EAS stores it for you. Do not lose access to that Expo
  account — if you later publish to the Play Store, updates must be signed with
  this same key.
- The build queues on Expo's servers. On the free plan you may wait in a queue;
  the build itself takes 10–15 minutes.

When it finishes the terminal prints a download link, and it also appears at
`expo.dev` → your project → **Builds**.

### Step 6: install it on a phone

Open the link on the Android phone and download it. Android will warn about
installing from outside the Play Store — allow it for your browser. The app
installs like any other.

To share with your team, send them that same link.

### Why `--profile preview` matters

Plain `eas build --platform android` produces an **.aab** — a Play Store upload
bundle that will *not* install on a phone. The `preview` profile in `eas.json`
sets `"buildType": "apk"`, which is the installable file you actually want for
testing and for handing to colleagues. Use `production` only when you are
uploading to the Play Store.

---

## What to test the moment it is live

In this order, because each depends on the last:

1. **Sign in** — if this fails, the environment variables are wrong or the
   Supabase Site URL is not set.
2. **Clock in** on the phone — this needs GPS. Android will ask for location
   permission; the app already declares it correctly in `app.json`.
3. **Clock out early** — you should see the "Leaving Xh Ym early" warning.
4. **Request leave** — confirm the balance moves and the entitlement check
   fires if you ask for more days than you have.
5. **Open the KPI screen** — attendance and Hours Completed should be filled in
   automatically.

Then the things added since this list was first written:

6. **Settings → Leave Policy.** Leave types now come from what the company
   actually offers rather than a hardcoded list of nine, so a UAE workspace
   shows the six entitlements the labour code cites and not Hajj Leave. Add a
   type and confirm it appears in the request form; remove it and confirm it
   disappears while past requests of that type still render in the history.
7. **Payroll → Bank File.** Pick a month and press Build file. It will say the
   month is not ready until the company has a MOHRE establishment ID and bank
   routing code and each employee has a labour card, IBAN and agent routing
   code — that is correct, none of them are filled in yet. A company in a
   country with no bank file format is refused by name instead.
8. **Permissions → Role preview.** Step through the roles and check the menus
   match what those people actually see when they sign in. If they do not, the
   preview is not wrong — `src/data/navigation.js` is, and both read it.
9. **Profile → Password.** Change it, confirm your other device is signed out,
   sign back in.
   **Use a test account for this, not your own.** There is no password reset
   until SMTP exists, so a mistyped new password means locked out with no way
   back short of editing Supabase by hand.

---

## Before a real customer uses this

`docs/deployment.md` explains several of these in more detail. The live
tracker is **BYOND Build Checklist** in the BYOND BY SERVA folder on Drive;
this list is the deployment-shaped view of it.

### Settled — no action

- **Region.** Decided and done. Production is Frankfurt, `eu-central-1`, which
  is where the Emirates IDs, IBANs and salaries live. The Mumbai project still
  exists as a fallback and is roughly 20 migrations behind — do not point
  anything at it.
- **Backups.** An encrypted nightly dump runs to Raaed's own Hetzner server,
  and it has actually been restored into a throwaway Postgres container, which
  is the only version of that sentence worth anything. The drill refuses to
  pass a backup older than 48 hours, so a dead timer surfaces as a failure
  rather than as a green result on a stale file.
  Ongoing duty: pull the repo on that server after any change to
  `ops/verify-restore.sh`, and re-run `sudo ./ops/verify-restore.sh`.

### Blocking a real customer

- **Custom SMTP.** Unchanged and still first. The built-in mailer sends a
  handful of emails per hour, and onboarding is invite-based — today HR creates
  an employee, copies a link and sends it themselves. That works for two people
  testing and not for a company onboarding forty. Parked with the domain
  decision: `byondhr.com` belongs to someone else, and the chosen direction is
  `byondhr.app`. Until it lands there is also no password reset, so a forgotten
  password needs a hand-edit in Supabase.
- **Storage policies.** `storage.objects` has row level security enabled and no
  policies on it, while the upload code claims the first path segment is checked
  against the caller's company. That bucket holds passports and national IDs.
  The fix is written as `supabase/migrations-pending/37_*.sql` and cannot be
  applied from a database connection — `storage.objects` is owned by
  `supabase_storage_admin` and Supabase's `postgres` role is neither a
  superuser nor a member of it, so `CREATE POLICY` is refused, in the Dashboard
  SQL editor too. It has to be done through **Storage → Policies** in the
  dashboard. Instructions are in that file's header.
- **Delete the six `@byond-test.com` accounts.** Still present — six of only
  ten auth users, holding every role including super_admin. Their shared
  password was rotated on 6 August 2026 after an earlier revision of
  `docs/deployment.md` published it while this repository was public.
- **Turn on leaked-password protection.** Still off; confirmed by the Supabase
  security advisor. One toggle.

### Worth doing before you are busy

- **Error monitoring.** There is none — no Sentry, no PostHog, nothing. When a
  customer hits a bug your only signal is them telling you.
- **Billing.** There is no payment provider in the codebase at all. Plans
  (`trial`, `active`, `suspended`) exist and suspension is enforced, so you can
  cut someone off; you cannot charge them. Bank transfer plus setting the plan
  by hand in the console works to roughly customer #10.
- **Foreign-key indexes.** Done — migration 38. Postgres never indexes the
  referencing side of a foreign key, so 41 of them were a sequential scan on
  any query filtering the column and on every delete of the parent, including
  the PDPL erasure path. All 100 foreign keys now have one, and assertion 83
  fails if a new one arrives without.
- **RLS policy overlaps.** Deliberately left alone, and the number I quoted
  earlier was wrong. The advisor reports 38 findings, but it counts one per
  (table, role, action), so a single overlapping pair written `TO public` is
  counted once per role. The real figure is 29 overlapping combinations in two
  shapes, about eighteen of which are a `FOR SELECT` policy sitting alongside a
  `FOR ALL` one. Fixing that means rewriting eighteen tables' security policies
  for a gain that is unmeasurable at this size — worth doing against a measured
  problem, one table at a time, not as housekeeping. Migration 39 records the
  measurement.
- **Mobile.** The Expo app is still in `mobile/` and was last updated on
  21 August with the internationalization work, so it is not abandoned — but no
  decision has been recorded either way. Part 2 below still works; decide
  whether you mean to ship it.
