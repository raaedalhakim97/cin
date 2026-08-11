#!/usr/bin/env bash
#
# Move BYOND-hr from ap-south-1 (Mumbai) to eu-central-1 (Frankfurt).
#
# A Supabase project is pinned to its region at the infrastructure level, so
# "changing region" means dumping one project and restoring into another. The
# destination project already exists:
#
#     old   rxkgnbvjywiqkgbbypfs   ap-south-1    BYOND-hr
#     new   ududaetdwoqtchkvqewv   eu-central-1  BYOND-hr-eu
#
# This script only READS from the old project. Every write goes to the new one.
# If it fails halfway, the old project is untouched and still serving traffic.
#
# Why the Supabase CLI and not plain pg_dump: the CLI runs pg_dump inside the
# Supabase Postgres image and filters the output — it drops internal schemas and
# adds IF NOT EXISTS. A raw pg_dump includes Supabase internals and fails on
# permission errors partway through the restore. It also means the dump does not
# care that your local psql is older than the server.
#
# It does NOT fully strip reserved roles, which this script used to claim. It omits
# CREATE ROLE for them but still emits `ALTER ROLE supabase_admin SET ...`, and the
# postgres role on Supabase is not a superuser, so that line cannot be executed by
# anyone running this. See the roles restore below for how it is handled.
#
# ── Before running ──────────────────────────────────────────────────────────
#
#   1. Docker must be running (the CLI needs it).
#   2. Supabase CLI installed:  npm i -g supabase   (or brew install supabase/tap/supabase)
#   3. psql installed.
#   4. Both database passwords. Dashboard → Project → Settings → Database.
#      Reset the password there if you do not have it; resetting is safe.
#
# ── Running ─────────────────────────────────────────────────────────────────
#
#   export OLD_DB_URL='<Mumbai session pooler URI>'
#   export NEW_DB_URL='<Frankfurt session pooler URI>'
#   ./ops/migrate-to-eu.sh
#
# COPY BOTH FROM THE DASHBOARD — do not build them from a template, including the
# one that used to be printed here. Dashboard → Connect → Session pooler.
#
# This example used to read `aws-0-ap-south-1` for Mumbai. That is wrong, and it
# was found the hard way: the two projects sit behind DIFFERENT pooler prefixes.
#
#     Mumbai      aws-1-ap-south-1.pooler.supabase.com:5432
#     Frankfurt   aws-0-eu-central-1.pooler.supabase.com:5432
#
# The prefix is assigned per project and cannot be derived from the region or the
# project ref. Getting it wrong gives "Tenant or user not found", which reads like
# a bad password and sends you off resetting credentials that were fine.
#
# Two other things that look like connection problems and are not:
#
#   * The direct host db.<ref>.supabase.co has no A record — it is IPv6-only. On a
#     machine with no global IPv6 both projects fail with "Network is
#     unreachable". That is not a firewall or a wrong password; use the pooler.
#   * Port 6543 is the TRANSACTION pooler. pg_dump cannot run through it. Session
#     mode is 5432. To prove which one you are actually on, create a temp table
#     and read it back in a second statement — it survives in session mode and
#     vanishes through the transaction pooler.
#
# Wrap both in SINGLE quotes. Passwords routinely contain characters the shell
# would otherwise interpret, and a mangled URL fails in confusing ways.
#
# One more that wastes a whole cycle: the Supabase CLI still requires Docker as of
# v2.113.0 — `supabase db dump` shells out to it. Docker Desktop running on
# Windows is NOT enough. WSL integration has to be enabled for the specific
# distro (Settings → Resources → WSL integration → tick the distro by name), and
# that only works if the distro is WSL 2. `wsl -l -v` shows the version, and
# `wsl --set-version <distro> 2` converts it.

set -euo pipefail

: "${OLD_DB_URL:?set OLD_DB_URL — see the header of this script}"
: "${NEW_DB_URL:?set NEW_DB_URL — see the header of this script}"

# Default OUTSIDE the repository, deliberately.
#
# This used to default to ./migration-<timestamp>, inside the working tree and not
# covered by .gitignore. data.sql holds every employee row, every salary and the
# whole audit log for both tenants, so one `git add -A` mid-migration would have
# published the entire HR database. Caught during the real migration, before any
# commit, by the session running it.
#
# .gitignore covers the old path and check-secrets.sh refuses a tracked dump, but
# the fix that does not depend on remembering anything is to not write it there.
OUT="${OUT:-$HOME/byond-migration-dumps/migration-$(date +%Y%m%d-%H%M%S)}"

