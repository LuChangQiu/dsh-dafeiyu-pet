# -*- mode: python ; coding: utf-8 -*-
"""把 onedir 打包目录压成 UTF-8 ZIP（中文文件名正确），并写 .sha256。

用法: python packaging/make_utf8_zip.py <dir> <zip> [--root-file NAME ...]
"""
import hashlib
import os
import sys
import zipfile


def main():
    args = sys.argv[1:]
    root_files = []
    if '--root-file' in args:
        i = args.index('--root-file')
        root_files = args[i + 1:]
        args = args[:i]
    if len(args) < 2:
        print('usage: make_utf8_zip.py <dir> <zip> [--root-file NAME ...]')
        return 2
    root, zpath = os.path.abspath(args[0]), os.path.abspath(args[1])
    files = []
    for dp, dns, fns in os.walk(root):
        for fn in fns:
            p = os.path.join(dp, fn)
            rel = os.path.relpath(p, root).replace(os.sep, '/')
            files.append((p, rel))
    files.sort(key=lambda x: x[1])
    with zipfile.ZipFile(zpath, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for p, rel in files:
            zi = zipfile.ZipInfo(rel)
            zi.flag_bits |= 0x800  # UTF-8 filename flag
            zi.external_attr = (0o100644 & 0xFFFF) << 16
            zi.compress_type = zipfile.ZIP_DEFLATED
            with open(p, 'rb') as f:
                z.writestr(zi, f.read())
    # 校验：根文件 / 50 webm / UTF-8 flag
    with zipfile.ZipFile(zpath) as z:
        names = z.namelist()
        missing = [n for n in root_files if n not in names]
        if missing:
            print('MISSING_ROOT=' + ','.join(missing))
            return 3
        webm = sum(1 for n in names if n.endswith('.webm'))
        if webm != 50:
            print('WEBM_COUNT=%d' % webm)
            return 4
        for info in z.infolist():
            if any(ord(c) > 127 for c in info.filename) and not (info.flag_bits & 0x800):
                print('UTF8_FLAG_MISSING=' + info.filename)
                return 5
    h = hashlib.sha256()
    with open(zpath, 'rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    sha = h.hexdigest().upper()
    with open(zpath + '.sha256', 'w', encoding='ascii', newline='\n') as f:
        f.write('%s  %s\n' % (sha, os.path.basename(zpath)))
    print('zip=%s' % zpath)
    print('size=%d' % os.path.getsize(zpath))
    print('sha256=%s' % sha)
    print('entries=%d' % len(files))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
