# MOUNT-TOOLS 用法/安全边界
- mount-check.ps1 [-TargetCommit <hash>] [-DryRun]：只读检查 repo clean/TARGET_COMMIT/validate-profile --expect unmounted/preflight/verify:detached/privacy/备份/APPROVED；输出 JSON，exit 0=可挂载。
- mount-pet.ps1 -TargetCommit <hash> [-DryRun] [-TimeoutSec 30] [-SampleCount 10]：构建新包目录→safe-patch 切换 id（保留 ui 块，原子写+备份）→轮询 loaded v<ver>/version/writerId→验证 home 401/ping/无 TEST HOOK/无 error→30s×N 采样→失败自动回滚 patch。
- unmount-pet.ps1 [-DryRun]：unmount-pet-blocks.mjs 移除 bridge 块→校验 id=0/disposed/host 存活→写 REVIEW-LOG。
- APPROVED 标记：verify/REVIEW-LOG.md 最新含 APPROVED 且 commit 匹配，或 evidence/approval.json `{commit,approvedAt,reviewer,scope}`。
- 安全边界：默认 DryRun；不修改 pet/server 与 ui 块；所有 patch 改动前备份；不自动删除旧包（回滚用）；本工具不真正挂载除非显式执行且 reviewer APPROVED。
