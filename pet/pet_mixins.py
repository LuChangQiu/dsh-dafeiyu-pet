# -*- coding: utf-8 -*-
"""PetWindow 方法 mixin（task-152 机械搬迁；逻辑未改）。

每个方法从 pet_window.PetWindow 原地搬到对应语义 Mixin，PetWindow 通过
``class PetWindow(PetWindowMixins, QWidget)`` 继承；方法里的模块级名字由
pet_window 末尾的命名空间桥接回填。
"""
from __future__ import annotations

# ruff: noqa: F401, F821
import pet_window as _pw

globals().update({k: v for k, v in vars(_pw).items() if not k.startswith("__")})

class PetAnimMixin:
    def _whale_active(self):
        """鲸鱼娘帧动画是否接管绘制：资产可用 + 用户没选挂件/自定义形象（不静默覆盖）。"""
        w = getattr(self, "_whale", None)
        if w is None or not getattr(w, "ok", False):
            return False
        if getattr(self, "skin", SKIN_PET) == SKIN_WIDGET:
            return False
        try:
            if self._current_skin_ref("pet"):
                return False      # 用户自己的三维形象优先，鲸鱼娘不覆盖
        except Exception:
            pass
        wcfg = getattr(self, "cfg", {}).get("whale")
        if isinstance(wcfg, dict) and wcfg.get("on", True) is False:
            return False
        return True


    def _whale_gag_ok(self):
        """现在能不能演"梗"：深夜 23:30–08:00 / 免打扰 / 全屏 / 桥侧静音只留基础待机（28 §4.8）。"""
        try:
            if self._hold_now():
                return False
            if time.time() < float(getattr(self, "_bridge_mute_until", 0.0) or 0.0):
                return False
            hh = time.localtime().tm_hour * 60 + time.localtime().tm_min
            if hh >= 23 * 60 + 30 or hh < 8 * 60:
                return False
        except Exception:
            return True
        return True


    def _whale_play(self, name, restart=True):
        """外部（act: 指令）触发一次帧动作；返回是否播放成功。"""
        w = getattr(self, "_whale", None)
        if w is None or not w.has(name):
            return False
        w.play(name, restart=restart)
        return True


    def _whale_force_play(self, name):
        """强制播放一次 clip/composite（用户操作 / DSH 状态 / 演出共用）；返回是否可播。

        重复设置同名动作不重置"保持末帧"计时：播完保持末帧等状态变化；
        单次动作保持多久见 _WHALE_HOLD_S（缺省 = 播完回 idle）。
        """
        w = getattr(self, "_whale", None)
        if w is None or not w.has(name):
            return False
        if getattr(self, "_whale_force", None) != name:
            self._whale_force = name
            self._whale_hold_until = 0.0
        return True


    def _whale_clear_force(self):
        self._whale_force = None
        self._whale_hold_until = 0.0


    def _whale_fall_land(self, hard=False):
        """A 线落地：先播 land 压扁回弹；硬摔且允许演梗时接 cry（30 分钟冷却，深夜不演）。"""
        w = getattr(self, "_whale", None)
        if w is None or not self._whale_active():
            return
        now = self._secs()
        if hard and w.has("cry") and self._whale_gag_ok() and now >= getattr(self, "_whale_cry_cd", 0.0):
            self._whale_cry_cd = now + 1800.0          # 29 §2.3：摔哭冷却 30 分钟
            if self._whale_force_play("cry"):
                self._bridge_bubble_kind = ""
                self.say("呜……摔疼了啦", seconds=3.8)
                return
        if w.has("land"):
            self._whale_force_play("land")


    def _anim_log(self, msg):
        _p = getattr(self, "_anim_log_path", "")
        if not _p:
            return
        try:
            with open(_p, "a", encoding="utf-8") as f:
                f.write("%.3f [anim] %s\n" % (time.time(), msg))
        except Exception:
            pass


    def _webm_height(self):
        try:
            sz = float(self.cfg.get("size", 0.2) or 0.2)
        except (TypeError, ValueError):
            sz = 0.2
        _base = float(pet_defaults.config_get(self.cfg, "whale", "displayHeight", default=pet_defaults.DISPLAY_H))
        # 验收：B 人物显示身高 184±10px（窗口固定 168×198）
        return max(174, min(194, int(round(_base * max(0.85, min(1.0, sz / 0.2))))))


    def _init_webm_body(self):
        if _webm_body is None:
            raise RuntimeError('webm_body module missing')
        try:
            self._anim_log("webm init: assets=%s" % getattr(_webm_body, 'ASSETS_DIR', '?'))
        except Exception:
            pass
        b = _webm_body.WebmBody(auto_click_clip=True)
        try:
            self._anim_log("webm init: view=%s assets=%s clips=%d" % (
                b._view is not None, b.assets_dir, len(b.listClips())))
        except Exception:
            pass
        b.error.connect(self._webm_on_error)
        b.clicked.connect(self._webm_on_clicked)
        b.positionChanged.connect(self._webm_on_pos)
        b.dragFinished.connect(self._webm_on_drag_finished)
        b.firstFrame.connect(self._webm_on_first_frame)
        try:
            b.clipChanged.connect(lambda n: self._anim_log("webm clip=%s" % n))
        except Exception:
            pass
        b.start(show=False)
        _w = pet_defaults.whale_defaults(self.cfg)
        b.setSize(_w["windowW"], _w["windowH"], self._webm_height())
        b.setFadeMs(_w["fadeMs"])
        b.setFootAnchor(_w["footAnchor"])
        # 初始位置：屏幕右下角（宠物区），主窗（168×198，气泡层）同位置
        try:
            _scr = QApplication.primaryScreen().availableGeometry()
            _bx = int(_scr.right() - _w["windowW"] - 24)
            _by = int(_scr.bottom() - _w["windowH"] - 8)
            b.setPosition(_bx, _by)
            self.move(_bx, _by)
        except Exception:
            pass
        b.start(show=True)
        self._webm = b
        self._body = "webm"
        self._whale = None            # A 外观不再展示
        self.mode = "still"           # B 原型：静息为主，不做 A 的散步位移
        self._apply_main_click_through(True)
        self._webm_sync_main()
        try:
            self.hide()          # B 模式：旧 A QWidget 窗口不显示
        except Exception:
            pass
        try:
            v = b._view
            self._anim_log("webm init done: visible=%s geom=%s,%s,%sx%s" % (
                bool(v.isVisible()) if v else '?', v.x() if v else -1, v.y() if v else -1,
                v.width() if v else -1, v.height() if v else -1))
        except Exception:
            pass
        try:
            self._anim_log("body=webm size=%d" % self._webm_h)
        except Exception:
            pass


    def _webm_sync_main(self):
        try:
            b = self._webm
            if b is None or b._view is None:
                return
            vp = b.position()
            self.move(int(vp.x()), int(vp.y()))
        except Exception:
            pass


    def _webm_on_first_frame(self, name, ms):
        _first = not self._webm_ready
        self._webm_ready = True
        if _first:
            try:
                self._anim_log("webm firstFrame clip=%s ms=%.0f" % (name, ms))
            except Exception:
                pass
        # B 规范：clip 切换 120ms（覆盖包内首次 180ms）；只覆盖一次，避免 firstFrame 回环重载
        if not getattr(self, "_webm_idle_fade_fixed", False):
            self._webm_idle_fade_fixed = True
            try:
                self._webm.playClip("待机呼吸休闲", 120, True)
            except Exception:
                pass


    def _webm_on_error(self, msg):
        print("[webm] error:", msg, flush=True)
        try:
            self._anim_log("webm error %s" % msg)
        except Exception:
            pass


    def _webm_on_clicked(self, pos=None):
        try:
            self._anim_log("webm clicked pos=%s -> speech_request(click)" % (pos,))
        except Exception:
            pass
        try:
            self._speech_request("click", {"phase": "click"})
        except Exception:
            pass
        try:
            self._anim_log("webm click clip via module auto_click_clip")
        except Exception:
            pass


    def _webm_on_pos(self, _pos=None):
        self._webm_sync_main()


    def _webm_on_drag_finished(self, pos=None):
        try:
            self._anim_log("webm dragFinished pos=%s" % (pos,))
        except Exception:
            pass
        try:
            self.cfg["x"] = int(pos.x())
            self.cfg["y"] = int(pos.y())
        except Exception:
            pass
        self._webm_sync_main()


    def _webm_play(self, act, loop=None):
        b = getattr(self, "_webm", None)
        if b is None:
            return False
        name = str(act or "")
        mapped = None
        try:
            mapped = self._webm_map_act(name)
        except Exception:
            mapped = None
        try:
            self._anim_log("webm act=%s -> %s peek=%s pending=%s" % (
                name, mapped, (self._webm.peekState() if getattr(self, "_webm", None) else ""),
                (self._webm.pendingClip() if getattr(self, "_webm", None) else "")))
        except Exception:
            pass
        if loop is None:
            loop = (mapped or name) in ("待机呼吸休闲", "认真工作", "工作思考", "工作摸鱼",
                                        "working", "thinking", "tool")
        return b.playClip(mapped or name, 120, bool(loop))


    def _webm_map_act(self, name):
        n = str(name or "")
        m = {
            "idleBase": "待机呼吸休闲", "idle": "待机呼吸休闲", "background": "待机呼吸休闲",
            "walk": "待机呼吸休闲", "turnStop": "东张西望", "idleShift": "工作摸鱼",
            "idleSettle": "东张西望", "idleStretch": "超大伸懒腰", "hum": "悠闲哼歌",
            "think": "工作思考", "thinking": "工作思考", "tool": "认真工作",
            "waitPeek": "东张西望", "waiting": "东张西望", "waiting_input": "工作被打扰",
            "waiting_approval": "东张西望", "approvalWait": "东张西望", "waitingInput": "工作被打扰",
            "disconnected": "待机呼吸休闲", "unavailable": "待机呼吸休闲",
            "approval": "东张西望", "done": "工作结束", "success": "工作结束",
            "cheer": "女仆屈膝礼仪", "error": "工作被打扰", "errorSequence": "工作被打扰",
            "cry": "被吓一跳（炸毛）", "caught": "摸鱼被抓", "pat": "点击回应 - 害羞惊讶",
            "poke": "点击回应 - 开心跃动", "tsundere": "点击回应 - 傲娇生气（侧身展示）",
            "tail": "用鲸鱼尾巴拍打地面", "eat": "吃小鱼干", "eatSatisfied": "吃盒饭",
            "sleep": "睡觉第一段", "wake": "睡眼惺忪", "drag": "被鼠标拖拽悬空反馈",
            "fall": "被吓一跳（炸毛）", "land": "工作结束", "dance": "小幅度原地 360 度旋转展示",
            "wave": "点击回应 - 开心跃动", "report": "翻钱包", "note": "东张西望",
            "lonelySit": "原地小憩沉眠", "sneak": "摸鱼被抓", "jump": "原地跳跃抓碎头顶物品",
        }
        if n in m:
            return m[n]
        # OP-MATRIX/原生 B clip 名直通
        return n


    def _webm_state_clip(self, name, st=None):
        """纯函数：DSH state/上下文 → B clip 名（不播放；单测/证据用）。"""
        n = str(name or "")
        if n == "tool":
            tool = str((st or {}).get("toolType") or (st or {}).get("tool") or "")
            if any(k in tool for k in ("bash", "command", "shell", "terminal")):
                return "原地敲击桌面互动"
            if any(k in tool for k in ("search", "grep", "find")):
                return "东张西望"
            return "认真工作"
        return self._webm_map_act(n)


    def _webm_apply_state(self, name, st=None):
        b = getattr(self, "_webm", None)
        if b is None:
            return False
        n = str(name or "")
        clip = self._webm_state_clip(n, st)
        try:
            _tt = str((st or {}).get("toolType") or (st or {}).get("tool") or "")
            self._anim_log("webm state=%s toolType=%s -> %s" % (n, _tt, clip))
        except Exception:
            pass
        loop = clip in ("待机呼吸休闲", "认真工作", "工作思考", "工作摸鱼")
        return b.playClip(clip, 120, loop)


    def _smooth_tick_rate(self):
        """walk/过渡期 60Hz tick（亚像素位移更顺）；静止恢复标准 tick。"""
        try:
            if not getattr(self, "perf_mode", True):
                return
            fast = bool(self.target is not None and not self.dragging)
            if not fast:
                w = getattr(self, "_whale", None)
                try:
                    fast = w is not None and w.fade_alpha() is not None
                except Exception:
                    fast = False
            want = 16 if fast else 20
            if int(getattr(self, "tick_ms", 20) or 20) != want:
                self.tick_ms = want
                self.timer.setInterval(want)
        except Exception:
            pass


    def _anim_celebrate(self):
        """done/完成：跳起→落地→举双手/转圈 3 阶段 + 爱心 FX + 气泡（1.5–3s）。"""
        w = getattr(self, "_whale", None)
        if w is None or not self._whale_active() or self.dragging:
            return False
        try:
            if not self._whale_gag_ok():
                return False
        except Exception:
            pass
        stages = self._smooth.celebration_stages() if self._smooth else ()
        if not stages:
            return False
        _now_w = time.time()
        _mode = 'short'
        try:
            _mode = self._smooth.celebration_mode(
                _now_w,
                cd_until=getattr(self, "_celebrate_cd_until", 0.0),
                task_started_at=getattr(self, "_task_started_at", 0.0),
            )
        except Exception:
            _mode = 'short'
        if _mode != 'full':
            # 短反应 ≤0.8s：不 jump；动作/请求 kind 轮换（V5 复读修复）
            _cycle = ("pat", "hum", "idleSettle")
            _kinds = ("praise", "report", "pat")
            _i = int(getattr(self, "_short_done_i", 0))
            _act = _cycle[_i % len(_cycle)]
            self._short_done_i = _i + 1
            if w.has(_act):
                self._whale_force_play(_act)
                try:
                    _st = w.action_stats(_act)
                    _total = (_st[2] / 1000.0) if _st and _st[2] else 0.8
                except Exception:
                    _total = 0.8
                self._dialog_force = _act
                self._dialog_until = self._secs() + max(0.35, min(0.8, _total * 1.05))
            try:
                self._speech_request(_kinds[_i % len(_kinds)],
                                     {"phase": "doneShort", "subkind": _kinds[_i % len(_kinds)]})
            except Exception:
                pass
            try:
                self._anim_log("celebrate short mode=%s act=%s" % (_mode, _act))
            except Exception:
                pass
            return False
        self._celebrate_cd_until = _now_w + 120.0
        self._celebration = {"stage": 0, "t0": self._secs()}
        self._celebrate_stage_at = self._secs()
        self._anim_log("celebrate start stages=%d totalMs=%s" % (
            len(stages), self._smooth.celebration_total_ms() if self._smooth else "?"))
        self._whale_force_play(stages[0]["action"])
        try:
            self._bridge_fx_play("love")
        except Exception:
            pass
        self._bridge_bubble_kind = "report"
        self._speech_request("celebrate", {"phase": "celebrate"}, fallback="完成啦！")
        return True


    def _anim_dialog(self, kind):
        """气泡 kind → 微动作（点头/歪头/害羞/摆手）；不抢 S0/庆祝通道。"""
        if getattr(self, "_celebration", None) is not None:
            return False
        w = getattr(self, "_whale", None)
        if w is None or not self._whale_active() or self.dragging:
            return False
        if self._smooth is None:
            return False
        act = self._smooth.dialog_action(kind)
        if not act or not w.has(act):
            return False
        force = getattr(self, "_whale_force", None)
        if force in ("think", "waitPeek", "errorSequence", "sleep", "cry"):
            return False
        # 多拍编排：首拍立即起（动作先起、气泡同帧到），后续拍按 gap 入队
        try:
            _beats = self._smooth.dialog_beats(kind) if self._smooth else ((act, 0),)
        except Exception:
            _beats = ((act, 0),)
        if not _beats:
            _beats = ((act, 0),)
        _first = _beats[0][0]
        if not w.has(_first):
            _first = act
        if self._whale_force_play(_first):
            self._anim_log("dialog kind=%s beats=%d first=%s" % (kind, len(_beats), _first))
            self._dialog_force = _first
            try:
                _st = w.action_stats(_first)
                _total = (_st[2] / 1000.0) if _st and _st[2] else 0.9
            except Exception:
                _total = 0.9
            self._dialog_until = self._secs() + max(0.45, min(1.6, _total * 1.05))
            self._dialog_queue = []
            _t = self._dialog_until
            for _a, _gap in _beats[1:]:
                _t += max(0.08, float(_gap) / 1000.0)
                self._dialog_queue.append((_a, _t))
            return True
        return False


    def _whale_tick(self):
        """把桌宠状态翻译成帧动作；素材只是表现层，异常绝不打断主循环。"""
        w = getattr(self, "_whale", None)
        if w is None or not self._whale_active():
            return
        try:
            now = time.time()
            # 用户操作优先：拖拽/抛掷一开始就清掉外部强制动作（act: 播一半也打断）
            if self.dragging:
                self._whale_clear_force()
                if getattr(self, "_life_offline", False):
                    self._life_wake()       # 被拎起来就醒（_life_wake 内刷新心跳，不会立刻睡回去）
                    self._whale_clear_force()
            force = self._whale_force
            # 事件动画通道：庆祝 3 阶段（jump→land→cheer）优先于 work/idle；对话动作短时占用
            if getattr(self, "_celebration", None) is not None:
                if self.dragging:
                    self._celebration = None
                    self._whale_clear_force()
                else:
                    _stages = self._smooth.celebration_stages() if self._smooth else ()
                    _si = int(self._celebration.get("stage", 0))
                    _stage_dur = (float(_stages[_si].get("durMs", 500)) / 1000.0) if _si < len(_stages) else 0.5
                    _stage_el = now - float(getattr(self, "_celebrate_stage_at", now))
                    if force in ("jump", "land", "cheer", "idleSettle") and (_stage_el >= _stage_dur or w.finished):
                        _si += 1
                        if _si >= len(_stages):
                            self._celebration = None
                            self._whale_clear_force()
                        else:
                            self._celebration["stage"] = _si
                            self._anim_log("celebrate stage=%s" % _stages[_si]["name"])
                            self._whale_force_play(_stages[_si]["action"])
                            self._celebrate_stage_at = now
                            if _stages[_si]["name"] == "cheer":
                                try:
                                    self._bridge_fx_play("love")
                                except Exception:
                                    pass
                    force = self._whale_force
            if getattr(self, "_dialog_force", None) and force == self._dialog_force and now >= self._dialog_until:
                self._dialog_force = None
                self._whale_clear_force()
                force = self._whale_force
            # 对话后续拍：到点且当前无强制动作时接一拍
            if getattr(self, "_dialog_queue", None) and not force:
                _nxt = self._dialog_queue[0]
                if now >= _nxt[1] and w.has(_nxt[0]):
                    self._dialog_queue.pop(0)
                    self._whale_force_play(_nxt[0])
                    self._dialog_force = _nxt[0]
                    try:
                        _stq = w.action_stats(_nxt[0])
                        _totq = (_stq[2] / 1000.0) if _stq and _stq[2] else 0.7
                    except Exception:
                        _totq = 0.7
                    self._dialog_until = now + max(0.4, min(1.2, _totq * 1.05))
                    self._anim_log("dialog beat=%s" % _nxt[0])
                    force = self._whale_force
            # hum 等循环微动作按定时回收，回 idle
            if getattr(self, "_whale_micro_until", 0.0) and now >= self._whale_micro_until:
                self._whale_micro_until = 0.0
                if w.cur == "hum":
                    w.play("idleBase")
            # CF5：fall 帧只在物理飞行期间保持；物理已被外部清空（phys:stop/异常）且不处于拖拽时
            # 自动接 land 再回 idle，避免卡在 fall 帧（act:fall 手动触发同样会 1 tick 内落回 land）。
            if force == "fall" and not self.dragging and getattr(self, "_enh_phys", None) is None:
                self._whale_force_play("land")
                force = self._whale_force
            if force:
                if w.has(force):
                    if w.cur != force:
                        w.play(force, restart=True)
                    if w.finished:                  # 单次动作播完：按配方保持末帧 / 回 idle
                        hold = self._WHALE_HOLD_S.get(force)
                        if hold is None:
                            self._whale_clear_force()
                        elif hold <= 0:
                            pass                    # 一直保持末帧，等状态变化/用户操作
                        elif not self._whale_hold_until:
                            self._whale_hold_until = now + hold
                        elif now >= self._whale_hold_until:
                            self._whale_clear_force()
                else:
                    self._whale_clear_force()
                force = self._whale_force
            if not force:
                if self.dragging:
                    w.play("drag")
                elif self.target is not None:
                    # 上下移动没有对应的走路帧：用 idleBase + 位移（P1）
                    dx = self.target[0] - (self.x() + self.width() / 2)
                    dy = self.target[1] - (self.y() + self.height() / 2)
                    w.play("walk" if abs(dx) >= abs(dy) * 0.7 else "idleBase")
                elif w.finished or w.cur in ("", "walk", "drag"):
                    w.play("idleBase")
                elif w.cur == "idleBase" and getattr(self, "_idle_micro", None) is not None and self._idle_micro.due(now):
                    if self._whale_gag_ok():        # 深夜/免打扰只留呼吸，不做 idle 微动作（D3）
                        n = self._idle_micro.pick(now)
                        if n and w.has(n):
                            self._anim_log("micro action=%s" % n)
                            w.play(n, restart=True)
                            try:
                                _timed = self._smooth.IDLE_TIMED_MS.get(n) if self._smooth else None
                            except Exception:
                                _timed = None
                            if _timed:
                                self._whale_micro_until = now + float(_timed) / 1000.0
            # 走路步频（体验评审 2026-10-24）：默认慢放 ×1.35（45→60.75ms/帧，1.94s/循环，≈1.03 步/秒）；
            # ×1.2 / ×1.35 / ×1.6 三档可配（whale.walkRate，1.6 = 悠闲/深夜档）。
            # tool 状态是"慢速 walk"，在正常步频上再慢 5%（不是过度拖慢）。
            # 注意方向：每帧推进的"动画时间"要除以倍率（rate>1 = 播得更慢），不是乘。
            step_ms = self.tick_ms
            _rate = 1.0
            if w.cur == "walk":
                _rate = float(getattr(self, "_whale_walk_rate", 1.35) or 1.35)
                if str(getattr(self, "_bridge_state", {}).get("state") or "") == "tool":
                    _rate *= 1.05
                _rate = max(0.5, min(3.0, _rate))
                step_ms = self.tick_ms / _rate
            w.tick(step_ms)
        except Exception as _whale_exc:      # 帧动画异常不影响主循环，限频记录（约每 20 秒最多 1 条）
            if self.t - getattr(self, '_whale_err_t', -10**9) > 200:
                self._whale_err_t = self.t
                print('鲸鱼娘帧动画异常:', repr(_whale_exc))


    def tick(self):
        self.t += 1
        self._life_tick()
        self._whale_tick()

        # 歌词换句的过渡动画：发现"该显示的那一句"变了就淡入淡出一下
        if self._music_playing() and self.music_lyrics and self._lyric_lines:
            cur_line = self._current_lyric_pair()[0]
            if cur_line and cur_line != self._lyric_shown:
                self._lyric_prev = self._lyric_shown
                self._lyric_shown = cur_line
                self._lyric_prev_h = self._lyric_last_h or 0.0
                self._lyric_prev_w = self._lyric_last_w or 0.0
                self._lyric_anim_t = 1.0
        # walk/过渡期 60Hz（亚像素位移更顺）；静止恢复标准 tick
        self._smooth_tick_rate()
        # LLM 台词兜底检查
        self._speech_tick(time.time())
        # 过渡期间（换句动画、或者气泡正在变大变小）换成 100 帧/秒的密帧重绘
        bubble_moving = (abs(self._bub_target[0] - self._bub_w) > 0.6
                         or abs(self._bub_target[1] - self._bub_h) > 0.6)
        if (self._lyric_anim_t > 0 or bubble_moving) and not self._lyric_timer.isActive():
            self._lyric_timer.start()

        # 歌词没抓到就自己重试（原来要等切歌才会重抓，主人反馈过"歌词不显示"）
        if (self.music_on and self.music_lyrics and self._lyric_key
                and not self._lyric_lines and not self._lyric_fetching
                and not getattr(self, "_music_no_progress", False)
                and time.time() >= self._lyric_retry_at):
            self._lyric_retry_at = time.time() + 15.0
            self._start_lyric_fetch(self._lyric_key, self.now_playing or {})

        # 大约每 5 秒顺手存一次配置：改了城市/大小/音效这些不用等退出也不会丢
        if self.t % 250 == 0:
            self.autosave_config()

        # 峰谷切换提醒：每秒看一次，跨进新时段就说一声
        if self.t % 50 == 0:
            self.check_timed_lines()        # 到点说一句（每天 / 每周 / 每隔）
            self._hold_tick()               # 免打扰到点了没 / 进没进全屏
            self._back_tick()               # 离开一阵子回来打个招呼
            peak_now = is_peak()
            if self._peak_now is None:
                self._peak_now = peak_now
            elif peak_now != self._peak_now:
                self._peak_now = peak_now
                self.say("进入" + peak_label(peak_now, self.peak_style)
                         + ("，这会儿聊起来贵一点" if peak_now else "，这会儿便宜"))

        # 处理后台线程排队的气泡消息，Qt 界面必须在主线程更新
        if self._say_queue:
            # 放歌时气泡被歌词占着，这些后台结果（天气等）就多停一会儿
            hold = MUSIC_HOLD_SEC if self._music_playing() else 0.0
            for text in self._say_queue:
                self.say(text, seconds=hold or 2.8)
            self._say_queue.clear()

        # 余额结果（后台线程 → 主线程）
        if self._bal_queue:
            self._apply_balance(self._bal_queue.pop(0))

        # 在放什么歌 / 找回来的歌词（后台线程 → 主线程）
        if self._music_queue:
            info = self._music_queue.pop(0)
            self._apply_now_playing(info)
            self._music_busy = False
            if self._music_manual:          # 菜单里手动点的那次：回一句话
                self._music_manual = False
                self._report_music_now(info)
        if self._lyric_queue:
            key, lrc = self._lyric_queue.pop(0)
            self._apply_lyric_result(key, lrc)
        self._music_cmd_tick()           # 气泡上那几颗 ⏮ / ⏸▶ / ⏭ 的结果

        # 余额数字滚动 + 按压回弹 + 音效补播
        if self.roll_t < 1.0:
            self.roll_t = min(1.0, self.roll_t + 0.07)
            if self.roll_t >= 1.0 and self.balance:
                self.roll_shown = float(self.balance["total"])
        if self.press_t > 0:
            self.press_t = max(0.0, self.press_t - 0.12)
        try:
            self._bridge_fx_tick()
        except Exception:
            pass
        self._flush_pending_sounds()

        # 延迟气泡（每轮消耗等）
        if self._bal_wait_until and self._secs() >= self._bal_wait_until:
            self.show_balance_bubble(self._bal_wait_secs, force=True)
        if self._pending_bubbles:
            now_s = self._secs()
            due = [i for i, x in enumerate(self._pending_bubbles) if x[0] <= now_s]
            if due:
                # 一次只说一条（原来是"到点的一批一起丢掉、只留第一条"，排队的会丢）
                _, text, inner = self._pending_bubbles.pop(due[0])
                self.say(text, inner=inner)

        # 单击欠着的那句台词：等双击判定窗口过去才冒（窗口内来了第二下就撤销）
        if self._single_pending and self._secs() >= self._single_pending[0]:
            _when, speak = self._single_pending
            self._single_pending = None
            try:
                speak()
            except Exception:
                pass

        # 城市定位 / 搜索结果
        if self._city_queue:
            city = self._city_queue.pop(0)
            if city:
                self._apply_city(city)
            else:
                self.say("没定位到，右键「天气 → 添加城市」搜一个吧")
        if self._city_pick_queue:
            items = self._city_pick_queue.pop(0)
            labels = [x[0] for x in items]
            with self._ui_guard():
                pick, ok = QInputDialog.getItem(self, "选择城市", "选一个城市：", labels,
                                                0, False, Qt.WindowType.WindowStaysOnTopHint)
            if ok and pick:
                self._apply_city(dict(items)[pick])
        if self._app_queue:
            self._pick_app_dialog(self._app_queue.pop(0))
        if self._app_time_queue:          # 「用久了提醒」扫到的应用列表
            self.app_time_dialog(self._app_time_queue.pop(0))
        if self._mem_queue:
            self._mem_trim_done(self._mem_queue.pop(0))

        if self.jump_t > 0:
            self.jump_t = max(0.0, self.jump_t - 0.06)
        if self.cross_t > 0:
            self.cross_t = max(0.0, self.cross_t - 0.15)
        if self.action_t > 0:
            self.action_t = max(0.0, self.action_t - 0.03)
            if self.action_t == 0:
                self.action = None

        if self.ui_open:        # 菜单 / 对话框开着：站住不动，免得跳上去把设置面板遮住
            if self.perf_mode:
                self.update()           # 性能模式：动画照跑，菜单开着也不掉帧
            elif self.t % 5 == 0:
                self.update()           # 休闲模式：几帧刷一次，省点资源
            return

        if self.dragging:
            self.update()
            return
        if getattr(self, "_life_offline", False):    # 失联打盹：原地睡着不动，等命令/用户操作
            self.update()
            return
        # A 路线增强：视线/边缘姿态/抛掷物理（物理接管时跳过普通移动）
        if self._enh_tick(self.t * self.tick_ms):
            self.update()
            return
        now_ms = self.t * self.tick_ms

        if self.mode == "follow":
            cursor = self.cursor().pos()
            screen = QApplication.screenAt(cursor) or self.screen() or QApplication.primaryScreen()
            geo = screen.availableGeometry()
            near = (self.x() - 100 <= cursor.x() <= self.x() + self.width() + 100 and
                    self.y() - 100 <= cursor.y() <= self.y() + self.height() + 100)
            if near:
                self.target = None
            else:
                # 目标点按"窗口中心"算，并且夹在可达范围内，否则贴边时会永远够不到
                half_w, half_h = self.width() / 2, self.height() / 2
                tx = max(geo.left() + half_w, min(geo.right() - half_w, cursor.x()))
                ty = max(geo.top() + half_h, min(geo.bottom() - half_h, cursor.y() + 60))
                self.target = (tx, ty)
        elif self.mode == "wander":
            # 用户口径：静息为主（80% 时间站着/坐着微动），每 60–180s 才短距离走一次（2–4s）
            if self.target is None:
                if now_ms < self.rest_until:
                    self._maybe_idle_action()
                    self.update()
                    return
                geo = (self.screen() or QApplication.primaryScreen()).availableGeometry()
                # 短距离目标：离当前位置 90–170px，走 2–4 秒就停，不再全屏乱跑
                half_w, half_h = self.width() / 2, self.height() / 2
                cx, cy = self.x() + half_w, self.y() + half_h
                ang = random.uniform(0.0, math.pi * 2.0)
                dist = random.uniform(90.0, 170.0)
                tx = cx + math.cos(ang) * dist
                ty = cy + math.sin(ang) * dist
                tx = max(geo.left() + half_w, min(geo.right() - half_w, tx))
                ty = max(geo.top() + half_h, min(geo.bottom() - half_h, ty))
                self.target = (int(tx), int(ty))
        else:
            # 原地待着：一直维持正面形象，不再转头看鼠标、也不会背过身
            # （拖动过程中的朝向逻辑照旧走 mouseMoveEvent，不受这里影响）
            self._still_face_front()
            self._maybe_idle_action()
            self.update()
            return

        if self.target is not None:
            # 卡住保护：有目标却几乎没挪窝（比如贴着屏幕边），2 秒就换个目标
            moved = abs(self.x() - self._last_pos[0]) + abs(self.y() - self._last_pos[1])
            self._last_pos = (self.x(), self.y())
            self._stuck_ticks = 0 if moved >= 2 else self._stuck_ticks + 1
            if self._stuck_ticks > 100:
                self._stuck_ticks = 0
                self.target = None
                self.rest_until = self.t * self.tick_ms + random.randint(2000, 6000)
                self._set_dir("down")
                self.update()
                return

            cx, cy = self.x() + self.width() / 2, self.y() + self.height() / 2
            dx, dy = self.target[0] - cx, self.target[1] - cy
            dist = (dx * dx + dy * dy) ** 0.5
            if dist < 12:
                self.target = None
                # 走完长休息 60–180s（静息为主），期间只做微动作
                self.rest_until = self.t * self.tick_ms + random.randint(60000, 180000)
                self._set_dir("down")
            else:
                step = self.cur_speed * self.tick_ms / 1000.0
                nx, ny = cx + dx / dist * step, cy + dy / dist * step
                # 整个窗口都要留在屏幕内，否则气泡会被顶出屏幕
                geo = (self.screen() or QApplication.primaryScreen()).availableGeometry()
                mx = max(geo.left(), min(geo.right() - self.width() + 1, int(nx - self.width() / 2)))
                my = max(geo.top(), min(geo.bottom() - self.height() + 1, int(ny - self.height() / 2)))
                self.move(mx, my)
                self._face_travel(dx, dy)
            # 用户 2026-10-26：禁止散步时随机弹跳（"蹦蹦蹦"主因之一）
        target_speed = SPEED if self.target is not None else 0.0
        self.cur_speed += (target_speed - self.cur_speed) * 0.3
        self.update()


    def _whale_click_react(self):
        """点击鲸鱼娘：摸头/戳身体 → pat（身体偶尔嘴硬 tsundere）；偷吃中点击 → caught。

        冷却 20 秒、深夜/免打扰不演梗；返回 True 表示这次点击已由帧动画接住。
        """
        if not self._whale_active():
            return False
        w = getattr(self, "_whale", None)
        if w is None:
            return False
        now = self._secs()
        force = getattr(self, "_whale_force", None)
        # 睡着被戳：先醒过来（act:sleep / 失联打盹都可能停在 sleep）
        if force == "sleep" and w.cur == "sleep" and w.has("wake"):
            if getattr(self, "_life_offline", False):
                self._last_line_at = time.time()
                self._life_wake()
            else:
                self._whale_force_play("wake")
            return True
        # 偷吃被抓包：sneak 播到一半被点 → 打断成 caught（STATE-MAP §5）
        if force == "sneak" and w.cur == "sneak" and w.has("caught"):
            self._whale_force_play("caught")
            self._bridge_bubble_kind = "remind"
            self._speech_request("sneakCaught", {"phase": "click", "subkind": "sneakCaught"},
                                 fallback="！才、才没有偷吃")
            return True
        if not self._whale_gag_ok() or now < getattr(self, "_whale_pat_cd", 0.0):
            return False
        try:                         # 头（上半）/ 身体：头摸头，身体偶尔嘴硬
            gp = getattr(self, "last_press_pos", None)
            lp = self.mapFromGlobal(gp) if gp is not None else None
            rel = (lp.y() - (self.bubble_h + MARGIN)) if lp is not None else 0
            head = rel < max(1, self.cur_h) * 0.40
        except Exception:
            head = True
        name = "pat" if (head or random.random() < 0.6) else "tsundere"
        if not self._whale_force_play(name):
            return False
        self._whale_pat_cd = now + 20.0
        self.jump_t = max(getattr(self, "jump_t", 0.0), 0.4)
        self._bridge_bubble_kind = "love" if name == "pat" else "remind"
        if name == "pat":
            self._speech_request("pat", {"phase": "click", "subkind": "pat"})
            try:
                getattr(self, "_bridge_fx_play", lambda _n: None)("love")
            except Exception:
                pass
        else:
            self._speech_request("praise", {"phase": "click", "subkind": "tsundere"})
        return True


