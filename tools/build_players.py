#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
为「杂豫」等级分榜上的每位棋手生成个人主页，并给等级分表的姓名加上内链。

    zayu/p/<姓名>.html   个人主页：等级分概览、参赛记录、逐局对局记录
    zayu/rating.html     在姓名单元格里补上指向个人主页的内链

数据全部取自 data/renju.db（tournaments / matches / ratings 三张表），
不依赖源备份库，因此单独跑本脚本就能重建全部个人主页。
「TA的相关报道」直接扫描 posts/ 下属于杂史栏目的文章现算，不落库：
文章增删后重跑一次，各人主页上的报道清单会一起更新。

参赛记录的名次有两种来源：成绩表算出的名次（只对名称含「高校」「大学生」
的赛事显示），以及赛事报道里点名公布的名次——后者存在 data/manual.db 的
event_ranks 表里，凡是表里有的（赛事 id + 姓名）一律按报道登记的名次显示。

用法：
    python tools/build_players.py

注：zayu/p/ 下的页面和本脚本对 rating.html 的改写都是生成物，重跑即可覆盖。
    rating.html 本身由 tools/build_zayu.py 生成，那边也已经带上了同样的内链，
    两个脚本任意顺序运行结果一致。
"""

import collections
import os
import re
import sqlite3
import sys
from urllib.parse import quote

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_zayu as bz          # noqa: E402  复用 HEAD / esc / compute 等

ROOT = bz.ROOT
POSTS_DIR = os.path.join(ROOT, 'posts')
PLAYER_DIR = os.path.join(bz.DETAIL_DIR, 'p')

# 一篇文章属于杂史栏目，看它正文里的栏目链接
ZASHI_MARK = '栏目：<a href="../zashi.html">'

# 参赛记录里只有这几类赛事才按成绩表显示名次（赛事名称包含其中任一关键词）
RANKED_KEYWORDS = ('高校', '大学生')


# ---------------------------------------------------------------- 数据

def load_db():
    d = sqlite3.connect(bz.DB_OUT)
    d.row_factory = sqlite3.Row
    ratings = [dict(r) for r in d.execute(
        'SELECT * FROM ratings ORDER BY rank, name')]
    tournaments = {r['id']: dict(r) for r in d.execute('SELECT * FROM tournaments')}
    matches = [dict(r) for r in d.execute(
        'SELECT * FROM matches ORDER BY tournament_id, round, board_number, id')]
    d.close()
    return ratings, tournaments, matches


def post_text(path):
    raw = open(path, encoding='utf-8').read()
    body = re.sub(r'<(script|style)\b.*?</\1>', ' ', raw, flags=re.S | re.I)
    body = re.sub(r'<[^>]+>', ' ', body)
    return re.sub(r'\s+', '', body)


def zashi_posts(names):
    """扫出杂史栏目的文章，返回 [(路径, 标题, 日期, {姓名: 提及次数})]。"""
    out = []
    for fn in sorted(os.listdir(POSTS_DIR)):
        if not fn.endswith('.html'):
            continue
        path = os.path.join(POSTS_DIR, fn)
        raw = open(path, encoding='utf-8').read()
        if ZASHI_MARK not in raw:
            continue
        m = re.search(r'<h1 class="article-title">(.*?)</h1>', raw, re.S)
        if m:
            # 标题里用 <br> 分行的，拼成一行时补一个破折号
            title = re.sub(r'<br\s*/?>', ' —— ', m.group(1))
            title = re.sub(r'<[^>]+>', '', title)
            title = re.sub(r'[ \t\r\n]+', ' ', title).strip()
        else:
            title = fn
        meta = re.search(r'<div class="article-meta">(.*?)</div>', raw, re.S)
        dm = re.search(r'(\d{4})年(\d{1,2})月(\d{1,2})日', meta.group(1)) if meta else None
        date = ('%s-%02d-%02d' % (dm.group(1), int(dm.group(2)), int(dm.group(3)))
                if dm else '')
        text = post_text(path)
        counts = {n: text.count(n) for n in names}
        out.append((fn, title, date, counts))
    out.sort(key=lambda x: (x[2], x[0]), reverse=True)
    return out


def person_reports(posts):
    """每人被哪些杂史文章写到，返回 {姓名: [{fn, title, date}, ...]}。

    posts 已按日期从新到旧排好，所以各人的报道清单也是新的在前。
    """
    out = collections.defaultdict(list)
    for fn, title, date, counts in posts:
        for name, c in counts.items():
            if c:
                out[name].append({'fn': fn, 'title': title, 'date': date})
    return out


def ranked_event(name):
    """赛事名称含「高校」或「大学生」的，才按成绩表计入可比较的名次。"""
    name = name or ''
    return any(k in name for k in RANKED_KEYWORDS)


def load_event_ranks():
    """读报道公布的名次：{(赛事 id, 姓名): {rank, source, note}}。

    洛阳系列赛这类小型赛事，成绩表只收录了部分对局，算出来的名次不等于
    最终成绩；报道里点名写了名次的，就按报道登记在 data/manual.db 的
    event_ranks 表里，个人主页直接照登，不再拿残缺对局去推算。
    """
    if not os.path.exists(bz.MANUAL_DB):
        return {}
    m = sqlite3.connect(bz.MANUAL_DB)
    m.row_factory = sqlite3.Row
    try:
        rows = [dict(r) for r in m.execute(
            'SELECT tournament_id, player, rank, source, note FROM event_ranks')]
    except sqlite3.OperationalError:        # 旧库还没建这张表
        rows = []
    m.close()
    return {(r['tournament_id'], r['player']): r for r in rows}


# ---------------------------------------------------------------- 对局

def match_result(m, name):
    """返回 (文字, 类别)：类别用于着色，沿用成绩表的胜/负/和记号。"""
    p1, p2, w = m['player1'], m['player2'], m['winner']
    first = (p1 == name)
    if w == '1':
        return ('胜', 'win') if first else ('负', 'loss')
    if w == '0':
        return ('负', 'loss') if first else ('胜', 'win')
    if w == '0.5':
        return '和', 'draw'
    if w == '0f':                 # 假后弃权
        return ('胜', 'fwin') if first else ('弃权负', 'floss')
    if w == 'f0':                 # 假先弃权
        return ('弃权负', 'floss') if first else ('胜', 'fwin')
    if w == 'ff':
        return '双弃', 'floss'
    return '·', ''


def collect(ratings, tournaments, matches):
    """每人：参赛各场成绩 + 逐局记录。"""
    by_tid = collections.defaultdict(list)
    for m in matches:
        by_tid[m['tournament_id']].append(m)

    per_event = {}
    for tid, ms in by_tid.items():
        rows, _rounds = bz.compute(ms)
        per_event[tid] = {r['name']: r for r in rows}

    games = collections.defaultdict(list)
    for tid, ms in by_tid.items():
        t = tournaments.get(tid, {})
        for m in ms:
            p1, p2 = m['player1'], m['player2']
            if bz.BYE in (p1, p2):
                continue
            for name, opp, first in ((p1, p2, True), (p2, p1, False)):
                if not name:
                    continue
                res, cls = match_result(m, name)
                games[name].append({'tid': tid, 't': t, 'm': m, 'opp': opp,
                                    'first': first, 'res': res, 'cls': cls})

    stats = {}
    for name, gl in games.items():
        tids = []
        for g in gl:
            if g['tid'] not in tids:
                tids.append(g['tid'])
        stats[name] = [{'tid': tid, 't': tournaments.get(tid, {}),
                        'row': per_event.get(tid, {}).get(name)} for tid in tids]
        stats[name].sort(key=lambda x: ((x['t'].get('date') or ''), x['tid']),
                         reverse=True)
        gl.sort(key=lambda g: ((g['t'].get('date') or ''),
                               g['m']['round'] or 0), reverse=True)
    return stats, games


# ---------------------------------------------------------------- 页面

def href_player(name):
    """站内链接里的姓名做百分号转义，文件名保持原样。"""
    return bz.player_href(name)


def rank_cell(t, row, name, arts):
    """参赛记录的名次格。

    报道里点名公布了名次的（arts 命中）以报道为准，格子上带一条出处提示；
    否则仍只对名称含「高校」「大学生」的赛事显示成绩表算出的名次，其余留空。
    """
    art = arts.get((t.get('id'), name))
    if art:
        rk = art['rank']
        attr = ' title="%s"' % bz.esc(art['note']) if art.get('note') else ''
    elif row and ranked_event(t.get('name')):
        rk, attr = row['rank'], ''
    else:
        return ''
    if isinstance(rk, int) and 1 <= rk <= 3:
        return '<span class="rank-badge r%d"%s>%d</span>' % (rk, attr, rk)
    if attr:
        return '<span%s>%s</span>' % (attr, bz.esc(rk))
    return bz.esc(rk)


def page(name, rec, events, games, reports, index, total_players, arts):
    region = rec['region'] or '—'
    uni = rec['university'] or '—'
    pt = '%.2f' % rec['rating']
    rank = rec['rank'] or '—'
    as_of = rec['as_of'] or ''

    body = ['            <header class="article-header">',
            '                <h1 class="article-title">%s</h1>' % bz.esc(name),
            '                <div class="article-meta">',
            '                    <span>栏目：<a href="../../zayu.html">杂豫</a></span>',
            '                    <span>%s</span>' % bz.esc(region),
            '                    <span>%s</span>' % bz.esc(uni),
            '                </div>',
            '            </header>',
            '',
            '            <div class="player-stats">',
            '                <span class="ps"><span class="ps-k">等级分</span>'
            '<span class="ps-v">%s</span></span>' % pt,
            '                <span class="ps"><span class="ps-k">榜上名次</span>'
            '<span class="ps-v">第 %s 名</span></span>' % rank,
            '                <span class="ps"><span class="ps-k">对局</span>'
            '<span class="ps-v">%d 局</span></span>' % (rec['games'] or 0),
            '                <span class="ps"><span class="ps-k">胜 / 和 / 负</span>'
            '<span class="ps-v">%d / %d / %d</span></span>'
            % (rec['wins'] or 0, rec['draws'] or 0, rec['losses'] or 0),
            '                <span class="ps"><span class="ps-k">参赛</span>'
            '<span class="ps-v">%d 场</span></span>' % len(events),
            '            </div>',
            '            <p class="player-note">等级分截至 %s，在 <a href="../rating.html">'
            '河南高校爱好者等级分</a>的 %d 人中列第 %s 位；上方对局数与胜负不含'
            '轮空、弃权，下方的对局记录则全部分局照录。'
            % (bz.esc(as_of), total_players, rank),
            '            </p>',
            '']

    if reports:
        body += ['            <section class="mention-card">',
                 '                <h2>TA的相关报道</h2>',
                 '                <p class="mention-line">「杂史」栏目中有 %d 篇'
                 '文章写到 TA：</p>' % len(reports),
                 '                <ul class="mention-list">']
        for r in reports:
            body.append('                    <li><a href="../../posts/%s">%s</a>'
                        '<span class="date">%s</span></li>'
                        % (quote(r['fn']), bz.esc(r['title']),
                           bz.esc(r['date'])))
        body += ['                </ul>',
                 '            </section>',
                 '']

    body += ['            <section>',
             '                <h2>参赛记录</h2>']
    if events:
        body += ['                <div class="table-scroll">',
                 '                <table class="crosstab p-games p-events">',
                 '                    <thead><tr>',
                 '                        <th>日期</th>',
                 '                        <th class="c-name">赛事</th>',
                 '                        <th class="c-rank">名次</th>',
                 '                    </tr></thead>',
                 '                    <tbody>']
        for e in events:
            t, row = e['t'], e['row']
            body.append('                        <tr>'
                        '<td>%s</td>'
                        '<td class="c-name"><a href="../../zayu/t%d.html">%s</a></td>'
                        '<td class="c-rank">%s</td></tr>'
                        % (bz.esc(t.get('date') or ''), e['tid'],
                           bz.esc(t.get('name') or ''),
                           rank_cell(t, row, name, arts)))
        body += ['                    </tbody>',
                 '                </table>',
                 '                </div>']
    else:
        body.append('                <p class="empty">该棋手暂无收录的参赛记录。</p>')
    body.append('            </section>')
    body.append('')

    body += ['            <section>',
             '                <h2>对局记录</h2>']
    if games:
        body += ['                <div class="table-scroll">',
                 '                <table class="crosstab p-games">',
                 '                    <thead><tr>',
                 '                        <th>日期</th>',
                 '                        <th class="c-name">赛事</th>',
                 '                        <th class="c-tb">轮次</th>',
                 '                        <th class="c-tb">执位</th>',
                 '                        <th class="c-opp">对手</th>',
                 '                        <th class="c-rank">结果</th>',
                 '                    </tr></thead>',
                 '                    <tbody>']
        for g in games:
            t = g['t']
            opp = g['opp']
            if opp in index:
                opp_html = '<a href="%s.html">%s</a>' % (quote(opp), bz.esc(opp))
            else:
                opp_html = bz.esc(opp)
            cls = 'res-%s' % g['cls'] if g['cls'] else ''
            body.append('                        <tr>'
                        '<td>%s</td>'
                        '<td class="c-name"><a href="../../zayu/t%d.html">%s</a></td>'
                        '<td class="c-tb">R%s</td>'
                        '<td class="c-tb">%s</td>'
                        '<td class="c-opp">%s</td>'
                        '<td class="c-rank %s">%s</td></tr>'
                        % (bz.esc(t.get('date') or ''),
                           g['tid'], bz.esc(t.get('name') or ''),
                           bz.esc(g['m']['round'] if g['m']['round'] is not None else '—'),
                           '假先' if g['first'] else '假后',
                           opp_html, cls, bz.esc(g['res'])))
        body += ['                    </tbody>',
                 '                </table>',
                 '                </div>']
    else:
        body.append('                <p class="empty">该棋手暂无收录的对局。</p>')
    body.append('            </section>')
    body.append('')
    body.append('            <p class="back-link"><a href="../../zayu.html">← 返回杂豫</a>'
                ' · <a href="../rating.html">等级分榜</a>'
                ' · <a href="../../index.html">返回首页</a></p>')

    desc = '%s（%s%s）的个人主页：等级分 %s，第 %s 名，参赛 %d 场。' % (
        name, region if region != '—' else '',
        '·' + uni if uni != '—' else '', pt, rank, len(events))

    return bz.HEAD.format(
        title='%s - 杂豫 - 连珠杂箱' % bz.esc(name),
        desc=bz.esc(desc),
        base='../../',
        base_attr=' data-base="../../"',
        body='\n'.join(body))


def patch_rating(names):
    """给等级分表的姓名单元格补内链；已是最新则原样返回。"""
    s = open(bz.RATING_OUT, encoding='utf-8').read()
    hit = 0
    for n in names:
        old = '<td class="r-name">%s</td>' % bz.esc(n)
        if old in s:
            s = s.replace(old, '<td class="r-name"><a href="%s">%s</a></td>'
                          % (href_player(n), bz.esc(n)))
            hit += 1
    if hit:
        open(bz.RATING_OUT, 'w', encoding='utf-8', newline='').write(s)
    return hit


def main():
    ratings, tournaments, matches = load_db()
    names = [r['name'] for r in ratings]
    index = set(names)

    zposts = zashi_posts(names)
    reports = person_reports(zposts)
    stats, games = collect(ratings, tournaments, matches)
    arts = load_event_ranks()

    os.makedirs(PLAYER_DIR, exist_ok=True)
    for old in os.listdir(PLAYER_DIR):
        if old.endswith('.html'):
            os.remove(os.path.join(PLAYER_DIR, old))

    for rec in ratings:
        name = rec['name']
        html = page(name, rec, stats.get(name, []), games.get(name, []),
                    reports.get(name, []), index, len(names), arts)
        with open(os.path.join(PLAYER_DIR, '%s.html' % name), 'w',
                  encoding='utf-8', newline='') as f:
            f.write(html)

    linked = patch_rating(names)

    tops = sorted(reports.items(), key=lambda kv: (-len(kv[1]), kv[0]))
    print('主页   ->', PLAYER_DIR, '(%d 页)' % len(ratings))
    print('内链   ->', bz.RATING_OUT, '(%d 处)' % linked)
    print('杂史   ->', len(zposts), '篇')
    print('相关报道 ->', '，'.join('%s %d 篇' % (n, len(v)) for n, v in tops)
          or '无')
    used = sum(1 for (tid, who) in arts
               if who in index and any(e['tid'] == tid
                                       for e in stats.get(who, [])))
    print('报道名次 ->', '%d 条（实际用到 %d 条）' % (len(arts), used))


if __name__ == '__main__':
    main()
