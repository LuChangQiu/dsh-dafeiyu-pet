# -*- coding: utf-8 -*-
"""鲸鱼娘 2D 帧动画皮肤（素材来源：YunYueSama/codex-deepseek-pet，署名许可 1.0）。

素材目录：<pet-work>/assets/whale-girl/（manifest.json 为权威：动作 → 目录/帧序/逐帧时长/循环/保持末帧）。
本模块只负责：加载清单、按序播放、按显示身高取帧 Pixmap；渲染与状态切换仍在 桌宠.py。

设计原则：
- 资产缺失 / 清单损坏 / 任何异常 → `load()` 返回 None，调用方自动回退原三视图（classic）。
- 不做透明边裁切：帧画布 320×320、脚底锚点 (160,295)，绘制方按 `foot_ratio()` 对齐脚底。
- 帧 Pixmap 按 (路径, 显示高度) 缓存，容量小、够用即清。
"""

import json
import os

from PySide6.QtCore import Qt
from PySide6.QtGui import QPainter, QPixmap

NOMINAL_CONTENT_H = 263.0   # 标称内容高度（manifest/STATE-MAP 定义）
FOOT_ANCHOR_Y = 295.0       # 脚底锚点 y（画布 320）
DEFAULT_CANVAS = 320
# 渲染平滑（窗口期 task-131）：帧间/动作切换交叉淡化 + 亚像素整帧变换（由桌宠.py 叠加）
CROSSFADE_MS = 100          # 帧间淡化（验收 80–150ms）
ACTION_FADE_MS = 120        # play() 切换动作时的短淡化（验收 80–150ms）


