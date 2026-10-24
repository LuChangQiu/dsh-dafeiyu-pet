# POST-WINDOW-PLAN（窗口后第一批，按序）

| # | 事项 | 验收判据 | 预计 |
|---|---|---|---|
| 1 | 12:00 卸载/保留决策 | Lead 决策记录；卸载走 unmount 工具 + id=0/disposed/host 存活 | 0.2h |
| 2 | B2/B3/B3.1 未挂载 copy 安装 + hash 校验 + live 回归（与 plugin-ui/reviewer） | 源/安装 hash 一致；home 401、state.get 真实数据；live 回归清单 PASS | 2h |
| 3 | F1–F5 修复（工具分类/状态/费用/多会话/互动） | verifier V1/V6/V7/V11 增量 PASS；无回归 | 3h |
| 4 | STATE-SEMANTICS + PERFORMANCE-CONTRACT（config/mappings.json 配置驱动） | 无新增 timer/热路径 snapshot/同步写盘；mappings 校验 + unknown 计数 | 3h |
| 5 | PyInstaller zip + 一键自检/修复 | zip 可重复构建+sha256；自检覆盖插件/venv/schtasks；修复失败回滚 | 2h |
| 6 | 命名整改（含 scripts/check-filenames.mjs 非 ASCII CI） | 全仓路径 ASCII（白名单显式）；preflight/pre-commit/CI 均跑；启动/pipe/打包回归 | 3h |
| 7 | 3D 高光时刻 spike（B 线） | 透明/多屏/性能指标按 25 §5.9；默认 2d 可回 | 2h |
| 8 | PROVENANCE 合入 | NOTICE/PROVENANCE 覆盖全部第三方资产；许可记录可查 | 1h |

冻结期只写本计划，不执行；每项独立 commit + 证据路径 + reviewer 门禁。
