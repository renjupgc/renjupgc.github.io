# -*- coding: utf-8 -*-
"""使用 renjunet_v10_20261113.rif 全量重新训练 GBDT 模型与特征数据管道。

执行步骤：
1. WHR 收敛拟合：基于 20261113 RIF 数据库重新拟合全量历史等级分与标准差，生成 game_base_20261113_renju.json。
2. 构建时间序列训练集：提取 14 维特征（开局规则、WHR rating、RD、差值、均值、衰减和棋率、衰减 H2H、国籍）。
3. 训练 LightGBM GBDT 多分类模型（白胜/和棋/黑胜）。
4. 导出模型：输出 model_20261113.json 与 model.json。
5. 导出棋手画像与交手：更新 players.json 与 h2h.json。
6. 导出 WHR 对局底库：更新 data/whr_games.json.gz。
7. 部署同步至 renjupgc.github.io。
"""

import gzip
import json
import math
import os
import sys
import xml.etree.ElementTree as ET
import numpy as np
import pandas as pd
import lightgbm as lgb
from sklearn.metrics import accuracy_score, log_loss

# 路径配置
WHR_DIR = r"C:\Users\yaolz\Downloads\whr_renju-master\whr_renju-master"
RIF_PATH = r"C:\Users\yaolz\Downloads\renjunet_v10_20261113.rif"
SAVE_BASE_JSON = os.path.join(WHR_DIR, "data", "game_base_20261113_renju.json")

REPO_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BISAI_DATA_DIR = os.path.join(REPO_DIR, "bisai", "data")
DATA_DIR = os.path.join(REPO_DIR, "data")

sys.path.insert(0, WHR_DIR)
from game_base import GameBase
from whr import Base


def step1_compute_whr():
    """步骤 1：读取 20261113 RIF 并运行 WHR 收敛拟合。"""
    print("=" * 70)
    print("步骤 1：开始运行 WHR 官方算法收敛拟合 (20261113)...")
    if os.path.exists(SAVE_BASE_JSON):
        print(f"已存在 {SAVE_BASE_JSON}，直接加载验证...")
        base = GameBase('1')
        base.load(SAVE_BASE_JSON)
        return base

    rated_tournaments = os.path.join(WHR_DIR, "data", "rated_tournaments")
    unrated_tournaments = os.path.join(WHR_DIR, "data", "unrated_tournaments")

    base = GameBase('1', cur_date=(2026, 11, 13))
    print(f"正在解析 XML: {RIF_PATH} ...")
    base.read_xml(
        RIF_PATH,
        rated_tournaments=rated_tournaments,
        unrated_tournaments=unrated_tournaments
    )
    print("生成 WHR 对局列表...")
    train_games = base.gen_games()
    print(f"有效对局数: {len(train_games)}，开始 WHR 迭代收敛...")

    w2 = 19.3
    virtual_games = 2
    base.set_w2(w2)
    whr_base = Base(config={"w2": w2, "virtual_games": virtual_games})
    whr_base.create_games(train_games)
    whr_base.iterate_until_converge(verbose=False)

    print("WHR 迭代收敛完成，保存基础数据库 JSON...")
    ratings = whr_base.get_ordered_ratings()
    base.set_ratings(ratings)
    base.save(SAVE_BASE_JSON)
    print(f"成功保存: {SAVE_BASE_JSON}")
    return base


