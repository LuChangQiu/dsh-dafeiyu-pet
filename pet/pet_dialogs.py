# -*- coding: utf-8 -*-
"""原生对话框（应用扫描/自动台词/形象编辑/形象库） (task-152 机械搬迁；逻辑未改)。

模块级命名空间在导入时从 pet_window 复制（函数/常量/Qt/依赖），
以便原代码里的模块级引用保持原语义；pet_window 末尾再回填本模块符号。
"""
from __future__ import annotations

# ruff: noqa: F401, F821
import pet_window as _pw

globals().update({k: v for k, v in vars(_pw).items() if not k.startswith("__")})

class AutoSayDialog(QDialog):
    """一张表管一类"自动说话"的规则：用久了 / 到点 / 快捷键。

    kind：
      apptime = 用久了提醒（某个应用连续在前台用满 N 分钟）
      clock   = 到点说一句（每天 / 每周 / 每隔一段时间）
      hotkey  = 全局快捷键（按一下就说一句）
    规则都存在 config.json 里；这里只管增删改，改完立刻生效（快捷键会重新注册）。
    """

    KINDS = {
        "apptime": ("应用使用时长提醒",
                    "同一应用连续使用达到设定分钟数时显示一条提示；\n"
                    "无键鼠操作的时间不计入（挂机、看视频不计）。"),
        "clock": ("定时提醒",
                  "按每天、每周指定日期或固定间隔显示提示。"),
        "hotkey": ("全局快捷键",
                   "在任意窗口按下组合键触发。\n"
                   + hotkey_supported_hint()),
    }

    def __init__(self, owner, kind, apps=None):
        super().__init__(None)
        if ui_console:                      # 跟设置窗口用同一套配色
            ui_console.style_dialog(self, BUNDLE_DIR)
        self.owner = owner
        self.kind = kind
        self.apps = list(apps or [])
        # 列表项前面那颗图标：用久了那本画应用的真图标（跟「扫描到的应用」一个口径），
        # 到点 / 快捷键两本画同类的小图标。这里先把 exe → 完整路径 攒起来。
        self._icons = QFileIconProvider()
        self._paths = {}
        if kind == "apptime":
            for exe, _label, path in self.apps:
                if exe and path:
                    self._paths.setdefault(exe.lower(), path)
            try:
                for exe, path in running_processes():
                    if exe and path:            # 正在跑的一般都能拿到真路径
                        self._paths.setdefault(exe.lower(), path)
            except Exception:
                pass
        title, tip = self.KINDS.get(kind, ("自动说话", ""))
        self.setWindowTitle(title)
        self.setWindowFlag(Qt.WindowType.WindowStaysOnTopHint, True)
        self.resize(560, 520)

        lay = QVBoxLayout(self)
        head = QLabel(tip)
        head.setWordWrap(True)
        lay.addWidget(head)
        self.tip = QLabel("")
        self.tip.setWordWrap(True)
        self.tip.setObjectName("dim")
        lay.addWidget(self.tip)

        self.listw = QListWidget()
        self.listw.setIconSize(QSize(24, 24))
        lay.addWidget(self.listw, 1)

        row = QHBoxLayout()
        self.add_btn = QPushButton("添加")
        self.edit_btn = QPushButton("编辑")
        self.del_btn = QPushButton("删除")
        self.try_btn = QPushButton("预览")
        close_btn = QPushButton("关闭")
        for btn in (self.add_btn, self.edit_btn, self.del_btn, self.try_btn):
            row.addWidget(btn)
        row.addStretch(1)
        row.addWidget(close_btn)
        lay.addLayout(row)

        self.add_btn.clicked.connect(lambda: self._edit(None))
        self.edit_btn.clicked.connect(lambda: self._edit(self._current()))
        self.del_btn.clicked.connect(self._delete)
        self.try_btn.clicked.connect(self._try)
        close_btn.clicked.connect(self.accept)
        self.listw.itemDoubleClicked.connect(lambda _i: self._edit(self._current()))
        self.listw.currentItemChanged.connect(lambda *_: self._sync_buttons())
        self._fill()

    # ---------- 规则的读写（都走桌宠那边的接口）----------
    def _entries(self):
        """[(键, 规则)]。apptime 的键是 exe 名，另外两种是规则的 id。"""
        if self.kind == "apptime":
            return [(exe, dict(rule))
                    for exe, rule in (self.owner.app_time_rules() or {}).items()]
        rules = (self.owner.clock_rules() if self.kind == "clock"
                 else self.owner.hotkey_rules())
        out = []
        for i, rule in enumerate(rules or []):
            item = dict(rule)
            item["id"] = item.get("id") or f"auto-{i}"
            out.append((item["id"], item))
        return out

    def _store(self, entries):
        if self.kind == "apptime":
            box = {}
            for key, rule in entries:
                if key:
                    box[key] = rule
            self.owner.set_app_time_rules(box)
        elif self.kind == "clock":
            self.owner.set_clock_rules([rule for _key, rule in entries])
        else:
            self.owner.set_hotkey_rules([rule for _key, rule in entries])
        self.owner.save_config()

    def _new_id(self, prefix):
        return f"{prefix}-{int(time.time() * 1000) % 100000000}"

    @staticmethod
    def _exe_from_text(text):
        """下拉里选的是「微信（wechat.exe）」这种写法，也可能直接手敲一个 exe 名。"""
        text = (text or "").strip()
        if text.endswith("）") and "（" in text:
            text = text.rsplit("（", 1)[1][:-1]
        elif text.endswith(")") and "(" in text:
            text = text.rsplit("(", 1)[1][:-1]
        return text.strip().lower()

    def _app_choices(self):
        """[(exe, 显示文字)]：已经配过的 + 扫到的应用。"""
        items, seen = [], set()
        for exe, _rule in self._entries():
            exe = (exe or "").lower()
            if exe and exe not in seen:
                seen.add(exe)
                items.append((exe, exe))
        for exe, label, _path in self.apps:
            exe = (exe or "").lower()
            if exe and exe not in seen:
                seen.add(exe)
                items.append((exe, f"{label}（{exe}）"))
        return items

    # ---------- 列表 ----------
    def _row_icon(self, key, rule):
        """列表项前面那颗图标。

        用久了那本：exe 的**真图标**（规则里记着路径 → 扫到的路径 → 注册表 App Paths），
        都找不到才退成一张通用文件图标。另外两本给个同类的小图标（钟 / 键盘）。
        """
        if self.kind != "apptime":
            name = "page.clock" if self.kind == "clock" else "ui.keyboard"
            try:
                color = (ui_console.tokens().get("text_dim", "#7b8093")
                         if ui_console else "#7b8093")
                return ui_console.icon(name, color, 18) if ui_console else None
            except Exception:
                return None
        exe = (key or "").lower()
        path = rule.get("path") or self._paths.get(exe)
        if not path and exe:                    # 没在跑、也不在开始菜单里：查注册表
            path = app_path_for(exe)
            if path:
                self._paths[exe] = path
        try:
            if path and os.path.exists(path):
                icon = self._icons.icon(QFileInfo(path))
                if not icon.isNull():
                    return icon
        except Exception:
            pass
        try:
            return self._icons.icon(QFileIconProvider.IconType.File)
        except Exception:
            return None

    def _label(self, key, rule):
        lines = [str(t) for t in (rule.get("lines") or []) if str(t).strip()]
        if self.kind == "apptime":
            head = f"{key}：连续使用 {int(rule.get('minutes') or 60)} 分钟"
            repeat = int(rule.get("repeat") or 0)
            if repeat:
                head += f"，之后每 {repeat} 分钟重复"
        elif self.kind == "clock":
            when = (rule.get("when") or "daily").lower()
            if when == "interval":
                head = f"每隔 {int(rule.get('every') or 60)} 分钟"
            elif when == "weekly":
                days = "、".join(WEEKDAY_NAMES[d] for d in sorted(rule.get("days") or [])
                                 if isinstance(d, int) and 0 <= d < 7)
                head = f"每周 {days or '（未选择星期）'} {rule.get('time') or ''}"
            else:
                head = f"每天 {rule.get('time') or ''}"
            if rule.get("summary"):
                head += "（含今日汇总）"
        else:
            head = rule.get("seq") or "（未设置按键）"
            act = rule.get("act") or "lines"
            if act != "lines":
                head += f"（{dict(HOTKEY_ACTS).get(act, act)}）"
        if not rule.get("on", True):
            head = "（已停用）" + head
        if not lines:
            tail = ("（无附加文字）" if self.kind == "hotkey"
                    and (rule.get("act") or "lines") != "lines" else "（未填写文字）")
        else:
            tail = lines[0]
        return f"{head} —— {tail}"

    def _fill(self):
        keep = None
        cur = self._current()
        if cur:
            keep = cur[0]
        self.listw.clear()
        for key, rule in self._entries():
            item = QListWidgetItem(self._label(key, rule))
            item.setData(Qt.ItemDataRole.UserRole, key)
            icon = self._row_icon(key, rule)
            if icon is not None:
                item.setIcon(icon)
            self.listw.addItem(item)
        if self.listw.count():
            row = self.listw.count() - 1
            for i in range(self.listw.count()):
                if self.listw.item(i).data(Qt.ItemDataRole.UserRole) == keep:
                    row = i
                    break
            self.listw.setCurrentRow(row)
        self._sync_buttons()

    def _sync_buttons(self):
        has = self._current() is not None
        for btn in (self.edit_btn, self.del_btn, self.try_btn):
            btn.setEnabled(has)

    def _current(self):
        item = self.listw.currentItem()
        if item is None:
            return None
        key = item.data(Qt.ItemDataRole.UserRole)
        for k, rule in self._entries():
            if k == key:
                return (k, rule)
        return None

    def _delete(self):
        cur = self._current()
        if not cur:
            return
        key, rule = cur
        what = self._label(key, rule).split(" —— ")[0]
        yes = QMessageBox.question(
            self, "删除", f"删掉这一条？\n{what}",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No)
        if yes != QMessageBox.StandardButton.Yes:
            return
        self._store([(k, r) for k, r in self._entries() if k != key])
        self.tip.setText(f"已经删掉：{what}")
        self._fill()

    def _try(self):
        cur = self._current()
        if not cur:
            return
        if self.kind == "hotkey" and (cur[1].get("act") or "lines") != "lines":
            self.tip.setText("这一条是动作快捷键，真按下去才看得到效果")
            return
        lines = [str(t) for t in (cur[1].get("lines") or []) if str(t).strip()]
        if not lines:
            self.tip.setText("这条还没有提示文字，先点「编辑」填写")
            return
        self.owner.say(random.choice(lines), again=True, seconds=3.2)

    # ---------- 编辑一条 ----------
    def _edit(self, cur):
        from PySide6.QtCore import QTime
        from PySide6.QtWidgets import QCheckBox, QKeySequenceEdit, QPlainTextEdit, QSpinBox, QTimeEdit
        rule = dict(cur[1]) if cur else {}
        old_key = cur[0] if cur else None
        is_new = cur is None
        title = self.KINDS.get(self.kind, ("自动说话", ""))[0]
        dlg = QDialog(self)
        dlg.setWindowTitle(("添加 · " if is_new else "修改 · ") + title)
        if ui_console:
            ui_console.style_dialog(dlg, BUNDLE_DIR)
        dlg.resize(460, 430)
        lay = QVBoxLayout(dlg)
        box = {}                      # 各种控件，保存时统一读

        if self.kind == "apptime":
            row = QHBoxLayout()
            row.addWidget(QLabel("应用："))
            combo = QComboBox()
            combo.setEditable(True)
            for exe, text in self._app_choices():
                combo.addItem(text, exe)
            want = (old_key or "").lower()
            if want:
                idx = combo.findData(want)
                if idx >= 0:
                    combo.setCurrentIndex(idx)
                else:
                    combo.setEditText(want)
            row.addWidget(combo, 1)
            lay.addLayout(row)
            box["exe"] = combo
            hint = QLabel("列表为已配置与本机扫描到的应用，也可直接输入进程名（例如 notepad.exe）。\n"
                          "提示文字支持 {app}（应用名）、{minutes}（分钟数）、{hm}（小时分钟）。")
            hint.setWordWrap(True)
            hint.setObjectName("dim")
            lay.addWidget(hint)

            row2 = QHBoxLayout()
            row2.addWidget(QLabel("连续使用："))
            spin = QSpinBox()
            spin.setRange(1, 600)
            spin.setSuffix(" 分钟")
            spin.setValue(int(rule.get("minutes") or 60))
            row2.addWidget(spin)
            row2.addSpacing(12)
            row2.addWidget(QLabel("重复间隔："))
            rep = QSpinBox()
            rep.setRange(0, 600)
            rep.setSuffix(" 分钟")
            rep.setSpecialValueText("不再提醒")
            rep.setValue(int(rule.get("repeat") or 0))
            row2.addWidget(rep)
            row2.addStretch(1)
            lay.addLayout(row2)
            box["minutes"], box["repeat"] = spin, rep

        elif self.kind == "clock":
            row = QHBoxLayout()
            row.addWidget(QLabel("触发方式："))
            mode = QComboBox()
            mode.addItem("每天这个点", "daily")
            mode.addItem("每周选几天", "weekly")
            mode.addItem("每隔一段时间", "interval")
            when = (rule.get("when") or "daily").lower()
            idx = mode.findData(when)
            mode.setCurrentIndex(idx if idx >= 0 else 0)
            row.addWidget(mode, 1)
            row.addWidget(QLabel("时刻："))
            edit_time = QTimeEdit()
            edit_time.setDisplayFormat("HH:mm")
            hh, mm = 23, 30
            try:
                hh, mm = [int(x) for x in (rule.get("time") or "23:30").split(":")[:2]]
            except Exception:
                pass
            edit_time.setTime(QTime(hh % 24, max(0, min(59, mm))))
            row.addWidget(edit_time)
            lay.addLayout(row)
            box["when"], box["time"] = mode, edit_time

            days_row = QWidget()
            days_lay = QHBoxLayout(days_row)
            days_lay.setContentsMargins(0, 0, 0, 0)
            days_lay.addWidget(QLabel("哪几天："))
            day_boxes = []
            chosen = set(rule.get("days") or [])
            for i, name in enumerate(WEEKDAY_NAMES):
                cb = QCheckBox(name)
                cb.setChecked(i in chosen)
                days_lay.addWidget(cb)
                day_boxes.append(cb)
            days_lay.addStretch(1)
            lay.addWidget(days_row)
            box["days"] = day_boxes

            every_row = QWidget()
            every_lay = QHBoxLayout(every_row)
            every_lay.setContentsMargins(0, 0, 0, 0)
            every_lay.addWidget(QLabel("每隔："))
            every = QSpinBox()
            every.setRange(1, 1440)
            every.setSuffix(" 分钟")
            every.setValue(int(rule.get("every") or 60))
            every_lay.addWidget(every)
            every_lay.addStretch(1)
            lay.addWidget(every_row)
            box["every"] = every

            sum_box = QCheckBox("先说「今日汇总」（余额用量 + 使用时长最长的应用）")
            sum_box.setChecked(bool(rule.get("summary")))
            lay.addWidget(sum_box)
            box["summary"] = sum_box

            def sync_clock_rows(_=None):
                kind_now = mode.currentData()
                days_row.setVisible(kind_now == "weekly")
                every_row.setVisible(kind_now == "interval")
                edit_time.setVisible(kind_now != "interval")

            mode.currentIndexChanged.connect(sync_clock_rows)
            sync_clock_rows()

        else:
            row = QHBoxLayout()
            row.addWidget(QLabel("按键："))
            seq = QKeySequenceEdit()
            if rule.get("seq"):
                seq.setKeySequence(QKeySequence(rule["seq"]))
            row.addWidget(seq, 1)
            lay.addLayout(row)
            box["seq"] = seq
            hint = QLabel(hotkey_supported_hint()
                          + "（点一下右边的框，然后直接按你要的组合键）")
            hint.setWordWrap(True)
            hint.setObjectName("dim")
            lay.addWidget(hint)
            act_row = QHBoxLayout()
            act_row.addWidget(QLabel("触发动作："))
            act_box = QComboBox()
            for value, label in HOTKEY_ACTS:
                act_box.addItem(label, value)
            ai = act_box.findData(rule.get("act") or "lines")
            act_box.setCurrentIndex(ai if ai >= 0 else 0)
            act_row.addWidget(act_box, 1)
            lay.addLayout(act_row)
            box["act"] = act_box

        line_title = QLabel("提示文字（一行一条）：")
        lay.addWidget(line_title)
        edit = QPlainTextEdit()
        edit.setPlainText("\n".join(str(t) for t in (rule.get("lines") or [])))
        lay.addWidget(edit, 1)
        box["lines"] = edit
        if self.kind == "hotkey":
            def sync_act(_=None):
                says = (box["act"].currentData() or "lines") == "lines"
                line_title.setText("提示文字（一行一条）：" if says
                                   else "附加文字（可留空）：")
            box["act"].currentIndexChanged.connect(sync_act)
            sync_act()

        on_box = QCheckBox("启用这一条")
        on_box.setChecked(bool(rule.get("on", True)))
        lay.addWidget(on_box)

        btns = QHBoxLayout()
        btns.addStretch(1)
        ok_btn = QPushButton("保存")
        ok_btn.setObjectName("primary")
        cancel_btn = QPushButton("取消")
        btns.addWidget(ok_btn)
        btns.addWidget(cancel_btn)
        lay.addLayout(btns)

        result = {}

        def save():
            lines = [t.strip() for t in box["lines"].toPlainText().splitlines() if t.strip()]
            if self.kind != "hotkey" and not lines:
                QMessageBox.information(dlg, "缺少提示文字", "至少填写一条提示文字。",
                                        QMessageBox.StandardButton.Ok)
                return
            item = {"on": on_box.isChecked(), "lines": lines}
            if self.kind == "apptime":
                exe = self._exe_from_text(box["exe"].currentText())
                if not exe:
                    QMessageBox.information(dlg, "未选择应用",
                                            "请选择一个应用，或输入进程名。",
                                            QMessageBox.StandardButton.Ok)
                    return
                item["exe"] = exe
                item["minutes"] = int(box["minutes"].value())
                item["repeat"] = int(box["repeat"].value())
                # 顺手把 exe 的完整路径记下来：下次打开这本列表不用再找一遍就能画图标
                item["path"] = self._paths.get(exe) or rule.get("path") or ""
                result["key"] = exe
            elif self.kind == "clock":
                when = box["when"].currentData()
                item["when"] = when
                item["time"] = box["time"].time().toString("HH:mm")
                item["days"] = [i for i, cb in enumerate(box["days"]) if cb.isChecked()]
                item["every"] = int(box["every"].value())
                item["summary"] = bool(box["summary"].isChecked())
                if when == "weekly" and not item["days"]:
                    QMessageBox.information(dlg, "还没选星期", "「每周选几天」至少要勾一天。",
                                            QMessageBox.StandardButton.Ok)
                    return
                item["id"] = (rule.get("id") if not is_new else None) or self._new_id("t")
                result["key"] = item["id"]
            else:
                text = box["seq"].keySequence().toString()
                if not text or hotkey_parse(text) is None:
                    QMessageBox.information(
                        dlg, "不支持的按键",
                        hotkey_supported_hint() + "\n（例如 Ctrl+Alt+1、Ctrl+Shift+F9）",
                        QMessageBox.StandardButton.Ok)
                    return
                act = box["act"].currentData() or "lines"
                if act == "lines" and not lines:
                    QMessageBox.information(dlg, "缺少提示文字",
                                            "动作选「说一句」时，至少填写一条提示文字。",
                                            QMessageBox.StandardButton.Ok)
                    return
                item["act"] = act
                item["seq"] = text
                item["id"] = (rule.get("id") if not is_new else None) or self._new_id("hk")
                result["key"] = item["id"]
            result["rule"] = item
            dlg.accept()

        ok_btn.clicked.connect(save)
        cancel_btn.clicked.connect(dlg.reject)
        if dlg.exec() != QDialog.DialogCode.Accepted or "rule" not in result:
            return
        entries = [(k, r) for k, r in self._entries() if k != old_key]
        entries.append((result["key"], result["rule"]))
        self._store(entries)
        self._fill()
        if self.kind == "hotkey":
            bad = self.owner.hotkey_failed_texts()
            self.tip.setText("快捷键已生效，按一下试试"
                             + (f"（这几个被别的程序占用了，按不出来：{'、'.join(bad)}）"
                                if bad else ""))
        else:
            self.tip.setText("存好啦，马上生效")


