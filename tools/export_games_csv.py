# -*- coding: utf-8 -*-
"""
将 RIF XML 数据库 (renjunet_v10_20261113.rif) 与 duiju.db 中已完赛对局合并导出为统一 CSV (data/all_games.csv)。

用法：
    python tools/export_games_csv.py
    python tools/export_games_csv.py --rif "C:\\Users\\yaolz\\Downloads\\renjunet_v10_20261113.rif" --out data/all_games.csv
"""

import argparse
import csv
import gzip
import json
import os
import re
import sqlite3
import sys
import xml.etree.ElementTree as ET
from datetime import date, datetime

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_RIF_PATH = r"C:\Users\yaolz\Downloads\renjunet_v10_20261113.rif"
DEFAULT_DB_PATH = os.path.join(BASE_DIR, "data", "duiju.db")
DEFAULT_RENJU4433_DIR = r"C:\Users\yaolz\.gemini\antigravity\scratch\renju4433.github.io\data"
DEFAULT_OUT_PATH = os.path.join(BASE_DIR, "data", "all_games.csv")
PLAYERS_JSON_PATH = os.path.join(BASE_DIR, "bisai", "data", "players.json")
WHR_GAMES_PATH = os.path.join(BASE_DIR, "data", "whr_games.json.gz")

EPOCH = date(1970, 1, 1)

RULE_MAP = {
    "塔拉山口-10": 25,
    "塔拉山口10": 25,
    "Taraguchi-10": 25,
    "索索夫-8": 24,
    "Soosyrv-8": 24,
    "山口": 1,
    "Yamaguchi": 1,
    "RIF": 0,
    "连珠": 0,
    "五手两打": 2,
    "坂田": 5,
    "Sakata": 5,
}

TOURNAMENT_DATES = {
    "2026-shanhai": "2026-11-14",
}

CSV_COLUMNS = [
    "game_id",
    "source",
    "tournament_id",
    "tournament_name",
    "round",
    "date",
    "day",
    "rule",
    "rated",
    "black_id",
    "black_name",
    "black_country",
    "white_id",
    "white_name",
    "white_country",
    "result",
    "swap",
    "opening",
    "moves",
]


def parse_date_to_day(date_str):
    """将日期字符串转为自 1970-01-01 起的天数。"""
    if not date_str:
        return None
    s = str(date_str).strip()[:10]
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d"):
        try:
            dt = datetime.strptime(s, fmt).date()
            return (dt - EPOCH).days
        except ValueError:
            continue
    # 兜底仅年份或年月
    parts = [p for p in s.replace("/", "-").split("-") if p.isdigit()]
    try:
        y = int(parts[0])
        m = int(parts[1]) if len(parts) > 1 else 1
        d = int(parts[2]) if len(parts) > 2 else 1
        return (date(y, max(1, min(12, m)), max(1, min(28, d))) - EPOCH).days
    except (IndexError, ValueError):
        return None


def parse_cn_date_text(date_text):
    """解析中文日期文本（如 '2026年10月3日-6日'、'2026年7月'）为 (YYYY-MM-DD, day)。"""
    if not date_text:
        return "", 0
    s = str(date_text).strip()
    m = re.search(r"(\d{4})年(\d{1,2})月(?:(\d{1,2})日)?", s)
    if m:
        y = int(m.group(1))
        mo = max(1, min(12, int(m.group(2))))
        d = max(1, min(28, int(m.group(3)))) if m.group(3) else 1
        ds = f"{y:04d}-{mo:02d}-{d:02d}"
        return ds, (date(y, mo, d) - EPOCH).days
    return "", 0


