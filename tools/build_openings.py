#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把库里录了完整手顺的对局导成一份给前端用的语料。

    assets/openings-data.js    window.ZBX_OPENING_GAMES

打谱页上的「同型局」要做两件事：拿当前局面的 225 维落点向量去比相似度，
以及把找到的那一局直接摆回棋盘。这两件都在浏览器里算，所以需要的不是
每局一个 JSON（几十个请求），而是一份一次取回的小语料：局号、对手、赛事、
日期、胜负，加上一手两个字母的紧凑手顺（见 board.js 的 encodeCompact）。

语料只有「录了谱」的那几十局，这是数据库的实情：2561 局里绝大多数只有
胜负没有手顺，局面上没法比。跑完会把这些数目打出来，页面上的文案照此写。

用法：
    python tools/build_openings.py

开局叫什么名字不在这里判——名称表在 assets/openings.js，前端和 node 校验
共用同一份，免得两边各写一套坐标表而对不上。
"""

import json
import os
import sqlite3
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, 'data', 'renju.db')
OUT = os.path.join(ROOT, 'assets', 'openings-data.js')

ALPHA = 'abcdefghijklmno'
SIZE = 15


def parse_record(text):
    """'7,7;7,6;8,6' -> [(i, j), ...]；j 自上而下，与 board.js 一致。"""
    out = []
    for tok in (text or '').replace(' ', '').split(';'):
        if not tok:
            continue
        try:
            i, j = tok.split(',')
            i, j = int(i), int(j)
        except ValueError:
            continue
        if 0 <= i < SIZE and 0 <= j < SIZE:
            out.append((i, j))
    return out


def compact(moves):
    """一手两个字母：列 + 行（行自下而上，与坐标记法 A1..O15 同向）。"""
    return ''.join(ALPHA[i] + ALPHA[SIZE - 1 - j] for i, j in moves)


def main():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        'SELECT m.id, m.tournament_id, m.round, m.board_number, m.player1, m.player2,'
        '       m.winner, m.result, m.date, m.board_record, t.name AS tname'
        '  FROM matches m LEFT JOIN tournaments t ON t.id = m.tournament_id'
        " WHERE m.board_record IS NOT NULL AND m.board_record <> ''"
        ' ORDER BY m.date DESC, m.id DESC').fetchall()

    games = []
    for r in rows:
        mv = parse_record(r['board_record'])
        if len(mv) < 3:                     # 三手才够判开局名
            continue
        games.append({
            'id': r['id'],
            'tid': r['tournament_id'],
            't': r['tname'] or '',
            'd': r['date'] or '',
            'r': r['round'],
            'n': r['board_number'],
            'a': r['player1'] or '',
            'b': r['player2'] or '',
            'res': r['result'] or '',
            'w': 1 if r['winner'] == '1' else (2 if r['winner'] == '0' else 0),
            'm': compact(mv),
            'len': len(mv),
        })

    total = conn.execute('SELECT COUNT(*) FROM matches').fetchone()[0]

    payload = {
        'total': total,                      # 全站对局数
        'games': games,                      # 有手顺、能比局面的
        'note': '手顺取自已录入的棋谱；只有胜负没有手顺的对局不参与同型比对。',
    }
    text = ('/* 由 tools/build_openings.py 生成，请勿手改。\n'
            ' * 有完整手顺的对局语料，供 zaji/dapu.html 的开局命名与同型检索使用。\n'
            ' * m 是一手两个字母的紧凑手顺，编码规则同 board.js 的 encodeCompact。\n'
            ' */\n'
            'window.ZBX_OPENING_GAMES = '
            + json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + ';\n')
    with open(OUT, 'w', encoding='utf-8', newline='') as f:
        f.write(text)

    print('语料   -> %s（%d 局，%.1f KB）' % (OUT, len(games), len(text.encode('utf-8')) / 1024))
    print('对局   -> 全站 %d 局，其中有手顺的可比对 %d 局' % (total, len(games)))
    hand = sum(1 for g in games if g['m'].startswith('hh'))
    print('天元   -> %d 局首手天元（h8），其余首手不居中，命名以其首手为原点' % hand)


if __name__ == '__main__':
    sys.exit(main())
