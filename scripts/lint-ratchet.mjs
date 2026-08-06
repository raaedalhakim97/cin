// Lint ratchet: the repo carries pre-existing findings, so a zero-tolerance
// gate would fail every build and train everyone to ignore CI. This fails only
// when the count GROWS, which is the property that actually matters.
//
// When you fix findings, lower .eslint-baseline in the same commit — the script
// tells you the new number.
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'

const baseline = existsSync('.eslint-baseline')
  ? Number(readFileSync('.eslint-baseline', 'utf8').trim())
  : Infinity

let out = ''
try {
  out = execFileSync('npx', ['eslint', '.', '-f', 'json'], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  })
} catch (err) {
  // eslint exits non-zero when it finds errors; the JSON is still on stdout.
  out = err.stdout || ''
  if (!out) { console.error('eslint produced no output'); process.exit(1) }
}

const files = JSON.parse(out)
const count = files.reduce((n, f) => n + f.messages.length, 0)

// A parse error means the file cannot even be read — never acceptable.
const fatal = files.flatMap((f) =>
  f.messages.filter((m) => m.fatal).map((m) => `${f.filePath}:${m.line} ${m.message}`)
)
if (fatal.length) {
  console.error('::error::eslint could not parse:')
  fatal.forEach((f) => console.error('  ' + f))
  process.exit(1)
}

console.log(`eslint findings: ${count} (baseline ${baseline})`)
if (count > baseline) {
  console.error(`::error::lint findings rose from ${baseline} to ${count}`)
  const worst = {}
  for (const f of files) for (const m of f.messages) worst[m.ruleId] = (worst[m.ruleId] || 0) + 1
  Object.entries(worst).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .forEach(([r, n]) => console.error(`  ${n}  ${r}`))
  process.exit(1)
}
if (count < baseline) {
  console.log(`findings went down — lower .eslint-baseline to ${count} in this commit`)
}
