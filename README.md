# dsh-dafeiyu-pet — DSH 大肥鱼桌宠联动产品仓（插件产品）

> 本仓库只放 **DSH 插件产品**（server + client/管理面板 + 安装/脚本/文档）。
> 桌宠源码在 fork 仓：`LuChangQiu/deepseek-dafeiyu-pet`（分支 `custom/dsh-linkage`，跟踪上游）；桌宠发行产物走该仓的 GitHub Release。

## 结构
- `plugin/server/` — DSH host 插件 `dsh-pet-bridge`（事件归因/气泡节奏/配置真源/生命周期/state）
- `plugin/client/` — 管理面板 `dsh-pet-bridge-ui`（Web 设置页，`/pet-bridge-ui`）
- `install/` — `install.ps1` + patch 模板（`pet-bridge-vX` 与 `pet-bridge-ui` 两块）
- `scripts/` — 自举/启停/回滚/活跃度/管道调试脚本；`pet-build-release.ps1` 为桌宠 fork 的发行构建脚本副本（构建需在 fork 源码运行）
- `docs/` — 仓库分层、配置映射、使用说明
- `release/`（后续）— 版本说明；二进制不进 git

## 版本联动（防止插件新/桌宠旧）
| 组件 | 版本/tag | 产物 |
|---|---|---|
| 插件 | 本仓 tag（如 `v0.18.0`） | 无二进制，npm/本地包 |
| 桌宠 fork | tag `pet-v1.1.5-dsh.1`（分支 custom/dsh-linkage） | Release: `dafeiyu-pet-win64-1.1.5-dsh.1.zip` |
- 当前桌宠 Release 资产（待上传）：`dafeiyu-pet-win64-1.1.5-dsh.1.zip`，sha256 `F2B6D7A1D8183820E40CE0F2C0BC419DB56E45F78C81776C4E4A069904BE99E5`（大小 75.3MB）
- 插件 `state.json` 上报 `version`（插件）与 `petVersion`（桌宠补丁）；管理面板显示两者，不一致提示升级。
- 自举：`scripts/bootstrap-pet.ps1` 检测不到运行时 → 优先本机 Python3.11+ 建 venv；无 Python 则下载桌宠 Release zip（`lifecycle.releaseZipUrl`）解压启动。

## 同事安装（只装插件）
1. 装 DSH（Node 22+），`dsh plugin add <本仓本地目录或包>`
2. `install\install.ps1`（装 server/client、写 profile patch 两块、准备运行目录）
3. 重启 `dsh web` → 管理面板出现；自举自动拉起桌宠
4. 回滚：`scripts\plugin-rollback.ps1` / `scripts\pet-rollback.ps1`

## License
MIT（见 LICENSE）；PySide6 为 LGPLv3 运行时依赖；上游桌宠素材声明见 NOTICE。
