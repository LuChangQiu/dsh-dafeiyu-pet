# ATTRIBUTION / 素材署名与许可

> 本目录（`pet-work/assets/whale-girl/`）是「大肥鱼 / DeepSeek 鲸鱼娘」**2D 桌面宠物动画帧资产**，由 `codex-deepseek-pet` 仓库的角色动画素材筛选、裁剪、降采样而来。
> 生成任务：task-92（character-scout）｜生成日期：2026-10-24

## 1. 署名（分发/展示/发布时必须保留）

```text
角色素材作者：YunYueSama
仓库：https://github.com/YunYueSama/codex-deepseek-pet
许可：大肥鱼项目署名许可 1.0（见下方全文）
修改说明：由原仓库 assets/whale 图集裁切、筛选有效帧并降采样为 320px（保留 alpha），
         重新编排 manifest/状态映射；画面内容未重绘，仅做缩放、裁剪与帧筛选。
```

- 本项目对素材的修改：**仅做裁切、筛选、降采样（512→320）、透明通道保留与清单编排**，未对角色画面做重绘或再创作。
- 署名位置：本桌面宠物的 README、关于/设置页、随附说明或发布说明等使用者容易找到的位置。
- 不得暗示原作者 YunYueSama 或 DeepSeek 官方对本项目认可/代言。
- **DEEPSEEK 官方从未推出、也未认领任何拟人吉祥物**；「大肥鱼/鲸鱼娘」是社区二创形象，本目录仅用于个人桌面宠物项目。

## 2. 许可全文（原样保留）

```text
大肥鱼项目署名许可 1.0（自定义许可，非标准 MIT）

Copyright (c) 2026 YunYueSama
作者：YunYueSama
仓库：https://github.com/YunYueSama/codex-deepseek-pet

1. 适用范围

本许可适用于本仓库中由项目作者拥有或有权授予许可的所有材料，包括源代码、文档、角色设定、图片、设计图、动画与其他资源（以下称“材料”）。第三方材料及另有许可声明的部分不在本授权范围内，详见 ASSET_LICENSE.md。

2. 授予的权利

在遵守以下条件的前提下，任何人均可免费使用、复制、修改、合并、展示、发布、分发、再许可及出售材料或其衍生作品，包括用于商业目的，无需另行向项目作者申请许可。修改后的作品无需公开源代码。

3. 必须保留的署名

使用、展示、发布或分发材料或其衍生作品时，必须清楚标明以下两项：

作者：YunYueSama
仓库：https://github.com/YunYueSama/codex-deepseek-pet

署名可以放在作品的 README、关于页面、致谢、随附说明或图片/视频发布说明等使用者或接收者容易找到的位置；无需在角色画面上添加水印。私人使用时，保留随附的署名与许可文件即可。署名不得仅写“来源网络”或只列作者而省略仓库地址。

分发材料或其实质性部分时，须同时保留本版权声明及完整许可文本。修改后的作品须说明经过修改，不得将修改内容冒称为原作者作品。再许可不得取消原材料的上述署名和许可保留义务；不得暗示原作者或 DeepSeek 官方认可或代言衍生作品。

4. 第三方权利与旧版本

本许可不授予第三方参考作品、字体、依赖、商标或其他第三方内容的额外权利。此类内容仍遵守各自的授权；对衍生素材的授权仅及于作者有权授权的贡献，不替代底层参考作品可能需要的许可。使用 AI 生成或处理素材不扩大授权范围。

此前已按 MIT 或其他许可发布的版本，其已授予的权利不因本许可变更而撤销；请以取得的相应版本所附许可为准。

5. 免责声明

材料按“现状”提供，不作任何明示或默示保证，包括适销性、特定用途适用性或不侵权的保证。在适用法律允许的范围内，作者或版权持有人不对因使用材料或与材料有关的行为所产生的任何索赔、损害或其他责任负责。
```

## 3. 第三方内容排除声明（重要）

- 上游仓库 `ASSET_LICENSE.md` 明确：作者可再授权的是其**新增贡献**；`design/`、`assets/whale/` 中的图像是依据社区角色参考经 AI 生成/透明化/图集编译产生，**不授予底层参考作品、角色设计、标志等第三方内容的额外权利**。
- 本目录**不包含**上游仓库中的社区参考原图（如 `assets/你这吃白饭的蓝色大肥鱼.png`）、用户提供参考图、字体（Noto Serif SC，OFL）、第三方依赖或任何 DeepSeek 官方标志文件。
- 上游提到的社区参考（溟月 / ZipZipPipe / 这个刀子真甜等）版权归各自作者：溟月为 **CC BY-NC-SA 4.0（非商用）**、ZipZipPipe 声明**禁止商用**。本项目**未使用**这些原图；仅将其作为设计语言参考（见 `deliverables/pet-integration/29-character-bible.md` §1/§14）。
- 若相关权利人认为本衍生帧超出授权范围，请联系项目维护者删除/替换。

## 4. 来源与处理链

| 步骤 | 内容 |
|---|---|
| 原始来源 | `reference-repos/codex-deepseek-pet/assets/whale/`（图集：dense-idle / dense-walk / dense-eat / dense-wave / dense-jump / dense-dance / dense-sneak / dense-sleep / actions / expressions / motion-turn / idle-front / portrait） |
| 角色基准 | `reference-repos/codex-deepseek-pet/design/character-standard.png`（六视图，外观唯一标准） |
| 帧选择依据 | `reference-repos/codex-deepseek-pet/src/renderer/motion.js`（上游实际使用的帧序与时长） |
| 第一刀（Lead） | 从图集按 512 cell 裁切出 299 帧（`qa/whale-girl/source-frames-512/` 保留 512 原帧） |
| 本次（task-92） | 按 motion.js 筛选有效帧（173 帧）+ portrait；512→320 降采样保留 alpha；生成 `manifest.json` / `STATE-MAP.md` / QA 报告 |
