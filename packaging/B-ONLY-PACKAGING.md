# B-only 发行打包（repo 内可复现）

本目录用于 B（MIT 鲸鱼娘 WebM）单身体发行包：**只带 B，不带 A 外观/素材**。
B 的 50 段 WebM 不入 git；构建前从 `tools/body-b/webm_pet`、third-party 或本机 pet-work 注入（或用 `scripts/fetch-b-assets.ps1`）。

## 用法

```powershell
# 1) B 素材注入（可选；Build 时也能直接用 -BWeb 指向源目录）
powershell -File scripts\fetch-b-assets.ps1 -Source <webm_pet>
# 2) dry-run：列清单/校验根级文件，不打包
powershell -File packaging\build-b-only.ps1 -BWeb <webm_pet>
# 3) 真正打包（等 B PASS/Lead 批准）
powershell -File packaging\build-b-only.ps1 -Build -BWeb <webm_pet>
# 也可从根入口：scripts\pet-build-release.ps1
```

产物：`release-build/b-only/dafeiyu-pet-win64-<version>-<git短sha>/` + `.zip` + `.zip.sha256`。
zip 由 `packaging/make_utf8_zip.py` 生成：所有非 ASCII 文件名为 UTF-8 flag，Windows 资源管理器解压中文正确；构建后 helper 会校验根文件、50 webm、UTF-8 flag。

## 包含 / 排除

| 内容 | 处理 |
|---|---|
| `pet/*.py`、`icon.ico`、`assets/icons` | 包含 |
| `pet/assets/webm_body`（HTML/JS + 50 WebM） | 构建时注入（`-BWeb`/`DSH_PET_B_WEB`/tools/third-party） |
| `pet/assets/body-b/placeholder.png` | 包含（B 静帧回退） |
| `LICENSE`（MIT）、`NOTICE`、`LICENSE-B.txt`、`NOTICE-B.md`、`PROVENANCE-B.md` | 复制到 zip 根 |
| `README.md`、`INSTALL.md`、`scripts/selfcheck.ps1` | 复制到 zip 根（解压即自检） |
| `assets/whale-girl`、`pet/sprites`、`custom_skins`、`skin_library` | **排除**（A 外观） |
| 50 段 WebM | 不入 git；发布包注入 |

## 体积

实测（2026-10-26 候选）：onedir 约 658.5MB / zip 约 264MB（PySide6+QtWebEngine 全量；B 素材 25.8MB）。B 单独交付可接受；后续可按需裁 Qt 模块/UPX 优化。

## 许可

- `LICENSE-B.txt`：dsh-whale-girl-pet MIT（yanzwzz）
- `NOTICE-B.md`：署名 + AI/Vidu 来源 + 重编码
- `PROVENANCE-B.md`：素材路径/处理链/静帧来源
