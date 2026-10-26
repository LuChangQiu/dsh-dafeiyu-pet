# -*- coding: utf-8 -*-
"""动画平滑/编排纯逻辑（无 Qt 依赖，假时钟可测）。

职责：
- 配置解析（whale.smooth：crossfadeMs/actionFadeMs/呼吸/摇摆/微动作间隔）；
- 帧间/动作切换淡化 alpha（easeInOut，80–150ms）；
- 整帧次级运动：呼吸缩放（4–6s，±0.3–0.6%）、轻微摇摆（±0.2–0.6°）、上下浮动；
- 待机小动作调度（随机 + 冷却 + 与空闲时长解耦）；
- 庆祝 3 阶段时间线（1.5–3.0s）；
- 对话气泡 kind → 微动作映射；
- DSH 状态映射常量（供断言保持不回归）。
"""

import math
import random

DEFAULTS = {
    'enabled': True,
    'crossfadeMs': 120,
    'actionFadeMs': 120,
    'breathAmpPct': 0.5,      # ±0.5%（验收 0.3–0.6）
    'breathPeriodSec': 5.0,   # 验收 4–6s
    'swayDeg': 0.35,          # 轻微摇摆（验收 ≤0.6°）
    'floatPx': 1.2,           # 上下浮动
    'microMinSec': 8.0,       # 待机微动作间隔（验收 8–20s）
    'microMaxSec': 18.0,
    'microCooldownSec': 1.5,
}

# DSH 状态 → 动作（tool 不再 walk：站桩 hum；保持既有映射语义）
DSH_MAP = {
    'thinking': 'think',
    'tool': 'hum',
    'waiting_approval': 'waitPeek',
    'approval': 'waitPeek',
    'waiting_input': 'waitPeek',
    'done': 'celebrate',
    'error': 'errorSequence',
    'cry': 'cry',
    'disconnected': 'lonelySit',
}

# 待机小动作池（组合现有帧）：换重心/整理/伸懒腰/看左右/摆手/哼歌/轻跳
IDLE_ACTIONS = ('idleShift', 'idleSettle', 'idleStretch', 'turnStop', 'wave', 'hum', 'jump')
IDLE_WEIGHTS = (30, 25, 18, 8, 6, 8, 5)
IDLE_LOOP_ACTIONS = {'hum'}          # 循环动作需调用方给定时长后收回
IDLE_TIMED_MS = {'hum': 2600}        # 组合动作播放时长（ms）

# 庆祝：3 阶段，总 1.5–3.0s（跳起→落地→举双手/celebrate）
CELEBRATION_STAGES = (
    {'name': 'jump', 'action': 'jump', 'durMs': 780},
    {'name': 'land', 'action': 'land', 'durMs': 430},
    {'name': 'cheer', 'action': 'cheer', 'durMs': 950},
)
CELEBRATION_TOTAL_MS = sum(int(s['durMs']) for s in CELEBRATION_STAGES)

# 对话气泡 kind → 微动作（点头/歪头/害羞/摆手）
DIALOG_ACTIONS = {
    'greet': 'wave',
    'report': 'report',
    'remind': 'waitPeek',
    'love': 'pat',
    'inner': 'pat',
    'night': 'hum',
    'error': 'errorSequence',
    '': 'pat',
}
S0_FORCES = ('think', 'waitPeek', 'errorSequence', 'none', 'sleep')

# 淡化白名单/硬切策略（Lead 2026-10-26 最终口径）：
# - 只允许：idle↔walk↔turnStop 等 locomotion + 普通动作切换 → 120ms（80–150 可配）；
# - 必须硬切：sleep(holdLast)/fall/land/sneak→caught/drag/表情/眨眼帧等；
# - walk 帧序不经过 play()，所以“走路帧间零淡化”天然满足。
# 白名单 = 只允许这些 clip 之间的切换淡化（Lead/char-scout 最终口径：不做全动作淡化）
LOCOMOTION_ACTIONS = ('idleBase', 'idleShift', 'idleSettle', 'idleStretch', 'walk', 'turnStop')
# 其余 clip（eat/eatSatisfied/wave/jump/land/dance/sneak/sleep/wake/drag/fall）+
# composites（think/waitPeek/cheer/errorSequence/cry/caught/lonelySit/hum/report/pat/tsundere）+ note 一律硬切
HARD_CUT_ACTIONS = (
    'eat', 'eatSatisfied', 'wave', 'jump', 'land', 'dance', 'sneak', 'sleep', 'wake', 'drag', 'fall',
    'think', 'waitPeek', 'cheer', 'errorSequence', 'cry', 'caught', 'lonelySit', 'hum', 'report',
    'pat', 'tsundere', 'note', 'idle', 'background', 'blink', '',
)


def should_crossfade(prev_clip, next_clip, enabled=True):
    """仅当 prev/next **都在 locomotion 白名单**内才淡化（walk/idle/turnStop 互相切换）；
    其余（表情/动作/睡眠/摔倒/拖拽/偷看被抓等）一律硬切。"""
    if not enabled:
        return False
    if not prev_clip or not next_clip:
        return False
    p, n = str(prev_clip), str(next_clip)
    if p == n:
        return False
    return p in LOCOMOTION_ACTIONS and n in LOCOMOTION_ACTIONS


def clamp(v, lo, hi):
    return lo if v < lo else (hi if v > hi else v)


def _num(v, default, lo, hi):
    try:
        return clamp(float(v), lo, hi)
    except (TypeError, ValueError):
        return default


