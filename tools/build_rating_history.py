#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
先验重放：生成「每个时点的等级分」，供 zayu/shiguang.html 的时光机与棋手页走势使用。

    assets/rating-history.js    window.ZBX_RATING_HISTORY = {...}

做法
----
1. 取 data/renju.db 里真正下完的对局（轮空、弃权、无结果的都不算），按日期排好。
2. 时点取「每个比赛日」，按日合并（同一届赛事常按组别拆成好几条记录，日期相同）。
3. 每个时点单独拟一次 WHR，**只用该日及之前的对局**。不掺后来的胜负，也不做事后
   校准——所以同一时点的分数，与把全量数据一起算出来的公示表会有出入；表是表的
   口径，这里是「那时候大家各自多少分」。
4. 不做「久未参赛」的衰减：那是「当前实力估计」的修正，放进历史曲线会在复出时
   出现锯齿。
5. 只收公示表（ratings）上、且在 data/public_players.txt 名单里的人：不在名单里的
   棋手不出现在时光机里。

有 whr 库就用它（与站点同源）；没有就退回仓库自带的 whr_lite，模型一致、尺度略有差别。

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
PUBLIC_FILE = os.path.join(ROOT, 'data', 'public_players.txt')

RATING_BASE = 2000
RATING_W2 = 19.3
RATING_VIRTUAL = 2
BYE = {'', None}


def load_games(db):
    """返回 (played, tournaments, 公示表)；played 里每项是 (p1, p2, 结果, 日期, 赛事号)。"""
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
    table = {r['name']: r['rating'] for r in d.execute('SELECT name, rating FROM ratings')}
    d.close()
    return played, tours, table


def load_public():
    """可公开的棋手名单；缺文件时退回「公示表上的人」，并提示一句。"""
    if not os.path.exists(PUBLIC_FILE):
        print('！ 缺 %s，时光机按公示表全员出榜' % os.path.relpath(PUBLIC_FILE, ROOT))
        return None
    with open(PUBLIC_FILE, encoding='utf-8') as f:
        return {ln.strip() for ln in f if ln.strip() and not ln.startswith('#')}


def fit(games, first):
    """只用这批对局拟一次 WHR，返回 {姓名: 分数}。"""
    gs = [(a, b, r, (d - first).days) for a, b, r, d, _t in games]
    # whr 每次迭代都会往 stdout 打印进度，这里吞掉，只留本脚本的统计
    with contextlib.redirect_stdout(io.StringIO()):
        try:
            import whr
            base = whr.Base(config={'w2': RATING_W2, 'virtual_games': RATING_VIRTUAL})
            base.create_games(gs)
            base.iterate_until_converge(verbose=False)
            engine = 'whr'
        except ImportError:
            import whr_lite
            base = whr_lite.Base(config={'w2': RATING_W2, 'virtual_games': RATING_VIRTUAL})
            base.create_games(gs)
            base.iterate_until_converge()
            engine = 'whr_lite'
        rows = base.get_ordered_ratings()

    # 历史项是 [天数, 分数, 标准差]；末项即这批对局结束时这个人所处的分数
    out = {}
    for name, hist in rows:
        if hist:
            out[name] = hist[-1][1] + RATING_BASE
    return out, engine


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


def build_series():
    """先验重放一遍，返回 (snaps, players, engine, worst, worst_name, 对局数)。

    players 每项是 [姓名, [时点1, 时点2, ...], [当时局数...]]，未出场处为 None。
    build_players.py 也调这个函数给棋手页画走势，免得两处各算一遍还可能不一致。
    """
    played, tours, table = load_games(DB)
    if not played:
        print('！ 数据库里没有可用的对局')
        return 1

    public = load_public()
    roster = [n for n in table if public is None or n in public]
    snaps = snapshot_dates(played, tours)
    order = sorted(played, key=lambda g: (g[3], g[4]))
    first = order[0][3]

    # 逐日推进：每跨过一个比赛日，就把当天的对局并进模型，重新拟一次。
    # 每次拟合的输入都只到当天为止，所以某一时点的分数不会用到此后的任何结果。
    values = {n: [] for n in roster}
    counts = {n: [] for n in roster}
    engine = ''
    for s in snaps:
        day = datetime.date.fromisoformat(s['d'])
        upto = [g for g in order if g[3] <= day]
        cur, engine = fit(upto, first)

        n_games = {}
        for a, b, _r, _d, _t in upto:
            n_games[a] = n_games.get(a, 0) + 1
            n_games[b] = n_games.get(b, 0) + 1
        for n in roster:
            v = cur.get(n)
            values[n].append(None if v is None else round(v, 2))
            counts[n].append(n_games.get(n, 0) if v is not None else None)

    players = [[n, values[n], counts[n]] for n in roster]

    # 稳定排序：最终分数高者在前，同分按姓名
    players.sort(key=lambda p: (-(p[1][-1] if p[1][-1] is not None else -1e9), p[0]))

    # 自检：末帧与公示表的差距（两个口径不同，这里只报数，不做对齐）
    worst, worst_name = 0.0, ''
    for name, row, _c in players:
        if row[-1] is not None and name in table:
            dv = abs(row[-1] - table[name])
            if dv > worst:
                worst, worst_name = dv, name

    return snaps, players, engine, worst, worst_name, len(played)


def main():
    snaps, players, engine, worst, worst_name, n_played = build_series()

    payload = {
        'asOf': snaps[-1]['d'],
        'engine': engine,
        'mode': 'prior',
        'snaps': snaps,
        'players': players,
        'note': '每个时点只用该日及之前的对局重算，不含后来的胜负；久未参赛者不另作衰减。',
    }
    js = ('/* 由 tools/build_rating_history.py 生成，勿手改。\n'
          '   数据：每个时点（= 某日全部对局结束后）全体棋手的先验等级分。 */\n'
          'window.ZBX_RATING_HISTORY = '
          + json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + ';\n')
    with open(OUT, 'w', encoding='utf-8', newline='') as f:
        f.write(js)

    ranked = sum(1 for p in players if p[1][-1] is not None)
    print('引擎 %s ｜ 对局 %d ｜ 时点 %d ｜ 入册棋手 %d（末帧在榜 %d）'
          % (engine, n_played, len(snaps), len(players), ranked))
    print('末帧与公示表：最大相差 %.2f（%s）——两个口径不同，不做对齐'
          % (worst, worst_name or '-'))
    print('输出 %s  %.0f KB' % (os.path.relpath(OUT, ROOT), os.path.getsize(OUT) / 1024))
    return 0


if __name__ == '__main__':
    sys.exit(main())
