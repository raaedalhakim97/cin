#!/usr/bin/env bash
#
# Nightly encrypted backup of the Supabase database.
#
# Runs on the Hetzner server, NOT inside Supabase — a backup that lives in the
# system it is backing up is not a backup. See ops/README.md for setup.
#
# Reads its configuration from /etc/byond/backup.env (mode 600, root-owned).
# Nothing secret is hardcoded here, so this file is safe to keep in git.

set -euo pipefail

CONFIG=/etc/byond/backup.env
[[ -r "$CONFIG" ]] || { echo "missing or unreadable $CONFIG" >&2; exit 1; }
# shellcheck source=/dev/null
source "$CONFIG"

: "${PGURL:?PGURL not set in $CONFIG}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/byond}"
KEEP_DAILY="${KEEP_DAILY:-30}"
GPG_RECIPIENT="${GPG_RECIPIENT:-}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$BACKUP_DIR/byond-$STAMP.dump"
LOCK=/var/lock/byond-backup.lock

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# A slow dump must never overlap with the next night's run.
exec 9>"$LOCK"
flock -n 9 || { echo "another backup is already running" >&2; exit 1; }

fail() {
  echo "BACKUP FAILED: $1" >&2
  # Ping the failure endpoint so a silent failure cannot masquerade as success.
  # A backup you believe in but which never ran is worse than none at all.
  [[ -n "$HEALTHCHECK_URL" ]] && curl -fsS -m 10 --retry 3 \
    --data-raw "$1" "${HEALTHCHECK_URL}/fail" >/dev/null 2>&1 || true
  exit 1
}
trap 'fail "unexpected error on line $LINENO"' ERR

# ── Dump ────────────────────────────────────────────────────────────────────
# -Fc  custom format, so pg_restore can do selective restores later.
# --no-owner / --no-privileges  the roles differ between projects; ownership
#   from the source would only fight the target on restore.
pg_dump "$PGURL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="$DEST" \
  || fail "pg_dump exited non-zero"

# ── Verify before trusting it ───────────────────────────────────────────────
# An unreadable archive that exists is the worst outcome, so prove it parses
# and that it actually contains tables.
[[ -s "$DEST" ]] || fail "dump is empty"

SIZE=$(stat -c%s "$DEST")
(( SIZE > 100000 )) || fail "dump is only ${SIZE} bytes — suspiciously small"

TABLES=$(pg_restore --list "$DEST" 2>/dev/null | grep -c 'TABLE DATA' || true)
(( TABLES > 20 )) || fail "archive lists only ${TABLES} tables — expected 30+"

# ── Encrypt ─────────────────────────────────────────────────────────────────
# The dump contains salaries, IBANs and national ID numbers. Encrypting to a
# PUBLIC key means this server can create backups but cannot read them back —
# so a compromise of the box does not hand over the payroll history. Keep the
# private key somewhere else entirely.
if [[ -n "$GPG_RECIPIENT" ]]; then
  gpg --batch --yes --trust-model always \
      --recipient "$GPG_RECIPIENT" --encrypt --output "$DEST.gpg" "$DEST" \
      || fail "gpg encryption failed"
  shred -u "$DEST" 2>/dev/null || rm -f "$DEST"
  DEST="$DEST.gpg"
else
  echo "WARNING: GPG_RECIPIENT not set — backup stored unencrypted" >&2
fi

chmod 600 "$DEST"

# ── Retention ───────────────────────────────────────────────────────────────
find "$BACKUP_DIR" -name 'byond-*.dump*' -type f -mtime "+$KEEP_DAILY" -delete

echo "backup ok: $DEST ($(numfmt --to=iec "$(stat -c%s "$DEST")")), ${TABLES} tables"

trap - ERR
[[ -n "$HEALTHCHECK_URL" ]] && curl -fsS -m 10 --retry 3 "$HEALTHCHECK_URL" >/dev/null 2>&1 || true
exit 0
