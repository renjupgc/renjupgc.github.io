#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 data/renju.db 的 matches.board_record 恢复棋谱，生成「杂谱」栏目。

    qipu/index.html     棋谱库：按赛事分组，列出所有有棋谱的对局
    qipu/g<id>.html     单局页面：棋盘（board.js）+ 逐手复盘（先读 eval，再交给
                        assets/qipu.js 渲染胜率曲线与手数表）
    qipu/eval/<id>.json 引擎逐手复盘的产物，由 tools/analyze_qipu.cjs 生成
    qipu/_games.json    给 node 复盘脚本的输入（引擎坐标，x 自左、y 自下）

同时把入口接到站内已有的页面上（都带 <!-- qipu:begin --> 标记，重跑只换标记
之间那段，不会越插越多）：
    zayu/t*.html   赛事成绩页底部加「本站棋谱」
    zayu/p/*.html  个人主页底部加「棋谱」

数据上有两处要当心：
1. board_record 有两种写法，`7,7;7,6` 与 `h8 i9`，都按「x 自左 0 起、y 自下
   0 起」理解（h8 就是天元，与 7,7 同一点）。个别记录末尾还带着一行尾注，
   形如 `ywc14cqa, r3, Ling Shijie - Mao Weiming`，那是棋谱库导出时留下的
   英文姓名，不是棋步。
2. 世青赛那批记录被整组复制过：同一份棋谱挂在 6 个不同的对阵上，只有尾注
   点名的那一对才是真的。这里按尾注的拼音核对，只留对得上的那一条，其余
   不进库——宁可少几局，不能把别人的棋安在别人头上。

用法：
    python tools/build_qipu.py            # 全流程（含调用 node 复盘）
    python tools/build_qipu.py --no-eval  # 只出页面，不跑引擎
"""

import json
import os
import re
import sqlite3
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DB = os.path.join(ROOT, 'data', 'renju.db')
OUT = os.path.join(ROOT, 'qipu')
EVAL_DIR = os.path.join(OUT, 'eval')
GAMES_JSON = os.path.join(OUT, '_games.json')

COLS = 'ABCDEFGHIJKLMNO'
SIZE = 15

# 尾注里的英文名与站内中文名对照（目前只用到这六个）
PINYIN = {
    '马也': 'ma ye',
    '赵云': 'zhao yun',
    '凌世杰': 'ling shijie',
    '毛玮铭': 'mao weiming',
    '药博凡': 'yao bofan',
    '钟煜阳': 'zhong yuyang',
}

RESULT_TEXT = {
    '1-0': ('先胜', 'win'),
    '0-1': ('后胜', 'loss'),
    '½-½': ('和棋', 'draw'),
    '+-': ('先手弃权', 'void'),
    '-+': ('后手弃权', 'void'),
    '--': ('双方弃权', 'void'),
}

# 一个棋步的两种写法：7,7 与 h8。逗号属于坐标，分词时不能拆开
PAT = re.compile(r'\d{1,2},\d{1,2}|[a-oA-O]\d{1,2}')


# --------------------------------------------------------------- 棋谱解析

def parse_record(raw):
    """把一条 board_record 拆成棋步列表与尾注。

    棋步一律返回 (x, y)：x 自左 0 起，y 自下 0 起，即引擎与连珠通用坐标。
    两种写法混着来过：`7,7;7,6` 与 `h8 i9`，逗号是坐标的一部分，不能当分隔符切。
    """
    text = (raw or '').replace('\r', '')
    note = ''
    if '\n' in text:
        text, _, note = text.partition('\n')
        note = note.strip()

    moves = []
    for tok in PAT.findall(text):
        m = re.fullmatch(r'(\d{1,2}),(\d{1,2})', tok)
        if m:
            moves.append((int(m.group(1)), int(m.group(2))))
        else:
            moves.append((ord(tok[0].lower()) - 97, int(tok[1:]) - 1))

    rest = re.sub(r'[\s;,]+', '', PAT.sub('', text))
    if rest:
        raise ValueError('看不懂的棋步：%r' % rest[:20])
    return moves, note


def note_pair(note):
    """尾注里的对阵：'ywc14cqa, r3, Ling Shijie - Mao Weiming' -> 两个英文名。"""
    if not note:
        return None
    m = re.search(r',\s*([A-Za-z ]+?)\s*-\s*([A-Za-z ]+?)\s*$', note)
    if not m:
        return None
    return (m.group(1).strip().lower(), m.group(2).strip().lower())


def pick_from_group(group):
    """同一份棋谱挂在多组对阵上时，按尾注挑出真身；挑不出就整组丢掉。"""
    if len(group) == 1:
        return group[0], None
    pair = note_pair(group[0]['note'])
    if pair:
        want = set(pair)
        hits = [g for g in group
                if {PINYIN.get(g['player1'], ''), PINYIN.get(g['player2'], '')} == want
                and '' not in {PINYIN.get(g['player1'], ''), PINYIN.get(g['player2'], '')}]
        if len(hits) == 1:
            return hits[0], len(group) - 1
    return None, len(group)


def load_games():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    rows = [dict(r) for r in conn.execute(
        'SELECT m.*, t.name AS tname, t.date AS tdate, t.rules AS trules, '
        '       t.organizer AS torganizer, t.participants AS tplayers '
        'FROM matches m JOIN tournaments t ON t.id = m.tournament_id '
        "WHERE trim(coalesce(m.board_record, '')) <> '' "
        'ORDER BY t.date DESC, m.tournament_id, m.round, m.board_number')]
    conn.close()

    games, groups, skipped = [], {}, 0
    for r in rows:
        try:
            moves, note = parse_record(r['board_record'])
        except ValueError as e:
            print('！跳过 match %s：%s' % (r['id'], e))
            continue
        if len(moves) < 2:
            print('！跳过 match %s：棋步不足两手' % (r['id']))
            continue
        if len(set(moves)) != len(moves):
            print('！跳过 match %s：同一交叉点出现两次' % (r['id']))
            continue
        if any(not (0 <= x < SIZE and 0 <= y < SIZE) for x, y in moves):
            print('！跳过 match %s：坐标越界' % (r['id']))
            continue
        r['moves'] = moves
        r['note'] = note
        groups.setdefault(tuple(moves), []).append(r)

    for mv in sorted(groups, key=lambda k: groups[k][0]['id']):
        g = groups[mv]
        keep, extra = pick_from_group(g)
        if keep is None:
            skipped += len(g)
            print('！同一份棋谱挂在 %d 组对阵上且尾注对不上，整组不进库：%s'
                  % (len(g), ' / '.join('%s-%s' % (x['player1'], x['player2']) for x in g)))
            continue
        if extra:
            skipped += extra
            print('· 尾注核对：%s（match %s）为真身，同组另外 %d 条未收录'
                  % ('%s vs %s' % (keep['player1'], keep['player2']), keep['id'], extra))
        games.append(keep)

    print('棋谱：入库 %d 局，剔除重复/存疑 %d 条' % (len(games), skipped))

    # 同名同日的赛事（世青赛的 A、B 组）在库里是两行，标题上得分开
    by_name = {}
    for g in games:
        by_name.setdefault((g['tname'], g['tdate']), set()).add(g['tournament_id'])
    for g in games:
        label = g['tname']
        if len(by_name[(g['tname'], g['tdate'])]) > 1:
            names = [n.strip() for n in (g['tplayers'] or '').split(',') if n.strip()]
            label += ('（%s 等）' % '、'.join(names[:2])) if names else '（第 %d 组）' % g['tournament_id']
        g['tlabel'] = label

    return games


# --------------------------------------------------------------- 小工具

def esc(s):
    return (str(s or '').replace('&', '&amp;').replace('<', '&lt;')
            .replace('>', '&gt;').replace('"', '&quot;'))


def coord_name(x, y):
    """引擎坐标 -> 站点坐标（h8、i9 这种，y 自下 1 起）。"""
    return COLS[x] + str(y + 1)


def move_tokens(moves):
    """给 board.js 的 data-moves：一手一个坐标，颜色按先后自动轮换。"""
    return ' '.join(coord_name(x, y) for x, y in moves)


def round_label(r):
    return '第 %s 轮' % r['round'] if r['round'] else '附加赛'


def result_of(r):
    txt, cls = RESULT_TEXT.get(r['result'], (r['result'] or '—', 'void'))
    return txt, cls


def headline(g):
    """一句话说清这局：能定胜负就写「甲 胜 乙」，否则写「甲 对 乙（和棋）」。"""
    if g['result'] == '1-0':
        return '%s 胜 %s' % (esc(g['player1']), esc(g['player2']))
    if g['result'] == '0-1':
        return '%s 胜 %s' % (esc(g['player2']), esc(g['player1']))
    return '%s 对 %s（%s）' % (esc(g['player1']), esc(g['player2']), result_of(g)[0])


def event_href(tid):
    """赛事在站内有没有成绩页（zayu/t<id>.html）。"""
    p = os.path.join(ROOT, 'zayu', 't%s.html' % tid)
    return 'zayu/t%s.html' % tid if os.path.exists(p) else ''


# --------------------------------------------------------------- 页面骨架

HEAD = '''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<meta name="description" content="{desc}">
<meta name="theme-color" content="#f6f2e9">
<link rel="stylesheet" href="../assets/style.css">
</head>

<body data-nav="杂谱" data-base="../">

<div class="container">

    <div id="site-header"></div>

    <main>
'''

FOOT = '''    </main>

</div>

<script src="../assets/layout.js"></script>
<script src="../assets/board.js"></script>
<script src="../assets/qipu.js"></script>

</body>
</html>
'''


def build_index(games):
    by_event = {}
    for g in games:
        by_event.setdefault((g['tournament_id'], g['tname'], g['tdate']), []).append(g)

    events = sorted(by_event.items(), key=lambda kv: (kv[0][2] or '', kv[0][0]), reverse=True)
    players = set()
    for g in games:
        players.update([g['player1'], g['player2']])

    blocks = []
    for (tid, tname, tdate), gs in events:
        tlabel = gs[0]['tlabel']
        gs.sort(key=lambda g: ((g['round'] or 0), (g['board_number'] or 0)))
        items = []
        for g in gs:
            txt, cls = result_of(g)
            items.append(
                '                <li><a href="g%s.html">%s</a>'
                '<span class="date">%s · %d 手</span></li>' % (
                    g['id'], headline(g), round_label(g), len(g['moves'])))
        head_link = esc(tlabel)
        if os.path.exists(os.path.join(ROOT, 'zayu', 't%s.html' % tid)):
            head_link = '<a href="../zayu/t%s.html">%s</a>' % (tid, esc(tlabel))
        blocks.append(
            '        <section>\n'
            '            <h2>%s<span class="qp-sub">%s · %d 局</span></h2>\n'
            '            <ul class="post-list">\n%s\n            </ul>\n'
            '        </section>\n' % (head_link, tdate or '', len(gs), '\n'.join(items)))

    body = '''        <header class="page-head">
            <p class="eyebrow">栏目</p>
            <h1 class="page-title">杂谱</h1>
            <p class="page-desc">比赛对局的棋谱，逐手可查，也可交给引擎重算一遍。</p>
        </header>

        <div class="rh-counts">
            <span>收录 <b>%d</b> 局</span>
            <span>赛事 <b>%d</b> 站</span>
            <span>棋手 <b>%d</b> 位</span>
            <span>记录多长就照录多长，未作增删</span>
        </div>

        <p class="qp-lede">棋谱取自成绩表里逐局记录的落点，坐标已换算成盘上的 A—O、1—15。
        点开一局，左边棋盘、右边复盘：引擎（Rapfi，连珠规则）会把每一手之后的胜率重算一遍，
        标出与首选手出入最大的几处。记录手数不多，都是当时现场记下来的样子。</p>

''' % (len(games), len(events), len(players))

    html = HEAD.format(
        title='杂谱 - 连珠杂箱',
        desc='连珠（五子棋）比赛棋谱库：%d 局实战记录，逐手复盘与胜率曲线。' % len(games),
    ) + body + '\n'.join(blocks) + '\n' + FOOT
    write(os.path.join(OUT, 'index.html'), html)


def build_game(g, prev_g, next_g):
    txt, cls = result_of(g)
    n = len(g['moves'])
    tid = g['tournament_id']
    href = event_href(tid)

    meta = ['栏目：<a href="../zayu.html">杂豫</a>',
            '赛事：%s' % ('<a href="../zayu/t%s.html">%s</a>' % (tid, esc(g['tlabel']))
                          if href else esc(g['tlabel'])),
            esc(g['tdate'] or ''),
            '%d 手' % n]
    info = ['规则：%s' % (g['trules'] or '—'),
            '轮次：%s' % (round_label(g)),
            '台次：%s' % (g['board_number'] or '—'),
            '结果：%s' % txt,
            '黑方：%s' % esc(g['player1']),
            '白方：%s' % esc(g['player2'])]

    nav = []
    if prev_g:
        nav.append('<a href="g%s.html">← 上一局：%s 对 %s</a>' % (
            prev_g['id'], esc(prev_g['player1']), esc(prev_g['player2'])))
    if next_g:
        nav.append('<a href="g%s.html">下一局：%s 对 %s →</a>' % (
            next_g['id'], esc(next_g['player1']), esc(next_g['player2'])))

    title = '%s 对 %s · %s' % (g['player1'], g['player2'], round_label(g))
    body = '''        <article>

            <header class="article-header">
                <h1 class="article-title">%s<span class="qp-vs">对</span>%s</h1>
                <div class="article-meta">
                    %s
                </div>
            </header>

            <div class="event-info">
                %s
            </div>

            <div class="qipu-layout">
                <div class="qipu-board">
                    <div class="board" data-board data-hash
                         data-numbers="1" data-moves="%s"></div>
                    <p class="qipu-tip">用 &lt;&lt; 与 &gt;&gt; 翻手，或点右侧手数跳转；局面会写进地址栏，方便把某一手发出去。</p>
                </div>

                <div class="qipu-side" id="qipu" data-id="%s" data-turns="%d">
                    <p class="qp-pending">正在取引擎复盘…</p>
                </div>
            </div>

            <p class="back-link">
                <a href="index.html">← 返回杂谱</a>
                %s
            </p>

        </article>
''' % (esc(g['player1']), esc(g['player2']),
       '\n                    '.join('<span>%s</span>' % m for m in meta),
       '\n                '.join('<span>%s</span>' % i for i in info),
       move_tokens(g['moves']), g['id'], n,
       ('· ' + ' · '.join(nav)) if nav else '')

    html = HEAD.format(
        title='%s - 杂谱 - 连珠杂箱' % title,
        desc='%s 对 %s，%s，%s，共 %d 手。含棋盘与逐手胜率复盘。' % (
            g['player1'], g['player2'], g['tlabel'], txt, n),
    ) + body + FOOT
    write(os.path.join(OUT, 'g%s.html' % g['id']), html)


# --------------------------------------------------------------- 站内入口

BEGIN = '<!-- qipu:begin -->'
END = '<!-- qipu:end -->'


def insert_block(path, block, anchor):
    """把 block 放在 anchor 之前；已有标记则替换标记之间那段。"""
    with open(path, encoding='utf-8') as f:
        text = f.read()
    if BEGIN in text and END in text:
        pre = text.split(BEGIN)[0]
        post = text.split(END, 1)[1]
        new = pre + BEGIN + '\n' + block + END + post
    else:
        if anchor not in text:
            return False
        idx = text.rindex(anchor)
        new = text[:idx] + BEGIN + '\n' + block + END + '\n' + text[idx:]
    if new == text:
        return False
    write(path, new)
    return True


def patch_events(games):
    """赛事成绩页：列表里加「本站棋谱」。"""
    todo = {}
    for g in games:
        todo.setdefault(g['tournament_id'], []).append(g)
    changed = 0
    for tid, gs in todo.items():
        path = os.path.join(ROOT, 'zayu', 't%s.html' % tid)
        if not os.path.exists(path):
            continue
        gs.sort(key=lambda g: ((g['round'] or 0), (g['board_number'] or 0)))
        items = []
        for g in gs:
            txt, cls = result_of(g)
            items.append('            <li><a href="../qipu/g%s.html">%s</a>'
                         '<span class="date">%s · %d 手</span></li>' % (
                             g['id'], headline(g), round_label(g), len(g['moves'])))
        block = ('        <section>\n'
                 '            <h2>本站棋谱</h2>\n'
                 '            <ul class="post-list qipu-links">\n%s\n'
                 '            </ul>\n'
                 '            <p class="qp-note">点开可看棋盘与引擎复盘；棋谱来自本页成绩表的逐局记录。</p>\n'
                 '        </section>\n' % ('\n'.join(items)))
        anchor = '<p class="back-link">' if '<p class="back-link">' in open(
            path, encoding='utf-8').read() else '</main>'
        if insert_block(path, block, anchor):
            changed += 1
    print('赛事页：%d 个页码已接上棋谱入口' % changed)


def patch_players(games):
    """个人主页：加「棋谱」，只列这个人下过的。"""
    by_player = {}
    for g in games:
        for name in (g['player1'], g['player2']):
            by_player.setdefault(name, []).append(g)

    changed = 0
    for name, gs in by_player.items():
        path = os.path.join(ROOT, 'zayu', 'p', '%s.html' % name)
        if not os.path.exists(path):
            continue
        gs.sort(key=lambda g: (g['tdate'] or '', g['id']), reverse=True)
        items = []
        for g in gs:
            txt, cls = result_of(g)
            mine = g['player1'] if name == g['player1'] else g['player2']
            opp = g['player2'] if name == g['player1'] else g['player1']
            if g['result'] in ('1-0', '0-1'):
                res = '胜' if ((g['result'] == '1-0') == (mine == g['player1'])) else '负'
            else:
                res = txt
            rcls = ('res-win' if res == '胜' else 'res-loss' if res == '负'
                    else 'res-draw')
            items.append('                <tr><td>%s</td>'
                         '<td class="c-name"><a href="../../qipu/g%s.html">%s</a></td>'
                         '<td class="c-tb">%s</td>'
                         '<td class="c-opp">%s</td>'
                         '<td class="c-rank %s">%s</td></tr>' % (
                             g['tdate'] or '', g['id'], esc(g['tlabel']),
                             esc(round_label(g)), esc(opp), rcls, res))
        block = ('            <section>\n'
                 '                <h2>棋谱</h2>\n'
                 '                <div class="table-scroll">\n'
                 '                <table class="crosstab p-games">\n'
                 '                    <thead><tr><th>日期</th><th class="c-name">赛事 / 棋谱</th>'
                 '<th class="c-tb">轮次</th><th class="c-opp">对手</th>'
                 '<th class="c-rank">结果</th></tr></thead>\n'
                 '                    <tbody>\n%s\n'
                 '                    </tbody>\n'
                 '                </table>\n'
                 '                </div>\n'
                 '            </section>\n' % ('\n'.join(items)))
        if insert_block(path, block, '<p class="back-link">'):
            changed += 1
    print('个人主页：%d 页已接上棋谱' % changed)


# --------------------------------------------------------------- 复盘

def run_eval():
    script = os.path.join(HERE, 'analyze_qipu.cjs')
    if not os.path.exists(script):
        print('！缺少 tools/analyze_qipu.cjs，跳过引擎复盘')
        return
    try:
        subprocess.run(['node', script], check=True, cwd=ROOT)
    except (OSError, subprocess.CalledProcessError) as e:
        print('！引擎复盘未完成（%s），页面先只放棋盘' % e)


def write(path, text):
    """写文件。HTML 一律 CRLF —— 仓库里现有的页面都是 CRLF，
    用 LF 重写会让「只加了一段」变成整页 diff。"""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    data = text.replace('\n', '\r\n') if path.lower().endswith('.html') else text
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(data)


def main():
    no_eval = '--no-eval' in sys.argv
    os.makedirs(EVAL_DIR, exist_ok=True)
    games = load_games()
    if not games:
        print('没有可用的棋谱')
        return 1

    write(GAMES_JSON, json.dumps(
        [{'id': g['id'], 'moves': g['moves']} for g in games],
        ensure_ascii=False, separators=(',', ':')))

    if not no_eval:
        run_eval()

    ordered = sorted(games, key=lambda g: (g['tdate'] or '', g['id']), reverse=True)
    for i, g in enumerate(ordered):
        build_game(g,
                   ordered[i + 1] if i + 1 < len(ordered) else None,
                   ordered[i - 1] if i > 0 else None)
    build_index(ordered)

    patch_events(ordered)
    patch_players(ordered)
    print('完成：%d 局，页面在 qipu/' % len(ordered))
    return 0


if __name__ == '__main__':
    sys.exit(main())
