# OPERATIONS — B-only 日常操作

> 角色锁定 B；旧 A 已退役，不再回 A。所有路径以本机 `%USERPROFILE%\pet-work` 为例。

## 启动 / 停止 / 重启
- 启动：`powershell -File scripts\start-pet.ps1`（源码模式）
- 检查：`powershell -File scripts\start-pet.ps1 -Check`
- 重启：`powershell -File scripts\start-pet.ps1 -Restart`
- 退出：任务栏/面板「停止联动」；或结束 `pythonw.exe`（桌宠进程）后按需重启。

## 源码模式
- 生产源码：`%USERPROFILE%\pet-work\pet`（不要直接改已安装插件包）。
- 首次/缺 B 素材：`powershell -File scripts\fetch-b-assets.ps1` 注入 50 段 WebM 到 `pet\assets\webm_body`。
- 依赖：`python -m pip install -r pet\requirements.txt`（Python 3.11+）。

## 发行包模式
- 解压 zip → 双击 `大肥鱼桌宠.exe`；`selfcheck.ps1` 自检，`-Launch` 启动自检。
- 卸载 = 删除解压目录；不写系统目录。

## B 身体 kill-switch
- `cmd:body:png`：切 B 静帧（`whale-girl static body`），**不回旧 A**。
- `cmd:body:webm`：恢复 B 动态。
- `peek:off`：退出贴边偷看；窗口被移出屏幕时用面板「回屏内」/`cmd:snap_into_screen`。

## 日志与状态
- 插件日志：`pet-work\evidence\pet-bridge-main.log`
- 状态：`pet-work\bridge-state-v2.json`；动画日志：`pet-work\evidence\whale-b\anim-log-desktop.txt`
- 面板：DSH → 设置 → 大肥鱼联动；`/pet-bridge-ui/home`。

## 回滚
- 插件：`scripts\plugin-rollback.ps1`；恢复 `cordis.patch.yml.bak-*` 后重挂旧包。
- 桌宠：`scripts\pet-rollback.ps1`；B 异常时先 `cmd:body:png` 静帧。
- 仓库/发行包备份：`E:\project\AI提效\tool\repo-backups\dsh-dafeiyu-pet-precleanup-*.bundle`。

## 打包
- `packaging\build-b-only.ps1 -Build`（B 50 WebM 构建注入；根级 INSTALL/selfcheck/许可）。
- 产物 zip 命名含版本+git sha；交付前核对 sha256。
