# -*- coding: utf-8 -*-
"""pet_app —— 大肥鱼桌宠薄入口。

真正的实现（PetWindow 与全部现有逻辑）在 pet_window.py；本文件只保留
启动/单实例生命周期，保证 PyInstaller 入口与旧启动脚本可平滑切换。
"""
from __future__ import annotations

# ruff: noqa: E402, I001

import os
import sys

# 直接运行 ``python pet/pet_app.py`` 时确保同目录模块（pet_window 等）可导入；
# PyInstaller 打包后 sys.frozen 分支不依赖此路径。
_here = os.path.dirname(os.path.abspath(__file__))
if _here not in sys.path:
    sys.path.insert(0, _here)

from pet_window import main  # noqa: E402  (必须在 sys.path 调整之后)


if __name__ == "__main__":
    raise SystemExit(main())
