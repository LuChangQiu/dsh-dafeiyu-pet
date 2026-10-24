# PROVENANCE · 授权链与分发口径（一页）

> 本文件是**授权链总览**，回答两个问题：①我们的形象素材从哪来、各自许可是什么；②在**内部/同事小范围使用**下，能带哪些东西、哪些只能用户自备。
> 相关文件：根 `LICENSE`（MIT）、根 `NOTICE`、`pet/NOTICE.md`、`assets/whale-girl/ATTRIBUTION.md`。
> 状态：**v2 · 2026-10-24**（用户拍板：不公开 Release；窗口冻结期只写文档，窗口后随 stash 合入）。
> 口径：**维持最严**——LOCAL ONLY 资产连内部/同事包也不含，仅用户本机个人使用；Aplaybox「禁止二次配布」按字面遵守。

## 0. 分发范围（用户拍板 2026-10-24）

- **内部/同事小范围使用，不公开 Release**；仓库只发 **MIT 代码 + PROVENANCE + 用户自备模型说明**；**不投入公开 Release 合规工程**。
- **默认可见形象 = 2D 鲸鱼娘帧**（已交付、task-92/93）。
- **3D v1 = 改造现成 BlueFatFish VRM**：**LOCAL ONLY**，由**用户自备导入**；**不捆绑、不再分发、不进任何分发包**（含同事包）；保留完整借物表。
- **VRoid 自捏 = 远期备选**（仅自建/自捏路径，当前不投入）。

## 1. 授权链（从原创到本项目）

```
上善无形「溟月」原创角色（2025-06，B站动态 2026-08-02 明示）
  · 许可：CC BY-NC-SA 4.0（署名 / 非商业 / 相同方式共享）
  · 来源：https://www.bilibili.com/opus/1231977657712771073
        │  二创引用关系
        ▼
ZipZipPipe 女仆鲸鱼娘（2026-04，深蓝白女仆装 / 首套表情包）
  · 声明：禁止商用（媒体/百科转述；原作者原始声明未取得，按最严处理）
  · 来源：https://space.bilibili.com/4168597
        │  同人二创 / 3D 化
        ▼
木子恶魔「BlueFatFish」VRM（Aplaybox，2026-10-07）
  · 原页配布规则：禁止商用 / 禁止二次配布 / 允许修改 / 使用需完整借物表
                  / 允许视频等非商业用途
  · 来源：https://www.aplaybox.com/details/model/ayXkRzVflmnd
  · 角色定位：**3D v1 由用户自备导入（LOCAL ONLY，不随包、不再分发）**
        │  2D 角色动画素材
        ▼
codex-deepseek-pet 2D 帧（YunYueSama）
  · 许可：大肥鱼项目署名许可 1.0（可改/可分享/可商用，须署名作者+仓库）
  · 但上游明确：**不授予底层第三方参考作品、角色设计、标志的权利**
  · 本项目修改：裁剪 / 筛选有效帧 / 512→320 降采样 / manifest v3 映射（未重绘）
  · 定位：**内部包可随（附署名/许可/NOTICE，内部非商业）**
        │  角色名称 / 题材关联
        ▼
DeepSeek 商标与名称（深度求索）
  · 本项目**非官方**：与 DeepSeek 官方无隶属、无授权、无背书
  · 官方从未推出/认领拟人吉祥物；「大肥鱼/鲸鱼娘」为社区二创
  · 只做**指示性提及**（nominative use），不随包分发 logo/官方视觉资产
```

> 补充（曾评估、均不入交付）：VRoid 官方样本「ヴィータ」（远期备选/C-LOCAL ONLY：官方条款禁 CC0 再分发/禁有偿再分发原始文件）、azwosile VRM（CC BY-NC-SA）、MakerWorld 打印模型（D，仅造型参考）、Quaternius/Poly Pizza CC0 鲸（占位/骨架参考，非最终形象）。

## 2. 两栏口径：内部/同事使用 vs 公开 Release（暂不做，仅保留说明）

