# -*- coding: utf-8 -*-
"""系统/媒体/余额/天气/网络/应用扫描服务与桥接类 (task-152 机械搬迁；逻辑未改)。

模块级命名空间在导入时从 pet_window 复制（函数/常量/Qt/依赖），
以便原代码里的模块级引用保持原语义；pet_window 末尾再回填本模块符号。
"""
from __future__ import annotations

# ruff: noqa: F401, F821
import pet_window as _pw

globals().update({k: v for k, v in vars(_pw).items() if not k.startswith("__")})

def foreground_pid():
    """前台窗口属于哪个进程（拿不到返回 0）。"""
    try:
        from ctypes import wintypes
        user32 = ctypes.WinDLL("user32.dll")
        hwnd = user32.GetForegroundWindow()
        if not hwnd:
            return 0
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        return int(pid.value or 0)
    except Exception:
        return 0


def foreground_is_fullscreen():
    """前台窗口是不是铺满了它所在那块屏（全屏游戏 / 全屏看电影）。

    桌面和任务栏不算（它们本来就铺满）。无边框全屏也算 —— 主人要的是
    "别在我打游戏 / 看电影的时候冒泡"。
    """
    try:
        from ctypes import wintypes
        user32 = ctypes.WinDLL("user32.dll")
        hwnd = user32.GetForegroundWindow()
        if not hwnd:
            return False
        cls = ctypes.create_unicode_buffer(64)
        user32.GetClassNameW(hwnd, cls, 64)
        if cls.value in ("Progman", "WorkerW", "Shell_TrayWnd"):
            return False

        class _MonInfo(ctypes.Structure):
            _fields_ = [("cbSize", wintypes.DWORD), ("rcMonitor", wintypes.RECT),
                        ("rcWork", wintypes.RECT), ("dwFlags", wintypes.DWORD)]

        rect = wintypes.RECT()
        if not user32.GetWindowRect(hwnd, ctypes.byref(rect)):
            return False
        mon = user32.MonitorFromWindow(hwnd, 2)          # 2 = NEAREST
        if not mon:
            return False
        info = _MonInfo()
        info.cbSize = ctypes.sizeof(_MonInfo)
        if not user32.GetMonitorInfoW(mon, ctypes.byref(info)):
            return False
        m = info.rcMonitor
        return (rect.left <= m.left and rect.top <= m.top
                and rect.right >= m.right and rect.bottom >= m.bottom)
    except Exception:
        return False


def read_today_usage(path):
    """从余额账本里读"今天用了多少"（没这本 / 跨天了就返回 0）。"""
    try:
        with open(path, "r", encoding="utf-8") as f:
            book = json.load(f) or {}
    except Exception:
        return 0.0
    if book.get("date") != datetime.now().strftime("%Y-%m-%d"):
        return 0.0
    try:
        return float(book.get("todayUsage") or 0)
    except (TypeError, ValueError):
        return 0.0


def load_app_time(path):
    """读应用时长账本 → (日期, {exe: 秒})；跨天 / 读不到就重开一本。"""
    today = datetime.now().strftime("%Y-%m-%d")
    try:
        with open(path, "r", encoding="utf-8") as f:
            book = json.load(f) or {}
    except Exception:
        book = {}
    if book.get("date") != today or not isinstance(book.get("apps"), dict):
        return today, {}
    out = {}
    for exe, secs in book["apps"].items():
        try:
            out[str(exe)] = float(secs)
        except (TypeError, ValueError):
            continue
    return today, out


def save_app_time(path, date, apps):
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"date": date, "apps": apps}, f, ensure_ascii=False, indent=1)
    except Exception as ex:
        print("应用时长账本保存失败:", repr(ex))


def app_path_for(exe):
    """从注册表 App Paths 里找这个 exe 的完整路径（找不到返回空串）。

    「用久了提醒」那本列表要给每个应用画真图标 —— 扫到的应用（正在跑 + 开始菜单）
    已经带路径了，剩下那些没在跑的（比如没开着的 Steam）就从这儿补一下。
    """
    exe = (exe or "").strip().lower()
    if not exe.endswith(".exe"):
        return ""
    try:
        import winreg
    except Exception:
        return ""
    sub = r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths"
    # 注意：winreg 没有 HKLM / HKCU 这种简写，得写全名
    for hive in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
        try:
            with winreg.OpenKey(hive, sub + "\\" + exe) as key:
                path, _kind = winreg.QueryValueEx(key, "")
        except OSError:
            continue
        except Exception:
            continue
        path = os.path.expandvars(str(path or "").strip().strip('"'))
        if path and os.path.exists(path):
            return path
    return ""


def scan_apps():
    """扫描本机应用：正在运行的进程 + 开始菜单里的快捷方式。

    返回 [(exe 名小写, 展示名, exe 完整路径)]，按展示名排序。
    路径是给对话框取图标用的（拿不到就是空串）。
    """
    apps = {}
    for name, path in running_processes():
        if name.endswith(".exe"):
            apps.setdefault(name, (name, path))
    # 开始菜单的快捷方式（含用户目录），交给 PowerShell 解析目标 exe
    script = (
        "$ErrorActionPreference='SilentlyContinue';"
        "$sh=New-Object -ComObject WScript.Shell;"
        "$dirs=@(\"$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\","
        "\"$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs\");"
        "Get-ChildItem $dirs -Recurse -Filter *.lnk | ForEach-Object {"
        "$t=$sh.CreateShortcut($_.FullName).TargetPath;"
        "if($t){ \"$t|$($_.BaseName)\" } }"
    )
    try:
        out = subprocess.run(["powershell", "-NoProfile", "-Command", script],
                             capture_output=True, text=True, timeout=25,
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        for line in (out.stdout or "").splitlines():
            if "|" not in line:
                continue
            target, label = line.split("|", 1)
            target = target.strip()
            exe = os.path.basename(target).lower()
            if exe.endswith(".exe"):
                apps.setdefault(exe, (label.strip() or exe, target))
    except Exception:
        pass
    return sorted(((exe, info[0], info[1]) for exe, info in apps.items()),
                  key=lambda item: item[1].lower())


def foreground_process_name():
    """当前前台窗口属于哪个进程（小写进程名）；拿不到就返回空串。"""
    try:
        from ctypes import wintypes
        user32 = ctypes.WinDLL("user32.dll")
        kernel32 = ctypes.WinDLL("kernel32.dll")
        hwnd = user32.GetForegroundWindow()
        if not hwnd:
            return ""
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if not pid.value:
            return ""
        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid.value)
        if not handle:
            return ""
        try:
            buf = ctypes.create_unicode_buffer(1024)
            size = wintypes.DWORD(len(buf))
            if kernel32.QueryFullProcessImageNameW(handle, 0, buf, ctypes.byref(size)):
                return buf.value.rsplit("\\", 1)[-1].lower()
        finally:
            kernel32.CloseHandle(handle)
    except Exception:
        pass
    return ""


