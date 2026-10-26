// task-133：LLM 全事件化辅助（纯逻辑：kind→池映射、深夜/互动门、回退原因、统计）
// 说明：本模块不含 IO；index.js 的 generate() 负责调用 ctx.llm / 落日志 / 池兜底。

/** kind → 失败/预算/深夜兜底池名（与 index.js 的 EMBEDDED/pools 键一致）。 */
export const KIND_POOL = Object.freeze({
  turnStart: 'kaigong',
  turnEnd: 'shougong',
  turnEndBad: 'anwei',
  error: 'anwei',
  spike: 'anwei',
  approval: 'dengdai',
  waitingInput: 'dengdai',
  morning: 'kaigong',
  reunion: 'kaigong',
  sleep: 'shenye',
  selfTalk: 'ganhuo',
  inner: 'ganhuo',
  report: 'shougong',
  interactHead: 'ganhuo',
  interactFeed: 'ganhuo',
  interactCome: 'ganhuo',
  praise: 'ganhuo',
  sneakLine: 'ganhuo'
})

/** S0（安全例外）：深夜/免打扰仍允许生成，避免耽误用户。 */
export const S0_KINDS = new Set(['approval', 'waitingInput'])

/** 用户手动互动类：用户明确发起，允许绕过 mode 静音限制（仍受预算/时长保护）。 */
export const INTERACTIVE_KINDS = new Set(['interactHead', 'interactFeed', 'interactCome', 'praise'])

export const NIGHT_DEFAULTS = Object.freeze({ nightStartMin: 23 * 60 + 30, nightEndMin: 8 * 60 })

export const minutesOfDay = (date = new Date()) => date.getHours() * 60 + date.getMinutes()

export const isNightTime = (date = new Date(), opts = {}) => {
  const m = minutesOfDay(date)
  const start = Number.isFinite(opts.nightStartMin) ? opts.nightStartMin : NIGHT_DEFAULTS.nightStartMin
  const end = Number.isFinite(opts.nightEndMin) ? opts.nightEndMin : NIGHT_DEFAULTS.nightEndMin
  return m >= start || m < end
}

/**
 * 统一回退原因（用于日志 fallbackReason 与指标）。
 * @returns {'mode'|'night'|'budget'|'disabled'|'kind-cap'|'llm-unavailable'|'timeout'|'empty'|'invalid'|'duplicate'|null}
 */
export const fallbackReasonFor = (flags = {}) => {
  if (flags.modeBlocked) return 'mode'
  if (flags.nightBlocked) return 'night'
  if (flags.disabled) return 'disabled'
  if (flags.budgetExceeded) return 'budget'
  if (flags.kindCap) return 'kind-cap'
  if (flags.unavailable) return 'llm-unavailable'
  if (flags.timeout) return 'timeout'
  if (flags.empty) return 'empty'
  if (flags.invalid) return 'invalid'
  if (flags.duplicate) return 'duplicate'
  return null
}

const percentile = (sorted, p) => {
  if (!sorted.length) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[idx]
}

/** LLM 指标（进程内；日志/state 只输出数字与枚举，不含文本）。 */
export const createLlmStats = ({ maxSamples = 500 } = {}) => {
  const byKind = {}
  const fallbackReasons = {}
  const latencies = []
  let attempts = 0
  let ok = 0
  let fallback = 0
  let tokens = 0

  const record = ({ kind = '', source = 'pool', latencyMs = 0, tokens: t = 0, fallbackReason = null } = {}) => {
    attempts += 1
    byKind[kind] = byKind[kind] || { attempts: 0, llm: 0, pool: 0 }
    byKind[kind].attempts += 1
    if (source === 'llm') {
      ok += 1
      byKind[kind].llm += 1
      tokens += Number(t) || 0
      const ms = Math.max(0, Number(latencyMs) || 0)
      latencies.push(ms)
      if (latencies.length > maxSamples) latencies.shift()
    } else {
      fallback += 1
      byKind[kind].pool += 1
      const reason = fallbackReason || 'unknown'
      fallbackReasons[reason] = (fallbackReasons[reason] || 0) + 1
    }
  }

  const snapshot = () => {
    const sorted = [...latencies].sort((a, b) => a - b)
    const sum = sorted.reduce((a, b) => a + b, 0)
    return {
      attempts,
      ok,
      fallback,
      successRate: attempts ? Number((ok / attempts).toFixed(4)) : null,
      sourceShare: { llm: ok, pool: fallback },
      latencyMs: {
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        avg: sorted.length ? Math.round(sum / sorted.length) : 0
      },
      tokens,
      byKind: JSON.parse(JSON.stringify(byKind)),
      fallbackReasons: { ...fallbackReasons }
    }
  }

  return { record, snapshot }
}
