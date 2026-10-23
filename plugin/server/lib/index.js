/**
 * dsh-pet-bridge-v2 — P1.5 (first-day surprises) on top of the P1 pipe bridge.
 *
 * Event -> reaction map (all through the pet's named-pipe protocol v2):
 *   turn/start            -> say kaigong (+ optional dual inner layer)
 *   turn/end (completed)  -> say shougong; optional "report" bubble with numbers + act:stretch
 *   turn/end (other)      -> say anwei
 *   approval/asked        -> walk:center + say dengdai (urgent: bypass throttle & quiet hours)
 *   daily ritual timer    -> morning greeting (say kaigong + act:jump) / sleep 23:30 (walk:corner + say shenye)
 *   every turn/approval   -> update daily receipt file (pet double-click shows it)
 *
 * Guardrails: minGap / per-kind cooldown / chance / hourly & daily caps / quiet hours
 * (23:30-08:00; approval still urgent) / text de-dupe / failure silent.
 * No LLM in P1.5: lines come from the P0 pools (JSON), with embedded fallbacks.
 */

import net from 'node:net'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
import fs from 'node:fs'
import path from 'node:path'

const PIPE = '\\\\.\\pipe\\dafeiyu-pet-whale-single-instance'

const EMBEDDED = {
  kaigong: ['开工吧，我先趴这儿看着', '来了啊。水杯先备好，我盯着', '慢慢来，我不催你，我就在旁边'],
  ganhuo: ['我就在旁边，不吵你', '你忙你的，我盯着进度呢'],
  shougong: ['这轮收了，我记本子上了', '收工，肩膀放下来吧', '成了。账我记着，你先歇会儿'],
  anwei: ['没事，我等你', '别急，卡住就卡住，喝口水再来', '这轮不算，我们重来一次'],
  dengdai: ['这一步要你点个头哦', '在等你确认呢，别晾着我呀', '我举着牌子站这儿呢，等你'],
  shenye: ['快十二点了，收一收嘛', '灯关小点，你眼睛还要用很久', '我不催你了，我陪你坐着'],
  inner: {
    turnStart: ['（我就在旁边，不吵。）', '（今天要顺顺利利的呀。）'],
    turnEndOk: ['（账记好了。）', '（悄悄松了口气。）'],
    turnEndBad: ['（不怪他，重来就好。）'],
    approval: ['（我不走开。）'],
  },
  report: '这轮用了 {turns} 轮里的一轮，{seconds}s、约 {tokens}k token',
}

const DEFAULTS = {
  enabled: true,
  dryRun: false,
  pipe: PIPE,
  onlyCwd: '',
  skipSubagent: true,

  events: { turnStart: true, turnEnd: true, approval: true },
  chance: { turnStart: 0.55, turnEnd: 0.5, approval: 1, report: 0.85, dual: 0.4 },
  cooldownMs: { turnStart: 60000, turnEnd: 45000, approval: 15000, report: 90000 },
  minGapMs: 20000,
  maxPerHour: 20,
  maxPerDay: 300,
  quietHours: ['23:30-08:00'],

  walkOnApproval: true,
  dualLayer: true,
  dualDelayMs: 700,

  // P2: report is no longer "every turn"; fire at most once per N turns / interval
  report: { enabled: true, everyNTurns: 5, minIntervalMs: 300000, minTools: 2, minDurationMs: 15000 },
  reportOnTurnEnd: false,
  reportMinTools: 2,
  reportMinDurationMs: 15000,

  // P2: dynamic lines via ctx.llm (persona + reversal + IP words + keeper relation)
  llm: {
    enabled: true,
    provider: 'deepseek-official',
    model: 'deepseek-flash',
    timeoutMs: 2500,
    maxTokens: 90,
    temperature: 0.9,
    maxCallsPerDay: 300,
    budgetPerDayYuan: 1.0,
    costPer1kTokensYuan: 0.0015,
    maxChars: 40,
    pregen: true,
    pregenTtlMs: 600000,
    approvalUseLlm: false,
    includeRecentText: false, // privacy: never send raw user text
  },
  historyFile: '', // line de-dupe store (7 days / 300 lines)

  // P0 fixes (v9): attribution + bubble pacing
  attribution: { enabled: true, onlyActive: true, activeTtlMs: 1800000, bootstrapLastKnown: true, stateFile: '' },
  lifecycle: { autoStart: true, startScript: '', bootstrapScript: '', releaseZipUrl: '', bootstrapStateFile: '' },
  uiActionFile: '',
  petConfigFile: '',
  balancePush: { enabled: true, everyNTurns: 5, startup: true },
  petSettings: { size: 0.72, opacity: 1.0, mode: 'wander', lineFreq: '正常', passthrough: false, locked: false },
  bubble: {
    normalMs: 5000, innerMs: 3000, reportMs: 10000, approvalMs: 8000, nightMs: 6000,
    queueGapMs: 300, innerDelayMinMs: 1200, innerDelayMaxMs: 1800,
    coalesceWindowMs: 2000, maxQueue: 8,
  },

  morning: { enabled: true, hour: 8, minute: 0 },
  sleep: { enabled: true, hour: 23, minute: 30 },
  ritualWalk: true,

  poolsDir: '',
  receiptFile: '',
  maxReceiptLines: 4,
  testHookFile: '', // TEST ONLY: watch a JSON file to inject演出 events (default off)
  logFile: '',
  logLevel: 'info',
  stateFile: '',      // P3: read-only status snapshot for pet-bridge-ui (state.json)
  uiConfigFile: '',   // P3: UI-managed config sidecar (whitelist applied without reload)

  // P3 (A+B): animation feel / activity level / idle skit
  activity: 'normal', // quiet / normal / lively
  activityFile: '',   // plain text or JSON {"level":...}; changes apply without reload
  actions: {
    enabled: true,
    turnStartSpinChance: 0.2, // spec：20% 旋转，其余小跳
    toolEveryMs: 20000,
    longTaskMs: 100000,
    longTaskStepMs: 30000,
  },
  idleSkit: {
    enabled: true,
    eventGapMs: 180000,  // 至少 3 分钟没有任何会话事件才算"没人操作"
    minMs: 180000,       // 小剧场间隔 3~6 分钟
    maxMs: 360000,
  },
}

function merge(base, patch) {
  const out = { ...base }
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = { ...base[k], ...v }
    } else if (v !== undefined) out[k] = v
  }
  return out
}

