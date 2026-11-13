# -*- coding: utf-8 -*-
import os, json, math, re

REPO_DIR = r"C:\Users\yaolz\WorkBuddy\2026-11-10-00-26-58\renjupgc.github.io"
SHANHAI_PATH = os.path.join(REPO_DIR, "posts", "2026-shanhai-cup-r1.html")
PIT_GB_PATH = r"C:\Users\yaolz\Downloads\whr_renju-master\whr_renju-master\data\game_base_20260704_renju.json"
LATEST_GB_PATH = r"C:\Users\yaolz\Downloads\whr_renju-master\whr_renju-master\data\game_base_20261112_renju.json"
MODEL_PATH = os.path.join(REPO_DIR, "bisai", "data", "model_20260704.json")

# Read shanhai-cup HTML template
with open(SHANHAI_PATH, "r", encoding="utf-8") as f:
    shanhai_html = f.read()

# Extra CSS for result badge and round navigation selector
extra_css = """
.m-res{text-align:center;margin-bottom:6px}
.res-tag{display:inline-block;font:400 12px/1 var(--num);letter-spacing:.04em;padding:2.5px 10px;border-radius:12px}
.res-b{background:#ddefe5;color:#0d4736}
.res-w{background:#e8edf5;color:#1e3a5f}
.res-d{background:#f5edd6;color:#7a5a10}

/* 选轮导航 */
.rd-nav{display:inline-flex;gap:5px;align-items:center;flex-wrap:wrap;margin-left:12px;vertical-align:middle}
.rd-tab{
  font:400 13px/1 var(--num);letter-spacing:.03em;
  color:var(--ink3);background:var(--line2);
  border-radius:6px;padding:5px 9px 4px;text-decoration:none;
  transition:all .15s ease;
}
.rd-tab:hover{background:var(--mint);color:var(--green)}
.rd-tab.active{font-weight:600;color:#fff;background:var(--green);box-shadow:0 2px 6px rgba(13,71,54,.25)}

@media (prefers-color-scheme:dark){
  .rd-nav .rd-tab{background:#232d28;color:#85928a}
  .rd-nav .rd-tab:hover{background:#1e2a24;color:#93d3b6}
  .rd-nav .rd-tab.active{background:#2c5b49;color:#fff}
}
"""

if ".rd-nav" not in shanhai_html:
    shanhai_html = shanhai_html.replace("</style>", extra_css + "</style>")

# Official player numbering (https://www.ljrenju.com/news/rif2026/ywc14.htm)
# Foreign players keep original Latin names (DO NOT translate)
PLAYERS = {
    "102574": {"no": 1, "name": "王鑫宇", "unit": "中国", "country_id": 5, "dr": 0.0132},
    "021042": {"no": 2, "name": "Barinov Random", "unit": "俄罗斯", "country_id": 2, "dr": 0.0333},
    "102459": {"no": 3, "name": "药博凡", "unit": "中国", "country_id": 5, "dr": 0.0847},
    "100963": {"no": 4, "name": "钟煜阳", "unit": "中国", "country_id": 5, "dr": 0.0951},
    "020975": {"no": 5, "name": "Startsev Maksim", "unit": "俄罗斯", "country_id": 2, "dr": 0.0748},
    "102695": {"no": 6, "name": "蔡嘉睦", "unit": "中国", "country_id": 5, "dr": 0.0597},
    "102702": {"no": 7, "name": "周士杰", "unit": "中国", "country_id": 5, "dr": 0.0530},
    "100732": {"no": 8, "name": "康庭瑞", "unit": "中国", "country_id": 5, "dr": 0.1614},
    "021171": {"no": 9, "name": "Vershinin Ivan", "unit": "俄罗斯", "country_id": 2, "dr": 0.1325},
    "102247": {"no": 10, "name": "潘冠臣", "unit": "中国", "country_id": 5, "dr": 0.0447},
    "101314": {"no": 11, "name": "丁泽宇", "unit": "中国", "country_id": 5, "dr": 0.0717},
    "101769": {"no": 12, "name": "陈浩源", "unit": "中国", "country_id": 5, "dr": 0.0528},
    "020961": {"no": 13, "name": "Noskov Pavel", "unit": "俄罗斯", "country_id": 2, "dr": 0.0356},
    "020959": {"no": 14, "name": "Sidorov Mikhail", "unit": "俄罗斯", "country_id": 2, "dr": 0.0999},
    "020978": {"no": 15, "name": "Kazantsev Konstantin", "unit": "俄罗斯", "country_id": 2, "dr": 0.0567},
    "100889": {"no": 16, "name": "李嘉骏", "unit": "中国", "country_id": 5, "dr": 0.0968}
}

with open(PIT_GB_PATH, "r", encoding="utf-8") as f:
    gb_pit = json.load(f)
pit_ratings = gb_pit.get("ratings", {})

# Load Point-in-Time ratings with 1900.0 offset matching the training scale
player_pit = {}
for pid, info in PLAYERS.items():
    r_list = pit_ratings.get(pid, [])
    if r_list:
        latest = r_list[-1]
        player_pit[pid] = {
            "r": latest[1] + 1900.0,
            "rd": latest[2]
        }
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
    # In LightGBM multi-class model:
    # class 0: white (假后) win
    # class 1: draw (和棋)
    # class 2: black (假先) win
    pw = round(probs[0] * 100, 1)
    pd = round(probs[1] * 100, 1)
    pb = round(100.0 - pw - pd, 1)
    return pb, pd, pw

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
    h2h = 0.5 # Neutral prior for no historical matchups
    c_b_id = PLAYERS[b_id]["country_id"]
    c_w_id = PLAYERS[w_id]["country_id"]
    return [22, rb, rw, diff, mean_r, stdb, stdw, j_std, dr_b, dr_w, comb_dr, h2h, c_b_id, c_w_id]