def running_processes():
    """枚举当前进程，返回 [(exe 小写名, 完整路径)]。用 Windows API，不依赖 psutil。"""
    out = []
    try:
        from ctypes import wintypes
        psapi = ctypes.WinDLL("psapi.dll")
        kernel32 = ctypes.WinDLL("kernel32.dll")
        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        arr = (wintypes.DWORD * 4096)()
        needed = wintypes.DWORD()
        if not psapi.EnumProcesses(ctypes.byref(arr), ctypes.sizeof(arr), ctypes.byref(needed)):
            return out
        count = needed.value // ctypes.sizeof(wintypes.DWORD)
        for i in range(count):
            pid = arr[i]
            if not pid:
                continue
            handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
            if not handle:
                continue
            try:
                buf = ctypes.create_unicode_buffer(1024)
                size = wintypes.DWORD(len(buf))
                if kernel32.QueryFullProcessImageNameW(handle, 0, buf, ctypes.byref(size)):
                    path = buf.value
                    exe = path.rsplit("\\", 1)[-1].lower()
                    if exe:
                        out.append((exe, path))
            finally:
                kernel32.CloseHandle(handle)
    except Exception:
        pass
    return out


def system_memory():
    """(总内存, 可用内存)，单位字节；读不到就返回 (0, 0)。"""
    class _MemStatus(ctypes.Structure):
        _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong),
                    ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]
    try:
        kernel32 = ctypes.WinDLL("kernel32.dll")
        st = _MemStatus()
        st.dwLength = ctypes.sizeof(st)
        if kernel32.GlobalMemoryStatusEx(ctypes.byref(st)):
            return int(st.ullTotalPhys), int(st.ullAvailPhys)
    except Exception:
        pass
    return 0, 0


def human_mb(nbytes):
    """字节 → 「512 MB」/「1.4 GB」这种好念的字样。"""
    mb = max(0.0, float(nbytes or 0)) / (1024 * 1024)
    return f"{mb / 1024:.1f} GB" if mb >= 1024 else f"{mb:.0f} MB"


def process_exe_by_pid(pid):
    """pid → 进程可执行文件名（小写）；拿不到返回空串。"""
    try:
        from ctypes import wintypes
        kernel32 = ctypes.WinDLL("kernel32.dll")
        handle = kernel32.OpenProcess(0x1000, False, int(pid))     # QUERY_LIMITED_INFORMATION
        if not handle:
            return ""
        try:
            buf = ctypes.create_unicode_buffer(1024)
            size = wintypes.DWORD(len(buf))
            if kernel32.QueryFullProcessImageNameW(handle, 0, buf, ctypes.byref(size)):
                return buf.value.rsplit("\\", 1)[-1].lower()
        finally:
            kernel32.CloseHandle(handle)
    except Exception:
        pass
    return ""


def app_name_from_id(app_id):
    """认不出来的标识，收拾成人能看的样子（总比「未知应用」强）。

    商店版的 AUMID 长这样：`Netease.CloudMusic_pfh4abc!App`，普通版是 `cloudmusic.exe`
    或完整路径。这里取最后一段、去掉 .exe / 下划线，截短到 24 个字。
    """
    text = (app_id or "").strip()
    if not text:
        return ""
    text = text.split("!")[0]
    text = text.replace("\\", "/").rstrip("/").split("/")[-1]
    if text.lower().endswith(".exe"):
        text = text[:-4]
    text = text.replace("_", " ").strip()
    return text[:24]


def music_app_name(app_id):
    """媒体会话的应用标识 / 进程名 → 「QQ音乐」这种名字；不是这两个软件就返回空串。"""
    low = (app_id or "").lower()
    if not low:
        return ""
    for key, name in MUSIC_APPS.items():
        if key in low:
            return name
    return ""


def smtc_available():
    """本机能不能读 Windows 媒体会话（读不了就走"看窗口标题"的退路）。"""
    try:
        import winsdk.windows.media.control  # noqa: F401
        return True
    except Exception:
        return False


def list_process_names():
    """只要进程名（小写）的旧接口。"""
    return {name for name, _path in running_processes()}


def usage_cost(usage):
    """按峰谷定价把一次对话的 usage 换算成金额，返回 (金额, 总token)。"""
    if not usage:
        return 0.0, 0
    hit = int(usage.get("prompt_cache_hit_tokens", 0) or 0)
    miss = usage.get("prompt_cache_miss_tokens")
    if miss is None:
        miss = max(0, int(usage.get("prompt_tokens", 0) or 0) - hit)
    miss = int(miss or 0)
    out = int(usage.get("completion_tokens", 0) or 0)
    price = PRO_PRICE if is_peak() else BASE_PRICE
    amount = (hit / 1e6) * price["hit"] + (miss / 1e6) * price["miss"] + (out / 1e6) * price["out"]
    return amount, hit + miss + out


def codex_usage_cost(usage):
    """把 Codex 会话日志里的 token 用量换算成金额，返回 (金额, 总token)。"""
    if not usage:
        return 0.0, 0
    hit = int(usage.get("cached_input_tokens", 0) or 0)
    inp = int(usage.get("input_tokens", 0) or 0)
    miss = max(0, inp - hit)          # Codex 的 input_tokens 已包含 cached
    out = int(usage.get("output_tokens", 0) or 0)
    price = PRO_PRICE if is_peak() else BASE_PRICE
    amount = (hit / 1e6) * price["hit"] + (miss / 1e6) * price["miss"] + (out / 1e6) * price["out"]
    return amount, inp + out


def pick_balance_info(infos):
    """接口返回的多币种顺序不固定：优先 CNY 且余额 > 0，其次任意非零，再退回 CNY，最后取第一项。"""
    if not isinstance(infos, list) or not infos:
        return None

    def num(x):
        try:
            return float((x or {}).get("total_balance"))
        except (TypeError, ValueError):
            return float("nan")

    for want_cny, need_positive in ((True, True), (False, True), (True, False)):
        for x in infos:
            if not isinstance(x, dict):
                continue
            if want_cny and x.get("currency") != "CNY":
                continue
            v = num(x)
            if need_positive and not (v > 0):
                continue
            return x
    return infos[0]


