// task-104 切片5：perf-script 表演编排层（纯函数；无 IO / 无 timer / 无随机）
// 契约：PERFORMANCE-CONTRACT §7.1/§7.1.1（script schema v2 + vocabulary 校验 + 拒绝整条 + baseline 回退）
export const SCRIPT_VERSION = 2

export const TRACKS = Object.freeze(['base', 'action', 'expression', 'bubble', 'fx', 'gaze', 'move'])
export const MODES = Object.freeze(['active', 'focus', 'silent', 'off', 'normal'])
export const BUBBLE_LEVELS = Object.freeze(['S0', 'S1', 'S2', 'S3'])
export const ANCHORS = Object.freeze([
  'user-cursor',
  'user-window',
  'screen-center',
  'feet',
  'edge-top',
  'edge-bottom',
  'edge-left',
  'edge-right'
])

// 从 state-map 提取唯一真源词表（ACT_ALL = clips ∪ compositesPlayable；note 不可播）
export function buildVocabulary(stateMap = {}) {
  return {
    clips: new Set(stateMap.clips || []),
    composites: new Set(stateMap.compositesPlayable || []),
    expressions: new Set(stateMap.expressions || []),
    fx: new Set(stateMap.fx || []),
    bubbleKinds: new Set((stateMap.bubbles && stateMap.bubbles.kinds) || []),
    bubbleStyles: new Set((stateMap.bubbles && stateMap.bubbles.styles) || []),
    bubbleLevels: new Set(BUBBLE_LEVELS),
    maxChars: Number((stateMap.bubbles && stateMap.bubbles.maxChars) || 40)
  }
}

// intent → 表演模板（只使用白名单 key；具体美术映射由 renderer 负责）
export const INTENT_TEMPLATES = Object.freeze({
  react_ack: { action: { clip: 'idleShift' }, expression: 'idleSmile', priority: 45 },
  comment_work: { action: { clip: 'walk' }, expression: 'thinking', gaze: true, priority: 50 },
  comfort_error: { action: { clip: 'walk' }, expression: 'sad', fx: 'sweat', priority: 70 },
  celebrate_done: {
    action: { composite: 'cheer' },
    expression: 'happy',
    fx: 'love',
    bubble: { kind: 'report', level: 'S1', textKey: 'done.cheer' },
    priority: 65
  },
  celebrate_goal: {
    action: { composite: 'cheer' },
    expression: 'happy',
    fx: 'love',
    bubble: { kind: 'report', level: 'S1', textKey: 'goal.cheer' },
    priority: 70
  },
  comfort_block: {
    action: { clip: 'walk' },
    expression: 'sad',
    bubble: { kind: 'normal', level: 'S1', textKey: 'block.care' },
    priority: 70
  },
  wait_approval: {
    action: { composite: 'waitPeek' },
    expression: 'surprised',
    bubble: { kind: 'remind', level: 'S0', textKey: 'approval.wait' },
    priority: 90
  },
  wait_input: {
    action: { composite: 'waitPeek' },
    expression: 'idleSmile',
    bubble: { kind: 'remind', level: 'S0', textKey: 'input.wait' },
    priority: 90
  },
  announce_job: {
    action: { clip: 'idleShift' },
    expression: 'proud',
    bubble: { kind: 'normal', level: 'S3', textKey: 'job.done' },
    priority: 50
  },
  note_switch: {
    action: { clip: 'turnStop' },
    expression: 'surprised',
    bubble: { kind: 'inner', level: 'S3', textKey: 'switch.note' },
    priority: 50
  },
  observe_stuck: {
    action: { composite: 'think' },
    expression: 'thinking',
    bubble: { kind: 'inner', level: 'S3', textKey: 'stuck.mutter' },
    priority: 55
  },
  report_cost: {
    action: { clip: 'turnStop' },
    expression: 'pout',
    bubble: { kind: 'report', level: 'S1', textKey: 'cost.report' },
    priority: 55
  },
  idle_skit: { action: { clip: 'idleStretch' }, expression: 'idleSmile', priority: 40 },
  greet: {
    action: { clip: 'wave' },
    expression: 'happy',
    bubble: { kind: 'greet', level: 'S3', textKey: 'greet.morning' },
    priority: 55
  },
  ask_attention: { action: { clip: 'walk' }, expression: 'idleSmile', gaze: true, priority: 50 },
  prank: { action: { clip: 'sneak' }, expression: 'guilty', fx: 'shy', priority: 60 },
  rare_ritual: { action: { composite: 'cheer' }, expression: 'happy', fx: 'love', priority: 75 },
  rest_onset: { action: { clip: 'sleep' }, expression: 'sleepy', fx: 'zzz', priority: 65 }
})

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))
const num = (x, d = 0) => (Number.isFinite(Number(x)) ? Number(x) : d)

