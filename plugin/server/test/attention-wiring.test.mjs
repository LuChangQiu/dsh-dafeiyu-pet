// attention-wiring 单测：默认关零副作用 / gate / S0 / quiet / ignore 近似 / 清盘节流 / 真实 whale-acts 组合
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createAttentionWiring, DEFAULT_ATTENTION_WIRING_CONFIG } from '../lib/attention-wiring.js'
import { deserializeBudgetState } from '../lib/attention-budget.js'
import { shouldFire, DEFAULT_WHALE_ACTS, loadWhitelist } from '../lib/whale-acts.js'

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
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'attention-wiring-'))
const cleanup = (dir) => {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {}
}

run('default config disabled: zero side effects (no read/write/gate call-through)', () => {
  assert.equal(DEFAULT_ATTENTION_WIRING_CONFIG.enabled, false)
  const dir = tmpDir()
  try {
    const stateFile = path.join(dir, 'attention-budget.json')
    let reads = 0
    const w = createAttentionWiring({
      config: {},
      readState: () => {
        reads++
        return null
      }
    })
    assert.equal(w.enabled, false)
    assert.equal(w.reason, 'disabled-by-config')
    assert.equal(w.gate().allowed, true)
    assert.equal(w.gate({ isS0: false }).reason, 'disabled')
    w.recordProactive({ kind: 'report' })
    w.noteInteraction()
    w.tick()
    w.dispose()
    assert.equal(reads, 0)
    assert.equal(fs.existsSync(stateFile), false)
    assert.equal(w.getState(), null)
  } finally {
    cleanup(dir)
  }
})

run('enabled: gate allows within budget, blocks after 3, persists state file', () => {
  const dir = tmpDir()
  try {
    const stateFile = path.join(dir, 'attention-budget.json')
    let t = 1000000
    const w = createAttentionWiring({
      config: { attentionBudget: { enabled: true, stateFile, persistMs: 0 } },
      now: () => t,
      mode: () => 'active'
    })
    assert.equal(w.enabled, true)
    assert.equal(w.gate({ kind: 'report' }).allowed, true)
    for (let i = 0; i < 3; i++) {
      assert.equal(w.recordProactive({ kind: 'report', nowMs: t }).ok, true)
      t += 1000
    }
    const blocked = w.gate({ kind: 'report' })
    assert.equal(blocked.allowed, false)
    assert.equal(blocked.reason, 'budget')
    const saved = deserializeBudgetState(fs.readFileSync(stateFile, 'utf8'), { nowMs: t })
    assert.equal(saved.proactiveUsed, 3)
    assert.ok(saved.topicSalt)
    w.dispose()
  } finally {
    cleanup(dir)
  }
})

run('S0 straight-through: allowed even when budget exhausted', () => {
  const dir = tmpDir()
  try {
    const w = createAttentionWiring({
      config: { attentionBudget: { enabled: true, stateFile: path.join(dir, 'ab.json'), persistMs: 0 } },
      now: () => 100000,
      mode: () => 'active'
    })
    for (let i = 0; i < 3; i++) w.recordProactive({ kind: 'report' })
    assert.equal(w.gate({ kind: 'report' }).allowed, false)
    const s0 = w.gate({ kind: 'approval', isS0: true })
    assert.equal(s0.allowed, true)
    assert.equal(s0.reason, 's0')
    w.dispose()
  } finally {
    cleanup(dir)
  }
})

run('quiet mode + interaction clear', () => {
  const dir = tmpDir()
  try {
    let t = 100000
    const w = createAttentionWiring({
      config: { attentionBudget: { enabled: true, stateFile: path.join(dir, 'ab.json'), persistMs: 0 } },
      now: () => t
    })
    w.noteQuiet({ nowMs: t })
    assert.equal(w.gate({ kind: 'wave' }).reason, 'rejection-pause')
    t += 1000
    w.noteInteraction({ nowMs: t })
    assert.equal(w.gate({ kind: 'wave' }).allowed, true)
    w.dispose()
  } finally {
    cleanup(dir)
  }
})

run('ignore heuristic: proactive sent + 60s no interaction → ignored; 2nd → pause', () => {
  const dir = tmpDir()
  try {
    let t = 1000000
    const w = createAttentionWiring({
      config: {
        attentionBudget: { enabled: true, stateFile: path.join(dir, 'ab.json'), persistMs: 0, ignoreAfterSec: 60 }
      },
      now: () => t
    })
    w.recordProactive({ kind: 'greet', nowMs: t })
    t += 61000
    w.tick({ nowMs: t })
    assert.equal(w.getState().rejection.count, 1)
    assert.equal(w.gate({ kind: 'greet' }).allowed, true, 'first ignored does not pause yet')
    w.recordProactive({ kind: 'greet', nowMs: t })
    t += 61000
    w.tick({ nowMs: t })
    assert.equal(w.getState().rejection.count, 2)
    assert.equal(w.getState().rejection.kind, 'ignored')
    assert.equal(w.gate({ kind: 'greet' }).reason, 'rejection-pause')
    // 用户互动 → 清零
    w.noteInteraction({ nowMs: t + 1000 })
    assert.equal(w.gate({ kind: 'greet' }).allowed, true)
    w.dispose()
  } finally {
    cleanup(dir)
  }
})

