# Server jobs (Hetzner)

Two scheduled jobs keep the system honest. They are split deliberately:

| Job | Runs where | Why there |
|---|---|---|
| Nightly database backup | **Hetzner** | Off-site is the entire point. A backup living inside Supabase is not a backup. |
| Monthly KPI rules | **Inside Supabase** (`pg_cron`) | No database credentials on a VPS, and it keeps running if the server is down or rebuilt. |

The monthly KPI job is **already scheduled and active** — nothing to do on the
server for it. Only the backup needs setting up.

---

## Why the KPI job needed a code change

`evaluate_kpi_rules()` resolves the company from the signed-in user and raises
`Not authenticated` when there isn't one. Called from cron it failed outright,
which would have meant a job that appeared to be scheduled and silently did
nothing every month.

It is now three functions: an internal one that takes the company explicitly,
the unchanged HR-facing wrapper, and `evaluate_kpi_rules_all_companies()` for
automation. Only the wrapper is reachable from the app.

Check it ran:

```sql
select jobname, status, start_time, return_message
from cron.job_run_details
order by start_time desc limit 5;
```

Run it by hand for a past month (as HR, from the app or SQL editor):

```sql
select public.evaluate_kpi_rules(2026, 7);
```

---

## Backup setup — about 20 minutes, once

### 1. Install a PostgreSQL client that is new enough

The database runs **PostgreSQL 17**. `pg_dump` refuses to dump a server newer
than itself, and Ubuntu/Debian ship 15 or 16 by default — so the distro package
will fail with a version mismatch. Add the official PostgreSQL repository:

```bash
sudo apt install -y curl ca-certificates gnupg lsb-release
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  https://www.postgresql.org/media/keys/ACCC4CF8.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
  | sudo tee /etc/apt/sources.list.d/pgdg.list
sudo apt update
sudo apt install -y postgresql-client-17

pg_dump --version    # must say 17.x
```

### 2. Get a connection string that works with `pg_dump`

**Back up Frankfurt, `ududaetdwoqtchkvqewv` (eu-central-1).** That is production as of
19 August 2026. Mumbai, `rxkgnbvjywiqkgbbypfs`, is the retired project — still running
as a fallback, but nothing writes to it any more. Backing that one up would produce a
perfect nightly copy of a database nobody uses, and the failure would be invisible
because the dumps would look completely healthy.

If the password has been exposed anywhere — a chat, a transcript, a screenshot — rotate
it **before** writing the config file in step 4, not after. Otherwise the config is
written with a credential you are about to invalidate, and the first failure is a
backup that silently stops working at 03:17 the following morning.

Supabase dashboard → **Project Settings** → **Database** → Connection string →
**URI**.

**Use the direct connection or the session pooler — never the transaction
pooler.** The transaction pooler (port **6543**) does not support the prepared
statements `pg_dump` relies on, and the dump will fail in a confusing way.

- Direct: `postgresql://postgres:PASSWORD@db.<ref>.supabase.co:5432/postgres`
  — that host is **IPv6-only**, it has no A record at all. It works from a server
  with IPv6 (Hetzner provides it by default) and fails with "Network is
  unreachable" from anything without it, including a typical Windows/WSL laptop.
- Session pooler: username `postgres.<ref>`, port 5432. **Copy the whole URI from
  the dashboard — Connect → Session pooler — rather than assembling it.** The
  host prefix is assigned per project and is not derivable: our two projects came
  out as `aws-1-ap-south-1` and `aws-0-eu-central-1` respectively. A wrong prefix
  returns "Tenant or user not found", which reads like a bad password and sends
  you off resetting credentials that were never the problem.

Test before scheduling anything:

```bash
psql "YOUR_CONNECTION_STRING" -c 'select current_database(), version();'
```

### 3. Create the encryption key (recommended)

The dump contains salaries, IBANs and national ID numbers. Encrypt it to a
**public** key, so the server can write backups but cannot read them back — a
compromise of the box then does not hand over your payroll history.

Generate the keypair **on your laptop, not the server**:

```bash
gpg --quick-generate-key "byond-backup" default default never
gpg --armor --export byond-backup > byond-backup-public.asc
```

Copy only the public half to the server and import it:

```bash
scp byond-backup-public.asc root@YOUR_SERVER:/tmp/
ssh root@YOUR_SERVER 'gpg --import /tmp/byond-backup-public.asc && rm /tmp/byond-backup-public.asc'
```

Keep the private key and its passphrase somewhere safe and off the server. If
you lose it, the backups are unreadable — which is the point, and also the risk.

### 4. Write the config file

```bash
sudo install -d -m 700 /etc/byond
sudo tee /etc/byond/backup.env >/dev/null <<'EOF'
PGURL="postgresql://postgres:PASSWORD@db.<ref>.supabase.co:5432/postgres"
BACKUP_DIR="/var/backups/byond"
KEEP_DAILY=30
GPG_RECIPIENT="byond-backup"
# Optional but strongly advised: a free healthchecks.io ping URL. Without it a
# backup that stops working is invisible until the day you need it.
HEALTHCHECK_URL=""
EOF
sudo chmod 600 /etc/byond/backup.env
```

