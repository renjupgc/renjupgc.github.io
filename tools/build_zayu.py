#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从五子棋赛事备份库（whr_backup_*.db）中抽取「赛事表」与「对局表」，生成：

    data/renju.db      新的 SQLite 数据库（tournaments / matches / ratings 三张表）
    zayu.html          杂豫栏目页：赛事列表 + 等级分横幅
    zayu/t{id}.html    每场赛事的独立页面：赛事信息 + 成绩表（逐轮对手 / 积分 / 名次）
    zayu/rating.html   河南高校爱好者等级分表（WHR 算法预先计算）

等级分表里的姓名会链到各自的个人主页 zayu/p/<姓名>.html，
那些页面由 tools/build_players.py 从 data/renju.db 生成，与本脚本互不覆盖。

用法：
    python tools/build_zayu.py <源数据库路径>
    python tools/build_zayu.py --rebuild     # 无源库时：按 data/renju.db 重出页面

依赖：等级分计算需要 whr 库（pip install whr），未安装时跳过等级分部分。

注：zayu.html 与 zayu/ 下的页面均为脚本生成，手工修改会在下次生成时被覆盖。
    --rebuild 不重算等级分，只重新套用 data/manual.db 的手工覆盖（赛事改名、
    对局改写）并重出页面，同时把覆盖结果写回 data/renju.db。
