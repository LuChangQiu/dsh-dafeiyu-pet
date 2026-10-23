/**
 * v46 工具类型分类（9 类 + job 子类）。
 *
 * 纯函数、无依赖：`lib/index.js`（状态通道/动作映射）与 `scripts/test-tool-types.mjs`（单测）共用。
 * 判定顺序固定（单测有顺序用例，不要随意调整）：
 *   1. `mcp__` 前缀：白名单 `codegraph|context7|understand*` → `knowledge`，其余 `mcp__*` → `mcp`
 *   2. plan：todo_write / create_goal / get_goal / update_goal / update_plan / plan / taskboard / ask_user_question
 *   3. knowledge：memory / skill / context / compact / knowledge / remember（前缀）
 *   4. agent：subagent / team / send_message / workflow / ralph / spawn_*（前缀）
 *   5. `job_*` → `unknown` + `subkind='job'`（后台作业不是工具语义分类，单列子类）
 *   6. search：web_search / web_fetch / search / grep / glob（非 mcp；前缀）
 *   7. write：write / edit / patch / apply_patch / create_file / rename（前缀）
 *   8. command：bash / pwsh / exec / shell / run / terminal / process（前缀）
 *   9. read：read / list / open / view / cat / get_file / read_file（前缀）
 *  10. 其余（含空名）→ `unknown`
 */

/** 9 类工具类型（顺序即业务枚举顺序，供面板/文档引用）。 */
export const TOOL_TYPES = ['read', 'write', 'command', 'search', 'plan', 'knowledge', 'agent', 'mcp', 'unknown']

/** mcp__ 白名单：知识检索类 MCP（codegraph/context7/understand*）归 knowledge。 */
const MCP_KNOWLEDGE_RE = /^mcp__(?:codegraph|context7|understand)/i
const MCP_RE = /^mcp__/i

/** plan 工具按精确名匹配（避免 ask_* / task* 之类前缀误伤）。 */
const PLAN_TOOLS = new Set([
  'todo_write',
  'create_goal',
  'get_goal',
  'update_goal',
  'update_plan',
  'plan',
  'taskboard',
  'ask_user_question'
])

/** job_* 之前的前缀规则：knowledge → agent（顺序敏感）。 */
const PRE_JOB_RULES = [
  ['knowledge', /^(?:memory|skill|context|compact|knowledge|remember)/i],
  ['agent', /^(?:subagent|team|send_message|workflow|ralph|spawn_)/i]
]

/** job_* 之后的前缀规则：search → write → command → read（顺序敏感）。 */
const POST_JOB_RULES = [
  ['search', /^(?:web_search|web_fetch|search|grep|glob)/i],
  ['write', /^(?:write|edit|patch|apply_patch|create_file|rename)/i],
  ['command', /^(?:bash|pwsh|exec|shell|run|terminal|process)/i],
  ['read', /^(?:read|list|open|view|cat|get_file|read_file)/i]
]

/**
 * 把工具名归类为 9 类之一。
 * @param {unknown} name 工具名（`d.tool` / `d.name`），大小写不敏感。
 * @returns {{ type: string, subkind: string|null }} type ∈ TOOL_TYPES；job_* 的 subkind='job'，其余 null。
 */
export function toolTypeOf(name) {
  const n = String(name ?? '').trim()
  if (!n) return { type: 'unknown', subkind: null }
  // 1. MCP 优先：mcp__ 白名单 → knowledge，其余 mcp__* → mcp
  if (MCP_KNOWLEDGE_RE.test(n)) return { type: 'knowledge', subkind: null }
  if (MCP_RE.test(n)) return { type: 'mcp', subkind: null }
  // 2. plan（精确名）
  if (PLAN_TOOLS.has(n.toLowerCase())) return { type: 'plan', subkind: null }
  // 3-4. knowledge / agent（前缀）
  for (const [type, re] of PRE_JOB_RULES) if (re.test(n)) return { type, subkind: null }
  // 5. job_*（在 agent 之后、search 之前判定，与规格顺序一致）：unknown + subkind=job
  if (/^job_/i.test(n)) return { type: 'unknown', subkind: 'job' }
  // 6-9. search / write / command / read（前缀）
  for (const [type, re] of POST_JOB_RULES) if (re.test(n)) return { type, subkind: null }
  // 10. 其余
  return { type: 'unknown', subkind: null }
}
