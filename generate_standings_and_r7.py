# -*- coding: utf-8 -*-
import os, json, math, time, re
import numpy as np

REPO_DIR = r"C:\Users\yaolz\WorkBuddy\2026-11-10-00-26-58\renjupgc.github.io"
SHANHAI_PATH = os.path.join(REPO_DIR, "tools", "predict-page.template.html")
PIT_GB_PATH = r"C:\Users\yaolz\Downloads\whr_renju-master\whr_renju-master\data\game_base_20260704_renju.json"
LATEST_GB_PATH = r"C:\Users\yaolz\Downloads\whr_renju-master\whr_renju-master\data\game_base_20261112_renju.json"
MODEL_PATH = os.path.join(REPO_DIR, "bisai", "data", "model_20260704.json")

PLAYERS = {
    "102574": {"no": 1, "name": "王鑫宇", "country_id": 5, "dr": 0.0132},
    "021042": {"no": 2, "name": "Barinov Random", "country_id": 2, "dr": 0.0333},
    "102459": {"no": 3, "name": "药博凡", "country_id": 5, "dr": 0.0847},
    "100963": {"no": 4, "name": "钟煜阳", "country_id": 5, "dr": 0.0951},
    "020975": {"no": 5, "name": "Startsev Maksim", "country_id": 2, "dr": 0.0748},
    "102695": {"no": 6, "name": "蔡嘉睦", "country_id": 5, "dr": 0.0597},
    "102702": {"no": 7, "name": "周士杰", "country_id": 5, "dr": 0.0530},
    "100732": {"no": 8, "name": "康庭瑞", "country_id": 5, "dr": 0.1614},
    "021171": {"no": 9, "name": "Vershinin Ivan", "country_id": 2, "dr": 0.1325},
    "102247": {"no": 10, "name": "潘冠臣", "country_id": 5, "dr": 0.0447},
    "101314": {"no": 11, "name": "丁泽宇", "country_id": 5, "dr": 0.0717},
    "101769": {"no": 12, "name": "陈浩源", "country_id": 5, "dr": 0.0528},
    "020961": {"no": 13, "name": "Noskov Pavel", "country_id": 2, "dr": 0.0356},
    "020959": {"no": 14, "name": "Sidorov Mikhail", "country_id": 2, "dr": 0.0999},
    "020978": {"no": 15, "name": "Kazantsev Konstantin", "country_id": 2, "dr": 0.0567},
    "100889": {"no": 16, "name": "李嘉骏", "country_id": 5, "dr": 0.0968}
}

player_pids = list(PLAYERS.keys())
pid_to_idx = {pid: i for i, pid in enumerate(player_pids)}

with open(PIT_GB_PATH, "r", encoding="utf-8") as f:
    gb_pit = json.load(f)
pit_ratings = gb_pit.get("ratings", {})

player_pit = {}
for pid, info in PLAYERS.items():
    r_list = pit_ratings.get(pid, [])
    if r_list:
        latest = r_list[-1]
        player_pit[pid] = {"r": latest[1] + 1900.0, "rd": latest[2]}
    else:
        player_pit[pid] = {"r": 2000.0, "rd": 150.0}

with open(MODEL_PATH, "r", encoding="utf-8") as f:
    model_data = json.load(f)

trees = model_data["trees"]
cat_maps = model_data["cat_maps"]

def predict_gbdt(sample):
    scores = [0.0, 0.0, 0.0]
    for i, curr in enumerate(trees):
        cls = i % 3
        node = curr["r"] if "r" in curr and "f" in curr["r"] else curr
        while "v" not in node:
            f_idx = node["f"]
            val = sample[f_idx]
            if val is None or (isinstance(val, float) and math.isnan(val)):
                node = node["l"] if node.get("dl") == 1 else node["r"]
                continue
            if "tc" in node:
                cat_list = cat_maps.get(str(f_idx), [])
                internal_idx = cat_list.index(int(val)) if int(val) in cat_list else -1
                if internal_idx != -1 and internal_idx in node["tc"]:
                    node = node["l"]
                else:
                    node = node["r"]
            else:
                if val <= node["t"]:
                    node = node["l"]
                else:
                    node = node["r"]
        scores[cls] += node["v"]

    max_s = max(scores)
    exp_s = [math.exp(s - max_s) for s in scores]
    sum_e = sum(exp_s)
    probs = [e / sum_e for e in exp_s]
    pw = round(probs[0] * 100, 1)
    pd = round(probs[1] * 100, 1)
    pb = round(100.0 - pw - pd, 1)
    return pb / 100.0, pd / 100.0, pw / 100.0

def get_feat(b_id, w_id):
    rb = player_pit[b_id]["r"]
    stdb = player_pit[b_id]["rd"]
    rw = player_pit[w_id]["r"]
    stdw = player_pit[w_id]["rd"]
    diff = rb - rw
    mean_r = (rb + rw) / 2.0
    j_std = math.sqrt(stdb**2 + stdw**2)
    dr_b = PLAYERS[b_id]["dr"]
    dr_w = PLAYERS[w_id]["dr"]
    comb_dr = (dr_b + dr_w) / 2.0
    h2h = 0.5
    c_b_id = PLAYERS[b_id]["country_id"]
    c_w_id = PLAYERS[w_id]["country_id"]
    return [22, rb, rw, diff, mean_r, stdb, stdw, j_std, dr_b, dr_w, comb_dr, h2h, c_b_id, c_w_id]

with open(LATEST_GB_PATH, "r", encoding="utf-8") as f:
    latest_data = json.load(f)
games_3597 = {gid: g for gid, g in latest_data["games"].items() if str(g.get("tournament")) == "3597"}

scores_r6 = {pid: 0.0 for pid in PLAYERS}
wins_r6 = {pid: 0 for pid in PLAYERS}
opps_r6 = {pid: [] for pid in PLAYERS}
h2h_map = {}

