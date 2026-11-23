# -*- coding: utf-8 -*-
"""生成 data/zalun-words.json —— 杂论栏目的全部词条（供后台「杂论词云」取舍）。

文章清单直接从 zalun.html 的 `<ul class="post-list">` 里读，栏目页加一篇，
重跑本脚本即可。词频统计用 jieba 分词 + 词性筛选，分类靠几份人工词表。

    python tools/build_zalun_words.py

依赖：jieba（pip install jieba）。其余都是标准库。
"""
import collections
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'zalun-words.json')

# 词云默认入选的 60 词：第一次上线时定的，后台保存过之后以云端配置为准
CLOUD = ["对方", "对手", "冠军", "必胜", "比赛", "开局", "进攻", "对局", "局面", "世界", "规则", "实战",
         "空间", "优势", "盘面", "失误", "定式", "全胜", "防守", "棋手", "复盘", "先手", "控盘",
         "朋友", "希望", "薄雾", "路", "生活", "叫醒", "时代", "等待", "失去", "梦", "信仰", "自由",
         "孤独", "生命", "少年", "广场", "黎明", "街道", "青春", "钟声", "桂花", "黄昏", "月光", "旅途",
         "荆棘", "城市", "夜晚", "天使", "鸽子", "红旗", "星星", "墓志铭", "果冻", "广告牌", "明珠",
         "天空", "浪花"]

THEME = set("连珠 五子棋 棋类 棋 对局 赛事 赛场 锦标赛 等级赛 公开赛".split())
CHESS = set("""对方 对手 冠军 必胜 比赛 开局 进攻 对局 局面 规则 实战 空间 优势 盘面 失误 定式 全胜 防守
棋手 复盘 先手 控盘 活二 活三 眠三 活四 冲四 眠二 跳活 连活 五目 禁手 无禁 打点 选点
走法 棋形 后手 反打 做棋 变化 计算 中局 残局 全谱 白方 黑方 白棋 黑棋 VCT VCF""".split())
PLACE = set("""河南省 洛阳市 郑州 山东 山东省 捷克 洛阳 河南 上海 北京 广州 信阳 驻马店 新乡 临沂
济宁 开封 平顶山 许昌 漯河 三门峡 南阳 商丘 周口 焦作 濮阳 鹤壁""".split())
GENERIC = set("""可以 这个 一个 没有 我们 自己 还是 或许 可能 这样 但是 如果 两个 看到 认为 开始 发现 需要
应该 虽然 一位 一步 知道 自然 然而 一切 因为 一定 倘若 容易 已经 成为 是否 这里 很大 所以 于是 这次
不能 一样 依然 出现 形成 仍然 存在 再次 什么 只能 当时 此时 那么 确实 时候 不会 许多 不好 获得 不错
这种 所有 就是 很多 非常 只有 不够 一下 比较 一种 一次 第二 接受 进行 使用 如同 发展 一条 留下 问题
正常 过来 情况 一些 原来 未来 人们 方向 或是 不是 左右 这位 决定 以上 似乎 或者 想到 便是 那种 过程
打算 完全 今年 拥有 同样 大家 一天 下次 相信 只要 而且 并且 不过 还有 因此 由此 以后 以前 之后 之前
这时 那时 随便 大概 大约 立刻 马上 突然 忽然 终于 常常 经常 偶尔 每次 绝对 相对 特别 十分 相当
极其 稍微 几乎 差不多 到底 毕竟 究竟 难道 简直 竟然 果然 居然 显然 明显 其实 如此 更加 最好""".split())

FUNC = ("r", "c", "d", "p", "u", "f", "m", "q", "t", "y", "e", "o", "zg", "w")


def article_links():
    """从栏目页读出文章清单，保持栏目页上的顺序"""
    html = open(os.path.join(ROOT, 'zalun.html'), encoding='utf-8').read()
    m = re.search(r'<ul class="post-list">(.*?)</ul>', html, re.S)
    if not m:
        raise SystemExit('zalun.html 里没找到 post-list')
    return re.findall(r'href="(posts/[^"]+\.html)"', m.group(1))


def plain_text(path):
    html = open(path, encoding='utf-8').read()
    m = re.search(r'<article[^>]*>(.*?)</article>', html, re.S)
    body = m.group(1) if m else html
    for pat in (r'<div class="article-footer">.*?</div>',
                r'<p class="related">.*?</p>',
                r'<p class="back-link">.*?</p>',
                r'<script.*?</script>'):
        body = re.sub(pat, ' ', body, flags=re.S)
    body = re.sub(r'<[^>]+>', ' ', body)
    body = re.sub(r'&[a-z]+;', ' ', body)
    return re.sub(r'\s+', ' ', body).strip()


def main():
    try:
        import jieba.posseg as pseg
    except ImportError:
        raise SystemExit('需要 jieba：pip install jieba')

    links = article_links()
    texts = []
    for rel in links:
        p = os.path.join(ROOT, rel)
        if not os.path.exists(p):
            print('缺文件，跳过：', rel)
            continue
        texts.append(plain_text(p))

    tok = collections.Counter()
    docs = collections.Counter()
    pos = collections.defaultdict(collections.Counter)
    for t in texts:
        seen = set()
        for w, f in pseg.cut(t):
            w = w.strip()
            if not re.fullmatch(r'[\u4e00-\u9fa5]+', w):
                continue
            # 单字只在原本就在词云里时保留（路、梦）：其余占了高频榜却没有意象价值
            if len(w) == 1 and w not in CLOUD:
                continue
            tok[w] += 1
            pos[w][f] += 1
            if w not in seen:
                docs[w] += 1
                seen.add(w)

    rows = []
    for w, c in tok.items():
        if c < 2 and w not in CLOUD:
            continue
        p = sorted(pos[w].items(), key=lambda x: -x[1])[0][0] if pos[w] else 'x'
        if w in CLOUD:
            kind = 'cloud'
        elif w in THEME:
            kind = 'theme'
        elif w in CHESS:
            kind = 'chess'
        elif w in PLACE or p == 'ns':
            kind = 'place'
        elif w in GENERIC or p in FUNC:
            kind = 'func'
        elif p.startswith('nr'):
            kind = 'name'
        elif p.startswith('n'):
            kind = 'noun'
        elif p.startswith('v'):
            kind = 'verb'
        elif p.startswith('a'):
            kind = 'adj'
        else:
            kind = 'other'
        rows.append({'w': w, 'c': c, 'd': docs[w], 'p': p, 'k': kind,
                     'on': 1 if w in CLOUD else 0})

    rows.sort(key=lambda r: (-r['c'], -r['d'], r['w']))
    out = {
        'generated': __import__('datetime').date.today().isoformat(),
        'posts': len(texts),
        'chars': sum(len(t) for t in texts),
        'note': '杂论栏目正文分词统计；on=1 为词云默认入选（后台保存过配置后以云端为准）',
        'words': rows,
    }
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))

    missing = [w for w in CLOUD if not any(r['w'] == w for r in rows)]
    print('文章 %d 篇 / %d 字 / 词条 %d 条 / 文件 %d KB'
          % (len(texts), out['chars'], len(rows), os.path.getsize(OUT) // 1024))
    if missing:
        print('默认词表里这些词没统计到：', missing)


if __name__ == '__main__':
    main()
