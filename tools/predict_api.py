# -*- coding: utf-8 -*-
"""赛事对局胜率预测 API（完全基于统一 CSV 与 20261113 GBDT 模型）。

核心逻辑：
1. 数据源：完全基于 data/all_games.csv（含 RIF XML 历史库与已完赛赛事对局），
   不再读取 duiju.db 历史对局，也不做额外姓名重映射。
2. 特征计算：直接从 CSV 计算全量 WHR 等级分与标准差、时间衰减和棋率、衰减 H2H 与国籍属性（共 14 维）。
3. 预测接口：支持按 (赛事, 轮次, 台次) 或整轮预测，模型为 bisai/data/model_20261113.json。

用法：
    python tools/predict_api.py --tid 2026-shanhai --round 6 --table 1
    python tools/predict_api.py --tid 2026-shanhai --round 6 --write
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

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(ROOT, 'data', 'duiju.db')
ALL_GAMES_CSV_PATH = os.path.join(ROOT, 'data', 'all_games.csv')
MODEL_PATH = os.path.join(ROOT, 'bisai', 'data', 'model_20261113.json')
if not os.path.exists(MODEL_PATH):
    MODEL_PATH = os.path.join(ROOT, 'bisai', 'data', 'model.json')

# WHR 官方基准常数：比赛日期 2026-11-14，对应的天数为 (date(2026, 11, 14) - date(1970, 1, 1)).days = 20771
W2 = 19.3
VIRTUAL_GAMES = 2
BIAS = 1900.0
BASE_DAY = 20771  # 比赛日期 2026-11-14
TAU = 730.0  # 衰减半衰尺度（天）

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
_CSV_GAMES_CACHE = {}
_CONTEXT_CACHE = {}
_INCREMENTAL_WHR_STATE = {}  # (csv_path, tid) -> (last_upto_round, whr_base)


def connect(path=None):
    conn = sqlite3.connect(path or DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


# ---------------------------------------------------------------- 加载 20261113 模型

def load_gbdt_model():
    """加载截止 20261113 的最新 GBDT 决策树模型。"""
    global _MODEL_CACHE
    if _MODEL_CACHE is not None:
        return _MODEL_CACHE
    if not os.path.exists(MODEL_PATH):
        raise FileNotFoundError(f'未找到最新模型文件: {MODEL_PATH}')
    with open(MODEL_PATH, 'r', encoding='utf-8') as f:
        _MODEL_CACHE = json.load(f)
    return _MODEL_CACHE


# ---------------------------------------------------------------- GBDT 概率推断

def predict_gbdt(sample, model=None):
    """最新 20261113 模型推断三分类概率 (p_black, p_draw, p_white)。
    
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


def _csv_lite_cache_path(path):
    key = hashlib.md5(os.path.abspath(path).encode('utf-8')).hexdigest()[:12]
    return os.path.join(tempfile.gettempdir(), f'renjupgc_all_games_lite_{key}.pkl')


def load_all_games_csv(csv_path=None):
    """加载统一对局 CSV（跳过 moves 列并启用轻量缓存）。"""
    path = csv_path or ALL_GAMES_CSV_PATH
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

    games = []
    name_to_pid = {}
    pid_to_country = {}
    with open(path, 'r', encoding='utf-8', newline='') as f:
        reader = csv.reader(f)
        header = next(reader, None)
        if not header:
            result = (games, name_to_pid, pid_to_country)
            _CSV_GAMES_CACHE[path] = (sig, result)
            return result
        col_idx = {name: i for i, name in enumerate(header)}
        i_tid = col_idx['tournament_id']
        i_rnd = col_idx['round']
        i_bid = col_idx['black_id']
        i_bn = col_idx['black_name']
        i_bc = col_idx['black_country']
        i_wid = col_idx['white_id']
        i_wn = col_idx['white_name']
        i_wc = col_idx['white_country']
        i_res = col_idx['result']
        i_day = col_idx['day']

        for row in reader:
            res = row[i_res]
            if res not in ('B', 'W', 'D'):
                continue
            b_name = row[i_bn]
            w_name = row[i_wn]
            b_id = row[i_bid] or b_name
            w_id = row[i_wid] or w_name
            if not b_id or not w_id:
                continue
            try:
                day = int(float(row[i_day] or 0))
            except ValueError:
                day = 0
            r_raw = row[i_rnd]
            rnd = int(r_raw) if r_raw.isdigit() else None
            tid = row[i_tid]
            games.append((tid, rnd, b_id, w_id, res, day, b_name, w_name))
            if b_name and b_id and b_name not in name_to_pid:
                name_to_pid[b_name] = b_id
            if w_name and w_id and w_name not in name_to_pid:
                name_to_pid[w_name] = w_id
            for pid, c_raw in ((b_id, row[i_bc]), (w_id, row[i_wc])):
                if pid and c_raw:
                    try:
                        pid_to_country[pid] = int(c_raw)
                    except ValueError:
                        pass

    result = (games, name_to_pid, pid_to_country)
    _CSV_GAMES_CACHE[path] = (sig, result)
    try:
        with open(pkl_path, 'wb') as pf:
            pickle.dump((sig, result), pf, protocol=pickle.HIGHEST_PROTOCOL)
    except Exception:
        pass
    return result