export function buildBaselineScript({ id = 'perf-baseline', source = 'state:idle', at = null } = {}) {
  return normalizeScript({
    id,
    scriptVersion: SCRIPT_VERSION,
    source,
    at: at || new Date(0).toISOString(),
    durationMs: 1200,
    priority: 20,
    interruptible: true,
    oneShot: false,
    layers: [
      {
        id: 'base',
        track: 'base',
        clip: 'idleBase',
        loop: true,
        priority: 10,
        dwellMs: 0,
        fadeMs: 0,
        allowDuring: ['active', 'focus']
      }
    ],
    constraints: { maxPrimaryActions: 1, modeGate: ['active'], noInterruptDuring: ['S0'] }
  })
}

export function normalizeScript(script = {}) {
  const out = { ...script }
  out.scriptVersion = out.scriptVersion === 1 ? 1 : SCRIPT_VERSION
  out.priority = num(out.priority, 40)
  out.interruptible = out.interruptible !== false
  out.oneShot = out.oneShot === true
  out.onEnd = out.onEnd || 'return:baseline'
  out.layers = (out.layers || []).map((layer, i) => normalizeLayer(layer, i))
  out.constraints = {
    maxPrimaryActions: num(out.constraints && out.constraints.maxPrimaryActions, 1),
    modeGate: (out.constraints && out.constraints.modeGate) || ['active'],
    noInterruptDuring: (out.constraints && out.constraints.noInterruptDuring) || ['S0']
  }
  return out
}

const normalizeLayer = (layer = {}, index = 0) => ({
  ...layer,
  id: layer.id || `layer-${index}`,
  track: layer.track || (index === 0 ? 'base' : 'action'),
  atMs: num(layer.atMs, 0),
  dwellMs: num(layer.dwellMs, 0),
  fadeMs: num(layer.fadeMs, 0),
  priority: num(layer.priority, 30),
  allowDuring: Array.isArray(layer.allowDuring) && layer.allowDuring.length ? layer.allowDuring : ['active']
})

