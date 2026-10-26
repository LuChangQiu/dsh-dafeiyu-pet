# -*- mode: python ; coding: utf-8 -*-
"""B-only 桌宠发行 spec（PyInstaller onedir）。

由 packaging/build-b-only.ps1 在 stage 目录生成：
- stage/pet/*.py + icon.ico
- stage/pet/assets/icons（UI 图标）
- stage/pet/assets/webm_body（B 包：index.html/clips.js/qwebchannel.js/assets/*.webm，构建时注入）
- stage/pet/assets/body-b/placeholder.png（B 静帧回退）
- LICENSE-B.txt / NOTICE-B.md / PROVENANCE-B.md

不含：A 的 assets/whale-girl、sprites、custom_skins、skin_library。
"""
import os

import PySide6
import shiboken6
from PyInstaller.utils.hooks import collect_all

datas = [
    ('assets/icons', 'assets/icons'),
    ('assets/webm_body', 'assets/webm_body'),
    ('assets/body-b', 'assets/body-b'),
    ('LICENSE-B.txt', 'LICENSE-B.txt'),
    ('NOTICE-B.md', 'NOTICE-B.md'),
    ('PROVENANCE-B.md', 'PROVENANCE-B.md'),
]
binaries = []
hiddenimports = ['pet_window', 'pet_defaults']

# requests（余额/HTTP）与 winsdk（媒体会话歌词）与现有 spec 一致
for _pkg in ('requests', 'winsdk'):
    try:
        _r = collect_all(_pkg)
        datas += _r[0]
        binaries += _r[1]
        hiddenimports += _r[2]
    except Exception:
        pass

# PySide6 MSVC 运行库补齐（同桌宠.spec）
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
    ['pet_app.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['whale_skin', 'PySide6.QtQuick3D', 'PySide6.Qt3DCore', 'PySide6.Qt3DRender',
              'PySide6.QtCharts', 'PySide6.QtDataVisualization', 'PySide6.QtMultimediaWidgets'],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

# 与现有 spec 相同：剔掉和 Qt6Core 冲突的 ICU 78 复制品，使用 Windows 系统 ICU 72
_drop = ('icuuc.dll', 'icuin.dll', 'icuio.dll', 'icutu.dll', 'icuuc', 'icudt')
a.binaries = [b for b in a.binaries
              if not any(os.path.basename(b[0]).lower().startswith(p) for p in _drop)]

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
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
