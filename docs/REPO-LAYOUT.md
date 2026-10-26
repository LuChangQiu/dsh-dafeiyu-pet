# 仓库布局（单仓方案）

- `pet/`：桌宠源码干净快照（无 git 历史、无上游依赖、无构建产物）；`pet/pet_app.py` 是薄入口，`pet/pet_window.py` 是 PetWindow 主体（唯一实现真源），`pet/pet_defaults.py` 集中 B 身体/气泡/微动作默认值。
- `plugin/server/`：DSH host 插件；`plugin/client/`：Web 管理面板。
- `install/`：一键安装 + patch 模板（server+client 两块，幂等）。
- `scripts/`：自举 bootstrap-pet.ps1、启停/回滚/活跃度/管道工具、发行构建 pet-build-release.ps1。
- `docs/`：本文件、契约（DATA/CHAT/STATE）、扩展、测试、发布、安全与 UI 范围；过期计划文档已删除。
- 旧 fork 不再使用；本仓 = 产品 + 桌宠源码，一个 commit 同时更新插件与桌宠补丁版本（`version`/`petVersion`）。

