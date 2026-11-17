#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 renju.net 抓取棋手的 RIF 档案，缓存到 data/rif_players.json。

抓的是 RIF 官方选手页（https://www.renju.net/people/<ID>/）：
档案字段、国际对局统计、开局偏好，以及他参加过的每一项 RIF 登记赛事；
赛事的成绩表再逐页取回来，拆成「第几轮、执黑执白、对手、结果」的逐局记录。

    python tools/fetch_rif_player.py 102247          # 按 RIF 编号抓
    python tools/fetch_rif_player.py --name Pan       # 按英文名搜索，列出候选
    python tools/fetch_rif_player.py 102247 --print   # 抓完把摘要打到终端

缓存文件按中文名索引（RenjuNet 的 Native name），页面生成脚本靠它把档案
挂到对应棋手的个人主页上。同一棋手重复抓取按编号覆盖，不会留下旧版本。

注：RIF 上的赛事名是英文、日期是赛事起始日，与本站成绩表的日期可能差一天，
两者是同一场比赛；build_players.py 会按日期把已在成绩表里的场次挑出来，
不重复上榜。本脚本只负责「抓全」，不做去重。
"""

import argparse
import html as htmllib
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PATH = os.path.join(ROOT, 'data', 'rif_players.json')
BASE = 'https://www.renju.net'
UA = 'Mozilla/5.0 (compatible; renjupgc-bot/1.0; +https://renjupgc.github.io/)'


def get(url, tries=3):
    """取一页 HTML。失败重试两次，还不行就返回空串，不中断整批抓取。"""
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=25) as r:
                return r.read().decode('utf-8', errors='ignore')
        except Exception as e:                       # noqa: BLE001
            if i == tries - 1:
                sys.stderr.write('！抓不到 %s（%s）\n' % (url, e))
                return ''
            time.sleep(0.6 * (i + 1))
    return ''


def clean(s):
    """去标签 + 解实体 + 压空白。赛事名里的 &quot; 与成绩表里的 &frac12; 都靠它。"""
    s = re.sub(r'<[^>]+>', ' ', s or '')
    s = htmllib.unescape(s).replace('\xa0', ' ')
    return re.sub(r'\s+', ' ', s).strip()


# 成绩表里的结果记号：1 胜、0 负、½ 和、+ 对手弃权、- 自己弃权/未赛
RESULT_KIND = {'1': 'win', '0': 'loss', '½': 'draw', '0.5': 'draw',
               '+': 'fwin', '-': 'floss', '=': 'draw'}


def text_of(html):
    """去掉标签，压掉空白，用来啃「Player ID: #102247」这类一行一条的字段。"""
    s = re.sub(r'<(script|style)[^>]*>.*?</\1>', ' ', html, flags=re.S)
    s = re.sub(r'<[^>]+>', ' ', s)
    s = s.replace('&nbsp;', ' ').replace('&amp;', '&').replace('&quot;', '"')
    return re.sub(r'[ \t\r\f\v]+', ' ', s)


def field(txt, label):
    """取「Label: 值」里的值；取不到返回空串。"""
    m = re.search(r'\b' + re.escape(label) + r'\s*:\s*([^\n]{0,80})', txt)
    return m.group(1).strip(' \t') if m else ''


def search(name):
    """按姓名搜索选手，返回 [(ID, 英文名, 段位, 等级分, 地点), ...]。"""
    url = BASE + '/people/search?name=' + urllib.parse.quote(name)
    html = get(url)
    out = []
    for m in re.finditer(r'<a[^>]*href="/people/(\d+)/"[^>]*>(.*?)</a>', html, re.S):
        pid = m.group(1)
        nm = re.sub(r'<[^>]+>', '', m.group(2)).strip()
        out.append((pid, re.sub(r'\s+', ' ', nm)))
    # 只保留名字里含关键词的（搜索是全表模糊匹配）
    key = name.lower()
    return [x for x in out if key in x[1].lower()]


