/**
 * task-107 B4：形象位（头像）素材本地镜像 + 署名常量。
 *
 * 资产来源：`assets/whale-girl/portrait.png`（YunYueSama/codex-deepseek-pet，
 * 「大肥鱼项目署名许可 1.0」；本仓库只做筛选/裁剪/降采样，未重绘）。
 * 本地镜像：`lib/assets/whale-girl/portrait.png`——`package.json files` 含 `lib`，
 *   因此随插件分发，**不依赖**用户机器上的仓库 assets 目录/未装 profile 的资产包。
 * 降级：文件缺失/非法 → `readPortrait()` 返回 null；页面 `<img onerror>` 隐藏图片，
 *   露出 29 色板占位（发 #5060A3 / 裙 #2D366A / 品牌蓝 #4D6BFE），不破版、不报错。
 *
 * 隐私/边界：只读本地 PNG，不发外部请求、不写盘；页面无外链（署名以纯文本呈现）。
 */
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

/** 资产路由后缀（挂到 `<channel>` 前缀下；页面 src 为 PORTRAIT_SRC）。 */
export const PORTRAIT_ROUTE_SUFFIX = '/asset/portrait.png'
/** 页面引用的同源头像地址（与 channel 固定前缀一致）。 */
export const PORTRAIT_SRC = '/pet-bridge-ui' + PORTRAIT_ROUTE_SUFFIX
/** 本地镜像相对 lib/ 的路径。 */
export const PORTRAIT_MIRROR_REL = 'assets/whale-girl/portrait.png'
/** 头像 alt 文案。 */
export const PORTRAIT_ALT = '大肥鱼头像（二头身蓝紫长发鲸鱼娘）'
/** 署名/许可/修改/非官方（页面可见；无外链 scheme，避免页面被判定外链）。 */
export const PORTRAIT_ATTRIBUTION =
  '角色素材：YunYueSama · github.com/YunYueSama/codex-deepseek-pet · 大肥鱼项目署名许可 1.0 · 已裁剪/筛选/降采样（未重绘）· 非官方（DeepSeek 未推出/未认领任何拟人吉祥物）'
/** 头像缩略图尺寸（页面 CSS 用；未装资产时仍占同样位置）。 */
export const PORTRAIT_SIZE = 44

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47]

/** 测试用：清空模块级缓存（验证缺失降级/替换资产）。 */
let cache

/**
 * 读取本地镜像 PNG（进程内缓存；缺失/损坏返回 null）。
 * @returns {Buffer|null}
 */
export function readPortrait() {
  if (cache !== undefined) return cache
  try {
    const file = fileURLToPath(new URL('./' + PORTRAIT_MIRROR_REL, import.meta.url))
    const buf = fs.readFileSync(file)
    cache = buf.length > 8 && PNG_MAGIC.every((b, i) => buf[i] === b) ? buf : null
  } catch {
    cache = null
  }
  return cache
}

/** 测试用：重置缓存。 */
export function resetPortraitCache() {
  cache = undefined
}
