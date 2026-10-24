# whale-girl · 大肥鱼 / 鲸鱼娘 2D 帧资产（320px）

> 来源：`YunYueSama/codex-deepseek-pet` ｜ 许可：**大肥鱼项目署名许可 1.0**（可商用，**必须署名**）
> 生成：task-92（character-scout）｜ 2026-10-24 ｜ 共 174 文件 / **16.65 MB**

## 怎么用（给集成方）

1. 读 **`manifest.json`**：`actions` = 17 个 clip（每个有 `dir` / `frames` 播放顺序 / `durationsMs` 逐帧毫秒 / `loop` / `holdLast`）；`composites` = 11 个跨目录组合序列（think / waitPeek / cheer / errorSequence / cry / caught / lonelySit / hum / report / pat / tsundere，每步含 dir/frames/durationsMs，可直接执行）。
2. 读 **`STATE-MAP.md`**：桌宠 14 个状态 → clip/composite 映射、姿态库语义、锚点/缩放公式、28/29 对齐。
3. 读 **`ATTRIBUTION.md`**：许可全文 + 必须保留的署名（分发时一起带上）。
4. 画布 320×320、脚底锚点 `(160,295)`、标称内容高 263px → `scale = 显示身高 / 263`（1080p 默认 184px ≈ 0.70）。
5. `idle/` 是微动作，主待机用 `idleFront/`；`sneak/` = 偷吃（不是潜行移动）；`portrait.png` 512×512 供面板/关于页。
6. 不要用文件系统排序当帧序（编号不连续是设计使然，按 `manifest.json` 播放）。
7. 回退：保留旧精灵，`skin: whale-girl | classic` 切换。

## 不含什么

- 不含上游社区参考原图（溟月 / ZipZipPipe / 这个刀子真甜等，另有限制授权）、不含字体、不含 DeepSeek 官方标志；本资产是**非官方同人二创**，与 DeepSeek 官方无隶属关系。

## 文件

```
manifest.json       权威清单（17 clip + 11 composite 组合序列 + portrait）
STATE-MAP.md        状态映射/锚点/集成清单
ATTRIBUTION.md      署名 + 许可全文 + 第三方排除
README.md           本文件
idleFront/ idle/ walk/ eat/ wave/ jump/ dance/ sneak/ sleep/ turn/ actions/ expressions/
portrait.png
```

校验报告与 contact sheet：`pet-work/qa/whale-girl/QA-REPORT.md`（512 原帧也在 `qa/whale-girl/source-frames-512/`）。
