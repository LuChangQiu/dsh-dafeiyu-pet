# STATE-MAP · 鲸鱼娘 2D 帧资产 ↔ 桌宠状态映射

> 资产：`pet-work/assets/whale-girl/`（320px PNG 序列，alpha 保留，脚底对齐）
> 清单：`manifest.json`（权威；`frames` 数组即播放顺序，`durationsMs` 为逐帧毫秒）
> 许可/署名：见 `ATTRIBUTION.md`（必须署名 YunYueSama + 仓库）
> 关联：`deliverables/pet-integration/29-character-bible.md` §2.3/§7/§8、`28-aliveness-spec.md` §4

## 0. 一句话

**主状态用 12 个动作片段 + 3 个姿态库**；`idle` 用 `idleFront`（正面基准）而非 `idle/` 目录；`sneak` = 偷吃；所有帧 320×320、脚底锚点 `y≈295`，按 `scale = 显示高度 ÷ 263` 缩放（263 为内容标称高度）。

---

## 1. 目录与命名

```
assets/whale-girl/
├── manifest.json          # 权威清单：帧序/逐帧时长/循环/保持末帧/阶段
├── STATE-MAP.md           # 本文件
├── ATTRIBUTION.md         # 许可全文 + 署名 + 第三方排除
├── portrait.png           # 512×512 立绘（面板/关于页/头像可用）
├── idleFront/f00,f01      # 正面待机基准（呼吸两帧）
├── idle/f01,f03,f05,f07   # 微动作关键帧（重心移动/安定/伸展；不是主 idle 循环）
├── walk/f00..f31          # 32 帧侧向行走循环（45ms/帧）
├── eat/f01..f31(奇)       # 吃饭 16 帧
├── wave/…                 # 打招呼 16 帧
├── jump/…                 # 跳跃 17 帧（含 drag/fall/land 复用帧）
├── dance/…                # 跳舞 15 帧
├── sneak/…                # 偷吃 16 帧（#大肥鱼不偷吃 的反差梗）
├── sleep/…                # 入睡 15 帧（末帧躺倒）+ 起身 13 帧（反向）
├── turn/f00..f07          # 走→停转身 8 帧（播放顺序 6→0，manifest 已排序）
├── actions/f00..f15       # 16 个整身姿态（表情/反应库）
└── expressions/f00..f15   # 16 个整身表情姿态（含困/惊讶/鼓腮/哼歌/睡）
```

**命名规则**：文件名沿用源图集帧号（`fNN`），因此目录内编号不连续是正常的；**播放顺序与时长一律以 `manifest.json` 的 `frames` / `durationsMs` 为准**，不要用文件系统排序当帧序。

## 2. 画布 / 锚点 / 缩放

| 项 | 值 |
|---|---|
| 画布 | 320×320（portrait 512×512） |
| 内容包围盒（标称） | x≈14–309、y≈34–297；**脚底线 y≈294–297** |
| 标称内容高度 | **263px**（用于换算显示尺寸） |
| 缩放公式 | `scale = 目标可见身高 / 263`（如 1080p 默认 184px → scale≈0.70） |
| 锚点 | 脚底中心：`(160, 295)`；窗口定位以该点为"角色落地点" |
| 左右翻转 | 用水平翻转实现另一方向行走（原帧为朝向一侧；`turn` 播放顺序可配翻转实现左转） |
| 建议缩放滤波 | 双线性（Qt `SmoothTransformation`）；2x DPR 时按 `devicePixelRatio` 放大渲染，不放大源文件 |

> 为什么 320：29 §12 默认显示 184px（1080p），320 画布在 2x DPR 下仍有约 1.7x 余量，同时把 299 帧/70.9MB 压到 173 帧/16.6MB。

## 3. 桌宠状态 → 片段（主映射）