class PetRenderMixin:
    def _enh_on(self):
        return bool(getattr(self, "render", {}).get("enhance", False))


    def _enh_drag_clear(self):
        self._enh_drag_samples = []


    def _enh_note_drag(self, gp):
        if not self._enh_on():
            return
        samples = getattr(self, "_enh_drag_samples", None)
        if samples is None:
            samples = self._enh_drag_samples = []
        samples.append((self.t * self.tick_ms, int(gp.x()), int(gp.y())))
        if len(samples) > 12:
            del samples[:-12]


    def _enh_take_throw(self):
        """用最近 ~120ms 的拖拽采样算抛掷速度（px/s）。"""
        samples = getattr(self, "_enh_drag_samples", []) or []
        self._enh_drag_samples = []
        if len(samples) < 2:
            return (0.0, 0.0)
        t1, x1, y1 = samples[-1]
        for t0, x0, y0 in reversed(samples[:-1]):
            dt = max(1, t1 - t0) / 1000.0
            if t1 - t0 >= 80:
                return ((x1 - x0) / dt, (y1 - y0) / dt)
        t0, x0, y0 = samples[0]
        dt = max(1, t1 - t0) / 1000.0
        return ((x1 - x0) / dt, (y1 - y0) / dt)


    def _enh_start_throw(self, vx, vy):
        if not self._enh_on() or not self.render.get("physics", True):
            return False
        cap = 2600.0  # 23 §4.2：初速上限 2600
        vx *= 1.05
        vy *= 1.05
        sp = (vx * vx + vy * vy) ** 0.5
        if sp > cap:
            k = cap / sp
            vx, vy = vx * k, vy * k
        if abs(vx) < 260 and abs(vy) < 260:  # 23 §4.2：甩出阈值 260px/s
            return False
        self._enh_phys = {"vx": vx, "vy": vy, "bounces": 0, "t": 0.0}
        self._enh_edge = None
        self.target = None
        return True


    def _enh_tick(self, now_ms):
        """每帧：落地缓冲/视线/边缘姿态/物理；返回 True 表示本帧由增强层接管位移。"""
        if not self._enh_on():
            return False
        if self._enh_land > 0:
            self._enh_land = max(0.0, self._enh_land - 0.06)
        # 视线跟随（不拖动、不飞行、设置窗口关闭、非跟随模式）
        if (self.render.get("gaze") and not self.dragging and self._enh_phys is None
                and not self.ui_open and self.mode != "follow"):
            try:
                cur = QCursor.pos()
                cx = self.x() + self.width() / 2
                cy = self.y() + self.height() / 2
                dx = max(-1.0, min(1.0, (cur.x() - cx) / 260.0))
                dy = max(-1.0, min(1.0, (cur.y() - cy) / 220.0))
                self._enh_gaze += (dx - self._enh_gaze) * 0.07   # 平滑 ~300ms（50fps）
                self._enh_gaze_y += (dy - self._enh_gaze_y) * 0.07
            except Exception:
                self._enh_gaze *= 0.9
                self._enh_gaze_y *= 0.9
        else:
            self._enh_gaze *= 0.9
            self._enh_gaze_y *= 0.9
        # 边缘姿态：贴边 16px 内进入四边姿态（23 §4.2：吸附 16px）；拖离 40px 解除
        if self.render.get("edges") and not self.dragging and self._enh_phys is None:
            if now_ms - self._enh_last_edge_check >= 250:
                self._enh_last_edge_check = now_ms
                side = self._edge_side()
                if side:
                    if not self._enh_edge or self._enh_edge.get("side") != side:
                        self._enh_edge = {"side": side, "since_ms": now_ms}
                        # 左右贴边用侧面精灵（朝向屏幕内侧）
                        if side in ("left", "right"):
                            self._set_dir(side, -1 if side == "left" else 1)
                elif self._enh_edge:
                    # 拖离超过 40px 才解除（滞回，防抖；23 §4.2 释放阈值）
                    if self._edge_distance() > 40:
                        self._enh_edge = None
        elif self._enh_phys is not None:
            self._enh_edge = None
        return self._enh_tick_physics()


    def _enh_tick_physics(self):
        phys = self._enh_phys
        if phys is None:
            return False
        # 鲸鱼娘：抛掷飞行中不站姿（fall 帧），落地再接 land / 硬摔 cry
        try:
            if self._whale_active():
                self._whale_force_play("fall")
        except Exception:
            pass
        geo = (self.screen() or QApplication.primaryScreen()).availableGeometry()
        dt = max(0.001, self.tick_ms / 1000.0)
        phys["t"] = float(phys.get("t", 0.0)) + dt
        x, y = float(self.x()), float(self.y())
        vx, vy = phys["vx"], phys["vy"]
        vy += 2200.0 * dt                      # 23 §4.2：g=2200
        damp = math.exp(-1.2 * dt)             # 线性阻尼 1.2/s
        vx *= damp
        vy *= damp
        x += vx * dt
        y += vy * dt
        w, h = self.width(), self.height()
        left, top = geo.left(), geo.top()
        right = geo.right() - w + 1
        bottom = geo.bottom() - h + 1
        hit = False
        if x < left:
            x, vx = left, -vx * 0.45           # 撞墙反弹 0.45
            hit = True
        elif x > right:
            x, vx = right, -vx * 0.45
            hit = True
        if y < top:
            y, vy = top, -vy * 0.45
            hit = True
        elif y > bottom:
            y, vy = bottom, -vy * 0.20         # 落地反弹 0.2
            hit = True
        phys["vx"], phys["vy"] = vx, vy
        if hit:
            phys["bounces"] += 1
            speed = (vx * vx + vy * vy) ** 0.5
            if speed > 650:
                phys["hard"] = True           # 硬摔标记：落地接 cry（有冷却、深夜限制）
            if speed > 650 and phys["bounces"] <= 4:
                self._enh_dizzy_until = self._secs() + max(0.6, min(2.0, 0.6 + speed / 1600.0))
                try:
                    self._bridge_fx_play("dizzy")
                except Exception:
                    pass
        self.move(int(x), int(y))
        # 落地：低速触底 → 压扁回弹（地面摩擦 0.3）+ 结束飞行
        on_floor = y >= bottom - 1
        if on_floor and abs(vy) < 260 and abs(vx) < 90:
            hard = bool(phys.get("hard"))
            self._enh_phys = None
            self._enh_land = 1.0
            self._enh_dizzy_until = max(self._enh_dizzy_until, self._secs() + 0.35)
            self.rest_until = self.t * self.tick_ms + random.randint(4000, 9000)
            self._set_dir("down", 1)
            try:
                self._whale_fall_land(hard)
            except Exception:
                pass
        return True


    def _enh_state(self, now):
        """paintEvent 用：一帧增强参数（关闭时返回中性值 = 原渲染）。"""
        neutral = {"rot": 0.0, "dx": 0.0, "dy": 0.0, "sx": 1.0, "sy": 1.0,
                   "bubble_dx": 0.0, "bubble_dy": 0.0, "shadow_alpha": 0.0,
                   "shadow_dx": 0.0, "shadow_rx": 0.0, "shadow_ry": 0.0}
        if not self._enh_on():
            return neutral
        # 用户反馈「站着的时候人物倾斜」：倾角上限硬限 3°；静止 rot=0，只在走路/拖拽/飞行时轻微前倾。
        max_deg = min(3.0, float(self.render.get("tilt_max_deg", 3.0) or 3.0))
        idle = (not self.dragging) and self._enh_phys is None
        moving = idle and self.target is not None
        rot = 0.0
        dx = dy = 0.0
        sx = sy = 1.0
        if moving:   # 行走轻微前倾（幅度随速度、方向跟朝向，≤ max_deg）；站立不倾斜
            lean = max_deg * min(1.0, abs(self.cur_speed) / max(1.0, SPEED))
            rot += lean if self.facing < 0 else -lean
        phys = self._enh_phys
        if phys is not None:  # 飞行：vx/40 + 角阻尼 4/s；垂直速度 → pitch（同样夹在 max_deg 内）
            vx, vy = phys.get("vx", 0.0), phys.get("vy", 0.0)
            rot += max(-max_deg, min(max_deg, vx / 40.0)) * math.exp(-4.0 * float(phys.get("t", 0.0)))
            dy -= max(-10.0, min(10.0, abs(vy) / 240.0))
            sx += max(-0.05, min(0.05, abs(vy) / 9000.0))
            sy -= max(-0.05, min(0.05, abs(vy) / 9000.0))
        if self.render.get("gaze"):  # 视线转头：鲸鱼娘帧图头身一体，22° 会像站立倾斜 → 限 ≤3°
            rot += max(-max_deg, min(max_deg, self._enh_gaze * 3.0))
            dy += self._enh_gaze_y * 14.0 * 0.3
        side = (self._enh_edge or {}).get("side") if self.render.get("edges") else None
        if side:
            since_s = float((self._enh_edge or {}).get("since_ms", 0)) / 1000.0
            e = min(1.0, max(0.0, (now - since_s) / 0.12))     # OutBack 120ms 过渡
            u = e - 1.0
            ease = 1.0 + 2.70158 * u ** 3 + 1.70158 * u ** 2
            if side == "left":     # 左右贴边：整体 ≤30°，用侧面精灵（_enh_tick 已切朝向）
                rot += -30.0 * ease
                dx -= 4.0 * ease
            elif side == "right":
                rot += 30.0 * ease
                dx += 4.0 * ease
            elif side == "top":    # 贴顶边：整体 −90° 躺下 + 压扁 8% + ±2° 钟摆
                rot += (-90.0 + math.sin(now * 2.0) * 2.0) * ease
                sy *= 1.0 - 0.08 * ease
                dy -= 6.0 * ease
            elif side == "bottom": # 任务栏坐姿
                sx += 0.06 * ease
                sy -= 0.06 * ease
                dy -= 2.0 * ease
        if self._enh_land > 0:  # 落地压扁：1.12/0.88 → 1.03/0.97 → 1.0（23 §4.2）
            p = 1.0 - self._enh_land
            if p < 0.35:
                k = p / 0.35
                sy *= 1.0 - 0.12 * k
                sx *= 1.0 + 0.12 * k
            else:
                k = (p - 0.35) / 0.65
                sy *= 0.88 + 0.15 * k
                sx *= 1.12 - 0.12 * k
        if now < self._enh_dizzy_until:  # 眩晕：短促摇头
            rot += math.sin(now * 46.0) * max_deg * 0.45
            dx += math.sin(now * 31.0) * 1.5
        par = bool(self.render.get("parallax"))
        # 三层视差：阴影 0.55 / 本体 1.0 / 气泡 1.18（错位 ≤6px）
        bubble_dx = max(-6.0, min(6.0, dx * 1.18)) if par else 0.0
        bubble_dy = max(-6.0, min(6.0, dy * 1.18)) if par else 0.0
        shadow_alpha = shadow_dx = shadow_rx = shadow_ry = 0.0
        if self.render.get("shadow"):
            lift = min(1.0, abs(dy) / 10.0 + abs(rot) / max(1.0, max_deg) * 0.25 + (0.35 if phys else 0.0))
            shadow_alpha = 0.28 - 0.10 * lift       # 0.28 → 0.18（随高度变淡）
            shadow_dx = (dx * 0.55 + rot * 0.35) if par else rot * 0.35
            speed = (abs(phys.get("vx", 0.0)) + abs(phys.get("vy", 0.0))) if phys else 0.0
            shadow_rx = 34.0 + 12.0 * lift + min(10.0, speed / 260.0)   # 随速度拉长
            shadow_ry = 8.0 + 2.0 * lift
        return {"rot": rot, "dx": dx, "dy": dy, "sx": sx, "sy": sy,
                "bubble_dx": bubble_dx, "bubble_dy": bubble_dy,
                "shadow_alpha": shadow_alpha, "shadow_dx": shadow_dx,
                "shadow_rx": shadow_rx, "shadow_ry": shadow_ry}


    def _enh_paint_shadow(self, p, cx, bottom, st):
        """双层软阴影：偏移 (0,8)、模糊 10、α 0.18~0.28、随速度拉长（23 §4.2）。"""
        if not self._enh_on() or st.get("shadow_alpha", 0) <= 0.01:
            return
        try:
            gx = cx + st.get("shadow_dx", 0.0)
            gy = bottom - 8.0
            rx = max(6.0, st.get("shadow_rx", 34.0))
            ry = max(3.0, st.get("shadow_ry", 8.0))
            alpha = float(st["shadow_alpha"])
            for scale, a_mul in ((1.25, 0.55), (1.0, 1.0)):  # 外圈更淡 → 近似 blur 10
                rr = rx * scale
                grad = QRadialGradient(QPointF(gx, gy), rr)
                grad.setColorAt(0.0, QColor(20, 24, 40, int(255 * alpha * a_mul)))
                grad.setColorAt(0.6, QColor(20, 24, 40, int(255 * alpha * a_mul * 0.45)))
                grad.setColorAt(1.0, QColor(20, 24, 40, 0))
                p.save()
                p.translate(gx, gy)
                p.scale(1.0, max(0.25, (ry * scale) / rr))
                p.translate(-gx, -gy)
                p.setPen(Qt.PenStyle.NoPen)
                p.setBrush(QBrush(grad))
                p.drawEllipse(QPointF(gx, gy), rr, rr)
                p.restore()
        except Exception:
            pass


    def _enh_bridge(self, action, val):
        """验收通道：enh:on|off / phys:throw:vx,vy / phys:stop / edge:left|right|top|bottom|none。"""
        try:
            if action == "enh":
                self.set_render_enhance(str(val).lower() in ("on", "1", "true", "开"))
                return "enh:" + ("on" if self._enh_on() else "off")
            if action == "phys" and str(val).startswith("throw"):
                nums = str(val).split(":", 1)[1] if ":" in str(val) else ""
                vx_s, _, vy_s = nums.partition(",")
                try:
                    vx, vy = float(vx_s or 0), float(vy_s or 0)
                except Exception:
                    vx, vy = 620.0, -520.0
                ok = self._enh_start_throw(vx, vy)
                return "phys:throw" + ("" if ok else ":skip")
            if action == "phys" and str(val) in ("stop", "reset"):
                self._enh_phys = None
                self._enh_land = 0.0
                self._enh_dizzy_until = 0.0
                return "phys:stop"
            if action == "edge" and str(val) in ("left", "right", "top", "bottom", "none"):
                geo = (self.screen() or QApplication.primaryScreen()).availableGeometry()
                w, h = self.width(), self.height()
                if val == "left":
                    self.move(geo.left(), self.y())
                elif val == "right":
                    self.move(geo.right() - w + 1, self.y())
                elif val == "top":
                    self.move(self.x(), geo.top())
                elif val == "bottom":
                    self.move(self.x(), geo.bottom() - h + 1)
                self._enh_edge = None if val == "none" else {"side": val, "since_ms": self.t * self.tick_ms}
                # 验收/贴边后保持：清 wander 目标 + 原地待 10s，避免立刻被散步带走
                self.target = None
                self.rest_until = self.t * self.tick_ms + 10000
                self.update()
                return "edge:" + str(val)
        except Exception as exc:
            return "enh:error:" + repr(exc)[:60]
        return "enh:unknown"


    def _draw_lyric_btn(self, p, rect, ink, playing=True, kind="toggle"):
        """歌词气泡右上角那几颗小按钮。

        kind="prev" / "next" 画「⏮」「⏭」；kind="toggle" 在放歌时画「⏸」、
        暂停了画「▶」。鼠标划过 / 按下的那颗才透出一圈底色。
        """
        color = QColor(ink["ly_head"])
        hover = getattr(self, "_lyric_btn_hover", None) == kind
        pressed = getattr(self, "_lyric_btn_pressed", None) == kind
        if hover or pressed:
            soft = QColor(color)
            soft.setAlpha(80 if pressed else 46)
            p.setPen(Qt.PenStyle.NoPen)
            p.setBrush(soft)
            p.drawEllipse(rect)
        p.setPen(Qt.PenStyle.NoPen)
        p.setBrush(color)
        cx, cy = rect.center().x(), rect.center().y()
        if kind == "toggle":
            if playing:                   # ⏸：两根小竖条
                w, h, gap = 2.6, 9.0, 3.2
                for dx in (-(w + gap) / 2, (w + gap) / 2):
                    p.drawRoundedRect(QRectF(cx + dx - w / 2, cy - h / 2, w, h), 1.2, 1.2)
            else:                         # ▶：小三角
                r = 4.6
                p.drawPolygon(QPolygonF([QPointF(cx - r + 0.8, cy - r),
                                         QPointF(cx - r + 0.8, cy + r),
                                         QPointF(cx + r + 0.8, cy)]))
            return
        # ⏮ / ⏭：一个小三角 + 一根小竖条（上一首竖条在左，下一首竖条在右）
        r, bar_w = 4.3, 1.8
        sgn = -1.0 if kind == "prev" else 1.0
        apex, base = cx + sgn * (r - 0.6), cx - sgn * (r - 0.6)
        p.drawPolygon(QPolygonF([QPointF(base, cy - r), QPointF(base, cy + r),
                                 QPointF(apex, cy)]))
        bar_x = cx + sgn * (r + 0.1) - bar_w / 2
        p.drawRoundedRect(QRectF(bar_x, cy - r, bar_w, r * 2), 0.8, 0.8)


    def _paint_lyric_bubble(self, p):
        """歌词气泡：小字「应用 · 歌名」，大字当前这句，再淡一行下一句。"""
        info = self.now_playing or {}
        max_w = min(300, self.width() - 12) - 22
        who = (info.get("artist") or "").strip()
        title = (info.get("title") or "").strip()
        # 播放器给的信息可能不全（网易云实测会缺）：缺了就用占位，命名风格保持一致
        # 注意：_app_label() 是静态方法，**必须把 info 传进去**（不传就是空字典 →
        # 顶上永远显示「未知应用」，2026-09-14 主人报的就是这个）
        # 顶行还要给右上角那颗 ⏸ / ▶ 让出一条（见 LYRIC_BTN_PAD）
        head = f"♪ {self._app_label(info)} · {title or TITLE_PLACEHOLDER}"
        if who:
            head += f"—— {who}"
        # 对时：正数 = 文字延后（等一下声音）；不同输出设备（外放 / 蓝牙耳机）延迟不一样
        cur, nxt = self._current_lyric_pair()
        if not cur:
            # 还没找到歌词 / 用户关了歌词 → 就挂个「♪ 歌名」
            cur, nxt = self._song_label(), ""
        # 排版缓存：换句 / 换宽度 / 换字号才重算 —— 每帧算一次 wrap_text 要 ~1ms，100 帧就掉帧了
        # 气泡风格也算在 key 里：颜色是烘在排版结果里的，换了风格得跟着重算
        theme = self._bubble_theme()
        ink = BUBBLE_INK[theme]
        layout_key = (head, cur, nxt, max_w, theme)
        if getattr(self, "_lyric_layout_key", None) != layout_key:
            self._lyric_layout_key = layout_key
            self._lyric_layout_cache = self._lyric_rows(head, cur, nxt, max_w, ink)
        rows, cur_lines, f_main, fm_m, n_head = self._lyric_layout_cache
        real_lyric = bool(self._lyric_lines) and self._current_lyric_pair()[0] == cur
        # 换句时的过渡：新的一句淡入、旧的淡出并往上滑一点（不然"啪"一下太生硬）
        anim = max(0.0, min(1.0, getattr(self, "_lyric_anim_t", 0.0)))
        prev_text = getattr(self, "_lyric_prev", "")
        prev_rows = []
        if anim > 0 and prev_text and prev_text != cur:
            prev_key = (prev_text, max_w, theme)
            if getattr(self, "_lyric_prev_key", None) != prev_key:
                self._lyric_prev_key = prev_key
                self._lyric_prev_cache = [
                    (line, f_main, ink["ly_main"])
                    for line in wrap_text(fm_m, prev_text, max_w)[:LYRIC_MAX_ROWS]]
            prev_rows = self._lyric_prev_cache
        widths = [QFontMetrics(font).horizontalAdvance(text) for text, font, _c in rows]
        if prev_rows:
            widths += [fm_m.horizontalAdvance(t) for t, _f, _c in prev_rows]
        # 顶行右边要站那颗 ⏸ / ▶：把它算成"顶行宽度 + 按钮那一条"，气泡才不会把标题挤掉
        if n_head and widths:
            widths[0] += LYRIC_BTN_PAD
        # 万一这版把顶行"♪ 应用·歌名"让出来给歌词了（超长歌词），那颗按钮就没地方站：
        # 在顶上多留一条给它，免得压在歌词上
        extra_top = 0.0 if n_head else float(LYRIC_BTN_SIZE + 4)
        height = sum(QFontMetrics(font).height() for _t, font, _c in rows) + 20 + extra_top
        bw = max(widths) + 28
        # 气泡"窗口"自己也会平滑变大/变小（0.15 秒、100 帧/秒那套），
        # 不然换到字数不同的那句时会"啪"地换一个框，看着像窗口重新弹了一次。
        now = time.time()
        dt = 0.0 if self._bub_t is None else max(0.0, min(0.12, now - self._bub_t))
        self._bub_t = now
        self._bub_target = (bw, height)
        if abs(bw - self._bub_w) < 0.6 and abs(height - self._bub_h) < 0.6:
            self._bub_w, self._bub_h = bw, height
        else:
            k = min(1.0, dt / max(0.05, self.bubble_anim_sec))
            self._bub_w += (bw - self._bub_w) * k
            self._bub_h += (height - self._bub_h) * k
        bw, height = self._bub_w, self._bub_h
        self._lyric_last_w = bw
        self._lyric_last_h = height
        bx = (self.width() - bw) / 2
        by = self._bubble_top(height)
        # 记下气泡占的矩形：过渡动画刷新时只重画这一块，别把整个窗口（含桌宠）都重画，
        # 不然 100 帧/秒会把合成器压住 —— 拖窗口就掉帧了（主人反馈的卡顿）。
        self._lyric_repaint_rect = QRectF(bx - 6, by - 6, bw + 12, height + 20).toRect()
        self._lyric_bubble_rect = QRectF(bx, by, bw, height)   # 气泡本体（量按钮位置用）
        p.setPen(Qt.PenStyle.NoPen)
        p.setBrush(ink["bg"])
        p.drawRoundedRect(QRectF(bx, by, bw, height), 14, 14)
        tail = QPointF(self.width() / 2, by + height)
        p.drawPolygon(QPolygonF([tail, QPointF(tail.x() - 7, tail.y() + 9),
                                 QPointF(tail.x() + 7, tail.y() + 9)]))
        # 右上角那三颗按钮：⏮ 上一首 / ⏸▶ 播放暂停 / ⏭ 下一首
        # （这块气泡就是个迷你播放器，放歌时不用切回播放器）
        btn, gap = float(LYRIC_BTN_SIZE), float(LYRIC_BTN_GAP)
        right, top = bx + bw - 6, by + 6
        self._lyric_btn_rects = {}
        for kind in ("next", "toggle", "prev"):     # 从右往左摆：⏭ | ⏸▶ | ⏮
            self._lyric_btn_rects[kind] = QRectF(right - btn, top, btn, btn)
            right -= btn + gap
        for kind in ("prev", "toggle", "next"):     # 从左往右画，叠不到一起
            self._draw_lyric_btn(p, self._lyric_btn_rects[kind], ink,
                                 playing=bool(info.get("playing")), kind=kind)
        ty = by + 10 + extra_top
        if prev_rows:                    # 旧的这句：往上滑出去 + 淡出
            p.setOpacity(anim)
            oy = ty - (1.0 - anim) * 8
            for text, font, color in prev_rows:
                fm = QFontMetrics(font)
                p.setFont(font)
                p.setPen(color)
                p.drawText(QRectF(bx, oy, bw, fm.height()), Qt.AlignmentFlag.AlignCenter, text)
                oy += fm.height()
            p.setOpacity(1.0)
        if anim > 0:                     # 新的一句：从下面 8px 滑上来 + 淡入
            p.setOpacity(max(0.15, 1.0 - anim * 0.85))
            ty += anim * 8
        # "唱到哪、字就变到哪"：当前这句按进度给已唱到的部分换颜色
        if LYRIC_KARAOKE_ON and real_lyric:
            line_start = self._lyric_lines[lyric_index(self._lyric_lines,
                                                       self._lyric_position())][0]
            sung_total = self._lyric_sung_total("".join(cur_lines), line_start)
            sung = self._karaoke_split(cur_lines, sung_total)
        else:
            sung = [0] * len(cur_lines)
        for i, (text, font, color) in enumerate(rows):
            fm = QFontMetrics(font)
            p.setFont(font)
            p.setPen(color)
            k = i - n_head                                  # 这一行是当前句的第几行
            if i < n_head:
                # 顶行左对齐；**只有第一行**要给右上角那颗 ⏸ / ▶ 让出一条，
                # 折到第二行的时候整行都能用（不然那一行会被硬生生切掉）
                pad = LYRIC_BTN_PAD if i == 0 else 0
                slack = 3 if i == 0 else 0        # 给气泡缩放动画留点余量
                p.drawText(QRectF(bx + 14, ty, bw - 28 - pad + slack, fm.height()),
                           Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter, text)
            elif 0 <= k < len(cur_lines):
                w_row = fm.horizontalAdvance(text)
                x0 = bx + (bw - w_row) / 2
                p.drawText(QRectF(bx, ty, bw, fm.height()),
                           Qt.AlignmentFlag.AlignCenter, text)
                n = sung[k] if k < len(sung) else 0
                if n > 0:                                   # 已唱到的部分：裁剪后重画成高亮色
                    w_pre = fm.horizontalAdvance(text[:n])
                    p.save()
                    p.setClipRect(QRectF(x0, ty, max(1.0, w_pre), fm.height()))
                    p.setPen(QColor(*LYRIC_KARAOKE_COLOR))
                    p.drawText(QRectF(bx, ty, bw, fm.height()),
                               Qt.AlignmentFlag.AlignCenter, text)
                    p.restore()
            else:
                p.drawText(QRectF(bx, ty, bw, fm.height()),
                           Qt.AlignmentFlag.AlignCenter, text)
            ty += fm.height()
        p.setOpacity(1.0)


