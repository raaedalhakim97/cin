// Compile every mobile source file with Babel.
//
// Run from the mobile/ directory. Lives as a script rather than YAML-escaped
// JavaScript so it can be run locally exactly as CI runs it — the inline
// version was three levels of quoting deep and impossible to test by hand.
import { createRequire } from 'node:module'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const require = createRequire(join(process.cwd(), 'package.json'))
const babel = require('@babel/core')
const preset = require.resolve('babel-preset-expo')

let checked = 0
const failures = []

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') walk(p)
      continue
    }
    if (!/\.(js|jsx)$/.test(entry.name)) continue
    checked++
    try {
      babel.transformSync(readFileSync(p, 'utf8'), {
        filename: p, presets: [preset], babelrc: false, configFile: false,
      })
    } catch (err) {
      failures.push(`${p}: ${err.message.split('\n')[0]}`)
    }
  }
}

walk('app')
walk('src')

for (const f of failures) console.error(`::error::${f}`)
console.log(`${checked} files checked, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
