# -*- coding: utf-8 -*-
# ruff: noqa: E402, F401, F811, F821, I001
"""
大肥鱼桌宠 —— 三视图透明桌宠（只会走 + 看天气 + 报余额）

保留：桌面移动、天气（城市可联网添加）、外观（大肥鱼 / 小鲸鱼挂件切换）
余额挂件特性（对齐 MeteorNOX/DeepSeek-Balance-Whale-Widget, MIT）：
余额泡泡（余额 / 今日已用）、数字滚动动画、拖拽四边吸附、左吸附整体翻转、
按压 Q 弹、按键音效、每轮 Codex 对话消耗换算（峰谷定价表取自该项目）
音乐联动：放 QQ音乐 / 网易云 时读 Windows 媒体会话，把当前歌词挂在气泡里
"""

import contextlib
import ctypes
import hashlib
import json
import math
import os
import random
import re
import subprocess
import sys
import threading
import time
import wave
from array import array
from datetime import datetime

import pet_defaults

import pet_defaults


def load_config():
    try:
        with open("config.json", "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print("配置读取失败:", e)
        return {
            "city": "汕头"
        }

import requests
from PySide6.QtCore import (
    QAbstractNativeEventFilter,
    QEvent,
    QFileInfo,
    QIODevice,
    QObject,
    QPoint,
    QPointF,
    QRectF,
    QSize,
    Qt,
    QTimer,
    QUrl,
)
from PySide6.QtGui import (
    QBrush,
    QColor,
    QCursor,
    QFont,
    QFontMetrics,
    QIcon,
    QImage,
    QKeySequence,
    QMouseEvent,
    QPainter,
    QPixmap,
    QPolygonF,
    QRadialGradient,
)
from PySide6.QtWidgets import (
    QApplication,
    QComboBox,
    QDialog,
    QFileDialog,
    QFileIconProvider,
    QFrame,
    QHBoxLayout,
    QInputDialog,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMenu,
    QMessageBox,
    QPushButton,
    QSlider,
    QSystemTrayIcon,
    QToolButton,
    QVBoxLayout,
    QWidget,
)

try:
    from PySide6.QtMultimedia import QAudioFormat, QAudioSink, QMediaDevices, QSoundEffect
    AUDIO_AVAILABLE = True
except Exception:
    AUDIO_AVAILABLE = False



try:
    from PySide6.QtMultimedia import QMediaDevices, QSoundEffect
    AUDIO_AVAILABLE = True
except Exception:
    AUDIO_AVAILABLE = False











if getattr(sys, "frozen", False):
    APP_DIR = os.path.dirname(sys.executable)
    BUNDLE_DIR = getattr(sys, "_MEIPASS", APP_DIR)
    PYTHONW = sys.executable
    # 打包版的配置/账本写到用户目录，别往 exe 旁边（桌面）丢文件
    USER_DIR = os.path.join(os.environ.get("APPDATA") or APP_DIR, "大肥鱼桌宠")
    try:
        os.makedirs(USER_DIR, exist_ok=True)
    except Exception:
        USER_DIR = APP_DIR
else:
    APP_DIR = os.path.dirname(os.path.abspath(__file__))
    BUNDLE_DIR = APP_DIR
    PYTHONW = os.path.join(APP_DIR, ".venv", "Scripts", "pythonw.exe")
    USER_DIR = APP_DIR
SPRITE_DIR = os.path.join(BUNDLE_DIR, "sprites")
ASSET_DIR = os.path.join(BUNDLE_DIR, "assets")     # 音效 + 小鲸鱼挂件形象
CONFIG_PATH = os.path.join(USER_DIR, "config.json")

# 旧 A 皮肤（whale_skin.py / sprites）已退役（task-138）；当前只使用 B（webm_body.py）。
try:
    import smooth_anim as _smooth_anim
except Exception:      # 平滑/编排模块缺失 → 退回原渲染（不阻塞启动）
    _smooth_anim = None
try:
    import speech_requests as _speech_requests
except Exception:      # LLM 台词队列缺失 → 固定台词降级（不阻塞启动）
    _speech_requests = None
try:
    os.environ.setdefault("QTWEBENGINE_CHROMIUM_FLAGS", "--enable-low-end-device-mode")
    import webm_body as _webm_body
except Exception:      # B 身体模块缺失 → 回退 png/占位
    _webm_body = None

# 新界面（设置窗口）：v1.1.0 起，菜单里的「打开设置…」开的是它。
# 单独一个模块；万一它起不来，也绝不能拖垮桌宠本身 —— 老菜单照旧能用。
# （先把自己的目录塞进 sys.path：直接 exec 加载本文件时也能找到 ui_console）
if APP_DIR not in sys.path:
    sys.path.insert(0, APP_DIR)
try:
    import ui_console
    ui_console.set_asset_dir(ASSET_DIR)
except Exception as _ui_exc:                       # pragma: no cover
    ui_console = None
    print("控制台界面加载失败:", _ui_exc)




# Qt 自带的中文翻译得留个引用，不然会被回收（回收了按钮又变回 OK / Cancel）
_QT_TRANSLATORS = []



BUBBLE_H = pet_defaults.BUBBLE_H  # 气泡区高度（集中默认值在 pet_defaults；config.bubble_height 可覆盖）
MARGIN = 4
# 五档。**滑块上的百分比以「大」为 100%**（2026-09-14 定的：选「大」时滑块就停在 100%），
# 所以这几档特意按"乘出来是整百分数"排：30% / 40% / 60% / 80% / 100%。
SIZE_LEVELS = {"迷你": 0.27, "特小": 0.36, "小": 0.54, "中": 0.72, "大": 0.90}
SIZE_REF = SIZE_LEVELS["大"]      # 滑块上的 100% = 这一档（340 * 0.9 = 306px）
# 无级调节的范围：20% ~ 150%（原来只有 30% ~ 120%）
SIZE_MIN = 0.18
SIZE_MAX = 1.35                 # 硬上限（任何配置都不允许超过）
SIZE_MAX_DEFAULT = 0.35         # 用户偏好默认（Lead 2026-10-26：生产 cap=0.35，防"又变大"）
SIZE_DEFAULT = SIZE_LEVELS["中"]




MIN_WIN_W = 168        # 窗口最窄宽度：小档位也别把气泡挤成一条（气泡要放得下三四行字）

# 语录（闲着时自己冒话）的触发频率档位
# cooldown = 两句之间最少隔多少帧（20ms/帧）。"正常"就是原来的行为，其它档只动这个间隔。
LINE_FREQ_LEVELS = {
    "安静": {"cooldown": 1500, "hint": "约 30 秒一句"},
    "正常": {"cooldown": 600, "hint": "约 12~17 秒一句"},
    "话多": {"cooldown": 300, "hint": "约 7~8 秒一句"},
    "话痨": {"cooldown": 150, "hint": "约 4~6 秒一句"},
}
LINE_FREQ_DEFAULT = "正常"
SPEED = 380.0
TICK = 20
# 「原地待着时也跟着鼠标转」的"鼠标贴身上"半径：鼠标在这个圈里就当正面（不左右转）
STILL_FACE_NEAR = 70

# ===== 它说话的调子 =====
# 统一风格：俏皮、机灵、有点小得意也爱撒娇的少女；句子短、口语、（呀／嘛／啦／诶／哦）。
# 三条不要：不要"AI 味"的排比和解释腔、不要说教、不要脏话。
# 加新台词照这个调子写就行。
#
# 闲着时冒的一句"双击我给你看余额"——双击被改成别的（或没配 Key）时就不再冒它（见 _maybe_idle_action）
DOUBLE_CLICK_HINT_LINE = "双击我一下嘛，余额马上端给你看"

LINES = [
    "在的在的，我一直蹲在这儿呢",
    "今天也要元气满满哦～我先替你满了",
    "偷偷瞄了一眼余额，还行，没被你饿着",
    "你专注起来的样子，我看了好久诶",
    "别老看我啦，看屏幕呀",
    "摸鱼是不对的……不过我不告状，放心",
    "我这么可爱，你多看我两眼也正常啦",
    "嗯哼，是不是在想我",
    "我刚刚在心里夸了你一句，你猜是哪句",
    DOUBLE_CLICK_HINT_LINE,
    "嫌我吵？把「语录频率」调成安静，我立刻闭嘴，说到做到",
    "嫌我占地方就把我调小一点点嘛",
]
REACT_LINES = [
    "哎呀别戳啦，痒的呀",
    "干嘛干嘛，我又不是按钮",
    "戳一下就想走？不行，得多戳两下才行",
    "你点到我了……好吧，允许你再来一次",
    "怎么啦，是想我了还是想看余额了",
    "哎哟，轻点儿戳嘛",
    "本鲸今天心情好，不跟你计较啦",
    "戳我干嘛呀，余额又不会自己变多",
    "行行行，我帮你看一眼余额……喏，就这么多",
]
INNER_LINES = [
    "唔…他是不是又想看余额了",
    "今天要不要多夸他两句呢",
    "他发呆的样子好呆哦（可爱那种）",
    "有点想要被摸头…但是不能主动说",
    "刚才那句我说重了吗？",
    "余额别掉那么快嘛，我还没花够",
    "他要是把我关掉就惨了，安静点安静点",
    "他工作起来就不理我了，哼",
    "我悄悄说一句：其实我挺喜欢他的",
]
DRAG_LINES = ["哇——飞起来咯！", "轻点轻点，我发型要乱了呀",
              "放我下来嘛……再玩一次也不是不行", "晕晕晕，转得我眼花了"]
# 快速双击选「说一句我写的台词」时冒的这几句（默认这几句，用户可整组改写）
DOUBLE_CLICK_LINES = [
    "双击算什么本事呀，有本事双击两次",
    "在的在的，说事儿嘛",
    "摸鱼可以，别摸我啦",
    "省着点花嘛，我还想多陪你两年",
]

# 离开一阵子又回来时说的（{away} = 离开了多久）
BACK_LINES = [
    "回来啦？我可是一直数着时间的哦",
    "诶，{away}没见着人，跑哪儿去了呀",
    "欢迎回来～我刚刚打了个小盹",
]

# 切成某一档「语录频率」时冒的话（每档都能在「台词内容…」里自己改写）
FREQ_LINES = {
    "安静": ["行行行，我闭嘴，安静得像块小石头",
             "安静模式启动咯，你忙你的，我不出声"],
    "正常": ["嗯～就按平时的节奏来，我偶尔冒个泡哦",
             "说话频率调回正常啦，我稍微热情一点点"],
    "话多": ["话多是你要的哦，可别回头嫌我",
             "那我多唠两句嘛，反正你也没别的娱乐"],
    "话痨": ["碎碎念模式！接下来请欣赏我的独角戏",
             "嘿嘿，我的嘴从现在开始停不下来咯"],
}
FREQ_LINE_KEYS = {f"FREQ_LINES_{level}": level for level in FREQ_LINES}

# 可以让用户自己改写的台词分组（键 → 给人看的名字）
LINE_GROUPS = [
    ("LINES", "日常台词（闲置时）"),
    ("REACT_LINES", "点击回嘴"),
    ("INNER_LINES", "心声（灰色小气泡）"),
    ("DRAG_LINES", "拖拽时"),
    ("DOUBLE_CLICK_LINES", "快速双击时（自己写）"),
    ("BACK_LINES", "离开 / 返回时（{away} = 离开时长）"),
    ("MUSIC_CLICK_LINES", "放歌时点击（{song} = 歌名——歌手）"),
    ("MUSIC_START_LINES", "换歌时（同上）"),
    ("FREQ_LINES_安静", "语录频率·安静（切换档位时）"),
    ("FREQ_LINES_正常", "语录频率·正常（切换档位时）"),
    ("FREQ_LINES_话多", "语录频率·话多（切换档位时）"),
    ("FREQ_LINES_话痨", "语录频率·话痨（切换档位时）"),
]

# ===== 「语录板块」总开关 =====
# 哪几块参与说话，由主人在「设置 → 文案和语录 → 语录板块」里勾。
# id → (给人看的名字, 说明, 这一块管着哪些台词 key)
# **快速双击不在这个表里**：主人要求"双击触发不受影响"——
# 双击做的那件事（看余额 / 天气 / 在放什么 / 说一句我写的）永远照旧，不受这些开关牵连。
LINE_SECTIONS = [
    ("idle", "日常台词（闲置时）", "闲着的时候自己冒的那几句", ["LINES"]),
    ("inner", "心声（灰色小气泡）", "它自己在心里嘀咕的那几句", ["INNER_LINES"]),
    ("react", "点击回嘴", "点它一下之后回你的话", ["REACT_LINES"]),
    ("drag", "拖拽时", "把它拖来拖去、松手时说的话", ["DRAG_LINES"]),
    ("back", "离开 / 返回时", "离开半小时以上、回来时打的那句招呼", ["BACK_LINES"]),
    ("music_click", "放歌时点击", "放着歌的时候点它，说的那一句", ["MUSIC_CLICK_LINES"]),
    ("music_start", "换歌时", "切到下一首时冒的那一句", ["MUSIC_START_LINES"]),
    ("freq", "语录频率切换时", "把语录频率换成安静 / 正常 / 话多 / 话痨时说的话",
     ["FREQ_LINES_安静", "FREQ_LINES_正常", "FREQ_LINES_话多", "FREQ_LINES_话痨"]),
]
# 台词 key → 板块 id（没列在这儿的就是双击那类，永远说）
LINE_SECTION_OF = {key: sid for sid, _n, _d, keys in LINE_SECTIONS for key in keys}
LINE_SECTION_IDS = {sid for sid, _n, _d, _k in LINE_SECTIONS}


# ===== 余额挂件配置 =====
BALANCE_URL = "https://api.deepseek.com/user/balance"
BALANCE_TTL = 60          # 余额自动刷新间隔（秒）
USAGE_PATH = os.path.join(USER_DIR, "usage.json")   # 今日已用账本
# 账本抗跳变：余额下降不等于"用量"，平台侧（赠送额度到期/回收、退款、接口抽风）
# 也会让余额掉一大块。单次刷新掉得太多就不算用量，改成记「余额变动」。
# 阈值按两次采样的间隔放宽（每小时最多信 5 元），免得关一晚桌宠之后把正常用量也挡掉。
USAGE_JUMP_LIMIT = 20.0   # 元：60 秒这种短间隔下，单次最多信这么多是用量
USAGE_JUMP_RATE = 5.0     # 元/小时：间隔拉长时按这个放宽

# 峰谷定价（每百万 token 单价，元）与时段规则取自
# MeteorNOX/DeepSeek-Balance-Whale-Widget（MIT）
BASE_PRICE = {"hit": 0.05, "miss": 1.5, "out": 4.5}    # 空闲时段
PRO_PRICE = {"hit": 0.10, "miss": 3.0, "out": 9.0}     # 高峰时段
WEEKEND_VALLEY_FROM = datetime(2026, 8, 23)            # 此后周末全天按谷价

# 音效（两套，取自上面那个项目；文件缺失时静默降级）
SOUND_SETS = {
    "小黄鸭": ("Ya1.wav", "Ya2.wav"),
    "音效1": ("D1.wav", "D2.wav"),
}
SOUND_POOL = 3          # 每种音效同时可播的实例数（连点不互相打断）
# 点击音：把原「按压 + 松手」两条 wav 拼成一条，点一次就放完整一段
CLICK_CLIP_FILES = {"小黄鸭": "click-duck.wav", "音效1": "click-fx1.wav"}

# 用户自己加的音效（放在用户目录里，不跟程序混在一起）
SOUND_USER_DIR = os.path.join(USER_DIR, "sounds")
SOUND_IDEAL = (0.15, 0.60)      # 点击音最适合的时长区间（秒）
SOUND_KEEP_MAX = 0.60           # 太长的帮他裁到这个长度
# 给主人看的建议（加音效时会弹出来）
SOUND_TIP = ("点击音最适合 0.15 ~ 0.60 秒：\n"
             "· 太短（不到 0.15 秒）容易听不清，只剩一下咔哒\n"
             "· 太长（超过 0.60 秒）连点时会叠成一团、听着拖\n"
             "· 最稳的是 0.2 ~ 0.4 秒，干脆利落")


# ===== 音乐联动（QQ音乐 / 网易云音乐）=====
# 这两个软件都会把"现在在放什么"登记到 Windows 的媒体会话里（SMTC），
# 所以不用猜窗口标题，直接读系统媒体会话就能拿到歌名 / 歌手 / 播放状态 / 进度。
MUSIC_APPS = {
    "qqmusic": "QQ音乐",
    "qq music": "QQ音乐",
    "cloudmusic": "网易云音乐",
    "netease": "网易云音乐",       # 商店版 / 新版客户端 AUMID 里常写成 Netease.xxx
    "网易云": "网易云音乐",
}
MUSIC_POLL_MS = 1500          # 多久看一眼在放什么歌
# 暂停之后气泡还留着多久（留着才有地方点"继续放"；太久就收起来，别一直挂在那儿）
PAUSED_BUBBLE_SEC = pet_defaults.PAUSED_BUBBLE_SEC
LYRIC_BTN_SIZE = 20            # 歌词气泡右上角那几颗按钮（⏮ ⏸▶ ⏭）的直径
LYRIC_BTN_GAP = 3              # 这几颗按钮之间的间隔
# 顶行「♪ 应用 · 歌名」右边要留出来的宽度：这几颗按钮就住在这一条里，
# 不留就会被文字压住（主人反馈"和原本的文字打架了"）
LYRIC_BTN_PAD = LYRIC_BTN_SIZE * 3 + LYRIC_BTN_GAP * 2 + 12
# 顶行最多占几行：小尺寸下「♪ 应用 《歌名》——歌手」一行塞不下，宁可折两行（别把歌名切掉）
LYRIC_HEAD_ROWS = 2

# 播放器给的信息可能不全（网易云实测会缺歌名/歌手）：缺了就用这几个占位，
# 命名风格保持一致（"无题" / "未知歌手" / "未知应用"）
TITLE_PLACEHOLDER = "无题"
ARTIST_PLACEHOLDER = "未知歌手"
APP_PLACEHOLDER = "未知应用"

# 歌词对时：正数 = 文字延后（等等声音），负数 = 文字提前。不同输出设备延迟不一样：
# 笔记本外放几乎没延迟，蓝牙耳机/音箱能差 0.3~1 秒，所以做成可选项。
LYRIC_OFFSET_LEVELS = [
    ("文字提前 0.5 秒", -0.5),
    ("文字提前 0.2 秒", -0.2),
    ("刚好同步", 0.0),
    ("文字延后 0.2 秒", 0.2),
    ("文字延后 0.5 秒", 0.5),
    ("文字延后 1.0 秒", 1.0),
]
LYRIC_OFFSET_DEFAULT = 0.2      # 默认让文字稍微等一下（实测文字容易抢在声音前头）
LYRIC_ANIM_SEC = 0.15           # 歌词换句时的过渡动画时长（秒）
LYRIC_ANIM_MS = 10              # 过渡期间用 100 帧/秒重绘（主时钟在休闲模式只有 25 帧，不够顺）
BUBBLE_ANIM_SEC = pet_defaults.BUBBLE_ANIM_SEC  # 集中默认值；config.bubble_anim_sec 可覆盖
LYRIC_KARAOKE_ON = False        # 逐字高亮（"唱到哪变蓝到哪"）：主人说不要，先关掉（网易云多数歌也没逐字数据）
LYRIC_KARAOKE_COLOR = (72, 104, 240)   # 已唱到的那部分的颜色（DeepSeek 蓝）

# 气泡风格（语录 / 余额 / 歌词三种气泡共用一套，在「设置 → 桌宠形象 → 外观」里换）：
# auto = 跟着设置界面的亮暗走，light / dark = 自己定死。
BUBBLE_STYLES = [("auto", "跟随界面"), ("light", "浅色"), ("dark", "深色")]
# 两套气泡底色 / 字色。亮色那套就是原来写死的值（老 config.json 不变样）。
BUBBLE_INK = {
    "light": {
        "bg": QColor(255, 255, 255, 242),          # 气泡底
        "fg": QColor(60, 60, 80),                  # 正文字
        "inner_bg": QColor(232, 232, 238, 242),    # 心声（（）那种）的底
        "inner_fg": QColor(125, 125, 138),
        "bal_title": QColor(130, 138, 158),        # 余额气泡：标题 / 数字 / 小字
        "bal_big": QColor(32, 49, 112),
        "bal_sub": QColor(150, 150, 165),
        "ly_head": QColor(140, 148, 168),          # 歌词气泡：应用·歌名 / 当前句 / 下一句
        "ly_main": QColor(38, 44, 66),
        "ly_next": QColor(158, 158, 172),
    },
    "dark": {
        "bg": QColor(31, 35, 49, 246),
        "fg": QColor(233, 235, 244),
        "inner_bg": QColor(45, 50, 68, 246),
        "inner_fg": QColor(170, 176, 196),
        "bal_title": QColor(151, 157, 178),
        "bal_big": QColor(150, 186, 255),
        "bal_sub": QColor(128, 135, 160),
        "ly_head": QColor(151, 157, 178),
        "ly_main": QColor(233, 235, 244),
        "ly_next": QColor(128, 135, 160),
    },
}
# 联动桥气泡情绪色（P1.5）：只覆盖底色/字色，不动原主题；没有命中的 kind 走原样。
BRIDGE_BUBBLE_TINTS = {
    "report": {"bg": QColor(255, 244, 222, 244), "fg": QColor(122, 84, 26)},
    "remind": {"bg": QColor(255, 235, 205, 244), "fg": QColor(140, 80, 20)},
    "night": {"bg": QColor(34, 40, 64, 246), "fg": QColor(214, 222, 246),
              "inner_bg": QColor(46, 54, 84, 246), "inner_fg": QColor(178, 186, 214)},
    "greet": {"bg": QColor(228, 240, 255, 244), "fg": QColor(40, 80, 140)},
    "love": {"bg": QColor(255, 228, 238, 244), "fg": QColor(160, 60, 90)},
    "inner": {"bg": QColor(236, 236, 244, 242), "fg": QColor(120, 120, 140)},
}

# 余额气泡里"现在高峰 / 空闲"那行的颜色（深色底上得亮一点才看得清）
BUBBLE_PEAK_COLORS = {"light": (QColor(198, 90, 20), QColor(46, 125, 50)),
                      "dark": (QColor(232, 152, 92), QColor(120, 214, 156))}

# 右键菜单每条前面的小图标：跟设置窗口**同一套**（assets/icons 里的 Lucide 线稿，
# 同一个 24 网格、线宽 1.75）。按文字**前缀**匹配、取最长的那个 ——
# 菜单文字常带状态后缀（「语录频率（现在：话多）」「透明度…（现在 100%）」）。
# 一张表、一份刷图标的代码，两版菜单（瘦身版 / 经典版）一起上 —— 这就是"图标风格统一"。
# 没写进来的条目就留空，菜单不会因为缺图标少显示一条。
MENU_ICONS = (
    ("查看余额", "nav.balance"),
    ("查看天气", "nav.weather"),
    ("看一眼", "ui.eye"),
    ("打开设置", "nav.general"),
    ("快速双击", "page.click"),
    ("说一句我写的台词", "ui.quote"),
    ("改写这几句", "ui.quote"),
    ("模式", "nav.behavior"),
    ("自由散步", "nav.behavior"),
    ("跟随鼠标", "nav.behavior"),
    ("原地待着", "nav.behavior"),
    ("大小", "page.resize"),
    ("迷你", "page.resize"),
    ("特小", "page.resize"),
    ("精确调节", "page.resize"),
    ("形象", "nav.appearance"),
    ("大肥鱼", "nav.appearance"),
    ("小鲸鱼挂件", "nav.appearance"),
    ("我的形象库", "nav.appearance"),
    ("全部恢复默认形象", "nav.appearance"),
    ("层级", "page.layers"),
    ("置顶", "page.layers"),
    ("置底", "page.layers"),
    ("普通层", "page.layers"),
    ("透明度", "page.opacity"),
    ("设置默认城市", "page.location"),
    ("自动定位城市", "page.location"),
    ("添加城市", "page.location"),
    ("天气", "nav.weather"),
    ("设置 Key", "nav.balance"),
    ("余额来源", "nav.balance"),
    ("添加其他 API Key", "nav.balance"),
    ("校准今日已用", "page.calibrate"),
    ("余额常显", "nav.balance"),
    ("每轮消耗统计", "page.calibrate"),
    ("每轮对话后显示消耗", "page.calibrate"),
    ("设置 Agent 名称", "ui.edit"),
    ("设置会话日志目录", "page.location"),
    ("日志目录", "page.location"),
    ("余额", "nav.balance"),
    ("吸附", "page.magnet"),
    ("拖拽吸附四边", "page.magnet"),
    ("左吸附时翻面", "page.magnet"),
    ("文案", "ui.quote"),
    ("显示峰谷时段", "nav.lines"),
    ("峰谷文案", "ui.quote"),
    ("语录频率", "ui.quote"),
    ("台词内容", "ui.quote"),
    ("进程联动", "nav.integration"),
    ("应用启动提醒", "nav.integration"),
    ("扫描本机应用并添加", "nav.integration"),
    ("音乐联动", "nav.music"),
    ("放歌时看着", "nav.music"),
    ("显示歌词内容", "nav.music"),
    ("歌词对时", "page.clock"),
    ("歌词太慢", "page.clock"),
    ("歌词太快", "page.clock"),
    ("按播放器显示的时间对齐", "page.clock"),
    ("这首歌的微调清零", "page.clock"),
    ("这首歌对不上", "page.clock"),
    ("流畅度", "nav.performance"),
    ("性能模式", "nav.performance"),
    ("休闲模式", "nav.performance"),
    ("百宝箱", "page.sparkle"),
    ("回收内存", "page.sparkle"),
    ("免打扰", "ui.bell-off"),
    ("结束免打扰", "ui.bell-off"),
    ("今日汇总", "page.calibrate"),
    ("回收时不动前台程序", "page.sparkle"),
    ("音效选择", "nav.sound"),
    ("按键音效", "nav.sound"),
    ("添加我的音效", "ui.add"),
    ("音量", "page.volume-high"),
    ("试听音效", "page.volume-high"),
    ("音效", "nav.sound"),
    ("显示/隐藏", "ui.eye"),
    ("回到屏幕内", "page.location"),
    ("锁定位置", "page.lock"),
    ("鼠标穿透", "page.pointer-off"),
    ("救急恢复", "page.rescue"),
    ("记菜单日志", "ui.help"),
    ("开机自启", "page.power"),
    ("退出", "page.exit"),
)

# 子菜单里的条目往下继承父项的图标（"大小"下面的迷你 / 小 / 中…都跟大小一个图案），
# 只有**父项和子项本来就不是一回事**的写在这里（天气菜单下面列的是城市）。
MENU_ICON_CHILD = (
    ("天气", "page.location"),
)
LYRIC_MAX_ROWS = 4              # 当前这句最多折几行（再多就先把字号缩一档）
LYRIC_MIN_PT = 7                # 折行还是超了时，字号最小缩到几磅（只有"迷你档 + 超长英文句"才会用到）
LYRIC_OVERFLOW_ROWS = 8         # 缩到底还装不下时最多铺几行（宁可气泡高一点，也别丢歌词）
MUSIC_HOLD_SEC = 5.0          # 放歌时：双击看余额 / 点"查看天气"，都显示 5 秒
MUSIC_PEEK_SEC = MUSIC_HOLD_SEC
PEEK_SEC = MUSIC_HOLD_SEC       # 快速双击看余额：顶上来显示几秒

# 快速双击（鼠标快点两下桌宠）冒什么：一级菜单「快速双击」里选。
# 「看一眼余额」必须**配了 Key 才给选** —— 没配 Key 时双击不会弹余额窗口，
# 还是原来的"换姿势"，只在本次启动里提醒一次怎么配（见 PetWindow._on_double_click）。
DOUBLE_CLICK_CHOICES = [
    ("balance", "看一眼余额（5 秒）"),
    ("weather", "看一眼天气"),
    ("music", "看一眼在放什么"),
    ("lines", "说一句我写的台词"),
]
DOUBLE_CLICK_DEFAULT = "balance"
# 双击之后留几秒"让位"：这几秒里的自言自语先憋着，别把刚弹出来的那一眼盖掉
DOUBLE_CLICK_HOLD_SEC = {"balance": PEEK_SEC, "weather": MUSIC_HOLD_SEC,
                         "music": MUSIC_HOLD_SEC, "lines": 4.0}
MENU_HOVER_MS = 120           # 菜单悬停兜底的检查间隔
MENU_HOVER_FAST_MS = 40       # 菜单开着时用这个间隔（纠位置差不多是"瞬间"）
MENU_HOVER_DELAY = 0.22       # 光标在带子菜单的项上停多久就替它弹出子菜单
MENU_HOVER_GRACE = 0.5        # 光标离开子菜单后，再等这么久才收（给手抖 / 斜着划过去留余地）
MENU_DEBUG_LOG = os.path.join(USER_DIR, "menu-debug.log")   # 菜单排查用日志
MENU_DEBUG = False            # 菜单排查日志（需要时改成 True，会写 menu-debug.log）
MENU_DEBUG_RUNTIME = False    # 同上，但可以由菜单里的「记菜单日志」开关打开（存在 config.json）
MENU_DEBUG_MOVE_MS = 120      # 鼠标移动最多每 120ms 记一条（免得日志爆掉）




_menu_debug_last = {"t": 0.0}




LYRIC_CACHE_PATH = os.path.join(USER_DIR, "lyrics_cache.json")
LYRIC_CACHE_MAX = 300         # 歌词缓存最多留多少首
LYRIC_CACHE_VERSION = 2       # 缓存格式版本：2 = 可能含逐字歌词（yrc）；旧缓存会自动重抓一次

# 放歌时点它的回嘴（{song} 会替换成《歌名》——歌手）
MUSIC_CLICK_LINES = [
    "♪ 正放着 {song} 呢，别打断我嘛",
    "刚听到副歌你就戳我，{song} 诶",
    "♪ 我在听 {song}，你品味还行哦",
    "别急别急，{song} 还没放完呢",
    "♪ {song}……要不要跟着哼两句呀",
    "听得正入神呢，{song} 真好听",
    "♪ 现在是 {song}，挑歌水平在线嘛",
]
# 换歌时冒一句
MUSIC_START_LINES = [
    "♪ 换歌啦：{song}",
    "♪ 这首 {song}，我先替你听听",
    "♪ 来活儿咯：{song}",
    "♪ 切到 {song} 啦，这首我记下了",
]












# 形象：大肥鱼（三视图）/ 小鲸鱼挂件（单张 cut-out）
SKIN_PET = "大肥鱼"
SKIN_WIDGET = "小鲸鱼挂件"
WIDGET_SKIN_FILE = "small-whale.png"
SPRITE_VIEWS = {"front": "正面", "side": "侧面", "back": "背面"}
VIEW_LABELS = {"front": "正面（朝屏幕下）", "side": "侧面（左右走）",
               "back": "背面（朝屏幕上）", "widget": "小鲸鱼挂件"}
# 短名字：菜单 / 对话框 / 冒泡里用得着（VIEW_LABELS 太长）
VIEW_SHORT = {"front": "正面", "side": "侧面", "back": "背面", "widget": "挂件"}

# 打开的某些应用时冒泡吐槽（进程名小写）
PROCESS_LINES = {
    "steam.exe": ["Steam 一开，今晚的我就没人管了吧", "又要玩游戏啦？我帮你看着时间哦"],
    "wegame.exe": ["开黑去咯～记得回来看看我", "打游戏可以，眼睛也要歇一歇呀"],
    "epicgameslauncher.exe": ["又是白嫖时间？领完就走哦", "Epic 又送游戏啦，快去拿"],
    "league of legends.exe": ["峡谷走起～上分了记得夸我一句", "又打排位呀？输了不许冲我发脾气"],
    "genshinimpact.exe": ["原神启动！抽卡前先看我一眼嘛", "去提瓦特啦？玩累了记得回来"],
    "chrome.exe": ["又开浏览器摸鱼，我什么都没看见哦", "开工还是冲浪？我猜是后者"],
    "msedge.exe": ["上网冲浪咯～", "开这么多标签，内存不会哭吗"],
    "douyin.exe": ["刷抖音记得看时间呀，我掐着表呢", "短视频是个坑，要不要我拉你一把"],
    "qq.exe": ["有人找你哦，别装没看见", "QQ 响了！快去回一下"],
    "wechat.exe": ["微信有人找你，回一下嘛", "别老盯着我看啦，去回消息"],
    "weixin.exe": ["微信有人找你，回一下嘛", "别老盯着我看啦，去回消息"],
    "qqmusic.exe": ["听歌时间！要不要跟着哼两句", "这歌好听诶，再来一首嘛"],
    "cloudmusic.exe": ["网易云开了，今天要 emo 吗", "听歌一时爽，一直听一直爽"],
    "code.exe": ["又写代码啦，记得多喝水哦", "写代码的样子好认真（我盯着呢）"],
    "chatgpt.exe": ["又去找它聊天？我有点吃醋诶", "我在这儿呢，随时待命啦"],
    "taskmgr.exe": ["打开任务管理器？是不是想关掉我…", "别看我占内存嘛，我很省的"],
    "obs64.exe": ["要录屏啦？记得把我拍得可爱一点", "开播咯，我去角落待着"],
    "photoshop.exe": ["开始画图啦，画完给我看看嘛", "修图还是摸鱼？我都支持哦"],
}

# ===== 自动说话：用久了 / 到点 / 快捷键 =====
# 三条规则都住在 config.json 里（app_time_lines / timed_lines / hotkeys），
# 下面这几个是"新装一份"时给的内置默认，主人可以在「设置 → 应用联动」里随便改、关、删。

# 用久了提醒：连续在前台用满这些分钟就说一句（进程名小写）
TIME_LINES = {
    "steam.exe": (60, ["{app} 玩了一个多小时咯，起来动动嘛",
                       "一个小时啦～眼睛也要喘口气的"]),
    "wegame.exe": (60, ["{app} 一个小时了，站起来晃两步嘛",
                        "打了一个多小时咯，腰还撑得住吗"]),
    "league of legends.exe": (90, ["{app} 一个半小时了，赢了也别再加一局哦",
                                   "峡谷再好看也得歇歇呀"]),
    "genshinimpact.exe": (60, ["{app} 一小时咯，眼睛离屏幕远一点点",
                               "一个小时啦，起来走两步再玩嘛"]),
    "douyin.exe": (40, ["{app} 刷了四十分钟啦，抬头看看我嘛",
                        "再刷下去天就黑咯，真的"]),
    "code.exe": (90, ["{app} 一个半小时了，喝口水，脖子也动动",
                      "九十分钟啦，起来走两步再战嘛"]),
    "chatgpt.exe": (90, ["{app} 聊了一个半小时咯，起来伸个懒腰",
                         "一个半小时了，记得喝水哦"]),
}

# 到点说一句：daily=每天这个点 / weekly=每周这几天 / interval=每隔 N 分钟
CLOCK_LINES_DEFAULT = [
    {"id": "builtin-night", "when": "daily", "time": "23:30", "days": [],
     "every": 0, "on": True, "summary": True,
     "lines": ["23:30 咯，早点睡嘛，明天的事明天再说",
               "都这个点啦？眼睛也要下班的哦"]},
]

# 全局快捷键：按一下它就说一句（键和台词都能改、能关、能删）
HOTKEYS_DEFAULT = [
    {"id": "builtin-praise", "seq": "Ctrl+Alt+1", "act": "lines", "on": True,
     "lines": ["哇！这一下也太帅了吧", "不错嘛你，我就知道你能行",
               "这波我给满分，真的满分", "厉害厉害，我在这儿都看呆了"]},
    {"id": "builtin-cheer", "seq": "Ctrl+Alt+2", "act": "lines", "on": True,
     "lines": ["别急别急，慢慢来嘛，我陪着你", "加油哦，再撑一小会儿就顺了",
               "有点难对吧？歇口气再来"]},
    {"id": "builtin-tease", "seq": "Ctrl+Alt+3", "act": "lines", "on": True,
     "lines": ["就这？……好吧，其实也还行啦", "又摸鱼？我可都记在小本本上了哦",
               "行吧，看在你这么认真的份上，我不说了"]},
]

WEEKDAY_NAMES = ("周一", "周二", "周三", "周四", "周五", "周六", "周日")

# 快捷键按下之后干什么（跟「快速双击」那四个动作是一套）
HOTKEY_ACTS = [("lines", "说一句（用下面写的台词）"),
               ("balance", "看一眼余额"),
               ("weather", "看一眼天气"),
               ("music", "看一眼在放什么")]

# 全局快捷键：修饰键表 + 认得的那些键
HOTKEY_BASE = 0xA510          # 注册用的 id 从这儿开始（只在桌宠自己这儿用）
HOTKEY_NOREPEAT = 0x4000      # 按住不放只算一次（不加会一直连发）
HOTKEY_MODS = {"ctrl": 0x0002, "control": 0x0002, "alt": 0x0001,
               "shift": 0x0004, "win": 0x0008, "meta": 0x0008}
HOTKEY_SPECIAL = {
    "space": 0x20, "tab": 0x09, "enter": 0x0D, "return": 0x0D, "esc": 0x1B,
    "escape": 0x1B, "backspace": 0x08, "del": 0x2E, "delete": 0x2E,
    "ins": 0x2D, "insert": 0x2D, "home": 0x24, "end": 0x23,
    "pgup": 0x21, "pageup": 0x21, "pgdn": 0x22, "pagedown": 0x22,
    "up": 0x26, "down": 0x28, "left": 0x25, "right": 0x27,
}
HOTKEY_MIN_MODS = 0x0002      # 至少得带 Ctrl（单键 / 纯 Shift 太容易误触、也容易抢别人的键）
FG_IDLE_FREEZE = 600          # 键鼠静了这么久（秒）就认为人不在："用久了"不累计也不提醒














# ===== 每日小结 / 免打扰 / 应用时长账本 =====
APP_TIME_PATH = os.path.join(USER_DIR, "app_time.json")   # 各应用今天的累计时长
APP_TIME_FLUSH_S = 60          # 每 60 秒把应用时长落一次盘（不要每 2 秒写一次）
# 小结里显示的名字（没列到的就用 exe 名去掉后缀）
APP_LABELS = {
    "steam.exe": "Steam", "wegame.exe": "WeGame", "epicgameslauncher.exe": "Epic",
    "league of legends.exe": "英雄联盟", "genshinimpact.exe": "原神",
    "douyin.exe": "抖音", "code.exe": "VS Code", "chatgpt.exe": "ChatGPT",
    "chrome.exe": "Chrome", "msedge.exe": "Edge", "firefox.exe": "Firefox",
    "qq.exe": "QQ", "wechat.exe": "微信", "weixin.exe": "微信",
    "qqmusic.exe": "QQ音乐", "cloudmusic.exe": "网易云音乐",
    "obs64.exe": "OBS", "photoshop.exe": "Photoshop", "taskmgr.exe": "任务管理器",
}
SUMMARY_MIN_SECONDS = 20 * 60      # 小结里至少用了这么久才点名（按时间从长到短取前两条）
SUMMARY_MAX_APPS = 2
BACK_AWAY_SECONDS = 1800           # 键鼠静这么久算"你走开了"，回来打个招呼
FULLSCREEN_REPORT_MIN = 180        # 全屏至少持续这么久，攒下的提醒才汇报
QUIET_DEFAULT_MIN = 30
















# 余额来源：目前只有 DeepSeek 和 OpenRouter 有公开的余额接口
NO_BALANCE_SERVICES = ("openai", "chatgpt", "gpt")
OPENROUTER_CREDITS_URL = "https://openrouter.ai/api/v1/credits"

# 从任意 agent 的会话日志里认 token 用量时用到的键名（Codex / Claude Code 等结构不同）
USAGE_TOKEN_KEYS = ("input_tokens", "prompt_tokens", "output_tokens", "completion_tokens",
                    "cached_input_tokens", "cache_read_input_tokens", "total_tokens")

# 每轮 Codex 对话消耗：读 Codex 会话日志里的 token 用量
CODEX_SESSIONS_DIR = os.path.join(os.path.expanduser("~"), ".codex-deepseek", "sessions")
CODEX_SCAN_MS = 3000        # 扫描间隔
CODEX_QUIET_S = 20          # 一轮安静这么久就结算并冒泡






SKIN_KIND_LABELS = {"pet": "三维形象", "widget": "挂件形象"}
# 三维形象的三个槽位（挂件只有一个）
PET_SLOTS = ("front", "side", "back")








# 峰谷提示文案（学原挂件的三档：默认 / 梁文峰谷 / !?强强?!）
PEAK_TEXT_STYLES = {
    "默认": ("高峰时段", "空闲时段"),
    "梁文峰谷": ("梁文·峰", "梁文·谷"),
    "!?强强?!": ("!?强强?!", "…弱弱…"),
}






























# ---------- 百宝箱：内存回收 ----------
# 只做"温和回收"：对能碰到的进程调 EmptyWorkingSet，把它已经用不着的那部分工作集还给系统。
# 不提权 —— 普通用户身份就能做（桌宠安装包默认就是这个不弹 UAC 的身份）。
# 实测（本机 62.5 GB，探针 F:\Codex\work\probe_mem_optimize.py）：
#   311 个进程里 141 个能碰到（都是同一个用户的），工作集 12.2 GB → 0.29 GB，整轮 150 ~ 850 ms；
#   剩下 170 个（系统 / 提权进程）连句柄都打不开 —— 那部分要管理员，本功能不做。
# 注意：收出来的页并没有消失，只是从"进程工作集"挪进了"备用列表"，程序再用到时是软缺页。
MEM_TRIM_MIN_MB = 20        # 比这还小的进程不动（收了也省不下什么）
MEM_TRIM_SKIP_EXE = {       # 系统关键进程：动了没收益，还可能让服务顿一下
    "system", "idle", "registry", "memory compression", "secure system",
    "smss.exe", "csrss.exe", "wininit.exe", "winlogon.exe", "services.exe",
    "lsass.exe", "dwm.exe", "fontdrvhost.exe", "audiodg.exe",
}






























def read_music_window():
    """退路：读不到媒体会话时，直接看 QQ音乐 / 网易云 的窗口标题。"""
    try:
        from ctypes import wintypes
        user32 = ctypes.WinDLL("user32.dll")
        found = []

        @ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
        def _visit(hwnd, _param):
            try:
                if not user32.IsWindowVisible(hwnd):
                    return True
                length = user32.GetWindowTextLengthW(hwnd)
                if length <= 0:
                    return True
                buf = ctypes.create_unicode_buffer(length + 1)
                user32.GetWindowTextW(hwnd, buf, length + 1)
                title = (buf.value or "").strip()
                if not title:
                    return True
                pid = wintypes.DWORD()
                user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                exe = process_exe_by_pid(pid.value)
                app = music_app_name(exe)
                if app:
                    found.append((app, title, exe))
            except Exception:
                pass
            return True

        user32.EnumWindows(_visit, 0)
        for app, title, exe in found:
            song, artist = split_music_title(title, app)
            if song:
                return {"app": app, "app_id": exe, "title": song, "artist": artist,
                        "album": "", "playing": True, "position": None,
                        "duration": 0.0, "at": time.time(), "from_title": True}
    except Exception:
        pass
    return None




_LRC_TAG = re.compile(r"\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]")








_YRC_LINE_RE = re.compile(r"^\[(\d+),(\d+)\](.*)$")
_YRC_WORD_RE = re.compile(r"\((\d+),(\d+),(\d+)\)")
_LRC_TIME_RE = re.compile(r"^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]")
_LRC_INLINE_RE = re.compile(r"<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>")




def parse_word_lyrics(text):
    """解析"逐字歌词"，返回 {这句的开始秒: [(字, 这个字的开始秒), ...]}。

    支持两种：
    · 网易云的 yrc：`[16250,2140](16250,430,0)有(16680,430,0)些(17110,430,0)话...`
    · 带行内时间戳的增强 LRC：`[00:16.25]有<00:16.68>些<00:17.11>话...`
    解析不出来就返回空 dict（那就退回"按这句的起止时间匀速推"）。
    """
    out = {}
    for raw in (text or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        m = _YRC_LINE_RE.match(line)
        if m and _YRC_WORD_RE.search(line):
            start = int(m.group(1)) / 1000.0
            body = m.group(3)
            marks = list(_YRC_WORD_RE.finditer(body))
            pairs = []
            for i, mk in enumerate(marks):
                end = marks[i + 1].start() if i + 1 < len(marks) else len(body)
                piece = body[mk.end():end]          # 这个词的文字（可能不止一个字，比如 "OP"）
                if not piece:
                    continue
                t0 = int(mk.group(1)) / 1000.0
                dur = int(mk.group(2)) / 1000.0
                n = len(piece)
                for k, ch in enumerate(piece):      # 词内按字数均分时间，避免几个字一起跳
                    pairs.append((ch, t0 + dur * k / max(1, n)))
            if pairs:
                out[start] = pairs
            continue
        m = _LRC_TIME_RE.match(line)
        if m and _LRC_INLINE_RE.search(line):
            start = _ms_or_sec(m.group(1), m.group(2), m.group(3))
            body = line[m.end():]
            pairs, pos, cur = [], 0, start
            for im in _LRC_INLINE_RE.finditer(body):
                piece = body[pos:im.start()].strip()
                if piece:
                    pairs.extend((c, cur) for c in piece)
                cur = _ms_or_sec(im.group(1), im.group(2), im.group(3))
                pos = im.end()
            tail = body[pos:].strip()
            if tail:
                pairs.extend((c, cur) for c in tail)
            if pairs:
                out[start] = pairs
    return out


















WS_EX_LAYERED, WS_EX_TRANSPARENT = 0x80000, 0x20










def has_chinese(text):
    return any("\u4e00" <= ch <= "\u9fff" for ch in (text or ""))




# ---------- 天气数据源 ----------
# 2026-09-14 换源。以前第一站是 wttr.in（墙外），实测从这台机器 4/4 全失败
# （3.0 秒被断连 / 12.9 秒读超时），而且它失败两次才轮到备用源 —— 这就是
# "每次看天气都要等十几秒"的根源。现在第一站是**国内直连的中国天气网**：
# 不要 Key，实测城市搜索 0.2~0.4 秒、实况 0.1 秒，回来的本来就是中文。
CN_WEATHER_SEARCH = "https://toy1.weather.com.cn/search"
CN_WEATHER_SK = "https://d1.weather.com.cn/sk_2d/{code}.html"
CN_WEATHER_HEADERS = {"User-Agent": "Mozilla/5.0",
                      "Referer": "https://www.weather.com.cn/"}










# open-meteo（WMO）天气代码 → 中文，做中国天气网取不到时的兜底
WMO_ZH = {
    0: "晴", 1: "晴间多云", 2: "多云", 3: "阴", 45: "雾", 48: "冻雾",
    51: "小毛毛雨", 53: "毛毛雨", 55: "大毛毛雨", 56: "冻毛毛雨", 57: "强冻毛毛雨",
    61: "小雨", 63: "中雨", 65: "大雨", 66: "冻雨", 67: "强冻雨",
    71: "小雪", 73: "中雪", 75: "大雪", 77: "雪粒",
    80: "小阵雨", 81: "中阵雨", 82: "强阵雨", 85: "小阵雪", 86: "大阵雪",
    95: "雷阵雨", 96: "雷阵雨伴冰雹", 99: "强雷阵雨伴冰雹",
}




















from pet_mixins import PetWindowMixins  # noqa: E402


class PetWindow(PetWindowMixins, QWidget):
    # ---------- 城市（联网添加） ----------
    def auto_locate_city(self):
        """按 IP 联网定位城市（挂梯子时定位到的是节点所在地）。"""
        self.say("我上网找找你在哪儿哦…")
        threading.Thread(target=lambda: self._city_queue.append(to_chinese_city(locate_city_by_ip())),
                         daemon=True).start()

    def search_city_dialog(self):
        """联网搜索城市：先查地理编码，查不到就用天气接口验证这个名字能不能用。"""
        with self._ui_guard():
            name, ok = QInputDialog.getText(self, "添加城市", "输入城市名（联网搜索）:",
                                            QLineEdit.EchoMode.Normal, "",
                                            Qt.WindowType.WindowStaysOnTopHint)
        if not ok or not name.strip():
            return
        self.say("我查查这个城市哦…")
        threading.Thread(target=lambda: self._city_pick_queue.append(lookup_city(name)),
                         daemon=True).start()

    def _apply_city(self, name):
        self.cfg["city"] = name
        # 顺手记进"城市列表"，之后菜单里可以直接点着切换。
        # 刚选中的这个排**最前面**（列表的第一位永远是当前城市，一眼看到自己在用哪个）
        others = [c for c in (self.cfg.get("city_list") or []) if c and c != name]
        self.cfg["city_list"] = ([name] + others)[:12]   # 最多留 12 个，别越堆越长
        self.save_config()              # 立刻落盘，下次启动就是这个默认城市
        self.say(f"好咯，城市换成{name}啦")
        self._get_weather()
        self._notify_console()          # 设置窗口开着的话，那一排城市立刻跟上

    def cities_ordered(self):
        """城市列表：**当前城市永远排最前面**，其余保持原顺序、不重复。

        菜单和设置页都读这个 —— 不管 config.json 里是怎么排的（老配置的当前城市
        可能躺在最后），显示出来总是"选中的那个在第一"。
        """
        cur = (self.cfg.get("city") or "").strip()
        out = []
        for c in ([cur] if cur else "") + list(self.cfg.get("city_list") or []):
            if c and c not in out:
                out.append(c)
        return out

    def remove_city_dialog(self):
        """从城市列表里删掉一个（最后一个删不掉，总得留一个用）。"""
        cities = self.cities_ordered()
        if len(cities) <= 1:
            self.say("就剩这一个城市啦，删下去可要空咯")
            return
        with self._ui_guard():
            pick, ok = QInputDialog.getItem(self, "删除城市", "删掉哪个城市？", cities,
                                            0, False, Qt.WindowType.WindowStaysOnTopHint)
        if not ok or not pick:
            return
        left = [c for c in cities if c != pick]
        self.cfg["city_list"] = left
        if self.cfg.get("city") == pick:
            # 城市列表是"当前的在最前"，删掉当前的就顶最前面那个上来
            self.cfg["city"] = left[0] if left else self.cfg.get("city", "汕头")
        self.save_config()
        self.say(f"{pick} 拿走咯")
        self._notify_console()

    def set_city_dialog(self):
        """手动设置默认城市：直接写进 config.json，不联网、不用等搜索。"""
        with self._ui_guard():
            city, ok = QInputDialog.getText(
                self,
                "设置默认城市",
                "输入城市名（中文英文都行，例如：汕头 / Shantou）:",
                QLineEdit.EchoMode.Normal,
                self.cfg.get("city", "汕头"),
                Qt.WindowType.WindowStaysOnTopHint
            )
        if ok and city.strip():
            self._apply_city(city.strip())
        elif ok:
            self.say("城市名总得写一个嘛")

    # ---------- 配置 ----------
    def save_config(self):
        try:
            self.cfg.pop("ds_api_key", None)
        except Exception:
            pass
        """把当前配置写回 config.json。"""
        try:
            with open(CONFIG_PATH, "w", encoding="utf-8") as f:
                json.dump(self.cfg, f, ensure_ascii=False, indent=2)
            self._cfg_snapshot = json.dumps(self.cfg, ensure_ascii=False, sort_keys=True)
        except Exception as ex:
            print("配置保存失败:", repr(ex))

    def autosave_config(self):
        """配置有变化就顺手存一下，不用等到退出（被杀掉也不丢设置）。"""
        try:
            now_snap = json.dumps(self.cfg, ensure_ascii=False, sort_keys=True)
        except Exception:
            return
        if now_snap != getattr(self, "_cfg_snapshot", None):
            self.save_config()

    def __init__(self):
        # 菜单排查日志：每次启动重新写，免得越积越大
        if MENU_DEBUG:
            try:
                with open(MENU_DEBUG_LOG, "w", encoding="utf-8") as f:
                    f.write(f"=== 大肥鱼桌宠 菜单日志 {datetime.now():%Y-%m-%d %H:%M:%S} ===\n")
            except Exception:
                pass

        # 默认配置；老 config.json 缺的新键会自动补上（免得升级后 KeyError）
        cfg_defaults = {
            "mode": "wander",
            # 新装默认 184px（29 §12）：340 × (184/340) = 184；老 config.json 有值时不覆盖、不自动放大
            "size": 184 / 340,
            "topmost": True,
            "passthrough": False,
            "autostart": False,
            "x": None,
            "y": None,
            "ds_api_key": "",
            "city": "汕头",
            "city_list": [],
            "balance_always": False,
            "snap_on": True,
            "flip_on_left": True,
            "locked": False,          # 锁定位置：开了就拖不动（防误触），点击 / 菜单照旧
            "turn_cost_on": True,
            "skin": SKIN_PET,
            "sound_on": True,
            "sound_set": "小黄鸭",
            "volume": 0.9,
            "show_peak": False,
            "peak_style": "默认",
            "bubble_style": "auto",     # 气泡风格：跟随界面 / 浅色 / 深色
            "line_freq": LINE_FREQ_DEFAULT,
            "lyric_offset": LYRIC_OFFSET_DEFAULT,
            "layer": "top",
            "opacity": 1.0,
            "process_alerts": True,
            # 自动说话（都在「设置 → 应用联动」里改）：
            #   用久了提醒 / 到点说一句 / 全局快捷键
            "app_time_on": True,
            "app_time_lines": app_time_default_rules(),
            "timed_on": True,
            "timed_lines": clone_rules(CLOCK_LINES_DEFAULT),
            "hotkeys_on": True,
            "hotkeys": clone_rules(HOTKEYS_DEFAULT),
            # 说话时机：离开回来打招呼 / 全屏（打游戏看电影）时闭嘴
            "back_greet": True,
            "fullscreen_silent": True,
            # 百宝箱的小工具：免打扰默认时长
            "quiet_minutes": QUIET_DEFAULT_MIN,
            "music_link": True,
            "music_lyrics": True,
            "perf_mode": True,
            # 鲸鱼娘 2D 帧动画皮肤（素材：codex-deepseek-pet；资产缺失自动回退 classic）
            "whale": {
                "on": True,
                "body": "webm",         # 用户 2026-10-26：只保留 B（MIT 鲸鱼娘 50 WebM），A 不再展示
                "maxSize": 0.35,        # 用户偏好：最大显示尺寸（0.35 ≈ 生产上限；硬上限仍 1.35）
                "windowW": pet_defaults.WINDOW_W,
                "windowH": pet_defaults.WINDOW_H,
                "displayHeight": pet_defaults.DISPLAY_H,
                "fadeMs": pet_defaults.CLIP_FADE_MS,
                "footAnchor": pet_defaults.FOOT_ANCHOR,
            },
            # 气泡/待机参数（pet_defaults 集中默认值，面板/config 可覆盖）
            "bubble_height": pet_defaults.BUBBLE_H,
            "bubble_anim_sec": pet_defaults.BUBBLE_ANIM_SEC,
            "paused_bubble_sec": pet_defaults.PAUSED_BUBBLE_SEC,
            # LLM 台词请求（task-133）：正常走插件 LLM，固定台词仅故障兜底
            "speech": {
                "llmRequests": True,
                "fallbackTimeoutHealthyMs": 4500,   # 管道健康时等 LLM（p95≈1.5s，留余量）
                "fallbackTimeoutOfflineMs": 1500,   # 管道离线时快速兜底
            },
            # 失联休眠（task-77）：DSH 长时间没消息 → 离线打盹；默认不擅自退出（Agent 安全）
            "lifecycle": {
                "offlineAfterMs": 120000,   # 2 分钟没收到任何管道命令 → 进入离线打盹
                "exitWithDsh": False,       # 默认不跟 DSH 一起退出，防误退
                "exitAfterMs": 600000,      # exitWithDsh=true 时，静默满 10 分钟才退出
            },
            # A 路线 2.5D「3D 感」增强（task-74；默认开，render.enhance=false 完全回滚原渲染）
            # 用户反馈「站着的时候人物倾斜」：倾角硬限幅 ≤3°，静止不倾斜（旧 config 的 20 也在代码里夹紧）
            "render": {
                "enhance": True,
                "tilt_max_deg": 3.0,
                "shadow": True,
                "parallax": True,
                "physics": True,
                "edges": True,
                "gaze": True,
            },
            "custom_skins": {},
            "skin_library": {"pet": [], "widget": []},   # 两本分开：三维形象 / 挂件形象
            "skin_draft": {},                             # 三维形象没挑完的三张图
            "skin_pick_dir": "",
            "balance_source": "DeepSeek",
            "other_keys": [],
            "double_click": DOUBLE_CLICK_DEFAULT,     # 快速双击弹哪个窗口（余额/天气/在放什么/台词）
            "custom_process_lines": {},
            "default_line_overrides": {},
            "custom_lines": {},
            "lines_off": [],                          # 关掉的「语录板块」（见 LINE_SECTIONS）
            "agent_name": "Codex",
            "agent_sessions_dir": "",
            "codex_sessions_dir": CODEX_SESSIONS_DIR,
            "menu_debug": False,
            "custom_sounds": {},
            "still_face_cursor": False,
            "mem_skip_foreground": True,    # 百宝箱·回收内存：不动前台程序（防卡顿）
            # 设置窗口自己的样子（背景 / 标题 / 图标）。跟桌宠本体无关，
            # 全是 ui_console.BACKDROP_DEFAULTS 里那几个键，界面那边负责读写。
            "console_bg_path": "",
            "console_bg_fit_window": True,
            "console_bg_focus": "cc",
            "console_bg_bright": 0,
            "console_bg_blur": 0,
            "console_bg_scrim": 34,
            "console_brand_title": "大肥鱼桌宠",
            "console_logo_path": "",
            "console_accent": "",
            "console_card_alpha": 100,
            "console_card_radius": 12,
            "console_remember_geo": True,
            "console_geo": "",
            "console_start_page": "balance"
        }
        self.cfg = load_json(CONFIG_PATH, dict(cfg_defaults))
        for cfg_key, cfg_value in cfg_defaults.items():
            self.cfg.setdefault(cfg_key, cfg_value)
        _bubble = pet_defaults.bubble_defaults(self.cfg)
        self.bubble_h = _bubble["height"]
        self.bubble_anim_sec = _bubble["animSec"]
        self.paused_bubble_sec = _bubble["pausedSec"]
        # 界面配色一上来就按配置定下来：气泡风格选「跟随界面」时要看这个亮暗，
        # 老对话框取主题色也走同一套 —— 以前是等设置窗口建出来才 set_mode，
        # 那样"刚启动、还没开过设置"的时候气泡会按系统的亮暗走，不是主人选的那档。
        if ui_console is not None:
            try:
                ui_console.set_mode(self.cfg.get("ui_theme", "system"))
            except Exception:
                pass
        # 菜单排查日志可以像开关一样存在 config.json 里（菜单里那一项用的）
        global MENU_DEBUG_RUNTIME
        MENU_DEBUG_RUNTIME = bool(self.cfg.get("menu_debug", False))
        if MENU_DEBUG_RUNTIME:
            try:
                with open(MENU_DEBUG_LOG, "w", encoding="utf-8") as f:
                    f.write(f"=== 大肥鱼桌宠 菜单日志 {datetime.now():%Y-%m-%d %H:%M:%S} ===\n")
            except Exception:
                pass
        self._cfg_snapshot = None

        flags = Qt.WindowType.FramelessWindowHint | Qt.WindowType.Tool
        if self.cfg.get("topmost", True):
            flags |= Qt.WindowType.WindowStaysOnTopHint
        super().__init__(None, flags)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        # v1.0.10：二三级菜单点击的"摆渡"（这台 Windows 会把落在子菜单上的点击送给上层菜单）
        self._click_bridge = MenuClickBridge(self)
        _app = QApplication.instance()
        if _app is not None:
            _app.installNativeEventFilter(self._click_bridge)
            # 全局快捷键也走原生消息（WM_HOTKEY），跟菜单那套一样在过滤器里收
            self._hotkey_bridge = HotkeyBridge(self)
            _app.installNativeEventFilter(self._hotkey_bridge)
        self.setMouseTracking(True)      # 菜单开着时要靠这个收鼠标移动消息（见 _forward_mouse_to_menu）
        self.setWindowTitle("大肥鱼桌宠")

        # 精灵加载（三视图 + 挂件，每一张都可以被用户自定义图片替换）
        self.sprites = {}
        self.custom_skin_ok = {}
        self._base_cache = {}             # 原始大图（裁过透明边）的缓存：无级调节要反复缩放，不能每次都读盘
        self._migrate_skin_library()      # 老配置里直接存的图片路径 → 搬进「我的形象库」
        self._rebuild_sprites()
        self.icon = QIcon(os.path.join(SPRITE_DIR, "icon.png"))

        self.skin = self.cfg.get("skin", SKIN_PET)
        if self.skin not in (SKIN_PET, SKIN_WIDGET) or (self.skin == SKIN_WIDGET
                                                        and not self._has_sprite("挂件")):
            self.skin = SKIN_PET

        # 用户偏好：最大显示尺寸（生产默认 0.35；config.whale.maxSize 可调，向上不超硬上限）
        try:
            _wmax = float((self.cfg.get("whale") or {}).get("maxSize", SIZE_MAX_DEFAULT))
        except (TypeError, ValueError):
            _wmax = SIZE_MAX_DEFAULT
        self.max_size = max(SIZE_MIN, min(SIZE_MAX, _wmax))
        self.cfg["size"] = self._clamp_size(self.cfg["size"])
        self.cur_h = int(340 * self.cfg["size"])
        # 老配置里存的是无级调节调出来的高度（不在五档上）时，得把那个高度的精灵补上，
        # 否则第一帧就没图可画
        self._ensure_sprites(self.cur_h)
        self._apply_window_size()

        # ---- 鲸鱼娘 2D 帧动画（默认开启；资产缺失/异常自动回退原三视图） ----
        self._whale = None
        self._whale_force = None          # 外部动作（act:/state:/演出）强制播放的动作名
        self._whale_micro_at = 0          # 下一次 idle 小动作的 tick
        self._whale_hold_until = 0.0      # 单次动作播完后保持末帧到什么时候（墙上时间；0=不保持）
        self._whale_pat_cd = 0.0          # 点击摸头 / 嘴硬演出冷却（内部时钟秒）
        self._whale_cry_cd = 0.0          # 摔哭冷却（29 §2.3：30 分钟）
        self._bridge_mute_until = 0.0     # 桥侧 mute 到什么时候（闷声时不演梗）
        self._whale_walk_rate = 1.35      # 走路慢放倍率（体验评审：1.0 步/秒自然；1.2/1.35/1.6 可配三档）
        try:
            _wcfg = self.cfg.get("whale")
            if not isinstance(_wcfg, dict):
                _wcfg = {"on": True}
            try:
                self._whale_walk_rate = max(0.5, min(3.0, float(_wcfg.get("walkRate", 1.35) or 1.35)))
            except (TypeError, ValueError):
                self._whale_walk_rate = 1.35
            # A 皮肤已退役；B 由 webm_body 负责，_whale 保持 None。
            self._whale = None
        except Exception:
            self._whale = None

        # ---- 渲染平滑 / 事件动画（task-131）：淡化 + 次级运动 + 待机微动作 + 庆祝/对话编排 ----
        self._smooth = _smooth_anim
        try:
            self._smooth_cfg = _smooth_anim.SmoothConfig(self.cfg) if _smooth_anim else None
        except Exception:
            self._smooth_cfg = None
        if self._whale is not None and self._smooth_cfg is not None:
            try:
                self._whale.set_smooth({
                    "enabled": self._smooth_cfg.enabled,
                    "crossfadeMs": self._smooth_cfg.crossfade_ms,
                    "actionFadeMs": self._smooth_cfg.action_fade_ms,
                })
            except Exception:
                pass
        try:
            self._idle_micro = _smooth_anim.IdleMicroScheduler(
                self._smooth_cfg or _smooth_anim.SmoothConfig({}), now=time.time(),
                rng=random.Random()) if _smooth_anim else None
        except Exception:
            self._idle_micro = None
        self._celebration = None          # 庆祝 5 拍状态 {stage,t0}
        self._cellbrate_stage_at = 0.0
        self._celebrate_cd_until = 0.0    # done 庆祝冷却（墙上时间；120s）
        self._task_started_at = 0.0       # 长回合计时（thinking/tool 开始时间）
        self._short_done_i = 0            # done 短反应轮换计数（动作/句式去重）
        self._dialog_force = None         # 对话动作占用的 force（到时清）
        self._dialog_until = 0.0
        self._dialog_queue = []           # 对话后续拍 [(action, at_secs)]
        self._whale_micro_until = 0.0     # 循环微动作（hum）回收时间
        self._anim_fast = False           # 过渡期 16ms 提频标记
        # ---- LLM 台词请求队列（task-133）：正常抑制固定台词，插件 say: 回来即取消兜底 ----
        # ---- B 身体（WebM QWebEngineView，默认；失败回退占位/旧渲染）----
        self._body = "png"
        self._webm = None
        self._webm_ready = False
        self._webm_h = 105
        self._webm_main_click_through = False
        self._static_body = None
        self._speech = None
        self._speech_enabled = bool((self.cfg.get("speech") or {}).get("llmRequests", True))
        self._speech_log_path = ""
        self._speech_dir = ""
        try:
            if os.path.exists(os.path.join(APP_DIR, "speech-debug.on")):
                self._speech_log_path = os.path.join(APP_DIR, "speech-debug.log")
        except Exception:
            pass
        try:
            _want_body = str((self.cfg.get("whale") or {}).get("body") or "webm")
        except Exception:
            _want_body = "webm"
        if _want_body == "placeholder":
            try:
                if not self._show_static_body():
                    self._body = "png"
            except Exception:
                self._body = "png"
        elif _want_body == "webm":
            try:
                self._init_webm_body()
            except Exception as _wexc:
                print("WebM 身体初始化失败，回退 B 静帧:", repr(_wexc))
                try:
                    self._anim_log("webm init FAILED: %r" % (_wexc,))
                except Exception:
                    pass
                self._show_static_body()
                self._body = "placeholder"
        try:
            if _speech_requests is not None and self._speech_enabled:
                _sp = self.cfg.get("speech") or {}
                # P2：显式 queueDir / PET_WORK_DIR 优先；否则源码布局 pet-work（含 tools）优先
                _sp_dir = str(_sp.get("queueDir") or os.environ.get("PET_WORK_DIR") or os.environ.get("PET_WORK") or "")
                if not _sp_dir:
                    _cand = os.path.dirname(APP_DIR)
                    _sp_dir = _cand if os.path.isdir(os.path.join(_cand, "tools")) else APP_DIR
                self._speech_dir = _sp_dir
                self._speech = _speech_requests.build_queue(
                    _sp_dir,
                    timeout_healthy_ms=int(_sp.get("fallbackTimeoutHealthyMs", 4500) or 4500),
                    timeout_offline_ms=int(_sp.get("fallbackTimeoutOfflineMs", 1500) or 1500),
                )
                self._speech_log("queue path=%s" % os.path.join(_sp_dir, "speech-requests.json"))
        except Exception:
            self._speech = None
        self._anim_log_path = str(os.environ.get("PET_ANIM_LOG") or "")
        if not self._anim_log_path:
            try:
                if os.path.exists(os.path.join(APP_DIR, "anim-log.on")):
                    self._anim_log_path = os.path.join(APP_DIR, "anim-log.txt")
            except Exception:
                pass

        # ---- 失联休眠（task-77）：默认 2 分钟无命令打盹，不擅自退出 ----
        _lc = self.cfg.get("lifecycle")
        if not isinstance(_lc, dict):
            _lc = {}
        try:
            _lc_off = int(_lc.get("offlineAfterMs", 120000) or 120000)
        except (TypeError, ValueError):
            _lc_off = 120000
        try:
            _lc_exit = int(_lc.get("exitAfterMs", 600000) or 600000)
        except (TypeError, ValueError):
            _lc_exit = 600000
        self.lifecycle = {
            "offlineAfterMs": max(5000, min(3600000, _lc_off)),
            "exitWithDsh": bool(_lc.get("exitWithDsh", False)),
            "exitAfterMs": max(60000, min(86400000, _lc_exit)),
        }
        self._last_line_at = time.time()     # 最近一次收到管道命令的墙上时间
        self._life_offline = False           # 离线打盹中
        self._life_offline_at = 0.0
        self._life_greet_at = 0.0            # 醒来问好的冷却（墙上时间）
        self._life_silent_ms = 0

        # 状态
        self.mode = self.cfg["mode"] if self.cfg["mode"] in ("wander", "follow", "still") else "wander"
        self.dir = "down"
        self.facing = 1
        # 「原地待着」时要不要跟着鼠标转（只管朝向、不挪窝；默认不要）
        self.still_face_cursor = bool(self.cfg.get("still_face_cursor", False))
        self.target = None
        self.rest_until = 0
        self.cur_speed = 0.0
        self.prev_key = None
        self.cross_t = 0.0
        self.action = None
        self.action_t = 0.0
        self.bubble_text = ""
        self.bubble_until = 0
        self.bubble_inner = False
        self.last_speak_tick = 0
        self.t = 0
        self.jump_t = 0
        self.dragging = False
        self._drag_blocked = False   # 锁定时按着划了一下（不算点击、也不挪窝）
        self.drag_offset = None
        self.drag_start_pos = None
        self.last_line = ""
        self.last_press_pos = None

        # ---- A 路线 2.5D「3D 感」增强状态（task-74；旧配置自动补默认；enhance=false 时全部旁路） ----
        _r = self.cfg.get("render")
        if not isinstance(_r, dict):
            _r = {}
        self.render = {
            "enhance": bool(_r.get("enhance", True)),
            # 倾角上限硬夹到 3°：老 config.json 里存着 20° 也不许再放大（用户反馈站立倾斜）
            "tilt_max_deg": max(0.0, min(3.0, float(_r.get("tilt_max_deg", 3.0) or 3.0))),
            "shadow": bool(_r.get("shadow", True)),
            "parallax": bool(_r.get("parallax", True)),
            "physics": bool(_r.get("physics", True)),
            "edges": bool(_r.get("edges", True)),
            "gaze": bool(_r.get("gaze", True)),
        }
        self.cfg["render"] = self.render
        self._enh_phys = None           # 抛掷物理 {"vx","vy","bounces"}
        self._enh_drag_samples = []     # 拖拽速度采样 [(ms,gx,gy)]
        self._enh_land = 0.0            # 落地压扁量 0~1（指数衰减）
        self._enh_dizzy_until = 0.0     # 眩晕截止（秒）
        self._enh_edge = None           # 边缘姿态 {"side","since_ms"}
        self._enh_gaze = 0.0            # 视线偏移 -1~1（x）
        self._enh_gaze_y = 0.0          # 视线偏移 -1~1（y）
        self._enh_last_edge_check = 0

        # 余额挂件状态
        self.balance = None          # {"total": 24.05, "currency": "CNY", "today": 0.0, "stale": False}
        self.bal_until = 0.0         # 余额泡泡显示截止时间（秒）
        self.balance_always = bool(self.cfg.get("balance_always", False))
        self.show_peak = bool(self.cfg.get("show_peak", False))
        self.peak_style = self.cfg.get("peak_style", "默认")
        self.bubble_style = self.cfg.get("bubble_style", "auto")
        if self.bubble_style not in dict(BUBBLE_STYLES):
            self.bubble_style = "auto"
        self.line_freq = (self.cfg.get("line_freq")
                          if self.cfg.get("line_freq") in LINE_FREQ_LEVELS else LINE_FREQ_DEFAULT)
        try:
            self.lyric_offset = float(self.cfg.get("lyric_offset", LYRIC_OFFSET_DEFAULT))
        except (TypeError, ValueError):
            self.lyric_offset = LYRIC_OFFSET_DEFAULT
        if self.peak_style not in PEAK_TEXT_STYLES:
            self.peak_style = "默认"
        self._peak_now = None
        self.layer = self.cfg.get("layer", "top")
        if self.layer not in ("top", "bottom", "normal"):
            self.layer = "top"
        self.opacity = float(self.cfg.get("opacity", 1.0) or 1.0)
        self.process_alerts = bool(self.cfg.get("process_alerts", True))
        self._running_procs = None      # 第一次扫描只记录，不冒泡
        self._last_proc_say = 0.0
        self._foreground_proc = None     # 上一次的前台应用
        self._proc_said_at = {}          # 每个应用上次吐槽的时间

        # 用久了提醒：连续在前台待的时间（只在"有人在动键鼠"的时候累计）
        self._fg_exe = None
        self._fg_accum = 0.0             # 这一轮累计了多少秒（换应用就清零）
        self._fg_clock = 0.0             # 上一次结算的时刻
        self._fg_count = 0               # 这一轮已经提醒过几次
        # 到点说一句：每条规则上次说的时刻（每天/每周记 "日期 时刻"，每隔记时间戳）
        self._timed_last = {}
        # 全局快捷键
        self._hotkey_ids = []            # 已经注册上的热键 id
        self._hotkey_slots = {}          # 热键 id → 那条规则（按键 / 动作 / 台词）
        self._hotkey_failed = []         # 注册失败（被别的程序占用）的键
        self._app_time_queue = []        # 扫到的应用列表（后台线程 → 主线程）

        # 音乐联动状态（QQ音乐 / 网易云）
        self.music_on = bool(self.cfg.get("music_link", True))
        self.music_lyrics = bool(self.cfg.get("music_lyrics", True))
        self.perf_mode = bool(self.cfg.get("perf_mode", True))   # True=性能模式（动画优先）
        # 每帧时长：性能模式 50 帧，休闲模式 25 帧（动作按同一个时钟换算，速度不变）
        self.tick_ms = TICK if self.perf_mode else TICK * 2
        self.now_playing = None          # {"app","title","artist","playing","position",...}
        self._music_queue = []           # 后台线程 → 主线程
        self._music_busy = False
        self._music_manual = False       # 菜单里点了"立刻看一眼"，结果要回话
        self._music_said_at = 0.0        # 换歌冒泡的节流
        self._music_played = 0.0         # 播放器不给进度时，按实际播放时长累加
        self._music_tick_at = 0.0        # 上一次累加的时刻
        self._bal_peek_until = 0.0       # 放歌时快速双击 → 临时看余额
        self._peek_pending = False        # 双击要的那一眼，等余额回来再冒泡
        self._key_hint_shown = False      # "没配 Key，双击看不了余额"这句每次启动只提醒一次
        self._last_click_ms = -99999     # 快速双击判定（墙上时间，毫秒）
        self._single_pending = None      # 单击欠着的那句台词：(到点秒, 说话函数)，双击就撤销
        self._dc_hold_until = 0.0        # 双击之后这几秒不让自言自语插嘴（别盖住刚弹的那一眼）
        self._trigger_until = 0.0        # 触发类的话说到什么时候：这段时间里闲话让位（见 say）
        self._bal_wait_until = 0.0       # 余额泡泡等"触发类的话"说完再顶上来（见 show_balance_bubble）
        self._bal_wait_secs = 0.0
        # 免打扰 / 全屏闭嘴：这期间"提醒"攒着，结束后汇报（见 _say_reminder）
        self._quiet_until = 0.0          # 免打扰到什么时候（内部时钟秒；0 = 没开）
        self._held_lines = []            # 免打扰 / 全屏期间攒下来的提醒
        self._fs_now = False             # 前台现在是不是全屏（游戏 / 电影）
        self._fs_since = 0.0
        # 离开回来打招呼
        self._away_flag = False
        self._away_at = 0.0
        # 番茄钟删了（主人 2026-09-14：「番茄钟这个功能好鸡肋，删了」）：
        # 老 config.json 里可能还留着这两个键，顺手清掉，别让配置里躺着死键
        self.cfg.pop("pomo_work", None)
        self.cfg.pop("pomo_break", None)
        # 应用时长账本（今天每个应用用了多久，给"每日小结"用）
        self._app_day, self._app_book = load_app_time(APP_TIME_PATH)
        self._app_flush_at = time.time() + APP_TIME_FLUSH_S
        self._proc_lines_cache = None    # 「打开应用时冒泡」的合并台词表（改了就作废）
        self._lyric_key = ""             # 当前歌「歌名|歌手」
        self._lyric_lines = []           # [(秒, 词)]
        self._lyric_words = {}           # {这句开始秒: [(字, 这个字的开始秒), ...]}（有逐字歌词时才有）
        self._lyric_queue = []           # 后台线程找回来的歌词
        self._lyric_fetching = ""        # 正在找歌词的那首
        self._lyric_cache = load_lyric_cache()
        self._lyric_retry_at = 0.0       # 歌词没抓到时的重试时间
        self._music_pos_memo = {}        # 歌 → 上次放到哪（暂停/切走再回来接着走）
        self._music_gone_at = 0.0        # 媒体会话消失的时刻（网易云暂停可能整个会话都没了）
        self._music_paused_at = 0.0      # 最近一次"看到暂停"的时刻（气泡留着 3 分钟好点继续）
        self._music_cmd_busy = False     # 正在切播放/暂停/上下首（连着点只算一次）
        self._music_cmd_queue = []       # [(点的是哪颗, 成没成)]（后台线程 → 主线程）
        self._lyric_btn_rects = {}       # 歌词气泡右上角那几颗按钮的位置（{kind: QRectF}）
        self._lyric_btn_hover = None     # 鼠标正划在哪颗按钮上（None = 都没划）
        self._lyric_btn_pressed = None   # 正按着哪颗按钮
        self._press_on_lyric_btn = None  # 这一下按在按钮上（不是点桌宠），存的是哪一颗
        self._music_no_progress = False   # 这个播放器不报时间轴（网易云）→ 只显示歌名，不猜歌词
        self._lyric_nudge = 0.0          # 这首歌的歌词微调（秒，正数=歌词往前赶）
        self._lyric_nudges = {}          # 歌 → 微调值（每首歌记住自己的）
        self._lyric_shown = ""           # 现在气泡里显示的是哪一句
        self._lyric_prev = ""            # 上一句（换句动画用）
        self._lyric_anim_t = 0.0         # 换句动画进度（1 → 0）
        self._lyric_prev_h = 0.0         # 上一句时气泡多高（过渡期间高度平滑变化）
        self._lyric_last_h = 0.0         # 最近一次画出来的气泡高度
        self._lyric_prev_w = 0.0         # 上一句时气泡多宽（过渡期间宽度也平滑变化）
        self._lyric_last_w = 0.0         # 最近一次画出来的气泡宽度
        self._bub_w = 0.0                # 气泡当前（动画中）的宽
        self._bub_h = 0.0                # 气泡当前（动画中）的高
        self._bub_target = (0.0, 0.0)    # 目标宽高（每帧由绘制算出来）
        self._bub_t = None               # 上一帧的时间（用来按真实帧间隔推进动画）
        self._lyric_timer = QTimer(self)  # 过渡期间专用：100 帧/秒
        self._lyric_timer.setInterval(LYRIC_ANIM_MS)
        self._lyric_timer.timeout.connect(self._lyric_anim_step)
        self._lyric_timer.stop()

        # 菜单悬停兜底（见 _menu_hover_watch）
        self._hover_key = None
        self._hover_since = 0.0
        self._hover_subs = {}            # 我替它弹出来的子菜单 → {"at": 上次光标在里面的时间, "pos": 弹出位置}
        self._sub_parent = {}            # 子菜单 → (上一层菜单, 触发它的那一项)，补弹时要用
        self._sub_of = {}                # 带子菜单的项 → 它的子菜单（Qt 那边已摘掉，改由浮窗显示）
        self._leave_at = 0.0             # 光标离开"项/子菜单"的时间（0.35 秒宽限用）
        self._keep = None                # 当前保持打开的是哪一项的子菜单（菜单, 项）
        self._sub_rect = {}              # 各子菜单最后一次显示的位置/大小（被 Qt 收掉后判断"光标还在不在附近"）
        self._resub = {}                 # 各子菜单"被收掉后补了几次"的计数
        self._flyout = None              # 二级/三级菜单的浮窗（普通窗口，点击一定生效）
        self._flyout_action = None       # 当前浮窗对应的是哪一项
        self._flyout_leave_at = 0.0      # 光标离开浮窗的时间（用来延时收起）
        self._menu_pool = []             # 最近建过的菜单，用来判断"还有菜单开着吗"
        self._dialog_open = False        # 对话框（设置 Key / 加城市…）开着
        self._through_applied = None     # 上一次实际设过的鼠标穿透状态
        self._forwarding_move = False    # 正在给菜单转发鼠标移动（防递归）

        self._last_pos = (0, 0)          # 卡住自检用
        self._stuck_ticks = 0
        self.snap_on = bool(self.cfg.get("snap_on", True))
        self.flip_on_left = bool(self.cfg.get("flip_on_left", True))
        self.locked = bool(self.cfg.get("locked", False))    # 锁定位置：拖不动，但点击 / 菜单照常
        self.turn_cost_on = bool(self.cfg.get("turn_cost_on", True))
        self.bal_busy = False
        self.bal_error = ""
        self._bal_queue = []         # 后台线程 → 主线程的余额结果
        self._pending_bubbles = []   # [(到点秒, 文本, 是否心声)]
        self.roll_shown = None       # 数字滚动当前值
        self.roll_from = None
        self.roll_to = None
        self.roll_t = 1.0
        self.press_t = 0.0           # 按压 Q 弹
        self.flip_x = False          # 整体水平翻转（左吸附）
        self.snap_h = None           # 吸附锚点：left / right
        self.snap_v = None           # top / bottom
        self.ui_open = False         # 右键菜单 / 对话框开着时，桌宠站住不动

        # 音效
        self.sound_on = bool(self.cfg.get("sound_on", True))
        self.sound_set = self.cfg.get("sound_set", "小黄鸭")
        self.volume = float(self.cfg.get("volume", 0.9))
        self._sounds = {}
        self._sound_idx = {}
        self._pending_sounds = []
        self._click_clips = pick_click_clips()
        # 主人自己加的音效（文件放在用户目录的 sounds/ 下，路径记在 config.json 里）
        self._custom_sounds = {}
        for _s_name, _s_path in (self.cfg.get("custom_sounds") or {}).items():
            if _s_path and os.path.exists(_s_path):
                self._custom_sounds[_s_name] = _s_path
                self._click_clips[_s_name] = _s_path
        # 常开音频流（首选）：设备一直是醒的，点下去立刻出声、开头不会被吞
        self._click_player = None
        if AUDIO_AVAILABLE:
            player = ClickPlayer(self)
            if player.ok:
                for clip_name, clip_path in self._click_clips.items():
                    player.load_clip(clip_name, clip_path)
                self._click_player = player
            else:
                player.deleteLater()
        self._init_sounds()
        # 系统默认播放设备变了（插耳机 / 切蓝牙音箱）→ 重开音频流，点击音跟着走。
        # 注意：这个 PySide6 版本的 QMediaDevices 没有 defaultAudioOutputChanged 信号，
        # 所以干脆每 2 秒自己查一次（有信号的话也顺手接上）。
        self._audio_dev_id = None
        self._audio_dev_watched = False
        self._audio_dev_timer = QTimer(self)
        self._audio_dev_timer.timeout.connect(self._check_audio_device)
        self._audio_dev_timer.start(500)          # 兜底轮询：0.5 秒一次（原来 2 秒，插耳机要等太久）
        # 有信号就直接用信号：插耳机 / 切蓝牙音箱时 QMediaDevices 会立刻发 audioOutputsChanged
        try:
            self._devices = QMediaDevices(self)
            self._devices.audioOutputsChanged.connect(self._on_audio_output_changed)
        except Exception:
            self._devices = None
        QTimer.singleShot(1200, self._check_audio_device)

        # 后台线程 → 主线程的结果队列
        self._say_queue = []          # 要冒泡的文本
        self._city_queue = []         # 自动定位结果
        self._city_pick_queue = []    # 城市搜索候选
        self._app_queue = []          # 扫描到的本机应用列表
        self._mem_queue = []          # 内存回收结果（后台线程 → 主线程）
        self._mem_trimming = False    # 正在回收：连着点就只提醒一句
        self._mem_last = None         # (程序数, 腾出字节)：菜单里那行"上次…"

        # 每轮 Codex 对话消耗（读 Codex 会话日志的 token 用量）
        self.agent_name = (self.cfg.get("agent_name") or "Codex").strip() or "Codex"
        self.agent_dir = (self.cfg.get("agent_sessions_dir")
                          or self.cfg.get("codex_sessions_dir") or CODEX_SESSIONS_DIR)
        self.codex_dir = self.agent_dir
        self._codex_file = None
        self._codex_pos = 0
        self._codex_turn = None
        self._codex_tokens = {}
        self._codex_reported = set()
        self._codex_last_change = 0.0
        self.cdx_timer = QTimer(self)
        self.cdx_timer.timeout.connect(self.scan_codex_usage)
        self.cdx_timer.start(CODEX_SCAN_MS)

        # 有些窗口（比如 Codex）自己也置顶，会盖住桌宠：定期把自己顶到置顶层最前面（不抢焦点）
        self.top_timer = QTimer(self)
        self.top_timer.timeout.connect(self._keep_on_top)
        self.top_timer.start(2000)

        self.timer = QTimer(self)
        self.timer.timeout.connect(self.tick)
        self.timer.start(self.tick_ms)

        # 余额：60 秒自动刷新 + 启动后先取一次
        self.bal_timer = QTimer(self)
        self.bal_timer.timeout.connect(lambda: self.refresh_balance(silent=True))
        self.bal_timer.start(BALANCE_TTL * 1000)
        QTimer.singleShot(1200, lambda: self.refresh_balance(silent=False))

        # 跨屏保护：窗口中心所在屏幕；若跨屏/出界，1.5s 内整窗夹回该屏（防止只露一条边）
        self.screen_timer = QTimer(self)
        self.screen_timer.timeout.connect(self._ensure_on_screen)
        self.screen_timer.start(1500)

        self.bubble_font = QFont("Microsoft YaHei UI", 11)

        # 设置窗口：懒加载，点「打开设置…」才建，别拖慢启动
        self._console = None

        # 托盘
        self.tray = QSystemTrayIcon(self.icon, self)
        # 注意：QSystemTrayIcon 不接管菜单所有权，这里必须自己留引用，
        # 否则菜单会被 Python 回收，托盘右键就再也弹不出来了（穿透也因此解不开）。
        self._tray_menu = self._make_menu()
        self.tray.setContextMenu(self._tray_menu)
        self.tray.activated.connect(self._on_tray_activated)
        self.tray.show()

        x, y = self.cfg.get("x"), self.cfg.get("y")
        if x is None or y is None:
            screen = QApplication.primaryScreen().availableGeometry()
            x = screen.right() - self.width() - 80
            y = screen.bottom() - self.height() - 60
        self.move(int(x), int(y))
        self.show()
        self.snap_into_screen()
        QTimer.singleShot(1500, self.warm_up_sounds)   # 音频设备预热，消掉首次点击的延迟
        self.setWindowOpacity(self.opacity)
        QTimer.singleShot(300, self._apply_layer)       # 层级要在窗口真正显示之后再摆
        if self.cfg.get("passthrough", False):
            self._apply_passthrough(True)
            # 开机就是穿透状态的话，顺手提醒一下怎么解除
            QTimer.singleShot(2500, lambda: self.say(
                "我现在是穿透状态哦：右键托盘图标 → 鼠标穿透，或者双击托盘图标就能把我捞回来"))

        # 自定义形象的原图被删 / 被挪走了：启动时提醒一次（菜单和形象库里也会标出来）
        gone = []
        pet_now = self.pet_skin_entry()
        if pet_now:
            missing_pet = self.skin_missing_views("pet", pet_now)
            if missing_pet:
                gone.append("三维形象的" + "、".join(VIEW_SHORT[v] for v in missing_pet) + "那张")
        if self.custom_skin_missing("widget"):
            gone.append("挂件形象的那张")
        if gone:
            QTimer.singleShot(3400, lambda: self.say(
                f"{'、'.join(gone)}图找不到啦（被删掉或者挪走了）：右键 → 形象 → 我的形象库…",
                seconds=5.0))

        # 进程联动：打开某些应用时冒个泡
        self.proc_timer = QTimer(self)
        self.proc_timer.timeout.connect(self.check_processes)
        self.proc_timer.start(2000)

        # 全局快捷键：注册到主线程（按下时走 HotkeyBridge，见文件开头那个类）
        self._register_hotkeys()

        # 音乐联动：定时看一眼 QQ音乐 / 网易云 在放什么（读取在后台线程，不卡界面）
        self.music_timer = QTimer(self)
        self.music_timer.timeout.connect(self.poll_music)
        self.music_timer.start(MUSIC_POLL_MS)
        QTimer.singleShot(2600, self.poll_music)

        # 菜单悬停兜底：Windows 有时不把鼠标移动消息送给弹出菜单（二级菜单因此不弹）
        self.hover_timer = QTimer(self)
        self.hover_timer.timeout.connect(self._menu_tick)
        self.hover_timer.start(MENU_HOVER_MS)

    # ---------- 音乐联动 ----------
    def poll_music(self):
        """后台线程读一次系统媒体会话。"""
        if not self.music_on or self._music_busy:
            return
        self._music_busy = True
        use_smtc = smtc_available()

        def worker():
            info = read_media_session() if use_smtc else None
            if info is None or not info.get("title"):
                # 退路：读不到媒体会话、或者会话没给歌名时，看播放器窗口标题
                info = merge_media_info(info, read_music_window())
            self._music_queue.append(info)

        threading.Thread(target=worker, daemon=True).start()

    def _song_label(self, info=None):
        info = info if info is not None else (self.now_playing or {})
        # 播放器给的信息可能不全（网易云实测会缺）：缺什么就用占位，命名风格保持一致
        title = (info.get("title") or "").strip() or TITLE_PLACEHOLDER
        artist = (info.get("artist") or "").strip() or ARTIST_PLACEHOLDER
        return f"《{title}》——{artist}"

    @staticmethod
    def _app_label(info=None):
        """气泡顶上那个应用名。

        三级兜底：认出来的中文名 → 原始标识再认一次 → 把标识收拾成人能看的样子。
        只有连标识都没有时才会是「未知应用」。
        """
        info = info or {}
        name = (info.get("app") or "").strip()
        if name:
            return name
        raw = (info.get("app_id") or "").strip()
        return music_app_name(raw) or app_name_from_id(raw) or APP_PLACEHOLDER



    def music_command(self, kind):
        """气泡右上角那三颗按钮：⏮ 上一首 / ⏸▶ 播放暂停 / ⏭ 下一首。

        都走同一套系统媒体会话（SMTC），QQ音乐 / 网易云都认，点完由后台线程
        去问播放器，结果回到主线程再刷新气泡（图标才翻得过来）。
        """
        if kind not in ("prev", "toggle", "next"):
            return
        if not self.music_on or not self.now_playing:
            return
        if self._music_cmd_busy:
            return
        self._music_cmd_busy = True
        # 按一下晃晃尾巴，手感上有个回应（真结果等后台回来）
        self.action, self.action_t = "sway", 0.6
        threading.Thread(target=self._music_cmd_worker, args=(kind,),
                         daemon=True).start()

    def toggle_music_playpause(self):
        """气泡右上角那颗 ⏸ / ▶：切一下当前播放器的播放 / 暂停。"""
        self.music_command("toggle")






    def _word_times_for(self, start_sec):
        """这一句的逐字时间戳（没有就返回空）。"""
        table = getattr(self, "_lyric_words", None) or {}
        if not table:
            return []
        key = min(table, key=lambda k: abs(k - float(start_sec)))
        if abs(key - float(start_sec)) > 0.35:
            return []
        return table.get(key) or []

    def _current_lyric_pair(self):
        """按"当前进度 - 对时偏移"算出该显示的（这一句, 下一句）。"""
        return lyric_pair(self._lyric_lines, self._lyric_position())




    @staticmethod
    def _karaoke_split(rows, sung_total):
        """把"已唱到第几个字"摊到每一行上：返回每行已经唱到的字数。"""
        total = sum(len(r) for r in rows)
        if total <= 0:
            return [0] * len(rows)
        sung = int(round(max(0.0, min(float(total), float(sung_total)))))
        out, used = [], 0
        for r in rows:
            n = max(0, min(len(r), sung - used))
            out.append(n)
            used += len(r)
        return out



    def _setup_lyrics_for(self, key, info, cached):
        """按"这个播放器报不报时间轴"决定这首歌显不显示歌词。

        网易云实测 position / 总时长恒为 0（不报时间轴）→ 只显示"歌名 + 歌手"，
        不抓歌词也不猜进度，一直保持到切歌为止；QQ音乐正常报，就照常显示歌词。
        """
        text = (cached or {}).get("text") or ""
        if info.get("has_timeline") is False:
            self._music_no_progress = True
            self._lyric_lines = []
            self._lyric_words = {}
            menu_debug(f"[音乐] {info.get('app')} 不报时间轴 → 只显示歌名")
            return
        self._music_no_progress = False
        self._lyric_lines = parse_lrc(text) if text else []
        self._lyric_words = parse_word_lyrics(text) if text else {}
        stale = bool(text) and int(cached.get("v", 1)) < LYRIC_CACHE_VERSION
        if (not text or stale) and self.music_lyrics and not self._lyric_fetching:
            self._start_lyric_fetch(key, info)

    def _announce_song(self):
        """换歌时冒一句（别连着刷）。"""
        now = time.time()
        if now - self._music_said_at < 6.0:
            return
        words = self.lines_for_say("MUSIC_START_LINES")
        if not words:
            return                    # 「换歌时」这块关着：安静换歌，不插话
        self._music_said_at = now
        # 换歌这句是"自动冒的"：正在说触发类的话时排在它后面，别打断
        self._say_when_free(
            random.choice(words).format(song=self._song_label()))

    def _start_lyric_fetch(self, key, info):
        self._lyric_fetching = key

        def worker():
            lrc = fetch_lyrics(info.get("title", ""), info.get("artist", ""))
            self._lyric_queue.append((key, lrc))

        threading.Thread(target=worker, daemon=True).start()

    def _apply_lyric_result(self, key, lrc):
        self._lyric_fetching = ""
        if lrc:
            self._lyric_cache[key] = {"v": LYRIC_CACHE_VERSION, "text": lrc}
            save_lyric_cache(self._lyric_cache)
            if key == self._lyric_key:
                self._lyric_lines = parse_lrc(lrc)
                self._lyric_words = parse_word_lyrics(lrc)
                self.update()
        elif key == self._lyric_key:
            # 这次没抓到（网络抽风 / 这首歌没歌词）：**不要**把正在显示的歌词擦掉，
            # 过一会儿自己再试一次 —— 主人反馈过"歌词不显示，要切歌才恢复"。
            self._lyric_retry_at = time.time() + 15.0
            self.update()


    def check_music_now(self):
        """菜单「立刻看一眼在放什么」：马上刷新一次，并把结果直接冒出来。"""
        if not self.music_on:
            self.say("音乐联动没开哦，先勾上「放歌时看着」嘛", seconds=3.6, again=True)
            return
        self._music_manual = True
        self.poll_music()

    def _report_music_now(self, info):
        """把"立刻看一眼"的结果说出来：看得见 / 看不见，别让用户猜。"""
        if info and info.get("title"):
            tail = "" if info.get("playing") else "（现在是暂停的）"
            # 名字走同一套兜底（会话没给标识时也能认出 QQ音乐 / 网易云）
            self.say(f"♪ {self._app_label(info)} 正在放：{self._song_label(info)}{tail}",
                     seconds=4.0, again=True)
            return
        if not smtc_available():
            self.say("这台机器读不到系统媒体会话，只能看播放器窗口标题："
                     "把 QQ音乐 / 网易云 的窗口留在桌面上再试试", seconds=5.0, again=True)
            return
        self.say("没听见 QQ音乐 / 网易云 在放歌哦，先放一首试试嘛", seconds=4.0, again=True)

    # ---------- 余额 ----------
    def _api_key(self):
        """优先用配置里的 Key，其次用系统环境变量 DEEPSEEK_API_KEY。"""
        return (self.cfg.get("ds_api_key") or os.environ.get("DEEPSEEK_API_KEY", "") or "").strip()

    def _current_source(self):
        """当前余额来源 → (显示名, key)。"""
        name = self.cfg.get("balance_source") or "DeepSeek"
        if name != "DeepSeek":
            for item in (self.cfg.get("other_keys") or []):
                if item.get("name") == name:
                    return name, (item.get("key") or "").strip()
        return "DeepSeek", self._api_key()

    def refresh_balance(self, silent=True):
        """后台拉余额，结果丢进 _bal_queue 由主线程处理（Qt 界面只在主线程更新）。"""
        name, key = self._current_source()
        if not key:
            self.bal_error = f"未配置 {name} 的 Key"
            if not silent:
                self.say(f"先给 {name} 配个 Key 嘛～右键菜单里就有")
            return
        if self.bal_busy:
            return
        self.bal_busy = True

        def worker():
            low = name.lower()
            if low.startswith("deepseek"):
                res = query_deepseek_balance(key)
            elif "openrouter" in low:
                res = query_openrouter_balance(key)
            else:
                # OpenAI / ChatGPT 这类：官方没开放余额接口，如实告诉用户
                res = {"ok": False, "code": "NO_API",
                       "error": f"{name} 没有提供余额查询接口，看不到具体余额"}
            res["name"] = name
            res["silent"] = silent
            # 账本要认"这是不是同一个账号"：只存 Key 指纹，不存 Key 本身
            res["key_id"] = key_fingerprint(key)
            res["ts"] = time.time()
            self._bal_queue.append(res)

        threading.Thread(target=worker, daemon=True).start()


    def _start_roll(self, target):
        """余额变化时从旧值滚到新值。"""
        if self.roll_shown is None:
            self.roll_shown = float(target)
            self.roll_t = 1.0
            return
        if abs(float(target) - float(self.roll_shown)) < 1e-9:
            self.roll_t = 1.0
            return
        self.roll_from = float(self.roll_shown)
        self.roll_to = float(target)
        self.roll_t = 0.0

    def _display_amount(self):
        if self.balance is None:
            return 0.0
        if self.balance.get("total") is None:
            return 0.0
        if self.roll_shown is None or self.roll_t >= 1.0:
            return float(self.balance["total"])
        eased = 1 - (1 - self.roll_t) ** 3
        return self.roll_from + (self.roll_to - self.roll_from) * eased

    def show_balance_bubble(self, seconds=6.0, force=False):
        """把余额泡泡顶上来显示几秒。

        **触发类的话正在说的时候不抢**（余额每 60 秒自动刷一次，撞上就会把
        "用久了 / 到点 / 快捷键"那句顶掉）：先记着，等它说完再顶上来。
        主人自己点的那种（快速双击看一眼余额）传 force=True，直接顶。
        """
        if not force and self._trigger_speaking():
            self._bal_wait_until = self._trigger_until + 0.15
            self._bal_wait_secs = seconds
            return
        self._bal_wait_until = 0.0
        self.bal_until = self._secs() + seconds
        # 收起普通气泡，避免两层叠在一起
        self.bubble_text = ""
        self.bubble_until = 0.0
        self.update()


    def _trigger_speaking(self):
        """现在是不是"触发类"的话正在说（这段时间闲话让位，见 say）。"""
        return self._secs() < getattr(self, "_trigger_until", 0.0)

    # ---------- 免打扰 / 全屏：这段时间的"提醒"攒着 ----------
    def quiet_left(self):
        """免打扰还剩多少秒（0 = 没开）。"""
        return max(0, int(getattr(self, "_quiet_until", 0.0) - self._secs()))

    def _hold_now(self):
        """现在该不该闭嘴（免打扰中 / 前台是全屏游戏或电影）。"""
        return self.quiet_left() > 0 or bool(getattr(self, "_fs_now", False))


    def start_quiet(self, minutes=None):
        """免打扰：接下来这段时间不显示气泡，提醒暂存，结束后统一汇报。"""
        try:
            minutes = int(minutes or self.cfg.get("quiet_minutes") or QUIET_DEFAULT_MIN)
        except (TypeError, ValueError):
            minutes = QUIET_DEFAULT_MIN
        self.cfg["quiet_minutes"] = minutes
        self._quiet_until = self._secs() + max(1, minutes) * 60
        self._held_lines = []
        self.say(f"好嘛，我安静 {minutes} 分钟，有事我先攒着，绝对不吵你",
                 again=True, seconds=3.2)

    def stop_quiet(self, announce=True):
        """结束免打扰（时间到了也走这儿）：把攒下的提醒报一下。"""
        left = self.quiet_left()
        n = len(self._held_lines)
        last = self._held_lines[-1] if n else ""
        self._quiet_until = 0.0
        self._held_lines = []
        if not announce:
            return
        tail = (f"～刚才攒了 {n} 条提醒，最后一条是「{last}」" if n
                else "～我一句话都没吭哦")
        self.say(("我回来啦" if left <= 0 else "好啦，不憋着了") + tail,
                 again=True, seconds=4.5)

    def _hold_tick(self):
        """每秒看一眼：免打扰到点了没、前台是不是进/出全屏了。"""
        if self._quiet_until and self._secs() >= self._quiet_until:
            self.stop_quiet()
        if not self.cfg.get("fullscreen_silent", True):
            self._fs_now = False
            return
        full = foreground_is_fullscreen()
        if full and not self._fs_now:
            self._fs_now = True
            self._fs_since = self._secs()
        elif not full and self._fs_now:
            self._fs_now = False
            if self._secs() - getattr(self, "_fs_since", 0.0) >= FULLSCREEN_REPORT_MIN:
                n = len(self._held_lines)
                last = self._held_lines[-1] if n else ""
                self._held_lines = []
                if n:
                    self.say(f"退出来啦～刚才全屏那会儿攒了 {n} 条提醒，最后一条是「{last}」",
                             again=True, seconds=4.5)
            else:
                self._held_lines = []      # 只是切出去一下：攒的就不报了

    # ---------- 应用时长账本（给"每日小结"用）----------
    def _back_tick(self):
        """离开一阵子又回来：打个招呼（台词里可用 `{away}` 写离开了多久）。"""
        idle = idle_seconds()
        if idle is None:
            return
        if idle >= BACK_AWAY_SECONDS:
            if not self._away_flag:
                self._away_flag = True
                self._away_at = time.time()
            return
        if not self._away_flag or idle > 2.0:
            return
        self._away_flag = False
        away = max(0.0, time.time() - getattr(self, "_away_at", time.time()))
        if not self.cfg.get("back_greet", True) or self._hold_now():
            return
        lines = self.lines_for_say("BACK_LINES")
        if not lines:
            return                    # 「离开 / 返回时」这块关着：回来也不吭声
        self.say(fill_vars(random.choice(lines), away=fmt_duration(away)),
                 again=True, seconds=3.2)

    def _app_time_add(self, exe, seconds, now=None):
        """把这个应用今天用的时间累加上去（每 60 秒落一次盘，别一直写文件）。"""
        if not exe or seconds <= 0:
            return
        today = datetime.now().strftime("%Y-%m-%d")
        if today != self._app_day:          # 跨天了：重开一本
            self._app_day, self._app_book = today, {}
        self._app_book[exe] = self._app_book.get(exe, 0.0) + seconds
        stamp = time.time() if now is None else now
        if stamp >= self._app_flush_at:
            self._app_flush_at = stamp + APP_TIME_FLUSH_S
            save_app_time(APP_TIME_PATH, self._app_day, self._app_book)

    def app_time_flush(self):
        save_app_time(APP_TIME_PATH, self._app_day, self._app_book)

    def app_time_top(self, limit=SUMMARY_MAX_APPS):
        """今天用得最久的几个应用（至少 SUMMARY_MIN_SECONDS 才点名）。"""
        items = [(exe, secs) for exe, secs in (self._app_book or {}).items()
                 if secs >= SUMMARY_MIN_SECONDS]
        items.sort(key=lambda item: item[1], reverse=True)
        return [(self.app_label(exe), secs) for exe, secs in items[:limit]]

    @staticmethod
    def app_label(exe):
        """exe 名 → 人看得懂的名字。"""
        exe = (exe or "").lower()
        if exe in APP_LABELS:
            return APP_LABELS[exe]
        return (exe[:-4] if exe.endswith(".exe") else exe) or "?"

    def daily_summary(self):
        """今天的小结：余额用量（**没配 Key 就不提余额**）+ 用得最久的一两个应用。"""
        parts = []
        _name, key = self._current_source()
        if key:                             # 没配 API Key 就不报余额（主人指定的）
            used = read_today_usage(USAGE_PATH)
            if used > 0:
                symbol = currency_symbol(self.balance.get("currency")) if self.balance else ""
                parts.append(f"余额用了 {symbol}{used:.2f}")
        top = self.app_time_top()
        if top:
            parts.append("、".join(f"{label} {fmt_duration(secs)}" for label, secs in top))
        return ("今天：" + " · ".join(parts)) if parts else ""


    # ---------- 音效 / 形象 ----------
    @staticmethod
    def _crop_alpha(pix):
        """裁掉四周全透明空白（逐行扫描 alpha，避免逐像素 Python 调用）。"""
        img = pix.toImage().convertToFormat(QImage.Format.Format_ARGB32)
        w, h = img.width(), img.height()
        data = bytes(img.constBits())
        bpl = img.bytesPerLine()
        minx, miny, maxx, maxy = w, h, -1, -1
        for y in range(h):
            alphas = data[y * bpl: y * bpl + w * 4][3::4]
            if max(alphas) <= 8:
                continue
            x = 0
            while alphas[x] <= 8:
                x += 1
            x2 = w - 1
            while alphas[x2] <= 8:
                x2 -= 1
            minx, maxx = min(minx, x), max(maxx, x2)
            miny, maxy = min(miny, y), y
        if maxx < 0:
            return pix
        return pix.copy(minx, miny, maxx - minx + 1, maxy - miny + 1)

    def _init_sounds(self):
        """为每套音效准备多个播放实例。

        一次点击只播一声完整音效，不再区分按压/松手；多实例是为了连点时互不打断；
        没解码好的实例会先登记，等 Ready 立刻补播（避免「点了没声音」）。
        """
        if not AUDIO_AVAILABLE:
            return
        for name, clip in self._click_clips.items():
            url = QUrl.fromLocalFile(clip)
            instances = []
            for _ in range(SOUND_POOL):
                eff = QSoundEffect(self)
                eff.setSource(url)
                eff.setVolume(self.volume)
                instances.append(eff)
            self._sounds[name] = instances

    def play_click(self):
        """点一下播一声完整音效；池里轮着用，连点就按点击间隔自然响。"""
        if not self.sound_on:
            return
        if self.sound_set in self._click_clips:
            name = self.sound_set
        else:
            name = "小黄鸭"
        if self._click_player and self._click_player.has_clip(name):
            self._click_player.volume = self.volume
            self._click_player.play(name)
            return
        pool = self._sounds.get(name)
        if not pool:
            self._play_fallback_click()
            return
        idx = self._sound_idx.get(name, 0)
        eff = pool[idx % len(pool)]
        self._sound_idx[name] = (idx + 1) % len(pool)
        if eff.source().isEmpty():
            return
        try:
            eff.setVolume(self.volume)
            if eff.status() == QSoundEffect.Status.Ready:
                eff.play()
            else:
                # 还没解码好：先记下，等 Ready 立刻补播（比直接丢音好）
                self._pending_sounds.append((eff, time.time()))
        except Exception:
            pass

    def _flush_pending_sounds(self):
        if not self._pending_sounds:
            return
        now = time.time()
        keep = []
        for eff, ts in self._pending_sounds:
            if eff.status() == QSoundEffect.Status.Ready:
                try:
                    eff.setVolume(self.volume)
                    eff.play()
                except Exception:
                    pass
            elif now - ts < 1.5:      # 太久了就别补了，免得突然冒出来
                keep.append((eff, ts))
        self._pending_sounds = keep

    def warm_up_sounds(self):
        """启动后把音频设备先唤醒（0 音量静音放一遍），消掉第一次点击的延迟。"""
        if self._click_player:
            return                      # 常开流本来就在跑，不用预热
        for instances in self._sounds.values():
            for eff in instances:
                if eff.status() != QSoundEffect.Status.Ready:
                    continue
                try:
                    eff.setVolume(0.0)
                    eff.play()
                except Exception:
                    pass
        QTimer.singleShot(600, self._restore_sound_volume)

    def _restore_sound_volume(self):
        for instances in self._sounds.values():
            for eff in instances:
                eff.setVolume(self.volume)

    def preview_sounds(self):
        """试听当前这套点击音效。"""
        self.play_click()

    def _on_audio_output_changed(self, _device=None):
        """系统默认播放设备变了 → 缓一小拍就重开音频流（设备刚切换时马上开会失败）。

        主人反馈"插耳机要等近 2 秒才切过去"——那是 2 秒轮询的锅；现在有信号就立刻走这条，
        再留 0.5 秒轮询兜底（有些设备不触发信号）。
        """
        QTimer.singleShot(150, self._rebuild_audio_output)

    def _check_audio_device(self):
        """每 2 秒看一眼系统默认输出设备是不是换了；换了就把点击音切过去。"""
        try:
            dev = QMediaDevices.defaultAudioOutput()
            dev_id = bytes(dev.id()) if dev is not None and not dev.isNull() else b""
        except Exception:
            return
        if dev_id == self._audio_dev_id:
            return
        self._audio_dev_id = dev_id
        if not self._audio_dev_watched:          # 第一次只是记下来，不用重开
            self._audio_dev_watched = True
            return
        self._rebuild_audio_output()

    def _rebuild_audio_output(self):
        """把点击音切到当前默认输出设备上（插耳机后声音跟着进耳机）。"""
        if self._click_player is not None:
            ok = self._click_player.rebuild_output()
            menu_debug(f"[音频] 默认输出设备变了 → 重开音频流，成功={ok}")
            if not self._click_player.ok:
                # 新设备可能还没就绪：隔一小会儿再试两次，别直接退回 QSoundEffect 池
                tries = getattr(self, "_audio_retry", 0) + 1
                self._audio_retry = tries
                if tries <= 3:
                    QTimer.singleShot(400, self._rebuild_audio_output)
                else:
                    self._audio_retry = 0
                    self._click_player = None      # 实在开不了：退回 QSoundEffect 池
                    self._init_sounds()
            else:
                self._audio_retry = 0
        else:
            self._init_sounds()

    def _play_fallback_click(self):
        """Qt 音频不可用时的兜底：用系统 winsound 异步播 wav（没有音量控制）。"""
        try:
            import winsound
            name = self.sound_set if self.sound_set in self._click_clips else "小黄鸭"
            path = self._click_clips.get(name)
            if path and os.path.exists(path):
                winsound.PlaySound(path, winsound.SND_FILENAME | winsound.SND_ASYNC
                                   | winsound.SND_NODEFAULT)
        except Exception:
            pass

    def set_sound(self, on):
        self.sound_on = bool(on)
        self.cfg["sound_on"] = bool(on)

    def set_sound_set(self, name):
        if name not in self._sound_names():
            return
        self.sound_set = name
        self.cfg["sound_set"] = name
        self.play_click()          # 换音效顺手试听一声

    # ---------- 自己加音效 ----------
    def _sound_names(self):
        """可选音效名单：内置两套 + 主人自己加的（自己加的排在后面）。"""
        extra = [n for n in getattr(self, "_custom_sounds", {}) if n not in SOUND_SETS]
        return list(SOUND_SETS) + extra

    def _register_sound(self, name, path):
        """把一个已经转好格式的 wav 注册成可选音效（立刻生效，不用重启）。"""
        if not hasattr(self, "_custom_sounds"):
            self._custom_sounds = {}
        self._click_clips[name] = path
        self._custom_sounds[name] = path
        self.cfg.setdefault("custom_sounds", {})[name] = path
        if self._click_player is not None:
            try:
                self._click_player.load_clip(name, path)
            except Exception:
                pass
        if AUDIO_AVAILABLE:
            try:
                url = QUrl.fromLocalFile(path)
                pool = []
                for _ in range(SOUND_POOL):
                    eff = QSoundEffect(self)
                    eff.setSource(url)
                    eff.setVolume(self.volume)
                    pool.append(eff)
                self._sounds[name] = pool
            except Exception:
                pass
        self.save_config()

    def _add_sound_from_path(self, src, name=None, max_seconds=None):
        """把主人的音频转格式、存进 sounds/、注册成音效。返回 (名字, 真实秒数, 处理说明)。"""
        base = (name or os.path.splitext(os.path.basename(src))[0] or "我的音效").strip()[:16]
        base = base or "我的音效"
        if base in SOUND_SETS:                 # 别和内置的重名
            base += "（我的）"
        dest = os.path.join(SOUND_USER_DIR, base + ".wav")
        secs, note = make_click_wav(src, dest, max_seconds=max_seconds)
        self._register_sound(base, dest)
        return base, secs, note

    def add_custom_sound_dialog(self):
        """挑一个自己的音频当点击音：会自动转成"单声道 44.1k"，太长还会问你要不要裁。"""
        with self._ui_guard():
            path, _ = QFileDialog.getOpenFileName(
                self, "挑一个音效文件（wav）", "", "WAV 音频 (*.wav);;所有文件 (*)")
        if not path:
            return
        if not path.lower().endswith(".wav"):
            with self._ui_guard():
                QMessageBox.information(
                    self, "要 wav 格式",
                    "点击音现在只吃 wav 格式。\n\n" + SOUND_TIP +
                    "\n\n可以先用任意工具把它转成 WAV（16 位最好）再选一次。")
            return
        secs = wav_seconds(path)
        keep = None
        if secs and secs > SOUND_IDEAL[1] + 0.2:
            with self._ui_guard():
                btn = QMessageBox.question(
                    self, "这个有点长",
                    f"这个音效 {secs:.2f} 秒。\n\n{SOUND_TIP}\n\n"
                    f"要我帮你裁到 {SOUND_KEEP_MAX:.2f} 秒吗（只保留开头）？",
                    QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
                    | QMessageBox.StandardButton.Cancel)
            if btn == QMessageBox.StandardButton.Cancel:
                return
            if btn == QMessageBox.StandardButton.Yes:
                keep = SOUND_KEEP_MAX
        elif secs and secs < SOUND_IDEAL[0]:
            with self._ui_guard():
                ok = QMessageBox.question(
                    self, "这个有点短",
                    f"这个音效只有 {secs:.2f} 秒，可能听不清。\n\n{SOUND_TIP}\n\n还是要用吗？",
                    QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No)
            if ok != QMessageBox.StandardButton.Yes:
                return
        try:
            name, real, note = self._add_sound_from_path(path, max_seconds=keep)
        except Exception as exc:
            with self._ui_guard():
                QMessageBox.warning(
                    self, "这个文件我处理不了",
                    f"{exc}\n\n{SOUND_TIP}\n\n建议先转成 WAV（16 位、44100Hz）再试。")
            return
        self.set_sound_set(name)               # 切过去，顺手试听一声
        fit = "正好在建议区间里" if SOUND_IDEAL[0] <= real <= SOUND_IDEAL[1] else "不在建议区间里，觉得别扭就再换一个"
        self.say(f"换上「{name}」啦：{real:.2f} 秒，{fit}" + (f"（{note}）" if note else ""))

    def remove_custom_sound_dialog(self):
        """删掉自己加的音效（内置两套动不了）。"""
        names = list(getattr(self, "_custom_sounds", {}))
        if not names:
            self.say("你还没加过自己的音效呢")
            return
        with self._ui_guard():
            pick, ok = QInputDialog.getItem(
                self, "删掉我加的音效", "选一个删掉（内置的动不了）：", names, 0, False,
                Qt.WindowType.WindowStaysOnTopHint)
        if not ok or not pick:
            return
        self._remove_sound(pick)
        self.say(f"「{pick}」删掉了")
        self.play_click()

    def _remove_sound(self, pick):
        """真正把某个自定义音效删掉（对话框和测试都走这里）。"""
        path = self._custom_sounds.pop(pick, None)
        self._click_clips.pop(pick, None)
        self._sounds.pop(pick, None)
        try:
            (self.cfg.get("custom_sounds") or {}).pop(pick, None)
        except Exception:
            pass
        if path:
            try:
                os.remove(path)
            except Exception:
                pass
        if self.sound_set == pick:
            self.sound_set = "小黄鸭"
            self.cfg["sound_set"] = "小黄鸭"
        self.save_config()

    def set_volume(self, vol):
        self.volume = max(0.0, min(1.0, float(vol)))
        self.cfg["volume"] = self.volume
        if self._click_player:
            self._click_player.volume = self.volume
        self._restore_sound_volume()

    # ---------- 形象加载 / 我的形象库（两本：三维形象 / 挂件形象）----------
    @staticmethod
    def _new_skin_id(*parts):
        """形象编号：按原图路径算，同一个文件永远同一个号（老配置迁移时也用这个）。"""
        key = "|".join(str(p) for p in parts if p)
        return "sk" + hashlib.md5(key.encode("utf-8", "ignore")).hexdigest()[:10]

    def skin_library(self, kind=None):
        """我的形象库，存在 config.json → skin_library，**两本分开**：

        {"pet": [三维形象…], "widget": [挂件形象…]}

        三维形象 = {"id","name","front","side","back","added"}（正面/侧面/背面三张齐了才算一条）；
        挂件形象 = {"id","name","path","added"}。存的都是**原图在硬盘上的位置**，
        桌宠只记路径、不搬文件 —— 所以原图不能删、不能挪（挪了就在库里标"文件找不到了"）。
        kind 给 "pet" / "widget" 就只返回那一本；不给就两本一起返回。
        """
        raw = self.cfg.get("skin_library")
        raw = raw if isinstance(raw, dict) else {}
        out = {}
        for name, keys in (("pet", PET_SLOTS), ("widget", ("path",))):
            out[name], seen = [], set()
            for item in (raw.get(name) or []):
                if not isinstance(item, dict):
                    continue
                paths = [(k, str(item.get(k) or "").strip()) for k in keys]
                if not any(p for _k, p in paths):
                    continue
                sid = str(item.get("id") or "").strip() or self._new_skin_id(
                    *[p for _k, p in paths])
                if sid in seen:                      # 同一个号只留一条
                    continue
                seen.add(sid)
                ent = {"id": sid, "name": str(item.get("name") or "").strip(),
                       "added": str(item.get("added") or "").strip()}
                for key, path in paths:
                    ent[key] = path
                if not ent["name"]:                  # 老数据没名字就用文件名顶上
                    ent["name"] = (os.path.splitext(
                        os.path.basename(ent[keys[0]] or ""))[0] or "我的形象")
                out[name].append(ent)
        return out.get(kind) if kind in out else out

    def _save_skin_library(self, kind, entries):
        lib = self.cfg.get("skin_library")
        lib = dict(lib) if isinstance(lib, dict) else {}
        lib[kind] = [dict(it) for it in entries]
        self.cfg["skin_library"] = lib
        self.save_config()

    def skin_entry(self, kind, ref):
        """按编号（或老配置里直接存的图片路径）找出库里的这一条。"""
        ref = str(ref or "").strip()
        if not ref:
            return None
        for it in self.skin_library(kind):
            if it["id"] == ref:
                return it
        if kind == "widget" and (os.path.isabs(ref) or os.sep in ref or "/" in ref):
            return {"id": self._new_skin_id(ref), "added": "",
                    "name": os.path.splitext(os.path.basename(ref))[0] or "我的形象",
                    "path": ref}
        return None

    def _current_skin_ref(self, kind):
        """现在登记用的是哪一条（三维 / 挂件各自的编号）。"""
        return str((self.cfg.get("custom_skins") or {}).get(kind) or "").strip()

    def pet_skin_entry(self):
        """现在用的三维形象（没自定义过就是 None）。"""
        return self.skin_entry("pet", self._current_skin_ref("pet"))

    def widget_skin_entry(self):
        """现在用的挂件形象（没自定义过就是 None）。"""
        return self.skin_entry("widget", self._current_skin_ref("widget"))

    def skin_view_path(self, kind, ent, view):
        """这条形象里某个视图的原图路径（三维是 front/side/back，挂件是 widget）。"""
        if not ent:
            return ""
        return str(ent.get("path" if view == "widget" else view) or "")

    def _custom_path(self, view):
        """该视图用户自定义的图片路径（没登记 / 文件不在了就返回空）。"""
        kind = "widget" if view == "widget" else "pet"
        ent = self.widget_skin_entry() if kind == "widget" else self.pet_skin_entry()
        path = self.skin_view_path(kind, ent, view)
        return path if path and os.path.exists(path) else ""

    def skin_missing_views(self, kind, ent):
        """这条形象里哪几张图现在找不到了（被删 / 改名 / 挪走）。"""
        keys = PET_SLOTS if kind == "pet" else ("widget",)
        return [v for v in keys
                if not self.skin_view_path(kind, ent, v)
                or not os.path.exists(self.skin_view_path(kind, ent, v))]

    def custom_skin_missing(self, view):
        """这个视图现在登记的那张图是不是找不到了。"""
        kind = "widget" if view == "widget" else "pet"
        ent = self.widget_skin_entry() if kind == "widget" else self.pet_skin_entry()
        return bool(ent) and view in self.skin_missing_views(kind, ent)

    def skin_in_use(self, kind, sid):
        """这条形象是不是"现在正用着"的那条。"""
        return bool(sid) and self._current_skin_ref(kind) == str(sid).strip()

    def skin_thumb_path(self, kind, ent):
        """列表 / 预览拿哪张当门面：三维默认**正面**那张（正面缺了才顺延），挂件就是它自己。"""
        if not ent:
            return ""
        keys = PET_SLOTS if kind == "pet" else ("widget",)
        first = ""
        for view in keys:
            path = self.skin_view_path(kind, ent, view)
            if not path:
                continue
            first = first or path
            if os.path.exists(path):
                return path
        return first

    def _make_skin(self, kind, name, **paths):
        """拼一条形象（三维：front/side/back；挂件：path），编号按路径算。"""
        keys = PET_SLOTS if kind == "pet" else ("path",)
        ent = {"id": self._new_skin_id(*[paths.get(k, "") for k in keys]),
               "name": (name or "").strip()[:24] or "我的形象",
               "added": datetime.now().strftime("%Y-%m-%d %H:%M")}
        for key in keys:
            ent[key] = str(paths.get(key) or "")
        return ent

    def add_pet_skin(self, name, front, side, back):
        """收一个三维形象（三张齐了才收录；同样的三张图再收一次 = 只换名字）。"""
        ent = self._make_skin("pet", name, front=front, side=side, back=back)
        lib = [it for it in self.skin_library("pet") if it["id"] != ent["id"]]
        lib.append(ent)
        self._save_skin_library("pet", lib)
        return ent

    def add_widget_skin(self, name, path):
        """收一个挂件形象（单张图）。"""
        ent = self._make_skin("widget", name, path=path)
        lib = [it for it in self.skin_library("widget") if it["id"] != ent["id"]]
        lib.append(ent)
        self._save_skin_library("widget", lib)
        return ent

    def update_skin(self, kind, sid, name, **paths):
        """改名字 / 换图：**编号不变**，所以已经用着它的地方不用重挑。"""
        keys = PET_SLOTS if kind == "pet" else ("path",)
        ent = {"id": str(sid), "name": (name or "").strip()[:24] or "我的形象", "added": ""}
        for key in keys:
            ent[key] = str(paths.get(key) or "")
        for old in self.skin_library(kind):
            if old["id"] == sid:
                ent["added"] = old["added"]
        lib = [it for it in self.skin_library(kind) if it["id"] != sid] + [ent]
        self._save_skin_library(kind, lib)
        return ent

    def _refresh_skins(self):
        """换完图 / 换完形象：重新加载精灵、按当前档位缩放、写回配置。"""
        self._rebuild_sprites()
        self.set_size(self.cfg.get("size", SIZE_DEFAULT))
        self.save_config()

    def _migrate_skin_library(self):
        """老配置升级：以前是"一个视图一张图"，现在分成三维 / 挂件两本库。

        - 挂在挂件上的那张 → 挂件形象库；
        - 正面 / 侧面 / 背面**三张都有** → 收成一个三维形象（名字取正面那张的名字）；
        - 只挑过一两张 → 记成"还没挑完的三维形象"（skin_draft），下次点上传接着挑，
          不硬凑一个形象出来（主人要求：三张齐了才算一个形象）；
        - 老库里没被任何视图用过的图 → 兜底放进挂件库（单张语义最稳妥）。
        """
        raw = self.cfg.get("skin_library")
        if isinstance(raw, dict):                    # 已经是新格式：只补齐缺的那本
            fixed = dict(raw)
            for kind in ("pet", "widget"):
                if not isinstance(fixed.get(kind), list):
                    fixed[kind] = []
            if fixed != raw:
                self.cfg["skin_library"] = fixed
                self.save_config()
            return
        old = []
        for item in (raw if isinstance(raw, list) else []):
            if isinstance(item, dict) and str(item.get("path") or "").strip():
                path = str(item["path"]).strip()
                old.append((str(item.get("id") or "").strip() or self._new_skin_id(path),
                            str(item.get("name") or "").strip(), path))
        by_id = {i: (n, p) for i, n, p in old}
        by_path = {os.path.normcase(p): (i, n, p) for i, n, p in old}
        skins = dict(self.cfg.get("custom_skins") or {})

        def resolve(ref):
            """老登记值（库编号 或 图片路径）→ (名字, 路径)。"""
            ref = str(ref or "").strip()
            if not ref:
                return None
            if ref in by_id:
                return by_id[ref][0], by_id[ref][1]
            if os.path.isabs(ref) or os.sep in ref or "/" in ref:
                hit = by_path.get(os.path.normcase(ref))
                if hit:
                    return hit[1], hit[2]
                return os.path.splitext(os.path.basename(ref))[0], ref
            return None

        pet_paths, widget_paths = {}, {}
        for view in tuple(PET_SLOTS) + ("widget",):
            got = resolve(skins.get(view))
            if got:
                (widget_paths if view == "widget" else pet_paths)[view] = got
        pet_lib, widget_lib = [], []
        for _view, (name, path) in widget_paths.items():
            widget_lib.append(self._make_skin("widget", name, path=path))
        pet_ent = None
        if len(pet_paths) == len(PET_SLOTS):         # 三张齐了才算一个三维形象
            pet_ent = self._make_skin(
                "pet", pet_paths.get("front", ("", ""))[0] or "我的三维形象",
                **{v: pet_paths[v][1] for v in PET_SLOTS})
            pet_lib.append(pet_ent)
        elif pet_paths:                              # 没齐：存成"还没挑完"
            draft = {"name": pet_paths.get("front", ("", ""))[0]}
            draft.update({v: pet_paths[v][1] for v in pet_paths})
            self.cfg["skin_draft"] = draft
        used = {os.path.normcase(p) for _n, p in pet_paths.values()}
        used |= {os.path.normcase(it["path"]) for it in widget_lib}
        for _sid, name, path in old:                 # 老库里没人用的图 → 挂件库兜底
            if os.path.normcase(path) not in used:
                used.add(os.path.normcase(path))
                widget_lib.append(self._make_skin("widget", name, path=path))
        new_skins = {}
        if pet_ent:
            new_skins["pet"] = pet_ent["id"]
        if widget_lib:
            new_skins["widget"] = widget_lib[0]["id"]
        self.cfg["skin_library"] = {"pet": pet_lib, "widget": widget_lib}
        self.cfg["custom_skins"] = new_skins
        self.save_config()

    def _dialog_guard(self, parent=None):
        """进窗口时让桌宠站住不动；父窗口已经是我们的对话框时不用再套一层。"""
        return self._ui_guard() if parent is None else contextlib.nullcontext()

    def _warn(self, parent, title, text):
        """警告窗口（QMessageBox 的静态方法不认"置顶"标志，只能自己搭一个）。"""
        box = QMessageBox(parent or self)
        box.setIcon(QMessageBox.Icon.Warning)
        box.setWindowTitle(title)
        box.setText(text)
        box.setWindowFlag(Qt.WindowType.WindowStaysOnTopHint, True)
        with self._dialog_guard(parent):
            box.exec()

    def _has_sprite(self, key):
        return any(k[0] == key for k in self.sprites)

    def _load_view_pixmap(self, view, h):
        """加载某个视图的某个高度：优先用户自定义图片，其次自带素材。

        注：无级调节会一路拖出几十个不同的高度，所以"原图（裁掉透明边）"走 `_view_base`
        的缓存，每次只是从缓存缩放到目标高度 —— 不用反复读盘、反复裁边。
        """
        custom = self._custom_path(view)
        if custom:
            base = self._view_base(custom)
            if base is not None and not base.isNull():
                self.custom_skin_ok[view] = True
                return base.scaledToHeight(h, Qt.TransformationMode.SmoothTransformation)
        self.custom_skin_ok[view] = False
        if view == "widget":
            base = self._view_base(os.path.join(ASSET_DIR, WIDGET_SKIN_FILE))
            return None if base is None else base.scaledToHeight(
                h, Qt.TransformationMode.SmoothTransformation)
        name = SPRITE_VIEWS[view]
        # 自带素材正好有这个高度的现成文件（原来那五档就是）→ 直接用，省一次缩放
        sized = os.path.join(SPRITE_DIR, f"{name}_{h}.png")
        if os.path.exists(sized):
            return QPixmap(sized)
        full = os.path.join(SPRITE_DIR, f"{name}.png")
        base = self._view_base(full)
        if base is None:
            return None
        return base.scaledToHeight(h, Qt.TransformationMode.SmoothTransformation)

    def _view_base(self, path):
        """某个视图"原图裁掉透明边"之后的那份，按「路径 + 修改时间」缓存。

        换过图（或者把原图改名换回来）时，修改时间一变缓存自然失效，不用手工清。
        """
        try:
            stamp = os.path.getmtime(path)
        except OSError:
            return None
        key = (path, stamp)
        base = self._base_cache.get(key)
        if base is None:
            raw = QPixmap(path)
            if raw.isNull():
                return None
            base = self._crop_alpha(raw)
            if len(self._base_cache) >= 8:      # 撑死了几 MB，超了就整批丢掉重来
                self._base_cache.clear()
            self._base_cache[key] = base
        return base

    def _rebuild_sprites(self):
        """重新加载各尺寸精灵（换了自定义图片后调用）。

        除了五档标准高度，**当前高度也要建**：v1.0.18 起大小能无级调（比如 40%），
        那不是五档里的任何一档；漏了它，换完形象在当前高度上就没图可画。
        """
        heights = [int(340 * mult) for mult in SIZE_LEVELS.values()]
        cur = getattr(self, "cur_h", None)
        if cur:
            heights.append(int(cur))
        self.sprites = {}
        for h in heights:
            for view, key in VIEW_SHORT.items():
                pix = self._load_view_pixmap(view, h)
                if pix is not None and not pix.isNull():
                    self.sprites[(key, h)] = pix
        self.widget_skin_ok = self._has_sprite("挂件")

    def _clamp_size(self, mult):
        """把大小倍率收进允许范围（上限 = 用户偏好 maxSize，默认 0.35）。"""
        try:
            mult = float(mult)
        except (TypeError, ValueError):
            mult = SIZE_DEFAULT
        _hi = getattr(self, "max_size", SIZE_MAX_DEFAULT)
        return max(SIZE_MIN, min(_hi, mult))

    def _ensure_sprites(self, h):
        """把某个高度的精灵补进 self.sprites（已经有了就跳过）。

        无级调节会用到五档以外的高度，这里现补：只缩放缓存好的原图，很快。
        """
        h = int(h)
        for view, key in VIEW_SHORT.items():
            if (key, h) not in self.sprites:
                pix = self._load_view_pixmap(view, h)
                if pix is not None and not pix.isNull():
                    self.sprites[(key, h)] = pix
        self.widget_skin_ok = self._has_sprite("挂件")

    def _prune_sprites(self, keep_h):
        """只留五档 + 当前高度：无级调节一路拖过去会产生几十个高度，
        不清理的话它们会一直占着内存。
        """
        keep = {int(340 * m) for m in SIZE_LEVELS.values()} | {int(keep_h)}
        for key in [k for k in self.sprites if k[1] not in keep]:
            del self.sprites[key]

    def _skin_pick_dir(self):
        """上次挑图的那个文件夹（没有就用"图片"文件夹）。"""
        start = str(self.cfg.get("skin_pick_dir") or "")
        if start and os.path.isdir(start):
            return start
        pics = os.path.join(os.path.expanduser("~"), "Pictures")
        return pics if os.path.isdir(pics) else os.path.expanduser("~")

    def upload_skin(self, kind, parent=None):
        """上传一个新形象：三维挑三张（齐了才收录）、挂件挑一张。"""
        prefill = self.cfg.get("skin_draft") if kind == "pet" else None
        if not isinstance(prefill, dict):
            prefill = None
        return self._skin_edit(kind, None, prefill, parent)

    def edit_skin(self, kind, sid, parent=None):
        """改一个已经收录的形象（换其中几张图 / 改回原来那张）。"""
        ent = self.skin_entry(kind, sid)
        return self._skin_edit(kind, ent, None, parent) if ent else None

    def _skin_edit(self, kind, entry, prefill=None, parent=None):
        """上传 / 编辑窗口的公共路子：挑图 → 起名字 → 收录或更新 → 换上。"""
        dlg = SkinEditDialog(self, kind, entry=entry, prefill=prefill)
        with self._dialog_guard(parent):
            ok = dlg.exec()
        if not ok or not dlg.result_data:
            if kind == "pet" and entry is None:
                # 半途取消：已经挑好的几张记下来，下次点上传接着挑（不白挑）
                picked = {v: p for v, p in dlg.slots.items() if p}
                if picked:
                    self.cfg["skin_draft"] = dict(picked, name=dlg.name_edit.text().strip())
                else:
                    self.cfg.pop("skin_draft", None)
                self.save_config()
            return None
        res = dlg.result_data
        paths = res["paths"]
        if kind == "pet":
            ent = (self.update_skin("pet", entry["id"], res["name"], **paths) if entry
                   else self.add_pet_skin(res["name"], paths["front"], paths["side"], paths["back"]))
        else:
            ent = (self.update_skin("widget", entry["id"], res["name"], path=paths["widget"])
                   if entry else self.add_widget_skin(res["name"], paths["widget"]))
        self.cfg.pop("skin_draft", None)
        if entry is None or self.skin_in_use(kind, ent["id"]):
            self.apply_skin(kind, ent["id"], parent=parent, fresh=entry is None)
        else:
            self._refresh_skins()
        return ent

    def apply_skin(self, kind, sid, parent=None, fresh=False):
        """换上一个形象：三维整套换上（顺手切到「大肥鱼」），挂件切到「小鲸鱼挂件」。"""
        ent = self.skin_entry(kind, sid)
        if not ent:
            return False
        missing = self.skin_missing_views(kind, ent)
        if missing:
            self._warn(parent, "这张图找不到了" if len(missing) == 1 else "这几张图找不到了",
                       f"「{ent['name']}」的" + "、".join(VIEW_SHORT[v] for v in missing)
                       + "那张图在硬盘上找不到了：\n"
                       + "\n".join(self.skin_view_path(kind, ent, v) for v in missing)
                       + "\n\n多半是被删掉、改名、或者挪到别的文件夹了。\n"
                       "把文件放回原来的位置就行；也可以在「形象 → 我的形象库…」里点"
                       "「换图…」重新指一张。")
            return False
        skins = dict(self.cfg.get("custom_skins") or {})
        skins[kind] = ent["id"]
        self.cfg["custom_skins"] = skins
        self._refresh_skins()
        tail = "（别删原图哦）" if fresh else ""
        if kind == "pet":
            self.set_skin(SKIN_PET)
            self.say(f"三维形象「{ent['name']}」整套换上啦{tail}")
        else:
            self.set_skin(SKIN_WIDGET)
            self.say(f"挂件形象「{ent['name']}」换上啦{tail}")
        return True

    def skin_library_dialog(self, kind=None):
        """「我的形象库…」：三维 / 挂件两本库 + 上传 / 换图 / 改名 / 删掉，全在这一个窗口里。"""
        if kind not in ("pet", "widget"):
            kind = "widget" if self.skin == SKIN_WIDGET else "pet"   # 默认先看你正用着的那本
        with self._ui_guard():
            SkinLibraryDialog(self, kind).exec()

    def rename_skin(self, kind, sid, parent=None):
        """给库里的一条改名字（编号不变，正在用它的一点不受影响）。"""
        ent = self.skin_entry(kind, sid)
        if not ent:
            return False
        with self._dialog_guard(parent):
            name, ok = QInputDialog.getText(
                parent or self, "给形象改个名字", f"「{ent['name']}」改成什么？",
                QLineEdit.EchoMode.Normal, ent["name"],
                Qt.WindowType.WindowStaysOnTopHint)
        name = (name or "").strip()[:24]
        if not ok or not name or name == ent["name"]:
            return False
        keys = PET_SLOTS if kind == "pet" else ("path",)
        self.update_skin(kind, sid, name, **{k: ent[k] for k in keys})
        self.say(f"改好啦，以后叫「{name}」")
        return True

    def remove_skin(self, kind, sid, parent=None):
        """从库里删掉一条（正用着它就退回自带形象；硬盘上的原图不动）。"""
        ent = self.skin_entry(kind, sid)
        if not ent:
            return False
        used = self.skin_in_use(kind, sid)
        tip = f"把「{ent['name']}」从{SKIN_KIND_LABELS[kind]}库里删掉？"
        if used:
            tip += "\n\n它现在正用着 —— 删了会退回自带形象。"
        tip += "\n\n只删库里这条记录，硬盘上那几张原图我不动。"
        with self._dialog_guard(parent):
            ok = QMessageBox.question(parent or self, "删掉这个形象", tip,
                                      QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No)
        if ok != QMessageBox.StandardButton.Yes:
            return False
        self._save_skin_library(kind, [it for it in self.skin_library(kind) if it["id"] != sid])
        if used:
            skins = dict(self.cfg.get("custom_skins") or {})
            skins.pop(kind, None)
            self.cfg["custom_skins"] = skins
            self._refresh_skins()
        self.say(f"「{ent['name']}」从{SKIN_KIND_LABELS[kind]}库里删掉了（原图我没动）")
        return True

    def clear_custom_skin(self, kind=None):
        """恢复自带形象（kind：pet=三维 / widget=挂件；不给就两个都恢复）。库里的都留着。"""
        skins = dict(self.cfg.get("custom_skins") or {})
        if kind in ("pet", "widget"):
            skins.pop(kind, None)
        else:
            skins = {}
        self.cfg["custom_skins"] = skins
        self._rebuild_sprites()
        if self.skin == SKIN_WIDGET and not self._has_sprite("挂件"):
            self.skin = SKIN_PET
            self.cfg["skin"] = SKIN_PET
        self.set_size(self.cfg.get("size", SIZE_DEFAULT))
        self.save_config()
        self.say(f"{SKIN_KIND_LABELS[kind]}恢复成自带的啦（库里的还留着）"
                 if kind in SKIN_KIND_LABELS else "已恢复自带形象（上传过的还在「我的形象库」里）")

    def set_skin(self, name):
        """切换形象：大肥鱼（三视图）/ 小鲸鱼挂件（单张）。"""
        if name == SKIN_WIDGET and not self.widget_skin_ok:
            self.say("小鲸鱼形象没找到图片")
            return
        self.skin = name
        self.cfg["skin"] = name
        self.prev_key = None
        self.cross_t = 0.0
        self._apply_window_size()
        self._settle()
        self.update()

    # ---------- 吸附 / 翻转 ----------
    # ================= A 路线 2.5D「3D 感」增强（task-74） =================
    def set_render_enhance(self, on):
        """render.enhance 开关：默认开；关闭后完全回到原渲染与原拖拽行为（可回滚）。"""
        self.render["enhance"] = bool(on)
        self.cfg["render"] = self.render
        if not on:
            self._enh_phys = None
            self._enh_edge = None
            self._enh_land = 0.0
            self._enh_dizzy_until = 0.0
            self._enh_gaze = 0.0
        try:
            self.save_config()
        except Exception:
            pass
        print("A 路线渲染增强:", "on" if on else "off")
        self.update()








    def _edge_side(self):
        """贴边探测（16px 内，23 §4.2）；角落按 左/右 > 上 > 下 优先。"""
        try:
            geo = (self.screen() or QApplication.primaryScreen()).availableGeometry()
            x, y, w, h = self.x(), self.y(), self.width(), self.height()
            probe = 16
            if x <= geo.left() + probe:
                return "left"
            if x + w >= geo.right() - probe:
                return "right"
            if y <= geo.top() + probe:
                return "top"
            if y + h >= geo.bottom() - probe:
                return "bottom"
        except Exception:
            pass
        return None

    def _edge_distance(self):
        """距最近屏幕边缘的像素距离（40px 释放滞回用）。"""
        try:
            geo = (self.screen() or QApplication.primaryScreen()).availableGeometry()
            x, y, w, h = self.x(), self.y(), self.width(), self.height()
            return min(x - geo.left(), geo.right() - (x + w), y - geo.top(), geo.bottom() - (y + h))
        except Exception:
            return 9999




    def _snap_to_edge(self):
        """松手后按四分之一区域吸附屏幕四边（角落可组合），左吸附时整体水平翻转。"""
        if not self.snap_on:
            self.snap_h = self.snap_v = None
            self.flip_x = False
            return
        geo = (self.screen() or QApplication.primaryScreen()).availableGeometry()
        cx, cy = self.x() + self.width() / 2, self.y() + self.height() / 2
        self.snap_h = ("left" if cx < geo.left() + geo.width() / 4
                       else "right" if cx > geo.right() - geo.width() / 4 else None)
        self.snap_v = ("top" if cy < geo.top() + geo.height() / 4
                       else "bottom" if cy > geo.bottom() - geo.height() / 4 else None)
        self._settle(geo)

    def _settle(self, geo=None):
        if not self.snap_on or (self.snap_h is None and self.snap_v is None):
            return
        geo = geo or (self.screen() or QApplication.primaryScreen()).availableGeometry()
        x, y = self.x(), self.y()
        if self.snap_h == "left":
            x = geo.left()
        elif self.snap_h == "right":
            x = geo.right() - self.width() + 1
        if self.snap_v == "top":
            y = geo.top()
        elif self.snap_v == "bottom":
            y = geo.bottom() - self.height() + 1
        # 吸附轴已经是精确贴边，只有没吸附的轴才需要钳制在屏幕内
        if self.snap_h is None:
            x = max(geo.left(), min(geo.right() - self.width(), x))
        if self.snap_v is None:
            y = max(geo.top(), min(geo.bottom() - self.height(), y))
        self.flip_x = bool(self.flip_on_left and self.snap_h == "left")
        self.move(int(x), int(y))

    # ---------- 绘制 ----------
    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        now = self._secs()
        # A 路线增强：一帧参数（关闭时中性值）+ 气泡层视差位移
        st = self._enh_state(now)
        p.save()
        if st["bubble_dx"] or st["bubble_dy"]:
            p.translate(st["bubble_dx"], st["bubble_dy"])

        mode = self._bubble_mode(now)
        if mode != "lyric":
            # 这会儿画的不是歌词气泡 → 那几颗按钮也没了。
            # 位置一起清掉，免得气泡收起来之后原地还留着"看不见但能点"的死区。
            self._lyric_btn_rects = {}
            if getattr(self, "_lyric_btn_hover", None) is not None:
                self._lyric_btn_hover = None
                self.setCursor(Qt.CursorShape.ArrowCursor)
        if mode == "text":
            ink = self._bubble_ink()
            if self.bubble_inner:
                bfont = QFont(self.bubble_font)
                bfont.setItalic(True)
                bg, fg = ink["inner_bg"], ink["inner_fg"]
            else:
                bfont = QFont(self.bubble_font)
                bg, fg = ink["bg"], ink["fg"]
            fm = QFontMetrics(bfont)
            max_w = min(240, self.width() - 16)
            words = self.bubble_text
            lines = []
            cur = ""
            for ch in words:
                if fm.horizontalAdvance(cur + ch) > max_w - 20:
                    lines.append(cur)
                    cur = ch
                else:
                    cur += ch
            lines.append(cur)
            bw = max(fm.horizontalAdvance(l) for l in lines) + 28
            bh = len(lines) * fm.height() + 16
            bx = (self.width() - bw) / 2
            by = self._bubble_top(bh)
            p.setPen(Qt.PenStyle.NoPen)
            p.setBrush(bg)
            p.drawRoundedRect(QRectF(bx, by, bw, bh), 14, 14)
            tail = QPointF(self.width() / 2, by + bh)
            p.drawPolygon(QPolygonF([tail, QPointF(tail.x() - 7, tail.y() + 9),
                                     QPointF(tail.x() + 7, tail.y() + 9)]))
            p.setPen(fg)
            p.setFont(bfont)
            for i, l in enumerate(lines):
                p.drawText(QRectF(bx, by + 8 + i * fm.height(), bw, fm.height()),
                           Qt.AlignmentFlag.AlignCenter, l)
        elif mode == "balance":
            # 余额气泡：余额 / 今日已用（数字带滚动动画）
            ink = self._bubble_ink()
            f_small = QFont(self.bubble_font)
            f_small.setPointSize(9)
            f_big = QFont(self.bubble_font)
            f_big.setPointSize(15)
            f_big.setBold(True)
            fm_s, fm_b = QFontMetrics(f_small), QFontMetrics(f_big)
            src = self.balance.get("name") or "DeepSeek"
            symbol = currency_symbol(self.balance.get("currency"))
            peak_now = is_peak()
            show_peak_line = bool(self.show_peak and src == "DeepSeek")
            if self.balance.get("no_api"):
                # 这个服务不提供余额接口，直接说清楚
                l1 = src
                l2 = "无法查询"
                l3 = "该服务不提供余额接口"
                show_peak_line = False
            else:
                l1 = f"{src} 余额"
                l2 = f"{symbol} {self._display_amount():.2f}".strip()
                l3 = (f"今日已用 {symbol} {self.balance['today']:.2f}".strip()
                      if src == "DeepSeek" else "今日已用 仅 DeepSeek 支持")
            l4 = f"现在 {peak_label(peak_now, self.peak_style)}"
            bw = max(fm_b.horizontalAdvance(l2), fm_s.horizontalAdvance(l1),
                     fm_s.horizontalAdvance(l3), fm_s.horizontalAdvance(l4)) + 28
            bh = fm_s.height() + fm_b.height() + fm_s.height() + 16
            if show_peak_line:
                bh += fm_s.height()
            bx = (self.width() - bw) / 2
            by = self._bubble_top(bh)
            p.setPen(Qt.PenStyle.NoPen)
            p.setBrush(ink["bg"])
            p.drawRoundedRect(QRectF(bx, by, bw, bh), 14, 14)
            tail = QPointF(self.width() / 2, by + bh)
            p.drawPolygon(QPolygonF([tail, QPointF(tail.x() - 7, tail.y() + 9),
                                     QPointF(tail.x() + 7, tail.y() + 9)]))
            ty = by + 8
            p.setFont(f_small)
            p.setPen(ink["bal_title"])
            p.drawText(QRectF(bx, ty, bw, fm_s.height()), Qt.AlignmentFlag.AlignCenter, l1)
            ty += fm_s.height()
            p.setFont(f_big)
            p.setPen(ink["bal_big"])
            p.drawText(QRectF(bx, ty, bw, fm_b.height()), Qt.AlignmentFlag.AlignCenter, l2)
            ty += fm_b.height()
            p.setFont(f_small)
            p.setPen(ink["bal_sub"])
            p.drawText(QRectF(bx, ty, bw, fm_s.height()), Qt.AlignmentFlag.AlignCenter, l3)
            if show_peak_line:
                ty += fm_s.height()
                p.setFont(f_small)
                # 高峰暖色、空闲绿色，一眼看出现在贵不贵
                warm, cool = BUBBLE_PEAK_COLORS[self._bubble_theme()]
                p.setPen(warm if peak_now else cool)
                p.drawText(QRectF(bx, ty, bw, fm_s.height()), Qt.AlignmentFlag.AlignCenter, l4)

        elif mode == "lyric":
            self._paint_lyric_bubble(p)

        cx = self.width() / 2
        bottom = self.bubble_h + MARGIN + self.cur_h
        p.restore()          # 气泡层视差结束
        # A 路线增强：贴地软阴影（身体之前画，作为"地面"）
        self._enh_paint_shadow(p, cx, bottom, st)
        walking = self.target is not None and not self.dragging
        _smcfg = getattr(self, "_smooth_cfg", None)
        _smmod = getattr(self, "_smooth", None)
        if _smcfg is not None and getattr(_smcfg, "enabled", True) and _smmod is not None:
            _sm = _smmod.secondary_motion(now, _smcfg, walking=walking)
            if walking:
                sway = math.sin(now * 9.0) * 2.6
                bob = -abs(math.sin(now * 4.5)) * 5.5
            else:
                sway = _sm["sway_deg"]
                bob = _sm["float_px"]
            breath = _sm["scale"]
        else:
            if walking:
                sway = math.sin(now * 9.0) * 3.5
                bob = -abs(math.sin(now * 4.5)) * 7.0
            else:
                sway = math.sin(now * 2.5) * 1.5
                bob = 0.0
            breath = 1.0 + 0.02 * math.sin(now * 2.5)
        scale = breath
        jump = -abs(math.sin(self.jump_t * 3.14159)) * 14 * self.jump_t if self.jump_t > 0 else 0
        act_rot = act_sx = act_sy = 0.0
        if self.action == "sway":
            act_rot = math.sin(self.action_t * 3.14159 * 2) * 10 * self.action_t
        elif self.action == "stretch":
            act_sy = 0.06 * math.sin(self.action_t * 3.14159)
            act_sx = -0.03 * math.sin(self.action_t * 3.14159)
        elif self.action == "spin":
            act_rot = 360.0 * (1.0 - min(1.0, self.action_t))
        elif self.action == "shake":
            act_rot = math.sin(self.action_t * 60.0) * 8.0 * self.action_t

        # 按压 Q 弹：底部坐标不变，横向撑开、纵向压扁
        press_sx = 1 + 0.13 * self.press_t
        press_sy = 1 - 0.13 * self.press_t

        def draw_one(key, opacity, raw=False):
            if key is None:
                return
            name, h, facing = key
            bottom = self.bubble_h + MARGIN + self.cur_h
            # 鲸鱼娘帧动画：帧画布带脚底留白，按 foot_ratio 对齐落地点；挂件形象 / 回退时走原逻辑
            whale = getattr(self, "_whale", None)
            if whale is not None and name != "挂件" and self._whale_active():
                # 方向 crossfade 期间用原始帧（避免与动作淡化叠加成双层）
                pix = whale.pixmap_raw(h) if raw else whale.pixmap(h)
                if pix is None or pix.isNull():
                    return
                ph = pix.height() * scale * (1 + act_sy) * press_sy
                pw = pix.width() * scale * (1 + act_sx) * press_sx
                dx = cx - pw / 2
                dy = bottom - ph * whale.foot_ratio() + jump + bob
            else:
                pix = self.sprites[(name, h)]
                ph = pix.height() * scale * (1 + act_sy) * press_sy
                pw = pix.width() * scale * (1 + act_sx) * press_sx
                dx = cx - pw / 2
                dy = bottom - ph + jump + bob
            p.save()
            p.setOpacity(opacity)
            p.translate(cx, bottom)
            p.rotate(sway + act_rot + st["rot"])
            p.translate(-cx, -bottom)
            # A 路线增强：身体位移/透视缩放（以底边中心为锚，避免脚底漂移）
            if st["dx"] or st["dy"]:
                p.translate(st["dx"], st["dy"])
            if st["sx"] != 1.0 or st["sy"] != 1.0:
                p.translate(cx, bottom)
                p.scale(st["sx"], st["sy"])
                p.translate(-cx, -bottom)
            # 鲸鱼娘 walk 素材是**朝右**的侧视图（f00~f31 脸/脚尖朝右、尾巴在左）：
            # 向左移动（facing>0）时才水平翻转；向右移动不翻。
            # 贴边 flip_x 是给经典三视图的"左吸附整体翻转"，不作用于鲸鱼娘；
            # 经典精灵保持原 XOR 逻辑。（此前鲸鱼娘沿用了 classic 的"朝左素材"假设 → 左右都倒着走）
            if whale is not None and name != "挂件" and self._whale_active():
                _flip = facing > 0
            else:
                _flip = (facing < 0) != bool(self.flip_x)
            if _flip:
                p.translate(cx, 0)
                p.scale(-1, 1)
                p.translate(-cx, 0)
            p.drawPixmap(QRectF(dx, dy, pw, ph), pix, QRectF(0, 0, pix.width(), pix.height()))
            p.restore()

        cur_key = self._sprite_key()
        _force_now = getattr(self, "_whale_force", None)
        _loco_actions = getattr(getattr(self, "_smooth", None), "LOCOMOTION_ACTIONS", ())
        _dir_fade_off = _force_now is not None and _force_now not in _loco_actions
        if self.cross_t > 0 and not _dir_fade_off:
            # 方向切换：两层都用原始帧（raw），淡化只由外层 cross_t 负责
            draw_one(self.prev_key, self.cross_t, raw=True)
            draw_one(cur_key, 1.0 - self.cross_t, raw=True)
        else:
            draw_one(cur_key, 1.0)
        try:
            self._bridge_paint_fx(p, cx, self.bubble_h + MARGIN + self.cur_h)
        except Exception as _fx_paint_exc:
            print("联动桥 FX 绘制失败:", repr(_fx_paint_exc))




    def _secs(self):
        """内部时钟（秒）。按当前每帧时长换算，两种流畅度下动作速度一致。"""
        return self.t * self.tick_ms / 1000.0







    # ---------- 鲸鱼娘 2D 帧动画 ----------
    # 单次动作播完后保持末帧的时长（秒；缺省 = 播完回 idle；0 = 保持到被状态变化/用户操作打断）
    _WHALE_HOLD_S = {
        "sleep": 0.0, "think": 0.0, "waitPeek": 0.0, "lonelySit": 0.0, "hum": 0.0,
        "eat": 1.8, "eatSatisfied": 1.2, "sneak": 1.5, "dance": 1.2, "fall": 0.0,
        "caught": 0.8, "cry": 0.8, "pat": 0.6, "tsundere": 0.6, "report": 0.6,
    }







    # ---------- 失联休眠（task-77） ----------
    def _life_tick(self):
        """管道静默太久 → 离线打盹；重新收到命令/用户操作 → 醒来问好（冷却）。

        默认只在本地打盹、不退出（lifecycle.exitWithDsh=false 防误退）。
        """
        now = time.time()
        silent = max(0.0, now - float(getattr(self, "_last_line_at", now) or now))
        self._life_silent_ms = int(silent * 1000)
        lc = getattr(self, "lifecycle", None) or {}
        off_ms = max(1000, int(lc.get("offlineAfterMs", 120000) or 120000))
        if bool(lc.get("exitWithDsh", False)):
            exit_ms = max(60000, int(lc.get("exitAfterMs", 600000) or 600000))
            if silent * 1000.0 >= exit_ms:          # 只在显式开启时才退出
                print("失联休眠：静默 %.0fs 且 exitWithDsh=true，准备退出" % silent)
                try:
                    QTimer.singleShot(0, QApplication.instance().quit)
                except Exception:
                    pass
                return
        if not getattr(self, "_life_offline", False):
            if silent * 1000.0 >= off_ms:
                self._life_enter_offline(now)
            return
        # 打盹中：命令到达（_last_line_at 被刷新）→ 醒；否则维持 sleep 末帧
        if silent * 1000.0 < off_ms:
            self._life_wake(now)
        elif (not self.dragging
              and getattr(self, "_whale_force", None) not in ("sleep", "wake")):
            self._whale_force_play("sleep")

    def _life_enter_offline(self, now=None):
        """进入离线打盹：停下所有动作、躺平睡觉；白天冒一个"？"，深夜/免打扰不冒泡（28 §4.8）。"""
        now = time.time() if now is None else now
        if getattr(self, "_life_offline", False):
            return
        self._life_offline = True
        self._life_offline_at = now
        self.target = None
        self.cur_speed = 0.0
        try:
            self._enh_phys = None
        except Exception:
            pass
        self._whale_force_play("sleep")
        if self._whale_gag_ok():
            self._bridge_bubble_kind = ""
            self.say("……？（等你好久了）", inner=True, seconds=4.0)
        print("失联休眠：进入离线打盹（静默 %.1fs）" % (now - getattr(self, "_last_line_at", now)))

    def _life_wake(self, now=None):
        """退出离线打盹：起身 + 问候（120 秒冷却；深夜/免打扰不冒泡）。

        醒来一律刷新 `_last_line_at`（命令 / 点击 / 拖拽都算"有人互动"），
        否则下一 tick 会按旧静默时长立刻又睡回去。
        """
        now = time.time() if now is None else now
        if not getattr(self, "_life_offline", False):
            self._last_line_at = now
            return
        self._last_line_at = now
        self._life_offline = False
        self._life_offline_at = 0.0
        self.rest_until = self.t * self.tick_ms + random.randint(2000, 5000)
        if not self._whale_force_play("wake"):
            self._whale_clear_force()
        if self._whale_gag_ok() and now - getattr(self, "_life_greet_at", 0.0) >= 120.0:
            self._life_greet_at = now

            # 28 §2.4：打盹唤醒先迷糊 0.8–1.5s 再开口 —— 与起身同帧冒泡像"装醒"；延迟 1.0s 且语气轻一点。
            def _greet_after_wake():
                try:
                    if getattr(self, "_life_offline", False) or not self._whale_gag_ok():
                        return
                    self._bridge_bubble_kind = "greet"
                    self.say("……你回来啦", seconds=4.0)
                except Exception:
                    pass

            QTimer.singleShot(1000, _greet_after_wake)
        print("失联休眠：醒来")


    # ---------- LLM 台词请求（task-133）----------





    # ---------- B 身体（WebM QWebEngineView）----------
    def _static_pix_path(self):
        here = os.path.dirname(os.path.abspath(__file__))
        cands = [os.path.join(os.path.dirname(here), 'tools', 'body-b', 'placeholder.png'),
                 os.path.join(here, 'assets', 'body-b', 'placeholder.png'),
                 os.path.join(here, 'assets', 'webm_body', 'placeholder.png')]
        for p in cands:
            if os.path.isfile(p):
                return p
        return ''

    def _show_static_body(self):
        path = self._static_pix_path()
        if not path:
            return False
        try:
            if self._static_body is None:
                self._static_body = StaticBodyWindow(path)
            else:
                self._static_body.set_pix(path)
            pos = None
            try:
                if self._webm is not None and self._webm._view is not None:
                    pos = self._webm._view.pos()
            except Exception:
                pos = None
            if pos is None:
                pos = self.pos()
            self._static_body.move(pos)
            self._static_body.show()
            self._static_body.raise_()
            self._body = "placeholder"
            self.hide()
            return True
        except Exception:
            return False

    def _hide_static_body(self):
        try:
            if self._static_body is not None:
                self._static_body.hide()
        except Exception:
            pass



    def show(self):
        if getattr(self, "_body", "png") == "placeholder":
            try:
                self._static_body.show()
                self._static_body.raise_()
            except Exception:
                pass
            return
        if getattr(self, "_body", "png") == "webm" and getattr(self, "_webm", None) is not None:
            try:
                self._webm._view.show()
                self._webm._view.raise_()
            except Exception:
                pass
            return
        super().show()

    def _apply_main_click_through(self, on):
        try:
            self.setWindowFlag(Qt.WindowType.WindowTransparentForInput, bool(on))
            self._webm_main_click_through = bool(on)
            if self.isVisible():
                self.show()
        except Exception:
            pass











    def set_body(self, kind):
        """同进程切换身体：webm（B）/ png（旧渲染 / 低内存回退）。"""
        kind = str(kind or "").lower()
        if kind == "webm":
            self._hide_static_body()
            if getattr(self, "_body", "") == "webm":
                return True
            try:
                self._init_webm_body()
                self.cfg.setdefault("whale", {})["body"] = "webm"
                return True
            except Exception as exc:
                print("切 B 失败:", repr(exc))
                return False
        if kind in ("png", "placeholder"):
            b = getattr(self, "_webm", None)
            if b is not None:
                try:
                    b.close()
                except Exception:
                    pass
            self._webm = None
            self._whale = None
            self._apply_main_click_through(False)
            ok = self._show_static_body()
            self.cfg.setdefault("whale", {})["body"] = "placeholder" if ok else "png"
            try:
                self._anim_log("body=placeholder static ok=%s" % ok)
            except Exception:
                pass
            return ok
        return False

    def closeEvent(self, event):
        try:
            b = getattr(self, "_webm", None)
            if b is not None:
                b.close()
                self._webm = None
        except Exception:
            pass
        try:
            super().closeEvent(event)
        except Exception:
            pass


    # ---------- 事件动画编排（task-131）：庆祝 3 阶段 / 对话微动作 ----------



    def _sprite_key(self):
        if self.skin == SKIN_WIDGET:
            return ("挂件", self.cur_h,
                    self.facing if self.dir in ("left", "right") else 1)
        name = {"left": "侧面", "right": "侧面", "up": "背面", "down": "正面"}[self.dir]
        return (name, self.cur_h, self.facing if self.dir in ("left", "right") else 1)

    def _set_dir(self, d, facing=None):
        if d != self.dir:
            self.prev_key = self._sprite_key()
            self.cross_t = 1.0
            self.dir = d
        if facing is not None and facing != self.facing:
            self.facing = facing

    def _face_travel(self, dx, dy, ratio=2):
        """按"这一步往哪走"给朝向（dx/dy 是窗口中心 → 目标点的位移）。

        明显横向（横向位移是纵向的 ratio 倍以上）→ 侧面（自动镜像）；
        其余只要往上走 → 背影（等于往屏幕里走、背对着你）；往下走 → 正面。

        以前这里是"只要横向超过 4px 就侧面，只有几乎笔直向上才给背影"，而散步的随机
        目标几乎不可能笔直向上，于是背影再也没出现过（主人反馈"我这么久没见过背面"）。
        阈值取 2 倍（不是对半分）是因为屏幕是宽屏：横向位移天然比纵向大一截，
        真按 |dx|>=|dy| 分的话背影只占 1/7 左右（实机 90 秒一次都没出现）。
        现在宽屏上大约 45% 侧面、25% 背影、30% 正面。

        ratio 只给"走路"用；跟着鼠标转头用的是 1（见 `_face_cursor`）——鼠标是看着走的，
        45 度就该算侧面，不该按宽屏那套偏袒横向。
        """
        if abs(dx) >= ratio * abs(dy):
            self._set_dir("left" if dx < 0 else "right", 1 if dx < 0 else -1)
        elif dy < 0:
            self._set_dir("up")
        else:
            self._set_dir("down")

    # ---------- 逻辑 ----------

    def check_processes(self):
        """切到（或刚打开）某个应用时冒一句吐槽。

        改成看"前台窗口"而不是"新出现的进程"：这样已经开着的微信 / 浏览器 /
        QQ 也算数，不会像以前那样只有刚启动的 Steam 会触发。同一个应用
        10 分钟（ChatGPT 15 分钟）只吐槽一次，避免刷屏。
        """
        name = foreground_process_name()
        if not name:
            return
        # 桌宠自己在前台（开着设置窗口 / 右键菜单）：不算"切到别的应用" ——
        # 既不打断了「用久了」那一段连续计时，也不拿自己当触发对象
        if foreground_pid() == os.getpid():
            return
        # 「用久了提醒」跟「打开时冒泡」是两个开关，各管各的
        self._track_fg_usage(name)
        if not self.process_alerts:
            return
        lines_map = self._process_lines_map()
        if name not in lines_map:
            self._foreground_proc = name
            return
        if name == self._foreground_proc:
            return
        self._foreground_proc = name
        now = time.time()
        cooldown = 900 if name == "chatgpt.exe" else 600
        if now - self._proc_said_at.get(name, 0) < cooldown:
            return
        self._proc_said_at[name] = now
        self._say_reminder(random.choice(lines_map[name]))

    def _process_lines_map(self):
        """默认台词表 → 用户改写的默认台词 → 用户自己加的应用。

        结果按**内容指纹**缓存：这个函数每 2 秒被问一次，没必要每次都把 18 条重建一遍。
        指纹就是这两张表本身 —— 菜单里改、对话框里改、甚至直接手改 config.json，
        指纹一变就重算，不会出现"台词改了菜单里还是旧的"（第一版按"谁改谁作废"写，
        漏了一条路就会读到旧表，改用指纹以后这条路彻底没有）。
        """
        custom = self.cfg.get("custom_process_lines") or {}
        overrides = self.cfg.get("default_line_overrides") or {}
        key = (repr(custom), repr(overrides))
        if self._proc_lines_cache and self._proc_lines_cache[0] == key:
            return self._proc_lines_cache[1]
        merged = {k: list(v) for k, v in PROCESS_LINES.items()}
        for exe, lines in overrides.items():
            exe = (exe or "").strip().lower()
            if exe and lines:
                merged[exe] = [t for t in lines if t]      # 改写内置台词（整组替换）
        for exe, lines in custom.items():
            exe = (exe or "").strip().lower()
            if not exe or not lines:
                continue
            if exe in PROCESS_LINES:
                continue        # 内置应用只走 override，不在这里追加，避免"重复添加"
            merged[exe] = list(merged.get(exe, [])) + [t for t in lines if t]
        self._proc_lines_cache = (key, merged)
        return merged

    def _invalidate_proc_lines(self):
        """用户改了"打开应用时冒泡"的台词 → 直接把缓存丢掉（指纹那条路也能兜住）。"""
        self._proc_lines_cache = None

    # ---------- 用久了提醒 ----------
    def app_time_rules(self):
        """{exe: {minutes, repeat, on, lines}}。规则表就在 config.json 里。"""
        box = self.cfg.get("app_time_lines")
        return dict(box) if isinstance(box, dict) else {}

    def set_app_time_rules(self, rules):
        self.cfg["app_time_lines"] = rules

    def _usage_rule(self, exe):
        """这个应用连续用满多久该说话？没配 / 已关 / 没台词都返回 None。"""
        rule = self.app_time_rules().get((exe or "").lower())
        if not isinstance(rule, dict) or not rule.get("on", True):
            return None
        lines = [str(t) for t in (rule.get("lines") or []) if str(t).strip()]
        if not lines:
            return None
        try:
            minutes = max(1, int(rule.get("minutes") or 60))
        except (TypeError, ValueError):
            minutes = 60
        try:
            repeat = max(0, int(rule.get("repeat") or 0))
        except (TypeError, ValueError):
            repeat = 0
        return minutes, repeat, lines

    def _track_fg_usage(self, name, now=None):
        """记"这个应用连续在前台待了多久"，到点说一句。

        只在**本人在用**的时候累计：连着 FG_IDLE_FREEZE 秒没人动键鼠
        （看电影、挂机、人走开了），这段时间不算进去 —— 不然回来会被冤枉。
        台词里可以用 `{app}`（应用名）和 `{minutes}` / `{hm}`（用了多久）。
        """
        now = time.time() if now is None else now
        if name != self._fg_exe:            # 换应用了：这一轮从头开始
            self._fg_exe = name
            self._fg_accum = 0.0
            self._fg_clock = now
            self._fg_count = 0
            return
        gap = now - self._fg_clock
        self._fg_clock = now
        idle = idle_seconds()
        if idle is not None and idle > FG_IDLE_FREEZE:
            return                          # 人没在用：不累计，也不提醒
        if gap > 0:
            self._fg_accum += gap
            self._app_time_add(name, gap, now=now)     # 顺手记进"今天用了多久"的账本
        rule = self._usage_rule(name)
        if rule is None:
            return
        minutes, repeat, lines = rule
        used = self._fg_accum / 60.0
        if used < minutes:
            return
        due = 1 if not repeat else 1 + int((used - minutes) // repeat)
        if due <= self._fg_count:
            return
        self._fg_count = due                # 关着开关也记上：免得一打开就补一串旧提醒
        if self.cfg.get("app_time_on", True):
            text = fill_vars(random.choice(lines), app=self.app_label(name),
                             minutes=int(used), hm=fmt_duration(used * 60))
            self._say_reminder(text)

    def app_time_dialog(self, apps=None):
        """用久了提醒。第一次进来先把本机应用扫出来（后台扫，扫完自己弹）。"""
        if apps is None:
            self.say("我翻翻你电脑里的应用哦…")
            threading.Thread(target=lambda: self._app_time_queue.append(scan_apps()),
                             daemon=True).start()
            return
        if not apps:
            apps = sorted((exe, exe, "") for exe in PROCESS_LINES)
        with self._ui_guard():
            AutoSayDialog(self, "apptime", apps).exec()
        self._notify_console()

    # ---------- 到点说一句 ----------
    def clock_rules(self):
        rules = self.cfg.get("timed_lines")
        return [r for r in rules if isinstance(r, dict)] if isinstance(rules, list) else []

    def set_clock_rules(self, rules):
        self.cfg["timed_lines"] = rules

    def check_timed_lines(self):
        """到点说一句。跟峰谷提醒同一个地方调（每秒看一次）。

        `summary: true` 的那几条（内置的 23:30 就是）会先说一句**今天的小结**
        （余额用量 + 用得最久的一两个应用），再接一句台词；今天没什么可说的就只说台词。
        """
        if not self.cfg.get("timed_on", True):
            return
        now = datetime.now()
        hm = now.strftime("%H:%M")
        today = now.strftime("%Y-%m-%d")
        stamp = time.time()
        for i, rule in enumerate(self.clock_rules()):
            if not rule.get("on", True):
                continue
            lines = [str(t) for t in (rule.get("lines") or []) if str(t).strip()]
            if not lines:
                continue
            rid = rule.get("id") or f"#{i}"
            when = (rule.get("when") or "daily").lower()
            if when == "interval":          # 每隔 N 分钟
                try:
                    every = max(1, int(rule.get("every") or 60))
                except (TypeError, ValueError):
                    every = 60
                last = self._timed_last.get(rid)
                if last is None:
                    self._timed_last[rid] = stamp     # 刚启动先记一笔，别一开桌宠就炸
                elif stamp - last >= every * 60:
                    self._timed_last[rid] = stamp
                    self._say_clock_rule(rule, lines)
                continue
            if (rule.get("time") or "").strip() != hm:
                continue
            if when == "weekly":            # 每周：得今天正好勾上
                try:
                    days = {int(d) for d in (rule.get("days") or [])}
                except (TypeError, ValueError):
                    days = set()
                if now.weekday() not in days:
                    continue
            mark = f"{today} {hm}"
            if self._timed_last.get(rid) == mark:     # 这一分钟已经说过了
                continue
            self._timed_last[rid] = mark
            self._say_clock_rule(rule, lines)


    def timed_lines_dialog(self):
        with self._ui_guard():
            AutoSayDialog(self, "clock").exec()
        self._notify_console()

    # ---------- 全局快捷键 ----------
    def hotkey_rules(self):
        rules = self.cfg.get("hotkeys")
        return [r for r in rules if isinstance(r, dict)] if isinstance(rules, list) else []

    def set_hotkey_rules(self, rules):
        self.cfg["hotkeys"] = rules
        self._register_hotkeys()          # 改了键 / 台词，立刻按新的注册

    def hotkey_failed_texts(self):
        return list(getattr(self, "_hotkey_failed", []))

    def _unregister_hotkeys(self):
        ids = list(getattr(self, "_hotkey_ids", []))
        self._hotkey_ids = []
        self._hotkey_slots = {}
        if not ids:
            return
        try:
            user32 = ctypes.WinDLL("user32.dll")
            for hid in ids:
                try:
                    user32.UnregisterHotKey(None, hid)
                except Exception:
                    pass
        except Exception:
            pass

    def _register_hotkeys(self):
        """按配置注册全局快捷键。注册不上（键被别的程序占用）的记在 _hotkey_failed 里。"""
        self._unregister_hotkeys()
        self._hotkey_failed = []
        if not self.cfg.get("hotkeys_on", True):
            return
        try:
            user32 = ctypes.WinDLL("user32.dll")
        except Exception:
            return
        for i, rule in enumerate(self.hotkey_rules()):
            if not rule.get("on", True):
                continue
            seq = (rule.get("seq") or "").strip()
            parsed = hotkey_parse(seq)
            lines = [str(t) for t in (rule.get("lines") or []) if str(t).strip()]
            act = rule.get("act") or "lines"
            if act == "lines" and not lines:
                continue
            if not parsed:
                if seq:
                    self._hotkey_failed.append(seq)
                continue
            mods, vk = parsed
            hid = HOTKEY_BASE + i
            try:
                ok = bool(user32.RegisterHotKey(None, hid, mods | HOTKEY_NOREPEAT, vk))
            except Exception:
                ok = False
            if ok:
                self._hotkey_ids.append(hid)
                self._hotkey_slots[hid] = dict(rule)
            else:
                self._hotkey_failed.append(seq)

    def _on_hotkey(self, hid):
        """原生消息里收到 WM_HOTKEY：按这条规则的动作来一下。"""
        rule = (getattr(self, "_hotkey_slots", None) or {}).get(hid)
        if not rule:
            return
        act = rule.get("act") or "lines"
        if act == "balance":
            self._double_click_balance()
        elif act == "weather":
            self._get_weather()
        elif act == "music":
            self.check_music_now()
        else:
            lines = [str(t) for t in (rule.get("lines") or []) if str(t).strip()]
            if lines:
                self.say(random.choice(lines), again=True, seconds=3.2, queue=True)

    def hotkeys_dialog(self):
        with self._ui_guard():
            AutoSayDialog(self, "hotkey").exec()
        self._notify_console()

    def scan_apps_dialog(self):
        """扫描本机应用，然后让用户挑一个加"打开时触发的文字"。"""
        self.say("我翻翻你电脑里的应用哦…")
        threading.Thread(target=lambda: self._app_queue.append(scan_apps()),
                         daemon=True).start()

    def _pick_app_dialog(self, apps):
        if not apps:
            self.say("一个都没扫到诶，等会儿再试嘛")
            return
        # 带图标 + 可搜索的应用列表，像「设置 → 应用」那样一眼能认出来
        with self._ui_guard():
            AppScanDialog(self, apps).exec()

    def remove_custom_app_dialog(self):
        """清理：删掉自己加的应用台词，或把改写过的内置应用恢复成原版。"""
        custom = dict(self.cfg.get("custom_process_lines") or {})
        overrides = dict(self.cfg.get("default_line_overrides") or {})
        if not custom and not overrides:
            self.say("还没有自己加的应用呢")
            return
        labels = ([f"{exe}（你自己加的）" for exe in sorted(custom)]
                  + [f"{exe}（改写过内置台词）" for exe in sorted(overrides)])
        with self._ui_guard():
            pick, ok = QInputDialog.getItem(self, "清理自定义文字", "要清掉哪一条？",
                                            labels, 0, False,
                                            Qt.WindowType.WindowStaysOnTopHint)
        if not ok or not pick:
            return
        exe = pick.split("（", 1)[0].strip()
        custom.pop(exe, None)
        overrides.pop(exe, None)
        self.cfg["custom_process_lines"] = custom
        self.cfg["default_line_overrides"] = overrides
        self.save_config()
        self._invalidate_proc_lines()
        self.say(f"已清理 {exe} 的文字")

    def set_agent_name_dialog(self):
        """设置"每轮消耗"里显示的 agent 名称（不是每个人都用 Codex）。"""
        with self._ui_guard():
            name, ok = QInputDialog.getText(
                self, "Agent 名称",
                "你用的 agent 叫什么？\n（会显示成「上一轮 XX 消耗 ¥…」，例如 Codex / Claude / Cursor）",
                QLineEdit.EchoMode.Normal, self.agent_name,
                Qt.WindowType.WindowStaysOnTopHint)
        if ok and name.strip():
            self.agent_name = name.strip()
            self.cfg["agent_name"] = self.agent_name
            self.save_config()
            self.say(f"好，以后就说「上一轮 {self.agent_name} 消耗」")

    def set_agent_dir_dialog(self):
        """设置会话日志目录（放 .jsonl 的那个目录，别的 agent 也能指向自己的日志）。"""
        start = self.agent_dir if os.path.isdir(self.agent_dir) else os.path.expanduser("~")
        with self._ui_guard():
            path = QFileDialog.getExistingDirectory(
                self, "选择会话日志目录（里面是 .jsonl）", start,
                QFileDialog.Option.DontUseNativeDialog)
        if not path:
            return
        self.agent_dir = path
        self.codex_dir = path
        self.cfg["agent_sessions_dir"] = path
        self.save_config()
        self._codex_file = None          # 重新对齐到最新日志
        self._codex_pos = 0
        self._codex_turn = None
        self._codex_tokens = {}
        self.say("日志目录换好了，我从现在开始盯")

    def _face_cursor(self):
        """跟着鼠标转（只转头、不挪窝）。规则是主人定的：

          - 鼠标在**右边** → 往右转（侧面 + 镜像）
          - 鼠标在**左边** → 往左转（侧面）
          - 鼠标在**身上/附近**（STILL_FACE_NEAR 这个圈里）→ 正对着你
          - **没有背影**：鼠标跑到上方也只是正面，绝不背过身去

        「原地待着」默认不做这个动作（固定正面），只有挂件形象 + 菜单里那条开关打开时才会。
        """
        if self.dragging or self.target is not None:
            return
        cursor = self.cursor().pos()
        dx = cursor.x() - (self.x() + self.width() / 2)
        dy = cursor.y() - (self.y() + self.height() / 2)
        if dx * dx + dy * dy <= STILL_FACE_NEAR * STILL_FACE_NEAR:
            self._set_dir("down", 1)                 # 贴身上：正对
        elif abs(dx) >= abs(dy):                     # 偏左右：按左右转
            self._set_dir("left" if dx < 0 else "right", 1 if dx < 0 else -1)
        else:                                        # 偏上下：正对（不背过身）
            self._set_dir("down", 1)

    def _still_face_front(self):
        """「原地待着」模式的朝向：默认一直维持正面（三维外观给正面，挂件也不左右翻面）。

        只影响"静止待着"时；拖动过程中的朝向照旧（mouseMoveEvent 里该翻就翻，
        松手回正面），所以拖起来的感觉和以前一样。

        例外：菜单里打开了「原地待着时也跟着鼠标转」的话，**当前形象**（大肥鱼/挂件都一样）
        就实时盯着鼠标 —— `_face_cursor`：鼠标在右往右转、在左往左转、贴身上/附近就正对着你，
        **不会背过身**。
        """
        if self.still_face_cursor:
            self._face_cursor()
            return
        if self.dir != "down" or self.facing != 1:
            self._set_dir("down", 1)

    def _maybe_idle_action(self):
        # 闲着时的"小动作"概率固定 0.03；发呆时说什么、说多勤由主人选的「语录频率」决定
        # （安静 / 正常 / 话多 / 话痨，见 LINE_FREQ_LEVELS）
        preset = LINE_FREQ_LEVELS.get(getattr(self, "line_freq", LINE_FREQ_DEFAULT),
                                      LINE_FREQ_LEVELS[LINE_FREQ_DEFAULT])
        if random.random() < 0.03:
            pick = random.random()
            if pick < 0.35:
                self.jump_t = 1.0
            elif pick < 0.6:
                self.action, self.action_t = "sway", 1.0
            elif pick < 0.7:
                self.action, self.action_t = "stretch", 1.0
            else:
                # 剩下 30% 的机会拿来冒话，两句之间按主人在「语录频率」里选的间隔隔开
                if self._music_playing():
                    return      # 放歌时不插嘴，把位置让给歌词
                if self._hold_now():
                    return      # 免打扰中 / 正在全屏打游戏看电影：一个字都不说
                if self._secs() < getattr(self, "_dc_hold_until", 0.0):
                    return      # 刚快速双击过：让它把选好的那一眼（余额/天气/台词）先说完
                if self._secs() < getattr(self, "_trigger_until", 0.0):
                    return      # 刚有触发类的话在说（开应用 / 用久了 / 到点 / 快捷键 / 回嘴…）：
                                # 让它先把话说完，闲话等下再说，不许盖掉它
                if self.t - self.last_speak_tick >= preset["cooldown"]:
                    self.last_speak_tick = self.t
                    # 「心声」占四成、「日常台词」占其余；关掉的板块直接不参与
                    # （两块都关了 = 闲着的时候一句话都不说，见 LINE_SECTIONS）
                    if random.random() < 0.4:
                        words = self.lines_for_say("INNER_LINES")
                        if words:
                            self.say(random.choice(words), inner=True, idle=True)
                            return
                    words = self.lines_for_say("LINES")
                    if not words:
                        return
                    if not self._double_click_sees_balance():
                        # 双击已经不归余额管了：别让它嘴上还挂着"双击我给你看余额"
                        words = [w for w in words if w != DOUBLE_CLICK_HINT_LINE] or words
                    self.say(random.choice(words), idle=True)

    def _queue_say(self, text):
        """后台线程调用：只入队，由主线程 tick 统一弹出显示（线程安全）"""
        self._say_queue.append(text)

    # ---------- 台词（用户可自定义 / 可改写内置）----------
    # ---------- 语录板块：哪几块参与说话（设置 → 文案和语录 → 语录板块）----------
    def line_sections_off(self):
        """现在关着的板块 id 集合。配置写坏了也不怕：认不出的 id 直接忽略。"""
        raw = self.cfg.get("lines_off") or []
        if not isinstance(raw, (list, tuple, set)):
            return set()
        return {str(x) for x in raw if str(x) in LINE_SECTION_IDS}

    def line_section_on(self, section):
        """这个板块现在是开着的吗（认不出的 id 一律当"开着"，别把人家的台词吞了）。"""
        return section not in self.line_sections_off()

    def set_line_section(self, section, on):
        """开 / 关一块语录：关掉 = 这一块整个不再说话（台词还在，随时能再打开）。

        定死的一条：**快速双击不受影响** —— 它不是板块，双击照旧做它那一件事
        （看余额 / 看天气 / 看在放什么 / 说一句我写的台词）。
        """
        if section not in LINE_SECTION_IDS:
            return
        off = self.line_sections_off()
        if on:
            off.discard(section)
        else:
            off.add(section)
        # 按 LINE_SECTIONS 的顺序存：配置文件里看着整齐，也不会越存越乱
        self.cfg["lines_off"] = [sid for sid, _n, _d, _k in LINE_SECTIONS if sid in off]
        self.save_config()
        if on:
            self.say("好，这块我接着说", seconds=2.2, again=True)

    def lines_for_say(self, key):
        """要开口时取某类台词：**这一块关掉了就返回空**（调用方自己别说话）。

        跟 `lines_for()` 的区别只有这一句 —— 台词编辑器照样用 `lines_for()` 读全部台词，
        "该不该开口"才问这里（见 LINE_SECTIONS）。
        """
        section = LINE_SECTION_OF.get(key)
        if section is not None and not self.line_section_on(section):
            return []
        return self.lines_for(key)

    def lines_for(self, key):
        """取某一类台词：用户改过就用用户那套，否则用内置默认。"""
        default = globals().get(key) or []
        if not default and key in FREQ_LINE_KEYS:
            default = FREQ_LINES[FREQ_LINE_KEYS[key]]      # 说多勤那四档的话
        custom = (self.cfg.get("custom_lines") or {}).get(key)
        if isinstance(custom, list):
            words = [str(t).strip() for t in custom if str(t).strip()]
            if words:
                return words
        return list(default)

    def set_lines(self, key, words):
        """写回某一类台词；words 为空 = 恢复内置默认。"""
        box = dict(self.cfg.get("custom_lines") or {})
        words = [str(t).strip() for t in (words or []) if str(t).strip()]
        if words:
            box[key] = words
        else:
            box.pop(key, None)
        self.cfg["custom_lines"] = box
        self.save_config()

    def lines_customized(self, key):
        return bool((self.cfg.get("custom_lines") or {}).get(key))

    def edit_lines_dialog(self, initial_key=None):
        """一个窗口里改所有台词：上面选类别，下面一行一句；可一键恢复默认。

        initial_key 用来直接停在某一类上（菜单里「快速双击 → 改写这几句…」用它）。
        """
        from PySide6.QtWidgets import QPlainTextEdit
        dlg = QDialog(self)
        dlg.setWindowTitle("台词内容（自定义或改写内置）")
        dlg.resize(560, 460)
        if ui_console:                      # 跟设置窗口用同一套配色
            ui_console.style_dialog(dlg, BUNDLE_DIR)
        lay = QVBoxLayout(dlg)
        # 语录频率也放这个窗口里（和菜单「文案 → 语录频率」是同一个设置）
        row0 = QHBoxLayout()
        row0.addWidget(QLabel("语录频率："))
        freq_combo = QComboBox()
        for _fname, _fpreset in LINE_FREQ_LEVELS.items():
            freq_combo.addItem(f"{_fname}（{_fpreset['hint']}）", _fname)
        try:
            freq_combo.setCurrentIndex(list(LINE_FREQ_LEVELS).index(self.line_freq))
        except ValueError:
            pass
        row0.addWidget(freq_combo, 1)
        lay.addLayout(row0)
        freq_hint = QLabel("语录频率只影响闲置时的自动说话；点击、拖拽、换歌等反应不受影响，"
                           "播放音乐时也不会说话。")
        freq_hint.setWordWrap(True)
        freq_hint.setObjectName("dim")
        lay.addWidget(freq_hint)
        row = QHBoxLayout()
        row.addWidget(QLabel("改哪一类："))
        combo = QComboBox()
        for key, label in LINE_GROUPS:
            _sec = LINE_SECTION_OF.get(key)
            if _sec is not None and not self.line_section_on(_sec):
                label += "〔已关闭〕"      # 这一类现在不参与说话（关它的开关在设置里）
            combo.addItem(label, key)
        if initial_key:
            _idx = combo.findData(initial_key)
            if _idx >= 0:
                combo.setCurrentIndex(_idx)
        row.addWidget(combo, 1)
        lay.addLayout(row)
        hint = QLabel("下面这些就是这一类的台词：一行一句（空行自动忽略）；"
                      "放歌那两类里可以写 %s 代表当前歌名；"
                      "保存时留空 = 恢复这一类默认。" % "{song}")
        hint.setWordWrap(True)
        hint.setObjectName("dim")
        lay.addWidget(hint)
        edit = QPlainTextEdit()
        lay.addWidget(edit, 1)
        state = QLabel("")
        state.setObjectName("dim")
        lay.addWidget(state)
        btns = QHBoxLayout()
        btn_restore = QPushButton("恢复这一类默认")
        btn_ok = QPushButton("保存")
        btn_cancel = QPushButton("取消")
        btn_ok.setObjectName("primary")
        btns.addWidget(btn_restore)
        btns.addStretch(1)
        btns.addWidget(btn_ok)
        btns.addWidget(btn_cancel)
        lay.addLayout(btns)

        def current_key():
            return combo.currentData()

        def load(_=None):
            key = current_key()
            edit.setPlainText("\n".join(self.lines_for(key)))
            who = ("这一类：自定义（保存时留空 = 恢复默认）"
                   if self.lines_customized(key)
                   else "这一类：当前用内置默认台词")
            _sec = LINE_SECTION_OF.get(key)
            if _sec is not None and not self.line_section_on(_sec):
                who += "　·　这个板块现在是关着的（设置 → 文案和语录 → 语录板块）"
            state.setText(who)

        def restore():
            self.set_lines(current_key(), [])
            load()
            self.say("这一类恢复成内置台词了", seconds=2.2, again=True)

        def save():
            self.set_lines(current_key(), edit.toPlainText().splitlines())
            load()
            self.say("台词存好啦", seconds=2.2, again=True)

        def freq_changed(_=None):
            name = freq_combo.currentData()
            if name and name != self.line_freq:
                self.set_line_freq(name)      # 立刻生效 + 写进 config（顺手冒一句）

        combo.currentIndexChanged.connect(load)
        freq_combo.currentIndexChanged.connect(freq_changed)
        btn_restore.clicked.connect(restore)
        btn_ok.clicked.connect(save)
        btn_cancel.clicked.connect(dlg.reject)
        load()
        with self._ui_guard():
            dlg.exec()

    def say(self, text, inner=False, seconds=2.8, again=False, idle=False, queue=False):
        """冒一句话。

        `idle=True` 只有"闲着时自己冒话"会用（见 `_maybe_idle_action`）：
        **触发类的话优先级最高** —— 开应用 / 用久了 / 到点 / 快捷键 / 双击 / 点它 / 拖它 /
        换歌 / 各种操作提示，说的时候"闲话"不许插嘴、也不许盖掉它（说完闲话自己接着冒）；
        反过来触发类的话可以立刻盖掉正在说的闲话（这条本来就该这样，主人点名要的）。
        `idle` 还顺带绕开下面这条去重：触发类的话即使跟上一句一模一样也要正常显示，
        不能因为"刚说过"就被憋回去（闲话才需要去重）。

        `queue=True`：**自动类的触发**（开应用 / 用久了 / 到点 / 快捷键）用这个。
        如果这会儿已经有触发类的话在说、或者队列里还排着，这句就**排在后面依次说**，
        不跟它抢（两条几乎同时来的时候，两句都能看见）。
        """
        if idle and text == self.last_line and not again and not text.startswith("天气"):
            return
        if queue:
            when = self._queue_behind()
            if when is not None:
                self._pending_bubbles.append((when, text, inner))
                del self._pending_bubbles[:-6]        # 排太长了就丢掉最早的
                return
        if getattr(self, "_body", "png") == "webm" and getattr(self, "_webm", None) is not None:
            try:
                _txt = ("（" + text + "）") if inner else text
                self._webm.showBubble(_txt, seconds)
                self.last_line = text
                self.bubble_inner = inner
                self.bubble_text = _txt
                self.bubble_until = self._secs() + seconds
                return
            except Exception:
                pass
        self.last_line = text
        self.bubble_inner = inner
        self.bubble_text = f"（{text}）" if inner else text
        self.bubble_until = self._secs() + seconds
        if not idle:
            # 这段时间归"触发类"的话：闲着冒话先憋着（见 _maybe_idle_action 里那个判断）
            self._trigger_until = self._secs() + seconds
        # 对话动画化：气泡 kind → 微动作（点头/歪头/害羞/摆手），动作先起、气泡同帧到
        try:
            _kind = getattr(self, "_bridge_bubble_kind", "") or ("inner" if inner else "")
            self._anim_dialog(_kind)
        except Exception:
            pass
        self.update()

    def _queue_behind(self):
        """要排队的话该排在什么时候（没人说话、队列也空就返回 None = 可以直接说）。"""
        now = self._secs()
        busy = max([now, getattr(self, "_trigger_until", 0.0)]
                   + [item[0] for item in self._pending_bubbles])
        return busy + 0.3 if busy > now + 0.01 else None

    # ---------- 鼠标事件 ----------

    def mousePressEvent(self, e):
        if e.button() == Qt.MouseButton.LeftButton:
            # 点在歌词气泡那几颗 ⏮ / ⏸▶ / ⏭ 上：不进"蹦一下 + 响一声"那套，
            # 等松手再看点的是哪一颗（切歌 / 切播放暂停）
            kind = self._lyric_btn_kind(e.position())
            if kind:
                self._press_on_lyric_btn = kind
                self._lyric_btn_pressed = kind
                self.update()
                return
            self._press_on_lyric_btn = None
            self.press_t = 1.0          # 按压 Q 弹
            self.play_click()           # 点一次响一声完整音效（不再区分松手）
            self.last_press_pos = e.globalPosition().toPoint()
            self.dragging = False
            self._drag_blocked = False
            self.drag_start_pos = e.globalPosition().toPoint()
            self._enh_drag_clear()      # A 路线：重置拖拽速度采样

    def mouseMoveEvent(self, e):
        if self._forward_mouse_to_menu(e):
            return
        # 鼠标划过那几颗按钮：亮一下 + 变成小手（其余时候不弄光标）
        if not self.dragging:
            over = self._lyric_btn_kind(e.position())
            if over != self._lyric_btn_hover:
                self._lyric_btn_hover = over
                self.setCursor(Qt.CursorShape.PointingHandCursor if over
                               else Qt.CursorShape.ArrowCursor)
                self.update()
        if e.buttons() & Qt.MouseButton.LeftButton and self.drag_start_pos is not None:
            delta = e.globalPosition().toPoint() - self.drag_start_pos
            if not self.dragging and delta.manhattanLength() > 6:
                if self.locked:
                    # 锁定位置：按住拖也不挪窝（防误触）；松手时这一次也不算点击
                    self._drag_blocked = True
                    return
                self.dragging = True
                self.drag_offset = e.globalPosition().toPoint() - QPoint(self.x(), self.y())
            if self.dragging and self.drag_offset is not None:
                pos = e.globalPosition().toPoint() - self.drag_offset
                # A 路线：抓取滞后 60~90ms（50fps 下每帧追 78%）
                if self._enh_on():
                    cx0, cy0 = self.x(), self.y()
                    self.move(int(cx0 + (pos.x() - cx0) * 0.78), int(cy0 + (pos.y() - cy0) * 0.78))
                else:
                    self.move(pos)
                self._enh_note_drag(e.globalPosition().toPoint())
                if abs(delta.x()) > 10:
                    self._set_dir("left" if delta.x() < 0 else "right", 1 if delta.x() < 0 else -1)
                try:
                    self._bridge_drag_vx = delta.x()
                except Exception:
                    pass
                self.update()

    def mouseReleaseEvent(self, e):
        if e.button() == Qt.MouseButton.LeftButton:
            pressed = getattr(self, "_press_on_lyric_btn", None)
            if pressed:
                self._press_on_lyric_btn = None
                self._lyric_btn_pressed = None
                self._last_click_ms = -99999    # 这一下不算点击，别带出假的单击 / 双击
                self._single_pending = None     # 点按钮也不是单击：欠着的那句台词撤销
                self.last_press_pos = None
                self.drag_start_pos = None
                # 按的哪颗、松手时还在哪颗上，才算真的点了它
                # （按着划出去再松手 = 反悔，什么都不做）
                if self._lyric_btn_kind(e.position()) == pressed:
                    self.music_command(pressed)
                self.update()
                return
            if self.dragging:
                self.dragging = False
                self.drag_offset = None
                self.drag_start_pos = None
                self._set_dir("down", 1)
                self.target = None
                self.rest_until = self.t * self.tick_ms + random.randint(6000, 14000)
                self._snap_to_edge()    # 松手后吸附到最近的边
                # A 路线：甩出速度 → 惯性飞行（阈值 260px/s，上限 2600）
                try:
                    _vx, _vy = self._enh_take_throw()
                    if (abs(_vx) + abs(_vy)) > 260 and self._enh_start_throw(_vx, _vy):
                        self._enh_edge = None
                except Exception:
                    pass
                try:
                    if abs(getattr(self, "_bridge_drag_vx", 0)) > 120:
                        getattr(self, "_bridge_fx_play", lambda _n: None)("spin")
                except Exception:
                    pass
                words = self.lines_for_say("DRAG_LINES")
                if words and random.random() < 0.5:
                    self.say(random.choice(words))
            elif self._drag_blocked:
                # 锁定着按住了乱划：什么都不做（不然会被当成单击/双击，蹦一句话或者弹窗口）
                self._drag_blocked = False
                self._last_click_ms = -99999      # 这一下也不算"上一次点击"，免得带出假双击
                self._single_pending = None       # 同上：拖了一把，就不算单击
            else:
                # 用**墙上时间**判双击：以前用桌宠自己的动画时钟（self.t × tick_ms），
                # 一旦动画停一下 / 卡一下，时钟就走得比真实时间慢，两次隔了 0.8 秒的点击
                # 也会被当成"快速双击"。
                now_ms = time.time() * 1000.0
                quick = (now_ms - self._last_click_ms) <= self._double_click_window_ms()
                self._last_click_ms = now_ms
                if quick:
                    self._last_click_ms = -99999      # 双击只算一次
                    self._single_pending = None       # 上一拍欠着的那句单击台词，撤销
                    self._on_double_click()
                else:
                    self._on_single_click()
            self.last_press_pos = None
            self.drag_start_pos = None

    def contextMenuEvent(self, e):
        if getattr(self, "_bridge_allow_native_ui", False):
            return self._bridge_native_contextMenuEvent(e)
        return




    def _on_single_click(self):
        """单击：蹦跳 + 回嘴 + 顺手刷一下余额。

        蹦跳和静默刷新**立刻**做（手感不能等），**台词压到双击判定窗口之后**
        才冒 —— 想快速双击的人不会再被先顶一句台词。这就是"分得开、又没感觉"：
        看得见的部分是零延迟，只有那句可能在 0.3~0.8 秒内被撤销的话在等。
        """
        self.refresh_balance(silent=True)      # 点一下顺手刷新余额
        try:
            if self._whale_click_react():      # 鲸鱼娘：摸头 pat / 身体 tsundere / 偷吃被抓 caught
                return
        except Exception:
            pass
        try:
            if self._bridge_zone_react():
                return
        except Exception:
            pass
        if self._music_playing():
            # 放歌时报"在放什么"，不用随机台词把歌词顶掉
            self.jump_t = 1.0
            words = self.lines_for_say("MUSIC_CLICK_LINES")
            if words:
                line = random.choice(words)
                self._defer_single_line(lambda: self.say(
                    line.format(song=self._song_label()), seconds=3.6, again=True))
            return
        if random.random() < 0.7:
            self.jump_t = 1.0
        words = self.lines_for_say("REACT_LINES")
        if words and random.random() < 0.6:
            line = random.choice(words)
            self._defer_single_line(lambda: self.say(line))

    def _double_click_window_ms(self):
        """双击判定窗口：跟系统设的双击间隔走，下限 500 毫秒、上限 800 毫秒。

        2026-09-14 之前这里写死 **380 毫秒** —— 比系统还严，手速慢一点的人双击
        会被拆成两次单击（多冒一句台词），误触很高。现在跟系统走，并且**下限提到
        500 毫秒**：这台机器控制面板里设的是 400 毫秒，只照系统来几乎等于没改。
        比窗口短 = 快速双击（撤销欠着的那句单击台词）；比窗口长 = 两次独立单击。
        """
        ms = 500
        try:
            ms = int(QApplication.doubleClickInterval()) or 500
        except Exception:
            pass
        return max(500, min(800, ms))

    def _defer_single_line(self, speak):
        """把单击要说的那句话记下来，等判定窗口过去再冒（窗口内双击就撤销）。"""
        self._single_pending = (self._secs() + self._double_click_window_ms() / 1000.0, speak)

    def _on_double_click(self):
        """快速双击：按一级菜单「快速双击」里选的那样冒一下（默认看 5 秒余额）。

        可选的四种：看一眼余额 / 看一眼天气 / 看一眼在放什么 / 说一句我写的台词。
        「看一眼余额」要配了 Key 才算数 —— 没配 Key 时**不会弹余额窗口**，
        还是原来的"换姿势"，并且只在本次启动里提醒一次怎么配。
        """
        # LLM 台词：双击事件也走插件（固定台词仅故障兜底）
        try:
            self._speech_request("doubleClick", {"phase": "doubleClick"})
        except Exception:
            pass
        # P1.5 联动小票：DSH 插件写 daily_receipt.txt，双击时优先念它（没有就退回原行为）
        try:
            _receipt = os.path.join(USER_DIR, "daily_receipt.txt")
            if os.path.exists(_receipt):
                with open(_receipt, "r", encoding="utf-8") as _rf:
                    _rlines = [ln.strip() for ln in _rf.read().splitlines() if ln.strip()]
                if _rlines:
                    self.action, self.action_t = "sway", 1.0
                    self.jump_t = max(self.jump_t, 0.6)
                    self.say("；".join(_rlines[:4]), seconds=6.0, again=True)
                    return
        except Exception:
            pass
        choice = self._double_click_choice()
        # 这几秒里先别自言自语（闲话会盖住刚弹出来的那一眼）；点它 / 拖它照旧有反应
        self._dc_hold_until = self._secs() + DOUBLE_CLICK_HOLD_SEC.get(choice, 3.0)
        if choice == "balance":
            self._double_click_balance()
            return
        # 其它三种：先把动作做出来（蹦一下 / 换个姿势），结果回来再冒泡
        self.action, self.action_t = random.choice(("sway", "stretch")), 1.0
        self.jump_t = max(self.jump_t, 0.6)
        if choice == "weather":
            self._get_weather()          # 后台查，回来冒 5 秒（放歌时也一样）
            return
        if choice == "music":
            self.check_music_now()
            return
        words = self.lines_for("DOUBLE_CLICK_LINES")
        if words:
            self.say(random.choice(words), seconds=4.0, again=True)

    def _double_click_choice(self):
        """快速双击这一项现在选的是哪个（老配置 / 手改坏了都退回默认）。"""
        choice = self.cfg.get("double_click") or DOUBLE_CLICK_DEFAULT
        return choice if choice in dict(DOUBLE_CLICK_CHOICES) else DOUBLE_CLICK_DEFAULT

    def _double_click_effect_label(self):
        """菜单里「快速双击=…」那句说明（跟着用户选的走）。"""
        choice = self._double_click_choice()
        if choice == "balance" and not self._double_click_sees_balance():
            return "看余额（要先配 Key，现在双击只换姿势）"
        return dict(DOUBLE_CLICK_CHOICES).get(choice, "")

    def _double_click_sees_balance(self):
        """双击现在是不是真的能看到余额（选了余额 + 配了 Key 才算）。"""
        return self._double_click_choice() == "balance" and bool(self._current_source()[1])

    def _double_click_menu_title(self):
        """一级菜单里「快速双击」那一项的标题（带着现在选的是什么）。"""
        if self._double_click_choice() == "balance" and not self._double_click_sees_balance():
            return "快速双击（现在：还没配 Key，双击只换姿势）"
        return "快速双击（现在：" + self._double_click_effect_label() + "）"

    def _double_click_balance(self):
        """双击要的那一眼余额：配了 Key 才给看（显示 5 秒）。"""
        name, key = self._current_source()
        if not key:
            self.action, self.action_t = random.choice(("sway", "stretch")), 1.0
            self.jump_t = max(self.jump_t, 0.6)
            if not self._key_hint_shown:
                self._key_hint_shown = True
                self.say(f"双击看余额要先填 {name} 的 Key：右键 →「余额 → 设置 Key」；"
                         f"也可以右键 →「快速双击」换成别的",
                         seconds=4.0, again=True)
            return
        if self.balance is not None:
            self._peek_balance(PEEK_SEC)                # 顶上来显示 5 秒
            return
        # 还没取到过：拉一把，结果回来会自动冒 5 秒（放歌时也一样）
        self._peek_pending = True
        self.refresh_balance(silent=False)


    def _get_weather(self):
        """联网查天气（后台线程，别卡住桌宠）。"""
        city = self.cfg.get("city", "汕头")

        def worker():
            got = fetch_weather(city)
            if got:
                temp, desc = got
                self._queue_say(f"{city}今天{temp}°，天气{desc}")
            else:
                self._queue_say("天气没查到，等会儿再试试")

        threading.Thread(target=worker, daemon=True).start()

    # ---------- 每轮 Codex 对话消耗 ----------
    def scan_codex_usage(self):
        """尾巴式读最新的 Codex 会话日志，按 turn 汇总 token 用量。"""
        if not self.turn_cost_on:
            return
        newest = None
        try:
            for root, _dirs, files in os.walk(self.codex_dir):
                for fn in files:
                    if not fn.endswith(".jsonl"):
                        continue
                    p = os.path.join(root, fn)
                    try:
                        m = os.path.getmtime(p)
                    except OSError:
                        continue
                    if newest is None or m > newest[0]:
                        newest = (m, p)
        except Exception:
            return
        if not newest:
            return

        path = newest[1]
        if path != self._codex_file:
            # 换文件了：从末尾开始，别把历史轮次当成本轮
            self._codex_file = path
            try:
                self._codex_pos = os.path.getsize(path)
            except OSError:
                self._codex_pos = 0
            self._codex_turn = None
            self._codex_tokens = {}
            return

        try:
            size = os.path.getsize(path)
            if size < self._codex_pos:      # 文件被截断/轮转
                self._codex_pos = 0
            if size > self._codex_pos:
                with open(path, "r", encoding="utf-8", errors="replace") as f:
                    f.seek(self._codex_pos)
                    for line in f:
                        self._ingest_codex_line(line)
                    self._codex_pos = f.tell()
        except OSError:
            return
        self._report_codex_turn()

    def _ingest_codex_line(self, line):
        if '"usage"' not in line and '"token_usage_record"' not in line and '"turn_context"' not in line:
            return
        try:
            obj = json.loads(line)
        except Exception:
            return
        payload = obj.get("payload") or {}
        # 轮次 id：Codex 用 turn_id；别的 agent 用 message.id / uuid / requestId
        turn = (payload.get("turn_id") or obj.get("turn_id")
                or payload.get("uuid") or obj.get("uuid") or obj.get("requestId"))
        if not turn:
            msg = obj.get("message")
            if isinstance(msg, dict):
                turn = msg.get("id")
        if not turn:
            turn = self._codex_turn or "current"      # 认不出轮次就靠"安静 20 秒"结算
        if turn != self._codex_turn:
            if self._codex_turn:                  # 上一轮结束了
                self._report_codex_turn(force=True)
            self._codex_turn = turn
        usage = (payload.get("turn_token_usage") or payload.get("usage")
                 or extract_usage(obj))
        if usage:
            prev = self._codex_tokens.get(turn)
            if not prev or (usage.get("total_tokens") or 0) >= (prev.get("total_tokens") or 0):
                self._codex_tokens[turn] = usage      # 累计值：取最大的那份
            else:
                merged = dict(prev)
                for k, v in usage.items():
                    if isinstance(v, (int, float)):
                        merged[k] = (prev.get(k) or 0) + v
                self._codex_tokens[turn] = merged
            self._codex_last_change = time.time()

    def _report_codex_turn(self, force=False):
        turn = self._codex_turn
        if not turn or turn in self._codex_reported:
            return
        if not force and time.time() - self._codex_last_change < CODEX_QUIET_S:
            return
        self._codex_reported.add(turn)
        if len(self._codex_reported) > 50:
            self._codex_reported = set(list(self._codex_reported)[-25:])
        amount, tokens = codex_usage_cost(self._codex_tokens.get(turn))
        if tokens:
            self.say(f"上一轮 {self.agent_name} 消耗 ¥{amount:.4f}（{tokens / 1000:.1f}k token）")


    def _add_tool_actions(self, menu, with_lengths=False):
        """免打扰 / 今日汇总 这两条（快捷菜单和经典菜单「百宝箱」共用）。

        with_lengths=True 时免打扰给几档时长（经典菜单位置宽裕），
        否则就一条"免打扰 N 分钟"（快捷菜单要保持短）。
        """
        if self.quiet_left() > 0:
            menu.addAction(f"结束免打扰（剩余 {fmt_duration(self.quiet_left())}）",
                           lambda: self.stop_quiet())
        elif with_lengths:
            for mins in (15, 30, 60, 120):
                menu.addAction(f"免打扰 {mins} 分钟",
                               lambda _=False, m=mins: self.start_quiet(m))
        else:
            mins = int(self.cfg.get("quiet_minutes") or QUIET_DEFAULT_MIN)
            menu.addAction(f"免打扰 {mins} 分钟",
                           lambda: self.start_quiet())
        menu.addAction("今日汇总", self.show_daily_summary)

    def show_daily_summary(self):
        """菜单里点「今日汇总」：把今天的小结冒出来看一眼。"""
        self.say(self.daily_summary() or "今天还没什么好总结的哦，先干点活嘛",
                 again=True, seconds=5.0)


    def _notify_console(self):
        """叫设置窗口把当前那一页重读一遍（城市这类"后台加进来"的东西要立刻反映）。

        窗口没开就是什么都不做 —— 下次打开它会自己现读（见 ConsoleWindow._refresh_page）。
        """
        win = getattr(self, "_console", None)
        if win is None:
            return
        try:
            win.refresh_pages()
        except Exception as exc:
            print("通知设置窗口刷新失败:", exc)

    def open_console(self):
        """打开设置窗口（菜单最上面那条「打开设置…」）。

        窗口是懒加载的：建一次就留着，再点只是抬到前面。
        """
        if ui_console is None:
            QMessageBox.warning(self, "设置", "界面模块没加载起来，看下启动时的报错。")
            return
        win = getattr(self, "_console", None)
        if win is not None:
            try:
                # 最小化着的话先播"还原动画"，别"啪"一下蹦出来
                win.restore_or_show()
                return
            except RuntimeError:          # 窗口已经被 Qt 收掉了，重建一个
                self._console = None
        ctx = {
            "ASSET_DIR": ASSET_DIR,
            "SPRITE_DIR": SPRITE_DIR,
            "BUNDLE_DIR": BUNDLE_DIR,
            "SIZE_LEVELS": SIZE_LEVELS,
            "size_percent": size_percent,
            "size_from_percent": size_from_percent,
            "SIZE_MIN": SIZE_MIN,
            "SIZE_MAX": getattr(self, "max_size", SIZE_MAX_DEFAULT),
            "LYRIC_OFFSET_LEVELS": LYRIC_OFFSET_LEVELS,
            "DOUBLE_CLICK_CHOICES": DOUBLE_CLICK_CHOICES,
            "PEAK_TEXT_STYLES": PEAK_TEXT_STYLES,
            "BUBBLE_STYLES": BUBBLE_STYLES,
            "LINE_FREQ_LEVELS": LINE_FREQ_LEVELS,
            "LINE_SECTIONS": LINE_SECTIONS,
            "SKIN_PET": SKIN_PET,
            "SKIN_WIDGET": SKIN_WIDGET,
            "LAYER_LABELS": dict(self.LAYER_LABELS),
            "currency_symbol": currency_symbol,
            "human_mb": human_mb,
        }
        self._console = ui_console.ConsoleWindow(self, ctx)
        # 设置窗口**不跟着桌宠的层级**：它就是个普通窗口，谁点谁在上面，
        # 不会被压在最上面碍事（打开时抬一下，够用了）。
        self._console.show()
        self._console.raise_()
        self._console.activateWindow()

    def set_balance_source(self, name):
        """切换余额来源（DeepSeek / 用户自己加的其他服务）。"""
        self.cfg["balance_source"] = name
        self.balance = None           # 换来源先清掉旧数据，免得数错
        self.save_config()
        self.refresh_balance(silent=False)

    def add_other_key_dialog(self):
        """添加别的服务的 API Key（例如 OpenRouter）。"""
        with self._ui_guard():
            name, ok = QInputDialog.getText(
                self, "添加其他 API Key",
                "服务名称（例如 OpenRouter / OpenAI / Kimi）:",
                QLineEdit.EchoMode.Normal, "", Qt.WindowType.WindowStaysOnTopHint)
        if not ok or not name.strip():
            return
        name = name.strip()
        with self._ui_guard():
            key, ok2 = QInputDialog.getText(
                self, f"{name} 的 API Key",
                f"粘贴 {name} 的 API Key（只存在本地 config.json）:",
                QLineEdit.EchoMode.Password, "", Qt.WindowType.WindowStaysOnTopHint)
        if not ok2 or not key.strip():
            return
        keys = [k for k in (self.cfg.get("other_keys") or []) if k.get("name") != name]
        keys.append({"name": name, "key": key.strip()})
        self.cfg["other_keys"] = keys
        self.cfg["balance_source"] = name
        self.save_config()
        self.say(f"记下 {name} 的 Key 了，我去看看")
        self.refresh_balance(silent=False)

    def remove_other_key_dialog(self):
        keys = list(self.cfg.get("other_keys") or [])
        if not keys:
            self.say("还没有添加别的 Key 呢")
            return
        names = [k.get("name", "?") for k in keys]
        with self._ui_guard():
            pick, ok = QInputDialog.getItem(self, "删除其他 API Key", "删掉哪个？",
                                            names, 0, False,
                                            Qt.WindowType.WindowStaysOnTopHint)
        if not ok or not pick:
            return
        self.cfg["other_keys"] = [k for k in keys if k.get("name") != pick]
        if (self.cfg.get("balance_source") or "DeepSeek") == pick:
            self.cfg["balance_source"] = "DeepSeek"
            self.balance = None
        self.save_config()
        self.say(f"已删除 {pick} 的 Key")
        self.refresh_balance(silent=True)

    def _set_key_dialog(self):
        with self._ui_guard():
            key, ok = QInputDialog.getText(
                self,
                "设置 DeepSeek Key",
                "输入你的 API Key（从 platform.deepseek.com 获取）:",
                QLineEdit.EchoMode.Normal,
                self.cfg.get("ds_api_key", ""),
                Qt.WindowType.WindowStaysOnTopHint
            )
        if ok and key.strip():
            self.cfg["ds_api_key"] = key.strip()
            self.say("Key 设置成功！我看看还剩多少钱")
            self.refresh_balance(silent=False)
        elif ok and not key.strip():
            self.say("Key 不能为空")

    def calibrate_usage_dialog(self):
        """按 DeepSeek 开放平台用量页的数字校准「今日已用」。

        余额差值记账遇到赠送额度到期 / 桌宠关着漏采就算不出真实用量，
        这里让主人把平台那个数填进来对齐（账本会留一笔 calibrateLog）。
        """
        cur = float((self.balance or {}).get("today") or 0.0)
        with self._ui_guard():
            text, ok = QInputDialog.getText(
                self,
                "校准今日已用",
                "输入 DeepSeek 开放平台 →「用量信息」页今天显示的消费金额（元）：\n"
                f"（桌宠现在记的是 ¥{cur:.2f}；平台那个数只在你账号里看得到，我拿不到）",
                QLineEdit.EchoMode.Normal,
                f"{cur:.2f}",
                Qt.WindowType.WindowStaysOnTopHint
            )
        if not ok:
            return
        raw = (text or "").strip().replace("¥", "").replace("￥", "").replace(",", "")
        try:
            amount = float(raw)
        except ValueError:
            self.say("这个数我没看懂，填个数字就行（例如 14.83）")
            return
        if amount < 0:
            self.say("金额不能是负的呀")
            return
        res = calibrate_balance_usage(USAGE_PATH, amount, "菜单里按平台用量页手动校准")
        if self.balance is not None:
            self.balance["today"] = res["today"]
        self.say(f"今日已用校准成 ¥{res['today']:.2f} 啦（原来记的是 ¥{res['was']:.2f}）",
                 seconds=4.5, again=True)
        self.show_balance_bubble(5.0)

    def _on_tray_activated(self, reason):
        if reason == QSystemTrayIcon.ActivationReason.Context:
            self._tray_menu = self._make_menu()      # 留引用，别被回收
            self.tray.setContextMenu(self._tray_menu)
        elif reason == QSystemTrayIcon.ActivationReason.Trigger:
            self.toggle_visible()
        elif reason == QSystemTrayIcon.ActivationReason.DoubleClick:
            # 救急通道：万一穿透了又找不到菜单，双击托盘图标直接解除
            was_passthrough = self.cfg.get("passthrough", False)
            if was_passthrough:
                self.set_passthrough(False)
            self.force_recover()          # 顺手把可能残留的"让位"状态也清掉
            self.say("穿透解除了，我回来啦" if was_passthrough else "我在这儿呢")

    # ---------- 百宝箱：内存回收 ----------
    def mem_trim_now(self):
        """「百宝箱 → 回收内存」：后台把工作集收一遍，回来报个数（不卡住桌宠）。"""
        if self._mem_trimming:
            self.say("还在收拾呢，等我一下下嘛")
            return
        self._mem_trimming = True
        skip_fg = bool(self.cfg.get("mem_skip_foreground", True))
        self.say("我先给内存收拾收拾哦…")

        def worker():
            skip_exes = []
            if skip_fg:
                fg = foreground_process_name()     # 正在用的程序不动，收了它得重新读一遍
                if fg:
                    skip_exes.append(fg)
            try:
                got = trim_working_sets(skip_pids={os.getpid()}, skip_exes=skip_exes)
            except Exception as exc:               # 兜底：别让后台线程把桌宠带崩
                got = {"error": str(exc)}
            self._mem_queue.append(got)

        threading.Thread(target=worker, daemon=True).start()

    def _mem_trim_done(self, got):
        """回收结果回到主线程：冒个泡报数（菜单里那行"上次…"也在这儿记）。"""
        self._mem_trimming = False
        if not got or got.get("error"):
            self.say("没收拾成，等会儿再试试")
            return
        n = int(got.get("trimmed") or 0)
        freed = int(got.get("freed") or 0)
        extra = int(got.get("avail_after") or 0) - int(got.get("avail_before") or 0)
        self._mem_last = (n, freed)
        if not n:
            self.say("这会儿干干净净的，没什么好收拾")
            return
        line = f"收拾好啦：{n} 个程序腾出 {human_mb(freed)}"
        if extra > 16 * 1024 * 1024:
            line += f"，可用内存多出 {human_mb(extra)}"
        self.say(line, seconds=4.0, again=True)

    def set_mem_skip_foreground(self, on):
        """回收时要不要连前台程序一起收（默认不收：收了前台可能会顿一下）。"""
        self.cfg["mem_skip_foreground"] = bool(on)
        self.save_config()
        self.say("回收时不动你正在用的程序" if on else "回收时前台程序也一起收，可能会顿一下")


    @staticmethod
    def _menu_icon_lookup(table, text):
        """在一张 (前缀, 图标) 表里挑最合适的一条（取最长的前缀；没有就空串）。"""
        best, name = -1, ""
        for prefix, icon_name in table:
            if text.startswith(prefix) and len(prefix) > best:
                best, name = len(prefix), icon_name
        return name


    def _iconize_menu(self, menu, color=None, inherit=""):
        """给一棵菜单（连各级子菜单）按 MENU_ICONS 配上图标。

        颜色取**菜单自己的文字色**：右键菜单是系统画的，亮 / 暗跟着系统走，
        写死一个颜色总有一边看不清。界面模块没起来就跳过（菜单照常能用）。

        inherit 是"父项那个图标"：子项没单独写在 MENU_ICONS 里就跟着父项
        （所以"大小"下面的迷你 / 小 / 中…也会带上同一个图案）。
        """
        if ui_console is None:
            return
        if color is None:
            try:
                from PySide6.QtGui import QPalette
                color = menu.palette().color(QPalette.ColorRole.WindowText).name()
            except Exception:
                color = "#5a5a64"
        for act in menu.actions():
            if act.isSeparator():
                continue
            sub = act.menu()
            name = self._menu_icon_name(act.text()) or inherit
            if not name:
                if sub is not None:
                    self._iconize_menu(sub, color, "")
                continue
            try:
                act.setIcon(ui_console.icon(name, color, ui_console.ICON_SM))
            except Exception:
                pass
            if sub is not None:
                child = self._menu_icon_lookup(MENU_ICON_CHILD, act.text()) or name
                self._iconize_menu(sub, color, child)

    def _install_place_fix(self, menu):
        """给这棵菜单树里每一层都装上"一显示就摆正"的过滤器（重复调用没关系）。"""
        if getattr(self, "_place_fix", None) is None:
            self._place_fix = SubmenuPlaceFix(self)
        for m in self._all_menus(menu):
            if getattr(m, "_dfy_placefix", False):
                continue
            m._dfy_placefix = True
            try:
                m.installEventFilter(self._place_fix)
            except RuntimeError:
                continue

    def _deepest_menu_at_cursor(self):
        """光标所在的最里面那层菜单（按窗口矩形找，不依赖"父项"链）。"""
        root = getattr(self, "_menu_keepalive", None)
        if root is None:
            return None
        pos = QCursor.pos()
        best, best_depth = None, -1
        for menu in self._all_menus(root):
            try:
                if not menu.isVisible():
                    continue
                top_left = menu.mapToGlobal(QPoint(0, 0))
            except RuntimeError:
                continue
            if (top_left.x() <= pos.x() <= top_left.x() + menu.width()
                    and top_left.y() <= pos.y() <= top_left.y() + menu.height()):
                depth = getattr(menu, "_dfy_depth", 0)
                if depth >= best_depth:
                    best, best_depth = menu, depth
        return best

    def _all_menus(self, menu, out=None):
        """把一棵菜单树里的所有菜单（含子菜单）列出来。"""
        out = out if out is not None else []
        out.append(menu)
        try:
            actions = menu.actions()
        except RuntimeError:
            return out
        for act in actions:
            child = act.menu()
            if child is not None:
                self._all_menus(child, out)
        return out

    def _send_move_to(self, menu):
        """给某一层菜单补一份鼠标移动事件。"""
        pos = QCursor.pos()
        self._send_move_point(menu, pos)


    def _highlight_menu_item(self, menu, pos=None):
        """把"光标下这一条"设成菜单的选中项（也就是高亮那一行）。

        这台机器上 Qt 的弹出菜单收不到真正的鼠标移动，Qt 自己就不会更新高亮 ——
        表现就是"快速上下移动时选择卡住"。这里由我们按光标位置点一下。
        """
        try:
            if not menu.isVisible():
                return
        except RuntimeError:
            return
        act = self._menu_action_at(menu, pos or QCursor.pos(), self.MENU_TRIGGER_MARGIN_X)
        if act is None:
            return
        try:
            if menu.activeAction() is not act:
                menu.setActiveAction(act)
        except RuntimeError:
            pass

    def _send_move_point(self, menu, pos):
        """把某个坐标的鼠标移动塞给指定菜单。"""
        """往某一层菜单里塞一个指定位置（全局坐标）的鼠标移动。"""
        pos = QPoint(pos)
        local = menu.mapFromGlobal(pos)
        if not menu.rect().contains(local):
            return
        self._forwarding_move = True
        try:
            QApplication.sendEvent(menu, QMouseEvent(
                QEvent.Type.MouseMove, QPointF(local), QPointF(pos),
                Qt.MouseButton.NoButton, Qt.MouseButton.NoButton,
                Qt.KeyboardModifier.NoModifier))
        except Exception:
            pass
        finally:
            self._forwarding_move = False


    def _show_flyout(self, sub, where):
        if self._flyout is None:
            self._build_flyout()
        if self._flyout_action is not sub:
            self._fill_flyout(sub)
            self._flyout_action = sub
        try:
            self._flyout.move(where)
            self._flyout.show()
            self._flyout.raise_()
        except RuntimeError:
            self._flyout = None
            return
        self._flyout_leave_at = 0.0

    def _build_flyout(self):
        w = QWidget(None, Qt.WindowType.Tool | Qt.WindowType.FramelessWindowHint
                    | Qt.WindowType.WindowStaysOnTopHint)
        lay = QVBoxLayout(w)
        lay.setContentsMargins(4, 4, 4, 4)
        lay.setSpacing(1)
        w.setStyleSheet(
            "QWidget#flyout { background: #ffffff; border: 1px solid #c8c8d0; border-radius: 8px; }"
            "QToolButton { border: none; text-align: left; padding: 5px 12px; background: transparent; }"
            "QToolButton:hover { background: #eaeaf2; border-radius: 5px; }"
            "QLabel { color: #8a8a99; padding: 3px 10px; }")
        w.setObjectName("flyout")
        self._flyout = w
        self._flyout_layout = lay

    def _fill_flyout(self, sub):
        lay = self._flyout_layout
        while lay.count():
            item = lay.takeAt(0)
            w = item.widget()
            if w is not None:
                w.deleteLater()
        for act in sub.actions():
            if act.isSeparator():
                line = QFrame()
                line.setFrameShape(QFrame.Shape.HLine)
                line.setStyleSheet("color: #dcdce4;")
                lay.addWidget(line)
                continue
            nested = self._sub_of.get(act)
            if nested is not None:
                group = act.text().rstrip().rstrip("▸").strip()
                lay.addWidget(QLabel("— " + group + " —"))
                for sub_act in nested.actions():
                    if sub_act.isSeparator() or self._sub_of.get(sub_act) is not None:
                        continue
                    self._add_flyout_button(lay, sub_act, prefix=group)
                continue
            self._add_flyout_button(lay, act)
        self._flyout.adjustSize()

    def _add_flyout_button(self, lay, act, prefix=""):
        btn = QToolButton()
        txt = (prefix + "：" if prefix else "") + act.text()
        if act.isCheckable() and act.isChecked():
            txt = "✓ " + txt
        btn.setText(txt)
        btn.setEnabled(act.isEnabled())
        btn.setToolButtonStyle(Qt.ToolButtonStyle.ToolButtonTextOnly)

        def go():
            self._hide_flyout()
            try:
                act.trigger()
            except Exception:
                pass
            root = getattr(self, "_menu_keepalive", None)
            if root is not None:
                try:
                    root.close()
                except Exception:
                    pass

        btn.clicked.connect(go)
        lay.addWidget(btn)

    def _hide_flyout(self):
        if self._flyout is not None:
            try:
                self._flyout.hide()
            except RuntimeError:
                self._flyout = None
        self._flyout_action = None

    def submenu_under_cursor(self):
        """光标所在的子菜单（不含最上层那个菜单）；没有就返回 None。"""
        root = getattr(self, "_menu_keepalive", None)
        if root is None:
            return None
        pos = QCursor.pos()
        best, best_depth = None, 0
        for menu in self._all_menus(root):
            if menu is root:
                continue
            try:
                if not menu.isVisible():
                    continue
                top_left = menu.mapToGlobal(QPoint(0, 0))
            except RuntimeError:
                continue
            if (top_left.x() <= pos.x() <= top_left.x() + menu.width()
                    and top_left.y() <= pos.y() <= top_left.y() + menu.height()):
                depth = getattr(menu, "_dfy_depth", 1)
                if depth >= best_depth:
                    best, best_depth = menu, depth
        return best

    def activate_menu_item(self, menu):
        """点击落在子菜单上时，由我们自己执行那一项（Windows 不会把点击送给子菜单）。"""
        pos = QCursor.pos()
        act = menu.actionAt(menu.mapFromGlobal(pos))
        menu_debug(f"[点击] 层级{getattr(menu, '_dfy_depth', '?')} 光标={pos} "
                   f"光标下={'（没有项）' if act is None else act.text()}")
        if act is None or not act.isEnabled() or act.isSeparator():
            return
        menu_debug(f"[点击] 触发 {act.text()}")
        try:
            if act.menu() is not None:              # 还有下一层 → 展开它
                sub = act.menu()
                sub.popup(self._submenu_pos(menu, act, sub))     # 同样按"和本级重叠"放
                return
            # 先关菜单、下一拍再执行这一项：如果这一项要弹窗口（音量/透明度/加音效…），
            # 直接在原生消息回调里 exec() 会被菜单的关闭动作吃掉（窗口一闪就没）。
            root0 = getattr(self, "_menu_keepalive", None)
            if root0 is not None:
                try:
                    root0.close()
                except Exception:
                    pass
            QTimer.singleShot(0, act.trigger)
            return
        except Exception:
            return
        root = getattr(self, "_menu_keepalive", None)
        if root is not None:
            try:
                root.close()                        # 选完了，把菜单收起来
            except Exception:
                pass


    def _keep_submenu_alive(self, obj):
        """光标正从这一项往子菜单平移（短暂在菜单外面）时，给子菜单喂一个贴边的位置。

        Qt 靠"鼠标是不是还在子菜单里"来决定收不收；这台机器上子菜单收不到鼠标消息，
        Qt 就每 300ms 收一次 —— 用户根本来不及移过去点。这里替它把"鼠标还在"报上去。
        """
        pos = QCursor.pos()
        for act in obj.actions():
            sub = act.menu()
            if sub is None:
                continue
            try:
                if not sub.isVisible():
                    continue
                top_left = sub.mapToGlobal(QPoint(0, 0))
                size = sub.size()
            except RuntimeError:
                continue
            if self._point_near_rect(pos, top_left, size):
                cx = min(max(pos.x(), top_left.x() + 6), top_left.x() + size.width() - 6)
                cy = min(max(pos.y(), top_left.y() + 6), top_left.y() + size.height() - 6)
                self._send_move_point(sub, QPoint(cx, cy))
                return True
        return False

    @staticmethod
    def _point_near_rect(pos, top_left, size, margin=80):
        return (top_left.x() - margin <= pos.x() <= top_left.x() + size.width() + margin
                and top_left.y() - margin <= pos.y() <= top_left.y() + size.height() + margin)

    def _find_submenu_parent(self, sub, menu=None):
        """找出"这个子菜单是被哪一层菜单的哪一项打开的"。"""
        menu = menu or getattr(self, "_menu_keepalive", None)
        if menu is None:
            return None
        try:
            actions = menu.actions()
        except RuntimeError:
            return None
        for act in actions:
            child = act.menu()
            if child is None:
                continue
            if child is sub:
                return (menu, act)
            found = self._find_submenu_parent(sub, child)
            if found is not None:
                return found
        return None

    def _reshow_submenu(self, sub):
        """子菜单被 Qt 收掉后立刻补弹回来（光标还在附近才补）。"""
        """子菜单被 Qt 收掉后立刻补弹回来（光标还在附近才补）。"""
        parent, action = self._sub_parent.get(sub, (None, None))
        if parent is None or action is None:
            return
        try:
            if not parent.isVisible():
                self._sub_parent.pop(sub, None)
                return
            top_left = sub.mapToGlobal(QPoint(0, 0))
            size = sub.size()
            if not self._point_near_rect(QCursor.pos(), top_left, size, margin=120):
                self._sub_parent.pop(sub, None)
                self._hover_subs.pop(sub, None)
                return
            parent.setActiveAction(None)
            parent.setActiveAction(action)
            self._hover_subs[sub] = {"at": time.time(), "parent": parent, "action": action}
        except RuntimeError:
            self._sub_parent.pop(sub, None)

    def _detach_submenus(self, menu):
        """把带子菜单的项和它的子菜单拆开：Qt 不再弹子菜单，改由我们的浮窗显示。

        Qt 的弹出式子菜单在这台机器上收不到鼠标移动/点击 —— 会自己闪、点了没反应。
        所以这里把子菜单摘下来（setMenu(None)），只在项的文字后面加个 "▸" 提示，
        真正展开交给自绘的普通窗口（_show_flyout），点起来和普通窗口一样可靠。
        """
        for act in menu.actions():
            sub = act.menu()
            if sub is None:
                continue
            self._detach_submenus(sub)
            self._sub_of[act] = sub
            act.setMenu(None)
            if not act.text().rstrip().endswith("▸"):
                act.setText(act.text() + "  ▸")
            # 点它 → 弹一个小选择框（和"添加城市"用的是同一种组件，这台机器上点击没问题）
            act.triggered.connect(lambda _checked=False, a=act: self._pick_submenu(a))

    def _pick_submenu(self, act):
        """点带 ▸ 的项：弹一个选择框列出它下面的项目（含再往下一层）。"""
        sub = self._sub_of.get(act)
        if sub is None:
            return
        title = act.text().rstrip().rstrip("▸").strip()
        options, table = [], {}
        for child in sub.actions():
            if child.isSeparator():
                continue
            nested = self._sub_of.get(child)
            if nested is not None:
                group = child.text().rstrip().rstrip("▸").strip()
                for deep in nested.actions():
                    if deep.isSeparator() or self._sub_of.get(deep) is not None:
                        continue
                    label = f"{group}：{deep.text()}"
                    options.append(label)
                    table[label] = deep
                continue
            label = child.text()
            options.append(label)
            table[label] = child
        if not options:
            return
        with self._ui_guard():
            pick, ok = QInputDialog.getItem(self, title, "选一个：", options, 0, False,
                                            Qt.WindowType.WindowStaysOnTopHint)
        if ok and pick and pick in table:
            target = table[pick]
            QTimer.singleShot(0, target.trigger)     # 等对话框收掉再执行

    def _watch_menu_tree(self, menu, depth=0):
        """给菜单和它所有子菜单装事件过滤器：记录点击 / 展开 / 收起。"""
        if getattr(menu, "_dfy_watched", False):
            return
        menu._dfy_watched = True
        menu._dfy_depth = depth
        menu.installEventFilter(self)
        for act in menu.actions():
            if act.menu() is not None:
                self._watch_menu_tree(act.menu(), depth + 1)
            try:
                act.triggered.connect(
                    lambda _checked=False, a=act: menu_debug(f"[触发] {a.text()}"))
            except Exception:
                pass

    def eventFilter(self, obj, ev):
        """菜单事件的排查日志（只在 MENU_DEBUG 打开时写文件）。"""
        if (isinstance(obj, QMenu) and ev.type() == QEvent.Type.Show
                and getattr(obj, "_dfy_depth", 0) > 0 and obj not in self._sub_parent):
            found = self._find_submenu_parent(obj)
            if found is not None:
                self._sub_parent[obj] = found
        if (isinstance(obj, QMenu) and ev.type() == QEvent.Type.Hide
                and obj in self._sub_parent):
            # 子菜单被 Qt 收掉了：只要光标还在它附近，立刻原地弹回来
            QTimer.singleShot(0, lambda m=obj: self._reshow_submenu(m))
        if isinstance(obj, QMenu) and not self._forwarding_move:
            t = ev.type()
            if MENU_DEBUG and t in (QEvent.Type.MouseButtonPress, QEvent.Type.MouseButtonRelease,
                                    QEvent.Type.MouseMove, QEvent.Type.Show, QEvent.Type.Hide):
                try:
                    pos = (round(ev.position().x()), round(ev.position().y()))
                except Exception:
                    pos = None
                act = None
                try:
                    a = obj.actionAt(obj.mapFromGlobal(QCursor.pos()))
                    act = a.text() if a else None
                except Exception:
                    pass
                line = (f"[Qt菜单{getattr(obj, '_dfy_depth', '?')}] {t.name} pos={pos} "
                        f"光标={QCursor.pos()} 光标下={act} 可见={obj.isVisible()}")
                if t == QEvent.Type.MouseMove:
                    menu_debug_throttled(line, 250)
                else:
                    menu_debug(line)
            if t in (QEvent.Type.MouseButtonPress, QEvent.Type.MouseButtonRelease):
                deepest = self._deepest_menu_at_cursor()
                if deepest is not None and deepest is not obj:
                    # 光标明明在子菜单上，但点击被 Windows 送给了上层菜单（捕获在上层）。
                    # 所以这里干脆自己处理：找到光标下那一项，放开时执行它 / 展开它的下一层。
                    if t == QEvent.Type.MouseButtonRelease:
                        self.activate_menu_item(deepest)
                    return True
            if t in (QEvent.Type.MouseMove, QEvent.Type.Leave):
                deepest = self._deepest_menu_at_cursor()
                if deepest is not None and deepest is not obj:
                    # 光标其实在最里面那层菜单里：把移动转给它，并且**别让外层菜单看到** ——
                    # 外层看到"光标跑到自己外面"就会把子菜单收掉。
                    self._send_move_to(deepest)
                    return True
                open_sub = any(a.menu() is not None and a.menu().isVisible()
                               for a in obj.actions())
                if t == QEvent.Type.MouseMove and open_sub:
                    # 光标可能正从这一项往子菜单平移：先给子菜单喂个"贴边"的位置，
                    # 让它知道鼠标还在附近，Qt 就不会急着收。
                    if self._keep_submenu_alive(obj):
                        return True
                if t == QEvent.Type.Leave and open_sub:
                    # 还有子菜单开着：光标是从这一项往子菜单平移的路上（多半会短暂跑到菜单外面），
                    # 这时候千万不能让上级菜单"因为光标离开"把子菜单收掉 —— 用户就是在这儿点不中的。
                    # 真要收，交给 _menu_hover_watch 的 0.5 秒宽限去判断。
                    return True
                if open_sub:
                    # 同理：光标不在这一层里（正往子菜单平移）时，连鼠标移动也压住，
                    # 否则上级菜单照样会把它当成"鼠标走了"。
                    try:
                        if not obj.rect().contains(obj.mapFromGlobal(QCursor.pos())):
                            return True
                    except Exception:
                        pass
        if MENU_DEBUG and isinstance(obj, QMenu):
            depth = getattr(obj, "_dfy_depth", 0)
            t = ev.type()
            if t in (QEvent.Type.MouseButtonPress, QEvent.Type.MouseButtonRelease,
                     QEvent.Type.Show, QEvent.Type.Hide):
                try:
                    pos = (round(ev.position().x()), round(ev.position().y()))
                except Exception:
                    pos = None
                act = None
                if pos is not None:
                    a = obj.actionAt(obj.mapFromGlobal(QCursor.pos()))
                    act = a.text() if a else None
                menu_debug(f"{'  ' * depth}[菜单{depth}] {t.name} pos={pos} 光标下={act} "
                           f"可见={obj.isVisible()}")
        return super().eventFilter(obj, ev)

    def _demote_topmost(self, on):
        """菜单打开期间把自己降到非置顶（菜单关了再按设定层级还原）。"""
        try:
            HWND_TOPMOST, HWND_NOTOPMOST = -1, -2
            SWP_NOSIZE, SWP_NOMOVE, SWP_NOACTIVATE = 0x0001, 0x0002, 0x0010
            if on:
                after = HWND_NOTOPMOST
            elif self.layer == "top":
                after = HWND_TOPMOST
            else:
                after = None
            if after is None:
                return
            ctypes.windll.user32.SetWindowPos(
                ctypes.c_void_p(int(self.winId())), ctypes.c_void_p(after),
                0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE)
        except Exception:
            pass



    def _place_shown_submenu(self, sub):
        """子菜单刚显示：立刻摆到"贴住这一条"的位置（同一帧，不留位移痕迹）。"""
        found = self._find_submenu_parent(sub)
        if found is None:
            return
        parent, holder = found
        try:
            if not parent.isVisible():
                return
            want = self._submenu_pos(parent, holder, sub)
            cur = sub.pos()
            if abs(cur.x() - want.x()) > 2 or abs(cur.y() - want.y()) > 2:
                sub.move(want)
                menu_debug(f"[兜底] 子菜单一显示就摆正：{holder.text()} "
                           f"({cur.x()},{cur.y()}) → ({want.x()},{want.y()})")
        except RuntimeError:
            return

    def _close_orphan_submenus(self):
        """根菜单已经关了，却还有子菜单挂在屏幕上 → 收掉。

        实测：Qt 偶尔不跟着把子菜单一起收（`root.close()` 之后二级菜单还在），
        而这个残留弹窗会把**下一次右键**挡掉（右键没反应，菜单弹不出来）。
        """
        root = getattr(self, "_menu_keepalive", None)
        if root is None:
            return
        try:
            if root.isVisible():
                return              # 这棵树还开着，别动
        except RuntimeError:
            return
        for sub in self._all_menus(root)[1:]:
            try:
                if sub.isVisible():
                    sub.close()
                    menu_debug("[兜底] 收掉残留的子菜单")
            except RuntimeError:
                continue


    def force_recover(self):
        """救急：把"给菜单让位"的状态强行收回来。

        万一哪个菜单窗口没关干净（残留一个"可见"的菜单），桌宠就会一直保持在
        "鼠标穿透 + 不置顶"里 —— 看起来就是"桌宠不见了、也点不到"。
        这个函数把残留菜单关掉、状态复位，再把自己亮出来。
        """
        for menu in list(self._menu_pool) + list(self._hover_subs):
            try:
                if menu.isVisible():
                    menu.close()
            except Exception:
                pass
        self._menu_pool = []
        self._hover_subs.clear()
        self._hover_key = None
        self._sub_rect = {}
        self._resub = {}
        self._dialog_open = False
        self.ui_open = False
        self._through_applied = False
        self._demote_topmost(False)
        self._apply_passthrough(bool(self.cfg.get("passthrough", False)))   # 按用户自己的设置还原
        if not self.isVisible():
            self.show()
        self.raise_()
        self._apply_layer()

    def _sync_overlay_state(self):
        """按"现在到底有没有菜单/对话框开着"纠正让位状态。

        只靠 aboutToShow / aboutToHide 信号不可靠：实测漏过一次 —— 菜单已经关了，
        aboutToHide 却没来，于是桌宠一直停在"鼠标穿透 + 不置顶"的状态，点也点不回来。
        这里每 120ms 按真实可见性对账，漏了信号也能自己恢复。
        """
        visible_menus = []
        for menu in self._menu_pool:
            try:
                if menu.isVisible():
                    visible_menus.append(menu)
            except RuntimeError:          # 老菜单对象可能已经被回收
                continue
        visible = bool(self._dialog_open) or bool(visible_menus)
        if visible != self.ui_open:
            self.ui_open = visible
            self._demote_topmost(visible)
        # 注意：**不要**让桌宠在菜单期间变成鼠标穿透。
        # 试过两版（整窗穿透 / 光标压在菜单上才穿透）都会出问题：右键桌宠时点击穿到桌面，
        # 弹出了 Windows 桌面的右键菜单。菜单压在桌宠上面的部分，靠"把桌宠降到非置顶"就够了。
        if self._through_applied:
            self._through_applied = False
            self._menu_click_through(False)

    def set_menu_debug(self, on):
        """菜单排查日志开关（菜单里那一项）：打开后菜单的动作、位置自愈都写进 menu-debug.log。"""
        global MENU_DEBUG_RUNTIME
        on = bool(on)
        MENU_DEBUG_RUNTIME = on
        self.cfg["menu_debug"] = on
        if on:
            try:
                with open(MENU_DEBUG_LOG, "w", encoding="utf-8") as f:
                    f.write(f"=== 大肥鱼桌宠 菜单日志 {datetime.now():%Y-%m-%d %H:%M:%S} ===\n")
            except Exception:
                pass
            self.say("菜单日志开着呢，出问题以后跟我说一声就行")
        else:
            self.say("菜单日志关啦")

    MENU_TRIGGER_MARGIN_X = 0       # 方案 1 已弃用（主人选方案 2）：不再放宽触发范围
    MENU_OVERLAP = 9                # v1.0.10 方案 2：子菜单和上一级菜单重叠的像素（16 → 12 → 9，两次各减 25%）




    def _ensure_chain_open(self, deep):
        """把 deep 以上的祖先菜单逐个保住：Qt 把哪一层收掉了，就重新展开哪一层。"""
        chain = []
        cur = deep
        for _ in range(5):
            found = self._find_submenu_parent(cur)
            if found is None:
                break
            chain.append(found)
            cur = found[0]
        for parent, holder in reversed(chain):
            try:
                sub = holder.menu()
                if sub is not None and not sub.isVisible() and parent.isVisible():
                    sub.popup(self._submenu_pos(parent, holder, sub))   # 直接补弹（setActiveAction 不一定生效）
                    menu_debug(f"[兜底] 补回上一层：{holder.text()}")
            except RuntimeError:
                continue


    def _prune_branches(self):
        """一次只留一支：光标所在的那一支留着，旁边那些残留的子菜单收掉。

        没有这条对账，会出现"光标已经跑到别的条目上、上一支的子菜单还挂在屏幕上"
        （实测：形象那一支挂在「层级」旁边，把「层级」的子菜单挡了个正着）。
        """
        root = getattr(self, "_menu_keepalive", None)
        if not self.ui_open or root is None:
            return
        deep = self._deepest_menu_at_cursor()
        if deep is None:
            return                      # 光标在空档里（0.35 秒宽限中）→ 什么都别动
        keep = None
        if self._keep is not None:
            try:
                keep = self._keep[1].menu()
            except RuntimeError:
                keep = None
        self._prune_menu(root, deep, keep)

    def _prune_menu(self, menu, deep, keep):
        for act in menu.actions():
            try:
                child = act.menu()
            except RuntimeError:
                continue
            if child is None:
                continue
            try:
                if not child.isVisible():
                    continue
            except RuntimeError:
                continue
            if self._menu_covers(child, deep) or self._menu_covers(child, keep):
                self._prune_menu(child, deep, keep)
            else:
                self._close_menu_tree(child)

    def _close_menu_tree(self, menu):
        """把这一支子菜单（含它下面的）全收掉。"""
        try:
            for act in menu.actions():
                child = act.menu()
                if child is not None:
                    self._close_menu_tree(child)
        except RuntimeError:
            return
        self._close_submenu(menu)

    @staticmethod
    def _close_submenu(sub):
        try:
            if sub is not None and sub.isVisible():
                sub.close()
        except Exception:
            pass

    def _open_classic_menu(self):
        """把完整版老菜单按老样子弹出来（设置窗口「通用」里那个"看一眼"用它）。"""
        m = self._make_menu(classic=True)
        try:
            m.exec(QCursor.pos())
        finally:
            self._sync_overlay_state()

    def set_classic_menu(self, on):
        """右键菜单用哪一份：瘦身版（默认）还是旧版那份完整菜单。"""
        self.cfg["classic_menu"] = bool(on)
        self.save_config()
        self.say("右键菜单换成旧版那份了（功能全，但很长）" if on
                 else "右键菜单回到瘦身版了", seconds=3.0, again=True)

    def set_minimize_target(self, point):
        """记下"设置窗口最小化动画往哪儿收"的屏幕坐标（在「通用」页校准）。"""
        try:
            x, y = int(point[0]), int(point[1])
        except (TypeError, ValueError, IndexError):
            return
        self.cfg["minimize_target"] = [x, y]
        self.save_config()

    def _open_menu(self, pos):
        """弹右键菜单。

        用 exec() 走 Qt 的弹出菜单模态循环：二级菜单能正常悬停展开、贴屏幕边缘时
        也会自动往反方向弹。之前用 popup + 定时 raise_() 会把子菜单顶掉，
        鼠标离开一级菜单整个菜单就消失，所以改回 exec()；菜单开着的时候
        桌宠本身也不再抢置顶（见 _keep_on_top），不会被压住。
        """
        m = self._make_menu()
        try:
            m.exec(pos)
        finally:
            # 保险：菜单没触发 aboutToHide 也要把状态收回来
            self._sync_overlay_state()

    def _ui_guard(self):
        """对话框期间用的上下文管理器：桌宠站住不动，免得盖住对话框。"""
        pet = self

        class _Guard:
            def __enter__(self):
                pet.ui_open = True
                pet._dialog_open = True
                pet._demote_topmost(True)

            def __exit__(self, *exc):
                pet._dialog_open = False
                pet._sync_overlay_state()
                return False

        return _Guard()


    # ---------- 功能 ----------
    def set_mode(self, mode):
        self.mode = mode
        self.target = None
        self.cfg["mode"] = mode
        if mode == "still":
            self._still_face_front()   # 切到「原地待着」立刻站正，不用等下一帧
        self.update()

    def set_still_face_cursor(self, on):
        """「原地待着时也跟着鼠标转」开关（当前形象都生效：大肥鱼会转侧面，挂件会左右翻）。"""
        self.still_face_cursor = bool(on)
        self.cfg["still_face_cursor"] = bool(on)
        self.update()

    def set_balance_always(self, on):
        self.balance_always = bool(on)
        self.cfg["balance_always"] = bool(on)
        if on and self.balance is None:
            self.refresh_balance(silent=False)
        self.update()

    def set_show_peak(self, on):
        self.show_peak = bool(on)
        self.cfg["show_peak"] = bool(on)
        self.update()

    def set_peak_style(self, style):
        if style not in PEAK_TEXT_STYLES:
            return
        self.peak_style = style
        self.cfg["peak_style"] = style
        self.update()

    def set_bubble_style(self, style):
        """气泡风格：跟随界面 / 浅色 / 深色（语录、余额、歌词三种气泡一起换）。"""
        if style not in dict(BUBBLE_STYLES):
            return
        self.bubble_style = style
        self.cfg["bubble_style"] = style
        # 歌词的颜色是烘在排版缓存里的，换了风格得让缓存重算一遍
        self._lyric_layout_key = None
        self._lyric_prev_key = None
        self._bubble_theme_cache = None        # auto 那个 1 秒的缓存也清掉，换风格立刻生效
        self.update()
        self.save_config()
        self.say("气泡换成"
                 + {"auto": "跟着界面走", "light": "浅色", "dark": "深色"}.get(style, "浅色")
                 + "啦")

    def set_line_freq(self, name):
        """语录频率：安静 / 正常 / 话多 / 话痨（管的是"闲着时自己冒话"的频率）。"""
        if name not in LINE_FREQ_LEVELS:
            return
        self.line_freq = name
        self.cfg["line_freq"] = name
        self.last_speak_tick = self.t          # 让新档位马上生效，不用等旧冷却
        # 切档时说的这句话本身也能在「台词内容…」里改写（LINE_GROUPS 里那四条）
        words = self.lines_for_say(f"FREQ_LINES_{name}")
        if words:
            self.say(random.choice(words), seconds=3.0, again=True)

    def set_double_click(self, key):
        """快速双击弹哪个窗口：余额 / 天气 / 在放什么 / 我写的台词。

        余额这一项**配了 Key 才能选** —— 没配 Key 时直接选了也不给存（双击不会弹余额窗口）。
        """
        if key not in dict(DOUBLE_CLICK_CHOICES):
            return
        if key == "balance" and not self._current_source()[1]:
            self.say("看余额要先配 Key：右键 →「余额 → 设置 Key」，配好再回来选这一项",
                     seconds=4.0, again=True)
            return
        self.cfg["double_click"] = key
        self.save_config()
        self.say(f"好，以后快速双击 → {dict(DOUBLE_CLICK_CHOICES)[key]}", seconds=3.0, again=True)

    # ---------- 层级 / 透明度 ----------
    LAYER_LABELS = {"top": "置顶", "bottom": "置底（在壁纸之上）", "normal": "普通层"}

    def set_layer(self, layer):
        """top = 始终置顶；bottom = 沉到所有窗口下面（但仍在壁纸/桌面之上）；normal = 普通。"""
        if layer not in self.LAYER_LABELS:
            return
        self.layer = layer
        self.cfg["layer"] = layer
        self.cfg["topmost"] = (layer == "top")
        self._apply_layer()
        self.say({"top": "我回到最上面啦",
                  "bottom": "我到最下面了（壁纸上面那种）",
                  "normal": "我站在普通层，谁点谁在上面"}[layer])

    def _apply_layer(self):
        """用 Win32 精确摆放层级：HWND_TOPMOST / HWND_BOTTOM / HWND_NOTOPMOST。"""
        try:
            HWND_TOPMOST, HWND_NOTOPMOST, HWND_BOTTOM = -1, -2, 1
            SWP_NOSIZE, SWP_NOMOVE, SWP_NOACTIVATE = 0x0001, 0x0002, 0x0010
            after = {"top": HWND_TOPMOST, "bottom": HWND_BOTTOM,
                     "normal": HWND_NOTOPMOST}.get(self.layer, HWND_TOPMOST)
            ctypes.windll.user32.SetWindowPos(
                ctypes.c_void_p(int(self.winId())), ctypes.c_void_p(after),
                0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE)
        except Exception:
            pass

    def set_opacity(self, value):
        """整体透明度 0.2 ~ 1.0（太低就看不见了，所以留个下限）。"""
        value = max(0.2, min(1.0, float(value)))
        self.opacity = value
        self.cfg["opacity"] = value
        self.setWindowOpacity(value)

    # ---------- 音量 / 透明度的小窗口（菜单里内嵌滑块在这台机器上拖不动，改成弹窗） ----------
    def _slider_dialog(self, title, tip_text, lo, hi, value, on_change, extra=None):
        """一个带滑块的小窗口：**拖动立刻生效**。

        为什么不用菜单里内嵌的滑块：这台机器上 Qt 的弹出子菜单收不到鼠标消息，
        嵌在里面的滑块拖不动（主人反馈"透明度和音效音量无法调整"就是这个原因）。
        """
        dlg = QDialog(self)
        dlg.setWindowTitle(title)
        dlg.setWindowFlag(Qt.WindowType.WindowStaysOnTopHint, True)
        dlg.setMinimumWidth(380)
        if ui_console:                      # 跟设置窗口用同一套配色
            ui_console.style_dialog(dlg, BUNDLE_DIR)
        lay = QVBoxLayout(dlg)
        tip = QLabel(tip_text)
        tip.setWordWrap(True)
        lay.addWidget(tip)
        row = QHBoxLayout()
        slider = QSlider(Qt.Orientation.Horizontal)
        slider.setRange(lo, hi)
        slider.setValue(value)
        slider.setMinimumWidth(240)
        row.addWidget(slider, 1)
        num = QLabel(f"{value}%")
        num.setFixedWidth(52)
        row.addWidget(num)
        lay.addLayout(row)
        btns = QHBoxLayout()
        if extra:
            b = QPushButton(extra[0])
            b.clicked.connect(extra[1])
            btns.addWidget(b)
        btns.addStretch(1)
        close_btn = QPushButton("关闭")
        close_btn.clicked.connect(dlg.accept)
        btns.addWidget(close_btn)
        lay.addLayout(btns)

        def changed(v):
            num.setText(f"{v}%")
            on_change(v / 100.0)

        slider.valueChanged.connect(changed)
        with self._ui_guard():
            dlg.exec()

    def volume_dialog(self):
        """音效音量：拖动立刻生效，顺手能试听一声。"""
        self._slider_dialog(
            "音效音量",
            f"拖动滑块调点击音效的音量（现在 {int(self.volume * 100)}%），拖的时候立刻生效。",
            0, 100, int(round(self.volume * 100)), self.set_volume,
            extra=("试听一声", self.preview_sounds))

    def opacity_dialog(self):
        """桌宠透明度：拖动立刻生效（20% 是下限，再低就看不见了）。"""
        self._slider_dialog(
            "桌宠透明度",
            f"拖动滑块调桌宠整体透明度（20% ~ 100%，现在 {int(self.opacity * 100)}%）。",
            20, 100, int(round(self.opacity * 100)), self.set_opacity)

    def size_dialog(self):
        """大小无级调节：滑块拖到哪儿就多大，原来那五档还在菜单里点一下就到。

        百分数以「大」档为 100%（也就是 306px 高）；范围 20% ~ 150%。
        """
        cur = size_percent(self.cfg.get("size", SIZE_DEFAULT))
        self._slider_dialog(
            "大小（无级调节）",
            f"拖动滑块无级调大小（{size_percent(SIZE_MIN)}% ~ {size_percent(getattr(self, 'max_size', SIZE_MAX_DEFAULT))}%，"
            "100% 就是「大」那一档那么大）：拖着的时候它当场变大变小，"
            "而且是原地缩放（脚底和中心不动，不会满屏乱窜）；松手就记住，"
            "菜单里的「迷你 / 特小 / 小 / 中 / 大」五档照旧点一下就到。",
            size_percent(SIZE_MIN), size_percent(getattr(self, "max_size", SIZE_MAX_DEFAULT)), cur,
            lambda pct: self.set_size(size_from_percent(pct)))

    def set_process_alerts(self, on):
        self.process_alerts = bool(on)
        self.cfg["process_alerts"] = bool(on)
        if on:
            self.say("好哦，你开什么我都盯着（才不是偷看呢）")

    def set_app_time_on(self, on):
        """用久了提醒的总开关（每个应用具体说多久、说什么在 app_time_lines 里）。"""
        self.cfg["app_time_on"] = bool(on)
        if on:
            self.say("好嘛，用久了我会喊你歇歇")

    def set_timed_on(self, on):
        """到点说一句的总开关。"""
        self.cfg["timed_on"] = bool(on)
        if on:
            self.say("到点我会吱一声的，放心")

    def set_hotkeys_on(self, on):
        """全局快捷键的总开关（关掉就把已经注册的键还给系统）。"""
        self.cfg["hotkeys_on"] = bool(on)
        self._register_hotkeys()
        if on:
            bad = self.hotkey_failed_texts()
            self.say("快捷键好啦，按一下试试嘛" if not bad
                     else f"快捷键里这几个被占用了：{'、'.join(bad)}")

    def set_back_greet(self, on):
        """离开一阵子回来打个招呼（台词在「台词内容 → 离开一阵子回来时」）。"""
        self.cfg["back_greet"] = bool(on)
        if on:
            self.say("好哦，你回来我一定第一时间发现", seconds=2.5)

    def set_fullscreen_silent(self, on):
        """全屏（打游戏 / 看电影）时闭嘴：提醒先攒着，退出全屏再报。"""
        self.cfg["fullscreen_silent"] = bool(on)
        if not on:
            self._fs_now = False
            self._held_lines = []

    def set_quiet_minutes(self, minutes):
        try:
            self.cfg["quiet_minutes"] = max(1, int(minutes))
        except (TypeError, ValueError):
            pass

    def set_perf_mode(self, on):
        """性能模式：动画优先，开设置菜单也不掉帧；休闲模式：省 CPU，可掉一点帧。

        休闲模式把帧间隔从 20ms 放到 40ms（50 帧 → 25 帧）；动作是按同一个内部时钟
        换算的，所以走的速度、气泡停留时间都不变，只是画面更"省"。
        """
        self.perf_mode = bool(on)
        self.cfg["perf_mode"] = bool(on)
        self.tick_ms = TICK if self.perf_mode else TICK * 2
        self.timer.setInterval(self.tick_ms)
        self.say("好，动画优先，菜单开着也不卡" if on else "行，省点资源，掉几帧没关系",
                 again=True)
        self.update()

    def set_music_link(self, on):
        """音乐联动总开关：关掉就不再读媒体会话。"""
        self.music_on = bool(on)
        self.cfg["music_link"] = bool(on)
        if on:
            self.say("好，你去放歌，我帮你看歌词")
            self.poll_music()
        else:
            self.now_playing = None
            self._lyric_key = ""
            self._lyric_lines = []
            self._lyric_words = {}
            self.say("行，那我不听了")
        self.update()

    def set_music_lyrics(self, on):
        """歌词内容开关：关掉只挂个歌名，不再请求歌词。"""
        self.music_lyrics = bool(on)
        self.cfg["music_lyrics"] = bool(on)
        if on and self.now_playing and self._lyric_key and not self._lyric_lines \
                and not self._lyric_fetching:
            self._start_lyric_fetch(self._lyric_key, self.now_playing)


    def set_lyric_offset(self, offset):
        """歌词对时：正数 = 文字延后（等一下声音），负数 = 文字提前。"""
        try:
            offset = float(offset)
        except (TypeError, ValueError):
            return
        self.lyric_offset = offset
        self.cfg["lyric_offset"] = offset
        self.update()
        tip = "歌词跟声音对齐啦" if abs(offset) < 1e-6 else (
            f"歌词{'延后' if offset > 0 else '提前'} {abs(offset):.1f} 秒")
        self.say(tip + "（觉得还对不上就再调一档）", seconds=3.2, again=True)
        self.update()

    # ---------- 这首歌的歌词微调（网易云不报播放进度，中途才开始看就只能手动对一次） ----------

    def align_lyric_dialog(self):
        """按播放器上显示的时间对一次表（网易云不报进度，这是最准的手动办法）。"""
        cur = self._music_position()
        tip = (f"输入播放器上现在显示的进度（例如 1:35）。\n"
               f"桌宠现在算的是 {int(cur // 60)}:{int(cur % 60):02d}，"
               f"填对了歌词立刻就对齐（这首歌会记住这个位置）。")
        with self._ui_guard():
            text, ok = QInputDialog.getText(
                self, "按播放器的时间对齐歌词", tip, QLineEdit.EchoMode.Normal, "",
                Qt.WindowType.WindowStaysOnTopHint)
        if not ok or not (text or "").strip():
            return
        secs = parse_mmss(text)
        if secs is None:
            self.say("这个时间没看懂，写成 1:35 这样就行", seconds=3.2, again=True)
            return
        self.set_lyric_anchor(secs)

    def set_lyric_anchor(self, seconds):
        """把"这首歌现在放到第几秒"设成指定值（网易云不给进度时的手动对表）。"""
        self._music_played = max(0.0, float(seconds))
        self._music_tick_at = time.time()
        if self._lyric_key:
            self._music_pos_memo[self._lyric_key] = self._music_played
        self.update()
        self.say(f"好，按 {int(self._music_played // 60)}:"
                 f"{int(self._music_played % 60):02d} 对齐啦", seconds=3.2, again=True)

    def nudge_lyric(self, delta, absolute=False):
        """把歌词整体往前赶 / 往后压几秒（只影响这一首歌，按歌记住）。"""
        try:
            delta = float(delta)
        except (TypeError, ValueError):
            return
        base = delta if absolute else float(getattr(self, "_lyric_nudge", 0.0)) + delta
        self._lyric_nudge = max(-20.0, min(20.0, base))
        if self._lyric_key:
            self._lyric_nudges[self._lyric_key] = self._lyric_nudge
        self.update()
        n = self._lyric_nudge
        tip = "这首歌的歌词微调清零了" if abs(n) < 1e-6 else (
            f"歌词{'往前赶' if n > 0 else '往后压'}了 {abs(n):.1f} 秒")
        self.say(tip + "（对上了就不用再动）", seconds=3.2, again=True)

    def set_snap(self, on):
        self.snap_on = bool(on)
        self.cfg["snap_on"] = bool(on)
        if not on:
            self.snap_h = self.snap_v = None
            self.flip_x = False
        self.update()

    def set_flip_on_left(self, on):
        self.flip_on_left = bool(on)
        self.cfg["flip_on_left"] = bool(on)
        if not on:
            self.flip_x = False
        self.update()

    def set_locked(self, on):
        """锁定位置：固定在原地 —— 点它、双击它、右键菜单都照常，就是拖着不动了。

        防的是"想点一下结果把桌宠拖跑了"这种误触。想让它连散步都不散，用
        模式 →「原地待着」；这里只管"拖不动"。
        """
        self.locked = bool(on)
        self.cfg["locked"] = bool(on)
        self.dragging = False
        self._drag_blocked = False
        self.drag_offset = None
        self.drag_start_pos = None
        self.save_config()
        self.say("锁定啦，我就在这儿不动了（右键 →「锁定位置」可以解锁）" if on
                 else "解锁了，又能拖着我走了",
                 seconds=3.0, again=True)
        self.update()

    def set_turn_cost(self, on):
        self.turn_cost_on = bool(on)
        self.cfg["turn_cost_on"] = bool(on)

    def set_size(self, mult):
        """设大小：菜单里那五档和"无级调节"的滑块都走这里。

        两个细节：
        · 五档以外的高度现补精灵（`_ensure_sprites`），顺手把多余的高度清掉（`_prune_sprites`）；
        · 变大小是"原地缩放"：脚底和中心不动，免得滑块一拖它整只往下出溜。
        """
        mult = self._clamp_size(mult)
        self.cfg["size"] = mult
        self.cross_t = 0.0
        self.prev_key = None
        old_x, old_y = self.x(), self.y()
        old_w, old_h = self.width(), self.height()
        self.cur_h = int(340 * mult)
        if getattr(self, "_webm", None) is not None:
            try:
                self._webm.setSize(self._webm_height())
                self._webm_sync_main()
            except Exception:
                pass
        self._prune_sprites(self.cur_h)
        self._ensure_sprites(self.cur_h)
        self._apply_window_size()
        if old_w:                      # 建窗口那一趟（还没摆位）不用动位置
            self.move(int(old_x + old_w / 2 - self.width() / 2),
                      int(old_y + old_h - self.height()))
        self.snap_into_screen()

    def _apply_window_size(self):
        """按当前档位摆好窗口：精灵宽度 + 两边留白，但不小于 MIN_WIN_W（气泡要放得下字）。

        为什么要有个最窄宽度：新加的「迷你 / 特小」两档精灵很窄（几十像素），
        如果窗口跟着一起变窄，余额气泡就会被挤成一列竖着的字。
        """
        try:
            spec_w = max(p.width() for k, p in self.sprites.items() if k[1] == self.cur_h)
        except ValueError:
            spec_w = 0
        self.win_mx = int(self.cur_h * 0.062) + 6
        self.win_w = max(spec_w + self.win_mx * 2, MIN_WIN_W)
        self.setFixedSize(self.win_w, self.cur_h + self.bubble_h + MARGIN * 2 + 10)

    def _window_screen(self):
        """窗口中心所在屏幕；跨屏时以中心为准，避免半只在另一块屏。"""
        try:
            scr = QApplication.screenAt(self.frameGeometry().center())
        except Exception:
            scr = None
        return scr or self.screen() or QApplication.primaryScreen()

    def _ensure_on_screen(self):
        """窗口若跨屏/出界，整窗夹回当前屏幕可用区域（多显示器边界 bug）。"""
        scr = self._window_screen()
        if scr is None:
            return
        geo = scr.availableGeometry()
        if geo.contains(self.frameGeometry()):
            return
        x = max(geo.left(), min(geo.right() - self.width() + 1, self.x()))
        y = max(geo.top(), min(geo.bottom() - self.height() + 1, self.y()))
        self.move(x, y)
        try:
            self._settle(geo)
        except Exception:
            pass

    def snap_into_screen(self):
        geo = (self._window_screen() or QApplication.primaryScreen()).availableGeometry()
        x = max(geo.left(), min(geo.right() - self.width(), self.x()))
        y = max(geo.top(), min(geo.bottom() - self.height(), self.y()))
        self.move(x, y)
        self._settle(geo)

    def _keep_on_top(self):
        """定期把自己顶到置顶窗口的最前面（SWP_NOACTIVATE，不抢焦点）。

        有的窗口（例如 Codex 主窗口）本身也是置顶的，两个置顶窗口重叠时就按 z 序排，
        不主动提一下的话桌宠会被盖住。

        但每次 SetWindowPos 都会让合成器重排一次 Z 序 —— 按住鼠标拖动窗口时做这个，
        就会明显卡顿掉帧（主人反馈过）。所以这里加两道闸：
        ① 正在按住鼠标（拖窗口 / 拖文件）时什么都不做；
        ② 只有真的被另一个"置顶窗口"压住时才动，平时不白折腾。
        """
        if (not self.cfg.get("topmost", True) or not self.isVisible()
                or self.ui_open):     # 菜单/对话框开着时别抢，免得盖住设置面板
            return
        try:
            if ctypes.windll.user32.GetAsyncKeyState(0x01) & 0x8000:   # 左键按着 = 正在拖
                return
        except Exception:
            pass
        try:
            GW_HWNDPREV, GWL_EXSTYLE, WS_EX_TOPMOST = 3, -20, 0x00000008
            user32 = ctypes.windll.user32
            user32.GetWindow.restype = ctypes.c_void_p
            above = user32.GetWindow(ctypes.c_void_p(int(self.winId())), GW_HWNDPREV)
            if above:
                ex = user32.GetWindowLongPtrW(ctypes.c_void_p(above), GWL_EXSTYLE)
                if not (int(ex) & WS_EX_TOPMOST):
                    return               # 上面那个不是置顶窗口 → 我们本来就是最上面的，不用动
        except Exception:
            pass
        try:
            self.raise_()          # 先把窗口抬到同类窗口最前面
        except Exception:
            pass
        try:
            SWP_NOSIZE, SWP_NOMOVE, SWP_NOACTIVATE = 0x0001, 0x0002, 0x0010
            ctypes.windll.user32.SetWindowPos(
                ctypes.c_void_p(int(self.winId())),
                ctypes.c_void_p(-1),          # HWND_TOPMOST（必须按指针传，直接传 -1 会被截断）
                0, 0, 0, 0,
                SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE)
        except Exception:
            pass

    def _apply_passthrough(self, on):
        hwnd = int(self.winId())
        GWL_EXSTYLE = -20
        style = ctypes.windll.user32.GetWindowLongPtrW(hwnd, GWL_EXSTYLE)
        style = click_through_style(style, self.ui_open, bool(on))
        ctypes.windll.user32.SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style)

    def set_passthrough(self, on):
        self.cfg["passthrough"] = bool(on)
        self._apply_passthrough(bool(on))
        self.save_config()               # 立刻落盘，免得重启后又变回穿透状态
        if on:
            self.say("我隐身啦！右键托盘图标 → 鼠标穿透 可以解除（双击托盘图标也行）")

    def set_topmost(self, on):
        self.cfg["topmost"] = bool(on)
        self.setWindowFlag(Qt.WindowType.WindowStaysOnTopHint, bool(on))
        self.show()

    def set_autostart(self, on):
        self.cfg["autostart"] = bool(on)
        lnk = os.path.join(os.environ["APPDATA"], "Microsoft", "Windows",
                           "Start Menu", "Programs", "Startup", "大肥鱼桌宠.lnk")
        try:
            if on:
                ps = ("$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{}');"
                      "$s.TargetPath='{}';$s.Arguments='\"{}\"';$s.WorkingDirectory='{}';$s.Save()"
                      .format(lnk, PYTHONW,
                              "" if getattr(sys, "frozen", False) else os.path.join(APP_DIR, "pet_app.py"),
                              APP_DIR))
                subprocess.run(["powershell", "-NoProfile", "-Command", ps],
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), check=True)
                self.say("已开机自启，明天见～")
            else:
                if os.path.exists(lnk):
                    os.remove(lnk)
                self.say("已取消开机自启")
        except Exception as ex:
            QMessageBox.warning(self, "开机自启", f"设置失败：{ex}")

    def toggle_visible(self):
        if self.isVisible():
            self.hide()
        else:
            self.show()
            self.raise_()

    def quit_app(self):
        self._unregister_hotkeys()        # 全局快捷键要还给系统，不然退出后这个键就废了
        try:
            self.app_time_flush()         # 今天用了多久：退出前落一次盘
        except Exception:
            pass
        self.cfg["x"], self.cfg["y"] = self.x(), self.y()
        self.save_config()
        if getattr(self, "_console", None) is not None:
            try:
                self._console.close()
            except Exception:
                pass
        self.tray.hide()
        QApplication.quit()


SINGLE_INSTANCE_KEY = "dafeiyu-pet-whale-single-instance"






# ── task-152：机械抽离模块回填（PetWindow/常量仍在本文；符号名保持兼容）──
import pet_utils as _pet_utils
for _k, _v in vars(_pet_utils).items():
    if not _k.startswith('__'):
        globals()[_k] = _v
import pet_services as _pet_services
for _k, _v in vars(_pet_services).items():
    if not _k.startswith('__'):
        globals()[_k] = _v
import pet_dialogs as _pet_dialogs
for _k, _v in vars(_pet_dialogs).items():
    if not _k.startswith('__'):
        globals()[_k] = _v
import pet_mixins as _pet_mixins
for _m in (_pet_utils, _pet_services, _pet_dialogs, _pet_mixins):
    _m.__dict__.update({k: v for k, v in globals().items() if not k.startswith('__')})
