#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
为全站补齐分享与发现所需的头部信息，并生成站点级文件。

一次性做四件事，可反复执行（幂等）：

    *.html            注入 canonical / og: / twitter: 一组标签（成对注释包裹，重跑先删后写）
    sitemap.xml       全站 400+ 页面的地址表，文章页带 lastmod
    robots.txt        允许抓取，并指向 sitemap
    feed.xml          RSS 2.0，取「杂论／杂史」最新若干篇
    assets/img/og-cover.png  社交分享默认图（棋枰图形，无文字，与站内 hero 同一母题）

站内页面是手写的，没有模板引擎，所以这里直接对 HTML 做文本层注入。
插入位置固定在 <meta name="description"> 之后、样式表之前，便于人眼核对。

用法：
    python tools/build_seo.py
"""

import os
import re
import struct
import sys
import zlib
from datetime import datetime, timezone

SITE_URL = 'https://renjupgc.github.io'
SITE_NAME = '连珠杂箱'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

BEGIN = '<!-- zbx:seo -->'
END = '<!-- /zbx:seo -->'

DEFAULT_OG_IMAGE = SITE_URL + '/assets/img/og-cover.png'

RE_TITLE = re.compile(r'<title>(.*?)</title>', re.S)
RE_DESC = re.compile(r'<meta\s+name="description"\s+content="(.*?)">', re.S)
RE_IMG = re.compile(r'<img\s[^>]*src="([^"]+)"', re.I)
RE_DATE = re.compile(
    r'href="(?:\.\./)?posts/([^"]+)"[^>]*>[^<]*</a>\s*<span class="date">(\d{4}-\d{2}-\d{2})</span>'
)
RE_LASTMOD = re.compile(r'<span class="date">(\d{4}-\d{2}-\d{2})</span>')

# 不参与 sitemap 的页面。时光机只在等级分表的角落里挂一个入口，不单独列出，
# 也不进搜索（页头另有 noindex）。
SKIP_SITEMAP = {'404.html', 'zayu/shiguang.html'}


def html_files():
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in ('.git', 'tools', 'docs', 'node_modules')]
        for name in filenames:
            if name.endswith('.html'):
                yield os.path.join(dirpath, name)


def rel(path):
    return os.path.relpath(path, ROOT).replace(os.sep, '/')


def url_of(path):
    """仓库内的相对路径 → 线上绝对地址。中文文件名做百分号编码。"""
    from urllib.parse import quote
    r = rel(path)
    if r == 'index.html':
        return SITE_URL + '/'
    return SITE_URL + '/' + quote(r)


def read(path):
    # newline='' 不做换行转换：仓库里的 HTML 是 CRLF，改写时得原样留着
    with open(path, encoding='utf-8', newline='') as f:
        return f.read()


def write(path, text):
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(text)


def eol_of(text):
    """沿用文件本身的换行符，避免一次注入把整页 CRLF 改成 LF。"""
    return '\r\n' if '\r\n' in text else '\n'


def esc(text):
    return (text.replace('&', '&amp;').replace('<', '&lt;')
                .replace('>', '&gt;').replace('"', '&quot;'))


def first_image(text, page_path):
    """取正文里第一张本地图片，换成线上绝对地址；外链与非图片资源忽略。"""
    for m in RE_IMG.finditer(text):
        src = m.group(1)
        if src.startswith(('data:', 'http://', 'https://', '//')):
            continue
        target = os.path.normpath(os.path.join(os.path.dirname(page_path), src))
        if not os.path.isfile(target):
            continue
        return url_of(target)
    return None


def strip_block(text):
    """删掉上一次注入的那一段。"""
    i = text.find(BEGIN)
    if i < 0:
        return text
    j = text.find(END, i)
    if j < 0:
        return text
    j += len(END)
    # 连同前面的缩进与后面的换行一起去掉
    start = text.rfind('\n', 0, i) + 1
    while j < len(text) and text[j] in '\r\n':
        j += 1
    return text[:start] + text[j:]


def build_block(title, desc, canonical, is_article, image, eol='\n'):
    t = esc(title)
    d = esc(desc)
    lines = [
        BEGIN,
        f'<link rel="canonical" href="{canonical}">',
        f'<meta property="og:site_name" content="{SITE_NAME}">',
        f'<meta property="og:type" content="{"article" if is_article else "website"}">',
        f'<meta property="og:title" content="{t}">',
        f'<meta property="og:description" content="{d}">',
        f'<meta property="og:url" content="{canonical}">',
        f'<meta property="og:locale" content="zh_CN">',
        f'<meta property="og:image" content="{image}">',
        f'<meta name="twitter:card" content="summary_large_image">',
        f'<meta name="twitter:title" content="{t}">',
        f'<meta name="twitter:description" content="{d}">',
        f'<meta name="twitter:image" content="{image}">',
        END,
    ]
    return eol.join(lines)


def inject_meta():
    changed = 0
    skipped = []
    for path in html_files():
        text = read(path)
        text = strip_block(text)

        mt = RE_TITLE.search(text)
        md = RE_DESC.search(text)
        if not mt or not md:
            skipped.append(rel(path))
            write(path, text)
            continue

        # og:title 不必再带「- 连珠杂箱」，og:site_name 已经给了站点名
        title = re.sub(r'\s+-\s+连珠杂箱\s*$', '', mt.group(1).strip())
        desc = md.group(1).strip()
        canonical = url_of(path)
        is_article = rel(path).startswith('posts/')
        image = first_image(text, path) or DEFAULT_OG_IMAGE

        eol = eol_of(text)
        block = build_block(title, desc, canonical, is_article, image, eol)

        # 紧接 description 换行后插入，原文件其余字节一个不动
        anchor = md.end()
        new = text[:anchor] + eol + block + text[anchor:]
        write(path, new)
        changed += 1
    return changed, skipped


def build_sitemap(post_dates):
    rows = []
    for path in sorted(html_files(), key=rel):
        r = rel(path)
        if r in SKIP_SITEMAP:
            continue
        loc = url_of(path)
        lastmod = post_dates.get(os.path.basename(r)) if r.startswith('posts/') else None
        if lastmod:
            rows.append(f'  <url><loc>{loc}</loc><lastmod>{lastmod}</lastmod>'
                        f'<changefreq>yearly</changefreq><priority>0.6</priority></url>')
        else:
            rows.append(f'  <url><loc>{loc}</loc></url>')

    xml = ('<?xml version="1.0" encoding="UTF-8"?>\n'
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
           + '\n'.join(rows) + '\n</urlset>\n')
    write(os.path.join(ROOT, 'sitemap.xml'), xml)
    return len(rows)


def build_robots():
    write(os.path.join(ROOT, 'robots.txt'),
          'User-agent: *\nAllow: /\n\n'
          f'Sitemap: {SITE_URL}/sitemap.xml\n')


def build_feed(post_dates):
    """按日期倒序取最近 12 篇，正文摘要用页面 description。"""
    items = []
    for name, date in post_dates.items():
        path = os.path.join(ROOT, 'posts', name)
        if not os.path.isfile(path):
            continue
        text = read(path)
        mt = RE_TITLE.search(text)
        md = RE_DESC.search(text)
        if not (mt and md):
            continue
        title = re.sub(r'\s*-\s*连珠杂箱\s*$', '', mt.group(1).strip())
        items.append((date, name, title, md.group(1).strip()))

    items.sort(reverse=True)
    items = items[:12]

    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
           '<channel>',
           f'<title>{SITE_NAME}</title>',
           f'<link>{SITE_URL}/</link>',
           '<description>连珠（五子棋）爱好者们的百宝箱，收录相关文章与比赛记录。</description>',
           '<language>zh-CN</language>',
           f'<atom:link href="{SITE_URL}/feed.xml" rel="self" type="application/rss+xml"/>']
    if items:
        dt = datetime.strptime(items[0][0], '%Y-%m-%d').replace(tzinfo=timezone.utc)
        out.append(f'<lastBuildDate>{dt.strftime("%a, %d %b %Y %H:%M:%S +0000")}</lastBuildDate>')

    for date, name, title, desc in items:
        link = f'{SITE_URL}/posts/{name}'
        dt = datetime.strptime(date, '%Y-%m-%d').replace(tzinfo=timezone.utc)
        out += ['<item>',
                f'<title>{esc(title)}</title>',
                f'<link>{link}</link>',
                f'<guid isPermaLink="true">{link}</guid>',
                f'<pubDate>{dt.strftime("%a, %d %b %Y %H:%M:%S +0000")}</pubDate>',
                f'<description>{esc(desc)}</description>',
                '</item>']
    out += ['</channel>', '</rss>', '']
    write(os.path.join(ROOT, 'feed.xml'), '\n'.join(out))
    return len(items)


def collect_post_dates():
    """文章日期原本只写在栏目页的列表里，这里从列表页反查，避免在文章页另立字段。"""
    dates = {}
    for path in html_files():
        r = rel(path)
        if r.startswith('posts/'):
            continue
        text = read(path)
        for m in RE_DATE.finditer(text):
            dates.setdefault(m.group(1), m.group(2))
    return dates


# ---------------------------------------------------------------- OG 图

def _png(width, height, pixels):
    """最小 PNG 编码：RGB、8 位、无滤波。够画几何图形，省一个 Pillow 依赖。"""
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        raw.extend(pixels[y])

    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
            + chunk(b'IEND', b''))


def build_og_cover():
    """1200×630 的满版棋枰：格线铺满画布，斜向五子居中，黑子压金环。

    与站内 hero 同一套母题，但不写字——卡片上的标题由 og:title 提供。
    """
    W, H = 1200, 630
    paper = (246, 242, 233)
    gold = (201, 164, 104)
    black = (30, 27, 22)

    step = 60
    px = [bytearray(paper * W) for _ in range(H)]

    def dot(x, y, color):
        if 0 <= x < W and 0 <= y < H:
            px[y][x * 3:x * 3 + 3] = bytes(color)

    def hline(y, xa, xb, color, alpha=255):
        if not (0 <= y < H):
            return
        for x in range(max(0, xa), min(W, xb)):
            blend(x, y, color, alpha)

    def vline(x, ya, yb, color, alpha=255):
        if not (0 <= x < W):
            return
        for y in range(max(0, ya), min(H, yb)):
            blend(x, y, color, alpha)

    def blend(x, y, color, alpha):
        """格线要淡，直接写色会太硬，这里按 alpha 与纸色混合。"""
        if not (0 <= x < W and 0 <= y < H):
            return
        i = x * 3
        row = px[y]
        for k in range(3):
            row[i + k] = (color[k] * alpha + paper[k] * (255 - alpha)) // 255

    # 铺满画布，起点用负偏移，让格线不落在正中
    ox = -step // 2
    oy = -step // 2
    for i in range(W // step + 2):
        vline(ox + i * step, 0, H, (176, 141, 87), 52)
    for j in range(H // step + 2):
        hline(oy + j * step, 0, W, (176, 141, 87), 52)

    def disc(cx, cy, r, color, ring=None):
        for y in range(int(cy - r - 3), int(cy + r + 4)):
            for x in range(int(cx - r - 3), int(cx + r + 4)):
                d2 = (x - cx) ** 2 + (y - cy) ** 2
                if d2 <= r * r:
                    dot(x, y, color)
                elif ring and (r + 0.8) ** 2 <= d2 <= (r + 2.6) ** 2:
                    blend(x, y, ring, 190)

    # 五子连线：落点必须压在格线交点上，否则一眼就看出浮在格子里
    gx, gy = -step // 2, -step // 2
    # 横纵都从格线交点取，纵向 j 比横向 i 差 5，五子正好落在画布中部
    pts = [(9 + i, 4 + i) for i in range(5)]
    for i, (ci, cj) in enumerate(pts):
        x, y = gx + ci * step, gy + cj * step
        if i < 4:
            disc(x, y, 26, gold)
        else:
            disc(x, y, 28, black, ring=(176, 141, 87))

    out = os.path.join(ROOT, 'assets', 'img', 'og-cover.png')
    with open(out, 'wb') as f:
        f.write(_png(W, H, px))
    return out


def main():
    post_dates = collect_post_dates()
    changed, skipped = inject_meta()
    n_sitemap = build_sitemap(post_dates)
    build_robots()
    n_feed = build_feed(post_dates)
    cover = build_og_cover()

    print(f'注入分享信息：{changed} 页')
    if skipped:
        print(f'  跳过（缺 title 或 description）：{len(skipped)} 页 -> {skipped[:5]}')
    print(f'sitemap.xml：{n_sitemap} 条')
    print(f'feed.xml：{n_feed} 篇')
    print(f'og-cover.png：{os.path.getsize(cover) // 1024} KB')


if __name__ == '__main__':
    sys.exit(main())
