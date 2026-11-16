# -*- coding: utf-8 -*-
"""生成「连珠英语」的两个词库文件：

    assets/words-cet4.js    window.ZBX_WORDS_CET4
    assets/words-renju.js   window.ZBX_WORDS_RENJU
    assets/reading-articles.js  window.ZBX_READING

源数据：
    data/english/cet4.txt          大学英语四级大纲单词表（一行一词：词 [音标] 词性.释义）
    data/english/renju_terms.json  连珠/五子棋常用术语，人工整理
    data/english/reading.json      五子棋主题英语阅读文章与题目

格式用「数组的数组」而不是对象，省掉一半键名，4500 词的体积能压到 200 KB 上下：

    {name, count, words: [[词, 音标, 释义], ...]}            四级
    {name, count, words: [[词, 音标, 释义, 分类, 例句], ...]}  术语

用法：
    python tools/build_english_words.py
"""
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_CET4 = os.path.join(ROOT, 'data', 'english', 'cet4.txt')
SRC_RENJU = os.path.join(ROOT, 'data', 'english', 'renju_terms.json')
OUT_CET4 = os.path.join(ROOT, 'assets', 'words-cet4.js')
OUT_RENJU = os.path.join(ROOT, 'assets', 'words-renju.js')
OUT_READING = os.path.join(ROOT, 'assets', 'reading-articles.js')

# 一行里「词 + 音标 + 释义」，音标有时紧贴词根（instruct[ inˈstrʌkt]），
# 所以先试带音标的写法，再退回「词 + 空白 + 其余」；a.m / i.e. 这类缩写两次都不中，直接跳过
LINE_PH = re.compile(r"^([A-Za-z][A-Za-z'\-]*)\s*\[([^\]]*)\]\s*(.+)$")
LINE_BARE = re.compile(r"^([A-Za-z][A-Za-z'\-]*)[ \t]+(.+)$")


def parse_cet4():
    """读源表，按词合并多义项。源表里同一词列两行（如 present 的形容词与动词）。"""
    with open(SRC_CET4, encoding='utf-8-sig') as f:
        raw = f.read()
    raw = raw.replace('oˈclock', "o'clock")      # 源表把重音符敲进了词里
    raw = re.sub(r'([A-Za-z])\([a-z]{1,3}\)', r'\1', raw)   # toward(s)、systematic(al) 取正体

    merged = {}
    order = []
    dropped = []
    for line in raw.splitlines():
        t = line.strip()
        if not t or t.startswith('大学英语四级') or t.startswith('(共'):
            continue
        if re.fullmatch(r'[A-Z]', t):       # 首字母分节的标题
            continue
        m = LINE_PH.match(t)
        if m:
            word, ph, tr = m.group(1), m.group(2).strip(), m.group(3).strip()
        else:
            m = LINE_BARE.match(t)
            if not m:
                dropped.append(t)
                continue
            word, ph, tr = m.group(1), '', m.group(2).strip()
        tr = tr.strip('；; ')
        key = word.lower()
        if key not in merged:
            merged[key] = [word, ph, tr]
            order.append(key)
        else:
            row = merged[key]
            if not row[1] and ph:
                row[1] = ph
            if tr and tr not in row[2]:
                row[2] = row[2] + ' ／ ' + tr
    return [merged[k] for k in order], dropped


def parse_renju():
    with open(SRC_RENJU, encoding='utf-8') as f:
        rows = json.load(f)
    out = []
    for r in rows:
        out.append([r['w'], r.get('ph', ''), r['tr'], r.get('tag', ''), r.get('ex', '')])
    return out


def write_js(path, var, name, words, extra=None):
    head = '/* 由 tools/build_english_words.py 生成，请勿直接改这个文件。 */\n'
    payload = {'name': name, 'count': len(words), 'words': words}
    if extra:
        payload.update(extra)
    body = json.dumps(payload, ensure_ascii=False, separators=(',', ':'))
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(head + 'window.' + var + '=' + body + ';\n')
    return len(head) + len('window.' + var + '=') + len(body) + 2


def main():
    cet4, dropped = parse_cet4()
    renju = parse_renju()
    n1 = write_js(OUT_CET4, 'ZBX_WORDS_CET4', '大学英语四级大纲词汇', cet4,
                  {'source': '《大学英语四级考试大纲》词汇表'})
    n2 = write_js(OUT_RENJU, 'ZBX_WORDS_RENJU', '连珠英语常用术语', renju,
                  {'source': '连珠（renju）与五子棋（gomoku）实务用语；规则用语参照 renju.net / RIF'})
    with open(os.path.join(ROOT, 'data', 'english', 'reading.json'), encoding='utf-8') as f:
        reading = json.load(f)
    n3 = write_js(OUT_READING, 'ZBX_READING', reading['name'], reading['passages'],
                  {'source': reading.get('source', '')})
    print('四级 %d 词 -> %s（%.1f KB）' % (len(cet4), os.path.relpath(OUT_CET4, ROOT), n1 / 1024))
    print('术语 %d 条 -> %s（%.1f KB）' % (len(renju), os.path.relpath(OUT_RENJU, ROOT), n2 / 1024))
    print('阅读 %d 篇 -> %s（%.1f KB）' % (len(reading['passages']), os.path.relpath(OUT_READING, ROOT), n3 / 1024))
    if dropped:
        print('  跳过 %d 行（缩写等）: %s' % (len(dropped), '、'.join(dropped[:6])))
    tags = {}
    for r in renju:
        tags[r[3]] = tags.get(r[3], 0) + 1
    print('  术语分类：' + '，'.join('%s %d' % (k, v) for k, v in tags.items()))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