def load_name_mappings():
    """从 players.json 和 whr_games.json.gz 加载中文名 -> (pid, country_id) 映射。"""
    name_to_pid = {}
    name_to_country = {}

    if os.path.exists(WHR_GAMES_PATH):
        try:
            with gzip.open(WHR_GAMES_PATH, "rt", encoding="utf-8") as f:
                data = json.load(f)
                for k, v in (data.get("name_to_pid") or {}).items():
                    if k and v:
                        name_to_pid[k] = str(v)
        except (OSError, ValueError):
            pass

    if os.path.exists(PLAYERS_JSON_PATH):
        try:
            with open(PLAYERS_JSON_PATH, "r", encoding="utf-8") as f:
                plist = json.load(f)
                for p in plist:
                    pid = str(p.get("id") or "").strip()
                    cid = p.get("country_id", 5)
                    for key in (p.get("native_name"), p.get("name")):
                        if key:
                            k = str(key).strip()
                            if pid and k not in name_to_pid:
                                name_to_pid[k] = pid
                            if k not in name_to_country and cid is not None:
                                name_to_country[k] = int(cid)
                    if pid == "102456":
                        name_to_pid["陈超"] = pid
                        if cid is not None:
                            name_to_country["陈超"] = int(cid)
                    if pid == "102466":
                        name_to_pid["王嘉欣"] = pid
                        if cid is not None:
                            name_to_country["王嘉欣"] = int(cid)
        except (OSError, ValueError):
            pass

    if "韋振強" in name_to_pid and "韦振强" not in name_to_pid:
        name_to_pid["韦振强"] = name_to_pid["韋振強"]
    if "韋振強" in name_to_country and "韦振强" not in name_to_country:
        name_to_country["韦振强"] = name_to_country["韋振強"]

    return name_to_pid, name_to_country


def parse_rif_xml(rif_path):
    """流式解析 RIF XML，提取所有有效对局行。"""
    players = {}
    tournaments = {}
    rows = []

    for event, elem in ET.iterparse(rif_path, events=("end",)):
        tag = elem.tag
        if tag == "player":
            internal_id = elem.attrib.get("id", "")
            disp_id = elem.attrib.get("disp_id") or internal_id
            native_name = (elem.attrib.get("native_name") or "").strip()
            surname = (elem.attrib.get("surname") or "").strip()
            given = (elem.attrib.get("name") or "").strip()
            full_name = native_name or f"{surname} {given}".strip() or f"player_{disp_id}"
            country = elem.attrib.get("country") or "5"
            players[internal_id] = {
                "pid": str(disp_id),
                "name": full_name,
                "country": str(country),
            }
            elem.clear()

        elif tag == "tournament":
            tid = elem.attrib.get("id", "")
            date_str = (elem.attrib.get("start") or elem.attrib.get("end") or "").strip()
            if not date_str and elem.attrib.get("year"):
                y = elem.attrib.get("year")
                m = elem.attrib.get("month") or "01"
                date_str = f"{y}-{str(m).zfill(2)}-01"
            day = parse_date_to_day(date_str)
            tournaments[tid] = {
                "name": (elem.attrib.get("name") or "").strip(),
                "date": date_str,
                "day": day if day is not None else 0,
                "rule": (elem.attrib.get("rule") or "0").strip(),
                "rated": (elem.attrib.get("rated") or "1").strip(),
            }
            elem.clear()

        elif tag == "game":
            bres = (elem.attrib.get("bresult") or "").strip()
            if bres == "1":
                res = "B"
            elif bres == "0":
                res = "W"
            elif bres == "0.5":
                res = "D"
            else:
                elem.clear()
                continue

            b_ref = elem.attrib.get("black", "")
            w_ref = elem.attrib.get("white", "")
            pb = players.get(b_ref)
            pw = players.get(w_ref)
            if not pb or not pw:
                elem.clear()
                continue

            swap = (elem.attrib.get("swap") or "").strip()
            if swap.count("R") % 2 == 1:
                pb, pw = pw, pb
                if res == "B":
                    res = "W"
                elif res == "W":
                    res = "B"

            tid = elem.attrib.get("tournament", "")
            tinfo = tournaments.get(tid, {})
            rule = (elem.attrib.get("rule") or tinfo.get("rule") or "0").strip()
            gid = elem.attrib.get("id", "")
            opening = (elem.attrib.get("opening") or "").strip()
            move_el = elem.find("move")
            moves = " ".join((move_el.text or "").split()) if move_el is not None else ""

            rows.append({
                "game_id": f"rif_{gid}",
                "source": "rif_xml",
                "tournament_id": f"rif_{tid}",
                "tournament_name": tinfo.get("name", ""),
                "round": (elem.attrib.get("round") or "").strip(),
                "date": tinfo.get("date", ""),
                "day": tinfo.get("day", 0),
                "rule": rule,
                "rated": tinfo.get("rated", "1"),
                "black_id": pb["pid"],
                "black_name": pb["name"],
                "black_country": pb["country"],
                "white_id": pw["pid"],
                "white_name": pw["name"],
                "white_country": pw["country"],
                "result": res,
                "swap": swap,
                "opening": opening,
                "moves": moves,
            })
            elem.clear()

    return rows, players