r7_games = []
for gid, g in games_3597.items():
    r = int(g["round"])
    b, w, res = g["black"], g["white"], g["result"]
    if r <= 6:
        opps_r6[b].append(w)
        opps_r6[w].append(b)
        if res == "B":
            scores_r6[b] += 1.0
            wins_r6[b] += 1
            h2h_map[(b, w)] = 1.0
            h2h_map[(w, b)] = 0.0
        elif res == "W":
            scores_r6[w] += 1.0
            wins_r6[w] += 1
            h2h_map[(b, w)] = 0.0
            h2h_map[(w, b)] = 1.0
        elif res == "D":
            scores_r6[b] += 0.5
            scores_r6[w] += 0.5
            h2h_map[(b, w)] = 0.5
            h2h_map[(w, b)] = 0.5
    elif r == 7:
        r7_games.append((b, w, res))

def sort_r7(item):
    b, w, _ = item
    sb, sw = scores_r6[b], scores_r6[w]
    nb, nw = PLAYERS[b]["no"], PLAYERS[w]["no"]
    hi_s, lo_s = max(sb, sw), min(sb, sw)
    hi_no = nb if sb > sw else (nw if sw > sb else min(nb, nw))
    return (-hi_s, -lo_s, hi_no, min(nb, nw))

r7_games = sorted(r7_games, key=sort_r7)

r7_boards = []
for idx, (b, w, res) in enumerate(r7_games):
    f_vec = get_feat(b, w)
    pb, pd, pw = predict_gbdt(f_vec)
    r7_boards.append({
        "b": b,
        "w": w,
        "res": res,
        "probs": [pb, pd, pw]
    })

# Opponents for all 7 rounds
all_opponents = {pid: list(opps_r6[pid]) for pid in PLAYERS}
for bd in r7_boards:
    b, w = bd["b"], bd["w"]
    all_opponents[b].append(w)
    all_opponents[w].append(b)

opp_indices = {pid: [pid_to_idx[o] for o in all_opponents[pid]] for pid in PLAYERS}

# 6561 scenarios computation
num_scenarios = 3**8
scen_ranks = np.zeros((num_scenarios, 16), dtype=np.int32)
scen_probs = np.zeros(num_scenarios, dtype=np.float64)

for s_idx in range(num_scenarios):
    tmp = s_idx
    outcomes = []
    p_scen = 1.0
    for g_idx in range(8):
        res_code = tmp % 3
        tmp //= 3
        outcomes.append(res_code)
        p_scen *= r7_boards[g_idx]["probs"][res_code]
    scen_probs[s_idx] = p_scen
    if p_scen == 0:
        continue

    scen_scores = [scores_r6[pid] for pid in player_pids]
    scen_wins = [wins_r6[pid] for pid in player_pids]
    scen_h2h = dict(h2h_map)

    for g_idx in range(8):
        b_pid = r7_boards[g_idx]["b"]
        w_pid = r7_boards[g_idx]["w"]
        b_i = pid_to_idx[b_pid]
        w_i = pid_to_idx[w_pid]
        oc = outcomes[g_idx]
        if oc == 0:
            scen_scores[b_i] += 1.0
            scen_wins[b_i] += 1
            scen_h2h[(b_pid, w_pid)] = 1.0
            scen_h2h[(w_pid, b_pid)] = 0.0
        elif oc == 1:
            scen_scores[b_i] += 0.5
            scen_scores[w_i] += 0.5
            scen_h2h[(b_pid, w_pid)] = 0.5
            scen_h2h[(w_pid, b_pid)] = 0.5
        elif oc == 2:
            scen_scores[w_i] += 1.0
            scen_wins[w_i] += 1
            scen_h2h[(b_pid, w_pid)] = 0.0
            scen_h2h[(w_pid, b_pid)] = 1.0

    keys = []
    for i, pid in enumerate(player_pids):
        opp_s = sorted([scen_scores[o_i] for o_i in opp_indices[pid]])
        bh = sum(opp_s)
        bhc1 = sum(opp_s[1:])
        bhc2 = sum(opp_s[2:])
        mbh = sum(opp_s[1:-1])
        keys.append((scen_scores[i], bh, bhc1, bhc2, mbh, scen_wins[i], i))

    # Sort descending by 积分, 对手分, BhC1, BhC2, MBh, 胜局数
    sorted_items = sorted(keys, key=lambda x: (x[0], x[1], x[2], x[3], x[4], x[5]), reverse=True)

    i = 0
    while i < 16:
        j = i
        while j < 16 and sorted_items[j][:6] == sorted_items[i][:6]:
            j += 1
        group = [sorted_items[k][6] for k in range(i, j)]
        if len(group) == 1:
            scen_ranks[s_idx, group[0]] = i
        elif len(group) == 2:
            p1_pid = player_pids[group[0]]
            p2_pid = player_pids[group[1]]
            h_score = scen_h2h.get((p1_pid, p2_pid))
            if h_score == 1.0:
                scen_ranks[s_idx, group[0]] = i
                scen_ranks[s_idx, group[1]] = i + 1
            elif h_score == 0.0:
                scen_ranks[s_idx, group[1]] = i
                scen_ranks[s_idx, group[0]] = i + 1
            else:
                # 并列不平分，就按照最高的算 (两者均赋予最高名次 i)
                for p_idx in group:
                    scen_ranks[s_idx, p_idx] = i
        else:
            sub_h2h = {}
            complete = True
            for a in group:
                for b in group:
                    if a != b:
                        if (player_pids[a], player_pids[b]) not in scen_h2h:
                            complete = False
                            break
                        sub_h2h.setdefault(a, 0.0)
                        sub_h2h[a] += scen_h2h[(player_pids[a], player_pids[b])]
            if complete and len(set(sub_h2h.values())) == len(group):
                sub_sorted = sorted(group, key=lambda a: sub_h2h[a], reverse=True)
                for rk_offset, p_idx in enumerate(sub_sorted):
                    scen_ranks[s_idx, p_idx] = i + rk_offset
            else:
                # 并列不平分，就按照最高的算
                for p_idx in group:
                    scen_ranks[s_idx, p_idx] = i
        i = j

# Simulate 10,000,000 times
N_SIM = 10_000_000
np.random.seed(20261114)
sim_counts = np.random.multinomial(N_SIM, scen_probs)