export function validateScript(script, vocab, opts = {}) {
  const errors = []
  const err = (reason, extra = {}) => errors.push({ reason, ...extra })
  if (!script || typeof script !== 'object') return { ok: false, errors: [{ reason: 'invalid-script' }] }
  const s = script
  if (s.scriptVersion !== SCRIPT_VERSION)
    err(s.scriptVersion === 1 ? 'v1-script-needs-normalize' : 'bad-script-version')
  if (!s.id || typeof s.id !== 'string') err('missing-script-id')
  if (!s.source || !/^(intent|state):/.test(String(s.source))) err('bad-source', { source: s.source })
  if (!Array.isArray(s.layers) || s.layers.length === 0) err('missing-layers')
  if (!Array.isArray(s.constraints && s.constraints.modeGate)) err('missing-modeGate')
  if (num(s.constraints && s.constraints.maxPrimaryActions, 0) > 1) err('maxPrimaryActions>1')
  const ids = new Set()
  const primary = { count: 0 }
  for (const layer of s.layers || []) {
    const layerId = layer.id
    if (!layerId) err('layer-missing-id')
    else if (ids.has(layerId)) err('duplicate-layer-id', { layerId })
    else ids.add(layerId)
    if (!TRACKS.includes(layer.track)) err('bad-track', { layerId, track: layer.track })
    if (!Array.isArray(layer.allowDuring) || layer.allowDuring.some((m) => !MODES.includes(m)))
      err('bad-allowDuring', { layerId })
    for (const k of ['atMs', 'dwellMs', 'fadeMs', 'priority']) {
      if (typeof layer[k] !== 'number' || Number.isNaN(layer[k])) err('bad-layer-field', { layerId, field: k })
    }
    if (num(layer.fadeMs) < 0 || num(layer.atMs) < 0 || num(layer.dwellMs) < 0) err('negative-timing', { layerId })
    if (layer.clip && layer.composite) err('clip-composite-exclusive', { layerId })
    if (layer.clip && !vocab.clips.has(layer.clip)) err('unknown-clip', { layerId, key: layer.clip })
    if (layer.composite && !vocab.composites.has(layer.composite))
      err('unknown-composite', { layerId, key: layer.composite })
    if (layer.track === 'action' || layer.track === 'base') {
      if (!layer.clip && !layer.composite) err('action-missing-key', { layerId })
    }
    if (layer.track === 'action') primary.count++
    if (layer.track === 'expression') {
      const expr = layer.id === 'expression' ? layer.expression : layer.expression || layer.key
      if (expr && !vocab.expressions.has(expr)) err('unknown-expression', { layerId, key: expr })
      if (!expr && !layer.noop) err('expression-missing', { layerId })
    }
    if (layer.track === 'fx') {
      const names = Array.isArray(layer.fx) ? layer.fx : layer.name ? [layer.name] : []
      for (const n of names) if (!vocab.fx.has(n)) err('unknown-fx', { layerId, key: n })
      if (!names.length) err('fx-missing', { layerId })
    }
    if (layer.track === 'bubble') {
      if (!vocab.bubbleKinds.has(layer.kind)) err('unknown-bubble-kind', { layerId, key: layer.kind })
      const style = layer.style || 'auto'
      if (!vocab.bubbleStyles.has(style)) err('unknown-bubble-style', { layerId, key: style })
      if (!vocab.bubbleLevels.has(layer.level)) err('unknown-bubble-level', { layerId, key: layer.level })
      const maxChars = num(layer.maxChars, 40)
      if (maxChars > vocab.maxChars || maxChars <= 0) err('bubble-maxChars', { layerId, maxChars })
      if (!layer.textKey || !/^[a-z0-9._-]+$/i.test(String(layer.textKey)))
        err('bubble-textKey-must-be-semantic', { layerId })
    }
    if (layer.track === 'gaze' || layer.track === 'move') {
      if (layer.anchor && !ANCHORS.includes(layer.anchor)) err('unknown-anchor', { layerId, key: layer.anchor })
      if (layer.target && !['user', 'cursor', 'window', 'screen', 'none'].includes(layer.target))
        err('unknown-gaze-target', { layerId, key: layer.target })
    }
  }
  if (primary.count > num(s.constraints && s.constraints.maxPrimaryActions, 1))
    err('too-many-primary-actions', { count: primary.count })
  return { ok: errors.length === 0, errors }
}

