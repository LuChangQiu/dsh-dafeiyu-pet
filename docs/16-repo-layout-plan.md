# 16 · 新仓库分层方案（插件产品仓 dsh-dafeiyu-pet）

> 2026-10-23 ｜ 决策：**两个仓库分工**，新仓库只放插件产品；桌宠源码继续留在现有 fork。

## 1. 仓库分工

| 仓库 | 内容 | 分支/追踪 |
| --- | --- | --- |
| `LuChangQiu/deepseek-dafeiyu-pet`（现有 fork） | **桌宠源码**（桌面宠物本体 + 联动补丁）、`patch/apply_p1.py`、`tools/`、桌宠发行打包 `scripts/build-release.ps1`、桌宠侧文档 | `main`=上游原样；`custom/dsh-linkage`=开发分支；`upstream-v1.1.5` tag |
| `dsh-dafeiyu-pet`（新仓库，public） | **DSH 插件产品**：`plugin/server/`、`plugin/client/`、`install/`、`scripts/`、`docs/`、`release/`（版本说明，二进制走 GitHub Release） | `main`；版本 tag（如 `v0.18.0`） |

## 2. 目录（新仓库）

```
dsh-dafeiyu-pet/
├─ plugin/server/        # dsh-pet-bridge（host 插件：事件归因/气泡节奏/配置真源/生命周期/state）
├─ plugin/client/        # dsh-pet-bridge-ui（Web 管理面板）
├─ install/              # install.ps1 + cordis.patch.template.yml（含 server+client 两 insert 块）
├─ scripts/              # bootstrap-pet.ps1（自举）、set-activity.ps1、pet-cmd.mjs、rollback 辅助
├─ docs/                 # 架构、安装/使用、管理面板、审查报告、发布说明
└─ release/              # CHANGELOG / 版本说明；二进制走 GitHub Release
```

## 3. 版本联动与防漂移

- 插件版本（新仓库 tag，如 `v0.18.0`）与桌宠 fork 的 **pet 版本/compat tag**（如 `pet-v1.1.5-dsh.1`，Release 资产 `dafeiyu-pet-win64-<ver>.zip`）分别发版。
- `state.json` 同时上报 `version`（插件）与 `petVersion`（桌宠补丁），管理面板展示"插件 vX / 桌宠 vY"，不一致时提示"桌宠版本旧，可一键更新"。
- 插件启动自举：先按 `lifecycle.releaseZipUrl` / 配置的 pet 版本校验本地 `petVersion`；缺失或落后 → 下载对应 Release zip（或本地源码/venv）→ 启动。避免"插件更新但桌宠旧"。
- Release 归属：**桌宠 zip 属于桌宠 fork 的 Release**；插件发布说明只记录兼容的 pet 版本范围 + 下载链接。

## 4. 同事安装（只装插件）

1. `dsh plugin add <本地 dsh-dafeiyu-pet 目录或 npm 包>`（或 `install/install.ps1`）
2. 重启 `dsh web`
3. 插件自举：检测 pet 运行时 → 无则优先本机 Python3.11+ 建 venv；无 Python 则从桌宠 fork Release 下载 `dafeiyu-pet-win64-<ver>.zip` 解压启动
4. 管理面板出现，桌宠自动出现

## 5. 迁移步骤

1. 用户创建空仓库 `dsh-dafeiyu-pet`（public）
2. 从现有 fork 的 `plugin/`、`install/`、`scripts/`、`docs/` 抽到新仓库对应目录（去掉 pet 源码）
3. `install/cordis.patch.template.yml` 单真源（两块 insert）；`secret` 扫描后首推 main
4. 新仓库加 `LICENSE`（MIT + 桌宠素材声明引用上游 LICENSE）、`CONTRIBUTING`、`SECURITY`
5. 后续插件版本只在新仓库迭代；桌宠改动仍在 fork 分支