| 状态 | 主片段（clip key / composite） | 目录/帧 | 时长/循环 | 说明 |
|---|---|---|---|---|
| `idle` | `idleBase` + 随机 `idleShift`/`idleSettle`/`idleStretch` | idleFront/f00,f01；idle/f01,f03,f05,f07 | base：两帧各 1100ms 交替（永续）；微动作各 615–780ms，每 8–25s 随机一次 | 呼吸感来自两帧交替 + FX 眨眼叠加；**不要**把 `idle/` 当主循环 |
| `thinking` | `think`（composite，§3.2） | expressions/f02（托腮）或 actions/f11 | 保持 350–1200ms，可叠加 idle 微动 | 头顶思考气泡由 FX/气泡层负责 |
| `tool` | `walk`（慢速） | walk/f00..f31 | 45ms/帧，循环；慢速播放 ×1.6（≈72ms/帧） | 表示"在忙/小跑"；工具类型细分交给气泡文案 |
| `waiting_approval` | `waitPeek`（composite） | expressions/f00→f01→f02→f03 | 180/220/350/180ms，末帧保持 | 探头等你确认；也可接 `wave` 前半段举手 |
| `done` | `cheer`（composite） | actions/f15（开心跳）→ f14（惊喜） | 各 200–250ms，然后回 idle | 收工/完成庆祝 |
| `error` | `errorSequence`（composite） | expressions/f09（惊讶）→ actions/f09（委屈） | 300ms → 350ms → 回 idle | 摇头/汗滴交给 FX 叠加 |
| `drag` | `drag` | jump/f13 | 保持（holdLast） | 被拎起 |
| `fall` | `fall` → `land` | jump/f19 → jump/f21,f23,f25,f27,f29,f31 | hold 100ms → 75/85/75/85/100/180ms | 落地压扁回弹；哭用 `cry` |
| `cry` | `cry`（composite） | actions/f09（擦泪）+ expressions/f11（含泪） | 各 400–600ms，限频 | 泪滴由 FX 层绘制；冷却 30min（29 §2.3） |
| `sleep` | `sleep` → 保持末帧；唤醒 `wake` | sleep/f01..f31(15 帧) → sleep 反向 13 帧 | 入睡 2410ms → 保持；起身 1400ms | 末帧为躺倒；锚点不变（内容向下移动属正常） |
| `eat` | `eat` → `eatSatisfied` | eat/f01..f31(16 帧) → f25,f27,f29,f31 | 吃饭 1595ms；满足 510ms | 正常吃饭（报账/喂食） |
| `steal` | `sneak` | sneak/f01..f31(16 帧，顺序见 manifest) | 1380ms，末帧保持 | **偷吃**：半夜偷吃/#大肥鱼不偷吃 反差梗；被抓包接 `caught` |
| `lonely` | `lonelySit` / `hum`（composite） | expressions/f14（坐着揉眼）或 f12/f13（哼歌） | 保持 2–4s，低频 | 长时间无互动 |
| `wave` | `wave` | wave/f01..f31(16 帧) | 1135ms，单次 | 打招呼/收工讨饭 |

**key 说明（重要）**
- `manifest.json` 的 `actions` 只有 **17 个 clip key**：`idleBase / idleShift / idleSettle / idleStretch / walk / eat / eatSatisfied / wave / jump / land / dance / sneak / sleep / wake / turnStop / drag / fall`（单个目录、连续帧）。
- 本表中 `think / waitPeek / cheer / errorSequence / cry / caught / lonelySit / hum / report / pat / tsundere` 是**组合序列**，定义在 `manifest.json` 的 **`composites`** 字段（每步含 `dir` / `frames` / `durationsMs`），不是 clip key；`caught/report/pat/tsundere` 可直接用于 29 §2.3 梗动作。
- 组合序列跨目录（actions/expressions/idleFront），必须按 `composites.steps` 顺序播放，不要假设同一目录连续文件。

### 3.2 组合序列（`manifest.composites`，可直接执行）

