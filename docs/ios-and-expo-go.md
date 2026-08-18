# Testing on iPhone: Expo Go now, a real build later

An `.apk` cannot be installed on an iPhone — iOS shows it as opaque "data" with no
Install option. Nothing is wrong with the build; it is an Android package. The
Android APK stands for Android staff, and iOS needs its own route.

Devices in scope are genuinely mixed, so both are needed.

## Right now, free: Expo Go

Expo Go runs the JavaScript of an Expo project inside a pre-built shell app from the
App Store. No Apple Developer account, no build, no $99. Good enough to walk through
clocking in, leave, KPI and the news feed on an actual iPhone today.

**This project is compatible.** Every dependency is either pure JavaScript or part of
the Expo SDK that Expo Go already contains — checked one by one against SDK 57:

```
@expo/vector-icons  async-storage  supabase-js  expo-constants  expo-font
expo-linking  expo-location  expo-router  expo-status-bar  react-native-svg
react-native-safe-area-context  react-native-screens  zustand
```

No custom native module, so nothing needs compiling.

### Setup

The one thing that catches people: with Expo Go the `EXPO_PUBLIC_*` variables come
from the **local** environment, not from the EAS project. The values stored on EAS
apply only to `eas build`. Without a local file the app falls back to the in-memory
demo client and rejects every real login — the same trap as an empty string in
`eas.json`, in a new place.

`mobile/.env` is already covered by `mobile/.gitignore`, so it cannot be committed.

```bash
cd ~/cin/mobile
cat > .env <<'EOF'
EXPO_PUBLIC_SUPABASE_URL=https://ududaetdwoqtchkvqewv.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<the publishable key>
EOF

npx expo start
```

Install **Expo Go** from the App Store, then point the iPhone camera at the QR code in
the terminal. The phone and the laptop must be on the same Wi-Fi; if they are not, or
the network blocks it, use `npx expo start --tunnel`.

### What Expo Go will not show you

* **The icons.** It runs inside Expo Go's own shell, so the launcher icon and splash
  are Expo's, not ours. Those only appear in a real build — which the Android APK
  already proves.
* **`expo-updates`.** Inert in Expo Go. Irrelevant for testing.
* **Push notifications.** Limited in Expo Go and removed on some platforms. When
  notifications are built, they will need a real build to test properly.
* **Distribution.** It stops working when the laptop's dev server stops. This is for
  looking at the app, never for giving it to staff.

You are on the real Frankfurt database, though, so a clock-in from Expo Go is a real
attendance row. Useful, and worth remembering before testing at 3am.

## Later, for staff iPhones: a real iOS build

Apple requires the **Apple Developer Program, $99/year**, before any iPhone can run
your build. There is no way around it, including for internal-only use. Enrolment can
take a day or two, so start it before you need it.

Once enrolled, EAS creates and manages the certificates and provisioning profiles:

```bash
cd ~/cin/mobile
npx eas-cli build --platform ios --profile preview
```

### Two distribution routes, and they are not equivalent

* **Ad hoc** (`distribution: internal`, which the `preview` profile already sets).
  Installs directly, but every device must be registered by UDID first —
  `eas device:create` — capped at 100 per year. Fine for your own iPhone. Miserable
  for fifty people.
* **TestFlight** (`distribution: store`, the `production` profile). Invite by email,
  no UDID collection. This is the route for staff. It needs App Store Connect and, for
  external testers, a light review per build.

### The trap in the production profile

**The `EXPO_PUBLIC_*` variables are stored only on the EAS `preview` environment.** A
build run with `--profile production` — which is what TestFlight needs — reads the
`production` environment, finds nothing, and ships in demo mode: it installs, looks
healthy, and rejects every real login.

Before the first TestFlight build:

```bash
set -a; . ~/.byond-migration.env; set +a
npx eas-cli env:create --name EXPO_PUBLIC_SUPABASE_URL      --value "https://ududaetdwoqtchkvqewv.supabase.co" --environment production
npx eas-cli env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "$FRANKFURT_ANON_KEY"                      --environment production
```

Then confirm the build log lists both as loaded from the `production` environment, the
same way the Android build did for `preview`.

### Export compliance

`ios.config.usesNonExemptEncryption` is now set to `false` in `app.json`. Without it,
every App Store Connect upload stops and asks about export compliance, and TestFlight
builds sit unavailable in "Missing Compliance" until someone answers by hand.

`false` is the correct answer here: the app's only cryptography is HTTPS/TLS provided
by the platform, which is exempt. It has no custom crypto of its own. If that ever
changes — end-to-end encrypted messaging, for instance — this declaration has to be
revisited, because it is a legal statement to Apple rather than a build setting.
