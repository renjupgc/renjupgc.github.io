# -*- coding: utf-8 -*-
"""基于 data/all_games.csv 使用 Glicko-1 与 4 特征训练 LightGBM GBDT 模型并导出 JSON。

特征 (4 维):
  [rule, rating_tb, rating_tw, rating_diff]
类别映射 (与 predict_api.py 一致):
  0: 白胜 (W), 1: 和棋 (D), 2: 黑胜 (B)
"""

import argparse
import csv
import json
import math
import os
import time
import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, log_loss

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_CSV_PATH = os.path.join(ROOT, "data", "all_games.csv")
BISAI_DATA_DIR = os.path.join(ROOT, "bisai", "data")
SHANHAI_DAY = 20771

Q = math.log(10.0) / 400.0
Q2 = Q * Q
THREE_Q2_OVER_PI2 = 3.0 * Q2 / (math.pi * math.pi)
INIT_RATING = 2000.0
INIT_RD = 350.0
MIN_RD = 30.0
MAX_RD = 350.0
C2_PER_DAY = 100.0


def load_training_games(csv_path, max_day_exclusive=SHANHAI_DAY):
    games = []
    with open(csv_path, "r", encoding="utf-8", newline="") as f:
        for idx, row in enumerate(csv.DictReader(f)):
            res = row.get("result", "")
            if res not in ("B", "W", "D"):
                continue
            b_id = row.get("black_id") or row.get("black_name") or ""
            w_id = row.get("white_id") or row.get("white_name") or ""
            if not b_id or not w_id or b_id == w_id:
                continue
            day = int(float(row.get("day") or 0))
            if day <= 0:
                continue
            if max_day_exclusive is not None and day >= max_day_exclusive:
                continue
            rule = int(float(row.get("rule") or 0))
            rnd = int(row["round"]) if (row.get("round") or "").isdigit() else 0
            games.append({
                "idx": idx, "rnd": rnd, "day": day, "rule": rule,
                "b_id": b_id, "w_id": w_id, "res": res,
            })
    games.sort(key=lambda g: (g["day"], g["rnd"], g["idx"]))
    return games


def build_glicko_features(games):
    rating, rd_map, last_day = {}, {}, {}

    def get_pre(pid, day):
        r = rating.get(pid, INIT_RATING)
        rd = rd_map.get(pid, INIT_RD)
        ld = last_day.get(pid)
        if ld is not None and day > ld:
            rd = min(MAX_RD, math.sqrt(rd * rd + C2_PER_DAY * (day - ld)))
        return r, rd

    def g_func(rd):
        return 1.0 / math.sqrt(1.0 + THREE_Q2_OVER_PI2 * rd * rd)

    rows = []
    for g in games:
        day, b_id, w_id, res = g["day"], g["b_id"], g["w_id"], g["res"]
        rb, rdb = get_pre(b_id, day)
        rw, rdw = get_pre(w_id, day)
        # 类别映射：0: 白胜 (W), 1: 和棋 (D), 2: 黑胜 (B)
        label = 2 if res == "B" else (1 if res == "D" else 0)
        rows.append((g["rule"], rb, rw, rb - rw, label))

        gb, gw = g_func(rdb), g_func(rdw)
        eb = 1.0 / (1.0 + 10.0 ** (-gw * (rb - rw) / 400.0))
        ew = 1.0 / (1.0 + 10.0 ** (-gb * (rw - rb) / 400.0))
        sb = 1.0 if res == "B" else (0.5 if res == "D" else 0.0)
        sw = 1.0 - sb
        db = 1.0 / (rdb * rdb) + Q2 * gw * gw * eb * (1.0 - eb)
        dw = 1.0 / (rdw * rdw) + Q2 * gb * gb * ew * (1.0 - ew)
        rating[b_id] = rb + (Q / db) * gw * (sb - eb)
        rd_map[b_id] = max(MIN_RD, math.sqrt(1.0 / db))
        last_day[b_id] = day
        rating[w_id] = rw + (Q / dw) * gb * (sw - ew)
        rd_map[w_id] = max(MIN_RD, math.sqrt(1.0 / dw))
        last_day[w_id] = day

    feature_cols = ["rule", "rating_tb", "rating_tw", "rating_diff"]
    return pd.DataFrame(rows, columns=feature_cols + ["label"]), feature_cols


def train_and_export(df, feature_cols, out_name="model_glicko_20261113.json"):
    cat_cols = ["rule"]
    cat_indices = [0]
    all_rules = sorted(list(df["rule"].unique()))
    df["rule"] = df["rule"].astype(pd.CategoricalDtype(categories=all_rules))

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
    print(f"Glicko-GBDT (4特征) 训练完成: best_iter={model.best_iteration}, Valid Acc={acc*100:.2f}%, LogLoss={loss:.4f}")

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
    print(f"已导出 Glicko-GBDT 模型: {out_path} 与 {default_path} ({len(trees)} 棵树)")
    return out_path


def main():
    ap = argparse.ArgumentParser(description="基于 data/all_games.csv 训练 5 特征 Glicko-GBDT 模型")
    ap.add_argument("--csv", default=DEFAULT_CSV_PATH, help="统一 CSV 路径")
    ap.add_argument("--out-name", default="model_glicko_20261113.json", help="输出模型文件名")
    ap.add_argument("--include-shanhai", action="store_true", help="是否把山海杯纳入训练集")
    args = ap.parse_args()

    t0 = time.time()
    max_day = None if args.include_shanhai else SHANHAI_DAY
    games = load_training_games(args.csv, max_day_exclusive=max_day)
    df, cols = build_glicko_features(games)
    train_and_export(df, cols, out_name=args.out_name)
    print(f"总耗时: {time.time() - t0:.2f}s")


if __name__ == "__main__":
    main()
