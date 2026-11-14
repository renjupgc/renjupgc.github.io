# -*- coding: utf-8 -*-
"""赛事对局胜率预测 API（基于截止 20261112 最新模型与数据）。

本模块提供针对一个赛事（如 2026-shanhai）一系列对局的官方 WHR 动态滚动与最新 GBDT 预测接口。

核心逻辑：
1. 模型：使用截止 20261112 训练的最新 GBDT 决策树模型（bisai/data/model_20261112.json）。
2. 特征：包含开局规则（塔拉山口-10 为 25）、双方等级分、等级分差、平均等级分、标准差、联合标准差、
   衰减和棋率、历史交手胜率（H2H）以及国家属性。
3. 动态滚动：预测第 R 轮时，自动提取本赛事第 1 ~ R-1 轮已出结果的实际对局（胜/平/负），
   结合全量 WHR 算法进行增量收敛拟合，动态更新棋手在当轮开赛前的最新 rating 与 rd。
4. 正误判定：对赛果已出的对局自动判定预测正误（最高概率方与实际赛果一致为正确，否则为错误）。

用法：
    python tools/predict_api.py --tid 2026-shanhai
    python tools/predict_api.py --tid 2026-shanhai --round 2
    python tools/predict_api.py --tid 2026-shanhai --write

作为库用：
    import predict_api
    preds = predict_api.predict_tournament(conn, '2026-shanhai', write=True)
"""

import argparse
import glob
import gzip
import json
import math
import os
import sqlite3
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(ROOT, 'data', 'duiju.db')
DATA_DIR = os.path.join(ROOT, 'data')
WHR_GAMES_PATH = os.path.join(ROOT, 'data', 'whr_games.json.gz')
MODEL_PATH = os.path.join(ROOT, 'bisai', 'data', 'model_20261112.json')
if not os.path.exists(MODEL_PATH):
    MODEL_PATH = os.path.join(ROOT, 'bisai', 'data', 'model.json')

PLAYERS_PATH = os.path.join(ROOT, 'bisai', 'data', 'players.json')
H2H_PATH = os.path.join(ROOT, 'bisai', 'data', 'h2h.json')

# WHR 官方基准常数
W2 = 19.3
VIRTUAL_GAMES = 2
BIAS = 1900.0
BASE_DAY = 20710

# 规则 ID 映射
RULE_MAP = {
    '塔拉山口-10': 25,
    'Taraguchi-10': 25,
    't10': 25,
    '索索夫-8': 22,
    'Soosyrv-8': 22,
    'RIF': 1,
}

_MODEL_CACHE = None
_PLAYERS_CACHE = None
_H2H_CACHE = None
_WHR_BASE_GAMES_CACHE = None


