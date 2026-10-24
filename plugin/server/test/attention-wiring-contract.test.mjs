// attention-wiring contract test：index.js 接线点静态断言（默认关/零副作用前提）
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_ATTENTION_WIRING_CONFIG } from '../lib/attention-wiring.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..', '..', '..')
const src = fs.readFileSync(path.join(root, 'plugin', 'server', 'lib', 'index.js'), 'utf8')

let pass = 0
let fail = 0
const run = (name, fn) => {
  try {
    fn()
    pass++
  } catch (err) {
    fail++
    console.error(`FAIL ${name}: ${err.message}`)
  }
}

run('default attentionBudget config is disabled', () => {
  assert.equal(DEFAULT_ATTENTION_WIRING_CONFIG.enabled, false)
})

run('index imports attention wiring (not budget directly)', () => {
  assert.match(
    src,
    /import \{ createAttentionWiring, DEFAULT_ATTENTION_WIRING_CONFIG \} from '\.\/attention-wiring\.js'/
  )
  assert.doesNotMatch(src, /from '\.\/attention-budget\.js'/)
})

run('index creates wiring only when explicitly enabled', () => {
  assert.match(src, /cfg\.attentionBudget && cfg\.attentionBudget\.enabled === true/)
  assert.match(src, /createAttentionWiring\(\{/)
  // 默认 config 来自 wiring 默认（false）
  assert.match(src, /attentionBudget: \{ \.\.\.DEFAULT_ATTENTION_WIRING_CONFIG \}/)
})

run('whaleAct gates proactive paths and records only on success', () => {
  assert.match(src, /attentionWiring\.gate\(\{ kind: key, isS0: false, isReaction: false, nowMs \}\)/)
  assert.match(src, /reason: 'attention:' \+ gate\.reason/)
  assert.match(src, /attentionWiring\?\.recordProactive\(\{ kind: key, nowMs \}\)/)
})

run('user interaction hooks: user/message + ui-action', () => {
  const matches = src.match(/attentionWiring\?\.noteInteraction\(\)/g) || []
  assert.ok(matches.length >= 2, `expected >=2 noteInteraction hooks, got ${matches.length}`)
})

run('tick + dispose hooks exist', () => {
  assert.match(src, /attentionWiring\?\.tick\(\)/)
  assert.match(src, /attentionWiring\?\.dispose\(\)/)
})

run('S0 path not routed through whaleAct (approval/waiting_input direct)', () => {
  // whaleAct 只被 report/wave/sneak 调用；S0 由既有 say/status 直通
  const calls = src.match(/whaleAct\('([a-z]+)'\)/g) || []
  const keys = new Set(calls.map((c) => c.replace(/.*'([a-z]+)'.*/, '$1')))
  assert.deepEqual([...keys].sort(), ['report', 'sneak', 'wave'])
})

console.log(`attention-wiring contract tests: ${pass}/${pass + fail} pass`)
if (fail) process.exit(1)
