# -*- mode: python ; coding: utf-8 -*-
import os

import PySide6
import shiboken6
from PyInstaller.utils.hooks import collect_all

# SPECPATH 由 PyInstaller 注入 = 本 spec 所在目录（<repo>/pet）；据此推算仓库根，
# 避免写死绝对路径。鲸鱼娘资产在仓库根 assets/whale-girl（不在 pet/assets），
# 必须显式加入 datas，否则发行版只有 classic 皮肤（P0：见 verify/RELEASE-BUILD-SMOKE.md）。
_REPO_ROOT = os.path.dirname(os.path.abspath(SPECPATH))
_WHALE_GIRL = os.path.join(_REPO_ROOT, 'assets', 'whale-girl')
if not os.path.isfile(os.path.join(_WHALE_GIRL, 'manifest.json')):
    raise SystemExit('missing whale-girl assets: ' + _WHALE_GIRL)

# 注意：PyInstaller onedir 的 datas 统一落进 _internal/，因此鲸鱼娘最终路径为
# <app>/_internal/assets/whale-girl/；构建脚本会校验该目录并在 zip 中校验单份资产。
datas = [('sprites', 'sprites'), ('assets', 'assets'), (_WHALE_GIRL, 'assets/whale-girl')]
binaries = []
hiddenimports = []
tmp_ret = collect_all('requests')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]

# winsdk：读 Windows 媒体会话（QQ音乐 / 网易云 放歌时的歌词联动）。
# 它带一批投影 DLL，必须一起收进去，否则打包版读不到"在放什么歌"。
try:
    _ws = collect_all('winsdk')
    datas += _ws[0]; binaries += _ws[1]; hiddenimports += _ws[2]
except Exception:
    pass

# PyInstaller 会漏收 PySide6 自带的部分 MSVC 运行库（尤其 msvcp140_codecvt_ids.dll），
# 缺了它们 Qt6Core.dll 会报 "DLL load failed ... 找不到指定的程序"。
for _pkg in (PySide6, shiboken6):
    _dir = os.path.dirname(_pkg.__file__)
    for _name in ('msvcp140.dll', 'msvcp140_1.dll', 'msvcp140_2.dll',
                  'msvcp140_codecvt_ids.dll', 'vcruntime140.dll', 'vcruntime140_1.dll',
                  'concrt140.dll', 'vcamp140.dll', 'vccorlib140.dll', 'vcomp140.dll'):
        _src = os.path.join(_dir, _name)
        if os.path.exists(_src):
            for _dest in ('.', 'PySide6', 'shiboken6'):
                binaries.append((_src, _dest))


a = Analysis(
    ['桌宠.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

# 关键修复：这台机器上 PyInstaller 会把 Codex 运行时里 ICU 78 的 icuuc.dll / icudt78.dll
# 也打进包，而 Qt6Core.dll 期望的是 Windows 自带那份 ICU 72，版本不匹配会报
# "DLL load failed while importing QtCore: 找不到指定的程序"。剔掉它们，让 Qt 用系统的。
_drop = ('icuuc.dll', 'icuin.dll', 'icuio.dll', 'icutu.dll', 'icuuc', 'icudt')
a.binaries = [b for b in a.binaries
              if not any(os.path.basename(b[0]).lower().startswith(p) for p in _drop)]

# 文件夹版（onedir）而不是单文件版（onefile）——2026-09-14 改的。
# 单文件版每次启动都要先把 100 多 MB 解压到 %TEMP% 再起来，"点了要等一会儿"
# 主要就是它；文件夹版直接读旁边的文件，启动快得多。发出去的是安装包，
# 安装包把整个文件夹装进去，用户那边看不出区别。
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,        # 依赖不进 exe，交给下面的 COLLECT 放到同一个文件夹
    name='大肥鱼桌宠',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=['icon.ico'],
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='大肥鱼桌宠',
)
