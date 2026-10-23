# 仓库布局（单仓方案）

- `pet/`：桌宠源码干净快照（无 git 历史、无上游依赖、无构建产物）；`pet/桌宠.py` 是唯一真源。
- `plugin/server/`：DSH host 插件；`plugin/client/`：Web 管理面板。
- `install/`：一键安装 + patch 模板（server+client 两块，幂等）。
- `scripts/`：自举 bootstrap-pet.ps1、启停/回滚/活跃度/管道工具、发行构建 pet-build-release.ps1。
- `docs/`：本文件、功能范围 PLUGIN-UI-SCOPE、配置映射、代码盘点 CODE-INVENTORY、上游对比 UPSTREAM。
- 旧 fork 不再使用；本仓 = 产品 + 桌宠源码，一个 commit 同时更新插件与桌宠补丁版本（`version`/`petVersion`）。
