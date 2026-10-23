# 代码规范（task-43）

- **Python（pet/桌宠.py）**：`ruff`，120 列（`ruff.toml`）。补丁锚点/协议处理/FX 层已加中文注释；不改上游既有风格大范围。
- **JS（plugin/server、plugin/client、scripts）**：Prettier（120 列、单引号、无分号）+ ESLint flat config；JSDoc 标注协议入口/路由/工具函数。
- **PowerShell（scripts/*.ps1、install/*.ps1）**：UTF-8 with BOM（Windows PowerShell 5.1 必需）；文件头注释写用途/参数/示例。
- **运行**：
  - `npm install`（首次）→ `npm run lint`（node --check + prettier）
  - `scripts\lint.ps1`（node + prettier + ruff 一站式）
  - Python：`ruff check pet --config ruff.toml`
- **原则**：只做规范化，不改行为；改动前后跑 `node --check` 与 smoke/E2E。
