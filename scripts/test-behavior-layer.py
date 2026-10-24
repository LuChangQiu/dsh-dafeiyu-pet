#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""P0-2 行为层单测（假时钟，不依赖 Qt/DSH）。

运行：python scripts/test-behavior-layer.py
覆盖：
1. 反应延迟：普通 150–300ms；S0 80–150ms；多源取 max；到点/未到点；
2. 打断恢复：200ms 到点；期间无新动作→清理；有新动作→不误清；可取消；
3. 走神：disabled/gag/未 idle → 不触发；idle 足够 + 命中概率 → 触发且冷却 ≥300s；
   roll window 防每帧连抽；冷却期内不再触发。
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'pet'))

from behavior_layer import (  # noqa: E402
    BehaviorConfig,
    IdleSkit,
    InterruptRecovery,
    ReactionScheduler,
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


def fake_rng(v):
    return lambda: v


# ---------- 配置 ----------
cfg = BehaviorConfig({})
check('默认配置：普通延迟目标 220ms', cfg.reaction_delay_ms == 220)
check('默认配置：S0 延迟目标 115ms', cfg.s0_reaction_delay_ms == 115)
check('默认配置：打断恢复 200ms', cfg.interrupt_recover_ms == 200)
check('默认配置：走神 60s/0.2/300s', cfg.skit_idle_s == 60 and cfg.skit_chance == 0.2 and cfg.skit_cooldown_s == 300)

cfg2 = BehaviorConfig({'behavior': {'reactionDelayMs': 999, 's0ReactionDelayMs': 10,
                                    'idleSkit': {'enabled': False, 'chance': 2.0}}})
check('配置夹取：reaction 999→300', cfg2.reaction_delay_ms == 300)
check('配置夹取：s0 10→80', cfg2.s0_reaction_delay_ms == 80)
check('配置夹取：chance 2.0→1.0', cfg2.skit_chance == 1.0)
check('配置：idleSkit.enabled=false 生效', cfg2.skit_enabled is False)
lo, hi = cfg2.delay_range_ms('thinking')
check('普通延迟范围 150–300', 150 <= lo <= hi <= 300, '%d–%d' % (lo, hi))
lo0, hi0 = cfg2.delay_range_ms('approval')
check('S0 延迟范围 80–150', 80 <= lo0 <= hi0 <= 150, '%d–%d' % (lo0, hi0))

# ---------- 反应延迟 ----------
s = ReactionScheduler(BehaviorConfig({}))
p = s.schedule('think', 'thinking', now=100.0, rng=fake_rng(0.5))
delay = p['delayMs']
check('反应延迟落在 150–300', 150 <= delay <= 300, '%dms' % delay)
check('未到点不生效', s.take_due(100.0 + delay / 1000.0 - 0.01) is None)
check('到点生效并返回动作', s.take_due(100.0 + delay / 1000.0 + 0.001)['name'] == 'think')

s = ReactionScheduler(BehaviorConfig({}))
p0 = s.schedule('waitPeek', 'approval', now=200.0, rng=fake_rng(0.5))
check('S0 延迟落在 80–150', 80 <= p0['delayMs'] <= 150, '%dms' % p0['delayMs'])

# 多源取 max：窗口内再次触发，due 不早于前一次
s = ReactionScheduler(BehaviorConfig({}))
a = s.schedule('think', 'thinking', now=300.0, rng=fake_rng(1.0))
b = s.schedule('walk', 'tool', now=300.02, rng=fake_rng(0.0))
check('多源取 max（due 不早于前次）', b['due'] >= a['due'], 'a=%.3f b=%.3f' % (a['due'], b['due']))
check('多源计数 sources=2', b['sources'] == 2)

# ---------- 打断恢复 ----------
r = InterruptRecovery(BehaviorConfig({}))
r.interrupt(now=10.0, current_force='think')
check('200ms 内未到点', r.take_due(10.19, current_force='think') is False)
check('200ms 到点清理', r.take_due(10.201, current_force='think') is True)
r.interrupt(now=20.0, current_force='think')
check('期间有新动作则不误清', r.take_due(20.3, current_force='walk') is False)
r.interrupt(now=30.0, current_force=None)
check('打断时无 force→可取消', r.cancel() is None and r.take_due(30.5, current_force=None) is False)

# ---------- 走神 ----------
cfg_skit = BehaviorConfig({'behavior': {'idleSkit': {'idleSec': 60, 'chance': 0.2, 'cooldownSec': 300, 'rollWindowSec': 60}}})
idle = IdleSkit(cfg_skit)
check('走神 disabled 时不触发', IdleSkit(cfg2).should_fire(1000.0, True, rng=fake_rng(0.0)) is False)
check('未 idle 不触发', idle.should_fire(70.0, False, rng=fake_rng(0.0)) is False)
# 第一次评估：未命中 → 进入 roll window
check('概率未命中不触发', idle.should_fire(70.0, True, rng=fake_rng(0.5)) is False)
# roll window 内不重复抽
check('roll window 内不重复抽', idle.should_fire(70.5, True, rng=fake_rng(0.0)) is False)
check('roll window 后可再抽且命中', idle.should_fire(131.0, True, rng=fake_rng(0.1)) is True)
check('触发后进入 300s 冷却', idle.should_fire(200.0, True, rng=fake_rng(0.0)) is False)
check('冷却结束后可再触发', idle.should_fire(440.0, True, rng=fake_rng(0.0)) is True)

print('\n%s behavior-layer: %d passed, %d failed' % ('PASS' if fail == 0 else 'FAIL', ok, fail))
sys.exit(0 if fail == 0 else 1)
