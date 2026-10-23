/**
 * v47 隐私脱敏工具（task-68）。
 *
 * 规则（与 DATA-CONTRACT §10 一致）：
 *   - 落盘/日志不出现绝对路径：`E:\...` / `C:/...` / `\\server\share\...` → basename
 *   - 会话工作区只留 basename + 短 hash（区分同名工作区），不再暴露绝对路径
 *   - 不落对话原文、key、任务描述；日志统一在 `log()` 出口做一次脱敏兜底
 *
 * 纯函数、无依赖：`lib/index.js` 与 `scripts/test-privacy.mjs` 共用。
 */

import crypto from 'node:crypto'

const ESCAPED = /\\\\/g

/** 取路径 basename（兼容 JSON 转义的双反斜杠与正斜杠）。 */
export function pathBasename(p) {
  const s = String(p == null ? '' : p)
    .replace(ESCAPED, '\\')
    .replace(/[\\/]+$/, '')
  if (!s) return ''
  const parts = s.split(/[\\/]+/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : ''
}

/** 工作区展示名（basename；空 → workspace）。 */
export function workspaceName(cwd) {
  return pathBasename(cwd) || 'workspace'
}

/** 工作区短 hash（sha1 前 6 位，区分同名不同路径）。 */
export function workspaceHash(cwd) {
  const s = String(cwd == null ? '' : cwd)
  if (!s) return ''
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 6)
}

/** 把一段文本里出现的绝对路径替换为 basename（JSON 转义/正反斜杠/UNC 都覆盖）。 */
export function redactPathText(text) {
  let s = String(text == null ? '' : text)
  if (!s) return s
  // 1) JSON 字符串里的路径（可能含空格）："E:\\a b\\c.ps1"
  s = s.replace(/"([A-Za-z]:[\\/]{1,2}[^"\r\n]*)"/g, (_m, p) => '"' + (pathBasename(p) || '<path>') + '"')
  // 2) 普通 Windows 绝对路径（E:\a\b 或 E:/a/b），到空白或 JSON 分隔符为止
  s = s.replace(/[A-Za-z]:[\\/]{1,2}(?:[^\\/\s"',;<>|()[\]{}]+[\\/]{1,2})*[^\\/\s"',;<>|()[\]{}]*/g, (m) => {
    const b = pathBasename(m)
    return b || '<path>'
  })
  // 3) UNC 路径 \\server\share\...
  s = s.replace(/\\\\[^\\/\s"',;<>|()[\]{}]+(?:[\\/][^\\/\s"',;<>|()[\]{}]+)+/g, (m) => {
    const b = pathBasename(m)
    return b || '<path>'
  })
  return s
}

/** 文件事件里可能出现的 bash 风格绝对路径（/home/...），按 basename 收敛；URL 原样保留。 */
export function redactPosixPathText(text) {
  let s = String(text == null ? '' : text)
  const urls = []
  s = s.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, (m) => {
    urls.push(m)
    return '\u0000URL' + (urls.length - 1) + '\u0000'
  })
  s = s.replace(/(?<![\w:])\/(?:[^/\s"',;<>|()[\]{}]+\/)+[^/\s"',;<>|()[\]{}]*/g, (m) => {
    const b = pathBasename(m)
    return b || '<path>'
  })
  s = s.replace(/\u0000URL(\d+)\u0000/g, (_m, i) => urls[Number(i)])
  return s
}
