# -*- coding: utf-8 -*-
"""pet_app —— 大肥鱼桌宠入口（task-149 薄入口；task-152 把 main 机械搬到入口）。

运行方式：``python pet/pet_app.py`` 或 PyInstaller entry。
所有实现仍在 pet_window/pet_dialogs/pet_services/pet_utils；这里只做入口命名空间桥接 + main。
"""
from __future__ import annotations

# ruff: noqa: E402, F821, I001
import os
import sys

_here = os.path.dirname(os.path.abspath(__file__))
if _here not in sys.path:
    sys.path.insert(0, _here)

import pet_window as _pw

globals().update({k: v for k, v in vars(_pw).items() if not k.startswith("__")})

def main():
    QApplication.setAttribute(Qt.ApplicationAttribute.AA_ShareOpenGLContexts, True)
    app = QApplication(sys.argv)
    app.setQuitOnLastWindowClosed(False)
    install_qt_translator(app)      # Qt 自带按钮（OK / Cancel…）显示中文
    # 滚轮别改滑块 / 下拉的值：鼠标划过去随手一滚就变了，那是误触
    if ui_console:
        ui_console.install_wheel_guard(app)
    # 窗口 / 任务栏图标：以前一个 setWindowIcon 都没有，任务栏上就是一只空白方块
    if ui_console:
        _ico = ui_console.bundle_icon(BUNDLE_DIR)
        if not _ico.isNull():
            app.setWindowIcon(_ico)

    # 单实例：已经在跑了就把那一只叫出来，不再开第二只（快捷方式 / 源码双击都一样）
    server = None
    try:
        from PySide6.QtNetwork import QLocalServer, QLocalSocket
        probe = QLocalSocket()
        probe.connectToServer(SINGLE_INSTANCE_KEY)
        if probe.waitForConnected(300):
            probe.write(b"show")
            probe.flush()
            probe.waitForBytesWritten(300)
            return 0
        QLocalServer.removeServer(SINGLE_INSTANCE_KEY)
        server = QLocalServer()
        server.listen(SINGLE_INSTANCE_KEY)
    except Exception:
        server = None

    w = PetWindow()
    # 设置窗口里挑的强调色 / 卡片样式是"整个界面"的：这里先套一次，
    # 免得从右键菜单直接开形象库那种老对话框时用的还是默认配色。
    if ui_console:
        try:
            ui_console.set_accent(w.cfg.get("console_accent"))
            ui_console.set_card_style(w.cfg.get("console_card_alpha"),
                                      w.cfg.get("console_card_radius"))
        except Exception:
            pass

    # ---- 大肥鱼 × DSH 联动桥（P1）：把单实例管道升级成“一行 IPC” ----
    # 协议（UTF-8，一行一条，\n 结尾，单行 ≤8KB）：
    #   say:<文本>        冒一句任意文本（≤120 字，queue 排队）
    #   act:<name>        jump / sway / stretch / press / show / hide
    #   cmd:<name>[:v]    mode/size/opacity/layer/topmost/passthrough/locked/
    #                     snap/bubble/freq/quiet/show/hide/snap_into_screen
    #   move:<x>,<y>      绝对坐标（临时停住，不吸附）
    #   peek:<edge>       left / right / top / bottom（只露一部分）
    #   mute:<毫秒>       桥侧静音（只挡 say/act/move/peek/cmd）
    #   ping              回 pong（调试）
    #   其它 / 空 / 旧 show  兼容旧行为：show/raise + 固定句
    PIPE_LINE_MAX = 8192
    PIPE_TEXT_MAX = 120
    bridge_state = {"mute_until": 0.0}
    try:
        w._bridge_bubble_kind = ""      # 气泡情绪样式：normal/inner/report/remind/night/greet/love
    except Exception:
        pass
    # ---- v10：DSH 面板成为唯一控制台；原生托盘/右键菜单默认关闭（cmd:nativeui:on 应急恢复）----
    try:
        w._bridge_allow_native_ui = False
        _tray = getattr(w, "tray", None)
        if _tray is not None:
            _tray.hide()
    except Exception:
        pass
    # ---- P3 C：微动画叠加层状态 + 触发函数（眨眼/爱心/害羞/汗滴/Zzz/眩晕/PNG 序列）----
    try:
        import random as _fx_random
        _fx_root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "fx")
        w._bridge_fx = {
            "blink_until": 0.0,
            "next_blink": time.time() + _fx_random.uniform(3.0, 6.0),
            "hearts": [],
            "shy_until": 0.0,
            "zzz_until": 0.0,
            "sweat_until": 0.0,
            "dizzy_until": 0.0,
            "png_frames": None,
            "png_at": 0.0,
            "png_dur": 0.0,
        }

        def _bridge_fx_play(name):
            fx = getattr(w, "_bridge_fx", None)
            if fx is None:
                return
            now = w._secs()
            if name == "blink":
                fx["blink_until"] = now + 0.11
            elif name in ("love", "heart"):
                fx["hearts"].append([now + 1.8, _fx_random.uniform(-0.14, 0.14)])
                fx["shy_until"] = now + 1.2
            elif name == "shy":
                fx["shy_until"] = now + 1.4
            elif name == "zzz":
                fx["zzz_until"] = now + 8.0
            elif name == "sweat":
                fx["sweat_until"] = now + 1.6
            elif name == "dizzy":
                fx["dizzy_until"] = now + 1.2
            elif name == "spin":
                w.action, w.action_t = "spin", 1.8
                fx["dizzy_until"] = now + 1.4
            elif name.startswith("png:"):
                seq = name[4:].strip()
                frames = []
                folder = os.path.join(_fx_root, seq)
                try:
                    for fn in sorted(os.listdir(folder)):
                        if fn.lower().endswith((".png", ".webp")):
                            pm = QPixmap(os.path.join(folder, fn))
                            if not pm.isNull():
                                frames.append(pm)
                except Exception:
                    frames = []
                fx["png_frames"] = frames or None
                fx["png_at"] = now
                fx["png_dur"] = max(0.6, len(frames) * 0.06) if frames else 0.0
                print("联动桥 FX 序列:", seq, "帧数=", len(frames))
        w._bridge_fx_play = _bridge_fx_play
        print("联动桥 FX 初始化 OK")
    except Exception as _fx_exc:
        print("联动桥 FX 初始化失败:", repr(_fx_exc))

    def _bridge_bool(text):
        return str(text).strip().lower() in ("1", "on", "true", "yes", "开", "是")

    def _bridge_num(text, default):
        try:
            return float(str(text).strip())
        except Exception:
            return default

    def _bridge_keep_place(ms=4000):
        """move/peek 之后先原地待一会儿，别立刻被散步/跟随带走。"""
        try:
            w.target = None
            w.rest_until = w.t * w.tick_ms + int(ms)
        except Exception:
            pass

    def _bridge_screen_geo():
        try:
            scr = w.screen() or QApplication.primaryScreen()
            return scr.availableGeometry()
        except Exception:
            return None

    def _bridge_dispatch(line):
        line = (line or "").strip()
        if not line:
            return "legacy"
        now = time.time()
        try:
            w._last_line_at = now       # task-77：任意管道命令都算"有人在线"
        except Exception:
            pass
        if line.startswith("mute:"):
            try:
                ms = max(0, min(86400000, int(line[5:].strip())))
            except Exception:
                ms = 60000
            bridge_state["mute_until"] = now + ms / 1000.0
            try:
                w._bridge_mute_until = bridge_state["mute_until"]   # 闷声时也不演梗（D3）
            except Exception:
                pass
            return "muted"
        muted = now < bridge_state["mute_until"]

        if line.startswith("say:"):
            if muted:
                return "muted"
            text = " ".join(line[4:].split())[:PIPE_TEXT_MAX]
            if text:
                w._speech_on_reply()       # 插件 LLM 回复到达 → 取消本地兜底
                try:
                    w._anim_log("speech say len=%d" % len(text))
                except Exception:
                    pass
                # 保留当前 bubble kind：既用于情绪色调，也允许 say: 触发对应节拍动作（cmd:style + say）
                w.say(text, seconds=4.0, queue=True)
            return "said"

        if line.startswith("say2:"):
            # say2:<kind>|<文本>  ——  带情绪样式的普通气泡（report/remind/night/greet/love…）
            if muted:
                return "muted"
            body = line[5:]
            kind, _, raw = body.partition("|")
            kind = kind.strip().lower()[:16]
            text = " ".join(raw.split())[:PIPE_TEXT_MAX]
            if text:
                w._bridge_bubble_kind = kind
                w.say(text, seconds=4.0, queue=True)
            return "said2:" + kind

        if line.startswith("say3:"):
            # say3:<秒>|<style>|<文本>  ——  可控停留时长的带样式气泡
            if muted:
                return "muted"
            body = line[5:]
            sec_s, _, rest = body.partition("|")
            style, _, raw = rest.partition("|")
            try:
                sec = max(1.0, min(30.0, float(sec_s)))
            except Exception:
                sec = 4.0
            kind = style.strip().lower()[:16]
            text = " ".join(raw.split())[:PIPE_TEXT_MAX]
            if text:
                w._bridge_bubble_kind = kind
                w.say(text, seconds=sec, queue=True)
            return "said3:" + kind

        if line.startswith("inner3:"):
            # inner3:<秒>|<文本>  ——  可控停留时长的内心气泡
            if muted:
                return "muted"
            body = line[6:]
            sec_s, _, raw = body.partition("|")
            try:
                sec = max(1.0, min(30.0, float(sec_s)))
            except Exception:
                sec = 3.0
            text = " ".join(raw.split())[:PIPE_TEXT_MAX]
            if text:
                w._bridge_bubble_kind = ""
                w.say(text, inner=True, seconds=sec, queue=True)
            return "inner3"

        if line.startswith("inner:"):
            if muted:
                return "muted"
            text = " ".join(line[6:].split())[:PIPE_TEXT_MAX]
            if text:
                w._bridge_bubble_kind = ""
                w.say(text, inner=True, seconds=4.0, queue=True)
            return "inner"

        if line.startswith("dev:"):
            # 开发/取证通道（不出现在正式协议文档；B 身体联调用）
            try:
                _dev = line[4:].strip()
                if _dev.startswith("shotstatic:"):
                    _path = _dev[11:].strip()
                    _sb = getattr(w, "_static_body", None)
                    if _sb is None:
                        return "noStatic"
                    _pm = _sb.grab()
                    _pm.save(_path)
                    return "shotstatic:" + _path
                if _dev.startswith("shotb:"):
                    _path = _dev[6:].strip()
                    _b = getattr(w, "_webm", None)
                    if _b is None or _b._view is None:
                        return "noB"
                    _pm = _b._view.grab()
                    _pm.save(_path)
                    return "shotb:" + _path
                if _dev == "info":
                    import json as _json
                    _b = getattr(w, "_webm", None)
                    return _json.dumps({
                        "body": getattr(w, "_body", ""),
                        "webm": _b is not None,
                        "clips": (len(_b.listClips()) if _b else 0),
                        "current": (_b.currentClip() if _b else ""),
                        "view": (([_b._view.x(), _b._view.y(), _b._view.width(), _b._view.height()]) if (_b and _b._view) else None),
                        "main_visible": bool(w.isVisible()),
                    }, ensure_ascii=False)
                if _dev.startswith("mark:"):
                    _m = _dev[5:].strip()
                    try:
                        w._anim_log("MARK " + _m)
                    except Exception:
                        pass
                    return "mark:" + _m
                if _dev.startswith("bubble:"):
                    _txt = _dev[7:].strip() or "测试气泡"
                    _b = getattr(w, "_webm", None)
                    if _b is None:
                        return "noB"
                    _r = _b.showBubble(_txt, 4.0)
                    try:
                        w._anim_log("dev bubble ret=%s len=%d" % (_r, len(_txt)))
                    except Exception:
                        pass
                    return "bubbleB:%s" % _r
                if _dev.startswith("jseval:"):
                    _code = _dev[7:].strip()
                    _b = getattr(w, "_webm", None)
                    if _b is None:
                        return "noB"
                    _b._page.runJavaScript(
                        _code,
                        lambda _r: w._anim_log("jseval=%s" % (_r,)))
                    return "jsevalB"
                if _dev.startswith("js:"):
                    _code = _dev[3:].strip()
                    _b = getattr(w, "_webm", None)
                    if _b is None:
                        return "noB"
                    _b._page.runJavaScript(_code)
                    return "jsB"
                if _dev.startswith("stateclip:"):
                    _payload = _dev[10:].strip()
                    try:
                        _o = json.loads(_payload)
                    except Exception:
                        _o = {"state": _payload}
                    _name = _o.get("state") or ""
                    _clip = w._webm_state_clip(_name, _o)
                    try:
                        w._anim_log("stateclip=%s toolType=%s -> %s" % (
                            _name, _o.get("toolType", ""), _clip))
                    except Exception:
                        pass
                    return "stateclip:" + _clip
                if _dev.startswith("play:"):
                    _name = _dev[5:].strip()
                    return "playB:" + str(w._webm_play(_name, loop=False))
                if _dev == "click":
                    _b = getattr(w, "_webm", None)
                    if _b is not None and hasattr(_b, "_on_clicked"):
                        _b._on_clicked()
                    else:
                        w._webm_on_clicked(None)
                    return "devclick"
                if _dev.startswith("peek:"):
                    _edge = _dev[5:].strip()
                    if getattr(w, "_webm", None) is not None:
                        w._webm.setPeek(_edge)
                        return "peekB:" + _edge
                    return "noB"
                return "unknownDev:" + _dev[:40]
            except Exception as _dexc:
                return "devErr:" + repr(_dexc)[:80]

        if line.startswith("act:"):
            if muted:
                return "muted"
            act = line[4:].strip().lower()
            if getattr(w, "_body", "png") == "webm" and getattr(w, "_webm", None) is not None:
                raw = line[4:].strip()
                if raw.lower() == "peek":
                    # 用户明确不喜欢静态贴边偷看（只露半只、看起来像坏了）；
                    # DSH 的 tool/read 探一眼改播「东张西望」动态 clip，不再进静态 peek。
                    try:
                        if w._webm_play("东张西望", loop=False):
                            return "actedB:peekClip"
                    except Exception:
                        pass
                    return "actedB:peek"
                if w._webm_play(raw, loop=False):
                    return "actedB:" + raw
            if act in ("jump", "hop"):
                w.jump_t = max(getattr(w, "jump_t", 0.0), 0.6)
            elif act == "sway":
                w.action, w.action_t = "sway", 1.0
            elif act == "stretch":
                w.action, w.action_t = "stretch", 1.0
            elif act == "spin":
                w.action, w.action_t = "spin", 1.2
            elif act in ("shake", "nod"):
                w.action, w.action_t = "shake", 1.0
            elif act == "peek":
                w.action, w.action_t = "sway", 0.7
                w.jump_t = max(getattr(w, "jump_t", 0.0), 0.45)
            elif act in ("eat", "steal", "sneak", "sleep", "wake", "wave", "dance", "turn", "feed", "come"):
                # 鲸鱼娘 2D 帧动作：eat / steal(偷吃) / sleep / wave / dance / turn
                try:
                    if act in ("eat", "feed"):
                        w._speech_request("feed", {"subkind": act})
                    elif act == "come":
                        w._speech_request("come", {"phase": "come"})
                    elif act == "steal":
                        w._speech_request("stealCaught", {"subkind": "steal"})
                except Exception:
                    pass
                clip = {"steal": "sneak", "feed": "eat", "come": "wave"}.get(act, act)
                if getattr(w, "_whale_active", lambda: False)() and w._whale_force_play(clip):
                    return "acted:" + act
                return "unknownact:" + act
            elif act in ("press", "squash"):
                w.press_t = 1.0
            elif act == "show":
                w.show()
                w.raise_()
            elif act == "hide":
                w.hide()
            elif getattr(w, "_whale_active", lambda: False)():
                # D1：任意 clip / composite 直通（pat/caught/tsundere/report/fall/land/cry/think…）；
                # 梗动作在深夜 23:30–08:00 / 免打扰 / 静音时只回 idle（28 §4.8）
                _clip = {"steal": "sneak"}.get(act, act)
                _basic = ("sleep", "wake", "idleBase", "walk", "drag", "fall", "land")
                if (act in _basic or w._whale_gag_ok()) and w._whale_force_play(_clip):
                    return "acted:" + act
                return "gagged:" + act
            else:
                return "unknownact:" + act
            return "acted:" + act

        if line.startswith("move:"):
            if muted:
                return "muted"
            try:
                x, y = [int(float(v)) for v in line[5:].split(",")]
                if abs(x) > 100000 or abs(y) > 100000:
                    return "badmove"
                _bridge_keep_place()
                w.move(x, y)
                return "moved"
            except Exception:
                return "badmove"

        if line.startswith("peek:"):
            if muted:
                return "muted"
            edge = line[5:].strip().lower()
            if getattr(w, "_body", "png") == "webm" and getattr(w, "_webm", None) is not None:
                if edge in ("left", "l"):
                    w._webm.setPeek("left")
                elif edge in ("right", "r"):
                    w._webm.setPeek("right")
                else:
                    w._webm.setPeek(None)
                try:
                    w._anim_log("webm peek=%s pending=%s" % (
                        w._webm.peekState(), w._webm.pendingClip()))
                except Exception:
                    pass
                return "peekB:" + edge
            geo = _bridge_screen_geo()
            if geo is None:
                return "nogeo"
            _bridge_keep_place()
            ww, wh = w.width(), w.height()
            if edge in ("left", "l"):
                w.move(int(geo.left() - ww * 0.55), w.y())
            elif edge in ("right", "r"):
                w.move(int(geo.right() - ww * 0.45), w.y())
            elif edge in ("top", "up", "t"):
                w.move(w.x(), int(geo.top() - wh * 0.45))
            elif edge in ("bottom", "down", "b"):
                w.move(w.x(), int(geo.bottom() - wh * 0.55))
            else:
                return "unknownpeek:" + edge
            return "peek:" + edge

        if line.startswith("walk:"):
            if muted:
                return "muted"
            geo = _bridge_screen_geo()
            if geo is None:
                return "nogeo"
            try:
                ww, wh = w.width(), w.height()
                spec = line[5:].strip().lower()
                cx = cy = None
                if "," in spec:
                    cx, cy = [int(float(v)) for v in spec.split(",", 1)]
                elif spec in ("nearby", "near"):
                    cx = w.x() + ww // 2 + random.choice((-1, 1)) * random.randint(40, 110)
                    cy = w.y() + wh // 2 + random.choice((-1, 1)) * random.randint(10, 45)
                elif spec in ("center", "middle"):
                    cx = geo.left() + geo.width() // 2
                    cy = geo.top() + geo.height() // 2 + 40
                elif spec in ("left", "l"):
                    cx = geo.left() + ww // 2 + 20
                    cy = geo.top() + geo.height() // 2
                elif spec in ("right", "r"):
                    cx = geo.right() - ww // 2 - 20
                    cy = geo.top() + geo.height() // 2
                elif spec in ("top", "up", "t"):
                    cx = geo.left() + geo.width() // 2
                    cy = geo.top() + wh // 2 + 20
                elif spec in ("bottom", "down", "b"):
                    cx = geo.left() + geo.width() // 2
                    cy = geo.bottom() - wh // 2 - 20
                elif spec in ("corner", "bottomright", "br"):
                    cx = geo.right() - ww // 2 - 16
                    cy = geo.bottom() - wh // 2 - 16
                if cx is None or cy is None:
                    return "badwalk"
                w.rest_until = 0
                w.target = (int(cx), int(cy))
                return "walking"
            except Exception:
                return "badwalk"

        if line.startswith("freeze:"):
            if muted:
                return "muted"
            try:
                ms = max(0, min(60000, int(float(line[7:].strip()))))
            except Exception:
                ms = 1500
            try:
                w.target = None
                w.rest_until = w.t * w.tick_ms + ms
            except Exception:
                pass
            return "frozen:" + str(ms)

        if line.startswith("bal:"):
            # bal:<余额>|<今日已用> —— DSH 插件推送的余额/今日已用（不依赖桌宠自己的 key）
            if muted:
                return "muted"
            body = line[4:].strip()
            bal_txt, _, used_txt = body.partition("|")
            show = "余额 " + (bal_txt.strip() or "不可查") + " · 今日 " + (used_txt.strip() or "—")
            w._bridge_bubble_kind = "report"
            w.say(show[:PIPE_TEXT_MAX], seconds=8.0, queue=True)
            return "bal"

        if line.startswith("state:"):
            # state:<json> —— DSH 插件推送的实时状态（thinking/tool/approval/background/error/done/idle）
            try:
                _st = json.loads(line[6:])
                w._bridge_state = _st
                _name = str(_st.get("state") or "")
                # B 身体：状态 → B clip（主路径）；A 映射保留给 png 回退
                if getattr(w, "_body", "png") == "webm" and getattr(w, "_webm", None) is not None:
                    try:
                        w._webm_apply_state(_name, _st)
                    except Exception:
                        pass
                # 鲸鱼娘 2D 帧动画：DSH 状态 → 动作（thinking/tool/waiting/done/error 等）
                _whale_map = {
                    "thinking": "think",
                    "tool": "hum",          # tool 不再 walk：站桩哼歌（生产热补丁收编）
                    "waiting_approval": "waitPeek",
                    "approval": "waitPeek",
                    "waiting_input": "waitPeek",
                    "done": "celebrate",    # 庆祝由 _anim_celebrate 3 阶段编排
                    "error": "errorSequence",
                    "cry": "cry",
                    "disconnected": "lonelySit",
                }
                try:
                    if _name in ("thinking", "tool") and not getattr(w, "_task_started_at", 0.0):
                        w._task_started_at = time.time()
                except Exception:
                    pass
                _wh = getattr(w, "_whale", None)
                _mapped = _whale_map.get(_name) if _name else None
                if _name in ("idle", "background", ""):
                    if getattr(w, "_celebration", None) is None:
                        w._whale_clear_force()
                elif _wh is not None and _mapped and _wh.has(_mapped):
                    try:
                        _gagged = bool(w._whale_gag_ok())
                    except Exception:
                        _gagged = True
                    if _gagged or _name in ("approval", "waiting_approval", "waiting_input"):
                        # 正常时段按映射演；深夜/免打扰/静音时 approval/waiting_input 是 S0 关键提示，仍保留
                        if getattr(w, "_whale_force", None) != _mapped:
                            w._whale_force_play(_mapped)
                    else:
                        # CF2：深夜/免打扰/静音降级 —— 只留 idleBase/呼吸，不演 think/walk/waitPeek/
                        # cheer/errorSequence/cry；气泡仍走下方 approval/error 分支（不额外冒泡）
                        w._whale_clear_force()
                        if _wh.cur != "idleBase":
                            _wh.play("idleBase")
                # 完成：庆祝 3 阶段 + LLM 台词（固定"完成啦"仅故障兜底）
                if _name == "done":
                    try:
                        w._speech_request("celebrate", {"phase": "done"})
                    except Exception:
                        pass
                    try:
                        w._anim_celebrate()
                    except Exception:
                        pass
                # 让 DSH 联动"看得见"：状态切换一句短气泡（45s 冷却；深夜/免打扰闭嘴）——生产热补丁收编
                try:
                    _now2 = time.time()
                    _last_name = str(getattr(w, "_bridge_state_last", "") or "")
                    if _name != _last_name:
                        w._bridge_state_last = _name
                        _lines = {
                            "thinking": "在想呢…",
                            "tool": "看到你在跑命令啦",
                        }
                        _txt2 = _lines.get(_name) or ""
                        if _txt2:
                            _allowed = True
                            try:
                                _allowed = bool(w._whale_gag_ok()) or _name in ("error", "waiting_input")
                            except Exception:
                                _allowed = True
                            _last_at = float(getattr(w, "_bridge_say_at_" + _name, 0.0) or 0.0)
                            if _allowed and (_now2 - _last_at) >= 45.0:
                                setattr(w, "_bridge_say_at_" + _name, _now2)
                                w._bridge_bubble_kind = "report" if _name in ("tool", "done") else ("remind" if _name in ("error", "waiting_input") else "inner")
                                w.say(_txt2, seconds=3.2, queue=True)
                except Exception:
                    pass
                if _name in ("approval", "waiting_approval"):
                    w._bridge_bubble_kind = "remind"
                    w._speech_request("approvalWait", {"phase": "waiting", "s0": True},
                                      fallback="我在等你的确认哦")
                elif _name == "error":
                    try:
                        w._bridge_fx_play("sweat")
                    except Exception:
                        pass
            except Exception:
                pass
            return "state"
        if line.startswith("enh:") or line.startswith("phys:") or line.startswith("edge:"):
            # A 路线验收/测试通道（不影响正常协议）
            if muted:
                return "muted"
            _act, _, _val = line.partition(":")
            return w._enh_bridge(_act.strip().lower(), _val.strip())
        if line.startswith("cmd:"):
            if muted:
                return "muted"
            body = line[4:].strip()
            name, _, val = body.partition(":")
            name = name.strip().lower()
            val = val.strip()
            try:
                if name == "mode" and val in ("wander", "follow", "still"):
                    w.set_mode(val)
                elif name == "body" and val in ("webm", "png"):
                    return ("body:" + val + ":" + str(w.set_body(val)))
                elif name == "size":
                    w.set_size(_bridge_num(val, 0.7))
                elif name == "opacity":
                    w.set_opacity(_bridge_num(val, 1.0))
                elif name == "layer" and val in ("top", "bottom", "normal"):
                    w.set_layer(val)
                elif name == "topmost":
                    w.set_topmost(_bridge_bool(val))
                elif name == "passthrough":
                    w.set_passthrough(_bridge_bool(val))
                elif name == "locked":
                    w.set_locked(_bridge_bool(val))
                elif name == "snap":
                    w.set_snap(_bridge_bool(val))
                elif name == "bubble" and val in ("auto", "light", "dark"):
                    w.set_bubble_style(val)
                elif name == "freq" and val in ("安静", "正常", "话多", "话痨"):
                    w.set_line_freq(val)
                elif name == "quiet":
                    if val in ("off", "0", "stop", "false"):
                        w.stop_quiet()
                    else:
                        w.start_quiet(int(_bridge_num(val, 30)))
                elif name == "show":
                    w.show()
                    w.raise_()
                elif name == "hide":
                    w.hide()
                elif name == "region" and val in ("head", "body", "tail"):
                    if hasattr(w, "_bridge_zone_reaction"):
                        w._bridge_zone_reaction(val)
                elif name == "style":
                    w._bridge_bubble_kind = val[:16]
                elif name == "fx":
                    if hasattr(w, "_bridge_fx_play"):
                        w._bridge_fx_play(val)
                elif name == "config":
                    try:
                        _spec = json.loads(val) if val else {}
                    except Exception:
                        return "badconfig"
                    _applied, _failed = [], []
                    _map = {
                        "size": ("set_size", float), "opacity": ("set_opacity", float),
                        "mode": ("set_mode", str), "lineFreq": ("set_line_freq", str),
                        "bubbleStyle": ("set_bubble_style", str), "passthrough": ("set_passthrough", bool),
                        "locked": ("set_locked", bool), "topmost": ("set_topmost", bool),
                        "snap": ("set_snap", bool), "layer": ("set_layer", str),
                        "skin": ("set_skin", str), "soundOn": ("set_sound", bool),
                        "volume": ("set_volume", float), "musicLink": ("set_music_link", bool),
                        "doubleClick": ("set_double_click", str),
                        "renderEnhance": ("set_render_enhance", bool),
                    }
                    for _k, _v in _spec.items():
                        if _k == "quiet":
                            try:
                                if _v in (0, False, "off", "stop"):
                                    w.stop_quiet()
                                else:
                                    w.start_quiet(int(float(_v)))
                                _applied.append("quiet")
                            except Exception:
                                _failed.append("quiet")
                            continue
                        if _k == "city":
                            try:
                                w.cfg["city"] = str(_v)
                                _applied.append("city")
                            except Exception:
                                _failed.append("city")
                            continue
                        _item = _map.get(_k)
                        if not _item:
                            _failed.append(_k)
                            continue
                        _m, _cast = _item
                        if not hasattr(w, _m):
                            _failed.append(_k)
                            continue
                        try:
                            _val = _v if _cast is bool else _cast(_v)
                            getattr(w, _m)(_val)
                            _applied.append(_k)
                        except Exception:
                            _failed.append(_k)
                    print("联动桥 config:", _applied, _failed)
                    return "config:" + ",".join(_applied) + ("|fail:" + ",".join(_failed) if _failed else "")
                elif name == "exit":
                    try:
                        QTimer.singleShot(0, QApplication.instance().quit)
                    except Exception:
                        pass
                    return "exit"
                elif name == "restart":
                    try:
                        _exe = sys.executable
                        _script = os.path.abspath(__file__)
                        subprocess.Popen([_exe, _script], cwd=os.path.dirname(_script), close_fds=True)
                    except Exception:
                        pass
                    try:
                        QTimer.singleShot(200, QApplication.instance().quit)
                    except Exception:
                        pass
                    return "restart"
                elif name == "nativeui":
                    on = _bridge_bool(val)
                    w._bridge_allow_native_ui = on
                    try:
                        _tray = getattr(w, "tray", None)
                        if _tray is not None:
                            _tray.setVisible(on)
                    except Exception:
                        pass
                    return "nativeui:" + ("on" if on else "off")
                elif name == "balance":
                    try:
                        if not (w.cfg.get("ds_api_key") or ""):
                            w._bridge_bubble_kind = "report"
                            w.say("余额已迁到 DSH 面板查看", seconds=6.0, queue=True)
                            return "balance-nokey"
                        w.refresh_balance(silent=False)
                        if hasattr(w, "show_balance_bubble"):
                            w.show_balance_bubble(5)
                        return "balance"
                    except Exception:
                        return "balance-fail"
                elif name == "weather":
                    try:
                        w._get_weather()
                    except Exception:
                        return "weather-fail"
                elif name == "music":
                    try:
                        w.check_music_now()
                    except Exception:
                        return "music-fail"
                elif name == "summary":
                    try:
                        _rp = os.path.join(USER_DIR, "daily_receipt.txt")
                        _lines = [ln.strip() for ln in open(_rp, "r", encoding="utf-8").read().splitlines() if ln.strip()] if os.path.exists(_rp) else []
                        _txt = "；".join(_lines[:4]) if _lines else "今天还没记账呢"
                        w._bridge_bubble_kind = "report"
                        w.say(_txt[:PIPE_TEXT_MAX], seconds=10.0, queue=True)
                    except Exception:
                        return "summary-fail"
                elif name == "recover":
                    try:
                        w.snap_into_screen()
                        w.show()
                        w.raise_()
                    except Exception:
                        return "recover-fail"
                elif name == "snap_into_screen":
                    w.snap_into_screen()
                else:
                    return "unknowncmd:" + name
                return "cmd:" + name
            except Exception as exc:
                print("联动桥 cmd 失败:", name, repr(exc))
                return "cmderr:" + name

        if line.startswith("life:"):
            # life:status|offline|wake|after:<ms> —— 失联休眠查询/测试（task-77；只在本机管道）
            body = line[5:].strip().lower()
            try:
                if body.startswith("after:"):
                    try:
                        ms = max(1000, min(3600000, int(float(body[6:].strip()))))
                    except Exception:
                        return "badlife"
                    w.lifecycle["offlineAfterMs"] = ms
                    return "life:after:" + str(ms)
                if body == "offline":
                    # 立刻睡：把"最近一次命令时间"拨到阈值之外，下一 tick 进入打盹
                    w._last_line_at = time.time() - w.lifecycle["offlineAfterMs"] / 1000.0 - 1.0
                    return "life:offline"
                if body == "wake":
                    w._last_line_at = time.time()
                    w._life_wake()
                    return "life:wake"
                if body == "status":
                    _w = getattr(w, "_whale", None)
                    return "life:" + json.dumps({
                        "offline": bool(getattr(w, "_life_offline", False)),
                        "silentMs": int(getattr(w, "_life_silent_ms", 0)),
                        "offlineAfterMs": int(w.lifecycle.get("offlineAfterMs", 120000)),
                        "exitWithDsh": bool(w.lifecycle.get("exitWithDsh", False)),
                        "exitAfterMs": int(w.lifecycle.get("exitAfterMs", 600000)),
                        "clip": str(getattr(_w, "cur", "") if _w is not None else ""),
                        "force": str(getattr(w, "_whale_force", "") or ""),
                    }, ensure_ascii=False, separators=(",", ":"))
                return "badlife"
            except Exception:
                return "lifeerr"

        if line == "ping":
            return "pong"

        # 旧客户端（再点一次快捷方式）或无法识别的行：保持原行为
        w.show()
        w.raise_()
        w.say("我在这儿呢，有我这只就够啦")
        return "legacy"

    if server is not None:
        def on_new_connection():
            sock = server.nextPendingConnection()
            if sock is None:
                return
            state = {"done": False}

            def _finish(raw_bytes):
                if state["done"]:
                    return
                state["done"] = True
                try:
                    text = bytes(raw_bytes)[:PIPE_LINE_MAX].decode("utf-8", "replace")
                except Exception:
                    text = ""
                line = text.split("\n", 1)[0].rstrip("\r")
                try:
                    _res = _bridge_dispatch(line)
                except Exception as exc:
                    _res = None
                    print("联动桥处理失败:", repr(exc))
                if _res is not None:
                    print("联动桥:", _res)
                _raw = line.strip()
                if _res == "pong" or _raw.startswith("life:"):
                    try:                    # ping 回 pong；life: 回一行文本（供 --read-reply 断言）
                        sock.write(((_res or "") + "\n").encode("utf-8"))
                        sock.flush()
                        sock.waitForBytesWritten(150)
                    except Exception:
                        pass
                try:
                    sock.disconnectFromServer()
                except Exception:
                    pass

            def _read():
                if state["done"]:
                    return
                try:
                    raw = bytes(sock.readAll())
                except Exception:
                    raw = b""
                _finish(raw)

            sock.readyRead.connect(_read)
            QTimer.singleShot(400, lambda: _finish(b""))
        server.newConnection.connect(on_new_connection)

    sys.exit(app.exec())


if __name__ == "__main__":
    raise SystemExit(main())

