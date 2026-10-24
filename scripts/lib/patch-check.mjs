/**
 * 共享：cordis.patch.yml 校验（js-yaml 解析 + 重复 key + 两个插件块各命中一次）。
 * 供 scripts/validate-profile.mjs 与 scripts/safe-patch.mjs 复用；只读、无副作用。
 */

import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

const YAML_CANDIDATES = [
  'C:/Users/xiqi/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/js-yaml/index.js',
  'C:/Users/xiqi/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/lib/node_modules/js-yaml/index.js'
]

let cachedYaml = null
export async function loadYaml() {
  if (cachedYaml) return cachedYaml
  for (const p of YAML_CANDIDATES) {
    try {
      if (!fs.existsSync(p)) continue
      cachedYaml = (await import(pathToFileURL(p).href)).default
      return cachedYaml
    } catch {}
  }
  try {
    cachedYaml = (await import('js-yaml')).default
    return cachedYaml
  } catch {
    throw new Error('js-yaml 不可用（请确认 DSH 安装路径）')
  }
}

/**
 * 校验 patch 文本。
 * @param {string} text 文件内容
 * @returns {Promise<{ok:boolean, errors:string[], ids:string[], warnings:string[]}>}
 */
export async function validatePatchText(text) {
  const errors = []
  const warnings = []
  let doc = null
  try {
    const yaml = await loadYaml()
    doc = yaml.load(text) // 重复 mapping key 会在这里抛 YAMLException
  } catch (e) {
    errors.push('YAML 解析失败（含重复 key/缩进问题）：' + String((e && e.message) || e).slice(0, 200))
    return { ok: false, errors, ids: [], warnings }
  }
  if (!Array.isArray(doc)) {
    errors.push('patch 顶层不是 YAML 数组')
    return { ok: false, errors, ids: [], warnings }
  }

  // 收集所有 id（含 insert[].id）
  const ids = []
  const pushId = (v) => {
    if (typeof v === 'string' && v.trim()) ids.push(v.trim())
  }
  for (const entry of doc) {
    if (!entry || typeof entry !== 'object') continue
    pushId(entry.id)
    if (Array.isArray(entry.insert)) for (const ins of entry.insert) if (ins && typeof ins === 'object') pushId(ins.id)
  }
  const dupIds = ids.filter((v, i) => ids.indexOf(v) !== i)
  if (dupIds.length) errors.push('重复 id：' + [...new Set(dupIds)].join(', '))

  // 插件块命中检查：pet-bridge-vNN 恰好 1 个；pet-bridge-ui 恰好 1 个
  const bridgeIds = ids.filter((v) => /^pet-bridge-v\d+$/.test(v))
  const uiIds = ids.filter((v) => v === 'pet-bridge-ui')
  if (bridgeIds.length !== 1)
    errors.push(`pet-bridge-vNN 命中 ${bridgeIds.length} 个（应恰好 1 个）：${bridgeIds.join(',') || '无'}`)
  if (uiIds.length !== 1) errors.push(`pet-bridge-ui 命中 ${uiIds.length} 个（应恰好 1 个）`)
  if (bridgeIds.length === 1) {
    const bridge = doc.flatMap((e) => e?.insert || []).find((x) => x?.id === bridgeIds[0])
    const wantName = 'dsh-' + bridgeIds[0]
    if (!bridge) errors.push('插件块不在 insert 列表里')
    else if (bridge.name !== wantName) errors.push(`插件 name 与 id 不匹配：name=${bridge.name}，期望 ${wantName}`)
    if (bridge && (!bridge.config || typeof bridge.config !== 'object')) errors.push('插件块缺少 config 对象')
    // 生产安全：patch 不得启用 TEST HOOK（只允许 ui-config.testHook.file 动态启用）
    if (bridge && bridge.config && bridge.config.testHookFile) {
      errors.push('生产 patch 不允许启用 testHookFile（TEST HOOK 仅通过 ui-config.testHook.file 动态开启）')
    }
  }
  if (bridgeIds.length === 1 && uiIds.length === 1) {
    // 顺序提示：pet-bridge-ui 应在 pet-bridge-vNN 之后（不强制，仅提示）
    const bi = ids.indexOf(bridgeIds[0])
    const ui = ids.indexOf('pet-bridge-ui')
    if (ui < bi) warnings.push('pet-bridge-ui 位于 pet-bridge-vNN 之前（通常不期望）')
  }
  return { ok: errors.length === 0, errors, ids, warnings }
}

/** 读取并校验 patch 文件。 */
export async function validatePatchFile(file) {
  const text = fs.readFileSync(file, 'utf8')
  return { ...(await validatePatchText(text)), file, bytes: text.length, hasBom: text.charCodeAt(0) === 0xfeff }
}