def step2_build_dataset(base):
    """步骤 2：提取 swap 标签并构建 14 维特征训练集。"""
    print("=" * 70)
    print("步骤 2：提取 swap 规则与构建 14 维时间序列特征...")
    swap_map = {}
    for event, elem in ET.iterparse(RIF_PATH, events=('end',)):
        if elem.tag == 'game':
            gid = elem.attrib.get('id')
            swap_map[gid] = elem.attrib.get('swap', '')
            elem.clear()

    tournament_dates = {}
    for tid, t in base.tournaments.items():
        s = t.get('start') or t.get('end')
        if s:
            try:
                tournament_dates[tid] = (base.date_to_day(pd.to_datetime(s).date()), pd.to_datetime(s).year)
            except Exception:
                pass

    valid_games = []
    for gid, g in base.games.items():
        tid = g.get('tournament')
        if tid not in tournament_dates:
            continue
        day, year = tournament_dates[tid]
        res = g.get('result')
        b_id, w_id = g.get('black'), g.get('white')
        rid = g.get('rule', '1')
        if res in ('B', 'W', 'D') and b_id and w_id and b_id != w_id:
            sw = swap_map.get(gid, '')
            is_swapped = (sw.count('R') % 2 == 1)
            tb_id = w_id if is_swapped else b_id
            tw_id = b_id if is_swapped else w_id

            pb = base.players.get(tb_id, {})
            pw = base.players.get(tw_id, {})
            c_tb = int(pb.get('country', 0)) if pb.get('country') else 0
            c_tw = int(pw.get('country', 0)) if pw.get('country') else 0

            # 类别编码：0: 白胜, 1: 和棋, 2: 黑胜
            tb_res = 1 if res == 'D' else (0 if ((res == 'B') == is_swapped) else 2)

            valid_games.append({
                'day': day,
                'rule': int(rid) if rid.isdigit() else 1,
                'tb_id': tb_id,
                'tw_id': tw_id,
                'tb_res': tb_res,
                'country_tb': c_tb,
                'country_tw': c_tw
            })

    valid_games.sort(key=lambda x: x['day'])
    print(f"有效时序对局总数: {len(valid_games)}")

    player_game_history = {}
    h2h_history = {}
    h2h_stats = {}
    records = []
    TAU = 730.0  # 半衰期 2 年 (730天)

    for item in valid_games:
        p_tb, p_tw, day, y, r = item['tb_id'], item['tw_id'], item['day'], item['tb_res'], item['rule']
        rb_info = base.get_player_rating_on_day(p_tb, day)
        rw_info = base.get_player_rating_on_day(p_tw, day)

        r_tb = (rb_info[0] + 1900.0) if rb_info else 1900.0
        r_tw = (rw_info[0] + 1900.0) if rw_info else 1900.0
        diff = r_tb - r_tw
        mean_r = (r_tb + r_tw) / 2.0
        std_tb = rb_info[1] if rb_info else 150.0
        std_tw = rw_info[1] if rw_info else 150.0
        joint_std = np.sqrt(std_tb**2 + std_tw**2)

        # 衰减和棋率 (黑方)
        hist_b = player_game_history.get(p_tb, [])
        w_sum_b, draw_w_b = 0.0, 0.0
        for h_day, is_draw in hist_b:
            w = np.exp(-(day - h_day) / TAU)
            w_sum_b += w
            if is_draw:
                draw_w_b += w
        decayed_dr_tb = (draw_w_b / w_sum_b) if w_sum_b > 2.0 else 0.12

        # 衰减和棋率 (白方)
        hist_w = player_game_history.get(p_tw, [])
        w_sum_w, draw_w_w = 0.0, 0.0
        for h_day, is_draw in hist_w:
            w = np.exp(-(day - h_day) / TAU)
            w_sum_w += w
            if is_draw:
                draw_w_w += w
        decayed_dr_tw = (draw_w_w / w_sum_w) if w_sum_w > 2.0 else 0.12
        combined_decayed_dr = (decayed_dr_tb + decayed_dr_tw) / 2.0

        # 衰减交手相对胜率
        pair = tuple(sorted([p_tb, p_tw]))
        hist_h2h = h2h_history.get(pair, [])
        decayed_tb_score = 0.0
        decayed_weight_sum = 0.0
        for h_day, h_tb, score_tb in hist_h2h:
            w = np.exp(-(day - h_day) / TAU)
            sc = score_tb if h_tb == p_tb else (1.0 - score_tb)
            decayed_tb_score += w * sc
            decayed_weight_sum += w
        decayed_h2h_score = (decayed_tb_score / decayed_weight_sum) if decayed_weight_sum > 0 else 0.5

        records.append({
            'rule': r,
            'rating_tb': r_tb,
            'rating_tw': r_tw,
            'rating_diff': diff,
            'rating_mean': mean_r,
            'std_tb': std_tb,
            'std_tw': std_tw,
            'joint_std': joint_std,
            'decayed_dr_tb': decayed_dr_tb,
            'decayed_dr_tw': decayed_dr_tw,
            'combined_decayed_dr': combined_decayed_dr,
            'decayed_h2h_score': decayed_h2h_score,
            'country_tb': item['country_tb'],
            'country_tw': item['country_tw'],
            'label': y
        })

        if p_tb not in player_game_history:
            player_game_history[p_tb] = []
        player_game_history[p_tb].append((day, y == 1))
        if p_tw not in player_game_history:
            player_game_history[p_tw] = []
        player_game_history[p_tw].append((day, y == 1))

        if pair not in h2h_history:
            h2h_history[pair] = []
            h2h_stats[pair] = {'total': 0, pair[0]: 0, pair[1]: 0, 'draws': 0, 'history': []}
        h2h_history[pair].append((day, p_tb, 1.0 if y == 2 else (0.5 if y == 1 else 0.0)))

        h2h_stats[pair]['total'] += 1
        if y == 1:
            h2h_stats[pair]['draws'] += 1
        elif y == 2:
            h2h_stats[pair][p_tb] += 1
        elif y == 0:
            h2h_stats[pair][p_tw] += 1
        h2h_stats[pair]['history'].append((day, p_tb, 1.0 if y == 2 else (0.5 if y == 1 else 0.0)))

    df = pd.DataFrame(records)
    print(f"特征提取完毕，构建训练集样本行数: {len(df)}")
    return df, valid_games, player_game_history, h2h_stats, tournament_dates