def extract_duiju_games(db_path, name_to_pid, name_to_country):
    """从 duiju.db 提取所有已完赛（B/W/D，非轮空）对局。"""
    if not os.path.exists(db_path):
        return []

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    sql = """
        SELECT g.id, g.tournament_id, g.round, g.table_no,
               g.black_name, g.white_name, g.result,
               t.name AS tour_name, t.year AS tour_year, t.rule AS tour_rule
        FROM games g
        JOIN tournaments t ON t.id = g.tournament_id
        WHERE g.result IN ('B', 'W', 'D')
          AND g.black_name != '轮空'
          AND g.white_name != '轮空'
        ORDER BY t.year, g.tournament_id, g.round, g.table_no
    """
    rows = []
    for r in conn.execute(sql):
        tid = r["tournament_id"]
        date_str = TOURNAMENT_DATES.get(tid) or f"{r['tour_year'] or 2026}-01-01"
        day = parse_date_to_day(date_str) or 0
        rule_id = RULE_MAP.get(r["tour_rule"], 25)

        bn = r["black_name"]
        wn = r["white_name"]
        b_id = name_to_pid.get(bn, "")
        w_id = name_to_pid.get(wn, "")
        b_country = name_to_country.get(bn, 5)
        w_country = name_to_country.get(wn, 5)

        rows.append({
            "game_id": f"duiju_{r['id']}",
            "source": "ljrenju",
            "tournament_id": tid,
            "tournament_name": r["tour_name"],
            "round": r["round"],
            "date": date_str,
            "day": day,
            "rule": rule_id,
            "rated": 1,
            "black_id": b_id,
            "black_name": bn,
            "black_country": b_country,
            "white_id": w_id,
            "white_name": wn,
            "white_country": w_country,
            "result": r["result"],
            "swap": "",
            "opening": "",
            "moves": "",
        })
    conn.close()
    return rows


def infer_rule_id(rule_text, opening_code=""):
    """从规则说明与开局代码推断规则 ID（默认 25 = 塔拉山口-10）。"""
    rt = str(rule_text or "")
    if "塔拉山口" in rt or "Taraguchi" in rt:
        return 25
    if "索索夫" in rt or "Soosyrv" in rt:
        return 24
    if "五手两打" in rt or "五手二打" in rt:
        return 2
    if "山口" in rt or "Yamaguchi" in rt:
        return 1
    oc = str(opening_code or "").strip()
    if oc.startswith("R:") and len(oc) >= 7:
        return 25
    return 25