class PetMenuMixin:
    def _forward_mouse_to_menu(self, e):
        """菜单开着时，把桌宠收到的鼠标移动转发给菜单。

        这台 Windows 经常不把鼠标移动消息送给弹出菜单（只送给桌宠窗口），
        Qt 的菜单因此以为"鼠标跑出去了"，二三级菜单会莫名其妙自己关掉。
        把移动事件转过去以后，Qt 的悬停高亮 / 展开 / 收起就都恢复正常。
        """
        if not self.ui_open:
            return False
        root = getattr(self, "_menu_keepalive", None)
        if root is None or not root.isVisible():
            return False
        pos = e.globalPosition().toPoint()
        menu = root
        for _ in range(4):                       # 找到光标所在的那一层菜单
            act = menu.actionAt(menu.mapFromGlobal(pos))
            if act is None or act.menu() is None or not act.menu().isVisible():
                break
            menu = act.menu()
        local = menu.mapFromGlobal(pos)
        if not menu.rect().contains(local):
            return False
        QApplication.sendEvent(menu, QMouseEvent(
            QEvent.Type.MouseMove, QPointF(local), e.globalPosition(),
            Qt.MouseButton.NoButton, Qt.MouseButton.NoButton, e.modifiers()))
        return True


    def _build_quick_menu(self):
        """右键菜单（v1.1.0 起瘦身版）：**一条子菜单都没有**，全是点一下就走。

        设置都搬进「打开设置…」那个窗口了，这里只留两类东西：
        「看一眼」（余额 / 天气 / 在放什么）和几条随手要用的开关与救命通道。
        菜单里没有子菜单，也就没有那套"悬停展开 / 点击摆渡"的老毛病。
        （完整版老菜单的入口挪到设置窗口「通用 → 排查问题」里去了。）
        """
        m = QMenu()
        m.addAction("查看余额", lambda: self.refresh_balance(silent=False))
        m.addAction("查看天气", self._get_weather)
        m.addAction("看一眼在放什么", self.check_music_now)
        m.addSeparator()
        m.addAction("打开设置…", defer_dialog(self.open_console))
        m.addSeparator()
        # 「显示/隐藏」和「经典菜单」都不放菜单里了：设置窗口「通用」页里有
        # （菜单只留"看一眼"和"救命"两类）
        lk = m.addAction("锁定位置（拖不动·防误触）")
        lk.setCheckable(True)
        lk.setChecked(self.locked)
        lk.triggered.connect(self.set_locked)
        pa = m.addAction("鼠标穿透（点不到它）")
        pa.setCheckable(True)
        pa.setChecked(self.cfg["passthrough"])
        pa.triggered.connect(lambda on: self.set_passthrough(on))
        m.addAction("救急恢复（点不到它 / 它不见了）", self.force_recover)
        m.addSeparator()
        self._add_tool_actions(m)      # 免打扰 / 今日汇总
        m.addSeparator()
        m.addAction("退出", self.quit_app)
        self._iconize_menu(m)          # 每条前面的小图标（跟设置窗口同一套）
        return m


    def _build_menu(self):
        """**完整版菜单**（老样子，一条没少）。

        v1.1.0 起右键桌宠弹的是瘦身后的 `_build_quick_menu()`，这一份退到
        「经典菜单…」那条后面当兜底 —— 等新界面用稳一版，这里连同下面那 1000 行
        子菜单补丁一起删。
        """
        # 菜单不挂在桌宠窗口下面（用无父窗口的弹出菜单）：
        # 依附桌宠时，子菜单的悬停/收起会受桌宠那个"无边框+半透明+置顶"窗口影响，
        # 靠屏幕边缘往左弹的子菜单尤其容易被误判成"鼠标离开了菜单"而收起来。
        m = QMenu()
        # ---------- 快速查看（独立区域，放最上面）----------
        # 这三个是平时最常用的："看一眼余额 / 看一眼天气 / 看一眼在放什么"，
        # 从各自的子菜单里挪到一级菜单，单独一块，不用再一层层点进去。
        m.addAction("查看余额", lambda: self.refresh_balance(silent=False))
        # （原来这里还有一行灰色的「今天另有 ¥x 余额变动，没算进今日已用」；
        #   主人 2026-09-13 看了一眼说"把这个灰色小字删了，奇奇怪怪的" → 去掉。
        #   真发生这种变动时，气泡里照旧会解释一句"余额少了…看着不像用掉的"。）
        m.addAction("查看天气", self._get_weather)
        m.addAction("看一眼在放什么", self.check_music_now)
        # 新界面：v1.1.0 起设置都搬进这个窗口（老菜单先全留着当兜底，跑稳一版再收）
        m.addAction("打开设置…", defer_dialog(self.open_console))
        # 快速双击弹哪个窗口：也放在这块最常用的区域里（一级菜单点一下就能换）
        dc_menu = m.addMenu(self._double_click_menu_title())
        dc_picked = self._double_click_choice()
        dc_has_key = bool(self._current_source()[1])
        for dc_key, dc_label in DOUBLE_CLICK_CHOICES:
            if dc_key == "balance" and not dc_has_key:
                # 没配 Key：这一项不给选（双击也不会弹余额窗口）
                dc_label += "（要先配 Key）"
            a = dc_menu.addAction(dc_label)
            a.setCheckable(True)
            a.setChecked(dc_picked == dc_key and (dc_key != "balance" or dc_has_key))
            a.setEnabled(dc_key != "balance" or dc_has_key)
            a.triggered.connect(lambda _, k=dc_key: self.set_double_click(k))
        dc_menu.addSeparator()
        n_dc = len(self.cfg.get("custom_lines", {}).get("DOUBLE_CLICK_LINES") or [])
        dc_menu.addAction("改写这几句…" + (f"（已改 {n_dc} 句）" if n_dc else ""),
                          defer_dialog(lambda: self.edit_lines_dialog("DOUBLE_CLICK_LINES")))
        m.addSeparator()

        mode_menu = m.addMenu("模式")
        for label, key in [("自由散步", "wander"), ("跟随鼠标", "follow"), ("原地待着", "still")]:
            a = mode_menu.addAction(label)
            a.setCheckable(True)
            a.setChecked(self.mode == key)
            a.triggered.connect(lambda _, k=key: self.set_mode(k))
        mode_menu.addSeparator()
        # 「原地待着」默认固定正面；想让桌宠实时盯着鼠标（只转头、不挪窝）就打开这条
        a = mode_menu.addAction("原地待着时也跟着鼠标转")
        a.setCheckable(True)
        a.setChecked(self.still_face_cursor)
        a.triggered.connect(self.set_still_face_cursor)
        size_menu = m.addMenu("大小")
        for label, mult in SIZE_LEVELS.items():
            a = size_menu.addAction(label)
            a.setCheckable(True)
            a.setChecked(abs(self.cur_h - 340 * mult) < 2)
            a.triggered.connect(lambda _, v=mult: self.set_size(v))
        size_menu.addSeparator()
        # 无级调节：滑块弹窗（菜单里内嵌滑块在这台机器上拖不动，见 _slider_dialog）
        size_menu.addAction(
            f"精确调节…（现在 {size_percent(self.cfg.get('size', SIZE_DEFAULT))}%）",
            defer_dialog(self.size_dialog))
        skin_menu = m.addMenu("形象")
        # v1.0.16：二级菜单就四条 —— 切三维 / 切挂件 / 形象库 / 全部恢复默认。
        # （原来那两套三级菜单去掉了：上传、换图、单套恢复都收进形象库窗口里，留着是重复）
        a = skin_menu.addAction(f"{SKIN_PET}（三视图）")
        a.setCheckable(True)
        a.setChecked(self.skin == SKIN_PET)
        a.triggered.connect(lambda _, n=SKIN_PET: self.set_skin(n))
        a = skin_menu.addAction(f"{SKIN_WIDGET}（单张）")
        a.setCheckable(True)
        a.setChecked(self.skin == SKIN_WIDGET)
        a.triggered.connect(lambda _, n=SKIN_WIDGET: self.set_skin(n))
        skin_menu.addSeparator()
        # 形象库：三维 / 挂件两本分开，上传·换图·改名·删掉·挑回来用都在这个窗口里
        n_pet = len(self.skin_library("pet"))
        n_wid = len(self.skin_library("widget"))
        skin_menu.addAction(
            (f"我的形象库…（三维 {n_pet} 个 · 挂件 {n_wid} 个）" if (n_pet or n_wid)
             else "我的形象库…（还没上传过）"),
            defer_dialog(self.skin_library_dialog))
        skin_menu.addAction("全部恢复默认形象", lambda: self.clear_custom_skin(None))
        layer_menu = m.addMenu("层级")
        for key, label in self.LAYER_LABELS.items():
            a = layer_menu.addAction(label)
            a.setCheckable(True)
            a.setChecked(self.layer == key)
            a.triggered.connect(lambda _, k=key: self.set_layer(k))
        # 透明度：改成"点开小窗口拖滑块"——菜单里内嵌滑块在这台机器上拖不动（弹出子菜单收不到鼠标）
        m.addAction(f"透明度…（现在 {int(self.opacity * 100)}%）",
                    defer_dialog(self.opacity_dialog))
        weather_menu = m.addMenu("天气")
        weather_menu.addAction("设置默认城市（手动输入）", self.set_city_dialog)
        # （「查看天气」挪到一级菜单最上面那块的"快速查看"里了）
        weather_menu.addAction("自动定位城市（按 IP，挂梯子会不准）", self.auto_locate_city)
        weather_menu.addAction("添加城市（联网搜索）", self.search_city_dialog)
        weather_menu.addSeparator()
        # 城市列表：加过的城市都在这儿，点一下就切过去（√ 是当前用的）
        # 顺序固定成"当前城市排第一"（选谁谁就上第一，见 _apply_city / cities_ordered）
        cur_city = self.cfg.get("city", "汕头")
        city_list = self.cities_ordered()
        for city in city_list:
            a = weather_menu.addAction(city)
            a.setCheckable(True)
            a.setChecked(city == cur_city)
            a.triggered.connect(lambda _, n=city: self._apply_city(n))
        if len(city_list) > 1:
            weather_menu.addAction("从列表里删掉城市…", self.remove_city_dialog)
        bal_menu = m.addMenu("余额")
        # （「查看余额」挪到一级菜单最上面那块"快速查看"里了）
        bal_menu.addAction("设置 Key", self._set_key_dialog)
        src_menu = bal_menu.addMenu("余额来源")
        for name in ["DeepSeek"] + [k.get("name", "?") for k in (self.cfg.get("other_keys") or [])]:
            a = src_menu.addAction(name)
            a.setCheckable(True)
            a.setChecked((self.cfg.get("balance_source") or "DeepSeek") == name)
            a.triggered.connect(lambda _, n=name: self.set_balance_source(n))
        bal_menu.addAction("添加其他 API Key…", self.add_other_key_dialog)
        if self.cfg.get("other_keys"):
            bal_menu.addAction("删除其他 API Key…", self.remove_other_key_dialog)
        # 账本自己算不出当天真实用量时（赠送额度到期、桌宠关着漏采）用来对齐平台那个数
        bal_menu.addAction("校准今日已用…（按平台用量页）",
                           defer_dialog(self.calibrate_usage_dialog))
        bal_menu.addSeparator()
        baa = bal_menu.addAction("余额常显")
        baa.setCheckable(True)
        baa.setChecked(self.balance_always)
        baa.triggered.connect(self.set_balance_always)

        # 吸附：独立菜单，不再塞在「余额」下面
        snap_menu = m.addMenu("吸附")
        sna = snap_menu.addAction("拖拽吸附四边")
        sna.setCheckable(True)
        sna.setChecked(self.snap_on)
        sna.triggered.connect(self.set_snap)
        fka = snap_menu.addAction("左吸附时翻面")
        fka.setCheckable(True)
        fka.setChecked(self.flip_on_left)
        fka.triggered.connect(self.set_flip_on_left)

        # 文案：独立菜单（峰谷显示 + 三档文案）
        text_menu = m.addMenu("文案")
        pka = text_menu.addAction("显示峰谷时段")
        pka.setCheckable(True)
        pka.setChecked(self.show_peak)
        pka.triggered.connect(self.set_show_peak)
        peak_menu = text_menu.addMenu("峰谷文案")
        for style in PEAK_TEXT_STYLES:
            a = peak_menu.addAction(style)
            a.setCheckable(True)
            a.setChecked(self.peak_style == style)
            a.triggered.connect(lambda _, s=style: self.set_peak_style(s))
        freq_menu = text_menu.addMenu("语录频率" + f"（现在：{self.line_freq}）")
        for name, preset in LINE_FREQ_LEVELS.items():
            a = freq_menu.addAction(f"{name}（{preset['hint']}）")
            a.setCheckable(True)
            a.setChecked(self.line_freq == name)
            a.triggered.connect(lambda _, n=name: self.set_line_freq(n))
        text_menu.addSeparator()
        # 台词内容：换了形象之后默认台词可能不搭，这里让用户自己写 / 改写内置
        n_custom = len(self.cfg.get("custom_lines") or {})
        text_menu.addAction(
            "台词内容…（自己写 / 改写内置）" + (f"（已改 {n_custom} 类）" if n_custom else ""),
            defer_dialog(self.edit_lines_dialog))

        # 每轮消耗：自己的子菜单，Agent 名称/日志目录可配（不是每个人都用 Codex）
        turn_menu = bal_menu.addMenu("每轮消耗统计")
        tca = turn_menu.addAction(f"每轮对话后显示消耗（当前：{self.agent_name}）")
        tca.setCheckable(True)
        tca.setChecked(self.turn_cost_on)
        tca.triggered.connect(self.set_turn_cost)
        turn_menu.addSeparator()
        turn_menu.addAction("设置 Agent 名称…", self.set_agent_name_dialog)
        turn_menu.addAction("设置会话日志目录…", self.set_agent_dir_dialog)
        turn_menu.addSeparator()
        turn_menu.addAction(f"日志目录：{os.path.basename(self.agent_dir.rstrip(os.sep)) or self.agent_dir}").setEnabled(False)

        # 进程联动：独立菜单，支持扫描本机应用并自定义触发文字
        proc_menu = m.addMenu("进程联动")
        pra = proc_menu.addAction("应用启动提醒")
        pra.setCheckable(True)
        pra.setChecked(self.process_alerts)
        pra.triggered.connect(self.set_process_alerts)
        proc_menu.addSeparator()
        proc_menu.addAction("扫描本机应用并添加…", self.scan_apps_dialog)
        if self.cfg.get("custom_process_lines") or self.cfg.get("default_line_overrides"):
            proc_menu.addAction("清理自定义文字…", self.remove_custom_app_dialog)
        proc_menu.addSeparator()
        proc_menu.addAction("使用时长提醒…",
                            defer_dialog(self.app_time_dialog))
        proc_menu.addAction("定时提醒…",
                            defer_dialog(self.timed_lines_dialog))
        proc_menu.addAction("全局快捷键…",
                            defer_dialog(self.hotkeys_dialog))

        # 音乐联动：QQ音乐 / 网易云 放歌时看歌词
        music_menu = m.addMenu("音乐联动")
        mla = music_menu.addAction("放歌时看着（放 QQ音乐 / 网易云 时联动）")
        mla.setCheckable(True)
        mla.setChecked(self.music_on)
        mla.triggered.connect(self.set_music_link)
        mlb = music_menu.addAction("显示歌词内容（关掉只报歌名）")
        mlb.setCheckable(True)
        mlb.setChecked(self.music_lyrics)
        mlb.triggered.connect(self.set_music_lyrics)
        off_menu = music_menu.addMenu("歌词对时" + self._lyric_offset_label())
        for label, off in LYRIC_OFFSET_LEVELS:
            a = off_menu.addAction(label)
            a.setCheckable(True)
            a.setChecked(abs(self.lyric_offset - off) < 1e-6)
            a.triggered.connect(lambda _, o=off: self.set_lyric_offset(o))
        # 网易云不报播放进度，中途才开始看（或拖过进度条）就只能手动对一次；按歌记住
        nud = music_menu.addMenu("这首歌对不上？微调" + self._lyric_nudge_label())
        nud.addAction("歌词太慢，往前赶 0.5 秒", lambda: self.nudge_lyric(0.5))
        nud.addAction("歌词太慢，往前赶 2 秒", lambda: self.nudge_lyric(2.0))
        nud.addAction("歌词太快，往后压 0.5 秒", lambda: self.nudge_lyric(-0.5))
        nud.addAction("歌词太快，往后压 2 秒", lambda: self.nudge_lyric(-2.0))
        nud.addSeparator()
        nud.addAction("按播放器显示的时间对齐…（最准）",
                      defer_dialog(self.align_lyric_dialog))
        nud.addAction("这首歌的微调清零", lambda: self.nudge_lyric(0.0, True))
        music_menu.addSeparator()
        music_menu.addAction(self._music_menu_label()).setEnabled(False)
        # （「看一眼在放什么」挪到一级菜单最上面那块"快速查看"里了）
        music_menu.addSeparator()
        music_menu.addAction("单击=回嘴（放歌时报歌名）· 快速双击="
                             + self._double_click_effect_label()).setEnabled(False)

        # 流畅度：动画优先 / 省资源，自己选
        perf_menu = m.addMenu("流畅度")
        for mode, label in ((True, "性能模式 · 动画优先（不掉帧）"),
                            (False, "休闲模式 · 省资源（可掉一点帧）")):
            a = perf_menu.addAction(label)
            a.setCheckable(True)
            a.setChecked(self.perf_mode == mode)
            a.triggered.connect(lambda _, k=mode: self.set_perf_mode(k))
        perf_menu.addSeparator()
        perf_menu.addAction("开设置菜单时：性能=动画照跑，休闲=降到约 5 帧").setEnabled(False)
        perf_menu.addAction("crossfade 仅位移/姿态切换（idle↔walk↔turnStop）").setEnabled(False)

        # 百宝箱：以后别的小工具都往这儿放（现在只有内存回收）
        box_menu = m.addMenu("百宝箱")
        box_menu.addAction("回收内存", self.mem_trim_now)
        mfg = box_menu.addAction("回收时不动前台程序（防卡顿）")
        mfg.setCheckable(True)
        mfg.setChecked(bool(self.cfg.get("mem_skip_foreground", True)))
        mfg.triggered.connect(self.set_mem_skip_foreground)
        box_menu.addSeparator()
        if self._mem_last:
            box_menu.addAction(
                f"上次：{self._mem_last[0]} 个程序腾出 {human_mb(self._mem_last[1])}"
            ).setEnabled(False)
        box_menu.addAction("系统 / 提权进程不回收（需要管理员权限）").setEnabled(False)

        # 百宝箱里再加两个小工具：免打扰 / 今日汇总
        box_menu.addSeparator()
        self._add_tool_actions(box_menu, with_lengths=True)

        snd_menu = m.addMenu("音效")
        so = snd_menu.addAction("按键音效")
        so.setCheckable(True)
        so.setChecked(self.sound_on)
        so.triggered.connect(self.set_sound)
        pick_menu = snd_menu.addMenu("音效选择")
        for idx, name in enumerate(self._sound_names()):
            if idx == len(SOUND_SETS):
                pick_menu.addSeparator()        # 下面开始是主人自己加的
            a = pick_menu.addAction(name)
            a.setCheckable(True)
            a.setChecked(self.sound_set == name)
            a.triggered.connect(lambda _, n=name: self.set_sound_set(n))
        snd_menu.addAction("添加我的音效…（自己挑 wav）",
                           defer_dialog(self.add_custom_sound_dialog))
        if getattr(self, "_custom_sounds", None):
            snd_menu.addAction("删掉我加的音效…",
                               defer_dialog(self.remove_custom_sound_dialog))
        # 音量：同样改成小窗口里拖滑块（菜单内嵌滑块在这台机器上拖不动）
        snd_menu.addAction(f"音量…（现在 {int(self.volume * 100)}%）",
                           defer_dialog(self.volume_dialog))
        snd_menu.addSeparator()
        snd_menu.addAction("试听音效", self.preview_sounds)
        m.addSeparator()
        m.addAction("显示/隐藏", self.toggle_visible)
        m.addAction("回到屏幕内", self.snap_into_screen)
        # 锁定位置：开了就拖不动（防误触），点击 / 双击 / 菜单照旧
        lk = m.addAction("锁定位置（拖不动·防误触）")
        lk.setCheckable(True)
        lk.setChecked(self.locked)
        lk.triggered.connect(self.set_locked)
        pa = m.addAction("鼠标穿透（点不到它）")
        pa.setCheckable(True)
        pa.setChecked(self.cfg["passthrough"])
        pa.triggered.connect(lambda on: self.set_passthrough(on))
        m.addAction("救急恢复（点不到它 / 它不见了）", self.force_recover)
        md = m.addAction("记菜单日志（菜单出问题时打开）")
        md.setCheckable(True)
        md.setChecked(bool(self.cfg.get("menu_debug", False)))
        md.triggered.connect(lambda on: self.set_menu_debug(on))
        aa = m.addAction("开机自启")
        aa.setCheckable(True)
        aa.setChecked(self.cfg["autostart"])
        aa.triggered.connect(lambda on: self.set_autostart(on))
        m.addSeparator()
        m.addAction("退出", self.quit_app)
        self._iconize_menu(m)          # 经典版也配同一套图标（两版菜单才叫统一）
        return m


    def _make_menu(self, classic=None):
        """建右键菜单：打开期间桌宠让位（临时取消置顶）并站住不动。

        classic=None（默认）看配置：「通用 → 用经典版菜单」打开时用完整版老菜单，
        否则用瘦身版快捷菜单；显式传 True / False 可以强制某一份（用例里用得多）。
        """
        if classic is None:
            classic = bool(self.cfg.get("classic_menu", False))
        m = self._build_menu() if classic else self._build_quick_menu()
        self._menu_keepalive = m          # 菜单是纯 Python 对象，留个引用防回收
        self._menu_pool = ([m] + self._menu_pool)[:4]     # 留几份，用来看"还有菜单开着吗"
        self._sub_rect = {}               # 新的一份菜单：上次那些"子菜单位置/补弹次数"作废
        self._resub = {}
        self._install_place_fix(m)        # 让每层子菜单"一显示就摆正"（同一帧，看不见挪动）
        # 不给菜单强加置顶标志——改成让桌宠自己在菜单期间退到普通层，
        # 这样菜单天然在最上面，而且是 Qt 标准的弹出菜单，二级菜单悬停最稳。

        def on_show():
            self.ui_open = True
            self._demote_topmost(True)

        def on_hide():
            # 别急着解除：可能还有别的菜单开着（比如托盘菜单），交给 _sync_overlay_state 对账
            for sub in list(self._hover_subs):      # 悬停兜底弹出来的子菜单要一起收掉
                try:
                    sub.close()
                except Exception:
                    pass
            self._hover_subs.clear()
            self._sync_overlay_state()
            self._hover_key = None

        m.aboutToShow.connect(on_show)
        m.aboutToHide.connect(on_hide)
        self._iconize_menu(m)
        return m


    def _menu_icon_name(self, text):
        return self._menu_icon_lookup(MENU_ICONS, text)


    def _menu_by_hwnd(self, hwnd):
        """按窗口句柄找到这是哪一层菜单（找不到返回 None）。"""
        root = getattr(self, "_menu_keepalive", None)
        if root is None:
            return None
        for m in self._all_menus(root):
            try:
                if int(m.winId()) == hwnd:
                    return m
            except RuntimeError:
                continue
        return None


    def _show_submenu_window(self, sub, where):
        """悬停不再弹子菜单（改用点击后的选择框，见 _pick_submenu）。"""
        return


    def _send_click_to(self, menu, ev):
        """把上层菜单收到的点击转给子菜单（Windows 会把点击送给持有捕获的上层菜单）。"""
        pos = QCursor.pos()
        local = menu.mapFromGlobal(pos)
        if not menu.rect().contains(local):
            return
        self._forwarding_move = True
        try:
            QApplication.sendEvent(menu, QMouseEvent(
                ev.type(), QPointF(local), QPointF(pos),
                ev.button(), ev.buttons(), ev.modifiers()))
        except Exception:
            pass
        finally:
            self._forwarding_move = False


    def _menu_click_through(self, on):
        """菜单/对话框开着时让桌宠不接收鼠标。

        二级菜单有时会弹到桌宠身上（靠屏幕右边、子菜单往左弹的时候最明显），
        点下去会被桌宠自己截住 —— 看起来就是"选项点不动"。菜单期间把窗口设成
        鼠标穿透，点击自然落到菜单上；菜单关了再按用户自己的设置还原。
        """
        try:
            hwnd = int(self.winId())
            GWL_EXSTYLE = -20
            style = ctypes.windll.user32.GetWindowLongPtrW(hwnd, GWL_EXSTYLE)
            style = click_through_style(style, on, bool(self.cfg.get("passthrough", False)))
            ctypes.windll.user32.SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style)
        except Exception:
            pass


    def _menu_tick(self):
        """每 120ms：先对账"让位状态"，再跑 v1.0.10 的"放宽触发范围 + 子菜单重叠"尝试。"""
        self._adopt_visible_menu()      # 托盘那条路是 Qt 自己弹的，先认准"屏幕上真正开着的那棵"
        self._sync_overlay_state()
        self._menu_hover_watch()
        self._prune_branches()
        self._close_orphan_submenus()
        # 菜单开着的时候跑勤一点（40ms）：万一某层子菜单被 Qt 摆歪，下 40ms 就纠回来，
        # 眼睛基本看不到"先摆一版再挪"；没菜单的时候回到 120ms，不白费电。
        want_ms = MENU_HOVER_FAST_MS if self.ui_open else MENU_HOVER_MS
        try:
            if self.hover_timer.interval() != want_ms:
                self.hover_timer.start(want_ms)
        except Exception:
            pass


    def _adopt_visible_menu(self):
        """把"屏幕上真正在显示的那棵菜单树"接到手里。

        托盘右键这条路的菜单是 Qt 自己弹的，而且每次右键都会重建一份（菜单里的勾选状态
        是按当前设置现画的）。万一 Qt 弹的是**上一次**那个对象，我们记着的 `_menu_keepalive`
        就跟屏幕上的对不上 —— 悬停兜底、收子菜单、点击摆渡会全部落空（表现就是
        "托盘里的二三级菜单还是老毛病"）。这里每 120ms 认一次，认错了就换过来。
        """
        root = getattr(self, "_menu_keepalive", None)
        if root is not None:
            try:
                if root.isVisible():
                    return          # 我们记着的那棵就在屏幕上 → 不用认
            except RuntimeError:
                pass
        try:
            all_menus = [w for w in QApplication.topLevelWidgets() if isinstance(w, QMenu)]
        except RuntimeError:
            return
        shown = []
        for m in all_menus:
            try:
                if m.isVisible():
                    shown.append(m)
            except RuntimeError:
                continue
        if not shown:
            return
        # 父关系要在**所有**菜单里找（包括已经关掉的上一层）：否则"上一层关了、子菜单还挂着"
        # 的时候，会把那个孤儿子菜单当成一棵树的根接管过来。
        inner = set()
        for m in all_menus:
            try:
                for a in m.actions():
                    child = a.menu()
                    if child is not None:
                        inner.add(id(child))
            except RuntimeError:
                continue
        roots = [m for m in shown if id(m) not in inner]
        if not roots:
            return
        popup = QApplication.activePopupWidget()      # 抓着鼠标的那个 = 当前这一支的根
        top = popup if popup in roots else roots[0]   # 都没有就按"最先建出来的"（根先于子菜单建）
        if root is top:
            return
        self._menu_keepalive = top
        if top not in self._menu_pool:
            self._menu_pool = ([top] + self._menu_pool)[:4]
        menu_debug("[兜底] 接管屏幕上真正显示的那棵菜单")


    def _menu_action_at(self, menu, pos, margin_x=0):
        """按（可横向放宽的）矩形找光标下那一项；纵向不放宽，免得串到相邻条目上。"""
        try:
            local = menu.mapFromGlobal(pos)
        except RuntimeError:
            return None
        if margin_x > 0:
            try:
                for a in menu.actions():
                    if a.isSeparator():
                        continue
                    r = menu.actionGeometry(a)
                    if (r.left() - margin_x <= local.x() <= r.right() + margin_x
                            and r.top() <= local.y() <= r.bottom()):
                        return a
            except RuntimeError:
                return None
        return menu.actionAt(local)


    def _submenu_pos(self, parent, holder, sub):
        """算子菜单该放哪儿：和一级菜单**重叠 MENU_OVERLAP 像素**，缩短鼠标要走的距离。

        关键：位置要在**弹出之前**算好（`sub.popup(位置)`），
        否则会"先出现在 Qt 算的位置、再跳过来"——主人一眼就看出来了。
        """
        try:
            item = parent.actionGeometry(holder)
            a = parent.mapToGlobal(item.topLeft())
            b = parent.mapToGlobal(item.bottomRight())
            screen = QApplication.screenAt(a) or QApplication.primaryScreen()
            geo = screen.availableGeometry()
            size = sub.size() if sub.isVisible() else sub.sizeHint()
            w, h = max(1, size.width()), max(1, size.height())
            # 这一层跟着上一层"往哪边弹"走：上一层是往左弹的，这一层也往左。
            # 不这样的话，孙子菜单会盖到爷爷（一级菜单）头上 —— 实测就是"三级菜单压住了
            # 一级菜单的「层级」那一条，于是悬停「层级」再也不出子菜单"。
            flip = bool(getattr(parent, "_dfy_flip_left", False))
            if flip:
                x = a.x() - w + self.MENU_OVERLAP
            else:
                x = b.x() - self.MENU_OVERLAP      # 先试右边（和这一条重叠）
                if x + w > geo.right():            # 右边放不下 → 放左边，同样重叠
                    x = a.x() - w + self.MENU_OVERLAP
                    flip = True
            sub._dfy_flip_left = flip
            y = a.y() - 4
            x = max(geo.left(), min(max(geo.left(), geo.right() - w), x))
            y = max(geo.top(), min(max(geo.top(), geo.bottom() - h), y))
            return QPoint(int(x), int(y))
        except Exception:
            return parent.mapToGlobal(QPoint(0, 0))


    def _menu_hover_watch(self):
        """菜单悬停的人为规则（用户定的，尽量贴近 Windows 原生）：

        · 光标在这一条的**任意位置**上 → 就弹这一条的子菜单
        · 移到下一条 → 上一个子菜单立刻换掉（不打架）
        · 光标进了子菜单 → 保持（并顺手把位置喂给 Qt，免得它以为鼠标跑了）
        · 既不在条上、也不在子菜单里 → 给 0.35 秒宽限（走过那条空档），超时才收
        """
        root = getattr(self, "_menu_keepalive", None)
        if not self.ui_open or root is None or not root.isVisible():
            self._hover_key = None
            self._keep = None
            self._leave_at = 0.0
            return
        pos = QCursor.pos()
        now = time.time()
        # 光标所在的菜单（含已经展开的子菜单）＋它下面的那一条
        menu = self._deepest_menu_at_cursor() or root
        # 让"光标停在哪一条"的高亮跟着手走：这台机器上 Qt 的弹出菜单收不到鼠标移动，
        # 高亮全靠我们喂（不然快速上下滑的时候高亮会停在老地方，看着就像卡住）。
        self._highlight_menu_item(menu, pos)
        act = self._menu_action_at(menu, pos, self.MENU_TRIGGER_MARGIN_X)

        # ① 光标压在某一条带子菜单的项上（这条的任意位置都算）→ 用它的子菜单
        if act is not None and act.menu() is not None:
            sub = act.menu()
            if self._keep is not None and self._keep[1] is not act:
                old_sub = None
                try:
                    old_sub = self._keep[1].menu()
                except RuntimeError:
                    old_sub = None
                # v1.0.10：如果"旧的子菜单"就是光标现在所在这一层（或它的上层），
                # 千万别关它 —— 关掉它等于把光标脚下的菜单收走（三级菜单一进去就没）。
                if old_sub is not None and not self._menu_covers(old_sub, menu):
                    self._close_submenu(old_sub)   # 移到别的条：旧的立刻关
                    menu_debug("[兜底] 换条 → 收掉上一个子菜单")
            self._keep = (menu, act)
            self._leave_at = 0.0
            self._hover_key = (id(menu), act.text())
            try:
                menu.setActiveAction(act)      # 这一条显成"选中"（高亮跟着手）
            except RuntimeError:
                pass
            self._ensure_chain_open(menu)      # 上层被 Qt 收掉了就补回来
            want = self._submenu_pos(menu, act, sub)
            if not sub.isVisible():
                # 方案 2：弹出前就把位置算成"和一级重叠"，中间不会有跳一下
                sub.popup(want)
                menu_debug(f"[兜底] 展开子菜单：{act.text()} @({want.x()},{want.y()}) "
                           f"这一条={menu.actionGeometry(act)}")
            else:
                # 自愈：不管是谁把子菜单放歪了（Qt 自己摆的、弹出时尺寸还没算准、
                # 或者被别的动作挪过），都挪回"贴住主人悬停的这一条"的位置。
                # 主人截图里"二级菜单位置/重叠忽上忽下"就是用这一条兜住的。
                try:
                    cur = sub.pos()
                except RuntimeError:
                    return
                dx, dy = abs(cur.x() - want.x()), abs(cur.y() - want.y())
                if dx > 2 or dy > 2:
                    sub.move(want)
                    menu_debug(f"[兜底] 子菜单挪回该在的位置：{act.text()} "
                               f"({cur.x()},{cur.y()}) → ({want.x()},{want.y()})")
            return

        # ② 光标已经在子菜单里 → 保持（喂一个位置给 Qt，免得它以为鼠标离开了）
        if self._keep is not None:
            deep_now = self._deepest_menu_at_cursor()
            if deep_now is not None:
                self._ensure_chain_open(deep_now)   # 上层被 Qt 收掉了就补回来
            parent, holder = self._keep
            sub = None
            try:
                sub = holder.menu()
            except RuntimeError:
                sub = None
            # v1.0.11：光标如果已经落到"同一个菜单里的另一条"上，就当成换条处理。
            # 不然下面那套"把被 Qt 收掉的子菜单顶回来"会把高亮又拽回旧的那一条 ——
            # 主人看到的就是"从「添加我的音效…」往旁边移，选中老是卡在「音效选择」上"。
            other = self._menu_action_at(parent, pos, self.MENU_TRIGGER_MARGIN_X)
            if other is not None and other is not holder:
                self._close_submenu(sub)
                if sub is not None:
                    self._resub.pop(sub, None)
                self._keep = (parent, other) if other.menu() is not None else None
                self._leave_at = 0.0
                self._highlight_menu_item(parent, pos)
                return
            if sub is not None:
                try:
                    if sub.isVisible() and sub.rect().contains(sub.mapFromGlobal(pos)):
                        self._leave_at = 0.0
                        self._sub_rect[sub] = (sub.mapToGlobal(QPoint(0, 0)), sub.size())
                        self._resub.pop(sub, None)
                        self._send_move_point(sub, pos)
                        return
                except RuntimeError:
                    pass
                try:
                    if not sub.isVisible():
                        # Qt 自己把它收了，而光标还停在它原来那一片 → 分三步往回捞：
                        # ① 让 Qt 按自己的流程重开（最干净）
                        # ② 还没开，就替 Qt 往这一条的中心塞一个鼠标移动（等于"手又停上去了"）
                        # ③ 连着几次都开不了，才自己补弹（最后手段，尽量不走到）
                        rect = self._sub_rect.get(sub)
                        near = rect is not None and self._point_near_rect(pos, rect[0], rect[1], 60)
                        tries = self._resub.get(sub, 0) + 1
                        self._resub[sub] = tries
                        if parent.isVisible():
                            parent.setActiveAction(None)
                            parent.setActiveAction(holder)
                            if near and tries >= 2:
                                self._send_move_point(parent, parent.mapToGlobal(
                                    parent.actionGeometry(holder).center()))
                            if near and tries >= 3:
                                self._resub[sub] = 0
                                sub.popup(self._submenu_pos(parent, holder, sub))
                        return
                except RuntimeError:
                    pass
            # ③ 既不在条上、也不在子菜单里 → 0.35 秒宽限（从条走到子菜单的空档），超时收
            if self._menu_action_at(parent, pos, self.MENU_TRIGGER_MARGIN_X) is holder:
                self._leave_at = 0.0        # v1.0.10：光标还在这一条的"放宽范围"里 → 保持
                return
            if self._leave_at == 0.0:
                self._leave_at = now
                return
            if now - self._leave_at <= 0.35:
                return
            # 光标可能落在更深一层（三级菜单）里：那就把"保持目标"跟下去，别手贱收掉
            deep = self._deepest_menu_at_cursor()
            if deep is not None and deep is not sub:
                self._ensure_chain_open(deep)      # Qt 会把上层收掉 → 逐个补回来
                found = self._find_submenu_parent(deep)
                if found is not None:
                    self._keep = found
                self._leave_at = 0.0
                return
            # 超时了，可光标还停在"这个子菜单原来那一片"上 → 说明是被 Qt 误收的，别放弃：
            # 自己把它弹回来（不然就成了"进去就没了"，实测 20 条里偶尔会中一条）。
            rect = self._sub_rect.get(sub)
            if rect is not None and self._point_near_rect(pos, rect[0], rect[1], 60):
                try:
                    if parent.isVisible():
                        sub.popup(self._submenu_pos(parent, holder, sub))
                        menu_debug("[兜底] 光标还在原地 → 重新弹出被误收的子菜单")
                        self._leave_at = 0.0
                        return
                except RuntimeError:
                    pass
            self._close_submenu(sub)
            self._keep = None
            self._leave_at = 0.0
        self._hover_key = None


    def _menu_covers(self, anc, menu):
        """anc 是不是 menu 本身、或者 menu 的某一层"上层菜单"。"""
        if anc is None or menu is None:
            return False
        cur = menu
        for _ in range(6):
            if cur is anc:
                return True
            found = self._find_submenu_parent(cur)
            if found is None:
                return False
            cur = found[0]
        return False


