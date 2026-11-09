#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
为所有出场过的棋手生成个人主页，并给等级分表的姓名加上内链。

    zayu/p/<姓名>.html   个人主页：等级分概览、参赛记录、逐局对局记录
    zayu/rating.html     在姓名单元格里补上指向个人主页的内链

主页覆盖两类人：等级分榜上的棋手（有等级分与榜上名次），以及只在成绩表里
出场过、尚未达到入榜门槛的棋手（等级分一栏留「—」，写「未入榜」）。成绩表
（zayu/t*.html）里的姓名正是靠这批页面才能点进去，所以两者必须一一对应。

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
import json
import os
import re
import sqlite3
import sys
from urllib.parse import quote

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_zayu as bz          # noqa: E402  复用 HEAD / esc / compute 等
import renwu_data as rw          # noqa: E402  杂豫「山河四省连珠人物」的人物资料

ROOT = bz.ROOT
POSTS_DIR = os.path.join(ROOT, 'posts')
PLAYER_DIR = os.path.join(bz.DETAIL_DIR, 'p')
SEARCH_OUT = os.path.join(ROOT, 'assets', 'players.js')

# 一篇文章属于杂史栏目，看它正文里的栏目链接
ZASHI_MARK = '栏目：<a href="../zashi.html">'

# 参赛记录里只有这几类赛事才按成绩表显示名次（赛事名称包含其中任一关键词）
RANKED_KEYWORDS = ('高校', '大学生')

# 未入榜者的籍贯与学校：ratings 只收进榜的人，这几个字段就得另记。
# 键 = 姓名，(地区, 学校)。
REGION_OVERRIDE = {
    '药博凡': ('北京市', ''),
    '刘郑贺': ('河北省 唐山市', ''),
    '邱海妍': ('山东省 济南市', '山东大学'),
    '唐楷': ('重庆市', ''),
}

# 同名不同人：站内按姓名做键，重名的人只能分开命名。
# MENTION 给出该人在杂史正文里的写法（报道里不会带括注）；
# REPORT_EXCLUDE 再把不属本人的那几篇剔掉，免得两位李丹的战绩串在一起。
MENTION = {'李丹（洛阳）': '李丹'}
REPORT_EXCLUDE = {
    '李丹': ('2026-luoyang-huifutang.html', '2026-luoyang-yuedu.html'),
}


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
    needles = {n: MENTION.get(n, n) for n in names}
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
        counts = {n: text.count(needles[n]) for n in names}
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


def tally(matches):
    """按等级分口径统计每人：正式对局数、胜、和、负（不含轮空与弃权）。

    只用于未入榜棋手——入榜者的这四项直接取等级分表里的快照。
    """
    s = {}

    def bump(name, key):
        d = s.setdefault(name, {'games': 0, 'wins': 0, 'draws': 0, 'losses': 0})
        d['games'] += 1
        d[key] += 1

    for m in matches:
        p1, p2, w = m['player1'], m['player2'], m['winner']
        if not p1 or not p2 or bz.BYE in (p1, p2):
            continue
        if w == '1':
            bump(p1, 'wins')
            bump(p2, 'losses')
        elif w == '0':
            bump(p1, 'losses')
            bump(p2, 'wins')
        elif w == '0.5':
            bump(p1, 'draws')
            bump(p2, 'draws')
    return s


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