class SkinLibraryDialog(QDialog):
    """我的形象库：两本分开 —— 三维形象（三视图）/ 挂件形象（单张），上面切换。

    三维形象 = 正面 / 侧面 / 背面三张图（**列表和预览默认显示正面那张**），三张齐了才算一个形象；
    挂件形象 = 一张 cut-out。上传、换图、改名、从库里删掉全在这个窗口里（主人要求：两个库 + 上传整合到一起）。
    桌宠只记原图在硬盘上的路径、不复制文件：别删原图、也别挪位置。
    """

    def __init__(self, owner, kind="pet"):
        super().__init__(None)
        if ui_console:                      # 跟设置窗口用同一套配色
            ui_console.style_dialog(self, BUNDLE_DIR)
        self.owner = owner
        self.kind = kind if kind in ("pet", "widget") else "pet"
        self.setWindowTitle("我的形象库")
        self.setWindowFlag(Qt.WindowType.WindowStaysOnTopHint, True)
        self.resize(720, 520)

        lay = QVBoxLayout(self)
        top = QHBoxLayout()
        top.addWidget(QLabel("看哪一本："))
        self.kind_box = QComboBox()
        self.kind_box.addItem("三维形象（三视图）", "pet")
        self.kind_box.addItem("挂件形象（单张）", "widget")
        self.kind_box.setCurrentIndex(0 if self.kind == "pet" else 1)
        self.kind_box.currentIndexChanged.connect(self._kind_changed)
        top.addWidget(self.kind_box, 1)
        lay.addLayout(top)
        self.tip = QLabel()
        self.tip.setWordWrap(True)
        lay.addWidget(self.tip)

        body = QHBoxLayout()
        self.listw = QListWidget()
        self.listw.setIconSize(QSize(56, 56))
        self.listw.setMinimumWidth(260)
        body.addWidget(self.listw, 1)

        right = QVBoxLayout()
        self.preview = QLabel("（选一张看看）")
        self.preview.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.preview.setMinimumSize(230, 165)
        self.preview.setObjectName("preview")
        right.addWidget(self.preview, 1)
        # 这本空着的时候，预览那块地方换成"插图 + 该干嘛"（不是只丢一句灰字）
        self.empty_mark = None
        if ui_console is not None:
            try:
                self.empty_mark = ui_console.EmptyState(
                    "empty.skin", "这本还空着",
                    "点下面的「上传新形象…」加一个", size=64)
                self.empty_mark.setVisible(False)
                right.addWidget(self.empty_mark, 1)
            except Exception:
                self.empty_mark = None
        # 三维形象：三张小图并排（正面 / 侧面 / 背面），一眼看出哪张缺
        self.slot_box = QWidget()
        slot_row = QHBoxLayout(self.slot_box)
        slot_row.setContentsMargins(0, 0, 0, 0)
        self.slot_shots = {}
        for view in PET_SLOTS:
            cell = QVBoxLayout()
            shot = QLabel("（缺）")
            shot.setFixedSize(76, 76)
            shot.setAlignment(Qt.AlignmentFlag.AlignCenter)
            shot.setObjectName("thumb")
            cap = QLabel(VIEW_SHORT[view])
            cap.setAlignment(Qt.AlignmentFlag.AlignCenter)
            cap.setObjectName("dim")
            cell.addWidget(shot)
            cell.addWidget(cap)
            self.slot_shots[view] = shot
            slot_row.addLayout(cell)
        right.addWidget(self.slot_box)
        self.info = QLabel("")
        self.info.setWordWrap(True)
        self.info.setObjectName("dim")
        right.addWidget(self.info)

        row1 = QHBoxLayout()
        self.use_btn = QPushButton("用这个形象")
        row1.addWidget(self.use_btn)
        row1.addStretch(1)
        # 只把"这一本"正用着的自定义形象退回自带的（库里的条目都留着，随时能再用）
        self.restore_btn = QPushButton("这套恢复默认")
        row1.addWidget(self.restore_btn)
        right.addLayout(row1)

        row2 = QHBoxLayout()
        self.edit_btn = QPushButton("换图…")
        self.rename_btn = QPushButton("改名…")
        self.del_btn = QPushButton("从库里删掉")
        for b in (self.edit_btn, self.rename_btn, self.del_btn):
            row2.addWidget(b)
        right.addLayout(row2)
        body.addLayout(right, 1)
        lay.addLayout(body, 1)

        bottom = QHBoxLayout()
        self.add_btn = QPushButton("上传新形象…")
        close_btn = QPushButton("关闭")
        bottom.addWidget(self.add_btn)
        bottom.addStretch(1)
        bottom.addWidget(close_btn)
        lay.addLayout(bottom)

        self.add_btn.clicked.connect(self._upload)
        self.use_btn.clicked.connect(self._double_clicked)
        self.restore_btn.clicked.connect(self._restore)
        self.edit_btn.clicked.connect(self._edit)
        self.rename_btn.clicked.connect(self._rename)
        self.del_btn.clicked.connect(self._remove)
        close_btn.clicked.connect(self.accept)
        self.listw.currentItemChanged.connect(lambda *_: self._show_detail())
        self.listw.itemDoubleClicked.connect(self._double_clicked)
        self._refresh()

    # ---------- 列表 ----------
    def _kind_changed(self, _index=None):
        self.kind = self.kind_box.currentData() or "pet"
        self._refresh()

    def _refresh(self):
        """重新读一遍这一本形象库（换本 / 改名 / 换图 / 删掉之后都走这儿）。"""
        self.slot_box.setVisible(self.kind == "pet")
        self.kind_box.blockSignals(True)
        self.kind_box.setItemText(0, f"三维形象（三视图）·  {len(self.owner.skin_library('pet'))} 个")
        self.kind_box.setItemText(
            1, f"挂件形象（单张）·  {len(self.owner.skin_library('widget'))} 个")
        self.kind_box.blockSignals(False)
        keep = self._current_id()
        self.listw.blockSignals(True)
        self.listw.clear()
        for ent in self.owner.skin_library(self.kind):
            item = QListWidgetItem()
            item.setData(Qt.ItemDataRole.UserRole, ent["id"])
            self._decorate(item, ent)
            self.listw.addItem(item)
        self.listw.blockSignals(False)
        row = 0
        for i in range(self.listw.count()):
            if self.listw.item(i).data(Qt.ItemDataRole.UserRole) == keep:
                row = i
                break
        if self.listw.count():
            self.listw.setCurrentRow(row)
        self._show_detail()

    def _decorate(self, item, ent):
        badges = []
        if self.owner.skin_in_use(self.kind, ent["id"]):
            badges.append("正在用")
        missing = self.owner.skin_missing_views(self.kind, ent)
        if missing:
            badges.append("⚠ " + "、".join(VIEW_SHORT[v] for v in missing) + "那张找不到了")
        item.setText(ent["name"] + ("　" + "　".join(badges) if badges else ""))
        thumb = self.owner.skin_thumb_path(self.kind, ent)     # 三维默认拿正面那张当图标
        pix = QPixmap(thumb) if thumb else QPixmap()
        if not pix.isNull():
            item.setIcon(QIcon(pix.scaled(56, 56, Qt.AspectRatioMode.KeepAspectRatio,
                                          Qt.TransformationMode.SmoothTransformation)))
        if item.icon().isNull():
            item.setIcon(QFileIconProvider().icon(QFileIconProvider.IconType.File))

    def _current_id(self):
        item = self.listw.currentItem()
        return item.data(Qt.ItemDataRole.UserRole) if item is not None else None

    def _current_entry(self):
        sid = self._current_id()
        return self.owner.skin_entry(self.kind, sid) if sid else None

    def _show_detail(self):
        ent = self._current_entry()
        if ent is None:
            if self.empty_mark is not None:
                self.empty_mark.setVisible(True)
            self.preview.setVisible(False)
            self.tip.setText(
                ("这本还空着。点下面的「上传新形象…」把正面 / 侧面 / 背面三张图都挑齐，"
                 "起个名字就收录成一个三维形象（列表和预览显示的是正面那张）。")
                if self.kind == "pet" else
                "这本还空着。点下面的「上传新形象…」挑一张图、起个名字就行"
                "（PNG 这类带透明背景的最好看）。")
            if self.empty_mark is not None:
                self.empty_mark.set_text(
                    "这本还空着",
                    "点下面的「上传新形象…」挑三张（正面 / 侧面 / 背面）"
                    if self.kind == "pet" else
                    "点下面的「上传新形象…」挑一张（带透明背景的最好）")
            self.info.setText("")
            for shot in self.slot_shots.values():
                shot.setPixmap(QPixmap())
                shot.setText("（缺）")
            self._enable(False)
            return
        if self.empty_mark is not None:
            self.empty_mark.setVisible(False)
        self.preview.setVisible(True)
        missing = self.owner.skin_missing_views(self.kind, ent)
        self.tip.setText(
            ("三张图齐了才算一个三维形象；下面显示的是正面那张，点「用这个形象」整套换上。\n"
             if self.kind == "pet" else "挑一个，点「用这个形象」就换上了。\n")
            + "桌宠只记【原图在硬盘上的位置】、不复制文件：别删它、也别挪地方；"
              "真挪了就点「换图…」重新指过去；只想退回自带的，点「这套恢复默认」（库里的还留着）。")
        made = ent["added"] or "（早期上传的，没记时间）"
        info = [f"名字：{ent['name']}", f"收进库的时间：{made}",
                "正在用：这本的当前形象" if self.owner.skin_in_use(self.kind, ent["id"])
                else "现在还没用上"]
        for view in (PET_SLOTS if self.kind == "pet" else ("widget",)):
            path = self.owner.skin_view_path(self.kind, ent, view)
            if view in missing:                 # 找不到的才把完整路径摊出来（方便照着找）
                info.append(f"⚠ {VIEW_SHORT[view]}：{path}\n　　（这个位置已经没有文件了）")
            else:
                info.append(f"{VIEW_SHORT[view]}：{os.path.basename(path)}")
        self.info.setText("\n".join(info))

        for view in PET_SLOTS:                      # 三张小图：缺哪张一眼看出来
            path = ent.get(view) or ""
            shot = self.slot_shots[view]
            pix = QPixmap(path) if (path and os.path.exists(path)) else QPixmap()
            shot.setText("" if not pix.isNull() else ("（缺）" if not path else "（不在了）"))
            shot.setPixmap(QPixmap() if pix.isNull() else pix.scaled(
                76, 76, Qt.AspectRatioMode.KeepAspectRatio,
                Qt.TransformationMode.SmoothTransformation))
        main = self.owner.skin_thumb_path(self.kind, ent)   # 三维 = 正面那张
        pix = QPixmap(main) if main else QPixmap()
        if pix.isNull():
            self.preview.setPixmap(QPixmap())
            self.preview.setText("（文件找不到了\n点「换图…」重新指一张）")
        else:
            self.preview.setText("")
            self.preview.setPixmap(pix.scaled(250, 170, Qt.AspectRatioMode.KeepAspectRatio,
                                              Qt.TransformationMode.SmoothTransformation))
        self._enable(True, not missing)

    def _enable(self, has_entry, exists=False):
        self.use_btn.setEnabled(bool(has_entry and exists))
        self.edit_btn.setEnabled(bool(has_entry))
        self.rename_btn.setEnabled(bool(has_entry))
        self.del_btn.setEnabled(bool(has_entry))
        # 「这套恢复默认」只看"这一本现在是不是自定义的"，跟选中哪条无关
        in_use = bool(self.owner._current_skin_ref(self.kind))
        self.restore_btn.setEnabled(in_use)
        self.restore_btn.setToolTip(
            "把这一本正用着的自定义形象退回自带的（库里的条目都留着，随时能再挑回来）"
            if in_use else "这一本现在用的就是自带的形象")

    # ---------- 按钮 ----------
    def _restore(self):
        """只把这一本（三维 / 挂件）恢复成自带形象，不动另一本、也不动库。"""
        self.owner.clear_custom_skin(self.kind)
        self._refresh()

    def _apply(self):
        ent = self._current_entry()
        if ent is None:
            return
        if self.owner.apply_skin(self.kind, ent["id"], parent=self):
            self._refresh()

    def _double_clicked(self, _item):
        self._apply()

    def _upload(self):
        if self.owner.upload_skin(self.kind, parent=self) is not None:
            self._refresh()

    def _edit(self):
        ent = self._current_entry()
        if ent is not None and self.owner.edit_skin(self.kind, ent["id"], parent=self) is not None:
            self._refresh()

    def _rename(self):
        ent = self._current_entry()
        if ent is not None and self.owner.rename_skin(self.kind, ent["id"], parent=self):
            self._refresh()

    def _remove(self):
        ent = self._current_entry()
        if ent is not None and self.owner.remove_skin(self.kind, ent["id"], parent=self):
            self._refresh()


