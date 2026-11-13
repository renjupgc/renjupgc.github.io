/*
 * 连珠杂箱 - 开局命名与同型检索
 * ------------------------------------------------------------
 * 两件事，都是纯函数，不碰 DOM，方便用 node 直接跑校验：
 *
 *   1. 开局叫什么名字。连珠规定第一手在天元、第二手在 3×3 以内、第三手在
 *      5×5 以内；再拿旋转和镜像把重复的形并掉，剩下来的正好二十六种，就是
 *      「26 开局」（D1〜D13 直指、I1〜I13 斜指）。所以命名不必查谱，只要把
 *      第一手挪到原点、看第二手在正侧还是斜侧、再看第三手的相对坐标即可。
 *      名字里带「星」还是「月」也有规律：第三手与第一手在同一条线或对角线
 *      上、中间空着一格，就是星；其余都是月。
 *
 *   2. 同型局。把一局棋的前 n 手摊成 225 维落点向量（黑 +1、白 −1，越早的
 *      手权重越大），两局之间取余弦相似度。棋形转个方向还是同一个棋形，所以
 *      每个候选都要在 8 个对称、以及黑白互换共 16 种摆法里取最高分。
 *
 * 用法：
 *   var K = window.ZBX_OPENINGS;
 *   K.classify(moves);              // -> {ok, name:'溪月', code:'D2', ...}
 *   K.book();                       // 26 条，带坐标，可点着摆
 *   K.similar(moves, games);        // -> [{game, score, sym}, ...] 由高到低
 *
 * moves 是 board.js 的 [{i, j, color}]：i 自左向右 0〜14，j 自上而下 0〜14。
 */

