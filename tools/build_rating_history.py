#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
重放全部对局，生成「每个时点的等级分」，供 zayu/shiguang.html 的时光机使用。

    assets/rating-history.js    window.ZBX_RATING_HISTORY = {...}

做法
----
1. 取 data/renju.db 里真正下完的对局（轮空、弃权、无结果的都不算），按日期建 WHR 模型。
   WHR 会给每位棋手一条「出场日 → 分数」的折线；两次出场之间分数不变。
2. 时点取「每个比赛日」，共十几个到几十个点——按届赛事拆组会重复日期，按日合并。
   每个时点上，取该棋手此日之前最后一个出场日的分数。
3. 末端对齐：站内等级分表（ratings）是对外公布的唯一口径，但它是用别的
   whr 版本算出来的，与本地重放的绝对值有偏差。所以按人算一个常量偏移，
   让最后一个时点与 ratings 表逐人相等——曲线管形状，表管数值，两者不会打架。
   位移是常量，同一位棋手的曲线走势与真实历史一致。
4. 不做「久未参赛」的衰减：那是「当前实力估计」的修正，放进历史曲线会在
   复出时出现锯齿。衰减只体现在榜单页的最终数值上。

有 whr 库就用它（与站点同源）；没有就退回仓库自带的 whr_lite，模型一致、
尺度略有差别，反正最后都要对齐。

用法：
    python tools/build_rating_history.py
