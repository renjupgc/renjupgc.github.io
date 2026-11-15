# -*- coding: utf-8 -*-
"""赛事对局胜率预测 API（基于统一 DB 与 8 特征 Glicko-GBDT 模型）。

核心逻辑：
1. 数据源：基于 data/duiju.db（含 RIF XML 历史库与已完赛赛事对局），
   仅使用当前赛事开始时间之前的其他赛事对局，以及本赛事轮数更小的对局。
2. 特征计算：按时间顺序单遍递推 Glicko-1 等级分（共 8 维）：
   [rule, rating_tb, rating_tw, rating_diff, base_time, increment, final_state_b, final_state_w]
3. 预测接口：支持按 (赛事, 轮次, 台次) 或整轮预测，模型为 bisai/data/model_glicko_20261113.json。

用法：
    python tools/predict_api.py --tid 2026-shanhai --round 8
    python tools/predict_api.py --tid 2026-shanhai --round 8 --write
"""

import argparse
import csv
from datetime import datetime, timezone, timedelta
import hashlib
import json
import math
import os
import pickle
import sqlite3
import sys
import tempfile

TZ = timezone(timedelta(hours=8))

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(ROOT, 'data', 'duiju.db')
ALL_GAMES_CSV_PATH = os.path.join(ROOT, 'data', 'all_games.csv')
MODEL_PATH = os.path.join(ROOT, 'bisai', 'data', 'model_glicko_20261113.json')
if not os.path.exists(MODEL_PATH):
    MODEL_PATH = os.path.join(ROOT, 'bisai', 'data', 'model.json')

# Glicko-1 胜负等级分常数
GLICKO_Q = math.log(10.0) / 400.0
GLICKO_Q2 = GLICKO_Q * GLICKO_Q
GLICKO_THREE_Q2_OVER_PI2 = 3.0 * GLICKO_Q2 / (math.pi * math.pi)
GLICKO_INIT_RATING = 2000.0
GLICKO_INIT_RD = 350.0
GLICKO_MIN_RD = 30.0
GLICKO_MAX_RD = 350.0
GLICKO_C2_PER_DAY = 100.0

# Glicko 式和棋倾向常数（基准和棋率 0.12）
GLICKO_BASE_DRAW_P = 0.12
GLICKO_D_BASE = 400.0 * math.log10(GLICKO_BASE_DRAW_P / (1.0 - GLICKO_BASE_DRAW_P))
GLICKO_D_INIT_RD = 250.0
GLICKO_D_MIN_RD = 35.0
GLICKO_D_MAX_RD = 250.0
GLICKO_D_C2_PER_DAY = 50.0

BASE_DAY = 20771  # 2026-11-14

RULE_MAP = {
    '塔拉山口-10': 25,
    'Taraguchi-10': 25,
    't10': 25,
    '索索夫-8': 22,
    'Soosyrv-8': 22,
    'RIF': 1,
}

_MODEL_CACHE = None
_CSV_GAMES_CACHE = {}
_CONTEXT_CACHE = {}
_INCREMENTAL_GLICKO_STATE = {}  # (csv_path, csv_sig, tid) -> (last_upto_round, rating, rd_map, last_day, d_rating, d_rd_map, d_last_day)


def now_str():
    return datetime.now(TZ).strftime('%Y-%m-%d %H:%M:%S')


def get_effective_result(res):
    """把 BF/WF 映射为等效对局胜方（BF 黑弃权=白胜 W，WF 白弃权=黑胜 B）。"""
    if res in ('B', 'WF'):
        return 'B'
    if res in ('W', 'BF'):
        return 'W'
    if res == 'D':
        return 'D'
    return None