# 杂史报道里点到、成绩表却未收录的赛事（洛阳月赛、双人联棋一类），只登在
# 相关棋手主页的参赛记录里，不另建赛事页。日期取报道所记比赛当日。
EXTRA_EVENTS = {
    '潘冠臣': [
        {'date': '2026-05-23',
         'name': '洛阳市“棋遇少年游”五子棋亲子联棋赛（双人联棋组）',
         'href': '../../posts/2026-luoyang-liuyi.html', 'rank': 1,
         'note': '与唐碧搭档“白羊双子星队”，全胜夺冠，据杂史《棋遇少年，亲子同局》'},
        {'date': '2026-03-07',
         'name': '洛阳天元站庆“三八”五子棋双人联棋赛',
         'href': '../../posts/2026-luoyang-tianyuan.html', 'rank': 1,
         'note': '与乔仕鑫搭档“潘乔联队”夺冠，据杂史《新春开枰，佳节联棋》'},
    ],
    '乔仕鑫': [
        {'date': '2026-03-07',
         'name': '洛阳天元站庆“三八”五子棋双人联棋赛',
         'href': '../../posts/2026-luoyang-tianyuan.html', 'rank': 1,
         'note': '与潘冠臣搭档“潘乔联队”夺冠，据杂史《新春开枰，佳节联棋》'},
    ],
    '李丹（洛阳）': [
        {'date': '2026-02-22',
         'name': '丙午年首场五子棋月赛（晖福堂）公开组',
         'href': '../../posts/2026-luoyang-huifutang.html', 'rank': 1,
         'note': '公开组冠军，据杂史《五子闪耀庆新春 老少同枰贺佳节》'},
    ],
    # 下面几位不在等级分榜、成绩表里也没有对局，参赛记录只能从杂史报道里摘。
    # 月度棋王的报道未记具体日期，日期栏只记到月份。
    '唐碧': [
        {'date': '2026-08',
         'name': '洛阳月度棋王海选赛（八月）',
         'href': '../../posts/2026-luoyang-yuedu.html', 'rank': 1,
         'note': '八月棋王，据杂史《月度手谈，棋王落定》所附全年月度棋王一览'},
        {'date': '2026-05-23',
         'name': '洛阳市“棋遇少年游”五子棋亲子联棋赛（双人联棋组）',
         'href': '../../posts/2026-luoyang-liuyi.html', 'rank': 1,
         'note': '与潘冠臣搭档“白羊双子星队”，全胜夺冠，据杂史《棋遇少年，亲子同局》'},
        {'date': '2026-03-07',
         'name': '洛阳天元站庆“三八”五子棋双人联棋赛',
         'href': '../../posts/2026-luoyang-tianyuan.html', 'rank': 2,
         'note': '与辛仲庙搭档“唐风新韵队”获亚军，据杂史《新春开枰，佳节联棋》'},
    ],
    '辛仲庙': [
        {'date': '2026-09',
         'name': '天元社区五子棋月度对弈赛',
         'href': '../../posts/2026-luoyang-yuedu.html', 'rank': 1,
         'note': '摘“九月棋王”，据杂史《月度手谈，棋王落定》'},
        {'date': '2026-03-07',
         'name': '洛阳五子棋棋王海选赛天元站（公开组）',
         'href': '../../posts/2026-luoyang-tianyuan.html', 'rank': 2,
         'note': '公开组亚军，据杂史《新春开枰，佳节联棋》'},
        {'date': '2026-03-07',
         'name': '洛阳天元站庆“三八”五子棋双人联棋赛',
         'href': '../../posts/2026-luoyang-tianyuan.html', 'rank': 2,
         'note': '与唐碧搭档“唐风新韵队”获亚军，据杂史《新春开枰，佳节联棋》'},
    ],
    '廖汉娇': [
        {'date': '2026-07',
         'name': '洛阳月度棋王交流赛（七月）',
         'href': '../../posts/2026-luoyang-yuedu.html', 'rank': 1,
         'note': '七月棋王，据杂史《月度手谈，棋王落定》所附全年月度棋王一览'},
        {'date': '2026-03-07',
         'name': '洛阳五子棋棋王海选赛天元站（公开组）',
         'href': '../../posts/2026-luoyang-tianyuan.html', 'rank': 3,
         'note': '公开组季军，据杂史《新春开枰，佳节联棋》'},
    ],
    '赵严': [
        {'date': '2026-03-07',
         'name': '洛阳五子棋棋王海选赛天元站（公开组）',
         'href': '../../posts/2026-luoyang-tianyuan.html', 'rank': 1,
         'note': '公开组冠军，赛间作大棋盘复盘与实战技法讲解，据杂史《新春开枰，佳节联棋》'},
    ],
    '申明增': [
        {'date': '2026-10-31',
         'name': '洛阳金秋五子棋棋王海选赛王府井站（公开组）',
         'href': '../../posts/2026-luoyang-jinqiu.html', 'rank': 2,
         'note': '公开组亚军，据杂史《金秋对弈，棋竞桂冠》'},
        {'date': '2026-06',
         'name': '洛阳月度棋王交流赛（六月）',
         'href': '../../posts/2026-luoyang-yuedu.html', 'rank': 1,
         'note': '六月棋王，据杂史《月度手谈，棋王落定》所附全年月度棋王一览'},
    ],
    '张夏玲': [
        {'date': '2025-01-19',
         'name': '洛阳市全民健身大拜年五子棋推广普及系列活动·双元站（棋王争夺）',
         'href': '../../posts/2025-shuangyuan.html', 'rank': 1,
         'note': '执白取胜，成为洛阳市首位五子棋棋王，据杂史《双元站赛事鸣金收枰》'},
    ],
    '王宗良': [
        {'date': '2025-05-11',
         'name': '2025年洛阳市全民健身活动月五子棋比赛（公开组）',
         'href': '../../posts/2025-jianshen-yue.html', 'rank': 1,
         'note': '公开组四轮积分编排，以绝对优势一骑绝尘斩获第一名（冠军），'
                 '据杂史《2025年洛阳市全民健身活动月 —— 五子棋比赛盛大落幕》'},
    ],
}


