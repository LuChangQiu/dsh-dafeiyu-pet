// task-104 切片2：state-machine 纯函数（无 IO/无 timer/无随机）
// 消费 config/state-map.json：事件 → state/subkind/计数/优先级/minDwell/TTL
const classifyTool = (name, rules) => {
  const n = String(name || '')
  const has = (arr) => Array.isArray(arr) && arr.some((p) => p && n.startsWith(p))
  if (has(rules.mcpKnowledgePrefixes)) return 'knowledge'
  if (rules.mcpPrefix && n.startsWith(rules.mcpPrefix)) return 'mcp'
  if (Array.isArray(rules.planTools) && rules.planTools.includes(n)) return 'plan'
  if (has(rules.knowledgePrefixes)) return 'knowledge'
  if (has(rules.agentPrefixes)) return 'agent'
  if (Array.isArray(rules.jobTools) && has(rules.jobTools)) return 'job'
  if (has(rules.searchPrefixes)) return 'search'
  if (has(rules.writePrefixes)) return 'write'
  if (has(rules.commandPrefixes)) return 'command'
  if (has(rules.readPrefixes)) return 'read'
  return 'unknown'
}
export function createStateMachine({
  stateMap,
  now = () => Date.now(),
  mode = () => 'normal',
  rng = Math.random
} = {}) {
  if (!stateMap || !stateMap.states || !stateMap.events) throw new Error('state-map missing')
  const states = stateMap.states
  const events = stateMap.events
  const timing = stateMap.timing || {}
  const priorityTable = stateMap.priority || {}
  let current = 'idle'
  let subkind = null
  let since = now()
  const counters = { turn: 0, tool: 0, approval: 0, retry: 0, toolTypes: {} }
  let lastToolClass = null

  const stateDef = (name) => states[name] || null
  const priorityOf = (name) => (stateDef(name) && Number(stateDef(name).priority)) || priorityTable.E2 || 60
  const ttlOf = (name) => (stateDef(name) && Number(stateDef(name).ttlMs)) || 0
  const minDwellOf = (name) => (stateDef(name) && Number(stateDef(name).minDwellMs)) || 0

  const resolvePresentation = (target, sub) => {
    const def = stateDef(target)
    if (!def) return {}
    const subDef = (def.subkinds && (def.subkinds[sub] || def.subkinds.default)) || null
    if (subDef) return { ...subDef }
    return def.presentation ? { ...def.presentation } : {}
  }

  function tick(ts) {
    if (!current || current === 'idle') return
    const ttl = ttlOf(current)
    if (ttl > 0 && ts - since > ttl) {
      current = 'idle'
      subkind = null
      since = ts
    }
  }

  function handle(event, ctx = {}) {
    if (!event || !event.t) return snapshot()
    const ts = Number.isFinite(ctx.now) ? ctx.now : now()
    tick(ts)
    const type = String(event.t)
    const route = events[type]
    if (!route) return snapshot()
    let target = String(route.target || '')
    let dynSub = null
    if (route.reasonMap) {
      const rk = String((event.data && event.data.reason && event.data.reason.kind) || '')
      const rm = route.reasonMap[rk] || route.reasonMap.default || null
      if (rm) {
        target = rm.state || target
        dynSub = rm.subkind || null
      }
    }
    if (!target || !stateDef(target)) return snapshot()
    // 事件归因/模式闸门（配置驱动；默认放行）
    const m = String(ctx.mode || mode())
    if (route.modes && !route.modes.includes(m)) return snapshot()
    // tool subkind：优先 subkindFrom(toolType) 映射
    let sub = route.subkind || dynSub || null
    if (!sub && route.subkindFrom === 'toolType') {
      const name = String((event.data && (event.data.name || event.data.tool)) || '')
      sub = classifyTool(name, stateMap.toolSubkindMap || {})
    }
    if (!sub && route.subkindFrom === 'tool') {
      const name = String((event.data && (event.data.name || event.data.tool)) || '')
      sub = classifyTool(name, stateMap.toolSubkindMap || {})
    }
    if (!sub && route.subkindFrom === 'toolTypeOf(toolName)') {
      const tn = String((event.data && (event.data.toolName || event.data.name || event.data.tool)) || '')
      sub = tn ? classifyTool(tn, stateMap.toolSubkindMap || {}) : lastToolClass || 'unknown'
    }
    if (!sub && route.subkindFrom === 'intent') sub = String((event.data && event.data.intent) || 'unknown')
    if (!sub && route.subkindFrom === 'failure.code') {
      const code = String(
        (event.data && event.data.failure && event.data.failure.code) || (event.data && event.data.code) || ''
      )
      const cm = route.codeMap || {}
      sub = cm[code] || cm[String(code).toUpperCase()] || cm.default || 'unknown'
    }
    // 最小停留：低优先级事件不得抢高优先级状态（同优先级允许切换）
    const dwell = ts - since
    if (current !== target && dwell < minDwellOf(current) && priorityOf(target) < priorityOf(current)) {
      return snapshot()
    }
    counters.toolTypes = counters.toolTypes || {}
    if (type === 'turn/start') counters.turn = Number((event.data && event.data.turn) || counters.turn + 1)
    if (type === 'tool/call') counters.tool += 1
    if (type === 'approval/asked') counters.approval += 1
    if (type === 'llm/retry') counters.retry += 1
    if (type === 'tool/call') {
      const key = (event.data && (event.data.name || event.data.tool)) || 'unknown'
      counters.toolTypes[key] = (counters.toolTypes[key] || 0) + 1
      lastToolClass = classifyTool(key, stateMap.toolSubkindMap || {})
    }
    current = target
    subkind = sub
    since = ts
    return snapshot()
  }

  function snapshot() {
    const def = stateDef(current) || {}
    return {
      state: current,
      subkind: subkind || null,
      stateClass: def.stateClass || null,
      perform: def.perform !== false,
      presentation: resolvePresentation(current, subkind),
      counters: { ...counters, toolTypes: { ...counters.toolTypes } },
      since
    }
  }

  return {
    handle,
    snapshot,
    reset() {
      current = 'idle'
      subkind = null
      since = now()
    },
    _debug: { stateDef, priorityOf }
  }
}
