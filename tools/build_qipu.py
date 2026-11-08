#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 data/renju.db 的 matches.board_record 恢复棋谱，供「杂豫」赛事页就地展开。

这里不再生成独立的棋谱页面。有棋谱的对局，成绩表里对应的格子会带
data-qipu="<id>"（由 tools/build_zayu.py 打标），点一下就在表格下方展开
棋盘与逐手复盘，由 assets/qipu.js 渲染。

产物：
    assets/qipu/g<id>.json      单局数据：双方、轮次、结果、落点、引擎复盘
    assets/qipu/_games.json     给 node 复盘脚本的输入（引擎坐标，x 自左、y 自下）
    assets/qipu/eval/<id>.json  引擎复盘的中间产物（tools/analyze_qipu.cjs）

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
    python tools/build_qipu.py --no-eval  # 只出数据，不跑引擎
"""

import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DB = os.path.join(ROOT, 'data', 'renju.db')
OUT = os.path.join(ROOT, 'assets', 'qipu')
EVAL_DIR = os.path.join(OUT, 'eval')
GAMES_JSON = os.path.join(OUT, '_games.json')
LEGACY = os.path.join(ROOT, 'qipu')

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
    '1-0': '先胜',
    '0-1': '后胜',
    '½-½': '和棋',
    '+-': '先手弃权',
    '-+': '后手弃权',
    '--': '双方弃权',
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


def load_games(quiet=False):
    """返回入库的对局（已剔重）。build_zayu.py 也会调用它来给成绩表打标。"""
    if not os.path.exists(DB):
        if not quiet:
            print('！找不到 %s' % DB)
        return []

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
            if not quiet:
                print('！跳过 match %s：%s' % (r['id'], e))
            continue
        if len(moves) < 2:
            if not quiet:
                print('！跳过 match %s：棋步不足两手' % r['id'])
            continue
        if len(set(moves)) != len(moves):
            if not quiet:
                print('！跳过 match %s：同一交叉点出现两次' % r['id'])
            continue
        if any(not (0 <= x < SIZE and 0 <= y < SIZE) for x, y in moves):
            if not quiet:
                print('！跳过 match %s：坐标越界' % r['id'])
            continue
        r['moves'] = moves
        r['note'] = note
        groups.setdefault(tuple(moves), []).append(r)

    for mv in sorted(groups, key=lambda k: groups[k][0]['id']):
        g = groups[mv]
        keep, extra = pick_from_group(g)
        if keep is None:
            skipped += len(g)
            if not quiet:
                print('！同一份棋谱挂在 %d 组对阵上且尾注对不上，整组不进库：%s'
                      % (len(g), ' / '.join('%s-%s' % (x['player1'], x['player2']) for x in g)))
            continue
        if extra:
            skipped += extra
            if not quiet:
                print('· 尾注核对：%s（match %s）为真身，同组另外 %d 条未收录'
                      % ('%s vs %s' % (keep['player1'], keep['player2']), keep['id'], extra))
        games.append(keep)

    if not quiet:
        print('棋谱：入库 %d 局，剔除重复/存疑 %d 条' % (len(games), skipped))

    # 同名同日的赛事（世青赛的 A、B 组）在库里是两行，副标题上得分开
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

def coord_name(x, y):
    """引擎坐标 -> 站点坐标（h8、i9 这种，y 自下 1 起）。"""
    return COLS[x] + str(y + 1)


def round_label(r):
    return '第 %s 轮' % r['round'] if r['round'] else '附加赛'


def result_text(r):
    return RESULT_TEXT.get(r['result'], r['result'] or '—')


def winner_of(g):
    if g['result'] == '1-0':
        return g['player1']
    if g['result'] == '0-1':
        return g['player2']
    return ''


# --------------------------------------------------------------- 产物

def game_json(g):
    """单局数据。moves 用站内坐标（h8），ev 原样带上引擎复盘。"""
    ev = None
    p = os.path.join(EVAL_DIR, '%s.json' % g['id'])
    if os.path.exists(p):
        try:
            with open(p, encoding='utf-8') as f:
                ev = json.load(f)
        except (ValueError, OSError):
            ev = None

    data = {
        'id': g['id'],
        'tid': g['tournament_id'],
        'event': g['tlabel'],
        'date': g['tdate'] or '',
        'round': g['round'],
        'roundLabel': round_label(g),
        'board': g['board_number'],
        'p1': g['player1'],
        'p2': g['player2'],
        'result': g['result'],
        'resultText': result_text(g),
        'winner': winner_of(g),
        'rules': g['trules'] or '',
        'moves': [coord_name(x, y) for x, y in g['moves']],
        'turns': len(g['moves']),
    }
    if ev:
        data['eval'] = {
            'engine': ev.get('engine') or 'Rapfi',
            'depth': ev.get('depth') or 0,
            'pos': ev.get('pos') or [],
        }
    return data


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))


def build_data(games):
    for g in games:
        write_json(os.path.join(OUT, 'g%s.json' % g['id']), game_json(g))
    write_json(GAMES_JSON, [{'id': g['id'], 'moves': g['moves']} for g in games])
    print('数据：%d 局写到 assets/qipu/' % len(games))


# --------------------------------------------------------------- 清理旧栏目

BEGIN = '<!-- qipu:begin -->'
END = '<!-- qipu:end -->'
BANNER = '''        <a class="banner" href="qipu/index.html">
            <span class="banner-text">杂谱：29 局比赛棋谱，可逐手复盘</span>
            <span class="banner-more">打谱 →</span>
        </a>
'''


def strip_file(path):
    """去掉页面上残留的「杂谱」插入块（旧版生成器留下的）。换行原样保留。"""
    with open(path, encoding='utf-8', newline='') as f:
        text = f.read()
    if BEGIN not in text:
        return False
    new = re.sub(re.escape(BEGIN) + r'.*?' + re.escape(END) + r'\r?\n?', '', text,
                 flags=re.S)
    if new == text:
        return False
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(new)
    return True


def cleanup():
    """删掉旧的 qipu/ 栏目与页面上的插入块。重复跑没有副作用。"""
    if os.path.isdir(LEGACY):
        shutil.rmtree(LEGACY)
        print('清理：删除 qipu/ 目录')

    n = 0
    for sub in ('zayu', os.path.join('zayu', 'p')):
        d = os.path.join(ROOT, sub)
        if not os.path.isdir(d):
            continue
        for name in os.listdir(d):
            if name.endswith('.html') and strip_file(os.path.join(d, name)):
                n += 1
    if n:
        print('清理：%d 个页面上的旧棋谱块已移除' % n)


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


def main():
    no_eval = '--no-eval' in sys.argv
    games = load_games()
    if not games:
        print('没有可用的棋谱')
        return 1

    cleanup()
    os.makedirs(EVAL_DIR, exist_ok=True)
    build_data(games)

    if not no_eval:
        run_eval()
        build_data(games)          # 复盘算完，再把 eval 并进单局数据

    print('完成：%d 局可展开查看' % len(games))
    return 0


if __name__ == '__main__':
    sys.exit(main())
