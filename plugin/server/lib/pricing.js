/**
 * v47 分项计价（估算）。
 *
 * DSH `assistant/message.data.usage` 字段口径（见 dsh-llm-deepseek 适配器）：
 *   inputTokens       未命中缓存的输入 token
 *   outputTokens      输出 token
 *   cacheReadTokens   缓存命中读取 token
 *   cacheWriteTokens  缓存写入 token（DeepSeek 恒 0）
 *   totalTokens       = 上述四者之和（适配器派生；也可能来自 provider 聚合值）
 *
 * 费用 = Σ 分项 token × 分项单价（元/百万 token）。默认单价按 DeepSeek 公开价假设：
 *   输入(未命中) 2 元/M、输出 3 元/M、缓存读取 0.2 元/M、缓存写入 2 元/M。
 * 全部为**估算**，可配置；与 `costYuanFlat = totalTokens/1000 × per1kTokens` 对照展示。
 *
 * 纯函数、无依赖：`lib/index.js` 与 `scripts/test-pricing.mjs` 共用。
 */

/** 默认价目表（元/百万 token）与旧版平铺单价（元/千 token）。 */
export const DEFAULT_PRICING = {
  inputPerM: 2,
  outputPerM: 3,
  cacheReadPerM: 0.2,
  cacheWritePerM: 2,
  per1kTokens: 0.0015,
  currency: 'CNY'
}

/**
 * v47 迁移日：v46 及更早只累计 tokens、没有分项。按典型 agent 长会话的缓存占比拆分
 * （缓存读约 98%），避免把历史 token 全按输入价→估算反而更高；次日按真实 usage 分项累计。
 */
export const LEGACY_MIX = { input: 0.01, output: 0.01, cacheRead: 0.98, cacheWrite: 0 }

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * 从 usage 提取分项；保证 categories 之和 ≈ totalTokens（total 多出的部分按输入价记，保守）。
 * @param {object} u usage 对象（缺字段按 0）
 * @returns {{input:number, output:number, cacheRead:number, cacheWrite:number, total:number}}
 */
export function usageParts(u) {
  const src = u || {}
  const input = num(src.inputTokens)
  const output = num(src.outputTokens)
  const cacheRead = num(src.cacheReadTokens)
  const cacheWrite = num(src.cacheWriteTokens)
  const sum = input + output + cacheRead + cacheWrite
  const totalRaw = num(src.totalTokens)
  const total = totalRaw > 0 ? totalRaw : sum
  const parts = { input, output, cacheRead, cacheWrite, total }
  if (total > sum)
    parts.input += total - sum // 未上报的差额按输入价保守计入
  else if (total < sum) parts.total = sum // 分项更可信
  return parts
}

/** 合并价目表（配置覆盖默认）。 */
export function priceTable(pricing) {
  const p = { ...DEFAULT_PRICING, ...(pricing || {}) }
  return {
    inputPerM: num(p.inputPerM),
    outputPerM: num(p.outputPerM),
    cacheReadPerM: num(p.cacheReadPerM),
    cacheWritePerM: num(p.cacheWritePerM),
    per1kTokens: num(p.per1kTokens),
    currency: String(p.currency || 'CNY')
  }
}

/** 分项费用（元，未四舍五入）。 */
export function costOf(parts, pricing) {
  const p = priceTable(pricing)
  const q = parts || {}
  return (
    (num(q.input) * p.inputPerM +
      num(q.output) * p.outputPerM +
      num(q.cacheRead) * p.cacheReadPerM +
      num(q.cacheWrite) * p.cacheWritePerM) /
    1e6
  )
}

/** 旧口径对照费用（元）：totalTokens/1000 × per1kTokens。 */
export function flatCostOf(totalTokens, pricing) {
  const p = priceTable(pricing)
  return (num(totalTokens) / 1000) * p.per1kTokens
}

/**
 * 三本账拆分：总估算按 token 占比分摊到 user/agent（四舍五入到 4 位，保证两者和 = 总）。
 * @returns {{user:number, agent:number}}
 */
export function splitCost(totalCostYuan, tokensUser, tokens) {
  const total = Math.round(num(totalCostYuan) * 10000) / 10000
  const t = num(tokens)
  const u = num(tokensUser)
  if (!(t > 0)) return { user: total, agent: 0 }
  const share = Math.max(0, Math.min(1, u / t))
  const user = Math.round(total * share * 10000) / 10000
  return { user, agent: Math.round((total - user) * 10000) / 10000 }
}

/**
 * 迁移日：把"只有总 token、没有分项"的历史量按典型缓存占比拆成四类，保持合计不变。
 * @returns {{input:number, output:number, cacheRead:number, cacheWrite:number, total:number}}
 */
export function legacyParts(totalTokens, mix = LEGACY_MIX) {
  const total = Math.round(num(totalTokens))
  const m = { ...LEGACY_MIX, ...(mix || {}) }
  const input = Math.round(total * num(m.input))
  const output = Math.round(total * num(m.output))
  const cacheWrite = Math.round(total * num(m.cacheWrite))
  const cacheRead = Math.max(0, total - input - output - cacheWrite)
  return { input, output, cacheRead, cacheWrite, total }
}
