/**
 * v47 控制模式单测（node scripts/test-mode.mjs）。
 * 覆盖：kind 归一/别名、默认时长与恢复点（含 until 解析）、对外视图、命令解析（tech-scout 定稿名）、
 * 快捷键循环、行为门控矩阵（气泡/LLM/动作/走动/状态推送/环境音）。
 */

import {
  MODE_KINDS,
  normalizeKind,
  modeLabel,
  resolveResumeAt,
  untilToDuration,
  modeView,
  normalizeRequest,
  cycleKind,
  modeAllowsBubble,
  modeAllowsLlm,
  modeAllowsAct,
  modeAllowsAction,
  modeAllowsStatusPush,
  modeAllowsAmbient,
  DEFAULT_MODE_DEFAULTS
} from '../plugin/server/lib/mode.js'

const CASES = []
const eq = (name, got, want) => CASES.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want })
const ok = (name, cond, detail = '') => CASES.push({ name, ok: !!cond, got: detail, want: 'truthy' })

// ── 1. kind 归一与别名
eq('normalize.all', MODE_KINDS.map(normalizeKind), ['active', 'focus', 'silent', 'off'])
eq('normalize.quiet->silent', normalizeKind('quiet'), 'silent')
eq('normalize.still->focus', normalizeKind('still'), 'focus')
eq('normalize.upper', normalizeKind('FOCUS'), 'focus')
eq('normalize.unknown->active', normalizeKind('whatever'), 'active')
eq('normalize.empty->active', normalizeKind(''), 'active')
eq('label.focus', modeLabel('focus'), '专注')
eq('label.quiet', modeLabel('quiet'), '静一静')

// ── 2. 默认时长与恢复点（契约：focus 50min / silent 30min / off 到明早 8 点）
const now = new Date('2026-10-23T15:00:00+08:00')
const nowMs = now.getTime()
eq('resume.active=0', resolveResumeAt('active', DEFAULT_MODE_DEFAULTS, 0, now), 0)
eq('resume.focus=50m', resolveResumeAt('focus', DEFAULT_MODE_DEFAULTS, 0, now) - nowMs, 50 * 60 * 1000)
eq('resume.silent=30m', resolveResumeAt('silent', DEFAULT_MODE_DEFAULTS, 0, now) - nowMs, 30 * 60 * 1000)
eq('resume.explicit', resolveResumeAt('focus', DEFAULT_MODE_DEFAULTS, 1000, now) - nowMs, 1000)
const offMs = resolveResumeAt('off', DEFAULT_MODE_DEFAULTS, 0, now)
eq('resume.off->next08', new Date(offMs).getHours(), 8)
ok('resume.off.tomorrow', offMs > nowMs + 12 * 3600e3, new Date(offMs).toISOString())
const offMorning = new Date('2026-10-23T06:00:00+08:00')
eq('resume.off.before8->today8', new Date(resolveResumeAt('off', DEFAULT_MODE_DEFAULTS, 0, offMorning)).getHours(), 8)
// ui-config 覆盖 focusMinutes
eq('resume.focus.fromUiConfig', resolveResumeAt('focus', { focusMs: 90 * 60000 }, 0, now) - nowMs, 90 * 60000)

// ── 3. until 解析（mode-off）
eq('until.empty', untilToDuration('', now), 0)
eq('until.hm.today', untilToDuration('18:30', now) - 3.5 * 3600e3, 0)
eq('until.hm.tomorrow', untilToDuration('08:00', now) - 17 * 3600e3, 0)
ok('until.iso', untilToDuration('2026-10-23T20:00:00+08:00', now) === 5 * 3600e3)
eq('until.pastIso', untilToDuration('2026-10-22T20:00:00+08:00', now), 0)

// ── 4. 对外视图
eq('view.active', modeView({ kind: 'active' }, nowMs), {
  active: false,
  kind: 'active',
  label: '正常',
  remainMs: 0,
  resumeAt: null,
  since: null
})
const view = modeView({ kind: 'silent', resumeAt: nowMs + 60000, since: '2026-10-23T15:00:00.000Z' }, nowMs)
eq('view.silent.active', view.active, true)
eq('view.silent.remain', view.remainMs, 60000)
ok('view.silent.resumeAtIso', typeof view.resumeAt === 'string' && view.resumeAt.includes('T'))
eq('view.expired.remain0', modeView({ kind: 'focus', resumeAt: nowMs - 1 }, nowMs).remainMs, 0)