def compute_context_from_csv(tid=None, upto_round=None, csv_path=None):
    """完全基于统一 CSV 计算 WHR 等级分/RD、衰减和棋率、衰减 H2H 与国籍映射。

    不读取 duiju.db，不做额外姓名重映射。
    若指定了 upto_round，则过滤掉 CSV 中同赛事 round >= upto_round 的记录。
    """
    resolved_csv = csv_path or ALL_GAMES_CSV_PATH
    cache_key = (resolved_csv, tid, upto_round)
    if cache_key in _CONTEXT_CACHE:
        return _CONTEXT_CACHE[cache_key]

    try:
        import whr
    except ImportError:
        print('！ 提示：未安装 whr 库 (pip install whr)', file=sys.stderr)
        whr = None

    csv_games, name_to_pid, pid_to_country = load_all_games_csv(resolved_csv)

    # 基准日期取 CSV 中该赛事日期或全局最新日期（默认 BASE_DAY）
    t_day = BASE_DAY
    tid_days = [g[5] for g in csv_games if tid and g[0] == tid and g[5] > 0]
    if tid_days:
        t_day = max(tid_days)
    elif csv_games:
        t_day = max((g[5] for g in csv_games if g[5] > 0), default=BASE_DAY)

    whr_input = []
    dr_acc = {}   # pid -> [w_sum, d_sum]
    h2h_acc = {}  # (p1, p2) -> [w_sum, s_first_sum]

    for g_tid, g_rnd, b_id, w_id, res, g_day, _, _ in csv_games:
        if g_day > t_day:
            continue
        if upto_round is not None and g_tid == tid and g_rnd is not None and g_rnd >= upto_round:
            continue
        whr_input.append([b_id, w_id, res, g_day])

        # 时间衰减权重
        w = math.exp(-max(0, t_day - g_day) / TAU)

        # 衰减和棋率累计
        d_val = w if res == 'D' else 0.0
        for pid in (b_id, w_id):
            acc = dr_acc.get(pid)
            if acc is None:
                dr_acc[pid] = [w, d_val]
            else:
                acc[0] += w
                acc[1] += d_val

        # 衰减 H2H 累计（按字典序较小者视角）
        if b_id <= w_id:
            pair = (b_id, w_id)
            s_first = w if res == 'B' else (0.5 * w if res == 'D' else 0.0)
        else:
            pair = (w_id, b_id)
            s_first = w if res == 'W' else (0.5 * w if res == 'D' else 0.0)
        p_acc = h2h_acc.get(pair)
        if p_acc is None:
            h2h_acc[pair] = [w, s_first]
        else:
            p_acc[0] += w
            p_acc[1] += s_first

    whr_base = None
    if whr is not None and whr_input:
        st = os.stat(resolved_csv)
        csv_sig = (st.st_mtime_ns, st.st_size)
        inc_key = (resolved_csv, csv_sig, tid)
        inc_state = _INCREMENTAL_WHR_STATE.get(inc_key)
        if (
            inc_state is not None
            and upto_round is not None
            and inc_state[0] is not None
            and upto_round > inc_state[0]
        ):
            last_rnd, whr_base = inc_state
            delta_games = [
                [b_id, w_id, res, g_day]
                for g_tid, g_rnd, b_id, w_id, res, g_day, _, _ in csv_games
                if g_day <= t_day and g_tid == tid and g_rnd is not None and last_rnd <= g_rnd < upto_round
            ]
            if delta_games:
                whr_base.create_games(delta_games)
                whr_base.iterate_until_converge(verbose=False)
            # 清除旧轮次缓存，避免外部拿到已被就地增量更新的 whr_base
            for k in [k for k in _CONTEXT_CACHE if k[0] == resolved_csv and k[1] == tid and k[2] != upto_round]:
                _CONTEXT_CACHE.pop(k, None)
            _INCREMENTAL_WHR_STATE[inc_key] = (upto_round, whr_base)
        else:
            whr_base = whr.Base(config={'w2': W2, 'virtual_games': VIRTUAL_GAMES})
            whr_base.create_games(whr_input)
            whr_base.iterate_until_converge(verbose=False)
            if tid is not None and upto_round is not None:
                _INCREMENTAL_WHR_STATE[inc_key] = (upto_round, whr_base)

    # 汇总衰减和棋率映射
    dr_map = {
        pid: (d_sum / w_sum) if w_sum > 2.0 else 0.12
        for pid, (w_sum, d_sum) in dr_acc.items()
    }

    # 汇总衰减 H2H 映射
    h2h_map = {
        pair: (0.5 + s_sum) / (1.0 + w_sum)
        for pair, (w_sum, s_sum) in h2h_acc.items()
    }

    ctx = {
        'whr_base': whr_base,
        'dr_map': dr_map,
        'h2h_map': h2h_map,
        'name_to_pid': name_to_pid,
        'pid_to_country': pid_to_country,
    }
    _CONTEXT_CACHE[cache_key] = ctx
    return ctx