def extra_row(x):
    """杂史赛事的一行：赛事名链到报道，名次照报道。"""
    rk = x.get('rank')
    attr = ' title="%s"' % bz.esc(x['note']) if x.get('note') else ''
    if isinstance(rk, int) and 1 <= rk <= 3:
        cell = '<span class="rank-badge r%d"%s>%d</span>' % (rk, attr, rk)
    else:
        cell = '<span%s>%s</span>' % (attr, bz.esc(rk or ''))
    return ('<td>%s</td><td class="c-name"><a href="%s">%s</a></td>'
            '<td class="c-rank">%s</td>'
            % (bz.esc(x['date']), x['href'], bz.esc(x['name']), cell))


def in_renwu(prof):
    """该人是否在「山河四省连珠人物」那一页上（EXTRA 里的人不在）。"""
    return (prof.get('src') or 'renwu') == 'renwu'


def render_renwu(prof):
    """「人物」一节：段位、地区与一句小传，取自杂豫的山河四省连珠人物。

    历年战绩不搬到个人主页——想看的人顺着这一节的链接去杂豫那一页。
    小传只写身份、师承、棋风与执裁推广，同样不逐条罗列年份与名次。
    参赛与对局记录另有专节，这里不重复。
    """
    dan = prof.get('dan') or ''
    cls = 'rh-dan' + (' is-none' if dan in ('段位未载', '') else '')
    if in_renwu(prof):
        src = ('段位、籍贯与这段小传摘自杂豫'
               ' <a href="../renwu.html">山河四省连珠人物</a>；完整小传与历年战绩也'
               '在该页。')
    else:
        src = '段位、籍贯与这段小传据杂史的赛事报道整理。'
    return ['            <section class="p-renwu">',
            '                <h2>人物</h2>',
            '                <p class="pr-head"><span class="%s">%s</span>'
            '<span class="rh-tag">%s</span></p>'
            % (cls, bz.esc(dan or '段位未载'), bz.esc(prof.get('tag') or '')),
            '                <p class="pr-bio">%s</p>' % (prof.get('bio') or ''),
            '                <p class="pr-src">%s</p>' % src,
            '            </section>',
            '']


