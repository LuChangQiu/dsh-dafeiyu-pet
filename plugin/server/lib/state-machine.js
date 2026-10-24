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
export function createStateMachine(opts = {}) {
  const {
    stateMap,
    now = () => Date.now(),
    mode = () => 'normal',
    initialState = 'idle',
    initialCounters = null
  } = opts
  if (!stateMap || !stateMap.states || !stateMap.events) throw new Error('state-map missing')
  const states = stateMap.states
  const events = stateMap.events
  const timing = stateMap.timing || {}
  const priorityTable = stateMap.priority || {}
  let current = 'idle'
  let subkind = null
  let since = now()
  const counters = {
    turn: 0,
    toolCalls: 0,
    toolResults: 0,
    approvalsAsked: 0,
    approvalsDecided: 0,
    retry: 0,
    backgroundCount: 0,
    unknownEventCount: 0,
    dispatchCount: 0,
    unknownIntentKind: 0
  }
  const toolCallIds = new Set()
  const approvalIds = new Set()
  const intentKindOf = (d) => {
    const direct = d && d.intent && d.intent.kind
    if (direct) return String(direct)
    if (d && d.questionKind) return String(d.questionKind)
    const qs = d && Array.isArray(d.questions) ? d.questions : []
    const withIntent = qs.find((q) => q && q.intent && q.intent.kind)
    if (withIntent) return String(withIntent.intent.kind)
    if (qs.some((q) => q && q.multiSelect)) return 'multi'
    return 'choice'
  }
  const intentEnum = (k) => {
    const raw = String(k || '').toLowerCase()
    if (raw === 'plan-review' || raw === 'plan_review') return 'plan_review'
    if (raw === 'freeform') return 'freeform'
    if (raw === 'multi') return 'multi'
    if (raw === 'choice' || raw === '') return 'choice'
    return 'choice'
  }
  let lastToolClass = null

  const stateDef = (name) => states[name] || null
  const priorityOf = (name) => (stateDef(name) && Number(stateDef(name).priority)) || priorityTable.E2 || 60
  const ttlOf = (name) => (stateDef(name) && Number(stateDef(name).ttlMs)) || 0
  const minDwellOf = (name) => (stateDef(name) && Number(stateDef(name).minDwellMs)) || 0
  if (initialState && stateDef(initialState)) current = String(initialState)

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
    counters.dispatchCount += 1
    const route = events[type]
    if (!route) {
      counters.unknownEventCount += 1
      return snapshot()
    }
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
    if (!sub && route.subkindRule) {
      const d = event.data || {}
      const qs = Array.isArray(d.questions) ? d.questions : []
      const withIntent = qs.find((q) => q && q.intent && q.intent.kind)
      let kind = (d.intent && d.intent.kind) || d.questionKind || (withIntent && withIntent.intent.kind)
      let isMulti = qs.some((q) => q && q.multiSelect === true)
      let baseKind = kind ? String(kind) : isMulti ? 'multi' : qs.length === 0 ? 'choice' : 'choice'
      const mapped =
        (route.subkindRule.map && (route.subkindRule.map[baseKind] || route.subkindRule.map[baseKind.toLowerCase()])) ||
        route.subkindRule.unknown ||
        'choice'
      const known =
        route.subkindRule.map && (route.subkindRule.map[baseKind] || route.subkindRule.map[baseKind.toLowerCase()])
      if (!known && route.subkindRule.unknownCounter)
        counters[route.subkindRule.unknownCounter] = (counters[route.subkindRule.unknownCounter] || 0) + 1
      sub = mapped
    }
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
    if (!sub && route.subkindFrom === 'intent') {
      const k = intentKindOf(event.data || {})
      sub = intentEnum(k)
      if (
        !['choice', 'plan_review', 'freeform', 'multi'].includes(String(k).toLowerCase()) &&
        !['plan-review', 'plan_review', 'freeform', 'multi', 'choice', ''].includes(String(k).toLowerCase())
      )
        counters.unknownIntentKind += 1
    }
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
    if (type === 'step/start') counters.step = (counters.step || 0) + 1
    if (type === 'tool/call') {
      const id = String((event.data && (event.data.callId || event.data.id)) || `${type}:${counters.dispatchCount}`)
      if (!toolCallIds.has(id)) {
        toolCallIds.add(id)
        counters.toolCalls += 1
      }
      const key = (event.data && (event.data.name || event.data.tool)) || 'unknown'
      lastToolClass = classifyTool(key, stateMap.toolSubkindMap || {})
    }
    if (type === 'tool/result') {
      const id = String((event.data && (event.data.callId || event.data.id)) || `${type}:${counters.dispatchCount}`)
      if (!toolCallIds.has('r:' + id)) {
        toolCallIds.add('r:' + id)
        counters.toolResults += 1
      }
    }
    if (type === 'approval/asked') {
      const id = String((event.data && (event.data.id || event.data.callId)) || `${type}:${counters.dispatchCount}`)
      if (!approvalIds.has('a:' + id)) {
        approvalIds.add('a:' + id)
        counters.approvalsAsked += 1
      }
    }
    if (type === 'approval/decided') {
      const id = String((event.data && (event.data.id || event.data.callId)) || `${type}:${counters.dispatchCount}`)
      if (!approvalIds.has('d:' + id)) {
        approvalIds.add('d:' + id)
        counters.approvalsDecided += 1
      }
    }
    if (type === 'llm/retry') counters.retry += 1
    if (type === 'session/event' && event.data && event.data.background) counters.backgroundCount += 1
    if (type === 'user/message' && event.data && event.data.sessionChanged)
      counters.activeSwitchCount = (counters.activeSwitchCount || 0) + 1
    counters.jobs = counters.jobs || { active: 0, completedToday: 0, failedToday: 0 }
    if (type === 'job/registered') counters.jobs.active = (counters.jobs.active || 0) + 1
    if (type === 'job/settled') counters.jobs.active = Math.max(0, (counters.jobs.active || 0) - 1)
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
      counters: { ...counters },
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