def parse_openings(html):
    """开局偏好表：code / 日文汉字名 / 局数 / 占比 / 得分率。"""
    rows = []
    seg = html.split('Score rate')[-1] if 'Score rate' in html else ''
    for tr in re.findall(r'<tr>(.*?)</tr>', seg, re.S):
        cells = [re.sub(r'<[^>]+>', '', c).strip() for c in
                 re.findall(r'<td[^>]*>(.*?)</td>', tr, re.S)]
        cells = [re.sub(r'\s+', ' ', c) for c in cells if c != '']
        if len(cells) < 5:
            continue
        code, jp, cnt, pct, score = cells[:5]
        if not re.fullmatch(r'[a-o]\d{1,2}', code):
            continue
        rows.append({'code': code, 'jp': jp, 'count': int(float(cnt)),
                     'pct': float(pct.rstrip('%')), 'score': float(score.rstrip('%'))})
    return rows


def parse_stats(html):
    """国际对局统计：总局数、总分、胜和负，以及执黑 / 执白两项拆分。"""
    i = html.find('Game statistics')
    if i < 0:
        return {}
    seg = html[i:html.find('Opening', i)]
    rows = []
    for tr in re.findall(r'<tr>(.*?)</tr>', seg, re.S):
        cells = [re.sub(r'<[^>]+>', '', c).strip() for c in
                 re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', tr, re.S)]
        cells = [re.sub(r'\s+', ' ', c) for c in cells]
        if cells:
            rows.append(cells)

    def num(x):
        x = (x or '').strip().rstrip('%')
        try:
            return float(x)
        except ValueError:
            return None

    out, cur = {}, None
    for cells in rows:
        label = cells[0]
        if label in ('Games', 'Black', 'White'):
            cur = label.lower()
            if cur == 'games':
                out['games'] = int(float(cells[1])) if len(cells) > 1 and num(cells[1]) is not None else None
                if len(cells) > 2 and cells[2].endswith('%'):
                    out['share'] = num(cells[2])
            else:
                out[cur + '_games'] = int(float(cells[1])) if len(cells) > 1 and num(cells[1]) is not None else None
                if len(cells) > 2 and cells[2].endswith('%'):
                    out[cur + '_share'] = num(cells[2])
            continue
        if not cur:
            continue
        key = {'Points': 'points', 'Wins': 'wins', 'Draws': 'draws',
               'Losses': 'losses'}.get(label)
        if not key:
            continue
        if cur == 'games':
            out[key] = num(cells[1]) if len(cells) > 1 else None
            if key == 'points' and len(cells) > 2:
                out['score_rate'] = num(cells[2])
            elif len(cells) > 2 and key != 'points':
                out[key + '_rate'] = num(cells[2])
        else:
            out['%s_%s' % (cur, key)] = num(cells[1]) if len(cells) > 1 else None
            if len(cells) > 2:
                out['%s_%s_rate' % (cur, key)] = num(cells[2])
    return out


def parse_events(html):
    """他参加过的赛事清单：赛事名、RIF 赛事编号、起始日期。"""
    i = html.rfind('Tournament</th>')
    if i < 0:
        return []
    seg = html[i:]
    out = []
    for tr in re.findall(r'<tr>(.*?)</tr>', seg, re.S):
        m = re.search(r'href="/tournament/(\d+)/"[^>]*>(.*?)</a>', tr, re.S)
        if not m:
            continue
        d = re.search(r'<td>(\d{4}-\d{2}-\d{2})</td>', tr)
        out.append({'tid': m.group(1), 'name': clean(m.group(2)),
                    'date': d.group(1) if d else ''})
    return out


def parse_tournament(tid, want_id):
    """赛事页：赛事信息 + 成绩表里该棋手那一行（含逐轮对手与结果）。

    成绩表的座位号不一定是名次：同一名次要拆成 4a / 4b / 4c 几个座位，
    单元格里的 <sub> 写的就是对手的座位号，所以按「Pl 列的原样标签」建索引，
    不能用行号——行号会把 9a 和 9b 认成同一个人。
    """
    html = get(BASE + '/tournament/%s/' % tid)
    if not html:
        return None
    ev = {'tid': tid}
    m = re.search(r'<div id="content"[^>]*>\s*<h2>\s*(.*?)</h2>', html, re.S)
    ev['name'] = clean(m.group(1)) if m else ''
    for key, label in (('place', 'Place'), ('rule', 'Rule'), ('level', 'Level'),
                       ('system', 'System'), ('time_control', 'Time control'),
                       ('organizer', 'Organizer'), ('chief_referee', 'Chief referee')):
        # Rule 那一行后面还跟着 <b>Rated:</b>，取到它前面为止
        m = re.search(r'<b>%s:</b>\s*(.*?)(?=<b>Rated:|</p>)' % label, html, re.S)
        ev[key] = clean(m.group(1)) if m else ''
    m = re.search(r'<b>Date:</b>\s*([\d-]+)\s*-\s*([\d-]+)', html)
    ev['date'], ev['date_end'] = (m.group(1), m.group(2)) if m else ('', '')
    m = re.search(r'<b>Rated:</b>\s*(\w+)', html)
    ev['rated'] = m.group(1) if m else ''
    m = re.search(r'See Games \((\d+)\)', html)
    ev['games_on_site'] = int(m.group(1)) if m else None

    if 'Score table' not in html:
        ev['played'] = False
        ev['games'] = []
        return ev
    tbl = re.search(r'<table>(.*?)</table>', html[html.find('Score table'):], re.S)
    if not tbl:
        ev['played'] = False
        ev['games'] = []
        return ev
    tbl = tbl.group(1)
    ths = [clean(x) for x in re.findall(r'<th[^>]*>(.*?)</th>', tbl, re.S)]
    rounds = [x for x in ths if x.isdigit()]
    ev['rounds'] = len(rounds)

    seats, rows = {}, []
    for tr in re.findall(r'<tr>\s*(.*?)</tr>', tbl, re.S):
        if '<td' not in tr:
            continue
        cells = re.findall(r'<td[^>]*>(.*?)</td>', tr, re.S)
        if len(cells) < 3:
            continue
        pl = re.search(r'href="/people/(\d+)/"[^>]*>(.*?)</a>', cells[1], re.S)
        if not pl:
            continue
        label = clean(cells[0])
        person = {'id': pl.group(1), 'name': clean(pl.group(2))}
        seats[label] = person
        rows.append({'label': label, 'pid': pl.group(1), 'cells': cells[2:]})

    mine = next((r for r in rows if r['pid'] == want_id), None)
    ev['games'] = []
    ev['played'] = bool(mine)
    if not mine:
        # 只在参赛名单里挂号、成绩表上没有单独的行走位：多半是领队、裁判长
        # 或团体赛的随队人员，不算他的个人成绩
        ev['role'] = 'entry_only'
        return ev

    ev['rank'] = mine['label']
    tail = [clean(x) for x in mine['cells'][len(rounds):]]
    ev['points'] = tail[0] if tail else ''
    ev['buchholz'] = tail[1] if len(tail) > 1 else ''
    for idx, cell in enumerate(mine['cells'][:len(rounds)]):
        m = re.search(r'<sub class="(first|second)">\s*([0-9A-Za-z]+)\s*</sub>\s*([^<]*)', cell)
        if not m:
            continue
        seat, color, res = m.group(2), m.group(1), htmllib.unescape(m.group(3)).strip()
        opp = seats.get(seat, {})
        ev['games'].append({
            'round': idx + 1,
            'color': 'black' if color == 'first' else 'white',
            'opp': opp.get('name', ''),
            'opp_id': opp.get('id', ''),
            'res': res,
            'kind': RESULT_KIND.get(res, ''),
        })
    return ev


def parse_player(pid):
    html = get(BASE + '/people/%s/' % pid)
    if not html:
        return None
    t = text_of(html)
    m = re.search(r'<div id="content"[^>]*>\s*<h2>\s*(.*?)</h2>', html, re.S)
    name_en = clean(m.group(1)) if m else ''
    flag = re.search(r'/flag/([A-Z]{3})\.svg', html)
    city = ''
    m = re.search(r'<span class="flag">.*?</span>\s*([^<]+)</p>', html, re.S)
    if m:
        city = clean(m.group(1))
    rating = re.search(r'<b>Rating:</b>\s*<a[^>]*href="([^"]+)"[^>]*>\s*(\d+)\s*\((\d+)(?:st|nd|rd|th)\)', html)
    vm = re.search(r'See Games \((\d+)\)', html)
    pm = re.search(r'See Photos \((\d+)\)', html)
    rec = {
        'id': pid,
        'name_en': name_en,
        'native': field(t, 'Native name'),
        'flag': flag.group(1) if flag else '',
        'city': city,
        'gender': field(t, 'Gender'),
        'rank': field(t, 'Rank'),
        'birth': field(t, 'Birth'),
        'rating': int(rating.group(2)) if rating else None,
        'rating_pos': int(rating.group(3)) if rating else None,
        'rating_url': rating.group(1).replace('&amp;', '&') if rating else '',
        'games_page': int(vm.group(1)) if vm else None,
        'photos': int(pm.group(1)) if pm else None,
        'stats': parse_stats(html),
        'openings': parse_openings(html),
        'events': [],
    }
    for e in parse_events(html):
        ev = parse_tournament(e['tid'], pid)
        time.sleep(0.35)                       # 对 RIF 客气一点
        if ev:
            ev['date'] = ev.get('date') or e['date']
            rec['events'].append(ev)
    rec['events'].sort(key=lambda x: x.get('date') or '', reverse=True)
    return rec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('ids', nargs='*', help='RIF 选手编号，如 102247')
    ap.add_argument('--name', help='按姓名搜索，列出候选后退出')
    ap.add_argument('--print', dest='show', action='store_true', help='抓完打印摘要')
    args = ap.parse_args()

    if args.name:
        for pid, nm in search(args.name):
            print('%s\t%s' % (pid, nm))
        return
    if not args.ids:
        ap.error('给一个 RIF 编号，或用 --name 搜索')

    db = {}
    if os.path.exists(OUT_PATH):
        with open(OUT_PATH, encoding='utf-8') as f:
            db = json.load(f)
    players = db.get('players', {})

    for pid in args.ids:
        rec = parse_player(pid)
        if not rec:
            print('！%s 抓取失败' % pid)
            continue
        key = rec['native'] or rec['name_en']
        players[key] = rec
        played = [e for e in rec['events'] if e.get('played')]
        print('%s（%s）→ %s：%d 场赛事（%d 场有成绩表）、%d 局逐轮记录'
              % (key, rec['name_en'], pid, len(rec['events']), len(played),
                 sum(len(e['games']) for e in rec['events'])))

    db['source'] = 'https://www.renju.net'
    db['fetched'] = time.strftime('%Y-%m-%d')
    db['players'] = dict(sorted(players.items()))
    with open(OUT_PATH, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(db, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print('已写入 %s（%d 人）' % (OUT_PATH, len(db['players'])))

    if args.show:
        for k, v in db['players'].items():
            print('\n=== %s / %s ===' % (k, v['name_en']))
            print('RIF #%s  %s  %s  %s  %s' % (v['id'], v['rank'], v['rating'],
                                               v['rating_pos'], v['birth']))
            print('统计', v['stats'])
            for e in v['events']:
                if not e.get('played'):
                    print('  %s  %-58s （无个人成绩表）' % (e['date'], e['name'][:58]))
                    continue
                print('  %s  %-58s %-4s %-5s pt  %d 局'
                      % (e['date'], e['name'][:58], e.get('rank', ''),
                         e.get('points', ''), len(e['games'])))
                for g in e['games']:
                    print('      R%d %s vs %-24s %-3s %s'
                          % (g['round'], '黑' if g['color'] == 'black' else '白',
                             g['opp'][:24], g['res'], g['kind']))


if __name__ == '__main__':
    main()
