#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""P0-2 行为层：反应延迟 / 打断恢复 / 走神（纯逻辑，无 Qt 依赖，便于假时钟单测）。

由 pet/桌宠.py 使用：
- ReactionScheduler：state 驱动动作先排期（150–300ms；S0 approval/waiting_input 80–150ms），
  多源取 max（同一窗口内多次状态触发不会越排越早），tick 到点后再生效，不阻塞主线程。
- InterruptRecovery：点击/拖拽/状态切换 → 200ms 内回到姿势锚点；只清理"打断时还在播"的动作，
  若期间已有新动作生效则不误清。
- IdleSkit：连续 idle ≥ idleSec、非深夜/静音/全屏、无 pending/force/物理/拖拽时，
  低概率（默认 0.2）插一次走神表演；冷却 ≥ cooldownSec（默认 300s）。

配置（config.json -> behavior）：
{
  "reactionDelayMs": 220,          # 普通状态动作的目标延迟（150–300 内抖动）
  "s0ReactionDelayMs": 115,        # S0 approval/waiting_input（80–150 内抖动）
  "interruptRecoverMs": 200,
  "idleSkit": {"enabled": true, "idleSec": 60, "chance": 0.2,
               "cooldownSec": 300, "rollWindowSec": 60, "holdMs": 2600}
}
"""

DEFAULT_CONFIG = {
    'reactionDelayMs': 220,
    's0ReactionDelayMs': 115,
    'interruptRecoverMs': 200,
    'idleSkit': {
        'enabled': True,
        'idleSec': 60,
        'chance': 0.2,
        'cooldownSec': 300,
        'rollWindowSec': 60,
        'holdMs': 2600,
    },
}

S0_STATES = ('approval', 'waiting_approval', 'waiting_input')


def clamp(v, lo, hi):
    return lo if v < lo else (hi if v > hi else v)


def _merge_dict(base, override):
    out = dict(base)
    for k, v in (override or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge_dict(out[k], v)
        else:
            out[k] = v
    return out


class BehaviorConfig:
    """解析 behavior.* 配置（缺省/老配置自动补默认）。"""

    def __init__(self, cfg=None):
        behavior = {}
        if isinstance(cfg, dict):
            b = cfg.get('behavior')
            if isinstance(b, dict):
                behavior = b
        merged = _merge_dict(DEFAULT_CONFIG, behavior)
        self.raw = merged
        try:
            self.reaction_delay_ms = clamp(int(merged.get('reactionDelayMs', 220)), 150, 300)
        except (TypeError, ValueError):
            self.reaction_delay_ms = 220
        try:
            self.s0_reaction_delay_ms = clamp(int(merged.get('s0ReactionDelayMs', 115)), 80, 150)
        except (TypeError, ValueError):
            self.s0_reaction_delay_ms = 115
        try:
            self.interrupt_recover_ms = clamp(int(merged.get('interruptRecoverMs', 200)), 50, 1000)
        except (TypeError, ValueError):
            self.interrupt_recover_ms = 200
        skit = merged.get('idleSkit') if isinstance(merged.get('idleSkit'), dict) else {}
        self.skit_enabled = bool(skit.get('enabled', True))
        try:
            self.skit_idle_s = max(5.0, float(skit.get('idleSec', 60) or 60))
        except (TypeError, ValueError):
            self.skit_idle_s = 60.0
        try:
            self.skit_chance = clamp(float(skit.get('chance', 0.2)), 0.0, 1.0)
        except (TypeError, ValueError):
            self.skit_chance = 0.2
        try:
            self.skit_cooldown_s = max(30.0, float(skit.get('cooldownSec', 300) or 300))
        except (TypeError, ValueError):
            self.skit_cooldown_s = 300.0
        try:
            self.skit_roll_window_s = max(5.0, float(skit.get('rollWindowSec', 60) or 60))
        except (TypeError, ValueError):
            self.skit_roll_window_s = 60.0
        try:
            self.skit_hold_s = max(0.5, float(skit.get('holdMs', 2600) or 2600) / 1000.0)
        except (TypeError, ValueError):
            self.skit_hold_s = 2.6

    def delay_range_ms(self, state_kind):
        """返回 (lo, hi) 毫秒；S0 用 80–150，其它用配置目标 ±40 并夹在 150–300。"""
        if state_kind in S0_STATES:
            base = self.s0_reaction_delay_ms
            return (max(80, base - 35), min(150, base + 35))
        base = self.reaction_delay_ms
        return (max(150, base - 40), min(300, base + 40))


class ReactionScheduler:
    """state 驱动动作的延迟排期（fake clock 可测；tick 内只查时间戳，不 sleep）。"""

    def __init__(self, config):
        self.config = config
        self.pending = None  # {'name','kind','due','delayMs','sources'}

    def schedule(self, name, kind, now, rng=None):
        rng = rng or __import__('random').random
        lo, hi = self.config.delay_range_ms(kind)
        # rng() in [0,1) → 整数毫秒抖动（fake rng 传入固定值即可复现）
        delay = int(round(lo + (hi - lo) * rng()))
        delay = clamp(delay, lo, hi)
        due = now + delay / 1000.0
        if self.pending and self.pending['due'] > now:
            # 多源取 max：同一窗口内多次触发，取更晚的截止时间，避免状态抖动越排越早
            due = max(due, self.pending['due'])
            sources = self.pending.get('sources', 1) + 1
        else:
            sources = 1
        self.pending = {'name': name, 'kind': kind, 'due': due, 'delayMs': delay, 'sources': sources, 'scheduledAt': now}
        return self.pending

    def take_due(self, now):
        if not self.pending:
            return None
        if now >= self.pending['due']:
            item = self.pending
            self.pending = None
            return item
        return None

    def cancel(self):
        self.pending = None


class InterruptRecovery:
    """点击/拖拽/状态切换后的姿势锚点恢复（默认 200ms）。"""

    def __init__(self, config):
        self.config = config
        self.recover_at = 0.0
        self.force_at_interrupt = None

    def interrupt(self, now, current_force=None):
        self.recover_at = now + self.config.interrupt_recover_ms / 1000.0
        self.force_at_interrupt = current_force
        return self.recover_at

    def take_due(self, now, current_force=None):
        """到点返回 True（调用方回姿势锚点）；若期间已有新动作（force 变化）则放弃清理。"""
        if not self.recover_at or now < self.recover_at:
            return False
        self.recover_at = 0.0
        if current_force != self.force_at_interrupt and current_force is not None:
            return False  # 新动作已接管，不误清
        self.force_at_interrupt = None
        return True

    def cancel(self):
        self.recover_at = 0.0
        self.force_at_interrupt = None


class IdleSkit:
    """走神/发呆：idle 足够久时低概率插入一次，冷却期内不再触发。"""

    def __init__(self, config):
        self.config = config
        self.cooldown_until = 0.0
        self.next_roll_at = 0.0
        self.fired_count = 0

    def should_fire(self, now, eligible, rng=None):
        cfg = self.config
        if not cfg.skit_enabled or not eligible:
            return False
        if now < self.cooldown_until:
            return False
        if now < self.next_roll_at:
            return False
        # 每次评估占用一个 roll 窗口（防每帧连抽），无论成败
        self.next_roll_at = now + cfg.skit_roll_window_s
        rng = rng or __import__('random').random
        if rng() < cfg.skit_chance:
            self.fired_count += 1
            self.cooldown_until = now + cfg.skit_cooldown_s
            return True
        return False


class BehaviorLayer:
    """行为层门面：一处持有 config + 三个组件，方便 pet 侧注入与单测。"""

    def __init__(self, cfg=None):
        self.config = BehaviorConfig(cfg)
        self.reaction = ReactionScheduler(self.config)
        self.interrupt = InterruptRecovery(self.config)
        self.idle = IdleSkit(self.config)

