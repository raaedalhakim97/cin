# Prompt for Claude Code running on the laptop

The Mumbai → Frankfurt migration and the APK build cannot be done from a
Claude Code web session: the sandbox has no IPv6 (so the direct database hosts
are unreachable), raw 5432 egress times out, and `dl.google.com` and
`api.expo.dev` are denied by proxy policy. A Claude Code session on the laptop
has all of that.

Paste everything in the block below into a fresh Claude Code session started in
WSL Ubuntu. It is written to be self-contained — that session has none of this
conversation's context.

---

```
You are helping me move a live Supabase project between regions and then build
an Android APK. I am a supervisor, not a developer, so explain what you are
doing and stop when something needs a decision from me.

## Environment

- Windows laptop, working inside WSL Ubuntu. psql 18.4, supabase CLI 2.113.0,
  gh and wslu are installed. Docker may or may not work — see step 2.
- Work in ~/cin (the Linux home). Do NOT work in /mnt/c: WSL cannot set Unix
  permissions there and git fails with "chmod on .git/config.lock failed".
- The repo github.com/raaedalhakim97/cin is PRIVATE. gh is already authenticated.

## The project

BYOND is a multi-tenant HR platform for UAE and Gulf SMEs (React 19 + Vite web,
Expo mobile, Supabase). Two Supabase projects exist:

    OLD  rxkgnbvjywiqkgbbypfs   ap-south-1    Mumbai      <- live, serving traffic
    NEW  ududaetdwoqtchkvqewv   eu-central-1  Frankfurt   <- empty, destination

We are moving out of India for UAE PDPL cross-border reasons, and because the
same region also has to serve Nigeria later. A Supabase project's region is
fixed, so "changing region" means dump one project and restore into the other.

## Ground rules

- NEVER print, echo, log or commit a database password, an anon key, or a JWT.
  scripts/check-secrets.sh fails the build if a JWT appears in tracked source,
  and that check is correct — do not work around it.
- I will put the two connection strings in ~/.byond-migration.env, which is
  OUTSIDE the repo so it can never be committed. Read them per command with:
      set -a; . ~/.byond-migration.env; set +a; <command>
  Do not copy them into the repo, into a script, or into your replies.
- The old project stays live and untouched until I explicitly say to switch over.
- Stop and ask me before anything destructive or irreversible.

## Step 0 — check the branch state

Confirm PR #14 on raaedalhakim97/cin is merged (gh pr view 14). It contains a
correction to ops/post-migrate-eu.sql: the expected object counts in that file
used to be 104 policies / 44 functions / 32 tables, captured before migrations
11-15 landed. The real numbers are 113 / 57 / 36. If you verify the migration
against the old numbers you will conclude nothing was lost while the restore is
actually missing nine RLS policies, which silently lets one tenant read another
tenant's salaries.

If PR #14 is not merged, stop and tell me to merge it first.

Then: git checkout main && git pull

## Step 1 — Docker is required; do not re-test this

Settled by testing on 11 Aug 2026: CLI **v2.113.0 still requires Docker**.
`supabase db dump` shells out to it and fails with "failed to run docker. Docker
Desktop is a prerequisite for local development." So the `docker info`
precondition in ops/migrate-to-eu.sh is correct and stays. Do not spend a cycle
re-testing it.

Docker Desktop running on Windows is NOT sufficient. The symptom of a
half-working setup is specific: Docker Desktop processes alive on Windows and the
`docker-desktop` WSL distro running, while inside Ubuntu there is no `docker`
binary and no `/var/run/docker.sock`. That means integration is not enabled for
this distro.

The fix is at the GUI, so ask me to do it:

  Docker Desktop → Settings → Resources → WSL integration → enable the default
  distro AND tick Ubuntu by name in the list below. Apply & Restart.

Ticking Ubuntu by name is the step that gets missed. If Ubuntu is not in the list
at all, either Docker Desktop was started before the distro existed (fully quit
it from the tray and reopen — the list is built at startup), or Ubuntu is WSL 1.
Check with `wsl -l -v` and convert with `wsl --set-version Ubuntu 2`.

Verify with: `docker info` from inside Ubuntu.

Do NOT substitute a raw `pg_dump` to avoid Docker, even though the local client
is new enough. The script uses the Supabase CLI because it strips reserved
Supabase roles and adds IF NOT EXISTS; hand-rolling those flags against a
multi-tenant HR database, where one missed RLS policy means one company reading
another's salaries, is the wrong place to improvise.

## Step 2 — the connection strings must be Session mode

Already solved and verified on 11 Aug 2026, recorded here so it is not
rediscovered. The working hosts are:

    Mumbai      postgres.rxkgnbvjywiqkgbbypfs @ aws-1-ap-south-1.pooler.supabase.com:5432
    Frankfurt   postgres.ududaetdwoqtchkvqewv @ aws-0-eu-central-1.pooler.supabase.com:5432

Note the prefixes differ — aws-1 and aws-0. It is assigned per project and cannot
be derived from the region or the ref. A wrong prefix returns "Tenant or user not
found", which reads like a bad password and sends you resetting credentials that
were fine.

The direct host db.<ref>.supabase.co is IPv6-only (no A record) and fails with
"Network is unreachable" from this laptop, which has no global IPv6. That is not a
firewall problem.

Check both before using them:

- Port must be 5432. Port 6543 is the transaction pooler and pg_dump cannot run
  through it — it fails in a confusing way. To prove which mode you are on,
  create a temp table and read it back in a second statement: it survives in
  session mode and vanishes through the transaction pooler.
- If a password contains characters like @ # / : the URL breaks. If so, tell me
  to reset the password to letters and numbers only (Settings -> Database ->
  Reset database password). Resetting is safe: the website and app authenticate
  over HTTPS with the anon key, not this password.

## Step 3 — run the migration

    set -a; . ~/.byond-migration.env; set +a; ./ops/migrate-to-eu.sh

The script has three direction guards that run before anything else, dumps
Mumbai to a timestamped folder, prints file sizes, then stops and waits for me
to type "yes" before writing to Frankfurt. Do not type "yes" on my behalf —
show me the sizes and let me decide.

Before we start, confirm with me that nobody is mid-shift. The dump is a
point-in-time snapshot: anything written to Mumbai afterwards is lost when we
switch over. At least one employee has previously been left clocked in
overnight, so check for open punches first:

    select count(*) from attendance where clock_out is null and date >= current_date - 1;

## Step 3b — restore the privilege layer (REQUIRED, before any verification)

`supabase db dump` does not emit ACLs. So a restore that matches the source on
every structural and row count still arrives with the NEW project's default
privileges applied, which on a fresh Supabase project grant anon and authenticated
broad access. Measured on the real restore:

                                            source   restored
    TRUNCATE/TRIGGER/REFERENCES grants         0        246
    anon grants beyond demo_requests INSERT    0        286
    audit_logs write grants for anon/auth      0          8

anon is the role the web app uses before anyone logs in, TRUNCATE is not subject
to RLS at all, and write grants on audit_logs make the append-only record editable
by the people it holds accountable.

    set -a; . ~/.byond-migration.env; set +a; psql -v ON_ERROR_STOP=1 "$NEW_DB_URL" -f ops/post-restore-grants.sql

Every count it prints at the end must be 0, except the last, which must be 2 —
get_user_role and get_user_company_id have to stay executable by authenticated,
because RLS policy expressions call them as the querying user. A 0 there means the
application is broken, not hardened.

Expect one NOTICE about skipping supabase_admin default privileges. That is
correct: the role is platform-reserved and postgres is not a superuser.

## Step 4 — verify Frankfurt against Mumbai

    set -a; . ~/.byond-migration.env; set +a; psql "$NEW_DB_URL" -f ops/post-migrate-eu.sql

That recreates the pg_cron job (the `cron` schema is not in the dump, so the
monthly KPI rules job would silently never run) and prints the comparison.

Expected, read from Mumbai just before the move:

    rls policies 113   functions 57   tables 36
    auth users     8   employees 16   companies 2   cron jobs 1
    audit_logs   781   attendance 29

The row counts move as the product is used — treat them as "same as Mumbai right
now". The structural three (policies, functions, tables) must match EXACTLY.

Then run the full guarantee suite against Frankfurt. It is 38 assertions
covering tenant isolation, attendance integrity, the audit trail and the
geofence, and it rolls back everything it writes, so it is safe:

    set -a; . ~/.byond-migration.env; set +a; psql -v ON_ERROR_STOP=1 "$NEW_DB_URL" -f supabase/tests/guarantees.sql

All 38 must pass. Assertion 22 is the one that fails if the cron step was
skipped. Do not proceed to step 5 with any assertion failing — tell me instead.

## Step 5 — three things the dump does not carry

Tell me to do these in the Supabase dashboard for the NEW project, and check
each one with me:

1. Storage objects — uploaded HR documents are not copied by a database dump.
2. Auth settings — SMTP, and the Site URL / redirect URLs. Miss these and
   password-reset and invite emails break or point at the wrong domain.
3. The API keys are different in the new project.

## Step 6 — switch the website over

The new project's URL and anon key go into Vercel (project cin, Production):
VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. These are inlined at BUILD time,
so a redeploy is required — changing the variable alone does nothing.

After redeploying, confirm with me that I can log in and that clocking in on the
website writes to Frankfurt, not Mumbai.

Everyone will be signed out once, because the two projects sign JWTs with
different secrets. Passwords survive in auth.users, so nobody needs a reset.

Keep the Mumbai project running for a week or two as a fallback, then pause it.
Do not delete it.

## Step 7 — the APK, only after the above works

Read docs/android-apk.md first; it explains the sequencing. EXPO_PUBLIC_SUPABASE_URL
is baked into the binary at build time and is not read at startup, so an APK is
permanently tied to whichever project it was built against. That is exactly why
the migration comes first.

    cd mobile
    npx eas-cli login
    npx eas-cli init                # writes extra.eas.projectId and owner
    npx eas-cli update:configure    # writes updates.url

app.json currently has updates.enabled: true with no updates.url. That is the
worst state: the app ships believing it can be updated over the air, and the
first time we need to push a fix we find out it cannot. Commit the app.json
changes those commands make.

Then store the FRANKFURT credentials on the Expo project — not in eas.json:

    npx eas-cli env:create --name EXPO_PUBLIC_SUPABASE_URL      --value "<frankfurt url>"  --environment preview
    npx eas-cli env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "<frankfurt anon>" --environment preview

Do not put these in eas.json. An empty string there is worse than nothing:
eas.json overrides the stored variables, and mobile/src/lib/supabase.js reads an
empty URL as "no project wired up yet" and falls back to an in-memory demo
client. The APK then installs, looks perfectly healthy, and rejects every real
login. scripts/check-mobile-config.mjs now fails on that, so run it after any
eas.json edit.

Build:

    npx eas-cli build --platform android --profile preview

The preview profile is distribution: internal and buildType: apk — an
installable file, not the .aab a phone cannot open. EAS prints a download link.

The APK is talking to the real database, not the demo, when my own password
works (the demo accepts anything and shows "Sarah Al-Hamdan"), a clock-in on the
phone appears on the website within seconds, and the phone refuses to clock in
without location permission.

## Working agreement

- Branch for any code changes: claude/cin-repo-code-review-j3zlww. Do not push
  to main.
- Before committing, run: node scripts/lint-ratchet.mjs, npm run build,
  bash scripts/check-secrets.sh, node scripts/check-mobile-config.mjs
- Report what actually happened, including failures and skipped steps. If a
  command fails, show me the real output rather than summarising it.
```
