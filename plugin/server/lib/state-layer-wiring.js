// task-104-wiring：state-layer 事件订阅骨架（config 门控；默认关 = 零调用/零副作用）
// 只做「事件 → state-layer → v2 stateLayer 字段 + perf 内存/日志」；不消费 script、不碰 renderer。
import { createStateLayer } from './state-layer.js'

const DEFAULT_WIRING_CONFIG = Object.freeze({
  enabled: false,
  affect: true,
  motivation: false,
  scripts: false
})

const localMinutesOfDay = (nowMs) => {
  const d = new Date(nowMs)
  return d.getHours() * 60 + d.getMinutes()
}

export function createStateLayerWiring(opts = {}) {
  const {
    ctx,
    config = {},
    log = () => {},
    now = () => Date.now(),
    mode = () => 'normal',
    loadStateMap = () => null,
    emitState = () => {},
    emitPerf = () => {},
    sessionRoleOf = () => null
  } = opts
  const cfg = { ...DEFAULT_WIRING_CONFIG, ...(config.stateLayer || {}) }
  const result = {
    enabled: false,
    applied: false,
    subscribed: false,
    reason: 'disabled',
    onEvent: () => null,
    getSnapshot: () => null,
    getPerf: () => [],
    setEnabled: () => ({ enabled: false, reason: 'disabled' }),
    dispose: () => {}
  }
  // 默认关：不加载 state-map、不订阅、不调用任何 emit（零副作用）
  if (cfg.enabled !== true) {
    result.reason = 'disabled-by-config'
    return result
  }
  let stateMap = null
  try {
    stateMap = loadStateMap()
  } catch (err) {
    stateMap = null
    result.reason = 'state-map-load-error'
    log('warn', 'state layer disabled: state-map load error', { message: String(err && err.message) })
  }
  if (!stateMap || !stateMap.states || !stateMap.events) {
    result.reason = result.reason === 'state-map-load-error' ? result.reason : 'state-map-missing'
    if (!result.reason) result.reason = 'state-map-missing'
    log('warn', 'state layer disabled: state-map missing')
    return result
  }

  let enabled = true
  const perfScripts = []
  let lastSnapshot = null
  const layer = createStateLayer({
    stateMap,
    now,
    mode,
    config: {
      enabled: true,
      affect: cfg.affect !== false,
      motivation: cfg.motivation === true,
      scripts: cfg.scripts === true
    }
  })

  const onEvent = (session, event) => {
    const type = event && (event.t || event.type)
    if (!enabled || !type) return null
    const nowMs = now()
    const d = event.data || {}
    const mapped = { t: String(type), data: d }
    const role = sessionRoleOf(session) || null
    let snapshot
    try {
      snapshot = layer.handle(mapped, {
        mode: String(mode()),
        nowMs,
        nowIso: new Date(nowMs).toISOString(),
        minutesOfDay: localMinutesOfDay(nowMs),
        sessionRole: role,
        facts: {}
      })
    } catch (err) {
      log('warn', 'state layer handle error', { message: String(err && err.message) })
      return null
    }
    lastSnapshot = snapshot
    try {
      emitState(snapshot)
    } catch {}
    if (snapshot && snapshot.script) {
      perfScripts.push(snapshot.script)
      if (perfScripts.length > 20) perfScripts.shift()
      try {
        emitPerf(snapshot.script)
      } catch {}
    }
    return snapshot
  }

  // 订阅：仅在 enabled 时执行一次（disabled 已提前 return，零订阅）
  let offHandler = null
  try {
    if (ctx && typeof ctx.on === 'function') {
      const off = ctx.on('session/event', onEvent)
      offHandler = typeof off === 'function' ? off : null
      result.subscribed = true
    }
  } catch (err) {
    log('warn', 'state layer subscribe failed', { message: String(err && err.message) })
  }

  result.enabled = true
  result.applied = true
  result.reason = 'enabled'
  result.onEvent = onEvent
  result.getSnapshot = () => lastSnapshot
  result.getPerf = () => perfScripts.slice()
  result.setEnabled = (value) => {
    enabled = value === true
    layer.setEnabled(enabled)
    if (!enabled) {
      lastSnapshot = layer.snapshot()
      log('info', 'state layer disabled (kill switch)')
    } else {
      log('info', 'state layer enabled')
    }
    return { enabled, reason: enabled ? 'enabled' : 'kill-switch' }
  }
  result.dispose = () => {
    enabled = false
    try {
      layer.setEnabled(false)
    } catch {}
    if (typeof offHandler === 'function') {
      try {
        offHandler()
      } catch {}
    } else if (result.subscribed && ctx && typeof ctx.off === 'function') {
      try {
        ctx.off('session/event', onEvent)
      } catch {}
    }
    result.subscribed = false
  }
  return result
}
