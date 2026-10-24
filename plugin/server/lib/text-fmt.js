/**
 * v49.1 文案清洗 & 活动标签中文化（修复"久别重逢"拼接脏字）。
 *
 * 背景：`lastActivityLabel` 来自 status 的 toolType/state 枚举（如 thinking/tool/read），
 * 直接拼进中文句子会出现 `…没走。，上次在thinking` 这类脏串。规则：
 *   - 基础句去尾部标点/空白（避免 `。，` 连排）
 *   - 活动标签映射为中文抽象词（隐私：只到动作类型，不含工具名/文件/命令）
 *   - 组合成 `…，上次在想事情。`；无法识别的标签不发英文，回退"忙别的"
 *
 * 纯函数、无依赖：`lib/index.js` 与 `scripts/test-text-fmt.mjs` 共用。
 */

/** 活动标签 → 中文抽象词（不泄露具体工具名/参数）。 */
export const ACTIVITY_LABEL_ZH = {
  thinking: '想事情',
  tool: '忙手上的活',
  read: '翻文件',
  write: '写东西',
  command: '跑命令',
  search: '查东西',
  agent: '安排任务',
  knowledge: '翻资料',
  mcp: '查资料',
  plan: '理计划',
  done: '刚忙完',
  idle: '发呆',
  error: '遇到点问题',
  waiting_approval: '等你确认',
  waiting_input: '等你选',
  background: '忙别的',
  unknown: '忙别的'
}

/** 去掉首尾空白与尾部标点/波浪号。 */
export function tidySpeech(text) {
  return String(text == null ? '' : text)
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[。！？!?…~～、，,.;；:：\s]+$/g, '')
    .trim()
}

/** 活动标签中文化；未知标签不输出英文，回退"忙别的"（只认精确标签，避免 weirdtool 误命中 tool）。 */
export function activityLabelZh(label) {
  const raw = String(label == null ? '' : label)
    .trim()
    .toLowerCase()
  if (!raw) return ''
  const plain = raw.replace(/^[a-z]+:/, '') // 兜底：去掉 "unknown:" 之类前缀
  if (ACTIVITY_LABEL_ZH[plain]) return ACTIVITY_LABEL_ZH[plain]
  // 已经是中文则保留（截断），否则回退
  if (/[\u4e00-\u9fa5]/.test(raw)) return raw.slice(0, 8)
  return '忙别的'
}

/**
 * 组合久别重逢句：`base` + `（可选）上次在<活动>。`，标点不重复。
 * @param {string} base 主句（如"你回来啦…我还以为要等很久"）
 * @param {string} activityLabel 抽象活动标签（thinking/read/…，可空）
 * @returns {string}
 */
export function composeReunion(base, activityLabel) {
  const b = tidySpeech(base)
  const act = activityLabelZh(activityLabel)
  if (!b) return act ? '上次在' + act + '。' : ''
  if (!act) return b + '。'
  return b + '，上次在' + act + '。'
}

/** 通用：在句子末尾追加补充，自动处理标点。 */
export function appendClause(base, clause) {
  const b = tidySpeech(base)
  const c = tidySpeech(clause)
  if (!b) return c ? c + '。' : ''
  if (!c) return b + '。'
  return b + '，' + c + '。'
}
