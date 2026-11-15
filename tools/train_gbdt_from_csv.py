# -*- coding: utf-8 -*-
"""直接基于统一 CSV (data/all_games.csv) 重新拟合 WHR 并训练 14 维 LightGBM GBDT 模型。

默认使用截止 2026-11-13 (day < 20771) 的全量对局（含 RIF XML 与 renju4433 补充赛事）进行训练，
保留 2026-11-14 山海杯作为严格样本外测试。

输出：
    bisai/data/model_20261115.json
    bisai/data/model.json
"""

import argparse
import csv
import json
import math
import os
import sys
import numpy as np
import pandas as pd
import lightgbm as lgb
from sklearn.metrics import accuracy_score, log_loss
import whr

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_CSV_PATH = os.path.join(ROOT, "data", "all_games.csv")
BISAI_DATA_DIR = os.path.join(ROOT, "bisai", "data")

W2 = 19.3
VIRTUAL_GAMES = 2
BIAS = 1900.0
TAU = 730.0
SHANHAI_DAY = 20771  # 2026-11-14


def load_training_games(csv_path, max_day_exclusive=SHANHAI_DAY):
    """从统一 CSV 加载并按时间排序训练对局。"""
    games = []
    with open(csv_path, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for idx, row in enumerate(reader):
            res = row.get("result", "")
            if res not in ("B", "W", "D"):
                continue
            b_id = row.get("black_id") or row.get("black_name") or ""
            w_id = row.get("white_id") or row.get("white_name") or ""
            if not b_id or not w_id or b_id == w_id:
                continue
            try:
                day = int(float(row.get("day") or 0))
            except ValueError:
                day = 0
            if day <= 0 or (max_day_exclusive is not None and day >= max_day_exclusive):
                continue
            try:
                rule = int(float(row.get("rule") or 0))
            except ValueError:
                rule = 0
            try:
                cb = int(float(row.get("black_country") or 5))
            except ValueError:
                cb = 5
            try:
                cw = int(float(row.get("white_country") or 5))
            except ValueError:
                cw = 5
            games.append({
                "idx": idx,
                "day": day,
                "rule": rule,
                "b_id": b_id,
                "w_id": w_id,
                "cb": cb,
                "cw": cw,
                "res": res,
            })

    games.sort(key=lambda g: (g["day"], g["idx"]))
    return games


def build_features_from_csv(games):
    """运行 WHR 并按时间顺序构建 14 维训练特征。"""
    print(f"加载训练对局共 {len(games)} 局，开始运行 WHR 收敛拟合...")
    whr_input = [[g["b_id"], g["w_id"], g["res"], g["day"]] for g in games]
    whr_base = whr.Base(config={"w2": W2, "virtual_games": VIRTUAL_GAMES})
    whr_base.create_games(whr_input)
    whr_base.iterate_until_converge(verbose=False)
    print("WHR 收敛完成，开始提取时间序列 14 维特征...")

    # 缓存每位棋手完整 WHR 历史序列 [(day, r, std), ...]
    rating_cache = {}

    def get_rating_at_day(pid, day):
        hist = rating_cache.get(pid)
        if hist is None:
            hist = whr_base.ratings_for_player(pid) or []
            rating_cache[pid] = hist
        # 二分或线性查找 <= day 的最近一条记录
        best = None
        for d, r_val, std_val in hist:
            if d <= day:
                best = (r_val + BIAS, std_val)
            else:
                break
        if best is not None:
            return best
        if hist:
            return hist[0][1] + BIAS, hist[0][2]
        return BIAS, 100.0

    player_hist = {}  # pid -> list of (day, is_draw)
    h2h_hist = {}     # (p1, p2) -> list of (day, b_id, score_b)

    records = []
    for g in games:
        day = g["day"]
        b_id = g["b_id"]
        w_id = g["w_id"]
        res = g["res"]
        y = 2 if res == "B" else (1 if res == "D" else 0)

        r_tb, std_tb = get_rating_at_day(b_id, day)
        r_tw, std_tw = get_rating_at_day(w_id, day)
        diff = r_tb - r_tw
        mean_r = (r_tb + r_tw) / 2.0
        joint_std = math.sqrt(std_tb ** 2 + std_tw ** 2)

        def calc_dr(pid):
            hist = player_hist.get(pid)
            if not hist:
                return 0.12
            w_sum = 0.0
            d_sum = 0.0
            for h_day, is_d in hist:
                w = math.exp(-(day - h_day) / TAU)
                w_sum += w
                if is_d:
                    d_sum += w
            return (d_sum / w_sum) if w_sum > 2.0 else 0.12

        dr_b = calc_dr(b_id)
        dr_w = calc_dr(w_id)
        comb_dr = (dr_b + dr_w) / 2.0

        pair = (b_id, w_id) if b_id <= w_id else (w_id, b_id)
        hh = h2h_hist.get(pair)
        if not hh:
            h2h_score = 0.5
        else:
            w_sum = 0.0
            s_sum = 0.0
            for h_day, h_b, s_b in hh:
                w = math.exp(-(day - h_day) / TAU)
                sc = s_b if h_b == b_id else (1.0 - s_b)
                w_sum += w
                s_sum += w * sc
            h2h_score = (s_sum / w_sum) if w_sum > 0 else 0.5

        records.append({
            "rule": g["rule"],
            "rating_tb": r_tb,
            "rating_tw": r_tw,
            "rating_diff": diff,
            "rating_mean": mean_r,
            "std_tb": std_tb,
            "std_tw": std_tw,
            "joint_std": joint_std,
            "decayed_dr_tb": dr_b,
            "decayed_dr_tw": dr_w,
            "combined_decayed_dr": comb_dr,
            "decayed_h2h_score": h2h_score,
            "country_tb": g["cb"],
            "country_tw": g["cw"],
            "label": y,
        })

        player_hist.setdefault(b_id, []).append((day, y == 1))
        player_hist.setdefault(w_id, []).append((day, y == 1))
        score_b = 1.0 if y == 2 else (0.5 if y == 1 else 0.0)
        h2h_hist.setdefault(pair, []).append((day, b_id, score_b))

    df = pd.DataFrame(records)
    print(f"特征提取完毕，样本行数: {len(df)}")
    return df


def train_and_export(df, out_name="model_20261113.json"):
    """训练 LightGBM 三分类 GBDT 模型并导出 JSON。"""
    feature_cols = [
        "rule",
        "rating_tb", "rating_tw", "rating_diff", "rating_mean",
        "std_tb", "std_tw", "joint_std",
        "decayed_dr_tb", "decayed_dr_tw", "combined_decayed_dr",
        "decayed_h2h_score",
        "country_tb", "country_tw",
    ]
    cat_cols = ["rule", "country_tb", "country_tw"]
    cat_indices = [feature_cols.index(c) for c in cat_cols]

    all_rules = sorted(list(df["rule"].unique()))
    all_countries = sorted(list(set(df["country_tb"].unique()) | set(df["country_tw"].unique()) | {0}))

    df["rule"] = df["rule"].astype(pd.CategoricalDtype(categories=all_rules))
    df["country_tb"] = df["country_tb"].astype(pd.CategoricalDtype(categories=all_countries))
    df["country_tw"] = df["country_tw"].astype(pd.CategoricalDtype(categories=all_countries))

    n_train = int(len(df) * 0.8)
    train_df = df.iloc[:n_train].copy()
    test_df = df.iloc[n_train:].copy()

    dtrain = lgb.Dataset(train_df[feature_cols], label=train_df["label"], categorical_feature=cat_cols)
    dtest = lgb.Dataset(test_df[feature_cols], label=test_df["label"], reference=dtrain, categorical_feature=cat_cols)

    params = {
        "objective": "multiclass",
        "num_class": 3,
        "metric": "multi_logloss",
        "boosting_type": "gbdt",
        "learning_rate": 0.05,
        "num_leaves": 31,
        "feature_fraction": 0.9,
        "bagging_fraction": 0.8,
        "bagging_freq": 5,
        "verbose": -1,
        "seed": 42,
    }

    model = lgb.train(
        params,
        dtrain,
        num_boost_round=1000,
        valid_sets=[dtrain, dtest],
        callbacks=[lgb.early_stopping(50, verbose=False)],
    )

    preds = model.predict(test_df[feature_cols], num_iteration=model.best_iteration)
    y_true = test_df["label"].values
    acc = accuracy_score(y_true, np.argmax(preds, axis=1))
    loss = log_loss(y_true, preds)
    print(f"训练完成！最佳迭代轮数: {model.best_iteration}, 验证集准确率: {acc*100:.2f}%, LogLoss: {loss:.4f}")

    model_dump = model.dump_model()
    pandas_cat = model_dump.get("pandas_categorical", [])

    def parse_tree_node(node):
        if "leaf_value" in node:
            return {"v": round(node["leaf_value"], 6)}
        f_idx = node["split_feature"]
        thresh = node["threshold"]
        res = {
            "f": f_idx,
            "l": parse_tree_node(node["left_child"]),
            "r": parse_tree_node(node["right_child"]),
            "dl": 1 if (node["default_left"] is True) else 0,
        }
        if isinstance(thresh, str):
            res["tc"] = [int(x) for x in thresh.split("||")]
        else:
            res["t"] = thresh if abs(thresh) < 1e-15 else round(thresh, 5)
        return res

    trees = [
        {"c": t["tree_index"] % 3, "r": parse_tree_node(t["tree_structure"])}
        for t in model_dump["tree_info"]
    ]
    cat_maps = {
        str(feature_cols.index(c)): [int(x) for x in pandas_cat[i]]
        for i, c in enumerate(cat_cols)
    }

    out_model = {
        "features": feature_cols,
        "cat_indices": cat_indices,
        "cat_maps": cat_maps,
        "trees": trees,
    }

    os.makedirs(BISAI_DATA_DIR, exist_ok=True)
    out_path = os.path.join(BISAI_DATA_DIR, out_name)
    default_path = os.path.join(BISAI_DATA_DIR, "model.json")
    for p in (out_path, default_path):
        with open(p, "w", encoding="utf-8") as f:
            json.dump(out_model, f, separators=(",", ":"))
    print(f"已导出模型: {out_path} 与 {default_path} ({len(trees)} 棵树)")
    return out_path


def main():
    ap = argparse.ArgumentParser(description="基于 data/all_games.csv 重新训练 LightGBM GBDT 模型")
    ap.add_argument("--csv", default=DEFAULT_CSV_PATH, help="统一 CSV 路径")
    ap.add_argument("--out-name", default="model_20261113.json", help="输出模型文件名")
    ap.add_argument("--include-shanhai", action="store_true", help="是否把山海杯也纳入训练集（默认保留样本外）")
    args = ap.parse_args()

    max_day = None if args.include_shanhai else SHANHAI_DAY
    games = load_training_games(args.csv, max_day_exclusive=max_day)
    df = build_features_from_csv(games)
    train_and_export(df, out_name=args.out_name)


if __name__ == "__main__":
    main()