rank_counts = np.zeros((16, 16), dtype=np.int64)
for s_idx in range(num_scenarios):
    c = sim_counts[s_idx]
    if c > 0:
        for p_idx in range(16):
            rk = scen_ranks[s_idx, p_idx]
            rank_counts[p_idx, rk] += c

sim_probs = rank_counts / float(N_SIM)

# Expected ranks
exp_ranks = [sum((rk + 1) * sim_probs[i, rk] for rk in range(16)) for i in range(16)]
sorted_player_indices = np.argsort(exp_ranks)

# Build HTML rows for Matches (View 1)
match_rows = []
for table_idx, bd in enumerate(r7_boards, 1):
    b_id, w_id, res = bd["b"], bd["w"], bd["res"]
    pb, pd, pw = [round(x * 100, 1) for x in bd["probs"]]
    pw = round(100.0 - pb - pd, 1)
    
    p_b = PLAYERS[b_id]
    p_w = PLAYERS[w_id]
    sb_str = f"{scores_r6[b_id]:g}分"
    sw_str = f"{scores_r6[w_id]:g}分"
    
    if res == "B":
        res_str = "1 : 0"
        res_cls = "res-b"
    elif res == "W":
        res_str = "0 : 1"
        res_cls = "res-w"
    else:
        res_str = "0.5 : 0.5"
        res_cls = "res-d"
        
    top_val = max(pb, pd, pw)
    cls_b = " top pos" if pb == top_val else ""
    cls_d = " top" if pd == top_val else ""
    cls_w = " top pos" if pw == top_val else ""
    
    row_html = (
        f'      <tr>\n'
        f'        <td class="c-no">{table_idx}</td>\n'
        f'        <td class="c-bn"><span class="pid">{p_b["no"]}</span><span class="pn" title="{p_b["name"]}">{p_b["name"]}</span><span class="pscore">{sb_str}</span></td>\n'
        f'        <td class="c-prob">\n'
        f'          <div class="m-res"><span class="res-tag {res_cls}">{res_str}</span></div>\n'
        f'          <span class="bar" title="假先 {pb}% · 和 {pd}% · 假后 {pw}%"><i class="s-b" style="width:{pb:.2f}%"></i><i class="s-d" style="width:{pd:.2f}%"></i><i class="s-w" style="width:{pw:.2f}%"></i></span>\n'
        f'          <span class="nums"><span class="n"><em>假先</em><span class="v{cls_b}">{pb}<i>%</i></span></span><span class="n"><em>和棋</em><span class="v{cls_d}">{pd}<i>%</i></span></span><span class="n"><em>假后</em><span class="v{cls_w}">{pw}<i>%</i></span></span></span>\n'
        f'        </td>\n'
        f'        <td class="c-wn"><span class="pscore">{sw_str}</span><span class="pn" title="{p_w["name"]}">{p_w["name"]}</span><span class="pid">{p_w["no"]}</span></td>\n'
        f'      </tr>'
    )
    match_rows.append(row_html)

matches_tbody = "\n".join(match_rows)

def format_pct_str(pct):
    if pct <= 0:
        return "0.00%"
    if pct >= 100.0:
        return "100.00%"
    return f"{pct:.2f}%"

def get_heat_level(pct):
    if pct <= 0:
        return 0
    elif pct < 1.0:
        return 1
    elif pct < 5.0:
        return 2
    elif pct < 15.0:
        return 3
    elif pct < 35.0:
        return 4
    elif pct < 65.0:
        return 5
    else:
        return 6

# Build HTML rows for Standings (View 2)
# Columns: 棋手 | 夺冠率 | 前三率 | 前八率 | 期望名次 | 详细分布
standings_rows = []
for p_rank_order, p_idx in enumerate(sorted_player_indices):
    pid = player_pids[p_idx]
    p_info = PLAYERS[pid]
    no = p_info["no"]
    name = p_info["name"]
    
    p_top1 = sim_probs[p_idx, 0] * 100
    p_top3 = sum(sim_probs[p_idx, :3]) * 100
    p_top8 = sum(sim_probs[p_idx, :8]) * 100
    exp_r = exp_ranks[p_idx]
    
    str_top1 = format_pct_str(p_top1)
    str_top3 = format_pct_str(p_top3)
    str_top8 = format_pct_str(p_top8)
    
    cls_top1 = " is-100" if str_top1 == "100.00%" else (" bold" if p_top1 > 0 else "")
    cls_top3 = " is-100" if str_top3 == "100.00%" else (" bold" if p_top3 > 0 else "")
    cls_top8 = " is-100" if str_top8 == "100.00%" else (" bold" if p_top8 > 0 else "")

    # Build 16 connected heatmap cells
    hm_cells = []
    mini_segs = []
    for rk in range(16):
        cnt = rank_counts[p_idx, rk]
        pct = cnt / float(N_SIM) * 100
        lvl = get_heat_level(pct)
        if cnt == 0:
            val_html = '<span class="hm-val hm-zero">0.00%</span>'
        else:
            val_text = format_pct_str(pct)
            val_html = f'<span class="hm-val">{val_text}</span>'
            
        hm_cell = (
            f'<div class="hm-cell hm-lvl-{lvl}" title="第 {rk+1} 名: {pct:.4f}% ({cnt:,}次)">'
            f'<span class="hm-rk">{rk+1}</span>'
            f'{val_html}'
            f'</div>'
        )
        hm_cells.append(hm_cell)
        mini_segs.append(f'<i class="m-seg hm-lvl-{lvl}" title="第 {rk+1} 名: {pct:.2f}%"></i>')

    hm_grid_html = "".join(hm_cells)
    mini_bar_html = "".join(mini_segs)

    # Main player row
    p_row = (
        f'      <tr class="player-row" id="prow-{p_idx}" onclick="toggleRow({p_idx})">\n'
        f'        <td class="c-pn-std">\n'
        f'          <span class="pid">{no}</span><span class="pn" title="{name}">{name}</span>\n'
        f'        </td>\n'
        f'        <td class="c-pct-std m-stat" data-label="夺冠率"><span class="v{cls_top1}">{str_top1}</span></td>\n'
        f'        <td class="c-pct-std m-stat" data-label="前三率"><span class="v{cls_top3}">{str_top3}</span></td>\n'
        f'        <td class="c-pct-std m-stat" data-label="前八率"><span class="v{cls_top8}">{str_top8}</span></td>\n'
        f'        <td class="c-exp-std"><span class="exp-badge"><i class="exp-lbl">期望 </i>{exp_r:.2f}</span></td>\n'
        f'        <td class="c-dist-std">\n'
        f'          <div class="dist-preview-wrap">\n'
        f'            <span class="mini-hm-bar" title="1~16名热力图概览">{mini_bar_html}</span>\n'
        f'            <button class="btn-expand" id="btn-exp-{p_idx}" type="button" onclick="event.stopPropagation(); toggleRow({p_idx})"><span>展开</span><i class="arr">▾</i></button>\n'
        f'          </div>\n'
        f'        </td>\n'
        f'      </tr>\n'
        f'      <tr class="detail-row" id="detail-{p_idx}">\n'
        f'        <td colspan="6" class="detail-cell">\n'
        f'          <div class="detail-wrap">\n'
        f'            <div class="hm-header">\n'
        f'              <span class="hm-title">第 1 ~ 16 名分布热力图</span>\n'
        f'              <span class="hm-hint">左右滑动查看 16 名 ⇄</span>\n'
        f'            </div>\n'
        f'            <div class="hm-scroll">\n'
        f'              <div class="hm-grid">\n'
        f'                {hm_grid_html}\n'
        f'              </div>\n'
        f'            </div>\n'
        f'          </div>\n'
        f'        </td>\n'
        f'      </tr>'
    )
    standings_rows.append(p_row)

