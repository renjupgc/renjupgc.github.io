#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 ntfy 通道里的访问记录归档进 data/visits.ndjson。

页面上的 assets/visit-log.js 把每次浏览 / 点击 / 停留打成一条 JSON，POST 到公共
ntfy 通道（只保留 12 小时）。本脚本由 .github/workflows/snapshot-visits.yml 定时
调用，把这些消息搬到仓库里长期保存，admin 面板直接读这个文件。

用法：
    python tools/snapshot_visits.py            # 定时任务用，增量抓取
    python tools/snapshot_visits.py --all      # 首次/补抓，把通道里现存的都取回
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import geoip  # noqa: E402  IP 归属地解析

TOPIC = os.environ.get('ZBX_TOPIC', 'zbx_stats_9c4k2m7q')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORE = os.environ.get('ZBX_STORE') or os.path.join(ROOT, 'data', 'visits.ndjson')
KEEP_DAYS = 400
MAX_EVENTS = 400000


def load(path):
    rows = []
    if not os.path.exists(path):
        return rows
    with open(path, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except ValueError:
                continue
            if isinstance(obj, dict):
                rows.append(obj)
    return rows


def fetch(since):
    """取回通道里的消息；返回 (消息列表, 错误说明)。"""
    url = 'https://ntfy.sh/%s/json?poll=1&since=%s' % (TOPIC, since)
    req = urllib.request.Request(url, headers={'User-Agent': 'zbx-visit-snapshot/1'})
    try:
        with urllib.request.urlopen(req, timeout=40) as resp:
            raw = resp.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return [], 'HTTP %s' % e.code
    except Exception as e:                # 网络问题不写坏数据，下次再试
        return [], str(e)
    out = []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except ValueError:
            continue
    return out, ''


def main():
    since = 'all' if '--all' in sys.argv else None
    rows = load(STORE)
    seen = {r.get('n') for r in rows if r.get('n')}
    last = max([r.get('t', 0) for r in rows] or [0])

    if since is None:
        if last:
            # 回退一小时，避免上一次抓取刚好卡在边界上漏消息
            since = str(int(last / 1000) - 3600)
        else:
            since = 'all'

    msgs, err = fetch(since)
    if err:
        print('抓取失败（%s），本轮不改动数据' % err)
        return 0

    added = 0
    for m in msgs:
        if m.get('event') != 'message':
            continue
        mid = m.get('id')
        if not mid or mid in seen:
            continue
        body = m.get('message') or ''
        try:
            ev = json.loads(body)
        except ValueError:
            continue
        if not isinstance(ev, dict) or not ev.get('p') or not ev.get('k'):
            continue
        ev['n'] = mid
        if not ev.get('t'):
            ev['t'] = int(m.get('time', time.time()) * 1000)
        rows.append(ev)
        seen.add(mid)
        added += 1

    now = int(time.time() * 1000)
    fresh = [r for r in rows if now - r.get('t', 0) <= KEEP_DAYS * 86400 * 1000]
    fresh.sort(key=lambda r: r.get('t', 0))
    if len(fresh) > MAX_EVENTS:
        fresh = fresh[-MAX_EVENTS:]

    changed = added > 0 or len(fresh) != len(rows)
    if changed:
        os.makedirs(os.path.dirname(STORE), exist_ok=True)
        tmp = STORE + '.tmp'
        with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
            for r in fresh:
                f.write(json.dumps(r, ensure_ascii=False, separators=(',', ':')) + '\n')
        os.replace(tmp, STORE)

    print('通道新增 %d 条，文件共 %d 条（%s）' % (added, len(fresh), '已写入' if changed else '无变化'))

    # 归档后顺带把 IP 归属地补进 data/ip_geo.json，admin 面板据此按省份统计
    geo, added_geo = geoip.ensure([r.get('i') for r in fresh])
    if added_geo:
        geoip.save(geo)
    print('IP 归属地新增解析 %d 个（缓存共 %d 条）' % (added_geo, len(geo)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
