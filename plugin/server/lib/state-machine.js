// task-104 切片2：state-machine 纯函数（无 IO / 无 timer / 无随机）
// 消费 config/state-map.json：事件 → state/subkind/stateClass/perform/presentation/计数
// 契约：STATE-SEMANTICS v1.1 / FIXTURE-CLARIFICATION v3.1（fixtures v1.3 / schema 3）
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

const STATE_LEVEL_DEFAULT = {
  tool: 'S3',
  thinking: 'S3',
  error: 'S1',
  done: 'S1',
  job: 'S3',
  model_switch: 'S2',
  session_focus: 'S3',
  sleep: 'S3',
  offline: 'S3',
  compaction: 'S1',
  approval: 'S0',
  waiting_input: 'S0',
  cost: 'S1',
  idle: 'S3'
}

const META_KEYS = new Set([
  'slow',
  'afterMs',
  'bubbleChance',
  'fxChance',
  'perform',
  'petBehavior',
  'preferredComposite',
  'preferredPlayable',
  'covers',
  'note'
])

const isNightTime = (iso) => {
  if (!iso) return false
  const m = String(iso).match(/T(\d{2}):(\d{2})/)
  if (!m) return false
  const hh = Number(m[1])
  const mm = Number(m[2])
  return (hh === 23 && mm >= 30) || hh < 6
}

