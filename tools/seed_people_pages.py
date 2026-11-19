# -*- coding: utf-8 -*-
"""解析 zayu/p/*.html 全部棋手主页，输出可编辑字段到 data/zayu-people-pages.json"""
import json
from pathlib import Path
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'zayu-people-pages.json'

def txt(el):
    return el.get_text(' ', strip=True) if el else ''

rows = []
for p in sorted((ROOT / 'zayu' / 'p').glob('*.html')):
    soup = BeautifulSoup(p.read_text(encoding='utf-8'), 'html.parser')
    name = p.stem
    title = txt(soup.select_one('.article-title')) or name

    spans = soup.select('.article-meta span')
    region = txt(spans[1]) if len(spans) > 1 else ''
    unit = txt(spans[2]) if len(spans) > 2 else ''
    # 第一个 span 是「栏目：杂豫」，跳过
    if region.startswith('栏目'):
        region = txt(spans[2]) if len(spans) > 2 else ''
        unit = txt(spans[3]) if len(spans) > 3 else ''

    stats = []
    box = soup.select_one('.player-stats')
    if box:
        for ps in box.select('.ps'):
            k = txt(ps.select_one('.ps-k'))
            v = txt(ps.select_one('.ps-v'))
            if k and v:
                stats.append({'k': k, 'v': v})

    dan = txt(soup.select_one('.rh-dan'))
    bio_el = soup.select_one('.pr-bio')
    bio = txt(bio_el)
    bio_html = bio_el.decode_contents().strip() if bio_el else ''

    rows.append({
        'name': name,
        'title': title,
        'region': region,
        'unit': unit,
        'dan': dan,
        'stats': stats,
        'bio': bio,
        'bioHtml': bio_html,
    })

OUT.write_text(json.dumps(rows, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print('pages:', len(rows), 'size:', OUT.stat().st_size)
print('with bio:', sum(1 for r in rows if r['bioHtml']))
print('with dan:', sum(1 for r in rows if r['dan']))
print('sample:', json.dumps(rows[0], ensure_ascii=False)[:400])
