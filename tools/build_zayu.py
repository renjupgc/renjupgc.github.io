#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从五子棋赛事备份库（whr_backup_*.db）中抽取「赛事表」与「对局表」，生成：

    data/renju.db      新的 SQLite 数据库（tournaments / matches 两张表）
    zayu.html          杂豫栏目页：赛事列表
    zayu/t{id}.html    每场赛事的独立页面：赛事信息 + 对局表

用法：
    python tools/build_zayu.py <源数据库路径>

注：zayu.html 与 zayu/ 下的页面均为脚本生成，手工修改会在下次生成时被覆盖。
"""

import html
import json
import os
import sqlite3
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_OUT = os.path.join(ROOT, 'data', 'renju.db')
LIST_OUT = os.path.join(ROOT, 'zayu.html')
DETAIL_DIR = os.path.join(ROOT, 'zayu')

# winner 编码 -> (结果显示, 胜方)
RESULT = {
    '1': ('1-0', 'p1'),
    '0': ('0-1', 'p2'),
    '0.5': ('½-½', ''),
    'f0': ('+', 'p1'),
    '0f': ('+', 'p2'),
    'ff': ('-', ''),
}


def esc(s):
    return html.escape(str(s or ''), quote=True)


HEAD = '''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="stylesheet" href="{base}assets/style.css">
</head>

<body data-nav="杂豫"{base_attr}>

<div class="container">

    <div id="site-header"></div>

    <main>
{body}
    </main>

</div>

<script src="{base}assets/layout.js"></script>

</body>
</html>
'''

FOOT = '''        <p class="back-link"><a href="{back}">← 返回杂豫</a> · <a href="{home}">返回首页</a></p>'''


def fetch(src):
    s = sqlite3.connect(src)
    s.row_factory = sqlite3.Row
    ts = [dict(r) for r in s.execute(
        'SELECT * FROM tournaments WHERE is_public = 1 ORDER BY date DESC, id DESC')]
    ids = [t['id'] for t in ts]
    ph = ','.join('?' * len(ids))
    ms = [dict(r) for r in s.execute(
        'SELECT * FROM matches WHERE tournament_id IN (%s) '
        'ORDER BY tournament_id, round, board_number, id' % ph, ids)]
    s.close()
    return ts, ms


def write_db(ts, ms):
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
    for t in ts:
        d.execute('INSERT INTO tournaments VALUES (?,?,?,?,?,?,?,?,?)',
                  (t['id'], t['name'], t['date'], t['organizer'], t['rules'],
                   t['time_limit'], t['chief_arbiter'], t['participants'], t['description']))
    d.executemany('INSERT INTO matches VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
                  [(m['id'], m['tournament_id'], m['round'], m['board_number'],
                    m['player1'], m['player2'], m['winner'],
                    RESULT.get(m['winner'], ('', ''))[0], m['date'],
                    m['board_record'] or '', m['swap_sequence'] or '', m['five_a'] or '')
                   for m in ms])
    d.commit()
    d.close()


def detail_page(t, ms):
    info = []
    if t['organizer']:
        info.append('主办：' + esc(t['organizer']))
    if t['chief_arbiter']:
        info.append('裁判：' + esc(t['chief_arbiter']))
    if t['rules']:
        info.append('规则：' + esc(t['rules']))
    if t['time_limit']:
        info.append('用时：' + esc(t['time_limit']))
    if ms:
        info.append('对局：%d 局' % len(ms))

    parts = [p for p in (t['participants'] or '').split(',') if p]

    body = ['            <header class="article-header">',
            '                <h1 class="article-title">%s</h1>' % esc(t['name']),
            '                <div class="article-meta">',
            '                    <span>栏目：<a href="../zayu.html">杂豫</a></span>',
            '                    <span>%s</span>' % esc(t['date'] or ''),
            '                </div>',
            '            </header>',
            '']

    if info:
        body.append('            <div class="event-info">%s</div>' %
                    ''.join('<span>%s</span>' % i for i in info))
        body.append('')

    if t['description']:
        body.append('            <p>%s</p>' % esc(t['description']))
        body.append('')

    if parts:
        body.append('            <p class="event-players"><span class="k">参赛棋手</span>%s</p>' %
                    '、'.join(esc(p) for p in parts))
        body.append('')

    if ms:
        body.append('            <table class="matches">')
        body.append('                <thead><tr><th>轮</th><th>台</th><th>假先</th>'
                    '<th>结果</th><th>假后</th></tr></thead>')
        body.append('                <tbody>')
        for m in ms:
            res, _ = RESULT.get(m['winner'], ('—', ''))
            body.append('                    <tr><td class="c-round">%s</td>'
                        '<td class="c-board">%s</td><td class="c-player">%s</td>'
                        '<td class="c-result">%s</td><td class="c-player">%s</td></tr>' %
                        ('—' if m['round'] is None else m['round'],
                         '—' if m['board_number'] is None else m['board_number'],
                         esc(m['player1']), res or '—', esc(m['player2'])))
        body.append('                </tbody>')
        body.append('            </table>')
    else:
        body.append('            <p class="empty">该赛事暂无对局记录。</p>')

    body.append('')
    body.append(FOOT.format(back='../zayu.html', home='../index.html'))

    page = HEAD.format(
        title=esc(t['name']) + ' - 杂豫 - 连珠杂箱',
        desc=esc('河南五子棋赛事：' + (t['name'] or '')),
        base='../',
        base_attr=' data-base="../"',
        body='\n'.join(body))
    path = os.path.join(DETAIL_DIR, 't%d.html' % t['id'])
    with open(path, 'w', encoding='utf-8') as f:
        f.write(page)
    return path


def list_page(ts, by_tid):
    body = ['        <section>',
            '            <h2>杂豫</h2>',
            '            <ul class="tournament-list">']
    for t in ts:
        n = len(by_tid.get(t['id'], []))
        body.append('                <li><a href="zayu/t%d.html">%s</a>'
                    '<span class="date">%s · %d 局</span></li>' %
                    (t['id'], esc(t['name']), esc(t['date'] or ''), n))
    body.append('            </ul>')
    body.append('        </section>')

    page = HEAD.format(
        title='杂豫 - 连珠杂箱',
        desc='河南五子棋赛事与对局记录。',
        base='',
        base_attr='',
        body='\n'.join(body))
    with open(LIST_OUT, 'w', encoding='utf-8') as f:
        f.write(page)


def main(src):
    ts, ms = fetch(src)
    by_tid = {}
    for m in ms:
        by_tid.setdefault(m['tournament_id'], []).append(m)

    os.makedirs(DETAIL_DIR, exist_ok=True)
    for old in os.listdir(DETAIL_DIR):
        if old.startswith('t') and old.endswith('.html'):
            os.remove(os.path.join(DETAIL_DIR, old))

    write_db(ts, ms)
    for t in ts:
        detail_page(t, by_tid.get(t['id'], []))
    list_page(ts, by_tid)

    print('赛事 %d 场 / 对局 %d 局' % (len(ts), len(ms)))
    print('db     ->', DB_OUT)
    print('list   ->', LIST_OUT)
    print('detail ->', DETAIL_DIR, '(%d 页)' % len(ts))


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1])
