# REPO-WORKFLOW（多 agent 并发提交纪律）

## 提交前
1. `git pull --ff-only`（拿最新 HEAD，避免基于旧基线）
2. `git status --short` 核对**只含自己负责的路径**；禁止 `git add -A` 夹带他人在途文件
3. 只 `git add <白名单路径>`（本次任务写区）
4. 跑 `node --check` / `npm run lint` / 相关测试；pre-commit 会兜底（node/prettier/ruff）
5. 提交信息写明版本事项（如 `feat(task-90): ...`）

## 并发冲突
- 遇 `index.lock` / `ref lock`：等待 2–3s 重试；**不要** `git reset --hard`、不要 `git clean -fdx`
- 遇 `non-fast-forward`：`git pull --rebase` 后重试；冲突只解决自己文件，不覆盖队友改动
- 大文件/缓存：`__pycache__/`、`*.pyc`、`dist/`、`logs/`、`evidence/`、`state*.json`、`*.bak*` 一律不入库
- 部署/挂载需 reviewer APPROVED；脚本默认 `-DryRun`

## 事故复盘（2026-10-24）
- 现象：`fcc221c` 多 agent 并发 commit 夹带 `pet/__pycache__/*.pyc` 与他人 in-flight 文件
- 修复：`fcc221c..6637945` 移除 pycache + `.gitignore` 追加 `__pycache__/`、`*.pyc`
- 教训：只用白名单 `git add`；提交前必看 `git status`；pull 后再提交
