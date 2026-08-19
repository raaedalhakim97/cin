// Keeps three lists of notification kinds in agreement.
//
// A notification kind is declared in one place — the CHECK constraint in
// migration 16 — and consumed in two: the web bell's KIND_META and the mobile
// bell's. Add a kind to the constraint and a trigger that writes it, and both
// clients start receiving rows they have no icon, no colour and (on mobile) no
// destination for. Nothing fails: the row renders as a plain grey bell, and on
// mobile the tap does nothing at all. That is a silent, permanent regression in
// the one feature whose whole job is to tell people something happened.
//
// So this asserts, from the checked-in files and with no database access:
//
//   1. web KIND_META covers exactly the constraint's kinds
//   2. mobile KIND_META covers exactly the constraint's kinds
//   3. mobile mobileRoute() has a branch for every kind
//
// Run from the repo root: node scripts/check-notification-kinds.mjs

import { readFileSync } from 'node:fs'

const MIGRATION = 'supabase/migrations-applied/16_notifications_foundation.sql'
const WEB       = 'src/components/NotificationBell.jsx'
const MOBILE    = 'mobile/src/lib/notifications.js'

const read = (p) => {
  try {
    return readFileSync(p, 'utf8')
  } catch {
    console.error(`::error::cannot read ${p}`)
    process.exit(1)
  }
}

// The kinds the database will accept, from the CHECK constraint body.
function constraintKinds(sql) {
  const m = sql.match(/CONSTRAINT\s+notifications_kind_check\s+CHECK\s*\(\s*kind\s+IN\s*\(([\s\S]*?)\)\s*\)/i)
  if (!m) {
    console.error(`::error::no notifications_kind_check constraint found in ${MIGRATION}`)
    process.exit(1)
  }
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1])
}

// The keys of a KIND_META object literal. Parsed rather than imported: the web
// copy pulls in lucide-react and the mobile copy is Metro-resolved, and neither
// loads in plain node. Keys are all this needs.
function metaKinds(src, path) {
  const m = src.match(/KIND_META\s*=\s*\{([\s\S]*?)\n\}/)
  if (!m) {
    console.error(`::error::no KIND_META object found in ${path}`)
    process.exit(1)
  }
  return [...m[1].matchAll(/^\s{2}([a-z_]+)\s*:/gm)].map((x) => x[1])
}

// The kinds mobileRoute() names in a case label.
function routedKinds(src) {
  const m = src.match(/export function mobileRoute\([\s\S]*$/)
  if (!m) {
    console.error(`::error::no mobileRoute function found in ${MOBILE}`)
    process.exit(1)
  }
  return [...m[0].matchAll(/case\s+'([a-z_]+)'/g)].map((x) => x[1])
}

const expected = constraintKinds(read(MIGRATION))
const mobileSrc = read(MOBILE)

const lists = [
  ['web KIND_META',      metaKinds(read(WEB), WEB)],
  ['mobile KIND_META',   metaKinds(mobileSrc, MOBILE)],
  ['mobile mobileRoute', routedKinds(mobileSrc)],
]

let failed = 0
for (const [name, actual] of lists) {
  const missing = expected.filter((k) => !actual.includes(k))
  const extra   = actual.filter((k) => !expected.includes(k))
  const dupes   = actual.filter((k, i) => actual.indexOf(k) !== i)

  for (const k of missing) {
    console.error(`::error::${name} has no entry for '${k}', which the database accepts`)
    failed++
  }
  for (const k of extra) {
    console.error(`::error::${name} has '${k}', which the CHECK constraint rejects — typo or stale kind`)
    failed++
  }
  for (const k of [...new Set(dupes)]) {
    console.error(`::error::${name} lists '${k}' twice`)
    failed++
  }
}

if (failed) process.exit(1)
console.log(
  `${expected.length} notification kinds; web bell, mobile bell and mobile routing all agree`
)
