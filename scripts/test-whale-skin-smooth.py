#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""whale_skin 渲染平滑运行时断言（Qt offscreen，无窗口）。

运行：$env:QT_QPA_PLATFORM='offscreen'; python scripts/test-whale-skin-smooth.py
覆盖 Lead 定位的三条：
1) 同一 clip 内换帧 **不产生淡化**（tick 不 fade）；
2) 方向/镜像 crossfade 可用 pixmap_raw（原始帧）取图，避免与动作淡化叠加；
3) play() 动作切换才有单层 dissolve 淡化（pixmap 可合成，alpha 在 0..1）。
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'pet'))
os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')

ok = 0
fail = 0


def check(name, cond, detail=''):
    global ok, fail
    if cond:
        ok += 1
        print('PASS %s%s' % (name, (' · ' + detail) if detail else ''))
    else:
        fail += 1
        print('FAIL %s%s' % (name, (' · ' + detail) if detail else ''))


from PySide6.QtGui import QGuiApplication  # noqa: E402

app = QGuiApplication.instance() or QGuiApplication([])

import whale_skin  # noqa: E402

assets = os.path.join(ROOT, 'assets', 'whale-girl')
skin = whale_skin.WhaleGirlSkin(assets)
check('鲸鱼娘资产加载', skin.ok, skin.err)

skin.set_smooth({'enabled': True, 'crossfadeMs': 120, 'actionFadeMs': 120})
skin.play('idleBase')
check('初始无淡化', skin.fade_alpha() is None)
p0 = skin.pixmap(184)
check('初始帧可绘制', p0 is not None and not p0.isNull())
check('初始帧可绘制（raw）', skin.pixmap_raw(184) is not None)
# 同一 clip 内推进多帧（idleBase 2 帧 × 1100ms）：不能产生淡化
faded_in_clip = False
for _ in range(3):
    skin.tick(1100)
    if skin.fade_alpha() is not None:
        faded_in_clip = True
check('同 clip 内换帧不产生淡化（tick 无 fade）', faded_in_clip is False)
# 动作切换：产生淡化；淡化期间 pixmap 合成不报错
skin.play('wave')
a = skin.fade_alpha()
check('play 切动作产生淡化', a is not None and 0.0 <= a < 1.0, 'alpha=%s' % a)
check('淡化期 pixmap 可合成', skin.pixmap(184) is not None)
# 前进超过淡化时长后结束
skin.tick(200)
check('淡化结束后回到单层', skin.fade_alpha() is None)
# 同 clip 重播不淡化（restart 但同 clip）
skin.play('wave', restart=True)
check('同 clip 重播不淡化', skin.fade_alpha() is None)
# 动作切换分档（drag/fall 为方向类、不报错）
skin.play('drag')
check('方向类动作淡化在 80–150ms 区间', skin.fade_ms >= 80.0 and skin.fade_ms <= 150.0, 'fadeMs=%s' % skin.fade_ms)

# 白名单门禁：sleep/fall 等硬切不产生淡化
skin.play('idleBase')
skin.tick(1100)
skin.play('sleep')
check('sleep 硬切（无淡化）', skin.fade_alpha() is None)
skin.play('idleBase')
skin.tick(1100)
skin.play('walk')
check('idle→walk 允许淡化', skin.fade_alpha() is not None or skin.fade_ms == 0)
skin.set_smooth({'enabled': True, 'crossfadeMs': 0, 'actionFadeMs': 120})
skin.play('idleBase')
check('crossfadeMs=0 全硬切', skin.fade_alpha() is None)
skin.set_smooth({'enabled': True, 'crossfadeMs': 120, 'actionFadeMs': 120})

print('\n%s whale-skin-smooth: %d passed, %d failed' % ('PASS' if fail == 0 else 'FAIL', ok, fail))
sys.exit(0 if fail == 0 else 1)
