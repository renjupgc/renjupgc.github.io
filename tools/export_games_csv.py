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
import sqlite3
import sys
import xml.etree.ElementTree as ET
from datetime import date, datetime

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_RIF_PATH = r"C:\Users\yaolz\Downloads\renjunet_v10_20261113.rif"
DEFAULT_DB_PATH = os.path.join(BASE_DIR, "data", "duiju.db")
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
        b_id = name_to_pid.get(bn, bn)
        w_id = name_to_pid.get(wn, wn)
        b_country = name_to_country.get(bn, 5)
        w_country = name_to_country.get(wn, 5)

        rows.append({
            "game_id": f"duiju_{r['id']}",
            "source": "duiju_db",
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
        })
    conn.close()
    return rows


def export_all_games_csv(rif_path=DEFAULT_RIF_PATH, db_path=DEFAULT_DB_PATH, out_path=DEFAULT_OUT_PATH):
    """合并导出 RIF XML 与 duiju.db 已完赛对局至 CSV。"""
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

    duiju_rows = extract_duiju_games(db_path, name_to_pid, name_to_country)
    all_rows = rif_rows + duiju_rows

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        writer.writerows(all_rows)

    print(f"导出完成: {out_path}")
    print(f"  RIF XML 对局: {len(rif_rows)}")
    print(f"  duiju.db 已完赛对局: {len(duiju_rows)}")
    print(f"  合计总对局: {len(all_rows)}")
    return len(rif_rows), len(duiju_rows), len(all_rows)


def main():
    parser = argparse.ArgumentParser(description="导出 RIF XML 与 duiju.db 已完赛对局至统一 CSV")
    parser.add_argument("--rif", default=DEFAULT_RIF_PATH, help="RIF XML 文件路径")
    parser.add_argument("--db", default=DEFAULT_DB_PATH, help="duiju.db 路径")
    parser.add_argument("--out", default=DEFAULT_OUT_PATH, help="输出 CSV 路径")
    args = parser.parse_args()
    export_all_games_csv(args.rif, args.db, args.out)


if __name__ == "__main__":
    main()