def connect(path=None):
    conn = sqlite3.connect(path or DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


# ---------------------------------------------------------------- 加载 20261112 静态元数据

def load_gbdt_model():
    """加载截止 20261112 的最新 GBDT 决策树模型。"""
    global _MODEL_CACHE
    if _MODEL_CACHE is not None:
        return _MODEL_CACHE
    if not os.path.exists(MODEL_PATH):
        raise FileNotFoundError(f'未找到最新模型文件: {MODEL_PATH}')
    with open(MODEL_PATH, 'r', encoding='utf-8') as f:
        _MODEL_CACHE = json.load(f)
    return _MODEL_CACHE


def load_players_meta():
    """加载 20261112 棋手画像数据（包含官方 ID、衰减和棋率、国籍等）。"""
    global _PLAYERS_CACHE
    if _PLAYERS_CACHE is not None:
        return _PLAYERS_CACHE
    p_map = {}
    if os.path.exists(PLAYERS_PATH):
        with open(PLAYERS_PATH, 'r', encoding='utf-8') as f:
            players = json.load(f)
            for p in players:
                if p.get('native_name'):
                    p_map[p['native_name']] = p
                if p.get('name'):
                    p_map[p['name']] = p
            p_map['韦振强'] = p_map.get('韋振強')
            # 常见重名或特定 ID 绑定
            for p in players:
                if p.get('id') == '102456':
                    p_map['陈超'] = p
                if p.get('id') == '102466':
                    p_map['王嘉欣'] = p
    _PLAYERS_CACHE = p_map
    return _PLAYERS_CACHE


def load_h2h_meta():
    """加载 20261112 棋手两两交手记录。"""
    global _H2H_CACHE
    if _H2H_CACHE is not None:
        return _H2H_CACHE
    if os.path.exists(H2H_PATH):
        with open(H2H_PATH, 'r', encoding='utf-8') as f:
            _H2H_CACHE = json.load(f)
            return _H2H_CACHE
    _H2H_CACHE = {}
    return _H2H_CACHE


def get_h2h_rate(p1_id, p2_id):
    """获取黑白双方历史交手相对胜率（黑方视角）。"""
    h2h_data = load_h2h_meta()
    if not p1_id or not p2_id or p1_id == 'unrated' or p2_id == 'unrated':
        return 0.5
    key = f'{p1_id}_{p2_id}' if p1_id < p2_id else f'{p2_id}_{p1_id}'
    item = h2h_data.get(key)
    if not item:
        return 0.5
    return item[4] if p1_id < p2_id else (1.0 - item[4])


# ---------------------------------------------------------------- GBDT 概率推断

def predict_gbdt(sample, model=None):
    """最新 20261112 模型推断三分类概率 (p_black, p_draw, p_white)。
    
    sample 维度为 14:
    [rule, r_tb, r_tw, diff, mean_r, std_tb, std_tw, joint_std,
     decayed_dr_tb, decayed_dr_tw, combined_decayed_dr, decayed_h2h_score, country_tb, country_tw]
    """
    model = model or load_gbdt_model()
    scores = [0.0, 0.0, 0.0]
    cat_maps = model.get('cat_maps', {})

    for t in model['trees']:
        cls = t['c']
        curr = t['r']
        while 'v' not in curr:
            f_idx = curr['f']
            val = sample[f_idx]
            if val is None or (isinstance(val, float) and math.isnan(val)):
                curr = curr['l'] if curr.get('dl') == 1 else curr['r']
                continue
            if 'tc' in curr:
                cat_list = cat_maps.get(str(f_idx), [])
                val_int = int(val)
                internal_idx = cat_list.index(val_int) if val_int in cat_list else -1
                if internal_idx != -1 and internal_idx in curr['tc']:
                    curr = curr['l']
                else:
                    curr = curr['r']
            else:
                if val <= curr['t']:
                    curr = curr['l']
                else:
                    curr = curr['r']
        scores[cls] += curr['v']

    max_s = max(scores)
    exp_s = [math.exp(s - max_s) for s in scores]
    sum_e = sum(exp_s)
    probs = [e / sum_e for e in exp_s]
    # 类别映射：0: 白胜, 1: 和棋, 2: 黑胜
    pw = round(probs[0] * 100, 1)
    pd = round(probs[1] * 100, 1)
    pb = round(100.0 - pw - pd, 1)
    return pb, pd, pw


# ---------------------------------------------------------------- 动态滚动 WHR 等级分

def load_initial_ratings(tid=None):
    """从源录入 JSON 中获取棋手的初始等级分 (姓名/编号 -> rating)。"""
    ratings_by_name = {}
    ratings_by_no = {}
    if not os.path.isdir(DATA_DIR):
        return ratings_by_name, ratings_by_no

    pattern = os.path.join(DATA_DIR, '*', '*.json')
    for path in sorted(glob.glob(pattern)):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except (ValueError, OSError):
            continue
        cur_tid = (data.get('tournament') or {}).get('id')
        if tid and cur_tid != tid:
            continue
        for g in data.get('games') or []:
            for key in ('black', 'white'):
                side = g.get(key) or {}
                name = side.get('name')
                no = side.get('no')
                r = side.get('rating')
                if r is not None:
                    if name:
                        ratings_by_name[name] = float(r)
                    if no is not None:
                        ratings_by_no[int(no)] = float(r)
    return ratings_by_name, ratings_by_no


def load_whr_base_games():
    """加载截止 20261112 的世界连珠对局库。"""
    global _WHR_BASE_GAMES_CACHE
    if _WHR_BASE_GAMES_CACHE is not None:
        return _WHR_BASE_GAMES_CACHE

    if os.path.exists(WHR_GAMES_PATH):
        with gzip.open(WHR_GAMES_PATH, 'rt', encoding='utf-8') as f:
            data = json.load(f)
            _WHR_BASE_GAMES_CACHE = (data['games'], data['name_to_pid'], data['pid_to_name'])
            return _WHR_BASE_GAMES_CACHE

    _WHR_BASE_GAMES_CACHE = ([], {}, {})
    return _WHR_BASE_GAMES_CACHE


def compute_whr_ratings(conn, tid, upto_round=None):
    """使用官方 whr 库动态计算指定轮次开赛前的全员 WHR 等级分与标准差。

    如果指定了 upto_round，则只纳入本赛事 round < upto_round 的已出赛果对局。
    """
    try:
        import whr
    except ImportError:
        print('！ 提示：未安装 whr 库 (pip install whr)', file=sys.stderr)
        whr = None

    base_games, name_to_pid, pid_to_name = load_whr_base_games()
    init_ratings_name, init_ratings_no = load_initial_ratings(tid)
    p_meta = load_players_meta()

    # 提取本赛事此前各轮次已完成的对局
    tour_games = []
    query = ('SELECT round, table_no, black_no, black_name, white_no, white_name, result'
             ' FROM games WHERE tournament_id=? AND result IN ("B","W","D")')
    params = [tid]
    if upto_round is not None:
        query += ' AND round < ?'
        params.append(upto_round)
    query += ' ORDER BY round, table_no'

    for g in conn.execute(query, params):
        res = g['result']
        b_name = g['black_name']
        w_name = g['white_name']
        b_id = name_to_pid.get(b_name, b_name)
        w_id = name_to_pid.get(w_name, w_name)
        day = BASE_DAY + int(g['round'])
        tour_games.append([b_id, w_id, res, day])

    ratings = {}
    if whr is not None and base_games:
        whr_base = whr.Base(config={'w2': W2, 'virtual_games': VIRTUAL_GAMES})
        all_games = base_games + tour_games
        whr_base.create_games(all_games)
        whr_base.iterate_until_converge(verbose=False)

        players = conn.execute(
            'SELECT DISTINCT black_name, white_name FROM games WHERE tournament_id=?',
            (tid,)
        ).fetchall()
        pnames = set()
        for r in players:
            pnames.add(r['black_name'])
            pnames.add(r['white_name'])

        for name in pnames:
            pid = name_to_pid.get(name)
            meta = p_meta.get(name) or {}
            r_init = init_ratings_name.get(name, meta.get('rating', BIAS))
            rd_init = meta.get('std', 80.0)

            if pid:
                hist = whr_base.ratings_for_player(pid)
                if hist:
                    latest = hist[-1]
                    ratings[name] = {
                        'rating': round(latest[1] + BIAS, 1),
                        'rd': round(latest[2], 1)
                    }
                else:
                    ratings[name] = {'rating': r_init, 'rd': rd_init}
            else:
                # 棋手未收录在 RIF 历史对局库中（如韦振强等著名棋手）
                hist = whr_base.ratings_for_player(name)
                if hist:
                    latest = hist[-1]
                    delta = (latest[1]) * (40.0 / max(latest[2], 40.0))
                    ratings[name] = {
                        'rating': round(r_init + delta, 1),
                        'rd': round(latest[2], 1)
                    }
                else:
                    ratings[name] = {'rating': r_init, 'rd': rd_init}
    else:
        players = conn.execute(
            'SELECT DISTINCT black_name, white_name FROM games WHERE tournament_id=?',
            (tid,)
        ).fetchall()
        for r in players:
            for name in (r['black_name'], r['white_name']):
                meta = p_meta.get(name) or {}
                r_init = init_ratings_name.get(name, meta.get('rating', BIAS))
                ratings[name] = {'rating': r_init, 'rd': meta.get('std', 80.0)}

    return ratings


# ---------------------------------------------------------------- 对局预测 API

def predict_games_list(games_rows, player_ratings, rule_name='塔拉山口-10', model=None):
    """根据最新 20261112 GBDT 模型推断一组对局的胜率，并判断正误标记。"""
    model = model or load_gbdt_model()
    p_meta = load_players_meta()
    rule_id = RULE_MAP.get(rule_name, 25)  # 默认塔拉山口-10 (25)

    out = []
    for g in games_rows:
        bn = g['black_name']
        wn = g['white_name']
        b_whr = player_ratings.get(bn, {'rating': BIAS, 'rd': 100.0})
        w_whr = player_ratings.get(wn, {'rating': BIAS, 'rd': 100.0})
        rb, stdb = b_whr['rating'], b_whr['rd']
        rw, stdw = w_whr['rating'], w_whr['rd']

        mb = p_meta.get(bn) or {}
        mw = p_meta.get(wn) or {}
        p1_id = mb.get('id', 'unrated')
        p2_id = mw.get('id', 'unrated')

        diff = rb - rw
        mean_r = (rb + rw) / 2.0
        j_std = math.sqrt(stdb**2 + stdw**2)
        dr_b = mb.get('decayed_draw_rate', 0.12)
        dr_w = mw.get('decayed_draw_rate', 0.12)
        comb_dr = (dr_b + dr_w) / 2.0
        h2h_rate = get_h2h_rate(p1_id, p2_id)
        c_b = mb.get('country_id', 5)
        c_w = mw.get('country_id', 5)

        # 14 维特征向量
        feat = [
            rule_id, rb, rw, diff, mean_r,
            stdb, stdw, j_std,
            dr_b, dr_w, comb_dr,
            h2h_rate, c_b, c_w
        ]
        pb, pd, pw = predict_gbdt(feat, model)

        # 预测最高项判定
        top_prob = max(pb, pd, pw)
        fav = 'B' if pb == top_prob else ('W' if pw == top_prob else 'D')
        res = g['result']
        is_correct = (fav == res) if res in ('B', 'W', 'D') else None

        out.append({
            'table': g['table_no'],
            'round': g['round'],
            'black_no': g['black_no'],
            'black_name': bn,
            'white_no': g['white_no'],
            'white_name': wn,
            'rating_black': rb,
            'rd_black': stdb,
            'rating_white': rw,
            'rd_white': stdw,
            'p_black': pb,
            'p_draw': pd,
            'p_white': pw,
            'fav': fav,
            'result': res,
            'is_correct': is_correct,
        })
    return out


def predict_round(conn, tid, rnd, write=False):
    """预测指定赛事的某一轮对局。
    
    自动利用第 1 ~ rnd-1 轮的已出赛果滚动 WHR，再使用 20261112 GBDT 模型推断概率。
    write=True 时写回 duiju.db。
    """
    model = load_gbdt_model()
    # 获取赛事规则
    tour = conn.execute('SELECT rule FROM tournaments WHERE id=?', (tid,)).fetchone()
    rule_name = (tour['rule'] if tour else None) or '塔拉山口-10'

    # 动态滚动截至第 rnd 轮开赛前的等级分
    ratings = compute_whr_ratings(conn, tid, upto_round=rnd)

    games = conn.execute(
        'SELECT round, table_no, black_no, black_name, white_no, white_name, result'
        ' FROM games WHERE tournament_id=? AND round=? ORDER BY table_no',
        (tid, rnd)
    ).fetchall()
    if not games:
        return []

    # 仅对未出赛果的台进行概率预测更新
    todo = [g for g in games if g['result'] not in ('B', 'W', 'D')]
    preds = predict_games_list(todo, ratings, rule_name=rule_name, model=model)

    if write and preds:
        for p in preds:
            conn.execute(
                'UPDATE games SET p_black=?, p_draw=?, p_white=?'
                ' WHERE tournament_id=? AND round=? AND table_no=?',
                (p['p_black'], p['p_draw'], p['p_white'], tid, rnd, p['table'])
            )
        conn.commit()

    all_preds = predict_games_list(games, ratings, rule_name=rule_name, model=model)
    return all_preds


def predict_tournament(conn, tid, write=True):
    """预测一个赛事一系列对局的完整 API。
    
    按轮次逐轮递增滚动计算前置轮次的赛果，完成所有未预测对局的概率赋值。
    """
    rounds = [r['round'] for r in conn.execute(
        'SELECT DISTINCT round FROM games WHERE tournament_id=? ORDER BY round', (tid,)
    )]
    if not rounds:
        print(f'赛事 {tid} 尚无对局数据', file=sys.stderr)
        return 0

    total_predicted = 0
    for rnd in rounds:
        unpredicted = conn.execute(
            'SELECT COUNT(*) c FROM games WHERE tournament_id=? AND round=? AND p_black IS NULL',
            (tid, rnd)
        ).fetchone()['c']
        preds = predict_round(conn, tid, rnd, write=write)
        if unpredicted > 0:
            total_predicted += len([p for p in preds if p['result'] not in ('B', 'W', 'D')])

    if write and total_predicted:
        print(f'已完成赛事 {tid} 滚动 WHR + 20261112 GBDT 预测：共更新 {total_predicted} 台概率')
    return total_predicted


# ---------------------------------------------------------------- CLI 命令行入口

def main(argv=None):
    ap = argparse.ArgumentParser(description='按官方 WHR 滚动与最新 20261112 GBDT 预测对局')
    ap.add_argument('--tid', required=True, help='赛事 id，如 2026-shanhai')
    ap.add_argument('--round', type=int, help='只算指定轮次（默认全赛事所有轮次）')
    ap.add_argument('--write', action='store_true', help='把预测概率写回 data/duiju.db')
    ap.add_argument('--db', help='数据库路径，默认 data/duiju.db')
    args = ap.parse_args(argv)

    conn = connect(args.db)
    try:
        if args.round:
            rows = predict_round(conn, args.tid, args.round, write=args.write)
            print(f'=== {args.tid} 第 {args.round} 轮预测结果 (基于 20261112 模型，共 {len(rows)} 台) ===')
            for p in rows:
                mark = '✔' if p['is_correct'] is True else ('✘' if p['is_correct'] is False else '·')
                res_str = p['result'] or '进行中'
                print(f'{mark} 第{p["table"]:2d}台  {p["black_name"]}({p["rating_black"]:.0f}) vs {p["white_name"]}({p["rating_white"]:.0f})  '
                      f'胜率: {p["p_black"]:.1f}% / {p["p_draw"]:.1f}% / {p["p_white"]:.1f}%  '
                      f'[实际: {res_str}]')
        else:
            n = predict_tournament(conn, args.tid, write=args.write)
            print(f'赛事 {args.tid} 处理完成，更新 {n} 台未预测对局')
    finally:
        conn.close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