def infer_country_from_slug(slug):
    """根据赛事 slug 前缀推断新选手的默认国家/地区 ID（RIF 标准编号）。"""
    s = str(slug or "").lower()
    if s.startswith(("chn", "cn", "cmsg")):
        return 5   # CHN
    if s.startswith("kor"):
        return 6   # KOR
    if s.startswith("jp"):
        return 4   # JPN
    if s.startswith("est"):
        return 1   # EST
    if s.startswith(("ru", "su", "ussr")):
        if s.startswith("suukr"):
            return 14  # UKR
        if s.startswith("sublr"):
            return 19  # BLR
        return 2   # RRA / RUS
    if s.startswith("fin"):
        return 3   # FIN
    if s.startswith("swe"):
        return 7   # SWE
    if s.startswith(("tai", "tpe")):
        return 8   # TPE
    if s.startswith("pol"):
        return 9   # POL
    if s.startswith("hun"):
        return 10  # HUN
    if s.startswith("usa"):
        return 11  # USA
    if s.startswith("arm"):
        return 12  # ARM
    if s.startswith("ukr"):
        return 14  # UKR
    if s.startswith("cze"):
        return 16  # CZE
    if s.startswith("lva"):
        return 17  # LAT
    if s.startswith("hkg"):
        return 47  # HKG
    return 40      # UNK