(function (root) {
    'use strict';

    var SIZE = 15;
    var COLS = 'ABCDEFGHIJKLMNO';

    /*
     * 26 开局的第三手坐标，以第一手为原点、j 向下为正。
     * 直指：第二手在正侧 (0,-1)；斜指：第二手在斜侧 (1,-1)。
     * 每种只列「再并按对称之后的那一半」的十三个点，查表时把八个对称全展开。
     */
    var DIRECT = [
        ['D1', '寒星', 'Kansei', 0, -2, '星', '黑必胜'],
        ['D2', '溪月', 'Keigetsu', 1, -2, '月', '黑必胜'],
        ['D3', '疏星', 'Sosei', 2, -2, '星', '白稍优'],
        ['D4', '花月', 'Kagetsu', 1, -1, '月', '黑必胜'],
        ['D5', '残月', 'Zangetsu', 2, -1, '月', '黑优'],
        ['D6', '雨月', 'Ugetsu', 1, 0, '月', '黑必胜'],
        ['D7', '金星', 'Kinsei', 2, 0, '月', '黑必胜'],
        ['D8', '松月', 'Shogetsu', 0, 1, '月', '黑优'],
        ['D9', '丘月', 'Kyugetsu', 1, 1, '月', '黑稍优'],
        ['D10', '新月', 'Shingetsu', 2, 1, '月', '黑必胜'],
        ['D11', '瑞星', 'Zuisei', 0, 2, '星', '大致平衡'],
        ['D12', '山月', 'Sangetsu', 1, 2, '月', '黑优'],
        ['D13', '游星', 'Yusei', 2, 2, '星', '白必胜']
    ];

    var INDIRECT = [
        ['I1', '长星', 'Chosei', 2, -2, '星', '白稍优'],
        ['I2', '峡月', 'Kyogetsu', 2, -1, '月', '黑必胜'],
        ['I3', '恒星', 'Kosei', 2, 0, '星', '黑必胜'],
        ['I4', '水月', 'Suigetsu', 2, 1, '月', '黑必胜'],
        ['I5', '流星', 'Ryusei', 2, 2, '星', '白稍优'],
        ['I6', '云月', 'Ungetsu', 1, 0, '月', '黑必胜'],
        ['I7', '浦月', 'Hogetsu', 1, 1, '月', '黑必胜'],
        ['I8', '岚月', 'Rangetsu', 1, 2, '月', '黑必胜'],
        ['I9', '银月', 'Gingetsu', 0, 1, '月', '黑优'],
        ['I10', '明星', 'Myojo', 0, 2, '星', '黑必胜'],
        ['I11', '斜月', 'Shagetsu', -1, 1, '月', '黑稍优'],
        ['I12', '名月', 'Meigetsu', -1, 2, '月', '黑优'],
        ['I13', '彗星', 'Suisei', -2, 2, '星', '白必胜']
    ];

    /* 正方形的八个对称：(x, y) -> ... */
    var SYMS = [
        function (x, y) { return [x, y]; },
        function (x, y) { return [-y, x]; },
        function (x, y) { return [-x, -y]; },
        function (x, y) { return [y, -x]; },
        function (x, y) { return [-x, y]; },
        function (x, y) { return [y, x]; },
        function (x, y) { return [x, -y]; },
        function (x, y) { return [-y, -x]; }
    ];

    function key(sx, sy, px, py) {
        return sx + ',' + sy + '|' + px + ',' + py;
    }

    /* 把十三个点按八个对称摊成一张表：任意朝向的第二、三手都能查到名字 */
    var MAP = {};
    var LIST = [];
    (function build() {
        var groups = [[DIRECT, 'direct', '直指', 0, -1], [INDIRECT, 'indirect', '斜指', 1, -1]];
        groups.forEach(function (g) {
            var rows = g[0];
            var fam = g[1];
            var famName = g[2];
            var w0 = g[3], w1 = g[4];
            rows.forEach(function (r) {
                var item = {
                    code: r[0], name: r[1], en: r[2], star: r[5], note: r[6],
                    family: fam, familyName: famName,
                    cx: r[3], cy: r[4],
                    full: r[1] + '局'
                };
                LIST.push(item);
                SYMS.forEach(function (S) {
                    var w = S(w0, w1);
                    var p = S(r[3], r[4]);
                    MAP[key(w[0], w[1], p[0], p[1])] = item;
                });
            });
        });
    })();

    function coord(i, j) {
        return COLS.charAt(i) + (SIZE - j);
    }

    /* ------------------------------------------------------------ 命名 */

    /*
     * 判开局名。三手之前不判（连珠的二十六种开局本来就是「前三手」的定义），
     * 第二手不贴着第一手、或第三手跑到 5×5 之外，都算脱谱——照样给出理由，
     * 免得让人以为是没识别出来。
     */
    function classify(moves) {
        var out = { ok: false, need: 3 };
        if (!moves || moves.length < 3) {
            out.why = moves && moves.length ? '摆到第三手才能定开局' : '空盘';
            return out;
        }
        var o = moves[0];
        var d2x = moves[1].i - o.i, d2y = moves[1].j - o.j;
        var d3x = moves[2].i - o.i, d3y = moves[2].j - o.j;

        out.first = coord(o.i, o.j);
        out.third = coord(moves[2].i, moves[2].j);
        out.center = o.i === 7 && o.j === 7;

        var fam;
        if (Math.abs(d2x) + Math.abs(d2y) === 1) {
            fam = 'direct';
        } else if (Math.abs(d2x) === 1 && Math.abs(d2y) === 1) {
            fam = 'indirect';
        } else {
            out.why = '第二手不在第一手的相邻点上（连珠要求贴在 3×3 以内），不构成开局';
            out.off = 'second';
            return out;
        }

        var hit = MAP[key(d2x, d2y, d3x, d3y)];
        if (!hit) {
            if (Math.abs(d3x) > 2 || Math.abs(d3y) > 2) {
                out.why = '第三手落在中央 5×5 之外，二十六种开局里没有这一手';
                out.off = 'third';
            } else {
                out.why = '第三手压在第一手或第二手上，不构成开局';
                out.off = 'overlap';
            }
            out.family = fam;
            out.familyName = fam === 'direct' ? '直指' : '斜指';
            return out;
        }

        out.ok = true;
        out.name = hit.name;
        out.code = hit.code;
        out.en = hit.en;
        out.full = hit.full;
        out.star = hit.star;
        out.note = hit.note;
        out.family = hit.family;
        out.familyName = hit.familyName;
        out.why = '第二手' + (hit.family === 'direct' ? '贴在正侧，是直指' : '贴在斜角，是斜指') +
            '；第三手在' + out.third + '，' + hit.star + '形，' + hit.code + ' ' + hit.full;
        return out;
    }

    /* 二十六种开局一览：直接用规范坐标，点一下就能摆出来 */
    function book() {
        return LIST.map(function (it) {
            var w = it.family === 'direct' ? [0, -1] : [1, -1];
            return {
                code: it.code, name: it.name, en: it.en, star: it.star,
                note: it.note, family: it.family, familyName: it.familyName,
                stones: [
                    { i: 7, j: 7, color: 'b' },
                    { i: 7 + w[0], j: 7 + w[1], color: 'w' },
                    { i: 7 + it.cx, j: 7 + it.cy, color: 'b' }
                ]
            };
        });
    }

    /* --------------------------------------------------------- 同型检索 */

    var DIM = SIZE * SIZE;

    /*
     * 落点向量：225 维，黑 +w、白 −w，w 随手数几何衰减——开局比的是前几手。
     * 坐标先按第一手平移到盘心再算，所以同一个棋形摆在哪一格都算同型；
     * 平移到窗口外的子（首手贴边时会有几枚）不计入。
     */
    function vec(moves, n, flip) {
        var v = new Float64Array(DIM);
        n = Math.min(n, moves.length);
        for (var k = 0; k < n; k++) {
            var m = moves[k];
            if (!(m.i >= 0 && m.i < SIZE && m.j >= 0 && m.j < SIZE)) { continue; }
            var w = Math.pow(0.88, k);
            var sign = (k % 2 === 0) !== !!flip ? 1 : -1;
            v[m.i * SIZE + m.j] += sign * w;
        }
        return v;
    }

    function cos(a, b) {
        var dot = 0, na = 0, nb = 0;
        for (var k = 0; k < DIM; k++) {
            dot += a[k] * b[k];
            na += a[k] * a[k];
            nb += b[k] * b[k];
        }
        if (!na || !nb) { return 0; }
        return dot / Math.sqrt(na * nb);
    }

    /* 把一个棋形按对称摆进以盘心为原点的 15×15 窗口 */
    function transpose(moves, S) {
        var out = new Array(moves.length);
        for (var k = 0; k < moves.length; k++) {
            var p = S(moves[k].i - moves[0].i, moves[k].j - moves[0].j);
            out[k] = { i: p[0] + 7, j: p[1] + 7 };
        }
        return out;
    }

    /*
     * 同型局：对每个候选，在 8 个对称 × 黑白互换（16 种摆法）里取最高分。
     * 比较长度取 min(查询手数, 候选手数, n)，两边手数一样多才公平——否则
     * 手顺长的局天然吃亏。分数 0〜100，100 表示前 n 手完全重合（含镜像）。
     */
    function similar(moves, games, opts) {
        opts = opts || {};
        var n = opts.n || 10;
        var pool = opts.filter ? games.filter(opts.filter) : games;
        var res = [];
        if (!moves || !moves.length) { return res; }

        var qc = moves[0];
        var qall = moves.map(function (m) {
            return { i: m.i - qc.i + 7, j: m.j - qc.j + 7 };
        });

        pool.forEach(function (g) {
            var cand = decode(g.m);
            if (cand.length < 3) { return; }
            var k = Math.min(n, qall.length, cand.length);
            var qv = vec(qall, k, false);
            var best = 0, bestSym = 0, bestFlip = 0;

            for (var s = 0; s < SYMS.length; s++) {
                var t = transpose(cand.slice(0, k), SYMS[s]);
                for (var f = 0; f < 2; f++) {
                    var sc = cos(qv, vec(t, k, f));
                    if (sc > best) { best = sc; bestSym = s; bestFlip = f; }
                }
            }
            res.push({
                game: g,
                score: Math.max(0, Math.round(best * 1000) / 10),
                sym: bestSym,
                flip: bestFlip,
                plies: k
            });
        });

        res.sort(function (a, b) {
            return b.score - a.score || String(a.game.d).localeCompare(String(b.game.d));
        });
        return res;
    }

    /* 一手两个字母的紧凑手顺（与 board.js 的 encodeCompact 同规则） */
    function decode(code) {
        var A = 'abcdefghijklmno';
        var out = [];
        for (var k = 0; k + 1 < String(code || '').length; k += 2) {
            var i = A.indexOf(code.charAt(k));
            var row = A.indexOf(code.charAt(k + 1));
            if (i < 0 || row < 0) { break; }
            out.push({ i: i, j: SIZE - 1 - row, color: k / 2 % 2 === 0 ? 'b' : 'w' });
        }
        return out;
    }

    /* 语料里各开局出现几次：页面拿它说「收录的局里哪种最多」 */
    function tally(games) {
        var box = {};
        games.forEach(function (g) {
            var c = classify(decode(g.m));
            if (!c.ok) { return; }
            var k = c.name;
            box[k] = box[k] || { code: c.code, name: c.name, family: c.familyName, n: 0 };
            box[k].n++;
        });
        return Object.keys(box).map(function (k) { return box[k]; })
            .sort(function (a, b) { return b.n - a.n || a.code.localeCompare(b.code); });
    }

    root.ZBX_OPENINGS = {
        SIZE: SIZE,
        coord: coord,
        classify: classify,
        book: book,
        similar: similar,
        tally: tally,
        decode: decode,
        list: function () { return LIST.slice(); }
    };
})(typeof window !== 'undefined' ? window : globalThis);
