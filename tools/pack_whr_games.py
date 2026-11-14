import json, gzip, os

GB_PATH = r"C:\Users\yaolz\Downloads\whr_renju-master\whr_renju-master\data\game_base_20261112_renju.json"
OUT_PATH = r"C:\Users\yaolz\WorkBuddy\2026-11-10-00-26-58\renjupgc.github.io\data\whr_games.json.gz"

if not os.path.exists(GB_PATH):
    print("GB_PATH does not exist")
    exit(1)

with open(GB_PATH, "r", encoding="utf-8") as f:
    gb = json.load(f)

tour_dates = {tid: t.get("start", "2000-01-01") for tid, t in gb["tournaments"].items()}
games = []
for gid, g in gb["games"].items():
    dstr = tour_dates.get(g["tournament"], "2000-01-01")
    try:
        parts = [int(x) for x in dstr.split("-")]
        day = parts[0]*365 + parts[1]*30 + parts[2]
    except:
        day = 0
    games.append([g["black"], g["white"], g["result"], day])

# Also build player name to pid map
name_to_pid = {}
pid_to_name = {}
for pid, p in gb["players"].items():
    nm = p.get("native_name") or f"{p.get('name','')} {p.get('surname','')}".strip()
    pid_to_name[pid] = nm
    if p.get("native_name"):
        name_to_pid[p["native_name"]] = pid

payload = {
    "games": games,
    "name_to_pid": name_to_pid,
    "pid_to_name": pid_to_name
}

raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
comp = gzip.compress(raw)
os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
with open(OUT_PATH, "wb") as f:
    f.write(comp)

print(f"Written {len(games)} games to {OUT_PATH}, size: {round(len(comp)/1024, 1)} KB")