class AppScanDialog(QDialog):
    """带图标的应用列表：能搜索、能看图标，选一个给它加"打开时说的话"。

    图标直接从 exe 取（QFileIconProvider），所以不用额外素材；
    ● 表示这个应用默认就有台词，✓ 表示你已经自定义过。
    """

    def __init__(self, owner, apps):
        super().__init__(None)
        if ui_console:                      # 跟设置窗口用同一套配色
            ui_console.style_dialog(self, BUNDLE_DIR)
        self.owner = owner
        self._icons = QFileIconProvider()
        self.setWindowTitle("扫描到的应用")
        self.setWindowFlag(Qt.WindowType.WindowStaysOnTopHint, True)
        self.resize(470, 580)

        lay = QVBoxLayout(self)
        self.tip = QLabel("选一个应用，然后点下面的按钮。\n"
                          "● 内置默认（已经自带台词，不能重复添加，但可以改）　✎ 已改写　✓ 你自己加的")
        self.tip.setWordWrap(True)
        lay.addWidget(self.tip)

        self.search = QLineEdit()
        self.search.setPlaceholderText("搜索应用名或 exe，例如 steam / edge / 微信")
        lay.addWidget(self.search)

        self.listw = QListWidget()
        self.listw.setIconSize(QSize(24, 24))
        lay.addWidget(self.listw, 1)

        row = QHBoxLayout()
        self.add_btn = QPushButton("添加触发文字")
        self.del_btn = QPushButton("删除该应用的文字")
        close_btn = QPushButton("关闭")
        row.addWidget(self.add_btn)
        row.addWidget(self.del_btn)
        row.addWidget(close_btn)
        lay.addLayout(row)

        self.add_btn.clicked.connect(self._add_line)
        self.del_btn.clicked.connect(self._del_line)
        close_btn.clicked.connect(self.accept)
        self.listw.itemDoubleClicked.connect(lambda _item: self._add_line())
        self.listw.currentItemChanged.connect(lambda *_: self._refresh_buttons())
        self.search.textChanged.connect(self._filter)
        self._fill(apps)
        self._refresh_buttons()

    def _fill(self, apps):
        self.listw.clear()
        for exe, label, path in apps:
            item = QListWidgetItem()
            item.setIcon(self._icon_for(path))
            item.setData(Qt.ItemDataRole.UserRole, exe)
            item.setData(Qt.ItemDataRole.UserRole + 1, f"{label}（{exe}）")
            self.listw.addItem(item)
            self._mark_item(item)
        if self.listw.count():
            self.listw.setCurrentRow(0)

    def _icon_for(self, path):
        try:
            if path and os.path.exists(path):
                icon = self._icons.icon(QFileInfo(path))
                if not icon.isNull():
                    return icon
        except Exception:
            pass
        return self._icons.icon(QFileIconProvider.IconType.File)

    def _mark_item(self, item):
        exe = item.data(Qt.ItemDataRole.UserRole)
        base = item.data(Qt.ItemDataRole.UserRole + 1)
        custom = self.owner.cfg.get("custom_process_lines") or {}
        overrides = self.owner.cfg.get("default_line_overrides") or {}
        if exe in PROCESS_LINES:
            # 内置应用：已经自带台词，不能再"重复添加"，但可以改写或恢复
            tag = "✎已改写默认台词" if exe in overrides else "●内置默认（不可重复添加）"
            item.setText(f"{base}　{tag}")
        elif exe in custom:
            item.setText(f"{base}　✓已添加")
        else:
            item.setText(base)

    def _state_of(self, exe):
        """返回 (是否内置, 当前文字列表, 是否已改写/已添加)。"""
        overrides = self.owner.cfg.get("default_line_overrides") or {}
        custom = self.owner.cfg.get("custom_process_lines") or {}
        if exe in PROCESS_LINES:
            lines = overrides.get(exe) or PROCESS_LINES[exe]
            return True, list(lines), exe in overrides
        lines = custom.get(exe) or []
        return False, list(lines), bool(lines)

    def _refresh_buttons(self):
        exe = None
        item = self.listw.currentItem()
        if item is not None and not item.isHidden():
            exe = item.data(Qt.ItemDataRole.UserRole)
        if not exe:
            self.add_btn.setEnabled(False)
            self.del_btn.setEnabled(False)
            return
        is_default, lines, changed = self._state_of(exe)
        self.add_btn.setEnabled(True)
        self.add_btn.setText("修改默认台词" if is_default else
                             ("修改触发文字" if lines else "添加触发文字"))
        self.del_btn.setEnabled(changed)
        self.del_btn.setText("恢复内置台词" if (is_default and changed) else
                             ("删除自定义文字" if (not is_default and lines) else "无需清理"))

    def _filter(self, text):
        text = (text or "").strip().lower()
        for i in range(self.listw.count()):
            item = self.listw.item(i)
            item.setHidden(bool(text) and text not in item.text().lower())

    def _current_exe(self):
        item = self.listw.currentItem()
        if item is None or item.isHidden():
            self.tip.setText("先在上面选一个应用～")
            return None
        return item.data(Qt.ItemDataRole.UserRole)

    def _add_line(self):
        exe = self._current_exe()
        if not exe:
            return
        is_default, current, _changed = self._state_of(exe)
        title = "修改内置台词" if is_default else "触发文字"
        hint = ("这是内置应用，原来的台词已经在下面了，改完会替换掉它（不会重复添加）："
                if is_default else "打开这个应用时它要说什么？（一句一行，可以写多行）")
        text, ok = QInputDialog.getMultiLineText(
            self, f"{exe} · {title}", hint, "\n".join(current),
            Qt.WindowType.WindowStaysOnTopHint)
        if not ok or not text.strip():
            return
        lines = [t.strip() for t in text.splitlines() if t.strip()]
        if is_default:
            overrides = dict(self.owner.cfg.get("default_line_overrides") or {})
            overrides[exe] = lines
            self.owner.cfg["default_line_overrides"] = overrides
        else:
            custom = dict(self.owner.cfg.get("custom_process_lines") or {})
            custom[exe] = lines
            self.owner.cfg["custom_process_lines"] = custom
        self.owner.save_config()
        self.owner.say(f"记住啦，开 {exe} 我就说这句")
        self.owner._invalidate_proc_lines()
        self.tip.setText(f"{exe} 现在有 {len(lines)} 句，切到这个应用就会冒泡")
        self._mark_item(self.listw.currentItem())
        self._refresh_buttons()

    def _del_line(self):
        exe = self._current_exe()
        if not exe:
            return
        is_default, _lines, changed = self._state_of(exe)
        if not changed:
            self.tip.setText(f"{exe} 用的是内置原版台词，没什么可清的")
            self._refresh_buttons()
            return
        if is_default:
            overrides = dict(self.owner.cfg.get("default_line_overrides") or {})
            overrides.pop(exe, None)
            self.owner.cfg["default_line_overrides"] = overrides
            self.owner.save_config()
            self.owner.say(f"{exe} 的台词恢复成内置的了")
            self.owner._invalidate_proc_lines()
            self.tip.setText(f"{exe} 已恢复内置台词")
            self._mark_item(self.listw.currentItem())
            self._refresh_buttons()
            return
        custom = dict(self.owner.cfg.get("custom_process_lines") or {})
        custom.pop(exe, None)
        self.owner.cfg["custom_process_lines"] = custom
        self.owner.save_config()
        self.owner.say(f"已删掉 {exe} 的自定义文字")
        self.owner._invalidate_proc_lines()
        self.tip.setText(f"已清掉 {exe} 的自定义文字")
        self._mark_item(self.listw.currentItem())
        self._refresh_buttons()


