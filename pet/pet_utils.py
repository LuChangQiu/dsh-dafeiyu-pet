# -*- coding: utf-8 -*-
"""通用工具函数（配置/时间/格式/文本/窗口/音频辅助） (task-152 机械搬迁；逻辑未改)。

模块级命名空间在导入时从 pet_window 复制（函数/常量/Qt/依赖），
以便原代码里的模块级引用保持原语义；pet_window 末尾再回填本模块符号。
"""
from __future__ import annotations

# ruff: noqa: F401, F821
import pet_window as _pw

globals().update({k: v for k, v in vars(_pw).items() if not k.startswith("__")})

def load_config():
    try:
        with open("config.json", "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print("配置读取失败:", e)
        return {
            "city": "汕头"
        }


def theme_color(key, fallback):
    """取当前主题里的一个颜色（界面模块没加载起来时退回写死的值）。"""
    try:
        return ui_console.tokens()[key]
    except Exception:
        return fallback


def size_percent(mult):
    """大小倍率 → 滑块上那个百分比（「大」= 100%）。"""
    try:
        return int(round(float(mult) / SIZE_REF * 100))
    except (TypeError, ValueError):
        return int(round(SIZE_DEFAULT / SIZE_REF * 100))


def size_from_percent(pct):
    """滑块上那个百分比 → 大小倍率。"""
    try:
        return float(pct) / 100.0 * SIZE_REF
    except (TypeError, ValueError):
        return SIZE_DEFAULT


def install_qt_translator(app):
    """让 Qt 内置对话框的按钮显示中文。

    `QInputDialog` / `QMessageBox` 那些窗口里的 OK / Cancel 是 Qt 自己的词条，
    只能靠 Qt 的翻译文件；PySide6 自带 `translations/qtbase_zh_CN.qm`，装上就全汉化了
    （弹出的"触发文字"窗口底下那两个按钮就是它）。
    """
    try:
        from PySide6.QtCore import QLibraryInfo, QLocale, QTranslator
    except Exception:
        return
    try:
        QLocale.setDefault(QLocale(QLocale.Language.Chinese, QLocale.Country.China))
    except Exception:
        pass
    path = QLibraryInfo.path(QLibraryInfo.LibraryPath.TranslationsPath)
    for name in ("qtbase_zh_CN", "qt_zh_CN"):
        try:
            tr = QTranslator(app)
            if tr.load(name, path):
                app.installTranslator(tr)
                _QT_TRANSLATORS.append(tr)
        except Exception:
            pass


def menu_debug(text):
    """菜单相关的排查日志（只写文件，不打扰使用）。"""
    if not (MENU_DEBUG or MENU_DEBUG_RUNTIME):
        return
    try:
        with open(MENU_DEBUG_LOG, "a", encoding="utf-8") as f:
            f.write(f"{datetime.now().strftime('%H:%M:%S.%f')[:-3]}  {text}\n")
    except Exception:
        pass


def menu_debug_throttled(text, ms=None):
    """节流版日志：鼠标移动之类的高频事件用它，别把日志刷爆。"""
    span = (ms if ms is not None else MENU_DEBUG_MOVE_MS) / 1000.0
    now = time.time()
    if now - _menu_debug_last["t"] < span:
        return
    _menu_debug_last["t"] = now
    menu_debug(text)


def defer_dialog(fn):
    """菜单项要弹窗口时用它包一层：**等菜单收完再弹**。

    实测：直接在菜单项回调里 `exec()`，偶尔会被菜单自己的关闭动作一起带走
    （窗口一闪就没了 / 干脆没出现）。隔一个事件循环再弹就稳了。
    """
    def wrapper(*_args, **_kwargs):
        QTimer.singleShot(0, fn)
    return wrapper


def merge_wavs(dest, sources):
    """把多段 wav 首尾拼成一段（采样率 / 声道 / 位宽必须一致）。"""
    params = None
    out = wave.open(dest, "wb")
    try:
        for src in sources:
            with wave.open(src, "rb") as r:
                p = r.getparams()
                key = (p.nchannels, p.sampwidth, p.framerate)
                if params is None:
                    params = key
                    out.setnchannels(p.nchannels)
                    out.setsampwidth(p.sampwidth)
                    out.setframerate(p.framerate)
                elif key != params:
                    raise ValueError("wav 参数不一致，没法拼接")
                out.writeframes(r.readframes(r.getnframes()))
    finally:
        out.close()
    return dest


def wav_seconds(path):
    """wav 时长（秒），读不出来就返回 0。"""
    try:
        with wave.open(path, "rb") as w:
            return w.getnframes() / float(w.getframerate() or 1)
    except Exception:
        return 0.0


def make_click_wav(src, dest, max_seconds=None, rate=44100):
    """把主人挑的 wav 转成"点击音"要的格式：单声道 / 16 位 / 44100Hz（可选裁短）。

    为什么要转：常开音频流那个播放器只吃"单声道 16 位 44100"的 wav，
    主人随便挑的文件多半是 48kHz 立体声，不转的话要么没声、要么开头被吞。
    返回 (时长秒, 过程说明)；出错就抛异常，由调用方给主人提示。
    """
    with wave.open(src, "rb") as w:
        channels, width = w.getnchannels(), w.getsampwidth()
        src_rate, frames = w.getframerate(), w.getnframes()
        data = w.readframes(frames)
    note = []
    try:
        import audioop
    except Exception:
        audioop = None
    if audioop is not None:
        if width != 2:
            data = audioop.lin2lin(data, width, 2)
            width = 2
            note.append("位深转 16 位")
        if channels == 2:
            data = audioop.tomono(data, 2, 0.5, 0.5)
            channels = 1
            note.append("立体声合单声道")
        if src_rate != rate:
            data, _ = audioop.ratecv(data, 2, 1, src_rate, rate, None)
            note.append(f"{src_rate}Hz → {rate}Hz")
    else:                       # 没有 audioop（以后 Python 可能删掉它）时的兜底
        if width != 2:
            raise ValueError("这个 wav 不是 16 位的，请先转成 16 位 wav")
        if channels == 2:
            samples = array("h")
            samples.frombytes(data)
            mono = array("h", b"\x00\x00" * (len(samples) // 2))
            for i in range(0, len(samples) - 1, 2):
                mono[i // 2] = (samples[i] + samples[i + 1]) // 2
            data = mono.tobytes()
            channels = 1
            note.append("立体声合单声道")
        if src_rate != rate:
            raise ValueError(f"这个 wav 是 {src_rate}Hz 的，请先转成 {rate}Hz")
    if max_seconds:
        cap = int(rate * float(max_seconds)) * 2 * max(1, channels)
        if len(data) > cap:
            data = data[:cap]
            note.append(f"裁到 {float(max_seconds):.2f} 秒")
    folder = os.path.dirname(dest)
    if folder:
        os.makedirs(folder, exist_ok=True)
    with wave.open(dest, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(data)
    return (len(data) // 2) / float(rate), "、".join(note)


def pick_click_clips():
    """每套音效的点击音：按压 + 松手两条拼成一条（拼不了就退回更长的那条）。

    返回 {音效名: wav 绝对路径}。
    """
    clips = {}
    for name, files in SOUND_SETS.items():
        srcs = [p for p in (os.path.join(ASSET_DIR, f) for f in files) if os.path.exists(p)]
        if not srcs:
            continue
        merged = os.path.join(ASSET_DIR, CLICK_CLIP_FILES.get(name, f"click-{name}.wav"))
        try:
            outdated = (not os.path.exists(merged)
                        or os.path.getmtime(merged) < max(os.path.getmtime(s) for s in srcs))
            if outdated:
                merge_wavs(merged, srcs)
            clips[name] = merged
        except Exception:
            clips[name] = max(srcs, key=wav_seconds)
    return clips


def clone_rules(rules):
    """复制一份规则表：config 里的默认值不能和模块常量共用同一个 dict（改了会互相串）。"""
    out = []
    for rule in rules:
        item = dict(rule)
        item["lines"] = [str(t) for t in (rule.get("lines") or [])]
        if "days" in rule:
            item["days"] = list(rule.get("days") or [])
        out.append(item)
    return out


def app_time_default_rules():
    """内置的「用久了提醒」，每次调用给一份新的。"""
    return {exe: {"minutes": mins, "repeat": 0, "on": True, "lines": list(lines)}
            for exe, (mins, lines) in TIME_LINES.items()}


def hotkey_parse(text):
    """把 "Ctrl+Alt+1" 拆成 (修饰键, 虚拟键码)；认不出来 / 太危险就返回 None。

    只认字母、数字、F1~F24 和 HOTKEY_SPECIAL 里那几张。别的符号（`-` `[` `;`）
    Qt 的键值和 Windows 的虚拟键码不是一回事，宁可不注册，也别注册成一个按不出来的键。
    """
    text = (text or "").strip()
    if not text:
        return None
    mods, vk = 0, None
    for raw in text.replace("＋", "+").replace(" ", "").split("+"):
        token = raw.strip().lower()
        if not token:
            continue
        if token in HOTKEY_MODS:
            mods |= HOTKEY_MODS[token]
        elif token in HOTKEY_SPECIAL:
            vk = HOTKEY_SPECIAL[token]
        elif len(token) == 1 and token.isalnum():
            vk = ord(token.upper())
        elif token.startswith("f") and token[1:].isdigit() and 1 <= int(token[1:]) <= 24:
            vk = 0x70 + int(token[1:]) - 1
        else:
            return None
    if vk is None or not (mods & HOTKEY_MIN_MODS):
        return None
    return mods, vk


def hotkey_supported_hint():
    """给对话框用的一句话：支持的写法。"""
    return "支持的键：字母 / 数字 / F1~F24 / 空格、Tab、回车、Esc 这些；至少带 Ctrl。"


def idle_seconds():
    """键鼠多久没动过了（秒）；拿不到就返回 None。"""
    try:
        from ctypes import wintypes

        class _LastInput(ctypes.Structure):
            _fields_ = [("cbSize", wintypes.UINT), ("dwTime", wintypes.DWORD)]

        info = _LastInput()
        info.cbSize = ctypes.sizeof(_LastInput)
        if not ctypes.WinDLL("user32.dll").GetLastInputInfo(ctypes.byref(info)):
            return None
        tick = ctypes.WinDLL("kernel32.dll").GetTickCount()
        return max(0.0, ((tick - info.dwTime) & 0xFFFFFFFF) / 1000.0)
    except Exception:
        return None


def fmt_duration(seconds):
    """秒数说成人话：2 小时 5 分 / 48 分 / 30 秒。"""
    seconds = max(0, int(seconds))
    if seconds < 60:
        return f"{seconds} 秒"
    minutes = seconds // 60
    if minutes < 60:
        return f"{minutes} 分"
    hours, mins = divmod(minutes, 60)
    return f"{hours} 小时" + (f" {mins} 分" if mins else "")


def fill_vars(text, **vars):
    """把台词里的 {app} / {minutes} / {away} 这类占位换掉。

    认不出来的占位**原样留着** —— 主人写了 {song} 之类的，别被我们吃掉。
    """
    for key, value in vars.items():
        text = text.replace("{" + key + "}", str(value))
    return text


def is_peak(ts=None):
    """高峰时段：工作日 9:00-12:00 与 14:00-18:00；周末（自 2026-08-23 起）全天谷价。"""
    dt = datetime.fromtimestamp(ts if ts is not None else time.time())
    if dt >= WEEKEND_VALLEY_FROM and dt.weekday() >= 5:
        return False
    return 9 <= dt.hour < 12 or 14 <= dt.hour < 18


def peak_label(peak, style="默认"):
    """当前时段的显示文案。"""
    hi, lo = PEAK_TEXT_STYLES.get(style) or PEAK_TEXT_STYLES["默认"]
    return hi if peak else lo


def city_query_variants(name):
    """同一个地名可能有的叫法：原样 + 去掉末尾的"区 / 县"。

    中国天气网的库里是"鹿城"不是"鹿城区"，带上后缀就一条都搜不到
    （2026-09-14 实测 "鹿城区" 0 条、"鹿城" 命中 101210710）。
    """
    q = (name or "").strip()
    out = [q] if q else []
    if len(q) > 1 and q.endswith(("区", "县")):
        out.append(q[:-1])
    return out


def wrap_text(fm, text, max_w):
    """按像素宽度折行：中文逐字折，英文整词折（别把单词劈两半）。"""
    lines, cur = [], ""
    for unit in _wrap_tokens(text):
        if cur and fm.horizontalAdvance(cur + unit) > max_w:
            lines.append(cur.rstrip())
            cur = unit.lstrip()
        else:
            cur += unit
        while fm.horizontalAdvance(cur) > max_w and len(cur) > 1:
            cut = len(cur)                 # 单个词就超宽：只能硬拆
            while cut > 1 and fm.horizontalAdvance(cur[:cut]) > max_w:
                cut -= 1
            lines.append(cur[:cut])
            cur = cur[cut:]
    lines.append(cur.rstrip())
    return lines


def wrap_text_hanging(fm, text, first_w, rest_w):
    """折行**但第一行窄一点**：右边那一条要留给气泡上那几颗按钮（⏮ ⏸▶ ⏭）。

    只有第一行会被按钮占掉一截，折到第二行起整行都能用 —— 不然按钮一多，
    顶行「♪ 应用 · 歌名」就会被整段省略成「♪ 网…」（主人反馈过"和文字打架"）。
    折行规矩跟 wrap_text 一样：中文逐字折，英文整词折。
    """
    lines, cur = [], ""
    limit = first_w
    for unit in _wrap_tokens(text):
        if cur and fm.horizontalAdvance(cur + unit) > limit:
            lines.append(cur.rstrip())
            cur = unit.lstrip()
            limit = rest_w
        else:
            cur += unit
        while fm.horizontalAdvance(cur) > limit and len(cur) > 1:
            cut = len(cur)                 # 单个词就超宽：只能硬拆
            while cut > 1 and fm.horizontalAdvance(cur[:cut]) > limit:
                cut -= 1
            lines.append(cur[:cut])
            cur = cur[cut:]
            limit = rest_w
    lines.append(cur.rstrip())
    return lines


def _wrap_tokens(text):
    """折行单位：英文单词（连同后面的空格）算一个，中文逐字。"""
    units, buf = [], ""
    for ch in text or "":
        if ch.isascii() and (ch.isalnum() or ch in "'’-"):
            buf += ch
            continue
        if buf:
            units.append(buf)
            buf = ""
        if ch == " " and units:
            units[-1] += ch          # 空格跟着前一个词，避免行首出现空格
        else:
            units.append(ch)
    if buf:
        units.append(buf)
    return units


def click_through_style(style, on, user_passthrough=False):
    """算窗口的扩展样式：菜单开着时加 WS_EX_TRANSPARENT（鼠标事件穿过去给菜单）。

    on 为假时按用户自己的「鼠标穿透」设置还原——用户开着穿透就别给关掉。
    """
    style |= WS_EX_LAYERED
    if on or user_passthrough:
        return style | WS_EX_TRANSPARENT
    return style & ~WS_EX_TRANSPARENT


def elide_text(fm, text, limit):
    """把一行文字塞进 limit 宽：塞不下就截住加个「…」。"""
    if fm.horizontalAdvance(text) <= limit:
        return text
    ell = fm.horizontalAdvance("…")
    out = ""
    for ch in text:
        if fm.horizontalAdvance(out + ch) > limit - ell:
            break
        out += ch
    return (out + "…") if out else "…"


def parse_mmss(text):
    """把「1:35」「01:35.5」「95」这种写法转成秒；看不懂返回 None。"""
    t = (text or "").strip().replace("：", ":")
    if not t:
        return None
    try:
        if ":" in t:
            parts = [p for p in t.split(":") if p != ""]
            if len(parts) == 2:
                return int(parts[0]) * 60 + float(parts[1])
            if len(parts) == 3:
                return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
            return None
        return float(t)
    except (TypeError, ValueError):
        return None


def split_music_title(title, app_name=""):
    """把「歌名 - 歌手 - QQ音乐」这类窗口标题拆成 (歌名, 歌手)。"""
    text = (title or "").strip()
    for junk in (app_name, "QQ音乐", "网易云音乐", "QQMusic", "网易云音乐PC版"):
        if junk and text.endswith(junk):
            text = text[: -len(junk)].strip(" -—–|·")
    if not text:
        return "", ""
    parts = [x.strip() for x in re.split(r"\s+[-—–]\s+", text) if x.strip()]
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], parts[1]


def merge_media_info(info, fallback):
    """媒体会话在、但没给歌名时，用窗口标题补上歌名 / 歌手（播放状态和进度以会话为准）。"""
    if fallback is None:
        return info
    if info is None:
        return fallback
    merged = dict(fallback)
    for key in ("playing", "position", "duration", "at"):
        if info.get(key) is not None:
            merged[key] = info[key]
    return merged


def parse_lrc(text):
    """LRC 歌词 → [(秒, 这一句)]，按时间排好；[ti:] 这类信息行丢掉。"""
    out = []
    for raw in (text or "").splitlines():
        stamps = _LRC_TAG.findall(raw)
        if not stamps:
            continue
        words = _LRC_TAG.sub("", raw).strip()
        if not words:
            continue
        for minute, second, frac in stamps:
            ms = int(frac) if frac else 0
            if len(frac) == 1:
                ms *= 100
            elif len(frac) == 2:
                ms *= 10
            out.append((int(minute) * 60 + int(second) + ms / 1000.0, words))
    out.sort(key=lambda item: item[0])
    return out


def lyric_pair(lines, pos):
    """pos 秒时该显示的（这一句, 下一句）；没有歌词返回两个空串。"""
    if not lines:
        return "", ""
    idx = lyric_index(lines, pos)
    nxt = lines[idx + 1][1] if idx + 1 < len(lines) else ""
    return lines[idx][1], nxt


def lyric_index(lines, pos):
    """pos 秒时该显示第几句（和 lyric_pair 用同一套判断，保证两者一致）。"""
    idx = 0
    for i, (when, _words) in enumerate(lines):
        if when <= pos + 0.15:
            idx = i
        else:
            break
    return idx


def sung_chars(words, pos):
    """逐字时间戳下，pos 秒时这句已经唱到第几个字（可以是小数，按当前字推进）。"""
    if not words:
        return 0.0
    n = 0
    for _c, t in words:
        if t <= pos:
            n += 1
        else:
            nxt_t = max(pos, t)
            prev_t = words[n - 1][1] if n > 0 else t
            span = max(0.05, nxt_t - prev_t)
            return float(n) + max(0.0, min(1.0, (pos - prev_t) / span))
    return float(n)


def _ms_or_sec(a, b, c):
    """[mm:ss.xx] / <mm:ss.xx> 三段 → 秒。"""
    return int(a) * 60 + int(b) + (int((c or "0").ljust(3, "0")) / 1000.0)


def _best_song(items, title, artist, name_of, artist_of):
    """在搜索结果里挑最像的那一首：歌名优先，歌手用来加分 / 排除。"""
    want_t = (title or "").strip().lower()
    want_a = (artist or "").strip().lower()
    best, best_score = None, 0
    for item in items[:8]:
        name = (name_of(item) or "").strip().lower()
        who = (artist_of(item) or "").strip().lower()
        score = 0
        if want_t and name == want_t:
            score += 4
        elif want_t and want_t in name:
            score += 3
        elif name and name in want_t:
            score += 2
        if want_a and who:
            if want_a == who:
                score += 3
            elif want_a in who or who in want_a:
                score += 2
            else:
                score -= 3
        if score > best_score:
            best, best_score = item, score
    return best


def to_chinese_city(name):
    """自动定位拿到的英文城市名尽量换成中文（比如 Singapore -> 新加坡）。"""
    if not name or has_chinese(name):
        return name
    try:
        for _label, city in lookup_city(name):
            if has_chinese(city):
                return city
    except Exception:
        pass
    return name


def key_fingerprint(key):
    """Key 指纹：只用来认「还是不是同一个账号的账本」，不还原、不外传。"""
    key = (key or "").strip()
    return hashlib.sha1(key.encode("utf-8")).hexdigest()[:8] if key else ""


def balance_drop_reason(prev, delta, granted, gap_sec):
    """这次余额下降算不算用量？算用量返回 ""，不算就返回原因。

    不算用量的两种：
    1) 赠送额度整块消失（到期 / 被平台收回）——上一次 granted 有值，这次基本归零，
       而且下降额对得上那笔赠送；
    2) 一次刷新掉得太多（60 秒掉二十几块不可能是 API 用量），间隔长时按小时放宽。
    """
    pg = prev.get("lastGranted")
    if pg and granted is not None and delta >= 0.5:
        gone = float(pg) - float(granted)
        if gone > 0 and gone >= delta - 0.05 and float(granted) <= max(0.05, float(pg) * 0.02):
            return "赠送额度到期/被收回"
    limit = max(USAGE_JUMP_LIMIT, USAGE_JUMP_RATE * max(0.0, float(gap_sec)) / 3600.0)
    if delta > limit:
        return f"一次掉 ¥{delta:.2f}，超过 ¥{limit:.2f} 的可信上限"
    return ""


def load_json(path, default):
    if not os.path.exists(path):
        with open(path, "w", encoding="utf-8") as f:
            json.dump(
                default,
                f,
                ensure_ascii=False,
                indent=4
            )
        return default

    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)

    except Exception:
        return default


