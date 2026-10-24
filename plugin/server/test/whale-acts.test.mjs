/**
 * CF1 单测：whale-acts.js 纯决策 + 白名单双文件一致性（无 DSH / 无 pipe / fake clock+rng）。
 * 运行：node --test plugin/server/test/whale-acts.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { loadWhitelist, shouldFire, nextSneakDecision, DEFAULT_WHALE_ACTS, WHITELIST_PATHS, normalizeWhaleActConfig } from '../lib/whale-acts.js'

const ALLOWED = new Set(['report', 'wave', 'sneak', 'pat', 'caught'])
const now = 1_800_000_000_000

const base = (over = {}) => ({
  now,
  cfg: structuredClone(DEFAULT_WHALE_ACTS),
  enabled: true,
  modeKind: 'active',
  quiet: false,
  petOnline: true,
  whitelist: ALLOWED,
  rng: () => 0,
  ...over
})

test('report：白天 active 正常触发', () => {
  assert.deepEqual(shouldFire(base({ key: 'report' })), { fire: true, reason: 'ok' })
})

test('report：quiet（23:30-08:00）suppressed', () => {
  assert.deepEqual(shouldFire(base({ key: 'report', quiet: true })), { fire: false, reason: 'quiet' })
})

test('wave：morning/reunion 替换模式（replaceClassicActs=true）可触发', () => {
  const cfg = structuredClone(DEFAULT_WHALE_ACTS)
  assert.equal(cfg.replaceClassicActs, true)
  assert.deepEqual(shouldFire(base({ key: 'wave', cfg })), { fire: true, reason: 'ok' })
})

test('wave：replaceClassicActs=false 的接线降级由契约测试覆盖（决策层不感知该开关）', () => {
  const cfg = structuredClone(DEFAULT_WHALE_ACTS)
  cfg.replaceClassicActs = false
  // 决策层只回答"该 key 本身能不能发"；false/kill switch 的"仅 classic"降级在 index 接线层
  assert.deepEqual(shouldFire(base({ key: 'wave', cfg })), { fire: true, reason: 'ok' })
})

test('sneak：idle 不足 15min suppressed', () => {
  assert.deepEqual(nextSneakDecision(base({ idleMs: 5 * 60000 })), { fire: false, reason: 'idle' })
})

test('sneak：idle 足够 + 概率注入 0 → 触发', () => {
  assert.deepEqual(nextSneakDecision(base({ idleMs: 16 * 60000 })), { fire: true, reason: 'ok' })
})

test('sneak：概率注入 1 > 0.15 → chance suppressed', () => {
  assert.deepEqual(nextSneakDecision(base({ idleMs: 16 * 60000, rng: () => 1 })), {
    fire: false,
    reason: 'chance'
  })
})

test('sneak：每日上限 2 次后 suppressed', () => {
  assert.deepEqual(nextSneakDecision(base({ idleMs: 16 * 60000, firedToday: 2 })), {
    fire: false,
    reason: 'daily-cap'
  })
})

test('sneak：60min 冷却内 suppressed', () => {
  assert.deepEqual(nextSneakDecision(base({ idleMs: 16 * 60000, lastAt: now - 30 * 60000 })), {
    fire: false,
    reason: 'cooldown'
  })
})

test('mode=focus/silent/off 全 suppressed', () => {
  for (const kind of ['focus', 'silent', 'off']) {
    assert.equal(shouldFire(base({ key: 'report', modeKind: kind })).reason, 'mode', kind)
  }
})

test('kill switch：whaleActs.enabled=false → 0 次（报告/挥手/偷吃全拒）', () => {
  const cfg = structuredClone(DEFAULT_WHALE_ACTS)
  cfg.enabled = false
  for (const key of ['report', 'wave', 'sneak']) {
    assert.deepEqual(shouldFire(base({ key, cfg, idleMs: 16 * 60000 })), { fire: false, reason: 'disabled' })
  }
})

test('actions.enabled=false → actions-off（kill switch 之外的第二道）', () => {
  assert.equal(shouldFire(base({ key: 'report', enabled: false })).reason, 'actions-off')
})

test('白名单非法值拒绝（note / 未知 key / 空 whitelist）', () => {
  assert.equal(shouldFire(base({ key: 'note' })).reason, 'whitelist')
  assert.equal(shouldFire(base({ key: 'steal' })).reason, 'whitelist')
  assert.equal(shouldFire(base({ key: 'report', whitelist: null })).reason, 'whitelist')
})

test('pet 离线 → pet-offline', () => {
  assert.equal(shouldFire(base({ key: 'report', petOnline: false })).reason, 'pet-offline')
})

test('同 state 连续触发 → same-state（与 act() noActionOnSameState 对齐）', () => {
  assert.deepEqual(shouldFire(base({ key: 'report', state: 'done', lastActionState: 'done' })), {
    fire: false,
    reason: 'same-state'
  })
})

test('CF1 事件驱动：noActionOnSameState=false 时同 state 仍可发（whaleAct 用法）', () => {
  assert.deepEqual(
    shouldFire(base({ key: 'report', state: 'done', lastActionState: 'done', noActionOnSameState: false })),
    { fire: true, reason: 'ok' }
  )
  assert.deepEqual(
    shouldFire(base({ key: 'wave', state: 'done', lastActionState: 'done', noActionOnSameState: false })),
    { fire: true, reason: 'ok' }
  )
})

test('每小时动作上限 → guard-cap', () => {
  assert.deepEqual(shouldFire(base({ key: 'report', actionsThisHour: 60, maxActionsPerHour: 60 })), {
    fire: false,
    reason: 'guard-cap'
  })
})

test('多条件优先级：whitelist 先于 mode/quiet/chance 判定', () => {
  const res = shouldFire(base({ key: 'note', modeKind: 'off', quiet: true, rng: () => 1 }))
  assert.equal(res.reason, 'whitelist')
})

test('loadWhitelist：优先 repo 真源，含 28 acts 且不含 note', () => {
  assert.equal(existsSync(WHITELIST_PATHS.repoJsonPath), true)
  const wl = loadWhitelist()
  assert.ok(wl && wl.source === 'repo')
  assert.equal(wl.acts.size, 28)
  assert.ok(wl.acts.has('report') && wl.acts.has('wave') && wl.acts.has('sneak'))
  assert.equal(wl.acts.has('note'), false)
})

test('loadWhitelist：随包副本与 repo 真源逐字节一致', () => {
  assert.equal(existsSync(WHITELIST_PATHS.bundleJsonPath), true, '缺随包副本：先跑 gen-act-fx-whitelist')
  const repoText = readFileSync(WHITELIST_PATHS.repoJsonPath, 'utf8')
  const bundleText = readFileSync(WHITELIST_PATHS.bundleJsonPath, 'utf8')
  assert.equal(bundleText, repoText)
})

test('loadWhitelist：repo 缺失 → 回退 bundle', () => {
  const wl = loadWhitelist({
    repoJsonPath: '/no/such/repo.json',
    bundleJsonPath: '/bundle.json',
    readFile: (p) => {
      if (p === '/bundle.json') return JSON.stringify({ acts: ['report'], fx: [] })
      throw new Error('ENOENT')
    }
  })
  assert.ok(wl && wl.source === 'bundle')
  assert.deepEqual([...wl.acts], ['report'])
})

test('loadWhitelist：两份都缺 → null（调用方禁用 whaleActs，不崩）', () => {
  const wl = loadWhitelist({
    repoJsonPath: '/no/repo.json',
    bundleJsonPath: '/no/bundle.json',
    readFile: () => {
      throw new Error('ENOENT')
    }
  })
  assert.equal(wl, null)
})

test('normalizeWhaleActConfig：局部配置保留嵌套默认（merge 只有一层）', () => {
  const cfg = normalizeWhaleActConfig({ sneak: { chance: 0.5 } })
  assert.equal(cfg.sneak.chance, 0.5)
  assert.equal(cfg.sneak.idleMinMs, 900000)
  assert.equal(cfg.sneak.checkEveryMs, 300000)
  assert.equal(cfg.sneak.maxPerDay, 2)
  assert.equal(cfg.enabled, true)
  assert.equal(cfg.replaceClassicActs, true)
})

test('normalizeWhaleActConfig：kill switch 保留', () => {
  const cfg = normalizeWhaleActConfig({ enabled: false })
  assert.equal(cfg.enabled, false)
})
