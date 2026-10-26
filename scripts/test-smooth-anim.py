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
    HARD_CUT_ACTIONS,
    IDLE_ACTIONS,
    IDLE_LOOP_ACTIONS,
    LOCOMOTION_ACTIONS,
    IdleMicroScheduler,
    SmoothConfig,
    action_fade_layers,
    breath_scale,
    celebration_mode,
    celebration_stages,
    dialog_action,
    direction_crossfade_uses_raw,
    fade_alpha,
    frame_change_fades,
    secondary_motion,
    should_crossfade,
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
check('默认 crossfade=120ms', c.crossfade_ms == 120)
check('默认 actionFade=120ms', c.action_fade_ms == 120)
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
check('池包含换重心/伸懒腰/看左右/哼歌/摸鱼/吃小鱼干/打哈欠',
      {'idleShift', 'idleStretch', 'turnStop', 'hum', 'lonelySit', 'eatSatisfied', 'sleep'} <= set(IDLE_ACTIONS))
check('池不再包含轻跳（蹦蹦蹦）', 'jump' not in IDLE_ACTIONS)
check('默认微动作间隔 8–15s', c.micro_min_s == 8.0 and c.micro_max_s == 15.0)
check('循环动作标记 hum', IDLE_LOOP_ACTIONS == {'hum'})
rng2 = random.Random(7)
sch2 = IdleMicroScheduler(c, now=0.0, rng=rng2)
a1 = sch2.pick(20.0)
a2 = sch2.pick(40.0)
check('同类不连续（两次抽样不同）', a1 != a2, a1 + '/' + a2)

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

# ---------- 闪烁修复：同 clip 不淡化 / 动作切换单层 dissolve / 方向 crossfade 用原始帧 ----------
check('同 clip 换帧不淡化', frame_change_fades('idleBase', 'idleBase') is False)
check('不同 clip 切换才淡化', frame_change_fades('idleBase', 'wave') is True)
check('首次播放不淡化', frame_change_fades('', 'idleBase') is False)
layers = action_fade_layers(0.5)
check('动作切换合成是单层 alpha（prev 满不透明）', len(layers) == 2 and layers[0] == ('prev', 1.0) and layers[1] == ('cur', 0.5))
check('合成 alpha 夹取', action_fade_layers(2.0)[1] == ('cur', 1.0) and action_fade_layers(-1)[1] == ('cur', 0.0))
check('方向 crossfade 使用原始帧', direction_crossfade_uses_raw(True) is True)

# ---------- 淡化白名单（char-scout 最终口径：仅 locomotion 之间淡化） ----------
check('idle* 之间允许淡化', should_crossfade('idleBase', 'idleShift') is True)
check('idle->walk 允许淡化', should_crossfade('idleBase', 'walk') is True)
check('walk->idle 允许淡化', should_crossfade('walk', 'idleBase') is True)
check('idle->turnStop 允许淡化', should_crossfade('idleSettle', 'turnStop') is True)
check('walk<->turnStop 允许淡化', should_crossfade('walk', 'turnStop') is True and should_crossfade('turnStop', 'walk') is True)
check('同 clip 不淡化', should_crossfade('walk', 'walk') is False)
check('walk 帧间换帧不淡化', frame_change_fades('walk', 'walk') is False)
check('jump->land 硬切', should_crossfade('jump', 'land') is False)
check('eat->idle 硬切', should_crossfade('eat', 'idleBase') is False)
check('report->idle 硬切', should_crossfade('report', 'idleBase') is False)
check('sneak->caught 硬切', should_crossfade('sneak', 'caught') is False)
check('drag->idle 硬切', should_crossfade('drag', 'idleBase') is False)
check('fall->idle 硬切', should_crossfade('fall', 'idleBase') is False)
check('sleep->idle 硬切', should_crossfade('sleep', 'idleBase') is False)
check('think 等 composites 硬切', should_crossfade('idleBase', 'think') is False)
check('enabled=false 全硬切', should_crossfade('idleBase', 'walk', enabled=False) is False)
check('白名单/硬切集合存在', 'idleBase' in LOCOMOTION_ACTIONS and 'sleep' in HARD_CUT_ACTIONS)
c0 = SmoothConfig({'whale': {'smooth': {'crossfadeMs': 0}}})
check('crossfadeMs=0 保留为全硬切', c0.crossfade_ms == 0)
cdis = SmoothConfig({'whale': {'smooth': {'enabled': False}}})
check('enabled=false 配置生效', cdis.enabled is False)

# ---------- done 庆祝门控（用户反馈：不再蹦蹦蹦） ----------
check('短任务 done 只短反应', celebration_mode(1000.0, task_started_at=990.0) == 'short')
check('手动 done（无任务起点）只短反应', celebration_mode(1000.0, task_started_at=0.0) == 'short')
check('长回合且无冷却 → 全链庆祝', celebration_mode(1000.0, task_started_at=900.0) == 'full')
check('冷却期内 done 不庆祝', celebration_mode(1000.0, task_started_at=900.0, cd_until=1100.0) == 'short')
check('冷却已过可再庆祝', celebration_mode(1200.0, task_started_at=1100.0, cd_until=1100.0) == 'full')

print('\n%s smooth-anim: %d passed, %d failed' % ('PASS' if fail == 0 else 'FAIL', ok, fail))
sys.exit(0 if fail == 0 else 1)
