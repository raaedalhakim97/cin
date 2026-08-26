#!/usr/bin/env bash
#
# Prove a backup can actually be restored. Run this once now, and again after
# any change to the backup pipeline.
#
# Restores the newest backup into a THROWAWAY PostgreSQL container and counts
# rows. It never touches the live database.
#
#   sudo ./verify-restore.sh                  # newest backup
#   sudo ./verify-restore.sh /path/to.dump    # a specific one
#
# Requires docker. Needs the GPG private key present if backups are encrypted.

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/byond}"
PGVER="${PGVER:-17}"          # must be >= the Supabase server major version
CONTAINER=byond-restore-test
TMPDIR_LOCAL=$(mktemp -d)
trap 'rm -rf "$TMPDIR_LOCAL"; docker rm -f "$CONTAINER" >/dev/null 2>&1 || true' EXIT

if [[ -n "${1:-}" ]]; then
  SRC="$1"
  AUTO_PICKED=0        # an explicit path means "test THIS one", age is the caller's business
else
  SRC="$(ls -1t "$BACKUP_DIR"/byond-*.dump* 2>/dev/null | head -1)"
  AUTO_PICKED=1
fi
[[ -n "${SRC:-}" && -r "$SRC" ]] || { echo "no readable backup found in $BACKUP_DIR" >&2; exit 1; }
echo "testing: $SRC"

# ── Is this backup actually recent? ────────────────────────────────────────────
# Without this the script answers the wrong question. It proves a dump can be
# restored; it said nothing about WHEN that dump was taken. If the systemd timer
# died three weeks ago, this restores the newest file it can find — a three-week-old
# one — and prints RESTORE TEST PASSED. False reassurance is worse than no check,
# because it is the one you act on.
#
# Only enforced when we picked the file ourselves. Passing a path explicitly is a
# deliberate "test this old dump", so the gate would just be in the way.
# MAX_AGE_HOURS=0 disables it.
MAX_AGE_HOURS="${MAX_AGE_HOURS:-48}"
AGE_HOURS=$(( ( $(date +%s) - $(stat -c %Y "$SRC") ) / 3600 ))
echo "backup age: ${AGE_HOURS}h"

if (( AUTO_PICKED == 1 )) && (( MAX_AGE_HOURS > 0 )) && (( AGE_HOURS > MAX_AGE_HOURS )); then
  echo >&2
  echo "STALE BACKUP — newest is ${AGE_HOURS}h old, limit is ${MAX_AGE_HOURS}h." >&2
  echo "The dump may well restore fine. That is not the problem: nothing has been" >&2
  echo "backed up since it was written, so the last ${AGE_HOURS}h are not protected." >&2
  echo >&2
  echo "Check the timer before trusting anything else here:" >&2
  echo "    systemctl status byond-backup.timer byond-backup.service" >&2
  echo "    journalctl -u byond-backup.service -n 50 --no-pager" >&2
  exit 1
fi

# Decrypt if needed.
DUMP="$TMPDIR_LOCAL/restore.dump"
if [[ "$SRC" == *.gpg ]]; then
  gpg --batch --yes --decrypt --output "$DUMP" "$SRC" \
    || { echo "decryption failed — is the private key on this machine?" >&2; exit 1; }
else
  cp "$SRC" "$DUMP"
fi

echo "starting throwaway postgres:$PGVER ..."
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=throwaway \
  "postgres:$PGVER" >/dev/null

# Wait for it to accept connections.
for _ in $(seq 1 60); do
  docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 \
  || { echo "container never became ready" >&2; exit 1; }

docker exec "$CONTAINER" psql -U postgres -qc 'CREATE DATABASE restored;' >/dev/null

# Create the Supabase roles before restoring, or this drill quietly proves less
# than it appears to.
#
# Every RLS policy in this database is written `TO authenticated` or `TO anon`.
# CREATE POLICY fails outright if the role does not exist, so in a bare container
# all 113 policies fail, their errors are swallowed by the `|| true` below, and
# the drill still reports success on the strength of the row counts alone. A
# backup could lose every policy and this script would have called it usable.
# Plain statements rather than a plpgsql loop: the container is brand new, so none
# of these exist yet and each one simply succeeds. Errors are discarded so that a
# role which does happen to exist cannot abort the drill.
for role in anon authenticated service_role authenticator \
            supabase_admin supabase_auth_admin supabase_storage_admin \
            dashboard_user pgbouncer; do
  docker exec "$CONTAINER" psql -U postgres -d restored -qc \
    "CREATE ROLE \"$role\" NOLOGIN;" >/dev/null 2>&1 || true
done

