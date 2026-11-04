#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从五子棋赛事备份库（whr_backup_*.db）中抽取「赛事表」与「对局表」，生成：

    data/renju.db      新的 SQLite 数据库（tournaments / matches 两张表）
    zayu.html          杂豫栏目页：赛事列表
    zayu/t{id}.html    每场赛事的独立页面：赛事信息 + 成绩表（逐轮对手 / 积分 / 名次）

用法：
    python tools/build_zayu.py <源数据库路径>

注：zayu.html 与 zayu/ 下的页面均为脚本生成，手工修改会在下次生成时被覆盖。
"""

import html
import os
import sqlite3
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# 不收录的赛事（按名称排除，重新生成时同样生效）
EXCLUDE = {
    '2026暑期高校大师练习赛',
}

DB_OUT = os.path.join(ROOT, 'data', 'renju.db')
LIST_OUT = os.path.join(ROOT, 'zayu.html')
DETAIL_DIR = os.path.join(ROOT, 'zayu')

BYE = '轮空'

# winner 编码 -> (假先得点, 假后得点)；f 表示该方弃权
SCORE = {
    '1': (1.0, 0.0),
    '0': (0.0, 1.0),
    '0.5': (0.5, 0.5),
    '0f': (1.0, 0.0),   # 假后弃权，假先胜
    'f0': (0.0, 1.0),   # 假先弃权，假后胜
    'ff': (0.0, 0.0),   # 双方弃权
    None: (0.0, 0.0),
    '': (0.0, 0.0),
}

# winner 编码 -> (假先结果, 假后结果)，用于落库
RESULT = {
    '1': ('1-0', '0-1'),
    '0': ('0-1', '1-0'),
    '0.5': ('½-½', '½-½'),
    '0f': ('+-', '-+'),
    'f0': ('-+', '+-'),
    'ff': ('--', '--'),
}

SYM = {
    'win': '1', 'loss': '0', 'draw': '½',
    'fwin': '+', 'floss': '−', 'double': '−', 'unknown': '·',
}


def esc(s):
    return html.escape(str(s or ''), quote=True)


def fmt(x):
    """6.0 -> 6，6.5 -> 6.5"""
    return ('%g' % x)


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

FOOT = '        <p class="back-link"><a href="{back}">← 返回杂豫</a> · <a href="{home}">返回首页</a></p>'


# ---------------------------------------------------------------- 数据读取

def fetch(src):
    s = sqlite3.connect(src)
    s.row_factory = sqlite3.Row
    ts = [dict(r) for r in s.execute(
        'SELECT * FROM tournaments WHERE is_public = 1 ORDER BY date DESC, id DESC')
        if (r['name'] or '').strip() not in EXCLUDE]
    ids = [t['id'] for t in ts]
    ph = ','.join('?' * len(ids))
    ms = [dict(r) for r in s.execute(
        'SELECT * FROM matches WHERE tournament_id IN (%s) '
        'ORDER BY tournament_id, round, board_number, id' % ph, ids)]
    idmap = {r['name']: r['id'] for r in s.execute('SELECT name, id FROM players')}
    s.close()
    return ts, ms, idmap


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


# ---------------------------------------------------------------- 成绩计算

def compute(ms):
    """按瑞士制成绩表口径计算每人：逐轮对手、积分、对手分、中间对手分、胜局数。"""
    rounds = sorted({m['round'] for m in ms if m['round'] is not None})
    total_rounds = max(rounds) if rounds else 0

    p = {}

    def get(name):
        if name not in p:
            p[name] = {'cells': {}, 'score': 0.0, 'wins': 0,
                       'floss': 0, 'bye': 0, 'fwin': 0}
        return p[name]

    def apply(name, kind):
        d = get(name)
        if kind == 'win':
            d['score'] += 1.0
            d['wins'] += 1
        elif kind == 'draw':
            d['score'] += 0.5
        elif kind == 'fwin':          # 对手弃权
            d['score'] += 1.0
            d['fwin'] += 1
        elif kind == 'floss':         # 自己弃权
            d['floss'] += 1
        elif kind == 'double':        # 双方弃权
            d['floss'] += 1

    for m in ms:
        r = m['round']
        p1, p2, w = m['player1'], m['player2'], m['winner']

        # 轮空
        if p1 == BYE or p2 == BYE:
            real = p2 if p1 == BYE else p1
            d = get(real)
            d['score'] += 1.0
            d['bye'] += 1
            d['cells'][r] = ('bye', None, '')
            continue

        if w == '1':
            k1, k2 = 'win', 'loss'
        elif w == '0':
            k1, k2 = 'loss', 'win'
        elif w == '0.5':
            k1, k2 = 'draw', 'draw'
        elif w == '0f':               # 假后弃权
            k1, k2 = 'fwin', 'floss'
        elif w == 'f0':               # 假先弃权
            k1, k2 = 'floss', 'fwin'
        elif w == 'ff':
            k1, k2 = 'double', 'double'
        else:
            k1 = k2 = 'unknown'

        apply(p1, k1)
        apply(p2, k2)
        get(p1)['cells'][r] = ('p', p2, k1)
        get(p2)['cells'][r] = ('p', p1, k2)

    # 虚拟积分 = 积分 + (弃权次数 - 轮空次数 - 对手弃权次数) * 0.5
    virtual = {}
    for name, d in p.items():
        virtual[name] = d['score'] + (d['floss'] - d['bye'] - d['fwin']) * 0.5

    rows = []
    for name, d in p.items():
        opp_vals = []
        for r in rounds:
            c = d['cells'].get(r)
            if not c:
                continue
            if c[0] == 'bye':
                opp_vals.append(total_rounds / 2.0)   # 轮空按总轮数一半的虚拟棋手
            else:
                opp_vals.append(virtual.get(c[1], 0.0))

        buch = sum(opp_vals)
        mid = sum(sorted(opp_vals)[1:-1]) if len(opp_vals) >= 3 else 0.0

        rows.append({
            'name': name,
            'cells': d['cells'],
            'score': d['score'],
            'buch': buch,
            'med': mid,
            'wins': d['wins'],
        })

    rows.sort(key=lambda x: (-x['score'], -x['buch'], -x['med'], -x['wins'], x['name']))

    # 名次：同分同名次（1,1,3）
    rank = 0
    prev = None
    for i, row in enumerate(rows, 1):
        key = (row['score'], row['buch'], row['med'], row['wins'])
        if key != prev:
            rank = i
            prev = key
        row['rank'] = rank

    return rows, rounds


# ---------------------------------------------------------------- 页面

def crosstab(rows, rounds, idmap):
    out = ['            <div class="table-scroll">',
           '            <table class="crosstab">',
           '                <thead><tr>',
           '                    <th class="c-no">编号</th>',
           '                    <th class="c-name">姓名</th>']
    out += ['                    <th class="c-round">R%d</th>' % r for r in rounds]
    out.append('                    <th class="c-pt">积分</th>')
    out.append('                    <th class="c-tb">对手分</th>')
    out.append('                    <th class="c-tb">中间对手分</th>')
    out.append('                    <th class="c-tb">胜局数</th>')
    out.append('                    <th class="c-rank">名次</th>')
    out.append('                </tr></thead>')
    out.append('                <tbody>')

    for row in rows:
        cells = []
        for r in rounds:
            c = row['cells'].get(r)
            if not c:
                cells.append('<td class="rt"></td>')
            elif c[0] == 'bye':
                cells.append('<td class="rt bye">轮空</td>')
            else:
                no = idmap.get(c[1], '')
                cells.append('<td class="rt"><span class="opp">%s</span>'
                             '<span class="res">%s</span></td>'
                             % (esc(no), SYM.get(c[2], '')))

        out.append('                    <tr>'
                   '<td class="c-no">%s</td><td class="c-name">%s</td>%s'
                   '<td class="c-pt">%s</td><td class="c-tb">%s</td>'
                   '<td class="c-tb">%s</td><td class="c-tb">%s</td>'
                   '<td class="c-rank">%s</td></tr>'
                   % (esc(idmap.get(row['name'], '')), esc(row['name']),
                      ''.join(cells), fmt(row['score']), fmt(row['buch']),
                      fmt(row['med']), row['wins'], row['rank']))

    out.append('                </tbody>')
    out.append('            </table>')
    out.append('            </div>')
    return out


def detail_page(t, ms, idmap):
    rows, rounds = compute(ms)

    info = []
    if t['organizer']:
        info.append('主办：' + esc(t['organizer']))
    if t['chief_arbiter']:
        info.append('裁判：' + esc(t['chief_arbiter']))
    if t['rules']:
        info.append('规则：' + esc(t['rules']))
    if t['time_limit']:
        info.append('用时：' + esc(t['time_limit']))
    if rows:
        info.append('棋手：%d 人' % len(rows))
        info.append('轮次：%d 轮' % (len(rounds)))
        info.append('对局：%d 局' % sum(
            1 for m in ms if m['player1'] != BYE and m['player2'] != BYE))

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

    if rows:
        body += crosstab(rows, rounds, idmap)
    else:
        body.append('            <p class="empty">该赛事暂无对局记录。</p>')

    body.append('')
    body.append(FOOT.format(back='../zayu.html', home='../index.html'))

    page = HEAD.format(
        title=esc(t['name']) + ' - 杂豫 - 连珠杂箱',
        desc=esc('河南五子棋赛事成绩：' + (t['name'] or '')),
        base='../',
        base_attr=' data-base="../"',
        body='\n'.join(body))
    with open(os.path.join(DETAIL_DIR, 't%d.html' % t['id']), 'w', encoding='utf-8') as f:
        f.write(page)


def list_page(ts, by_tid):
    body = ['        <section>',
            '            <h2>杂豫</h2>',
            '            <ul class="tournament-list">']
    for t in ts:
        n = sum(1 for m in by_tid.get(t['id'], [])
                if m['player1'] != BYE and m['player2'] != BYE)
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
    ts, ms, idmap = fetch(src)
    by_tid = {}
    for m in ms:
        by_tid.setdefault(m['tournament_id'], []).append(m)

    os.makedirs(DETAIL_DIR, exist_ok=True)
    for old in os.listdir(DETAIL_DIR):
        if old.startswith('t') and old.endswith('.html'):
            os.remove(os.path.join(DETAIL_DIR, old))

    write_db(ts, ms)
    for t in ts:
        detail_page(t, by_tid.get(t['id'], []), idmap)
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