### 5. Install the script and run it once

```bash
sudo install -m 750 ops/backup-supabase.sh /usr/local/bin/byond-backup
sudo /usr/local/bin/byond-backup
```

You should see `backup ok: ... 30+ tables`. The script refuses to report success
on an empty dump, a suspiciously small one, or an archive that lists fewer than
20 tables.

### 6. Prove it restores — do not skip this

```bash
sudo apt install -y docker.io
sudo ./ops/verify-restore.sh
```

This restores the newest backup into a throwaway container and counts rows. It
never touches the live database. Expect `RESTORE TEST PASSED`. Some restore
errors scroll past and are harmless — Supabase dumps reference roles and
extensions a bare container does not have. What matters is the row counts.

An untested backup is a guess. Run this once now and again whenever you change
anything about the pipeline.

### 7. Schedule it

```bash
sudo crontab -e
```

Add:

```cron
# Nightly at 03:17 UTC. An odd minute avoids the top-of-hour rush.
17 3 * * * /usr/local/bin/byond-backup >> /var/log/byond-backup.log 2>&1
```

Then check the next morning:

```bash
tail /var/log/byond-backup.log
ls -lh /var/backups/byond/
```

### 8. Optional: a second copy somewhere else

One copy on one server is one fire away from nothing. A Hetzner Storage Box is
a few euros a month:

```cron
27 4 * * * rsync -a --delete /var/backups/byond/ uXXXXX@uXXXXX.your-storagebox.de:byond/
```

### 9. Where the backups physically sit

Check which Hetzner location the server is in. Nuremberg, Falkenstein and Helsinki are
in the EU; Hillsboro and Ashburn are not.

The database was moved to Frankfurt so that UAE PDPL cross-border rules are satisfied
by an EU adequacy argument, and the same reasoning has to serve Nigeria's NDPA later.
Nightly encrypted copies of every salary, IBAN and national ID sitting on a US server
would quietly undo that, and it would be an odd thing to have to explain. Keep both the
server and any off-site copy inside the EU.

---

## Restoring for real — read this before you need it

`ops/verify-restore.sh` proves a backup *parses and contains the rows*. It restores into
a throwaway container, so it deliberately proves nothing about grants. Restoring into a
live Supabase project needs two more steps, and skipping them is not a small mistake.

`backup-supabase.sh` dumps with `--no-owner --no-privileges`. Policies come across —
`CREATE POLICY` is schema, not an ACL — but **table and function GRANTs do not**. So a
restore lands with the *target* project's default privileges, and on a fresh Supabase
project those give `anon` and `authenticated` broad access.

That is not hypothetical. It is exactly what the Frankfurt migration was found in, after
a restore that matched the source on every structural and row count:

```
                                          source   restored
TRUNCATE/TRIGGER/REFERENCES grants           0        246
anon grants beyond demo_requests INSERT      0        286
audit_logs write grants for anon/auth        0          8
```

`anon` is the role the web app uses before anyone logs in, and `TRUNCATE` is not subject
to RLS, so no row policy contains it. RLS was fully intact throughout — which is why
nothing looked wrong.

So after any real restore:

```bash
psql -v ON_ERROR_STOP=1 "$TARGET_DB_URL" -f ops/post-restore-grants.sql
psql -v ON_ERROR_STOP=1 "$TARGET_DB_URL" -f supabase/tests/guarantees.sql
```

The guarantee suite is the actual proof — 32 assertions covering tenant isolation,
attendance integrity, the audit trail and the geofence — and it rolls back everything it
writes, so it is safe against production. Five of those 32 failed on the Frankfurt
restore, and all five were this.

Also recreate the `pg_cron` schedule, which no dump carries: `ops/post-migrate-eu.sql`.

---

## What this does not cover

- **Table and function GRANTs.** See the section above. The dump excludes ACLs by
  design, and `post-restore-grants.sql` is how they come back.
- **Point-in-time recovery.** A nightly dump means you can lose up to a day.
  If that is unacceptable for payroll, Supabase Pro with PITR is the answer;
  no script can substitute for it.
- **Storage bucket contents.** `pg_dump` captures the database, not uploaded
  files — and this one has already bitten. The Frankfurt restore produced a
  `storage.objects` row *and* an `hr_documents` row for a 113 KB PDF whose bytes
  were never copied, so the document listed in the UI and 404'd on download. The
  metadata travels and the file does not, which is worse than an obvious absence.
  Add a `storage` sync as soon as employees upload anything real.
- **`pg_cron` schedules.** The `cron` schema is not in the dump. Without it the
  monthly KPI job silently never runs, and nobody notices until a month of awards
  and warnings is missing.
- **Auth users.** They live in the `auth` schema, which this dump does include —
  but restoring them into a *different* Supabase project needs care, because
  user IDs are referenced throughout `public`.
