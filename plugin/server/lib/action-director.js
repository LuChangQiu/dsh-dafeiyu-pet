// task-133：LLM 动作导演（action director）——把 LLM 输出解析为 2–4 拍动作计划
// 词表 = A（现有 28 acts，act-fx-whitelist.json） ∪ B（MIT 50 段 clip 名，dsh-whale-girl-pet）；
// 统一 perf:<json> 协议：{text?, beats:[{act, ms, intensity?, transitionMs?}], interrupt?}
// 约束：非法/超时 → 单动作兜底；预算/温度/去重沿用 llm.lines。
export const DIRECTOR_KINDS = Object.freeze(
  new Set([
    'clickLine',
    'doubleClickLine',
    'praise',
    'interactHead',
    'interactFeed',
    'interactCome',
    'turnEnd',
    'selfTalk'
  ])
)

// B：MIT dsh-whale-girl-pet 的 50 段 clip 名（精确匹配；pet 侧解析为 assets/thumb/<名>.webm）
export const CLIP_NAMES = Object.freeze([
  '被鼠标拖拽悬空反馈',
  '被吓一跳（炸毛）',
  '超大伸懒腰',
  '吃盒饭',
  '吃小鱼干',
  '打瞌睡被惊醒',
  '打喷嚏',
  '待机呼吸休闲',
  '点击回应 - 傲娇生气（侧身展示）',
  '点击回应 - 害羞惊讶',
  '点击回应 - 开心跃动',
  '东张西望',
  '翻钱包',
  '工作被打扰',
  '工作结束',
  '工作摸鱼',
  '工作思考',
  '哈欠连天',
  '喝奶茶',
  '鲸鱼吐泡泡特效',
  '举牌不是大肥鱼',
  '开始工作',
  '看表叹气',
  '看天气',
  '空白举牌',
  '迷糊犯困',
  '摸鱼被抓',
  '女仆屈膝礼仪',
  '女仆扫除',
  '螃蟹走路',
  '认真工作',
  '睡觉第二段',
  '睡觉第三段',
  '睡觉第一段',
  '睡眼惺忪',
  '偷吃零食被抓住',
  '偷吃Token',
  '玩游戏气急败坏',
  '闲得无聊打游戏',
  '小幅度原地 360 度旋转展示',
  '用鲸鱼尾巴拍打地面',
  '悠闲哼歌',
  '原地蹲下玩玩具汽车',
  '原地漂浮踏步',
  '原地敲击桌面互动',
  '原地跳跃抓碎头顶物品',
  '原地小憩沉眠',
  '原地重力下蹲压缩',
  '原地专心玩魔方',
  '长时间工作看表'
])

export const DIRECTOR_LIMITS = Object.freeze({
  minBeats: 2,
  maxBeats: 4,
  beatMsMin: 200,
  beatMsMax: 3000,
  transitionMsMin: 0,
  transitionMsMax: 800,
  maxChars: 40,
  intensityMin: 0.5,
  intensityMax: 1.5
})

