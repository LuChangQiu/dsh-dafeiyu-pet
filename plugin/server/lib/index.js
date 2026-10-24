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
 *
 * v46（三本账 / 工具分类 / 计账续种）：
 *   - tokens = 全会话 usage.totalTokens 之和（含 cache，原样计入）；按会话 role 拆 tokensUser/tokensAgent，
 *     role 未知归 user 并计数 roleUnknown。
 *   - costUserYuan/costAgentYuan/costYuan = tokens/1000 × pricing.per1kTokens（默认 0.0015 元/1k，估算）。
 *   - LLM 计账（calls/petLlmCostYuan）在 callLlm 成功处直接累计；reload 用 lastLlm* 差分 +
 *     bridge-state-v2.today 续种，不清零。
 *   - toolType 9 类规则见 ./tool-types.js（mcp 白名单、plan、knowledge、agent、job 子类…）。
 *
 * v47（分项计价 / 控制模式 / 隐私）：
 *   - 费用改分项价：input/output/cacheRead/cacheWrite × priceTable（元/百万 token，估算）；
 *     costYuanFlat 保留旧口径对照；tokens* 分项与 costCacheYuan/cacheSavedYuan 见 DATA-CONTRACT §10。
 *   - 控制模式 mode{active,kind,remainMs,resumeAt}：focus/silent/off 门控气泡/动作/LLM/状态推送，
 *     到点自动恢复、重启保持、estill 迁移；ui-action mode-set / mode-clear。
 *   - 隐私：日志出口统一脱敏绝对路径；v2 会话工作区只留 workspaceName + workspaceHash。
 */

import net from 'node:net'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
import fs from 'node:fs'
import path from 'node:path'
import { toolTypeOf } from './tool-types.js'
import { DEFAULT_WHALE_ACTS, normalizeWhaleActConfig, loadWhitelist, shouldFire } from './whale-acts.js'
import { usageParts, costOf, flatCostOf, splitCost, priceTable, legacyParts, DEFAULT_PRICING } from './pricing.js'
import {
  normalizeKind,
  modeLabel,
  resolveResumeAt,
  modeView,
  normalizeRequest,
  cycleKind,
  modeAllowsBubble,
  modeAllowsLlm,
  modeAllowsAct,
  modeAllowsAction,
  modeAllowsStatusPush,
  modeAllowsAmbient,
  DEFAULT_MODE_DEFAULTS
} from './mode.js'
import { redactPathText, workspaceName, workspaceHash } from './privacy.js'
import { buildTeamV2, emptyTeamV2 } from './team-view.js'
import { composeReunion } from './text-fmt.js'

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
    approval: ['（我不走开。）']
  },
  report: '这轮用了 {turns} 轮里的一轮，{seconds}s、约 {tokens}k token'
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
    lines: {
      enabled: true,
      perKindPerHour: 6,
      reportPerHour: 3,
      spikePerHour: 2,
      dedupeWindow: 20,
      similarityMax: 0.8,
      retryOnDup: true
    },
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
    includeRecentText: false // privacy: never send raw user text
  },
  historyFile: '', // line de-dupe store (7 days / 300 lines)

  // P0 fixes (v9): attribution + bubble pacing
  attribution: { enabled: true, onlyActive: true, activeTtlMs: 1800000, bootstrapLastKnown: true, stateFile: '' },
  lifecycle: { autoStart: true, startScript: '', bootstrapScript: '', releaseZipUrl: '', bootstrapStateFile: '' },
  uiActionFile: '',
  petConfigFile: '',
  stateFileV2: '',
  companionFile: '',
  eventsFile: '',
  balancePush: { enabled: true, everyNTurns: 5, startup: true },
  petSettings: {
    size: 0.72,
    opacity: 1.0,
    mode: 'wander',
    lineFreq: '正常',
    passthrough: false,
    locked: false,
    soundOn: false
  },
  guards: { maxActionsPerHour: 60, noActionOnSameState: true, startleDelayMinMs: 900, startleDelayMaxMs: 1500 },
  // CF1：鲸鱼娘 act 生产者（report/wave/sneak）。白名单唯一真源 docs/generated/act-fx-whitelist.json，
  // 随包副本 plugin/server/lib/generated/。enabled=false = kill switch；replaceClassicActs=true 时
  // 用 act:report 替代 report 的 act:stretch、act:wave 替代 morning 的 act:jump（OQ1=A）。
  whaleActs: { ...DEFAULT_WHALE_ACTS },
  spike: { enabled: true, ratio: 1.8, absFloor: 3000, window: 20, minSamples: 8, cooldownMs: 600000, dailyCap: 2 },
  rice: { enabled: true, bowlTokens: 100000 },
  hesitate: { enabled: true, minMs: 900, maxMs: 1500 },
  stateClass: { enabled: true, debounceMs: 300 },
  reunion: { enabled: true },
  costModel: { ricePriceYuan: 0.5, userPricePer1kTokensYuan: 0.002 },
  // v47 分项计价（元/百万 token，默认按 DeepSeek 公开价假设；全部为估算，可配置）
  pricing: {
    per1kTokens: 0.0015,
    inputPerM: 2,
    outputPerM: 3,
    cacheReadPerM: 0.2,
    cacheWritePerM: 2,
    currency: 'CNY',
    legacyMix: { input: 0.01, output: 0.01, cacheRead: 0.98, cacheWrite: 0 }
  },
  // v47 控制模式：active / focus（专注）/ silent（静一静）/ off（下班）
  mode: {
    file: '', // 持久化（重启保持）；空 = 不落盘
    defaults: { focusMs: 50 * 60 * 1000, silentMs: 30 * 60 * 1000, offUntilHour: 8 },
    autoResume: true, // 到期自动恢复 active（ui-config.mode.autoResume 可关）
    // 通用外部触发文件（1s 轮询，供面板/脚本/测试用）；用户已明确 DROP 全局快捷键，无 RegisterHotKey 路径
    requestFile: ''
  },
  // v47-hotfix/task-69：pipe 串行队列 & 低占用写盘/降频
  pipeTimeoutMs: 1200, // 单连接串行队列的等待上限（旧版 600ms 偏短）
  stateWriteMs: 10000, // state 写盘最小间隔（心跳/事件都会触发，但被此间隔合并）
  companionSaveMs: 30000, // companion 情绪持久化最小间隔
  eventsSaveMs: 2000, // events 缓冲落盘去抖
  lowMemory: { rssMb: 2000, stateWriteMs: 20000, statusPushMs: 10000, memLogMs: 120000 },
  // v48：team/goal/plan/userQuestions 只读 v2 字段（投影快照，≤1/min 聚合；缺失→null+degraded）
  teamV2: { enabled: true, refreshMs: 60000 },
  statusChannel: { enabled: true, heartbeatMs: 5000, petPush: true },
  bubble: {
    normalMs: 5000,
    innerMs: 3000,
    reportMs: 10000,
    approvalMs: 8000,
    nightMs: 6000,
    queueGapMs: 300,
    innerDelayMinMs: 1200,
    innerDelayMaxMs: 1800,
    coalesceWindowMs: 2000,
    maxQueue: 8
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
  stateFile: '', // P3: read-only status snapshot for pet-bridge-ui (state.json)
  uiConfigFile: '', // P3: UI-managed config sidecar (whitelist applied without reload)

  // P3 (A+B): animation feel / activity level / idle skit
  activity: 'normal', // quiet / normal / lively
  activityFile: '', // plain text or JSON {"level":...}; changes apply without reload
  actions: {
    enabled: true,
    turnStartSpinChance: 0.2, // spec：20% 旋转，其余小跳
    toolEveryMs: 20000,
    longTaskMs: 100000,
    longTaskStepMs: 30000
  },
  idleSkit: {
    enabled: true,
    eventGapMs: 180000, // 至少 3 分钟没有任何会话事件才算"没人操作"
    minMs: 180000, // 小剧场间隔 3~6 分钟
    maxMs: 360000
  }
}

function merge(base, patch) {
  const out = { ...base }
  for (const [k, v] of Object.entries(patch || {})) {
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      base[k] &&
      typeof base[k] === 'object' &&
      !Array.isArray(base[k])
    ) {
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
  return content
    .filter((b) => b && typeof b.text === 'string')
    .map((b) => b.text)
    .join(' ')
    .trim()
}

function clip(s, n) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, n)
}

export const name = 'dsh-pet-bridge-v49'