def extract_renju4433_games(renju4433_dir, existing_moves, name_to_pid, name_to_country):
    """从 renju4433.github.io/data 补充 RIF XML 与 duiju.db 中没有的赛事对局。"""
    if not renju4433_dir or not os.path.isdir(renju4433_dir):
        return []

    g_path = os.path.join(renju4433_dir, "games.csv")
    t_path = os.path.join(renju4433_dir, "tournaments.csv")
    gr_path = os.path.join(renju4433_dir, "groups.csv")
    if not os.path.exists(g_path) or not os.path.exists(t_path):
        return []

    tours = {}
    with open(t_path, "r", encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            tours[r["id"]] = r

    groups = {}
    if os.path.exists(gr_path):
        with open(gr_path, "r", encoding="utf-8-sig", newline="") as f:
            for r in csv.DictReader(f):
                groups[(r["tournament_id"], r["group_name"])] = r.get("rule", "")

    by_tid = {}
    with open(g_path, "r", encoding="utf-8-sig", newline="") as f:
        for g in csv.DictReader(f):
            by_tid.setdefault(g["tournament_id"], []).append(g)

    rows = []
    added_tours = 0
    for tid, glist in sorted(by_tid.items(), key=lambda x: int(x[0]) if x[0].isdigit() else 999999):
        if tid == "2":
            continue
        valid = [
            g for g in glist
            if g.get("result") in ("black_win", "white_win", "draw")
            and g.get("walkover") == "0"
            and g.get("unplayed") == "0"
        ]
        if not valid:
            continue
        matched = sum(
            1 for g in valid
            if (g.get("moves") or "").strip() and " ".join((g.get("moves") or "").split()) in existing_moves
        )
        if matched > len(valid) * 0.3:
            continue

        tinfo = tours.get(tid, {})
        date_str, day = parse_cn_date_text(tinfo.get("date_text", ""))
        tour_title = (tinfo.get("title") or "").strip()
        default_country = infer_country_from_slug(tinfo.get("slug", ""))
        added_tours += 1

        for g in valid:
            bn = (g.get("black_player") or "").strip()
            wn = (g.get("white_player") or "").strip()
            if not bn or not wn:
                continue

            res_raw = g["result"]
            res = "B" if res_raw == "black_win" else ("W" if res_raw == "white_win" else "D")

            oc = (g.get("opening_code") or "").strip()
            swap_str = ""
            if ":" in oc:
                tail = oc.split(":", 1)[1]
                swap_str = "".join("R" if ch == "+" else "-" for ch in tail)
            if oc.count("+") % 2 == 1:
                bn, wn = wn, bn
                if res == "B":
                    res = "W"
                elif res == "W":
                    res = "B"

            b_id = name_to_pid.get(bn, "")
            w_id = name_to_pid.get(wn, "")
            b_country = name_to_country.get(bn, default_country)
            w_country = name_to_country.get(wn, default_country)

            rule_text = groups.get((tid, g.get("group_name") or ""), "")
            rule_id = infer_rule_id(rule_text, oc)
            moves = " ".join((g.get("moves") or "").split())

            rows.append({
                "game_id": f"r4433_{g['id']}",
                "source": "ljrenju",
                "tournament_id": f"r4433_{tid}",
                "tournament_name": tour_title,
                "round": (g.get("round_num") or "").strip(),
                "date": date_str,
                "day": day,
                "rule": rule_id,
                "rated": 1,
                "black_id": b_id,
                "black_name": bn,
                "black_country": b_country,
                "white_id": w_id,
                "white_name": wn,
                "white_country": w_country,
                "result": res,
                "swap": swap_str,
                "opening": (g.get("opening_name") or "").strip(),
                "moves": moves,
            })

    print(f"  renju4433 补充新赛事: {added_tours} 场, {len(rows)} 局")
    return rows


def export_all_games_csv(rif_path=DEFAULT_RIF_PATH, db_path=DEFAULT_DB_PATH,
                         renju4433_dir=DEFAULT_RENJU4433_DIR, out_path=DEFAULT_OUT_PATH):
    """合并导出 RIF XML、renju4433 与 duiju.db 已完赛对局至统一 CSV。"""
    if not os.path.exists(rif_path):
        raise FileNotFoundError(f"未找到 RIF XML 文件: {rif_path}")

    name_to_pid, name_to_country = load_name_mappings()
    rif_rows, xml_players = parse_rif_xml(rif_path)

    # 补充 XML 中的名字映射
    for p in xml_players.values():
        nm = p["name"]
        if nm and nm not in name_to_pid:
            name_to_pid[nm] = p["pid"]
        if nm and nm not in name_to_country:
            name_to_country[nm] = p["country"]

    existing_moves = {r["moves"] for r in rif_rows if r.get("moves")}
    r4433_rows = extract_renju4433_games(renju4433_dir, existing_moves, name_to_pid, name_to_country)
    duiju_rows = extract_duiju_games(db_path, name_to_pid, name_to_country)

    # 为没有 RIF 编号的新选手分配独立数字编号 ID（从 1000001 起）
    next_new_pid = 1000001
    new_player_ids = {}
    for row in r4433_rows + duiju_rows:
        for id_key, name_key in (("black_id", "black_name"), ("white_id", "white_name")):
            if not row[id_key]:
                nm = row[name_key]
                if nm not in new_player_ids:
                    new_player_ids[nm] = str(next_new_pid)
                    next_new_pid += 1
                row[id_key] = new_player_ids[nm]

    all_rows = rif_rows + r4433_rows + duiju_rows

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        writer.writerows(all_rows)

    print(f"导出完成: {out_path}")
    print(f"  RIF XML 对局: {len(rif_rows)}")
    print(f"  renju4433 补充对局: {len(r4433_rows)}")
    print(f"  duiju.db 已完赛对局: {len(duiju_rows)}")
    print(f"  新选手独立编号数: {len(new_player_ids)}")
    print(f"  合计总对局: {len(all_rows)}")
    return len(rif_rows), len(r4433_rows), len(duiju_rows), len(all_rows)


def main():
    parser = argparse.ArgumentParser(description="导出 RIF XML、renju4433 与 duiju.db 已完赛对局至统一 CSV")
    parser.add_argument("--rif", default=DEFAULT_RIF_PATH, help="RIF XML 文件路径")
    parser.add_argument("--db", default=DEFAULT_DB_PATH, help="duiju.db 路径")
    parser.add_argument("--renju4433", default=DEFAULT_RENJU4433_DIR, help="renju4433 data 目录")
    parser.add_argument("--out", default=DEFAULT_OUT_PATH, help="输出 CSV 路径")
    args = parser.parse_args()
    export_all_games_csv(args.rif, args.db, args.renju4433, args.out)


if __name__ == "__main__":
    main()