// DSH 操作 → 动作/clip 映射（B 为主词表，A 为 fallback；消费 ux OP-ACTION-MATRIX v1）
export const OP_ACTION_HINTS = Object.freeze({
  turnStart: 'B: 开始工作 / 原地漂浮踏步；A fallback: walk/wave/land',
  tool: 'B: 认真工作 / 工作思考 / 工作摸鱼；A fallback: think/hum',
  toolRead: 'B: 认真工作；A fallback: think/turnStop',
  toolCommand: 'B: 认真工作 / 原地敲击桌面互动；A fallback: walk/turnStop',
  approval: 'B: 工作被打扰 / 举牌不是大肥鱼；A fallback: waitPeek/turnStop',
  waitingInput: 'B: 空白举牌；A fallback: waitPeek',
  done: 'B: 工作结束 / 女仆屈膝礼仪；A fallback: cheer/report/idleSettle',
  error: 'B: 被吓一跳（炸毛）/ 工作被打扰；A fallback: errorSequence/caught',
  longTask: 'B: 长时间工作看表 / 看表叹气；A fallback: think/hum',
  cost: 'B: 翻钱包；A fallback: report',
  plan: 'B: 工作思考；A fallback: report/think',
  team: 'B: 认真工作；A fallback: report/walk',
  reminder: 'B: 举牌不是大肥鱼；A fallback: wave/jump',
  multiSession: 'B: 东张西望；A fallback: turnStop',
  idle: 'B: 待机呼吸休闲 / 东张西望 / 悠闲哼歌 / 看天气 / 哈欠连天 / 打喷嚏 / 翻钱包 / 吃小鱼干；A fallback: idleBase/idleShift/idleSettle/idleStretch/hum',
  click:
    'B: 点击回应 - 开心跃动 / 点击回应 - 害羞惊讶 / 点击回应 - 傲娇生气（侧身展示）；A fallback: pat/tsundere/waitPeek',
  pat: 'B: 点击回应 - 害羞惊讶 / 女仆屈膝礼仪；A fallback: pat',
  feed: 'B: 吃小鱼干 / 吃盒饭；A fallback: eat/eatSatisfied',
  come: 'B: 东张西望；A fallback: waitPeek/walk',
  sneakCaught: 'B: 偷吃零食被抓住 / 偷吃Token；A fallback: caught',
  celebrate: 'B: 工作结束；A fallback: cheer/jump/land'
})

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u
const BANNED_RE = /(作为\s*AI|建议您|绝绝子|栓\s*Q|主人)/i

export const isDirectorKind = (kind) => DIRECTOR_KINDS.has(String(kind || ''))

/** 追加到原 prompt 末尾的 JSON schema 指令（只要求动作计划，台词仍由 text 字段）。 */
export const buildDirectorSuffix = ({ acts = [], clips = CLIP_NAMES, maxBeats = DIRECTOR_LIMITS.maxBeats } = {}) => {
  const actList = Array.isArray(acts) ? acts.slice(0, 40) : []
  const clipList = Array.isArray(clips) ? clips : [...CLIP_NAMES]
  return [
    '',
    '[导演任务] 在台词之外，给 2–4 拍动作计划，帮助表达这句话。',
    '[输出格式] 只输出 JSON（不要 Markdown/解释/引号包裹），形如：',
    '{"text":"台词（≤40字，≤2句，无emoji/数字）","beats":[{"act":"think","ms":800,"intensity":1,"transitionMs":120},{"act":"hum","ms":600}],"interrupt":false}',
    `[B 主词表（优先使用，精确复制）] ${clipList.join('、')}`,
    `[A 回退词表（B 不可用时才用）] ${actList.join(', ')}`,
    `[限制] beats ${DIRECTOR_LIMITS.minBeats}–${maxBeats} 个；ms ${DIRECTOR_LIMITS.beatMsMin}–${DIRECTOR_LIMITS.beatMsMax}；intensity ${DIRECTOR_LIMITS.intensityMin}–${DIRECTOR_LIMITS.intensityMax}（可选）；transitionMs ${DIRECTOR_LIMITS.transitionMsMin}–${DIRECTOR_LIMITS.transitionMsMax}（可选）；text 必须是一句完整台词。`,
    `[语义提示] ${Object.entries(OP_ACTION_HINTS)
      .map(([k, v]) => `${k}=${v}`)
      .join('；')}。`,
    '[选择规则] 优先 B clip；仅当 B 在当前身体不可用/缺资产时才用 A act；A/B 都不要自造名字。',
    '[禁忌] 不生成清单/解释/多个 JSON；不重复上一句；不做危险/剧烈动作。'
  ].join('\n')
}

const stripFences = (raw) => {
  let s = String(raw || '').trim()
  s = s
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
  const i = s.indexOf('{')
  const j = s.lastIndexOf('}')
  if (i >= 0 && j > i) s = s.slice(i, j + 1)
  return s
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))

