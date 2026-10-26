# 仓库审计与清理记录（2026-10-26）

范围：`dsh-dafeiyu-pet-repo`（B-only 最终仓），tracked 文件全部过一遍；工作区构建产物不纳入 git。

## 1. 已删除的无用内容

| 文件/目录 | 原因 |
|---|---|
| `docs/32-config-mapping.md` | A 路线 2.5D 配置映射，已无对应实现 |
| `docs/CODE-INVENTORY.md` | 旧 A/B 盘点，内容过期 |
| `docs/INSTALL-STRATEGY.md` | 旧安装策略，被交付包 INSTALL/README 取代 |
| `docs/LIFECYCLE-PLAN.md` | 旧生命周期计划，功能已实现并入现有代码 |
| `docs/OPERATIONS.md` | 旧 A 运维/回滚步骤，已失效 |
| `docs/POST-WINDOW-PLAN.md` | 窗口后旧计划，已过期 |
| `docs/RENDER-ENHANCE.md` | A 2.5D 渲染增强说明，已移除 |
| `docs/UPSTREAM.md` | 上游同步说明；本仓已停止同步上游 |
| `packaging/task-138-remove-a-appearance.ps1` | A 已删除，脚本完成历史使命 |
| `pet/assets/D1.mp3` `D2.mp3` `Ya1.mp3` `Ya2.mp3` | 无任何代码/文档引用（保留对应 wav） |
| `pet/NOTICE.md` | 与根 `NOTICE` 重复，且旧“上游 fork”表述不再准确；根 NOTICE 已含完整许可/署名 |

## 2. 检查结果（全仓）

- tracked：约 200 files / 2.5MB；无单文件 >1MB；`preflight 14/14` 保持通过。
- 最大文件：`pet/pet_app.py` 573KB（主程序）、`pet/ui_console.py` 179KB、`pet/icon.ico` 157KB、`plugin/server/lib/index.js` 149KB、`plugin/client/lib/*.js` 100–111KB。
- 无 webm/mp4/模型/构建产物入库；50 段 B WebM 构建时注入。
- 资源引用检查：保留的 `small-whale.png`/`icon.ico`/wav/svg 均有代码引用；删掉的 4 个 mp3 无引用。
- 旧 A 历史记录仅保留在根 NOTICE/PROVENANCE/README 的“已退役”一句，不再有可执行路径。

## 3. 命名准确性

**不准确/不一致（建议下一批改）**：
- `pet/pet_app.py`（中文文件名）与 `packaging/桌宠-b-only.spec` 不符合英文命名规范；
- 代码里仍引用 `pet_app.py` 的启动/打包/测试脚本约 30 处。

改名方案（需要同步改启动脚本、PyInstaller spec、测试与生产 pet-work，并重打交付包）：
`pet/pet_app.py → pet/pet_app.py`；`packaging/桌宠-b-only.spec → packaging/pet-b-only.spec`。
本次未执行：会改变正在运行的桌宠入口与已交付包结构，风险高于收益；确认要做时按“分支改→全量测试→重打包→替换生产→归档旧名”执行。

## 4. 大文件/拆分/参数配置

- 无超大文件；`pet/pet_app.py` 573KB 属单文件偏大（UI + 管道 + 动画 + 配置），建议后续拆 `app_core`/`pipe_protocol`/`animation`/`config` 四块；不是当前交付阻塞。
- 参数已有两层配置：`pet/config.json`（运行时外观/行为）+ `ui-config.json`（面板写入）；无硬编码绝对路径。
- 仍有少量魔法数字（窗口尺寸/动画时长/气泡时长）散在代码；建议后续抽到 `pet/config_defaults.py`，本次不改以保稳定。

## 5. GitHub 分支清理

- 远程 16 个 `feat/*` 分支已全部删除，GitHub 只剩 **main**；
- 本地只剩 main；保留 11 个 tag（final + archive 8 + 旧 2），archive tag 保存暂缓功能提交；
- 完整历史备份：`E:\project\AI提效\tool\repo-backups\dsh-dafeiyu-pet-precleanup-20261026-140829.bundle`（19.47MB，含全部 refs）。

## 6. 安装脚本修正

`install/install.ps1` 之前指向不存在的 `plugin/dsh-pet-bridge*` 目录；已改为 `plugin/server|client`，包名/模板 id 同步到 `dsh-pet-bridge-v49`，预算默认改 ¥10/日；模板 `set/install` 仍可作为源码安装入口。
