#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
站点一致性校验（只读，不改文件）。

检查项：
  1. 站内链接与资源是否落地（href / src，按页面所在目录解析）；
  2. 使用 assets/layout.js 的页面是否有 <main>、#site-header、data-nav，data-base 是否与目录深度一致；
  3. sitemap.xml 是否覆盖所有可公开页面，条目是否都有对应文件；
  4. 可公开页面是否有 canonical / og:title；
  5. 正文图片是否缺 alt、width/height。

用法：
    python tools/check.py
    python tools/check.py --strict   # 警告也按失败处理

退出码：0 通过（可能有警告）；1 有错误；--strict 时有警告也返回 1。
"""

import argparse
import html
import os
import re
import sys
from urllib.parse import unquote, urlsplit

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP_DIRS = {'.git', 'node_modules', '__pycache__'}

# 第三方静态构建、后台、模板与片段：不参与“公开页面”的结构与 SEO 检查
NON_PUBLIC_PREFIX = ('renju/', 'admin/', 'assets/', 'tools/', 'docs/', 'labs/', '.github/')
NOINDEX_RE = re.compile(r'<meta[^>]+name=["\']robots["\'][^>]*\bnoindex\b', re.I)
LAYOUT_RE = re.compile(r'assets/layout\.js')
ATTR_RE = re.compile(r'\b(?:href|src)\s*=\s*(["\'])(.*?)\1', re.I | re.S)
LOC_RE = re.compile(r'<loc>(.*?)</loc>', re.I | re.S)
IMG_RE = re.compile(r'<img\b[^>]*>', re.I | re.S)


def rel(path):
    return os.path.relpath(path, ROOT).replace(os.sep, '/')


def html_files():
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            if name.endswith('.html'):
                yield os.path.join(dirpath, name)


def read(path):
    with open(path, encoding='utf-8', errors='ignore') as f:
        return f.read()


def is_external(value):
    v = value.strip()
    if not v:
        return True
    if v.startswith(('http://', 'https://', '//', '#', 'mailto:', 'tel:', 'data:', 'javascript:', 'blob:')):
        return True
    # 模板/JS 拼出来的地址，静态检查无法落地
    if any(t in v for t in ('{{', '${', "' +", '" +', "+ '")):
        return True
    return False


def resolve(page, value):
    """把页面里的相对地址解析成仓库内路径；不是站内文件时返回 None。"""
    v = html.unescape(value.strip())
    if is_external(v):
        return None
    parts = urlsplit(v)
    if not parts.path:
        return None
    p = unquote(parts.path)
    if p.startswith('/'):
        target = os.path.join(ROOT, p.lstrip('/'))
    else:
        target = os.path.normpath(os.path.join(os.path.dirname(page), p))
    if p.endswith('/'):
        target = os.path.join(target, 'index.html')
    if os.path.isdir(target):
        target = os.path.join(target, 'index.html')
    return target


def page_url_path(path):
    r = rel(path)
    if r == 'index.html':
        return 'index.html'
    if r.endswith('/index.html'):
        return r
    return r


def sitemap_paths():
    sm = os.path.join(ROOT, 'sitemap.xml')
    if not os.path.exists(sm):
        return None
    out = set()
    for u in LOC_RE.findall(read(sm)):
        p = unquote(urlsplit(u.strip()).path).lstrip('/')
        if not p:
            p = 'index.html'
        elif p.endswith('/'):
            p += 'index.html'
        out.add(p)
    return out


def main():
    ap = argparse.ArgumentParser(description='站点一致性校验')
    ap.add_argument('--strict', action='store_true', help='警告也按失败处理')
    a = ap.parse_args()

    errors = []
    warnings = []
    files = sorted(html_files())
    texts = {p: read(p) for p in files}

    # 1. 死链 / 缺资源
    for p in files:
        base = ROOT if rel(p) == 'assets/zx-content.html' else os.path.dirname(p)
        for m in ATTR_RE.finditer(texts[p]):
            value = m.group(2)
            target = resolve(os.path.join(base, os.path.basename(p)), value)
            if target is None:
                continue
            if not os.path.exists(target):
                errors.append('死链 %s -> %s' % (rel(p), value.strip()))

    # 2. 布局结构
    layout_pages = [p for p in files if LAYOUT_RE.search(texts[p])]
    for p in layout_pages:
        t = texts[p]
        if '<main' not in t:
            errors.append('%s 使用 layout.js 但缺少 <main>' % rel(p))
        if 'id="site-header"' not in t:
            errors.append('%s 使用 layout.js 但缺少 #site-header' % rel(p))
        if 'data-nav=' not in t:
            errors.append('%s 使用 layout.js 但缺少 data-nav' % rel(p))
        mb = re.search(r'<body[^>]*\bdata-base=["\']([^"\']*)["\']', t, re.I)
        depth = rel(p).count('/')
        expected = '../' * depth
        if depth == 0:
            # 根目录页面留空即可；写 "/" 也是绝对根路径，不必纠。
            if mb and mb.group(1) not in ('', '/'):
                warnings.append('%s data-base="%s"，根目录页面应为空'
                                % (rel(p), mb.group(1)))
        elif not mb:
            warnings.append('%s 使用 layout.js 但没有 data-base' % rel(p))
        elif mb.group(1) != expected:
            warnings.append('%s data-base="%s"，按目录深度应为 "%s"'
                            % (rel(p), mb.group(1), expected))

    # 3. sitemap 覆盖
    sm_paths = sitemap_paths()
    all_paths = {rel(p) for p in files}
    if sm_paths is None:
        errors.append('缺少 sitemap.xml')
    else:
        public = set()
        for p in files:
            r = rel(p)
            if r.startswith(NON_PUBLIC_PREFIX) or r == '404.html':
                continue
            if NOINDEX_RE.search(texts[p]):
                continue
            public.add(page_url_path(p))
        missing = sorted(public - sm_paths)
        extra = sorted(sm_paths - all_paths)
        if missing:
            warnings.append('sitemap 漏 %d 个可公开页面：%s'
                            % (len(missing), '、'.join(missing[:12])
                               + (' …' if len(missing) > 12 else '')))
        if extra:
            errors.append('sitemap 有 %d 条指向不存在的文件：%s'
                          % (len(extra), '、'.join(extra[:8])))

    # 4. canonical / og
    no_canonical = []
    no_og = []
    for p in files:
        r = rel(p)
        if r.startswith(NON_PUBLIC_PREFIX) or NOINDEX_RE.search(texts[p]):
            continue
        if 'rel="canonical"' not in texts[p]:
            no_canonical.append(r)
        if 'property="og:title"' not in texts[p]:
            no_og.append(r)
    if no_canonical:
        warnings.append('缺 canonical：%s' % '、'.join(no_canonical[:10]))
    if no_og:
        warnings.append('缺 og:title：%s' % '、'.join(no_og[:10]))

    # 5. 图片属性
    img_pages = {}
    for p in files:
        bad = 0
        for tag in IMG_RE.findall(texts[p]):
            if 'alt=' not in tag or 'width=' not in tag or 'height=' not in tag:
                bad += 1
        if bad:
            img_pages[rel(p)] = bad
    if img_pages:
        top = sorted(img_pages.items(), key=lambda kv: -kv[1])
        warnings.append('图片缺 alt/width/height：%d 页，%d 处；最多 %s'
                        % (len(img_pages), sum(img_pages.values()),
                           '、'.join('%s(%d)' % x for x in top[:5])))

    # 输出
    print('扫描 %d 个 HTML 页面' % len(files))
    if errors:
        print('\n[错误] %d 条' % len(errors))
        for e in errors[:60]:
            print('  - ' + e)
        if len(errors) > 60:
            print('  … 另有 %d 条' % (len(errors) - 60))
    else:
        print('\n[错误] 0 条')

    if warnings:
        print('\n[警告] %d 条' % len(warnings))
        for w in warnings:
            print('  - ' + w)
    else:
        print('[警告] 0 条')

    if errors or (a.strict and warnings):
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
