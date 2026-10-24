# INSTALL-STRATEGY（安装可交付优先）

- 默认交付：PyInstaller onedir zip（`pet/pet.spec` + `scripts/build-release.ps1`，版本号+sha256）；源码模式仅开发。
- 自检项（面板一键自检/修复）：①profile 插件完整性（node_modules 被 pnpm 清掉）②`pet-work/.venv` 与依赖 ③schtasks `DafeiyuPetStart` ④patch 块数/id 唯一 ⑤pipe 可达 ⑥版本一致性（version/petVersion/zip）。
- 一键修复：重装插件/重建 venv/重注册 schtasks/幂等重写 patch 两块（保留 ui 块）；不覆盖 config/memory；失败不阻塞 DSH；返回 `{healthy,issues[],repaired[],needRestart}`。
- 版本/回滚：Release 资产优先、本地 zip 兜底；保留旧包+旧 patch 备份；不自动删旧包；state.json 上报版本。
- 分发口径：内部/朋友分发 zip；不含 LOCAL ONLY 资产（个人素材/测试数据/绝对路径配置）、不打包 state/ui-config/memory/logs。
- 验收：临时目录全新安装→启动→pipe→home 401/正常；卸载→host 存活→无残留 bridge 块。
