/**
 * v48 team/goal/plan/userQuestions 映射单测（node scripts/test-team-view.mjs）。
 * fixtures：scripts/fixtures/team-view/*.json（tsk-57；task-66 起统一 fixtures 约定）。
 * 覆盖：活跃团队映射、空团队 progress=null、未注册/服务缺失降级、failure 降级、
 * 隐私（输出不含 subject/description/objective/writeScopes 原文）、sentCount 透传。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildTeamV2, emptyTeamV2 } from '../plugin/server/lib/team-view.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'team-view', name), 'utf8'))

const CASES = []
const eq = (name, got, want) => CASES.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want })
const ok = (name, cond, detail = '') => CASES.push({ name, ok: !!cond, got: detail, want: 'truthy' })

// ── 1. 活跃团队
const active = buildTeamV2({
  values: fixture('active.json'),
  services: { teams: true },
  sentCount: 2,
  now: 1792740000000
})
eq('active.team.enabled', active.team.enabled, true)
eq('active.team.status', active.team.status, 'ok')
eq('active.members', active.team.members, { total: 2, active: 1, failed: 1 })
eq('active.tasks.total', active.team.tasks.total, 4)
eq('active.tasks.pending', active.team.tasks.pending, 2)
eq('active.tasks.in_progress', active.team.tasks.in_progress, 1)
eq('active.tasks.completed', active.team.tasks.completed, 1)
eq('active.tasks.ready', active.team.tasks.ready, 1)
eq('active.tasks.blocked', active.team.tasks.blocked, 1)
eq('active.tasks.progress', active.team.tasks.progress, 0.25)
eq('active.goal', active.goal, { active: true, operation: 'create', status: 'active', roundsStarted: 3 })
eq('active.plan', active.plan, { active: true, pending: false })
eq('active.uq', active.userQuestions, { active: 1, sentCount: 2 })
eq('active.degraded', active.degraded, [])

// ── 2. 空团队：progress 必须是 null（不是 0）
const empty = buildTeamV2({ values: fixture('empty-team.json'), services: { teams: true }, sentCount: 0 })
eq('empty.team.enabled', empty.team.enabled, false)
eq('empty.team.status', empty.team.status, 'empty')
eq('empty.tasks.total', empty.team.tasks.total, 0)
eq('empty.tasks.progress', empty.team.tasks.progress, null)
eq('empty.goal', empty.goal, { active: false, operation: 'complete', status: 'complete', roundsStarted: 2 })
eq('empty.plan', empty.plan, { active: false, pending: false })

// ── 3. 未注册（投影 values 为空）+ 服务装载 → 全部 null + degraded 标注
const unsupported = buildTeamV2({ values: fixture('unsupported.json'), services: { teams: true }, sentCount: 0 })
eq('unsupported.team', unsupported.team, null)
eq('unsupported.goal', unsupported.goal, null)
eq('unsupported.plan', unsupported.plan, null)
eq('unsupported.uq', unsupported.userQuestions, null)
ok(
  'unsupported.degraded',
  unsupported.degraded.includes('team:not-registered') &&
    unsupported.degraded.includes('goal:not-registered') &&
    unsupported.degraded.includes('plan:not-registered') &&
    unsupported.degraded.includes('userQuestions:not-registered'),
  JSON.stringify(unsupported.degraded)
)

// ── 4. 服务未装载 → team:unsupported
const noService = buildTeamV2({ values: {}, services: { teams: false } })
ok('noService.degraded', noService.degraded.includes('team:unsupported'), JSON.stringify(noService.degraded))

// ── 5. 投影 failure → status=degraded + team:degraded
const degraded = buildTeamV2({ values: fixture('degraded.json'), services: { teams: true } })
eq('degraded.team.status', degraded.team.status, 'degraded')
eq('degraded.team.enabled', degraded.team.enabled, false)
ok('degraded.degradedFlag', degraded.degraded.includes('team:degraded'), JSON.stringify(degraded.degraded))

// ── 6. 隐私：输出不含原文/描述/目标/writeScopes（只计数）
const dumped = JSON.stringify(active)
for (const secret of ['secret', 'subject', 'description', 'objective', 'writeScopes', 'objectiveSummary', 'cwd']) {
  ok('privacy.no_' + secret, !dumped.includes(secret), secret)
}

// ── 7. 空态与非法输入不崩
const emptyState = emptyTeamV2('not-refreshed')
eq('emptyState.team', emptyState.team, null)
eq('emptyState.degraded', emptyState.degraded, ['not-refreshed'])
const junk = buildTeamV2({ values: { agentTeam: 'x', goal: 5, plan: [], userQuestions: 'y' }, services: {} })
eq('junk.team', junk.team, null)
ok('junk.degraded', junk.degraded.length >= 4, JSON.stringify(junk.degraded))
const noArgs = buildTeamV2()
ok('noArgs.noThrow', noArgs.team === null && Array.isArray(noArgs.degraded), JSON.stringify(noArgs.degraded))

const failed = CASES.filter((c) => !c.ok)
for (const f of failed) console.error(`FAIL ${f.name}: got=${JSON.stringify(f.got)} want=${JSON.stringify(f.want)}`)
if (failed.length) {
  console.error(`\nteam-view tests: ${CASES.length - failed.length}/${CASES.length} passed, ${failed.length} failed`)
  process.exit(1)
}
console.log(`team-view tests: ${CASES.length}/${CASES.length} passed (active/empty/unsupported/degraded/privacy)`)
