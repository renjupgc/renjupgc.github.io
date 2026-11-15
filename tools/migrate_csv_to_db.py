# -*- coding: utf-8 -*-
"""清空 data/duiju.db 并将 data/all_games.csv 的全部对局、赛事、选手数据迁入 data/duiju.db，同时保留现役赛事（如 2026-shanhai）的实时对阵与预测。"""

import csv
import os
import sqlite3

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(ROOT, "data", "duiju.db")
CSV_PATH = os.path.join(ROOT, "data", "all_games.csv")

SCHEMA = """
CREATE TABLE players (
    id      TEXT PRIMARY KEY,
    name    TEXT NOT NULL,
    country INTEGER
);

CREATE TABLE tournaments (
    id           TEXT PRIMARY KEY,
    source       TEXT,
    name         TEXT NOT NULL,
    year         INTEGER,
    date         TEXT,
    day          INTEGER,
    group_name   TEXT,
    rule         TEXT,
    rule_id      INTEGER,
    rated        INTEGER,
    slug         TEXT,
    total_rounds INTEGER,
    base_time    INTEGER,
    increment    INTEGER,
    updated_at   TEXT
);

CREATE TABLE rounds (
    tournament_id TEXT NOT NULL REFERENCES tournaments(id),
    round         INTEGER NOT NULL,
    model         TEXT,
    predicted_at  TEXT,
    updated_at    TEXT,
    PRIMARY KEY (tournament_id, round)
);

CREATE TABLE games (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id       TEXT UNIQUE,
    source        TEXT,
    tournament_id TEXT NOT NULL REFERENCES tournaments(id),
    round         INTEGER NOT NULL,
    table_no      INTEGER,
    date          TEXT,
    day           INTEGER,
    rule          INTEGER,
    rated         INTEGER,
    black_id      TEXT,
    black_no      INTEGER,
    black_name    TEXT NOT NULL,
    black_country INTEGER,
    white_id      TEXT,
    white_no      INTEGER,
    white_name    TEXT NOT NULL,
    white_country INTEGER,
    result        TEXT,
    swap          TEXT,
    opening       TEXT,
    moves         TEXT,
    base_time     INTEGER,
    increment     INTEGER,
    p_black       REAL,
    p_draw        REAL,
    p_white       REAL
);

CREATE INDEX idx_games_tour_rnd ON games(tournament_id, round, table_no);
CREATE INDEX idx_games_day_rnd  ON games(day, round);
CREATE INDEX idx_games_black_id ON games(black_id);
CREATE INDEX idx_games_white_id ON games(white_id);
"""


def _to_int(val, default=None):
    s = str(val or "").strip()
    if s == "":
        return default
    try:
        return int(float(s))
    except ValueError:
        return default


