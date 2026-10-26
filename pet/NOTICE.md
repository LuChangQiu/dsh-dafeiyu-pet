# NOTICE — 大肥鱼桌宠（DSH 联动源码版）

本目录（`pet/`）是「大肥鱼桌宠 × DSH 联动」的桌宠源码。完整第三方声明见仓库根 `NOTICE` 与素材目录 `assets/whale-girl/ATTRIBUTION.md`；本文件只摘录与桌宠分发直接相关的署名，**不替代完整许可文本**。**授权链与分发口径**见仓库根 `PROVENANCE.md`：仅内部/同事小范围使用，暂不做公开 Release；内部包 = MIT 代码 + 2D 帧（附署名）；LOCAL ONLY 资产由用户本机自备导入、不随包。

## 1. 上游桌宠

- 上游：`RYANFFY/deepseek-dafeiyu-pet`（代码 MIT；上游素材仅限个人使用，不随代码再授权）。
- 本 fork 改动：DSH 联动补丁与管道协议、鲸鱼娘 2D 帧动画接入（manifest v3 播放器）、A 路线 2.5D 增强、失联休眠等（详见仓库提交记录）。

## 2. 鲸鱼娘 2D 帧动画素材（`assets/whale-girl/`）

- 角色素材作者：**YunYueSama**
- 仓库：https://github.com/YunYueSama/codex-deepseek-pet
- 许可：**大肥鱼项目署名许可 1.0**（完整条文见 `assets/whale-girl/ATTRIBUTION.md`，打包时随素材目录一起分发）。
- 修改说明：由原仓库图集裁切、筛选有效帧并降采样为 320×320（保留 alpha），重排 manifest v3 与状态映射；**画面内容未重绘**，仅做缩放、裁剪与帧筛选。
- 本形象为社区二创，**非 DeepSeek 官方形象**，不代表深度求索官方授权/认可；不得暗示原作者或 DeepSeek 官方为本项目背书。
- 分发/发布时须保留：作者 `YunYueSama`、上述仓库链接、完整许可文本，以及"经过修改"的说明。

## 3. 运行时依赖

- PySide6（LGPLv3，运行时依赖，不修改其源码）；分发二进制时须遵守 LGPL 相应义务（见仓库根 `NOTICE` / `LICENSE`）。