| 资产 / 内容 | 授权结论 | 内部 / 同事使用（私有分发） | 公开 Release（**暂不做，仅保留说明**） |
|---|---|---|---|
| 本项目代码（pet fork 补丁 + DSH 插件 + 脚本/文档） | MIT（根 `LICENSE`） | ✅ 可含 | 暂不发；如未来做可发 |
| 鲸鱼娘 2D 帧（`assets/whale-girl/`） | codex 署名许可 1.0，但**底层角色设计受溟月 NC / ZipZipPipe 禁商用约束**，权利不完整 | ⚠️ 可随**内部私有包**（必须附 `NOTICE`+`ATTRIBUTION.md`+许可全文；仅个人/内部、非商业） | 暂不发；不随包 |
| BlueFatFish VRM（木子恶魔）——**3D v1** | Aplaybox：禁商用 / 禁二次配布 / 需完整借物表 | ❌ 不进包、不得分发给同事；**由用户本机自备导入使用**（保留借物表，不再分发） | 暂不发；不随包 |
| VRoid「ヴィータ」等官方样本衍生（远期备选） | C / LOCAL ONLY（禁 CC0 再分发、禁有偿再分发原始文件） | ❌ 仅本机个人实验，不进包 | 暂不发；不随包 |
| azwosile VRM | CC BY-NC-SA 4.0（非商业） | ❌ 仅本机个人参考 | 暂不发；不随包 |
| MakerWorld / 打印模型 | D（禁/不明；仅造型参考） | ❌ 不入运行时 | 暂不发；不随包 |
| CC0 占位鲸（Quaternius/Poly Pizza） | CC0 | ⚠️ 可作内部占位/骨架参考（非最终形象，勿演示宣传） | 暂不发；不随包 |
| DeepSeek 名称 / logo / 官方视觉 | 商标与版权归深度求索 | ✅ 仅指示性文字提及（附非官方声明） | 暂不发；名称可提及，logo/官方视觉不随包 |
| 用户自备模型（用户自己的 VRM/GLB 等；含 BlueFatFish 3D v1） | 用户自行负责授权 | ✅ 用户本机使用；本地导入 | 暂不发；仅提供导入说明，不代为分发 |

**一句话**：**本项目只做内部/同事小范围分发**——内部包 = MIT 代码 + 2D 帧（附署名/许可/NOTICE，内部非商业）+ 文档；**公开 Release 暂不做、仅保留说明**；**任何 LOCAL ONLY 资产（BlueFatFish、VRoid 样本、azwosile、打印模型）不进任何分发包（含同事包）**——3D v1 的 BlueFatFish 由用户自备导入本机使用。

## 3. 公开 Release（暂不做）说明与未来门槛

- 当前**明确不做公开 Release**，不投入合规工程；仓库/内部分发只按 §2 口径执行。
- 若未来要做公开 Release（新需求需用户/Lead 明确拍板），最低门槛：
  - [ ] 仅包含：MIT 代码、`LICENSE`、`NOTICE`、`PROVENANCE.md`、安装与使用文档；
  - [ ] 不包含：`assets/whale-girl/` 角色帧、`reference-models/`、任何 VRM/GLB 角色、DeepSeek logo/官方视觉、社区二创图；
  - [ ] README/关于页保留 **非 DeepSeek 官方**声明 + 形象素材"用户自备"说明；
  - [ ] 用户自备素材指引（codex 仓库 + 署名 + 底层权利提示）；
  - [ ] 发布前跑 `scripts/test-whale-assets.mjs`（若包含帧）与 secret/path 扫描。

## 4. 与 NOTICE / ATTRIBUTION 的引用关系

- 根 `NOTICE`：第三方声明总表（上游 MIT、PySide6 LGPL、2D 帧署名）；**授权链全景见本文件**。
- `pet/NOTICE.md`：桌宠目录随包署名（作者/许可/修改说明/非官方）；**分发口径见本文件 §0/§2**。
- `assets/whale-girl/ATTRIBUTION.md`：2D 帧完整许可全文与第三方排除；**授权链上游见本文件 §1**。
- 本文件与上述三份冲突时：**许可/署名以完整许可原文为准（ATTRIBUTION/LGPL/MIT），分发范围以本文件 §0/§2 为管理口径**。

## 5. 变更记录

- v1 2026-10-24：初版（Lead 授权链决策）。
- v2 2026-10-24：按**用户拍板（目标 ⑪）**更新——①分发范围=内部/同事小范围，不公开 Release；仓库只发 MIT 代码+PROVENANCE+用户自备模型说明，不投入公开 Release 合规工程；②3D v1=改造现成 BlueFatFish VRM（LOCAL ONLY，用户自备导入，不捆绑/不再分发），默认可见仍为 2D 鲸鱼娘，VRoid 自捏仅远期备选；③两栏第二列改为"公开 Release（暂不做，仅保留说明）"；④口径维持最严（LOCAL ONLY 连内部包也不含）。