def connect(path=None):
    conn = sqlite3.connect(path or DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


# ---------------------------------------------------------------- 模型加载与推断

def load_gbdt_model():
    """加载 Glicko-GBDT 决策树模型。"""
    global _MODEL_CACHE
    if _MODEL_CACHE is not None:
        return _MODEL_CACHE
    if not os.path.exists(MODEL_PATH):
        raise FileNotFoundError(f'未找到模型文件: {MODEL_PATH}')
    with open(MODEL_PATH, 'r', encoding='utf-8') as f:
        _MODEL_CACHE = json.load(f)
    return _MODEL_CACHE


def predict_gbdt(sample, model=None):
    """GBDT 三分类概率推断 (p_black, p_draw, p_white)。"""
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


# ---------------------------------------------------------------- CSV 加载与 Glicko 特征计算

def _csv_lite_cache_path(path):
    key = hashlib.md5(os.path.abspath(path).encode('utf-8')).hexdigest()[:12]
    return os.path.join(tempfile.gettempdir(), f'renjupgc_all_games_lite_v4_{key}.pkl')


def load_all_games_csv(csv_path=None):
    """加载统一对局数据（默认从 data/duiju.db 读取，也可指定 CSV 路径）。"""
    path = csv_path or DB_PATH
    if str(path).endswith('.db'):
        if not os.path.exists(path):
            raise FileNotFoundError(f'未找到数据库文件: {path}')
        conn = sqlite3.connect(path)
        name_to_pid = {}
        games = []
        sql = """
            SELECT g.tournament_id, t.name, g.round, g.black_id, g.black_name,
                   g.white_id, g.white_name, g.result, g.day
            FROM games g
            LEFT JOIN tournaments t ON t.id = g.tournament_id
            WHERE g.result IN ('B', 'W', 'D') AND g.day > 0
            ORDER BY g.day, g.round, g.id
        """
        for tid, tname, rnd_raw, bid_raw, bn, wid_raw, wn, res, day in conn.execute(sql):
            b_id = bid_raw or bn
            w_id = wid_raw or wn
            if not b_id or not w_id or b_id == w_id:
                continue
            rnd = int(rnd_raw) if rnd_raw and int(rnd_raw) > 0 else None
            games.append((tid, rnd, b_id, w_id, res, int(day), tname or ''))
            if bn and b_id and bn not in name_to_pid:
                name_to_pid[bn] = b_id
            if wn and w_id and wn not in name_to_pid:
                name_to_pid[wn] = w_id
        conn.close()
        return games, name_to_pid

    if not os.path.exists(path):
        raise FileNotFoundError(f'未找到统一对局 CSV 文件: {path}，请先运行 tools/export_games_csv.py')

    st = os.stat(path)
    sig = (st.st_mtime_ns, st.st_size)
    cached = _CSV_GAMES_CACHE.get(path)
    if cached is not None and cached[0] == sig:
        return cached[1]

    pkl_path = _csv_lite_cache_path(path)
    if os.path.exists(pkl_path):
        try:
            with open(pkl_path, 'rb') as pf:
                pkl_sig, result = pickle.load(pf)
            if pkl_sig == sig:
                _CSV_GAMES_CACHE[path] = (sig, result)
                return result
        except Exception:
            pass

    name_to_pid = {}
    indexed_games = []
    with open(path, 'r', encoding='utf-8', newline='') as f:
        reader = csv.reader(f)
        header = next(reader, None)
        if not header:
            result = ([], name_to_pid)
            _CSV_GAMES_CACHE[path] = (sig, result)
            return result
        col_idx = {name: i for i, name in enumerate(header)}
        i_tid = col_idx['tournament_id']
        i_tname = col_idx.get('tournament_name')
        i_rnd = col_idx['round']
        i_bid = col_idx['black_id']
        i_bn = col_idx['black_name']
        i_wid = col_idx['white_id']
        i_wn = col_idx['white_name']
        i_res = col_idx['result']
        i_day = col_idx['day']

        for row_idx, row in enumerate(reader):
            res = row[i_res]
            if res not in ('B', 'W', 'D'):
                continue
            b_name = row[i_bn]
            w_name = row[i_wn]
            b_id = row[i_bid] or b_name
            w_id = row[i_wid] or w_name
            if not b_id or not w_id or b_id == w_id:
                continue
            try:
                day = int(float(row[i_day] or 0))
            except ValueError:
                day = 0
            if day <= 0:
                continue
            r_raw = row[i_rnd]
            rnd = int(r_raw) if r_raw.isdigit() else None
            tid = row[i_tid]
            tname = row[i_tname] if i_tname is not None else ''
            indexed_games.append((day, rnd or 0, row_idx, (tid, rnd, b_id, w_id, res, day, tname)))
            if b_name and b_id and b_name not in name_to_pid:
                name_to_pid[b_name] = b_id
            if w_name and w_id and w_name not in name_to_pid:
                name_to_pid[w_name] = w_id

    indexed_games.sort(key=lambda x: (x[0], x[1], x[2]))
    games = [x[3] for x in indexed_games]
    result = (games, name_to_pid)
    _CSV_GAMES_CACHE[path] = (sig, result)
    try:
        with open(pkl_path, 'wb') as pf:
            pickle.dump((sig, result), pf, protocol=pickle.HIGHEST_PROTOCOL)
    except Exception:
        pass
    return result


def _glicko_g(rd):
    return 1.0 / math.sqrt(1.0 + GLICKO_THREE_Q2_OVER_PI2 * rd * rd)


def _glicko_pre(rating, rd_map, last_day, pid, day):
    r = rating.get(pid, GLICKO_INIT_RATING)
    rd = rd_map.get(pid, GLICKO_INIT_RD)
    ld = last_day.get(pid)
    if ld is not None and day > ld:
        rd = min(GLICKO_MAX_RD, math.sqrt(rd * rd + GLICKO_C2_PER_DAY * (day - ld)))
    return r, rd


def _glicko_step(rating, rd_map, last_day, day, b_id, w_id, res):
    rb, rdb = _glicko_pre(rating, rd_map, last_day, b_id, day)
    rw, rdw = _glicko_pre(rating, rd_map, last_day, w_id, day)
    gb = _glicko_g(rdb)
    gw = _glicko_g(rdw)
    eb = 1.0 / (1.0 + 10.0 ** (-gw * (rb - rw) / 400.0))
    ew = 1.0 / (1.0 + 10.0 ** (-gb * (rw - rb) / 400.0))
    sb = 1.0 if res == 'B' else (0.5 if res == 'D' else 0.0)
    sw = 1.0 - sb
    db = 1.0 / (rdb * rdb) + GLICKO_Q2 * gw * gw * eb * (1.0 - eb)
    dw = 1.0 / (rdw * rdw) + GLICKO_Q2 * gb * gb * ew * (1.0 - ew)
    rating[b_id] = rb + (GLICKO_Q / db) * gw * (sb - eb)
    rd_map[b_id] = max(GLICKO_MIN_RD, math.sqrt(1.0 / db))
    last_day[b_id] = day
    rating[w_id] = rw + (GLICKO_Q / dw) * gb * (sw - ew)
    rd_map[w_id] = max(GLICKO_MIN_RD, math.sqrt(1.0 / dw))
    last_day[w_id] = day


def _glicko_draw_pre(d_rating, d_rd_map, d_last_day, pid, day):
    d = d_rating.get(pid, 0.0)
    rd = d_rd_map.get(pid, GLICKO_D_INIT_RD)
    ld = d_last_day.get(pid)
    if ld is not None and day > ld:
        rd = min(GLICKO_D_MAX_RD, math.sqrt(rd * rd + GLICKO_D_C2_PER_DAY * (day - ld)))
    return d, rd


def _glicko_draw_to_prob(d):
    return 1.0 / (1.0 + 10.0 ** (-(GLICKO_D_BASE + d) / 400.0))


def _glicko_draw_step(d_rating, d_rd_map, d_last_day, day, b_id, w_id, res):
    db_r, db_rd = _glicko_draw_pre(d_rating, d_rd_map, d_last_day, b_id, day)
    dw_r, dw_rd = _glicko_draw_pre(d_rating, d_rd_map, d_last_day, w_id, day)
    g_db = _glicko_g(db_rd)
    g_dw = _glicko_g(dw_rd)
    ed_b = 1.0 / (1.0 + 10.0 ** (-g_dw * (GLICKO_D_BASE + db_r + dw_r) / 400.0))
    ed_w = 1.0 / (1.0 + 10.0 ** (-g_db * (GLICKO_D_BASE + db_r + dw_r) / 400.0))
    sd = 1.0 if res == 'D' else 0.0
    den_b = 1.0 / (db_rd * db_rd) + GLICKO_Q2 * g_dw * g_dw * ed_b * (1.0 - ed_b)
    den_w = 1.0 / (dw_rd * dw_rd) + GLICKO_Q2 * g_db * g_db * ed_w * (1.0 - ed_w)
    d_rating[b_id] = db_r + (GLICKO_Q / den_b) * g_dw * (sd - ed_b)
    d_rd_map[b_id] = max(GLICKO_D_MIN_RD, math.sqrt(1.0 / den_b))
    d_last_day[b_id] = day
    d_rating[w_id] = dw_r + (GLICKO_Q / den_w) * g_db * (sd - ed_w)
    d_rd_map[w_id] = max(GLICKO_D_MIN_RD, math.sqrt(1.0 / den_w))
    d_last_day[w_id] = day


def compute_context_from_csv(tid=None, upto_round=None, csv_path=None):
    """基于统一 CSV 计算 Glicko-1 等级分/RD 与 Glicko 式双方和棋倾向。

    若指定了 tid：仅使用本次赛事开始时间之前（g_day < t_start_day）的历史对局，
    以及本次赛事轮数更小（同赛事且 g_rnd < upto_round）的对局。
    """
    resolved_csv = csv_path or ALL_GAMES_CSV_PATH
    cache_key = (resolved_csv, tid, upto_round)
    if cache_key in _CONTEXT_CACHE:
        return _CONTEXT_CACHE[cache_key]

    csv_games, name_to_pid = load_all_games_csv(resolved_csv)

    tour_name = None
    if tid and os.path.exists(DB_PATH):
        try:
            _conn = sqlite3.connect(DB_PATH)
            _row = _conn.execute('SELECT name FROM tournaments WHERE id=?', (tid,)).fetchone()
            if _row:
                tour_name = _row[0]
            _conn.close()
        except Exception:
            pass

    def _is_same_tour(g_tid, g_tname):
        if not tid:
            return False
        return g_tid == tid or (bool(tour_name) and g_tname == tour_name)

    tid_days = [g[5] for g in csv_games if tid and _is_same_tour(g[0], g[6]) and g[5] > 0]
    if tid_days:
        t_day = min(tid_days)
    elif csv_games:
        max_csv_day = max((g[5] for g in csv_games if g[5] > 0), default=BASE_DAY)
        t_day = (max_csv_day + 1) if tid else max_csv_day
    else:
        t_day = BASE_DAY

    st = os.stat(resolved_csv)
    csv_sig = (st.st_mtime_ns, st.st_size)
    inc_key = (resolved_csv, csv_sig, tid)
    inc_state = _INCREMENTAL_GLICKO_STATE.get(inc_key)

    if (
        inc_state is not None
        and upto_round is not None
        and inc_state[0] is not None
        and upto_round > inc_state[0]
    ):
        last_rnd, rating, rd_map, last_day, d_rating, d_rd_map, d_last_day = inc_state
        for g_tid, g_rnd, b_id, w_id, res, g_day, g_tname in csv_games:
            if _is_same_tour(g_tid, g_tname) and g_rnd is not None and last_rnd <= g_rnd < upto_round:
                _glicko_step(rating, rd_map, last_day, g_day, b_id, w_id, res)
                _glicko_draw_step(d_rating, d_rd_map, d_last_day, g_day, b_id, w_id, res)
        _INCREMENTAL_GLICKO_STATE[inc_key] = (upto_round, rating, rd_map, last_day, d_rating, d_rd_map, d_last_day)
    else:
        rating, rd_map, last_day = {}, {}, {}
        d_rating, d_rd_map, d_last_day = {}, {}, {}
        for g_tid, g_rnd, b_id, w_id, res, g_day, g_tname in csv_games:
            if tid:
                if _is_same_tour(g_tid, g_tname):
                    if upto_round is not None and (g_rnd is None or g_rnd >= upto_round):
                        continue
                elif g_day >= t_day:
                    continue
            elif g_day > t_day:
                continue
            _glicko_step(rating, rd_map, last_day, g_day, b_id, w_id, res)
            _glicko_draw_step(d_rating, d_rd_map, d_last_day, g_day, b_id, w_id, res)
        if tid is not None and upto_round is not None:
            _INCREMENTAL_GLICKO_STATE[inc_key] = (upto_round, rating, rd_map, last_day, d_rating, d_rd_map, d_last_day)

    pred_day = t_day + (max(0, (upto_round - 1) // 2) if upto_round else 0)
    glicko_snapshot = {}
    for pid in set(rating.keys()) | set(rd_map.keys()):
        r_val, rd_val = _glicko_pre(rating, rd_map, last_day, pid, pred_day)
        glicko_snapshot[pid] = (r_val, rd_val)

    glicko_dr_snapshot = {
        pid: _glicko_draw_to_prob(d_val)
        for pid, d_val in d_rating.items()
    }

    ctx = {
        'glicko_snapshot': glicko_snapshot,
        'glicko_dr_snapshot': glicko_dr_snapshot,
        'name_to_pid': name_to_pid,
    }
    _CONTEXT_CACHE[cache_key] = ctx
    return ctx


def get_player_rating(ctx, name):
    """查询棋手最新 Glicko 等级分与标准差 (RD)。"""
    snap = ctx.get('glicko_snapshot')
    if not snap or not name or name == '轮空':
        return {'rating': GLICKO_INIT_RATING, 'rd': GLICKO_INIT_RD}
    pid = ctx['name_to_pid'].get(name, name)
    pair = snap.get(pid)
    if pair is not None:
        return {'rating': round(pair[0], 1), 'rd': round(pair[1], 1)}
    return {'rating': GLICKO_INIT_RATING, 'rd': GLICKO_INIT_RD}


# ---------------------------------------------------------------- 对局预测 API

def get_tournament_meta(conn, tid):
    """从 duiju.db tournaments 表读取赛事规则、总轮数与时限。"""
    row = conn.execute('SELECT * FROM tournaments WHERE id=?', (tid,)).fetchone()
    if not row:
        return '塔拉山口-10', None, None, None
    keys = row.keys()
    rule_name = row['rule'] or '塔拉山口-10'
    total_rounds = row['total_rounds'] if 'total_rounds' in keys else None
    base_time = row['base_time'] if 'base_time' in keys else None
    increment = row['increment'] if 'increment' in keys else None
    return rule_name, total_rounds, base_time, increment


def compute_final_states_map(conn, tid, rnd, games_rows, total_rounds=None):
    """计算每台的末轮双方状态 (final_state_b, final_state_w):
    0: 非最后一轮, 1: 争胜, 2: 保和, 3: 稳冠, 4: 无冠。"""
    if not total_rounds or rnd != total_rounds:
        return {}

    from collections import defaultdict
    pts = defaultdict(float)
    prev_rows = conn.execute(
        'SELECT black_name, white_name, result FROM games WHERE tournament_id=? AND round < ?',
        (tid, rnd)
    ).fetchall()
    for r in prev_rows:
        eff = get_effective_result(r['result'])
        bn, wn = r['black_name'], r['white_name']
        if eff == 'B':
            if bn != '轮空':
                pts[bn] += 1.0
        elif eff == 'W':
            if wn != '轮空':
                pts[wn] += 1.0
        elif eff == 'D':
            if bn != '轮空':
                pts[bn] += 0.5
            if wn != '轮空':
                pts[wn] += 0.5

    final_rows = conn.execute(
        'SELECT black_name, white_name FROM games WHERE tournament_id=? AND round=?',
        (tid, rnd)
    ).fetchall()
    in_final = {
        nm for r in final_rows for nm in (r['black_name'], r['white_name']) if nm and nm != '轮空'
    }

    out = {}
    for g in games_rows:
        b, w = g['black_name'], g['white_name']
        if b == '轮空' or w == '轮空':
            out[g['table_no']] = (4, 4)
            continue
        states = []
        for p, opp in ((b, w), (w, b)):
            other_max = max((pts[q] + 1.0 for q in in_final if q != p and q != opp), default=-1.0)
            max_if_lose = max(other_max, pts[opp] + 1.0)
            max_if_draw = max(other_max, pts[opp] + 0.5)
            min_other_if_win = pts[opp]
            for fr in final_rows:
                u, v = fr['black_name'], fr['white_name']
                if (u == b and v == w) or (u == w and v == b):
                    continue
                if u == '轮空' or v == '轮空':
                    solo = v if u == '轮空' else u
                    if solo and pts[solo] > min_other_if_win:
                        min_other_if_win = pts[solo]
                    continue
                pair_min_max = min(
                    max(pts[u] + 1.0, pts[v]),
                    max(pts[u], pts[v] + 1.0),
                    max(pts[u], pts[v]) + 0.5,
                )
                if pair_min_max > min_other_if_win:
                    min_other_if_win = pair_min_max
            if pts[p] > max_if_lose:
                states.append(3)
            elif pts[p] + 0.5 > max_if_draw:
                states.append(2)
            elif pts[p] + 1.0 < min_other_if_win:
                states.append(4)
            else:
                states.append(1)
        out[g['table_no']] = (states[0], states[1])
    return out


def predict_games_list(games_rows, ctx, rule_name='塔拉山口-10', model=None, base_time=None, increment=None, final_states_map=None):
    """基于 8 特征 Glicko-GBDT 模型推断一组对局的胜率。"""
    model = model or load_gbdt_model()
    rule_id = RULE_MAP.get(rule_name, 25)
    glicko_dr_map = ctx.get('glicko_dr_snapshot') or {}
    name_to_pid = ctx['name_to_pid']

    out = []
    for g in games_rows:
        bn = g['black_name']
        wn = g['white_name']

        if wn == '轮空' or bn == '轮空':
            b_g = get_player_rating(ctx, bn) if bn != '轮空' else {'rating': 0.0, 'rd': 0.0}
            w_g = get_player_rating(ctx, wn) if wn != '轮空' else {'rating': 0.0, 'rd': 0.0}
            out.append({
                'table': g['table_no'],
                'round': g['round'],
                'black_no': g['black_no'],
                'black_name': bn,
                'white_no': g['white_no'],
                'white_name': wn,
                'rating_black': b_g['rating'],
                'rd_black': b_g['rd'],
                'rating_white': w_g['rating'],
                'rd_white': w_g['rd'],
                'dr_black': 0.0,
                'dr_white': 0.0,
                'p_black': None,
                'p_draw': None,
                'p_white': None,
                'fav': None,
                'result': g['result'],
                'is_correct': None,
            })
            continue

        b_g = get_player_rating(ctx, bn)
        w_g = get_player_rating(ctx, wn)
        rb, stdb = b_g['rating'], b_g['rd']
        rw, stdw = w_g['rating'], w_g['rd']

        p1_id = name_to_pid.get(bn, bn)
        p2_id = name_to_pid.get(wn, wn)
        gdr_b = glicko_dr_map.get(p1_id, GLICKO_BASE_DRAW_P)
        gdr_w = glicko_dr_map.get(p2_id, GLICKO_BASE_DRAW_P)

        sb, sw = (final_states_map or {}).get(g['table_no'], (0, 0))
        feat = [rule_id, rb, rw, rb - rw, base_time, increment, sb, sw]
        pb, pd, pw = predict_gbdt(feat, model)

        top_prob = max(pb, pd, pw)
        fav = 'B' if pb == top_prob else ('W' if pw == top_prob else 'D')
        res = g['result']
        eff_res = get_effective_result(res)
        is_correct = (fav == eff_res) if eff_res else None

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
            'dr_black': round(gdr_b, 4),
            'dr_white': round(gdr_w, 4),
            'p_black': pb,
            'p_draw': pd,
            'p_white': pw,
            'fav': fav,
            'result': res,
            'is_correct': is_correct,
        })
    return out


# ---------------------------------------------------------------- 模型评估 API

def compute_metrics_for_games(games_rows):
    """计算一组有赛果对局的评估指标 (Accuracy, Brier, LogLoss, Confidence, 分类命中明细)。"""
    n = hit = 0
    brier = logloss = conf = 0.0
    classes = {'B': 0, 'D': 0, 'W': 0}
    hit_by_class = {'B': 0, 'D': 0, 'W': 0}
    fav_counts = {'B': 0, 'D': 0, 'W': 0}

    for g in games_rows:
        if g.get('black_name') == '轮空' or g.get('white_name') == '轮空':
            continue
        res = g.get('result')
        if not res or g.get('p_black') is None:
            continue
        eff_res = get_effective_result(res)
        if not eff_res:
            continue
        pb = g['p_black'] / 100.0
        pd = g['p_draw'] / 100.0
        pw = g['p_white'] / 100.0
        p = {'B': pb, 'D': pd, 'W': pw}

        top = max(p, key=lambda k: p[k])
        n += 1
        classes[eff_res] += 1
        fav_counts[top] += 1
        if top == eff_res:
            hit += 1
            hit_by_class[eff_res] += 1
        brier += sum((p[k] - (1.0 if k == eff_res else 0.0)) ** 2 for k in p)
        logloss -= math.log(max(p[eff_res], 1e-9))
        conf += p[top]

    if n == 0:
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
        'fav_distribution': fav_counts
    }