"""

import contextlib
import datetime
import io
import json
import os
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

DB = os.path.join(ROOT, 'data', 'renju.db')
OUT = os.path.join(ROOT, 'assets', 'rating-history.js')

RATING_BASE = 2000
RATING_W2 = 19.3
RATING_VIRTUAL = 2
BYE = {'', None}


def load_games(db):
    """返回 (played, tournaments)；played 里每项是 (p1, p2, 结果字母, 日期, 赛事号)。"""
    d = sqlite3.connect(db)
    d.row_factory = sqlite3.Row
    played = []
    for m in d.execute('SELECT * FROM matches'):
        p1, p2, w = m['player1'], m['player2'], m['winner']
        if p1 in BYE or p2 in BYE or not m['date']:
            continue
        res = {'1': 'B', '0': 'W', '0.5': 'D'}.get(w)
        if res:
            played.append((p1, p2, res, datetime.date.fromisoformat(m['date']),
                           m['tournament_id']))
    tours = {r['id']: dict(r) for r in d.execute('SELECT * FROM tournaments')}
    snap = {r['name']: r['rating'] for r in d.execute('SELECT name, rating FROM ratings')}
    d.close()
    return played, tours, snap


def histories(played):
    """建模型并返回 {姓名: [(天数, 分数), ...]}，分数已加基准分。"""
    first = min(g[3] for g in played)
    games = [(a, b, r, (d - first).days) for a, b, r, d, _ in played]

    # whr 每次迭代都会往 stdout 打印进度，这里吞掉，只留本脚本的统计
    with contextlib.redirect_stdout(io.StringIO()):
        try:
            import whr
            base = whr.Base(config={'w2': RATING_W2, 'virtual_games': RATING_VIRTUAL})
            base.create_games(games)
            base.iterate_until_converge(verbose=False)
            rows = base.get_ordered_ratings()
            engine = 'whr'
        except ImportError:
            import whr_lite
            base = whr_lite.Base(config={'w2': RATING_W2, 'virtual_games': RATING_VIRTUAL})
            base.create_games(games)
            base.iterate_until_converge()
            rows = base.get_ordered_ratings()
            engine = 'whr_lite'

    # whr 的历史项是 [天数, 分数, 当次对局数]，顺手把对局数也用上
    out = {}
    for name, hist in rows:
        out[name] = [(item[0], item[1] + RATING_BASE, item[2] if len(item) > 2 else 0)
                     for item in hist]
    return out, first, engine


def snapshot_dates(played, tours):
    """每个「比赛日」一个时点。

    同一届赛事常按组别拆成好几条记录（2026 选拔赛就拆了 10 组），日期完全相同，
    逐条当时点会让滑块里连着十来格都一样。这里按日期合并成一格，标注该日几个组别。
    """
    by_day = {}
    for _a, _b, _r, d, tid in played:
        by_day.setdefault(d, {})
        by_day[d][tid] = by_day[d].get(tid, 0) + 1

    snaps = []
    for day in sorted(by_day):
        tids = sorted(by_day[day].items(), key=lambda kv: -kv[1])
        names = []
        for tid, _n in tids:
            nm = (tours.get(tid) or {}).get('name') or ('赛事 %s' % tid)
            if nm not in names:
                names.append(nm)
        label = names[0]
        if len(tids) > 1:
            label += '（%d 组）' % len(tids)
        elif len(names) > 1:
            label += ' 等'
        snaps.append({
            'd': day.isoformat(),
            't': label,
            'tid': tids[0][0],
            'ev': len(tids),
            'g': sum(by_day[day].values()),
        })
    return snaps


def series_at(hist, day):
    """折线取值。day 是「距首场的天数」，取该日之前最后一个出场日的分数。"""
    val = None
    for item in hist:
        if item[0] <= day:
            val = item[1]
        else:
            break
    return val


def build_series():
    """算一遍，返回 (snaps, players, engine, worst, worst_name, 对局数)。

    players 每项是 [姓名, [时点1, 时点2, ...]]，未出场处为 None。
    build_players.py 也调这个函数给棋手页画走势，免得两处各算一遍还可能不一致。
    """
    played, tours, table = load_games(DB)
    if not played:
        print('！ 数据库里没有可用的对局')
        return 1

    hist, first, engine = histories(played)
    snaps = snapshot_dates(played, tours)

    # 末端对齐：算出每人偏移量，使最后一个时点与 ratings 表相等
    end_day = max(h[-1][0] for h in hist.values() if h)
    offset = {}
    for name, h in hist.items():
        raw = series_at(h, end_day)
        if name in table and raw is not None:
            offset[name] = table[name] - raw
        else:
            offset[name] = 0.0

    # 只收等级分表上的人：榜单口径与 rating.html 一致，
    # 那些只下过一两局、未入榜的棋手不参与排名，免得末帧与公示表对不上
    players = []
    for name, h in hist.items():
        if name not in table:
            continue
        off = offset[name]
        row = []
        for s in snaps:
            v = series_at(h, (datetime.date.fromisoformat(s['d']) - first).days)
            row.append(None if v is None else round(v + off, 2))
        players.append([name, row])

    # 稳定排序：最终分数高者在前，同分按姓名
    players.sort(key=lambda p: (-(p[1][-1] if p[1][-1] is not None else -1e9), p[0]))

    # 自检：最后一个时点与等级分表逐人比对
    worst = 0.0
    worst_name = ''
    for name, row in players:
        if name in table and row[-1] is not None:
            dv = abs(row[-1] - table[name])
            if dv > worst:
                worst, worst_name = dv, name

    return snaps, players, engine, worst, worst_name, len(played)


def main():
    snaps, players, engine, worst, worst_name, n_played = build_series()

    payload = {
        'asOf': snaps[-1]['d'],
        'engine': engine,
        'snaps': snaps,
        'players': players,
        'note': '曲线按当时的对局重放；末端数值与等级分表一致。久未参赛者不另作衰减。',
    }
    js = ('/* 由 tools/build_rating_history.py 生成，勿手改。\n'
          '   数据：每个时点（= 每场赛事结束日）全体棋手的等级分。 */\n'
          'window.ZBX_RATING_HISTORY = '
          + json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + ';\n')
    with open(OUT, 'w', encoding='utf-8', newline='') as f:
        f.write(js)

    print('引擎 %s ｜ 对局 %d ｜ 时点 %d ｜ 入榜棋手 %d'
          % (engine, n_played, len(snaps), len(players)))
    if worst < 0.005:
        print('末帧与等级分表：逐人一致')
    else:
        print('末帧与等级分表最大偏差：%.3f（%s）' % (worst, worst_name or '-'))
    print('输出 %s  %.0f KB' % (os.path.relpath(OUT, ROOT), os.path.getsize(OUT) / 1024))
    return 0


if __name__ == '__main__':
    sys.exit(main())
