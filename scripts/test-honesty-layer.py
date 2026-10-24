#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""P0-1 状态诚实化单测（假时钟，不依赖 Qt/DSH）。

运行：python scripts/test-honesty-layer.py
覆盖：卡住 25s 门禁/同 thinking 持续/新事件重置/disabled；慢眨眼节拍；
失败第一次短承认/连续第二次委屈+延迟 cry/成功重置；等待短句与 S0 标记；配置夹取。
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'pet'))

from honesty_layer import HonestyConfig, StateHonesty  # noqa: E402

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


# ---------- 配置 ----------
cfg = HonestyConfig({})
check('默认 enabled=true', cfg.enabled is True)
check('默认 stuckAfter=25s', cfg.stuck_after_s == 25.0)
check('默认慢眨 2.6s/0.26s', cfg.blink_every_s == 2.6 and cfg.blink_s == 0.26)
check('默认错误短句两条', len(cfg.error_lines) == 2 and '没成' in cfg.error_lines[0])
cfg2 = HonestyConfig({'honesty': {'stuckAfterSec': 1, 'stuckBlinkEverySec': 99, 'errorLines': []}})
check('配置夹取 stuckAfter 1→5', cfg2.stuck_after_s == 5.0)
check('配置夹取 blinkEvery 99→10', cfg2.blink_every_s == 10.0)
check('errorLines 空→回退默认', len(cfg2.error_lines) == 2)
cfg3 = HonestyConfig({'honesty': {'enabled': False}})
check('enabled=false 生效', cfg3.enabled is False)

# ---------- 卡住 ----------
h = StateHonesty({})
r = h.note_state('thinking', now=0.0)
check('thinking 事件后处于 busy', h.is_busy() and r['error_streak'] == 0)
check('未到 25s 不算卡住', h.stuck_due(24.9) is False)
check('25s 到点卡住', h.stuck_due(25.1) is True)
check('已卡住不重复进入', h.stuck_due(30.0) is False)
check('慢眨未到间隔不触发', h.stuck_blink_due(25.2) is False)
check('慢眨到间隔触发', h.stuck_blink_due(25.1 + 2.6) is True)
# 新 state 事件重置
r = h.note_state('tool', now=40.0)
check('新事件退出卡住', r['was_stuck'] is True and h.stuck_active is False)
check('新事件重置 25s 计时', h.stuck_due(64.9) is False and h.stuck_due(65.1) is True)
# 非 busy 状态永不卡住
h2 = StateHonesty({})
h2.note_state('idle', now=0.0)
check('idle 不进入卡住', h2.stuck_due(100.0) is False)
# disabled
h3 = StateHonesty({'honesty': {'enabled': False}})
h3.note_state('thinking', now=0.0)
check('honesty.enabled=false 不卡住', h3.stuck_due(100.0) is False and h3.stuck_blink_due(100.0) is False)

# ---------- 失败 ----------
e = StateHonesty({})
e.note_state('error', now=0.0)
check('第一次失败：短承认', e.error_line() == e.config.error_lines[0])
check('第一次失败：不委屈', e.error_should_cry() is False and e.schedule_cry(0.0) == 0.0)
e.note_state('error', now=10.0)
check('连续第二次失败：委屈短句', e.error_line() == e.config.error_lines[1])
check('连续第二次失败：安排 cry', e.error_should_cry() is True and e.schedule_cry(10.0) == 11.2)
check('cry 未到点不触发', e.take_cry_due(11.1) is False)
check('cry 到点触发', e.take_cry_due(11.3) is True)
check('cry 只触发一次', e.take_cry_due(12.0) is False)
e.note_state('done', now=20.0)
check('成功后 error_streak 重置', e.error_streak == 0 and e.error_line() == e.config.error_lines[0])
e.note_state('error', now=30.0)
check('重置后的失败算第一次', e.error_should_cry() is False)

# ---------- 等待 ----------
w = StateHonesty({})
w.note_state('waiting_approval', now=0.0)
check('waiting_approval 是 S0', w.is_s0() is True)
check('approval 不补 waiting_input 短句', w.waiting_line() == '')
w.note_state('waiting_input', now=1.0)
check('waiting_input 短句存在', w.waiting_line() == w.config.waiting_input_line)
w3 = StateHonesty({'honesty': {'enabled': False}})
w3.note_state('waiting_input', now=0.0)
check('disabled 时不补等待短句', w3.waiting_line() == '')
check('waiting_input 不会进入卡住', StateHonesty({}).stuck_due(100.0) is False)

# ---------- P1：error×2 后成功 → 取消 pending cry ----------
pc = StateHonesty({})
pc.note_state('error', now=0.0)
pc.note_state('error', now=1.0)
pc.schedule_cry(1.0)
check('P1: error×2 已安排 cry', pc.take_cry_due(99.0) is True)  # 先消费掉一次，下面重新安排
pc.note_state('error', now=10.0)
pc.note_state('error', now=11.0)
pc.schedule_cry(11.0)
pc.note_state('done', now=11.2)
check('P1: done 后 take_cry_due 不再触发', pc.take_cry_due(12.5) is False)
check('P1: done 后 streak 重置（只算首次承认）', pc.error_streak == 0 and pc.error_line() == pc.config.error_lines[0])
pc.note_state('error', now=20.0)
check('P1: done 后再 error 只算首次', pc.error_should_cry() is False and pc.error_line() == pc.config.error_lines[0])

# ---------- P2：卡住边界（严格 >25s）与"同 thinking 反复事件不被误判" ----------
bd = StateHonesty({})
bd.note_state('thinking', now=0.0)
check('P2: 恰好 25.0s 不判卡住', bd.stuck_due(25.0) is False)
check('P2: 25.001s 判卡住', bd.stuck_due(25.001) is True)
bd2 = StateHonesty({})
bd2.note_state('thinking', now=0.0)
for i in range(1, 6):
    bd2.note_state('thinking', now=i * 20.0)   # 周期心跳/重复事件
check('P2: 重复 thinking 事件持续刷新，不误判卡住', bd2.stuck_due(99.0) is False)
bd3 = StateHonesty({})
bd3.note_state('tool', now=0.0)
check('P2: tool 状态同样按最后事件起算', bd3.stuck_due(25.001) is True)


print('\n%s honesty-layer: %d passed, %d failed' % ('PASS' if fail == 0 else 'FAIL', ok, fail))
sys.exit(0 if fail == 0 else 1)