const validText = (text, { maxChars = DIRECTOR_LIMITS.maxChars, allowDigits = false } = {}) => {
  const s = String(text || '')
    .replace(/^["'“”‘’「」《》\s]+|["'“”‘’「」《》\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!s) return ''
  if (s.length > maxChars) return ''
  if (EMOJI_RE.test(s) || BANNED_RE.test(s)) return ''
  if (!allowDigits && /[0-9]/.test(s)) return ''
  if (s.length < 2) return ''
  return s
}

/**
 * 解析 LLM 导演 JSON；非法返回 {ok:false,reason}（调用方回退单动作/池台词）。
 * @param {object} opts {acts: A 白名单, clips: B 白名单, ...}
 */
export const parseDirectorPlan = (raw, opts = {}) => {
  const {
    acts = [],
    clips = CLIP_NAMES,
    maxBeats = DIRECTOR_LIMITS.maxBeats,
    minBeats = DIRECTOR_LIMITS.minBeats,
    beatMsMin = DIRECTOR_LIMITS.beatMsMin,
    beatMsMax = DIRECTOR_LIMITS.beatMsMax,
    maxChars = DIRECTOR_LIMITS.maxChars,
    allowDigits = false
  } = opts
  let obj
  try {
    obj = JSON.parse(stripFences(raw))
  } catch {
    return { ok: false, reason: 'invalid-json' }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, reason: 'invalid-json' }
  const text = obj.text == null ? '' : validText(obj.text, { maxChars, allowDigits })
  if (obj.text != null && !text) return { ok: false, reason: 'invalid-text' }
  const rawBeats = Array.isArray(obj.beats) ? obj.beats : []
  const actSet = new Set(Array.from(acts || [], (a) => String(a)))
  const clipSet = new Set(Array.from(clips || [], (c) => String(c)))
  const beats = []
  for (const b of rawBeats) {
    if (!b || typeof b !== 'object') continue
    const act = String(b.act || '')
    if (!actSet.has(act) && !clipSet.has(act)) continue
    const ms = clamp(Math.round(Number(b.ms) || 800), beatMsMin, beatMsMax)
    const beat = { act, ms }
    if (Number.isFinite(Number(b.intensity)))
      beat.intensity = clamp(Number(b.intensity), DIRECTOR_LIMITS.intensityMin, DIRECTOR_LIMITS.intensityMax)
    if (Number.isFinite(Number(b.transitionMs)))
      beat.transitionMs = clamp(
        Math.round(Number(b.transitionMs)),
        DIRECTOR_LIMITS.transitionMsMin,
        DIRECTOR_LIMITS.transitionMsMax
      )
    beats.push(beat)
    if (beats.length >= maxBeats) break
  }
  if (beats.length < minBeats) return { ok: false, reason: 'too-few-beats' }
  const intensity = clamp(Number(obj.intensity) || 1, DIRECTOR_LIMITS.intensityMin, DIRECTOR_LIMITS.intensityMax)
  const interrupt = obj.interrupt === true
  return { ok: true, plan: { text, beats, intensity, interrupt } }
}

/** 单动作兜底（LLM 计划非法/超时；台词仍用池句或已生成的 text）。 */
export const fallbackPlan = (kind = '', reason = 'fallback') => ({
  text: '',
  beats: [{ act: 'think', ms: 800 }],
  intensity: 1,
  interrupt: false,
  fallback: true,
  reason: String(reason || 'fallback'),
  kind: String(kind || '')
})

/** perf:<json> 通道 payload（pet 侧执行；A→act，B→clip）。 */
export const perfPayload = (plan, { kind = '', source = 'action-director', priority = 'normal', text = '' } = {}) =>
  JSON.stringify({
    v: 1,
    kind: String(kind || ''),
    source,
    priority,
    text: String(text || plan.text || ''),
    intensity: Number(plan.intensity) || 1,
    interrupt: plan.interrupt === true,
    beats: (plan.beats || []).map((b) => {
      const out = { act: String(b.act), ms: Math.round(Number(b.ms) || 800) }
      if (b.intensity != null) out.intensity = Number(b.intensity)
      if (b.transitionMs != null) out.transitionMs = Math.round(Number(b.transitionMs))
      return out
    }),
    onEnd: 'idle'
  })
