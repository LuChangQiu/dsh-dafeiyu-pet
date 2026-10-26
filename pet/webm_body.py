# -*- coding: utf-8 -*-
"""WebM 鲸鱼娘身体适配器（B 身体，独立透明 overlay）。

不侵入现有 WhaleGirlSkin / _whale_tick：
- 本模块只负责一个透明、无边框、置顶的 QWebEngineView；
- A（现有 2D 帧皮肤）仍是默认，调用方 opt-in 才创建本对象；
- 失败/超时/素材缺失通过 error 信号报告，调用方回退 A。

素材：dsh-whale-girl-pet v0.3.10（MIT，署名 yanzwzz；详见 assets/webm_body/LICENSE/NOTICE.md）
"""
from __future__ import annotations

import ctypes
import json
import os
import re
import sys
from pathlib import Path

from PySide6.QtCore import QObject, QPoint, Qt, QTimer, QUrl, Signal, Slot
from PySide6.QtGui import QCursor
from PySide6.QtWebChannel import QWebChannel
from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineProfile, QWebEngineSettings
from PySide6.QtWebEngineWidgets import QWebEngineView


def _resolve_assets_dir() -> Path:
    """B 素材路径：env → tools/body-b/webm_pet → 旧本地 assets/webm_body。

    50 段 webm 不入 git；发布包由打包侧注入目录。
    """
    cands = []
    env = os.environ.get("DSH_PET_WEBM_ASSETS")
    if env:
        cands.append(Path(env))
    here = Path(__file__).resolve().parent
    work = here.parent
    cands += [
        work / "tools" / "body-b" / "webm_pet",
        here / "assets" / "webm_body",
        work / "third-party" / "dsh-whale-girl-pet" / "package",
    ]
    for c in cands:
        try:
            if (c / "index.html").is_file() and (c / "assets").is_dir():
                return c
        except Exception:
            continue
    return here / "assets" / "webm_body"


ASSETS_DIR = _resolve_assets_dir()

# 英文语义 alias → 50 段中文 clip 名
CLIP_ALIAS = {
    "idle": "待机呼吸休闲", "thinking": "工作思考", "tool": "认真工作",
    "working": "认真工作", "working_command": "原地敲击桌面互动",
    "working_search": "东张西望", "waiting": "东张西望",
    "success": "工作结束", "error": "工作被打扰", "done": "工作结束",
    "dragging": "被鼠标拖拽悬空反馈", "dragging_release": "工作结束",
    "head_pat": "点击回应 - 害羞惊讶", "poke": "点击回应 - 开心跃动",
    "tail": "用鲸鱼尾巴拍打地面", "eat_token": "吃小鱼干",
    "idle_stretch": "超大伸懒腰", "idle_yawn": "哈欠连天",
    "sleep": "睡觉第一段", "sleepDeep": "睡觉第二段", "wake": "睡眼惺忪",
    "longTask": "长时间工作看表", "approval": "东张西望",
    "waiting_input": "工作被打扰", "waiting_approval": "东张西望",
    "approvalWait": "东张西望", "waitingInput": "工作被打扰",
    "disconnected": "待机呼吸休闲", "cancelled": "工作结束",
    "fail": "工作被打扰", "pat": "点击回应 - 害羞惊讶",
    "drag_release": "工作结束", "dragRelease": "工作结束",
    "click": "点击回应 - 开心跃动",
    "clickHappy": "点击回应 - 开心跃动", "praise": "点击回应 - 害羞惊讶",
}
# 语义名 → 默认 clip（供 pet 侧快速接线；完整 OP-MATRIX 用 applyAction(id)）
DEFAULT_ACTION_MAP = {
    "idle": "待机呼吸休闲",
    "turnStart": "开始工作",
    "tool": "认真工作",
    "approval": "举牌不是大肥鱼",
    "waiting_input": "空白举牌",
    "done": "工作结束",
    "complete": "工作结束",
    "error": "工作被打扰",
    "longTask": "长时间工作看表",
    "click": "点击回应 - 害羞惊讶",
    "clickHappy": "点击回应 - 开心跃动",
    "praise": "点击回应 - 害羞惊讶",
    "sleep": "睡觉第一段",
    "sleepDeep": "睡觉第二段",
    "wake": "睡眼惺忪",
    "offline": "睡眼惺忪",
    "drag": "被鼠标拖拽悬空反馈",
    "fallback": "待机呼吸休闲",
    "peek": None,  # 使用静态 peek-edge.png，不走 clip
}