ROLES_MADE=$(docker exec "$CONTAINER" psql -U postgres -qAt -c \
  "select count(*) from pg_roles where rolname in
     ('anon','authenticated','service_role','authenticator','supabase_admin',
      'supabase_auth_admin','supabase_storage_admin','dashboard_user','pgbouncer');")
echo "supabase roles present: $ROLES_MADE/9"
(( ROLES_MADE >= 3 )) || { echo "could not create anon/authenticated — policies would all fail" >&2; exit 1; }

echo "restoring ..."
# Supabase dumps reference extensions that do not exist in a bare container, so
# some errors are expected and harmless. What matters is whether the TABLE DATA
# and the policies landed, which is what we count below.
docker cp "$DUMP" "$CONTAINER:/tmp/r.dump" >/dev/null
docker exec "$CONTAINER" pg_restore -U postgres -d restored --no-owner \
  --no-privileges /tmp/r.dump >/dev/null 2>"$TMPDIR_LOCAL/err.log" || true

echo
echo "── row counts in the restored copy ──"
# Real counts, not pg_class.reltuples. reltuples is a planner estimate maintained by
# VACUUM and ANALYZE, and pg_restore runs neither, so it reads -1 for a table nothing
# has analysed yet. That is not a corner case: measured on the live Frankfurt database,
# reltuples is -1 for all but one table — employees included, where the real count is 17.
# So this block used to print a column of -1 and call it row counts. The one table with a
# real estimate had it wrong anyway (781 against 874 actual).
#
# query_to_xml is the idiom for counting a table whose name you only learn at runtime.
# Slower than an estimate, irrelevant at this size, and the whole job here is verification.
docker exec "$CONTAINER" psql -U postgres -d restored -qAt -c "
  select format('%-28s %s', table_name, n) from (
    select c.relname as table_name,
           (xpath('/row/c/text()',
                  query_to_xml(format('select count(*) as c from public.%I', c.relname),
                               false, true, '')))[1]::text::bigint as n
    from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
    where ns.nspname='public' and c.relkind='r'
    order by c.relname
  ) t;" | sed 's/^/  /'

TABLES=$(docker exec "$CONTAINER" psql -U postgres -d restored -qAt -c \
  "select count(*) from pg_tables where schemaname='public';")
EMPLOYEES=$(docker exec "$CONTAINER" psql -U postgres -d restored -qAt -c \
  "select count(*) from public.employees;" 2>/dev/null || echo 0)
# Employees alone is a weak signal: this database is multi-tenant, and a restore that
# brought back staff but lost the company rows they hang off is not a usable backup.
COMPANIES=$(docker exec "$CONTAINER" psql -U postgres -d restored -qAt -c \
  "select count(*) from public.company;" 2>/dev/null || echo 0)
POLICIES=$(docker exec "$CONTAINER" psql -U postgres -d restored -qAt -c \
  "select count(*) from pg_policies where schemaname='public';" 2>/dev/null || echo 0)
RLS_OFF=$(docker exec "$CONTAINER" psql -U postgres -d restored -qAt -c \
  "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and not c.relrowsecurity;" 2>/dev/null || echo 99)

echo
echo "tables restored:      $TABLES"
echo "companies restored:   $COMPANIES"
echo "employees restored:   $EMPLOYEES"
echo "RLS policies:         $POLICIES"
echo "tables with RLS off:  $RLS_OFF"
echo

# Tenant isolation is the property that matters most in this database, and it is
# made of policies. A restore that brings the rows back without them is not a
# usable backup — it is a data leak with the right row counts.
if (( TABLES >= 30 )) && (( COMPANIES > 0 )) && (( EMPLOYEES > 0 )) \
   && (( POLICIES >= 100 )) && (( RLS_OFF == 0 )); then
  echo "RESTORE TEST PASSED — ${AGE_HOURS}h-old backup, rows, policies and RLS all present."
  echo
  echo "One thing this backup does NOT contain, by design: table and function"
  echo "GRANTs. backup-supabase.sh dumps with --no-privileges, so ACLs are absent."
  echo "Restoring into a real Supabase project therefore lands with the NEW"
  echo "project's default grants, which give anon and authenticated broad access —"
  echo "exactly the state the Frankfurt migration was found in. So after any real"
  echo "restore, run:"
  echo
  echo "    psql -v ON_ERROR_STOP=1 \"\$TARGET_DB_URL\" -f ops/post-restore-grants.sql"
  echo "    psql -v ON_ERROR_STOP=1 \"\$TARGET_DB_URL\" -f supabase/tests/guarantees.sql"
  echo
  echo "The guarantee suite is the real proof, and it rolls back everything it"
  echo "writes. Deliberately no assertion count here — the last one went stale."
else
  echo "RESTORE TEST FAILED"
  echo "  tables=$TABLES (want >=30)  companies=$COMPANIES (want >0)  employees=$EMPLOYEES (want >0)"
  echo "  policies=$POLICIES (want >=100)  rls_off=$RLS_OFF (want 0)"
  echo
  if (( POLICIES < 100 )); then
    echo "  Policies missing is the serious one. If the roles could not be created"
    echo "  above, every CREATE POLICY would have failed — check the errors below"
    echo "  before concluding the backup itself is at fault."
  fi
  echo "last 20 restore errors:"
  tail -20 "$TMPDIR_LOCAL/err.log" | sed 's/^/  /'
  exit 1
fi
