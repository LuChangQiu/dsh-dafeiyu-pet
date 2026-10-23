import { readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
const roots = ['plugin', 'scripts']
const files = []
const walk = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (p.endsWith('.js') || p.endsWith('.mjs')) files.push(p)
  }
}
for (const r of roots) {
  try {
    walk(r)
  } catch {}
}
let bad = 0
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' })
  } catch (e) {
    bad++
    console.error('SYNTAX FAIL', f, String(e.stderr || e))
  }
}
console.log(`node --check: ${files.length - bad}/${files.length} OK`)
process.exit(bad ? 1 : 0)
