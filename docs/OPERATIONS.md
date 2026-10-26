# 操作手册（B-only）

> 2026-10-26 task-141：旧 A 皮肤/素材已删除；以下只保留 B（webm_body / MIT WebM）与 DSH 联调操作。

## 启动 / 重启 / 停止

```powershell
powershell -File scripts\start-pet.ps1 -Restart
node tools\pet-cmd.mjs ping
```

生产源码模式：`pet-work\pet\桌宠.py` + `pet-work\pet\config.json`（不是 APPDATA）。
B 身体在 `whale.body=webm`，单窗 `whale-girl webm body` 168×198；A 不再创建/显示。

## 查看

- 动画/状态日志：`pet-work\pet\anim-log.txt`（需 `anim-log.on` 或 `PET_ANIM_LOG`）。
- B 状态：`node tools\pet-cmd.mjs dev:info`（开发通道）。
- 点击/台词：`dev:click`；LLM 台词走 speech-requests/plugin。

## 回退

- 低内存/异常：`cmd:body:png` → B 静帧 `whale-girl static body`（不回到 A 外观）；`cmd:body:webm` 恢复。
- 进程异常：`scripts\pet-rollback.ps1`（回滚桌宠）；插件：`scripts\plugin-rollback.ps1`。
- 旧 A 回滚说明已失效：`whale_skin.py`/`assets/whale-girl`/`sprites` 已删除（备份在 `pet-work\backups\task-138-*`）。

## 打包

- B-only：`packaging\build-b-only.ps1 -Build`（B 50 段 WebM 构建时注入；根级 INSTALL/selfcheck/许可 + UTF-8 zip）。
- 旧 A spec/whale-girl 打包检查已移除。
