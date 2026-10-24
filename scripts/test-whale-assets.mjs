#!/usr/bin/env node
// scripts/test-whale-assets.mjs — 鲸鱼娘 2D 资产（manifest v3）校验 + 三类回退断言。
// 用法：node scripts/test-whale-assets.mjs [--verbose]
// 退出码：0 全过；1 有 FAIL。
// 校验：17 clip + 11 composites 的引用帧存在且 320×320、durations 对齐、总大小上限、署名文件；
//       回退：缺目录 load→None、manifest 损坏→None、whale.on=false 不加载（静态断言）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const VERBOSE = process.argv.includes('--verbose')
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const assets = process.env.PET_ASSETS_DIR || path.join(repo, 'assets', 'whale-girl')
const CANVAS = 320
const EXPECT_CLIPS = 17
const EXPECT_COMPOSITES = 11
const MAX_TOTAL_BYTES = 20 * 1024 * 1024 // STATE-MAP §7 约 16.6MB，上限留余量
const CLIP_KEYS = [
  'idleBase',
  'idleShift',
  'idleSettle',
  'idleStretch',
  'walk',
  'eat',
  'eatSatisfied',
  'wave',
  'jump',
  'land',
  'dance',
  'sneak',
  'sleep',
  'wake',
  'turnStop',
  'drag',
  'fall'
]

let pass = 0
let fail = 0
let totalBytes = 0
const seenFrames = new Set()
const check = (name, cond, extra = '') => {
  if (cond) {
    pass += 1
    if (VERBOSE) console.log(`  PASS ${name}${extra ? ' · ' + extra : ''}`)
  } else {
    fail += 1
    console.log(`  FAIL ${name}${extra ? ' · ' + extra : ''}`)
  }
}

function pngSize(file) {
  try {
    const buf = fs.readFileSync(file)
    if (buf.length < 24) return null
    // PNG 签名 + IHDR：宽/高各 4 字节大端
    if (buf[0] !== 0x89 || buf.toString('ascii', 1, 4) !== 'PNG') return null
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), bytes: buf.length }
  } catch {
    return null
  }
}

function checkFrames(label, dir, frames, durations) {
  check(`${label} frames 非空`, Array.isArray(frames) && frames.length > 0, `${(frames || []).length} 帧`)
  check(
    `${label} durationsMs 对齐`,
    Array.isArray(durations) && durations.length === (frames || []).length,
    `${(durations || []).length}/${(frames || []).length}`
  )
  let bad = []
  for (const fn of frames || []) {
    const file = path.join(assets, String(dir), String(fn))
    const sz = pngSize(file)
    if (!sz) {
      bad.push(`${dir}/${fn} 缺失或非 PNG`)
      continue
    }
    if (sz.w !== CANVAS || sz.h !== CANVAS) bad.push(`${dir}/${fn} ${sz.w}×${sz.h}`)
    const key = path.resolve(file)
    if (!seenFrames.has(key)) {
      seenFrames.add(key)
      totalBytes += sz.bytes
    }
  }
  check(`${label} 帧全部存在且 ${CANVAS}×${CANVAS}`, bad.length === 0, bad.slice(0, 3).join('; '))
  for (const [i, ms] of (durations || []).entries()) {
    if (!(Number(ms) >= 16 && Number(ms) <= 5000)) {
      check(`${label} duration[${i}] 合理`, false, String(ms))
      break
    }
  }
}

console.log(`whale-assets: ${assets}`)
const manifestPath = path.join(assets, 'manifest.json')
check('asset dir 存在', fs.existsSync(assets), assets)
check('manifest.json 存在', fs.existsSync(manifestPath), manifestPath)

let manifest = null
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
} catch (e) {
  check('manifest.json 可解析', false, String(e.message || e))
}
if (manifest) {
  check('manifest version=3', manifest.version === 3, String(manifest.version))
  check('manifest canvas=320', Number(manifest.canvas) === CANVAS, String(manifest.canvas))
  const actions = manifest.actions || {}
  const clips = Object.keys(actions)
  check(`clips 数量=${EXPECT_CLIPS}`, clips.length === EXPECT_CLIPS, String(clips.length))
  const missingKeys = CLIP_KEYS.filter((k) => !clips.includes(k))
  check('17 个 clip key 齐全', missingKeys.length === 0, missingKeys.join(','))

  for (const key of CLIP_KEYS) {
    const spec = actions[key]
    if (!spec) continue
    checkFrames(`clip:${key}`, spec.dir || key, spec.frames, spec.durationsMs)
    if (spec.loop !== undefined) check(`clip:${key} loop 布尔`, typeof spec.loop === 'boolean', String(spec.loop))
    if (spec.holdLast !== undefined) {
      check(`clip:${key} holdLast 布尔`, typeof spec.holdLast === 'boolean', String(spec.holdLast))
    }
  }

  const composites = Object.entries(manifest.composites || {}).filter(([, v]) => v && typeof v === 'object')
  check(`composites 数量=${EXPECT_COMPOSITES}`, composites.length === EXPECT_COMPOSITES, String(composites.length))
  for (const [name, spec] of composites) {
    const steps = Array.isArray(spec.steps) ? spec.steps : []
    check(`composite:${name} 至少 1 步`, steps.length > 0, String(steps.length))
    let ok = true
    for (const [i, step] of steps.entries()) {
      if (!step || typeof step !== 'object') {
        ok = false
        break
      }
      const frames = step.frames || []
      const durs = step.durationsMs || []
      if (!frames.length || frames.length !== durs.length) ok = false
      for (const fn of frames) {
        const file = path.join(assets, String(step.dir || ''), String(fn))
        const sz = pngSize(file)
        if (!sz || sz.w !== CANVAS || sz.h !== CANVAS) ok = false
        else {
          const key = path.resolve(file)
          if (!seenFrames.has(key)) {
            seenFrames.add(key)
            totalBytes += sz.bytes
          }
        }
      }
      if (!ok) break
    }
    check(`composite:${name} 引用帧齐全`, ok)
  }

  check('引用帧总大小 ≤ 20MB', totalBytes <= MAX_TOTAL_BYTES, `${(totalBytes / 1048576).toFixed(1)}MB`)
  const attr = String(manifest.attribution || '')
  check('manifest attribution 指向署名文件', /ATTRIBUTION\.md/i.test(attr), attr)
}