def query_deepseek_balance(key):
    """查 DeepSeek 余额，返回 {ok, total, currency, granted, topped_up} 或 {ok: False, error}。

    granted / topped_up 是接口给的「赠送余额 / 充值余额」，账本靠这两个字段认得出
    「赠送额度整块到期被收回」——那种下降不是用量。
    """
    last = "网络错误"
    for attempt in range(2):
        try:
            r = requests.get(BALANCE_URL, headers={"Authorization": f"Bearer {key}"}, timeout=15)
            if r.status_code == 200:
                info = pick_balance_info((r.json() or {}).get("balance_infos"))
                if info and info.get("total_balance") is not None:
                    def num(name):
                        try:
                            return float(info.get(name))
                        except (TypeError, ValueError):
                            return None

                    return {"ok": True, "total": float(info["total_balance"]),
                            "currency": info.get("currency") or "CNY",
                            "granted": num("granted_balance"),
                            "topped_up": num("topped_up_balance")}
                return {"ok": False, "error": "余额返回结构异常"}
            last = f"HTTP {r.status_code}"
            if r.status_code < 500:
                break
        except Exception as ex:
            last = str(ex)[:60]
        if attempt == 0:
            time.sleep(0.6)
    return {"ok": False, "error": last}


def query_openrouter_balance(key):
    """查 OpenRouter 额度（credits - usage）。"""
    try:
        r = requests.get(OPENROUTER_CREDITS_URL,
                         headers={"Authorization": f"Bearer {key}"}, timeout=15)
        if r.status_code != 200:
            return {"ok": False, "error": f"HTTP {r.status_code}"}
        data = (r.json() or {}).get("data") or {}
        total = float(data.get("total_credits") or 0)
        used = float(data.get("total_usage") or 0)
        return {"ok": True, "total": round(total - used, 4), "currency": "USD"}
    except Exception as ex:
        return {"ok": False, "error": str(ex)[:60]}


def extract_usage(obj, depth=0):
    """从任意 agent 的日志行里挖出 token 用量。

    Codex 的日志是 `payload.usage`，Claude Code 之类是 `message.usage`，键名也不一样
    （input_tokens / prompt_tokens、cached_input_tokens / cache_read_input_tokens）。
    这里递归找第一个带 token 字段的对象，并归一化成内部统一格式。
    """
    if depth > 6 or not isinstance(obj, (dict, list)):
        return None
    if isinstance(obj, dict):
        if any(k in obj for k in USAGE_TOKEN_KEYS):
            inp = obj.get("input_tokens")
            if inp is None:
                inp = obj.get("prompt_tokens")
            out = obj.get("output_tokens")
            if out is None:
                out = obj.get("completion_tokens")
            if isinstance(inp, (int, float)) or isinstance(out, (int, float)):
                inp = int(inp or 0)
                out = int(out or 0)
                hit = int(obj.get("cached_input_tokens")
                          or obj.get("cache_read_input_tokens") or 0)
                total = int(obj.get("total_tokens") or 0) or (inp + out)
                if inp or out:
                    return {"input_tokens": inp, "output_tokens": out,
                            "cached_input_tokens": hit, "total_tokens": total}
        for value in obj.values():
            got = extract_usage(value, depth + 1)
            if got:
                return got
    else:
        for value in obj:
            got = extract_usage(value, depth + 1)
            if got:
                return got
    return None


def lookup_city(query):
    """联网查城市，返回候选列表 [(显示名, 存进配置的城市名)]。

    先走中国天气网（国内直连、中文库全，"温州 / 汕头"这种简称也认），
    查不到再退到 open-meteo（国外地名靠它兜底）。
    """
    q = (query or "").strip()
    if not q:
        return []
    items = []
    for variant in city_query_variants(q):
        try:
            for _code, name, prov in cn_city_search(variant)[:6]:
                if name not in [x[1] for x in items]:
                    items.append((f"{name}（{prov}）" if prov else name, name))
        except Exception:
            pass
        if items:
            break
    if not items:
        try:
            r = requests.get("https://geocoding-api.open-meteo.com/v1/search",
                             params={"name": q, "count": 6, "language": "zh"}, timeout=8)
            for x in ((r.json() or {}).get("results") or []):
                label = x.get("name") or ""
                extra = " · ".join([v for v in (x.get("admin1"), x.get("country")) if v])
                if label:
                    items.append((f"{label}（{extra}）" if extra else label, label))
        except Exception:
            items = []
    if not items:
        items = [(q, q)]
    return items


def locate_city_by_ip():
    """按 IP 联网定位城市，失败返回空串（挂代理时拿到的是节点所在地）。"""
    for url in ("https://api.ip.sb/geoip", "https://myip.wtf/json"):
        try:
            data = requests.get(url, timeout=8,
                                headers={"User-Agent": "dafeiyu-pet/1.0"}).json() or {}
            city = (data.get("city") or data.get("YourFuckingCity")
                    or data.get("region") or "").strip()
            if city:
                return city
        except Exception:
            continue
    return ""


def fetch_weather(city):
    """查天气：先走国内源（中国天气网），不行再用 open-meteo 兜底。

    返回 (温度, 中文描述)；都失败返回 None。
    """
    city = (city or "").strip()
    variants = city_query_variants(city)
    for attempt in range(2):        # 国内源偶尔也会抽一下，重试一次比退到墙外划算
        try:
            for q in variants:
                hits = cn_city_search(q)
                if hits:
                    got = cn_weather_now(hits[0][0])
                    if got:
                        return got
            break                   # 查询本身是通的（只是它这儿没有实况），不用重试
        except Exception:
            if attempt == 0:
                time.sleep(0.4)
    names = []
    for q in variants:
        names.append(q)
        if not q.endswith(("市", "县", "区")):
            # open-meteo 的中文库里多是"汕头市"这种全称，简称常搜不到，补一刀再试
            names.append(q + "市")
    for attempt in range(2):        # 兜底源偶尔抽一下（SSL 报错 / 超时），重试一次
        for name in names:
            try:
                got = open_meteo_weather(name)
                if got:
                    return got
            except Exception:
                pass
        if attempt == 0:
            time.sleep(0.4)
    return None