class WhaleGirlSkin:
    """鲸鱼娘 2D 帧动画播放器（无 Qt 窗口依赖，纯数据 + Pixmap）。"""

    def __init__(self, assets_dir):
        self.dir = assets_dir
        self.ok = False
        self.err = ""
        self.canvas = DEFAULT_CANVAS
        self.actions = {}          # name -> {"dir","frames","durationsMs","loop","holdLast"}
        self._seq = {}             # name -> [(abs_path, ms), ...]
        self._loop = {}
        self._hold = {}
        self._pix = {}             # (path, display_h) -> QPixmap
        self.cur = ""
        self.idx = 0
        self.acc = 0.0
        self.finished = False
        self._quick_fade_ms = 80.0        # 快速事件（点击反应等）
        self._dir_fade_ms = 150.0         # 方向/镜像变化（drag/fall）
        # 渲染平滑：动画时钟、上一显示帧、淡化进度、缩放帧缓存
        self.clock_ms = 0.0
        self.prev_path = None
        self.fade_start_ms = 0.0
        self.fade_ms = float(CROSSFADE_MS)
        self.action_fade_ms = float(ACTION_FADE_MS)
        self.fade_enabled = True
        self._fade_cache = {}
        try:
            self._load()
            self.ok = True
        except Exception as e:  # 资产问题绝不能让桌宠起不来
            self.err = repr(e)
            self.ok = False

    # ---------- 加载 ----------
    def _load(self):
        manifest = os.path.join(self.dir, "manifest.json")
        with open(manifest, "r", encoding="utf-8") as f:
            data = json.load(f)
        self.canvas = int(data.get("canvas") or DEFAULT_CANVAS)
        actions = data.get("actions") or {}
        for name, spec in actions.items():
            sub = str(spec.get("dir") or name)
            frames = spec.get("frames") or []
            durs = spec.get("durationsMs") or []
            seq = []
            for i, fn in enumerate(frames):
                path = os.path.join(self.dir, sub, str(fn))
                if not os.path.isfile(path):
                    continue
                if i < len(durs):
                    ms = float(durs[i])
                elif durs:
                    ms = float(durs[-1])
                else:
                    ms = 80.0
                seq.append((path, max(16.0, ms)))
            if seq:
                self.actions[name] = spec
                self._seq[name] = seq
                self._loop[name] = bool(spec.get("loop"))
                self._hold[name] = bool(spec.get("holdLast"))
        if "idleBase" not in self._seq:
            raise RuntimeError("manifest 缺少 idleBase 动作")

        # 跨目录组合序列（composites）：think/waitPeek/cheer/errorSequence/cry/caught/report/pat/tsundere 等
        # 每步 {dir, frames[], durationsMs[]}，必须按 steps 顺序拼成一条播放序列，不能假设同目录连续文件。
        for name, spec in (data.get("composites") or {}).items():
            if not isinstance(spec, dict):
                continue
            steps = spec.get("steps") or []
            seq = []
            for step in steps:
                if not isinstance(step, dict):
                    continue
                sub = str(step.get("dir") or "")
                frames = step.get("frames") or []
                durs = step.get("durationsMs") or []
                for i, fn in enumerate(frames):
                    path = os.path.join(self.dir, sub, str(fn))
                    if not os.path.isfile(path):
                        continue
                    if i < len(durs):
                        ms = float(durs[i])
                    elif durs:
                        ms = float(durs[-1])
                    else:
                        ms = 80.0
                    seq.append((path, max(16.0, ms)))
            if seq:
                self.actions[name] = spec
                self._seq[name] = seq
                self._loop[name] = False
                self._hold[name] = bool((steps[-1] or {}).get("holdLast")) if steps else False

    # ---------- 查询/播放 ----------
    def has(self, name):
        return name in self._seq

    def set_smooth(self, cfg=None):
        """配置渲染平滑：crossfadeMs / actionFadeMs / enabled（缺省用常量）。"""
        cfg = cfg if isinstance(cfg, dict) else {}
        self.fade_enabled = bool(cfg.get('enabled', True))
        try:
            self.fade_ms = float(max(80.0, min(150.0, float(cfg.get('crossfadeMs', CROSSFADE_MS)))))
        except (TypeError, ValueError):
            self.fade_ms = float(CROSSFADE_MS)
        try:
            self.action_fade_ms = float(max(80.0, min(150.0, float(cfg.get('actionFadeMs', ACTION_FADE_MS)))))
        except (TypeError, ValueError):
            self.action_fade_ms = float(ACTION_FADE_MS)

    def _start_fade(self, old_path, fade_ms):
        if not self.fade_enabled or not old_path:
            return
        self.prev_path = old_path
        self.fade_start_ms = self.clock_ms
        self.fade_ms = max(60.0, float(fade_ms))
        if len(self._fade_cache) > 64:
            self._fade_cache.clear()

    def fade_alpha(self):
        """当前淡化进度（0=旧帧/旧动作，1=新）；无淡化返回 None。"""
        if not self.prev_path or not self.fade_enabled:
            return None
        el = self.clock_ms - self.fade_start_ms
        if el < 0 or el >= self.fade_ms or self.fade_ms <= 0:
            self.prev_path = None
            return None
        a = max(0.0, min(1.0, el / self.fade_ms))
        a = a * a * (3.0 - 2.0 * a)      # smoothstep
        if a >= 0.999:
            self.prev_path = None
            return None
        return a

    def play(self, name, restart=False):
        """切换到指定动作；返回是否成功。动作切换也走短交叉淡化，避免硬切。"""
        if name not in self._seq:
            return False
        if name == self.cur and not restart:
            return True
        old_path = self.frame_path()
        old_clip = self.cur
        self.cur = name
        self.idx = 0
        self.acc = 0.0
        self.finished = False
        # 淡化只发生在 **clip 切换**（同 clip 重播/换帧不淡化）；分档 80–150ms
        if old_path and old_clip != name:
            if name in ("drag", "fall"):
                _fade = self._dir_fade_ms
            elif name in ("pat", "tsundere"):
                _fade = self._quick_fade_ms
            else:
                _fade = self.action_fade_ms
            self._start_fade(old_path, _fade)
        return True

    def tick(self, ms):
        """按毫秒推进当前动作；循环动作自动回绕，单次动作到末帧后 finished=True。"""
        seq = self._seq.get(self.cur)
        if not seq or self.finished:
            return
        self.clock_ms += float(ms)
        self.acc += float(ms)
        guard = 0
        while self.acc >= seq[self.idx][1] and guard < 128:
            self.acc -= seq[self.idx][1]
            guard += 1
            if self.idx + 1 < len(seq):
                self.idx += 1
            elif self._loop.get(self.cur):
                self.idx = 0
            else:
                self.finished = True
                if self._hold.get(self.cur):
                    self.idx = len(seq) - 1
                break
        # 帧间不做淡化（每帧混合会与方向 crossfade 叠加成双层 → 透明边缘闪烁）；
        # 淡化只在 play() 动作切换时发生，见 _start_fade。

    def frame_path(self):
        seq = self._seq.get(self.cur)
        if not seq:
            return None
        return seq[min(self.idx, len(seq) - 1)][0]

    def action_stats(self, name):
        """动作帧统计 (帧数, 平均帧时长 ms, 循环总时长 ms)；未知动作返回 (0, 0.0, 0.0)。

        给"帧时长日志"用（用户反馈走路摆臂过快，需要记录素材时长与生效慢放倍率）。
        """
        seq = self._seq.get(name)
        if not seq:
            return (0, 0.0, 0.0)
        total = 0.0
        for _path, ms in seq:
            total += float(ms)
        return (len(seq), total / len(seq), total)

    def _scaled_pix(self, path, h):
        key = (path, h)
        pix = self._pix.get(key)
        if pix is not None:
            return pix
        raw = QPixmap(path)
        if raw.isNull():
            return None
        scale = h / NOMINAL_CONTENT_H
        target = max(1, int(round(self.canvas * scale)))
        pix = raw.scaled(target, target, Qt.AspectRatioMode.KeepAspectRatio,
                         Qt.TransformationMode.SmoothTransformation)
        if len(self._pix) > 96:
            self._pix.clear()
        self._pix[key] = pix
        return pix

    def pixmap_raw(self, display_h):
        """原始当前帧（不做任何淡化混合）：方向/镜像 crossfade 外层使用，避免双层混合。"""
        path = self.frame_path()
        if not path:
            return None
        try:
            h = max(48, int(display_h))
        except (TypeError, ValueError):
            h = 184
        return self._scaled_pix(path, h)

    def pixmap(self, display_h):
        """取当前帧；仅在动作切换淡化期返回 prev+cur 的 dissolve 合成（单层 alpha）。"""
        path = self.frame_path()
        if not path:
            return None
        try:
            h = max(48, int(display_h))
        except (TypeError, ValueError):
            h = 184
        cur = self._scaled_pix(path, h)
        if cur is None:
            return None
        alpha = self.fade_alpha()
        if alpha is None or not self.prev_path:
            return cur
        prev = self._scaled_pix(self.prev_path, h)
        if prev is None or prev.size() != cur.size():
            return cur
        step = int(alpha * 16)
        ckey = (self.prev_path, path, h, step)
        out = self._fade_cache.get(ckey)
        if out is not None:
            return out
        # dissolve：prev 满不透明打底，cur 以 alpha 叠上（不对两层各设 opacity 后 SourceOver）
        out = prev.copy()
        p = QPainter(out)
        try:
            p.setOpacity(max(0.0, min(1.0, alpha)))
            p.drawPixmap(0, 0, cur)
        finally:
            p.end()
        if len(self._fade_cache) > 64:
            self._fade_cache.clear()
        self._fade_cache[ckey] = out
        return out

    def foot_ratio(self):
        """脚底锚点在帧画布高度中的比例（绘制时用于把脚底对齐到落地点）。"""
        return FOOT_ANCHOR_Y / float(max(1, self.canvas))


def default_assets_dir(pet_file):
    """由 桌宠.py 路径推出 <pet-work>/assets/whale-girl。"""
    pet_dir = os.path.dirname(os.path.abspath(pet_file))
    work_dir = os.path.dirname(pet_dir)
    return os.path.join(work_dir, "assets", "whale-girl")


def load(pet_file):
    """加载鲸鱼娘皮肤；不可用返回 None（调用方回退 classic）。"""
    try:
        assets = default_assets_dir(pet_file)
        if not os.path.isdir(assets):
            return None
        skin = WhaleGirlSkin(assets)
        return skin if skin.ok else None
    except Exception:
        return None