class PetFeatureMixin:
    def _music_playing(self):
        info = self.now_playing
        return bool(self.music_on and info and info.get("playing") and info.get("title"))


    def _music_paused(self):
        """放着一首歌、但现在是暂停。

        暂停之后**气泡先不撤**（`self.paused_bubble_sec` 之内都留着），这样右上角那颗 ▶
        还有地方点；超过这个时间就照旧收起来，免得屏幕上一直挂着一块歌词。
        """
        info = self.now_playing
        if not (self.music_on and info and info.get("title") and not info.get("playing")):
            return False
        at = getattr(self, "_music_paused_at", 0.0)
        return bool(at) and (time.time() - at) < self.paused_bubble_sec


    def _music_cmd_worker(self, kind):
        try:
            if kind in ("prev", "next"):
                ok = bool(skip_media(kind))
            else:
                ok = bool(toggle_media_playpause())
        except Exception:
            ok = False
        finally:
            self._music_cmd_queue.append((kind, ok))


    def _music_cmd_tick(self):
        """处理"切播放/暂停 / 上下首"的结果（主线程里跑）。"""
        if not self._music_cmd_queue:
            return
        kind, ok = self._music_cmd_queue.pop(0)
        self._music_cmd_busy = False
        if not ok:
            self.say("诶…播放器没理我，你手动点一下吧", seconds=3.0, again=True)
            return
        self.poll_music()                # 立刻看一眼新状态（图标马上翻过来）
        self.update()
        if kind in ("prev", "next"):
            # 切歌是播放器自己去做的，刚切完那一下它可能还报着上一首的元信息，
            # 等它缓过神来再读一次（不然气泡和歌词会停在上一首上）。
            QTimer.singleShot(700, self.poll_music)


    def _lyric_btn_kind(self, pos):
        """这个坐标点在哪颗按钮上（"prev" / "toggle" / "next"）；没点着返回 None。"""
        for kind, rect in (getattr(self, "_lyric_btn_rects", None) or {}).items():
            if rect is not None and rect.contains(pos):
                return kind
        return None


    def _lyric_btn_at(self, pos):
        """这个坐标是不是点在歌词气泡那几颗按钮上。"""
        return self._lyric_btn_kind(pos) is not None


    def _music_position(self):
        """当前放到第几秒。

        媒体会话给的是"读取那一刻"的快照，往后按时间自己走；有些播放器只给 0，
        那种情况就按"这首歌实际放了多久"累加（暂停不会累加）。
        """
        info = self.now_playing or {}
        pos = info.get("position")
        playing = bool(info.get("playing"))
        if pos is not None and float(pos) > 0.5:
            if not playing:
                return max(0.0, float(pos))        # 暂停：播放器报的就是当前位置，别往前跑
            return max(0.0, float(pos) + (time.time() - float(info.get("at") or time.time())))
        # 报的是 0 / 垃圾值（网易云就是这样，连总时长都不给）：
        # 只能靠我们自己累加的"这首歌放到哪"——**暂停时不清零**，切走再回来也接着走。
        return max(0.0, self._music_played)


    def _lyric_position(self):
        """算歌词用的时间：播放进度 − 对时偏移 ＋ 这首歌的微调（网易云不报进度时靠它手动对）。

        正数微调 = 歌词往前赶（显示更靠后的那句）；负数 = 往后压。
        """
        pos = (self._music_position()
               - float(getattr(self, "lyric_offset", 0.0))
               + float(getattr(self, "_lyric_nudge", 0.0)))
        return max(0.0, pos)


    def _lyric_progress(self):
        """当前这一句唱到几成了（0~1），用来做"唱到哪、字就变到哪"。"""
        lines = self._lyric_lines
        if not lines:
            return 0.0
        pos = self._lyric_position()
        idx = lyric_index(lines, pos)
        start = lines[idx][0]
        end = lines[idx + 1][0] if idx + 1 < len(lines) else start + 4.0
        span = max(0.4, float(end) - float(start))
        return max(0.0, min(1.0, (pos - start) / span))


    def _lyric_sung_total(self, text, start_sec):
        """这句已经唱到第几个字（可以是小数）。

        有**逐字歌词**（网易云 yrc / 增强 LRC）就按每个字的真实时间算 —— 这样能完全贴合
        真人演唱（唱歌不是匀速的）；没有就退回"按这句的起止时间匀速推"。
        """
        total = max(0, len(text))
        if total == 0:
            return 0.0
        pos = self._lyric_position()
        words = self._word_times_for(start_sec)
        if words:
            return max(0.0, min(float(total), sung_chars(words, pos) / max(1, len(words)) * total))
        return total * self._lyric_progress()


    def _lyric_anim_step(self):
        """换句过渡期间专用的一帧：走得比主时钟密（100 帧/秒），所以更顺。"""
        if self._lyric_anim_t > 0:
            self._lyric_anim_t = max(
                0.0, self._lyric_anim_t - (LYRIC_ANIM_MS / 1000.0) / max(0.05, LYRIC_ANIM_SEC))
        rect = getattr(self, "_lyric_repaint_rect", None)
        if rect is not None and not rect.isEmpty():
            self.update(rect)           # 只重画气泡那一块
        else:
            self.update()
        bubble_moving = (abs(self._bub_target[0] - self._bub_w) > 0.6
                         or abs(self._bub_target[1] - self._bub_h) > 0.6)
        if self._lyric_anim_t <= 0 and not bubble_moving:
            self._lyric_timer.stop()


    def _apply_now_playing(self, info):
        now = time.time()
        # 播放器不给进度时，靠这里累计的"播放了多少秒"来对歌词
        if self.now_playing and self.now_playing.get("playing") and self._music_tick_at:
            self._music_played += max(0.0, min(now - self._music_tick_at, 5.0))
        self._music_tick_at = now
        if info is None:
            if self.now_playing is not None:
                self.now_playing = None
                # 注意：**别**清空歌词/进度。网易云一暂停就可能把整个媒体会话收掉，
                # 清掉的话恢复播放时歌词会从头开始（主人反馈的"暂停和开启直接清零"就是这个）。
                self._music_gone_at = time.time()
                self.update()
            return
        # 换歌前先把"上一首放到哪"记下来（注意：要在覆盖 now_playing **之前**算，
        # 不然算出来的会是新歌的位置 —— 之前就踩过这个坑）
        old_key = self._lyric_key
        old_pos = self._music_position() if self.now_playing else 0.0
        self.now_playing = info
        # 记一下"什么时候开始暂停"：气泡要留着给主人点 ▶（见 _music_paused）
        if info.get("playing"):
            self._music_paused_at = 0.0
        elif (info.get("title") or "").strip() and not self._music_paused_at:
            self._music_paused_at = time.time()
        # 排查用（开了「记菜单日志」才写）：记下播放器到底报了什么，方便诊断歌词对不上的原因
        menu_debug(f"[音乐] {info.get('app')} playing={info.get('playing')} "
                   f"position={info.get('position')} title={info.get('title')!r}")
        title = (info.get("title") or "").strip()
        key = f"{title}|{info.get('artist', '')}"
        if not title and self._lyric_key:
            # 暂停 / 缓冲时有些播放器（尤其网易云）会短暂不给歌名：
            # 这时候**不能**当成换歌，否则歌词会从头开始显示（主人反馈的 bug）。
            self.update()
            return
        if key != self._lyric_key:
            if old_key:                             # 记下上一首放到哪（回来时不用从头开始）
                self._music_pos_memo[old_key] = old_pos
                self._lyric_nudges[old_key] = float(getattr(self, "_lyric_nudge", 0.0))
                if len(self._music_pos_memo) > 30:  # 别无限涨
                    for k in list(self._music_pos_memo)[:-20]:
                        self._music_pos_memo.pop(k, None)
            self._lyric_key = key
            # 播放器不报进度时，用"记忆里的位置"接着走（暂停→放别的→切回来 不会从 0 开始）
            memo = self._music_pos_memo.get(key, 0.0)
            gone = getattr(self, "_music_gone_at", 0.0)
            if gone and time.time() - gone > 30.0:
                memo = 0.0                      # 消失超过 30 秒：当成重新开始，别用老位置
            self._music_gone_at = 0.0
            reported = info.get("position")
            pos_ok = reported is not None and float(reported) > 0.5
            self._music_played = max(0.0, float(reported)) if pos_ok else max(0.0, memo)
            self._lyric_nudge = float(self._lyric_nudges.get(key, 0.0))
            cached = self._lyric_cache.get(key) or {}
            if isinstance(cached, str):          # 兼容老格式（纯文本）
                cached = {"v": 1, "text": cached}
            self._setup_lyrics_for(key, info, cached)
            if info.get("playing") and info.get("title"):
                self._announce_song()
        else:
            # 同一首歌：如果播放器报的进度和我们自己推的差很多（拖动进度条 / 回退），
            # 就以播放器报的为准 —— 不然歌词不会跟着跳（主人反馈过这个问题）。
            pos = info.get("position")
            if (pos is not None and float(pos) > 0.5        # 只信"报了真实进度"的播放器
                and abs(float(pos) - self._music_played) > 2.5):
                self._music_played = max(0.0, float(pos))
            # 同一首歌换了个播放器（比如网易云 → QQ音乐），时间轴能力可能变：
            # 变了就按新播放器重新决定"显不显示歌词"
            if (info.get("has_timeline") is False) != bool(
                    getattr(self, "_music_no_progress", False)):
                cached = self._lyric_cache.get(key) or {}
                if isinstance(cached, str):
                    cached = {"v": 1, "text": cached}
                self._setup_lyrics_for(key, info, cached)
        # 放歌时看勤一点：网易云根本不报进度（实测 position 恒为 0），我们只能靠"什么时候
        # 开始放"起算，看得越勤误差越小
        want_ms = 800 if info.get("playing") else MUSIC_POLL_MS
        try:
            if self.music_timer.interval() != want_ms:
                self.music_timer.start(want_ms)
        except Exception:
            pass
        self.update()


    def _music_menu_label(self):
        info = self.now_playing or {}
        if not self.music_on:
            return "音乐联动：已关闭"
        if info and info.get("title"):
            state = "正在放" if info.get("playing") else "暂停在"
            return f"{state}：{info.get('app', '')} · {self._song_label()}"
        return "现在没在放歌"


    def _apply_balance(self, res):
        self.bal_busy = False
        if not res.get("ok"):
            self.bal_error = str(res.get("error") or "")
            if res.get("code") == "NO_API":
                # 这个服务压根没有余额接口：不报错，如实展示
                self.balance = {"name": res.get("name") or "?", "total": None,
                                "currency": "", "today": 0.0, "no_api": True}
                self.show_balance_bubble(8.0)
                return
            if not res.get("silent") and self.balance is None:
                self.say("余额没取到诶：" + self.bal_error[:14])
            return

        total, currency = float(res["total"]), res["currency"]
        name = res.get("name") or "DeepSeek"
        # 今日已用记账只对 DeepSeek 有意义（本地按余额差值记账）
        if name == "DeepSeek":
            book = record_balance_usage(USAGE_PATH, total, currency,
                                        granted=res.get("granted"),
                                        topped_up=res.get("topped_up"),
                                        key_id=res.get("key_id") or "",
                                        sample_ts=res.get("ts"))
        else:
            book = {"today": 0.0, "adjust": 0.0, "amount": 0.0, "reason": ""}
        old = self.balance["total"] if self.balance else None
        self.balance = {"name": name, "total": total, "currency": currency,
                        "today": book["today"], "adjust": book["adjust"],
                        "adjust_reason": book.get("adjust_why") or book.get("reason") or "",
                        "stale": False, "no_api": False}
        self.bal_error = ""
        self._start_roll(total)

        if book.get("reason"):
            # 余额掉了一大块但不是用量（赠额到期/接口抽风之类）：说清楚，别让主人以为自己乱花钱
            symbol = currency_symbol(currency)
            self.say(f"余额少了 {symbol}{book['amount']:.2f}，看着不像用掉的"
                     f"（{book['reason']}），这次没算进今日已用", seconds=6.0, again=True)

        if getattr(self, "_peek_pending", False):
            # 双击要的那一眼：不管是不是在放歌，都把余额顶上来显示 5 秒
            self._peek_pending = False
            self._peek_balance(PEEK_SEC)
            return
        if self._music_playing():
            return          # 放歌时不打断歌词；想看余额快速双击就行
        if not res.get("silent"):
            self.show_balance_bubble(6.0)
        elif old is None or abs(total - old) > 1e-9:
            # 余额变了就滚一次给主人看
            self.show_balance_bubble(4.0)


    def _lyric_rows(self, head, cur, nxt, max_w, ink=None):
        """把歌词折成"要画的几行"。

        一句太长就先把字号往下缩（11 → 8 磅）；缩到底还超才截到 LYRIC_MAX_ROWS 行 ——
        主人反馈过"歌词显示不全"，所以尽量别丢掉半句话。
        ink 是当前气泡那套颜色（见 _bubble_ink）—— 颜色烘在结果里，换风格要连带重算。
        不给就按现在生效的那套来（老用例只关心折行，不传这个参数）。
        返回 (rows, 折好的当前句, 当前句用的字体, 它的 QFontMetrics)。
        """
        if ink is None:
            ink = self._bubble_ink()
        f_small = QFont(self.bubble_font)
        f_small.setPointSize(9)
        f_main = QFont(self.bubble_font)
        f_main.setPointSize(11)
        # 顶行右边那条要留给 ⏮ ⏸▶ ⏭（见 LYRIC_BTN_PAD），**只有第一行窄**：
        # 折到第二行起整行都能用。一行塞不下就折两行；两行还塞不下才丢"——歌手"，
        # 最后才省略 —— 以前是"只取第一行"，歌手甚至歌名会无声无息地消失。
        fm_s = QFontMetrics(f_small)
        head_w = max_w - LYRIC_BTN_PAD
        head_lines = wrap_text_hanging(fm_s, head, head_w, max_w)
        if len(head_lines) > LYRIC_HEAD_ROWS:
            # 先丢"——歌手"那截（唱到谁不重要，谁的什么歌才重要）
            head_lines = wrap_text_hanging(fm_s, head.split("——")[0].strip(),
                                           head_w, max_w)
        if len(head_lines) > LYRIC_HEAD_ROWS:
            head_lines = [elide_text(fm_s, head.split("——")[0].strip(), head_w)]
        head_lines = head_lines[:LYRIC_HEAD_ROWS]
        # 折行时别让「·」「——」孤零零留在行尾：挪到下一行开头（看着是故意换行的）
        for _i in range(len(head_lines) - 1):
            for _sep in ("——", "·"):
                if head_lines[_i].endswith(_sep):
                    head_lines[_i] = head_lines[_i][:-len(_sep)].rstrip()
                    head_lines[_i + 1] = _sep + " " + head_lines[_i + 1]
                    break
        cur_lines = wrap_text(QFontMetrics(f_main), cur, max_w)
        pt = 11
        while len(cur_lines) > LYRIC_MAX_ROWS and pt > LYRIC_MIN_PT:
            pt -= 1
            f_main.setPointSize(pt)
            cur_lines = wrap_text(QFontMetrics(f_main), cur, max_w)
        total = len(cur_lines)
        fm_m = QFontMetrics(f_main)
        if total > LYRIC_MAX_ROWS:
            # 字号已经缩到底还是装不下（比如迷你尺寸下遇到很长的英文句）：
            # 再多给两行，同时把顶部那行「♪ 应用 · 歌名」去掉，腾出高度，
            # 尽量让整句歌词都看得见（主人反馈过"歌词显示不全"）。
            keep = cur_lines[:LYRIC_OVERFLOW_ROWS]
            rows = [(line, f_main, ink["ly_main"]) for line in keep]
            return rows, keep, f_main, fm_m, 0
        cur_lines = cur_lines[:LYRIC_MAX_ROWS]
        # 下一句一直显示（主人要求：不要因为这一句长就不显示下一句）
        nxt_lines = wrap_text(QFontMetrics(f_small), nxt, max_w)[:1] if nxt else []
        rows = ([(line, f_small, ink["ly_head"]) for line in head_lines]
                + [(line, f_main, ink["ly_main"]) for line in cur_lines]
                + [(line, f_small, ink["ly_next"]) for line in nxt_lines])
        return rows, cur_lines, f_main, fm_m, len(head_lines)


    def _lyric_offset_label(self):
        """菜单标题里显示当前对时（例如「（文字延后 0.2 秒）」）。"""
        for label, off in LYRIC_OFFSET_LEVELS:
            if abs(getattr(self, "lyric_offset", 0.0) - off) < 1e-6:
                return "" if abs(off) < 1e-6 else f"（{label}）"
        return ""


    def _lyric_nudge_label(self):
        n = float(getattr(self, "_lyric_nudge", 0.0))
        if abs(n) < 1e-6:
            return ""
        return f"（现在{'往前赶' if n > 0 else '往后压'} {abs(n):.1f} 秒）"