def open_meteo_weather(name):
    """兜底源 open-meteo：地名 → 坐标 → 实况，返回 (温度, 中文描述) 或 None。"""
    g = requests.get("https://geocoding-api.open-meteo.com/v1/search",
                     params={"name": name, "count": 1, "language": "zh"},
                     timeout=5).json() or {}
    found = g.get("results") or []
    if not found:
        return None
    w = requests.get("https://api.open-meteo.com/v1/forecast",
                     params={"latitude": found[0]["latitude"],
                             "longitude": found[0]["longitude"],
                             "current": "temperature_2m,weather_code"},
                     timeout=5).json() or {}
    cur = w.get("current") or {}
    if cur.get("temperature_2m") is None:
        return None
    code = cur.get("weather_code")
    desc = WMO_ZH.get(int(code), "未知天气") if code is not None else "未知天气"
    return str(round(float(cur["temperature_2m"]))), desc


def cn_city_search(name):
    """中国天气网：城市名 → [(城市代码, 中文名, 省份)]，查不到返回 []。

    接口回来的是 `([{"ref":"101280501~guangdong~汕头~Shantou~…~广东"}])` 这种
    "伪 JSON"：外面裹着一对括号，去掉再按 JSON 读。
    """
    q = (name or "").strip()
    if not q:
        return []
    r = requests.get(CN_WEATHER_SEARCH, params={"cityname": q},
                     headers=CN_WEATHER_HEADERS, timeout=6)
    body = _cn_body(r).strip().strip("()")
    rows = json.loads(body) if body else []
    out = []
    for row in rows or []:
        parts = str((row or {}).get("ref") or "").split("~")
        code = parts[0] if parts else ""
        cname = parts[2] if len(parts) > 2 else ""
        prov = parts[9] if len(parts) > 9 else ""
        if code and cname:
            out.append((code, cname, prov))
    return out


def cn_parse_sk(body):
    """中国天气网那行 `var dataSK={...}` → (温度, 中文描述)；不是实况就返回 None。

    单独拆出来是为了能离线自测（不用真联网）。
    """
    body = body or ""
    if "dataSK" not in body:
        # 国外城市（2 开头的代码）它只回一张"网页无法访问"的报错页，早点认出来
        return None
    i, j = body.find("{"), body.rfind("}")
    if i < 0 or j <= i:
        return None
    try:
        data = json.loads(body[i:j + 1]) or {}
    except Exception:
        return None
    temp = data.get("temp")
    if temp in (None, "", "999"):        # 999 是它自己的"这儿没数据"占位
        return None
    desc = (data.get("weather") or "").strip() or "未知天气"
    try:
        return str(round(float(temp))), desc
    except (TypeError, ValueError):
        return None


def cn_weather_now(code):
    """中国天气网实况：城市代码 → (温度, 中文描述)；没取到返回 None。"""
    r = requests.get(CN_WEATHER_SK.format(code=code),
                     headers=CN_WEATHER_HEADERS, timeout=6)
    return cn_parse_sk(_cn_body(r))


def _cn_body(resp):
    """中国天气网的响应头没写 charset，requests 会猜成 ISO-8859-1，这里按 UTF-8 读。"""
    if not resp.encoding or resp.encoding.lower() in ("iso-8859-1", "ascii"):
        resp.encoding = "utf-8"
    return resp.text or ""


def fetch_lyrics(title, artist):
    """联网找歌词：先网易云，再 QQ音乐；都找不到返回空串。"""
    if not (title or "").strip():
        return ""
    for finder in (_netease_lyric, _qq_lyric):
        try:
            lrc = finder(title, artist)
            if lrc and len(parse_lrc(lrc)) >= 3:
                return lrc
        except Exception:
            continue
    return ""


def _qq_lyric(title, artist):
    """QQ音乐的公开搜索 + 歌词接口（不需要 Key）。"""
    r = requests.get("https://c.y.qq.com/soso/fcgi-bin/client_search_cp",
                     params={"w": f"{title} {artist}".strip(), "format": "json",
                             "n": 8, "cr": 1, "p": 1},
                     headers={"User-Agent": "Mozilla/5.0",
                              "Referer": "https://y.qq.com/"},
                     timeout=10)
    text = r.text
    data = json.loads(text[text.find("{"):text.rfind("}") + 1])
    songs = ((data.get("data") or {}).get("song") or {}).get("list") or []
    song = _best_song(songs, title, artist,
                      lambda s: s.get("songname") or s.get("title"),
                      lambda s: " ".join(x.get("name", "")
                                         for x in (s.get("singer") or [])))
    if not song:
        return ""
    r2 = requests.get("https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg",
                      params={"songmid": song.get("songmid"), "format": "json",
                              "nobase64": 1, "g_tk": 5381},
                      headers={"User-Agent": "Mozilla/5.0",
                               "Referer": "https://y.qq.com/portal/player.html"},
                      timeout=10)
    text2 = r2.text
    data2 = json.loads(text2[text2.find("{"):text2.rfind("}") + 1])
    return data2.get("lyric") or ""


def _netease_lyric(title, artist):
    """网易云的公开搜索 + 歌词接口（不需要 Key）。"""
    r = requests.post("https://music.163.com/api/search/get/web",
                      data={"s": f"{title} {artist}".strip(), "type": 1,
                            "limit": 8, "offset": 0},
                      headers={"User-Agent": "Mozilla/5.0",
                               "Referer": "https://music.163.com/"},
                      timeout=10)
    songs = ((r.json() or {}).get("result") or {}).get("songs") or []
    song = _best_song(songs, title, artist,
                      lambda s: s.get("name"),
                      lambda s: " ".join(a.get("name", "")
                                         for a in (s.get("artists") or [])))
    if not song:
        return ""
    r2 = requests.get("https://music.163.com/api/song/lyric",
                      params={"id": song.get("id"), "lv": 1, "kv": 1, "tv": -1, "yv": 1},
                      headers={"User-Agent": "Mozilla/5.0",
                               "Referer": "https://music.163.com/"},
                      timeout=10)
    data = r2.json() or {}
    # 有逐字歌词（yrc）就用它：这样"唱到哪高亮到哪"能完全贴合真人演唱，而不是匀速推
    word = ((data.get("yrc") or {}).get("lyric") or "").strip()
    return word or ((data.get("lrc") or {}).get("lyric") or "")