# OP-ACTION-MATRIX §1.7：ID -> (主 clip, loop, weight)
ACTION_META = {
    "S1": ("睡眼惺忪", False, 0.7),
    "S2": ("工作结束", False, 0.6),
    "S3": ("睡眼惺忪", False, 0.8),
    "S4": ("开始工作", False, 0.7),
    "S5": ("工作结束", False, 0.8),
    "S6": ("工作被打扰", False, 1.0),
    "T1": ("认真工作", True, 0.6),
    "T2": ("原地敲击桌面互动", True, 0.6),
    "T3": ("认真工作", True, 0.6),
    "T4": ("东张西望", False, 0.6),
    "T5": ("工作思考", True, 0.6),
    "T6": ("工作思考", True, 0.6),
    "T7": ("长时间工作看表", True, 0.6),
    "T8": ("东张西望", False, 0.5),
    "T9": ("东张西望", False, 0.4),
    "T10": ("长时间工作看表", True, 0.5),
    "A1": ("举牌不是大肥鱼", False, 1.0),
    "A2": ("女仆屈膝礼仪", False, 0.6),
    "A3": ("空白举牌", False, 0.8),
    "A4": ("举牌不是大肥鱼", False, 1.0),
    "E1": ("工作被打扰", False, 1.0),
    "E2": ("工作被打扰", False, 0.8),
    "E3": ("工作思考", True, 0.6),
    "E4": ("睡眼惺忪", False, 0.8),
    "E5": ("待机呼吸休闲", True, 0.4),
    "P1": ("工作思考", False, 0.5),
    "P2": ("工作结束", False, 0.7),
    "P3": ("认真工作", False, 0.5),
    "P4": ("认真工作", True, 0.5),
    "P5": ("工作被打扰", False, 0.8),
    "P6": ("翻钱包", False, 0.6),
    "P7": ("举牌不是大肥鱼", False, 0.6),
    "P8": ("东张西望", False, 0.5),
    "P9": ("长时间工作看表", True, 0.6),
    "P10": ("长时间工作看表", True, 0.6),
    "I1": ("待机呼吸休闲", True, 1.0),
    "I2": ("工作思考", False, 0.5),
    "I3": ("东张西望", False, 0.4),
    "I4": ("女仆屈膝礼仪", False, 0.5),
    "I5": ("工作思考", False, 0.4),
    "I6": ("东张西望", False, 0.3),
    "I7": ("睡觉第一段", False, 1.0),
    "U1": ("点击回应 - 害羞惊讶", False, 0.8),
    "U2": ("被鼠标拖拽悬空反馈", False, 0.9),
}


def _load_clips(assets_dir: Path) -> list[str]:
    """从 clips.js 解析 50 个 clip 名（不依赖 Web 页面）。"""
    p = assets_dir / "clips.js"
    try:
        txt = p.read_text(encoding="utf-8")
        m = re.search(r"window\.CLIPS\s*=\s*(\[.*?\]);", txt, re.S)
        if m:
            return [str(x) for x in json.loads(m.group(1))]
    except Exception:
        pass
    return [p.stem for p in sorted((assets_dir / "assets").glob("*.webm"))]


class _Bridge(QObject):
    jsReady = Signal()
    logLine = Signal(str)
    frameReady = Signal(str, float)

    def __init__(self, owner: "WebmBody") -> None:
        super().__init__(owner)
        self.owner = owner

    @Slot()
    def ready(self) -> None:
        self.jsReady.emit()

    @Slot(str)
    def log(self, message: str) -> None:
        self.logLine.emit(str(message))

    @Slot(str, float)
    def firstFrame(self, name: str, t: float) -> None:
        self.frameReady.emit(str(name), float(t))

    @Slot(str)
    def clipChanged(self, name: str) -> None:
        self.owner._current = str(name)
        self.owner.clipChanged.emit(str(name))

    @Slot(float, float)
    def mouseDown(self, sx: float, sy: float) -> None:
        self.owner._begin_drag(float(sx), float(sy))

    @Slot()
    def mouseUp(self) -> None:
        self.owner._end_drag()

    @Slot()
    def clicked(self) -> None:
        self.owner._on_clicked()


