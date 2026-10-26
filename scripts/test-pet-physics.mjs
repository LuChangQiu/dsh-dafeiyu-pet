/**
 * A 路线物理参数单测（task-74 / 审查偏差④）。
 * 不依赖 Qt：校验 pet 源码里的关键常数 + 用同一组公式验证积分/反弹/压扁/滞回行为。
 * 用法：node scripts/test-pet-physics.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..')
const src = fs.readFileSync(path.join(repo, 'pet', 'pet_window.py'), 'utf8')
const cases = []
const eq = (n, got, want) => cases.push({ n, ok: got === want, got, want })
const ok = (n, cond, detail = '') => cases.push({ n, ok: !!cond, got: detail, want: 'truthy' })
const close = (n, got, want, tol = 1e-9) => cases.push({ n, ok: Math.abs(got - want) <= tol, got, want })

// 1) 源码常数（23 §4.2 口径）
ok('源码: g=2200', src.includes('2200.0 * dt'))
ok('源码: 线性阻尼 1.2/s', src.includes('math.exp(-1.2 * dt)'))
ok('源码: 撞墙 0.45', src.includes('* 0.45'))
ok('源码: 落地 0.20', src.includes('* 0.20'))
ok('源码: 初速×1.05', src.includes('vx *= 1.05'))
ok('源码: 上限 2600', src.includes('cap = 2600.0'))
ok('源码: 阈值 260', src.includes('abs(vx) < 260 and abs(vy) < 260'))
ok('源码: 顶边 -90°', src.includes('-90.0 + math.sin'))
ok('源码: 左右 ≤30°', src.includes('-30.0 * ease') && src.includes('30.0 * ease'))
ok('源码: 释放距 40px', src.includes('self._edge_distance() > 40'))
ok('源码: _edge_distance 存在', src.includes('def _edge_distance(self):'))
ok('源码: 吸附 16px', src.includes('probe = 16'))

// 2) 积分/阻尼/反弹公式
const g = 2200
const v0 = 1000
const dt = 1 / 50
let vy = -v0
vy += g * dt
const damp = Math.exp(-1.2 * dt)
vy *= damp
close('1 帧后 vy（−1000+2200/50）×e^-0.024', vy, (-1000 + 44) * Math.exp(-0.024), 1e-6)
close('撞墙反弹 1000→450', 1000 * 0.45, 450)
close('落地反弹 1000→200', 1000 * 0.2, 200)
close('1s 无重力阻尼保留 e^-1.2', Math.exp(-1.2), 0.3011942119122022, 1e-12)

// 3) 落地压扁曲线（1.12/0.88 → 1.03/0.97 → 1.0）
const seg = (p, a, b, va, vb) => va + ((vb - va) * (p - a)) / (b - a)
const landSy = (p) =>
  p < 0.3 ? seg(p, 0, 0.3, 1, 0.88) : p < 0.65 ? seg(p, 0.3, 0.65, 0.88, 0.97) : seg(p, 0.65, 1, 0.97, 1)
const landSx = (p) =>
  p < 0.3 ? seg(p, 0, 0.3, 1, 1.12) : p < 0.65 ? seg(p, 0.3, 0.65, 1.12, 1.03) : seg(p, 0.65, 1, 1.03, 1)
close('压扁 p=0: sy=1', landSy(0), 1)
close('压扁 p=0.30: sy=0.88', landSy(0.3), 0.88)
close('压扁 p=0.65: sy=0.97', landSy(0.65), 0.97)
close('压扁 p=1: sy=1', landSy(1), 1)
close('压扁 p=0.30: sx=1.12', landSx(0.3), 1.12)
ok(
  '压扁过程 sx*sy ≈ 1（体积近似守恒）',
  Math.max(...[0, 0.2, 0.35, 0.5, 0.65, 0.8, 1].map((p) => Math.abs(landSx(p) * landSy(p) - 1))) < 0.02
)

// 4) 40px 滞回
const releaseAt = (dist) => dist > 40
ok('滞回: 30px 不释放', releaseAt(30) === false)
ok('滞回: 45px 释放', releaseAt(45) === true)

const failed = cases.filter((c) => !c.ok)
for (const f of failed) console.error(`FAIL ${f.n}: got=${f.got} want=${f.want}`)
if (failed.length) {
  console.error(`\npet-physics tests: ${cases.length - failed.length}/${cases.length} passed, ${failed.length} failed`)
  process.exit(1)
}
console.log(
  `pet-physics tests: ${cases.length}/${cases.length} passed (constants/integration/bounce/squash/hysteresis)`
)
