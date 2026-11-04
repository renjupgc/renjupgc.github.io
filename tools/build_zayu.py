#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从五子棋赛事备份库（whr_backup_*.db）中抽取「赛事表」与「对局表」，
生成站点使用的数据：data/renju.db（新的 SQLite 数据库）
                  data/zayu.js （杂豫栏目直接读取的数据文件）

用法：
    python tools/build_zayu.py <源数据库路径>

说明：
    - 只收录 is_public = 1 的赛事（跳过调试/测试赛）
    - winner 字段沿用源库编码：
        1   -> 选手一胜            0   -> 选手二胜
        0.5 -> 和棋                f0  -> 选手一胜（对手弃权）
        0f  -> 选手二胜（对手弃权） ff  -> 双方弃权
        NULL-> 未记录
"""

import json
import os
import sqlite3
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_OUT = os.path.join(ROOT, 'data', 'renju.db')
JS_OUT = os.path.join(ROOT, 'data', 'zayu.js')

RESULT_TEXT = {
    '1': ('1-0', 'player1'),
    '0': ('0-1', 'player2'),
    '0.5': ('½-½', 'draw'),
    'f0': ('+', 'player1'),
    '0f': ('+', 'player2'),
    'ff': ('-', 'none'),
    None: ('', 'none'),
    '': ('', 'none'),
}


def build(src):
    s = sqlite3.connect(src)
    s.row_factory = sqlite3.Row

    tournaments = [dict(r) for r in s.execute(
        'SELECT * FROM tournaments WHERE is_public = 1 ORDER BY date DESC, id DESC')]
    ids = [t['id'] for t in tournaments]
    placeholders = ','.join('?' * len(ids))
    matches = [dict(r) for r in s.execute(
        'SELECT * FROM matches WHERE tournament_id IN (%s) '
        'ORDER BY tournament_id, round, board_number, id' % placeholders, ids)]

    os.makedirs(os.path.dirname(DB_OUT), exist_ok=True)
    if os.path.exists(DB_OUT):
        os.remove(DB_OUT)

    d = sqlite3.connect(DB_OUT)
    d.executescript("""
    CREATE TABLE tournaments (
        id            INTEGER PRIMARY KEY,
        name          TEXT NOT NULL,
        date          TEXT,
        organizer     TEXT,
        rules         TEXT,
        time_limit    TEXT,
        chief_arbiter TEXT,
        participants  TEXT,
        description   TEXT
    );
    CREATE TABLE matches (
        id            INTEGER PRIMARY KEY,
        tournament_id INTEGER NOT NULL REFERENCES tournaments(id),
        round         INTEGER,
        board_number  INTEGER,
        player1       TEXT,
        player2       TEXT,
        winner        TEXT,
        result        TEXT,
        date          TEXT,
        board_record  TEXT,
        swap_sequence TEXT,
        five_a        TEXT
    );
    CREATE INDEX idx_matches_tournament ON matches(tournament_id, round, board_number);
    """)

    for t in tournaments:
        d.execute(
            'INSERT INTO tournaments (id,name,date,organizer,rules,time_limit,'
            'chief_arbiter,participants,description) VALUES (?,?,?,?,?,?,?,?,?)',
            (t['id'], t['name'], t['date'], t['organizer'], t['rules'], t['time_limit'],
             t['chief_arbiter'], t['participants'], t['description']))

    rows = []
    for m in matches:
        result, _ = RESULT_TEXT.get(m['winner'], ('', 'none'))
        rows.append((m['id'], m['tournament_id'], m['round'], m['board_number'],
                     m['player1'], m['player2'], m['winner'], result, m['date'],
                     m['board_record'] or '', m['swap_sequence'] or '', m['five_a'] or ''))
    d.executemany('INSERT INTO matches VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', rows)
    d.commit()

    # 组装页面数据
    by_tid = {}
    for m in matches:
        by_tid.setdefault(m['tournament_id'], []).append(m)

    players = set()
    out = []
    for t in tournaments:
        parts = [p for p in (t['participants'] or '').split(',') if p]
        ms = []
        for m in by_tid.get(t['id'], []):
            result, winner = RESULT_TEXT.get(m['winner'], ('', 'none'))
            players.add(m['player1'])
            players.add(m['player2'])
            ms.append({
                'r': m['round'],
                'b': m['board_number'],
                'p1': m['player1'],
                'p2': m['player2'],
                'res': result,
                'win': winner,
                'date': m['date'],
                'rec': 1 if m['board_record'] else 0,
            })
        out.append({
            'id': t['id'],
            'name': t['name'],
            'date': t['date'],
            'organizer': t['organizer'] or '',
            'rules': t['rules'] or '',
            'timeLimit': t['time_limit'] or '',
            'arbiter': t['chief_arbiter'] or '',
            'desc': t['description'] or '',
            'players': parts,
            'matches': ms,
        })

    payload = {
        'generated': '2026-08-26 备份',
        'tournaments': out,
        'stats': {
            'tournaments': len(out),
            'matches': len(rows),
            'players': len([p for p in players if p]),
        },
    }

    with open(JS_OUT, 'w', encoding='utf-8') as f:
        f.write('window.ZAYU_DATA = ')
        json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';\n')

    s.close()
    d.close()
    print('tournaments: %d, matches: %d, players: %d' %
          (len(out), len(rows), len([p for p in players if p])))
    print('db  ->', DB_OUT)
    print('js  ->', JS_OUT, '(%.0f KB)' % (os.path.getsize(JS_OUT) / 1024))


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    build(sys.argv[1])
