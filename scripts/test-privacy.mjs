/**
 * v47 隐私脱敏单测（node scripts/test-privacy.mjs）。
 * 覆盖：Windows/JSON 转义/UNC/POSIX 路径 → basename；工作区 name+hash；无路径文本不变。
 */

import { pathToFileURL } from 'node:url'
import {
  pathBasename,
  workspaceName,
  workspaceHash,
  redactPathText,
  redactPosixPathText
} from '../plugin/server/lib/privacy.js'

const CASES = []
const eq = (name, got, want) => CASES.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want })
const ok = (name, cond, detail = '') => CASES.push({ name, ok: !!cond, got: detail, want: 'truthy' })

// ── 1. basename
eq('basename.win', pathBasename('E:\\project\\AI提效\\tool\\start-pet.ps1'), 'start-pet.ps1')
eq('basename.json', pathBasename('E:\\\\project\\\\AI提效\\\\tool\\\\start-pet.ps1'), 'start-pet.ps1')
eq('basename.posix', pathBasename('/home/user/work/x.js'), 'x.js')
eq('basename.trailing', pathBasename('E:\\project\\tool\\'), 'tool')
eq('basename.empty', pathBasename(''), '')

// ── 2. 工作区名 + hash
eq('ws.name', workspaceName('C:\\Users\\xiqi\\.dsh\\im'), 'im')
eq('ws.name.empty', workspaceName(''), 'workspace')
eq('ws.hash.len', workspaceHash('E:\\project\\x').length, 6)
ok('ws.hash.hex', /^[0-9a-f]{6}$/.test(workspaceHash('E:\\project\\x')), workspaceHash('E:\\project\\x'))
eq('ws.hash.same', workspaceHash('E:\\a\\b'), workspaceHash('E:\\a\\b'))
ok('ws.hash.differs', workspaceHash('E:\\a\\b') !== workspaceHash('E:\\a\\c'))

// ── 3. 纯文本路径脱敏
eq(
  'redact.plain',
  redactPathText('loaded from E:\\project\\AI提效\\tool\\start-pet.ps1 ok'),
  'loaded from start-pet.ps1 ok'
)
eq(
  'redact.jsonEscaped',
  redactPathText('{"logFile":"E:\\\\project\\\\AI提效\\\\tool\\\\pet-work\\\\evidence\\\\pet-bridge-main.log"}'),
  '{"logFile":"pet-bridge-main.log"}'
)
eq('redact.posixMixed', redactPathText('run C:/work/pet/start.ps1 now'), 'run start.ps1 now')
eq('redact.multi', redactPathText('E:\\a\\b.txt 与 C:\\c\\d.txt'), 'b.txt 与 d.txt')
eq(
  'redact.noPath',
  redactPathText('llm accounted {"calls":1,"cost":0.0005}'),
  'llm accounted {"calls":1,"cost":0.0005}'
)
eq('redact.unc', redactPathText('share \\\\server\\share\\dir\\file.txt end'), 'share file.txt end')
ok('redact.noAbsoluteLeft', !/[A-Za-z]:\\/.test(redactPathText('x E:\\a\\b y')), redactPathText('x E:\\a\\b y'))

// ── 4. POSIX（文件事件/命令参数）脱敏
eq('redactPosix.basic', redactPosixPathText('rm /home/u/proj/a.js'), 'rm a.js')
eq('redactPosix.keepsUrl', redactPosixPathText('https://example.com/a/b'), 'https://example.com/a/b')

export const audit = () => CASES

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const failed = CASES.filter((c) => !c.ok)
  for (const f of failed) console.error(`FAIL ${f.name}: got=${JSON.stringify(f.got)} want=${JSON.stringify(f.want)}`)
  if (failed.length) {
    console.error(`\nprivacy tests: ${CASES.length - failed.length}/${CASES.length} passed, ${failed.length} failed`)
    process.exit(1)
  }
  console.log(`privacy tests: ${CASES.length}/${CASES.length} passed (path redaction / workspace name+hash)`)
}
