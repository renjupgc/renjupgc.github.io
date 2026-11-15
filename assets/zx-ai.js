/* ==========================================================================
   杂想 · 猜术语 —— 题目与判分引擎（离线版）
   --------------------------------------------------------------------------
   这里没有网络请求，也不需要任何密钥：
     · 题库（assets/zx-bank.js）是预先算好的——术语表、题核、问法三张表；
     · 运行时把三者组合出题目，组合总数 = 题核 × 问法；
     · 判分走同一张术语表：正解 100，同路说法按表里定死的分给，表外的词按
       字面相似度估算，且永远低于表内词。
   所以访客打开页面就能玩，不填任何东西。
   ========================================================================== */

(window.ZXAI = (function () {
    'use strict';

    var B = window.ZXBANK || { terms: {}, cores: [], frames: [] };
    var terms = B.terms || {};
    var cores = B.cores || [];
    var framesR = B.framesR || B.frames || [];
    var framesN = B.framesN || B.framesR || B.frames || [];
    var HINT = B.hint || {};

    /* ---------- 小工具 ---------- */

    function norm(s) {
        return String(s == null ? '' : s)
            .replace(/[\s，。、；：！？「」『』（）()[\]{}"'“”‘’·…—\-_/\\|]/g, '')
            .toLowerCase();
    }

    function rnd(n) { return Math.floor(Math.random() * n); }

    function shuffle(a) {
        var b = a.slice();
        for (var i = b.length - 1; i > 0; i--) {
            var j = rnd(i + 1);
            var t = b[i]; b[i] = b[j]; b[j] = t;
        }
        return b;
    }

    function bigrams(s) {
        var out = {}, i;
        if (s.length === 1) { out[s] = 1; return out; }
        for (i = 0; i < s.length - 1; i++) { out[s.slice(i, i + 2)] = 1; }
        return out;
    }

    /* 字面相似：二元组 Dice 与共字率取大者，0–1 */
    function sim(a, b) {
        if (!a || !b) { return 0; }
        if (a === b) { return 1; }
        var A = bigrams(a), Bg = bigrams(b);
        var ka = Object.keys(A), kb = Object.keys(Bg);
        var hit = 0;
        ka.forEach(function (k) { if (Bg[k]) { hit += 1; } });
        var dice = (2 * hit) / (ka.length + kb.length);
        var setA = {}, setB = {}, sh = 0;
        a.split('').forEach(function (c) { setA[c] = 1; });
        b.split('').forEach(function (c) { setB[c] = (setB[c] || 0) + 1; });
        Object.keys(setA).forEach(function (c) { if (setB[c]) { sh += 1; } });
        var jac = sh / (Object.keys(setA).length + Object.keys(setB).length - sh);
        return Math.max(dice, jac * 0.92);
    }

    /* ---------- 出题 ---------- */

    /* 预先把所有可用的「题核 × 问法」摊平；题面里出现正解的一律作废 */
    var POOL = [];
    (function build() {
        cores.forEach(function (c, ci) {
            if (!c || !terms[c.term]) { return; }
            var t = norm(c.term);
            var fr = (c.k === 'n') ? framesN : framesR;
            fr.forEach(function (f, fi) {
                var p;
                try { p = f(c.say); } catch (e) { return; }
                if (!p) { return; }
                var np = norm(p);
                if (np.indexOf(t) >= 0) { return; }
                /* 题面里已经写着的说法，不能再当作可选提示白送分 */
                var acc = terms[c.term].n.filter(function (r) {
                    return np.indexOf(norm(r[0])) < 0;
                });
                if (acc.length < 3) { return; }
                POOL.push({ ci: ci, fi: fi, prompt: p, acc: acc });
            });
        });
    })();

    var used = {};

    function acceptOf(rows) {
        if (!rows) { return []; }
        /* 打乱固定次序，位置不泄露高低 */
        return shuffle(rows.slice()).map(function (r) {
            return { w: r[0], v: r[1], note: r[2] };
        });
    }

    function makeQuestion() {
        if (!POOL.length) {
            return Promise.reject(new Error('题库没读到：assets/zx-bank.js 可能没加载。'));
        }
        var free = POOL.filter(function (x) { return !used[x.ci + '|' + x.fi]; });
        if (!free.length) { used = {}; free = POOL; }
        var pick = free[rnd(free.length)];
        used[pick.ci + '|' + pick.fi] = 1;

        var core = cores[pick.ci];
        var T = terms[core.term];

        var q = {
            id: core.ref + '-' + pick.fi + '-' + Date.now().toString(36),
            src: 'bank',
            chapter: core.ch,
            prompt: pick.prompt,
            target: core.term,
            say: core.say,
            accept: acceptOf(pick.acc),
            hint: HINT[core.term] || core.note,
            note: T.d,
            ref: core.ref,
            left: POOL.length - Object.keys(used).length
        };
        return Promise.resolve(q);
    }

    /* ---------- 判分 ---------- */

    function verdictOf(p) {
        if (p >= 95) { return '就是它'; }
        if (p >= 88) { return '很近了'; }
        if (p >= 60) { return '沾边'; }
        if (p >= 30) { return '差一层'; }
        return '差得远';
    }

    function rate(q, guess) {
        var g = norm(guess);
        var t = norm(q.target);
        var res = { engine: 'bank', model: 'zx-bank-v1', similarity: 0, verdict: '', matched: [], gap: '', hint: '' };
        if (!g) { return Promise.reject(new Error('没听到词。')); }

        /* 1. 正解 */
        if (g === t) {
            res.similarity = 100;
            res.verdict = verdictOf(100);
            res.matched.push('就是这个落点：' + (terms[q.target] ? terms[q.target].d : ''));
            return Promise.resolve(res);
        }

        /* 2. 同一条路上的说法：分值在题里定死，互不相同 */
        var acc = q.accept || [];
        var hit = null;
        acc.forEach(function (a) {
            if (norm(a.w) === g && (!hit || a.v > hit.v)) { hit = a; }
        });
        if (hit) {
            res.similarity = hit.v;
            res.verdict = verdictOf(hit.v);
            res.matched.push('「' + hit.w + '」也在这一条路上，只是落点不同。');
            res.gap = hit.note;
            if (hit.v < 90) { res.hint = q.hint; }
            return Promise.resolve(res);
        }

        /* 3. 是术语表里的词，只是不在这道题上 */
        var asTerm = null;
        Object.keys(terms).forEach(function (k) {
            if (norm(k) === g) { asTerm = k; }
        });
        if (asTerm) {
            var s0 = sim(g, t);
            /* 它自己那一组近邻说法，和本题的同路说法重合越多，离得越近 */
            var mine = (terms[asTerm].n || []).map(function (r) { return norm(r[0]); });
            var overlap = 0;
            acc.forEach(function (a) {
                if (mine.indexOf(norm(a.w)) >= 0) { overlap += 1; }
            });
            res.similarity = Math.max(11, Math.min(56, Math.round(13 + 12 * overlap + 18 * s0)));
            res.verdict = verdictOf(res.similarity);
            res.matched.push('「' + asTerm + '」是连珠术语，但这一条说的不是它——' +
                '它指的是' + terms[asTerm].d);
            res.hint = q.hint;
            return Promise.resolve(res);
        }

        /* 4. 表外的词：只看字面，最高也到不了表内 */
        var s = sim(g, t);
        var best = 0;
        acc.forEach(function (a) { var x = sim(g, norm(a.w)); if (x > best) { best = x; } });
        var use = Math.max(s, best * 0.86);
        var pct = Math.round(6 + 52 * Math.pow(use, 0.8));
        if (g.length === 1) { pct = Math.min(pct, 34); }
        res.similarity = Math.max(3, Math.min(58, pct));
        res.verdict = verdictOf(res.similarity);

        if (best >= 0.34) {
            var near = null;
            acc.forEach(function (a) {
                if (!near && sim(g, norm(a.w)) === best) { near = a; }
            });
            if (near) {
                res.matched.push('字面上和「' + near.w + '」挨得最近，但还没到那一步。');
            }
        }
        if (!res.matched.length) {
            res.matched.push('和本题的说法都对不上，先换一个方向。');
        }
        res.hint = q.hint;
        return Promise.resolve(res);
    }

    return {
        isReady: function () { return POOL.length > 0; },
        size: function () { return POOL.length; },
        usedCount: function () { return Object.keys(used).length; },
        makeQuestion: makeQuestion,
        rate: rate,
        terms: terms,
        cores: cores
    };
})());
