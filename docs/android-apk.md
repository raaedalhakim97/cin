# Building the Android APK

Everything in the repo is ready for this build. What is missing is an Expo
account and the four values that only exist once it is created, and those need a
terminal logged in as you — so this is a runbook rather than something already
done.

## Where this can and cannot be built

Not from a Claude Code **web** session. Both routes need a host that sandbox is not
allowed to reach, and the proxy denies them by policy:

```
CONNECT dl.google.com:443  -> 403 (policy denial)   # Android SDK, for a local Gradle build
CONNECT api.expo.dev:443   -> 403 (policy denial)   # EAS, for a cloud build
```

There is no Android SDK in that container either.

**A Claude Code session on your own laptop is a different matter, and this file used
to imply otherwise.** Measured from the Windows/WSL laptop:

```
api.expo.dev   -> HTTP 200
dl.google.com  -> HTTP 302
```

So a session there can drive the whole EAS build. Two things it still cannot do for
you, and neither is a network limit:

* `eas-cli login` — creating an account or typing a password is yours. If you would
  rather not hand over a logged-in session at all, generate an access token in the
  Expo dashboard and pass it as `EXPO_TOKEN`, which is scoped and revocable.
* installing Node, if the distro has none, because that needs `sudo`.

The same caution applies as with the Docker requirement in `ops/migrate-to-eu.sh`:
test the host rather than trusting a note written about a different machine. That is
how both of these were established.

### If WSL has no Node

Windows Node leaks into WSL through interop, so `npm` resolves to
`/mnt/c/Program Files/nodejs/npm` while `node` is not found at all. Do not drive
the Windows Node against the WSL checkout over a `\\wsl.localhost\...` UNC path —
`scripts/check-mobile-config.mjs` cannot resolve `app.json` through it. It is the
same class of problem as working in `/mnt/c`.

```
sudo apt-get update && sudo apt-get install -y nodejs npm
```

One thing to watch afterwards: an older `npm` rewrites `libc` metadata on unrelated
optional packages, which turns a one-package install into a fifty-line lockfile
diff. If you need to add a dependency and see that, use `npx npm@11 install <pkg>`
instead. `npx eas-cli` does not touch the lockfile, so the build itself is unaffected.

## Decide this before you build: which database does the APK point at?

`EXPO_PUBLIC_SUPABASE_URL` is **baked into the binary at build time**. It is not
read at startup. So an APK is permanently tied to the project it was built
against.

The plan on record is to move the database out of Mumbai to Frankfurt (see
`ops/migrate-to-eu.sh`). If an APK is built now and the migration happens later,
**every installed copy stops working** and has to be rebuilt and reinstalled by
hand on every phone.

So:

* **A test build for your own phone, today** — fine, build against the current
  project. Treat it as disposable.
* **Anything you give to staff** — migrate first, then build. Otherwise you
  will be walking around 50 phones reinstalling.

Over-the-air updates (`expo-updates`) can replace the JavaScript in an installed
app, but they cannot change a native build-time environment variable. This is not
a problem OTA solves.

## One-time setup

From `mobile/`, on a machine with Node 20+:

```bash
cd mobile
npx eas-cli login          # your Expo account
npx eas-cli init           # creates the Expo project; writes extra.eas.projectId and owner
npx eas-cli update:configure   # writes updates.url, so OTA updates have somewhere to go
```

`app.json` currently has `updates.enabled: true` with no `updates.url`. That is
the half-configured state — the app ships believing it can be updated, and the
first time you need to push a fix you find out it cannot. `update:configure`
fixes it, and `scripts/check-mobile-config.mjs` warns until it is done.

Commit the `app.json` changes those two commands make.

## The Supabase credentials

These must **not** go in `eas.json` or anywhere else tracked — the anon key is a
JWT, and `scripts/check-secrets.sh` fails the build if one appears in source.
They are stored on the Expo project instead.

Keep the key out of the command line too, not just out of the repo. A literal in a
command lands in shell history, in terminal scrollback, and in any transcript of the
session. Put it in the same file the database URLs already live in — outside any
repository, mode 0600 — and reference it:

```bash
echo "FRANKFURT_ANON_KEY='<paste it here>'" >> ~/.byond-migration.env
chmod 600 ~/.byond-migration.env

set -a; . ~/.byond-migration.env; set +a
npx eas-cli env:create --name EXPO_PUBLIC_SUPABASE_URL      --value "https://<project>.supabase.co" --environment preview
npx eas-cli env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "$FRANKFURT_ANON_KEY"           --environment preview
```

Take both from the Supabase dashboard, or from the Vercel environment variables
the website already uses — they are the same two values.

**Do not put empty strings in `eas.json`.** `eas.json` takes precedence over
these stored variables, so `"EXPO_PUBLIC_SUPABASE_URL": ""` does not mean
"unset" — it wins. And `mobile/src/lib/supabase.js` treats an empty URL as "no
project wired up yet" and silently falls back to the in-memory demo client. The
APK then installs, looks perfectly healthy, and rejects every real login,
because it is running on seed data. `check-mobile-config.mjs` now fails on this
rather than letting you spend a build cycle finding out.

The `env` blocks were removed from both profiles for exactly that reason, so there
is currently nothing to fix in `eas.json` — the `preview` profile is already
`distribution: internal` with `android.buildType: apk`, and nothing else. Leave it
that way; the check exists to catch the empty strings coming back.

## Build it

```bash
npx eas-cli build --platform android --profile preview
```

The `preview` profile is `distribution: internal` and
`android.buildType: apk` — an installable file, not the `.aab` the store wants
and a phone cannot open. EAS prints a download link when it finishes; the free
tier queues, so it can take a while.

Install it by opening that link on the phone and allowing installation from an
unknown source.

## Checking it works

The APK is talking to the real database, not the demo, when:

* your own login works, with the password you actually use — the demo accepts
  anything and shows Sarah Al-Hamdan;
* clocking in on the phone appears on the website within a few seconds;
* the phone refuses to clock in without location permission, because
  `require_gps_clock_in` is on and the server enforces it.

If logins fail but the app otherwise looks fine, it is in demo mode: the two
environment variables did not reach the build.