"""

import datetime
import html
import os
import sqlite3
import sys
from urllib.parse import quote

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DB_OUT = os.path.join(ROOT, 'data', 'renju.db')
# 手工增补库：源备份库只读，赛后补录的赛事/对局与「不收录」名单都存在这里
MANUAL_DB = os.path.join(ROOT, 'data', 'manual.db')
LIST_OUT = os.path.join(ROOT, 'zayu.html')
DETAIL_DIR = os.path.join(ROOT, 'zayu')
RATING_OUT = os.path.join(DETAIL_DIR, 'rating.html')

# 等级分参数：沿用 WHR 公开实现（renjurating）的取值
RATING_W2 = 19.3          # 等级分随时间的波动幅度
RATING_VIRTUAL = 2        # 首日附加两个虚拟和棋
RATING_BASE = 2000.0      # 输出基准分

# 久未参赛的衰减：满一年开始，按周衰减，最多累计到 730 天；
# 只参加过一次比赛的棋手，满半年就开始衰减
RATING_DECAY_AFTER = 365
RATING_DECAY_AFTER_SINGLE = 180
RATING_DECAY_CAP = 730
RATING_DECAY_RATE = 0.9995

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


def player_href(name):
    """棋手个人主页的内链（页面由 tools/build_players.py 生成）。"""
    return 'p/%s.html' % quote(name)


def name_cell(name, players):
    """成绩表里的姓名格：有个人主页的做成内链，没有的保持纯文本。"""
    txt = esc(name)
    if name in players:
        return '<a href="%s">%s</a>' % (player_href(name), txt)
    return txt


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

def region_text(raw):
    """把「河南省,开封市,」这类地区字段整理成「河南省 开封市」。"""
    parts = [x.strip() for x in (raw or '').split(',')]
    return ' '.join(x for x in parts if x)


def opt_rows(conn, sql):
    """读可选表：老版本 manual.db 里可能还没有这些表。"""
    try:
        return [dict(r) for r in conn.execute(sql)]
    except sqlite3.OperationalError:
        return []


def read_manual():
    """读手工增补库 data/manual.db。

    源备份库当作只读原件，赛后补录与排除名单都写在这个库里：
      hidden_tournaments  不收录的赛事（按名称）
      tournaments_extra   新增赛事
      matches_extra       新增对局（winner 编码与源库一致：1 / 0 / 0.5 / f0 / 0f / ff）
      forfeit_players     弃权名单，这些棋手的所有对局都记本人弃权负
      tournament_renames  赛事改名（源库里的名称有误时在这里覆盖）
      match_rules         对局改写规则，在弃权名单之后套用（优先级更高）
    """
    if not os.path.exists(MANUAL_DB):
        return [], [], set(), set(), [], {}
    m = sqlite3.connect(MANUAL_DB)
    m.row_factory = sqlite3.Row
    extra_t = [dict(r) for r in m.execute('SELECT * FROM tournaments_extra')]
    extra_m = [dict(r) for r in m.execute('SELECT * FROM matches_extra')]
    hidden = {r['name'] for r in m.execute('SELECT name FROM hidden_tournaments')}
    forfeit = {r['name'] for r in m.execute('SELECT name FROM forfeit_players')}
    rules = opt_rows(m, 'SELECT * FROM match_rules')
    renames = {r['old_name']: r['new_name']
               for r in opt_rows(m, 'SELECT * FROM tournament_renames')}
    m.close()
    return extra_t, extra_m, hidden, forfeit, rules, renames


def apply_overrides(ts, ms, rules, renames):
    """套用手工覆盖：赛事改名 + 按规则改写对局结果。

    规则形如「某赛事里，凡 subject 的对局，除与 except_players 中的对手外，
    一律改记为 winner/result」——用来纠正整批漏记、误记的成绩。
    """
    for t in ts:
        new = renames.get((t['name'] or '').strip())
        if new:
            t['name'] = new

    for rule in rules:
        subj = (rule['subject'] or '').strip()
        except_ = {x.strip() for x in (rule['except_players'] or '').split(',')
                   if x.strip()}
        for m in ms:
            if m['tournament_id'] != rule['tournament_id']:
                continue
            p1, p2 = m['player1'], m['player2']
            if p1 in (None, '') or p2 in (None, '') or BYE in (p1, p2):
                continue
            if subj == p1:
                opp = p2
            elif subj == p2:
                opp = p1
            else:
                continue
            if opp in except_:
                continue
            m['winner'] = rule['winner']
            if rule['result']:
                m['result'] = rule['result']


def fetch(src):
    s = sqlite3.connect(src)
    s.row_factory = sqlite3.Row
    extra_t, extra_m, hidden, forfeit, rules, renames = read_manual()
    ts = [dict(r) for r in s.execute('SELECT * FROM tournaments WHERE is_public = 1')
          if (r['name'] or '').strip() not in hidden]
    ts += [dict(r) for r in extra_t if (r['name'] or '').strip() not in hidden]
    ts.sort(key=lambda t: ((t['date'] or ''), t['id']), reverse=True)
    ids = [t['id'] for t in ts]
    ph = ','.join('?' * len(ids))
    ms = [dict(r) for r in s.execute(
        'SELECT * FROM matches WHERE tournament_id IN (%s) '
        'ORDER BY tournament_id, round, board_number, id' % ph, ids)]
    kept = set(ids)
    ms += [dict(r) for r in extra_m if r['tournament_id'] in kept]
    ms.sort(key=lambda m: (m['tournament_id'], m['round'] or 0,
                           m['board_number'] or 0, m['id']))
    # 弃权名单：这些棋手的所有对局都改记为本人弃权负
    for m in ms:
        p1, p2 = m['player1'], m['player2']
        if p1 in (None, '') or p2 in (None, '') or BYE in (p1, p2):
            continue
        a, b = p1 in forfeit, p2 in forfeit
        if a and b:
            m['winner'] = 'ff'
        elif a:
            m['winner'] = 'f0'
        elif b:
            m['winner'] = '0f'
    # 手工覆盖（改名、按规则改写对局）放在弃权名单之后，规则优先
    apply_overrides(ts, ms, rules, renames)
    idmap = {r['name']: r['id'] for r in s.execute('SELECT name, id FROM players')}
    unis = {r['name']: (r['university'] or '').strip()
            for r in s.execute('SELECT name, university FROM players')}
    regions = {r['name']: region_text(r['region'])
               for r in s.execute('SELECT name, region FROM players')}
    s.close()
    return ts, ms, idmap, unis, regions


def write_db(ts, ms, ratings=None):
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
    CREATE TABLE ratings (
        name       TEXT PRIMARY KEY,
        region     TEXT,
        university TEXT,
        rating     REAL,
        games      INTEGER,
        wins       INTEGER,
        draws      INTEGER,
        losses     INTEGER,
        rank       INTEGER,
        as_of      TEXT
    );
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
    if ratings:
        d.executemany('INSERT INTO ratings VALUES (?,?,?,?,?,?,?,?,?,?)',
                      [(r['name'], r['region'], r['uni'], r['pt'],
                        r['games'], r['wins'], r['draws'], r['losses'],
                        r['rank'], r['as_of'])
                       for r in ratings])
    d.commit()
    d.close()


# ---------------------------------------------------------------- 成绩计算

def compute(ms):
    """按瑞士制成绩表口径计算每人：逐轮对手、积分、对手分、中间对手分、胜局数。

    对手分：所有对手的虚拟积分之和。轮空补一个「总轮数一半」的虚拟对手；
    某一轮根本没有对局（空着的格子）则视为一个 0 分的虚拟对手。
    中间对手分：去掉最高、最低各一个后求和，虚拟对手同样参与（0 分自然成为最低分被剔除）。
    """
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
        get(p1)['cells'][r] = ('p', p2, k1, 'first')    # 假先
        get(p2)['cells'][r] = ('p', p1, k2, 'second')   # 假后

    # 虚拟积分 = 积分 + (弃权次数 - 轮空次数 - 对手弃权次数) * 0.5
    virtual = {}
    for name, d in p.items():
        virtual[name] = d['score'] + (d['floss'] - d['bye'] - d['fwin']) * 0.5

    rows = []
    for name, d in p.items():
        opp_vals = []          # 对手分：含虚拟对手（轮空按总轮数一半 / 空局按 0 分）
        mid_vals = []          # 中间对手分：同样含虚拟对手（0 分通常会被当作最低分剔除）
        for r in rounds:
            c = d['cells'].get(r)
            if not c:
                opp_vals.append(0.0)                 # 这一轮没有对局
                mid_vals.append(0.0)
                continue
            if c[0] == 'bye':
                v = total_rounds / 2.0               # 轮空
            else:
                v = virtual.get(c[1], 0.0)
            opp_vals.append(v)
            mid_vals.append(v)

        buch = sum(opp_vals)
        mid = sum(sorted(mid_vals)[1:-1]) if len(mid_vals) >= 3 else 0.0

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


# ---------------------------------------------------------------- 等级分

def compute_ratings(ms, unis, regions):
    """用 WHR（Whole-History Rating）算法预先计算每位棋手的等级分。

    只统计真正下完的对局：轮空、弃权（f0 / 0f / ff）与无结果的对局都不计入，
    和局按 0.5 计（因此「对局数」也只含非弃权、非轮空的对局）。
    参数：w2 = 19.3，每人首日附加两个虚拟和棋，输出「WHR 分数 + 基准分 2000」。
    长期未参赛按 0.9995 每周衰减，最多累计 730 天；起点为 365 天，
    只参加过一次比赛的棋手从 180 天起算。
    """
    try:
        import whr
    except ImportError:
        print('！ 未安装 whr 库，跳过等级分（python -m pip install whr）')
        return None, None

    played = []
    for m in ms:
        p1, p2, w = m['player1'], m['player2'], m['winner']
        if p1 in (None, '', BYE) or p2 in (None, '', BYE) or not m['date']:
            continue
        res = {'1': 'B', '0': 'W', '0.5': 'D'}.get(w)
        if res:
            played.append((p1, p2, res, datetime.date.fromisoformat(m['date']),
                           m['tournament_id']))
    if not played:
        return None, None

    first = min(g[3] for g in played)
    games = [(a, b, r, (d - first).days) for a, b, r, d, _ in played]

    stats = {}
    events = {}
    last_played = {}

    def bump(name):
        s = stats.setdefault(name, {'games': 0, 'wins': 0, 'draws': 0, 'losses': 0})
        s['games'] += 1
        return s

    # 参赛场次与最后出场日期都只看真正下过的对局
    for a, b, _r, d, tid in played:
        for p in (a, b):
            events.setdefault(p, set()).add(tid)
            if p not in last_played or d > last_played[p]:
                last_played[p] = d

    for a, b, r, _ in games:
        if r == 'B':
            bump(a)['wins'] += 1
            bump(b)['losses'] += 1
        elif r == 'W':
            bump(a)['losses'] += 1
            bump(b)['wins'] += 1
        else:
            bump(a)['draws'] += 1
            bump(b)['draws'] += 1

    base = whr.Base(config={'w2': RATING_W2, 'virtual_games': RATING_VIRTUAL})
    base.create_games(games)
    base.iterate_until_converge(verbose=False)

    as_of_date = max(g[3] for g in played)
    as_of = as_of_date.isoformat()
    rows = []
    for name, hist in base.get_ordered_ratings():
        s = stats.get(name, {'games': 0, 'wins': 0, 'draws': 0, 'losses': 0})
        ev = len(events.get(name, ()))
        rating = hist[-1][1] + RATING_BASE
        # 长期未参赛：一般满一年开始衰减，只打过一场比赛的满半年就开始；
        # 按周衰减，最多累计两年
        threshold = (RATING_DECAY_AFTER_SINGLE if ev == 1
                     else RATING_DECAY_AFTER)
        days_since = (as_of_date - last_played[name]).days
        if days_since > threshold:
            decay_days = min(days_since, RATING_DECAY_CAP)
            rating *= RATING_DECAY_RATE ** (decay_days / 7.0)
        rows.append({'name': name, 'uni': unis.get(name, ''),
                     'region': regions.get(name, ''),
                     'rating': rating,
                     'games': s['games'], 'wins': s['wins'],
                     'draws': s['draws'], 'losses': s['losses'],
                     'events': len(events.get(name, ())),
                     'as_of': as_of})

    # 入榜门槛：只看地区。河南选手须下满 4 局；外省选手须至少参加 2 场比赛
    def is_henan(r):
        return '河南' in (r['region'] or '')

    rows = [r for r in rows
            if (r['games'] >= 4 if is_henan(r) else r['events'] >= 2)]

    for r in rows:
        r['pt'] = round(r['rating'], 2)       # 等级分保留两位小数
    rows.sort(key=lambda r: (-r['pt'], -r['games'], r['name']))

    # 等级分相同者并列
    rank, prev = 0, None
    for i, r in enumerate(rows, 1):
        if r['pt'] != prev:
            rank, prev = i, r['pt']
        r['rank'] = rank
    return rows, as_of


def rating_page(rows, as_of, n_tournaments, n_games):
    body = ['        <header class="article-header">',
            '            <h1 class="article-title">河南高校爱好者等级分</h1>',
            '            <div class="article-meta">',
            '                <span>栏目：<a href="../zayu.html">杂豫</a></span>',
            '                <span>%s 更新</span>' % esc(as_of),
            '            </div>',
            '        </header>',
            '',
            '        <div class="table-scroll">',
            '        <table class="ratings">',
            '            <thead><tr>',
            '                <th class="r-rank">名次</th>',
            '                <th class="r-name">姓名</th>',
            '                <th class="r-region">地区</th>',
            '                <th class="r-uni">学校</th>',
            '                <th class="r-pt">等级分</th>',
            '            </tr></thead>',
            '            <tbody>']

    for r in rows:
        body.append('                <tr><td class="r-rank">%d</td>'
                    '<td class="r-name"><a href="%s">%s</a></td>'
                    '<td class="r-region">%s</td><td class="r-uni">%s</td>'
                    '<td class="r-pt">%.2f</td></tr>'
                    % (r['rank'], player_href(r['name']), esc(r['name']),
                       esc(r['region'] or '—'), esc(r['uni'] or '—'), r['pt']))

    body += ['            </tbody>',
             '        </table>',
             '        </div>',
             '',
             FOOT.format(back='../zayu.html', home='../index.html')]

    page = HEAD.format(
        title='河南高校爱好者等级分（%s 更新） - 杂豫 - 连珠杂箱' % as_of,
        desc='河南高校五子棋爱好者等级分，WHR 算法计算，%s 更新。' % as_of,
        base='../',
        base_attr=' data-base="../"',
        body='\n'.join(body))
    with open(RATING_OUT, 'w', encoding='utf-8') as f:
        f.write(page)


# ---------------------------------------------------------------- 页面

def crosstab(rows, rounds, idmap, players=()):
    """成绩表。姓名链到个人主页（p/<姓名>.html），并列名次按赛事编号从小到大排。"""
    rows = sorted(rows, key=lambda r: (r['rank'], idmap.get(r['name'], 0)))
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
                # 假先的格子用阴影底，假后留白
                cls = 'rt first' if len(c) > 3 and c[3] == 'first' else 'rt'
                cells.append('<td class="%s"><span class="opp">%s</span>'
                             '<span class="res">%s</span></td>'
                             % (cls, esc(no), SYM.get(c[2], '')))

        out.append('                    <tr>'
                   '<td class="c-no">%s</td><td class="c-name">%s</td>%s'
                   '<td class="c-pt">%s</td><td class="c-tb">%s</td>'
                   '<td class="c-tb">%s</td><td class="c-tb">%s</td>'
                   '<td class="c-rank">%s</td></tr>'
                   % (esc(idmap.get(row['name'], '')), name_cell(row['name'], players),
                      ''.join(cells), fmt(row['score']), fmt(row['buch']),
                      fmt(row['med']), row['wins'], row['rank']))

    out.append('                </tbody>')
    out.append('            </table>')
    out.append('            </div>')
    return out


def roster_ids(t, ms):
    """赛事内编号：按参赛名单顺序从 1 开始，名单外出场的棋手依次续编。"""
    names = [x.strip() for x in (t['participants'] or '').split(',') if x.strip()]
    seen = set(names)
    for m in ms:
        for p in (m['player1'], m['player2']):
            if p and p != BYE and p not in seen:
                seen.add(p)
                names.append(p)
    return {n: i for i, n in enumerate(names, 1)}


def all_players(ms):
    """全部出场过的棋手：每个人在 zayu/p/ 下都会有一页主页（build_players.py 生成）。"""
    out = set()
    for m in ms:
        for p in (m['player1'], m['player2']):
            if p and p != BYE:
                out.add(p)
    return out


def event_ranks_for(tid):
    """某场赛事里人工/报道登记的名次：{姓名: 名次}。"""
    if not os.path.exists(MANUAL_DB):
        return {}
    m = sqlite3.connect(MANUAL_DB)
    try:
        rows = m.execute('SELECT player, rank FROM event_ranks WHERE tournament_id=?',
                         (tid,)).fetchall()
    except sqlite3.OperationalError:
        rows = []
    m.close()
    return {p: r for p, r in rows}


def detail_page(t, ms, players=()):
    rows, rounds = compute(ms)
    idmap = roster_ids(t, ms)
    # 成绩表只收录了部分对局的赛事，算出来的名次不等于最终成绩；
    # 登记过名次的（报道公布或棋友补录）以登记的为准。
    fixed = event_ranks_for(t['id'])
    for r in rows:
        if r['name'] in fixed:
            r['rank'] = fixed[r['name']]

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
        info.append('轮次：%d 轮' % max(rounds))
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
        body += crosstab(rows, rounds, idmap, players)
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


def list_page(ts, by_tid, as_of=None):
    body = []
    if as_of:
        body += ['        <a class="banner" href="zayu/rating.html">',
                 '            <span class="banner-text">河南高校爱好者等级分'
                 '（%s 更新）</span>' % esc(as_of),
                 '            <span class="banner-more">查看 →</span>',
                 '        </a>',
                 '']
    body += ['        <section>',
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


def sync_overrides(ts, ms):
    """把手上的覆盖结果写回 data/renju.db，只更新真正有变化的那几行。"""
    d = sqlite3.connect(DB_OUT)
    n_t = n_m = 0
    for t in ts:
        cur = d.execute('UPDATE tournaments SET name = ? WHERE id = ? AND name <> ?',
                        (t['name'], t['id'], t['name']))
        n_t += cur.rowcount
    for m in ms:
        cur = d.execute(
            'UPDATE matches SET winner = ?, result = ? WHERE id = ? '
            'AND (winner IS NOT ? OR result IS NOT ?)',
            (m['winner'], m['result'], m['id'], m['winner'], m['result']))
        n_m += cur.rowcount
    d.commit()
    d.close()
    return n_t, n_m


def rebuild_pages():
    """不碰源备份库：直接读 data/renju.db，套用手工覆盖后重建页面。

    等级分沿用库内既有快照（不重算 WHR —— 弃权、轮空本来就不计入等级分，
    把弃权改成双弃不会改变任何人的等级分），适合在没有源库、也没装 whr
    的机器上改完数据后重出页面。
    """
    d = sqlite3.connect(DB_OUT)
    d.row_factory = sqlite3.Row
    ts = [dict(r) for r in d.execute('SELECT * FROM tournaments')]
    ts.sort(key=lambda t: ((t['date'] or ''), t['id']), reverse=True)
    ms = [dict(r) for r in d.execute(
        'SELECT * FROM matches ORDER BY tournament_id, round, board_number, id')]
    as_of = d.execute('SELECT MAX(as_of) FROM ratings').fetchone()[0] or ''
    d.close()

    _extra_t, _extra_m, _hidden, _forfeit, rules, renames = read_manual()
    apply_overrides(ts, ms, rules, renames)
    n_t, n_m = sync_overrides(ts, ms)

    by_tid = {}
    for m in ms:
        by_tid.setdefault(m['tournament_id'], []).append(m)

    os.makedirs(DETAIL_DIR, exist_ok=True)
    for old in os.listdir(DETAIL_DIR):
        if old.startswith('t') and old.endswith('.html'):
            os.remove(os.path.join(DETAIL_DIR, old))
    players = all_players(ms)
    for t in ts:
        detail_page(t, by_tid.get(t['id'], []), players)
    list_page(ts, by_tid, as_of)

    print('赛事 %d 场 / 对局 %d 局' % (len(ts), len(ms)))
    print('覆盖 -> 赛事改名 %d 处，对局改写 %d 处' % (n_t, n_m))
    print('list   ->', LIST_OUT)
    print('detail ->', DETAIL_DIR, '(%d 页)' % len(ts))
    print('rating -> 沿用库内快照（截至 %s），未重算' % as_of)


def main(src):
    ts, ms, idmap, unis, regions = fetch(src)
    by_tid = {}
    for m in ms:
        by_tid.setdefault(m['tournament_id'], []).append(m)

    os.makedirs(DETAIL_DIR, exist_ok=True)
    for old in os.listdir(DETAIL_DIR):
        if old.startswith('t') and old.endswith('.html'):
            os.remove(os.path.join(DETAIL_DIR, old))

    ratings, as_of = compute_ratings(ms, unis, regions)
    write_db(ts, ms, ratings)
    players = all_players(ms)
    for t in ts:
        detail_page(t, by_tid.get(t['id'], []), players)
    list_page(ts, by_tid, as_of)
    if ratings:
        rating_page(ratings, as_of, len(ts),
                    sum(r['games'] for r in ratings) // 2)

    print('赛事 %d 场 / 对局 %d 局' % (len(ts), len(ms)))
    print('db     ->', DB_OUT)
    print('list   ->', LIST_OUT)
    print('detail ->', DETAIL_DIR, '(%d 页)' % len(ts))
    if ratings:
        print('rating ->', RATING_OUT,
              '(%d 人，截至 %s)' % (len(ratings), as_of))


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    if sys.argv[1] == '--rebuild':
        rebuild_pages()
    else:
        main(sys.argv[1])
