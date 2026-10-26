# B 第三方素材声明（reproducible from git / third-party）

本目录保存 B（MIT 鲸鱼娘）**不随 50 段 WebM 入库**的小文件，保证打包可复现：

| 文件 | 来源 | 说明 |
|---|---|---|
| `LICENSE-B.txt` | `tools/body-b/webm_pet/LICENSE`（dsh-whale-girl-pet MIT） | MIT 全文 |
| `NOTICE-B.md` | `tools/body-b/webm_pet/NOTICE.md` | 署名 yanzwzz、AI/Vidu 来源、重编码 |
| `placeholder.png` | `待机呼吸休闲.webm` 首帧（VP9 alpha） | B 静帧回退，168×198 合成 |

- 50 段 WebM（约 25.8MB）仍在 `tools/body-b/webm_pet/assets/`（不入 git，`.gitignore` 已排除），构建时由 `-BWeb`/`DSH_PET_B_WEB` 注入。
- 完整来源链见 `../PROVENANCE-B.md`。
- 重新生成静帧（需要 WebM 源）：`python packaging/make-b-placeholder.py --webm <待机呼吸休闲.webm> -o packaging/third-party-b/placeholder.png`
