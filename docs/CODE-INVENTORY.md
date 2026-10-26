# 代码盘点（B-only 现状）

> 2026-10-26 task-141 更新。产品仓只保留 B（MIT 鲸鱼娘 WebM）+ DSH 联动；旧 A 皮肤/素材已删除。

## 一句

桌宠本体 = 上游 MIT 代码 + DSH 管道协议/气泡/动作叠加 + B 身体接入（`webm_body.py`）与平滑动画逻辑；不再包含 A 帧皮肤、sprites、whale_skin。

## 关键文件

| 文件/目录 | 说明 |
|---|---|
| `pet/桌宠.py` | 主程序；B shim、DSH 管道、气泡/动画逻辑 |
| `pet/webm_body.py` | B 透明 QWebEngineView 适配器（50 clip/120ms/peek/静帧回退） |
| `pet/smooth_anim.py`、`speech_requests.py` | 平滑/编排、LLM 台词队列 |
| `plugin/` | DSH server/client 插件 |
| `packaging/` | B-only 打包：spec、build 脚本、third-party-b 许可/静帧 |
| `docs/generated/action-clips.json` | B 50 clip 清单（映射/导演用） |

## 已删除

- `assets/whale-girl/`、`pet/sprites/`、`pet/whale_skin.py` 及旧 A 授权链（task-138）。