export function buildScript({
  intentId,
  source,
  at,
  emotion = {},
  durationMs = 2600,
  mode = 'active',
  oneShot = false,
  cooldownMs = 6000,
  extraLayers = [],
  seed = 0
} = {}) {
  const template = INTENT_TEMPLATES[intentId]
  if (!template) throw new Error(`unknown intent template: ${intentId}`)
  const layers = [
    {
      id: 'base',
      track: 'base',
      clip: 'idleBase',
      loop: true,
      priority: 10,
      dwellMs: 0,
      fadeMs: 0,
      allowDuring: ['active', 'focus']
    }
  ]
  if (template.action) {
    layers.push({
      id: 'act1',
      track: 'action',
      ...template.action,
      atMs: 150,
      holdLast: template.action.composite ? true : undefined,
      dwellMs: 600,
      fadeMs: 120,
      priority: template.priority || 60,
      allowDuring: mode === 'focus' ? ['focus'] : ['active', 'focus']
    })
  }
  if (template.expression) {
    layers.push({
      id: 'face1',
      track: 'expression',
      expression: template.expression,
      atMs: 0,
      holdMs: 1400,
      dwellMs: 1400,
      fadeMs: 120,
      priority: 40,
      allowDuring: ['active', 'focus']
    })
  }
  if (template.bubble) {
    layers.push({
      id: 'bub1',
      track: 'bubble',
      kind: template.bubble.kind,
      level: template.bubble.level,
      style: 'auto',
      maxChars: 40,
      textKey: template.bubble.textKey,
      textSource: 'llm|pool',
      notBeforeMs: 300,
      holdMs: 5000,
      dual: false,
      priority: 80,
      allowDuring: ['active']
    })
  }
  if (template.fx) {
    layers.push({
      id: 'fx1',
      track: 'fx',
      name: template.fx,
      atMs: 600,
      dwellMs: 1800,
      fadeMs: 0,
      priority: 30,
      allowDuring: ['active', 'focus']
    })
  }
  if (template.gaze) {
    layers.push({
      id: 'gaze1',
      track: 'gaze',
      target: 'user',
      anchor: 'user-cursor',
      clampScreen: true,
      atMs: 100,
      dwellMs: 800,
      fadeMs: 80,
      priority: 25,
      allowDuring: ['active', 'focus']
    })
  }
  layers.push(...extraLayers)
  return normalizeScript({
    id: `perf-${intentId}-${seed}`,
    scriptVersion: SCRIPT_VERSION,
    source: source || `intent:${intentId}`,
    at: at || new Date(0).toISOString(),
    durationMs,
    priority: template.priority || 50,
    interruptible: true,
    oneShot,
    cooldownMs,
    requires: ['attention>=0.4', 'mode:active'],
    onEnd: 'return:baseline',
    emotion: {
      valence: clamp(num(emotion.valence, 0.1), -1, 1),
      arousal: clamp(num(emotion.arousal, 0.3), 0, 1),
      energy: clamp(num(emotion.energy, 0.7), 0, 1),
      attention: clamp(num(emotion.attention, 0.3), 0, 1)
    },
    layers,
    constraints: { maxPrimaryActions: 1, modeGate: [mode], noInterruptDuring: ['S0'] }
  })
}

// 组装：非法整条拒绝 + 回退 baseline（不部分播放）
export function assembleScript({ stateMap, baselineSource = 'state:idle', ...opts } = {}) {
  const vocab = buildVocabulary(stateMap)
  let script
  try {
    script = buildScript(opts)
  } catch (error) {
    return {
      script: buildBaselineScript({ source: baselineSource }),
      rejected: true,
      errors: [{ reason: 'build-error', message: error.message }]
    }
  }
  const result = validateScript(script, vocab)
  if (!result.ok)
    return { script: buildBaselineScript({ source: baselineSource }), rejected: true, errors: result.errors }
  return { script, rejected: false, errors: [] }
}

// 幂等：同 source 在 cooldownMs 内不重复生成（registry 由调用方持有，纯函数返回判定）
export function canEmit({ registry = new Map(), source, nowMs = 0, cooldownMs = 0, oneShotKey = null } = {}) {
  if (!source) return { emit: false, reason: 'missing-source' }
  const last = registry.get(source)
  if (last !== undefined && nowMs < last + cooldownMs) return { emit: false, reason: 'cooldown', lastAt: last }
  if (oneShotKey && registry.has('one-shot:' + oneShotKey)) return { emit: false, reason: 'one-shot-done' }
  return { emit: true }
}

export function markEmitted({ registry = new Map(), source, nowMs = 0, oneShotKey = null } = {}) {
  if (source) registry.set(source, nowMs)
  if (oneShotKey) registry.set('one-shot:' + oneShotKey, nowMs)
  return registry
}

// v1 兼容：补齐缺省字段；未知字段忽略（debug 由调用方记录）
export function normalizeScriptV1(oldScript = {}) {
  const patched = normalizeScript({ ...oldScript, scriptVersion: SCRIPT_VERSION })
  const ignored = []
  for (const key of Object.keys(oldScript)) {
    if (
      ![
        'id',
        'scriptVersion',
        'source',
        'at',
        'durationMs',
        'priority',
        'interruptible',
        'oneShot',
        'cooldownMs',
        'requires',
        'onEnd',
        'emotion',
        'layers',
        'constraints',
        'performance'
      ].includes(key)
    )
      ignored.push(key)
  }
  return { script: patched, ignored }
}

export function perfScriptVersions() {
  return {
    scriptVersion: SCRIPT_VERSION,
    tracks: [...TRACKS],
    modes: [...MODES],
    bubbleLevels: [...BUBBLE_LEVELS],
    templateCount: Object.keys(INTENT_TEMPLATES).length
  }
}