run('ignore heuristic: interaction within window prevents ignored', () => {
  const dir = tmpDir()
  try {
    let t = 1000000
    const w = createAttentionWiring({
      config: {
        attentionBudget: { enabled: true, stateFile: path.join(dir, 'ab.json'), persistMs: 0, ignoreAfterSec: 60 }
      },
      now: () => t
    })
    w.recordProactive({ kind: 'idle_skit', nowMs: t })
    t += 30000
    w.noteInteraction({ nowMs: t })
    t += 40000
    w.tick({ nowMs: t })
    assert.equal(w.getState().rejection.count, 0)
    w.dispose()
  } finally {
    cleanup(dir)
  }
})

run('persistence throttle: writes coalesced then flushed on dispose', () => {
  const dir = tmpDir()
  try {
    const stateFile = path.join(dir, 'ab.json')
    let t = 1000000
    const w = createAttentionWiring({
      config: { attentionBudget: { enabled: true, stateFile, persistMs: 30000 } },
      now: () => t
    })
    w.recordProactive({ kind: 'report', nowMs: t }) // 首次写
    const first = fs.readFileSync(stateFile, 'utf8')
    t += 1000
    w.recordProactive({ kind: 'report', nowMs: t }) // 节流内不写
    assert.equal(fs.readFileSync(stateFile, 'utf8'), first)
    t += 31000
    w.tick({ nowMs: t }) // 超过节流 → 落盘
    const third = deserializeBudgetState(fs.readFileSync(stateFile, 'utf8'), { nowMs: t })
    assert.equal(third.proactiveUsed, 2)
    t += 1000
    w.recordProactive({ kind: 'report', nowMs: t })
    w.dispose({ nowMs: t })
    const finalState = deserializeBudgetState(fs.readFileSync(stateFile, 'utf8'), { nowMs: t })
    assert.equal(finalState.proactiveUsed, 3)
  } finally {
    cleanup(dir)
  }
})

run('topic privacy in wiring: raw topic never in state file', () => {
  const dir = tmpDir()
  try {
    const stateFile = path.join(dir, 'ab.json')
    let t = 1000000
    const w = createAttentionWiring({
      config: {
        attentionBudget: { enabled: true, stateFile, persistMs: 0, topic: '用户原话秘密' }
      },
      now: () => t
    })
    w.recordProactive({ kind: 'report', nowMs: t })
    t += 61000
    w.tick({ nowMs: t }) // 触发 ignored → topic 落 hash
    const raw = fs.readFileSync(stateFile, 'utf8')
    assert.equal(raw.includes('用户原话秘密'), false)
    const st = JSON.parse(raw)
    assert.match(st.topicSalt, /^[a-f0-9]{32,64}$/)
    assert.match(st.rejection.topicKey, /^[a-f0-9]{16}$/)
    w.dispose()
  } finally {
    cleanup(dir)
  }
})

run('real whale-acts combined: shouldFire ok + budget gates 4th proactive', () => {
  const dir = tmpDir()
  try {
    const whitelistInfo = loadWhitelist()
    assert.ok(whitelistInfo && whitelistInfo.acts)
    const whitelist = whitelistInfo.acts
    let t = 1000000
    const w = createAttentionWiring({
      config: { attentionBudget: { enabled: true, stateFile: path.join(dir, 'ab.json'), persistMs: 0 } },
      now: () => t
    })
    const evaluate = (key) => {
      const fire = shouldFire({
        key,
        now: t,
        cfg: DEFAULT_WHALE_ACTS,
        enabled: true,
        modeKind: 'active',
        quiet: false,
        petOnline: true,
        lastAt: 0,
        firedToday: 0,
        idleMs: 3600000,
        whitelist,
        state: 'done',
        lastActionState: null,
        noActionOnSameState: false,
        actionsThisHour: 0,
        maxActionsPerHour: 60,
        rng: () => 0
      })
      if (!fire.fire) return { fired: false, reason: fire.reason }
      const g = w.gate({ kind: key, isS0: false, isReaction: false, nowMs: t })
      if (!g.allowed) return { fired: false, reason: 'attention:' + g.reason }
      w.recordProactive({ kind: key, nowMs: t })
      return { fired: true, reason: fire.reason }
    }
    assert.equal(evaluate('report').fired, true)
    assert.equal(evaluate('wave').fired, true)
    assert.equal(evaluate('sneak').fired, true)
    const fourth = evaluate('report')
    assert.equal(fourth.fired, false)
    assert.match(fourth.reason, /^attention:budget$/)
    w.dispose()
  } finally {
    cleanup(dir)
  }
})

console.log(`attention-wiring tests: ${pass}/${pass + fail} pass`)
if (fail) process.exit(1)
