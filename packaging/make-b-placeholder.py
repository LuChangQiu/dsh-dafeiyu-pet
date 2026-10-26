# -*- coding: utf-8 -*-
"""从 B 的 idle WebM 首帧生成 168×198 静帧回退图（可复现）。

用法：
  python packaging/make-b-placeholder.py --webm <待机呼吸休闲.webm> -o packaging/third-party-b/placeholder.png
依赖：ffmpeg（支持 libvpx-vp9 alpha 解码）+ PySide6。
"""
import argparse
import os
import shutil
import subprocess
import tempfile

from PySide6.QtCore import Qt
from PySide6.QtGui import QImage, QPainter, QPixmap
from PySide6.QtWidgets import QApplication

# FFmpeg 由 env / PATH 决定（不再硬编码开发机路径）
FF = os.environ.get('FFMPEG') or shutil.which('ffmpeg') or 'ffmpeg'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--webm', required=True)
    ap.add_argument('-o', '--out', default='placeholder.png')
    args = ap.parse_args()
    app = QApplication([])  # noqa: F841
    fd, png = tempfile.mkstemp(suffix='.png')
    os.close(fd)
    subprocess.run([FF, '-y', '-v', 'error', '-c:v', 'libvpx-vp9', '-i', args.webm,
                    '-frames:v', '1', '-pix_fmt', 'rgba', png], check=True)
    pm = QPixmap(png)
    os.unlink(png)
    if pm.isNull():
        raise SystemExit('无法解码 WebM 首帧')
    scale = 184.0 / 271.0
    side = int(round(360 * scale))
    s = pm.scaled(side, side, Qt.KeepAspectRatio, Qt.SmoothTransformation)
    img = QImage(168, 198, QImage.Format.Format_ARGB32_Premultiplied)
    img.fill(0)
    p = QPainter(img)
    p.setRenderHint(QPainter.SmoothPixmapTransform)
    left = round((168 - 244 * scale) / 2 - 58 * scale)
    top = round(198 - 7 - (59 + 271) * scale)
    p.drawPixmap(left, top, s)
    p.end()
    QPixmap.fromImage(img).save(args.out)
    print('saved', args.out)


if __name__ == '__main__':
    main()