def evaluate_tournament_model(conn, tid, write=True, print_report=True):
    """自动评估当前模型在指定赛事的整体及逐轮实战表现，并自动写回 metrics.json。"""
    tour = conn.execute('SELECT * FROM tournaments WHERE id=?', (tid,)).fetchone()
    if not tour:
        return None
    slug = tour['slug']

    rounds = [r['round'] for r in conn.execute(
        'SELECT DISTINCT round FROM games WHERE tournament_id=? ORDER BY round', (tid,)
    )]

    rounds_stats = []
    pooled_rows = []
    for rnd in rounds:
        rows = conn.execute(
            'SELECT * FROM games WHERE tournament_id=? AND round=? ORDER BY table_no',
            (tid, rnd)
        ).fetchall()
        rows_dict = [dict(r) for r in rows]
        stat = compute_metrics_for_games(rows_dict)
        if stat:
            stat['round'] = rnd
            rounds_stats.append(stat)
            pooled_rows.extend([
                r for r in rows_dict
                if get_effective_result(r['result']) is not None and r['p_black'] is not None
            ])

    if not rounds_stats:
        if print_report:
            print(f'赛事 {tid} 尚无已出赛果的已预测对局，暂无评估样本。')
        return None

    overall = compute_metrics_for_games(pooled_rows)
    model_name = os.path.basename(MODEL_PATH).replace('.json', '')

    payload = {
        'tournament': {
            'id': tour['id'],
            'slug': tour['slug'],
            'name': tour['name'],
            'year': tour['year'],
            'group': tour['group_name'],
            'rule': tour['rule'],
        },
        'model': model_name,
        'evaluated_at': now_str(),
        'rounds': rounds_stats,
        'overall': overall,
    }

    if write:
        out_dir = os.path.join(ROOT, 'api', 'duiju', slug)
        os.makedirs(out_dir, exist_ok=True)
        m_file = os.path.join(out_dir, 'metrics.json')
        with open(m_file, 'w', encoding='utf-8') as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)

        bisai_m_file = os.path.join(ROOT, 'bisai', 'data', 'metrics.json')
        with open(bisai_m_file, 'w', encoding='utf-8') as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)

    if print_report:
        print('=' * 68)
        print(f'📊 模型实战评估看板 ({tour["name"]} | 当前评估模型: {model_name})')
        print('=' * 68)
        ov = overall
        acc_pct = ov['accuracy'] * 100
        print(f'总完赛台数: {ov["n"]} 台 | 命中: {ov["hit"]} 台 | 命中率: {acc_pct:.2f}%')
        print(f'对数损失 (Log-Loss): {ov["logloss"]:.4f} | Brier 校准误差: {ov["brier"]:.4f} | 平均置信度: {ov["confidence"]*100:.2f}%')
        print('【分项命中率】')
        for res_k, name_k in [('B', '黑胜'), ('W', '白胜'), ('D', '和棋')]:
            tot_c = ov['results'].get(res_k, 0)
            hit_c = ov['hit_by_result'].get(res_k, 0)
            rate_c = (hit_c / tot_c * 100) if tot_c > 0 else 0.0
            print(f'  - {name_k} ({res_k}): 实际 {tot_c:2d} 局，命中 {hit_c:2d} 局 ({rate_c:5.1f}%)')
        print('-' * 68)
        for r_stat in rounds_stats:
            print(f'  第 {r_stat["round"]} 轮: 完赛 {r_stat["n"]} 台，命中 {r_stat["hit"]} 台 ({r_stat["accuracy"]*100:.1f}%) | '
                  f'LogLoss {r_stat["logloss"]:.4f} | Brier {r_stat["brier"]:.4f}')
        if write:
            print(f'✔ 最新评估指标已自动同步持久化至: api/duiju/{slug}/metrics.json')
        print('=' * 68)

    return payload


