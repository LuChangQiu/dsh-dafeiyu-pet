# -*- coding: utf-8 -*-
"""pet_defaults —— B 身体/气泡/微动作的集中默认值（单一真源）。

这些值原先散落在 pet_window.py / webm_body.py / smooth_anim.py；现在集中到这里。
运行时配置（pet/config.json 的 whale / bubble 等键）可覆盖同名默认值，见
``pet_window.py`` 的 cfg_defaults 与 ``webm_body.py`` 的 setter。
"""
from __future__ import annotations

# B 身体窗口/显示（验收契约：单窗 168×198，人物显示高 184，脚底锚 96.5%）
WINDOW_W = 168
WINDOW_H = 198
DISPLAY_H = 184
CLIP_FADE_MS = 120
FOOT_ANCHOR = 0.965

# 气泡
BUBBLE_H = 112
BUBBLE_ANIM_SEC = 0.15
PAUSED_BUBBLE_SEC = 180

# 待机微动作（smooth_anim 的 SmoothConfig 默认值；config.whale.smooth 可覆盖）
MICRO_MIN_SEC = 8.0
MICRO_MAX_SEC = 13.0
MICRO_COOLDOWN_SEC = 0.0
IDLE_WEIGHTS = (18, 16, 14, 14, 12, 10, 10, 6)
IDLE_TIMED_MS = {"hum": 2600, "sleep": 1200}

# 兼容旧模块的别名（语义更明确）
DEFAULT_WINDOW_W = WINDOW_W
DEFAULT_WINDOW_H = WINDOW_H
DEFAULT_DISPLAY_H = DISPLAY_H
DEFAULT_FADE_MS = CLIP_FADE_MS
DEFAULT_FOOT_ANCHOR = FOOT_ANCHOR


def config_get(cfg, *path, default=None):
    """按嵌套 key 读 config（dict），缺失/类型异常时返回 default。"""
    cur = cfg
    for key in path:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(key)
        if cur is None:
            return default
    return cur


def whale_defaults(cfg=None) -> dict:
    """返回 B 身体默认值 + config.whale 覆盖（供 webm_body/pet_window 使用）。"""
    cfg = cfg or {}
    w = cfg.get("whale") if isinstance(cfg, dict) else None
    w = w if isinstance(w, dict) else {}
    return {
        "windowW": int(w.get("windowW", WINDOW_W)),
        "windowH": int(w.get("windowH", WINDOW_H)),
        "displayHeight": int(w.get("displayHeight", DISPLAY_H)),
        "fadeMs": int(w.get("fadeMs", CLIP_FADE_MS)),
        "footAnchor": float(w.get("footAnchor", FOOT_ANCHOR)),
    }


def bubble_defaults(cfg=None) -> dict:
    cfg = cfg or {}
    return {
        "height": int(cfg.get("bubble_height", BUBBLE_H)),
        "animSec": float(cfg.get("bubble_anim_sec", BUBBLE_ANIM_SEC)),
        "pausedSec": int(cfg.get("paused_bubble_sec", PAUSED_BUBBLE_SEC)),
    }
