#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""WHR（Whole-History Rating）的纯 Python 复算工具（MAP 近似，仅供核对）。

⚠ 只用来看趋势、验证「多加一局会不会改变名次」，**不要**拿它的数值去生成
   zayu/rating.html：它与官方包的 EP 结果在尺度上并不一致（本站数据上顶部会
   低 500 分以上），站点等级分仍以 whr 包的计算为准。

build_zayu.py 的等级分原本依赖 pip 上的 whr 库；有些机器（比如校园网）装不上，
这里按同一套模型重写一遍，接口与 whr.Base 的那几个方法一致，缺库时自动顶上：

    base = Base(config={'w2': 19.3, 'virtual_games': 2})
    base.create_games([(p1, p2, 'B'|'W'|'D', days), ...])
    base.iterate_until_converge()
    for name, hist in base.get_ordered_ratings(): ...

模型（Coulom 2008）：每位棋手的实力 γ 随时间走维纳过程，相邻两次出场之间
γ 的方差是 w2 * 天数；对局按 Bradley-Terry 计，logit = (γ_a - γ_b) / S，
S = 400 / ln 10，即 400 分对应 10:1；和局按「半胜」计入。
首次出场附 virtual_games 个与 0 分对手的虚拟和棋，用来定基准、防止整体漂移。