def predict_round(conn, tid, rnd, write=False, overwrite=False, csv_path=None):
    """预测指定赛事的某一轮对局。"""
    model = load_gbdt_model()
    rule_name, total_rounds, base_time, increment = get_tournament_meta(conn, tid)

    ctx = compute_context_from_csv(tid=tid, upto_round=rnd, csv_path=csv_path)

    games = conn.execute(
        'SELECT round, table_no, black_no, black_name, white_no, white_name, result'
        ' FROM games WHERE tournament_id=? AND round=? ORDER BY table_no',
        (tid, rnd)
    ).fetchall()
    if not games:
        return []

    todo = games if overwrite else [g for g in games if g['result'] not in ('B', 'W', 'D')]
    final_states_map = compute_final_states_map(conn, tid, rnd, games, total_rounds=total_rounds)
    preds = predict_games_list(todo, ctx, rule_name=rule_name, model=model, base_time=base_time, increment=increment, final_states_map=final_states_map)

    if write and preds:
        for p in preds:
            conn.execute(
                'UPDATE games SET p_black=?, p_draw=?, p_white=?'
                ' WHERE tournament_id=? AND round=? AND table_no=?',
                (p['p_black'], p['p_draw'], p['p_white'], tid, rnd, p['table'])
            )
        model_name = os.path.basename(MODEL_PATH).replace('.json', '')
        now = now_str()
        conn.execute(
            'UPDATE rounds SET model=?, predicted_at=?, updated_at=?'
            ' WHERE tournament_id=? AND round=?',
            (model_name, now, now, tid, rnd)
        )
        conn.commit()
        evaluate_tournament_model(conn, tid, write=True, print_report=False)

    return predict_games_list(games, ctx, rule_name=rule_name, model=model, base_time=base_time, increment=increment, final_states_map=final_states_map)


