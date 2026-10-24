/**
 * v49.1 文案清洗单测（node scripts/test-text-fmt.mjs）。
 * 回归用例：旧版拼接 `…没走。，上次在thinking` 必须变成 `…没走，上次在想事情。`
 */

import { tidySpeech, activityLabelZh, composeReunion, appendClause } from '../plugin/server/lib/text-fmt.js'

const CASES = []
const eq = (name, got, want) => CASES.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want })
const ok = (name, cond, detail = '') => CASES.push({ name, ok: !!cond, got: detail, want: 'truthy' })

// ── 1. tidySpeech：去尾标点/空白
eq('tidy.period', tidySpeech('你回来啦。'), '你回来啦')
eq('tidy.mixed', tidySpeech('你回来啦。，'), '你回来啦')
eq('tidy.ellipsis', tidySpeech('你回来啦……'), '你回来啦')
eq('tidy.space', tidySpeech('  你 回来啦  '), '你 回来啦')
eq('tidy.empty', tidySpeech(null), '')

// ── 2. 活动标签中文化（不泄英文/工具名）
eq('label.thinking', activityLabelZh('thinking'), '想事情')
eq('label.tool', activityLabelZh('tool'), '忙手上的活')
eq('label.read', activityLabelZh('read'), '翻文件')
eq('label.upper', activityLabelZh('COMMAND'), '跑命令')
eq('label.prefixed', activityLabelZh('unknown:thinking'), '想事情')
eq('label.unknownEn', activityLabelZh('weirdtool'), '忙别的')
eq('label.unknownNull', activityLabelZh(null), '')
eq('label.chineseKept', activityLabelZh('在写文档'), '在写文档')

// ── 3. composeReunion（回归 bug：`…没走。，上次在thinking`）
eq(
  'reunion.regression',
  composeReunion('你回来啦…我还以为要等很久。', 'thinking'),
  '你回来啦…我还以为要等很久，上次在想事情。'
)
eq('reunion.noLabel', composeReunion('你回来啦。', ''), '你回来啦。')
eq('reunion.noBase', composeReunion('', 'read'), '上次在翻文件。')
eq('reunion.bothEmpty', composeReunion('', ''), '')
const dirty = composeReunion('……没走。', 'thinking')
ok('reunion.noDoublePunct', !/[。！？…]，/.test(dirty), dirty)
ok('reunion.noEnglishLabel', !/[a-zA-Z]/.test(dirty), dirty)

// ── 4. appendClause
eq('clause.both', appendClause('收工了。', '今天用了 3 碗白饭'), '收工了，今天用了 3 碗白饭。')
eq('clause.emptyClause', appendClause('收工了。', ''), '收工了。')

const failed = CASES.filter((c) => !c.ok)
for (const f of failed) console.error(`FAIL ${f.name}: got=${JSON.stringify(f.got)} want=${JSON.stringify(f.want)}`)
if (failed.length) {
  console.error(`\ntext-fmt tests: ${CASES.length - failed.length}/${CASES.length} passed, ${failed.length} failed`)
  process.exit(1)
}
console.log(`text-fmt tests: ${CASES.length}/${CASES.length} passed (reunion punctuation/label regression)`)