// 署名/状态映射文件随包
check('ATTRIBUTION.md 存在', fs.existsSync(path.join(assets, 'ATTRIBUTION.md')))
check('STATE-MAP.md 存在', fs.existsSync(path.join(assets, 'STATE-MAP.md')))
check('pet/NOTICE.md 存在', fs.existsSync(path.join(repo, 'pet', 'NOTICE.md')))
let attrText = ''
try {
  attrText = fs.readFileSync(path.join(assets, 'ATTRIBUTION.md'), 'utf8')
} catch {
  attrText = ''
}
check('ATTRIBUTION.md 含作者 YunYueSama', attrText.includes('YunYueSama'))
check('ATTRIBUTION.md 含素材仓库链接', attrText.includes('codex-deepseek-pet'))

// ---- 回退断言：whale_skin 加载失败必须返回 None / ok=False（不能拖垮桌宠）----
const py =
  process.env.PET_PYTHON ||
  path.join(
    process.env.PET_WORK_DIR || path.join(repo, '..', 'pet-integration-src', 'pet-work'),
    '.venv',
    'Scripts',
    'python.exe'
  )
const pyCmd = fs.existsSync(py) ? py : 'python'
const pySrc = `import json, os, sys, tempfile
repo = sys.argv[1]
sys.path.insert(0, os.path.join(repo, "pet"))
import whale_skin
out = {}
out["missing_dir"] = not whale_skin.WhaleGirlSkin(os.path.join(tempfile.gettempdir(), "whale-no-such-dir-xyz")).ok
bad = tempfile.mkdtemp(prefix="whale-bad-")
open(os.path.join(bad, "manifest.json"), "w", encoding="utf-8").write("{ not json")
out["corrupt_manifest"] = not whale_skin.WhaleGirlSkin(bad).ok
skin = whale_skin.WhaleGirlSkin(os.path.join(repo, "assets", "whale-girl"))
out["valid_ok"] = bool(skin.ok)
composites = ("think", "waitPeek", "cheer", "errorSequence", "cry", "caught", "lonelySit", "hum", "report", "pat", "tsundere")
out["clips"] = len([k for k in skin.actions if k not in composites])
out["composites"] = len([k for k in skin.actions if k in composites])
print(json.dumps(out))
`
const probeFile = path.join(os.tmpdir(), `whale-assets-probe-${process.pid}.py`)
fs.writeFileSync(probeFile, pySrc, 'utf8')
const pyRun = spawnSync(pyCmd, [probeFile, repo], {
  encoding: 'utf8',
  env: { ...process.env, QT_QPA_PLATFORM: 'offscreen' },
  timeout: 120000
})
try {
  fs.rmSync(probeFile, { force: true })
} catch {
  // 清理失败不影响结论
}
if (pyRun.error || pyRun.status !== 0) {
  const why = (pyRun.error && pyRun.error.message) || pyRun.stderr || pyRun.stdout || ''
  check('回退断言：python 可执行 whale_skin', false, String(why).slice(-300))
} else {
  let res = {}
  try {
    res = JSON.parse(pyRun.stdout.trim().split('\n').pop())
  } catch {
    res = {}
  }
  check('回退：缺目录 → ok=False', res.missing_dir === true, JSON.stringify(res.missing_dir))
  check('回退：manifest 损坏 → ok=False', res.corrupt_manifest === true, JSON.stringify(res.corrupt_manifest))
  check('回退：正常资产 → ok=True', res.valid_ok === true, JSON.stringify(res.valid_ok))
  check('回退：正常资产 clip=17', res.clips === EXPECT_CLIPS, String(res.clips))
  check('回退：正常资产 composite=11', res.composites === EXPECT_COMPOSITES, String(res.composites))
}

// whale.on=false 不加载：静态断言 桌宠.py 里的开关分支仍在（运行时需 Qt 窗口，不在本脚本起）
const petSrc = fs.readFileSync(path.join(repo, 'pet', '桌宠.py'), 'utf8')
check('whale.on=false 分支存在', /if _wcfg\.get\("on", True\) and _whale_skin is not None:/.test(petSrc))
check(
  'skin 不被静默覆盖（_whale_active 尊重自定义形象）',
  /def _whale_active/.test(petSrc) && /_current_skin_ref\("pet"\)/.test(petSrc)
)

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} whale-assets: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