| key | 用途 | 步骤（dir:frame@ms） |
|---|---|---|
| think | 思考 | expressions:f02@1200（hold）；备选 actions:f11 |
| waitPeek | 等确认 | expressions:f00@180→f01@220→f02@350→f03@180（hold） |
| cheer | 完成庆祝 | actions:f15@250→f14@200→idleFront:f00@600 |
| errorSequence | 出错 | expressions:f09@300→actions:f09@350→idleFront:f00@400 |
| cry | 委屈哭 | expressions:f11@400→actions:f09@500→idleFront:f00@600 |
| caught | 偷吃被抓包 | expressions:f09@200→actions:f08@300→expressions:f10@400→idleFront:f00@400 |
| lonelySit | 冷落 | expressions:f14@3000（hold） |
| hum | 摸鱼哼歌 | expressions:f12@1500 ↔ f13@1500（loop） |
| report | 白饭报账 | expressions:f06@600→actions:f04@400→idleFront:f00@400 |
| pat | 被摸头 | actions:f04@400→expressions:f07@500→idleFront:f00@400 |
| tsundere | 嘴硬否认 | actions:f08@300→expressions:f10@400→idleFront:f00@300 |

**通用规则**
1. 片段切换用 80–150ms 交叉淡入（或直接切，Q 版可接受）；先播完当前单次片段再切（除用户操作/审批）。
2. 循环类：`idleBase`、`walk`；其余单次 + `holdLast`（按 manifest）。
3. 同一片段连续播放 2 次后强制换（避免复读机，28 §4）。
4. 深夜/免打扰：只保留 idle/呼吸/眨眼；`steal/eat/wave/dance` 不主动演。
5. 帧缓存：按动作懒加载（每个动作解码约 2–6MB 显存/内存；同时驻留 2–3 个动作即可，≈30–40MB）。

## 4. 姿态/表情库（单帧，不循环）

### actions/f00–f15（整身姿态）
| 帧 | 语义 | 用法 |
|---|---|---|
| f00 | 站立中性 | 默认底图/回正 |
| f01 | 揉眼/刚醒 | 早安、睡醒过渡 |
| f02 | 抿嘴/害羞 | 被夸 |
| f03 | 期待/紧张 | 等审批、等回答 |
| f04 | 得意/满足 | 干完活、被摸头 |
| f05 | 开心张嘴 | 惊喜/收到夸奖 |
| f06 | 馋/期待 | 白饭/token、喂食前 |
| f07 | 侧看 | 观察/看你 |
| f08 | 抗议/生气 | 被叫大肥鱼、嘴硬 |
| f09 | 委屈/擦泪 | 摔倒后、被冷落、`cry` |
| f10 | 惊喜举手 | 惊讶/打招呼 |
| f11 | 托腮思考 | `thinking` |
| f12/f13 | 走路两姿势 | `walk` 备用/静态 |
| f14 | 惊喜跳 | `done`/庆祝 |
| f15 | 开心跳/收工 | `done`/收工 |

### expressions/f00–f15（整身表情姿态）
| 帧 | 语义 | 用法 |
|---|---|---|
| f00–f03 | 中性→好奇→托腮→歪头 | `peek`（探头/等你） |
| f04 | 生气鼓腮 | 嘴硬/抗议 |
| f05 | 害羞别开脸 | 被夸/被摸 |
| f06 | 捧着 token/白饭 | 报账、偷吃被抓（反差梗） |
| f07 | 满足闭眼 | 吃饱/被摸头 |
| f08 | 打哈欠 | 困/摸鱼 |
| f09 | 惊讶 | `error`/被抓包第一拍 |
| f10 | 鼓腮抗议 | 嘴硬否认（#不偷吃） |
| f11 | 委屈含泪 | `cry` |
| f12/f13 | 哼歌（音符） | 摸鱼/心情好 |
| f14 | 坐着揉眼 | `lonely`/困 |
| f15 | 躺着睡着 | `sleep` 静态备选 |

