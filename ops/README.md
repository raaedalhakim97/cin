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

---

## What this does not cover

- **Point-in-time recovery.** A nightly dump means you can lose up to a day.
  If that is unacceptable for payroll, Supabase Pro with PITR is the answer;
  no script can substitute for it.
- **Storage bucket contents.** `pg_dump` captures the database, not uploaded
  files. Once employees start uploading documents, add a `storage` sync too.
- **Auth users.** They live in the `auth` schema, which this dump does include —
  but restoring them into a *different* Supabase project needs care, because
  user IDs are referenced throughout `public`.
