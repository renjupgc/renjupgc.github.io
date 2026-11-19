#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把杂豫所有静态页面解析成一份结构化种子 zayu-full.json，供管理后台一键载入云端。
覆盖：比赛(标题/日期/event-info/介绍/等级带/成绩表台次/棋谱引用)、棋谱、人物卡片、
      人物页介绍、等级分、赛事列表。
"""
import json, re, sys
from pathlib import Path
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
ZAYU = ROOT / 'zayu'
QP = ROOT / 'assets' / 'qipu'


def txt(node):
    return node.get_text(' ', strip=True) if node else ''


def attr(node, name):
    return node.get(name, '') if node else ''


# ---------- 比赛页 ----------
def parse_competition(path):
    soup = BeautifulSoup(path.read_text(encoding='utf-8'), 'html.parser')
    main = soup.find('main') or soup
    title = txt(main.select_one('.article-title'))
    meta = [txt(s) for s in main.select('.article-meta span')]
    date = meta[-1] if meta else ''

    band = {}
    figs = main.select('.band-hero .band-figure')
    for f in figs:
        k = txt(f.select_one('.band-k'))
        v = txt(f.select_one('.band-v')) or txt(f.select_one('.band-g'))
        if k:
            band[k] = v

    info = [txt(s) for s in main.select('.event-info span') if txt(s)]

    # 赛事介绍：article-header 之后、qp-hint / table-scroll 之前的 <p>
    intro = ''
    anchor = main.select_one('.article-header')
    if anchor:
        for sib in anchor.find_next_siblings():
            if getattr(sib, 'name', None) == 'p' and 'qp-hint' not in (sib.get('class') or []):
                intro = txt(sib)
                if intro:
                    break
            if getattr(sib, 'name', None) in ('div',) and ('band-hero' in (sib.get('class') or []) or 'event-info' in (sib.get('class') or [])):
                continue
            if getattr(sib, 'name', None) == 'p':
                continue

    qp_hint = txt(main.select_one('.qp-hint'))

    # 成绩表
    table = main.select_one('table.crosstab')
    rounds = []
    rows = []
    if table:
        heads = table.select('thead th')
        for h in heads:
            rounds.append(txt(h))
        for tr in table.select('tbody tr'):
            cells = tr.select('td')
            row = {}
            ridx = 0
            for td in cells:
                cls = td.get('class') or []
                raw = txt(td)
                cell = {'raw': raw}
                qid = td.get('data-qipu')
                if qid:
                    cell['qipu'] = qid
                if 'first' in cls:
                    cell['first'] = True
                if 'bye' in cls:
                    cell['bye'] = True
                # 归类列
                if 'c-no' in cls:
                    row['no'] = raw
                elif 'c-name' in cls:
                    a = td.find('a')
                    row['name'] = txt(a) or raw
                    row['href'] = attr(a, 'href')
                elif 'rt' in cls:
                    opp = td.select_one('.opp')
                    res = td.select_one('.res')
                    cell['opp'] = txt(opp)
                    cell['res'] = txt(res)
                    row.setdefault('games', []).append(cell)
                elif 'c-pt' in cls:
                    row['pt'] = raw
                elif 'c-tb' in cls:
                    row.setdefault('tb', []).append(raw)
                elif 'c-rank' in cls:
                    row['rank'] = raw
                ridx += 1
            if row:
                rows.append(row)

    # 棋谱引用 id
    qids = sorted(set(int(m) for m in re.findall(r'data-qipu="(\d+)"', path.read_text(encoding='utf-8'))))
    tid = int(re.sub(r'\D', '', path.stem) or 0)

    return {
        'id': path.stem,
        'tid': tid,
        'title': title,
        'date': date,
        'meta': meta,
        'band': band,
        'info': info,
        'intro': intro,
        'qp_hint': qp_hint,
        'rounds': rounds,
        'rows': rows,
        'qipu_ids': qids,
        'url': 'zayu/' + path.name,
    }


# ---------- 棋谱 ----------
def parse_qipu():
    out = []
    for p in sorted(QP.glob('g*.json'), key=lambda x: int(re.sub(r'\D', '', x.stem) or 0)):
        try:
            d = json.loads(p.read_text(encoding='utf-8'))
            out.append(d)
        except Exception as e:
            print('skip', p.name, e, file=sys.stderr)
    return out


# ---------- 人物卡片(renwu.html) ----------
def parse_people():
    soup = BeautifulSoup((ZAYU / 'renwu.html').read_text(encoding='utf-8'), 'html.parser')
    out = []
    for card in soup.select('article.rh-card'):
        facts = []
        for div in card.select('.rh-facts div'):
            k = txt(div.select_one('dt'))
            v = txt(div.select_one('dd'))
            if k:
                facts.append({'k': k, 'v': v})
        honors = []
        for li in card.select('.rh-honors li'):
            honors.append({'year': txt(li.select_one('.rh-year')),
                           'text': txt(li.select_one('.rh-txt'))})
        links = [{'text': txt(a), 'href': attr(a, 'href')} for a in card.select('.rh-links a')]
        out.append({
            'id': attr(card, 'id'),
            'name': txt(card.select_one('.rh-name')),
            'dan': txt(card.select_one('.rh-dan')),
            'tag': txt(card.select_one('.rh-tag')),
            'facts': facts,
            'bio': txt(card.select_one('.rh-bio')),
            'honors': honors,
            'links': links,
        })
    return out


# ---------- 人物页介绍(p/*.html 的 pr-bio) ----------
def parse_person_pages():
    out = []
    for p in sorted(ZAYU.glob('p/*.html')):
        soup = BeautifulSoup(p.read_text(encoding='utf-8'), 'html.parser')
        bio = soup.select_one('.pr-bio')
        if not bio:
            continue
        main = soup.find('main') or soup
        out.append({
            'name': p.stem,
            'title': txt(main.select_one('.article-title')),
            'bio': txt(bio),
            'file': 'zayu/p/' + p.name,
        })
    return out


# ---------- 等级分 ----------
def parse_ratings():
    soup = BeautifulSoup((ZAYU / 'rating.html').read_text(encoding='utf-8'), 'html.parser')
    out = []
    for tr in soup.select('table tr'):
        tds = tr.select('td')
        if len(tds) < 5:
            continue
        vals = [txt(td) for td in tds]
        a = tds[1].find('a')
        out.append({
            'rank': vals[0],
            'name': vals[1],
            'href': attr(a, 'href'),
            'region': vals[2],
            'uni': vals[3],
            'rating': vals[4],
        })
    return out


def main():
    comps = [parse_competition(p) for p in sorted(ZAYU.glob('t*.html'),
             key=lambda x: int(re.sub(r'\D', '', x.stem) or 0))]
    data = {
        'competitions': comps,
        'qipu': parse_qipu(),
        'people': parse_people(),
        'person_pages': parse_person_pages(),
        'ratings': parse_ratings(),
    }
    out = ROOT / 'data' / 'zayu-full.json'
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print('wrote', out, out.stat().st_size, 'bytes')
    for k, v in data.items():
        print(' ', k, len(v))
    # 样例
    if comps:
        c = comps[0]
        print('sample competition:', c['id'], c['title'], 'rows', len(c['rows']), 'rounds', len(c['rounds']))
        print('  info:', c['info'])
        print('  band:', c['band'])
        if c['rows']:
            print('  row0:', json.dumps(c['rows'][0], ensure_ascii=False)[:400])


if __name__ == '__main__':
    main()