class WebmBody(QObject):
    """透明 WebM 身体 overlay。用法见文件头与 README。"""

    ready = Signal()             # JS bridge ready（不代表首帧）
    firstFrame = Signal(str, float)  # (clip, ms since start)
    clipChanged = Signal(str)
    clicked = Signal(QPoint)      # global cursor pos
    dragStarted = Signal(QPoint)
    dragMoved = Signal(QPoint)
    dragFinished = Signal(QPoint)
    positionChanged = Signal(QPoint)
    error = Signal(str)
    closed = Signal()

    def __init__(self, parent: QObject | None = None, assets_dir: str | Path | None = None,
                 click_through: bool = False, auto_click_clip: bool = True) -> None:
        super().__init__(parent)
        self.assets_dir = Path(assets_dir) if assets_dir else ASSETS_DIR
        self.auto_click_clip = bool(auto_click_clip)
        self._click_through = bool(click_through)
        self._started = False
        self._started_at = 0.0
        self._ready = False
        self._first_frame = None
        self._current = ""
        self._size = 184
        self._box_w = 168
        self._box_h = 198
        self._bubble_extra = 0
        self._base_pos = None
        self._bubble_timer = QTimer(self)
        self._bubble_timer.setSingleShot(True)
        self._bubble_timer.timeout.connect(self._hide_bubble)
        self._paused = False
        self._peek = ""
        self._clips = _load_clips(self.assets_dir)
        self._action_map = dict(DEFAULT_ACTION_MAP)
        self._drag_offset = QPoint()
        self._dragging = False
        self._drag_moved = False
        self._drag_start_pos = QPoint()

        self._drag_timer = QTimer(self)
        self._drag_timer.setInterval(10)
        self._drag_timer.timeout.connect(self._drag_tick)

        self._view = None
        self._page = None
        self._profile = None
        index = self.assets_dir / "index.html"
        if not index.is_file() or not self._clips:
            self.error.emit(f"webm_body assets missing: {self.assets_dir}")
            return

        self._view = QWebEngineView()
        self._view.setWindowFlags(
            Qt.WindowType.Tool | Qt.WindowType.FramelessWindowHint |
            Qt.WindowType.WindowStaysOnTopHint
        )
        self._view.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        self._view.setAttribute(Qt.WidgetAttribute.WA_ShowWithoutActivating, True)
        self._view.setWindowTitle("whale-girl webm body")
        self._view.setStyleSheet("background: transparent;")
        self._view.resize(260, 300)
        self._view.hide()

        self._profile = QWebEngineProfile(self)
        self._profile.setHttpCacheType(QWebEngineProfile.HttpCacheType.MemoryHttpCache)
        self._profile.setPersistentCookiesPolicy(QWebEngineProfile.PersistentCookiesPolicy.NoPersistentCookies)
        self._page = QWebEnginePage(self._profile, self._view)
        self._page.setBackgroundColor(Qt.GlobalColor.transparent)
        try:
            s = self._page.settings()
            s.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessFileUrls, True)
            s.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessRemoteUrls, False)
            s.setAttribute(QWebEngineSettings.WebAttribute.WebGLEnabled, True)
        except Exception:
            pass
        self._view.setPage(self._page)
        self._channel = QWebChannel(self)
        self._bridge = _Bridge(self)
        self._channel.registerObject("bridge", self._bridge)
        self._page.setWebChannel(self._channel)
        self._bridge.jsReady.connect(self._on_ready)
        self._bridge.logLine.connect(self._on_log)
        self._bridge.frameReady.connect(self._on_first_frame)
        self._view.load(QUrl.fromLocalFile(str(index)))
        self._pending_clip = ""
        self._pending_fade = 120
        self._pending_loop = True

    # ------------------------------------------------------------- lifecycle
    def start(self, show: bool = True) -> bool:
        if self._view is None:
            return False
        if not self._started:
            self._started = True
            self._started_at = __import__("time").monotonic()
        if show:
            self._view.show()
            self._view.raise_()
        if self._pending_clip:
            self.playClip(self._pending_clip, self._pending_fade, self._pending_loop)
        return True

    def startHidden(self) -> bool:
        return self.start(show=False)

    def close(self) -> None:
        self._drag_timer.stop()
        try:
            if self._view is not None:
                self._view.hide()
            if self._page is not None:
                self._page.setWebChannel(None)
                try:
                    self._page.setParent(None)
                except Exception:
                    pass
                self._page.deleteLater()
            if self._view is not None:
                try:
                    self._view.setPage(None)
                except Exception:
                    pass
                self._view.deleteLater()
            if getattr(self, "_profile", None) is not None:
                self._profile.deleteLater()
        except Exception:
            pass
        self._view = None
        self._page = None
        self._profile = None
        self.closed.emit()

    # ------------------------------------------------------------- API
    def playClip(self, name: str, fadeMs: int = 120, loop: bool = True) -> bool:
        if not name:
            return False
        name = CLIP_ALIAS.get(str(name), str(name))
        if self._view is None:
            return False
        if name not in self._clips:
            self.error.emit(f"unknown clip: {name}")
            return False
        if self._peek:
            # 用户主动 peek 优先于 state→clip；只缓存最新状态，等 setPeek(None) 恢复
            self._pending_clip = name
            self._pending_fade = int(fadeMs)
            self._pending_loop = bool(loop)
            return True
        self._pending_clip = name
        self._pending_fade = int(fadeMs)
        self._pending_loop = bool(loop)
        if not self._ready:
            return True
        self._page.runJavaScript(
            "window.petApi && window.petApi.play(%s, %d, %s);" % (
                json.dumps(name, ensure_ascii=False), max(0, int(fadeMs)), "true" if loop else "false"
            )
        )
        return True

    def setSize(self, *args) -> None:
        """setSize(184) 或 setSize(168,198,184)（窗口宽,窗口高,人物显示高）。"""
        box_w, box_h, h = 168, 198, 184
        if len(args) >= 3:
            box_w, box_h, h = int(args[0]), int(args[1]), int(args[2])
        elif len(args) == 1:
            h = int(args[0])
            box_w = max(120, int(round(h * 168 / 184)))
            box_h = max(140, int(round(h * 198 / 184)))
        h = max(120, min(220, int(h)))
        self._size = h
        self._box_w = box_w
        self._box_h = box_h
        if self._view is not None:
            anchor = self.footAnchor()
            self._view.resize(box_w, box_h)
            if anchor is not None:
                self.setPosition(anchor.x() - box_w // 2, anchor.y() - round(box_h * 0.965))
            self._page.runJavaScript(
                f"window.petApi && window.petApi.layout({h},{box_w},{box_h});")

    def size(self) -> int:
        return self._size

    def setPosition(self, x: int, y: int) -> None:
        if self._view is not None:
            self._view.move(int(x), int(y))
            self.positionChanged.emit(QPoint(int(x), int(y)))

    def position(self) -> QPoint:
        return self._view.pos() if self._view is not None else QPoint()

    def footAnchor(self) -> QPoint:
        """窗口内脚底锚点的全局坐标：横向中心、纵向 96.5% 窗高（168×198 裁布局）。"""
        if self._view is None:
            return QPoint()
        return self._view.pos() + QPoint(self._view.width() // 2, round(self._view.height() * 0.965))

    def setPeek(self, edge: str | None) -> None:
        """显示/取消静态 peek-edge；peek 期间 state→clip 不抢镜，直到显式取消。"""
        e = (edge or "").lower()
        was = self._peek
        self._peek = e if e in ("left", "right") else ""
        if self._view is not None and self._ready:
            self._page.runJavaScript("window.petApi && window.petApi.setPeek(%s);" % json.dumps(self._peek))
        if was and not self._peek:
            # 取消 peek：恢复最新状态 clip（没有 pending 就恢复当前）
            n = self._pending_clip or self._current
            if n:
                QTimer.singleShot(0, lambda: self.playClip(n, self._pending_fade, self._pending_loop))


    def showBubble(self, text: str, seconds: float = 3.2) -> bool:
        """在 B 同一个 QWebEngineView 内显示台词气泡；**窗口固定 168×198 不缩放不跳位**。"""
        if self._view is None:
            return False
        text = str(text or "").strip()
        if not text:
            return False
        try:
            self._page.runJavaScript(
                "window.petApi && window.petApi.showBubble(%s, %d, 0);" % (
                    __import__("json").dumps(text, ensure_ascii=False),
                    int(max(0.8, float(seconds)) * 1000)))
            self._bubble_timer.start(int(max(0.8, float(seconds)) * 1000) + 250)
            return True
        except Exception:
            return False

    def _hide_bubble(self) -> None:
        if self._view is None:
            return
        try:
            self._page.runJavaScript("window.petApi && window.petApi.hideBubble();")
        except Exception:
            pass

    def setPaused(self, on: bool) -> None:
        self._paused = bool(on)
        if self._view is not None and self._ready:
            self._page.runJavaScript("window.petApi && window.petApi.setPaused(%s);" % ("true" if on else "false"))

    def setClickThrough(self, on: bool) -> None:
        self._click_through = bool(on)
        if self._view is None:
            return
        try:
            self._view.setWindowFlag(Qt.WindowType.WindowTransparentForInput, bool(on))
            # Windows 上 Qt 的 flag 不一定生效，补 WS_EX_TRANSPARENT
            if sys.platform == "win32":
                hwnd = int(self._view.winId())
                user32 = ctypes.WinDLL("user32", use_last_error=True)
                GWL_EXSTYLE = -20
                WS_EX_TRANSPARENT = 0x00000020
                get = user32.GetWindowLongPtrW
                set_ = user32.SetWindowLongPtrW
                get.restype = ctypes.c_ssize_t
                get.argtypes = [ctypes.c_void_p, ctypes.c_int]
                set_.restype = ctypes.c_ssize_t
                set_.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_ssize_t]
                ex = get(hwnd, GWL_EXSTYLE)
                ex = (ex | WS_EX_TRANSPARENT) if on else (ex & ~WS_EX_TRANSPARENT)
                set_(hwnd, GWL_EXSTYLE, ex)
            self._view.show()
        except Exception as esc:
            self.error.emit(f"click-through failed: {esc!r}")

    def listClips(self) -> list[str]:
        return list(self._clips)

    def currentClip(self) -> str:
        return self._current

    def setActionMap(self, mapping: dict) -> None:
        self._action_map.update({str(k): v for k, v in (mapping or {}).items() if v is not None})

    def actionMap(self) -> dict:
        return dict(self._action_map)

    def applyAction(self, action_id: str, fadeMs: int = 120) -> bool:
        """执行 OP-ACTION-MATRIX §1.7 的 B 主选（如 T3/A1/U1）。"""
        meta = ACTION_META.get(str(action_id))
        if not meta:
            return False
        name, loop, _weight = meta
        return self.playClip(name, fadeMs, loop)

    def applyState(self, state: str, fadeMs: int = 120) -> bool:
        state = str(state)
        if state in ACTION_META:
            return self.applyAction(state, fadeMs)
        name = self._action_map.get(state)
        if state == "peek":
            self.setPeek("right")
            return True
        if not name:
            return False
        loop = state in ("idle", "tool", "longTask", "drag")
        return self.playClip(name, fadeMs, loop)

    def applyPerf(self, payload) -> bool:
        """最小 perf 协议：接受 dict 或 'perf:<json>'，播第一拍/顺序拍。

        只保证“B clip 名→文件”与即时单拍；priority/interrupt 先不抢占，
        后续由 pet-dev 导演层接管。返回 False 表示 B 无此 clip，调用方回退 A。
        """
        data = payload
        if isinstance(data, str):
            raw = data[5:] if data.startswith("perf:") else data
            try:
                data = json.loads(raw)
            except Exception:
                return False
        if not isinstance(data, dict):
            return False
        beats = data.get("beats") or []
        if not isinstance(beats, list) or not beats:
            return False
        parsed = []
        for b in beats:
            if not isinstance(b, dict):
                continue
            act = b.get("act")
            if act in self._clips:
                parsed.append({
                    "act": str(act),
                    "ms": max(100, int(b.get("ms") or 1000)),
                    "transitionMs": max(0, int(b.get("transitionMs") or 180)),
                })
        if not parsed:
            return False
        self._perf_beats = parsed
        self._perf_index = 0
        self._perf_on_end = str(data.get("onEnd") or "idle")
        self._play_next_perf_beat()
        return True

    def _play_next_perf_beat(self) -> None:
        if not getattr(self, "_perf_beats", None):
            return
        if self._perf_index >= len(self._perf_beats):
            self._perf_beats = []
            if self._perf_on_end == "idle":
                self.applyState("idle")
            return
        beat = self._perf_beats[self._perf_index]
        self._perf_index += 1
        self.playClip(beat["act"], beat.get("transitionMs", 180), False)
        QTimer.singleShot(int(beat.get("ms") or 1000), self._play_next_perf_beat)

    # ------------------------------------------------------------- events
    def _on_ready(self) -> None:
        self._ready = True
        self.ready.emit()
        # 应用启动前缓存的尺寸/点击穿透
        self._page.runJavaScript(f"window.petApi && window.petApi.layout({self._size});")
        if self._pending_clip:
            self.playClip(self._pending_clip, self._pending_fade, self._pending_loop)
        elif "idle" in self._action_map:
            self.playClip(self._action_map["idle"], 120, True)
        if self._click_through:
            QTimer.singleShot(0, lambda: self.setClickThrough(True))
        if self._peek:
            self.setPeek(self._peek)

    def _on_log(self, message: str) -> None:
        if message.startswith("clips="):
            try:
                self._clips = [str(x) for x in self._clips]
            except Exception:
                pass
        print("[webm_body]", message, flush=True)

    def _on_first_frame(self, name: str, t: float) -> None:
        self._current = name
        ms = t
        if self._started_at:
            ms = (__import__("time").monotonic() - self._started_at) * 1000.0
        if self._first_frame is None:
            self._first_frame = ms
        self.firstFrame.emit(name, ms)

    def _begin_drag(self, sx: float, sy: float) -> None:
        if self._view is None or self._click_through:
            return
        self._dragging = True
        self._drag_moved = False
        self._drag_start_pos = QCursor.pos()
        self._drag_offset = QCursor.pos() - self._view.pos()
        self._drag_timer.start()
        self.dragStarted.emit(QCursor.pos())

    def _drag_tick(self) -> None:
        if not self._dragging or self._view is None:
            return
        pos = QCursor.pos() - self._drag_offset
        if (pos - self._view.pos()).manhattanLength() > 2:
            self._drag_moved = True
            self._view.move(pos)
            self.dragMoved.emit(pos)
            self.positionChanged.emit(pos)

    def _end_drag(self) -> None:
        if not self._dragging:
            return
        self._dragging = False
        self._drag_timer.stop()
        self.dragFinished.emit(self._view.pos() if self._view else QPoint())

    def _on_clicked(self) -> None:
        pos = QCursor.pos()
        self.clicked.emit(pos)
        if self.auto_click_clip and not self._drag_moved:
            self.playClip(self._action_map.get("click", "点击回应 - 开心跃动"), 180, True)


# 可选：直接运行本模块做最小 selftest（不进生产）
if __name__ == "__main__":
    from PySide6.QtCore import QTimer as _QT
    from PySide6.QtWidgets import QApplication as _QApp
    app = _QApp(sys.argv)
    b = WebmBody(auto_click_clip=False)
    b.error.connect(lambda e: print("[selftest] error", e))
    b.firstFrame.connect(lambda n, t: print(f"[selftest] firstFrame {n} {t:.0f}ms"))
    b.start()
    _QT.singleShot(8000, app.quit)
    raise SystemExit(app.exec())
