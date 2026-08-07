// Guard two mobile settings that fail SILENTLY rather than loudly.
//
// Run from the mobile/ directory.
//
//   * Without ACCESS_FINE_LOCATION / ACCESS_COARSE_LOCATION, clock-in fails on
//     a real device with no error the user can act on.
//   * A preview profile that builds an app-bundle produces a file that cannot
//     be installed on a phone at all — the classic first-Android-build dead end.
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(join(process.cwd(), 'package.json'))
const app = require(join(process.cwd(), 'app.json')).expo
const eas = require(join(process.cwd(), 'eas.json'))

let failed = false

// Every dependency must be present in the lockfile.
//
// `npm ci` refuses to install when package.json and package-lock.json disagree,
// and it fails on the runner rather than locally — adding expo-updates to
// package.json without regenerating the lock broke CI on main with
// "Missing: expo-updates@57.0.12 from lock file". Nothing local caught it,
// because compile-check runs against whatever node_modules already exists and
// is perfectly happy with a stale tree.
//
// This is the offline half of that check: no network, no install, just the two
// files agreeing. It runs in a second and would have caught it.
const lock = require(join(process.cwd(), 'package-lock.json'))
const pkg = require(join(process.cwd(), 'package.json'))
const locked = lock.packages ?? {}
const unlocked = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
  .filter((name) => !locked[`node_modules/${name}`])

if (unlocked.length) {
  console.error(`::error::package-lock.json is out of sync with package.json — missing ${unlocked.join(', ')}. Run \`npm install --package-lock-only\` in mobile/ and commit the lockfile, or \`npm ci\` will fail on the runner.`)
  failed = true
}

const need = ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION']
const have = app.android?.permissions ?? []
const missing = need.filter((p) => !have.includes(p))
if (missing.length) {
  console.error(`::error::android permissions missing: ${missing.join(', ')} — clock-in needs GPS and will fail silently without them`)
  failed = true
}

if (eas.build?.preview?.android?.buildType !== 'apk') {
  console.error('::error::the preview profile must build an apk, not an app-bundle — an aab cannot be installed on a phone')
  failed = true
}

// expo-updates is installed but does nothing until `updates.url` points at an
// EAS project. Half-configured is the worst state: the app ships believing it
// can be updated over the air, and the first time you need to change the
// Supabase URL you discover it cannot. `eas update:configure` fills this in
// once the Expo project exists — which needs a terminal, so it is a warning
// here rather than a failure.
const hasUpdates = Object.prototype.hasOwnProperty.call(app, 'updates')
if (hasUpdates && !app.updates?.url) {
  console.warn('::warning::expo-updates is configured but updates.url is not set — over-the-air updates will not reach the app. Run `eas update:configure` in mobile/.')
}
if (hasUpdates && !app.runtimeVersion) {
  console.error('::error::updates are enabled without a runtimeVersion — EAS cannot decide which builds an update is compatible with')
  failed = true
}

// A build profile without a channel cannot receive updates, which is the same
// silent dead end as above.
for (const profile of ['preview', 'production']) {
  if (hasUpdates && !eas.build?.[profile]?.channel) {
    console.error(`::error::build profile "${profile}" has no channel — builds from it can never receive an over-the-air update`)
    failed = true
  }
}

if (!failed) console.log('app.json permissions ok; preview profile builds an apk; update channels set')
process.exit(failed ? 1 : 0)
