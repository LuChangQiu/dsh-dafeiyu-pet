# NOTICE — 大肥鱼桌宠（B-only）

本目录 `pet/` 是 B 鲸鱼娘身体的桌宠源码。完整第三方声明见仓库根 `NOTICE` 与 `packaging/PROVENANCE-B.md`；本文件只摘录桌宠分发相关署名。

## 1. 上游代码

- 上游：`RYANFFY/deepseek-dafeiyu-pet`（MIT）。
- 本 fork：DSH 管道协议、B 身体接入（`webm_body.py`）、B 静帧回退、平滑动画逻辑；不再包含旧 A 皮肤/精灵。

## 2. B 身体素材

- 项目：`dsh-whale-girl-pet`；作者：**yanzwzz**；许可：**MIT**。
- 素材：50 段 VP9-alpha WebM（AI/Vidu 生成，重编码）；许可全文与 NOTICE 见 `packaging/third-party-b/`。
- 本形象为社区二创，**非 DeepSeek 官方形象**，不代表深度求索授权/认可。
- `举牌不是大肥鱼` / `空白举牌` 仅素材保留，不接 DSH 映射。

## 3. 旧 A（已退役）

`assets/whale-girl`、`sprites/`、`whale_skin.py` 已于 task-138 删除；仅历史一句，不再随包。

## 4. 运行时依赖

PySide6（LGPLv3，运行时依赖）；分发二进制时遵守 LGPL 义务。
