# -*- coding: utf-8 -*-
"""B 映射单测：approval/waiting 等 DSH 语义不得映射到禁用牌子；
50 clip 全部保留；peek 优先级实现存在。
"""
import json
import os
import re
import sys

ROOT = str(__import__('pathlib').Path(__file__).resolve().parents[1])
WORK = r'E:\project\AI提效\tool\pet-integration-src\pet-work'
sys.path.insert(0, os.path.join(ROOT, 'pet'))
os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')

import webm_body as wb  # noqa: E402

PASS = 0
FAIL = 0


def check(name, cond):
    global PASS, FAIL
    if cond:
        PASS += 1
        print('PASS', name)
    else:
        FAIL += 1
        print('FAIL', name)


clips = json.loads(re.search(
    r'window\.CLIPS\s*=\s*(\[.*?\]);',
    open(os.path.join(WORK, 'tools', 'body-b', 'webm_pet', 'clips.js'), encoding='utf-8').read(), re.S).group(1))
banned = set(getattr(wb, 'BANNED_DSH_CLIPS', ()))
# 用 unicode 转义写期望值，避免控制台/文件编码干扰
EXPECT_APPROVAL = '\u4e1c\u5f20\u897f\u671b'          # 东张西望
EXPECT_WAITING_INPUT = '\u5de5\u4f5c\u88ab\u6253\u6270'  # 工作被打扰

check('banned clips still in 50 assets', all(b in clips for b in banned))
check('DEFAULT_ACTION_MAP.approval == waiting/idle clip',
      wb.DEFAULT_ACTION_MAP.get('approval') == EXPECT_APPROVAL)
check('DEFAULT_ACTION_MAP.waiting_input == error-ish clip',
      wb.DEFAULT_ACTION_MAP.get('waiting_input') == EXPECT_WAITING_INPUT)
check('DEFAULT_ACTION_MAP has no banned clip',
      not (set(v for v in wb.DEFAULT_ACTION_MAP.values() if v) & banned))
check('CLIP_ALIAS has no banned clip',
      not (set(v for v in wb.CLIP_ALIAS.values() if v) & banned))
check('all DEFAULT_ACTION_MAP targets are valid clips',
      all((v is None) or (v in clips) for v in wb.DEFAULT_ACTION_MAP.values()))
check('all CLIP_ALIAS targets are valid clips',
      all(v in clips for v in wb.CLIP_ALIAS.values()))

wb_src = open(os.path.join(ROOT, 'pet', 'webm_body.py'), encoding='utf-8').read()
pet_src = open(os.path.join(ROOT, 'pet', 'pet_window.py'), encoding='utf-8').read()
check('webm_body peek priority implementation exists',
      '_pending_clip' in wb_src and 'self._peek' in wb_src)
# ACTION_META（perf/director 可达）也不得指向禁用 clip
check('ACTION_META has no banned clip',
      not (set(v[0] for v in wb.ACTION_META.values()) & banned))
check('playClip/applyAction 门禁函数存在',
      hasattr(wb, 'is_banned_clip') and hasattr(wb, '_allow_banned'))
check('is_banned_clip 对禁用 clip 为 True',
      all(wb.is_banned_clip(b) for b in banned))
check('is_banned_clip 对正常 clip 为 False',
      not wb.is_banned_clip(clips[0]))
dsh_values = set(v for v in wb.DEFAULT_ACTION_MAP.values() if v)
dsh_values |= set(v for v in wb.CLIP_ALIAS.values() if v)
dsh_values |= set(v[0] for v in wb.ACTION_META.values())
check('所有 DSH/perf 可达映射值均非禁用 clip', not (dsh_values & banned))
check('pet state mapping has no banned clip literal',
      not any(b in pet_src for b in banned))
print('RESULT %d passed, %d failed' % (PASS, FAIL))
raise SystemExit(1 if FAIL else 0)