standings_tbody = "\n".join(standings_rows)

# Full CSS incorporating view-switcher, standings table with connected heatmap grid and mobile optimization
full_page_html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>世青赛 · 男子青年组（B组）第 7 轮对阵与详情预测表</title>
<style>
@font-face{{
  font-family:"ShuHei";
  font-style:normal;
  font-weight:400 900;
  font-display:swap;
  src:local("Alimama ShuHeiTi Bold"),local("Alimama ShuHeiTi"),local("AlimamaShuHeiTi-Bold"),local("阿里妈妈数黑体"),
      url("../fonts/AlimamaShuHeiTi-Bold.woff2") format("woff2"),
      url("https://cdn.jsdelivr.net/npm/@fontpkg/alimama-shu-hei-ti/AlimamaShuHeiTi-Bold.woff2") format("woff2");
}}
* {{
  font-family: "ShuHei", "Alimama ShuHeiTi", "AlimamaShuHeiTi-Bold", "阿里妈妈数黑体", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
  box-sizing: border-box;
}}
:root{{
  --paper:#f2f0e9;
  --card:#fffefb;
  --ink:#15201c;
  --ink3:#7c877f;
  --line:#e4dfd2;
  --line2:#eeeadf;
  --green:#0d4736;
  --mint:#e5f0ea;
  --mint2:#f2f8f5;
  --pos-bg:#ddefe5;
  --neg-bg:#e7e5db;
  --neg-ink:#6d776f;
  --sans:"ShuHei",-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Segoe UI",sans-serif;
  --dis:"ShuHei",sans-serif;
  --num:var(--dis);
}}
html{{-webkit-text-size-adjust:100%;font-synthesis:none}}
body{{
  margin:0;background:var(--paper);color:var(--ink);
  font:400 15px/1.6 var(--sans);
  -webkit-font-smoothing:antialiased;
  padding:28px 20px 40px;
}}
.sheet{{max-width:1080px;margin:0 auto}}

