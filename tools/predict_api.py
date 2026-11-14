# -*- coding: utf-8 -*-
"""赛事对局胜率预测 API。

本模块提供针对一个赛事（如 2026-shanhai）一系列对局的官方 WHR 动态滚动与 GBDT 预测接口。

核心逻辑：
1. 采用官方 whr 库（whr.Base，w2=19.3，virtual_games=2）进行全历史等级分计算。
2. 预测第 R 轮时，自动提取本赛事第 1 ~ R-1 轮已出结果的实际对局（胜/平/负），
   加入 WHR 训练集进行收敛拟合，动态更新棋手在开赛前的最新等级分（rating）与不确定度（rd）。
3. 结合官方 CatBoost / GBDT 树模型（bisai/data/model_20260704.json）精准输出黑胜、和棋、白胜概率。
4. 对赛果已出的对局自动标注预测正误（最高概率方与实际赛果一致为正确 ✔，否则为错误 ✘）。

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
MODEL_PATH = os.path.join(ROOT, 'bisai', 'data', 'model_20260704.json')

# WHR 官方基准常数
W2 = 19.3
VIRTUAL_GAMES = 2
BIAS = 1900.0
BASE_DAY = 20710

# 全局缓存模型，避免每次重复读取解析
_MODEL_CACHE = None
_WHR_BASE_GAMES_CACHE = None


def connect(path=None):
    conn = sqlite3.connect(path or DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


# ---------------------------------------------------------------- GBDT 模型加载与推断

def load_gbdt_model():
    """加载官方 GBDT 决策树模型（model_20260704.json）。"""
    global _MODEL_CACHE
    if _MODEL_CACHE is not None:
        return _MODEL_CACHE
    if not os.path.exists(MODEL_PATH):
        raise FileNotFoundError(f'未找到 GBDT 模型文件: {MODEL_PATH}')
    with open(MODEL_PATH, 'r', encoding='utf-8') as f:
        _MODEL_CACHE = json.load(f)
    return _MODEL_CACHE


def predict_gbdt(sample, model=None):
    """根据 14 维特征 sample 计算三分类概率 (p_black, p_draw, p_white)。
    
    sample: [22, rb, rw, diff, mean_r, stdb, stdw, j_std, dr_b, dr_w, comb_dr, h2h, c_b_id, c_w_id]
    """
    model = model or load_gbdt_model()
    trees = model['trees']
    cat_maps = model['cat_maps']

    scores = [0.0, 0.0, 0.0]
    for i, curr in enumerate(trees):
        cls = i % 3
        node = curr['r'] if 'r' in curr and 'f' in curr['r'] else curr
        while 'v' not in node:
            f_idx = node['f']
            val = sample[f_idx]
            if val is None or (isinstance(val, float) and math.isnan(val)):
                node = node['l'] if node.get('dl') == 1 else node['r']
                continue
            if 'tc' in node:
                cat_list = cat_maps.get(str(f_idx), [])
                internal_idx = cat_list.index(int(val)) if int(val) in cat_list else -1
                if internal_idx != -1 and internal_idx in node['tc']:
                    node = node['l']
                else:
                    node = node['r']
            else:
                if val <= node['t']:
                    node = node['l']
                else:
                    node = node['r']
        scores[cls] += node['v']

    max_s = max(scores)
    exp_s = [math.exp(s - max_s) for s in scores]
    sum_e = sum(exp_s)
    probs = [e / sum_e for e in exp_s]
    # GBDT 输出中：0: 白胜, 1: 和棋, 2: 黑胜
    pw = round(probs[0] * 100, 1)
    pd = round(probs[1] * 100, 1)
    pb = round(100.0 - pw - pd, 1)
    return pb, pd, pw


# ---------------------------------------------------------------- 基础等级分与历史对局

def load_initial_ratings(tid=None):
    """从源录入 JSON 中获取棋手的初始等级分 (编号/姓名 -> rating)。"""
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
    """加载压缩的世界连珠对局库（data/whr_games.json.gz）。"""
    global _WHR_BASE_GAMES_CACHE
    if _WHR_BASE_GAMES_CACHE is not None:
        return _WHR_BASE_GAMES_CACHE

    if os.path.exists(WHR_GAMES_PATH):
        with gzip.open(WHR_GAMES_PATH, 'rt', encoding='utf-8') as f:
            data = json.load(f)
            _WHR_BASE_GAMES_CACHE = (data['games'], data['name_to_pid'], data['pid_to_name'])
            return _WHR_BASE_GAMES_CACHE

    # 若未找到打包文件，退回空底库
    _WHR_BASE_GAMES_CACHE = ([], {}, {})
    return _WHR_BASE_GAMES_CACHE


# ---------------------------------------------------------------- 动态 WHR 计算核心

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
        # 统一映射到 WHR 内部 ID
        b_id = name_to_pid.get(b_name, b_name)
        w_id = name_to_pid.get(w_name, w_name)
        day = BASE_DAY + int(g['round'])
        tour_games.append([b_id, w_id, res, day])

    ratings = {}
    if whr is not None and base_games:
        # 使用官方 WHR Base 进行收敛拟合
        whr_base = whr.Base(config={'w2': W2, 'virtual_games': VIRTUAL_GAMES})
        all_games = base_games + tour_games
        whr_base.create_games(all_games)
        whr_base.iterate_until_converge(verbose=False)

        # 获取赛事中出现的所有棋手
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
            r_init = init_ratings_name.get(name, BIAS)
            if pid:
                hist = whr_base.ratings_for_player(pid)
                if hist:
                    latest = hist[-1]
                    ratings[name] = {
                        'rating': round(latest[1] + BIAS, 1),
                        'rd': round(latest[2], 1)
                    }
                else:
                    ratings[name] = {'rating': r_init, 'rd': 80.0}
            else:
                # 棋手未收录在 RIF 历史对局库中（如著名棋手韦振强等）
                # 以其录入初始分为基准，叠加本赛事实际赛果带来的 WHR 增量
                hist = whr_base.ratings_for_player(name)
                if hist:
                    latest = hist[-1]
                    delta = (latest[1]) * (40.0 / max(latest[2], 40.0))
                    ratings[name] = {
                        'rating': round(r_init + delta, 1),
                        'rd': round(latest[2], 1)
                    }
                else:
                    ratings[name] = {'rating': r_init, 'rd': 100.0}
    else:
        # 降级模式（无 whr 库时保持初始等级分）
        players = conn.execute(
            'SELECT DISTINCT black_name, white_name FROM games WHERE tournament_id=?',
            (tid,)
        ).fetchall()
        for r in players:
            for name in (r['black_name'], r['white_name']):
                r0 = init_ratings_name.get(name, BIAS)
                ratings[name] = {'rating': r0, 'rd': 80.0}

    return ratings


# ---------------------------------------------------------------- 胜率预测与单轮/全赛事 API

def predict_games_list(games_rows, player_ratings, model=None):
    """对一组对局计算黑胜/和棋/白胜预测概率，并判断正误标记。"""
    model = model or load_gbdt_model()
    out = []
    for g in games_rows:
        bn = g['black_name']
        wn = g['white_name']
        b_info = player_ratings.get(bn, {'rating': BIAS, 'rd': 100.0})
        w_info = player_ratings.get(wn, {'rating': BIAS, 'rd': 100.0})
        rb, stdb = b_info['rating'], b_info['rd']
        rw, stdw = w_info['rating'], w_info['rd']

        diff = rb - rw
        mean_r = (rb + rw) / 2.0
        j_std = math.sqrt(stdb**2 + stdw**2)
        dr_b, dr_w = 0.08, 0.08
        comb_dr = (dr_b + dr_w) / 2.0
        # 14 维特征向量
        feat = [22, rb, rw, diff, mean_r, stdb, stdw, j_std, dr_b, dr_w, comb_dr, 0.5, 5, 5]
        pb, pd, pw = predict_gbdt(feat, model)

        # 胜负预测与正误判定
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
    """预测指定赛事的某一个轮次。
    
    自动纳入该赛事第 1 ~ rnd-1 轮的全部已出赛果进行 WHR 滚动计算。
    write=True 时写回 duiju.db（已有赛果的台保持既有预测或更新未出结果的台）。
    """
    model = load_gbdt_model()
    # 动态滚动计算截至第 rnd 轮开赛前的等级分
    ratings = compute_whr_ratings(conn, tid, upto_round=rnd)

    games = conn.execute(
        'SELECT round, table_no, black_no, black_name, white_no, white_name, result'
        ' FROM games WHERE tournament_id=? AND round=? ORDER BY table_no',
        (tid, rnd)
    ).fetchall()
    if not games:
        return []

    # 仅对未出赛果的台进行预测更新（已出赛果的台概率定死锁定）
    todo = [g for g in games if g['result'] not in ('B', 'W', 'D')]
    preds = predict_games_list(todo, ratings, model)

    if write and preds:
        for p in preds:
            conn.execute(
                'UPDATE games SET p_black=?, p_draw=?, p_white=?'
                ' WHERE tournament_id=? AND round=? AND table_no=?',
                (p['p_black'], p['p_draw'], p['p_white'], tid, rnd, p['table'])
            )
        conn.commit()

    # 返回本轮全部对局的最新评估信息
    all_preds = predict_games_list(games, ratings, model)
    return all_preds


def predict_tournament(conn, tid, write=True):
    """预测一个赛事一系列对局的完整 API。
    
    按轮次递增（Round 1, Round 2, ...）依次处理：
    预测第 R 轮时，前面第 1 ~ R-1 轮的已出赛果自动参与 WHR 滚动计算。
    """
    rounds = [r['round'] for r in conn.execute(
        'SELECT DISTINCT round FROM games WHERE tournament_id=? ORDER BY round', (tid,)
    )]
    if not rounds:
        print(f'赛事 {tid} 尚无对局数据', file=sys.stderr)
        return 0

    total_predicted = 0
    for rnd in rounds:
        # 检查本轮是否有待预测的台
        unpredicted = conn.execute(
            'SELECT COUNT(*) c FROM games WHERE tournament_id=? AND round=? AND p_black IS NULL',
            (tid, rnd)
        ).fetchone()['c']
        # 始终用前序各轮赛果重新校准 WHR
        preds = predict_round(conn, tid, rnd, write=write)
        if unpredicted > 0:
            total_predicted += len([p for p in preds if p['result'] not in ('B', 'W', 'D')])

    if write and total_predicted:
        print(f'已完成赛事 {tid} 滚动 WHR 预测：共更新 {total_predicted} 台概率')
    return total_predicted


# ---------------------------------------------------------------- CLI 命令行入口

def main(argv=None):
    ap = argparse.ArgumentParser(description='按官方 WHR 滚动等级分与 GBDT 预测赛事对局')
    ap.add_argument('--tid', required=True, help='赛事 id，如 2026-shanhai')
    ap.add_argument('--round', type=int, help='只算指定轮次（默认全赛事所有轮次）')
    ap.add_argument('--write', action='store_true', help='把预测概率写回 data/duiju.db')
    ap.add_argument('--db', help='数据库路径，默认 data/duiju.db')
    args = ap.parse_args(argv)

    conn = connect(args.db)
    try:
        if args.round:
            rows = predict_round(conn, args.tid, args.round, write=args.write)
            print(f'=== {args.tid} 第 {args.round} 轮预测结果 (共 {len(rows)} 台) ===')
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