def predict_game(conn, tid, rnd, table, write=False, overwrite=False, csv_path=None):
    """按 (赛事, 轮次, 台次) 预测单台对局的 API 接口。"""
    model = load_gbdt_model()
    rule_name, total_rounds, base_time, increment = get_tournament_meta(conn, tid)

    row = conn.execute(
        'SELECT round, table_no, black_no, black_name, white_no, white_name, result'
        ' FROM games WHERE tournament_id=? AND round=? AND table_no=?',
        (tid, rnd, table)
    ).fetchone()
    if not row:
        return None

    ctx = compute_context_from_csv(tid=tid, upto_round=rnd, csv_path=csv_path)
    final_states_map = compute_final_states_map(conn, tid, rnd, [row], total_rounds=total_rounds)
    preds = predict_games_list([row], ctx, rule_name=rule_name, model=model, base_time=base_time, increment=increment, final_states_map=final_states_map)
    p = preds[0] if preds else None

    if write and p and (overwrite or row['result'] not in ('B', 'W', 'D')):
        conn.execute(
            'UPDATE games SET p_black=?, p_draw=?, p_white=?'
            ' WHERE tournament_id=? AND round=? AND table_no=?',
            (p['p_black'], p['p_draw'], p['p_white'], tid, rnd, p['table'])
        )
        conn.commit()

    return p