# Direction checks run FIRST, before anything else can fail for a boring reason.
# Getting these two variables the wrong way round is the only mistake here that
# destroys the live database, so it must be caught even on a machine that has
# neither psql nor Docker installed — and before any later guard can mask it with
# a complaint of its own.
[[ "$OLD_DB_URL" == "$NEW_DB_URL" ]] && { echo "OLD_DB_URL and NEW_DB_URL are identical"; exit 1; }
[[ "$OLD_DB_URL" == *ududaetdwoqtchkvqewv* ]] && { echo "OLD_DB_URL points at the NEW project — check your variables"; exit 1; }
[[ "$NEW_DB_URL" == *rxkgnbvjywiqkgbbypfs* ]] && { echo "NEW_DB_URL points at the OLD project — refusing to overwrite it"; exit 1; }

# Refuse to write the dumps anywhere inside the working tree, however OUT was set.
REPO_ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || true)"
mkdir -p "$OUT"
chmod 700 "$OUT"
OUT_ABS="$(cd "$OUT" && pwd -P)"
if [[ -n "$REPO_ROOT" && ( "$OUT_ABS" == "$REPO_ROOT" || "$OUT_ABS" == "$REPO_ROOT"/* ) ]]; then
  echo "OUT is inside the git working tree: $OUT_ABS"
  echo "These dumps hold every salary and the full audit log. Point OUT outside the repo."
  exit 1
fi

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing: $1"; exit 1; }; }
need psql

# The Supabase CLI and Docker are only needed to TAKE a dump. Restoring is plain
# psql against .sql files, so a SKIP_DUMP=1 run must not demand either — otherwise
# a machine that can restore a vetted dump is refused for lacking a tool it will
# never invoke.
if [[ "${SKIP_DUMP:-0}" != "1" ]]; then
  need supabase
  docker info >/dev/null 2>&1 || { echo "Docker is not running — the Supabase CLI needs it"; exit 1; }
fi

DUMPS=(roles.sql schema.sql data.sql history_schema.sql history_data.sql)

# SKIP_DUMP=1 restores an EXISTING dump folder instead of taking a fresh one.
#
# This exists because of a real dilemma during the Frankfurt migration. The dumps
# had been taken and then checked against the source project — 113 policies, 57
# functions, 36 tables, 781 audit rows, all confirmed present in the dump file
# itself. The only way to restore from those exact files was to run the psql
# commands out of this script by hand, and the alternative was to re-dump, which
# means restoring an artifact nobody has inspected.
#
# Neither is good. You verify an artifact and then you deploy THAT artifact, and
# you do it through the reviewed code path rather than a retyped copy of it. So the
# script now supports both, and the safe choice does not require improvising.
#
# A fresh dump is the better default when the source is live and being written to.
# Reuse is better when the window is quiet and the dump has been vetted, which is
# exactly when a careful person is standing at this prompt.
if [[ "${SKIP_DUMP:-0}" == "1" ]]; then
  echo "==> SKIP_DUMP=1 — restoring the existing dumps in $OUT, taking no new ones"
  missing=0
  for f in "${DUMPS[@]}"; do
    if [[ ! -s "$OUT/$f" ]]; then echo "missing or empty: $OUT/$f"; missing=1; fi
  done
  [[ $missing -eq 0 ]] || { echo "Refusing to restore from an incomplete dump folder."; exit 1; }
else
  echo "==> Writing dumps to $OUT"

  # Three files, because they restore in a specific order and one of them needs
  # triggers disabled while it loads.
  echo "==> 1/4  roles"
  supabase db dump --db-url "$OLD_DB_URL" -f "$OUT/roles.sql" --role-only

  echo "==> 2/4  schema"
  supabase db dump --db-url "$OLD_DB_URL" -f "$OUT/schema.sql"

  echo "==> 3/4  data"
  supabase db dump --db-url "$OLD_DB_URL" -f "$OUT/data.sql" --use-copy --data-only \
    -x "storage.buckets_vectors" -x "storage.vector_indexes"

  # The migration history is a separate schema and is not part of the normal dump.
  # Carrying it across is what keeps `supabase db push` sane afterwards — without
  # it the new project believes it has never had a migration applied.
  echo "==> 4/4  migration history"
  supabase db dump --db-url "$OLD_DB_URL" -f "$OUT/history_schema.sql" --schema supabase_migrations
  supabase db dump --db-url "$OLD_DB_URL" -f "$OUT/history_data.sql" --use-copy --data-only --schema supabase_migrations
fi

echo
echo "==> Restoring from:"
wc -l "$OUT"/*.sql
echo
# `|| reply=""` matters. Under `set -e`, a bare `read` that hits end-of-file exits
# the script immediately with status 1 and prints nothing — so a deliberately
# non-interactive run (stdin from /dev/null, which is a good way to prove the
# script cannot approve itself) looks indistinguishable from a crash partway
# through the restore. Treating EOF as "not yes" reaches the message below, which
# says plainly that nothing was written.
read -r -p "Restore these into the NEW Frankfurt project? [yes/NO] " reply || reply=""
[[ "$reply" == "yes" ]] || { echo "Stopped. Dumps are in $OUT; nothing was written."; exit 0; }

# roles.sql restores on its own, and tolerantly. This is not fussiness:
#
#   psql: roles.sql:13: ERROR:  "supabase_admin" is a reserved role,
#                              only superusers can modify it
#   exit code: 3
#
# `supabase db dump --role-only` emits ALTER ROLE for supabase_admin, and the
# postgres role on Supabase is not a superuser, so psql cannot execute that line —
# ever, on any Supabase project. Bundled into the same --single-transaction with
# ON_ERROR_STOP=1 as the schema and data, that one unexecutable line aborted the
# entire restore of a 1.8 MB database and rolled it all back. The rollback worked
# perfectly; the problem is that the restore could never have succeeded.
#
# (The header of this script used to claim the CLI strips reserved roles. It
# strips CREATE ROLE, not ALTER ROLE ... SET.)
#
# What the file actually carries is statement_timeout and lock_timeout settings for
# anon, authenticated, authenticator and supabase_admin. On a freshly provisioned
# project the first three are already identical, so they are no-ops — but they are
# not guaranteed to be on some future project, which is why this still runs rather
# than being skipped.
#
# Tolerant means: apply what we can, then insist that every failure was a reserved
# role. Anything else is a real problem and aborts before the schema is touched.
echo "==> Restoring roles (reserved-role settings cannot be applied as postgres)"
ROLES_LOG="$OUT/roles-restore.log"
set +e
psql --variable ON_ERROR_STOP=0 --file "$OUT/roles.sql" --dbname "$NEW_DB_URL" \
  >"$ROLES_LOG" 2>&1
set -e

if grep -qE 'ERROR:' "$ROLES_LOG"; then
  echo "    refused (expected for platform-reserved roles):"
  grep -E 'ERROR:' "$ROLES_LOG" | sed 's/^/      /'
  if grep -E 'ERROR:' "$ROLES_LOG" | grep -qvE 'is a reserved role, only superusers can modify it'; then
    echo
    echo "One of those is NOT a reserved-role refusal. Stopping before the schema is"
    echo "touched — the full log is at $ROLES_LOG"
    exit 1
  fi
fi

# session_replication_role = replica disables triggers for the data load. Without
# it every INSERT fires the attendance, leave and KPI guards we added, which
# would rewrite the very values being restored.
echo "==> Restoring schema and data"
psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file "$OUT/schema.sql" \
  --command 'SET session_replication_role = replica' \
  --file "$OUT/data.sql" \
  --dbname "$NEW_DB_URL"

echo "==> Restoring migration history"
psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file "$OUT/history_schema.sql" \
  --file "$OUT/history_data.sql" \
  --dbname "$NEW_DB_URL"

echo
echo "==> Restore finished. Row counts in the NEW project:"
psql "$NEW_DB_URL" -Atc "
  select 'auth.users     ' || count(*) from auth.users
  union all select 'employees      ' || count(*) from employees
  union all select 'company        ' || count(*) from company
  union all select 'attendance     ' || count(*) from attendance
  union all select 'kpi_scores     ' || count(*) from kpi_scores
  union all select 'rls policies   ' || count(*) from pg_policies where schemaname='public'
  union all select 'functions      ' || count(*) from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace where n.nspname='public';"

cat <<'NOTE'

Not carried over by this script — these need doing separately:

  * pg_cron jobs. The `cron` schema is not part of the dump, so the monthly
    KPI rules job does not exist in the new project. It has to be recreated.
  * Storage objects. Files in buckets are not copied by a database dump.
  * Auth settings: SMTP, redirect URLs, leaked-password protection, and any
    social login client IDs and secrets.
  * API keys are different in the new project — the app config must be updated.

Existing user sessions will not survive: the two projects sign JWTs with
different secrets, so everyone signs in again. Passwords themselves come across
intact in auth.users, so nobody needs a reset.
NOTE