def get_player_rating(ctx, name):
    """直接从 WHR 模型中查询棋手最新等级分与标准差。"""
    whr_base = ctx.get('whr_base')
    if whr_base is None or not name or name == '轮空':
        return {'rating': BIAS, 'rd': 100.0}
    pid = ctx['name_to_pid'].get(name, name)
    hist = whr_base.ratings_for_player(pid)
    if hist:
        latest = hist[-1]
        return {'rating': round(latest[1] + BIAS, 1), 'rd': round(latest[2], 1)}
    return {'rating': BIAS, 'rd': 100.0}


# ---------------------------------------------------------------- 对局预测 API

def predict_games_list(games_rows, ctx, rule_name='塔拉山口-10', model=None):
    """完全基于 CSV 上下文与 20261113 GBDT 模型推断一组对局的胜率。"""
    model = model or load_gbdt_model()
    rule_id = RULE_MAP.get(rule_name, 25)  # 默认塔拉山口-10 (25)

    dr_map = ctx['dr_map']
    h2h_map = ctx['h2h_map']
    name_to_pid = ctx['name_to_pid']
    pid_to_country = ctx['pid_to_country']

    out = []
    for g in games_rows:
        bn = g['black_name']
        wn = g['white_name']

        # 轮空台不参与预测，也不算做预测内
        if wn == '轮空' or bn == '轮空':
            b_whr = get_player_rating(ctx, bn) if bn != '轮空' else {'rating': 0.0, 'rd': 0.0}
            w_whr = get_player_rating(ctx, wn) if wn != '轮空' else {'rating': 0.0, 'rd': 0.0}
            out.append({
                'table': g['table_no'],
                'round': g['round'],
                'black_no': g['black_no'],
                'black_name': bn,
                'white_no': g['white_no'],
                'white_name': wn,
                'rating_black': b_whr['rating'],
                'rd_black': b_whr['rd'],
                'rating_white': w_whr['rating'],
                'rd_white': w_whr['rd'],
                'dr_black': 0.0,
                'dr_white': 0.0,
                'h2h_score': 0.5,
                'p_black': None,
                'p_draw': None,
                'p_white': None,
                'fav': None,
                'result': g['result'],
                'is_correct': None,
            })
            continue

        b_whr = get_player_rating(ctx, bn)
        w_whr = get_player_rating(ctx, wn)
        rb, stdb = b_whr['rating'], b_whr['rd']
        rw, stdw = w_whr['rating'], w_whr['rd']

        p1_id = name_to_pid.get(bn, bn)
        p2_id = name_to_pid.get(wn, wn)

        diff = rb - rw
        mean_r = (rb + rw) / 2.0
        j_std = math.sqrt(stdb**2 + stdw**2)

        dr_b = dr_map.get(p1_id, 0.12)
        dr_w = dr_map.get(p2_id, 0.12)
        comb_dr = (dr_b + dr_w) / 2.0

        if p1_id <= p2_id:
            h2h_rate = h2h_map.get((p1_id, p2_id), 0.5)
        else:
            h2h_rate = 1.0 - h2h_map.get((p2_id, p1_id), 0.5)

        c_b = pid_to_country.get(p1_id, 5)
        c_w = pid_to_country.get(p2_id, 5)

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
            'dr_black': round(dr_b, 4),
            'dr_white': round(dr_w, 4),
            'h2h_score': round(h2h_rate, 4),
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
    """自动评估当前/最新模型在指定赛事的整体及逐轮实战表现，并自动写回 metrics.json。"""
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
        print("=" * 68)
        print(f"📊 模型实战评估看板 ({tour['name']} | 当前评估模型: {model_name})")
        print("=" * 68)
        ov = overall
        acc_pct = ov['accuracy'] * 100
        print(f"总完赛台数: {ov['n']} 台 | 命中: {ov['hit']} 台 | 命中率: {acc_pct:.2f}%")
        print(f"对数损失 (Log-Loss): {ov['logloss']:.4f} | Brier 校准误差: {ov['brier']:.4f} | 平均置信度: {ov['confidence']*100:.2f}%")
        print("【分项命中率】")
        for res_k, name_k in [('B', '黑胜'), ('W', '白胜'), ('D', '和棋')]:
            tot_c = ov['results'].get(res_k, 0)
            hit_c = ov['hit_by_result'].get(res_k, 0)
            rate_c = (hit_c / tot_c * 100) if tot_c > 0 else 0.0
            print(f"  - {name_k} ({res_k}): 实际 {tot_c:2d} 局，命中 {hit_c:2d} 局 ({rate_c:5.1f}%)")
        print("-" * 68)
        for r_stat in rounds_stats:
            print(f"  第 {r_stat['round']} 轮: 完赛 {r_stat['n']} 台，命中 {r_stat['hit']} 台 ({r_stat['accuracy']*100:.1f}%) | "
                  f"LogLoss {r_stat['logloss']:.4f} | Brier {r_stat['brier']:.4f}")
        if write:
            print(f"✔ 最新评估指标已自动同步持久化至: api/duiju/{slug}/metrics.json")
        print("=" * 68)

    return payload