export function createStateMachine(opts = {}) {
  const {
    stateMap,
    now = () => Date.now(),
    mode = () => 'normal',
    initialState = 'idle',
    initialCounters = null,
    preconditions = null,
    sessionRole = null,
    currentSessionId = null
  } = opts
  if (!stateMap || !stateMap.states || !stateMap.events) throw new Error('state-map missing')
  const states = stateMap.states
  const events = stateMap.events
  const timing = stateMap.timing || {}
  const priorityTable = stateMap.priority || {}

  let current = 'idle'
  let subkind = null
  let since = now()
  let curSessionId = currentSessionId || (preconditions && preconditions.currentSessionId) || null
  const isBackground = !!(sessionRole && sessionRole !== 'main')
  const pre = preconditions || {}

  const counters = {
    turn: 0,
    step: 0,
    toolCalls: 0,
    toolResults: 0,
    approvalsAsked: 0,
    approvalsDecided: 0,
    retry: 0,
    backgroundCount: 0,
    unknownEventCount: 0,
    unknownIntentKind: 0,
    dispatchCount: 0,
    activeSwitchCount: 0,
    jobs: { active: 0, completedToday: 0, failedToday: 0 }
  }
  if (initialCounters && typeof initialCounters === 'object') {
    for (const [k, v] of Object.entries(initialCounters)) {
      if (k === 'jobs' && v && typeof v === 'object') counters.jobs = { ...counters.jobs, ...v }
      else counters[k] = v
    }
  }

  const toolCallIds = new Set()
  const toolResultIds = new Set()
  const approvalAskedIds = new Set()
  const approvalDecidedIds = new Set()
  const retryTimestamps = []
  let lastToolClass = null
  let presentationOverride = null

  const stateDef = (name) => states[name] || null
  const priorityOf = (name) => (stateDef(name) && Number(stateDef(name).priority)) || priorityTable.E2 || 60
  const ttlOf = (name) => (stateDef(name) && Number(stateDef(name).ttlMs)) || 0
  const minDwellOf = (name) => (stateDef(name) && Number(stateDef(name).minDwellMs)) || 0

  // 派生初始状态（插件内部信号，不是 DSH 事件）
  const offlineAfterMs = Number(timing.pluginOfflineAfterMs) || 30000
  if (Number(pre.heartbeatAgoMs) >= offlineAfterMs && stateDef('offline')) {
    current = 'offline'
    subkind = 'heartbeat_lost'
  } else if (stateDef('sleep') && Number(pre.lastEventAgoMin) >= 35 && isNightTime(pre.now)) {
    current = 'sleep'
    subkind = 'night'
  } else if (initialState && stateDef(initialState)) {
    current = String(initialState)
  }
  if (current === 'approval' && Number(pre.askedAgeMs) >= (ttlOf('approval') || 300000)) {
    current = 'thinking'
    subkind = 'step'
  }

  const normalizePresentation = (p) => {
    if (!p || typeof p !== 'object') return {}
    const out = {}
    for (const [k, v] of Object.entries(p)) {
      if (k === 'level') out.bubbleLevel = v
      else if (k === 'surface' || k === 'bubble') continue
      else out[k] = v
    }
    if ('bubble' in p && p.bubble === 'none') {
      out.bubbleKind = null
      out.bubbleLevel = null
    }
    return out
  }
  const mergeFields = (base, overlay) => {
    if (!overlay) return base
    const out = { ...(base || {}) }
    for (const [k, v] of Object.entries(overlay)) out[k] = v
    return out
  }
  const resolvePresentation = (target, sub, route, override = null) => {
    const def = stateDef(target)
    const pr = stateMap.presentationRules || {}
    const defaults = pr.defaults || {}
    let base = null
    const subEntry = def && def.subkinds && sub ? def.subkinds[sub] : null
    if (subEntry) {
      // L2：命中即整体替换 L3（条目本身即 presentation；剥离 subkind meta keys）
      base = {}
      for (const [k, v] of Object.entries(subEntry.presentation || subEntry)) {
        if (!META_KEYS.has(k)) base[k] = v
      }
    } else if (def && def.presentation) {
      base = { ...def.presentation }
    } else if (defaults[target]) {
      base = { ...defaults[target] }
    } else if (defaults._global) {
      base = { ...defaults._global }
    }
    // L1：events[type].presentation 字段级合并（当前 0 使用；clip/composite 由 guard 拒绝）
    const L1 = route && route.presentation ? route.presentation : null
    if (L1) base = mergeFields(base, L1)
    const out = normalizePresentation(base)
    if (out.composite && out.clip) delete out.clip
    if (!out.bubbleKind) {
      out.bubbleKind = null
      out.bubbleLevel = null
    } else if (!out.bubbleLevel) {
      out.bubbleLevel = STATE_LEVEL_DEFAULT[target] || 'S3'
    }
    if (target === 'cost' && sub === 'limit100') out.expression = 'sad'
    if (override) for (const [k, v] of Object.entries(override)) out[k] = v
    return out
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

  const applyCounters = (type, event) => {
    const d = event.data || {}
    if (type === 'turn/start') counters.turn += 1
    else if (type === 'step/start') counters.step += 1
    else if (type === 'tool/call') {
      const id = String(d.callId || d.id || `${type}:${counters.dispatchCount}`)
      if (!toolCallIds.has(id)) {
        toolCallIds.add(id)
        counters.toolCalls += 1
      }
      lastToolClass = classifyTool(d.name || d.tool || 'unknown', stateMap.toolSubkindMap || {})
    } else if (type === 'tool/result') {
      const id = String(d.callId || d.id || `${type}:${counters.dispatchCount}`)
      if (!toolResultIds.has(id)) {
        toolResultIds.add(id)
        counters.toolResults += 1
      }
    } else if (type === 'approval/asked') {
      const id = String(d.id || d.callId || `${type}:${counters.dispatchCount}`)
      if (!approvalAskedIds.has(id)) {
        approvalAskedIds.add(id)
        counters.approvalsAsked += 1
      }
    } else if (type === 'approval/decided') {
      const id = String(d.id || d.callId || `${type}:${counters.dispatchCount}`)
      if (!approvalDecidedIds.has(id)) {
        approvalDecidedIds.add(id)
        counters.approvalsDecided += 1
      }
    } else if (type === 'llm/retry') {
      counters.retry += 1
      retryTimestamps.push(Number.isFinite(d.at) ? d.at : Number.MAX_SAFE_INTEGER)
    } else if (type === 'job/registered') counters.jobs.active += 1
    else if (type === 'job/settled') counters.jobs.active = Math.max(0, counters.jobs.active - 1)
    else if (type === 'session/event' && d.background) counters.backgroundCount += 1
  }

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
    return 'choice'
  }
  const resolveSubkindRule = (route, event) => {
    const d = event.data || {}
    const qs = Array.isArray(d.questions) ? d.questions : []
    const withIntent = qs.find((q) => q && q.intent && q.intent.kind)
    const kind = (d.intent && d.intent.kind) || d.questionKind || (withIntent && withIntent.intent.kind)
    const isMulti = qs.some((q) => q && q.multiSelect === true)
    const rawKind = kind ? String(kind) : isMulti ? 'multi' : 'choice'
    const mapped =
      (route.subkindRule.map && (route.subkindRule.map[rawKind] || route.subkindRule.map[rawKind.toLowerCase()])) ||
      route.subkindRule.unknown ||
      'choice'
    const known =
      route.subkindRule.map && (route.subkindRule.map[rawKind] || route.subkindRule.map[rawKind.toLowerCase()])
    if (!known && route.subkindRule.unknownCounter) {
      counters[route.subkindRule.unknownCounter] = (counters[route.subkindRule.unknownCounter] || 0) + 1
    }
    return mapped
  }

  function handle(event, ctx = {}) {
    presentationOverride = null
    const explicitNow = Number.isFinite(ctx.now)
    const ts = explicitNow ? ctx.now : now()
    if (!event || !event.t) return snapshot()
    const type = String(event.t)
    const route = events[type]
    if (!route) {
      counters.unknownEventCount += 1
      return snapshot()
    }
    if (isBackground && route.source !== 'plugin-internal') {
      counters.backgroundCount += 1
      return snapshot()
    }
    tick(ts)
    const m = String(ctx.mode || mode())
    if (Array.isArray(route.modes) && !route.modes.includes(m)) return snapshot()

    applyCounters(type, event)

    if (route.panelOnly || route.kind === 'panelOnly') return snapshot()

    let target = route.target ? String(route.target) : ''
    let dynSub = null

    if (type === 'user/message') {
      const d = event.data || {}
      const isHuman = !d.source || d.source.kind === 'user' || d.source.kind === undefined
      const sid = d.sessionId || d.session_id || null
      const changed = d.sessionChanged === true || (!!sid && !!curSessionId && String(sid) !== String(curSessionId))
      if (isHuman && changed) {
        curSessionId = String(sid)
        counters.activeSwitchCount += 1
        target = String((route.activeSwitch && route.activeSwitch.target) || 'session_focus')
        dynSub = (route.activeSwitch && route.activeSwitch.subkind) || 'switch'
      } else if (sid) curSessionId = String(sid)
    }

    if (route.targetFromReasonMap && route.reasonMap) {
      const rk = String((event.data && event.data.reason && event.data.reason.kind) || '')
      const rm = route.reasonMap[rk] || route.reasonMap.incomplete || { state: 'done', subkind: 'incomplete' }
      target = rm.state || target
      dynSub = rm.subkind || dynSub
      const reportDue =
        (event.preconditions && event.preconditions.reportDue === true) ||
        (event.data && event.data.reportDue === true) ||
        pre.reportDue === true
      if (route.reportRule && rk === 'completed' && reportDue && target === 'done') {
        dynSub = route.reportRule.subkind || 'report'
      }
    } else if (route.reasonMap) {
      const rk = String((event.data && event.data.reason && event.data.reason.kind) || '')
      const rm = route.reasonMap[rk] || route.reasonMap.default
      if (rm) {
        target = rm.state || target
        dynSub = rm.subkind || dynSub
      }
    }

    // compaction/end(error) 是 state-exit：compaction → error
    if (type === 'compaction/end' && event.data && event.data.error) {
      target = 'error'
      dynSub = 'unknown'
      presentationOverride = { bubbleLevel: 'S2' }
    }

    // job/settled exitRule：活跃 job 归零才回 thinking/step
    if (type === 'job/settled' && route.exitRule) {
      const status = String((event.data && event.data.status) || 'completed')
      if (counters.jobs.active > 0) {
        target = String(route.target || 'job')
        dynSub = status
      } else {
        target = String(route.exitState || 'thinking')
        dynSub = route.exitSubkind || 'step'
      }
    }

    // llm/retry 升级：窗口内达到阈值 → error/rate_limit
    if (type === 'llm/retry' && route.escalate) {
      const windowMs = Number(route.escalate.windowMs) || 60000
      const threshold = Number(route.escalate.count) || 3
      const t = Number.isFinite(event.data && event.data.at) ? event.data.at : ts
      const recent = retryTimestamps.filter((x) => t - x <= windowMs)
      if (recent.length >= threshold) {
        const then = String(route.escalate.then || 'error/rate_limit')
        const parts = then.split('/')
        target = parts[0]
        dynSub = parts[1] || 'rate_limit'
      } else {
        target = ''
        dynSub = null
      }
    }

    if (!target || !stateDef(target)) return snapshot()

    let sub = dynSub || route.subkind || null
    if (!sub && route.subkindRule) sub = resolveSubkindRule(route, event)
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
    if (!sub && route.subkindFrom === 'intent') sub = intentEnum(intentKindOf(event.data || {}))
    if (!sub && route.subkindFrom === 'failure.code') {
      const code = String(
        (event.data && event.data.failure && event.data.failure.code) || (event.data && event.data.code) || ''
      )
      const cm = route.codeMap || {}
      sub = cm[code] || cm[String(code).toUpperCase()] || cm.default || 'unknown'
    }
    if (!sub && route.subkindFrom === 'status') sub = String((event.data && event.data.status) || 'unknown')

    if (explicitNow && current !== target) {
      const dwell = ts - since
      if (dwell < minDwellOf(current) && priorityOf(target) < priorityOf(current)) return snapshot()
    }

    if (current !== target || subkind !== sub) counters.dispatchCount += 1
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
      presentation: resolvePresentation(current, subkind, null, presentationOverride),
      counters: JSON.parse(JSON.stringify(counters)),
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
    _debug: { stateDef, priorityOf, events, counters }
  }
}