def main():
    # 1. 备份当前 duiju.db 中的现役赛事（如 2026-shanhai）
    live_tours, live_rounds, live_games = [], [], []
    if os.path.exists(DB_PATH):
        old = sqlite3.connect(DB_PATH)
        old.row_factory = sqlite3.Row
        live_tours = [dict(r) for r in old.execute("SELECT * FROM tournaments")]
        live_rounds = [dict(r) for r in old.execute("SELECT * FROM rounds")]
        live_games = [dict(r) for r in old.execute("SELECT * FROM games ORDER BY tournament_id, round, table_no")]
        old.close()
        os.remove(DB_PATH)

    live_tour_names = {t["name"] for t in live_tours}

    # 2. 读取 all_games.csv
    players = {}       # pid -> (pid, name, country)
    name_to_pid = {}   # name -> pid
    tours = {}         # tid -> dict
    game_rows = []

    with open(CSV_PATH, "r", encoding="utf-8-sig", newline="") as f:
        for idx, r in enumerate(csv.DictReader(f), 1):
            tname = (r.get("tournament_name") or "").strip()
            if tname in live_tour_names:
                continue

            tid = (r.get("tournament_id") or "").strip()
            src = (r.get("source") or "").strip()
            date_str = (r.get("date") or "").strip()
            day = _to_int(r.get("day"), 0)
            year = _to_int(date_str[:4], None) if len(date_str) >= 4 else None
            rule_id = _to_int(r.get("rule"), 0)
            rated = _to_int(r.get("rated"), 1)
            rnd = _to_int(r.get("round"), 0)
            bt = _to_int(r.get("base_time"), None)
            inc = _to_int(r.get("increment"), None)

            bid = (r.get("black_id") or "").strip()
            bn = (r.get("black_name") or "").strip()
            bc = _to_int(r.get("black_country"), 5)
            wid = (r.get("white_id") or "").strip()
            wn = (r.get("white_name") or "").strip()
            wc = _to_int(r.get("white_country"), 5)

            if bid:
                players.setdefault(bid, (bid, bn or bid, bc))
                if bn and bn not in name_to_pid:
                    name_to_pid[bn] = bid
            if wid:
                players.setdefault(wid, (wid, wn or wid, wc))
                if wn and wn not in name_to_pid:
                    name_to_pid[wn] = wid

            if tid:
                tinfo = tours.get(tid)
                if tinfo is None:
                    tours[tid] = {
                        "id": tid,
                        "source": src,
                        "name": tname or tid,
                        "year": year,
                        "date": date_str,
                        "day": day,
                        "rule_id": rule_id,
                        "rated": rated,
                        "total_rounds": rnd if rnd > 0 else None,
                        "base_time": bt,
                        "increment": inc,
                    }
                else:
                    if rnd > 0 and (tinfo["total_rounds"] is None or rnd > tinfo["total_rounds"]):
                        tinfo["total_rounds"] = rnd
                    if tinfo["base_time"] is None and bt is not None:
                        tinfo["base_time"] = bt
                        tinfo["increment"] = inc

            game_rows.append((
                (r.get("game_id") or f"csv_{idx}").strip(),
                src,
                tid,
                rnd,
                None,
                date_str,
                day,
                rule_id,
                rated,
                bid or None,
                None,
                bn,
                bc,
                wid or None,
                None,
                wn,
                wc,
                (r.get("result") or "").strip(),
                (r.get("swap") or "").strip(),
                (r.get("opening") or "").strip(),
                (r.get("moves") or "").strip(),
                bt,
                inc,
                None,
                None,
                None,
            ))

    # 3. 写入全新 duiju.db
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)

    conn.executemany(
        "INSERT OR IGNORE INTO players (id, name, country) VALUES (?, ?, ?)",
        players.values(),
    )

    conn.executemany(
        """INSERT INTO tournaments
           (id, source, name, year, date, day, group_name, rule, rule_id, rated, slug, total_rounds, base_time, increment, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL, ?, ?, ?, NULL)""",
        [
            (
                t["id"], t["source"], t["name"], t["year"], t["date"], t["day"],
                t["rule_id"], t["rated"], t["total_rounds"], t["base_time"], t["increment"],
            )
            for t in tours.values()
        ],
    )

    conn.executemany(
        """INSERT INTO games
           (game_id, source, tournament_id, round, table_no, date, day, rule, rated,
            black_id, black_no, black_name, black_country,
            white_id, white_no, white_name, white_country,
            result, swap, opening, moves, base_time, increment, p_black, p_draw, p_white)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        game_rows,
    )

    # 4. 恢复现役赛事（如 2026-shanhai）
    for t in live_tours:
        bt = t.get("base_time")
        inc = t.get("increment")
        conn.execute(
            """INSERT OR REPLACE INTO tournaments
               (id, source, name, year, date, day, group_name, rule, rule_id, rated, slug, total_rounds, base_time, increment, updated_at)
               VALUES (?, 'ljrenju', ?, ?, '2026-11-14', 20771, ?, ?, 25, 1, ?, ?, ?, ?, ?)""",
            (
                t["id"], t["name"], t.get("year"), t.get("group_name"), t.get("rule"),
                t.get("slug"), t.get("total_rounds"), bt, inc, t.get("updated_at"),
            ),
        )
        t_bt, t_inc = bt, inc
        t_games = [g for g in live_games if g["tournament_id"] == t["id"]]
        for g in t_games:
            bn, wn = g["black_name"], g["white_name"]
            bid = name_to_pid.get(bn) if bn != "轮空" else None
            wid = name_to_pid.get(wn) if wn != "轮空" else None
            conn.execute(
                """INSERT INTO games
                   (game_id, source, tournament_id, round, table_no, date, day, rule, rated,
                    black_id, black_no, black_name, black_country,
                    white_id, white_no, white_name, white_country,
                    result, swap, opening, moves, base_time, increment, p_black, p_draw, p_white)
                   VALUES (?, 'ljrenju', ?, ?, ?, '2026-11-14', 20771, 25, 1, ?, ?, ?, 5, ?, ?, ?, 5, ?, '', '', '', ?, ?, ?, ?, ?)""",
                (
                    f"duiju_{t['id']}_{g['round']}_{g['table_no']}",
                    t["id"], g["round"], g["table_no"],
                    bid, g.get("black_no"), bn,
                    wid, g.get("white_no"), wn,
                    g.get("result"), t_bt, t_inc,
                    g.get("p_black"), g.get("p_draw"), g.get("p_white"),
                ),
            )

    for r in live_rounds:
        conn.execute(
            "INSERT OR REPLACE INTO rounds (tournament_id, round, model, predicted_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (r["tournament_id"], r["round"], r.get("model"), r.get("predicted_at"), r.get("updated_at")),
        )

    conn.commit()
    conn.execute("VACUUM")
    p_cnt = conn.execute("SELECT COUNT(*) FROM players").fetchone()[0]
    t_cnt = conn.execute("SELECT COUNT(*) FROM tournaments").fetchone()[0]
    g_cnt = conn.execute("SELECT COUNT(*) FROM games").fetchone()[0]
    r_cnt = conn.execute("SELECT COUNT(*) FROM rounds").fetchone()[0]
    conn.close()
    mb = os.path.getsize(DB_PATH) / (1024 * 1024)
    print(f"迁移完成 -> {DB_PATH} ({mb:.2f} MB)")
    print(f"  players: {p_cnt}, tournaments: {t_cnt}, games: {g_cnt}, rounds: {r_cnt}")


if __name__ == "__main__":
    main()
