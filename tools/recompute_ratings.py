# -*- coding: utf-8 -*-
"""按 build_zayu.compute_ratings 的原有算法（whr 包）重算等级分并落盘。

用法：python tools/recompute_ratings.py [--dry]
"""
import os
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_zayu as bz

DB = bz.DB_OUT


def main(dry=False):
    d = sqlite3.connect(DB)
    d.row_factory = sqlite3.Row
    ms = [dict(r) for r in d.execute('SELECT * FROM matches')]
    ts = [dict(r) for r in d.execute('SELECT * FROM tournaments')]
    snap = [dict(r) for r in d.execute('SELECT * FROM ratings')]
    unis = {r['name']: r['university'] or '' for r in snap}
    regions = {r['name']: r['region'] or '' for r in snap}

    rows, as_of = bz.compute_ratings(ms, unis, regions,
                                     exclude_tids=bz.unrated_tids(ts))
    if not rows:
        print('！ 未安装 whr 库，退出')
        return 1

    old = {r['name']: r['rating'] for r in snap}
    new = {r['name']: r['pt'] for r in rows}
    changed = [(n, old[n], new[n]) for n in new
               if n in old and old[n] is not None and abs(new[n] - old[n]) > 0.005]
    changed.sort(key=lambda x: -abs(x[2] - x[1]))
    print('as_of %s  入榜 %d 人  分数变动 %d 人' % (as_of, len(rows), len(changed)))
    for n, a, b in changed[:12]:
        print('  %-6s %9.2f -> %9.2f  Δ%+.2f' % (n, a, b, b - a))

    oldrank = {r['name']: r['rank'] for r in snap}
    moved = [(r['name'], oldrank[r['name']], r['rank']) for r in rows
             if r['name'] in oldrank and oldrank[r['name']] is not None
             and oldrank[r['name']] != r['rank']]
    print('名次变动 %d 人' % len(moved))
    for n, a, b in moved[:12]:
        print('  %-6s 第 %s -> 第 %s' % (n, a, b))
    if len(moved) > 12:
        print('  ……')

    if dry:
        d.close()
        return 0

    for r in rows:
        d.execute('UPDATE ratings SET rating=?, games=?, wins=?, draws=?, losses=?,'
                  ' rank=?, as_of=? WHERE name=?',
                  (r['pt'], r['games'], r['wins'], r['draws'], r['losses'],
                   r['rank'], r['as_of'], r['name']))
    d.commit()
    d.close()

    # rating_page 自己写文件
    bz.rating_page(rows, as_of, len(ts), sum(r['games'] for r in rows) // 2)
    print('rating ->', bz.RATING_OUT)
    return 0


if __name__ == '__main__':
    sys.exit(main('--dry' in sys.argv))