def page(name, rec, events, games, reports, index, total_players, arts,
         extras=(), prof=None):
    rated = rec.get('rating') is not None
    region = (rec.get('region') or '').strip()
    uni = (rec.get('university') or '').strip()
    pt = '%.2f' % rec['rating'] if rated else '—'
    rank = rec.get('rank') or ''
    as_of = rec.get('as_of') or ''

    # 只收在「山河四省连珠人物」里、既无等级分也无对局记录的人（教练、裁判、名宿），
    # 统计条改登段位与地区，免得摆一排「—」「0 局」。
    profile_only = bool(prof) and not rated and not events and not games

    body = ['            <header class="article-header">',
            '                <h1 class="article-title">%s</h1>' % bz.esc(name),
            '                <div class="article-meta">',
            '                    <span>栏目：<a href="../../zayu.html">杂豫</a></span>',
            '                    <span>%s</span>'
            % bz.esc(prof['tag'] if profile_only else (region or '—')),
            '                    <span>%s</span>'
            % bz.esc(prof['dan'] if profile_only else (uni or '—')),
            '                </div>',
            '            </header>',
            '',
            '            <div class="player-stats">']
    if profile_only:
        tag_line = ('山河四省连珠人物' if in_renwu(prof) else '杂史赛事报道')
        how = ('本页依据杂豫 <a href="../renwu.html">「山河四省连珠人物」</a>、'
               '杂史的赛事报道与成绩表整理。' if in_renwu(prof)
               else '本页依据杂史的赛事报道整理。')
        # 默认登段位、地区、收录；人物资料里写了 stats 的，按它自己的口径登
        stats = prof.get('stats') or [('段位', prof['dan']),
                                      ('地区', prof['tag'].replace(' · ', ' ')),
                                      ('收录', tag_line)]
        body += ['                <span class="ps"><span class="ps-k">%s</span>'
                 '<span class="ps-v">%s</span></span>' % (bz.esc(k), bz.esc(v))
                 for k, v in stats]
        body += ['            </div>',
                 '            <p class="player-note">TA 不在本站等级分榜的收录范围内，'
                 '%s</p>' % how,
                 '']
    else:
        body += ['                <span class="ps"><span class="ps-k">等级分</span>'
                 '<span class="ps-v">%s</span></span>' % pt,
                 '                <span class="ps"><span class="ps-k">榜上名次</span>'
                 '<span class="ps-v">%s</span></span>'
                 % ('第 %s 名' % rank if rank else '未入榜'),
                 '                <span class="ps"><span class="ps-k">对局</span>'
                 '<span class="ps-v">%d 局</span></span>' % (rec['games'] or 0),
                 '                <span class="ps"><span class="ps-k">胜 / 和 / 负</span>'
                 '<span class="ps-v">%d / %d / %d</span></span>'
                 % (rec['wins'] or 0, rec['draws'] or 0, rec['losses'] or 0),
                 '                <span class="ps"><span class="ps-k">参赛</span>'
                 '<span class="ps-v">%d 场</span></span>'
                 % (len(events) + len(extras)),
                 '            </div>']
        if rated:
            note = ('等级分截至 %s，在 <a href="../rating.html">河南高校爱好者等级分</a>'
                    '的 %d 人中列第 %s 位；上方对局数与胜负不含轮空、弃权，'
                    '下方的对局记录则全部分局照录。'
                    % (bz.esc(as_of), total_players, rank))
        else:
            note = ('等级分榜只收达到门槛的棋手（河南选手须下满 4 局，外省选手须至少'
                    '参加 2 场比赛），TA 暂未入榜，故不列等级分与榜上名次；上方对局数'
                    '与胜负不含轮空、弃权，下方的对局记录则全部分局照录。')
        body += ['            <p class="player-note">%s' % note,
                 '            </p>',
                 '']

    if prof:
        body += render_renwu(prof)

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

    rows = []
    for e in events:
        t = e['t']
        rows.append(((t.get('date') or ''),
                     '                        <tr>'
                     '<td>%s</td>'
                     '<td class="c-name"><a href="../../zayu/t%d.html">%s</a></td>'
                     '<td class="c-rank">%s</td></tr>'
                     % (bz.esc(t.get('date') or ''), e['tid'],
                        bz.esc(t.get('name') or ''),
                        rank_cell(t, e['row'], name, arts))))
    for x in extras:
        rows.append((x['date'], '                        <tr>%s</tr>'
                     % extra_row(x)))
    rows.sort(key=lambda r: r[0], reverse=True)
    # 不在榜又没有成绩表赛事的人（教练、裁判、名宿），没有记录就不摆这一节；
    # 杂史报道里点到的战绩（EXTRA_EVENTS）仍然照列。
    if rows or not profile_only:
        body += ['            <section>',
                 '                <h2>参赛记录</h2>']
        if rows:
            body += ['                <div class="table-scroll">',
                     '                <table class="crosstab p-games p-events">',
                     '                    <thead><tr>',
                     '                        <th>日期</th>',
                     '                        <th class="c-name">赛事</th>',
                     '                        <th class="c-rank">名次</th>',
                     '                    </tr></thead>',
                     '                    <tbody>']
            body += [html for _d, html in rows]
            body += ['                    </tbody>',
                     '                </table>',
                     '                </div>']
        else:
            body.append('                <p class="empty">该棋手暂无收录的参赛记录。</p>')
        body.append('            </section>')
        body.append('')

    if not profile_only:
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
                               bz.esc(g['m']['round']
                                      if g['m']['round'] is not None else '—'),
                               '假先' if g['first'] else '假后',
                               opp_html, cls, bz.esc(g['res'])))
            body += ['                    </tbody>',
                     '                </table>',
                     '                </div>']
        else:
            body.append('                <p class="empty">该棋手暂无收录的对局。</p>')
        body.append('            </section>')
        body.append('')

    if profile_only:
        # 人物页上的，就回人物页；只有杂史可查的，指回杂史，别把人往人物页上带
        back = ('<a href="../renwu.html">← 山河四省连珠人物</a>' if in_renwu(prof)
                else '<a href="../../zashi.html">← 杂史</a>')
        body.append('            <p class="back-link">' + back +
                    ' · <a href="../../zayu.html">杂豫</a>'
                    ' · <a href="../../index.html">返回首页</a></p>')
    else:
        body.append('            <p class="back-link">'
                    '<a href="../../zayu.html">← 返回杂豫</a>'
                    ' · <a href="../rating.html">等级分榜</a>'
                    ' · <a href="../../index.html">返回首页</a></p>')

    sub = '·'.join(x for x in (region, uni) if x)
    if profile_only:
        desc = '%s（%s·%s）的个人主页：段位、小传与主要战绩。' % (
            name, prof['tag'].replace(' · ', ' '), prof['dan'])
    else:
        desc = '%s%s的个人主页：等级分 %s，%s参赛 %d 场。' % (
            name, '（%s）' % sub if sub else '', pt,
            '第 %s 名，' % rank if rank else '未入榜，', len(events) + len(extras))

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