求解用 MAP + 牛顿法：目标是「对数似然 - 高斯先验惩罚」，海森矩阵以大
共轭梯度求解——不像 EP 那样逐条消息迭代，但同一模型、同一尺度，数值上很接近。
"""

import math

# 原实现（wind23/whole_history_rating）里变量是 r = ln(实力 γ)，对局按
# p = γ_a / (γ_a + γ_b) 计，即 logit = r_a - r_b；输出再换成 400/ln10 * r。
# 所以这里的「分」只是显示单位，模型内部一律用 r 算。
S = 1.0
ELO = 400.0 / math.log(10.0)    # r -> 显示分数
DRAW_INFO = 0.25                # 一次和局（对 γ=1 的对手）提供的信息量


def _sigmoid(x):
    if x >= 0:
        return 1.0 / (1.0 + math.exp(-x))
    e = math.exp(x)
    return e / (1.0 + e)


class Base(object):
    def __init__(self, config=None):
        cfg = config or {}
        self.w2 = float(cfg.get('w2', 19.3))
        self.virtual_games = int(cfg.get('virtual_games', 2))
        self.games = []
        self.players = []           # 名字，按首次出场顺序
        self.idx = {}               # 名字 -> 序号
        self.knots = []             # 每人 [(day, var_index), ...]
        self.gamma = []             # 变量：每人每个节点的 γ
        self.solved = False

    # ---------------------------------------------------------------- 建图
    def create_games(self, games):
        # 按日期排好再建节点，否则同一人的节点会乱序，链上的先验就全错了
        self.games = sorted(games, key=lambda g: g[3])
        per = {}
        for p1, p2, _r, d in self.games:
            for p in (p1, p2):
                if p not in self.idx:
                    self.idx[p] = len(self.players)
                    self.players.append(p)
                    per[p] = []
                    self.knots.append([])
                    self.gamma.append([])
                if not per[p] or per[p][-1] != d:
                    per[p].append(d)
        at = {}
        for p, days in per.items():
            i = self.idx[p]
            self.knots[i] = days
            self.gamma[i] = [0.0] * len(days)
            at[p] = {d: k for k, d in enumerate(days)}
        self._games = []
        for p1, p2, r, d in self.games:
            if r not in ('B', 'W', 'D'):
                continue
            y = 1.0 if r == 'B' else (0.0 if r == 'W' else 0.5)
            self._games.append((self.idx[p1], at[p1][d],
                                self.idx[p2], at[p2][d], y))

    # ---------------------------------------------------------------- 求解
    def _state(self):
        """把所有节点的 γ 平铺成向量，附属信息一并返回。"""
        flat, pos = [], []
        for g in self.gamma:
            pos.append(len(flat))
            flat.extend(g)
        return flat, pos

    def iterate_until_converge(self, verbose=False, max_iter=60, tol=1e-6):
        flat, pos = self._state()
        n = len(flat)

        def knot(i, k):
            return pos[i] + k

        # 对局里存的是（选手号, 节点号），换成展平后的变量下标
        gidx = [(knot(i, k), knot(j, l), y)
                for i, k, j, l, y in self._games]

        # 链上的先验：(idx_a, idx_b, 1/var)
        chain = []
        for i, days in enumerate(self.knots):
            for k in range(len(days) - 1):
                var = self.w2 * max(days[k + 1] - days[k], 1e-9)
                chain.append((knot(i, k), knot(i, k + 1), 1.0 / var))
        # 首次出场的虚拟和棋：均值 0
        init = [(knot(i, 0), self.virtual_games * DRAW_INFO)
                for i, days in enumerate(self.knots) if days]

        def objective(x):
            tot = 0.0
            for a, b, y in gidx:
                d = (x[a] - x[b]) / S
                tot += y * d - _log1pexp(d)
            for a, b, prec in chain:
                tot -= 0.5 * (x[b] - x[a]) ** 2 * prec
            for a, prec in init:
                tot -= 0.5 * x[a] ** 2 * prec
            return tot

        for it in range(max_iter):
            grad = [0.0] * n
            for a, b, prec in chain:
                d = flat[b] - flat[a]
                grad[a] += d * prec
                grad[b] -= d * prec
            for a, prec in init:
                grad[a] -= flat[a] * prec
            info = [0.0] * n
            for a, b, prec in chain:
                info[a] += prec
                info[b] += prec
            for a, prec in init:
                info[a] += prec

            gpair = []
            for a, b, y in gidx:
                p = _sigmoid((flat[a] - flat[b]) / S)
                w = p * (1.0 - p) / (S * S)
                gpair.append((a, b, w))
                grad[a] -= (y - p) / S
                grad[b] += (y - p) / S
                info[a] += w
                info[b] += w

            # 牛顿方向：H d = -grad，H = 先验 + 对局两项，用共轭梯度解
            def matvec(v):
                out = [v[i] * info[i] for i in range(n)]
                for a, b, prec in chain:
                    t = (v[b] - v[a]) * prec
                    out[a] += t
                    out[b] -= t
                for a, b, w in gpair:
                    t = (v[a] - v[b]) * w
                    out[a] += t
                    out[b] -= t
                return out

            rhs = [-g for g in grad]
            step = _cg(matvec, rhs, n, iters=80)
            # 回溯线搜索，保证目标不升
            f0 = objective(flat)
            t = 1.0
            for _ in range(30):
                cand = [flat[i] + t * step[i] for i in range(n)]
                if objective(cand) >= f0 - 1e-12:
                    break
                t *= 0.5
            else:
                break
            flat = cand
            dec = -sum(grad[i] * step[i] for i in range(n))   # 牛顿减量的近似
            if verbose:
                print('  iter %d  -g·d = %.6g  step = %.3g' % (it, dec, t))
            if dec < tol:
                break

        k = 0
        for i, days in enumerate(self.knots):
            self.gamma[i] = [x * ELO for x in flat[pos[i]:pos[i] + len(days)]]
        self.solved = True

    def get_ordered_ratings(self):
        if not self.solved:
            self.iterate_until_converge()
        rows = []
        for i, name in enumerate(self.players):
            hist = list(zip(self.knots[i], self.gamma[i]))
            rows.append((name, hist))
        rows.sort(key=lambda kv: kv[1][-1][1] if kv[1] else 0.0, reverse=True)
        return rows


def _log1pexp(x):
    if x > 0:
        return x + math.log1p(math.exp(-x))
    return math.log1p(math.exp(x))


def _cg(matvec, b, n, iters=80, tol=1e-10):
    x = [0.0] * n
    r = list(b)
    p = list(r)
    rs = sum(v * v for v in r)
    if rs <= 0:
        return x
    for _ in range(iters):
        Ap = matvec(p)
        pAp = sum(p[i] * Ap[i] for i in range(n))
        if pAp <= 0:
            break
        alpha = rs / pAp
        for i in range(n):
            x[i] += alpha * p[i]
        for i in range(n):
            r[i] -= alpha * Ap[i]
        rs2 = sum(v * v for v in r)
        if rs2 < tol:
            break
        beta = rs2 / rs
        rs = rs2
        for i in range(n):
            p[i] = r[i] + beta * p[i]
    return x