class PetBridgeMixin:
    def _bridge_paint_fx(self, p, cx, bottom):
        """P3 C 微动画叠加层：纯 Qt 矢量绘制，不依赖新美术。"""
        fx = getattr(self, "_bridge_fx", None)
        if not fx:
            return
        now = self._secs()
        pet_h = max(1.0, float(self.cur_h))
        pet_w = pet_h * 0.66
        top = bottom - pet_h
        p.save()
        try:
            # 鲸鱼娘帧图自带表情（帧内眨眼/表情），笔绘的眨眼/腮红锚点按经典精灵比例算，
            # 画上去会落到脸外 —— 鲸鱼娘接管时先关掉这两项（Lead 审计 P0 简单方案）。
            whale_drawn = False
            try:
                whale_drawn = self._whale_active()
            except Exception:
                whale_drawn = False
            # 1) 眨眼：60~110ms 的眼睑线（无美术时的降级近似）
            if now < fx.get("blink_until", 0.0) and not whale_drawn:
                p.setPen(QColor(40, 44, 66, 210))
                for sgn in (-1, 1):
                    ex = cx + sgn * pet_w * 0.17
                    ey = top + pet_h * 0.38
                    p.drawLine(QPointF(ex - pet_w * 0.055, ey), QPointF(ex + pet_w * 0.055, ey))
                p.setPen(Qt.PenStyle.NoPen)
            # 2) 害羞腮红
            if now < fx.get("shy_until", 0.0) and not whale_drawn:
                p.setPen(Qt.PenStyle.NoPen)
                p.setBrush(QColor(255, 150, 170, 150))
                for sgn in (-1, 1):
                    bx = cx + sgn * pet_w * 0.20
                    by = top + pet_h * 0.46
                    p.drawEllipse(QPointF(bx, by), pet_w * 0.055, pet_h * 0.022)
            # 3) 爱心（上浮淡出）
            keep = []
            for item in (fx.get("hearts") or []):
                end_at, dx = item[0], item[1]
                left = end_at - now
                if left <= 0:
                    continue
                keep.append(item)
                prog = 1.0 - min(1.0, left / 1.8)
                hx = cx + dx * pet_w + math.sin(prog * 6.0) * pet_w * 0.03
                hy = top - pet_h * 0.02 - prog * pet_h * 0.22
                alpha = int(220 * max(0.0, 1.0 - prog))
                if alpha <= 0:
                    continue
                p.setPen(Qt.PenStyle.NoPen)
                p.setBrush(QColor(240, 96, 130, alpha))
                hs = pet_h * 0.05
                p.drawEllipse(QPointF(hx - hs * 0.5, hy), hs * 0.5, hs * 0.5)
                p.drawEllipse(QPointF(hx + hs * 0.5, hy), hs * 0.5, hs * 0.5)
                tri = QPolygonF([QPointF(hx - hs, hy + hs * 0.15),
                                 QPointF(hx, hy + hs * 1.05),
                                 QPointF(hx + hs, hy + hs * 0.15)])
                p.drawPolygon(tri)
            fx["hearts"] = keep
            # 4) 汗滴
            if now < fx.get("sweat_until", 0.0):
                p.setPen(Qt.PenStyle.NoPen)
                p.setBrush(QColor(120, 180, 235, 210))
                sx = cx + pet_w * 0.24
                sy = top + pet_h * 0.30 + math.sin(now * 18.0) * pet_h * 0.01
                p.drawEllipse(QPointF(sx, sy), pet_w * 0.032, pet_h * 0.017)
                drop = QPolygonF([QPointF(sx, sy - pet_h * 0.05),
                                  QPointF(sx - pet_w * 0.020, sy - pet_h * 0.004),
                                  QPointF(sx + pet_w * 0.020, sy - pet_h * 0.004)])
                p.drawPolygon(drop)
            # 5) Zzz（23:30~08:00 自动，或手动 fx:zzz）
            hh = time.localtime().tm_hour * 60 + time.localtime().tm_min
            late = (hh >= 23 * 60 + 30 or hh < 8 * 60)
            if late or now < fx.get("zzz_until", 0.0):
                p.setFont(QFont(self.bubble_font.family(), max(7, int(pet_h * 0.055)), QFont.Weight.Bold))
                for i in range(3):
                    phase = (now * 0.35 + i * 0.33) % 1.0
                    zx = cx + pet_w * 0.26 + phase * pet_w * 0.18
                    zy = top + pet_h * 0.20 - phase * pet_h * 0.30
                    alpha = int(200 * (1.0 - phase))
                    if alpha > 0:
                        p.setPen(QColor(150, 170, 235, alpha))
                        p.drawText(QPointF(zx, zy), "Z")
            # 6) 眩晕小星星
            if now < fx.get("dizzy_until", 0.0):
                p.setPen(Qt.PenStyle.NoPen)
                for i in range(3):
                    ang = now * 6.0 + i * 2.094
                    ox = cx + math.cos(ang) * pet_w * 0.24
                    oy = top + pet_h * 0.16 + math.sin(ang) * pet_h * 0.03
                    p.setBrush(QColor(255, 210, 90, 200))
                    p.drawEllipse(QPointF(ox, oy), pet_h * 0.014, pet_h * 0.014)
            # 7) PNG 帧序列（未来真美术接口：assets/fx/<name>/*.png）
            frames = fx.get("png_frames")
            if frames:
                elapsed = now - fx.get("png_at", now)
                dur = max(0.1, fx.get("png_dur", len(frames) * 0.06))
                idx = int(elapsed / dur * len(frames))
                if idx >= len(frames):
                    fx["png_frames"] = None
                else:
                    pm = frames[idx]
                    tw = pet_w * 1.2
                    th = tw * pm.height() / max(1, pm.width())
                    p.setOpacity(1.0)
                    p.drawPixmap(QRectF(cx - tw / 2, top - th * 0.15, tw, th), pm, QRectF(0, 0, pm.width(), pm.height()))
        finally:
            p.restore()


    def _bridge_fx_tick(self):
        fx = getattr(self, "_bridge_fx", None)
        if not fx:
            return
        now = self._secs()
        wall = time.time()
        if wall >= fx.get("next_blink", 0.0):
            fx["blink_until"] = now + 0.11
            fx["next_blink"] = wall + random.uniform(4.0, 7.0)
        if now >= fx.get("zzz_until", 0.0):
            fx["zzz_until"] = 0.0


    def _bridge_zone_react(self):
        """P1.5 点击热区分区：头（上半）/ 身体（中段）/ 尾脚（下半），身体走原来的随机回嘴。"""
        try:
            gp = getattr(self, "last_press_pos", None)
            if gp is None:
                return False
            lp = self.mapFromGlobal(gp)
            body_top = self.bubble_h + MARGIN
            rel = lp.y() - body_top
            pet_h = max(1, self.cur_h)
            if rel < pet_h * 0.40:
                zone = "head"
            elif rel > pet_h * 0.82:
                zone = "tail"
            else:
                return False
            self._bridge_zone_reaction(zone)
            return True
        except Exception:
            return False


    def _bridge_zone_reaction(self, zone):
        self.jump_t = max(getattr(self, "jump_t", 0.0), 0.5)
        if zone == "head":
            self._bridge_bubble_kind = "love"
            self._speech_request("pat", {"phase": "pat", "subkind": "head"},
                                 fallback="别摸头啦……再摸要长不高了")
            self.action, self.action_t = "sway", 0.8
            getattr(self, "_bridge_fx_play", lambda _n: None)("love")
        elif zone == "tail":
            self._bridge_bubble_kind = "remind"
            self._speech_request("pat", {"phase": "pat", "subkind": "tail"},
                                 fallback="尾巴不能拽！拽掉就不摇了")
            self.action, self.action_t = "shake", 1.0
        elif zone == "body":
            self._bridge_bubble_kind = "love"
            self._speech_request("praise", {"phase": "praise", "subkind": "body"})
            self.action, self.action_t = "stretch", 0.8


    def _bridge_native_contextMenuEvent(self, e):
        self._open_menu(e.globalPos())


