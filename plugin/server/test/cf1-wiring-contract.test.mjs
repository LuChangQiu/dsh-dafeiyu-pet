/**
 * CF1 接线契约测试（静态断言，不启 DSH / 不碰 pipe）——补 reviewer P1-c / P1-d：
 *   P1-c：morning 用 act:wave 替代 classic act:jump（kill switch 才回退），reunion 同类 anchor 无双动作；
 *         report 走 whale 的轮次不再先 act:stretch（same-state 修复）；
 *   P1-d：安装版白名单路径 plugin/server/lib/generated 与 repo 真源逐字节一致；两份都缺 → index 禁用 +
 *         `whale acts disabled: whitelist missing`（不崩插件）；index.js 不直接读白名单文件（IO 收敛在 whale-acts）。
 * 运行：node --test plugin/server/test/
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..', '..', '..')
const indexPath = path.join(repo, 'plugin', 'server', 'lib', 'index.js')
const src = readFileSync(indexPath, 'utf8')

const count = (needle) => src.split(needle).length - 1

test('P1-c morning：wave 替代 classic jump（replace=false/kill switch 仅 classic）', () => {
  assert.match(src, /if \(wa\.enabled && wa\.replaceClassicActs !== false\) whaleAct\('wave'\)/)
  assert.match(src, /else send\('act:jump'\)/)
  // 生产路径（非 TEST HOOK）里 act:jump 只允许出现在 morning 这一处降级分支
  assert.equal(count("send('act:jump')"), 1, 'act:jump 生产调用应只有 morning 降级分支一处')
})

test('P1-c 降级语义：replaceClassicActs=false = 仅 classic（0 次 whale act，不双发）', () => {
  // Lead/reviewer 终审：动作只由 turn/end 统一决策点发一次；report 回调不得再补发 classic stretch
  assert.match(src, /if \(wa\.enabled && wa\.replaceClassicActs !== false\) whaleAct\('report'\)/)
  assert.ok(!/else send\('act:stretch'\)/.test(src), 'report 回调不得再补发 act:stretch（否则同轮两行）')
  assert.match(src, /if \(wa\.enabled && wa\.replaceClassicActs !== false\) whaleAct\('wave'\)/)
  assert.match(src, /else send\('act:jump'\)/)
})

test('P1-c reunion：只有 wave，无 classic jump 双动作', () => {
  const i = src.indexOf('const checkReunion')
  assert.ok(i > 0, 'checkReunion 未找到')
  const block = src.slice(i, i + 4200)
  assert.match(block, /whaleAct\('wave'\)/, 'reunion 应发 whale wave')
  assert.ok(!block.includes("send('act:jump')"), 'reunion 不得同时发 classic jump')
  assert.ok(!block.includes("send('act:wave')"), '不得绕过 act() 直接 send act:wave')
})

test('P1-c report：会走 whale report 的轮次不再先 act:stretch（same-state 修复）', () => {
  assert.match(src, /const whaleReportNext =/)
  assert.match(src, /if \(!whaleReportNext\) act\('stretch'\)/)
  assert.match(src, /if \(wa\.enabled && wa\.replaceClassicActs !== false\) whaleAct\('report'\)/)
  // 发送必须复用 act()（whaleAct 只决策），不允许直接 send('act:report')
  assert.ok(!src.includes("send('act:report')"))
})

test('P1-c reunion：replace=false/kill switch 不发 whale wave（无 classic 对应动作）', () => {
  const i = src.indexOf('const checkReunion')
  assert.ok(i > 0, 'checkReunion 未找到')
  const block = src.slice(i, i + 5200)
  const gate = 'cfg.whaleActs?.enabled && cfg.whaleActs?.replaceClassicActs !== false'
  assert.ok(block.includes(gate), 'reunion 的 whale wave 必须受 enabled+replaceClassicActs 门控')
  assert.equal(block.split(gate).length - 1, 2, 'then/catch 两处都要门控')
})

test('P2 记账顺序：act() 返回 bool，whaleAct 成功后才落 cooldown/日上限', () => {
  assert.match(src, /const act = \(name, opts = \{\}\) => \{/)
  assert.match(src, /send\('act:' \+ name\)\s*\n\s*log\('debug', 'act', \{ name \}\)\s*\n\s*return true/)
  // CF1 事件驱动一次性演出显式绕过同态守卫（classic 默认行为不变）
  assert.match(src, /if \(!act\(key, \{ ignoreSameState: true \}\)\) \{/)
  assert.match(src, /g\.noActionOnSameState && !opts\.ignoreSameState/)
  // 决策层同样跳过 same-state（双保险，避免首轮 report/wave 被同轮 action 吞）
  assert.match(src, /noActionOnSameState: false/)
  // 记账必须在 act(key,...) 之后（顺序断言）
  const i = src.indexOf('const whaleAct = (key) =>')
  const block = src.slice(i, i + 2700)
  assert.ok(block.indexOf('act(key, { ignoreSameState: true })') < block.indexOf('whaleActState.last[key] = nowMs'))
})

test('P1-d 安装版白名单：generated 副本存在且与 repo 真源逐字节一致', () => {
  const repoJson = path.join(repo, 'docs', 'generated', 'act-fx-whitelist.json')
  const bundleJson = path.join(repo, 'plugin', 'server', 'lib', 'generated', 'act-fx-whitelist.json')
  assert.ok(existsSync(repoJson), '缺 repo 真源')
  assert.ok(existsSync(bundleJson), '缺随包副本')
  assert.equal(readFileSync(bundleJson, 'utf8'), readFileSync(repoJson, 'utf8'))
})

test('P1-d 两份都缺：index 禁用 whaleActs + 可读日志（不崩插件）', () => {
  assert.match(src, /cfg\.whaleActs\.enabled = false/)
  assert.match(src, /whale acts disabled: whitelist missing/)
  // index 只调用一次 loadWhitelist()，路径解析/回退逻辑在 whale-acts 内部（单一真源）
  assert.equal(count('loadWhitelist('), 1)
  assert.match(src, /const whaleWhitelistInfo = loadWhitelist\(\)/)
})

test('P1-d IO 收敛：index.js 不直接读白名单文件', () => {
  assert.ok(!/readFileSync\([^)]*act-fx-whitelist/.test(src), 'index.js 不应直接 readFileSync 白名单')
  const whaleSrc = readFileSync(path.join(repo, 'plugin', 'server', 'lib', 'whale-acts.js'), 'utf8')
  assert.match(whaleSrc, /fs\.readFileSync/)
})