class SkinEditDialog(QDialog):
    """上传 / 编辑一个形象：三维的挑三张，挂件的挑一张。

    规矩是主人定的：**三维形象要把正面 / 侧面 / 背面三张照片都挑齐了才算一个形象**
    （少一张不给保存、也不会收录）；名字在这个窗口里起，
    「原图别删、别挪」的提醒也写在这个窗口里。
    """

    SLOTS = {"pet": PET_SLOTS, "widget": ("widget",)}

    def __init__(self, owner, kind, entry=None, prefill=None):
        super().__init__(None)
        if ui_console:                      # 跟设置窗口用同一套配色
            ui_console.style_dialog(self, BUNDLE_DIR)
        self.owner = owner
        self.kind = kind if kind in self.SLOTS else "widget"
        self.entry = dict(entry) if entry else None
        src = self.entry or prefill or {}
        self.slots = {}
        for view in self.SLOTS[self.kind]:
            self.slots[view] = str(src.get("path" if view == "widget" else view) or "")
        self.result_data = None
        self.setWindowTitle(("编辑" if self.entry else "上传") + SKIN_KIND_LABELS[self.kind])
        self.setWindowFlag(Qt.WindowType.WindowStaysOnTopHint, True)
        self.resize(580, 340 if self.kind == "pet" else 250)

        lay = QVBoxLayout(self)
        tip = QLabel(
            "三维形象要 正面 / 侧面 / 背面 三张都挑齐了才会收录成一个形象"
            "（先挑哪张都行，点「保存」才算数）。"
            if self.kind == "pet" else
            "挂件形象就一张图（PNG 这类带透明背景的最好看）。")
        tip.setWordWrap(True)
        lay.addWidget(tip)

        name_row = QHBoxLayout()
        name_row.addWidget(QLabel("名字："))
        self.name_edit = QLineEdit(str(src.get("name") or ""))
        self.name_edit.setPlaceholderText("给这个形象起个名字（挑完图会自动填文件名）")
        name_row.addWidget(self.name_edit, 1)
        lay.addLayout(name_row)

        self.slot_widgets = {}
        for view in self.SLOTS[self.kind]:
            line = QHBoxLayout()
            cap = QLabel(VIEW_LABELS.get(view, view))
            cap.setFixedWidth(150)
            line.addWidget(cap)
            shot = QLabel("（还没选）")
            shot.setFixedSize(76, 76)
            shot.setAlignment(Qt.AlignmentFlag.AlignCenter)
            shot.setObjectName("thumb")
            line.addWidget(shot)
            path_lb = QLabel("")
            path_lb.setWordWrap(True)
            path_lb.setObjectName("dim")
            line.addWidget(path_lb, 1)
            pick = QPushButton("选图片…")
            pick.clicked.connect(lambda _=False, vv=view: self._pick(vv))
            line.addWidget(pick)
            lay.addLayout(line)
            self.slot_widgets[view] = (shot, path_lb)

        self.status = QLabel("")
        self.status.setWordWrap(True)
        lay.addWidget(self.status)
        warn = QLabel(
            "⚠ 记住两点（桌宠记的是原图在硬盘上的位置，不会复制走）：\n"
            "　· 别把源文件删掉；\n"
            "　· 别改它的路径 —— 改名、挪文件夹、换盘都会让桌宠找不到。\n"
            "真找不到时，「我的形象库…」里点「换图…」重新指一张就行。")
        warn.setWordWrap(True)
        warn.setObjectName("warnText")
        lay.addWidget(warn)

        btns = QHBoxLayout()
        self.save_btn = QPushButton("保存")
        cancel_btn = QPushButton("取消")
        # 对话框按钮也配同一套小图标（颜色按对话框自己的主题算，每次建窗口都现算）
        if ui_console is not None:
            try:
                fg = ui_console.tokens()["text"]      # 保存键是普通按钮，配正文色
                self.save_btn.setIconSize(QSize(16, 16))
                self.save_btn.setIcon(ui_console.icon("ui.save", fg, 16))
            except Exception:
                pass
        btns.addStretch(1)
        btns.addWidget(self.save_btn)
        btns.addWidget(cancel_btn)
        lay.addLayout(btns)

        self.save_btn.clicked.connect(self._save)
        cancel_btn.clicked.connect(self.reject)
        self.name_edit.textChanged.connect(lambda *_: self._refresh())
        self._refresh()

    def _pick(self, view):
        path, _ok = QFileDialog.getOpenFileName(
            self, f"选{VIEW_LABELS.get(view, view)}那张图", self.owner._skin_pick_dir(),
            "图片 (*.png *.jpg *.jpeg *.webp *.bmp *.gif)",
            options=QFileDialog.Option.DontUseNativeDialog)
        if not path:
            return
        if QPixmap(path).isNull():
            self.owner.say("这张图读不了，换一张试试")
            return
        self.slots[view] = path
        self.owner.cfg["skin_pick_dir"] = os.path.dirname(path)
        if not self.name_edit.text().strip():
            self.name_edit.setText(os.path.splitext(os.path.basename(path))[0] or "我的形象")
        self._refresh()

    def missing(self):
        """还差哪几张（没选 / 文件不在了）。"""
        return [v for v in self.SLOTS[self.kind]
                if not self.slots.get(v) or not os.path.exists(self.slots.get(v))]

    def _refresh(self):
        need = self.missing()
        for view, (shot, path_lb) in self.slot_widgets.items():
            path = self.slots.get(view) or ""
            if path and os.path.exists(path):
                pix = QPixmap(path)
                shot.setText("（读不了）" if pix.isNull() else "")
                shot.setPixmap(QPixmap() if pix.isNull() else pix.scaled(
                    76, 76, Qt.AspectRatioMode.KeepAspectRatio,
                    Qt.TransformationMode.SmoothTransformation))
                path_lb.setText(f"{os.path.basename(path)}\n{os.path.dirname(path)}")
            else:
                shot.setPixmap(QPixmap())
                shot.setText("（还没选）" if not path else "（文件不在了）")
                path_lb.setText("还没挑图" if not path else f"{os.path.basename(path)}\n找不到了")
        if need:
            tail = "（三张齐了才能保存）" if self.kind == "pet" else ""
            self.status.setText("还差：" + "、".join(VIEW_SHORT[v] for v in need) + tail)
            self.status.setStyleSheet(f"color:{theme_color('warn', '#c9770f')};")
        elif not self.name_edit.text().strip():
            self.status.setText("图齐了，再起个名字就能保存")
            self.status.setStyleSheet(f"color:{theme_color('warn', '#c9770f')};")
        else:
            self.status.setText("齐了，可以保存 ✓")
            self.status.setStyleSheet(f"color:{theme_color('ok', '#2e9e5b')};")
        self.save_btn.setEnabled(not need and bool(self.name_edit.text().strip()))

    def _save(self):
        name = self.name_edit.text().strip()[:24]
        if self.missing() or not name:
            self._refresh()
            return
        self.result_data = {"name": name, "paths": dict(self.slots)}
        self.accept()


