# B 素材来源与处理链（PROVENANCE）

- 上游：`dsh-whale-girl-pet`（MIT，作者 yanzwzz），50 段鲸鱼娘 WebM 动画。
- 来源目录（构建时注入）：`tools/body-b/webm_pet/`
  - `index.html` / `clips.js` / `qwebchannel.js` / `assets/*.webm`（50 段，VP9 alpha，约 25.8MB）
  - `LICENSE`（MIT 全文）、`NOTICE.md`
- 本仓集成：`pet/webm_body.py`（透明 QWebEngineView 适配器，168×198，clip 切换 120ms，peek 优先级，banned clip 门禁）+ `pet/pet_app.py` B 身体 shim。
- B 静帧回退：`tools/body-b/placeholder.png`（由 `待机呼吸休闲.webm` 首帧经 ffmpeg `-c:v libvpx-vp9 -pix_fmt rgba` 导出后按 168×198 布局合成）。
- 许可：MIT 全文见 `LICENSE-B.txt`；署名/来源/重编码说明见 `NOTICE-B.md`。
- 发行包不包含 A/鲸尾女仆外观与旧 `dsh-dafeiyu` 素材。
