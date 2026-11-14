#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
对局库 duiju.db：录入对局与预测结果，导出站点 API。

数据只有一份：data/duiju.db。库里只放对局（台次、双方编号与姓名、赛果）与预测概率；
等级分留在源 JSON 里（那是一次预测的输入留档），分数按前几轮赛果现算，两者都不入库。
页面不再内置任何一局，只读站点上的 JSON。

    python tools/manage_duiju.py record data/shanhai/2026-r1.json
    python tools/manage_duiju.py export
    python tools/manage_duiju.py sync
    python tools/manage_duiju.py all data/shanhai/2026-r1.json
    python tools/manage_duiju.py result --tid 2026-shanhai --round 1 --table 3 --value B
    python tools/manage_duiju.py apply --tid 2026-shanhai --round 1 --results "1=B,2=W,5=-"
    python tools/manage_duiju.py show --tid 2026-shanhai

命令：
    record  读一轮对局 JSON（见下），整轮覆盖写库，可反复执行（幂等）
    export  从库导出 API：api/duiju/index.json、api/duiju/<slug>/r<N>.json
    sync    把 data/<赛事>/ 下的所有轮次 JSON 重录一遍再导出
    all     record 之后接着 export
    result  写入某一台的赛果（B 黑胜 / W 白胜 / D 和棋 / - 清空）
    apply   一次写入多台赛果，如 "1=B,2=W,5=-"
    show    打印库内赛事与轮次概况

一台对局一旦有了赛果，它的概率就定死：之后再 record / sync，JSON 里的预测不再覆盖它
（赛果为 null 的台照常更新）。赛果可以用命令行补，也可以在暗门页 admin/duiju.html
点按钮，页面会触发 update-duiju 工作流把结果写进库。

后端不靠服务器：`sync` 由 .github/workflows/update-duiju.yml 定时（以及手动、推送时）
在 Actions 里跑，重出 api/duiju/ 并提交；GitHub Pages 直接把这些 JSON 当接口发出去。

一轮对局 JSON 的结构：

    {
      "tournament": {"id": "2026-shanhai", "name": "…", "year": 2026,
                     "group": "公开组", "rule": "塔拉山口-10", "slug": "shanhai"},
      "round": 1,
      "predicted_at": "2026-11-14 01:29:38",
      "model": "gbdt-20260704",
      "games": [
        {"table": 1,
         "black": {"no": 1, "name": "王俊锴", "rating": 2347.3},
         "white": {"no": 24, "name": "马子轩", "rating": 2164.7},
         "prediction": {"black": 65.6, "draw": 9.3, "white": 25.2},
         "result": null}
      ]
    }