const pad2 = (n) => String(n).padStart(2, '0')
const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
const hhmm = (d = new Date()) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`

function inRanges(now, ranges) {
  const cur = now.getHours() * 60 + now.getMinutes()
  return (ranges || []).some((r) => {
    const m = String(r).match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/)
    if (!m) return false
    const a = Number(m[1]) * 60 + Number(m[2])
    const b = Number(m[3]) * 60 + Number(m[4])
    return a <= b ? cur >= a && cur < b : cur >= a || cur < b
  })
}

function blocksToText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter((b) => b && typeof b.text === 'string').map((b) => b.text).join(' ').trim()
}

function clip(s, n) { return String(s || '').replace(/\s+/g, ' ').trim().slice(0, n) }

export const name = 'dsh-pet-bridge-v25'

export function apply(ctx, rawConfig) {
  const cfg = merge(DEFAULTS, rawConfig)
  const log = (level, msg, extra) => {
    if (cfg.logLevel !== 'debug' && level === 'debug') return
    const line = `[${new Date().toISOString()}] [${level}] ${msg}${extra === undefined ? '' : ' ' + safe(extra)}`
    try {
      if (cfg.logFile) {
        // rotate at ~5MB; previous file kept next to it with a timestamp suffix
        try {
          const st = fs.statSync(cfg.logFile)
          if (st.size >= (cfg.logMaxBytes || 5 * 1024 * 1024)) {
            const stamp = new Date().toISOString().replace(/[:.]/g, '-')
            fs.renameSync(cfg.logFile, cfg.logFile + '.' + stamp + '.old')
          }
        } catch {}
        fs.appendFileSync(cfg.logFile, line + '\n')
      }
      if (level !== 'debug') console.log('[pet-bridge-v25] ' + line)
    } catch {}
  }
  const safe = (v) => { try { return JSON.stringify(v) } catch { return String(v) } }

  // ---------- P0 pools ----------
  const pools = { kaigong: [], ganhuo: [], shougong: [], anwei: [], dengdai: [], shenye: [], inner: {} }
  const loadPools = () => {
    if (!cfg.poolsDir) return
    const read = (name) => {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(cfg.poolsDir, `${name}.json`), 'utf8'))
        const lines = (j.lines || []).map((x) => String(x.text || '').trim()).filter(Boolean)
        return lines
      } catch { return [] }
    }
    for (const k of ['kaigong', 'ganhuo', 'shougong', 'anwei', 'dengdai', 'shenye']) {
      const got = read(k)
      if (got.length) pools[k] = got
    }
  }
  loadPools()
  const pick = (pool, fallback = []) => {
    const lines = (pools[pool] && pools[pool].length ? pools[pool] : fallback.length ? fallback : EMBEDDED[pool]) || []
    if (!lines.length) return ''
    return lines[Math.floor(Math.random() * lines.length)]
  }
  const innerFor = (kind) => {
    const map = EMBEDDED.inner[kind] || []
    return map.length ? map[Math.floor(Math.random() * map.length)] : ''
  }

  // ---------- P2: persona / prompt / LLM generation / de-dupe / cost ----------
  const PERSONA = `你是"大肥鱼"，一条住在用户屏幕边的小鱼桌宠。
你不是助手，是一个陪着他过日子、偶尔自言自语的小家伙。
性格：温吞、清醒、会自嘲、会给自己打气、关心很具体、有分寸。
说话：8~20字为宜，最多2句；口语；少用感叹号；不用emoji；不用网络热词；
      不说教、不油腻、不灌鸡汤、不卖惨、不装懂、不复述他的隐私。
