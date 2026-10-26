# dsh-dafeiyu-pet — 大肥鱼桌宠 × DSH 联动（单仓产品）

> 桌宠源码 + DSH 插件 + 管理面板 + 安装脚本，全部在这一个仓库里：**不 fork 上游、不保留上游 git 历史**。
> 上游代码仅保留 MIT 署名，本仓已大幅改造为 B-only，不再同步/对比上游源码。

## 结构
```
pet/                     # 改好的桌宠源码（干净快照，无 git 历史，约 2.2MB）
  ├─ pet_app.py          # 薄入口（启动/退出生命周期）
  ├─ pet_window.py       # PetWindow 主体（管道协议/动作/微动画/配置，机械搬迁自原 桌宠.py）
  ├─ pet_defaults.py     # B 身体/气泡/微动作集中默认值（config 可覆盖）
  ├─ ui_console.py       # 原生对话框配色（设置窗口已移除，仍用于余额/天气/小票弹窗样式）
  ├─ assets/body-b/      # B 静帧 placeholder.png（tracked）
  ├─ assets/webm_body/   # B HTML/JS + 50 WebM（由 fetch-b-assets 注入，不入 git）
  ├─ icon.ico            # 图标
  ├─ webm_body.py        # B 身体 QWebEngine 适配器
  └─ requirements.txt    # PySide6 等依赖
scripts/fetch-b-assets.ps1  # 注入 B 50 WebM（从 third-party/本机 pet-work；不入 git）
packaging/             # B-only PyInstaller spec/build（根级 INSTALL/selfcheck/许可 + UTF-8 zip）
plugin/
  ├─ server/             # DSH host 插件 dsh-pet-bridge
  └─ client/             # 管理面板 dsh-pet-bridge-ui
install/                 # 一键安装 + cordis.patch 模板（server+client 两块）
scripts/                 # 自举/启停/回滚/活跃度/管道工具 + 发行构建脚本
docs/                    # 仓库布局、契约、扩展、测试、发布与安全说明
```

## 安装（同事）
1. 装 DSH（Node 22+），克隆本仓库。
2. `install\install.ps1`：复制 server/client 到 DSH profile、写 patch 两块、把 `pet/` 与 `scripts/`（tools）释放到 `%USERPROFILE%\pet-work`，并尝试注入 B 50 WebM；无 B 源时 B 静帧回退。
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

## 发行包（B-only，免 Python）
- 打包：`packaging\build-b-only.ps1 -Build` → `dafeiyu-pet-win64-<ver>-<sha>.zip` + `.sha256`（B 50 WebM 构建时注入；根级 LICENSE/NOTICE/README/INSTALL/selfcheck + UTF-8 zip）。
- 源码模式先跑 `scripts\fetch-b-assets.ps1` 注入 B 素材；`-DryRun` 可零写入检查。
- 分发：**内部小范围**，直接发 zip（解压即用）；不公开 Release（见 `PROVENANCE.md`）。
- 当前 r3 内部构建（本版本重构）：`release-build\b-only-r3\dafeiyu-pet-win64-1.1.5-dsh.3-whalegirl-<git短sha>.zip`；sha 以同名 `.sha256` 为准（repo build 产出，根级 LICENSE/NOTICE/INSTALL/README/selfcheck 齐全）。
- 回滚保留 r2：`dafeiyu-pet-win64-1.1.5-dsh.2-whalegirl-831002e.zip`，**276,706,744B / SHA256 `D550CAE684F30AB25CAD9B6E0E5B7EDBF5A3E1DBF69F6B9989629E8E681D5A44`**。

## 上游更新
不 fork、不建上游 git 历史：手动 diff 上游 `pet_app.py` 与 `pet/pet_app.py`，只移植必要修复（记忆点：`main()` 单实例块、`paintEvent`、`mouseReleaseEvent`、`_bubble_ink`、`say()`）。

## 形象与素材署名
- 默认形象：**MIT 鲸鱼娘 B 身体**（项目 `dsh-whale-girl-pet`，作者 yanzwzz）——50 段 WebM 动作；许可全文/署名见 `packaging/third-party-b/LICENSE-B.txt`、`NOTICE-B.md`、`packaging/PROVENANCE-B.md`。
- 素材经 AI/Vidu 生成与重编码；本形象为社区二创，**非 DeepSeek 官方形象**，不代表深度求索授权/背书。
- 旧 A（鲸尾女仆三视图 / `assets/whale-girl` / `whale_skin.py`）已于 task-138 退役；本仓库与发行包**只保留 B**，仅作历史一句记录，不再随包/不再映射。

## License
MIT（见 `LICENSE`）；PySide6 为 LGPLv3 运行时依赖；上游/形象素材声明见 `NOTICE`；**授权链与内部分发口径见 `PROVENANCE.md`（仅内部/同事使用，暂无公开 Release 计划）**。





