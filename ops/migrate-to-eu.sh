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
# Supabase Postgres image and filters the output — it drops internal schemas,
# strips reserved roles, and adds IF NOT EXISTS. A raw pg_dump includes Supabase
# internals and fails on permission errors partway through the restore. It also
# means the dump does not care that your local psql is older than the server.
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
need supabase
docker info >/dev/null 2>&1 || { echo "Docker is not running — the Supabase CLI needs it"; exit 1; }

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

echo
echo "==> Dumped:"
wc -l "$OUT"/*.sql
echo
read -r -p "Restore these into the NEW Frankfurt project? [yes/NO] " reply
[[ "$reply" == "yes" ]] || { echo "Stopped. Dumps are in $OUT; nothing was written."; exit 0; }

# session_replication_role = replica disables triggers for the data load. Without
# it every INSERT fires the attendance, leave and KPI guards we added, which
# would rewrite the very values being restored.
echo "==> Restoring"
psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file "$OUT/roles.sql" \
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
