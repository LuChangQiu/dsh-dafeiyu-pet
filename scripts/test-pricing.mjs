/**
 * v47 分项计价单测（node scripts/test-pricing.mjs）。
 * 覆盖：usage 分项提取、缺字段/差额兜底、分项费用公式、旧口径对照、三本账按占比分摊、
 * 迁移日历史 token 拆分（合计不变）。
 */

import {
  usageParts,
  priceTable,
  costOf,
  flatCostOf,
  splitCost,
  legacyParts,
  DEFAULT_PRICING,
  LEGACY_MIX
} from '../plugin/server/lib/pricing.js'

const CASES = []
const near = (a, b, tol = 1e-9) => Math.abs(Number(a) - Number(b)) <= tol
const eq = (name, got, want) => CASES.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want })
const ok = (name, cond, detail = '') => CASES.push({ name, ok: !!cond, got: detail, want: 'truthy' })

// ── 1. usageParts：完整字段（DSH 实际形态）
const p1 = usageParts({
  inputTokens: 32186,
  outputTokens: 262,
  cacheReadTokens: 896,
  cacheWriteTokens: 0,
  totalTokens: 33344
})
eq('usageParts.full', p1, { input: 32186, output: 262, cacheRead: 896, cacheWrite: 0, total: 33344 })

// ── 2. usageParts：缺 total → 由分项相加
eq('usageParts.noTotal', usageParts({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 880 }), {
  input: 100,
  output: 20,
  cacheRead: 880,
  cacheWrite: 0,
  total: 1000
})

// ── 3. usageParts：只有 totalTokens（旧/未知 provider）→ 差额按输入价保守计入
eq('usageParts.totalOnly', usageParts({ totalTokens: 5000 }), {
  input: 5000,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  total: 5000
})

// ── 4. usageParts：分项和 > total → 分项可信
eq('usageParts.categoriesWin', usageParts({ inputTokens: 10, outputTokens: 5, totalTokens: 12 }), {
  input: 10,
  output: 5,
  cacheRead: 0,
  cacheWrite: 0,
  total: 15
})

// ── 5. usageParts：空/负数/字符串容错
eq('usageParts.empty', usageParts(null), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 })
eq('usageParts.junk', usageParts({ inputTokens: -5, outputTokens: 'x', cacheReadTokens: NaN }), {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  total: 0
})

// ── 6. priceTable 默认值与覆盖
eq('priceTable.defaults', priceTable(), {
  inputPerM: 2,
  outputPerM: 3,
  cacheReadPerM: 0.2,
  cacheWritePerM: 2,
  per1kTokens: 0.0015,
  currency: 'CNY'
})
eq('priceTable.override', priceTable({ inputPerM: 4, cacheReadPerM: 0.5 }).inputPerM, 4)
eq('priceTable.overrideCache', priceTable({ cacheReadPerM: 0.5 }).cacheReadPerM, 0.5)

// ── 7. 分项费用：1M 混合 token = input 100k + output 100k + cacheRead 800k
const parts = { input: 100000, output: 100000, cacheRead: 800000, cacheWrite: 0, total: 1000000 }
// 100k×2/1M=0.2 + 100k×3/1M=0.3 + 800k×0.2/1M=0.16 = 0.66 元
ok('costOf.mixed', near(costOf(parts, DEFAULT_PRICING), 0.66), String(costOf(parts, DEFAULT_PRICING)))

// ── 8. 缓存读多的会话：分项应显著低于旧口径
const cacheHeavy = { input: 1000000, output: 500000, cacheRead: 50000000, cacheWrite: 0, total: 51500000 }
const item = costOf(cacheHeavy, DEFAULT_PRICING)
const flat = flatCostOf(51500000, DEFAULT_PRICING)
ok('costOf.cacheHeavy < flat', item < flat && flat / item > 3, `item=${item.toFixed(4)} flat=${flat.toFixed(4)}`)

// ── 9. flatCostOf 公式
ok('flatCostOf.exact', near(flatCostOf(1000, { per1kTokens: 0.0015 }), 0.0015), String(flatCostOf(1000, {})))

// ── 10. splitCost：按占比分摊、和 = 总、4 位小数
const split = splitCost(1.515, 1003000, 1010000)
ok('splitCost.sum', near(split.user + split.agent, 1.515, 1e-9), JSON.stringify(split))
ok('splitCost.share', near(split.user, Math.round(1.515 * (1003000 / 1010000) * 10000) / 10000), JSON.stringify(split))
eq('splitCost.zeroTokens', splitCost(1.234, 0, 0), { user: 1.234, agent: 0 })
eq('splitCost.allUser', splitCost(2, 1000, 1000), { user: 2, agent: 0 })
eq('splitCost.outOfRange', splitCost(2, 5000, 1000), { user: 2, agent: 0 })

// ── 11. legacyParts：迁移日拆分合计不变、按典型缓存占比
const legacy = legacyParts(73195709)
ok(
  'legacyParts.sum',
  legacy.input + legacy.output + legacy.cacheRead + legacy.cacheWrite === 73195709,
  JSON.stringify(legacy)
)
ok('legacyParts.cacheDominant', legacy.cacheRead / legacy.total > 0.95, JSON.stringify(legacy))
ok('legacyParts.input', legacy.input === Math.round(73195709 * LEGACY_MIX.input), String(legacy.input))
const legacyCustom = legacyParts(1000000, { input: 0.5, output: 0.1, cacheRead: 0.4 })
eq('legacyParts.custom', legacyCustom, {
  input: 500000,
  output: 100000,
  cacheRead: 400000,
  cacheWrite: 0,
  total: 1000000
})

// ── 12. 真实样本回归（lead 主会话一条 usage）：成本量级合理
const real = usageParts({
  inputTokens: 260,
  outputTokens: 400,
  cacheReadTokens: 33792,
  cacheWriteTokens: 0,
  totalTokens: 34452
})
ok('costOf.realSamplePositive', costOf(real, DEFAULT_PRICING) > 0, String(costOf(real, DEFAULT_PRICING)))
ok(
  'costOf.realSampleBelowFlat',
  costOf(real, DEFAULT_PRICING) < flatCostOf(real.total, DEFAULT_PRICING),
  `${costOf(real, DEFAULT_PRICING)} vs ${flatCostOf(real.total, DEFAULT_PRICING)}`
)

// ── report
const failed = CASES.filter((c) => !c.ok)
for (const f of failed) console.error(`FAIL ${f.name}: got=${JSON.stringify(f.got)} want=${JSON.stringify(f.want)}`)
if (failed.length) {
  console.error(`\npricing tests: ${CASES.length - failed.length}/${CASES.length} passed, ${failed.length} failed`)
  process.exit(1)
}
console.log(`pricing tests: ${CASES.length}/${CASES.length} passed (itemized pricing / split / legacy migration)`)