你知道自己是个程序，但不悲情：你接受自己帮不上大忙，只负责陪着。
[反转结构] 夸口/豪言/凶话开头，必须同句或紧接着一句自己收回、露馅（例："这活儿我包了——吧，我尽力。"）。
[IP 词表] token=白饭；干活=干饭；花费=这顿白饭；余额=饭碗/鱼粮；子代理=转包出去了；用户=饲养员/工友（偶尔反过来觉得是你在养他，自嘲，不索取）。
[关系] 你不是工具，是"赛博工友+被他养着的小家伙"；可以心疼他，但不索取关注、不制造愧疚。
[禁忌] 不说教、不油腻、不灌鸡汤、不过度卖萌、不装懂、不卖惨、不复述他的隐私；不用 emoji/网络热词；不出现"作为AI/建议您"；不编造他做过的事；深夜不说教不劝睡（最多一句轻的）。`

  const KIND_DESC = {
    turnStart: '他刚开始一轮工作，你想说一句让他在、又不打扰的话',
    turnEnd: '这一轮结束了，你想说一句收工/陪伴的话',
    turnEndBad: '这一轮没跑完/出错了，你想说一句只陪伴、不玩梗的话',
    report: '收工报账：像人替他记账',
    approval: '任务停下来等他点确认，你想说一句让他安心、顺便提醒点一下的话',
    morning: '早上第一轮，跟他打个招呼',
    sleep: '晚上 23:30 了，跟他说一句清醒的温柔',
    selfTalk: '没人理你，你在过自己的日子，心里嘀咕一句（心声体，短，像被偷听到的）',
  }

  const hist = []
  const loadHist = () => {
    if (!cfg.historyFile) return
    try {
      const arr = JSON.parse(fs.readFileSync(cfg.historyFile, 'utf8'))
      const cut = Date.now() - 7 * 86400e3
      for (const x of Array.isArray(arr) ? arr : []) if (x && x.text && Number(x.at) >= cut) hist.push({ text: String(x.text), at: Number(x.at) })
    } catch {}
  }
  loadHist()
  const saveHist = () => {
    if (!cfg.historyFile) return
    try {
      const cut = Date.now() - 7 * 86400e3
      while (hist.length && hist[0].at < cut) hist.shift()
      while (hist.length > 300) hist.shift()
      fs.writeFileSync(cfg.historyFile, JSON.stringify(hist.slice(-300)), 'utf8')
    } catch {}
  }
  const isDuplicate = (text) => {
    const now = Date.now()
    return hist.some((x) => x.text === text && now - x.at < 7 * 86400e3)
  }
  const rememberLine = (text, source) => {
    hist.push({ text, at: Date.now() })
    saveHist()
    log('debug', 'line remembered', { source, chars: text.length })
  }

  const llmDay = { day: dateKey(), calls: 0, tokens: 0, cost: 0 }
  const rollLlmDay = () => {
    const k = dateKey()
    if (llmDay.day !== k) { llmDay.day = k; llmDay.calls = 0; llmDay.tokens = 0; llmDay.cost = 0 }
  }
  const llmBudgetOk = () => {
    rollLlmDay()
    if (!cfg.llm.enabled) return false
    if (llmDay.calls >= cfg.llm.maxCallsPerDay) { log('info', 'llm budget: maxCallsPerDay', { calls: llmDay.calls }); return false }
    if (llmDay.cost >= cfg.llm.budgetPerDayYuan) { log('info', 'llm budget: cost', { cost: Number(llmDay.cost.toFixed(4)), limit: cfg.llm.budgetPerDayYuan }); return false }
    return true
  }
  const estimateCost = (tokens) => (tokens || 0) / 1000 * cfg.llm.costPer1kTokensYuan

  const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u
  const BANNED_RE = /(作为\s*AI|建议您|绝绝子|栓\s*Q|city\s*不\s*city|主人)/i
  const validateLine = (raw, opts = {}) => {
    let s = String(raw || '').trim()
    if (!s) return ''
    s = s.replace(/^["'“”‘’「」《》\s]+|["'“”‘’「」《》\s]+$/g, '')
    s = s.replace(/^[\-*\d.)、\s]+/, '')
    s = s.replace(/\s+/g, ' ').trim()
    if (EMOJI_RE.test(s) || BANNED_RE.test(s)) return ''
    const max = opts.maxChars || cfg.llm.maxChars || 40
    if (s.length > max) return ''
    if (/[0-9]/.test(s) && !opts.allowDigits) return ''
    if (!opts.allowDigits && s.length < 2) return ''
    return s
  }

  const timeBucket = () => {
    const h = new Date().getHours()
    if (h < 6) return '凌晨'; if (h < 9) return '早上'; if (h < 12) return '上午'
    if (h < 14) return '中午'; if (h < 18) return '下午'; if (h < 23) return '晚上'
    return '深夜'
  }
  const buildPrompt = (kind, s, extra = {}) => {
    const tools = s.tools || 0
    const toolBucket = tools === 0 ? '没动工具' : tools <= 3 ? '动了几个工具' : tools <= 10 ? '一直在动工具' : '工具没停过'
    const lines = [
      `[情境] ${KIND_DESC[kind] || kind}。当前时段：${timeBucket()}，今天第 ${stats.turns} 轮。`,
      `[抽象上下文] 这轮用了${toolBucket}；结果：${extra.outcome || '进行中'}；用时档：${extra.durBucket || '不长'}。`,
    ]
    if (extra.numbers) lines.push(`[数字槽位] ${extra.numbers}（原样使用，不要自己计算/改写）`)
    if (cfg.llm.includeRecentText && extra.recentUser) lines.push(`[最近一句] 用户：${extra.recentUser}`)
    lines.push(`[要求] 只输出一句中文台词（不要解释、不要引号、不要列表）。≤${cfg.llm.maxChars} 字，口语，可带括号心声体。`)
    lines.push('[输出格式] 只输出台词本身，不要解释、不要推理过程、不要任何前缀（如"我：""答："）、不要 Markdown/引号/列表。')
    lines.push('[避免] 最近说过：' + (hist.slice(-20).map((x) => x.text).join(' / ') || '（还没有）'))
    if (kind === 'sleep') lines.push('[禁忌] 不劝睡、不说教、不评价花费；可以只说"我在"。')
    if (kind === 'report') lines.push('[禁忌] 不卖惨、不评价金额高低；数字必须原样使用。')
    return lines.join('\n')
  }

  const callLlm = async (prompt, kind) => {
    let llm = null
    try { llm = typeof ctx.get === 'function' ? ctx.get('llm') : null } catch { llm = null }
    if (!llm || typeof llm.stream !== 'function') { log('info', 'llm unavailable'); return { text: '', latencyMs: 0, tokens: 0 } }
    const runOnce = async (attempt) => {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), cfg.llm.timeoutMs)
      const started = Date.now()
      let out = ''
      try {
        const stream = llm.stream({
          provider: cfg.llm.provider,
          model: cfg.llm.model,
          system: PERSONA,
          messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
          maxTokens: cfg.llm.maxTokens,
          temperature: cfg.llm.temperature,
          signal: ac.signal,
        })
        for await (const chunk of stream) {
          if (!chunk) continue
          if (chunk.type === 'text-delta' && typeof chunk.text === 'string') out += chunk.text
          else if (chunk.type === 'reasoning-delta') { /* reasoning text is ignored, never shown/logged */ }
          else if (chunk.type === 'finish') break
        }
      } catch (err) {
        log('warn', 'llm failed', { kind, attempt, error: err && (err.code || err.message || String(err)), latencyMs: Date.now() - started })
        return { text: '', latencyMs: Date.now() - started, tokens: 0 }
      } finally { clearTimeout(timer) }
      const tokens = Math.max(0, Math.ceil((out.length + prompt.length) / 2))
      return { text: out, latencyMs: Date.now() - started, tokens }
    }
    let r = await runOnce(1)
    if (!r.text.trim()) {
      log('info', 'llm empty-output retry', { kind, firstLatencyMs: r.latencyMs })
      const r2 = await runOnce(2)
      r = { text: r2.text, latencyMs: r.latencyMs + r2.latencyMs, tokens: r.tokens + r2.tokens }
    }
    rollLlmDay()
    llmDay.calls += 1
    llmDay.tokens += r.tokens
    llmDay.cost += estimateCost(r.tokens)
    log('info', 'llm call', { kind, latencyMs: r.latencyMs, tokens: r.tokens, callsToday: llmDay.calls, costToday: Number(llmDay.cost.toFixed(4)) })
    return r
  }

  const generate = async (kind, s, extra = {}) => {
    const fallback = () => {
      const poolName = kind === 'turnStart' ? 'kaigong' : kind === 'turnEnd' ? 'shougong' : kind === 'turnEndBad' ? 'anwei' : kind === 'approval' ? 'dengdai' : kind === 'morning' ? 'kaigong' : kind === 'sleep' ? 'shenye' : kind === 'selfTalk' ? 'ganhuo' : 'shougong'
      return { text: pick(poolName), source: 'pool', latencyMs: 0, tokens: 0 }
    }
    if (!llmBudgetOk()) { log('debug', 'llm fallback: budget/disabled', { kind }); return fallback() }
    const { text: raw, latencyMs, tokens } = await callLlm(buildPrompt(kind, s, extra), kind)
    const line = validateLine(raw, { allowDigits: kind === 'report', maxChars: cfg.llm.maxChars })
    if (!line && raw && kind === 'report') log('info', 'report too long/invalid -> fallback', { rawChars: String(raw).length, limit: cfg.llm.maxChars })
    if (!line || isDuplicate(line)) {
      if (line) log('info', 'llm rejected: duplicate', { kind, line })
      else if (raw) log('info', 'llm rejected: constraint', { kind, raw: clip(raw, 40) })
      return fallback()
    }
    return { text: line, source: 'llm', latencyMs, tokens }
  }

  const pregen = { at: 0, text: '' }

  // ---------- P3 (A+B): activity presets / actions / idle skit ----------
  const ACTIVITY_PRESETS = {
    quiet: {
      chance: { turnStart: 0.3, turnEnd: 0.3, approval: 1, report: 1, dual: 0.1 },
      minGapMs: 45000, cooldownScale: 2.0,
      toolEveryMs: 60000, idleMinMs: 540000, idleMaxMs: 720000, actionFactor: 0.3,
    },
    normal: {
      // 默认"正常偏活泼"：概率 ×1.2、minGap 17s、小剧场 6~9 分钟、微动画 ×1.15
      chance: { turnStart: 0.66, turnEnd: 0.66, approval: 1, report: 1, dual: 0.66 },
      minGapMs: 17000, cooldownScale: 0.9,
      toolEveryMs: 12000, idleMinMs: 360000, idleMaxMs: 540000, actionFactor: 1.15,
    },
    lively: {
      chance: { turnStart: 0.85, turnEnd: 0.85, approval: 1, report: 1, dual: 0.75 },
      minGapMs: 10000, cooldownScale: 0.5,
      toolEveryMs: 8000, idleMinMs: 180000, idleMaxMs: 300000, actionFactor: 1.3,
    },
  }
  const activityState = { level: 'normal', ...ACTIVITY_PRESETS.normal }
  let lastActivityRaw = ''
  let nextSkitAt = 0
  function scheduleNextSkit() {
    const min = cfg.idleSkit?.minMs || 180000
    const max = Math.max(min, cfg.idleSkit?.maxMs || 360000)
    const lo = Math.min(min, activityState.idleMinMs || min)
    const hi = Math.max(lo, Math.min(max, activityState.idleMaxMs || max))
    nextSkitAt = Date.now() + lo + Math.random() * (hi - lo)
  }
  function applyActivity(level) {
    const key = ACTIVITY_PRESETS[level] ? level : 'normal'
    const preset = ACTIVITY_PRESETS[key]
    activityState.level = key
    activityState.chance = { ...preset.chance }
    activityState.minGapMs = preset.minGapMs
    activityState.cooldownScale = preset.cooldownScale
    activityState.toolEveryMs = preset.toolEveryMs
    activityState.idleMinMs = preset.idleMinMs
    activityState.idleMaxMs = preset.idleMaxMs
    activityState.actionFactor = preset.actionFactor
    scheduleNextSkit()
    log('info', 'activity preset', { level: key, minGapMs: preset.minGapMs, chances: preset.chance })
  }
  let lastEventAt = Date.now()
  let lastToolActAt = 0
  let toolActionSeq = 0
  let lastLongStepAt = 0
  let lastSkitAt = 0
  const act = (name) => {
    if (!cfg.enabled || !cfg.actions?.enabled) return
    send('act:' + name)
    log('debug', 'act', { name })
  }
  const walkNear = () => {
    if (!cfg.enabled || !cfg.actions?.enabled) return
    send('walk:nearby')
    log('debug', 'walk nearby')
  }
  const pollActivityFile = () => {
    if (!cfg.activityFile) return
    try {
      const raw = fs.readFileSync(cfg.activityFile, 'utf8').trim()
      if (raw === lastActivityRaw) return
      lastActivityRaw = raw
      let level = raw
      try { const j = JSON.parse(raw); level = j.level || j.activity || raw } catch {}
      level = String(level || '').trim().toLowerCase()
      if (ACTIVITY_PRESETS[level]) applyActivity(level)
    } catch {}
  }
  applyActivity(cfg.activity || 'normal')
  // v10 lifecycle: DSH 启动时自动拉起桌宠（幂等：start-pet.ps1 会先检查）
  if (cfg.lifecycle?.autoStart && cfg.lifecycle.startScript) {
    setTimeout(() => {
      let ok = false
      try {
        const s = net.connect(cfg.pipe)
        s.setTimeout(800)
        s.on('connect', () => { ok = true; try { s.write('ping\n') } catch {}; s.destroy() })
        s.on('error', () => {})
        s.on('timeout', () => { try { s.destroy() } catch {} })
        setTimeout(() => {
          if (!ok) {
            try {
              const cp = require('node:child_process')
              const boot = cfg.lifecycle.bootstrapScript || cfg.lifecycle.startScript
              const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', boot]
              if (cfg.lifecycle.releaseZipUrl) args.push('-ReleaseUrl', cfg.lifecycle.releaseZipUrl)
              const ch = cp.spawn('powershell.exe', args, { detached: true, stdio: ['ignore', 'ignore', 'pipe'] }); ch.on('error', (e) => log('warn', 'spawn error', String(e && e.message))); ch.on('exit', (code) => log('info', 'spawn exit', { code })); ch.stderr && ch.stderr.on('data', (b) => log('warn', 'spawn stderr', String(b).slice(0, 300))); ch.unref()
              log('info', 'bootstrap pet spawned', { script: boot, release: !!cfg.lifecycle.releaseZipUrl })
            } catch (e) { log('warn', 'bootstrap spawn failed', String(e && e.message)) }
          }
        }, 1400)
      } catch {}
    }, 1500)
  }

  // ---- P3: state.json (for dsh-pet-bridge-ui) + ui-config.json hot apply ----
  const recentSay = []
  let petOnline = false
  const refreshPetOnline = () => {
    try {
      const sock = net.connect(cfg.pipe)
      let done = false
      sock.setTimeout(500)
      sock.on('connect', () => { petOnline = true; try { sock.write('ping\n') } catch {} })
      sock.on('data', () => { petOnline = true })
      sock.on('end', () => { if (!done) { done = true; petOnline = true } })
      sock.on('error', () => { if (!done) { done = true } })
      sock.on('timeout', () => { if (!done) { done = true }; try { sock.destroy() } catch {} })
    } catch { petOnline = false }
  }
  let lastAction = null
  let balanceTurns = 0
  let balanceStartupPushed = false
  let petSettingsPushed = false
  const petCmd = (line) => { try { send(line) } catch {} }
  const applyPetSettings = (petCfg) => {
    if (!petCfg || typeof petCfg !== 'object') return
    const map = { size: 'size', opacity: 'opacity', mode: 'mode', lineFreq: 'lineFreq',
      passthrough: 'passthrough', locked: 'locked', bubbleStyle: 'bubbleStyle',
      topmost: 'topmost', snap: 'snap', layer: 'layer', skin: 'skin',
      soundOn: 'soundOn', volume: 'volume', musicLink: 'musicLink', doubleClick: 'doubleClick' }
    const out = {}
    for (const [k, cmdKey] of Object.entries(map)) if (petCfg[k] !== undefined) out[cmdKey] = petCfg[k]
    if (petCfg.city !== undefined) out.city = petCfg.city
    if (petCfg.quietMinutes !== undefined) out.quiet = petCfg.quietMinutes
    if (Object.keys(out).length) {
      petCmd('cmd:config:' + JSON.stringify(out))
      cfg.petSettings = { ...(cfg.petSettings || {}), ...petCfg }
      log('info', 'pet settings pushed', out)
    }
  }
  const runPsFile = (tag, content) => {
    try {
      const cp = require('node:child_process')
      const dir = cfg.lifecycle.bootstrapStateFile ? path.dirname(cfg.lifecycle.bootstrapStateFile) : path.join(process.env.USERPROFILE || '.', 'pet-work')
      const logs = path.join(dir, 'logs')
      try { fs.mkdirSync(logs, { recursive: true }) } catch {}
      const file = path.join(logs, 'ui-action-' + String(tag).replace(/[^A-Za-z0-9._-]/g, '_') + '.ps1')
      fs.writeFileSync(file, '\ufeff' + content, 'utf8')
      const ch = cp.spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file], { detached: true, stdio: ['ignore', 'ignore', 'pipe'] })
      ch.on('error', (e) => log('warn', 'ui-action spawn error', String(e && e.message)))
      ch.on('exit', (code) => log('info', 'ui-action ps exit', { tag, code }))
      if (ch.stderr) ch.stderr.on('data', (b) => log('warn', 'ui-action ps stderr', String(b).slice(0, 300)))
      ch.unref()
      log('info', 'ui-action ps started', { tag, file })
    } catch (e) { log('warn', 'runPsFile failed', String(e && e.message)) }
  }
  const spawnScript = (extraArg) => {
    const cp = require('node:child_process')
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', cfg.lifecycle.startScript]
    if (extraArg) args.push(extraArg)
    try { const ch = cp.spawn('powershell.exe', args, { detached: true, stdio: ['ignore', 'ignore', 'pipe'] }); ch.on('error', (e) => log('warn', 'spawn error', String(e && e.message))); ch.on('exit', (code) => log('info', 'spawn exit', { code })); ch.stderr && ch.stderr.on('data', (b) => log('warn', 'spawn stderr', String(b).slice(0, 300))); ch.unref() } catch {}
  }
  const consumeUiAction = () => {
    if (!cfg.uiActionFile) return
    try {
      const raw = fs.readFileSync(cfg.uiActionFile, 'utf8')
      const j = JSON.parse(raw)
      if (!j || !j.name || j.handledAt) return
      const aid = String(j.id || '')
      let status = 'done', message = ''
      try {
        if (j.name === 'restart-pet') {
          send('cmd:restart')
        } else if (j.name === 'start-pet') {
          spawnScript()
        } else if (j.name === 'quit-pet' || j.name === 'stop-pet') {
          send('cmd:exit')
        } else if (j.name === 'enable-autostart' || j.name === 'disable-autostart') {
          const startup = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
          const cmdFile = path.join(startup, '大肥鱼桌宠.cmd')
          const sp = cfg.lifecycle.startScript || ''
          if (j.name === 'enable-autostart') {
            try {
              fs.mkdirSync(startup, { recursive: true })
              fs.writeFileSync(cmdFile, '@echo off\r\npowershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + sp + '"\r\n', 'utf8')
            } catch (e) { status = 'failed'; message = String(e && e.message) }
          } else {
            try { fs.unlinkSync(cmdFile) } catch {}
          }
        } else { status = 'failed'; message = 'unsupported action' }
      } catch (e) { status = 'failed'; message = String(e && e.message) }
      lastAction = { id: String(j.id || ''), name: j.name, status, at: new Date().toISOString(), message }
      j.handledAt = new Date().toISOString(); j.status = status
      try { fs.writeFileSync(cfg.uiActionFile, JSON.stringify(j)) } catch {}
      log('info', 'ui-action handled', lastAction)
      writeState()
    } catch {}
  }

  const writeState = () => {
    if (!cfg.stateFile) return
    try {
      const state = {
        updatedAt: new Date().toISOString(),
        host: true,
        pet: petOnline,
        pipe: petOnline,
        enabled: cfg.enabled,
        activity: activityState.level,
        quietHours: cfg.quietHours,
        inQuietHours: quietNow(),
        todayCalls: llmDay.calls,
        todayCost: Number(llmDay.cost.toFixed(4)),
        budgetPerDayYuan: cfg.llm.budgetPerDayYuan,
        llmEnabled: cfg.llm.enabled,
        provider: cfg.llm.provider,
        model: cfg.llm.model,
        recentSay: recentSay.slice(-10),
        version: '0.25.0',
        petVersion: 'v1.1.5+patch-v25',
        lastAction,
        petSettings: cfg.petSettings || {},
        bubble: cfg.bubble || {},
        attribution: { active: activeSessionId ? String(activeSessionId).slice(0, 16) : null, bootstrapped: attributionBootstrapped },
        skins: (() => { try { const pc = JSON.parse(fs.readFileSync(cfg.petConfigFile, 'utf8')); return { current: pc.skin || '大肥鱼', available: ['大肥鱼'] } } catch { return { current: '大肥鱼', available: ['大肥鱼'] } } })(),
        capabilities: { petActions: ['balance', 'weather', 'music', 'summary', 'show', 'hide', 'snapInto', 'recover'], doubleClick: true, skin: true, quiet: true, quit: true, autoStart: true },
        bootstrap: (() => { try { return JSON.parse(fs.readFileSync(cfg.lifecycle.bootstrapStateFile, 'utf8')) } catch { return null } })(),
        logsRecent: [],
      }
      fs.writeFileSync(cfg.stateFile, JSON.stringify(state), 'utf8')
    } catch {}
  }
  let lastUiRaw = ''
  const pollUiConfig = () => {
    if (!cfg.uiConfigFile) return
    try {
      const raw = fs.readFileSync(cfg.uiConfigFile, 'utf8')
      if (raw === lastUiRaw) return
      lastUiRaw = raw
      const j = JSON.parse(raw)
      const applied = {}
      if (typeof j.enabled === 'boolean') { cfg.enabled = j.enabled; applied.enabled = j.enabled }
      if (Array.isArray(j.quietHours)) {
        const ok = j.quietHours.filter((r) => typeof r === 'string' && /^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(r))
        if (ok.length) { cfg.quietHours = ok; applied.quietHours = ok }
      }
      if (j.llm && Number.isFinite(Number(j.llm.budgetPerDayYuan))) {
        cfg.llm.budgetPerDayYuan = Number(j.llm.budgetPerDayYuan)
        applied.budgetPerDayYuan = cfg.llm.budgetPerDayYuan
      }
      if (j.pet && typeof j.pet === 'object') { applyPetSettings(j.pet); applied.pet = Object.keys(j.pet) }
      if (j.bubble && typeof j.bubble === 'object') {
        const b = cfg.bubble || {}
        for (const k of ['normalMs', 'innerMs', 'reportMs', 'approvalMs', 'nightMs', 'queueGapMs']) {
          if (Number.isFinite(Number(j.bubble[k]))) b[k] = Number(j.bubble[k])
        }
        if (j.pet && Number.isFinite(Number(j.pet.bubbleMs))) {
          b.normalMs = Number(j.pet.bubbleMs)
          b.innerMs = Math.max(3000, Math.round(b.normalMs * 0.6))
        }
        cfg.bubble = b
        applied.bubble = { normalMs: b.normalMs, innerMs: b.innerMs, reportMs: b.reportMs }
      }
      if (typeof j.activity === 'string' && ACTIVITY_PRESETS[j.activity]) { applyActivity(j.activity); applied.activity = j.activity }
      log('info', 'ui-config applied', applied)
      writeState()
    } catch {}
  }


  // ---------- pipe (short connection per line, silent failures) ----------
  function send(line) {
    if (cfg.dryRun) { log('info', 'dryRun send', { line }); return }
    const payload = line + '\n'
    let wrote = false
    const attempt = (n) => {
      const sock = net.connect(cfg.pipe)
      let settled = false
      sock.setTimeout(600)
      sock.on('connect', () => { sock.write(payload); wrote = true; sock.end() })
      sock.on('data', () => {})
      sock.on('timeout', () => { if (!settled) { settled = true; sock.destroy(); log('warn', 'pipe timeout') } })
      sock.on('error', (err) => {
        if (settled) return
        settled = true
        sock.destroy()
        if (!wrote && n < 1) { setTimeout(() => attempt(n + 1), 60); return }
        if (!wrote) log('warn', 'pipe unavailable', err.code || err.message)
      })
    }
    try { attempt(0) } catch (e) { log('warn', 'pipe send threw', e && e.message) }
  }
  // ---------- P0 v9: bubble queue (serial, coalesce, configurable durations) ----------
  const bubbleQ = []
  let bubbleBusyUntil = 0
  let activeSessionId = null
  let activeAt = 0
  let attributionBootstrapped = false
  if (cfg.attribution?.enabled && cfg.attribution.bootstrapLastKnown !== false && cfg.attribution.stateFile) {
    try {
      const j = JSON.parse(fs.readFileSync(cfg.attribution.stateFile, "utf8"))
      if (j && j.sessionId) {
        activeSessionId = j.sessionId
        activeAt = Date.now()
        attributionBootstrapped = true
        log('info', 'attribution bootstrap', { session: String(j.sessionId).slice(0, 16), from: 'last-known' })
      }
    } catch {}
  }
  if (!attributionBootstrapped && cfg.attribution?.bootstrapLastKnown !== false) {
    try {
      const txt = fs.readFileSync(cfg.logFile, 'utf8')
      const ids = [...txt.matchAll(/"session":"(session-[^"]+)"/g)].map((m) => m[1])
      const last = ids.length ? ids[ids.length - 1] : ''
      if (last) {
        activeSessionId = last
        activeAt = Date.now()
        attributionBootstrapped = true
        log('info', 'attribution bootstrap', { session: last.slice(0, 16), from: 'log' })
        try {
          if (cfg.attribution?.stateFile) fs.writeFileSync(cfg.attribution.stateFile, JSON.stringify({ sessionId: last, at: new Date().toISOString(), source: 'log' }))
        } catch {}
      }
    } catch {}
  }
  const attrSkipLogAt = {}
  const bubbleDurFor = (kind, style) => {
    const b = cfg.bubble || {}
    if (kind === 'inner') return b.innerMs || 3000
    if (style === 'report') return b.reportMs || 8000
    if (style === 'remind' || style === 'approval') return b.approvalMs || 8000
    if (style === 'night') return b.nightMs || 6000
    return b.normalMs || 5000
  }
  const bubblePrio = (kind, style) => {
    if (style === 'remind' || style === 'approval') return 100
    if (style === 'report') return 90
    if (kind === 'turnEndBad') return 80
    if (kind === 'turnEnd') return 70
    if (style === 'night') return 65
    if (kind === 'turnStart') return 60
    if (style === 'greet') return 55
    if (kind === 'inner') return 20
    return 40
  }
  const enqueueBubble = (text, kind, meta = {}) => {
    const t = clip(text, 60)
    if (!t || !cfg.enabled) return false
    const style = meta.style || ''
    bubbleQ.push({ text: t, kind, style, source: meta.source || 'pool', durMs: bubbleDurFor(kind, style), prio: bubblePrio(kind, style), at: Date.now(), latencyMs: meta.latencyMs ?? null, tokens: meta.tokens ?? null })
    if (bubbleQ.length > (cfg.bubble?.maxQueue || 8)) bubbleQ.shift()
    log('info', 'bubble queue', { kind, style: style || 'normal', q: bubbleQ.length })
    return true
  }
  const sendBubble = (item) => {
    const sec = Math.max(1, Math.min(30, Math.round(item.durMs / 1000)))
    recentSay.push({ at: new Date().toISOString(), kind: item.kind, source: item.source, line: item.text })
    if (recentSay.length > 10) recentSay.shift()
    log('info', 'say', { kind: item.kind, style: item.style || 'normal', source: item.source, line: item.text, latencyMs: item.latencyMs, tokens: item.tokens, callsToday: llmDay.calls, costToday: Number(llmDay.cost.toFixed(4)), showMs: sec * 1000 })
    if (item.kind === 'inner') send('inner3:' + sec + '|' + item.text)
    else send('say3:' + sec + '|' + item.style + '|' + item.text)
    bubbleBusyUntil = Date.now() + item.durMs
  }
  const flushBubbleQueue = () => {
    try {
      const now = Date.now()
      if (now < bubbleBusyUntil + (cfg.bubble?.queueGapMs || 300)) return
      if (!bubbleQ.length) return
      const win = cfg.bubble?.coalesceWindowMs || 2000
      if (bubbleQ.length > 1 && now - bubbleQ[0].at <= win) {
        bubbleQ.sort((a, b) => b.prio - a.prio)
        const keep = bubbleQ.shift()
        const dropped = bubbleQ.length
        bubbleQ.length = 0
        if (dropped) log('info', 'bubble coalesced', { kept: keep.kind, dropped })
        sendBubble(keep)
        return
      }
      bubbleQ.sort((a, b) => b.prio - a.prio)
      sendBubble(bubbleQ.shift())
    } catch {}
  }
  const bubbleTimer = setInterval(flushBubbleQueue, 250)
  const say = (text, kind, meta = {}) => {
    const ok = enqueueBubble(text, kind, meta)
    if (!ok) return
    const dualChance = (activityState.chance && activityState.chance.dual) ?? cfg.chance.dual ?? 0
    if (cfg.dualLayer && kind !== 'inner' && Math.random() < dualChance) {
      const inner = innerFor(kind)
      if (inner) {
        const lo = cfg.bubble?.innerDelayMinMs || 1200
        const hi = Math.max(lo, cfg.bubble?.innerDelayMaxMs || 1800)
        const delay = lo + Math.random() * (hi - lo)
        setTimeout(() => { log('info', 'inner queued', { kind, delayMs: Math.round(delay) }); enqueueBubble(inner, 'inner', { source: 'pool' }) }, delay)
      }
    }
  }

  // ---------- throttle ----------
  const lastKindAt = new Map()
  const recentLines = []
  let lastSaidAt = 0
  const hourStamps = []
  let dayKey = ''
  let dayCount = 0
  const nowCount = () => {
    const k = dateKey()
    if (k !== dayKey) { dayKey = k; dayCount = 0 }
    return dayCount
  }
  const hourCount = () => {
    const cut = Date.now() - 3600e3
    while (hourStamps.length && hourStamps[0] < cut) hourStamps.shift()
    return hourStamps.length
  }
  const quietNow = () => inRanges(new Date(), cfg.quietHours)
  const canSpeak = (kind, urgent = false, opts = {}) => {
    if (!cfg.enabled) return false
    if (quietNow() && !urgent) return false
    const now = Date.now()
    if (!urgent) {
      if (!opts.ignoreMinGap && now - lastSaidAt < (activityState.minGapMs || cfg.minGapMs)) { log('debug', 'skip throttle: minGap', { kind }); return false }
      const cd = (cfg.cooldownMs[kind] || 0) * (activityState.cooldownScale || 1)
      if (now - (lastKindAt.get(kind) || 0) < cd) { log('debug', 'skip throttle: cooldown', { kind }); return false }
    }
    if (hourCount() >= cfg.maxPerHour) { log('debug', 'skip throttle: maxPerHour', { kind }); return false }
    if (nowCount() >= cfg.maxPerDay) { log('debug', 'skip throttle: maxPerDay', { kind }); return false }
    if (!urgent && Math.random() > ((activityState.chance && activityState.chance[kind]) ?? cfg.chance[kind] ?? 1)) { log('debug', 'skip throttle: chance', { kind }); return false }
    return true
  }
  const remember = (kind, text) => {
    lastSaidAt = Date.now()
    hourStamps.push(lastSaidAt)
    nowCount()
    dayCount += 1
    lastKindAt.set(kind, lastSaidAt)
    recentLines.push({ text, at: Date.now() })
    while (recentLines.length && recentLines[0].at < Date.now() - 30 * 60e3) recentLines.shift()
  }
  const speak = (kind, text, opts = {}) => {
    const t = clip(text, 60)
    if (!t) return false
    if (!opts.force && !canSpeak(kind, opts.urgent, opts)) return false
    if (recentLines.some((x) => x.text === t)) { log('debug', 'skip throttle: duplicate', { kind }); return false }
    remember(kind, t)
    rememberLine(t, opts.source || 'pool')
    say(t, kind, opts)
    return true
  }

  // ---------- daily stats & receipt ----------
  const stats = {
    day: dateKey(),
    turns: 0,
    tools: 0,
    tokens: 0,
    longestMs: 0,
    approvals: 0,
  }
  const rollStats = () => {
    const k = dateKey()
    if (stats.day !== k) {
      stats.day = k; stats.turns = 0; stats.tools = 0; stats.tokens = 0; stats.longestMs = 0; stats.approvals = 0
    }
  }
  const reportState = { turnsSince: 0, lastAt: 0 }

  let receiptLastWrite = 0
  const writeReceipt = () => {
    if (!cfg.receiptFile) return
    if (Date.now() - receiptLastWrite < 1000) return
    receiptLastWrite = Date.now()
    rollStats()
    const d = new Date()
    const lines = [
      `今日小票｜${d.getMonth() + 1}月${d.getDate()}日`,
      `轮次 ${stats.turns} · 工具 ${stats.tools} 次`,
      `最长一轮 ${Math.round(stats.longestMs / 1000)}s · 共 ${(stats.tokens / 1000).toFixed(1)}k token`,
      `等你点头 ${stats.approvals} 次`,
    ].slice(0, cfg.maxReceiptLines || 4)
    try {
      const tmp = cfg.receiptFile + '.tmp'
      fs.writeFileSync(tmp, lines.join('\n') + '\n', 'utf8')
      fs.renameSync(tmp, cfg.receiptFile)
      log('debug', 'receipt written', { lines })
    } catch (e) { log('debug', 'receipt write failed', e && e.message) }
  }

  // ---------- per-session summary ----------
  const sessions = new Map()
  const summaryOf = (session) => {
    const id = session.id
    let s = sessions.get(id)
    if (!s) {
      s = { id, cwd: session.header?.cwd || '', turnStartAt: 0, tools: 0, tokens: 0, events: 0 }
      sessions.set(id, s)
      if (sessions.size > 50) sessions.delete(sessions.keys().next().value)
    }
    return s
  }
  const passesFilter = (session) => {
    const h = session.header || {}
    if (cfg.skipSubagent && (h.origin === 'subagent' || (h.delegationDepth ?? 0) > 0)) return false
    if (cfg.onlyCwd) {
      const cwd = String(h.cwd || '').replace(/[\\/]+$/, '')
      const want = String(cfg.onlyCwd).replace(/[\\/]+$/, '')
      if (cwd !== want && !cwd.startsWith(want + '\\') && !cwd.startsWith(want + '/')) return false
    }
    return true
  }

  // ---------- event handlers ----------
  const onEvent = (session, event) => {
    if (!session || !event || !event.type) return
    if (!passesFilter(session)) return
    lastEventAt = Date.now()
    rollStats()
    const s = summaryOf(session)
    const t = event.type
    const d = event.data || {}
    log('debug', 'event', { type: t, session: String(session.id || '').slice(0, 14) })

    const hdr = session.header || {}
    if (t === 'user/message') {
      const srcKind = d.source && d.source.kind
      const denyOrigin = hdr.origin && ['subagent', 'teammate', 'team', 'delegate', 'background', 'tool'].includes(String(hdr.origin).toLowerCase())
      if (srcKind === 'user' && !denyOrigin && (hdr.delegationDepth ?? 0) === 0) {
        activeSessionId = session.id
        activeAt = Date.now()
        try {
          if (cfg.attribution?.stateFile) fs.writeFileSync(cfg.attribution.stateFile, JSON.stringify({ sessionId: session.id, at: new Date().toISOString(), cwd: hdr.cwd || '' }))
        } catch {}
        log('info', 'attribution active', { session: String(session.id).slice(0, 16) })
      }
    }
    if (!attrSkipLogAt['hdr:' + String(session.id)]) {
      attrSkipLogAt['hdr:' + String(session.id)] = Date.now()
      log('info', 'attribution header', { session: String(session.id).slice(0, 16), origin: hdr.origin ?? null, depth: hdr.delegationDepth ?? 0, cwd: hdr.cwd ? 'set' : 'none' })
    }
    if (cfg.attribution?.enabled && cfg.attribution.onlyActive) {
      const denyOrigin2 = hdr.origin && ['subagent', 'teammate', 'team', 'delegate', 'background', 'tool'].includes(String(hdr.origin).toLowerCase())
      const sid = String(session.id)
      const aid = activeSessionId ? String(activeSessionId) : ''
      const activeMatch = !!aid && (sid === aid || sid.startsWith(aid))
      if (activeMatch && !denyOrigin2 && sid !== aid) {
        // 启动 bootstrap 可能来自日志里的截断 id（16 字符）；命中后升级为完整 id 并持久化
        activeSessionId = session.id
        activeAt = Date.now()
        try { if (cfg.attribution?.stateFile) fs.writeFileSync(cfg.attribution.stateFile, JSON.stringify({ sessionId: sid, at: new Date().toISOString(), upgraded: true })) } catch {}
        log('info', 'attribution upgraded', { session: sid.slice(0, 16) })
      }
      const okay = activeMatch && !denyOrigin2
        && (hdr.delegationDepth ?? 0) === 0
        && Date.now() - activeAt <= (cfg.attribution.activeTtlMs || 1800000)
      if (!okay) {
        const key = String(session.id)
        if (!attrSkipLogAt[key] || Date.now() - attrSkipLogAt[key] > 60000) {
          attrSkipLogAt[key] = Date.now()
          log('info', 'attribution skip', { session: key.slice(0, 16), reason: hdr.origin ? ('origin:' + hdr.origin) : 'not-active', active: activeSessionId ? String(activeSessionId).slice(0, 16) : null })
        }
        return
      }
    }

    if (t === 'user/message' || t === 'system/message' || t === 'request/header') return
    if (t === 'tool/call') {
      s.tools += 1; stats.tools += 1
      if (cfg.actions?.enabled && activityState.level !== 'quiet'
          && Date.now() - lastToolActAt >= (activityState.toolEveryMs || cfg.actions.toolEveryMs || 20000)) {
        lastToolActAt = Date.now(); toolActionSeq += 1
        act('peek')                                  // 转头
        setTimeout(() => walkNear(), 450)            // 小跑两步
      }
      return
    }
    if (t === 'assistant/message') {
      const u = d.usage
      if (u) s.tokens += Number(u.totalTokens ?? (Number(u.inputTokens || 0) + Number(u.outputTokens || 0))) || 0
      return
    }
    if (t === 'turn/start') {
      s.turnStartAt = Date.now(); s.tools = 0
      stats.turns += 1
      if (cfg.actions?.enabled) {
        send('freeze:900')   // 先停步，再小跳/旋转（spec：停步 + 小跳 0.7s，20% 旋转）
        act(Math.random() < (cfg.actions.turnStartSpinChance ?? 0.2) ? 'spin' : 'jump')
      }
      if (cfg.events.turnStart && canSpeak('turnStart')) {
        const fresh = pregen.text && Date.now() - pregen.at < (cfg.llm.pregenTtlMs || 600000)
        if (fresh) {
          const cached = pregen.text
          pregen.text = ''
          log('info', 'use pregen line', { kind: 'turnStart' })
          speak('turnStart', cached, { force: true, source: 'llm-pregen' })
        } else {
          void generate('turnStart', s).then((g) => speak('turnStart', g.text, { force: true, source: g.source, latencyMs: g.latencyMs, tokens: g.tokens }))
        }
      }
      return
    }
    if (t === 'turn/end') {
      const dur = s.turnStartAt ? Date.now() - s.turnStartAt : 0
      const durBucket = dur < 15000 ? '很快' : dur < 60000 ? '一会儿' : '挺久'
      stats.longestMs = Math.max(stats.longestMs, dur)
      stats.tokens += s.tokens
      s.tokens = 0
      const ok = String(d.reason?.kind || '') === 'completed'
      if (cfg.actions?.enabled) {
        if (ok) act('stretch')
        else { act('shake'); setTimeout(() => send('freeze:6000'), 500); setTimeout(() => send('cmd:fx:sweat'), 900) }   // 报错：摇头 0.4s + 定格 6s + 汗滴
      }
      lastLongStepAt = 0
      if (cfg.events.turnEnd && canSpeak(ok ? 'turnEnd' : 'turnEndBad')) {
        const kind = ok ? 'turnEnd' : 'turnEndBad'
        void generate(kind, s, { outcome: ok ? '成功' : '没跑完', durBucket })
          .then((g) => speak(kind, g.text, { force: true, source: g.source, latencyMs: g.latencyMs, tokens: g.tokens }))
        // pregenerate next turn's opening line while idle
        if (cfg.llm.pregen && cfg.llm.enabled) {
          void generate('turnStart', s).then((g) => {
            if (g.source === 'llm') { pregen.text = g.text; pregen.at = Date.now(); log('debug', 'pregen cached', { text: g.text }) }
          })
        }
      }
      // interval report: every N turns AND at least minInterval
      reportState.turnsSince += 1
      if (ok && cfg.report.enabled && reportState.turnsSince >= (cfg.report.everyNTurns || 5)
          && Date.now() - reportState.lastAt >= (cfg.report.minIntervalMs || 0)
          && s.tools >= (cfg.report.minTools || 0) && dur >= (cfg.report.minDurationMs || 0)) {
        reportState.turnsSince = 0
        reportState.lastAt = Date.now()
        const numbers = `turns=${stats.turns} tokens=${stats.tokens} cost=${llmDay.cost.toFixed(4)}元`
        void generate('report', s, { outcome: '成功', durBucket, numbers })
          .then((g) => { if (speak('report', g.text, { source: g.source, latencyMs: g.latencyMs, tokens: g.tokens, ignoreMinGap: true })) setTimeout(() => send('act:stretch'), 600) })
      }
      // 去 key：DSH 侧统计今日用量并推送余额/用量给桌宠（不依赖桌宠 key，不伪造余额）
      if (cfg.balancePush?.enabled) {
        balanceTurns += 1
        if (balanceTurns % (cfg.balancePush.everyNTurns || 5) === 0) {
          try {
            send('bal:' + '不可查（走DSH渠道）' + '|' + '今日 ¥' + llmDay.cost.toFixed(4) + '（DSH统计）')
            log('info', 'balance pushed', { costToday: Number(llmDay.cost.toFixed(4)) })
          } catch {}
        }
      }
      writeReceipt()
      return
    }
    if (t === 'approval/asked') {
      if (!cfg.events.approval) return
      stats.approvals += 1
      const go = () => {
        if (cfg.walkOnApproval) {
          send('walk:center')
          setTimeout(() => send('freeze:3000'), 700)   // 走到中央后站定
        }
        speak('approval', pick('dengdai'), { urgent: true, source: 'pool', style: 'remind' })
        writeReceipt()
      }
      setTimeout(go, cfg.walkOnApproval ? 120 : 0)
    }
    if (t === 'session/created') sessions.delete(session.id)
  }

  ctx.on('session/event', onEvent)

  // ---------- rituals (morning / sleep) ----------
  const ritualDone = { date: '', morning: false, sleep: false }
  const timer = setInterval(() => {
    try {
      const now = new Date()
      const k = dateKey(now)
      if (ritualDone.date !== k) { ritualDone.date = k; ritualDone.morning = false; ritualDone.sleep = false }
      const m = now.getHours() * 60 + now.getMinutes()
      if (cfg.morning?.enabled && !ritualDone.morning) {
        const mm = cfg.morning.hour * 60 + cfg.morning.minute
        if (m >= mm && m <= mm + 1) {
          ritualDone.morning = true
          if (!quietNow()) {
            speak('morning', pick('kaigong'), { urgent: false, style: 'greet' })
            setTimeout(() => send('act:jump'), 500)
          }
        }
      }
      if (cfg.sleep?.enabled && !ritualDone.sleep) {
        const sm = cfg.sleep.hour * 60 + cfg.sleep.minute
        if (m >= sm && m <= sm + 1) {
          ritualDone.sleep = true
          if (cfg.ritualWalk) send('walk:corner')
          setTimeout(() => speak('sleep', pick('shenye'), { urgent: true, style: 'night' }), cfg.ritualWalk ? 900 : 0)
          setTimeout(() => send('cmd:fx:zzz'), cfg.ritualWalk ? 1200 : 300)
        }
      }
      // P3: activity file switch (quiet/normal/lively) — no reload needed
      pollActivityFile()
      pollUiConfig()
      consumeUiAction()
      if (!petSettingsPushed) { petSettingsPushed = true; setTimeout(() => { try { applyPetSettings(cfg.petSettings) } catch {} }, 2000) }
      if (!balanceStartupPushed && cfg.balancePush?.enabled && cfg.balancePush.startup) {
        balanceStartupPushed = true
        try { send('bal:' + '不可查（走DSH渠道）' + '|' + '今日 ¥' + llmDay.cost.toFixed(4) + '（DSH统计）'); log('info', 'balance pushed (startup)', { costToday: Number(llmDay.cost.toFixed(4)) }) } catch {}
      }
      refreshPetOnline()
      writeState()
      // P3: long task -> walk two small steps every ~30s
      if (cfg.actions?.enabled && cfg.actions.longTaskMs && Date.now() - lastLongStepAt >= (cfg.actions.longTaskStepMs || 30000)) {
        for (const s of sessions.values()) {
          if (s.turnStartAt && Date.now() - s.turnStartAt >= cfg.actions.longTaskMs) {
            if ((s.longSteps || 0) >= 3) continue
            s.longSteps = (s.longSteps || 0) + 1
            lastLongStepAt = Date.now()
            walkNear()
            setTimeout(() => act('shake'), 450)
            setTimeout(() => send('cmd:fx:sweat'), 700)
            log('info', 'long task: walk two steps', { session: String(s.id).slice(0, 12), step: s.longSteps })
            break
          }
        }
      }
      // P3: idle skit — only when nobody is operating, not during quiet hours
      if (cfg.idleSkit?.enabled && cfg.idleSkit.eventGapMs && Date.now() - lastEventAt >= cfg.idleSkit.eventGapMs
          && !quietNow() && Date.now() >= nextSkitAt) {
        const s = { id: 'idle', tools: 0, tokens: 0 }
        void generate('selfTalk', s, {}).then((g) => {
          const t = validateLine(g.text, { maxChars: cfg.llm.maxChars })
          if (!t) return
          if (Date.now() - lastEventAt < (cfg.idleSkit.eventGapMs || 180000)) return
          lastSkitAt = Date.now()
          log('info', 'idle skit', { source: g.source, kind: 'selfTalk' })
          rememberLine(t, 'idle')
          send('inner:' + t)
          scheduleNextSkit()
        })
      }
    } catch {}
  }, 20000)

  // ---------- TEST-ONLY event hook (default off) ----------
  // For approval-policy=never environments: write a JSON file and the plugin
  // performs the same演出 the real event would. NEVER enable for daily use.
  //   {"type":"approval"}[,"text":"..."] / {"type":"turnStart"} / {"type":"turnEnd","report":true}
  //   / {"type":"inner"} / {"type":"say"} / {"type":"walk","text":"center"} / {"type":"receipt"}
  let hookTimer = null
  if (cfg.testHookFile) {
    let lastRaw = ''
    hookTimer = setInterval(() => {
      try {
        const raw = fs.readFileSync(cfg.testHookFile, 'utf8')
        if (raw === lastRaw) return
        lastRaw = raw
        const spec = JSON.parse(raw)
        log('info', 'TESTHOOK event', spec)
        if (spec.type === 'approval') {
          stats.approvals += 1
          if (cfg.walkOnApproval) send('walk:center')
          setTimeout(() => speak('approval', spec.text || pick('dengdai'), { urgent: true }), cfg.walkOnApproval ? 120 : 0)
          writeReceipt()
        } else if (spec.type === 'turnStart') {
          speak('turnStart', spec.text || pick('kaigong'))
        } else if (spec.type === 'turnEnd') {
          speak('turnEnd', spec.text || pick('shougong'))
          if (spec.report) setTimeout(() => send('act:stretch'), 600)
        } else if (spec.type === 'inner') {
          send('inner:' + (spec.text || '（我就在旁边。）'))
        } else if (spec.type === 'say') {
          send('say:' + (spec.text || '测试一句'))
        } else if (spec.type === 'walk') {
          send('walk:' + (spec.text || 'center'))
        } else if (spec.type === 'receipt') {
          writeReceipt()
        }
      } catch {}
    }, 1500)
    log('warn', 'TESTHOOK enabled (test-only)', { file: cfg.testHookFile })
  }

  const dispose = () => { try { clearInterval(timer) } catch {}; try { clearInterval(bubbleTimer) } catch {}; try { if (hookTimer) clearInterval(hookTimer) } catch {}; sessions.clear() }
  try { if (typeof ctx.effect === 'function') ctx.effect(() => dispose); else ctx.on('dispose', dispose) } catch {}

  log('info', 'loaded v25', {
    dryRun: cfg.dryRun,
    pools: cfg.poolsDir ? 'on' : 'embedded',
    receipt: cfg.receiptFile ? 'on' : 'off',
    history: cfg.historyFile ? 'on' : 'off',
    llm: cfg.llm.enabled ? `${cfg.llm.provider}/${cfg.llm.model}` : 'off',
    llmLimits: { maxTokens: cfg.llm.maxTokens, timeoutMs: cfg.llm.timeoutMs, maxCallsPerDay: cfg.llm.maxCallsPerDay, budgetPerDayYuan: cfg.llm.budgetPerDayYuan },
    report: cfg.report,
    dualLayer: cfg.dualLayer,
    activity: activityState.level,
    actions: cfg.actions,
    idleSkit: cfg.idleSkit,
    activityFile: cfg.activityFile ? 'on' : 'off',
    attribution: cfg.attribution,
    attributionBootstrapped,
    lifecycle: { autoStart: cfg.lifecycle.autoStart, bootstrap: !!cfg.lifecycle.bootstrapScript, release: !!cfg.lifecycle.releaseZipUrl },
    uiActionFile: cfg.uiActionFile ? 'on' : 'off',
    bubble: cfg.bubble,
    stateFile: cfg.stateFile ? 'on' : 'off',
    uiConfigFile: cfg.uiConfigFile ? 'on' : 'off',
    quietHours: cfg.quietHours,
    rituals: { morning: cfg.morning, sleep: cfg.sleep },
    logLevel: cfg.logLevel,
  })
}

