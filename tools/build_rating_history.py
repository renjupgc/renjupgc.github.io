#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
先验重放：生成「每个时点的等级分」，供 zayu/shiguang.html 的时光机与棋手页走势使用。

    assets/rating-history.js    window.ZBX_RATING_HISTORY = {...}

口径
----
与公示表（data/renju.db 的 ratings，由 build_zayu.compute_ratings 算出）同一套规则：

* 只算真正下完的对局：轮空、弃权（f0 / 0f / ff）、无结果的一律不计，和局按 0.5。
* **非公开进行的赛事整批不计**（名单见 data/rating_excluded.txt）。这批赛事站上不出
  赛事页、不公示成绩，算进等级分就会把公开赛的成绩稀释掉——公示表也从不含它们。
* WHR：w2 = 19.3，每人首日附加两个虚拟和棋，输出「分数 + 基准分 2000」。
* 久未参赛按 0.9995 每周衰减，最多累计 730 天；只参加过一次比赛的从 180 天起算。

先验
----
时点取「每个比赛日」，按日合并（同一届赛事常按组别拆成好几条记录，日期相同）。
每个时点单独拟一次 WHR，**只用该日及之前的对局**，衰减的参照日也是那天，
不掺后来的胜负、不做事后校准。所以末时点的数值与公示表逐人相等，
而中间时点给的是「那一刻按当时成绩算，他该是多少分」。

只收公示表（ratings）上、且在 data/public_players.txt 名单里的人：不在名单里的
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
UNRATED_FILE = os.path.join(ROOT, 'data', 'rating_excluded.txt')

RATING_BASE = 2000
RATING_W2 = 19.3
RATING_VIRTUAL = 2
RATING_DECAY_AFTER = 365
RATING_DECAY_AFTER_SINGLE = 180
RATING_DECAY_CAP = 730
RATING_DECAY_RATE = 0.9995

BYE = {'', None, '轮空'}


def load_unrated():
    """不计等级分的赛事名；缺文件就当没有排除项。"""
    if not os.path.exists(UNRATED_FILE):
        print('！ 缺 %s，全部赛事都计入等级分' % os.path.relpath(UNRATED_FILE, ROOT))
        return set()
    with open(UNRATED_FILE, encoding='utf-8') as f:
        return {ln.strip() for ln in f if ln.strip() and not ln.startswith('#')}


def load_games(db, unrated):
    """返回 (played, tournaments, 公示表, 跳过的局数)。

    played 里每项是 (p1, p2, 结果, 日期, 赛事号)，已剔除弃权、轮空与非公开赛事。
    """
    d = sqlite3.connect(db)
    d.row_factory = sqlite3.Row
    tours = {r['id']: dict(r) for r in d.execute('SELECT * FROM tournaments')}

    played = []
    skipped = 0
    for m in d.execute('SELECT * FROM matches'):
        tid = m['tournament_id']
        if (tours.get(tid) or {}).get('name', '').strip() in unrated:
            skipped += 1
            continue
        p1, p2, w = m['player1'], m['player2'], m['winner']
        if p1 in BYE or p2 in BYE or not m['date']:
            continue
        res = {'1': 'B', '0': 'W', '0.5': 'D'}.get(w)
        if res:
            played.append((p1, p2, res, datetime.date.fromisoformat(m['date']), tid))

    table = {r['name']: r['rating'] for r in d.execute('SELECT name, rating FROM ratings')}
    d.close()
    return played, tours, table, skipped


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


def apply_decay(raw, day, events, last_played):
    """复刻公示表的「久未参赛」衰减，参照日取这个时点本身（先验，不看以后）。"""
    for name, v in raw.items():
        last = last_played.get(name)
        if last is None:
            continue
        threshold = (RATING_DECAY_AFTER_SINGLE if len(events.get(name, ())) == 1
                     else RATING_DECAY_AFTER)
        days_since = (day - last).days
        if days_since > threshold:
            decay_days = min(days_since, RATING_DECAY_CAP)
            raw[name] = v * RATING_DECAY_RATE ** (decay_days / 7.0)


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
    unrated = load_unrated()
    played, tours, table, skipped = load_games(DB, unrated)
    if not played:
        print('！ 数据库里没有可用的对局')
        return 1

    public = load_public()
    roster = [n for n in table if public is None or n in public]
    snaps = snapshot_dates(played, tours)
    order = sorted(played, key=lambda g: (g[3], g[4]))
    first = order[0][3]

    if skipped:
        print('非公开赛事：跳过 %d 局（%s）'
              % (skipped, '、'.join(sorted(unrated)) or '-'))

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
        events = {}
        last_played = {}
        for a, b, _r, d, tid in upto:
            for p in (a, b):
                n_games[p] = n_games.get(p, 0) + 1
                events.setdefault(p, set()).add(tid)
                if p not in last_played or d > last_played[p]:
                    last_played[p] = d
        apply_decay(cur, day, events, last_played)

        for n in roster:
            v = cur.get(n)
            values[n].append(None if v is None else round(v, 2))
            counts[n].append(n_games.get(n, 0) if v is not None else None)

    players = [[n, values[n], counts[n]] for n in roster]

    # 稳定排序：最终分数高者在前，同分按姓名
    players.sort(key=lambda p: (-(p[1][-1] if p[1][-1] is not None else -1e9), p[0]))

    # 自检：末帧必须与公示表逐人相等（同一套对局、同一套规则）
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
        'note': '每个时点只用该日及之前的对局重算；非公开赛事不计，久未参赛者按公示表'
                '同一规则衰减。末时点与等级分表逐人相等。',
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
    if worst <= 0.005:
        print('末帧与等级分表：逐人一致')
    else:
        print('！末帧与等级分表最大相差 %.2f（%s）——口径仍不一致，检查对局筛选'
              % (worst, worst_name or '-'))
    print('输出 %s  %.0f KB' % (os.path.relpath(OUT, ROOT), os.path.getsize(OUT) / 1024))
    return 0 if worst <= 0.005 else 1


if __name__ == '__main__':
    sys.exit(main())
