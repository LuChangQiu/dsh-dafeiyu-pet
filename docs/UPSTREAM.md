# 上游对比（不 fork、不保留上游历史）

- 上游：`RYANFFY/deepseek-dafeiyu-pet`（仅作参考来源，不进入本仓 git 历史）。
- 需要跟进上游修复时：手动 diff 上游 `桌宠.py` 与 `pet/桌宠.py`，只移植必要部分。
- 关键冲突点（rebase/移植时优先检查）：`main()` 单实例管道块、`paintEvent` 动作与气泡绘制、`mouseReleaseEvent` 拖拽、`_bubble_ink`、`say()`、`tray/contextMenuEvent`（本仓已默认移除原生 UI）。
- 不要用上游覆盖 `pet/桌宠.py`，否则会丢联动补丁（协议/动作/FX/配置/去 key）。
