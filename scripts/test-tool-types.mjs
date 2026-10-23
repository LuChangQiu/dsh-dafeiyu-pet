/**
 * v46 工具类型分类单测（node scripts/test-tool-types.mjs）。
 *
 * 覆盖：9 类全部示例、判定顺序（mcp 白名单 > read/write；plan > agent；job_* > read）、
 * 大小写不敏感、空值 / 未知名兜底、以及 9 类枚举全覆盖。
 * 退出码：0 = 全过；1 = 有失败（CI/verifier 可直接跑）。
 */

import { toolTypeOf, TOOL_TYPES } from '../plugin/server/lib/tool-types.js'

/** [工具名, 期望 type, 期望 subkind?] */
const CASES = [
  // ── 1. mcp__ 白名单 → knowledge；其余 mcp__* → mcp ──
  ['mcp__codegraph__codegraph_explore', 'knowledge'],
  ['mcp__codegraph__codegraph_search', 'knowledge'],
  ['mcp__context7__query-docs', 'knowledge'],
  ['mcp__context7__resolve-library-id', 'knowledge'],
  ['mcp__understand__understand-chat', 'knowledge'],
  ['mcp__understand-knowledge__analyze', 'knowledge'],
  ['mcp__datagrip__execute_sql_query', 'mcp'],
  ['mcp__chrome-devtools__click', 'mcp'],
  ['mcp__idea__search_symbol', 'mcp'],

  // ── 2. plan（精确名） ──
  ['todo_write', 'plan'],
  ['create_goal', 'plan'],
  ['get_goal', 'plan'],
  ['update_plan', 'plan'],
  ['plan', 'plan'],
  ['taskboard', 'plan'],
  ['ask_user_question', 'plan'],
  ['update_goal', 'plan'], // goal 家族（create/get 的姊妹工具）

  // ── 3. knowledge（前缀） ──
  ['memory', 'knowledge'],
  ['memory_manager_list', 'knowledge'],
  ['memory_manager_save', 'knowledge'],
  ['skill', 'knowledge'],
  ['context', 'knowledge'],
  ['compact', 'knowledge'],
  ['knowledge_search', 'knowledge'],
  ['remember_this', 'knowledge'],

  // ── 4. agent（前缀） ──
  ['subagent', 'agent'],
  ['subagent_fork', 'agent'],
  ['subagent_codex', 'agent'],
  ['team_task_create', 'agent'],
  ['team_task_update', 'agent'],
  ['send_message', 'agent'],
  ['workflow', 'agent'],
  ['ralph', 'agent'],
  ['spawn_teammate', 'agent'],

  // ── 5. job_* → unknown + subkind=job ──
  ['job_list', 'unknown', 'job'],
  ['job_output', 'unknown', 'job'],
  ['job_kill', 'unknown', 'job'],

  // ── 6. search（非 mcp，前缀） ──
  ['web_search', 'search'],
  ['web_fetch', 'search'],
  ['search', 'search'],
  ['grep', 'search'],
  ['glob', 'search'],

  // ── 7. write（前缀） ──
  ['write', 'write'],
  ['edit', 'write'],
  ['patch', 'write'],
  ['apply_patch', 'write'],
  ['create_file', 'write'],
  ['rename', 'write'],

  // ── 8. command（前缀） ──
  ['bash', 'command'],
  ['pwsh', 'command'],
  ['exec', 'command'],
  ['shell', 'command'],
  ['run', 'command'],
  ['terminal_send', 'command'],
  ['terminal_read', 'command'],
  ['process', 'command'],

  // ── 9. read（前缀） ──
  ['read', 'read'],
  ['read_file', 'read'],
  ['list', 'read'],
  ['open', 'read'],
  ['view', 'read'],
  ['cat', 'read'],
  ['get_file', 'read'],

  // ── 10. unknown / 空值兜底 ──
  ['foo', 'unknown'],
  ['unknown_tool', 'unknown'],
  ['plan_extra', 'unknown'], // plan 为精确匹配，前缀不算
  ['agent_status', 'unknown'], // agent 不是前缀规则
  ['', 'unknown'],
  ['   ', 'unknown'],
  [null, 'unknown'],
  [undefined, 'unknown'],

  // ── 顺序校验（同样的名字若命中不同规则，必须按规格顺序取先者） ──
  ['mcp__codegraph__read_file', 'knowledge'], // mcp 白名单 > read
  ['mcp__datagrip__read_file', 'mcp'], // mcp > read
  ['mcp__codegraph__write', 'knowledge'], // mcp 白名单 > write
  ['mcp__chrome-devtools__click', 'mcp'], // mcp > 其它前缀
  ['ask_user_question', 'plan'], // plan > agent（旧规则 ^ask 误判为 agent）
  ['taskboard', 'plan'], // plan > agent（旧规则 ^task 误判为 agent）
  ['team_task_create', 'agent'], // agent 前缀，不是 plan
  ['job_read', 'unknown', 'job'], // job > read
  ['job_search', 'unknown', 'job'], // job > search
  ['MCP__CODEGRAPH__X', 'knowledge'], // 大小写不敏感
  ['Todo_Write', 'plan'], // 大小写不敏感（plan 精确名）
  ['WEB_SEARCH', 'search'] // 大小写不敏感（前缀）
]

let pass = 0
const failures = []
for (const [name, wantType, wantSub] of CASES) {
  const got = toolTypeOf(name)
  const gotSub = got.subkind ?? null
  const ok = got.type === wantType && gotSub === (wantSub ?? null)
  if (ok) pass += 1
  else failures.push({ name, wantType, wantSub: wantSub ?? null, got })
}

// 9 类枚举必须全部被覆盖到（避免规则表/用例漏类）
const failedNames = new Set(failures.map((f) => f.name))
const covered = new Set(CASES.filter(([name]) => !failedNames.has(name)).map(([, type]) => type))
const missingTypes = TOOL_TYPES.filter((t) => !covered.has(t))
if (missingTypes.length)
  failures.push({ name: '<enum coverage>', wantType: missingTypes.join(','), got: { type: 'missing' } })

if (failures.length) {
  for (const f of failures) {
    console.error(
      `FAIL ${String(f.name)} → got ${f.got.type}${f.got.subkind ? '/' + f.got.subkind : ''}, ` +
        `want ${f.wantType}${f.wantSub ? '/' + f.wantSub : ''}`
    )
  }
  console.error(`\ntool-type tests: ${pass}/${CASES.length} passed, ${failures.length} failed`)
  process.exit(1)
}
console.log(`tool-type tests: ${pass}/${CASES.length} passed (order + enum coverage OK)`)