## 5. 与 29 §2.3 梗动作的对接

| 梗 | 推荐片段序列 |
|---|---|
| 半夜偷吃 | `sneak`（循环 1 次）→ 保持末帧 → 左右看（可选 idleShift） |
| 偷吃被抓包 | `sneak` 中断 → expressions/f09（惊讶 200ms）→ actions/f08（抗议 300ms）→ expressions/f10（鼓腮 deny 400ms）→ idle |
| 嘴硬否认 | actions/f08 → expressions/f10 → idle |
| 白饭=Token 报账 | expressions/f06（捧 token）600ms → actions/f04（得意）400ms |
| 摸鱼 | expressions/f12 或 f13（哼歌）1.5–3s → 察觉用户 → actions/f01（揉眼装醒）→ idle |
| 偷懒拖延 | expressions/f08（打哈欠）→ 保持 idle 慢速 |
| 嘴馋/护食 | actions/f06（馋）→ 被戳 → actions/f08（抗议） |
| 被气哭 | expressions/f11（含泪）600ms → actions/f09（擦泪）500ms → idle |
| 收工讨饭 | `wave` → actions/f06 → `eatSatisfied` |
| 久别重逢 | actions/f05 → actions/f15 → `wave` |

## 6. 集成检查清单（给 bridge-dev / task-93）

- [ ] 读 `manifest.json` 播放，不依赖文件系统排序
- [ ] 显示默认高 184px（1080p），可按 2D `size` 语义缩放（29 §12）；**不得自动放大用户现有 0.36 档**
- [ ] 锚点脚底中心 `(160,295)`；缩放后按比例偏移窗口
- [ ] 循环片段：idleBase、walk；单次片段结束回 idle；`holdLast` 片段保持末帧
- [ ] `idle/` 只当微动作，主 idle 用 `idleFront/`
- [ ] `sneak` = 偷吃（非"潜行移动"），语义与 29 §2.3 一致
- [ ] 署名/许可：README/关于页保留 `YunYueSama` + 仓库 + 许可（见 ATTRIBUTION.md）
- [ ] 性能：动作级懒加载；同时驻留 ≤3 个动作；首帧 <300ms
- [ ] 回退：保留旧精灵 `skin: whale-girl | classic` 切换
- [ ] 冒烟：idle 呼吸可见、walk 循环无卡顿、eat/sneak 语义可辨、sleep 末帧躺倒、播完动作回 idle、无越界裁切

## 7. 帧数与体积（当前）

| 目录 | 帧数 | 体积 |
|---|---|---|
| idleFront | 2 | 0.2 MB |
| idle | 4 | 0.4 MB |
| walk | 32 | 2.8 MB |
| eat | 16 | 1.6 MB |
| wave | 16 | 1.6 MB |
| jump | 17 | 1.6 MB |
| dance | 15 | 1.5 MB |
| sneak | 16 | 1.6 MB |
| sleep | 15 | 1.3 MB |
| actions | 16 | 1.5 MB |
| expressions | 16 | 1.5 MB |
| turn | 8 | 0.7 MB |
| portrait | 1 | 0.2 MB |
| **合计** | **174 帧 + 清单/文档** | **16.6 MB**（<25MB 目标） |

## 8. 与 28/29 的对应

- 状态优先级、不打扰、深夜克制、冷却：以 `28-aliveness-spec.md` §4.8 为准。
- 表情名称（14 个权威名）：以 `29-character-bible.md` §7 为准；本文件 §4 的 actions/expressions 是"素材语义"，映射到 29 表情名时：鼓腮嘴硬=expressions f10/actions f08；偷吃心虚=expressions f06+sneak；抓包否认=expressions f09→f10；吃饭满足=eatSatisfied/expressions f07；哭=expressions f11/actions f09。
- 尺寸/比例/锚点原则：29 §12。