class PetSpeechMixin:
    def _say_later(self, seconds, text, inner=False):
        self._pending_bubbles.append((self._secs() + seconds, text, inner))


    def _say_reminder(self, text, **kw):
        """说一句"提醒"（开应用 / 用久了 / 到点）。

        免打扰、或者前台是全屏游戏/电影的时候：**这句先攒着**，等结束了再一起汇报；
        平时就交给 `say(queue=True)` —— 前面还有触发类的话在说时依次排着说，不互相盖。
        """
        if self._hold_now():
            self._held_lines.append(text)
            del self._held_lines[:-20]        # 攒太多就留最近 20 条
            return
        self.say(text, queue=True, **kw)


    def _say_when_free(self, text, inner=False):
        """这句是自动冒的（比如换歌），但**别打断正在说的触发类的话**：排到它说完再说。"""
        if not self._trigger_speaking():
            self.say(text, inner=inner)
            return
        self._pending_bubbles.append((self._trigger_until + 0.25, text, inner))


    def _bubble_top(self, bh):
        """气泡贴着鱼头顶：尾巴尖落在精灵上沿附近。"""
        return max(2.0, self.bubble_h + MARGIN - 10 - bh)


    def _bubble_mode(self, now):
        """气泡区这会儿该显示什么：text（说话）/ balance（余额）/ lyric（歌词）。

        放歌时歌词优先于「余额常显」——想瞄一眼余额就快速双击（显示 5 秒）。
        """
        if self.bubble_text and now < self.bubble_until:
            return "text"
        if self.now_playing and now < self._bal_peek_until and self.balance is not None:
            return "balance"
        # 放歌期间一直显示这一块：有歌词就显示歌词，没有（或网易云不报进度）就显示「♪ 应用 · 歌名」
        # —— 主人要求"歌名信息要持续一整首歌"。刚按暂停的那几分钟也留着（好点 ▶ 继续放）。
        if self._music_playing() or self._music_paused():
            return "lyric"
        if self.balance is not None and (self.balance_always or now < self.bal_until):
            return "balance"
        return None


    def _bubble_theme(self):
        """气泡现在该用亮色还是深色那套（bubble_style="auto" 时跟着设置界面的主题）。"""
        style = getattr(self, "bubble_style", "auto")
        if style in ("light", "dark"):
            return style
        try:
            # 主人自己挑的亮 / 暗是定死的，直接算（这就是个字符串比较，便宜）
            if ui_console.get_mode() in ("light", "dark"):
                return "dark" if ui_console.is_dark() else "light"
        except Exception:                      # 界面模块没起来 → 还是老样子（浅色）
            return "light"
        # 剩下的只有"跟随系统"：那条路要读注册表，而画气泡时每帧都要问一次，
        # 所以结果缓存 1 秒（Windows 切深色模式时最多晚一秒跟上）
        now = time.time()
        cached = getattr(self, "_bubble_theme_cache", None)
        if cached is not None and now - cached[0] < 1.0:
            return cached[1]
        try:
            theme = "dark" if ui_console.is_dark() else "light"
        except Exception:
            theme = "light"
        self._bubble_theme_cache = (now, theme)
        return theme


    def _bubble_ink(self):
        """气泡那套颜色（底 / 字）。每帧都取一次，就是个字典查表，不重新算。
        P1.5+：联动桥可通过 _bridge_bubble_kind 给气泡加情绪色调（report/remind/night/greet/love）。
        """
        base = BUBBLE_INK[self._bubble_theme()]
        try:
            kind = getattr(self, "_bridge_bubble_kind", "") or ""
            tint = BRIDGE_BUBBLE_TINTS.get(kind)
            if tint:
                out = dict(base)
                out.update(tint)
                return out
        except Exception:
            pass
        return base


    def _speech_log(self, msg):
        _p = getattr(self, "_speech_log_path", "")
        if not _p:
            return
        try:
            with open(_p, "a", encoding="utf-8") as f:
                f.write("%.3f [speech] %s\n" % (time.time(), msg))
        except Exception:
            pass


    def _speech_local(self, text, seconds=3.2):
        try:
            self.say(text, seconds=seconds, queue=True, again=True)
        except Exception:
            pass


    def _speech_request(self, kind, context=None, fallback=None):
        """写 LLM 台词请求；正常返回 True（不冒固定台词），仅故障/失败时用 fallback。"""
        q = getattr(self, "_speech", None)
        if q is None or not getattr(self, "_speech_enabled", True):
            if fallback:
                self._speech_local(fallback)
            return False
        try:
            item = q.enqueue(kind, context)
        except Exception:
            item = None
        if item is None:
            if fallback:
                self._speech_local(fallback)
            return False
        try:
            self._speech_log("request kind=%s id=%s context=%s" % (kind, item.get("id"), context))
        except Exception:
            pass
        return True


    def _speech_on_reply(self):
        q = getattr(self, "_speech", None)
        if q is not None:
            try:
                q.on_reply()
                self._speech_log("reply received -> pending cleared")
            except Exception:
                pass


    def _speech_tick(self, now):
        """兜底：超过健康/离线阈值还没收到插件 say: → 用本地池一句（仅故障时）。"""
        q = getattr(self, "_speech", None)
        if q is None or not getattr(self, "_speech_enabled", True):
            return
        if not getattr(q, "pending", None):
            return
        try:
            # P1：健康判定用桥接生命状态（life_offline=失联休眠），不要只看最后一行时间；
            # 插件正常但静默 >30s 时也等 4.5s，绝不让本地池抢在 LLM 前。
            _healthy = not bool(getattr(self, "_life_offline", False))
            due = q.fallback_due(now, getattr(self, "_last_line_at", 0.0), healthy=_healthy)
        except Exception:
            due = None
        if due:
            text, reason = due
            try:
                print("[speech] fallback:", reason, text)
            except Exception:
                pass
            self._bridge_bubble_kind = "remind"
            try:
                self._speech_log("fallback reason=%s text=%s" % (reason, text))
            except Exception:
                pass
            self._speech_local(text)


    def _say_clock_rule(self, rule, lines):
        """一条到点规则该说的话：可选"今天的小结" + 一句台词。"""
        text = random.choice(lines)
        if rule.get("summary"):
            head = self.daily_summary()
            if head:
                text = head + "。" + text
        self._say_reminder(text)


    def _peek_balance(self, seconds=PEEK_SEC):
        """把余额泡泡临时顶上来显示几秒（快速双击用它；放歌时优先于歌词）。"""
        self.show_balance_bubble(seconds, force=True)
        self._bal_peek_until = self._secs() + seconds
        self.action, self.action_t = random.choice(("sway", "stretch")), 1.0
        self.jump_t = max(self.jump_t, 0.6)


class PetWindowMixins(PetAnimMixin, PetRenderMixin, PetMenuMixin, PetFeatureMixin, PetBridgeMixin, PetSpeechMixin):
    pass
