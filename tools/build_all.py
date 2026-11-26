#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
一键重出站点：按固定顺序调用各生成脚本，最后跑一致性校验。

用法：
    python tools/build_all.py                 # 常规重建 + 校验
    python tools/build_all.py --with-english  # 连词库/阅读文章一起重建
    python tools/build_all.py --with-zalun    # 连杂论词云一起重建（需要 jieba）
    python tools/build_all.py --with-eval     # 棋谱复盘也跑引擎（需要 node）
    python tools/build_all.py --no-check      # 只生成，不校验

顺序不能随便改：赛事页会引用棋手页，棋手页会改写等级分表的内链，
SEO 必须最后跑，否则新生成的页面进不了 sitemap。
"""

import argparse
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def run(label, args):
    cmd = [sys.executable] + args
    print('\n== %s ==' % label)
    print('$ ' + ' '.join(cmd))
    t0 = time.time()
    proc = subprocess.run(cmd, cwd=ROOT)
    if proc.returncode:
        print('!! %s 失败（退出码 %d）' % (label, proc.returncode), file=sys.stderr)
        return False
    print('-- %.1fs' % (time.time() - t0))
    return True


def main():
    ap = argparse.ArgumentParser(description='按顺序重建站点')
    ap.add_argument('--with-english', action='store_true', help='重建连珠英语词库与阅读文章')
    ap.add_argument('--with-zalun', action='store_true', help='重建杂论词云词表（需要 jieba）')
    ap.add_argument('--with-eval', action='store_true', help='棋谱复盘同时跑引擎（需要 node）')
    ap.add_argument('--no-check', action='store_true', help='生成后不跑 check.py')
    a = ap.parse_args()

    steps = [
        ('赛事页与等级分表', ['tools/build_zayu.py', '--rebuild']),
        ('等级分时序', ['tools/build_rating_history.py']),
        ('棋手主页与搜索索引', ['tools/build_players.py']),
        ('棋谱数据', ['tools/build_qipu.py'] + ([] if a.with_eval else ['--no-eval'])),
        ('开局语料', ['tools/build_openings.py']),
        ('预测数据', ['tools/build_predict.py']),
    ]
    if a.with_english:
        steps.append(('连珠英语词库', ['tools/build_english_words.py']))
    if a.with_zalun:
        steps.append(('杂论词云词表', ['tools/build_zalun_words.py']))
    steps += [
        ('SEO / sitemap / feed', ['tools/build_seo.py']),
        ('图片尺寸与懒加载', ['tools/build_img_attrs.py']),
    ]

    for label, args in steps:
        if not run(label, args):
            return 1

    if not a.no_check:
        print('\n== 一致性校验 ==')
        proc = subprocess.run([sys.executable, 'tools/check.py'], cwd=ROOT)
        if proc.returncode:
            print('!! 校验未通过', file=sys.stderr)
            return proc.returncode

    print('\n全部完成。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
