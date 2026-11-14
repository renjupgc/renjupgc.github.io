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
    python tools/manage_duiju.py show --tid 2026-shanhai

命令：
    record  读一轮对局 JSON（见下），整轮覆盖写库，可反复执行（幂等）
    export  从库导出 API：api/duiju/index.json、api/duiju/<slug>/r<N>.json
    sync    把 data/<赛事>/ 下的所有轮次 JSON 重录一遍再导出
    all     record 之后接着 export
    result  写入某一台的赛果（B 黑胜 / W 白胜 / D 和棋）
    show    打印库内赛事与轮次概况

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
import os
import sqlite3
import sys
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

RESULTS = ('B', 'W', 'D')


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
    old_result = {row[0]: row[5] for row in existing}
    old_meta = conn.execute(
        'SELECT model, predicted_at FROM rounds WHERE tournament_id=? AND round=?',
        (t['id'], rnd),
    ).fetchone()
    old_tour = conn.execute(
        'SELECT name, year, group_name, rule, slug FROM tournaments WHERE id=?',
        (t['id'],),
    ).fetchone()

    rows = []
    for g in payload['games']:
        b, w = g['black_norm'], g['white_norm']
        pred = g.get('prediction') or {}
        res = g.get('result') or None
        if res is None:
            res = old_result.get(g['table'])      # null = 不改动已有赛果
        rows.append((
            g['table'],
            b['no'], b['name'],
            w['no'], w['name'],
            res,
            _opt_float(pred.get('black')),
            _opt_float(pred.get('draw')),
            _opt_float(pred.get('white')),
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
    print('录入 %s 第 %d 轮：%d 台（预测 %d 台）' % (
        t['name'], rnd, len(rows),
        sum(1 for r in rows if r[6] is not None),
    ))
    return True


def _opt_float(value):
    return None if value is None else float(value)


# ---------------------------------------------------------------- result

def set_result(conn, tid, rnd, table, value):
    if value not in RESULTS:
        die('result 只能是 B / W / D')
    cur = conn.execute(
        'SELECT black_name, white_name FROM games WHERE tournament_id=? AND round=? AND table_no=?',
        (tid, rnd, table),
    )
    row = cur.fetchone()
    if not row:
        die('库里没有这一台：%s 第 %d 轮 第 %d 台' % (tid, rnd, table))
    conn.execute(
        'UPDATE games SET result=? WHERE tournament_id=? AND round=? AND table_no=?',
        (value, tid, rnd, table),
    )
    conn.commit()
    print('第 %d 台 %s — %s：%s' % (table, row['black_name'], row['white_name'], value))


# ---------------------------------------------------------------- export

def _round_stats(rows):
    played = sum(1 for r in rows if r['result'])
    predicted = sum(1 for r in rows if r['p_black'] is not None)
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
        all_rounds = [r['round'] for r in rounds]
        rmeta = []
        points = {}      # 姓名 → 本轮开赛前的累计分；分数不入库，导出时按赛果现算
        for r in rounds:
            rows = conn.execute(
                'SELECT * FROM games WHERE tournament_id=? AND round=? ORDER BY table_no',
                (t['id'], r['round']),
            ).fetchall()
            played, predicted = _round_stats(rows)
            rmeta.append({
                'round': r['round'],
                'games': len(rows),
                'predicted': predicted,
                'played': played,
                'model': r['model'],
                'predicted_at': r['predicted_at'],
                'updated_at': r['updated_at'],
            })
            write_round(t, r, rows, all_rounds, dict(points))
            for g in rows:
                if g['result'] == 'B':
                    points[g['black_name']] = points.get(g['black_name'], 0) + 1
                elif g['result'] == 'W':
                    points[g['white_name']] = points.get(g['white_name'], 0) + 1
                elif g['result'] == 'D':
                    points[g['black_name']] = points.get(g['black_name'], 0) + 0.5
                    points[g['white_name']] = points.get(g['white_name'], 0) + 0.5

        index['tournaments'].append({
            'id': t['id'],
            'slug': t['slug'],
            'name': t['name'],
            'year': t['year'],
            'group': t['group_name'],
            'rule': t['rule'],
            'updated_at': t['updated_at'],
            'api': 'api/duiju/%s/' % t['slug'],
            'rounds': rmeta,
        })

    path = os.path.join(API_ROOT, 'index.json')
    dump_json(path, index)
    print('导出 %d 场赛事 → %s' % (len(index['tournaments']), os.path.relpath(API_ROOT, ROOT)))


def write_round(tour, rmeta, rows, round_list, points):
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
        'rounds': sorted(set(round_list + [rmeta['round']])),
        'model': rmeta['model'],
        'predicted_at': rmeta['predicted_at'],
        'updated_at': rmeta['updated_at'],
        'games': [],
    }
    for g in rows:
        payload['games'].append({
            'table': g['table_no'],
            'black': {
                'no': g['black_no'], 'name': g['black_name'],
                'score': points.get(g['black_name'], 0),
            },
            'white': {
                'no': g['white_no'], 'name': g['white_name'],
                'score': points.get(g['white_name'], 0),
            },
            'prediction': None if g['p_black'] is None else {
                'black': g['p_black'], 'draw': g['p_draw'], 'white': g['p_white'],
            },
            'result': g['result'],
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

    p_res = sub.add_parser('result', help='写入某一台的赛果')
    p_res.add_argument('--tid', required=True)
    p_res.add_argument('--round', type=int, required=True)
    p_res.add_argument('--table', type=int, required=True)
    p_res.add_argument('--value', required=True, choices=RESULTS)

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
            export_api(conn)
        elif args.cmd == 'sync':
            sync_sources(conn)
        elif args.cmd == 'result':
            set_result(conn, args.tid, args.round, args.table, args.value)
        elif args.cmd == 'show':
            show(conn, args.tid)
    finally:
        conn.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