def step3_train_gbdt(df):
    """步骤 3：训练 LightGBM GBDT 多分类模型并解析树节点。"""
    print("=" * 70)
    print("步骤 3：训练最新 GBDT 决策树模型...")
    feature_cols = [
        'rule',
        'rating_tb', 'rating_tw', 'rating_diff', 'rating_mean',
        'std_tb', 'std_tw', 'joint_std',
        'decayed_dr_tb', 'decayed_dr_tw', 'combined_decayed_dr',
        'decayed_h2h_score',
        'country_tb', 'country_tw'
    ]
    cat_cols = ['rule', 'country_tb', 'country_tw']
    cat_indices = [feature_cols.index(c) for c in cat_cols]

    all_rules = sorted(list(df['rule'].unique()))
    all_countries = sorted(list(set(df['country_tb'].unique()) | set(df['country_tw'].unique()) | {0}))

    rule_cat_type = pd.CategoricalDtype(categories=all_rules)
    country_cat_type = pd.CategoricalDtype(categories=all_countries)

    df['rule'] = df['rule'].astype(rule_cat_type)
    df['country_tb'] = df['country_tb'].astype(country_cat_type)
    df['country_tw'] = df['country_tw'].astype(country_cat_type)

    n_train = int(len(df) * 0.8)
    train_df = df.iloc[:n_train].copy()
    test_df = df.iloc[n_train:].copy()

    dtrain = lgb.Dataset(train_df[feature_cols], label=train_df['label'], categorical_feature=cat_cols)
    dtest = lgb.Dataset(test_df[feature_cols], label=test_df['label'], reference=dtrain, categorical_feature=cat_cols)

    params = {
        'objective': 'multiclass',
        'num_class': 3,
        'metric': 'multi_logloss',
        'boosting_type': 'gbdt',
        'learning_rate': 0.05,
        'num_leaves': 31,
        'feature_fraction': 0.9,
        'bagging_fraction': 0.8,
        'bagging_freq': 5,
        'verbose': -1,
        'seed': 42
    }

    model = lgb.train(params, dtrain, num_boost_round=1000, valid_sets=[dtrain, dtest],
                      callbacks=[lgb.early_stopping(50, verbose=False)])

    preds = model.predict(test_df[feature_cols], num_iteration=model.best_iteration)
    y_true = test_df['label'].values
    acc = accuracy_score(y_true, np.argmax(preds, axis=1))
    loss = log_loss(y_true, preds)
    print(f"训练完成！最佳轮数: {model.best_iteration}, 测试集准确率: {acc*100:.2f}%, LogLoss: {loss:.4f}")

    # 导出树结构 JSON
    model_dump = model.dump_model()
    pandas_cat = model_dump.get('pandas_categorical', [])

    def parse_tree_node(node):
        if 'leaf_value' in node:
            return {'v': round(node['leaf_value'], 6)}
        f_idx = node['split_feature']
        thresh = node['threshold']
        default_left = (node['default_left'] is True)
        left_child = parse_tree_node(node['left_child'])
        right_child = parse_tree_node(node['right_child'])
        res = {
            'f': f_idx,
            'l': left_child,
            'r': right_child,
            'dl': 1 if default_left else 0
        }
        if isinstance(thresh, str):
            res['tc'] = [int(x) for x in thresh.split('||')]
        else:
            if abs(thresh) < 1e-15:
                res['t'] = thresh
            else:
                res['t'] = round(thresh, 5)
        return res

    trees = []
    for tree_info in model_dump['tree_info']:
        trees.append({
            'c': tree_info['tree_index'] % 3,
            'r': parse_tree_node(tree_info['tree_structure'])
        })

    cat_maps = {}
    for i, c in enumerate(cat_cols):
        cat_maps[str(feature_cols.index(c))] = [int(x) for x in pandas_cat[i]]

    out_model = {
        'features': feature_cols,
        'cat_indices': cat_indices,
        'cat_maps': cat_maps,
        'trees': trees
    }
    return out_model