def predict_by_table(tid, rnd, table, write=False, overwrite=False, db_path=None, csv_path=None):
    """独立预测 API：输入 (赛事 id, 轮次, 台次)，返回单台预测结果字典。"""
    conn = connect(db_path)
    try:
        return predict_game(conn, tid, rnd, table, write=write, overwrite=overwrite, csv_path=csv_path)
    finally:
        conn.close()


def predict_tournament(conn, tid, write=True, overwrite=False, csv_path=None):
    """预测一个赛事所有轮次对局的完整 API。"""
    rounds = [r['round'] for r in conn.execute(
        'SELECT DISTINCT round FROM games WHERE tournament_id=? ORDER BY round', (tid,)
    )]
    if not rounds:
        print(f'赛事 {tid} 尚无对局数据', file=sys.stderr)
        return 0

    total_predicted = 0
    for rnd in rounds:
        if overwrite:
            preds = predict_round(conn, tid, rnd, write=write, overwrite=True, csv_path=csv_path)
            total_predicted += len(preds)
        else:
            unpredicted = conn.execute(
                'SELECT COUNT(*) c FROM games WHERE tournament_id=? AND round=? AND p_black IS NULL',
                (tid, rnd)
            ).fetchone()['c']
            preds = predict_round(conn, tid, rnd, write=write, overwrite=False, csv_path=csv_path)
            if unpredicted > 0:
                total_predicted += len([p for p in preds if p['result'] not in ('B', 'W', 'D')])

    if write:
        if total_predicted:
            print(f'已完成赛事 {tid} 预测（基于统一 CSV）：共更新 {total_predicted} 台概率')
        evaluate_tournament_model(conn, tid, write=True, print_report=True)

    return total_predicted


