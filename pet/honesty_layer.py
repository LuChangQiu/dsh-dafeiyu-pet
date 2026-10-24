#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""P0-1 状态诚实化（pet 侧，纯逻辑，无 Qt 依赖）。

只作用于"表现层"，不改既有动作优先级：
- 卡住：busy/thinking 状态超过 `stuckAfterSec`（默认 25s）没有新 state 事件 → 停止走路/装忙，
  改为发愣（think 帧）+ 慢眨眼；不显示"正在努力"类文案。
- 失败：state:error 不庆祝；一句短承认（第一次），连续第二次失败才委屈（cry）。
- 等待：waiting_approval / waiting_input 保留现有 waitPeek/S0 规则，waiting_input 补一句短"等你"。

配置（config.json -> honesty）：
{
  "enabled": true,                 # 总开关（false = 完全恢复原表现）
  "stuckAfterSec": 25,             # busy 状态多久无新事件算"卡住"
  "stuckBlinkEverySec": 2.6,       # 卡住时慢眨眼间隔
  "stuckBlinkSec": 0.26,           # 单次慢眨眼长度
  "secondFailureCryDelaySec": 1.2, # 二次失败后多久委屈
  "errorLines": ["这次没成……", "又没成……"],
  "waitingInputLine": "我在等你～"
}
"""

DEFAULT_CONFIG = {
    'enabled': True,
    'stuckAfterSec': 25.0,
    'stuckBlinkEverySec': 2.6,
    'stuckBlinkSec': 0.26,
    'secondFailureCryDelaySec': 1.2,
    'errorLines': ['这次没成……', '又没成……'],
    'waitingInputLine': '我在等你～',
}

BUSY_STATES = ('thinking', 'tool')
S0_STATES = ('approval', 'waiting_approval', 'waiting_input')


def clamp(v, lo, hi):
    return lo if v < lo else (hi if v > hi else v)


def _merge(base, override):
    out = dict(base)
    for k, v in (override or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = v
    return out


class HonestyConfig:
    def __init__(self, cfg=None):
        raw = {}
        if isinstance(cfg, dict):
            h = cfg.get('honesty')
            if isinstance(h, dict):
                raw = h
        merged = _merge(DEFAULT_CONFIG, raw)
        self.raw = merged
        self.enabled = bool(merged.get('enabled', True))
        try:
            self.stuck_after_s = clamp(float(merged.get('stuckAfterSec', 25)), 5.0, 600.0)
        except (TypeError, ValueError):
            self.stuck_after_s = 25.0
        try:
            self.blink_every_s = clamp(float(merged.get('stuckBlinkEverySec', 2.6)), 0.8, 10.0)
        except (TypeError, ValueError):
            self.blink_every_s = 2.6
        try:
            self.blink_s = clamp(float(merged.get('stuckBlinkSec', 0.26)), 0.1, 1.0)
        except (TypeError, ValueError):
            self.blink_s = 0.26
        try:
            self.cry_delay_s = clamp(float(merged.get('secondFailureCryDelaySec', 1.2)), 0.2, 5.0)
        except (TypeError, ValueError):
            self.cry_delay_s = 1.2
        lines = merged.get('errorLines')
        if not (isinstance(lines, list) and lines):
            lines = list(DEFAULT_CONFIG['errorLines'])
        self.error_lines = [str(x) for x in lines[:2]]
        while len(self.error_lines) < 2:
            self.error_lines.append(DEFAULT_CONFIG['errorLines'][len(self.error_lines)])
        self.waiting_input_line = str(merged.get('waitingInputLine') or DEFAULT_CONFIG['waitingInputLine'])


class StateHonesty:
    """记录 state 事件时间线，给出卡住/失败/等待的表现决策（fake clock 可测）。"""

    def __init__(self, cfg=None):
        self.config = HonestyConfig(cfg)
        self.state = ''
        self.last_event_at = 0.0
        self.stuck_active = False
        self.stuck_since = 0.0
        self.last_blink_at = 0.0
        self.error_streak = 0
        self.cry_at = 0.0

    # ---------- state 事件 ----------
    def note_state(self, name, now):
        """收到新的 state 事件：重置卡住计时器；返回变化信息供调用方清 force。"""
        prev = self.state
        name = str(name or '')
        self.state = name
        self.last_event_at = now
        was_stuck = self.stuck_active
        self.stuck_active = False
        self.last_blink_at = 0.0
        if name == 'error':
            self.error_streak += 1
        else:
            self.error_streak = 0
        return {'prev': prev, 'was_stuck': was_stuck, 'error_streak': self.error_streak}

    def is_busy(self):
        return self.state in BUSY_STATES

    # ---------- 卡住 ----------
    def stuck_due(self, now):
        """busy/thinking 超过 stuckAfterSec 无新事件 → 首次进入卡住表现。"""
        if not self.config.enabled or not self.is_busy():
            return False
        if self.stuck_active:
            return False
        if now - self.last_event_at < self.config.stuck_after_s:
            return False
        self.stuck_active = True
        self.stuck_since = now
        self.last_blink_at = now      # 从卡住起点算第一次慢眨间隔
        return True

    def stuck_blink_due(self, now):
        """卡住期间的慢眨眼节拍（返回 True 表示调用方应触发一次慢眨）。"""
        if not self.stuck_active:
            return False
        if now - self.last_blink_at < self.config.blink_every_s:
            return False
        self.last_blink_at = now
        return True

    # ---------- 失败 ----------
    def error_line(self):
        """第一次失败 → 短承认；连续第二次失败 → 更委屈的短句。"""
        if self.error_streak >= 2:
            return self.config.error_lines[1]
        return self.config.error_lines[0]

    def error_should_cry(self):
        return self.error_streak >= 2

    def schedule_cry(self, now):
        if self.error_streak < 2:
            return 0.0
        self.cry_at = now + self.config.cry_delay_s
        return self.cry_at

    def take_cry_due(self, now):
        if not self.cry_at or now < self.cry_at:
            return False
        self.cry_at = 0.0
        return True

    # ---------- 等待 ----------
    def waiting_line(self):
        if not self.config.enabled:
            return ''
        if self.state == 'waiting_input':
            return self.config.waiting_input_line
        return ''

    def is_s0(self):
        return self.state in S0_STATES
