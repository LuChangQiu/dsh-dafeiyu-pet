#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""pet 侧 LLM 台词请求队列单测（临时目录/假时钟，无 Qt）。

运行：python scripts/test-speech-requests.py
覆盖：原子写/id 唯一/≤50 裁剪/context 白名单/连续事件 id 不重复/
健康 4.5s 与离线 1.5s 兜底/收到 say 取消兜底/损坏文件恢复/兜底池非空。
"""
import json
import os
import shutil
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'pet'))

from speech_requests import (  # noqa: E402
    FALLBACK_LINES,
    KINDS,
    MAX_ITEMS,
    SpeechRequestQueue,
    build_queue,
)

ok = 0
fail = 0


def check(name, cond, detail=''):
    global ok, fail
    if cond:
        ok += 1
        print('PASS %s%s' % (name, (' · ' + detail) if detail else ''))
    else:
        fail += 1
        print('FAIL %s%s' % (name, (' · ' + detail) if detail else ''))


tmp = tempfile.mkdtemp(prefix='speech-test-')
try:
    path = os.path.join(tmp, 'speech-requests.json')
    clock = {'t': 1000.0}
    ids = {'n': 0}

    def now():
        return clock['t']

    def make_id(_now):
        ids['n'] += 1
        return 'pet-test-%d' % ids['n']

    q = SpeechRequestQueue(path, now_fn=now, id_fn=make_id)
    check('KINDS 覆盖点击/双击/摸头/夸/喂食/叫她/偷吃被抓',
          {'click', 'doubleClick', 'pat', 'praise', 'feed', 'come',
           'sneakCaught', 'stealCaught'} <= set(KINDS))
    check('兜底池非空', all(FALLBACK_LINES.get(k) for k in ('click', 'pat', 'celebrate')))

    item = q.enqueue('click', {'phase': 'click', 'mood': 2})
    check('返回请求对象', isinstance(item, dict) and item['kind'] == 'click')
    check('文件已原子写', os.path.exists(path) and not os.path.exists(path + '.tmp'))
    data = json.load(open(path, encoding='utf-8'))
    check('落盘格式 {id,kind,context,at}', set(data[0]) == {'id', 'kind', 'context', 'at'})
    check('context 保留白名单键', data[0]['context'] == {'phase': 'click', 'mood': 2})
    # 连续点击：每个事件 id 唯一
    item2 = q.enqueue('click', {'phase': 'click'})
    data = json.load(open(path, encoding='utf-8'))
    check('连续点击都写盘', len(data) == 2)
    check('连续点击 id 不重复', data[0]['id'] != data[1]['id'])

    # context 过滤：禁止文本/路径/参数，仅枚举/数值/布尔
    q2 = SpeechRequestQueue(path, now_fn=now, id_fn=make_id)
    it = q2.enqueue('pat', {'phase': 'pat', 'userText': '我的密码是 123', 'path': 'C:\\secret',
                            'toolType': 'bash', 'energy': 5, 'night': True, 'other': {'a': 1}})
    check('context 只留白名单键', set(it['context']) == {'phase', 'toolType', 'energy', 'night'}, str(it['context']))
    json.dump([{'id': 'x', 'kind': 'click', 'context': {}, 'at': 'x'}] * (MAX_ITEMS + 5),
              open(path, 'w', encoding='utf-8'))
    q3 = SpeechRequestQueue(path, now_fn=now, id_fn=make_id)
    q3.enqueue('click', {})
    data = json.load(open(path, encoding='utf-8'))
    check('数组裁到 ≤50 条', len(data) == MAX_ITEMS, str(len(data)))

    # 兜底：健康 4.5s / 离线 1.5s
    clock['t'] = 2000.0
    q4 = SpeechRequestQueue(path, now_fn=now, id_fn=make_id)
    q4.enqueue('click')
    check('健康时 4.4s 不兜底', q4.fallback_due(now() + 4.4, last_pipe_at=now()) is None)
    due = q4.fallback_due(now() + 4.6, last_pipe_at=now())
    check('健康时 4.6s 兜底', due is not None and due[1] == 'llm_timeout', str(due))
    check('兜底后 pending 清空', q4.pending is None)
    q4.enqueue('pat')
    due = q4.fallback_due(now() + 1.6, last_pipe_at=now() - 120)
    check('离线时 1.6s 兜底', due is not None and due[1] == 'pipe_offline', str(due))

    # 收到 say 回复 → 取消兜底
    q4.enqueue('praise')
    q4.on_reply()
    check('收到回复后不兜底', q4.fallback_due(now() + 99, last_pipe_at=now()) is None)

    # P1：健康覆盖（桥接生命状态）——插件正常但静默 >30s 时仍等 4.5s
    clock['t'] = 3000.0
    qh = SpeechRequestQueue(path, now_fn=now, id_fn=make_id)
    qh.enqueue('click')
    check('P1 健康覆盖：旧 last_pipe 也不 1.5s 兜底', qh.fallback_due(now() + 2.0, last_pipe_at=now() - 100, healthy=True) is None)
    check('P1 健康覆盖：4.6s 才兜底', qh.fallback_due(now() + 4.6, last_pipe_at=now() - 100, healthy=True) is not None)
    qh.enqueue('pat')
    check('P1 离线覆盖：1.6s 兜底', qh.fallback_due(now() + 1.6, last_pipe_at=now(), healthy=False) is not None)
    # P2：context 枚举收紧（非枚举文本丢弃）
    qe = SpeechRequestQueue(path, now_fn=now, id_fn=make_id)
    it = qe.enqueue('click', {'phase': '点击一下', 'subkind': 'head', 'toolType': 'bash', 'mood': 2})
    check('P2 context 非枚举文本丢弃', it['context'] == {'subkind': 'head', 'toolType': 'bash', 'mood': 2}, str(it['context']))

    # 损坏文件可恢复
    open(path, 'w', encoding='utf-8').write('{not-json')
    q5 = SpeechRequestQueue(path, now_fn=now, id_fn=make_id)
    q5.enqueue('come', {})
    data = json.load(open(path, encoding='utf-8'))
    check('损坏文件恢复为数组', isinstance(data, list) and data[-1]['kind'] == 'come')

    # build_queue 路径
    bq = build_queue(tmp, now_fn=now, id_fn=make_id)
    check('build_queue 指向 speech-requests.json', bq.path.endswith('speech-requests.json'))
finally:
    shutil.rmtree(tmp, ignore_errors=True)

print('\n%s speech-requests: %d passed, %d failed' % ('PASS' if fail == 0 else 'FAIL', ok, fail))
sys.exit(0 if fail == 0 else 1)
