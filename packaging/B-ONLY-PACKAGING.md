# B-only 发行打包准备（静态脚本；默认 dry-run，不执行最终打包）

本目录用于 B（MIT 鲸鱼娘 WebM）单身体发行包：**只带 B，不带 A 外观/素材**。
B 的 50 段 WebM 不入 git；构建时从 `tools/body-b/webm_pet/`（或 `third-party/dsh-whale-girl-pet`）注入。

## 使用

```powershell
# dry-run：只列清单/体积估算，不打包
powershell -File packaging\build-b-only.ps1

# 真正打包（等 B PASS 后由 Lead 批准再执行）
powershell -File packaging\build-b-only.ps1 -Build -Version 1.1.5-dsh.2-whalegirl
```

产物：`dist-b/<version>/dafeiyu-pet-win64-<version>/` + `.zip` + `.sha256`（zip 不进 git）。

## 包含 / 排除

| 内容 | 处理 |
|---|---|
| `pet/*.py`、`icon.ico`、UI 图标 | 包含 |
| `pet/assets/webm_body`（index.html/clips.js/qwebchannel.js/assets/*.webm） | 构建时从 `tools/body-b/webm_pet` 注入（25.8MB，50 clip） |
| `pet/assets/body-b/placeholder.png` | 包含（B 静帧回退） |
| B LICENSE / NOTICE / PROVENANCE | 包含 |
| `assets/whale-girl`、`pet/sprites`、`custom_skins`、`skin_library` | **排除**（A 外观） |
| 50 段 WebM | **不入 git**；发布包注入 |

## 体积估算（onedir / zip）

- 实际候选构建（2026-10-26，`7168c54`）：onedir **658.5MB / 2205 files**（`大肥鱼桌宠.exe` 5.4MB），zip **263.9MB**；B 素材 25.8MB；
- 早前 300–380MB 估算偏低；PySide6/QtWebEngine 全量收集。后续可按需裁 Qt 模块 / UPX 对照优化。
- 构建产物不进 git（`release-build/` 忽略）；发布时上传 zip + `.sha256`。

## 许可

- `LICENSE-B.txt`：dsh-whale-girl-pet MIT（yanzwzz）
- `NOTICE-B.md`：署名 + AI/Vidu 来源 + 重编码说明
- `PROVENANCE-B.md`：素材 commit/路径/处理链

## 审计修正（P1/P2）

- **P1**：stage/build 显式排除 `pet/whale_skin.py`（A 皮肤代码），spec `excludes=['whale_skin', ...]`；打包后 stage 无 A 代码/素材。
- **P2**：`LICENSE-B.txt` / `NOTICE-B.md` / `placeholder.png` 已存入 git 内 `packaging/third-party-b/`（可复现）；50 段 WebM 仍不入 git（`.gitignore` 排除 `tools/body-b/`、`*.webm`），构建时从 `tools/body-b`/third-party 注入。
- 静帧重生成：`python packaging/make-b-placeholder.py --webm <待机呼吸休闲.webm> -o packaging/third-party-b/placeholder.png`。