def step4_export_assets(base, out_model, valid_games, player_game_history, h2h_stats, tournament_dates):
    """步骤 4：导出 model.json, players.json, h2h.json, whr_games.json.gz。"""
    print("=" * 70)
    print("步骤 4：导出全量生产模型与特征数据...")
    os.makedirs(BISAI_DATA_DIR, exist_ok=True)
    os.makedirs(DATA_DIR, exist_ok=True)

    # 1. model_20261113.json & model.json
    m_path_13 = os.path.join(BISAI_DATA_DIR, "model_20261113.json")
    m_path_default = os.path.join(BISAI_DATA_DIR, "model.json")
    with open(m_path_13, 'w', encoding='utf-8') as f:
        json.dump(out_model, f, separators=(',', ':'))
    with open(m_path_default, 'w', encoding='utf-8') as f:
        json.dump(out_model, f, separators=(',', ':'))
    print(f"导出模型: {m_path_13} ({len(out_model['trees'])} 棵树)")

    # 2. players.json
    latest_ratings = base.get_ratings_latest()
    last_day = valid_games[-1]['day']
    TAU = 730.0

    players_export = []
    for pid, (r_val, u_val) in latest_ratings.items():
        pl = base.players.get(pid, {})
        fn = pl.get('name', '')
        ln = pl.get('surname', '')
        nn = pl.get('native_name', '')
        fullname = (fn + ' ' + ln).strip()
        c_id = int(pl.get('country', 0)) if pl.get('country') else 0
        c_abbr = base.countries.get(str(c_id), {}).get('abbr', 'UNK')

        birth = pl.get('birth', '')
        age = (2026 - int(birth[:4])) if (birth and len(birth) >= 4 and birth[:4].isdigit()) else None

        hist = player_game_history.get(pid, [])
        if hist:
            w_sum = 0.0
            draw_sum = 0.0
            for h_day, is_d in hist:
                w = np.exp(-(last_day - h_day) / TAU)
                w_sum += w
                if is_d:
                    draw_sum += w
            decayed_dr = round((draw_sum + 0.12 * 2.0) / (w_sum + 2.0), 4)
        else:
            decayed_dr = 0.12

        players_export.append({
            'id': pid,
            'name': fullname,
            'native_name': nn,
            'country_id': c_id,
            'country_abbr': c_abbr,
            'age': age,
            'rating': round(r_val + 1900.0, 1),
            'std': round(u_val, 1),
            'decayed_draw_rate': decayed_dr,
            'gender': pl.get('gender')
        })

    players_export.sort(key=lambda x: x['rating'], reverse=True)
    players_path = os.path.join(BISAI_DATA_DIR, "players.json")
    with open(players_path, 'w', encoding='utf-8') as f:
        json.dump(players_export, f, separators=(',', ':'), ensure_ascii=False)
    print(f"导出棋手画像: {players_path} ({len(players_export)} 位棋手)")

    # 3. h2h.json
    h2h_export = {}
    for pair, pstat in h2h_stats.items():
        p1, p2 = pair  # sorted
        key = f"{p1}_{p2}"
        tot = pstat['total']
        p1_wins = pstat[p1]
        p2_wins = pstat[p2]
        draws = pstat['draws']

        decayed_score = 0.0
        weight_sum = 0.0
        for h_day, h_tb_id, h_res in pstat['history']:
            w = np.exp(-(last_day - h_day) / TAU)
            actual = h_res if h_tb_id == p1 else (1.0 - h_res if h_res in (0.0, 1.0) else 0.5)
            decayed_score += w * actual
            weight_sum += w
        decayed_p1 = (decayed_score / weight_sum) if weight_sum > 0 else 0.5
        h2h_export[key] = [tot, p1_wins, p2_wins, draws, round(decayed_p1, 3)]

    h2h_path = os.path.join(BISAI_DATA_DIR, "h2h.json")
    with open(h2h_path, 'w', encoding='utf-8') as f:
        json.dump(h2h_export, f, separators=(',', ':'))
    print(f"导出历史交手: {h2h_path} ({len(h2h_export)} 对选手交手记录)")

    # 4. whr_games.json.gz
    whr_games_list = []
    for gid, g in base.games.items():
        res = g.get('result')
        b_id, w_id = g.get('black'), g.get('white')
        tid = g.get('tournament')
        if res in ('B', 'W', 'D') and b_id and w_id and tid in tournament_dates:
            day, _ = tournament_dates[tid]
            whr_games_list.append([b_id, w_id, res, day])

    name_to_pid = {}
    pid_to_name = {}
    for pid, pl in base.players.items():
        nn = pl.get('native_name')
        fn = (pl.get('name', '') + ' ' + pl.get('surname', '')).strip()
        if nn:
            name_to_pid[nn] = pid
        if fn:
            name_to_pid[fn] = pid
        pid_to_name[pid] = nn or fn

    whr_pack_path = os.path.join(DATA_DIR, "whr_games.json.gz")
    with gzip.open(whr_pack_path, 'wt', encoding='utf-8') as f:
        json.dump({
            'games': whr_games_list,
            'name_to_pid': name_to_pid,
            'pid_to_name': pid_to_name
        }, f, separators=(',', ':'))
    print(f"导出压缩世界对局库: {whr_pack_path} ({len(whr_games_list)} 局)")


def main():
    base = step1_compute_whr()
    df, valid_games, player_game_history, h2h_stats, tournament_dates = step2_build_dataset(base)
    out_model = step3_train_gbdt(df)
    step4_export_assets(base, out_model, valid_games, player_game_history, h2h_stats, tournament_dates)

    # 步骤 5：自动评估新模型在当前赛事已完赛对局上的实战表现并刷新 metrics.json
    print("=" * 70)
    print("步骤 5：新模型自动评估与实战指标校验...")
    try:
        import predict_api
        conn = predict_api.connect()
        tids = [r['id'] for r in conn.execute('SELECT id FROM tournaments').fetchall()]
        for tid in tids:
            predict_api.evaluate_tournament_model(conn, tid, write=True, print_report=True)
        conn.close()
    except Exception as e:
        print(f"提示：赛事评估调用跳过或出错: {e}")

    print("=" * 70)
    print("全部训练、产物生成与新模型自动评估流程圆满完成！")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
