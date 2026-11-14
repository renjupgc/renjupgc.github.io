#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""IP → 地区解析：国内精确到省份，境外到国家。

结果缓存在 data/ip_geo.json（ip → {c: 国家, r: 省份/地区, city, g: 展示名, t: 查询时间}），
由 tools/snapshot_visits.py 归档时按需补查，admin 面板读这份缓存给每条访问记录补「地区」。

主源是 ip-api.com 的批量接口（中文、免费、仅限非商业用途），失败时逐条回退到
whois.pconline.com.cn。只查公网 IP；查不到的 IP 不写缓存，下次归档再试。

用法：
    python tools/geoip.py --backfill     # 给 data/visits.ndjson 里出现过的 IP 补地区
"""

import ipaddress
import json
import os
import sys
import time
import urllib.request

if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.environ.get('ZBX_GEO') or os.path.join(ROOT, 'data', 'ip_geo.json')
STORE = os.path.join(ROOT, 'data', 'visits.ndjson')

FRESH_DAYS = 90            # 归属地缓存的有效期
BATCH = 100                # ip-api 批量上限
BATCH_PAUSE = 4.5          # 免费版 15 次/分钟，批量之间歇一下
LANG_FIELDS = 'status,message,country,regionName,city,query'

PROVINCES = {
    '北京', '天津', '河北', '山西', '内蒙古', '辽宁', '吉林', '黑龙江', '上海',
    '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南', '湖北', '湖南',
    '广东', '广西', '海南', '重庆', '四川', '贵州', '云南', '西藏', '陕西',
    '甘肃', '青海', '宁夏', '新疆', '香港', '澳门', '台湾'
}

SUFFIXES = ('特别行政区', '维吾尔自治区', '壮族自治区', '回族自治区', '自治区', '省', '市')

# ip-api 偶尔对国内省份返回英文名，兜底转中文（shaanxi 是陕西，注意与 shanxi 区分）
EN2CN = {
    'beijing': '北京', 'tianjin': '天津', 'hebei': '河北', 'shanxi': '山西',
    'inner mongolia': '内蒙古', 'nei mongol': '内蒙古', 'liaoning': '辽宁',
    'jilin': '吉林', 'heilongjiang': '黑龙江', 'shanghai': '上海', 'jiangsu': '江苏',
    'zhejiang': '浙江', 'anhui': '安徽', 'fujian': '福建', 'jiangxi': '江西',
    'shandong': '山东', 'henan': '河南', 'hubei': '湖北', 'hunan': '湖南',
    'guangdong': '广东', 'guangxi': '广西', 'hainan': '海南', 'chongqing': '重庆',
    'sichuan': '四川', 'guizhou': '贵州', 'yunnan': '云南', 'tibet': '西藏',
    'xizang': '西藏', 'shaanxi': '陕西', 'gansu': '甘肃', 'qinghai': '青海',
    'ningxia': '宁夏', 'xinjiang': '新疆', 'hong kong': '香港', 'macau': '澳门',
    'macao': '澳门', 'taiwan': '台湾'
}


def is_public(ip):
    """只统计公网地址；内网、链路本地、保留地址一律不查。"""
    try:
        addr = ipaddress.ip_address((ip or '').strip())
    except ValueError:
        return False
    return not (addr.is_private or addr.is_loopback or addr.is_link_local or
                addr.is_multicast or addr.is_reserved)


def norm_region(name):
    s = (name or '').strip()
    if not s:
        return ''
    for suf in SUFFIXES:
        if s.endswith(suf) and len(s) > len(suf):
            s = s[:-len(suf)]
            break
    low = s.lower()
    if low in EN2CN:
        return EN2CN[low]
    if s in PROVINCES:
        return s
    return s


def display(country, region):
    """展示名：国内用省份，境外用国家，取不到就留空。"""
    c = (country or '').strip()
    r = norm_region(region)
    if c in ('中国', 'China', 'CHN'):
        return r or c
    if c:
        return c
    return r


def load():
    if not os.path.exists(CACHE):
        return {}
    try:
        with open(CACHE, encoding='utf-8') as f:
            data = json.load(f)
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def save(cache):
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    tmp = CACHE + '.tmp'
    with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(cache, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write('\n')
    os.replace(tmp, CACHE)


def fresh(rec):
    if not isinstance(rec, dict) or not rec.get('g'):
        return False
    return time.time() - (rec.get('t') or 0) < FRESH_DAYS * 86400


def _record(ip, country, region, city):
    g = display(country, region)
    if not g:
        return None
    return {
        'c': (country or '').strip(),
        'r': norm_region(region),
        'city': (city or '').strip(),
        'g': g,
        't': int(time.time())
    }


def lookup_batch(ips):
    """ip-api 批量接口；成功返回 {ip: record}，限流或网络错误返回 {}。"""
    body = json.dumps(ips).encode('utf-8')
    url = 'http://ip-api.com/batch?lang=zh-CN&fields=' + LANG_FIELDS
    req = urllib.request.Request(url, data=body, headers={
        'Content-Type': 'application/json',
        'User-Agent': 'zbx-geoip/1'
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            rows = json.loads(resp.read().decode('utf-8', 'replace'))
    except Exception as e:
        print('  ip-api 批量查询失败：%s' % e)
        return {}
    if not isinstance(rows, list):
        print('  ip-api 返回格式异常，跳过本轮')
        return {}
    out = {}
    for row in rows:
        if not isinstance(row, dict) or row.get('status') != 'success':
            continue
        ip = row.get('query') or ''
        rec = _record(ip, row.get('country'), row.get('regionName'), row.get('city'))
        if rec:
            out[ip] = rec
    return out


def lookup_one(ip):
    """备用源：太平洋电脑网 whois，返回 {ip: record} 或 {}。"""
    url = 'https://whois.pconline.com.cn/ipJson.jsp?ip=%s&json=true' % ip
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 zbx-geoip'})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            text = resp.read().decode('gbk', 'replace')
        row = json.loads(text)
    except Exception:
        return {}
    if not isinstance(row, dict):
        return {}
    rec = _record(ip, row.get('country') or row.get('countryName'),
                  row.get('pro'), row.get('city'))
    return {ip: rec} if rec else {}


def ensure(ips, cache=None, verbose=True):
    """确保这批 IP 都有归属地缓存；返回 (cache, 新增条数)。"""
    if cache is None:
        cache = load()
    todo = []
    for ip in dict.fromkeys([(x or '').strip() for x in ips]):
        if not ip or ip in cache and fresh(cache[ip]):
            continue
        if is_public(ip):
            todo.append(ip)
    if not todo:
        return cache, 0

    added = 0
    for start in range(0, len(todo), BATCH):
        chunk = todo[start:start + BATCH]
        got = lookup_batch(chunk)
        missed = [ip for ip in chunk if ip not in got]
        for ip in missed:                       # 批量里漏掉的逐条问备用源
            got.update(lookup_one(ip))
        cache.update(got)
        added += len(got)
        if verbose:
            print('  解析 %d 个 IP，成功 %d 个' % (len(chunk), len(got)))
        if start + BATCH < len(todo):
            time.sleep(BATCH_PAUSE)
    return cache, added


def backfill():
    """把 visits.ndjson 里出现过的 IP 全部补进缓存。"""
    if not os.path.exists(STORE):
        print('还没有 data/visits.ndjson，先跑 snapshot_visits.py')
        return 0
    ips = []
    with open(STORE, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except ValueError:
                continue
            if isinstance(obj, dict) and obj.get('i'):
                ips.append(obj['i'])
    cache, added = ensure(ips)
    if added:
        save(cache)
    print('IP 共 %d 个（去重 %d），本次新解析 %d 个，缓存共 %d 条'
          % (len(ips), len(set(ips)), added, len(cache)))
    return 0


if __name__ == '__main__':
    sys.exit(backfill())
