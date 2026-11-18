/* ==========================================================================
   夺冠概率引擎 —— 十人单循环、无和棋
   --------------------------------------------------------------------------
   P[i][j]：i 对 j 时 i 胜的千分率（0–1000）。P[j][i] 取补，只用上三角。
   0 与 1000 是已定的胜负；1–999 是未定的场，按概率展开。

   冠军 = 胜场最多者；胜场相同则按人数均分概率。
   所以每人概率之和恒为 1。

   算法是「流水」式的：把未定场一场一场往外开，每开一层先看一眼
   眼下领先的那几个人还有没有牌可打——
     · 领先者都已经下完，且其余人再怎么赢也追不上，冠军已定，
       整枝结算（余下各场概率之和为 1，直接按人数均分入账）；
     · 否则继续往下开。
   十人桌最多 45 场未定；未定不超过 22 场时精确展开，再多改用抽样。
   ========================================================================== */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) { module.exports = factory(); }
    else { root.DGEngine = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var N = 10;
    var MAX_EXACT = 22;
    var MC_SAMPLES = 500000;

    function clampP(v) {
        if (v === null || v === undefined || v === '') { return 500; }
        var x = Math.round(Number(v));
        if (!isFinite(x)) { return 500; }
        if (x < 0) { x = 0; }
        if (x > 1000) { x = 1000; }
        return x;
    }

    /* 随机数：mulberry32，给定种子可复现 */
    function rng(seed) {
        var a = (seed >>> 0) || 1;
        return function () {
            a = (a + 0x6D2B79F5) >>> 0;
            var t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function randn(next) {
        var u = 0, v = 0;
        while (u === 0) { u = next(); }
        while (v === 0) { v = next(); }
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }

    /* ---------- 最大流：这人还有没有戏 ----------
       经典「淘汰判定」。设 k 余下各场全胜，得 wkWins；别人 j 至多再赢
       cap[j] = wkWins − wins[j] 场（赢到这个数也只是并列，仍算夺冠）。
       余下不关 k 的场，每场必须派一个人赢，于是
         源点 →（容量 1）每场 →（容量 1）该场两人 →（容量 cap）各人 → 汇点。
       满流 ⇔ 存在一种结局让 k 并列或独占鳌头 ⇔ k 的夺冠概率 > 0。
       图只有几十条边，一次 Edmonds–Karp 就够，属 P。                          */
    function canWin(P, k) {
        var n = N, i, j, p, a;
        var wins = new Int32Array(n);
        var rem = new Int32Array(n);
        var rest = [];                      /* 不关 k 的未定场 */
        var wkWins = 0;

        for (i = 0; i < n; i++) {
            for (j = i + 1; j < n; j++) {
                p = clampP(P[i][j]);
                if (p <= 0) { wins[j] += 1; }
                else if (p >= 1000) { wins[i] += 1; }
                else {
                    rem[i] += 1; rem[j] += 1;
                    if (i !== k && j !== k) { rest.push([i, j]); }
                }
            }
        }
        wkWins = wins[k] + rem[k];

        var caps = new Array(n);
        for (a = 0; a < n; a++) {
            caps[a] = (a === k) ? 0 : wkWins - wins[a];
        }
        for (a = 0; a < n; a++) {
            if (a !== k && caps[a] < 0) {
                return { ok: false, wkWins: wkWins, caps: caps, games: rest.length,
                         why: '第 ' + (a + 1) + ' 号已经赢过 ' + wins[a] + ' 场，追不上' };
            }
        }

        /* 建图：0 源点，1..m 场，m+1..m+n 人，m+n+1 汇点 */
        var m = rest.length;
        var S = 0, T = m + n + 1, V = T + 1;
        var to = [], cap = [], head = new Array(V).fill(-1), nxt = [];
        function addEdge(u, v, c) {
            to.push(v); cap.push(c); nxt.push(head[u]); head[u] = to.length - 1;
            to.push(u); cap.push(0); nxt.push(head[v]); head[v] = to.length - 1;
        }
        for (a = 0; a < m; a++) {
            addEdge(S, 1 + a, 1);
            addEdge(1 + a, m + 1 + rest[a][0], 1);
            addEdge(1 + a, m + 1 + rest[a][1], 1);
        }
        for (a = 0; a < n; a++) {
            if (caps[a] > 0) { addEdge(m + 1 + a, T, caps[a]); }
        }

        var flow = 0;
        var level = new Int32Array(V), iter = new Int32Array(V), q = new Int32Array(V);
        function bfs() {
            level.fill(-1); level[S] = 0;
            var h = 0, t = 0; q[t++] = S;
            while (h < t) {
                var u = q[h++];
                for (var e = head[u]; e !== -1; e = nxt[e]) {
                    if (cap[e] > 0 && level[to[e]] === -1) {
                        level[to[e]] = level[u] + 1;
                        q[t++] = to[e];
                    }
                }
            }
            return level[T] !== -1;
        }
        function dfs(u, f) {
            if (u === T) { return f; }
            for (; iter[u] !== -1; iter[u] = nxt[iter[u]]) {
                var e = iter[u], v = to[e];
                if (cap[e] > 0 && level[v] === level[u] + 1) {
                    var d = dfs(v, Math.min(f, cap[e]));
                    if (d > 0) { cap[e] -= d; cap[e ^ 1] += d; return d; }
                }
            }
            return 0;
        }
        while (bfs()) {
            for (a = 0; a < V; a++) { iter[a] = head[a]; }
            var f;
            while ((f = dfs(S, 1e9)) > 0) { flow += f; }
        }

        /* 一种可行的结局：每场流量去了哪边，就是谁赢 */
        var witness = [];
        for (a = 0; a < m; a++) {
            var e1 = -1;
            for (var e2 = head[1 + a]; e2 !== -1; e2 = nxt[e2]) {
                if (cap[e2] === 0 && to[e2] > m && to[e2] <= m + n) { e1 = to[e2] - m - 1; break; }
            }
            witness.push([rest[a][0], rest[a][1], e1]);
        }

        return {
            ok: flow === m, flow: flow, need: m, wkWins: wkWins,
            caps: caps, wins: wins, rem: rem, witness: witness
        };
    }

    /* ---------- 求解 ---------- */

    function solve(P, opt) {
        opt = opt || {};
        var t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        var n = N;
        var wins = new Int32Array(n);
        var remCnt = new Int32Array(n);
        var oi = [], oj = [], op = [];
        var i, j, p;

        for (i = 0; i < n; i++) {
            for (j = i + 1; j < n; j++) {
                p = clampP(P[i][j]);
                if (p <= 0) { wins[j] += 1; }
                else if (p >= 1000) { wins[i] += 1; }
                else {
                    remCnt[i] += 1; remCnt[j] += 1;
                    oi.push(i); oj.push(j); op.push(p / 1000);
                }
            }
        }

        var k = oi.length;
        var acc = new Float64Array(n);
        var nodes = 0;
        var mode = 'exact';

        if (k > 0 && k <= (opt.maxExact || MAX_EXACT)) {
            /* rem[t][i]：从第 t 场起，i 还有几场没下 */
            var rem = new Array(k + 1);
            rem[k] = new Int8Array(n);
            for (var t = k - 1; t >= 0; t--) {
                var r = rem[t + 1].slice();
                r[oi[t]] += 1;
                r[oj[t]] += 1;
                rem[t] = r;
            }

            var rec = function (idx, prob) {
                nodes++;
                var a, best = -1, leadN = 0, settled = true;
                for (a = 0; a < n; a++) { if (wins[a] > best) { best = wins[a]; } }
                var rr = rem[idx];
                for (a = 0; a < n; a++) {
                    if (wins[a] === best) {
                        leadN++;
                        if (rr[a] > 0) { settled = false; }
                    } else if (wins[a] + rr[a] >= best) {
                        settled = false;
                    }
                }
                if (settled) {
                    var share = prob / leadN;
                    for (a = 0; a < n; a++) { if (wins[a] === best) { acc[a] += share; } }
                    return;
                }
                if (idx >= k) { return; }           /* 理论上到不了这里 */
                var x = oi[idx], y = oj[idx], q = op[idx];
                wins[x] += 1;
                rec(idx + 1, prob * q);
                wins[x] -= 1;
                wins[y] += 1;
                rec(idx + 1, prob * (1 - q));
                wins[y] -= 1;
            };
            rec(0, 1);
        } else if (k === 0) {
            var best0 = -1, cnt0 = 0, a0;
            for (a0 = 0; a0 < n; a0++) { if (wins[a0] > best0) { best0 = wins[a0]; } }
            for (a0 = 0; a0 < n; a0++) { if (wins[a0] === best0) { cnt0++; } }
            for (a0 = 0; a0 < n; a0++) { if (wins[a0] === best0) { acc[a0] = 1 / cnt0; } }
            nodes = 1;
        } else {
            mode = 'mc';
            var next = rng(opt.mcSeed || 20261118);
            var samples = opt.samples || MC_SAMPLES;
            var w = new Int32Array(n);
            var s, bestm, cntm, am, bm;
            for (s = 0; s < samples; s++) {
                w.set(wins);
                for (var u = 0; u < k; u++) {
                    if (next() < op[u]) { w[oi[u]] += 1; }
                    else { w[oj[u]] += 1; }
                }
                bestm = -1; cntm = 0;
                for (am = 0; am < n; am++) { if (w[am] > bestm) { bestm = w[am]; } }
                for (am = 0; am < n; am++) { if (w[am] === bestm) { cntm++; } }
                for (am = 0; am < n; am++) { if (w[am] === bestm) { acc[am] += 1 / cntm; } }
            }
            for (bm = 0; bm < n; bm++) { acc[bm] /= samples; }
            nodes = samples;
        }

        /* 期望胜场：已定的 + 未定场按概率折算 */
        var expWins = new Array(n);
        var v;
        for (v = 0; v < n; v++) { expWins[v] = wins[v]; }
        for (v = 0; v < k; v++) {
            expWins[oi[v]] += op[v];
            expWins[oj[v]] += 1 - op[v];
        }

        /* 最大流判定：出局 / 有戏 / 已锁定 */
        var status = new Array(n);
        for (v = 0; v < n; v++) {
            var locked = true;
            for (var q2 = 0; q2 < n; q2++) {
                if (q2 !== v && wins[q2] + remCnt[q2] >= wins[v]) { locked = false; break; }
            }
            if (locked) { status[v] = 'lock'; }
            else if (canWin(P, v).ok) { status[v] = 'live'; }
            else { status[v] = 'out'; }
        }

        var permille = new Array(n);
        var total = 0;
        for (v = 0; v < n; v++) {
            permille[v] = Math.round(acc[v] * 1000);
            total += permille[v];
        }

        var ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
        var out = {
            acc: acc,
            permille: permille,
            permilleTotal: total,
            expWins: expWins,
            status: status,
            wins: wins,
            rem: remCnt,
            openCount: k,
            mode: mode,
            nodes: nodes,
            samples: mode === 'mc' ? (opt.samples || MC_SAMPLES) : 0,
            ms: Math.round(ms * 10) / 10
        };
        return out;
    }

    /* ---------- 出题 ---------- */

    /* 一张十人单循环的表：先按「棋力」定出每对的胜率，已定的场照胜率抽成胜负，
       未定的十场把胜率原样留在格子里。 */
    function puzzle(seed) {
        var next = rng(seed);
        var n = N;
        var i, j, a, b;
        var str = new Array(n);
        for (i = 0; i < n; i++) { str[i] = randn(next); }

        var pairs = [];
        for (i = 0; i < n; i++) {
            for (j = i + 1; j < n; j++) { pairs.push([i, j]); }
        }
        var q = [];
        for (a = 0; a < pairs.length; a++) {
            i = pairs[a][0]; j = pairs[a][1];
            var raw = 1000 / (1 + Math.exp(-0.62 * (str[i] - str[j])));
            var val = Math.max(40, Math.min(960, Math.round(raw / 5) * 5));
            q[a] = val;
        }

        /* 抽十场当「未定」 */
        var order = [];
        for (a = 0; a < pairs.length; a++) { order.push(a); }
        for (a = order.length - 1; a > 0; a--) {
            var k2 = Math.floor(next() * (a + 1));
            var tmp = order[a]; order[a] = order[k2]; order[k2] = tmp;
        }
        var unknownIdx = order.slice(0, 10);
        var unknown = [];
        var mark = new Array(pairs.length);
        for (a = 0; a < unknownIdx.length; a++) {
            mark[unknownIdx[a]] = true;
            unknown.push([pairs[unknownIdx[a]][0], pairs[unknownIdx[a]][1], q[unknownIdx[a]]]);
        }

        var P = [];
        for (i = 0; i < n; i++) {
            P.push(new Array(n).fill(0));
            P[i][i] = null;
        }
        for (a = 0; a < pairs.length; a++) {
            i = pairs[a][0]; j = pairs[a][1];
            var pv;
            if (mark[a]) {
                pv = q[a];
            } else {
                pv = next() * 1000 < q[a] ? 1000 : 0;
            }
            P[i][j] = pv;
            P[j][i] = 1000 - pv;
        }

        return { seed: seed >>> 0, P: P, pairs: pairs, unknown: unknown, q: q };
    }

    /* 小测验用的题：一号选手的答案不能一边倒，且至少三个人还有戏 */
    function question(seed) {
        var base = (seed >>> 0) || 1;
        var best = null;
        for (var t = 0; t < 240; t++) {
            var s = (base + t) >>> 0;
            var pz = puzzle(s);
            var ans = solve(pz.P);
            pz.ans = ans;
            if (!best) { best = pz; }
            var p1 = ans.permille[0];
            var alive = 0;
            for (var i = 0; i < N; i++) { if (ans.permille[i] >= 25) { alive++; } }
            /* 一号选手先过最大流：有戏才出；再要求答案不贴 0/1000 */
            if (ans.status[0] === 'live' && p1 >= 30 && p1 <= 970 && alive >= 3) { return pz; }
        }
        return best;
    }

    return {
        N: N,
        solve: solve,
        canWin: canWin,
        puzzle: puzzle,
        question: question,
        rng: rng,
        clampP: clampP
    };
}));
