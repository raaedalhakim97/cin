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

SRC="${1:-$(ls -1t "$BACKUP_DIR"/byond-*.dump* 2>/dev/null | head -1)}"
[[ -n "${SRC:-}" && -r "$SRC" ]] || { echo "no readable backup found in $BACKUP_DIR" >&2; exit 1; }
echo "testing: $SRC"

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

echo "restoring ..."
# Supabase dumps reference roles and extensions that do not exist in a bare
# container, so some errors are expected and harmless. What matters is whether
# the TABLE DATA landed, which is what we count below.
docker cp "$DUMP" "$CONTAINER:/tmp/r.dump" >/dev/null
docker exec "$CONTAINER" pg_restore -U postgres -d restored --no-owner \
  --no-privileges /tmp/r.dump >/dev/null 2>"$TMPDIR_LOCAL/err.log" || true

echo
echo "── row counts in the restored copy ──"
docker exec "$CONTAINER" psql -U postgres -d restored -qAt -c "
  select format('%-28s %s', table_name, n) from (
    select c.relname as table_name, c.reltuples::bigint as n
    from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
    where ns.nspname='public' and c.relkind='r'
    order by c.relname
  ) t;" | sed 's/^/  /'

TABLES=$(docker exec "$CONTAINER" psql -U postgres -d restored -qAt -c \
  "select count(*) from pg_tables where schemaname='public';")
EMPLOYEES=$(docker exec "$CONTAINER" psql -U postgres -d restored -qAt -c \
  "select count(*) from public.employees;" 2>/dev/null || echo 0)

echo
echo "tables restored:    $TABLES"
echo "employees restored: $EMPLOYEES"
echo
if (( TABLES >= 30 )) && (( EMPLOYEES > 0 )); then
  echo "RESTORE TEST PASSED — this backup is usable."
else
  echo "RESTORE TEST FAILED — tables=$TABLES employees=$EMPLOYEES"
  echo "last 20 restore errors:"
  tail -20 "$TMPDIR_LOCAL/err.log" | sed 's/^/  /'
  exit 1
fi