prediction 可以缺省（= 这一轮还没跑预测），超出 0~100 的值会被拒绝。
rating 只在源文件里留档，不入库、不进接口。
"""

import argparse
import json
import math
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import predict_api  # noqa: E402  同目录的预测接口
from datetime import datetime, timezone, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(ROOT, 'data', 'duiju.db')
API_ROOT = os.path.join(ROOT, 'api', 'duiju')
TZ = timezone(timedelta(hours=8))

SCHEMA = """
CREATE TABLE IF NOT EXISTS tournaments (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    year        INTEGER,
    group_name  TEXT,
    rule        TEXT,
    slug        TEXT NOT NULL,
    updated_at  TEXT
);
CREATE TABLE IF NOT EXISTS rounds (
    tournament_id TEXT NOT NULL REFERENCES tournaments(id),
    round         INTEGER NOT NULL,
    model         TEXT,
    predicted_at  TEXT,
    updated_at    TEXT,
    PRIMARY KEY (tournament_id, round)
);
CREATE TABLE IF NOT EXISTS games (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id TEXT NOT NULL REFERENCES tournaments(id),
    round         INTEGER NOT NULL,
    table_no      INTEGER NOT NULL,
    black_no      INTEGER,
    black_name    TEXT NOT NULL,
    white_no      INTEGER,
    white_name    TEXT NOT NULL,
    result        TEXT,
    p_black       REAL,
    p_draw        REAL,
    p_white       REAL,
    UNIQUE (tournament_id, round, table_no)
);
"""

RESULTS = ('B', 'W', 'D', 'BF', 'WF')


def get_effective_result(res):
    """把 BF/WF 映射为等效对局胜方（BF 黑弃权=白胜 W，WF 白弃权=黑胜 B）。"""
    if res in ('B', 'WF'):
        return 'B'
    if res in ('W', 'BF'):
        return 'W'
    if res == 'D':
        return 'D'
    return None


def now_str():
    return datetime.now(TZ).strftime('%Y-%m-%d %H:%M:%S')


def connect(path=DB_PATH):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def die(msg):
    print('！ ' + msg, file=sys.stderr)
    sys.exit(1)


# ---------------------------------------------------------------- record

def _num(value, field, allow_none=False):
    if value is None:
        if allow_none:
            return None
        die('缺少字段：%s' % field)
    try:
        return float(value)
    except (TypeError, ValueError):
        die('字段 %s 不是数字：%r' % (field, value))


def _side(raw, field):
    if not isinstance(raw, dict):
        die('字段 %s 应是对象（no/name）' % field)
    name = (raw.get('name') or '').strip()
    if not name:
        die('%s 缺少姓名' % field)
    no = raw.get('no')
    if no is not None:
        try:
            no = int(no)
        except (TypeError, ValueError):
            die('%s 的编号不是整数：%r' % (field, no))
    return {'no': no, 'name': name}


def load_round_file(path):
    with open(path, encoding='utf-8') as f:
        data = json.load(f)

    t = data.get('tournament') or {}
    tid = (t.get('id') or '').strip()
    if not tid:
        die('JSON 缺少 tournament.id')
    name = (t.get('name') or '').strip()
    if not name:
        die('JSON 缺少 tournament.name')
    slug = (t.get('slug') or tid.split('-', 1)[-1]).strip()
    if not slug or '/' in slug:
        die('tournament.slug 不可用：%r' % slug)

    rnd = data.get('round')
    if not isinstance(rnd, int) or rnd < 1:
        die('round 应是正整数')

    games = data.get('games')
    if not isinstance(games, list) or not games:
        die('games 不能为空')

    tables, names = set(), set()
    for g in games:
        table = g.get('table')
        if not isinstance(table, int) or table < 1:
            die('每局都要有正整数 table，出错的是 %r' % (g,))
        if table in tables:
            die('台号重复：%d' % table)
        tables.add(table)
        for key in ('black', 'white'):
            side = _side(g.get(key), key)
            if side['name'] in names:
                die('同一轮里 %s 出现了两次' % side['name'])
            names.add(side['name'])
            g[key + '_norm'] = side
        if g.get('result') not in (None, '', *RESULTS):
            die('第 %d 台 result 只能是 B / W / D 或空' % table)
        pred = g.get('prediction')
        if pred is None:
            continue
        for key in ('black', 'draw', 'white'):
            p = _num(pred.get(key), 'prediction.%s' % key, allow_none=True)
            if p is not None and not 0 <= p <= 100:
                die('第 %d 台 prediction.%s 超出 0~100：%r' % (table, key, p))

    return {
        'tournament': {
            'id': tid,
            'name': name,
            'year': t.get('year'),
            'group': t.get('group'),
            'rule': t.get('rule'),
            'slug': slug,
        },
        'round': rnd,
        'model': (data.get('model') or '').strip() or None,
        'predicted_at': (data.get('predicted_at') or '').strip() or None,
        'games': games,
    }


def _round_rows(conn, tid, rnd):
    """库里这一轮的现状，用来判断重录是否真的带来变化。"""
    rows = conn.execute(
        'SELECT table_no, black_no, black_name, white_no, white_name, result,'
        ' p_black, p_draw, p_white FROM games'
        ' WHERE tournament_id=? AND round=? ORDER BY table_no',
        (tid, rnd),
    ).fetchall()
    return [tuple(r) for r in rows]


def record_round(conn, payload):
    """把一轮写进库。同一份数据反复录不会产生任何改动（Actions 定时跑也不会出空提交）；
    JSON 里 result 为 null 时不覆盖库里已经记下的赛果。"""
    t = payload['tournament']
    rnd = payload['round']

    existing = _round_rows(conn, t['id'], rnd)
    old_rows = {row[0]: row for row in existing}
    old_meta = conn.execute(
        'SELECT model, predicted_at FROM rounds WHERE tournament_id=? AND round=?',
        (t['id'], rnd),
    ).fetchone()
    old_tour = conn.execute(
        'SELECT name, year, group_name, rule, slug FROM tournaments WHERE id=?',
        (t['id'],),
    ).fetchone()

    rows = []
    locked = 0
    for g in payload['games']:
        b, w = g['black_norm'], g['white_norm']
        pred = g.get('prediction') or {}
        prev = old_rows.get(g['table'])
        res = g.get('result') or None
        if res is None and prev is not None:
            res = prev[5]                        # null = 不改动已有赛果
        if prev is not None and prev[5] is not None:
            # 这一台已经有赛果：概率就此定死，JSON 里后来的预测不再覆盖
            pb, pd, pw = prev[6], prev[7], prev[8]
            locked += 1
        else:
            pb = _opt_float(pred.get('black'))
            pd = _opt_float(pred.get('draw'))
            pw = _opt_float(pred.get('white'))
            if prev is not None and pb is None and pd is None and pw is None:
                # JSON 没给概率：用库里已经算出来的那份，不因为重录而清空
                pb, pd, pw = prev[6], prev[7], prev[8]
        rows.append((
            g['table'],
            b['no'], b['name'],
            w['no'], w['name'],
            res,
            pb, pd, pw,
        ))

    same_games = [tuple(r[:5]) + (r[5], r[6], r[7], r[8]) for r in existing] == rows
    same_meta = bool(old_meta) and tuple(old_meta) == (payload['model'], payload['predicted_at'])
    same_tour = bool(old_tour) and tuple(old_tour) == (
        t['name'], t['year'], t['group'], t['rule'], t['slug'])
    if same_games and same_meta and same_tour:
        print('%s 第 %d 轮：库里已是最新，未写入' % (t['name'], rnd))
        return False

    stamp = now_str()
    conn.execute(
        'INSERT INTO tournaments (id, name, year, group_name, rule, slug, updated_at)'
        ' VALUES (?,?,?,?,?,?,?)'
        ' ON CONFLICT(id) DO UPDATE SET name=excluded.name, year=excluded.year,'
        ' group_name=excluded.group_name, rule=excluded.rule, slug=excluded.slug,'
        ' updated_at=excluded.updated_at',
        (t['id'], t['name'], t['year'], t['group'], t['rule'], t['slug'], stamp),
    )
    conn.execute(
        'INSERT INTO rounds (tournament_id, round, model, predicted_at, updated_at)'
        ' VALUES (?,?,?,?,?) ON CONFLICT(tournament_id, round) DO UPDATE SET'
        ' model=excluded.model, predicted_at=excluded.predicted_at,'
        ' updated_at=excluded.updated_at',
        (t['id'], rnd, payload['model'], payload['predicted_at'], stamp),
    )
    # 整轮覆盖：先删后插，后面的轮次重复执行也不会叠数据
    conn.execute('DELETE FROM games WHERE tournament_id=? AND round=?', (t['id'], rnd))
    conn.executemany(
        'INSERT INTO games (tournament_id, round, table_no, black_no, black_name,'
        ' white_no, white_name, result, p_black, p_draw, p_white)'
        ' VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [(t['id'], rnd) + r for r in rows],
    )
    conn.commit()
    print('录入 %s 第 %d 轮：%d 台（预测 %d 台，%d 台已出赛果、概率锁定）' % (
        t['name'], rnd, len(rows),
        sum(1 for r in rows if r[6] is not None), locked,
    ))
    return True


def _opt_float(value):
    return None if value is None else float(value)


# ---------------------------------------------------------------- result

def set_result(conn, tid, rnd, table, value):
    """写一台的赛果；value 为 '-' 表示清掉（回到未出结果）。"""
    value = (value or '').strip() or '-'
    if value != '-' and value not in RESULTS:
        die('result 只能是 B / W / D / -（- 表示清空）')
    row = conn.execute(
        'SELECT black_name, white_name, result FROM games'
        ' WHERE tournament_id=? AND round=? AND table_no=?',
        (tid, rnd, table),
    ).fetchone()
    if not row:
        die('库里没有这一台：%s 第 %d 轮 第 %d 台' % (tid, rnd, table))
    new_value = None if value == '-' else value
    if row['result'] == new_value:
        print('第 %d 台 %s — %s：%s（未变化）' % (
            table, row['black_name'], row['white_name'], new_value or '未出结果'))
        return False
    conn.execute(
        'UPDATE games SET result=? WHERE tournament_id=? AND round=? AND table_no=?',
        (new_value, tid, rnd, table),
    )
    conn.commit()
    print('第 %d 台 %s — %s：%s' % (
        table, row['black_name'], row['white_name'], new_value or '清空'))
    return True


def apply_results(conn, tid, rnd, spec):
    """批量写赛果：spec 形如 "1=B,2=W,5=D,7=-"（- 清空）。"""
    items = [s.strip() for s in (spec or '').split(',') if s.strip()]
    if not items:
        die('没有可写的赛果：--results "1=B,2=W"')
    changed = 0
    for item in items:
        for sep in ('=', ':'):
            if sep in item:
                table_s, value_s = item.split(sep, 1)
                break
        else:
            die('看不懂这一项：%r（应为 台次=B/W/D/-）' % item)
        try:
            table = int(table_s.strip())
        except ValueError:
            die('台次不是数字：%r' % table_s)
        if set_result(conn, tid, rnd, table, value_s.strip().upper()):
            changed += 1
    print('共 %d 项，%d 台有改动' % (len(items), changed))


# ---------------------------------------------------------------- 名次

# 山海杯名次口径：积分 → 对手分 → 中间对手分 → 胜局数 → 并列（同分同名次）
POINT = {
    'B': (1.0, 0.0),
    'W': (0.0, 1.0),
    'D': (0.5, 0.5),
    'BF': (0.0, 1.0),  # 黑弃权，白方得 1 分
    'WF': (1.0, 0.0),  # 白弃权，黑方得 1 分
}
BYE_POINT = 1.0


def _player_key(no, name):
    return no if no is not None else name


def collect_players(conn, tid):
    """库里出现过的全部棋手：编号、姓名。"""
    players = {}
    for g in conn.execute(
            'SELECT black_no, black_name, white_no, white_name FROM games'
            ' WHERE tournament_id=? ORDER BY round, table_no', (tid,)):
        for no, name in ((g['black_no'], g['black_name']),
                         (g['white_no'], g['white_name'])):
            if name == '轮空':
                continue
            key = _player_key(no, name)
            players.setdefault(key, {'no': no, 'name': name, 'results': []})
    return players


def compute_standings(conn, tid, upto=None):
    """按山海杯口径算名次：积分 → 对手分 → 中间对手分 → 胜局数，末了并列同名次。

    对手分计算规则（FIDE/连珠瑞士制虚拟积分口径）：
    1. 虚拟积分 = 积分 + 0.5 * (弃权次数 + 退赛轮数 - 对手弃权次数 - 轮空次数)
    2. 对手分 = 所有对手的虚拟积分之和，轮空算做一个虚拟积分 = 0.5 * 总轮数的对手；未编排退赛轮次对手虚拟积分为 0
    3. 中间对手分 = 去掉最高、最低各一个对手虚拟积分后求和（对手不足 3 人时等于对手分）
    4. 胜局数 = 真正赢下来的盘数（轮空、弃权白捡的不算）
    """
    rounds = [r['round'] for r in conn.execute(
        'SELECT round FROM rounds WHERE tournament_id=? ORDER BY round', (tid,))]
    if upto is None:
        upto = max(rounds) if rounds else 0
    total = max(rounds) if rounds else upto
    round_list = [r for r in rounds if r <= upto]

    players = collect_players(conn, tid)
    games = conn.execute(
        'SELECT * FROM games WHERE tournament_id=? AND round<=? ORDER BY round, table_no',
        (tid, upto)).fetchall()

    stats = {}
    for k, p in players.items():
        stats[k] = {
            'score': 0.0,
            'wins': 0,
            'floss': 0,      # 自己弃权次数
            'fwin': 0,       # 对手弃权次数
            'bye': 0,        # 轮空次数
            'rounds_played': set(),
            'opponents': {}  # round -> opponent_key (or '轮空')
        }

    for g in games:
        rnd = g['round']
        b_key = _player_key(g['black_no'], g['black_name'])
        w_key = _player_key(g['white_no'], g['white_name'])
        res = g['result']

        if b_key != '轮空':
            stats[b_key]['rounds_played'].add(rnd)
            stats[b_key]['opponents'][rnd] = w_key
            players[b_key]['results'].append({
                'round': rnd, 'color': 'black', 'opponent': w_key, 'result': res
            })
        if w_key != '轮空':
            stats[w_key]['rounds_played'].add(rnd)
            stats[w_key]['opponents'][rnd] = b_key
            players[w_key]['results'].append({
                'round': rnd, 'color': 'white', 'opponent': b_key, 'result': res
            })

        # 积分、胜局与弃权/轮空统计
        if w_key == '轮空':
            stats[b_key]['score'] += 1.0
            stats[b_key]['bye'] += 1
        elif b_key == '轮空':
            stats[w_key]['score'] += 1.0
            stats[w_key]['bye'] += 1
        elif res == 'B':
            stats[b_key]['score'] += 1.0
            stats[b_key]['wins'] += 1
        elif res == 'W':
            stats[w_key]['score'] += 1.0
            stats[w_key]['wins'] += 1
        elif res == 'D':
            stats[b_key]['score'] += 0.5
            stats[w_key]['score'] += 0.5
        elif res == 'BF':
            stats[b_key]['floss'] += 1
            stats[w_key]['fwin'] += 1
            stats[w_key]['score'] += 1.0
        elif res == 'WF':
            stats[w_key]['floss'] += 1
            stats[b_key]['fwin'] += 1
            stats[b_key]['score'] += 1.0

    # 虚拟积分 = 积分 + 0.5 * (弃权次数 + 退赛轮数 - 对手弃权次数 - 轮空次数)
    virtual_scores = {}
    for k, st in stats.items():
        withdraw = len(round_list) - len(st['rounds_played'])
        v_score = st['score'] + 0.5 * (st['floss'] + withdraw - st['fwin'] - st['bye'])
        virtual_scores[k] = v_score
        players[k]['score'] = st['score']
        players[k]['wins'] = st['wins']

    # 轮空算做一个虚拟积分 = 0.5 * 总轮数的对手
    bye_virtual_score = 0.5 * len(round_list)

    for k, p in players.items():
        st = stats[k]
        opp_vals = []
        for rnd in round_list:
            if rnd not in st['rounds_played']:
                opp_vals.append(0.0)
            else:
                opp = st['opponents'][rnd]
                if opp == '轮空':
                    opp_vals.append(bye_virtual_score)
                else:
                    opp_vals.append(virtual_scores.get(opp, 0.0))

        p['buch'] = round(sum(opp_vals), 4)
        if len(opp_vals) >= 3:
            p['med'] = round(sum(sorted(opp_vals)[1:-1]), 4)
        else:
            p['med'] = 0.0
        p['played'] = len(st['rounds_played'])

    ordered = sorted(
        players.values(),
        key=lambda p: (-p['score'], -p['buch'], -p['med'], -p['wins'],
                       p['no'] if p['no'] is not None else 9999, p['name']))

    ranking = []
    last_key, last_rank = None, 0
    for idx, p in enumerate(ordered, 1):
        key = (p['score'], p['buch'], p['med'], p['wins'])
        if key != last_key:
            last_rank = idx
            last_key = key
        ranking.append({
            'rank': last_rank,
            'no': p['no'],
            'name': p['name'],
            'score': round(p['score'], 4),
            'buch': p['buch'],
            'med': p['med'],
            'wins': p['wins'],
            'played': p['played'],
            'results': [{
                'round': r['round'],
                'color': r['color'],
                'opponent_no': players[r['opponent']]['no'] if r['opponent'] in players else None,
                'opponent': players[r['opponent']]['name'] if r['opponent'] in players else str(r['opponent']),
                'result': r['result'],
            } for r in sorted(p['results'], key=lambda r: r['round'])],
        })
    return ranking, rounds, total


def standings_payload(conn, tour, rnd):
    ranking, rounds, total = compute_standings(conn, tour['id'], rnd)
    played_games = conn.execute(
        'SELECT COUNT(*) c FROM games WHERE tournament_id=? AND round=? AND result IS NOT NULL',
        (tour['id'], rnd)).fetchone()['c']
    return {
        'tournament': {
            'id': tour['id'], 'slug': tour['slug'], 'name': tour['name'],
            'year': tour['year'], 'group': tour['group_name'], 'rule': tour['rule'],
        },
        'round': rnd,
        'rounds': rounds,
        'total_rounds': total,
        'played': played_games,
        'tiebreak': ['score', 'buch', 'med', 'wins'],
        'points': {'win': 1.0, 'draw': 0.5, 'bye': BYE_POINT},
        'ranking': ranking,
    }




# ---------------------------------------------------------------- 预测

def predict_missing(conn, only_tid=None):
    """预测交给 tools/predict_api.py：按前几轮的赛果滚动 WHR，再算概率。

    只填「还没有赛果」的台；已经有赛果的那几台概率定死，不会被重算。"""
    tids = [t['id'] for t in conn.execute('SELECT id FROM tournaments')]
    if only_tid:
        tids = [t for t in tids if t == only_tid]
    total = 0
    for tid in tids:
        total += predict_api.predict_tournament(conn, tid, write=True)
    return total


# ---------------------------------------------------------------- export

def _round_stats(rows):
    played = sum(1 for r in rows if r['result'] and r['black_name'] != '轮空' and r['white_name'] != '轮空')
    predicted = sum(1 for r in rows if r['p_black'] is not None and r['black_name'] != '轮空' and r['white_name'] != '轮空')
    return played, predicted


def export_api(conn):
    """把库里的东西摊成静态 JSON，挂在站点 /api/duiju/ 下。

    导出的内容只由库决定，不带导出时间：同一份库跑两次，产物逐字节相同，
    这样 GitHub Actions 定时跑不会因为时间戳而空提交。"""
    tours = conn.execute(
        'SELECT * FROM tournaments ORDER BY year DESC, id'
    ).fetchall()
    if not tours:
        die('库里还没有赛事，先 record 一轮')

    os.makedirs(API_ROOT, exist_ok=True)
    index = {
        'source': 'data/duiju.db',
        'tournaments': [],
    }

    for t in tours:
        rounds = conn.execute(
            'SELECT * FROM rounds WHERE tournament_id=? ORDER BY round',
            (t['id'],),
        ).fetchall()
        
        round_data = []
        for r in rounds:
            rows = conn.execute(
                'SELECT * FROM games WHERE tournament_id=? AND round=? ORDER BY table_no',
                (t['id'], r['round']),
            ).fetchall()
            played, predicted = _round_stats(rows)
            is_finished = (len(rows) > 0 and all(bool(g['result']) for g in rows))
            round_data.append({
                'r': r,
                'rows': rows,
                'played': played,
                'predicted': predicted,
                'is_finished': is_finished,
            })

        rmeta = [{
            'round': d['r']['round'],
            'games': len(d['rows']),
            'predicted': d['predicted'],
            'played': d['played'],
            'is_finished': d['is_finished'],
            'model': d['r']['model'],
            'predicted_at': d['r']['predicted_at'],
            'updated_at': d['r']['updated_at'],
            'standings': ('api/duiju/%s/standings/r%d.json' % (t['slug'], d['r']['round'])) if d['is_finished'] else None,
        } for d in round_data]

        rounds_summary = [{'round': m['round'], 'is_finished': m['is_finished']} for m in rmeta]

        points = {}      # 姓名 → 本轮开赛前的累计分；分数不入库，导出时按赛果现算
        for d in round_data:
            write_round(t, d['r'], d['rows'], rounds_summary, dict(points), is_finished=d['is_finished'])
            if d['is_finished']:
                write_standings(conn, t, d['r']['round'])
            else:
                stale_path = os.path.join(API_ROOT, t['slug'], 'standings', 'r%d.json' % d['r']['round'])
                if os.path.exists(stale_path):
                    os.remove(stale_path)
            for g in d['rows']:
                if g['result'] in ('B', 'WF'):
                    points[g['black_name']] = points.get(g['black_name'], 0) + 1
                elif g['result'] in ('W', 'BF'):
                    points[g['white_name']] = points.get(g['white_name'], 0) + 1
                elif g['result'] == 'D':
                    points[g['black_name']] = points.get(g['black_name'], 0) + 0.5
                    points[g['white_name']] = points.get(g['white_name'], 0) + 0.5

        write_metrics(conn, t, rmeta)
        index['tournaments'].append({
            'id': t['id'],
            'slug': t['slug'],
            'name': t['name'],
            'year': t['year'],
            'group': t['group_name'],
            'rule': t['rule'],
            'updated_at': t['updated_at'],
            'api': 'api/duiju/%s/' % t['slug'],
            'metrics': 'api/duiju/%s/metrics.json' % t['slug'],
            'rounds': rmeta,
        })

    path = os.path.join(API_ROOT, 'index.json')
    dump_json(path, index)
    print('导出 %d 场赛事 → %s' % (len(index['tournaments']), os.path.relpath(API_ROOT, ROOT)))


# ---------------------------------------------------------------- 预测评估

def _metrics_of(rows):
    """对「有概率又有赛果」的台算命中率、Brier、对数损失、平均置信度。"""
    n = hit = 0
    brier = logloss = conf = 0.0
    classes = {'B': 0, 'D': 0, 'W': 0}
    hit_by_class = {'B': 0, 'D': 0, 'W': 0}
    for g in rows:
        res = g['result']
        if res not in ('B', 'D', 'W') or g['p_black'] is None:
            continue
        p = {
            'B': g['p_black'] / 100.0,
            'D': g['p_draw'] / 100.0,
            'W': g['p_white'] / 100.0,
        }
        top = max(p, key=lambda k: p[k])
        n += 1
        classes[res] += 1
        if top == res:
            hit += 1
            hit_by_class[res] += 1
        brier += sum((p[k] - (1.0 if k == res else 0.0)) ** 2 for k in p)
        logloss -= math.log(max(p[res], 1e-9))
        conf += p[top]
    if not n:
        return None
    return {
        'n': n,
        'hit': hit,
        'accuracy': round(hit / float(n), 4),
        'brier': round(brier / n, 4),
        'logloss': round(logloss / n, 4),
        'confidence': round(conf / n, 4),
        'results': classes,
        'hit_by_result': hit_by_class,
    }


def write_metrics(conn, tour, rmeta):
    predict_api.evaluate_tournament_model(conn, tour['id'], write=True, print_report=False)


def write_round(tour, rmeta, rows, rounds_summary, points, is_finished=False):
    payload = {
        'tournament': {
            'id': tour['id'],
            'slug': tour['slug'],
            'name': tour['name'],
            'year': tour['year'],
            'group': tour['group_name'],
            'rule': tour['rule'],
        },
        'round': rmeta['round'],
        'is_finished': is_finished,
        'rounds': rounds_summary,
        'model': rmeta['model'],
        'predicted_at': rmeta['predicted_at'],
        'updated_at': rmeta['updated_at'],
        'games': [],
    }
    for g in rows:
        is_bye = (g['black_name'] == '轮空' or g['white_name'] == '轮空')
        pred = None if (is_bye or g['p_black'] is None) else {
            'black': g['p_black'], 'draw': g['p_draw'], 'white': g['p_white'],
        }
        is_correct = None
        if not is_bye and pred is not None and g['result']:
            eff = get_effective_result(g['result'])
            if eff:
                pb, pd, pw = pred['black'], pred['draw'], pred['white']
                top = max(pb, pd, pw)
                fav = 'B' if pb == top else ('W' if pw == top else 'D')
                is_correct = (fav == eff)

        payload['games'].append({
            'table': g['table_no'],
            'black': {
                'no': g['black_no'], 'name': g['black_name'],
                'score': None if g['black_name'] == '轮空' else points.get(g['black_name'], 0),
            },
            'white': {
                'no': g['white_no'], 'name': g['white_name'],
                'score': None if g['white_name'] == '轮空' else points.get(g['white_name'], 0),
            },
            'prediction': pred,
            'result': g['result'],
            'prediction_correct': is_correct,
        })

    out_dir = os.path.join(API_ROOT, tour['slug'])
    os.makedirs(out_dir, exist_ok=True)
    dump_json(os.path.join(out_dir, 'r%d.json' % rmeta['round']), payload)


def dump_json(path, obj):
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write('\n')


# ---------------------------------------------------------------- sync

def sync_sources(conn):
    """把 data/<赛事>/ 下的每一轮 JSON 重录一遍，再重出接口。

    这是 GitHub Actions 走的那条路：仓库里的 JSON 是录入底稿，库与 api/duiju/
    都由它长出来。没有变化时不会写库，也不会改动 api/ 里的文件。
    """
    base = os.path.join(ROOT, 'data')
    files = []
    for sub in sorted(os.listdir(base)):
        folder = os.path.join(base, sub)
        if not os.path.isdir(folder):
            continue
        for name in sorted(os.listdir(folder)):
            if name.endswith('.json'):
                files.append(os.path.join(folder, name))
    if not files:
        die('data/ 下没有可录的对局 JSON')

    changed = 0
    for path in files:
        if record_round(conn, load_round_file(path)):
            changed += 1
    print('同步 %d 个文件，%d 个有变化' % (len(files), changed))
    predict_missing(conn)
    export_api(conn)


# ---------------------------------------------------------------- show

def show(conn, tid=None):
    tours = conn.execute('SELECT * FROM tournaments ORDER BY year DESC, id').fetchall()
    if tid:
        tours = [t for t in tours if t['id'] == tid]
    if not tours:
        print('（库里没有赛事）')
        return
    for t in tours:
        print('%s  %s（%s · %s）' % (t['id'], t['name'], t['group_name'] or '—', t['rule'] or '—'))
        for r in conn.execute(
                'SELECT * FROM rounds WHERE tournament_id=? ORDER BY round', (t['id'],)):
            rows = conn.execute(
                'SELECT result, p_black FROM games WHERE tournament_id=? AND round=?',
                (t['id'], r['round']),
            ).fetchall()
            played, predicted = _round_stats(rows)
            print('    第 %d 轮  %d 台  预测 %d  已出结果 %d  预测于 %s' % (
                r['round'], len(rows), predicted, played, r['predicted_at'] or '—'))
        total = conn.execute(
            'SELECT COUNT(*) c FROM games WHERE tournament_id=?', (t['id'],)
        ).fetchone()['c']
        print('    合计 %d 局' % total)


def write_standings(conn, tour, rnd):
    """每轮一份名次表：积分 → 对手分 → 中间对手分 → 胜局数 → 并列同名次。"""
    out_dir = os.path.join(API_ROOT, tour['slug'], 'standings')
    os.makedirs(out_dir, exist_ok=True)
    dump_json(os.path.join(out_dir, 'r%d.json' % rnd),
              standings_payload(conn, tour, rnd))


# ---------------------------------------------------------------- main

def main(argv=None):
    ap = argparse.ArgumentParser(description='duiju.db 对局录入与站点 API 导出')
    sub = ap.add_subparsers(dest='cmd')

    p_rec = sub.add_parser('record', help='录入一轮对局（整轮覆盖）')
    p_rec.add_argument('file')

    sub.add_parser('export', help='从库导出 api/duiju/')

    p_all = sub.add_parser('all', help='record 之后接着 export')
    p_all.add_argument('file')

    sub.add_parser('sync', help='重录 data/ 下所有轮次 JSON 并重出接口（Actions 用）')

    sub.add_parser('predict', help='给还没概率的台补预测（sync/all 已自带）')

    p_res = sub.add_parser('result', help='写入某一台的赛果')
    p_res.add_argument('--tid', required=True)
    p_res.add_argument('--round', type=int, required=True)
    p_res.add_argument('--table', type=int, required=True)
    p_res.add_argument('--value', required=True, choices=RESULTS + ('-',))

    p_apply = sub.add_parser('apply', help='一次写入多台赛果，如 1=B,2=W,5=-')
    p_apply.add_argument('--tid', required=True)
    p_apply.add_argument('--round', type=int, required=True)
    p_apply.add_argument('--results', required=True)

    p_show = sub.add_parser('show', help='概况')
    p_show.add_argument('--tid')

    args = ap.parse_args(argv)
    if not args.cmd:
        ap.print_help()
        return 0

    conn = connect()
    try:
        if args.cmd == 'record':
            record_round(conn, load_round_file(args.file))
        elif args.cmd == 'export':
            export_api(conn)
        elif args.cmd == 'all':
            record_round(conn, load_round_file(args.file))
            predict_missing(conn)
            export_api(conn)
        elif args.cmd == 'predict':
            predict_missing(conn)
            export_api(conn)
        elif args.cmd == 'sync':
            sync_sources(conn)
        elif args.cmd == 'result':
            set_result(conn, args.tid, args.round, args.table, args.value)
        elif args.cmd == 'apply':
            apply_results(conn, args.tid, args.round, args.results)
        elif args.cmd == 'show':
            show(conn, args.tid)
    finally:
        conn.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
