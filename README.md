# dsh-dafeiyu-pet — 大肥鱼桌宠 × DSH 联动（单仓产品）

> 桌宠源码 + DSH 插件 + 管理面板 + 安装脚本，全部在这一个仓库里：**不 fork 上游、不保留上游 git 历史**。
> 上游只做手动对比（见 `docs/UPSTREAM.md`），不参与构建。

## 结构
```
pet/                     # 改好的桌宠源码（干净快照，无 git 历史，约 2.2MB）
  ├─ 桌宠.py             # 主程序（含 DSH 联动补丁：管道协议/动作/微动画/配置）
  ├─ ui_console.py       # 原生对话框配色（设置窗口已移除，仍用于余额/天气/小票弹窗样式）
  ├─ assets/ sprites/    # 必需素材（约 1.4MB）
  ├─ icon.ico            # 图标
  ├─ 桌宠.spec           # PyInstaller 发行构建 spec
  └─ requirements.txt    # PySide6 等依赖
plugin/
  ├─ server/             # DSH host 插件 dsh-pet-bridge
  └─ client/             # 管理面板 dsh-pet-bridge-ui
install/                 # 一键安装 + cordis.patch 模板（server+client 两块）
scripts/                 # 自举/启停/回滚/活跃度/管道工具 + 发行构建脚本
docs/                    # 仓库布局、功能范围、配置映射、代码盘点、上游对比
```

## 安装（同事）
1. 装 DSH（Node 22+），克隆本仓库。
2. `install\install.ps1`：复制 server/client 到 DSH profile、写 patch 两块、把 `pet/` 释放到 `%USERPROFILE%\pet-work\pet`。
3. 重启 `dsh web`：管理面板出现；插件启动自举（`scripts\bootstrap-pet.ps1`）：
   - 优先用**仓库内 `pet/` 源码** + 本机 Python 3.11+ 建 venv 启动；
   - 无 Python / 无法建 venv 时，才回退 Release zip（`lifecycle.releaseZipUrl`，可选）。
4. 应急：`scripts\start-pet.ps1 -Check|-Restart`、`scripts\pet-rollback.ps1`、`scripts\plugin-rollback.ps1`；面板内也有重启/停止/恢复默认/查看日志/回滚指引。
5. 卸载：`scripts\plugin-rollback.ps1`（glob 清理插件+面板、还原 patch、校验无残留）。

## 启动兜底（计划任务）
- 安装时注册 Windows 计划任务 `DafeiyuPetStart`（powershell 运行 `scripts\start-pet.ps1`）。
- 面板「启动桌宠」/离线「重启」通过 `schtasks /Run /TN DafeiyuPetStart` 拉起，绕开 DSH 插件子进程限制；卸载时可用 `schtasks /Delete /TN DafeiyuPetStart /F` 删除。

## 版本配对（插件 ↔ 桌宠）
| 组件 | 位置 | 版本标识 |
|---|---|---|
| 插件 server | `plugin/server` | `package.json` 的 `version`（以文件为准） |
| 管理面板 client | `plugin/client` | 与 server 同步 |
| 桌宠源码 | `pet/` | `petVersion`（`v1.1.5+patch-v<server版本号>`，插件运行时上报） |

插件 `bridge-state-v2.json` 同时上报 `version` 与 `petVersion`；两处版本在**同一个 commit** 更新，避免漂移。

> 给 AI Agent / DSH 的安装说明见 [`AGENTS.md`](AGENTS.md)。

## 发行包（免 Python，可选）
- 打包：`scripts\pet-build-release.ps1 -Version 1.1.5-dsh.1` → `dafeiyu-pet-win64-<ver>.zip` + `.sha256`。
- 分发：优先 GitHub Release（https://github.com/LuChangQiu/dsh-dafeiyu-pet/releases/tag/pet-v1.1.5-dsh.1）；未上传时可直接发 zip（解压即用；单实例互斥会与运行中的桌宠二选一）。
- 当前 zip：`dafeiyu-pet-win64-1.1.5-dsh.1.zip`，sha256 `F2B6D7A1D8183820E40CE0F2C0BC419DB56E45F78C81776C4E4A069904BE99E5`。

## 上游更新
不 fork、不建上游 git 历史：手动 diff 上游 `桌宠.py` 与 `pet/桌宠.py`，只移植必要修复（记忆点：`main()` 单实例块、`paintEvent`、`mouseReleaseEvent`、`_bubble_ink`、`say()`）。

## 形象与素材署名
- 默认形象：**大肥鱼 / DeepSeek 鲸鱼娘（社区二创）**——2D 帧动画素材来自 [YunYueSama/codex-deepseek-pet](https://github.com/YunYueSama/codex-deepseek-pet)（作者：YunYueSama），按「大肥鱼项目署名许可 1.0」署名使用；本项目对其做了裁剪/降采样/状态映射等修改。
- 该许可条文允许使用/修改/分享及商用，**但上游未授予底层第三方参考作品与角色设计的权利**；公开分发/商用前请自行确认授权。本项目按个人/内部使用处理。
- 本形象为社区二创，**非 DeepSeek 官方形象**，不代表深度求索官方授权。
- 许可全文、第三方排除与来源：`assets/whale-girl/ATTRIBUTION.md` 与 `NOTICE`。
- 授权链（溟月 → ZipZipPipe → BlueFatFish → codex 2D 帧 → DeepSeek 商标）与分发口径：见仓库根 **`PROVENANCE.md`**。**本项目仅内部/同事小范围使用，暂不做公开 Release**；内部包 = MIT 代码 + 2D 帧（附 NOTICE/ATTRIBUTION，非商业）；3D v1 的 BlueFatFish VRM 由用户自备导入（LOCAL ONLY，不随包、不再分发）。

## License
MIT（见 `LICENSE`）；PySide6 为 LGPLv3 运行时依赖；上游/形象素材声明见 `NOTICE`；**授权链与内部分发口径见 `PROVENANCE.md`（仅内部/同事使用，暂无公开 Release 计划）**。