def write_search_index(names, ratings, profiles):
    """首页搜索框用的全站棋手索引：assets/players.js。

    写成 JS 赋值而不是 JSON——本地直接打开 index.html 时 fetch 取不到文件，
    用 <script> 载入才在 file:// 下也能搜。
    """
    rec = {r['name']: r for r in ratings}
    rows = []
    for name in names:
        r = rec.get(name) or {}
        p = profiles.get(name) or {}
        bits = []
        if r.get('region'):
            bits.append(r['region'])
        elif p.get('tag'):
            bits.append(p['tag'].replace(' · ', ' '))
        if p.get('dan') and p['dan'] != '段位未载':
            bits.append(p['dan'])
        if r.get('rating') is not None:
            bits.append('等级分第 %s 位' % r.get('rank'))
        elif p:
            bits.append('人物')
        rows.append({'n': name,
                     'p': 'zayu/p/%s.html' % quote(name),
                     's': ' · '.join(bits),
                     'k': r.get('rank') or 9999})
    rows.sort(key=lambda x: (x['k'], x['n']))
    body = ',\n'.join(json.dumps(x, ensure_ascii=False, separators=(',', ':'))
                      for x in rows)
    out = ('/* 由 tools/build_players.py 生成：全站棋手索引，供首页搜索框使用。 */\n'
           'window.ZBX_PLAYERS=[\n' + body + '\n];\n'
           'if(window.ZBX_PLAYERS_READY){window.ZBX_PLAYERS_READY();}\n')
    with open(SEARCH_OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write(out)
    return len(rows)


def main():
    ratings, tournaments, matches = load_db()
    rated_names = [r['name'] for r in ratings]
    rated = set(rated_names)
    profiles = dict(rw.RENWU)
    profiles.update(getattr(rw, 'EXTRA', {}))

    # 只在成绩表里出场过、还没入榜的棋手也各出一页：成绩表里的姓名要能点进来。
    # 以「出场过」为准，而不是「有正式对局」——只下过弃权局的棋手同样在表里有名。
    unrated = sorted(n for n in bz.all_players(matches) if n not in rated)

    # 还有一类：杂豫「山河四省连珠人物」里写着，却既不进榜也不在成绩表里出场
    # （教练、裁判、名宿）。那一栏的姓名同样要能点进来，所以也各建一页。
    solo = sorted(n for n in profiles if n not in rated and n not in set(unrated))

    zposts = zashi_posts(rated_names + unrated + solo)
    reports = person_reports(zposts)
    for who, fns in REPORT_EXCLUDE.items():      # 重名的，报道别串到别人名下
        if who in reports:
            reports[who] = [r for r in reports[who] if r['fn'] not in fns]
    stats, games = collect(ratings, tournaments, matches)
    arts = load_event_ranks()

    tally_ = tally(matches)
    zero = {'games': 0, 'wins': 0, 'draws': 0, 'losses': 0}
    as_of = max((r['as_of'] or '' for r in ratings), default='')
    extra = []
    for name in unrated:
        d = tally_.get(name, zero)
        reg, uni = REGION_OVERRIDE.get(name, ('', ''))
        extra.append({'name': name, 'region': reg, 'university': uni,
                      'rating': None, 'games': d['games'], 'wins': d['wins'],
                      'draws': d['draws'], 'losses': d['losses'],
                      'rank': None, 'as_of': as_of})
    for name in solo:
        extra.append({'name': name, 'region': '', 'university': '',
                      'rating': None, 'games': 0, 'wins': 0, 'draws': 0,
                      'losses': 0, 'rank': None, 'as_of': as_of})

    names = rated_names + unrated + solo
    index = set(names)

    os.makedirs(PLAYER_DIR, exist_ok=True)
    for old in os.listdir(PLAYER_DIR):
        if old.endswith('.html'):
            os.remove(os.path.join(PLAYER_DIR, old))

    for rec in ratings + extra:
        name = rec['name']
        html = page(name, rec, stats.get(name, []), games.get(name, []),
                    reports.get(name, []), index, len(rated_names), arts,
                    EXTRA_EVENTS.get(name, ()), profiles.get(name))
        with open(os.path.join(PLAYER_DIR, '%s.html' % name), 'w',
                  encoding='utf-8', newline='') as f:
            f.write(html)

    linked = patch_rating(rated_names)
    # 未入榜者的地区/学校来自 REGION_OVERRIDE，一并交给索引，搜索结果里才不至于是空白
    made = write_search_index(names, ratings + extra, profiles)

    tops = sorted(reports.items(), key=lambda kv: (-len(kv[1]), kv[0]))
    print('主页   ->', PLAYER_DIR,
          '(%d 页：入榜 %d，未入榜 %d，人物页 %d)'
          % (len(names), len(rated_names), len(unrated), len(solo)))
    print('索引   ->', SEARCH_OUT, '(%d 人)' % made)
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
