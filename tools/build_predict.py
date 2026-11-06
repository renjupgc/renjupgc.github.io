#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成杂技「胜率预测」用的数据文件：

    assets/predict.js    window.ZBX_PREDICT = {...}

内容三块：
    1. 每位出场过的棋手的等级分、胜负和、地区学校，以及最近几场的参赛成绩；
    2. 两两交手记录（按姓名排序配对），含逐局日期、赛事与结果；
    3. 在全部正式对局上标定出的模型参数——期望得分的斜率、和棋率的衰减。

不用入榜门槛：未满 4 局（外省 2 场）的棋手照样算出一个 WHR 分数，页面上标注
「未入榜·估算」，否则一半人在选择框里都搜不到。分数本身与等级分榜同源
（tools/build_zayu.py 的 compute_ratings），只是不参与排名。

用法：
    python tools/build_predict.py
"""

import collections
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_players as bp       # noqa: E402  复用 load_db / collect / 名次规则
import build_zayu as bz          # noqa: E402

OUT = os.path.join(bz.ROOT, 'assets', 'predict.js')
RECENT_EVENTS = 4                # 每人页面上列几场成绩
RECENT_GAMES = 12                # 每组对手最多列几局
# 期望得分用等级分自己的 logit 尺度：WHR 里 1 分差 = 1 个 logit，输出再乘
# 400/ln10 换成「分」。反推回来，斜率就是 ln10/400 —— 与算等级分时用的链接
# 函数完全一致，不做二次标定（拿同一批对局再拟合斜率属于样本内自证，斜率会
# 虚高到 1.7 倍以上，预测随之过度自信）。
K = math.log(10.0) / 400.0


def fit_draw(rows):
    """和棋率 = D × exp(-|等级分差| / C)，两参数网格搜索最小平方误差。"""
    best = None
    d0 = 0.10
    while d0 <= 0.22001:
        c = 100
        while c <= 320:
            err = 0.0
            for d, is_draw in rows:
                p = d0 * math.exp(-abs(d) / c)
                err += (is_draw - p) ** 2
            if best is None or err < best[2]:
                best = (d0, c, err)
            c += 10
        d0 += 0.005
    return best[0], best[1]


def main():
    ratings, tournaments, matches = bp.load_db()
    unis = {r['name']: r['university'] or '' for r in ratings}
    regions = {r['name']: r['region'] or '' for r in ratings}

    # 1) 等级分：不带门槛算一遍，顺带拿到 listed 标记
    rows, as_of = bz.compute_ratings(matches, unis, regions, apply_threshold=False)
    if not rows:
        print('！ 未安装 whr 库，退出')
        return 1
    rating = {r['name']: r for r in rows}
    listed = {r['name'] for r in ratings}

    # 2) 参赛成绩（含报道登记的名次）与逐局记录
    stats, _games = bp.collect(ratings, tournaments, matches)
    arts = bp.load_event_ranks()

    # 3) 模型标定
    fit_rows = []
    for m in matches:
        p1, p2, w = m['player1'], m['player2'], m['winner']
        if not p1 or not p2 or bz.BYE in (p1, p2):
            continue
        if w not in ('1', '0', '0.5') or p1 not in rating or p2 not in rating:
            continue
        d = rating[p1]['rating'] - rating[p2]['rating']
        fit_rows.append((d, {'1': 1.0, '0.5': 0.5, '0': 0.0}[w]))
    k = K
    draw_rows = [(d, 1 if s == 0.5 else 0) for d, s in fit_rows]
    d0, dc = fit_draw(draw_rows)

    # 标定自查：按等级分差分档，看模型给的期望得分与实得是否相称
    buckets = collections.defaultdict(lambda: [0, 0.0, 0.0])
    for d, sc in fit_rows:
        b = min(int(abs(d) // 100) * 100, 600)
        buckets[b][0] += 1
        buckets[b][1] += sc
        buckets[b][2] += 0.5 + 0.5 * math.tanh(k * d / 2.0)
    print('  分档  局数  实得  模型')
    for b in sorted(buckets):
        n, obs, pred = buckets[b]
        print('  %3d+  %4d  %.3f  %.3f' % (b, n, obs / n, pred / n))

    # 4) 每人一条记录
    players = {}
    for name, r in rating.items():
        ev = []
        for e in (stats.get(name) or [])[:RECENT_EVENTS]:
            t = e['t'] or {}
            rk = arts.get((t.get('id'), name))
            if rk is not None:
                rank = rk['rank']
            elif e.get('row') and bp.ranked_event(t.get('name')):
                rank = e['row']['rank']
            else:
                rank = ''
            ev.append([t.get('date') or '', t.get('id'), rank])
        players[name] = {
            'r': round(r['rating'], 2),
            'listed': 1 if name in listed else 0,
            'rank': r['rank'] if name in listed else 0,
            'g': r['games'], 'w': r['wins'], 'd': r['draws'], 'l': r['losses'],
            'reg': regions.get(name, ''), 'uni': unis.get(name, ''),
            'ev': ev,
        }

    # 5) 交手记录：按姓名排序做键，胜负都按键里靠前的一方记
    pair = collections.defaultdict(lambda: {'n': 0, 'aw': 0, 'd': 0, 'bw': 0, 'g': []})
    for m in matches:
        p1, p2, w = m['player1'], m['player2'], m['winner']
        if not p1 or not p2 or bz.BYE in (p1, p2) or w not in ('1', '0', '0.5'):
            continue
        a, b = sorted((p1, p2))
        rec = pair['%s|%s' % (a, b)]
        rec['n'] += 1
        # 站在 a 的角度看这一局
        if w == '0.5':
            rec['d'] += 1
            res = '0.5'
        elif (w == '1') == (p1 == a):
            rec['aw'] += 1
            res = '1'
        else:
            rec['bw'] += 1
            res = '0'
        rec['g'].append([m['date'] or '', m['tournament_id'], res])

    for rec in pair.values():
        rec['g'].sort(key=lambda g: g[0], reverse=True)
        rec['g'] = rec['g'][:RECENT_GAMES]

    tz = {t['id']: [t.get('date') or '', t.get('name') or '']
          for t in tournaments.values()}

    n_games = sum(1 for _ in fit_rows)
    n_draws = sum(1 for _d, s in fit_rows if s == 0.5)
    data = {
        'asOf': as_of,
        'nGames': n_games,
        'nDraws': n_draws,
        'k': round(k, 6),
        'd0': round(d0, 4),
        'dc': int(dc),
        'tz': tz,
        'players': players,
        'h2h': dict(pair),
    }
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write('/* 由 tools/build_predict.py 生成：杂技「胜率预测」的棋手、'
                '交手记录与模型参数。 */\n')
        f.write('window.ZBX_PREDICT=')
        f.write(json.dumps(data, ensure_ascii=False, separators=(',', ':')))
        f.write(';\n')
    print('棋手 %d 人（入榜 %d）、交手组合 %d 组、样本 %d 局（和 %d）'
          % (len(players), len(listed), len(pair), n_games, n_draws))
    print('标定：k=%.5f  D=%.3f  C=%d' % (k, d0, dc))
    print('predict ->', OUT, '%.1f KB' % (os.path.getsize(OUT) / 1024))
    return 0


if __name__ == '__main__':
    sys.exit(main())
