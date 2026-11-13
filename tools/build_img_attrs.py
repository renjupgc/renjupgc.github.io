#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
给正文图片补上尺寸与加载策略，可反复执行。

做三件事：

    width / height   从图片文件头读出真实像素，写进标签。浏览器据此预留版面高度，
                     图片加载完成时不再把正文往下顶（CLS）。
    loading=lazy     首屏之外才懒加载；每页第一张图保持即时加载，避免拖慢首屏。
    decoding=async   解码不阻塞渲染。

只处理指向本地文件的 <img>。外链、data: URI、以及读不出尺寸的文件原样跳过。

用法：
    python tools/build_img_attrs.py
"""

import os
import re
import struct
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RE_IMG = re.compile(r'<img\b[^>]*>', re.I)
RE_SRC = re.compile(r'src="([^"]+)"', re.I)


def png_size(path):
    with open(path, 'rb') as f:
        head = f.read(33)
    if len(head) < 24 or head[:8] != b'\x89PNG\r\n\x1a\n':
        return None
    w, h = struct.unpack('>II', head[16:24])
    return w, h


def gif_size(path):
    with open(path, 'rb') as f:
        head = f.read(10)
    if len(head) < 10 or head[:3] != b'GIF':
        return None
    w, h = struct.unpack('<HH', head[6:10])
    return w, h


def jpeg_size(path):
    with open(path, 'rb') as f:
        data = f.read()
    if data[:2] != b'\xff\xd8':
        return None
    i = 2
    n = len(data)
    while i < n - 9:
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        # SOF0..SOF15，排除 DHT(C4) / JPG(C8) / DAC(CC)
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            h, w = struct.unpack('>HH', data[i + 5:i + 9])
            return w, h
        seg_len = struct.unpack('>H', data[i + 2:i + 4])[0]
        i += 2 + seg_len
    return None


def image_size(path):
    for fn in (jpeg_size, png_size, gif_size):
        try:
            size = fn(path)
        except Exception:
            size = None
        if size:
            return size
    return None


def rebuild_tag(tag, w, h, lazy):
    """把要补的属性插在标签末尾，已有同名属性则跳过。"""
    add = []
    if not re.search(r'\swidth=', tag, re.I):
        add.append(f'width="{w}"')
    if not re.search(r'\sheight=', tag, re.I):
        add.append(f'height="{h}"')
    if not re.search(r'\sdecoding=', tag, re.I):
        add.append('decoding="async"')
    if lazy and not re.search(r'\sloading=', tag, re.I):
        add.append('loading="lazy"')
    if not add:
        return tag
    return tag[:-1].rstrip() + ' ' + ' '.join(add) + '>'


def process(path):
    with open(path, encoding='utf-8', newline='') as f:
        text = f.read()

    changed = 0
    seen = 0

    def repl(m):
        nonlocal changed, seen
        tag = m.group(0)
        if re.search(r'\sloading=', tag, re.I) and re.search(r'\swidth=', tag, re.I):
            return tag
        ms = RE_SRC.search(tag)
        if not ms:
            return tag
        src = ms.group(1)
        if src.startswith(('data:', 'http://', 'https://', '//')):
            return tag
        target = os.path.normpath(os.path.join(os.path.dirname(path), src.split('?')[0].split('#')[0]))
        size = image_size(target) if os.path.isfile(target) else None
        if not size:
            return tag
        # 每页第一张图留在首屏，不懒加载
        lazy = seen >= 1
        seen += 1
        new = rebuild_tag(tag, size[0], size[1], lazy)
        if new != tag:
            changed += 1
        return new

    new_text = RE_IMG.sub(repl, text)
    if new_text != text:
        with open(path, 'w', encoding='utf-8', newline='') as f:
            f.write(new_text)
    return changed


def main():
    total_files = 0
    total_imgs = 0
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in ('.git', 'tools', 'docs', 'node_modules')]
        for name in sorted(filenames):
            if not name.endswith('.html'):
                continue
            path = os.path.join(dirpath, name)
            n = process(path)
            if n:
                total_files += 1
                total_imgs += n
    print(f'处理 {total_files} 个文件，改写 {total_imgs} 张图片')


if __name__ == '__main__':
    sys.exit(main())