.card{{
  background:var(--card);border:1px solid var(--line);
  border-radius:14px;overflow:hidden;
  box-shadow:0 16px 40px -30px rgba(12,50,40,.5);
}}
.card::before{{
  content:"";display:block;height:4px;
  background:linear-gradient(90deg,#0d4736 0%,#2f7f63 42%,#cf8f45 100%);
}}

.hd{{padding:19px 22px 17px;border-bottom:1px solid var(--line)}}
.hd h1{{
  margin:0;font:400 27px/1.32 var(--dis);letter-spacing:.005em;
  color:var(--ink);white-space:nowrap;
}}
.hd h1 em{{font-style:normal;color:var(--green)}}
.hd h1 .yr{{font-family:var(--num);font-weight:400;letter-spacing:.01em;font-size:1.06em;}}

.hd-row{{
  margin-top:10px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;
}}
.hd-sub{{
  font:400 13.5px/1 var(--dis);letter-spacing:.04em;color:#68746d;
  display:flex;align-items:center;gap:9px;flex-wrap:wrap;
}}

.rd-nav{{display:inline-flex;gap:5px;align-items:center;flex-wrap:wrap;vertical-align:middle}}
.rd-tab{{
  font:400 13px/1 var(--num);letter-spacing:.03em;
  color:var(--ink3);background:var(--line2);
  border-radius:6px;padding:5px 9px 4px;text-decoration:none;
  transition:all .15s ease;
}}
.rd-tab:hover{{background:var(--mint);color:var(--green)}}
.rd-tab.active{{font-weight:600;color:#fff;background:var(--green);box-shadow:0 2px 6px rgba(13,71,54,.25)}}

/* 视图切换按钮 */
.view-switch{{
  display:inline-flex;background:var(--line2);border-radius:8px;padding:2.5px;
}}
.v-btn{{
  border:none;background:transparent;color:var(--ink3);
  font:500 13px/1 var(--dis);letter-spacing:.03em;
  padding:6px 15px 5px;border-radius:6px;cursor:pointer;
  transition:all .15s ease;
}}
.v-btn:hover{{color:var(--green)}}
.v-btn.active{{
  background:var(--card);color:var(--green);
  box-shadow:0 2px 6px rgba(0,0,0,.08);font-weight:700;
}}

/* 桌面端对阵表格 */
table.table-matches{{width:100%;border-collapse:collapse;table-layout:fixed;font-variant-numeric:tabular-nums}}
table.table-matches thead th{{
  background:var(--mint);vertical-align:bottom;
  font:400 13px/1 var(--dis);letter-spacing:.13em;color:#2c5b49;
  padding:12px 10px;white-space:nowrap;border-bottom:1px solid #d3e5db;
}}
table.table-matches th.t-no{{width:52px;text-align:center}}
table.table-matches th.t-prob{{width:260px;text-align:center;padding:11px 16px}}
table.table-matches th.t-bn{{width:calc((100% - 312px) / 2);text-align:left;padding-left:16px}}
table.table-matches th.t-wn{{width:calc((100% - 312px) / 2);text-align:right;padding-right:16px}}

.ph-nums{{display:grid;grid-template-columns:1fr 1fr 1fr;align-items:baseline}}
.ph-nums i{{font-style:normal;font:400 13px/1 var(--dis);letter-spacing:.07em;color:#2c5b49}}
.ph-nums i:nth-child(1){{text-align:left}}
.ph-nums i:nth-child(2){{text-align:center}}
.ph-nums i:nth-child(3){{text-align:right}}

tbody tr{{border-bottom:1px solid var(--line2);transition:background .15s}}
tbody tr:last-child{{border-bottom:0}}
td{{padding:10px;vertical-align:middle}}

td.c-no{{text-align:center;width:52px;font:400 14.5px/1 var(--num);letter-spacing:.02em;color:var(--ink3)}}
td.c-bn{{text-align:left;padding-left:16px;white-space:nowrap;overflow:hidden}}
td.c-wn{{text-align:right;padding-right:16px;white-space:nowrap;overflow:hidden}}

.pn{{
  font:400 16px/1.25 var(--dis);letter-spacing:.01em;color:var(--ink);
  display:inline-block;vertical-align:middle;max-width:calc(100% - 45px);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}}
.pid{{
  display:inline-block;min-width:26px;text-align:center;
  font:400 13px/1 var(--num);letter-spacing:.02em;
  color:#8d978f;background:#f1f0e8;
  border-radius:5px;padding:4px 5px 3px;margin:0 8px;vertical-align:2px;
}}
td.c-bn .pid{{margin-left:0}}
td.c-wn .pid{{margin-right:0}}

.pscore{{
  display:inline-block;padding:1px 6px;margin:0 4px;
  font-size:12px;color:var(--ink3);background:var(--line2);
  border-radius:10px;vertical-align:middle;font-family:var(--num);
}}

td.c-prob{{width:260px;padding:11px 16px}}
.m-res{{text-align:center;margin-bottom:6px}}
.res-tag{{display:inline-block;font:400 12px/1 var(--num);letter-spacing:.04em;padding:2.5px 10px;border-radius:12px}}
.res-b{{background:#ddefe5;color:#0d4736}}
.res-w{{background:#e8edf5;color:#1e3a5f}}
.res-d{{background:#f5edd6;color:#7a5a10}}

.bar{{display:flex;height:8px;border-radius:99px;overflow:hidden;background:#f0eee5;gap:1.5px}}
.bar i{{display:block;height:100%}}
.bar .s-b{{background:linear-gradient(180deg,#1a5f49,#0d4736)}}
.bar .s-d{{background:linear-gradient(180deg,#e6b273,#cf8f45)}}
.bar .s-w{{background:linear-gradient(180deg,#cfdbd4,#b6c8bf)}}

.nums{{display:grid;grid-template-columns:1fr 1fr 1fr;margin-top:8px}}
.n{{display:flex;flex-direction:column;gap:5px;min-width:0}}
.n:nth-child(1){{justify-self:start;align-items:flex-start}}
.n:nth-child(2){{justify-self:center;align-items:center}}
.n:nth-child(3){{justify-self:end;align-items:flex-end}}
.n em{{display:none;font-style:normal;font:400 10px/1 var(--dis);letter-spacing:.1em;color:#a3aca5}}

.v{{
  display:inline-block;text-align:center;white-space:nowrap;
  font:400 16px/1 var(--num);letter-spacing:.01em;
  color:var(--ink3);padding:6px 7px 5px;border-radius:8px;
  transition:background .15s;
}}
.v i{{font-style:normal;font-size:.66em;font-weight:400;opacity:.66;margin-left:1.5px}}
.v.top.pos{{background:var(--pos-bg);color:var(--green);font-weight:600}}
.v.bold{{font-weight:600;color:var(--ink)}}

/* 详情表格（桌面端） */
.table-scroll{{width:100%}}
table.table-standings{{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}}
table.table-standings thead th{{
  background:var(--mint);font:400 13px/1 var(--dis);letter-spacing:.05em;color:#2c5b49;
  padding:12px 10px;border-bottom:1px solid #d3e5db;white-space:nowrap;
}}
.c-pn-std{{text-align:left;white-space:nowrap;padding-left:18px}}
.c-pn-std .pid{{margin-left:0;margin-right:8px}}
.c-pct-std{{text-align:center;white-space:nowrap}}
table.table-standings .v{{background:transparent;padding:3px 6px;border-radius:6px;transition:background .15s}}
table.table-standings .v.is-100{{background:var(--pos-bg)!important;color:var(--green)!important;font-weight:700}}
table.table-standings .v.bold{{color:var(--ink);font-weight:600}}
.c-exp-std{{text-align:center;white-space:nowrap}}
.exp-badge{{
  display:inline-block;font:600 14px/1 var(--num);padding:0;
  background:transparent!important;color:var(--ink);
}}
.exp-lbl{{display:none;font-style:normal;font-size:11px;opacity:.7}}
.c-dist-std{{text-align:right;padding-right:18px}}

/* 主行交互 */
tr.player-row{{cursor:pointer;transition:background .15s ease}}
tr.player-row:hover{{background:var(--mint2)}}
tr.player-row.is-open{{background:var(--mint2);border-bottom-color:transparent}}

.dist-preview-wrap{{display:inline-flex;align-items:center;gap:10px;justify-content:flex-end}}
.mini-hm-bar{{
  display:inline-flex;height:10px;width:120px;border-radius:3px;overflow:hidden;
  border:1px solid var(--line);flex-shrink:0;vertical-align:middle;
}}
.m-seg{{flex:1;height:100%}}

.btn-expand{{
  border:1px solid var(--line);background:var(--card);color:var(--ink3);
  font:500 12px/1 var(--dis);padding:4px 9px 4px;border-radius:6px;cursor:pointer;
  display:inline-flex;align-items:center;gap:3px;transition:all .15s ease;
}}
.btn-expand:hover{{border-color:var(--green);color:var(--green);background:var(--mint)}}
.btn-expand .arr{{font-style:normal;font-size:11px}}

.btn-all-exp{{
  border:none;background:rgba(13,71,54,.08);color:var(--green);
  font:500 12px/1 var(--dis);padding:4px 8px 3px;border-radius:5px;cursor:pointer;
  transition:all .15s ease;
}}
.btn-all-exp:hover{{background:rgba(13,71,54,.15)}}

/* 手机端置顶快捷栏（桌面端隐藏） */
.standings-mobile-bar{{display:none}}

/* 展开详情行 */
tr.detail-row{{display:none;background:#faf8f2;border-bottom:1px solid var(--line2)}}
tr.detail-row.is-open{{display:table-row}}
td.detail-cell{{padding:10px 18px 16px}}
.detail-wrap{{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px 14px;box-shadow:0 3px 10px rgba(0,0,0,.03)}}
.hm-header{{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}}
.hm-title{{font:600 13px/1 var(--dis);color:var(--green);display:flex;align-items:center;gap:5px}}
.hm-title::before{{content:"◆";font-size:10px;color:var(--green)}}
.hm-hint{{display:none;font-size:11px;color:var(--ink3);font-family:var(--dis)}}

/* 连贯热力图格子（格子连着） */
.hm-scroll{{overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:2px}}
.hm-grid{{
  display:grid;grid-template-columns:repeat(16,minmax(48px,1fr));
  border:1px solid var(--line);border-radius:8px;overflow:hidden;
  background:var(--card);width:100%;
}}
.hm-cell{{
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding:7px 2px 6px;border-right:1px solid var(--line);
  box-sizing:border-box;text-align:center;min-width:0;
  transition:all .12s ease;
}}
.hm-cell:last-child{{border-right:none}}
.hm-cell:hover{{filter:brightness(0.96)}}
.hm-rk{{font-size:11px;line-height:1;font-family:var(--dis);opacity:.8;margin-bottom:4px}}
.hm-val{{font-size:11.5px;line-height:1.15;font-family:var(--num);white-space:nowrap}}
.hm-val.hm-zero{{opacity:.3;font-weight:400}}

/* 热力梯度色彩 */
.hm-lvl-0{{background:#fbfaf6;color:#a9b3ab}}
.hm-lvl-1{{background:#eef6f2;color:#1e4f3c;font-weight:500}}
.hm-lvl-2{{background:#ddefe5;color:#0d4736;font-weight:600}}
.hm-lvl-3{{background:#b8e2cd;color:#0a3a2c;font-weight:600}}
.hm-lvl-4{{background:#68bc96;color:#ffffff;font-weight:700}}
.hm-lvl-5{{background:#23835f;color:#ffffff;font-weight:700}}
.hm-lvl-6{{background:#0d4736;color:#ffffff;font-weight:700}}

/* 移动端与窄屏适配 */
@media (max-width:820px){{
  body{{padding:10px 10px 24px}}
  .sheet{{max-width:none}}
  .hd{{padding:14px 14px 12px}}
  .hd h1{{font-size:18.5px;line-height:1.4;white-space:normal}}
  .hd-row{{margin-top:8px;flex-direction:column;align-items:flex-start;gap:10px}}
  .hd-sub{{width:100%;justify-content:space-between;gap:8px}}
  .rd-nav{{flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;max-width:100%;padding-bottom:3px}}
  .rd-nav::-webkit-scrollbar{{display:none}}
  .rd-tab{{flex-shrink:0;padding:5px 8px 4px;font-size:12px}}
  .view-switch{{width:100%;display:flex}}
  .v-btn{{flex:1;text-align:center}}
  
  /* 对阵表响应式卡片 */
  table.table-matches, table.table-matches tbody, table.table-matches tr, table.table-matches td{{display:block}}
  table.table-matches thead{{display:none}}
  table.table-matches tbody tr{{
    display:grid;grid-template-columns:30px minmax(0,1fr) minmax(0,1fr);
    grid-template-areas:
      "no bh wn"
      "pb pb pb";
    align-items:center;gap:10px 10px;padding:12px 14px 13px;
    border-bottom:1px solid var(--line2);
  }}
  table.table-matches td.c-bn{{grid-area:bh;text-align:left;min-width:0;overflow:hidden;padding:0!important;width:auto!important}}
  table.table-matches td.c-wn{{grid-area:wn;text-align:right;min-width:0;overflow:hidden;padding:0!important;width:auto!important}}
  table.table-matches td.c-prob{{grid-area:pb;padding:0!important;width:auto!important}}
  table.table-matches td.c-bn .pn, table.table-matches td.c-wn .pn{{max-width:calc(100% - 62px);font-size:14px}}
}}

/* 针对手机端 (<= 640px) 详情卡片化重构 */
@media (max-width:640px){{
  .standings-mobile-bar{{
    display:flex;justify-content:space-between;align-items:center;
    padding:9px 14px;background:var(--mint);border-bottom:1px solid #d3e5db;
    font:500 13px/1 var(--dis);color:#2c5b49;
  }}
  
  table.table-standings{{display:block;width:100%}}
  table.table-standings thead{{display:none}}
  table.table-standings tbody{{display:block}}
  
  tr.player-row{{
    display:grid;
    grid-template-columns:1fr 1fr 1fr;
    grid-template-areas:
      "name name exp"
      "t1   t3   t8"
      "bar  bar  bar";
    padding:13px 14px;
    gap:9px 8px;
    border-bottom:1px solid var(--line2);
    align-items:center;
  }}
  
  td.c-pn-std{{
    grid-area:name;padding:0!important;text-align:left;
    display:flex;align-items:center;overflow:hidden;
  }}
  td.c-pn-std .pn{{font-size:15px;max-width:calc(100% - 40px)}}
  
  td.c-exp-std{{
    grid-area:exp;padding:0!important;text-align:right;
    display:flex;justify-content:flex-end;align-items:center;
  }}
  .exp-lbl{{display:inline}}
  .exp-badge{{font-size:12px;padding:0;background:transparent!important}}
  
  /* 指标卡片小块 */
  td.m-stat{{
    padding:0!important;display:flex;flex-direction:column;align-items:center;
    background:var(--paper);border-radius:6px;padding:6px 2px 5px!important;
  }}
  td.m-stat::before{{
    content:attr(data-label);
    font-size:11px;line-height:1;color:var(--ink3);margin-bottom:4px;
    font-family:var(--dis);letter-spacing:.02em;
  }}
  td.m-stat:nth-of-type(2){{grid-area:t1}}
  td.m-stat:nth-of-type(3){{grid-area:t3}}
  td.m-stat:nth-of-type(4){{grid-area:t8}}
  td.m-stat .v{{font-size:14px;padding:2px 5px;background:transparent}}
  td.m-stat .v.is-100{{background:var(--pos-bg)!important;color:var(--green)!important;font-weight:700;border-radius:4px}}
  td.m-stat .v.bold{{color:var(--ink);font-weight:600}}
  
  td.c-dist-std{{
    grid-area:bar;padding:0!important;width:100%;
  }}
  .dist-preview-wrap{{
    width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;
  }}
  .mini-hm-bar{{flex:1;width:auto!important;height:11px}}
  .btn-expand{{padding:4px 8px;font-size:11.5px}}
  
  /* 手机端详情展开行 */
  tr.detail-row{{display:none}}
  tr.detail-row.is-open{{display:block!important}}
  td.detail-cell{{display:block;padding:8px 12px 14px!important}}
  .detail-wrap{{padding:10px 10px 12px}}
  .hm-header{{margin-bottom:6px}}
  .hm-hint{{display:inline-block}}
  .hm-grid{{
    grid-template-columns:repeat(16,minmax(42px,1fr));
    min-width:672px;
  }}
  .hm-cell{{padding:6px 1px 5px}}
  .hm-rk{{font-size:10px;margin-bottom:2px}}
  .hm-val{{font-size:10.5px}}
}}

@media (max-width:400px){{
  body{{padding:8px 8px 20px}}
  .hd{{padding:12px 12px 10px}}
  .hd h1{{font-size:17px}}
  tr.player-row{{padding:11px 12px}}
  td.m-stat .v{{font-size:13px}}
}}

@media (prefers-color-scheme:dark){{
  body{{background:#121614;color:#e9efe9}}
  .card{{background:#181d1a;border-color:#26332c}}
  .hd{{border-color:#26332c}}
  .hd h1{{color:#eef4ef}}
  .hd h1 em{{color:#8fc7ae}}
  .hd-sub{{color:#7f8d85}}
  .rd-nav .rd-tab{{background:#232d28;color:#85928a}}
  .rd-nav .rd-tab:hover{{background:#1e2a24;color:#93d3b6}}
  .rd-nav .rd-tab.active{{background:#2c5b49;color:#fff}}
  .view-switch{{background:#232d28}}
  .v-btn{{color:#85928a}}
  .v-btn.active{{background:#1e2a24;color:#93d3b6}}
  table.table-matches thead th, table.table-standings thead th, .standings-mobile-bar{{
    background:#1e2a24;color:#8fc7ae;border-color:#2b3a32;
  }}
  .ph-nums i{{color:#8fc7ae}}
  tbody tr{{border-color:#232d28}}
  tbody tr:nth-child(even){{background:#1a201c}}
  tbody tr:hover{{background:#1f2a24}}
  tr.player-row:hover{{background:#1f2a24}}
  tr.player-row.is-open{{background:#1e2822}}
  tr.detail-row{{background:#151b18;border-color:#232d28}}
  .detail-wrap{{background:#181d1a;border-color:#26332c}}
  .hm-title{{color:#93d3b6}}
  .hm-title::before{{color:#93d3b6}}
  .hm-hint{{color:#7f8d85}}
  .pn{{color:#e9efe9}}
  .pid{{background:#232d28;color:#85928a}}
  td.c-no{{color:#7f8d85}}
  .pscore{{background:#232d28;color:#85928a}}
  .exp-badge{{background:transparent!important;color:#eef4ef}}
  table.table-standings .v.is-100, td.m-stat .v.is-100{{background:rgba(143,199,174,.18)!important;color:#93d3b6!important}}
  table.table-standings .v.bold, td.m-stat .v.bold{{color:#eef4ef}}
  td.m-stat{{background:#151b18}}
  td.m-stat::before{{color:#7f8d85}}
  .mini-hm-bar{{border-color:#2b3a32}}
  .btn-expand{{background:#232d28;border-color:#2b3a32;color:#9ec2b0}}
  .btn-expand:hover{{background:#1e2a24;border-color:#385b49;color:#fff}}
  .btn-all-exp{{background:rgba(143,199,174,.12);color:#93d3b6}}
  .btn-all-exp:hover{{background:rgba(143,199,174,.22)}}
  .hm-grid{{border-color:#2b3a32;background:#181d1a}}
  .hm-cell{{border-right-color:#2b3a32}}
  .hm-lvl-0{{background:#1a201c;color:#5a665e}}
  .hm-lvl-1{{background:#172920;color:#8fc7ae}}
  .hm-lvl-2{{background:#1a382b;color:#a4e1c4}}
  .hm-lvl-3{{background:#1d4d39;color:#c0f2db}}
  .hm-lvl-4{{background:#256b4f;color:#ffffff}}
  .hm-lvl-5{{background:#1e875e;color:#ffffff}}
  .hm-lvl-6{{background:#146e4b;color:#ffffff}}
}}
</style>
<script>
function setView(view) {{
  var viewMatches = document.getElementById('view-matches');
  var viewStandings = document.getElementById('view-standings');
  var btnMatch = document.getElementById('btn-match');
  var btnStand = document.getElementById('btn-stand');
  if (view === 'stand') {{
    viewMatches.style.display = 'none';
    viewStandings.style.display = 'block';
    btnMatch.classList.remove('active');
    btnStand.classList.add('active');
    if (history.replaceState) history.replaceState(null, null, '#details');
  }} else {{
    viewMatches.style.display = 'block';
    viewStandings.style.display = 'none';
    btnMatch.classList.add('active');
    btnStand.classList.remove('active');
    if (history.replaceState) history.replaceState(null, null, '#matches');
  }}
}}

function toggleRow(idx) {{
  var dRow = document.getElementById('detail-' + idx);
  var pRow = document.getElementById('prow-' + idx);
  var btn = document.getElementById('btn-exp-' + idx);
  if (!dRow) return;
  var isOpen = dRow.classList.toggle('is-open');
  if (pRow) pRow.classList.toggle('is-open', isOpen);
  if (btn) btn.innerHTML = isOpen ? '<span>收起</span><i class="arr">▴</i>' : '<span>展开</span><i class="arr">▾</i>';
}}

var allExpanded = false;
function toggleAllRows() {{
  allExpanded = !allExpanded;
  var dRows = document.querySelectorAll('.detail-row');
  var pRows = document.querySelectorAll('.player-row');
  var btns = document.querySelectorAll('.btn-expand');
  var btnAlls = document.querySelectorAll('.btn-all-exp');
  
  for (var i = 0; i < dRows.length; i++) {{
    if (allExpanded) dRows[i].classList.add('is-open');
    else dRows[i].classList.remove('is-open');
  }}
  for (var j = 0; j < pRows.length; j++) {{
    if (allExpanded) pRows[j].classList.add('is-open');
    else pRows[j].classList.remove('is-open');
  }}
  for (var k = 0; k < btns.length; k++) {{
    btns[k].innerHTML = allExpanded ? '<span>收起</span><i class="arr">▴</i>' : '<span>展开</span><i class="arr">▾</i>';
  }}
  for (var m = 0; m < btnAlls.length; m++) {{
    btnAlls[m].textContent = allExpanded ? '全部收起 ▴' : '全部展开 ▾';
  }}
}}

window.addEventListener('DOMContentLoaded', function() {{
  if (window.location.hash === '#details' || window.location.hash === '#standings') {{
    setView('stand');
  }}
}});
</script>
</head>
<body>
<div class="sheet">
  <div class="card">
    <div class="hd">
      <h1><em>「世青赛」</em><span class="yr">2026</span> 年第 14 届世界青少年连珠锦标赛</h1>
      <div class="hd-row">
        <div class="hd-sub">
          <span>男子青年组（B组）</span>
          <div class="rd-nav">
            <a class="rd-tab" href="2026-shiqing-b-r1.html">第 1 轮</a>
            <a class="rd-tab" href="2026-shiqing-b-r2.html">第 2 轮</a>
            <a class="rd-tab" href="2026-shiqing-b-r3.html">第 3 轮</a>
            <a class="rd-tab" href="2026-shiqing-b-r4.html">第 4 轮</a>
            <a class="rd-tab" href="2026-shiqing-b-r5.html">第 5 轮</a>
            <a class="rd-tab" href="2026-shiqing-b-r6.html">第 6 轮</a>
            <a class="rd-tab active" href="2026-shiqing-b-r7.html">第 7 轮</a>
          </div>
        </div>
        <div class="view-switch">
          <button class="v-btn active" id="btn-match" onclick="setView('match')">对阵表</button>
          <button class="v-btn" id="btn-stand" onclick="setView('stand')">详情</button>
        </div>
      </div>
    </div>

    <!-- 视图 1：第 7 轮对阵表 -->
    <div id="view-matches">
      <table class="table-matches">
        <thead>
          <tr>
            <th class="t-no">台号</th>
            <th class="t-bn">假先方</th>
            <th class="t-prob">
              <span class="ph-nums"><i>假先胜率</i><i>和棋率</i><i>假后胜率</i></span>
            </th>
            <th class="t-wn">假后方</th>
          </tr>
        </thead>
        <tbody>
{matches_tbody}
        </tbody>
      </table>
    </div>

    <!-- 视图 2：模拟 10,000,000 次名次概率分布表（自适应手机端卡片与展开热力图） -->
    <div id="view-standings" style="display:none">
      <div class="standings-mobile-bar">
        <span>名次概率预测</span>
        <button class="btn-all-exp" type="button" onclick="toggleAllRows()">全部展开 ▾</button>
      </div>
      <div class="table-scroll">
        <table class="table-standings">
          <thead>
            <tr>
              <th style="width:220px;text-align:left;padding-left:18px">棋手</th>
              <th style="width:95px;text-align:center">夺冠率</th>
              <th style="width:95px;text-align:center">前三率</th>
              <th style="width:95px;text-align:center">前八率</th>
              <th style="width:95px;text-align:center">期望名次</th>
              <th style="text-align:right;padding-right:18px">
                <button class="btn-all-exp" id="btn-all-exp" type="button" onclick="toggleAllRows()">全部展开 ▾</button>
              </th>
            </tr>
          </thead>
          <tbody>
{standings_tbody}
          </tbody>
        </table>
      </div>
    </div>

  </div>
</div>
</body>
</html>
"""

# Write to 2026-shiqing-b-r7.html
r7_path = os.path.join(REPO_DIR, "posts", "2026-shiqing-b-r7.html")
with open(r7_path, "w", encoding="utf-8") as f:
    f.write(full_page_html)

# Also write to standalone details page
det_html = full_page_html.replace('id="view-matches"', 'id="view-matches" style="display:none"')
det_html = det_html.replace('id="view-standings" style="display:none"', 'id="view-standings"')
det_html = det_html.replace('id="btn-match" class="v-btn active"', 'id="btn-match" class="v-btn"')
det_html = det_html.replace('id="btn-stand" class="v-btn"', 'id="btn-stand" class="v-btn active"')

details_path = os.path.join(REPO_DIR, "posts", "2026-shiqing-b-details.html")
with open(details_path, "w", encoding="utf-8") as f:
    f.write(det_html)

print("Successfully generated 2026-shiqing-b-r7.html and 2026-shiqing-b-details.html!")