export function apply(ctx, rawConfig) {
  const cfg = merge(DEFAULTS, rawConfig)
  cfg.whaleActs = normalizeWhaleActConfig(cfg.whaleActs)
  const log = (level, msg, extra) => {
    if (cfg.logLevel !== 'debug' && level === 'debug') return
    const raw = `[${new Date().toISOString()}] [${level}] ${msg}${extra === undefined ? '' : ' ' + safe(extra)}`
    // v47 隐私（task-68）：日志出口统一脱敏 —— 绝对路径只留 basename，不落 C:\ / E:\ 路径
    const line = redactPathText(raw)
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
      if (level !== 'debug') console.log('[pet-bridge-v49] ' + line)
    } catch {}
  }
  const safe = (v) => {
    try {
      return JSON.stringify(v)
    } catch {
      return String(v)
    }
  }

  // ---------- task-69 低占用：内存/定时器自检 + 自动降频（尽早声明，热路径函数引用） ----------
  const memRssMb = () => {
    try {
      return Math.round(process.memoryUsage().rss / 1048576)
    } catch {
      return 0
    }
  }
  const memHeapMb = () => {
    try {
      return Math.round(process.memoryUsage().heapUsed / 1048576)
    } catch {
      return 0
    }
  }
  // Node 活动 Timeout 数（timer 泄漏自检：reload 后不应随加载次数增长）
  const timerCount = () => {
    try {
      return (process.getActiveResourcesInfo?.() || []).filter((x) => x === 'Timeout').length
    } catch {
      return -1
    }
  }
  let lowFootprint = false
  let lowFootprintCheckedAt = 0
  let lastMemLogAt = 0
  const refreshLowFootprint = () => {
    if (Date.now() - lowFootprintCheckedAt < 20000) return lowFootprint
    lowFootprintCheckedAt = Date.now()
    const was = lowFootprint
    lowFootprint = memRssMb() >= Number(cfg.lowMemory?.rssMb || 2000)
    if (was !== lowFootprint) log('info', 'low footprint mode', { lowFootprint, rssMB: memRssMb() })
    return lowFootprint
  }
  const pipeStats = { ok: 0, fail: 0 }

  // ---------- v47 控制模式状态（尽早声明：send/act/generate/status 等门控都引用） ----------
  const modeState = { kind: 'active', since: null, resumeAt: 0, source: null }
  // 进入 focus/silent 前的桌宠原生设置，恢复 active 时还原
  const restorePet = { mode: 'wander', locked: false, lineFreq: '正常' }
  let modeSuppressLoggedAt = 0
  // v48 team/goal/plan/userQuestions 只读 v2 字段：投影快照 ≤1/min 聚合，WeakRef 持会话不增内存
  let teamV2 = emptyTeamV2('not-refreshed')
  let lastSessionRef = null
  let lastTeamV2At = 0
  let teamV2Timer = null
  let userQuestionsSentCount = 0
  const modeEngaged = () => modeState.kind !== 'active'
  const logModeSuppress = (what, detail) => {
    if (Date.now() - modeSuppressLoggedAt < 60000) return
    modeSuppressLoggedAt = Date.now()
    log('info', 'mode suppress', { mode: modeState.kind, what, detail: clip(detail, 36) })
  }
  // 发给桌宠的每一行在出口统一门控（force=true = 手动/模式自身指令，永不被拦）
  const modeAllowsPipeLine = (line) => {
    const k = modeState.kind
    if (k === 'active') return true
    const l = String(line || '')
    if (k === 'focus' || k === 'silent') {
      if (l.startsWith('state:')) return k === 'focus'
      if (l.startsWith('say') || l.startsWith('inner')) return true // 上游 speak() 已按 S0 门控
      return false // 动作/走动/特效/余额
    }
    return false // off：停止一切自动联动（手动互动走 force）
  }

  // ---------- P0 pools ----------
  const pools = { kaigong: [], ganhuo: [], shougong: [], anwei: [], dengdai: [], shenye: [], inner: {} }
  const loadPools = () => {
    if (!cfg.poolsDir) return
    const read = (name) => {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(cfg.poolsDir, `${name}.json`), 'utf8'))
        const lines = (j.lines || []).map((x) => String(x.text || '').trim()).filter(Boolean)
        return lines
      } catch {
        return []
      }
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
    waitingInput: '用户需要做选择，你在旁边等他选，不催',
    error: '这轮出错了，安慰他但不说教、不玩梗',
    spike: '发现他这轮用量突然涨了很多，被发现的俏皮心虚',
    reunion: '很久没见他了，重逢的开心但不索取',
    turnStart: '他刚开始一轮工作，你想说一句让他在、又不打扰的话',
    turnEnd: '这一轮结束了，你想说一句收工/陪伴的话',
    turnEndBad: '这一轮没跑完/出错了，你想说一句只陪伴、不玩梗的话',
    report: '收工报账：像人替他记账',
    approval: '任务停下来等他点确认，你想说一句让他安心、顺便提醒点一下的话',
    morning: '早上第一轮，跟他打个招呼',
    sleep: '晚上 23:30 了，跟他说一句清醒的温柔',
    selfTalk: '没人理你，你在过自己的日子，心里嘀咕一句（心声体，短，像被偷听到的）'
  }

  const hist = []
  const loadHist = () => {
    if (!cfg.historyFile) return
    try {
      const arr = JSON.parse(fs.readFileSync(cfg.historyFile, 'utf8'))
      const cut = Date.now() - 7 * 86400e3
      for (const x of Array.isArray(arr) ? arr : [])
        if (x && x.text && Number(x.at) >= cut) hist.push({ text: String(x.text), at: Number(x.at) })
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
    try {
      const big = (t) => {
        const c = String(t).replace(/\s/g, '')
        const set = new Set()
        for (let i = 0; i < c.length - 1; i++) set.add(c.slice(i, i + 2))
        return set
      }
      const a = big(text)
      const sim = (braw) => {
        const b = big(braw)
        if (!a.size || !b.size) return 0
        let inter = 0
        for (const x of a) if (b.has(x)) inter += 1
        return inter / (a.size + b.size - inter)
      }
      const win = hist.slice(-(cfg.llm.lines?.dedupeWindow || 20))
      if (win.some((x) => sim(x.text) > (cfg.llm.lines?.similarityMax || 0.8))) return true
    } catch {}
  }
  const rememberLine = (text, source) => {
    hist.push({ text, at: Date.now() })
    saveHist()
    log('debug', 'line remembered', { source, chars: text.length })
  }

  // v46：LLM 计账（calls/petLlmCostYuan）跨 reload 续种。
  // llmDay = 今日累计（装载时从 bridge-state-v2.today 续种，预算护栏也按续种后天数计）；
  // lastLlmCalls/lastLlmCost = 已发布到 today 的基线，用于增量差分（避免重复累计或清零）。
  const llmDay = { day: dateKey(), calls: 0, tokens: 0, cost: 0 }
  let lastLlmCalls = 0
  let lastLlmCost = 0
  const rollLlmDay = () => {
    const k = dateKey()
    if (llmDay.day !== k) {
      llmDay.day = k
      llmDay.calls = 0
      llmDay.tokens = 0
      llmDay.cost = 0
      lastLlmCalls = 0
      lastLlmCost = 0
    }
  }
  const publishLlmAccounting = () => {
    today.calls = llmDay.calls
    today.petLlmCostYuan = Number(llmDay.cost.toFixed(4))
  }
  const llmBudgetOk = () => {
    rollLlmDay()
    if (!cfg.llm.enabled) return false
    if (llmDay.calls >= cfg.llm.maxCallsPerDay) {
      log('info', 'llm budget: maxCallsPerDay', { calls: llmDay.calls })
      return false
    }
    if (llmDay.cost >= cfg.llm.budgetPerDayYuan) {
      log('info', 'llm budget: cost', { cost: Number(llmDay.cost.toFixed(4)), limit: cfg.llm.budgetPerDayYuan })
      return false
    }
    return true
  }
  const estimateCost = (tokens) => ((tokens || 0) / 1000) * cfg.llm.costPer1kTokensYuan

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
    if (h < 6) return '凌晨'
    if (h < 9) return '早上'
    if (h < 12) return '上午'
    if (h < 14) return '中午'
    if (h < 18) return '下午'
    if (h < 23) return '晚上'
    return '深夜'
  }
  const buildPrompt = (kind, s, extra = {}) => {
    const tools = s.tools || 0
    const toolBucket =
      tools === 0 ? '没动工具' : tools <= 3 ? '动了几个工具' : tools <= 10 ? '一直在动工具' : '工具没停过'
    const lines = [
      `[情境] ${KIND_DESC[kind] || kind}。当前时段：${timeBucket()}，今天第 ${stats.turns} 轮。`,
      `[抽象上下文] 这轮用了${toolBucket}；结果：${extra.outcome || '进行中'}；用时档：${extra.durBucket || '不长'}。`
    ]
    if (extra.numbers) lines.push(`[数字槽位] ${extra.numbers}（原样使用，不要自己计算/改写）`)
    if (cfg.llm.includeRecentText && extra.recentUser) lines.push(`[最近一句] 用户：${extra.recentUser}`)
    lines.push(
      `[要求] 只输出一句中文台词（不要解释、不要引号、不要列表）。≤${cfg.llm.maxChars} 字，口语，可带括号心声体。`
    )
    lines.push(
      '[输出格式] 只输出台词本身，不要解释、不要推理过程、不要任何前缀（如"我：""答："）、不要 Markdown/引号/列表。'
    )
    lines.push(
      '[避免] 最近说过：' +
        (hist
          .slice(-20)
          .map((x) => x.text)
          .join(' / ') || '（还没有）')
    )
    if (kind === 'sleep') lines.push('[禁忌] 不劝睡、不说教、不评价花费；可以只说"我在"。')
    if (kind === 'report') lines.push('[禁忌] 不卖惨、不评价金额高低；数字必须原样使用。')
    return lines.join('\n')
  }

  const callLlm = async (prompt, kind) => {
    let llm = null
    try {
      llm = typeof ctx.get === 'function' ? ctx.get('llm') : null
    } catch {
      llm = null
    }
    if (!llm || typeof llm.stream !== 'function') {
      log('info', 'llm unavailable')
      return { text: '', latencyMs: 0, tokens: 0 }
    }
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
          signal: ac.signal
        })
        for await (const chunk of stream) {
          if (!chunk) continue
          if (chunk.type === 'text-delta' && typeof chunk.text === 'string') out += chunk.text
          else if (chunk.type === 'reasoning-delta') {
            /* reasoning text is ignored, never shown/logged */
          } else if (chunk.type === 'finish') break
        }
      } catch (err) {
        log('warn', 'llm failed', {
          kind,
          attempt,
          error: err && (err.code || err.message || String(err)),
          latencyMs: Date.now() - started
        })
        return { text: '', latencyMs: Date.now() - started, tokens: 0 }
      } finally {
        clearTimeout(timer)
      }
      const tokens = Math.max(0, Math.ceil((out.length + prompt.length) / 2))
      return { text: out, latencyMs: Date.now() - started, tokens }
    }
    let r = await runOnce(1)
    if (!r.text.trim()) {
      log('info', 'llm empty-output retry', { kind, firstLatencyMs: r.latencyMs })
      const r2 = await runOnce(2)
      r = { text: r2.text, latencyMs: r.latencyMs + r2.latencyMs, tokens: r.tokens + r2.tokens }
    }
    // v46：计账放在“调用成功”处（不再依赖 say/气泡路径）；reload 后用 lastLlm* 差分续种，跨 reload 不清零。
    rollLlmDay()
    llmDay.calls += 1
    llmDay.tokens += r.tokens
    llmDay.cost += estimateCost(r.tokens)
    const deltaCalls = llmDay.calls - lastLlmCalls
    const deltaCost = llmDay.cost - lastLlmCost
    lastLlmCalls = llmDay.calls
    lastLlmCost = llmDay.cost
    publishLlmAccounting()
    log('info', 'llm accounted', {
      calls: deltaCalls,
      cost: Number(deltaCost.toFixed(6)),
      callsToday: today.calls,
      costToday: today.petLlmCostYuan
    })
    log('info', 'llm call', {
      kind,
      latencyMs: r.latencyMs,
      tokens: r.tokens,
      callsToday: llmDay.calls,
      costToday: Number(llmDay.cost.toFixed(4))
    })
    return r
  }

  let kindHourKey = ''
  const kindCalls = new Map()
  const generate = async (kind, s, extra = {}) => {
    const fallback = () => {
      const poolName =
        kind === 'turnStart'
          ? 'kaigong'
          : kind === 'turnEnd'
            ? 'shougong'
            : kind === 'turnEndBad' || kind === 'error' || kind === 'spike'
              ? 'anwei'
              : kind === 'approval' || kind === 'waitingInput'
                ? 'dengdai'
                : kind === 'morning' || kind === 'reunion'
                  ? 'kaigong'
                  : kind === 'sleep'
                    ? 'shenye'
                    : kind === 'selfTalk'
                      ? 'ganhuo'
                      : 'shougong'
      return { text: pick(poolName), source: 'pool', latencyMs: 0, tokens: 0 }
    }
    if (!modeAllowsLlm(modeState.kind, kind)) {
      // v47：模式期间不为非 S0 生成文案（省钱/安静）；S0 仍可用 LLM
      log('debug', 'llm fallback: mode', { kind, mode: modeState.kind })
      return fallback()
    }
    if (!llmBudgetOk() || cfg.llm.lines?.enabled === false) {
      log('debug', 'llm fallback: budget/disabled', { kind })
      return fallback()
    }
    const hk = new Date().toDateString() + new Date().getHours()
    if (hk !== kindHourKey) {
      kindHourKey = hk
      kindCalls.clear()
    }
    const cap =
      kind === 'report'
        ? cfg.llm.lines?.reportPerHour || 3
        : kind === 'spike'
          ? cfg.llm.lines?.spikePerHour || 2
          : cfg.llm.lines?.perKindPerHour || 6
    if ((kindCalls.get(kind) || 0) >= cap) {
      log('debug', 'llm fallback: kind cap', { kind })
      return fallback()
    }
    kindCalls.set(kind, (kindCalls.get(kind) || 0) + 1)
    const { text: raw, latencyMs, tokens } = await callLlm(buildPrompt(kind, s, extra), kind)
    const line = validateLine(raw, { allowDigits: kind === 'report', maxChars: cfg.llm.maxChars })
    if (!line && raw && kind === 'report')
      log('info', 'report too long/invalid -> fallback', { rawChars: String(raw).length, limit: cfg.llm.maxChars })
    if (!line || isDuplicate(line)) {
      if (line && cfg.llm.lines?.retryOnDup && !extra.__dupRetry) {
        log('info', 'llm duplicate retry', { kind })
        return generate(kind, s, { ...extra, __dupRetry: true })
      }
      if (line) log('info', 'llm lines fallback', { kind, reason: 'duplicate' })
      else if (raw) log('info', 'llm rejected: constraint', { kind, rawChars: String(raw).length })
      else log('info', 'llm lines fallback', { kind, reason: 'invalid' })
      return fallback()
    }
    log('info', 'llm lines ok', { kind, text: line, latencyMs, tokens })
    return { text: line, source: 'llm', latencyMs, tokens }
  }

  const pregen = { at: 0, text: '' }

  // ---------- P3 (A+B): activity presets / actions / idle skit ----------
  const ACTIVITY_PRESETS = {
    quiet: {
      chance: { turnStart: 0.3, turnEnd: 0.3, approval: 1, report: 1, dual: 0.1 },
      minGapMs: 45000,
      cooldownScale: 2.0,
      toolEveryMs: 60000,
      idleMinMs: 540000,
      idleMaxMs: 720000,
      actionFactor: 0.3
    },
    normal: {
      // 默认"正常偏活泼"：概率 ×1.2、minGap 17s、小剧场 6~9 分钟、微动画 ×1.15
      chance: { turnStart: 0.66, turnEnd: 0.66, approval: 1, report: 1, dual: 0.66 },
      minGapMs: 17000,
      cooldownScale: 0.9,
      toolEveryMs: 12000,
      idleMinMs: 360000,
      idleMaxMs: 540000,
      actionFactor: 1.15
    },
    lively: {
      chance: { turnStart: 0.85, turnEnd: 0.85, approval: 1, report: 1, dual: 0.75 },
      minGapMs: 10000,
      cooldownScale: 0.5,
      toolEveryMs: 8000,
      idleMinMs: 180000,
      idleMaxMs: 300000,
      actionFactor: 1.3
    }
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
  let lastToolTypeLogged = ''
  let lastLongStepAt = 0
  let lastSkitAt = 0
  let hourActKey = ''
  let hourlyActions = 0
  const act = (name) => {
    // v47：focus 只允许最小幅度动作；silent/off 不动
    if (!modeAllowsAct(modeState.kind, name)) {
      logModeSuppress('act', name)
      return
    }
    const hk = new Date().toDateString() + new Date().getHours()
    if (hk !== hourActKey) {
      hourActKey = hk
      hourlyActions = 0
    }
    const g = cfg.guards || {}
    if (g.noActionOnSameState && statusState.lastActionState === statusState.state) return
    if (hourlyActions >= (g.maxActionsPerHour || 60)) return
    hourlyActions += 1
    statusState.lastActionState = statusState.state
    if (!cfg.enabled || !cfg.actions?.enabled) return
    send('act:' + name)
    log('debug', 'act', { name })
  }
  const walkNear = () => {
    if (!modeAllowsAction(modeState.kind)) return
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
      try {
        const j = JSON.parse(raw)
        level = j.level || j.activity || raw
      } catch {}
      level = String(level || '')
        .trim()
        .toLowerCase()
      if (ACTIVITY_PRESETS[level]) applyActivity(level)
    } catch {}
  }
  applyActivity(cfg.activity || 'normal')
  setTimeout(() => {
    try {
      checkReunion()
    } catch {}
  }, 4000)
  // v10 lifecycle: DSH 启动时自动拉起桌宠（幂等：start-pet.ps1 会先检查）
  if (cfg.lifecycle?.autoStart && cfg.lifecycle.startScript) {
    setTimeout(() => {
      let ok = false
      try {
        const s = net.connect(cfg.pipe)
        s.setTimeout(800)
        s.on('connect', () => {
          ok = true
          try {
            s.write('ping\n')
          } catch {}
          s.destroy()
        })
        s.on('error', () => {})
        s.on('timeout', () => {
          try {
            s.destroy()
          } catch {}
        })
        setTimeout(() => {
          if (!ok) {
            try {
              const cp = require('node:child_process')
              const boot = cfg.lifecycle.bootstrapScript || cfg.lifecycle.startScript
              const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', boot]
              if (cfg.lifecycle.releaseZipUrl) args.push('-ReleaseUrl', cfg.lifecycle.releaseZipUrl)
              const ch = cp.spawn('powershell.exe', args, { detached: true, stdio: ['ignore', 'ignore', 'pipe'] })
              ch.on('error', (e) => log('warn', 'spawn error', String(e && e.message)))
              ch.on('exit', (code) => log('info', 'spawn exit', { code }))
              ch.stderr && ch.stderr.on('data', (b) => log('warn', 'spawn stderr', String(b).slice(0, 300)))
              ch.unref()
              log('info', 'bootstrap pet spawned', { script: boot, release: !!cfg.lifecycle.releaseZipUrl })
            } catch (e) {
              log('warn', 'bootstrap spawn failed', String(e && e.message))
            }
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
      sock.on('connect', () => {
        petOnline = true
        try {
          sock.write('ping\n')
        } catch {}
      })
      sock.on('data', () => {
        petOnline = true
      })
      sock.on('end', () => {
        if (!done) {
          done = true
          petOnline = true
        }
      })
      sock.on('error', () => {
        if (!done) {
          done = true
        }
      })
      sock.on('timeout', () => {
        if (!done) {
          done = true
        }
        try {
          sock.destroy()
        } catch {}
      })
    } catch {
      petOnline = false
    }
  }
  let lastAction = null
  let balanceTurns = 0
  let balanceStartupPushed = false
  let petSettingsPushed = false
  const petCmd = (line) => {
    try {
      send(line)
    } catch {}
  }
  const applyPetSettings = (petCfg) => {
    if (!petCfg || typeof petCfg !== 'object') return
    const map = {
      size: 'size',
      opacity: 'opacity',
      mode: 'mode',
      lineFreq: 'lineFreq',
      passthrough: 'passthrough',
      locked: 'locked',
      bubbleStyle: 'bubbleStyle',
      topmost: 'topmost',
      snap: 'snap',
      layer: 'layer',
      skin: 'skin',
      soundOn: 'soundOn',
      volume: 'volume',
      musicLink: 'musicLink',
      doubleClick: 'doubleClick'
    }
    const out = {}
    for (const [k, cmdKey] of Object.entries(map)) if (petCfg[k] !== undefined) out[cmdKey] = petCfg[k]
    if (petCfg.city !== undefined) out.city = petCfg.city
    if (petCfg.quietMinutes !== undefined) out.quiet = petCfg.quietMinutes
    // 用户决定（2026-10-23）：联动不再有任何音效（soundOn/volume 保留内部字段但强制静音）
    out.soundOn = false
    out.volume = 0
    // v47 契约：petSettings.mode='still' 不再作为联动状态真源（映射为 normal）；模式由 mode 字段控制
    if (String(out.mode || '') === 'still') out.mode = 'wander'
    if (modeEngaged()) {
      // 模式期间强制桌宠侧：不散步 + 锁位置 + 少主动说话
      out.mode = 'still'
      out.locked = true
      out.lineFreq = '安静'
    } else {
      if (out.mode !== undefined) restorePet.mode = String(out.mode || 'wander')
      if (out.locked !== undefined) restorePet.locked = !!out.locked
      if (out.lineFreq !== undefined) restorePet.lineFreq = String(out.lineFreq || '正常')
    }
    if (Object.keys(out).length) {
      petCmd('cmd:config:' + JSON.stringify(out))
      cfg.petSettings = { ...(cfg.petSettings || {}), ...petCfg }
      if (modeEngaged()) cfg.petSettings = { ...cfg.petSettings, mode: 'still', locked: true, lineFreq: '安静' }
      log('info', 'pet settings pushed', out)
    }
  }
  const runPsFile = (tag, content) => {
    try {
      const cp = require('node:child_process')
      const dir = cfg.lifecycle.bootstrapStateFile
        ? path.dirname(cfg.lifecycle.bootstrapStateFile)
        : path.join(process.env.USERPROFILE || '.', 'pet-work')
      const logs = path.join(dir, 'logs')
      try {
        fs.mkdirSync(logs, { recursive: true })
      } catch {}
      const file = path.join(logs, 'ui-action-' + String(tag).replace(/[^A-Za-z0-9._-]/g, '_') + '.ps1')
      fs.writeFileSync(file, '\ufeff' + content, 'utf8')
      const ch = cp.spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file], {
        detached: true,
        stdio: ['ignore', 'ignore', 'pipe']
      })
      ch.on('error', (e) => log('warn', 'ui-action spawn error', String(e && e.message)))
      ch.on('exit', (code) => log('info', 'ui-action ps exit', { tag, code }))
      if (ch.stderr) ch.stderr.on('data', (b) => log('warn', 'ui-action ps stderr', String(b).slice(0, 300)))
      ch.unref()
      log('info', 'ui-action ps started', { tag, file })
    } catch (e) {
      log('warn', 'runPsFile failed', String(e && e.message))
    }
  }
  const spawnScript = (extraArg) => {
    const cp = require('node:child_process')
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', cfg.lifecycle.startScript]
    if (extraArg) args.push(extraArg)
    try {
      const ch = cp.spawn('powershell.exe', args, { detached: true, stdio: ['ignore', 'ignore', 'pipe'] })
      ch.on('error', (e) => log('warn', 'spawn error', String(e && e.message)))
      ch.on('exit', (code) => log('info', 'spawn exit', { code }))
      ch.stderr && ch.stderr.on('data', (b) => log('warn', 'spawn stderr', String(b).slice(0, 300)))
      ch.unref()
    } catch {}
  }
  const consumeUiAction = () => {
    if (!cfg.uiActionFile) return
    try {
      const raw = fs.readFileSync(cfg.uiActionFile, 'utf8')
      const j = JSON.parse(raw)
      if (!j || !j.name || j.handledAt) return
      const aid = String(j.id || '')
      let status = 'done',
        message = ''
      try {
        const runTask = () => {
          try {
            const cp = require('node:child_process')
            const ch = cp.spawn('schtasks.exe', ['/Run', '/TN', 'DafeiyuPetStart'], {
              detached: true,
              stdio: 'ignore',
              windowsHide: true
            })
            ch.on('error', (e) => log('warn', 'schtasks error', String(e && e.message)))
            ch.unref()
            log('info', 'pet start requested via schtasks')
          } catch (e) {
            status = 'failed'
            message = String(e && e.message)
          }
        }
        // v47 契约：mode-silent{minutes} / mode-focus{minutes} / mode-off{until?} / mode-resume
        // 兼容旧名 mode-set / mode-clear / mode-cycle；返回 lastAction{done|failed,message}
        if (/^mode[-_]/i.test(String(j.name || ''))) {
          const isCycle = String(j.name).toLowerCase() === 'mode-cycle'
          const req = isCycle
            ? { kind: cycleKind(modeState.kind), durationMs: 0, clear: false }
            : normalizeRequest(j, cfg.mode?.defaults)
          if (!req) {
            status = 'failed'
            message = 'unsupported mode request'
          } else {
            const r = applyMode(req, 'ui-action')
            status = r.ok ? 'done' : 'failed'
            message = r.message
          }
        } else if (j.name === 'restart-pet') {
          if (petOnline) send('cmd:restart', { force: true })
          else runTask()
        } else if (j.name === 'start-pet') {
          runTask()
        } else if (j.name === 'quit-pet' || j.name === 'stop-pet') {
          send('cmd:exit', { force: true })
        } else if (j.name === 'enable-autostart' || j.name === 'disable-autostart') {
          const startup = path.join(
            process.env.APPDATA || '',
            'Microsoft',
            'Windows',
            'Start Menu',
            'Programs',
            'Startup'
          )
          const cmdFile = path.join(startup, '大肥鱼桌宠.cmd')
          const sp = cfg.lifecycle.startScript || ''
          if (j.name === 'enable-autostart') {
            try {
              fs.mkdirSync(startup, { recursive: true })
              fs.writeFileSync(
                cmdFile,
                '@echo off\r\npowershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + sp + '"\r\n',
                'utf8'
              )
            } catch (e) {
              status = 'failed'
              message = String(e && e.message)
            }
          } else {
            try {
              fs.unlinkSync(cmdFile)
            } catch {}
          }
        } else if (j.name === 'interact-head') interact('head')
        else if (j.name === 'interact-feed') {
          const r = interact('feed')
          if (r === 'feed-night') {
            status = 'failed'
            message = '深夜不喂食'
          }
        } else if (j.name === 'interact-come') interact('come')
        else if (j.name === 'events-ack') {
          events = events.map((e) => ({ ...e, unread: false }))
          saveEvents()
        } else {
          status = 'failed'
          message = 'unsupported action'
        }
      } catch (e) {
        status = 'failed'
        message = String(e && e.message)
      }
      lastAction = {
        id: String(j.id || ''),
        name: j.name,
        status,
        at: new Date().toISOString(),
        message: redactPathText(message) // v47 隐私：错误信息里不落路径
      }
      j.handledAt = new Date().toISOString()
      j.status = status
      try {
        fs.writeFileSync(cfg.uiActionFile, JSON.stringify(j))
      } catch {}
      log('info', 'ui-action handled', lastAction)
      writeState()
    } catch {}
  }

  // ---------- task-44 状态通道（state:<json>） ----------
  const statusState = {
    state: 'idle',
    stateClass: 'idle',
    lastActionState: null,
    tool: null,
    toolType: null,
    subkind: null,
    phase: null,
    since: new Date().toISOString(),
    step: null,
    turn: null,
    heartbeatAt: new Date().toISOString(),
    source: null,
    message: ''
  }
  // v46：工具类型细分（9 类）已抽到 ./tool-types.js（纯函数、可单测），动作映射见 tool/call 处理分支
  // v47-hotfix：状态推送合并节流 —— ≥5s 一次（低占用 10s）、只推当前状态汇总
  let lastStatusPushAt = 0
  let lastStatusPayload = ''
  const pushStatusToPet = () => {
    if (!cfg.statusChannel?.petPush) return
    if (!modeAllowsStatusPush(modeState.kind)) return // v47：silent/off 不推姿态
    try {
      if (!petOnline) return
      const now = Date.now()
      const interval = refreshLowFootprint() ? Number(cfg.lowMemory?.statusPushMs || 10000) : 5000
      if (now - lastStatusPushAt < interval) return
      const payload = JSON.stringify({
        state: statusState.state,
        tool: statusState.tool,
        since: statusState.since,
        step: statusState.step,
        turn: statusState.turn
      })
      if (payload === lastStatusPayload && now - lastStatusPushAt < 15000) return
      lastStatusPushAt = now
      lastStatusPayload = payload
      send('state:' + payload, { coalesceKey: 'state' })
    } catch {}
  }
  const setStatus = (st, extra = {}) => {
    if (statusState.state === st && extra.tool === undefined) {
      statusState.heartbeatAt = new Date().toISOString()
      return
    }
    statusState.state = st
    statusState.since = new Date().toISOString()
    if (extra.tool !== undefined) statusState.tool = extra.tool || null
    if (extra.toolType !== undefined) statusState.toolType = extra.toolType || null
    if (extra.subkind !== undefined) statusState.subkind = extra.subkind || null
    if (extra.phase !== undefined) statusState.phase = extra.phase || null
    if (extra.step !== undefined) statusState.step = extra.step
    if (extra.turn !== undefined) statusState.turn = extra.turn
    if (extra.source !== undefined) statusState.source = extra.source
    if (extra.message !== undefined) statusState.message = extra.message
    statusState.heartbeatAt = new Date().toISOString()
    if (cfg.stateClass?.enabled) scheduleClass()
    pushStatusToPet()
    if (st !== 'thinking' && st !== 'tool') log('info', 'state', { state: st, tool: statusState.tool })
  }
  let statusTimer = null
  if (cfg.statusChannel?.enabled) {
    statusTimer = setInterval(() => {
      statusState.heartbeatAt = new Date().toISOString()
      if (!petOnline && statusState.state !== 'disconnected') {
        statusState.state = 'disconnected'
        statusState.since = new Date().toISOString()
      }
      if (petOnline && statusState.state === 'disconnected') {
        statusState.state = 'idle'
        statusState.since = new Date().toISOString()
      }
      pruneSessions()
      todayReset()
      try {
        const base = currentTurnStartAt || (sessions.get(String(currentSessionId)) || {}).turnStartAt || 0
        if (base) today.longestTurnMs = Math.max(today.longestTurnMs || 0, Date.now() - base)
      } catch {}
      saveCompanion()
      pushStatusToPet()
      writeState()
    }, cfg.statusChannel.heartbeatMs || 5000)
  }

  // ---------- Phase-1：今日统计 / 事件环形缓冲 / companion 情绪模型 / 互动 ----------
  let currentTurnStartAt = 0
  const today = {
    date: new Date().toISOString().slice(0, 10),
    turns: 0,
    toolCalls: 0,
    longestTurnMs: 0,
    tokens: 0,
    tokensInput: 0,
    tokensOutput: 0,
    tokensCacheRead: 0,
    tokensCacheWrite: 0,
    tokensUser: 0,
    tokensAgent: 0,
    roleUnknown: 0,
    costUserYuan: 0,
    costAgentYuan: 0,
    costYuan: 0,
    costYuanFlat: 0,
    costCacheYuan: 0,
    cacheSavedYuan: 0,
    petLlmCostYuan: 0,
    budgetYuan: cfg.llm.budgetPerDayYuan || 1,
    calls: 0,
    agentCalls: 0,
    riceBowls: 0,
    period: ''
  }
  const companion = {
    mood: 10,
    energy: 70,
    affinity: 5,
    level: '熟悉',
    streakDays: 0,
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    totals: { turns: 0, tools: 0, interactions: 0 },
    updatedAt: new Date().toISOString()
  }
  try {
    if (cfg.companionFile && fs.existsSync(cfg.companionFile))
      Object.assign(companion, JSON.parse(fs.readFileSync(cfg.companionFile, 'utf8')))
  } catch {}
  try {
    if (cfg.stateFileV2 && fs.existsSync(cfg.stateFileV2)) {
      const prev = JSON.parse(fs.readFileSync(cfg.stateFileV2, 'utf8'))
      if (prev && prev.today && prev.today.date === today.date) {
        Object.assign(today, prev.today)
        // v46 迁移：v45 及更早只累计 tokens、没有 role 拆分 ⇒ 把当日历史缺口补进 tokensUser
        // （口径：role 未知归 user），保证 tokens ≈ tokensUser + tokensAgent 不变式。
        const legacyGap =
          (Number(today.tokens) || 0) - (Number(today.tokensUser) || 0) - (Number(today.tokensAgent) || 0)
        if (legacyGap > 0) today.tokensUser = (Number(today.tokensUser) || 0) + legacyGap
        today.roleUnknown = Number(today.roleUnknown) || 0
        // v47 迁移：v46 及更早只累计 tokens 总数、没有分项 ⇒ 按典型缓存占比拆四类（合计不变，便于分项计价）
        if (prev.today.tokensInput === undefined && (Number(today.tokens) || 0) > 0) {
          const legacy = legacyParts(today.tokens, cfg.pricing?.legacyMix)
          today.tokensInput = legacy.input
          today.tokensOutput = legacy.output
          today.tokensCacheRead = legacy.cacheRead
          today.tokensCacheWrite = legacy.cacheWrite
          log('info', 'today seed migrate itemized', {
            total: legacy.total,
            input: legacy.input,
            output: legacy.output,
            cacheRead: legacy.cacheRead
          })
        }
        // v46：calls/petLlmCostYuan 增量续种 —— llmDay 承接今日已发生量，lastLlm* 作为差分基线
        llmDay.calls = Number(today.calls) || 0
        llmDay.cost = Number(today.petLlmCostYuan) || 0
        lastLlmCalls = llmDay.calls
        lastLlmCost = llmDay.cost
        log('info', 'today seed', {
          from: 'bridge-state-v2',
          tokens: today.tokens,
          tokensUser: today.tokensUser,
          tokensAgent: today.tokensAgent,
          roleUnknown: today.roleUnknown,
          calls: today.calls,
          petLlmCostYuan: today.petLlmCostYuan
        })
      }
    }
  } catch {}
  const updateLastContext = (ok) => {
    companion.lastContext = {
      at: new Date().toISOString(),
      toolType: statusState.toolType || statusState.state,
      outcome: ok ? 'ok' : 'bad',
      turns: today.turns
    }
  }
  const deriveStateClass = (st) =>
    st === 'error'
      ? 'error'
      : st === 'waiting_approval' || st === 'waiting_input'
        ? 'waiting'
        : st === 'thinking' || st === 'tool'
          ? 'running'
          : st === 'done'
            ? 'ready'
            : st === 'idle'
              ? 'idle'
              : st
  let classTimer = null
  const scheduleClass = () => {
    if (classTimer) return
    classTimer = setTimeout(() => {
      classTimer = null
      const c = deriveStateClass(statusState.state)
      if (c !== statusState.stateClass) {
        statusState.stateClass = c
        if (c === 'running' || c === 'waiting') {
          /* 只演一次 */
        }
      }
    }, cfg.stateClass?.debounceMs || 300)
  }
  const levelOf = (a) => (a >= 60 ? '黏人' : a >= 30 ? '亲近' : a >= 10 ? '熟悉' : '陌生')
  const stateWords = () => {
    const moodW = companion.mood >= 40 ? '开心' : companion.mood <= -20 ? '有点低落' : '平静'
    const energyW = companion.energy < 30 ? '困了' : companion.energy > 70 ? '有精神' : '有点累'
    const affW = levelOf(companion.affinity)
    return { mood: moodW, energy: energyW, affinity: affW }
  }
  // task-69：写盘统计 + 去抖落盘（companion 30s / events 2s；旧版顺手每 5s 写 companion、每个事件写 events）
  const persistStats = { companion: 0, events: 0, state: 0, skipped: 0 }
  let companionDirty = false
  let lastCompanionSaveAt = 0
  const saveCompanion = (force = false) => {
    if (!force && Date.now() - lastCompanionSaveAt < Number(cfg.companionSaveMs || 30000)) {
      companionDirty = true
      return
    }
    lastCompanionSaveAt = Date.now()
    companionDirty = false
    persistStats.companion += 1
    try {
      companion.level = levelOf ? levelOf(companion.affinity) : companion.level
      companion.updatedAt = new Date().toISOString()
      if (cfg.companionFile) {
        const t = cfg.companionFile + '.tmp'
        fs.writeFileSync(t, JSON.stringify(companion), 'utf8')
        fs.renameSync(t, cfg.companionFile)
      }
    } catch {}
  }
  let events = []
  try {
    if (cfg.eventsFile && fs.existsSync(cfg.eventsFile)) {
      const j = JSON.parse(fs.readFileSync(cfg.eventsFile, 'utf8'))
      if (Array.isArray(j.events)) events = j.events
    }
  } catch {}
  let eventsDirty = false
  let eventsDirtyTimer = null
  const saveEvents = (force = false) => {
    if (!cfg.eventsFile) return
    if (!force) {
      eventsDirty = true
      if (!eventsDirtyTimer) {
        eventsDirtyTimer = setTimeout(
          () => {
            eventsDirtyTimer = null
            if (eventsDirty) saveEvents(true)
          },
          Number(cfg.eventsSaveMs || 2000)
        )
      }
      return
    }
    eventsDirty = false
    persistStats.events += 1
    try {
      const t = cfg.eventsFile + '.tmp'
      fs.writeFileSync(t, JSON.stringify({ events: events.slice(-500) }), 'utf8')
      fs.renameSync(t, cfg.eventsFile)
    } catch {}
  }
  const pushEvent = (kind, level, payload, said) => {
    events.push({
      at: new Date().toISOString(),
      kind,
      level,
      payload: String(payload || '').slice(0, 80),
      said: !!said,
      unread: level === 'S0' || level === 'S1'
    })
    if (events.length > 500) events = events.slice(-500)
    saveEvents()
  }
  const interact = (name) => {
    const now = Date.now()
    const limits = { head: 5 * 60 * 1000, feed: 0, come: 60 * 1000 }
    // v47 契约：手动互动在 off/silent/focus 下仍保留（force 直发，不受模式门控）
    if (name === 'head') {
      send('cmd:fx:love', { force: true })
      companion.mood = Math.min(100, companion.mood + 3)
      companion.affinity = Math.min(100, companion.affinity + 0.5)
    } else if (name === 'feed') {
      const h = new Date().getHours()
      if (h >= 23 || h < 8) return 'feed-night'
      send('act:jump', { force: true })
      setTimeout(() => send('cmd:fx:love', { force: true }), 300)
      companion.mood = Math.min(100, companion.mood + 2)
      companion.energy = Math.min(100, companion.energy + 3)
    } else if (name === 'come') {
      send('walk:nearby', { force: true })
      setTimeout(() => send('freeze:800', { force: true }), 700)
      companion.mood = Math.min(100, companion.mood + 1)
    }
    companion.totals.interactions += 1
    companion.lastSeenAt = new Date().toISOString()
    saveCompanion(true)
    pushEvent('interaction', 'S3', name, false)
    log('info', 'interaction', { name, mood: companion.mood, affinity: companion.affinity })
    return 'ok'
  }
  // v38 偷吃判定 + 久别重逢 v2（隐私：只用 token 数/状态枚举/时间，不读原文）
  const tokenHistory = []
  let usageSpikeDay = ''
  let usageSpikeCount = 0
  let lastSpikeAt = 0
  const SPIKE_LINES = ['糟了，被发现了…', '我、我就多看了两眼…', '这可不是偷吃哦']
  const REUNION_2D = '你回来啦…我还以为要等很久'
  const REUNION_7D = '好久不见，上次你好像在忙，我就一直趴这儿'
  const checkUsageSpike = (turnTokens) => {
    try {
      const cg = cfg.spike || {}
      if (cg.enabled === false) return
      const win = tokenHistory.slice(-(cg.window || 20))
      tokenHistory.push(turnTokens)
      if (tokenHistory.length > 20) tokenHistory.shift()
      if (win.length < (cg.minSamples || 8) || !turnTokens || turnTokens < (cg.absFloor || 3000)) return
      const sorted = [...win].sort((a, b) => a - b)
      const base = sorted[Math.floor(sorted.length / 2)]
      if (!base || turnTokens <= base * (cg.ratio || 1.8)) return
      const dayKey = new Date().toISOString().slice(0, 10)
      if (usageSpikeDay !== dayKey) {
        usageSpikeDay = dayKey
        usageSpikeCount = 0
      }
      if (usageSpikeCount >= (cg.dailyCap || 3) || Date.now() - lastSpikeAt < (cg.cooldownMs || 600000)) return
      usageSpikeCount += 1
      lastSpikeAt = Date.now()
      send('cmd:fx:sweat')
      setTimeout(() => {
        void generate('spike', { tools: 0, tokens: turnTokens }).then((g) =>
          speak('turnEndBad', g.text, { force: true, source: g.source, latencyMs: g.latencyMs, tokens: g.tokens })
        )
      }, 350)
      pushEvent('usage', 'S2', '用量突增', true)
      log('info', 'usage spike', { turnTokens, base: Math.round(base), count: usageSpikeCount })
    } catch {}
  }
  const checkReunion = () => {
    try {
      const last = companion.lastUserSeenAt || companion.lastSeenAt
      if (!last) return
      const gap = Date.now() - Date.parse(last)
      const todayKey = new Date().toISOString().slice(0, 10)
      if (companion.lastGreetDate === todayKey) return
      if (gap < 2 * 3600000) return
      const text =
        gap >= 3 * 86400000
          ? gap >= 7 * 86400000
            ? REUNION_7D
            : '你回来啦，这几天没见我心里空空的'
          : gap >= 86400000
            ? '你回来啦，一天没见，我都想你了'
            : '你回来啦，刚才那会儿我还以为你忙完了'

      const activityLabel = companion.lastActivityLabel
      companion.lastGreetDate = todayKey
      companion.affinity = Math.min(100, (companion.affinity || 0) + 2)
      companion.mood = Math.min(100, (companion.mood || 0) + 3)
      saveCompanion()
      setTimeout(() => {
        try {
          send('walk:nearby')
          // v49.1：文案清洗 —— 主句去尾标点 + 活动标签中文化（旧版会拼出 `…没走。，上次在thinking`）
          void generate('reunion', { tools: 0 })
            .then((g) => {
              if (
                speak('morning', composeReunion(g.text, activityLabel), {
                  force: true,
                  source: g.source,
                  style: 'greet',
                  latencyMs: g.latencyMs,
                  tokens: g.tokens
                })
              ) {
                setTimeout(() => whaleAct('wave'), 600) // CF1：久别重逢挥手（wave 冷却 2h）
              }
            })
            .catch(() => {
              if (
                speak('morning', composeReunion(text, activityLabel), { force: true, source: 'pool', style: 'greet' })
              ) {
                setTimeout(() => whaleAct('wave'), 600)
              }
            })
        } catch {}
      }, 2500)
      pushEvent('reunion', 'S1', gap >= 7 * 86400000 ? '久别 7 天+' : '久别 2 天+', true)
      log('info', 'reunion', { days: Math.floor(gap / 86400000) })
    } catch {}
  }

  const todayReset = () => {
    const d = new Date().toISOString().slice(0, 10)
    if (today.date !== d) {
      // v46/v47：跨天重置全部日统计（旧版漏了 tokens/角色/cost/agentCalls 等，会串到新的一天）
      today.date = d
      today.turns = 0
      today.toolCalls = 0
      today.longestTurnMs = 0
      today.tokens = 0
      today.tokensInput = 0
      today.tokensOutput = 0
      today.tokensCacheRead = 0
      today.tokensCacheWrite = 0
      today.tokensUser = 0
      today.tokensAgent = 0
      today.roleUnknown = 0
      today.agentCalls = 0
      today.costUserYuan = 0
      today.costAgentYuan = 0
      today.costYuan = 0
      today.costYuanFlat = 0
      today.costCacheYuan = 0
      today.cacheSavedYuan = 0
      today.petLlmCostYuan = 0
      today.calls = 0
      today.riceBowls = 0
      log('info', 'today rollover', { date: d })
    }
    rollLlmDay()
    // v46：calls/petLlmCostYuan 以续种后的 llmDay 为准（reload 不清零）
    publishLlmAccounting()
    // v47：分项计价（估算）；costYuanFlat 保留 v46 旧口径对照；三本账按 token 占比分摊（两者和 = 总）
    const price = priceTable(cfg.pricing)
    const parts = {
      input: Number(today.tokensInput) || 0,
      output: Number(today.tokensOutput) || 0,
      cacheRead: Number(today.tokensCacheRead) || 0,
      cacheWrite: Number(today.tokensCacheWrite) || 0,
      total: Number(today.tokens) || 0
    }
    const itemCost = costOf(parts, price)
    const split = splitCost(itemCost, today.tokensUser, today.tokens)
    today.costYuan = Number(itemCost.toFixed(4))
    today.costUserYuan = split.user
    today.costAgentYuan = split.agent
    today.costYuanFlat = Number(flatCostOf(today.tokens, price).toFixed(4))
    today.costCacheYuan = Number(
      ((parts.cacheRead * price.cacheReadPerM + parts.cacheWrite * price.cacheWritePerM) / 1e6).toFixed(4)
    )
    today.cacheSavedYuan = Number(
      (
        (parts.cacheRead * Math.max(0, price.inputPerM - price.cacheReadPerM) +
          parts.cacheWrite * Math.max(0, price.inputPerM - price.cacheWritePerM)) /
        1e6
      ).toFixed(4)
    )
    today.budgetYuan = cfg.llm.budgetPerDayYuan || 1
    today.riceBowls = Number(((today.tokens || 0) / (cfg.rice?.bowlTokens || 100000)).toFixed(2))
    today.period = new Date().getHours() >= 0 && new Date().getHours() < 8 ? '低谷' : '高峰'
  }

  // task-69：state 写盘节流（默认 10s，低占用 20s）；写前重算派生字段保证快照自洽
  let lastStateWriteAt = 0
  let stateWriteSkipped = 0
  const writeState = (force = false) => {
    const target = cfg.stateFileV2 || ''
    if (!target) return
    const interval = refreshLowFootprint()
      ? Number(cfg.lowMemory?.stateWriteMs || 20000)
      : Number(cfg.stateWriteMs || 10000)
    const nowMs = Date.now()
    if (!force && nowMs - lastStateWriteAt < interval) {
      stateWriteSkipped += 1
      return
    }
    lastStateWriteAt = nowMs
    // v46：状态文件可能被事件路径（ui-action/互动等）在两次心跳之间触发写入；
    // 写盘前重算派生字段（cost*/riceBowls/calls/petLlmCostYuan），保证快照自洽（verifier 断言按文件读取）。
    try {
      todayReset()
    } catch {}
    try {
      const sess = sessionsPayload() // task-69：每次写盘只算一次（旧版算 4 次）
      const state = {
        updatedAt: new Date().toISOString(),
        version: '0.49.0',
        writerId: '0.49.0', // v49：多模块并存时辨认真正的写者（v2 version 与实际 loaded 一致性证据）
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
        petVersion: 'v1.1.5+patch-v49',
        lastAction,
        petSettings: cfg.petSettings || {},
        bubble: cfg.bubble || {},
        status: {
          state: statusState.state,
          stateClass: statusState.stateClass,
          tool: statusState.tool,
          toolType: statusState.toolType,
          subkind: statusState.subkind,
          phase: statusState.phase,
          since: statusState.since,
          step: statusState.step,
          turn: statusState.turn,
          heartbeatAt: statusState.heartbeatAt,
          source: statusState.source,
          message: statusState.message
        },
        attribution: {
          active: activeSessionId ? String(activeSessionId).slice(0, 16) : null,
          bootstrapped: attributionBootstrapped
        },
        currentSessionId: currentSessionId ? String(currentSessionId).slice(0, 16) : null,
        today,
        priceTable: priceTable(cfg.pricing),
        mode: modeView(modeState),
        // task-69：宿主低占用观测（面板可显示"低占用中"/内存；阈值来自 lowMemory.rssMb）
        hostMemory: {
          rssMB: memRssMb(),
          heapMB: memHeapMb(),
          timers: timerCount(),
          lowFootprint: refreshLowFootprint(),
          thresholdRssMB: Number(cfg.lowMemory?.rssMb || 2000)
        },
        // v48：团队/目标/计划/等你选 —— 只读计数/状态枚举；投影缺失 → null + degraded（面板空态）
        team: teamV2.team,
        goal: teamV2.goal,
        plan: teamV2.plan,
        userQuestions: teamV2.userQuestions,
        degraded: teamV2.degraded,
        teamUpdatedAt: teamV2.updatedAt,
        companion: { ...companion, level: levelOf(companion.affinity), words: stateWords() },
        eventsUnread: events.filter((e) => e.unread).length,
        userActiveCount: sess.filter((x) => x.role === 'user').length,
        backgroundCount: sess.filter((x) => x.role !== 'user').length,
        activeSessionCount: sess.filter((x) => x.role === 'user').length,
        sessions: sess,
        skins: (() => {
          try {
            const pc = JSON.parse(fs.readFileSync(cfg.petConfigFile, 'utf8'))
            return { current: pc.skin || '大肥鱼', available: ['大肥鱼'] }
          } catch {
            return { current: '大肥鱼', available: ['大肥鱼'] }
          }
        })(),
        capabilities: {
          petActions: ['balance', 'weather', 'music', 'summary', 'show', 'hide', 'snapInto', 'recover'],
          interactions: { head: true, feed: true, come: true },
          doubleClick: true,
          skin: true,
          quiet: true,
          quit: true,
          autoStart: true,
          // v47/契约：面板可切换 active/focus/silent/off
          mode: { silent: true, focus: true, off: true, resume: true }
        },
        bootstrap: (() => {
          try {
            return JSON.parse(fs.readFileSync(cfg.lifecycle.bootstrapStateFile, 'utf8'))
          } catch {
            return null
          }
        })(),
        logsRecent: []
      }
      fs.writeFileSync(target, JSON.stringify(state), 'utf8')
      persistStats.state += 1
      persistStats.skipped = stateWriteSkipped
      // v47：旧 state.json 只写兼容镜像（权威仍是 bridge-state-v2.json，见 DATA-CONTRACT §10）
      try {
        if (cfg.stateFile) {
          const mirror = {
            updatedAt: state.updatedAt,
            version: state.version,
            petVersion: state.petVersion,
            host: state.host,
            pet: state.pet,
            enabled: state.enabled,
            compactOnly: true,
            today: state.today,
            mode: state.mode,
            status: state.status,
            companion: state.companion
          }
          const t2 = cfg.stateFile + '.tmp'
          fs.writeFileSync(t2, JSON.stringify(mirror), 'utf8')
          fs.renameSync(t2, cfg.stateFile)
        }
      } catch {}
    } catch {}
  }

  // ---------- v47 控制模式：应用 / 持久化 / 自动恢复 / 桌宠侧行为 ----------
  const captureRestorePet = () => {
    const pm = String(cfg.petSettings?.mode || '')
    restorePet.mode = pm && pm !== 'still' ? pm : 'wander'
    restorePet.locked = !!cfg.petSettings?.locked
    restorePet.lineFreq = String(cfg.petSettings?.lineFreq || '正常')
  }
  const persistMode = () => {
    if (!cfg.mode?.file) return
    try {
      fs.writeFileSync(cfg.mode.file, JSON.stringify({ ...modeState, updatedAt: new Date().toISOString() }), 'utf8')
    } catch {}
  }
  // focus/silent：停散步 + 锁位置 + 少主动台词；active：还原进入前的原生设置
  const pushModeToPet = () => {
    if (!petOnline) return
    try {
      if (modeEngaged()) {
        send('cmd:mode:still', { force: true })
        send('cmd:locked:true', { force: true })
        send('cmd:freq:安静', { force: true })
      } else {
        send('cmd:mode:' + restorePet.mode, { force: true })
        send('cmd:locked:' + (restorePet.locked ? 'true' : 'false'), { force: true })
        send('cmd:freq:' + restorePet.lineFreq, { force: true })
      }
      log('info', 'mode pet applied', modeView(modeState))
    } catch {}
  }
  const applyMode = (req, source = 'api') => {
    if (!req) return { ok: false, message: 'unsupported mode request' }
    const wanted = req.clear ? 'active' : normalizeKind(req.kind)
    if (wanted === 'active') {
      modeState.kind = 'active'
      modeState.resumeAt = 0
      modeState.since = new Date().toISOString()
      modeState.source = source
    } else {
      if (modeState.kind === 'active') captureRestorePet()
      modeState.kind = wanted
      modeState.resumeAt = resolveResumeAt(wanted, cfg.mode?.defaults, req.durationMs, new Date())
      modeState.since = new Date().toISOString()
      modeState.source = source
    }
    persistMode()
    pushModeToPet()
    try {
      bubbleQ.length = 0 // 进入模式时丢弃排队中的非 S0 气泡
    } catch {}
    // 契约：事件 kind = mode_change，级别 S1
    pushEvent('mode_change', 'S1', modeLabel(modeState.kind), false)
    const view = modeView(modeState)
    log('info', 'mode change', {
      kind: view.kind,
      remainMs: view.remainMs,
      resumeAt: view.resumeAt,
      source,
      auto: !!req.auto
    })
    writeState(true) // 模式变化立即落盘（不被写盘节流吞掉，面板/verifier 即时可见）
    return { ok: true, message: view.kind + (view.remainMs ? ' remainMs=' + view.remainMs : '') }
  }
  const modeTick = () => {
    if (!modeEngaged() || !modeState.resumeAt) return
    if (cfg.mode?.autoResume === false) return
    if (Date.now() >= modeState.resumeAt) {
      log('info', 'mode auto resume', { from: modeState.kind })
      applyMode({ kind: 'active', clear: true, auto: true }, 'auto')
    }
  }
  const modeTimer = setInterval(modeTick, 1000)
  // 启动加载：优先持久化恢复；契约迁移：petSettings.mode='still' → normal（不迁移，避免被困）
  const loadMode = () => {
    let restored = false
    try {
      if (cfg.mode?.file && fs.existsSync(cfg.mode.file)) {
        const j = JSON.parse(fs.readFileSync(cfg.mode.file, 'utf8'))
        const kind = normalizeKind(j.kind)
        const resumeAt = Number(j.resumeAt) || 0
        if (kind !== 'active' && !(resumeAt && resumeAt <= Date.now())) {
          modeState.kind = kind
          modeState.resumeAt = resumeAt
          modeState.since = j.since || new Date().toISOString()
          modeState.source = 'restore'
          restored = true
        }
        log('info', 'mode restored', { kind: modeState.kind, remainMs: modeView(modeState).remainMs })
      }
    } catch {}
    if (!restored && String(cfg.petSettings?.mode || '') === 'still') {
      cfg.petSettings = { ...(cfg.petSettings || {}), mode: 'wander' }
      log('info', 'pet mode still -> normal (v47 contract)')
    }
    captureRestorePet()
    if (modeEngaged()) pushModeToPet()
  }
  loadMode()
  // 外部模式请求文件（快捷键助手等写入；1s 轮询，消费后写 handled 标记）
  let modeRequestRaw = ''
  const pollModeRequest = () => {
    if (!cfg.mode?.requestFile) return
    try {
      const raw = fs.readFileSync(cfg.mode.requestFile, 'utf8')
      if (!raw || raw === modeRequestRaw) return
      modeRequestRaw = raw
      const j = JSON.parse(raw)
      const req = normalizeRequest(j, cfg.mode?.defaults)
      if (!req) return
      applyMode(req, 'request-file')
      log('info', 'mode request consumed', { kind: req.kind, name: String(j.name || '') })
      try {
        fs.writeFileSync(cfg.mode.requestFile, JSON.stringify({ handled: true, at: new Date().toISOString() }), 'utf8')
      } catch {}
    } catch {}
  }
  const modeRequestTimer = setInterval(pollModeRequest, 1000)

  // ---------- v48：team / goal / plan / userQuestions 只读 v2 字段（投影快照，≤1/min） ----------
  const refreshTeamV2 = (force = false) => {
    if (!cfg.teamV2?.enabled) return
    const now = Date.now()
    if (!force && now - lastTeamV2At < Number(cfg.teamV2?.refreshMs || 60000)) return
    lastTeamV2At = now
    let svc = null
    let teamsSvc = false
    try {
      svc = typeof ctx.get === 'function' ? ctx.get('sessionProjections') : null
      teamsSvc = !!(typeof ctx.get === 'function' ? ctx.get('agentTeams') : null)
    } catch {}
    const session = lastSessionRef && typeof lastSessionRef.deref === 'function' ? lastSessionRef.deref() : null
    if (!svc || typeof svc.snapshot !== 'function') {
      teamV2 = buildTeamV2({ values: {}, services: { teams: teamsSvc }, sentCount: userQuestionsSentCount })
      teamV2.degraded = ['sessionProjections:unsupported']
      log('info', 'team v2 degraded', { reason: 'sessionProjections:unsupported', teamsSvc })
      writeState(true)
      return
    }
    if (!session) {
      teamV2 = emptyTeamV2('session:none')
      return
    }
    try {
      const snap = svc.snapshot(session, ['agentTeam', 'goal', 'plan', 'userQuestions'])
      const next = buildTeamV2({
        values: (snap && snap.values) || {},
        services: { teams: teamsSvc },
        sentCount: userQuestionsSentCount
      })
      const changed =
        JSON.stringify(next.team) !== JSON.stringify(teamV2.team) ||
        JSON.stringify(next.goal) !== JSON.stringify(teamV2.goal) ||
        JSON.stringify(next.plan) !== JSON.stringify(teamV2.plan) ||
        JSON.stringify(next.userQuestions) !== JSON.stringify(teamV2.userQuestions) ||
        JSON.stringify(next.degraded) !== JSON.stringify(teamV2.degraded)
      teamV2 = next
      if (changed || force) {
        // 隐私：只记计数/状态/阶段，不记 subject/description/objective/cwd
        log('info', 'team v2 updated', {
          team: teamV2.team && {
            enabled: teamV2.team.enabled,
            status: teamV2.team.status,
            members: teamV2.team.members,
            tasks: teamV2.team.tasks
          },
          goal: teamV2.goal && { status: teamV2.goal.status, rounds: teamV2.goal.roundsStarted },
          plan: teamV2.plan,
          uq: teamV2.userQuestions && teamV2.userQuestions.active,
          degraded: teamV2.degraded
        })
        writeState(true)
      }
    } catch (e) {
      // 异常不崩：保留上一次有效值，标记降级
      teamV2 = { ...teamV2, degraded: ['snapshot:error'] }
      log('warn', 'team v2 snapshot failed', { error: clip(e && e.message, 80) })
    }
  }
  const scheduleTeamRefresh = () => {
    if (teamV2Timer) return
    teamV2Timer = setTimeout(() => {
      teamV2Timer = null
      refreshTeamV2()
    }, 400)
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
      if (typeof j.enabled === 'boolean') {
        cfg.enabled = j.enabled
        applied.enabled = j.enabled
      }
      if (Array.isArray(j.quietHours)) {
        const ok = j.quietHours.filter((r) => typeof r === 'string' && /^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(r))
        if (ok.length) {
          cfg.quietHours = ok
          applied.quietHours = ok
        }
      }
      // v47 契约：ui-config.mode = {silentMinutes,focusMinutes,offUntil,autoResume}
      // 用户已 DROP 全局快捷键：不再读取/暴露 hotkey 配置
      if (j.mode && typeof j.mode === 'object') {
        const md = { ...(cfg.mode?.defaults || {}) }
        if (Number(j.mode.silentMinutes) > 0) md.silentMs = Number(j.mode.silentMinutes) * 60000
        if (Number(j.mode.focusMinutes) > 0) md.focusMs = Number(j.mode.focusMinutes) * 60000
        if (j.mode.offUntil !== undefined && j.mode.offUntil !== null) md.offUntil = j.mode.offUntil
        cfg.mode = { ...(cfg.mode || {}), defaults: md }
        if (typeof j.mode.autoResume === 'boolean') cfg.mode.autoResume = j.mode.autoResume
        applied.mode = {
          silentMinutes: Math.round((Number(md.silentMs) || 0) / 60000),
          focusMinutes: Math.round((Number(md.focusMs) || 0) / 60000),
          offUntil: md.offUntil ?? null,
          autoResume: cfg.mode.autoResume !== false
        }
      }
      if (j.llm && Number.isFinite(Number(j.llm.budgetPerDayYuan))) {
        cfg.llm.budgetPerDayYuan = Number(j.llm.budgetPerDayYuan)
        applied.budgetPerDayYuan = cfg.llm.budgetPerDayYuan
      }
      if (j.pet && typeof j.pet === 'object') {
        applyPetSettings(j.pet)
        applied.pet = Object.keys(j.pet)
      }
      if (j.guards && typeof j.guards === 'object') {
        cfg.guards = { ...(cfg.guards || {}), ...j.guards }
        applied.guards = j.guards
      }
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
      // v49 TEST HOOK 动态开关（ui-config.testHook.file；默认无此键 = 关）
      if (j.testHook && typeof j.testHook === 'object') {
        const f = String(j.testHook.file || '').trim()
        if (f && !hookTimer) startTestHook(f)
        else if (!f && hookTimer) stopTestHook()
        applied.testHook = f ? 'on' : 'off'
      }
      if (typeof j.activity === 'string' && ACTIVITY_PRESETS[j.activity]) {
        applyActivity(j.activity)
        applied.activity = j.activity
      }
      log('info', 'ui-config applied', applied)
      writeState()
    } catch {}
  }

  // ---------- pipe：单连接串行队列 + 合并状态 + 指数退避（v47-hotfix） ----------
  // 旧实现"每行开一条 net.connect、并发写、600ms 超时 + 单次重试"在状态推送密集时会并发打开
  // 多个连接，桌宠命名管道处理不过来 ⇒ pipe timeout 刷屏。改为：全局串行、一次一条连接、
  // 状态行按 key 合并（只保留最新）、失败指数退避（400ms→30s）且不逐行重试、告警日志限流 30s。
  const pipeQ = []
  let pipeBusy = false
  let pipeFailStreak = 0
  let pipePausedUntil = 0
  let pipeDisposed = false
  let pipeWarnAt = 0
  const pipeTimeoutMs = () => Math.max(300, Number(cfg.pipeTimeoutMs) || 1200)
  const pipeWarn = (msg, extra) => {
    if (Date.now() - pipeWarnAt < 30000) return
    pipeWarnAt = Date.now()
    log('warn', msg, extra)
  }
  const pipePump = () => {
    if (pipeDisposed || pipeBusy || !pipeQ.length) return
    const wait = pipePausedUntil - Date.now()
    if (wait > 0) {
      setTimeout(pipePump, wait)
      return
    }
    const item = pipeQ.shift()
    pipeBusy = true
    let settled = false
    const finish = (ok) => {
      if (settled) return
      settled = true
      pipeBusy = false
      if (ok) {
        pipeFailStreak = 0
        pipePausedUntil = 0
        pipeStats.ok += 1
        // 成功后排下一行前稍等一拍，让桌宠先处理完当前连接（单连接串行，不并发）
        if (!pipeDisposed) setTimeout(pipePump, 15)
      } else {
        pipeFailStreak += 1
        pipeStats.fail += 1
        const backoff = Math.min(30000, 400 * Math.pow(2, Math.min(6, pipeFailStreak - 1)))
        pipePausedUntil = Date.now() + backoff
        pipeWarn('pipe backoff', { streak: pipeFailStreak, backoffMs: backoff, queued: pipeQ.length })
        if (!pipeDisposed) setTimeout(pipePump, 0)
      }
    }
    try {
      const sock = net.connect(cfg.pipe)
      sock.setTimeout(pipeTimeoutMs())
      let wrote = false
      sock.once('connect', () => {
        // 桌宠管道语义：服务端读到一行就 dispatch 并主动断开 ⇒ 客户端写完后会收到 EPIPE/close，属正常。
        // 因此「写在 connect 内成功」即视为投递成功，不等待 close（否则每行都被误判成超时/失败）。
        try {
          sock.write(item.line + '\n')
          sock.end()
          wrote = true
          finish(true)
        } catch {
          finish(false)
        }
        setTimeout(() => {
          try {
            sock.destroy()
          } catch {}
        }, 80)
      })
      sock.on('data', () => {})
      sock.once('close', () => finish(wrote))
      sock.once('error', () => {
        try {
          sock.destroy()
        } catch {}
        finish(wrote) // 已写出 = 已投递（EPIPE 是桌宠主动断开的正常表现）
      })
      sock.once('timeout', () => {
        try {
          sock.destroy()
        } catch {}
        finish(wrote)
      })
    } catch (e) {
      finish(false)
      pipeWarn('pipe connect threw', { error: clip(e && e.message, 80) })
    }
  }
  const pipeEnqueue = (line, opts = {}) => {
    if (pipeDisposed) return
    const item = { line: String(line), key: opts.coalesceKey || '' }
    if (item.key) {
      for (let i = pipeQ.length - 1; i >= 0; i--) {
        if (pipeQ[i].key === item.key) {
          pipeQ[i] = item // 同 key 只保留最新（例如 state: 只推当前状态）
          return
        }
      }
    }
    if (pipeQ.length >= 200) pipeQ.shift()
    pipeQ.push(item)
    if (!pipeBusy) setTimeout(pipePump, 0)
  }
  function send(line, opts = {}) {
    // v47 模式门控：自动演出按 mode 拦截；手动互动/模式指令传 force:true
    if (!opts.force && !modeAllowsPipeLine(line)) {
      logModeSuppress('pipe', String(line).split('|')[0])
      return
    }
    if (cfg.dryRun) {
      log('info', 'dryRun send', { line })
      return
    }
    pipeEnqueue(line, opts)
  }
  // ---------- P0 v9: bubble queue (serial, coalesce, configurable durations) ----------
  let bubbleQ = []
  let bubbleBusyUntil = 0
  let activeSessionId = null
  // ---------- task-46 多会话/多工作区 ----------
  const sessionRegistry = new Map()
  let currentSessionId = null
  let lastSwitchAt = 0
  const ROLE_BG = new Set(['subagent', 'teammate', 'team', 'delegate', 'background', 'tool'])
  const roleOf = (hdr) => {
    const o = String(hdr.origin || '').toLowerCase()
    if (ROLE_BG.has(o)) return o
    if ((hdr.delegationDepth ?? 0) > 0) return 'subagent'
    return 'user'
  }
  // v46：usage 角色判定（与会话列表展示口径分开）。
  // 已知：顶层会话（origin 为空）→ user；subagent/团队（origin 命中 ROLE_BG 或 delegationDepth>0）→ agent。
  // 非空但未知的 origin 视为未知角色：tokens 归 user 并计数 today.roleUnknown（规格要求）。
  const usageTokens = (u) => usageParts(u).total
  const usageRoleOf = (session) => {
    const hdr = session && session.header
    if (!hdr) return 'unknown'
    const origin = String(hdr.origin || '').toLowerCase()
    if (ROLE_BG.has(origin)) return 'agent'
    if ((hdr.delegationDepth ?? 0) > 0) return 'agent'
    if (!origin || origin === 'user') return 'user'
    return 'unknown'
  }
  let roleUnknownLoggedAt = 0
  // v46/v47：usage 归集放在 skipSubagent/归因过滤之前调用 ⇒ tokens 覆盖全部角色/会话（含团队/后台）。
  const accountUsage = (session, data) => {
    const u = data && data.usage
    if (!u) return 0
    const parts = usageParts(u)
    const dt = parts.total
    if (!dt) return 0
    today.tokens = (today.tokens || 0) + dt
    // v47：分项累计（cache 原样单列，用于分项计价）
    today.tokensInput = (today.tokensInput || 0) + parts.input
    today.tokensOutput = (today.tokensOutput || 0) + parts.output
    today.tokensCacheRead = (today.tokensCacheRead || 0) + parts.cacheRead
    today.tokensCacheWrite = (today.tokensCacheWrite || 0) + parts.cacheWrite
    let role = usageRoleOf(session)
    if (role === 'unknown') {
      today.roleUnknown = (today.roleUnknown || 0) + 1
      if (Date.now() - roleUnknownLoggedAt > 60000) {
        roleUnknownLoggedAt = Date.now()
        log('warn', 'usage role unknown -> user', { session: String((session && session.id) || '').slice(0, 16) })
      }
      role = 'user'
    }
    if (role === 'user') today.tokensUser = (today.tokensUser || 0) + dt
    else today.tokensAgent = (today.tokensAgent || 0) + dt
    return dt
  }
  const touchSession = (session) => {
    const hdr = session.header || {}
    const id = String(session.id)
    let rec = sessionRegistry.get(id)
    if (!rec) {
      const cwd = String(hdr.cwd || '')
      const base = cwd
        ? cwd
            .replace(/[\\/]+$/, '')
            .split(/[\\/]/)
            .pop()
        : 'workspace'
      const rawTitle = String(session.title || hdr.title || '').trim()
      const shortId = id.replace(/[^A-Za-z0-9]/g, '').slice(-8) || id.slice(-8)
      rec = {
        sessionId: id,
        workspace: cwd,
        title: rawTitle || base + ' · #' + shortId,
        role: roleOf(hdr),
        lastUserMessageAt: 0,
        state: 'idle',
        tool: null,
        step: null,
        lastSeenAt: Date.now()
      }
      sessionRegistry.set(id, rec)
    }
    rec.lastSeenAt = Date.now()
    rec.role = roleOf(hdr)
    return rec
  }
  const pruneSessions = () => {
    const ttl = cfg.attribution?.activeTtlMs || 1800000
    const now = Date.now()
    for (const [id, rec] of sessionRegistry) {
      if (now - (rec.lastUserMessageAt || rec.lastSeenAt) > ttl) sessionRegistry.delete(id)
    }
  }
  const sessionsPayload = () => {
    const now = Date.now()
    return Array.from(sessionRegistry.values())
      .filter((r) => now - (r.lastUserMessageAt || r.lastSeenAt) <= (cfg.attribution?.activeTtlMs || 1800000))
      .sort((a, b) => (b.lastUserMessageAt || b.lastSeenAt) - (a.lastUserMessageAt || a.lastSeenAt))
      .slice(0, 20)
      .map((r) => ({
        sessionId: String(r.sessionId).slice(0, 16),
        // v47 隐私：不落绝对路径 —— name(basename) + hash 区分同名；workspace 为兼容旧字段（只给 name）
        workspace: workspaceName(r.workspace),
        workspaceName: workspaceName(r.workspace),
        workspaceHash: workspaceHash(r.workspace),
        title: r.title,
        role: r.role,
        lastUserMessageAt: r.lastUserMessageAt ? new Date(r.lastUserMessageAt).toISOString() : null,
        state: r.state,
        tool: r.tool,
        step: r.step,
        lastSeenAt: new Date(r.lastSeenAt).toISOString(),
        current: String(r.sessionId) === String(currentSessionId)
      }))
  }
  let activeAt = 0
  let attributionBootstrapped = false
  if (cfg.attribution?.enabled && cfg.attribution.bootstrapLastKnown !== false && cfg.attribution.stateFile) {
    try {
      const j = JSON.parse(fs.readFileSync(cfg.attribution.stateFile, 'utf8'))
      if (j && j.sessionId) {
        activeSessionId = j.sessionId
        activeAt = Date.now()
        attributionBootstrapped = true
        currentSessionId = j.sessionId
        if (!sessionRegistry.get(String(j.sessionId))) {
          const sid = String(j.sessionId)
          sessionRegistry.set(sid, {
            sessionId: sid,
            workspace: String(j.cwdName || workspaceName(j.cwd) || ''),
            title: 'workspace · #' + sid.slice(-8),
            role: 'user',
            lastUserMessageAt: Date.now(),
            state: 'idle',
            tool: null,
            step: null,
            lastSeenAt: Date.now()
          })
        } else {
          const rr = sessionRegistry.get(String(j.sessionId))
          if (!rr.lastUserMessageAt) rr.lastUserMessageAt = Date.now()
        }
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
          if (cfg.attribution?.stateFile)
            fs.writeFileSync(
              cfg.attribution.stateFile,
              JSON.stringify({ sessionId: last, at: new Date().toISOString(), source: 'log' })
            )
        } catch {}
      }
    } catch {}
  }
  const attrSkipLogAt = {}

  // ---------- v48/v49：team v2 bootstrap（复用 attribution last-known，reload 后不等用户发消息就有数） ----------
  const bootstrapDiagnostics = () => {
    try {
      const store = typeof ctx.get === 'function' ? ctx.get('sessions') : null
      const id = activeSessionId || currentSessionId || null
      const live = store && typeof store.list === 'function' ? store.list().length : -1
      return { hasStore: !!store, hasId: !!id, liveSessions: live }
    } catch (e) {
      return { hasStore: false, hasId: false, liveSessions: -1, error: clip(e && e.message, 60) }
    }
  }
  const bootstrapTeamFromAttribution = () => {
    try {
      const store = typeof ctx.get === 'function' ? ctx.get('sessions') : null
      const id = activeSessionId || currentSessionId || null
      if (!store || typeof store.get !== 'function' || !id) return false
      let session = store.get(id)
      if (!session && typeof store.list === 'function') {
        // attribution 日志里可能是 16 字符截断 id → 前缀匹配 live 会话
        const sid = String(id)
        session = store.list().find((s) => s && String(s.id).startsWith(sid))
      }
      if (!session) return false
      lastSessionRef = new WeakRef(session)
      return true
    } catch {
      return false
    }
  }
  // 重试 5 次（3s/8s/15s/25s/40s）：host 重启后会话可能尚未进入 live store，早读会 miss
  let teamBootstrapTry = 0
  const tryBootstrapTeam = () => {
    teamBootstrapTry += 1
    const ok = bootstrapTeamFromAttribution()
    const diag = bootstrapDiagnostics()
    if (ok) {
      lastTeamV2At = 0 // 允许立即刷新（不受 ≤1/min 节流初始值影响）
      refreshTeamV2(true)
      log('info', 'team v2 bootstrap', { ok: true, from: 'attribution', try: teamBootstrapTry })
      return
    }
    if (teamBootstrapTry === 1) log('info', 'team v2 bootstrap retry', { try: teamBootstrapTry, ...diag })
    if (teamBootstrapTry < 5) {
      const delays = [5000, 7000, 10000, 15000]
      setTimeout(tryBootstrapTeam, delays[teamBootstrapTry - 1] || 15000)
      return
    }
    log('warn', 'team v2 bootstrap', { ok: false, from: 'attribution', ...diag })
  }
  setTimeout(tryBootstrapTeam, 3000)
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
    bubbleQ.push({
      text: t,
      kind,
      style,
      source: meta.source || 'pool',
      durMs: bubbleDurFor(kind, style),
      prio: bubblePrio(kind, style),
      at: Date.now(),
      notBefore: Date.now() + (meta.notBeforeMs || 0),
      latencyMs: meta.latencyMs ?? null,
      tokens: meta.tokens ?? null
    })
    if (bubbleQ.length > (cfg.bubble?.maxQueue || 8)) bubbleQ.shift()
    log('info', 'bubble queue', { kind, style: style || 'normal', q: bubbleQ.length })
    return true
  }
  const sendBubble = (item) => {
    // v46：calls/petLlmCostYuan 已改在 callLlm 成功处计账（此处不再重复累计，避免 pregen/重试/排队重复计数）
    const sec = Math.max(1, Math.min(30, Math.round(item.durMs / 1000)))
    recentSay.push({ at: new Date().toISOString(), kind: item.kind, source: item.source, line: item.text })
    if (recentSay.length > 10) recentSay.shift()
    log('info', 'say', {
      kind: item.kind,
      style: item.style || 'normal',
      source: item.source,
      line: item.text,
      latencyMs: item.latencyMs,
      tokens: item.tokens,
      callsToday: llmDay.calls,
      costToday: Number(llmDay.cost.toFixed(4)),
      showMs: sec * 1000
    })
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
      const ready = bubbleQ.filter((x) => (x.notBefore || 0) <= now)
      if (!ready.length) return
      if (ready.length > 1 && now - ready[0].at <= win) {
        ready.sort((a, b) => b.prio - a.prio)
        const keep = ready[0]
        bubbleQ = bubbleQ.filter((x) => !ready.includes(x))
        if (ready.length > 1) log('info', 'bubble coalesced', { kept: keep.kind, dropped: ready.length - 1 })
        sendBubble(keep)
        return
      }
      ready.sort((a, b) => b.prio - a.prio)
      const chosen = ready[0]
      bubbleQ = bubbleQ.filter((x) => x !== chosen)
      sendBubble(chosen)
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
        setTimeout(() => {
          log('info', 'inner queued', { kind, delayMs: Math.round(delay) })
          enqueueBubble(inner, 'inner', { source: 'pool' })
        }, delay)
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
    if (k !== dayKey) {
      dayKey = k
      dayCount = 0
    }
    return dayCount
  }
  const hourCount = () => {
    const cut = Date.now() - 3600e3
    while (hourStamps.length && hourStamps[0] < cut) hourStamps.shift()
    return hourStamps.length
  }
  const quietNow = () => inRanges(new Date(), cfg.quietHours)

  // ---------- CF1：鲸鱼娘 act 生产者（report / wave / sneak） ----------
  // 白名单启动时只读一次（优先 repo 真源、缺失回退随包副本；都缺 → 禁用 whaleActs，不崩插件）。
  const whaleWhitelistInfo = loadWhitelist()
  const whaleWhitelist = whaleWhitelistInfo ? whaleWhitelistInfo.acts : null
  if (!whaleWhitelist) {
    cfg.whaleActs.enabled = false
    log('warn', 'whale acts disabled: whitelist missing')
  } else {
    log('info', 'whale acts whitelist loaded', { source: whaleWhitelistInfo.source, acts: whaleWhitelist.size })
  }
  const whaleActState = { last: {}, day: '', today: {} }
  let lastSneakEvalAt = 0
  /**
   * 决策 → 发送。只负责"该不该发"；实际发送复用现有 act()（保留 noActionOnSameState /
   * maxActionsPerHour 等守卫），日志只记 key/reason（不含文本/数字/路径）。
   */
  const whaleAct = (key) => {
    const nowMs = Date.now()
    const dayKey = new Date().toDateString()
    if (whaleActState.day !== dayKey) {
      whaleActState.day = dayKey
      whaleActState.today = {}
    }
    const res = shouldFire({
      key,
      now: nowMs,
      cfg: cfg.whaleActs,
      enabled: !!(cfg.enabled && cfg.actions?.enabled),
      modeKind: modeState.kind,
      quiet: quietNow(),
      petOnline,
      lastAt: whaleActState.last[key] || 0,
      firedToday: whaleActState.today[key] || 0,
      idleMs: nowMs - lastEventAt,
      whitelist: whaleWhitelist,
      state: statusState.state,
      lastActionState: statusState.lastActionState,
      noActionOnSameState: cfg.guards?.noActionOnSameState !== false,
      actionsThisHour: hourlyActions,
      maxActionsPerHour: cfg.guards?.maxActionsPerHour,
      rng: Math.random
    })
    if (!res.fire) {
      log('debug', 'whale act suppressed', { key, reason: res.reason })
      return false
    }
    whaleActState.last[key] = nowMs
    whaleActState.today[key] = (whaleActState.today[key] || 0) + 1
    act(key)
    log('info', 'whale act', { key, reason: res.reason })
    return true
  }

  const canSpeak = (kind, urgent = false, opts = {}) => {
    if (!cfg.enabled) return false
    if (quietNow() && !urgent) return false
    const now = Date.now()
    if (!urgent) {
      if (!opts.ignoreMinGap && now - lastSaidAt < (activityState.minGapMs || cfg.minGapMs)) {
        log('debug', 'skip throttle: minGap', { kind })
        return false
      }
      const cd = (cfg.cooldownMs[kind] || 0) * (activityState.cooldownScale || 1)
      if (now - (lastKindAt.get(kind) || 0) < cd) {
        log('debug', 'skip throttle: cooldown', { kind })
        return false
      }
    }
    if (hourCount() >= cfg.maxPerHour) {
      log('debug', 'skip throttle: maxPerHour', { kind })
      return false
    }
    if (nowCount() >= cfg.maxPerDay) {
      log('debug', 'skip throttle: maxPerDay', { kind })
      return false
    }
    if (!urgent && Math.random() > ((activityState.chance && activityState.chance[kind]) ?? cfg.chance[kind] ?? 1)) {
      log('debug', 'skip throttle: chance', { kind })
      return false
    }
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
    // v47：模式门控优先于 quietHours/activity —— focus/silent 只留 S0，off 全静默（手动互动走 force）
    if (!modeAllowsBubble(modeState.kind, kind, !!opts.urgent)) {
      logModeSuppress('bubble', kind)
      return false
    }
    if (!opts.force && !canSpeak(kind, opts.urgent, opts)) return false
    if (recentLines.some((x) => x.text === t)) {
      log('debug', 'skip throttle: duplicate', { kind })
      return false
    }
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
    approvals: 0
  }
  const rollStats = () => {
    const k = dateKey()
    if (stats.day !== k) {
      stats.day = k
      stats.turns = 0
      stats.tools = 0
      stats.tokens = 0
      stats.longestMs = 0
      stats.approvals = 0
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
      `等你点头 ${stats.approvals} 次`
    ].slice(0, cfg.maxReceiptLines || 4)
    try {
      const tmp = cfg.receiptFile + '.tmp'
      fs.writeFileSync(tmp, lines.join('\n') + '\n', 'utf8')
      fs.renameSync(tmp, cfg.receiptFile)
      log('debug', 'receipt written', { lines })
    } catch (e) {
      log('debug', 'receipt write failed', e && e.message)
    }
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
    const t = event.type
    const recEarly = touchSession(session)
    // v48：记录当前会话（WeakRef，不增加内存占用）；团队/目标/计划事件优先取用户根会话
    try {
      if (!recEarly || recEarly.role === 'user' || /^(team\/|goal\/|plan\/|user-questions\/)/.test(t)) {
        lastSessionRef = new WeakRef(session)
      }
    } catch {}
    if (t === 'user-questions/request') userQuestionsSentCount += 1
    if (/^(team\/|goal\/|plan\/)/.test(t) || t === 'user-questions/request' || t === 'turn/end') scheduleTeamRefresh()
    // v46：usage 先归集（全角色、含 team/subagent/background；不受 skipSubagent/归因过滤影响，纯统计不演出）
    if (t === 'assistant/message') accountUsage(session, event.data)
    if (!passesFilter(session)) {
      recEarly.state = recEarly.role === 'user' ? recEarly.state : 'background'
      if ((t === 'turn/start' || t === 'tool/call') && recEarly.role !== 'user') today.agentCalls += 1
      return
    }
    lastEventAt = Date.now()
    rollStats()
    const s = summaryOf(session)
    if (t === 'assistant/message.stream') return
    const d = event.data || {}
    log('debug', 'event', { type: t, session: String(session.id || '').slice(0, 14) })
    if (/error|failed/i.test(t)) {
      setStatus('error', { message: t })
      pushEvent('error', 'S0', t, true)
      if (cfg.actions?.enabled) {
        act('shake')
        setTimeout(() => send('cmd:fx:sweat'), 400)
        setTimeout(() => send('cmd:fx:sweat'), 1200)
      }
    }

    const hdr = session.header || {}
    const rec0 = recEarly
    if (t === 'user/message') {
      const srcKind = d.source && d.source.kind
      if (srcKind === 'user' && rec0.role === 'user') {
        rec0.lastUserMessageAt = Date.now()
        rec0.state = 'thinking'
        try {
          companion.lastUserSeenAt = new Date().toISOString()
          companion.lastActivityLabel = statusState.toolType || statusState.state || '忙碌'
        } catch {}
        const switchable = Date.now() - lastSwitchAt >= 2500
        if (String(session.id) !== String(currentSessionId) && switchable) {
          currentSessionId = session.id
          activeSessionId = session.id
          activeAt = Date.now()
          lastSwitchAt = Date.now()
          try {
            if (cfg.attribution?.stateFile)
              fs.writeFileSync(
                cfg.attribution.stateFile,
                JSON.stringify({
                  sessionId: session.id,
                  at: new Date().toISOString(),
                  cwdName: workspaceName(hdr.cwd)
                })
              )
          } catch {}
          log('info', 'session follow', {
            session: String(session.id).slice(0, 16),
            workspace: rec0.workspace,
            role: rec0.role
          })
        }
        if (String(session.id) === String(currentSessionId))
          setStatus('thinking', { source: String(session.id).slice(0, 16) })
      }
    }
    if (!attrSkipLogAt['hdr:' + String(session.id)]) {
      attrSkipLogAt['hdr:' + String(session.id)] = Date.now()
      log('info', 'attribution header', {
        session: String(session.id).slice(0, 16),
        origin: hdr.origin ?? null,
        depth: hdr.delegationDepth ?? 0,
        cwd: hdr.cwd ? 'set' : 'none'
      })
    }
    if (cfg.attribution?.enabled && cfg.attribution.onlyActive) {
      const denyOrigin2 =
        hdr.origin &&
        ['subagent', 'teammate', 'team', 'delegate', 'background', 'tool'].includes(String(hdr.origin).toLowerCase())
      const sid = String(session.id)
      const aid = activeSessionId ? String(activeSessionId) : ''
      const activeMatch = !!aid && (sid === aid || sid.startsWith(aid))
      if (activeMatch && !denyOrigin2 && sid !== aid) {
        // 启动 bootstrap 可能来自日志里的截断 id（16 字符）；命中后升级为完整 id 并持久化
        activeSessionId = session.id
        activeAt = Date.now()
        try {
          if (cfg.attribution?.stateFile)
            fs.writeFileSync(
              cfg.attribution.stateFile,
              JSON.stringify({ sessionId: sid, at: new Date().toISOString(), upgraded: true })
            )
        } catch {}
        log('info', 'attribution upgraded', { session: sid.slice(0, 16) })
      }
      const okay =
        activeMatch &&
        !denyOrigin2 &&
        (hdr.delegationDepth ?? 0) === 0 &&
        Date.now() - activeAt <= (cfg.attribution.activeTtlMs || 1800000)
      if (!okay) {
        const key = String(session.id)
        if (!attrSkipLogAt[key] || Date.now() - attrSkipLogAt[key] > 60000) {
          attrSkipLogAt[key] = Date.now()
          log('info', 'attribution skip', {
            session: key.slice(0, 16),
            reason: hdr.origin ? 'origin:' + hdr.origin : 'not-active',
            active: activeSessionId ? String(activeSessionId).slice(0, 16) : null
          })
        }
        const recB = sessionRegistry.get(String(session.id))
        if (recB) {
          recB.state = 'background'
          recB.tool = null
        }
        return
      }
    }

    if (t === 'user/message' || t === 'system/message' || t === 'request/header') return
    if (t === 'tool/call') {
      const toolName = String(d.tool || d.name || 'tool')
      const tt = toolTypeOf(toolName)
      // v46：ask_user_question = 等用户做选择 → 状态 waiting_input（stateClass 派生 waiting），不只是普通 tool
      const isAsk = tt.type === 'plan' && /^ask_user_question$/i.test(toolName)
      // v46：工具分类证据日志（按映射去重，避免每轮工具都刷一行；verifier 用 status.toolType + 该日志抽查）
      const mapKey = tt.type + '/' + (tt.subkind || '')
      if (lastToolTypeLogged !== mapKey) {
        lastToolTypeLogged = mapKey
        log('info', 'toolType mapped', { tool: toolName, toolType: tt.type, subkind: tt.subkind })
      }
      setStatus(isAsk ? 'waiting_input' : 'tool', {
        tool: toolName,
        toolType: tt.type,
        subkind: tt.subkind,
        step: s.tools + 1
      })
      {
        const r = sessionRegistry.get(String(session.id))
        if (r) {
          r.state = isAsk ? 'waiting_input' : 'tool'
          r.tool = toolName
          r.step = s.tools + 1
        }
      }
      s.tools += 1
      stats.tools += 1
      today.toolCalls += 1
      if (
        cfg.actions?.enabled &&
        activityState.level !== 'quiet' &&
        Date.now() - lastToolActAt >= (activityState.toolEveryMs || cfg.actions.toolEveryMs || 20000)
      ) {
        lastToolActAt = Date.now()
        toolActionSeq += 1
        if (tt.type === 'agent') today.agentCalls = (today.agentCalls || 0) + 1
        if (tt.type === 'read') act('peek')
        else if (tt.type === 'write') act('jump')
        else if (tt.type === 'command') {
          act('peek')
          setTimeout(() => walkNear(), 450)
        } else if (tt.type === 'search') {
          act('peek')
          setTimeout(() => act('peek'), 500)
        } else if (tt.type === 'mcp') {
          // v46：MCP 工具独立成类；动作沿用旧口径（探一下头），但不逐条播报
          act('peek')
        } else if (tt.type === 'agent') {
          /* 后台任务不动作 */
        }
      }
      return
    }
    if (t === 'assistant/message') {
      // v46：usage 已在入口 accountUsage 归集（全角色含 cache）；此处只累计当前会话摘要，供偷吃/报账判断
      const u = d.usage
      if (u) s.tokens += usageTokens(u)
      return
    }
    if (t === 'turn/start') {
      today.turns += 1
      currentTurnStartAt = Date.now()
      setStatus('thinking', { turn: stats.turns + 1, tool: null, step: 0 })
      {
        const r = sessionRegistry.get(String(session.id))
        if (r) {
          r.state = 'thinking'
          r.tool = null
          r.step = 0
        }
      }
      s.turnStartAt = Date.now()
      s.tools = 0
      stats.turns += 1
      if (cfg.actions?.enabled) {
        send('freeze:900') // 先停步，再小跳/旋转（spec：停步 + 小跳 0.7s，20% 旋转）
        act(Math.random() < (cfg.actions.turnStartSpinChance ?? 0.2) ? 'spin' : 'jump')
      }
      if (cfg.events.turnStart && canSpeak('turnStart')) {
        const fresh = pregen.text && Date.now() - pregen.at < (cfg.llm.pregenTtlMs || 600000)
        const g0 = cfg.guards || {}
        const startleMs =
          g0.startleDelayMinMs +
          Math.floor(Math.random() * Math.max(1, (g0.startleDelayMaxMs || 1500) - (g0.startleDelayMinMs || 900)))
        setTimeout(
          () => {
            if (fresh) {
              const cached = pregen.text
              pregen.text = ''
              log('info', 'use pregen line', { kind: 'turnStart' })
              speak('turnStart', cached, { force: true, source: 'llm-pregen' })
            } else {
              void generate('turnStart', s).then((g) =>
                speak('turnStart', g.text, { force: true, source: g.source, latencyMs: g.latencyMs, tokens: g.tokens })
              )
            }
          },
          fresh ? Math.round(startleMs * 0.6) : startleMs
        )
      }
      return
    }
    if (t === 'turn/end') {
      setStatus('done')
      {
        const r = sessionRegistry.get(String(session.id))
        if (r) r.state = 'done'
      }
      setTimeout(() => {
        if (statusState.state === 'done') setStatus('idle')
      }, 3000)
      const dur = s.turnStartAt ? Date.now() - s.turnStartAt : 0
      const durBucket = dur < 15000 ? '很快' : dur < 60000 ? '一会儿' : '挺久'
      stats.longestMs = Math.max(stats.longestMs, dur)
      updateLastContext(String(d.reason?.kind || '') === 'completed')
      checkUsageSpike(s.tokens)
      stats.tokens += s.tokens
      s.tokens = 0
      const reasonKind = String(d.reason?.kind || '')
      const ok = reasonKind === 'completed'
      if (['error', 'aborted', 'max-tokens', 'max_tokens'].includes(reasonKind)) {
        setStatus('error', { message: reasonKind })
        pushEvent('error', 'S1', reasonKind, true)
      }
      today.longestTurnMs = Math.max(today.longestTurnMs, dur)
      // CF1（OQ1=A）：若本轮随后会走 whale report（replaceClassicActs=true），就不再先 act:stretch，
      // 否则 noActionOnSameState 会把这轮的 act:report 当成同一 state 的重复动作吞掉（同一轮只演一次）。
      const whaleReportNext =
        ok &&
        cfg.whaleActs?.enabled &&
        cfg.whaleActs?.replaceClassicActs !== false &&
        cfg.report.enabled &&
        reportState.turnsSince + 1 >= (cfg.report.everyNTurns || 5) &&
        Date.now() - reportState.lastAt >= (cfg.report.minIntervalMs || 0) &&
        s.tools >= (cfg.report.minTools || 0) &&
        dur >= (cfg.report.minDurationMs || 0)
      if (cfg.actions?.enabled) {
        if (ok) {
          if (!whaleReportNext) act('stretch')
        } else {
          act('shake')
          setTimeout(() => send('freeze:6000'), 500)
          setTimeout(() => send('cmd:fx:sweat'), 900)
        } // 报错：摇头 0.4s + 定格 6s + 汗滴
      }
      lastLongStepAt = 0
      if (cfg.events.turnEnd && canSpeak(ok ? 'turnEnd' : 'turnEndBad')) {
        const kind = ok ? 'turnEnd' : 'turnEndBad'
        void generate(kind, s, { outcome: ok ? '成功' : '没跑完', durBucket }).then((g) =>
          speak(kind, g.text, { force: true, source: g.source, latencyMs: g.latencyMs, tokens: g.tokens })
        )
        // pregenerate next turn's opening line while idle
        if (cfg.llm.pregen && cfg.llm.enabled && !refreshLowFootprint()) {
          void generate('turnStart', s).then((g) => {
            if (g.source === 'llm') {
              pregen.text = g.text
              pregen.at = Date.now()
              log('debug', 'pregen cached', { text: g.text })
            }
          })
        }
      }
      // interval report: every N turns AND at least minInterval
      reportState.turnsSince += 1
      if (
        ok &&
        cfg.report.enabled &&
        reportState.turnsSince >= (cfg.report.everyNTurns || 5) &&
        Date.now() - reportState.lastAt >= (cfg.report.minIntervalMs || 0) &&
        s.tools >= (cfg.report.minTools || 0) &&
        dur >= (cfg.report.minDurationMs || 0)
      ) {
        reportState.turnsSince = 0
        reportState.lastAt = Date.now()
        const rice = (llmDay.cost / (cfg.costModel?.ricePriceYuan || 0.5)).toFixed(1)
        const hourNow = new Date().getHours()
        const period = hourNow >= 0 && hourNow < 8 ? '低谷' : '高峰'
        const numbers = `turns=${stats.turns} tokens=${stats.tokens} cost=${llmDay.cost.toFixed(4)}元 rice=${rice}碗 period=${period}`
        void generate('report', s, { outcome: '成功', durBucket, numbers }).then((g) => {
          if (
            speak('report', g.text, { source: g.source, latencyMs: g.latencyMs, tokens: g.tokens, ignoreMinGap: true })
          ) {
            // CF1（OQ1=A）：replaceClassicActs=true 时用 act:report 替代 act:stretch；false 才双发；
            // kill switch（whaleActs.enabled=false）→ 完全回退 classic 行为（只 stretch）。
            setTimeout(() => {
              const wa = cfg.whaleActs || {}
              if (!wa.enabled || wa.replaceClassicActs === false) send('act:stretch')
              if (wa.enabled) whaleAct('report')
            }, 600)
          }
        })
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
      pushEvent('turn', 'S1', ok ? '完成' : '未完成', true)
      writeReceipt()
      return
    }
    if (t === 'approval/decided') {
      setStatus('thinking')
      pushEvent('approval', 'S3', '已决定', false)
      if (cfg.actions?.enabled) act('stretch')
      return
    }
    if (t === 'user-questions/request') {
      setStatus('waiting_input')
      pushEvent('waiting_input', 'S0', '等你选', true)
      if (cfg.walkOnApproval) {
        send('walk:center')
        setTimeout(() => send('freeze:3000'), 700)
      }
      void generate('waitingInput', s).then((g) =>
        speak('approval', g.text, {
          urgent: true,
          source: g.source,
          style: 'remind',
          latencyMs: g.latencyMs,
          tokens: g.tokens
        })
      )
      writeReceipt()
      return
    }
    if (t === 'agent/request-error') {
      const code = String(d.failure?.code || d.code || 'agent-error').slice(0, 40)
      setStatus('error', { message: code })
      pushEvent('error', 'S1', code, true)
      if (cfg.actions?.enabled) {
        act('shake')
        setTimeout(() => send('cmd:fx:sweat'), 400)
      }
      return
    }
    if (t === 'llm/retry') {
      pushEvent('retry', 'S3', '重试', false)
      return
    }
    if (t === 'approval/asked') {
      pushEvent('approval', 'S0', '等确认', true)
      setStatus('waiting_approval')
      {
        const r = sessionRegistry.get(String(session.id))
        if (r) r.state = 'waiting_approval'
      }
      if (!cfg.events.approval) return
      stats.approvals += 1
      const go = () => {
        if (cfg.walkOnApproval) {
          send('walk:center')
          setTimeout(() => send('freeze:3000'), 700) // 走到中央后站定
        }
        void generate('approval', s).then((g) =>
          speak('approval', g.text, {
            urgent: true,
            source: g.source,
            style: 'remind',
            latencyMs: g.latencyMs,
            tokens: g.tokens
          })
        )
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
      if (ritualDone.date !== k) {
        ritualDone.date = k
        ritualDone.morning = false
        ritualDone.sleep = false
      }
      const m = now.getHours() * 60 + now.getMinutes()
      if (cfg.morning?.enabled && !ritualDone.morning) {
        const mm = cfg.morning.hour * 60 + cfg.morning.minute
        if (m >= mm && m <= mm + 1) {
          ritualDone.morning = true
          if (!quietNow()) {
            speak('morning', pick('kaigong'), { urgent: false, style: 'greet' })
            // CF1（OQ1=A）：replaceClassicActs=true 时用 act:wave 替代 classic act:jump；false 才双发；
            // kill switch（whaleActs.enabled=false）→ 完全回退 classic 行为（只 jump）。
            setTimeout(() => {
              const wa = cfg.whaleActs || {}
              if (!wa.enabled || wa.replaceClassicActs === false) send('act:jump')
              if (wa.enabled) whaleAct('wave')
            }, 500)
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
      if (!petSettingsPushed) {
        petSettingsPushed = true
        setTimeout(() => {
          try {
            applyPetSettings(cfg.petSettings)
          } catch {}
        }, 2000)
      }
      if (!balanceStartupPushed && cfg.balancePush?.enabled && cfg.balancePush.startup) {
        balanceStartupPushed = true
        try {
          send('bal:' + '不可查（走DSH渠道）' + '|' + '今日 ¥' + llmDay.cost.toFixed(4) + '（DSH统计）')
          log('info', 'balance pushed (startup)', { costToday: Number(llmDay.cost.toFixed(4)) })
        } catch {}
      }
      refreshPetOnline()
      writeState()
      // v48：团队/目标/计划字段定期刷新（内部 ≤1/min 聚合）
      refreshTeamV2()
      // v47：桌宠上线后重发当前模式（reload/重启后保持）
      if (petOnline && modeEngaged()) pushModeToPet()
      // task-69：内存 / 定时器 / 降频自检（默认 2 分钟一行，供 4h 开/关对比测试）
      refreshLowFootprint()
      if (Date.now() - lastMemLogAt >= Number(cfg.lowMemory?.memLogMs || 120000)) {
        lastMemLogAt = Date.now()
        log('info', 'mem', {
          rssMB: memRssMb(),
          heapMB: memHeapMb(),
          timers: timerCount(),
          lowFootprint,
          mode: modeState.kind,
          pipe: { ...pipeStats },
          persist: { ...persistStats }
        })
      }
      // P3: long task -> walk two small steps every ~30s
      if (
        cfg.actions?.enabled &&
        cfg.actions.longTaskMs &&
        Date.now() - lastLongStepAt >= (cfg.actions.longTaskStepMs || 30000)
      ) {
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
      if (
        cfg.idleSkit?.enabled &&
        !refreshLowFootprint() && // task-69：低占用不跑小剧场
        cfg.idleSkit.eventGapMs &&
        Date.now() - lastEventAt >= cfg.idleSkit.eventGapMs &&
        !quietNow() &&
        Date.now() >= nextSkitAt
      ) {
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
      // CF1：白天长时间无事件 → 低频偷吃小动作（15min 无事件、0.15、60min 冷却、≤2/日、无气泡；
      // 深夜/免打扰/静音/专注由 whaleAct 门禁拒绝）。每 checkEveryMs 评估一次，避免每 20s 掷骰子。
      if (
        cfg.whaleActs?.enabled &&
        !refreshLowFootprint() &&
        Date.now() - lastSneakEvalAt >= (cfg.whaleActs.sneak?.checkEveryMs || 300000)
      ) {
        lastSneakEvalAt = Date.now()
        whaleAct('sneak')
      }
    } catch {}
  }, 20000)

  // ---------- TEST-ONLY event hook (default off) ----------
  // 仅在 cfg.testHookFile 非空时注册（默认关，绝不影响日常）。写 JSON 文件触发一次演出/数据注入：
  //   {"type":"usage","tokens":42000}                     合成一次 user 角色 usage（input/output 可显式给）→ 偷吃/白饭/费用
  //   {"type":"state","states":["thinking","tool","waiting_approval","waiting_input","error","done","idle"],"stepMs":800}
  //   {"type":"report"}                                   强制走报账生成路径（LLM 成功用 LLM，失败池兜底）
  //   兼容旧类型：approval / turnStart / turnEnd / inner / say / walk / receipt
  // 清理：删除文件或把 cfg.testHookFile 置空；样例见 <pet-work>\test-hook\sample-*.json
  let hookTimer = null
  let hookFile = ''
  let hookLastRaw = ''
  const stopTestHook = () => {
    if (hookTimer) clearInterval(hookTimer)
    hookTimer = null
    hookFile = ''
    hookLastRaw = ''
  }
  const runTestHookTick = () => {
    try {
      if (!hookFile) return
      const raw = fs.readFileSync(hookFile, 'utf8')
      if (raw === hookLastRaw) return
      hookLastRaw = raw
      const spec = JSON.parse(raw)
      if (!spec || !spec.type) return
      const applied = (extra = {}) => log('info', 'testHook applied', { type: spec.type, ...extra })
      if (spec.type === 'approval') {
        stats.approvals += 1
        if (cfg.walkOnApproval) send('walk:center')
        setTimeout(
          () => speak('approval', spec.text || pick('dengdai'), { urgent: true }),
          cfg.walkOnApproval ? 120 : 0
        )
        writeReceipt()
        applied()
      } else if (spec.type === 'turnStart') {
        speak('turnStart', spec.text || pick('kaigong'))
        applied()
      } else if (spec.type === 'turnEnd') {
        speak('turnEnd', spec.text || pick('shougong'))
        if (spec.report) setTimeout(() => send('act:stretch'), 600)
        applied()
      } else if (spec.type === 'inner') {
        send('inner:' + (spec.text || '（我就在旁边。）'))
        applied()
      } else if (spec.type === 'say') {
        send('say:' + (spec.text || '测试一句'))
        applied()
      } else if (spec.type === 'walk') {
        send('walk:' + (spec.text || 'center'))
        applied()
      } else if (spec.type === 'receipt') {
        writeReceipt()
        applied()
      } else if (spec.type === 'usage') {
        // 合成一次 usage（默认 user 角色）：input/output 可显式给，缺省从 tokens 拆（便于造偷吃/白饭/费用）
        const total = Math.max(0, Math.floor(Number(spec.tokens ?? spec.totalTokens ?? 0)))
        const input = Number.isFinite(Number(spec.inputTokens)) ? Number(spec.inputTokens) : Math.round(total * 0.9)
        const output = Number.isFinite(Number(spec.outputTokens)) ? Number(spec.outputTokens) : total - input
        const usage = {
          inputTokens: Math.max(0, input),
          outputTokens: Math.max(0, output),
          cacheReadTokens: Math.max(0, Number(spec.cacheReadTokens) || 0),
          cacheWriteTokens: Math.max(0, Number(spec.cacheWriteTokens) || 0),
          totalTokens: total || Math.max(0, input) + Math.max(0, output)
        }
        accountUsage({ id: 'test-hook-usage', header: { cwd: 'test-hook', delegationDepth: 0 } }, { usage })
        if ((usage.totalTokens || 0) >= Number(cfg.spike?.absFloor || 3000)) checkUsageSpike(usage.totalTokens)
        writeState(true)
        applied({ tokens: usage.totalTokens, input: usage.inputTokens, output: usage.outputTokens })
      } else if (spec.type === 'state') {
        const seq = Array.isArray(spec.states) ? spec.states : [spec.state || 'thinking']
        const stepMs = Math.max(200, Number(spec.stepMs) || 800)
        seq.slice(0, 20).forEach((st, i) => {
          setTimeout(() => {
            setStatus(String(st))
            applied({ state: String(st) })
          }, i * stepMs)
        })
      } else if (spec.type === 'report') {
        const s0 = { id: 'test-hook-report', tools: Number(spec.tools ?? 3), tokens: 0 }
        const numbers = `turns=${today.turns} tokens=${today.tokens} cost=${(today.costYuan || 0).toFixed(4)}元 rice=${(today.riceBowls || 0).toFixed(1)}碗 period=${today.period || '高峰'}`
        void generate('report', s0, { outcome: '成功', durBucket: '一会儿', numbers }).then((g) => {
          if (
            speak('report', g.text, { source: g.source, latencyMs: g.latencyMs, tokens: g.tokens, ignoreMinGap: true })
          )
            setTimeout(() => send('act:stretch'), 600)
          applied({ source: g.source })
        })
      }
    } catch {}
  }
  // 动态开关：patch cfg.testHookFile 或 ui-config.testHook.file 均可（默认关；清空即停）
  const startTestHook = (file) => {
    const f = String(file || '').trim()
    if (!f) {
      stopTestHook()
      return false
    }
    stopTestHook()
    hookFile = f
    hookTimer = setInterval(runTestHookTick, 1500)
    log('warn', 'TEST HOOK enabled (test-only)', { file: f })
    return true
  }
  if (cfg.testHookFile) startTestHook(cfg.testHookFile)

  const dispose = () => {
    // v47-hotfix/task-69：reload 时完整停掉本实例定时器/队列并 flush 待写盘数据
    pipeDisposed = true
    pipeQ.length = 0
    try {
      if (statusTimer) clearInterval(statusTimer)
    } catch {}
    try {
      clearInterval(timer)
    } catch {}
    try {
      clearInterval(bubbleTimer)
    } catch {}
    try {
      if (hookTimer) clearInterval(hookTimer)
    } catch {}
    try {
      if (modeTimer) clearInterval(modeTimer)
    } catch {}
    try {
      if (modeRequestTimer) clearInterval(modeRequestTimer)
    } catch {}
    try {
      if (eventsDirtyTimer) clearTimeout(eventsDirtyTimer)
    } catch {}
    eventsDirtyTimer = null
    try {
      if (teamV2Timer) clearTimeout(teamV2Timer)
    } catch {}
    teamV2Timer = null
    try {
      saveEvents(true)
    } catch {}
    try {
      saveCompanion(true)
    } catch {}
    try {
      writeState(true)
    } catch {}
    sessions.clear()
    log('info', 'disposed', {
      mode: modeState.kind,
      pipe: { ...pipeStats },
      persist: { ...persistStats },
      timers: timerCount(),
      rssMB: memRssMb()
    })
  }
  try {
    if (typeof ctx.effect === 'function') ctx.effect(() => dispose)
    else ctx.on('dispose', dispose)
  } catch {}

  log('info', 'loaded v49', {
    memoryMB: memRssMb(),
    timers: timerCount(),
    lowMemory: cfg.lowMemory,
    teamV2: { enabled: cfg.teamV2?.enabled !== false, refreshMs: cfg.teamV2?.refreshMs || 60000 },
    persistIntervals: { stateMs: cfg.stateWriteMs, companionMs: cfg.companionSaveMs, eventsMs: cfg.eventsSaveMs },
    pipe: { timeoutMs: Number(cfg.pipeTimeoutMs) || 1200, mode: 'serial-queue+coalesce' },
    mode: modeView(modeState),
    dryRun: cfg.dryRun,
    pools: cfg.poolsDir ? 'on' : 'embedded',
    receipt: cfg.receiptFile ? 'on' : 'off',
    history: cfg.historyFile ? 'on' : 'off',
    pricing: priceTable(cfg.pricing),
    accounting: {
      tokens: 'all-roles incl cache (totalTokens) + itemized categories',
      costs: 'itemized priceTable; costYuanFlat kept for v46 comparison',
      calls: 'seed from state v2 + lastLlm delta'
    },
    toolTypes: '9-class (tool-types.js)',
    llm: cfg.llm.enabled ? `${cfg.llm.provider}/${cfg.llm.model}` : 'off',
    llmLimits: {
      maxTokens: cfg.llm.maxTokens,
      timeoutMs: cfg.llm.timeoutMs,
      maxCallsPerDay: cfg.llm.maxCallsPerDay,
      budgetPerDayYuan: cfg.llm.budgetPerDayYuan
    },
    report: cfg.report,
    dualLayer: cfg.dualLayer,
    activity: activityState.level,
    actions: cfg.actions,
    idleSkit: cfg.idleSkit,
    activityFile: cfg.activityFile ? 'on' : 'off',
    attribution: cfg.attribution,
    attributionBootstrapped,
    lifecycle: {
      autoStart: cfg.lifecycle.autoStart,
      bootstrap: !!cfg.lifecycle.bootstrapScript,
      release: !!cfg.lifecycle.releaseZipUrl
    },
    uiActionFile: cfg.uiActionFile ? 'on' : 'off',
    bubble: cfg.bubble,
    stateFile: cfg.stateFile ? 'on' : 'off',
    uiConfigFile: cfg.uiConfigFile ? 'on' : 'off',
    quietHours: cfg.quietHours,
    rituals: { morning: cfg.morning, sleep: cfg.sleep },
    logLevel: cfg.logLevel
  })
}
