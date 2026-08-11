# Building the Android APK

Everything in the repo is ready for this build. What is missing is an Expo
account and the four values that only exist once it is created, and those need a
terminal logged in as you — so this is a runbook rather than something already
done.

## Why this cannot be built from a Claude Code session

Both routes to an APK need a host the sandbox is not allowed to reach, and the
proxy denies them by policy:

```
CONNECT dl.google.com:443  -> 403 (policy denial)   # Android SDK, for a local Gradle build
CONNECT api.expo.dev:443   -> 403 (policy denial)   # EAS, for a cloud build
```

There is no Android SDK in the container either. So the build runs on your
laptop, or in GitHub Actions with an `EXPO_TOKEN` secret.

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
They are stored on the Expo project instead:

```bash
npx eas-cli env:create --name EXPO_PUBLIC_SUPABASE_URL      --value "https://<project>.supabase.co" --environment preview
npx eas-cli env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "<anon key>"                    --environment preview
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
