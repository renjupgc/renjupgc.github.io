# -*- coding: utf-8 -*-
"""按 PAIRS+CODES 算总积分，与公示积分逐人比对。"""
import sys
from data_t121 import PAIRS, CODES, NO, OFFICIAL


def pts_of(c):
    if c == 'BYE':
        return 1.0, 0.0
    l, r = c.split(':')
    return float(l.rstrip('+-')), float(r.rstrip('+-'))


def main(detail=None):
    pts = {}
    games = {}
    for r in sorted(PAIRS):
        ps = PAIRS[r]
        cs = list(CODES[r])
        if len(ps) != len(cs):
            print('!! R%d 台数 %d != 码数 %d' % (r, len(ps), len(cs)))
            continue
        for (a, b), c in zip(ps, cs):
            if b is None:
                pts[a] = pts.get(a, 0) + 1
                games.setdefault(a, []).append((r, None, c, 1))
                continue
            pa, pb = pts_of(c)
            pts[a] = pts.get(a, 0) + pa
            pts[b] = pts.get(b, 0) + pb
            games.setdefault(a, []).append((r, b, c, pa))
            games.setdefault(b, []).append((r, a, c, pb))
    bad = []
    for k in sorted(OFFICIAL):
        got = pts.get(k, 0)
        if abs(got - OFFICIAL[k]) > 1e-9:
            bad.append((k, NO.get(k), OFFICIAL[k], got))
    print('不符 %d / %d，我算 %.1f，公示 %.1f' % (len(bad), len(OFFICIAL), sum(pts.values()), sum(OFFICIAL.values())))
    for k, n, o, g in bad:
        print('  %3d %-6s 公示 %-4s 我算 %-4s 差 %+g' % (k, n, o, g, g - o))
    if detail:
        for k in detail:
            print('--- %d %s 公示 %s' % (k, NO.get(k), OFFICIAL.get(k)))
            for g in sorted(games.get(k, [])):
                print('    R%-2d vs %-6s %-9s +%g' % (g[0], NO.get(g[1], g[1]), g[2], g[3]))


if __name__ == '__main__':
    main([int(x) for x in sys.argv[1:]])