with open(LATEST_GB_PATH, "r", encoding="utf-8") as f:
    latest_data = json.load(f)
games_3597 = {gid: g for gid, g in latest_data["games"].items() if str(g.get("tournament")) == "3597"}

by_round = {}
for gid, g in games_3597.items():
    r = int(g["round"])
    by_round.setdefault(r, []).append((gid, g))

scores = {pid: 0.0 for pid in PLAYERS}

for r in range(1, 8):
    rgames = by_round[r]
    
    # 4-tier sorting
    def sort_key(item):
        gid, g = item
        b_id = g["black"]
        w_id = g["white"]
        sb = scores[b_id]
        sw = scores[w_id]
        nb = PLAYERS[b_id]["no"]
        nw = PLAYERS[w_id]["no"]
        hi_score = max(sb, sw)
        lo_score = min(sb, sw)
        if sb > sw:
            hi_no = nb
        elif sw > sb:
            hi_no = nw
        else:
            hi_no = min(nb, nw)
        min_no = min(nb, nw)
        return (-hi_score, -lo_score, hi_no, min_no)
        
    sorted_games = sorted(rgames, key=sort_key)
    
    rows = []
    for table_idx, (gid, g) in enumerate(sorted_games, 1):
        b_id = g["black"]
        w_id = g["white"]
        res = g["result"]
        
        p_b = PLAYERS[b_id]
        p_w = PLAYERS[w_id]
        
        sb = scores[b_id]
        sw = scores[w_id]
        sb_str = f"{sb:g}分"
        sw_str = f"{sw:g}分"
        
        if res == "B":
            res_str = "1 : 0"
            res_cls = "res-b"
        elif res == "W":
            res_str = "0 : 1"
            res_cls = "res-w"
        else:
            res_str = "0.5 : 0.5"
            res_cls = "res-d"
            
        f_vec = get_feat(b_id, w_id)
        pb, pd, pw = predict_gbdt(f_vec)
        
        top_val = max(pb, pd, pw)
        cls_b = " top pos" if pb == top_val else ""
        cls_d = " top" if pd == top_val else ""
        cls_w = " top pos" if pw == top_val else ""
        
        row_html = (
            f'      <tr>\n'
            f'        <td class="c-no">{table_idx}</td>\n'
            f'        <td class="c-bn"><span class="pid">{p_b["no"]}</span><span class="pn">{p_b["name"]}</span><span class="pscore">{sb_str}</span></td>\n'
            f'        <td class="c-prob">\n'
            f'          <div class="m-res"><span class="res-tag {res_cls}">{res_str}</span></div>\n'
            f'          <span class="bar" title="假先 {pb}% · 和 {pd}% · 假后 {pw}%"><i class="s-b" style="width:{pb:.2f}%"></i><i class="s-d" style="width:{pd:.2f}%"></i><i class="s-w" style="width:{pw:.2f}%"></i></span>\n'
            f'          <span class="nums"><span class="n"><em>假先</em><span class="v{cls_b}">{pb}<i>%</i></span></span><span class="n"><em>和棋</em><span class="v{cls_d}">{pd}<i>%</i></span></span><span class="n"><em>假后</em><span class="v{cls_w}">{pw}<i>%</i></span></span></span>\n'
            f'        </td>\n'
            f'        <td class="c-wn"><span class="pscore">{sw_str}</span><span class="pn">{p_w["name"]}</span><span class="pid">{p_w["no"]}</span></td>\n'
            f'      </tr>'
        )
        rows.append(row_html)
        
    for prefix in ["2026-shiqing-b", "2026-wyc-b"]:
        # Build round nav with proper target links
        nav_tabs = []
        for nav_r in range(1, 8):
            active_cls = " active" if nav_r == r else ""
            target_href = f"{prefix}-r{nav_r}.html"
            nav_tabs.append(f'<a class="rd-tab{active_cls}" href="{target_href}">第 {nav_r} 轮</a>')
        nav_html = '<div class="rd-nav">' + "".join(nav_tabs) + '</div>'
        
        # Replace title
        html = re.sub(r"<title>.*?</title>", f"<title>世青赛 · 男子青年组（B组）第 {r} 轮对阵概率预测表</title>", shanhai_html)
        
        # Replace hd with round navigation
        new_hd = (
            f'    <div class="hd">\n'
            f'      <h1><em>「世青赛」</em><span class="yr">2026</span> 年第 14 届世界青少年连珠锦标赛</h1>\n'
            f'      <div class="hd-sub">\n'
            f'        <span>男子青年组（B组）</span>\n'
            f'        {nav_html}\n'
            f'      </div>\n'
            f'    </div>'
        )
        html = re.sub(r"<div class=\"hd\">.*?</div>", new_hd, html, flags=re.DOTALL)
        
        # Replace tbody
        new_tbody = "      <tbody>\n" + "\n".join(rows) + "\n      </tbody>"
        html = re.sub(r"<tbody>.*?</tbody>", new_tbody, html, flags=re.DOTALL)
        
        fp = os.path.join(REPO_DIR, "posts", f"{prefix}-r{r}.html")
        with open(fp, "w", encoding="utf-8") as out:
            out.write(html)
            
    # update scores
    for gid, g in rgames:
        b = g["black"]
        w = g["white"]
        res = g["result"]
        if res == "B":
            scores[b] += 1.0
        elif res == "W":
            scores[w] += 1.0
        elif res == "D":
            scores[b] += 0.5
            scores[w] += 0.5

print("Regenerated all 7 rounds with corrected names and calibrated draw rates!")
