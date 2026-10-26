# PROVENANCE · B 身体素材来源与分发包口径

> 状态：2026-10-26（task-138/141）。本仓库与发行包**只保留 B（MIT 鲸鱼娘 WebM）**；旧 A 外观已退役。

## 1. B 身体素材

| 项 | 内容 |
|---|---|
| 上游项目 | `dsh-whale-girl-pet` |
| 作者 | yanzwzz |
| 许可 | MIT（全文 `packaging/third-party-b/LICENSE-B.txt`） |
| 素材 | 50 段 VP9-alpha WebM（约 25.8MB），`tools/body-b/webm_pet/assets/*.webm`（不入 git） |
| 生成/处理 | AI/Vidu 生成；重编码为 50 段 WebM；静帧 `placeholder.png` 由 `待机呼吸休闲.webm` alpha 首帧合成 |
| 运行集成 | `pet/webm_body.py` + `pet/桌宠.py` B shim；单窗 168×198、120ms clip 切换、peek 优先级、B 静帧回退 |

## 2. 分发口径

- 代码：MIT（根 `LICENSE`）。
- B 素材：MIT；随包附 `LICENSE-B.txt` + `NOTICE-B.md` + 本文件。
- 50 段 WebM 不入 git；发布包构建时从 `tools/body-b`/third-party 注入。
- `举牌不是大肥鱼` / `空白举牌` 仅素材保留，不接 DSH 映射。

## 3. 已退役（仅历史）

- 旧 A：`assets/whale-girl`、`pet/sprites`、`pet/whale_skin.py` 及旧鲸尾/三视图授权链于 task-138 删除；不再随包、不再映射。
- 3D/VRM 等 LOCAL ONLY 资产从未进入本发布包。