// ── 5. 命令解析（定稿：mode-silent/mode-focus/mode-off/mode-resume；旧名兼容）
eq('req.silent', normalizeRequest({ name: 'mode-silent' }), { kind: 'silent', durationMs: 30 * 60000, clear: false })
eq('req.silent.minutes', normalizeRequest({ name: 'mode-silent', minutes: 15 }).durationMs, 15 * 60000)
eq('req.focus', normalizeRequest({ name: 'mode-focus' }), { kind: 'focus', durationMs: 50 * 60000, clear: false })
eq('req.focus.ui', normalizeRequest({ name: 'mode-focus' }, { focusMinutes: 90 }).durationMs, 90 * 60000)
eq('req.off.until', normalizeRequest({ name: 'mode-off', until: '20:00' }).kind, 'off')
ok('req.off.untilDuration', normalizeRequest({ name: 'mode-off', until: '20:00' }).durationMs > 0)
eq('req.off.default', normalizeRequest({ name: 'mode-off' }), { kind: 'off', durationMs: 0, clear: false })
eq('req.resume', normalizeRequest({ name: 'mode-resume' }), { kind: 'active', durationMs: 0, clear: true })
eq('req.legacy.mode-set', normalizeRequest({ name: 'mode-set', kind: 'focus', durationMs: 3600000 }), {
  kind: 'focus',
  durationMs: 3600000,
  clear: false
})
eq('req.legacy.mode-clear', normalizeRequest({ name: 'mode-clear' }), { kind: 'active', durationMs: 0, clear: true })
eq('req.cycle', normalizeRequest({ name: 'mode-cycle', current: 'active' }).kind, 'focus')
eq('req.unknown', normalizeRequest({ name: 'foo' }), null)

// ── 6. 快捷键循环
eq('cycle.fromActive', cycleKind('active'), 'focus')
eq('cycle.fromFocus', cycleKind('focus'), 'silent')
eq('cycle.fromSilent', cycleKind('silent'), 'off')
eq('cycle.fromOff', cycleKind('off'), 'active')

// ── 7. 气泡门控（silent/focus 保留 S0；off 全禁）
ok('bubble.active', modeAllowsBubble('active', 'turnEnd', false))
ok('bubble.focus.turnEnd.blocked', !modeAllowsBubble('focus', 'turnEnd', false))
ok('bubble.focus.approval', modeAllowsBubble('focus', 'approval', false))
ok('bubble.silent.waitingInput', modeAllowsBubble('silent', 'waitingInput', false))
ok('bubble.silent.urgent', modeAllowsBubble('silent', 'report', true))
ok('bubble.off.approval.blocked', !modeAllowsBubble('off', 'approval', true))

// ── 8. LLM 门控（focus/silent 只服务 S0）
ok('llm.active', modeAllowsLlm('active', 'turnStart'))
ok('llm.focus.turnStart.blocked', !modeAllowsLlm('focus', 'turnStart'))
ok('llm.focus.approval', modeAllowsLlm('focus', 'approval'))
ok('llm.silent.waitingInput', modeAllowsLlm('silent', 'waitingInput'))
ok('llm.off.blocked', !modeAllowsLlm('off', 'approval'))

// ── 9. 动作门控（focus 仅最小幅度动作）
ok('act.active.any', modeAllowsAct('active', 'jump'))
ok('act.focus.sway', modeAllowsAct('focus', 'sway'))
ok('act.focus.peek', modeAllowsAct('focus', 'peek'))
ok('act.focus.jump.blocked', !modeAllowsAct('focus', 'jump'))
ok('act.focus.spin.blocked', !modeAllowsAct('focus', 'spin'))
ok('act.silent.blocked', !modeAllowsAct('silent', 'sway'))
ok('act.off.blocked', !modeAllowsAct('off', 'sway'))

// ── 10. 走动 / 状态推送 / 环境音
ok('action.active', modeAllowsAction('active'))
ok('action.focus.blocked', !modeAllowsAction('focus'))
ok('status.active', modeAllowsStatusPush('active'))
ok('status.focus', modeAllowsStatusPush('focus'))
ok('status.silent.blocked', !modeAllowsStatusPush('silent'))
ok('status.off.blocked', !modeAllowsStatusPush('off'))
ok('ambient.active', modeAllowsAmbient('active'))
ok('ambient.focus.blocked', !modeAllowsAmbient('focus'))

// ── report
const failed = CASES.filter((c) => !c.ok)
for (const f of failed) console.error(`FAIL ${f.name}: got=${JSON.stringify(f.got)} want=${JSON.stringify(f.want)}`)
if (failed.length) {
  console.error(`\nmode tests: ${CASES.length - failed.length}/${CASES.length} passed, ${failed.length} failed`)
  process.exit(1)
}
console.log(`mode tests: ${CASES.length}/${CASES.length} passed (kind/expiry/view/commands/cycle/gates)`)
