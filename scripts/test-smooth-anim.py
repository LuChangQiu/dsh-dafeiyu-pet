#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""动画平滑/编排纯逻辑单测（假时钟，无 Qt/DSH 依赖）。

运行：python scripts/test-smooth-anim.py
覆盖：淡化 alpha（80–150ms 夹取/ease/边界）、呼吸 4–6s ±0.3–0.6%、摇摆/浮动、
待机小动作调度（8–20s、冷却、池有效）、庆祝 3 阶段 1.5–3.0s、对话 kind→动作、DSH 映射不回归。
"""
import os
import random
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'pet'))

from smooth_anim import (  # noqa: E402
    CELEBRATION_TOTAL_MS,
    DSH_MAP,
    IDLE_ACTIONS,
    IDLE_LOOP_ACTIONS,
    IdleMicroScheduler,
    SmoothConfig,
    breath_scale,
    celebration_stages,
    dialog_action,
    fade_alpha,
    secondary_motion,
)

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


# ---------- 配置夹取 ----------
c = SmoothConfig({})
check('默认 enabled', c.enabled is True)
check('默认 crossfade=100ms', c.crossfade_ms == 100)
check('默认 actionFade=90ms', c.action_fade_ms == 90)
c2 = SmoothConfig({'whale': {'smooth': {'crossfadeMs': 10, 'actionFadeMs': 999, 'breathAmpPct': 9,
                                        'breathPeriodSec': 1, 'swayDeg': 5, 'floatPx': 99,
                                        'microMinSec': 50, 'microMaxSec': 60}}})
check('crossfade 夹取 10→80', c2.crossfade_ms == 80)
check('actionFade 夹取 999→150', c2.action_fade_ms == 150)
check('呼吸幅度夹取 9→0.6%', abs(c2.breath_amp_pct - 0.6) < 1e-9)
check('呼吸周期夹取 1→4s', abs(c2.breath_period_s - 4.0) < 1e-9)
check('摇摆夹取 5→0.6°', abs(c2.sway_deg - 0.6) < 1e-9)
check('浮动夹取 99→2.5px', abs(c2.float_px - 2.5) < 1e-9)
check('微动作间隔有界', c2.micro_min_s <= c2.micro_max_s)
c3 = SmoothConfig({'whale': {'smooth': {'enabled': False}}})
check('enabled=false 生效', c3.enabled is False)

# ---------- 淡化 alpha ----------
check('淡化 0ms → 0', fade_alpha(0, 100) == 0.0)
check('淡化 50ms 介于 0/1', 0.0 < fade_alpha(50, 100) < 1.0)
check('淡化 100ms → 1', fade_alpha(100, 100) == 1.0)
check('淡化负数/超界夹取', fade_alpha(-5, 100) == 0.0 and fade_alpha(500, 100) == 1.0)
check('淡化 disabled → 1', fade_alpha(10, 100, enabled=False) == 1.0)
check('淡化 dur=0 → 1', fade_alpha(10, 0) == 1.0)

# ---------- 次级运动 ----------
s0 = secondary_motion(0.0, c)
check('次级运动含 scale/sway/float', set(s0) == {'scale', 'sway_deg', 'float_px'})
check('呼吸幅度在 ±0.6% 内', abs(s0['scale'] - 1.0) <= 0.0061)
# 周期：两个相隔半个周期的采样应反向
s_a = breath_scale(c.breath_period_s / 4.0, c)
s_b = breath_scale(c.breath_period_s * 3.0 / 4.0, c)
check('呼吸 4–6s 周期反向', (s_a - 1.0) > 1e-6 and (s_b - 1.0) < -1e-6)
walk = secondary_motion(1.0, c, walking=True)
check('走路时不做额外摆动/浮动', walk['sway_deg'] == 0.0 and walk['float_px'] == 0.0)
off = secondary_motion(1.0, c3)
check('关闭时中性值', off == {'scale': 1.0, 'sway_deg': 0.0, 'float_px': 0.0})

# ---------- 待机小动作调度 ----------
rng = random.Random(42)
sch = IdleMicroScheduler(c, now=0.0, rng=rng)
check('初始未到点', sch.due(7.9) is False)
check('8–20s 内到点', sch.due(c.micro_min_s) is True or sch.due(c.micro_max_s) is True)
act = sch.pick(c.micro_max_s)
check('到点返回池内动作', act in IDLE_ACTIONS, str(act))
check('触发后重新排期（未到点）', sch.due(c.micro_max_s + 0.1) is False)
check('池包含换重心/伸懒腰/看左右/摆手/哼歌/轻跳',
      {'idleShift', 'idleStretch', 'turnStop', 'wave', 'hum'} <= set(IDLE_ACTIONS))
check('循环动作标记 hum', IDLE_LOOP_ACTIONS == {'hum'})

# ---------- 庆祝 ----------
st = celebration_stages()
check('庆祝 3 阶段', len(st) == 3, str([x['name'] for x in st]))
check('庆祝总时长 1.5–3.0s', 1500 <= CELEBRATION_TOTAL_MS <= 3000, str(CELEBRATION_TOTAL_MS))
check('庆祝顺序 jump→land→cheer', [x['action'] for x in st] == ['jump', 'land', 'cheer'])

# ---------- 对话映射 ----------
for kind in ('greet', 'report', 'remind', 'love', 'inner', 'error', 'night'):
    a = dialog_action(kind)
    check('对话 kind 有动作: %s' % kind, isinstance(a, str) and bool(a), a)

# ---------- DSH 映射不回归 ----------
check('tool→hum（不走路）', DSH_MAP['tool'] == 'hum')
check('thinking→think', DSH_MAP['thinking'] == 'think')
check('waiting→waitPeek', DSH_MAP['waiting_approval'] == 'waitPeek' and DSH_MAP['waiting_input'] == 'waitPeek')
check('error→errorSequence', DSH_MAP['error'] == 'errorSequence')
check('done→celebrate', DSH_MAP['done'] == 'celebrate')

print('\n%s smooth-anim: %d passed, %d failed' % ('PASS' if fail == 0 else 'FAIL', ok, fail))
sys.exit(0 if fail == 0 else 1)
