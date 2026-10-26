# -*- coding: utf-8 -*-
"""pet 侧 LLM 台词请求队列（task-133，纯逻辑，无 Qt/DSH 依赖）。

契约见 deliverables/pet-integration/verify/LLM-SPEECH-QUEUE.md：
- 写 <pet-work>/speech-requests.json：JSON 数组（≤50 条），每项 {id,kind,context,at}；
- 原子写：先写 .tmp 再 os.replace；
- context 只允许枚举/数值/布尔白名单键，禁止用户文本/路径/参数；
- 插件正常时抑制本地固定台词；收到 say: 取消本地兜底；
- 兜底：管道健康等 4.5s、离线等 1.5s（可配），失败记 fallbackReason。

本模块不依赖 pet 运行环境，便于假时钟/临时目录单测。
"""

import json
import os
import random
import time

KINDS = (
    'click', 'doubleClick', 'praise', 'pat', 'feed', 'come', 'sneakCaught',
    'stealCaught', 'report', 'approvalWait', 'waitingInput', 'greet', 'sleep',
    'inner', 'selfTalk', 'celebrate',
)
CONTEXT_KEYS = (
    'phase', 'subkind', 'toolType', 'mood', 'energy', 'relation', 'mode',
    'count', 'hourBucket', 'night', 's0',
)
MAX_ITEMS = 50
DEFAULT_TIMEOUT_HEALTHY_MS = 4500
DEFAULT_TIMEOUT_OFFLINE_MS = 1500

# 仅故障兜底用的本地池（正常路径不该被用户看到）
FALLBACK_LINES = {
    'click': ('诶嘿～', '戳我干嘛呀', '在呢在呢'),
    'doubleClick': ('这么想我呀', '双击也没糖哦'),
    'praise': ('嘿嘿，被你夸到了', '真的吗～'),
    'pat': ('摸摸头…舒服', '头发要乱啦'),
    'feed': ('好吃！', '谢谢投喂～'),
    'come': ('来啦来啦', '叫我呀？'),
    'sneakCaught': ('没、没偷吃！', '被抓到了…'),
    'stealCaught': ('就尝一小口…', '别告诉别人哦'),
    'report': ('今天也辛苦啦', '账我记着呢'),
    'approvalWait': ('我在等你的确认哦', '你点一下嘛'),
    'waitingInput': ('我在等你～', '慢慢来，不急'),
    'greet': ('早上好呀', '你来啦～'),
    'sleep': ('困了…先眯一会', '晚安…'),
    'inner': ('（发会呆…）', '（在想事情）'),
    'selfTalk': ('今天也要加油呀', '有点无聊…'),
    'celebrate': ('完成啦！', '干得漂亮～'),
}


def _sanitize_context(ctx):
    out = {}
    if not isinstance(ctx, dict):
        return out
    for k, v in ctx.items():
        if k not in CONTEXT_KEYS:
            continue
        if isinstance(v, bool):
            out[k] = bool(v)
        elif isinstance(v, (int, float)):
            out[k] = v
        elif isinstance(v, str):
            # 只允许短枚举字符串，防止把用户文本带进队列
            s = v.strip()[:24]
            if s and len(s) <= 24:
                out[k] = s
    return out


def _make_id(now):
    return 'pet-%d-%04x' % (int(now * 1000), random.randint(0, 0xFFFF))


class SpeechRequestQueue:
    def __init__(self, path, now_fn=None, id_fn=None, rng=None,
                 timeout_healthy_ms=DEFAULT_TIMEOUT_HEALTHY_MS,
                 timeout_offline_ms=DEFAULT_TIMEOUT_OFFLINE_MS):
        self.path = path
        self._now = now_fn or time.time
        self._id = id_fn or _make_id
        self.rng = rng or random.Random()
        self.timeout_healthy_ms = int(timeout_healthy_ms)
        self.timeout_offline_ms = int(timeout_offline_ms)
        self.pending = None        # {'id','kind','fallback','at','timeout_ms'}
        self.last_kind = ''
        self.last_at = 0.0
        self.last_fallback_reason = ''

    # ---------- 文件 ----------
    def _read(self):
        try:
            with open(self.path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            return data if isinstance(data, list) else []
        except (OSError, ValueError):
            return []

    def _write_atomic(self, items):
        try:
            os.makedirs(os.path.dirname(self.path) or '.', exist_ok=True)
            tmp = self.path + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(items[-MAX_ITEMS:], f, ensure_ascii=False)
            os.replace(tmp, self.path)
            return True
        except OSError:
            return False

    # ---------- 请求 ----------
    def enqueue(self, kind, context=None):
        """写一条请求（每次事件一条、id 唯一；去重由调用方保证同一事件只调一次）。"""
        kind = str(kind)
        if kind not in KINDS:
            kind = 'click'
        now = self._now()
        item = {
            'id': self._id(now),
            'kind': kind,
            'context': _sanitize_context(context),
            'at': time.strftime('%Y-%m-%dT%H:%M:%S', time.localtime(now)),
        }
        items = self._read()
        items.append(item)
        ok = self._write_atomic(items)
        if not ok:
            return None
        self.last_kind, self.last_at = kind, now
        self.pending = {
            'id': item['id'], 'kind': kind,
            'fallback': self.fallback_line(kind),
            'at': now,
        }
        return item

    def on_reply(self):
        """收到插件 say: 回复 → 取消本地兜底。"""
        self.pending = None

    def mark_offline(self):
        self.pending = None

    # ---------- 兜底 ----------
    def healthy(self, last_pipe_at, now=None):
        now = self._now() if now is None else now
        try:
            return (now - float(last_pipe_at)) <= 30.0
        except (TypeError, ValueError):
            return False

    def fallback_due(self, now, last_pipe_at):
        """超时兜底：返回 (文本, 原因)；未到期返回 None；收到回复后 pending=None。"""
        p = self.pending
        if not p:
            return None
        now = float(now)
        if self.healthy(last_pipe_at, now):
            timeout_ms = self.timeout_healthy_ms
        else:
            timeout_ms = self.timeout_offline_ms
        if (now - p['at']) * 1000.0 < timeout_ms:
            return None
        reason = 'pipe_offline' if timeout_ms == self.timeout_offline_ms else 'llm_timeout'
        self.pending = None
        self.last_fallback_reason = reason
        return (p['fallback'], reason)

    def fallback_line(self, kind):
        pool = FALLBACK_LINES.get(str(kind)) or FALLBACK_LINES['click']
        return pool[self.rng.randrange(len(pool))]


def build_queue(pet_work_dir, **kw):
    path = os.path.join(pet_work_dir, 'speech-requests.json')
    return SpeechRequestQueue(path, **kw)
