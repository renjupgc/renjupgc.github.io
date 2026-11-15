# -*- coding: utf-8 -*-
"""从 renju.net 抓取所有 RIF 赛事的时限信息并缓存至 data/rif_time_controls.json。"""

import concurrent.futures
import json
import os
import re
import threading
import time
import urllib.request
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_RIF_PATH = r"C:\Users\yaolz\Downloads\renjunet_v10_20261113.rif"
OUT_JSON_PATH = os.path.join(ROOT, "data", "rif_time_controls.json")

_thread_local = threading.local()
try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False


def get_session():
    if HAS_REQUESTS:
        if not hasattr(_thread_local, "sess"):
            s = requests.Session()
            s.headers.update({"User-Agent": "Mozilla/5.0 (compatible; renjupgc-bot/1.0)"})
            _thread_local.sess = s
        return _thread_local.sess
    return None


def fetch_one(tid):
    url = f"https://www.renju.net/tournament/{tid}/"
    for attempt in range(2):
        try:
            if HAS_REQUESTS:
                resp = get_session().get(url, timeout=12)
                if resp.status_code == 404:
                    return tid, ""
                resp.raise_for_status()
                html = resp.text
            else:
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=12) as r:
                    html = r.read().decode("utf-8", errors="ignore")
            m = re.search(r"Time control:\s*</b>\s*([^<\n\r]+)", html, re.IGNORECASE)
            return tid, (m.group(1).strip() if m else "")
        except Exception:
            time.sleep(0.3 * (attempt + 1))
    return tid, None


def collect_rif_tournaments(rif_path):
    t_with_games = set()
    for _, elem in ET.iterparse(rif_path, events=("end",)):
        if elem.tag == "game":
            tid = elem.attrib.get("tournament")
            if tid:
                t_with_games.add(tid)
            elem.clear()
        elif elem.tag in ("tournament", "player"):
            elem.clear()
    return sorted(t_with_games, key=lambda x: int(x) if x.isdigit() else 0, reverse=True)


def main():
    t0 = time.time()
    tids = collect_rif_tournaments(DEFAULT_RIF_PATH)
    cache = {}
    if os.path.exists(OUT_JSON_PATH):
        with open(OUT_JSON_PATH, "r", encoding="utf-8") as f:
            cache = json.load(f)

    todo = [tid for tid in tids if tid not in cache]
    print(f"RIF 有对局赛事总数: {len(tids)}, 已缓存: {len(cache)}, 待抓取: {len(todo)}")

    done = 0
    found = sum(1 for v in cache.values() if v)
    failed = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=24) as pool:
        for tid, tc in pool.map(fetch_one, todo):
            done += 1
            if tc is None:
                failed += 1
            else:
                cache[tid] = tc
                if tc:
                    found += 1
            if done % 250 == 0 or done == len(todo):
                with open(OUT_JSON_PATH, "w", encoding="utf-8") as f:
                    json.dump(cache, f, ensure_ascii=False, indent=2)
                print(f"  进度 {done}/{len(todo)} | 累计找到时限: {found} | 本次失败: {failed} | 耗时: {time.time()-t0:.1f}s")

    with open(OUT_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)
    print(f"完成! 共缓存 {len(cache)} 场, 有时限 {found} 场, 保存至 {OUT_JSON_PATH}")


if __name__ == "__main__":
    main()