def load_lyric_cache():
    """歌词缓存：按「歌名|歌手」存，换歌不用每次都联网。"""
    data = load_json(LYRIC_CACHE_PATH, {})
    out = {}
    for key, value in (data or {}).items():
        if isinstance(value, dict):
            out[key] = {"v": int(value.get("v") or 1), "text": str(value.get("text") or "")}
        else:
            # 老版本缓存的是纯文本（那时候只存了行级歌词）→ 标记成旧版，回头再抓一次，
            # 这样有逐字歌词的歌能升级成"唱到哪高亮到哪"
            out[key] = {"v": 1, "text": str(value or "")}
    return out


def save_lyric_cache(cache):
    try:
        items = list(cache.items())[-LYRIC_CACHE_MAX:]
        with open(LYRIC_CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(dict(items), f, ensure_ascii=False)
    except Exception:
        pass


def record_balance_usage(path, total, currency, granted=None, topped_up=None,
                         key_id="", sample_ts=None):
    """小鲸鱼记账：只把余额下降记成当日消耗，跨天归零归档。

    币种变化、Key（账号）变化、赠额到期、异常跳变都只重置基准，不记成用量——
    否则平台侧的余额变动会变成"我今天用了两百多"。

    返回 {"today": 今日已用, "adjust": 今天没算进用量的余额变动,
          "amount": 这一次的变动额, "reason": 这一次的变动原因（没有就是空串）,
          "adjust_why": 今天最近一次变动的原因（给菜单说明用）}
    """
    now = (datetime.fromtimestamp(sample_ts) if sample_ts else datetime.now())
    today = now.strftime("%Y-%m-%d")
    prev = {}
    try:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                prev = json.load(f) or {}
    except Exception:
        prev = {}

    prev_date = prev.get("date")
    last = prev.get("lastBalance")
    last_cur = prev.get("lastCurrency")
    prev_key = (prev.get("lastKeyId") or "").strip()
    today_usage = float(prev.get("todayUsage") or 0)
    today_adjust = float(prev.get("todayAdjust") or 0)
    hist = dict(prev.get("history") or {})
    log = list(prev.get("adjustLog") or [])[-20:]
    # 老账本没有 lastAdjustWhy 就从变动记录里补，菜单里那句说明才不会空着
    last_why = prev.get("lastAdjustWhy") or (log[-1].get("why", "") if log else "")
    last_at = prev.get("lastAdjustAt") or (log[-1].get("at", "") if log else "")
    reason = ""
    amount = 0.0

    if prev_date != today:
        # 跨天：把昨天的用量归档，今天的基准重新起
        if prev_date and today_usage:
            hist[prev_date] = round(today_usage, 4)
        hist = dict(sorted(hist.items())[-30:])
        today_usage, today_adjust, log, reason = 0.0, 0.0, [], ""
        last_why, last_at = "", ""        # 新的一天：昨天那笔变动的原因不再挂着
    elif last is not None and last_cur == currency and (not prev_key or not key_id or prev_key == key_id):
        delta = float(last) - float(total)
        if delta > 0:
            # 采样间隔：文件没写时间就用文件修改时间兜底
            try:
                last_ts = prev.get("lastSampleAt")
                prev_at = (datetime.fromisoformat(last_ts) if last_ts
                           else datetime.fromtimestamp(os.path.getmtime(path)))
            except Exception:
                prev_at = now
            why = balance_drop_reason(prev, delta, granted, (now - prev_at).total_seconds())
            if why:
                amount = delta
                reason = why
                last_why, last_at = why, now.isoformat(timespec="seconds")
                today_adjust = round(today_adjust + delta, 4)
                log.append({"at": now.isoformat(timespec="seconds"),
                            "amount": round(delta, 4), "why": why})
            else:
                today_usage = round(today_usage + delta, 4)

    # 以老账本为基础再覆盖我们管的字段：手工校准之类额外写进去的字段不会被抹掉
    data = dict(prev)
    data.update({
        "date": today,
        "lastBalance": total,
        "lastCurrency": currency,
        "lastGranted": granted,
        "lastToppedUp": topped_up,
        "lastKeyId": key_id or prev_key,
        "lastSampleAt": now.isoformat(timespec="seconds"),
        "todayUsage": round(today_usage, 4),
        "todayAdjust": round(today_adjust, 4),
        "history": hist,
        "adjustLog": log,
        "lastAdjustWhy": last_why,
        "lastAdjustAt": last_at,
        "updatedAt": datetime.now().isoformat(timespec="seconds"),
    })
    try:
        # 先写临时文件再替换：中途出错也不会把账本写成半截（半截 JSON 会被当成空账本）
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except Exception:
        pass
    return {"today": float(data["todayUsage"]), "adjust": float(data["todayAdjust"]),
            "amount": amount, "reason": reason,
            "adjust_why": last_why, "adjust_at": last_at}


def calibrate_balance_usage(path, amount, why="手动校准"):
    """按主人看到的平台数字校准「今日已用」，账本里留一笔 calibrateLog。

    什么时候用：赠送额度到期、桌宠关着漏采了一段……这些情况下账本自己算不出当天真实用量，
    平台用量页的「消费金额」才是准的。只改 todayUsage，不动 todayAdjust 和余额基准。
    返回 {"today": 校准后的值, "was": 原来的值}。
    """
    amount = max(0.0, float(amount))
    prev = {}
    try:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                prev = json.load(f) or {}
    except Exception:
        prev = {}

    now = datetime.now().isoformat(timespec="seconds")
    was = float(prev.get("todayUsage") or 0)
    log = list(prev.get("calibrateLog") or [])[-20:]
    log.append({"at": now, "from": round(was, 4), "to": round(amount, 4), "why": why})

    data = dict(prev)
    data.update({
        "date": prev.get("date") or datetime.now().strftime("%Y-%m-%d"),
        "todayUsage": round(amount, 4),
        "calibrateLog": log,
        "updatedAt": now,
    })
    try:
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except Exception:
        pass
    return {"today": round(amount, 4), "was": round(was, 4)}


def trim_working_sets(skip_pids=(), skip_exes=(), min_bytes=None):
    """温和回收：把能碰到的进程的工作集收一遍。

    skip_pids / skip_exes 里的不动（自己和前台程序由调用方传进来）。
    返回字典：trimmed / skipped_small / skipped_named / denied / failed 各种计数，
              freed（这次一共腾出多少字节，按工作集前后差值算），
              avail_before / avail_after（系统可用内存，给气泡里那句话用）、elapsed_ms。
    出错时带 error 字段。只读查询 + 一次回收调用，不碰任何配置。
    """
    from ctypes import wintypes

    class _PMC(ctypes.Structure):
        _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD),
                    ("PeakWorkingSetSize", ctypes.c_size_t),
                    ("WorkingSetSize", ctypes.c_size_t),
                    ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                    ("PagefileUsage", ctypes.c_size_t),
                    ("PeakPagefileUsage", ctypes.c_size_t),
                    ("PrivateUsage", ctypes.c_size_t)]

    floor = MEM_TRIM_MIN_MB * 1024 * 1024 if min_bytes is None else int(min_bytes)
    out = {"trimmed": 0, "skipped_small": 0, "skipped_named": 0, "denied": 0,
           "failed": 0, "freed": 0, "avail_before": 0, "avail_after": 0,
           "elapsed_ms": 0}
    t0 = time.perf_counter()
    try:
        kernel32 = ctypes.WinDLL("kernel32.dll", use_last_error=True)
        psapi = ctypes.WinDLL("psapi.dll", use_last_error=True)
        # 原型必须声明：不声明的话，64 位下返回的句柄会被当成 32 位截断
        kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel32.OpenProcess.restype = wintypes.HANDLE
        kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel32.CloseHandle.restype = wintypes.BOOL
        kernel32.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD,
                                                       wintypes.LPWSTR,
                                                       ctypes.POINTER(wintypes.DWORD)]
        kernel32.QueryFullProcessImageNameW.restype = wintypes.BOOL
        psapi.EnumProcesses.argtypes = [ctypes.c_void_p, wintypes.DWORD,
                                        ctypes.POINTER(wintypes.DWORD)]
        psapi.EnumProcesses.restype = wintypes.BOOL
        psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(_PMC),
                                              wintypes.DWORD]
        psapi.GetProcessMemoryInfo.restype = wintypes.BOOL
        psapi.EmptyWorkingSet.argtypes = [wintypes.HANDLE]
        psapi.EmptyWorkingSet.restype = wintypes.BOOL
    except Exception as exc:
        out["error"] = str(exc)
        return out

    out["avail_before"] = system_memory()[1]
    skip_pids = {int(p) for p in skip_pids}
    skip_exes = {str(x).strip().lower() for x in skip_exes if str(x).strip()}
    skip_exes |= MEM_TRIM_SKIP_EXE

    def _open(access, pid):
        return kernel32.OpenProcess(access, False, int(pid))

    def _ws(handle):
        pmc = _PMC()
        pmc.cb = ctypes.sizeof(pmc)
        if psapi.GetProcessMemoryInfo(handle, ctypes.byref(pmc), ctypes.sizeof(pmc)):
            return int(pmc.WorkingSetSize)
        return 0

    def _exe_of(handle):
        buf = ctypes.create_unicode_buffer(1024)
        size = wintypes.DWORD(len(buf))
        if kernel32.QueryFullProcessImageNameW(handle, 0, buf, ctypes.byref(size)):
            return buf.value.rsplit("\\", 1)[-1].lower()
        return ""

    arr = (wintypes.DWORD * 4096)()
    needed = wintypes.DWORD()
    if not psapi.EnumProcesses(ctypes.byref(arr), ctypes.sizeof(arr), ctypes.byref(needed)):
        out["error"] = "枚举进程失败"
        return out

    targets = []                     # [(pid, 回收前的工作集)]
    for i in range(needed.value // ctypes.sizeof(wintypes.DWORD)):
        pid = int(arr[i])
        if not pid or pid in (0, 4) or pid in skip_pids:
            continue
        handle = _open(0x0410, pid)              # QUERY_INFORMATION | VM_READ
        if not handle:
            out["denied"] += 1                   # 系统 / 提权进程：普通身份碰不到
            continue
        try:
            name = _exe_of(handle)
            if name in skip_exes:
                out["skipped_named"] += 1
                continue
            ws = _ws(handle)
        finally:
            kernel32.CloseHandle(handle)
        if ws < floor:
            out["skipped_small"] += 1
            continue
        targets.append((pid, ws))

    for pid, _before in targets:
        handle = _open(0x0500, pid)              # QUERY_INFORMATION | SET_QUOTA
        if not handle:
            out["failed"] += 1
            continue
        try:
            if psapi.EmptyWorkingSet(handle):
                out["trimmed"] += 1
            else:
                out["failed"] += 1
        finally:
            kernel32.CloseHandle(handle)

    if out["trimmed"]:
        time.sleep(0.2)                          # 等内存管理器把账记完再量（实测 0.2 秒够）
    for pid, ws_before in targets:
        handle = _open(0x0410, pid)
        if not handle:
            continue
        try:
            ws_after = _ws(handle)
        finally:
            kernel32.CloseHandle(handle)
        if ws_after:
            out["freed"] += max(0, ws_before - ws_after)
    out["avail_after"] = system_memory()[1]
    out["elapsed_ms"] = (time.perf_counter() - t0) * 1000
    return out


def read_media_session():
    """读系统媒体会话 → dict；没在放歌 / 读不到返回 None。

    position 是"读取那一刻"的进度，配上 at（读取时间）就能自己往后推。
    """
    try:
        import asyncio

        from winsdk.windows.media.control import GlobalSystemMediaTransportControlsSessionManager as _Manager
    except Exception:
        return None

    async def _read():
        manager = await _Manager.request_async()
        session, name = _music_session_of(manager)
        if session is None:
            return None
        status = getattr(session.get_playback_info().playback_status, "name", "")
        props = await session.try_get_media_properties_async()
        line = session.get_timeline_properties()
        return {
            "app": name,
            # 原始标识留着：万一还是没名字，气泡顶上能拿它当兜底（见 _app_label）
            "app_id": session.source_app_user_model_id or "",
            "title": (props.title or "").strip(),
            "artist": (props.artist or "").strip(),
            "album": (props.album_title or "").strip(),
            "playing": str(status).upper() == "PLAYING",
            "position": float(line.position.total_seconds()),
            "duration": float(line.end_time.total_seconds()),
            # 播放器到底报没报"时间轴"：网易云 position 和总时长恒为 0（实测），
            # 这种就只能显示歌名，别硬猜进度、也别去抓歌词了
            "has_timeline": (float(line.position.total_seconds()) > 0.0
                             or float(line.end_time.total_seconds()) > 0.0),
            "at": time.time(),
        }

    try:
        return asyncio.run(_read())
    except Exception:
        return None


def _music_session_of(manager):
    """从系统媒体会话里挑出"在放歌的那一个" → (session, 显示名)；挑不到就是 (None, "")。

    名字认不出来（各家版本 AUMID 写法五花八门）就看播放器窗口：
    窗口那边认得出是 QQ音乐 / 网易云，就跟着当前会话走（不然气泡顶上会显示「未知应用」）。
    """
    first = manager.get_current_session()
    for one in [first] + list(manager.get_sessions()):
        if one is None:
            continue
        got = music_app_name(one.source_app_user_model_id)
        if got:
            return one, got
    if first is not None:
        window = read_music_window()
        if window is not None:
            return first, (window.get("app") or "").strip()
    return None, ""


def skip_media(direction):
    """切上一首 / 下一首（direction 给 "prev" / "next"）。

    跟播放 / 暂停一样走系统媒体会话（SMTC）—— QQ音乐、网易云都支持，
    不用去猜播放器的快捷键、也不用去点它的窗口。返回 True / False；
    False = 没找到会话或者播放器没接受（桌宠自己会冒一句让主人手动点）。
    """
    if direction not in ("prev", "next"):
        return False
    try:
        import asyncio

        from winsdk.windows.media.control import GlobalSystemMediaTransportControlsSessionManager as _Manager
    except Exception:
        return False

    async def _skip():
        manager = await _Manager.request_async()
        session, _name = _music_session_of(manager)
        if session is None:
            return False
        if direction == "next":
            return bool(await session.try_skip_next_async())
        return bool(await session.try_skip_previous_async())

    try:
        return bool(asyncio.run(_skip()))
    except Exception:
        return False


def toggle_media_playpause():
    """放歌时切一下"播放 / 暂停"（气泡右上角那颗小按钮）。

    走的是同一套系统媒体会话（SMTC）—— QQ音乐、网易云都支持，所以不用去猜
    播放器的快捷键、也不用去点它的窗口。返回 True / False；False = 没找到会话
    或者播放器没接受（桌宠自己会冒一句让主人手动点）。
    """
    try:
        import asyncio

        from winsdk.windows.media.control import GlobalSystemMediaTransportControlsSessionManager as _Manager
    except Exception:
        return False

    async def _toggle():
        manager = await _Manager.request_async()
        session, _name = _music_session_of(manager)
        if session is None:
            return False
        return bool(await session.try_toggle_play_pause_async())

    try:
        return bool(asyncio.run(_toggle()))
    except Exception:
        return False


def currency_symbol(currency):
    return {"CNY": "¥", "USD": "$", "EUR": "€"}.get((currency or "").upper(), "")


class MenuClickBridge(QAbstractNativeEventFilter):
    """把"落在子菜单上、却被 Windows 送给上层菜单"的点击自己处理掉。

    实测：二级菜单弹出后，鼠标点在它上面时，Windows 把 WM_LBUTTONDOWN/UP 送给了
    **持有鼠标捕获的上层菜单**；Qt 一看坐标在自己外面，就把整个菜单关掉 —— 所以
    二级菜单永远收不到点击（点了就消失）。这里在原生消息层拦截并自己执行那一项。
    """

    DOWN, UP = 0x0201, 0x0202

    def __init__(self, pet):
        super().__init__()
        self.pet = pet

    def nativeEventFilter(self, eventType, message):
        try:
            msg = ctypes.cast(int(message), ctypes.POINTER(_NativeMsg)).contents
        except Exception:
            return False, 0
        if MENU_DEBUG and msg.message in (0x0200, 0x0201, 0x0202, 0x0204, 0x0205):
            name = {0x0200: "WM_MOUSEMOVE", 0x0201: "WM_LBUTTONDOWN", 0x0202: "WM_LBUTTONUP",
                    0x0204: "WM_RBUTTONDOWN", 0x0205: "WM_RBUTTONUP"}.get(msg.message)
            info = f"[原生] {name} hwnd={msg.hWnd} pt=({msg.pt_x},{msg.pt_y})"
            try:
                root = getattr(self.pet, "_menu_keepalive", None)
                for m in self.pet._all_menus(root) if root else []:
                    if int(m.winId()) == msg.hWnd:
                        info += f" → 是菜单(层级{getattr(m, '_dfy_depth', '?')})"
                        break
                else:
                    if int(self.pet.winId()) == msg.hWnd:
                        info += " → 是桌宠"
            except Exception:
                pass
            if msg.message == 0x0200:
                if "是菜单" in info:                 # 只记落在菜单上的移动
                    menu_debug_throttled(info, 250)
            else:
                menu_debug(info)
        if msg.message not in (self.DOWN, self.UP) or not self.pet.ui_open:
            # v1.0.11：菜单窗口收到的鼠标移动，Qt 自己不去处理（这台机器上 Qt 弹出菜单
            # 收不到输入）→ 菜单里"光标停在哪一条"的高亮就不动，快速上下滑看着就是"卡住"。
            # 这里把原生的每一帧移动直接喂给对应那层菜单，高亮就能跟着手走。
            if msg.message == 0x0200 and self.pet.ui_open:
                try:
                    m = self.pet._menu_by_hwnd(msg.hWnd)
                    if m is not None:
                        self.pet._highlight_menu_item(m, QCursor.pos())
                except Exception:
                    pass
            return False, 0
        menu = self.pet.submenu_under_cursor()
        if menu is None:
            return False, 0
        menu_debug(f"[原生] 拦截到落在子菜单上的点击（层级{getattr(menu, '_dfy_depth', '?')}）")
        if msg.message == self.UP:
            self.pet.activate_menu_item(menu)
        return True, 0


class HotkeyBridge(QAbstractNativeEventFilter):
    """全局快捷键：Windows 把热键消息投给"注册它的那个线程"。

    桌宠在主线程用 RegisterHotKey 注册（见 PetWindow._register_hotkeys），
    按下时 Windows 往主线程消息队列里投一条 WM_HOTKEY；Qt 的事件循环
    会先过一遍原生消息过滤器 —— 就在这儿认出来，转给桌宠说一句。
    """

    WM_HOTKEY = 0x0312

    def __init__(self, pet):
        super().__init__()
        self.pet = pet

    def nativeEventFilter(self, eventType, message):
        try:
            if bytes(eventType) not in (b"windows_generic_MSG", b"windows_dispatcher_MSG"):
                return False, 0
            msg = ctypes.cast(int(message), ctypes.POINTER(_NativeMsg)).contents
        except Exception:
            return False, 0
        if msg.message != self.WM_HOTKEY:
            return False, 0
        try:
            self.pet._on_hotkey(int(msg.wParam or 0))
        except Exception as exc:
            print("快捷键处理失败:", exc)
        return True, 0


class SubmenuPlaceFix(QObject):
    """子菜单**一显示的那一瞬间**就把它摆到"贴住这一条"的位置。

    为什么需要：Qt 自己弹子菜单时用的是它自己那套摆法（在条目边上、没有我们那 12px 重叠），
    我们下一拍（120ms 后）才发现"位置不对"再挪过去 —— 主人看到的就是
    "先小部分重叠、再往里移动"。装上这个过滤器以后，摆正发生在同一帧里，看不出来。
    """

    def __init__(self, pet):
        super().__init__(pet)
        self.pet = pet

    def eventFilter(self, obj, ev):
        if isinstance(obj, QMenu) and ev.type() == QEvent.Type.Show:
            try:
                self.pet._place_shown_submenu(obj)
            except Exception:
                pass
        return False


class _NativeMsg(ctypes.Structure):
    _fields_ = [("hWnd", ctypes.c_void_p), ("message", ctypes.c_uint),
                ("wParam", ctypes.c_void_p), ("lParam", ctypes.c_void_p),
                ("time", ctypes.c_ulong), ("pt_x", ctypes.c_long), ("pt_y", ctypes.c_long)]


class ClickPlayer(QIODevice):
    """常开音频流的小音效播放器（自己混音，音量按样本缩放）。

    为什么不用 QSoundEffect：它每次播放都要重新起流，设备空闲后再点，开头一小段
    会被吞掉（表现为「有时候 ya1 听不见」）。这里改成常开的 QAudioSink + 自己
    喂样本：没人点的时候一直输出静音，所以设备始终是醒的，点下去立刻出声、
    完整一段都不会丢；顺便还支持多条音效重叠（连点）。
    """

    def __init__(self, parent=None, rate=44100):
        super().__init__(parent)
        self.rate = rate
        self.volume = 0.9
        self._clips = {}            # 名字 -> array('h') 样本
        self._voices = []           # [[样本, 播放位置, 音量], ...]
        self._lock = threading.Lock()
        self.sink = None
        self.ok = False
        if not AUDIO_AVAILABLE:
            return
        self._open_sink()

    def _open_sink(self):
        """按**当前**系统默认输出设备开一条常开音频流。"""
        if not AUDIO_AVAILABLE:
            return
        try:
            fmt = QAudioFormat()
            fmt.setSampleRate(self.rate)
            fmt.setChannelCount(1)
            fmt.setSampleFormat(QAudioFormat.SampleFormat.Int16)
            device = QMediaDevices.defaultAudioOutput()
            if device.isNull():
                return
            self.open(QIODevice.OpenModeFlag.ReadOnly | QIODevice.OpenModeFlag.Unbuffered)
            self.sink = QAudioSink(device, fmt, self)
            self.sink.setBufferSize(int(self.rate * 0.12) * 2)     # ≈120ms 缓冲
            self.sink.start(self)                              # 常开：一直读我们的样本
            # 注意：PySide6 里没有 QAudioSink.Error/State 这两个枚举名，
            # 用字符串判定，免得踩到 AttributeError 直接静音。
            self.ok = "NoError" in str(self.sink.error())
        except Exception:
            self.sink = None
            self.ok = False

    def rebuild_output(self):
        """系统默认输出设备换了（插耳机 / 切蓝牙音箱）→ 重开一条流，让声音跟着走。

        主人反馈："一开始用笔记本外放，插上耳机以后别的声音都进耳机了，
        点击音效还在外放"——就是因为这条常开流一直绑在**开机时那个**设备上。
        """
        old = self.sink
        self.sink = None
        self.ok = False
        try:
            if old is not None:
                old.stop()
                old.deleteLater()
        except Exception:
            pass
        self._open_sink()
        return self.ok

    # --- QIODevice 接口：Qt 音频线程会不断来要数据 ---
    def isSequential(self):
        return True

    def bytesAvailable(self):
        return 1 << 20

    def readData(self, maxlen):
        frames = max(0, int(maxlen) // 2)
        out = array("h", bytes(int(maxlen)))
        with self._lock:
            for voice in list(self._voices):
                samples, pos, gain = voice
                n = min(frames, len(samples) - pos)
                if n > 0:
                    for i in range(n):
                        s = out[i] + int(samples[pos + i] * gain)
                        out[i] = -32768 if s < -32768 else (32767 if s > 32767 else s)
                    voice[1] = pos + n
                if voice[1] >= len(samples):
                    self._voices.remove(voice)
        return out.tobytes()

    def writeData(self, _data, _maxlen):
        return 0

    # --- 给桌宠用的接口 ---
    def load_clip(self, name, path):
        try:
            with wave.open(path, "rb") as w:
                if (w.getnchannels(), w.getsampwidth(), w.getframerate()) != (1, 2, self.rate):
                    return False
                data = w.readframes(w.getnframes())
            samples = array("h")
            samples.frombytes(data)
            self._clips[name] = samples
            return True
        except Exception:
            return False

    def has_clip(self, name):
        return name in self._clips

    def play(self, name, volume=None):
        samples = self._clips.get(name)
        if samples is None:
            return False
        gain = self.volume if volume is None else volume
        with self._lock:
            self._voices.append([samples, 0, gain])
            if len(self._voices) > 12:        # 太密了就把最老的丢掉
                self._voices.pop(0)
        return True

    def stop_all(self):
        with self._lock:
            self._voices = []


class StaticBodyWindow(QWidget):
    """B 静帧/占位窗口：低内存或 B 加载失败时显示 MIT 鲸鱼娘静态帧，不回 A 外观。"""

    def __init__(self, pix_path=''):
        super().__init__()
        self.setWindowFlags(Qt.WindowType.Tool | Qt.WindowType.FramelessWindowHint |
                            Qt.WindowType.WindowStaysOnTopHint)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        self.setAttribute(Qt.WidgetAttribute.WA_ShowWithoutActivating, True)
        self.setWindowTitle("whale-girl static body")
        self._pix = QPixmap(pix_path) if pix_path else QPixmap()
        self.resize(168, 198)

    def set_pix(self, pix_path):
        pm = QPixmap(pix_path) if pix_path else QPixmap()
        if not pm.isNull():
            self._pix = pm
            self.update()

    def paintEvent(self, _e):  # noqa: N802
        if self._pix.isNull():
            return
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform)
        x = (self.width() - self._pix.width()) // 2
        y = self.height() - self._pix.height()
        p.drawPixmap(x, y, self._pix)


