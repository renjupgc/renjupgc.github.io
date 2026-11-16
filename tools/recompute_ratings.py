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
                                     exclude_tids=bz.unrated_tids(ts),
                                     adults=bz.adult_names())
    if not rows:
        print('！ 未安装 whr 库，退出')
        return 1

    old = {r['name']: r['rating'] for r in snap}
    new = {r['name']: r['pt'] for r in rows}
    changed = [(n, old[n], new[n]) for n in new
               if n in old and old[n] is not None and abs(new[n] - old[n]) > 0.005]
    changed.sort(key=lambda x: -abs(x[2] - x[1]))
    n_college = sum(1 for r in rows if r['college'])
    n_listed = sum(1 for r in rows if r['listed'])
    print('as_of %s  有分 %d 人（入榜高校 %d / 未入榜高校 %d / 成人 %d）  分数变动 %d 人'
          % (as_of, len(rows), n_listed, n_college - n_listed,
             len(rows) - n_college, len(changed)))
    for n, a, b in changed[:12]:
        print('  %-6s %9.2f -> %9.2f  Δ%+.2f' % (n, a, b, b - a))

    oldrank = {r['name']: r['rank'] for r in snap}
    moved = [(r['name'], oldrank[r['name']], r['rank']) for r in rows
             if r['listed'] and r['name'] in oldrank
             and oldrank[r['name']] is not None
             and oldrank[r['name']] != r['rank']]
    print('名次变动 %d 人' % len(moved))
    for n, a, b in moved[:12]:
        print('  %-6s 第 %s -> 第 %s' % (n, a, b))
    if len(moved) > 12:
        print('  ……')

    if dry:
        d.close()
        return 0

    # 有分的都进表：入榜的 rank 有值，未入榜的 rank 留空、只记预估名次。
    # 表里还没有的人（新补录赛事的生面孔）一并补一行，地区/学校沿用库里的。
    for r in rows:
        cur = d.execute('UPDATE ratings SET rating=?, games=?, wins=?, draws=?, losses=?,'
                        ' rank=?, as_of=?, college=?, est_rank=? WHERE name=?',
                        (r['pt'], r['games'], r['wins'], r['draws'], r['losses'],
                         r['rank'], r['as_of'], r['college'], r['est_rank'], r['name']))
        if not cur.rowcount:
            d.execute('INSERT INTO ratings(name, region, university, rating, games,'
                      ' wins, draws, losses, rank, as_of, college, est_rank)'
                      ' VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
                      (r['name'], r['region'], r['uni'], r['pt'], r['games'],
                       r['wins'], r['draws'], r['losses'], r['rank'], r['as_of'],
                       r['college'], r['est_rank']))
    d.commit()
    d.close()

    # rating_page 自己写文件（榜单只排高校棋手，成人在页面下方另作说明）
    bz.rating_page(rows, as_of, len(ts), sum(r['games'] for r in rows) // 2)
    print('rating ->', bz.RATING_OUT)
    print('成人（非高校）->',
          '，'.join('%s 预估第 %s 名（%s）' % (r['name'], r['est_rank'], r['pt'])
                   for r in rows if not r['college']) or '无')
    print('未入榜的高校棋手 ->',
          '，'.join('%s 预估第 %s 名（%s）' % (r['name'], r['est_rank'], r['pt'])
                   for r in rows if r['college'] and not r['listed']) or '无')
    return 0


if __name__ == '__main__':
    sys.exit(main('--dry' in sys.argv))