def predict_round(conn, tid, rnd, write=False, overwrite=False, csv_path=None):
    """预测指定赛事的某一轮对局。

    直接从统一 CSV（含 RIF XML 历史对局与已完赛的本赛事前序对局）计算 WHR、衰减和棋率与 H2H，
    再使用 20261113 GBDT 模型推断概率。
    write=True 时写回 duiju.db。
    overwrite=True 时强制覆盖已有概率（即使已有赛果或旧概率）。
    """
    model = load_gbdt_model()
    tour = conn.execute('SELECT rule FROM tournaments WHERE id=?', (tid,)).fetchone()
    rule_name = (tour['rule'] if tour else None) or '塔拉山口-10'

    ctx = compute_context_from_csv(tid=tid, upto_round=rnd, csv_path=csv_path)

    games = conn.execute(
        'SELECT round, table_no, black_no, black_name, white_no, white_name, result'
        ' FROM games WHERE tournament_id=? AND round=? ORDER BY table_no',
        (tid, rnd)
    ).fetchall()
    if not games:
        return []

    if overwrite:
        todo = games
    else:
        todo = [g for g in games if g['result'] not in ('B', 'W', 'D')]

    preds = predict_games_list(todo, ctx, rule_name=rule_name, model=model)

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

    all_preds = predict_games_list(games, ctx, rule_name=rule_name, model=model)
    return all_preds


def predict_game(conn, tid, rnd, table, write=False, overwrite=False, csv_path=None):
    """按 (赛事, 轮次, 台次) 预测单台对局的 API 接口。"""
    model = load_gbdt_model()
    tour = conn.execute('SELECT rule FROM tournaments WHERE id=?', (tid,)).fetchone()
    rule_name = (tour['rule'] if tour else None) or '塔拉山口-10'

    row = conn.execute(
        'SELECT round, table_no, black_no, black_name, white_no, white_name, result'
        ' FROM games WHERE tournament_id=? AND round=? AND table_no=?',
        (tid, rnd, table)
    ).fetchone()
    if not row:
        return None

    ctx = compute_context_from_csv(tid=tid, upto_round=rnd, csv_path=csv_path)
    preds = predict_games_list([row], ctx, rule_name=rule_name, model=model)
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
    """预测一个赛事一系列对局的完整 API。"""
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
            print(f'已完成赛事 {tid} 全特征预测（基于统一 CSV）：共更新 {total_predicted} 台概率')
        evaluate_tournament_model(conn, tid, write=True, print_report=True)

    return total_predicted


# ---------------------------------------------------------------- CLI 命令行入口

def main(argv=None):
    ap = argparse.ArgumentParser(description='基于统一 CSV 与 20261113 GBDT 模型的赛事/轮次/台次预测 API')
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
            print(f'=== {args.tid} 第 {args.round} 轮预测结果 (基于最新模型，共 {len(rows)} 台) ===')
            for p in rows:
                mark = '✔' if p['is_correct'] is True else ('✘' if p['is_correct'] is False else '·')
                res_str = p['result'] or '进行中'
                if p['p_black'] is None:
                    print(f'· 第{p["table"]:2d}台  {p["black_name"]} vs {p["white_name"]}  [轮空免测]  [实际: {res_str}]')
                else:
                    print(f'{mark} 第{p["table"]:2d}台  {p["black_name"]}({p["rating_black"]:.0f}) vs {p["white_name"]}({p["rating_white"]:.0f})  '
                          f'胜率: {p["p_black"]:.1f}% / {p["p_draw"]:.1f}% / {p["p_white"]:.1f}%  '
                          f'[和棋率: {p["dr_black"]:.3f}/{p["dr_white"]:.3f}, H2H: {p["h2h_score"]:.2f}]  '
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
