/**
 * whale-acts.js — CF1：鲸鱼娘 act 生产者的纯决策层（无 IO / 无 timer / 无 ctx）。
 *
 * 职责：
 *   1) 白名单加载（仅初始化读一次；热路径零 IO）→ Set，供决策函数注入；
 *   2) `shouldFire()/nextSneakDecision()`：按 CF1-WIRING-PLAN §4 的固定门禁顺序给出 {fire, reason}；
 *   3) 不做任何发送/日志/计时 —— index.js 负责把 fire=true 交给现有 `act()`（保留其 guard），并记录 reason。
 *
 * 门禁顺序（短路，reason 用于日志/测试断言）：
 *   disabled → actions-off → key-disabled → whitelist → mode → quiet → pet-offline
 *   → idle(sneak) → cooldown → daily-cap → same-state → guard-cap → chance → ok
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { modeAllowsAct } from './mode.js'

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url))

/** 白名单文件位置：唯一真源 = repo docs/generated；随包副本 = plugin/server/lib/generated/。 */
export const WHITELIST_PATHS = {
  repoJsonPath: path.resolve(LIB_DIR, '..', '..', '..', 'docs', 'generated', 'act-fx-whitelist.json'),
  bundleJsonPath: path.join(LIB_DIR, 'generated', 'act-fx-whitelist.json')
}

/** CF1 配置默认值（可被用户配置覆盖；kill switch = enabled:false）。 */
export const DEFAULT_WHALE_ACTS = {
  enabled: true,
  // OQ1=A：whale 支持下用 act:wave 替代 morning ritual 的 classic act:jump；
  //         用 act:report 替代 turn/end report 的 classic act:stretch（false=双发，仅备用）。
  replaceClassicActs: true,
  report: { enabled: true, chance: 1.0, cooldownMs: 300000 }, // 复用 report 自身 5 轮/5min 节流
  wave: { enabled: true, chance: 1.0, cooldownMs: 7200000 }, // 2h（事件本身稀有）
  sneak: {
    enabled: true,
    chance: 0.15,
    idleMinMs: 900000, // 15min 无事件才评估
    checkEveryMs: 300000, // 复用现有 20s idle tick 内的评估节流（每 5min 掷一次）
    cooldownMs: 3600000,
    maxPerDay: 2
  }
}

/**
 * 深合并一份 whaleActs 配置（merge() 只做一层展开，嵌套键需要补默认）。
 * @param {object} [raw]
 */
export function normalizeWhaleActConfig(raw = {}) {
  const out = { ...DEFAULT_WHALE_ACTS, ...(raw && typeof raw === 'object' ? raw : {}) }
  for (const key of ['report', 'wave', 'sneak']) {
    out[key] = { ...DEFAULT_WHALE_ACTS[key], ...((raw && raw[key]) || {}) }
  }
  return out
}

/**
 * 加载白名单（仅初始化调用一次）。
 * 优先 repo 真源，缺失回退随包副本；两份都缺 → null（调用方禁用 whaleActs + 记日志，不崩插件）。
 * @param {{repoJsonPath?:string, bundleJsonPath?:string, readFile?:(p:string)=>string}} [opts]
 * @returns {{acts:Set<string>, fx:Set<string>, source:'repo'|'bundle', path:string}|null}
 */
export function loadWhitelist(opts = {}) {
  const repoJsonPath = opts.repoJsonPath || WHITELIST_PATHS.repoJsonPath
  const bundleJsonPath = opts.bundleJsonPath || WHITELIST_PATHS.bundleJsonPath
  const readFile = opts.readFile || ((p) => fs.readFileSync(p, 'utf8'))
  const candidates = [
    ['repo', repoJsonPath],
    ['bundle', bundleJsonPath]
  ]
  for (const [source, file] of candidates) {
    try {
      const data = JSON.parse(readFile(file))
      if (Array.isArray(data?.acts) && data.acts.length) {
        return {
          acts: new Set(data.acts),
          fx: new Set(Array.isArray(data.fx) ? data.fx : []),
          source,
          path: file
        }
      }
    } catch {
      // 尝试下一个候选；都不行由调用方禁用
    }
  }
  return null
}

/**
 * 鲸鱼娘 act 是否该发（纯函数，可注入 clock/rng/whitelist，便于 fixture 复现）。
 * @returns {{fire:boolean, reason:string}}
 */
export function shouldFire(opts = {}) {
  const key = String(opts.key || '')
  const cfg = opts.cfg || DEFAULT_WHALE_ACTS
  const now = Number.isFinite(opts.now) ? opts.now : Date.now()
  const rng = typeof opts.rng === 'function' ? opts.rng : Math.random
  const keyCfg = cfg[key] || null

  if (!cfg || cfg.enabled === false) return { fire: false, reason: 'disabled' }
  if (opts.enabled === false) return { fire: false, reason: 'actions-off' }
  if (!opts.whitelist || !opts.whitelist.has(key)) return { fire: false, reason: 'whitelist' }
  if (!keyCfg || keyCfg.enabled === false) return { fire: false, reason: 'key-disabled' }
  if (!modeAllowsAct(String(opts.modeKind || 'active'), key)) return { fire: false, reason: 'mode' }
  if (opts.quiet === true) return { fire: false, reason: 'quiet' }
  if (opts.petOnline === false) return { fire: false, reason: 'pet-offline' }
  if (key === 'sneak' && Number(opts.idleMs || 0) < Number(keyCfg.idleMinMs || 0)) {
    return { fire: false, reason: 'idle' }
  }
  const lastAt = Number(opts.lastAt || 0)
  if (lastAt > 0 && now - lastAt < Number(keyCfg.cooldownMs || 0)) return { fire: false, reason: 'cooldown' }
  const firedToday = Number(opts.firedToday || 0)
  if (keyCfg.maxPerDay && firedToday >= Number(keyCfg.maxPerDay)) return { fire: false, reason: 'daily-cap' }
  // 与现有 act() 守卫对齐（只做决策解释，实际仍由 act() 兜底）：
  if (opts.noActionOnSameState !== false && opts.lastActionState && opts.lastActionState === opts.state) {
    return { fire: false, reason: 'same-state' }
  }
  const maxActionsPerHour = Number(opts.maxActionsPerHour || 0)
  if (maxActionsPerHour > 0 && Number(opts.actionsThisHour || 0) >= maxActionsPerHour) {
    return { fire: false, reason: 'guard-cap' }
  }
  const chance = Number.isFinite(keyCfg.chance) ? keyCfg.chance : 1
  if (rng() > chance) return { fire: false, reason: 'chance' }
  return { fire: true, reason: 'ok' }
}

/** sneak 专用：复用 shouldFire，补 key/idleMs。 */
export function nextSneakDecision(opts = {}) {
  return shouldFire({ ...opts, key: 'sneak' })
}
