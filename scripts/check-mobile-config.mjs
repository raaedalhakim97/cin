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

if (!failed) console.log('app.json permissions ok; preview profile builds an apk')
process.exit(failed ? 1 : 0)
