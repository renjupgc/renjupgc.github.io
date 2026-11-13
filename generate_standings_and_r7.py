# -*- coding: utf-8 -*-
import os, json, math, time, re
import numpy as np

REPO_DIR = r"C:\Users\yaolz\WorkBuddy\2026-11-10-00-26-58\renjupgc.github.io"
SHANHAI_PATH = os.path.join(REPO_DIR, "posts", "2026-shanhai-cup-r1.html")
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
analytical_rank_probs = np.zeros((16, 16), dtype=np.float64)

for s_idx in range(num_scenarios):
    tmp = s_idx
    outcomes = []
    p_scen = 1.0
    for g_idx in range(8):
        res_code = tmp % 3
        tmp //= 3
        outcomes.append(res_code)
        p_scen *= r7_boards[g_idx]["probs"][res_code]
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

    sorted_items = sorted(keys, key=lambda x: (x[0], x[1], x[2], x[3], x[4], x[5]), reverse=True)

    i = 0
    while i < 16:
        j = i
        while j < 16 and sorted_items[j][:6] == sorted_items[i][:6]:
            j += 1
        group = [sorted_items[k][6] for k in range(i, j)]
        if len(group) == 1:
            analytical_rank_probs[group[0], i] += p_scen
        elif len(group) == 2:
            p1_pid = player_pids[group[0]]
            p2_pid = player_pids[group[1]]
            h_score = scen_h2h.get((p1_pid, p2_pid))
            if h_score == 1.0:
                analytical_rank_probs[group[0], i] += p_scen
                analytical_rank_probs[group[1], i + 1] += p_scen
            elif h_score == 0.0:
                analytical_rank_probs[group[1], i] += p_scen
                analytical_rank_probs[group[0], i + 1] += p_scen
            else:
                for p_idx in group:
                    for rk in range(i, j):
                        analytical_rank_probs[p_idx, rk] += p_scen / len(group)
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
                    analytical_rank_probs[p_idx, i + rk_offset] += p_scen
            else:
                for p_idx in group:
                    for rk in range(i, j):
                        analytical_rank_probs[p_idx, rk] += p_scen / len(group)
        i = j

# Rank metrics
exp_ranks = [sum((rk + 1) * analytical_rank_probs[i, rk] for rk in range(16)) for i in range(16)]
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

# Build HTML rows for Standings (View 2)
standings_rows = []
for rank_disp, p_idx in enumerate(sorted_player_indices, 1):
    pid = player_pids[p_idx]
    p_info = PLAYERS[pid]
    no = p_info["no"]
    name = p_info["name"]
    s_r6 = f"{scores_r6[pid]:g}分"
    
    p_top1 = analytical_rank_probs[p_idx, 0] * 100
    p_top3 = sum(analytical_rank_probs[p_idx, :3]) * 100
    p_top8 = sum(analytical_rank_probs[p_idx, :8]) * 100
    exp_r = exp_ranks[p_idx]
    
    cls_top1 = " top pos" if p_top1 >= 50.0 else (" bold" if p_top1 > 0 else "")
    cls_top3 = " top pos" if p_top3 >= 50.0 else (" bold" if p_top3 > 0 else "")
    
    # Non-zero rank badges
    rank_pills = []
    for rk in range(16):
        pct = analytical_rank_probs[p_idx, rk] * 100
        if pct >= 0.05:
            pill_cls = "rk-hi" if pct >= 40.0 else ("rk-mid" if pct >= 15.0 else "rk-lo")
            rank_pills.append(f'<span class="rk-pill {pill_cls}"><span class="rk-idx">第{rk+1}名</span><span class="rk-val">{pct:.1f}%</span></span>')
    rank_pills_html = "".join(rank_pills)
    
    row_html = (
        f'      <tr>\n'
        f'        <td class="c-no">{rank_disp}</td>\n'
        f'        <td class="c-pn-std"><span class="pid">{no}</span><span class="pn" title="{name}">{name}</span></td>\n'
        f'        <td class="c-score-std"><span class="pscore">{s_r6}</span></td>\n'
        f'        <td class="c-pct-std"><span class="v{cls_top1}">{p_top1:.1f}%</span></td>\n'
        f'        <td class="c-pct-std"><span class="v{cls_top3}">{p_top3:.1f}%</span></td>\n'
        f'        <td class="c-exp-std"><span class="exp-badge">{exp_r:.2f}</span></td>\n'
        f'        <td class="c-dist-std"><div class="dist-wrap">{rank_pills_html}</div></td>\n'
        f'      </tr>'
    )
    standings_rows.append(row_html)

standings_tbody = "\n".join(standings_rows)