# ---------------------------------------------------------------- CLI 命令行入口

def main(argv=None):
    ap = argparse.ArgumentParser(description='基于统一 CSV 与 6 特征 Glicko-GBDT 模型的赛事/轮次/台次预测 API')
    ap.add_argument('--tid', required=True, help='赛事 id，如 2026-shanhai')
    ap.add_argument('--round', type=int, help='指定轮次（默认全赛事所有轮次）')
    ap.add_argument('--table', type=int, help='指定台次（需同时指定 --round）')
    ap.add_argument('--csv', help='统一对局 CSV 路径，默认 data/all_games.csv')
    ap.add_argument('--write', action='store_true', help='把预测概率写回 data/duiju.db')
    ap.add_argument('--overwrite', action='store_true', help='强制覆盖已有预测概率（即使已有赛果或旧概率）')
    ap.add_argument('--eval', '--evaluate', action='store_true', dest='evaluate', help='自动评估当前模型在指定赛事的实战表现')
    ap.add_argument('--db', help='数据库路径，默认 data/duiju.db')
    args = ap.parse_args(argv)

    if args.table is not None and not args.round:
        ap.error('指定 --table 时必须同时指定 --round')

    conn = connect(args.db)
    try:
        if args.evaluate:
            evaluate_tournament_model(conn, args.tid, write=args.write, print_report=True)
            return 0

        if args.round and args.table is not None:
            p = predict_game(conn, args.tid, args.round, args.table,
                             write=args.write, overwrite=args.overwrite, csv_path=args.csv)
            if not p:
                print(f'未找到 {args.tid} 第 {args.round} 轮第 {args.table} 台', file=sys.stderr)
                return 1
            print(json.dumps(p, ensure_ascii=False, indent=2))
        elif args.round:
            rows = predict_round(conn, args.tid, args.round,
                                 write=args.write, overwrite=args.overwrite, csv_path=args.csv)
            print(f'=== {args.tid} 第 {args.round} 轮预测结果 (基于 Glicko-GBDT 6特征，共 {len(rows)} 台) ===')
            for p in rows:
                mark = '✔' if p['is_correct'] is True else ('✘' if p['is_correct'] is False else '·')
                res_str = p['result'] or '进行中'
                if p['p_black'] is None:
                    print(f'· 第{p["table"]:2d}台  {p["black_name"]} vs {p["white_name"]}  [轮空免测]  [实际: {res_str}]')
                else:
                    print(f'{mark} 第{p["table"]:2d}台  {p["black_name"]}({p["rating_black"]:.0f}) vs {p["white_name"]}({p["rating_white"]:.0f})  '
                          f'胜率: {p["p_black"]:.1f}% / {p["p_draw"]:.1f}% / {p["p_white"]:.1f}%  '
                          f'[和棋倾向: {p["dr_black"]:.3f}/{p["dr_white"]:.3f}]  '
                          f'[实际: {res_str}]')
            if args.write:
                evaluate_tournament_model(conn, args.tid, write=True, print_report=True)
        else:
            n = predict_tournament(conn, args.tid, write=args.write, overwrite=args.overwrite, csv_path=args.csv)
            print(f'赛事 {args.tid} 处理完成，更新 {n} 台未预测对局')
    finally:
        conn.close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