class SmoothConfig:
    """从 config['whale']['smooth'] 解析；缺省/非法自动回退与夹取。"""

    def __init__(self, cfg=None):
        raw = {}
        if isinstance(cfg, dict):
            whale = cfg.get('whale')
            if isinstance(whale, dict) and isinstance(whale.get('smooth'), dict):
                raw = whale['smooth']
        self.enabled = bool(raw.get('enabled', DEFAULTS['enabled']))
        # 允许 0 = 全硬切；否则验收 80–150ms
        _cf = raw.get('crossfadeMs', DEFAULTS['crossfadeMs'])
        try:
            _cfv = float(_cf)
        except (TypeError, ValueError):
            _cfv = float(DEFAULTS['crossfadeMs'])
        self.crossfade_ms = 0 if _cfv <= 0 else int(clamp(_cfv, 80, 150))
        self.action_fade_ms = int(_num(raw.get('actionFadeMs'), DEFAULTS['actionFadeMs'], 80, 150))
        self.breath_amp_pct = _num(raw.get('breathAmpPct'), DEFAULTS['breathAmpPct'], 0.3, 0.6)
        self.breath_period_s = _num(raw.get('breathPeriodSec'), DEFAULTS['breathPeriodSec'], 4.0, 6.0)
        self.sway_deg = _num(raw.get('swayDeg'), DEFAULTS['swayDeg'], 0.2, 0.6)
        self.float_px = _num(raw.get('floatPx'), DEFAULTS['floatPx'], 0.5, 2.5)
        self.micro_min_s = _num(raw.get('microMinSec'), DEFAULTS['microMinSec'], 5.0, 30.0)
        self.micro_max_s = _num(raw.get('microMaxSec'), DEFAULTS['microMaxSec'], self.micro_min_s, 40.0)
        if self.micro_max_s < self.micro_min_s:
            self.micro_max_s = self.micro_min_s
        self.micro_cooldown_s = _num(raw.get('microCooldownSec'), DEFAULTS['microCooldownSec'], 0.0, 10.0)


def frame_change_fades(prev_clip, next_clip):
    """帧间是否淡化：**同一 clip 内换帧永不淡化**（闪烁根因修复）；仅 clip 变化时淡化。"""
    return bool(prev_clip) and bool(next_clip) and str(prev_clip) != str(next_clip)


def action_fade_layers(alpha):
    """动作切换淡化合成层：先 prev 满不透明，再 cur 以 alpha 叠上（dissolve，单层 alpha）。

    返回 [(layer, opacity), ...]；调用方必须按顺序绘制，不能对两层都 setOpacity 后 SourceOver
    （那会让重叠透明边缘的 alpha 忽大忽小 → 闪烁）。
    """
    a = clamp(float(alpha), 0.0, 1.0)
    return [('prev', 1.0), ('cur', a)]


def direction_crossfade_uses_raw(whale_active=True):
    """方向/镜像 crossfade 使用原始帧（pixmap_raw），避免与动作淡化叠加成双层混合。"""
    return bool(whale_active)


def ease_in_out(t):
    t = clamp(float(t), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def fade_alpha(elapsed_ms, duration_ms, enabled=True):
    """淡化进度：0=旧帧/旧动作、1=新帧/新动作；非法参数按已完成处理。"""
    if not enabled:
        return 1.0
    try:
        dur = float(duration_ms)
        if dur <= 0:
            return 1.0
        return ease_in_out(float(elapsed_ms) / dur)
    except (TypeError, ValueError):
        return 1.0


def breath_scale(now, cfg):
    """整帧呼吸缩放（以脚底为锚由调用方处理）：±amp%。"""
    try:
        return 1.0 + (cfg.breath_amp_pct / 100.0) * math.sin(
            2.0 * math.pi * float(now) / max(0.5, cfg.breath_period_s))
    except Exception:
        return 1.0


def secondary_motion(now, cfg, walking=False):
    """整帧次级运动参数：缩放 + 摇摆角 + 浮动像素。"""
    if not cfg or not cfg.enabled:
        return {'scale': 1.0, 'sway_deg': 0.0, 'float_px': 0.0}
    if walking:
        return {'scale': breath_scale(now, cfg),
                'sway_deg': 0.0, 'float_px': 0.0}
    sway = cfg.sway_deg * math.sin(2.0 * math.pi * now / max(1.0, cfg.breath_period_s * 1.3))
    flt = cfg.float_px * math.sin(2.0 * math.pi * now / max(1.0, cfg.breath_period_s * 0.8) + 0.7)
    return {'scale': breath_scale(now, cfg), 'sway_deg': sway, 'float_px': flt}


class IdleMicroScheduler:
    """待机小动作调度：随机间隔（默认 8–18s）+ 冷却；假时钟可测。"""

    def __init__(self, cfg, now=0.0, rng=None):
        self.cfg = cfg or SmoothConfig({})
        self.rng = rng or random.Random()
        self.next_at = float(now) + self._interval()
        self.last_at = -1e9

    def _interval(self):
        lo = max(0.1, self.cfg.micro_min_s)
        hi = max(lo, self.cfg.micro_max_s)
        return self.rng.uniform(lo, hi)

    def due(self, now):
        return float(now) >= self.next_at

    def pick(self, now):
        if not self.due(now):
            return None
        if float(now) - self.last_at < self.cfg.micro_cooldown_s:
            self.next_at = float(now) + self.cfg.micro_cooldown_s
            return None
        self.last_at = float(now)
        self.next_at = float(now) + self._interval()
        return self.rng.choices(IDLE_ACTIONS, weights=IDLE_WEIGHTS, k=1)[0]

    def reset(self, now):
        self.last_at = float(now)
        self.next_at = float(now) + self._interval()


def celebration_stages():
    return tuple(dict(s) for s in CELEBRATION_STAGES)


def celebration_total_ms():
    return CELEBRATION_TOTAL_MS


def dialog_action(kind):
    return DIALOG_ACTIONS.get(str(kind or '').strip(), DIALOG_ACTIONS[''])