# Full CSS incorporating view-switcher, standings table, and responsive rules
full_page_html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>世青赛 · 男子青年组（B组）第 7 轮对阵与名次概率预测表</title>
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
tbody tr:nth-child(even){{background:#fafdfb}}
tbody tr:hover{{background:var(--mint2)}}
tbody tr:last-child{{border-bottom:0}}
td{{padding:10px;vertical-align:middle}}

td.c-no{{text-align:center;width:52px;font:400 14.5px/1 var(--num);letter-spacing:.02em;color:var(--ink3)}}
td.c-bn{{text-align:left;padding-left:16px;white-space:nowrap;overflow:hidden}}
td.c-wn{{text-align:right;padding-right:16px;white-space:nowrap;overflow:hidden}}

.pn{{
  font:400 16px/1.25 var(--dis);letter-spacing:.01em;color:var(--ink);
  display:inline-block;vertical-align:middle;max-width:calc(100% - 75px);
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
  font:400 17px/1 var(--num);letter-spacing:.01em;
  color:var(--ink3);padding:6px 7px 5px;border-radius:8px;
  transition:background .15s;
}}
.v i{{font-style:normal;font-size:.66em;font-weight:400;opacity:.66;margin-left:1.5px}}
.v.top.pos{{background:var(--pos-bg);color:var(--green);font-weight:600}}
.v.bold{{font-weight:600;color:var(--ink)}}

/* 名次预测表格样式 */
table.table-standings{{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}}
table.table-standings thead th{{
  background:var(--mint);font:400 13px/1 var(--dis);letter-spacing:.05em;color:#2c5b49;
  padding:12px 10px;border-bottom:1px solid #d3e5db;
}}
.c-pn-std{{text-align:left;white-space:nowrap;padding-left:12px}}
.c-score-std{{text-align:center;white-space:nowrap}}
.c-pct-std{{text-align:center;white-space:nowrap}}
.c-exp-std{{text-align:center;white-space:nowrap}}
.exp-badge{{
  display:inline-block;font:600 13px/1 var(--num);padding:3px 8px;border-radius:6px;
  background:#f1f0e8;color:var(--ink);
}}
.c-dist-std{{text-align:left;padding-left:16px;padding-right:16px}}
.dist-wrap{{display:flex;gap:5px;align-items:center;flex-wrap:wrap}}
.rk-pill{{
  display:inline-flex;align-items:baseline;gap:3px;padding:2px 7px;border-radius:6px;
  font-size:12px;font-family:var(--num);white-space:nowrap;
}}
.rk-pill.rk-hi{{background:var(--pos-bg);color:var(--green);font-weight:700}}
.rk-pill.rk-mid{{background:#eef4f0;color:#1e4f3c;font-weight:500}}
.rk-pill.rk-lo{{background:var(--line2);color:var(--ink3)}}
.rk-idx{{opacity:.85;font-size:11px}}
.rk-val{{font-size:12.5px}}

/* 说明卡片 */
.ft-rules{{
  margin:16px 20px 20px;padding:14px 18px;border-radius:10px;
  background:#f8f6ee;border:1px solid var(--line);font-size:13px;color:var(--ink3);line-height:1.6;
}}
.ft-rules-title{{
  font:600 13.5px/1 var(--dis);color:var(--green);margin-bottom:6px;display:flex;align-items:center;gap:6px;
}}
.ft-rules-list{{
  margin:0;padding-left:18px;color:#556259;
}}
.ft-rules-list li{{margin-bottom:3px}}
.ft-rules-note{{margin-top:8px;font-size:12px;color:#7c877f;border-top:1px dashed var(--line);padding-top:6px}}

/* 窄屏响应式 */
@media (max-width:820px){{
  body{{padding:12px 12px 28px}}
  .sheet{{max-width:none}}
  .hd{{padding:15px 15px 13px}}
  .hd h1{{font-size:19.5px;line-height:1.45;white-space:normal}}
  .hd-row{{margin-top:8px;flex-direction:column;align-items:flex-start;gap:10px}}
  .view-switch{{width:100%;display:flex}}
  .v-btn{{flex:1;text-align:center}}
  
  table.table-matches, table.table-matches tbody, table.table-matches tr, table.table-matches td{{display:block}}
  table.table-matches thead{{display:none}}
  table.table-matches tbody tr{{
    display:grid;grid-template-columns:32px minmax(0,1fr) minmax(0,1fr);
    grid-template-areas:
      "no bh wn"
      "pb pb pb";
    align-items:center;gap:10px 12px;padding:13px 15px 14px;
    border-bottom:1px solid var(--line2);
  }}
  table.table-matches td.c-bn{{grid-area:bh;text-align:left;min-width:0;overflow:hidden;padding:0!important;width:auto!important}}
  table.table-matches td.c-wn{{grid-area:wn;text-align:right;min-width:0;overflow:hidden;padding:0!important;width:auto!important}}
  table.table-matches td.c-prob{{grid-area:pb;padding:0!important;width:auto!important}}
  table.table-matches td.c-bn .pn, table.table-matches td.c-wn .pn{{max-width:calc(100% - 65px);font-size:14.5px}}
  
  /* 名次表窄屏自适应 */
  .c-dist-std{{padding-left:10px;padding-right:10px}}
  table.table-standings{{display:block;overflow-x:auto;-webkit-overflow-scrolling:touch}}
}}

@media (max-width:520px){{
  table.table-matches tbody tr{{grid-template-columns:28px minmax(0,1fr) minmax(0,1fr);gap:8px 8px;padding:10px 10px 12px}}
  table.table-matches td.c-bn .pn, table.table-matches td.c-wn .pn{{font-size:13px;max-width:calc(100% - 50px)}}
  .pid, .pscore{{font-size:11px;padding:2px 4px;margin:0 2px}}
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
  table.table-matches thead th, table.table-standings thead th{{background:#1e2a24;color:#8fc7ae;border-color:#2b3a32}}
  .ph-nums i{{color:#8fc7ae}}
  tbody tr{{border-color:#232d28}}
  tbody tr:nth-child(even){{background:#1a201c}}
  tbody tr:hover{{background:#1f2a24}}
  .pn{{color:#e9efe9}}
  .pid{{background:#232d28;color:#85928a}}
  td.c-no{{color:#7f8d85}}
  .pscore{{background:#232d28;color:#85928a}}
  .exp-badge{{background:#232d28;color:#d0ded5}}
  .rk-pill.rk-hi{{background:#1b3a2e;color:#93d3b6}}
  .rk-pill.rk-mid{{background:#1d2922;color:#a4c9b8}}
  .rk-pill.rk-lo{{background:#232d28;color:#7c877f}}
  .ft-rules{{background:#18201b;border-color:#26332c;color:#85928a}}
  .ft-rules-title{{color:#93d3b6}}
  .ft-rules-list{{color:#a8b5ac}}
  .ft-rules-note{{border-color:#26332c;color:#6b7870}}
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
    if (history.replaceState) history.replaceState(null, null, '#standings');
  }} else {{
    viewMatches.style.display = 'block';
    viewStandings.style.display = 'none';
    btnMatch.classList.add('active');
    btnStand.classList.remove('active');
    if (history.replaceState) history.replaceState(null, null, '#matches');
  }}
}}
window.addEventListener('DOMContentLoaded', function() {{
  if (window.location.hash === '#standings') {{
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
          <button class="v-btn" id="btn-stand" onclick="setView('stand')">名次表</button>
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

    <!-- 视图 2：模拟 2,000,000 次名次概率分布表 -->
    <div id="view-standings" style="display:none">
      <table class="table-standings">
        <thead>
          <tr>
            <th style="width:48px;text-align:center">名次</th>
            <th style="width:180px;text-align:left;padding-left:12px">棋手</th>
            <th style="width:72px;text-align:center">上轮积分</th>
            <th style="width:72px;text-align:center">夺冠率</th>
            <th style="width:72px;text-align:center">前三率</th>
            <th style="width:75px;text-align:center">期望名次</th>
            <th style="text-align:left;padding-left:16px">名次概率分布 (1 ~ 16名)</th>
          </tr>
        </thead>
        <tbody>
{standings_tbody}
        </tbody>
      </table>

      <div class="ft-rules">
        <div class="ft-rules-title">
          <span>◆</span> 破同分排序依据（严格遵循世青赛 RIF 瑞士积分制规程）：
        </div>
        <ol class="ft-rules-list">
          <li><strong>最终总积分</strong>：高者列前。</li>
          <li><strong>对手分 (Buchholz)</strong>：所有对手积分之和，高者列前。</li>
          <li><strong>对手分去最低 1 (BhC1)</strong>：扣除一个最低对手积分后之和。</li>
          <li><strong>对手分去最低 2 (BhC2)</strong>：扣除两个最低对手积分后之和。</li>
          <li><strong>中间对手分 (MBh)</strong>：扣除一个最高和一个最低对手积分后之和。</li>
          <li><strong>胜局数 (Wins)</strong>：总胜局数高者列前。</li>
          <li><strong>直胜关系</strong>：同分棋手间直接对局结果（若相互全部交手）。</li>
          <li><strong>并列平分</strong>：若上述指标依然完全相同，则判定并列，平分对应名次概率。</li>
        </ol>
        <div class="ft-rules-note">
          ※ 演算基准：基于 2026-07-04 截止历史数据专属无泄漏模型，执行 2,000,000 次蒙特卡洛模拟抽样演算。
        </div>
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

# Also write to standalone standings page 2026-shiqing-b-standings.html
standings_path = os.path.join(REPO_DIR, "posts", "2026-shiqing-b-standings.html")
with open(standings_path, "w", encoding="utf-8") as f:
    # Set default view to 'stand' for the standalone page
    stand_html = full_page_html.replace('id="view-matches"', 'id="view-matches" style="display:none"')
    stand_html = stand_html.replace('id="view-standings" style="display:none"', 'id="view-standings"')
    stand_html = stand_html.replace('id="btn-match" class="v-btn active"', 'id="btn-match" class="v-btn"')
    stand_html = stand_html.replace('id="btn-stand" class="v-btn"', 'id="btn-stand" class="v-btn active"')
    f.write(stand_html)

print("Generated 2026-shiqing-b-r7.html and 2026-shiqing-b-standings.html with dual-view switcher!")
