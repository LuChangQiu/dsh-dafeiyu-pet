# A 路线：2.5D「3D 感」渲染增强 + 拖拽物理 + 边缘交互（task-74）

> 纯代码实现，**零新美术资产**；随 pet 进程生效（改 `pet/桌宠.py` 后重启 pet 即可，不需要挂载 DSH）。
> 一键回滚：`render.enhance=false`（配置文件或 `cmd:config {"renderEnhance": false}`），关闭后完全走原渲染/原拖拽路径。

## 配置（config.json 顶层 `render`）

```json
"render": {
  "enhance": true,        // 总开关（false = 回滚）
  "tilt_max_deg": 20.0,   // 倾斜上限（yaw/roll，防晕）
  "shadow": true,         // 双层软阴影
  "parallax": true,       // 三层视差（阴影 0.55 / 本体 1.0 / 气泡 1.18，错位 ≤6px）
  "physics": true,        // 拖拽抛掷物理
  "edges": true,          // 四边贴附/趴框/挂沿/坐任务栏
  "gaze": true            // 视线跟随鼠标（±22°/±14°，平滑 ~300ms）
}
```

旧的 config.json 缺少这些键时自动补默认（默认全开）。

## 行为参数（与 23-modern-pet-3d-research §4.2 / 25-3d-experience-spec 对齐）

- 抛掷：拖拽末速 ×1.05、上限 2600 px/s、阈值 260 px/s；g=2200；线性阻尼 1.2/s；角阻尼 4/s（旋转 = vx/40 衰减）；撞墙反弹 0.45、落地 0.2、地面摩擦 0.3。
- 落地压扁：1.12/0.88 → 1.03/0.97 → 1.0；眩晕 0.6–2.0s（按撞击速度）。
- 阴影：偏移 (0,8)，模糊 10（双层径向渐变近似），α 0.18–0.28（随高度变淡、随速度拉长）。
- 边缘：吸附 16px、姿态过渡 OutBack 120ms；左右贴边（≤30°，侧面精灵）、贴顶边整体 −90° 躺下 + 压扁 8% + ±2° 钟摆、任务栏坐姿（availableGeometry，多屏跟随当前屏幕）、拖离 40px 解除。
- 抓取滞后 60~90ms（每帧追 78%）。
- idle 微倾斜 ±4/2/3°，视线跟随鼠标。

## 验收通道（仅测试用，与正常协议并行）

通过 pet pipe 发送单行命令（`scripts/pet-cmd.mjs` 或任意管道客户端）：

- `enh:on` / `enh:off`：开关增强（回滚验证）
- `phys:throw:900,-700`：模拟抛掷（vx,vy px/s；省略参数用默认）；`phys:stop`：停止物理
- `edge:left|right|top|bottom|none`：贴附到指定边并进入姿态（验收截图用）
  返回：`enh:on` / `phys:throw` / `edge:top` 等。

## 验收（多帧截图，V1–V14）

1. 拖拽甩出 → 飞行倾斜/阴影偏移（3 帧间隔）；
2. 撞墙反弹 → 方向反转；
3. 落地压扁回弹（squash frames）；
4. 眩晕摇头（1.5s 内多帧）；
5. 四边姿态（left/right/top/bottom 各 1 帧）；
6. 视线跟随（鼠标左/右各 1 帧）；
7. `render.enhance=false` 回滚后画面与旧版一致（对照帧）；
8. 性能：60fps（tick_ms=20 性能模式）、CPU <10%、内存增量 <30MB（任务管理器/`mem` 采样）。

## 回滚

- 配置：`"render": {"enhance": false}` 或 `cmd:config {"renderEnhance": false}`（即时生效并写回 config.json）；
- 代码：`git revert <commit>` 后重启 pet。

## 参数口径与已知偏差（2026-10-24 审查后）

- **以 23 §4.2 为准**（25 §3.2 与 23 冲突处按 23）：撞墙反弹 0.45、落地反弹 0.20、落地压扁 1.12/0.88 → 1.03/0.97 → 1.0。
- **边缘角度**：顶边采用 −90° 躺下 + 压扁 8% + ±2° 钟摆；左右贴边采用 ≤30° 侧趴（"趴边框"观感更自然），不采用 23 的 ±90° 横躺（人物横躺不自然；如需可后续做成配置）。
- **边缘释放滞回**：吸附阈值 16px；释放阈值 **40px**（移动距离超过 40px 才退出边缘姿态，防抖）。
- **验收命令保持**：`edge:*` 会同时清除 wander 目标并原地保持 10s，便于截图；正常拖拽松手仍走 `_snap_to_edge` + 姿态。
- 物理单测：`node scripts/test-pet-physics.mjs`（校验常数与积分/反弹/压扁曲线/滞回阈值；不依赖 Qt）。
