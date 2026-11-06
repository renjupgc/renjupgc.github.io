/*
 * 连珠杂箱 - VCF 做题
 * ------------------------------------------------------------
 * 黑方（攻方）每一手都必须冲四，白方只有一个挡点，跟着挡下去，直到成五。
 * 这里的 VCF 搜索是自己写的，不依赖 Rapfi：只找「冲四」这一种着法，
 * 分支很窄，纯 JS 也够快。规则按无禁手判定（黑棋不做三三/四四检查）。
 *
 * 同一段代码在 Node 里可以 require 出来校验题库，所以浏览器和 Node 各走各路。
 */

(function (root, factory) {
    'use strict';

    var api = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = api;               /* Node：node -e "…" 校验题目时用 */
    } else if (typeof document !== 'undefined') {
        /*
         * 站内换页是无刷新替换 <main>，同名的 vcf.js 不会再次执行，
         * 所以盯着 main 的变化，看到新的空棋盘就重新挂一次。
         */
        var once = function () {
            api.boot(root, document);

            if (!window.MutationObserver) { return; }
            var obs = new window.MutationObserver(function () {
                var c = document.getElementById('vcf-board');
                if (c && !c.dataset.booted) { api.boot(root, document); }
            });
            obs.observe(document.body, { childList: true, subtree: true });
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', once);
        } else {
            once();
        }
    }
})(typeof window !== 'undefined' ? window : null, function () {
    'use strict';

    var N = 15;
    var EMPTY = 0, BLACK = 1, WHITE = 2;
    var DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

    /* ---------- 搜索内核 ---------- */

    function inside(x, y) {
        return x >= 0 && y >= 0 && x < N && y < N;
    }

    /* 过 (x,y) 的四个方向上有没有连成五个 */
    function isFive(b, x, y, p) {
        for (var d = 0; d < 4; d++) {
            var dx = DIRS[d][0], dy = DIRS[d][1], n = 1, i, cx, cy;
            for (i = 1; i < 5; i++) {
                cx = x + dx * i; cy = y + dy * i;
                if (!inside(cx, cy) || b[cy * N + cx] !== p) { break; }
                n++;
            }
            for (i = 1; i < 5; i++) {
                cx = x - dx * i; cy = y - dy * i;
                if (!inside(cx, cy) || b[cy * N + cx] !== p) { break; }
                n++;
            }
            if (n >= 5) { return true; }
        }
        return false;
    }

    /* 只在这个方向上连成五个（冲四的补点必须与这一手同线） */
    function lineFive(b, cx, cy, p, dx, dy) {
        var n = 1, i, x, y;
        for (i = 1; i <= 4; i++) {
            x = cx + dx * i; y = cy + dy * i;
            if (!inside(x, y) || b[y * N + x] !== p) { break; }
            n++;
        }
        for (i = 1; i <= 4; i++) {
            x = cx - dx * i; y = cy - dy * i;
            if (!inside(x, y) || b[y * N + x] !== p) { break; }
            n++;
        }
        return n >= 5;
    }

    /*
     * 刚落下的这一手在四条线上各能补出哪些成五点。
     * 成五点必然落在以 (x,y) 为中心、半径 4 的十字上，扫一遍就够。
     */
    function completions(b, x, y, p, out) {
        for (var d = 0; d < 4; d++) {
            var dx = DIRS[d][0], dy = DIRS[d][1], i;
            for (i = -4; i <= 4; i++) {
                if (!i) { continue; }
                var cx = x + dx * i, cy = y + dy * i;
                if (!inside(cx, cy)) { continue; }
                var k = cy * N + cx;
                if (b[k] !== EMPTY || out.indexOf(k) >= 0) { continue; }
                b[k] = p;
                var five = lineFive(b, cx, cy, p, dx, dy);
                b[k] = EMPTY;
                if (five) { out.push(k); }
            }
        }
        return out;
    }

    /* 邻近两格内有子的空点才可能冲四，其余不必算 */
    function candidates(b) {
        var list = [], seen = new Int8Array(N * N), x, y, dx, dy;
        for (y = 0; y < N; y++) {
            for (x = 0; x < N; x++) {
                if (b[y * N + x] === EMPTY) { continue; }
                for (dy = -2; dy <= 2; dy++) {
                    for (dx = -2; dx <= 2; dx++) {
                        var cx = x + dx, cy = y + dy;
                        if (!inside(cx, cy)) { continue; }
                        var k = cy * N + cx;
                        if (b[k] !== EMPTY || seen[k]) { continue; }
                        seen[k] = 1;
                        list.push(k);
                    }
                }
            }
        }
        return list;
    }

    /* 返回一串点：攻、守、攻、守……末尾一手是成五（或双四后的补五） */
    function search(b, atk, depth, deadline) {
        if (depth <= 0 || Date.now() > deadline) { return null; }

        var def = atk === BLACK ? WHITE : BLACK;
        var cand = candidates(b);
        var fallback = null;

        for (var i = 0; i < cand.length; i++) {
            var k = cand[i], x = k % N, y = (k / N) | 0;

            b[k] = atk;
            if (isFive(b, x, y, atk)) {
                b[k] = EMPTY;
                return [k];
            }

            var comps = completions(b, x, y, atk, []);
            if (!comps.length) {           /* 不是冲四，VCF 里没有这一手 */
                b[k] = EMPTY;
                continue;
            }
            if (comps.length > 1) {        /* 活四或双四：只有作为最后一手时才算数 */
                b[k] = EMPTY;
                if (depth === 1 && !fallback) { fallback = [k, comps[0]]; }
                continue;
            }

            var q = comps[0];
            b[q] = def;
            var ok = !isFive(b, q % N, (q / N) | 0, def);
            var rest = ok ? search(b, atk, depth - 1, deadline) : null;
            b[q] = EMPTY;
            b[k] = EMPTY;

            if (rest) { return [k, q].concat(rest); }
        }
        return fallback;
    }

    /* 逐层加深，拿到最短的一串；超时就当作没解 */
    function solve(b, atk, maxDepth, ms) {
        var deadline = Date.now() + (ms || 1200);
        for (var d = 1; d <= maxDepth; d++) {
            var line = search(b, atk, d, deadline);
            if (line) { return line; }
            if (Date.now() > deadline) { return null; }
        }
        return null;
    }

    /* ---------- 出题器 ----------
     * 做法跟 renju4433 的生成器同路：先让双方「安静」自对弈铺局面
     * （谁都不主动冲四），铺到黑方该走时回头查这里是不是藏着 VCF，
     * 藏得够深就成对删掉与解法无关的子，最后再复算一遍深度。
     */

    function mulberry32(a) {
        return function () {
            a |= 0;
            a = a + 1831565813 | 0;
            var t = Math.imul(a ^ a >>> 15, 1 | a);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    /* 假设在 (x,y) 落 p 子，某个方向上这一串值多少分 */
    function runScore(b, x, y, p, dx, dy) {
        var run = 1, open = 0, i, cx, cy, v;
        for (i = 1; i <= 4; i++) {
            cx = x + dx * i; cy = y + dy * i;
            if (!inside(cx, cy)) { break; }
            v = b[cy * N + cx];
            if (v === p) { run++; }
            else { if (v === EMPTY) { open++; } break; }
        }
        for (i = 1; i <= 4; i++) {
            cx = x - dx * i; cy = y - dy * i;
            if (!inside(cx, cy)) { break; }
            v = b[cy * N + cx];
            if (v === p) { run++; }
            else { if (v === EMPTY) { open++; } break; }
        }
        if (run >= 5) { return 10000000; }
        if (run === 4) { return open >= 2 ? 1000000 : (open === 1 ? 90000 : 0); }
        if (run === 3) { return open >= 2 ? 14000 : (open === 1 ? 1600 : 0); }
        if (run === 2) { return open >= 2 ? 420 : (open === 1 ? 80 : 0); }
        return open >= 2 ? 22 : 8;
    }

    /* 这个点对 p 的价值；quiet 时把自己造出四的着法重罚，逼双方都安静 */
    function threat(b, x, y, p, quiet) {
        var s = 0, d, v;
        for (d = 0; d < 4; d++) {
            v = runScore(b, x, y, p, DIRS[d][0], DIRS[d][1]);
            if (quiet && v >= 90000) { s -= 400000; }
            else { s += v; }
        }
        return s;
    }

    function near(b, k, r) {
        var x = k % N, y = (k / N) | 0, dx, dy, cx, cy;
        for (dy = -r; dy <= r; dy++) {
            for (dx = -r; dx <= r; dx++) {
                cx = x + dx; cy = y + dy;
                if (inside(cx, cy) && b[cy * N + cx]) { return true; }
            }
        }
        return false;
    }

    /* 挑一手安静的棋：自己别冲四，同时看对方在这里的威胁值 */
    function pickQuiet(b, me, rnd, boxR) {
        var opp = me === BLACK ? WHITE : BLACK;
        var list = [], c, x, y, s2;
        for (c = 0; c < N * N; c++) {
            if (b[c] || !near(b, c, 2)) { continue; }
            x = c % N; y = (c / N) | 0;
            if (boxR >= 0 && (Math.abs(x - 7) > boxR || Math.abs(y - 7) > boxR)) { continue; }
            s2 = threat(b, x, y, opp, false);
            list.push({
                c: c,
                s2: s2,
                v: threat(b, x, y, me, true) + s2 * 0.92 + rnd() * 40
            });
        }
        if (!list.length) { return -1; }
        list.sort(function (a, b2) { return b2.v - a.v; });
        var i, top = Math.min(list.length, 16);
        for (i = 0; i < top; i++) {
            if (list[i].s2 >= 1000000) { return list[i].c; }   /* 对方这里能成四，先堵 */
        }
        i = Math.min(list.length, 4);
        return list[Math.floor(Math.pow(rnd(), 1.5) * i)].c;
    }

    /* 自对弈到黑方该走，顺手看看有没有 VCF */
    function playQuiet(rnd, cfg) {
        var bd = new Int8Array(N * N), order = [];
        var turn = BLACK, nb = 0, nw = 0;
        var maxMoves = 40 + Math.floor(rnd() * 14);
        for (var mv = 0; mv < maxMoves; mv++) {
            var c = mv === 0 ? 7 * N + 7 : pickQuiet(bd, turn, rnd, mv < 4 ? mv : -1);
            if (c < 0 || bd[c]) { return null; }
            bd[c] = turn;
            order.push(c);
            if (turn === BLACK) { nb++; } else { nw++; }
            if (isFive(bd, c % N, (c / N) | 0, turn)) { return null; }
            turn = turn === BLACK ? WHITE : BLACK;

            if (turn !== BLACK || mv < 11 || nb !== nw) { continue; }
            var line = solve(bd, BLACK, cfg.maxMoves, cfg.ms);
            if (!line) { continue; }
            var bm = (line.length + 1) >> 1;
            if (bm >= cfg.minMoves && bm <= cfg.maxMoves) {
                return { bd: bd, order: order, path: line, moves: bm };
            }
        }
        return null;
    }

    /* 成对删掉无关的子：前 4 手与解法路径上的点得留着，每删一对都要复算 */
    function trim(bd, order, path, cfg) {
        var cur = Int8Array.from(bd), keep = {}, i, a, c1, c2, p1, p2, line, bm, ok;
        for (i = 0; i < 4 && i < order.length; i++) { keep[order[i]] = 1; }
        for (i = 0; i < path.length; i++) { keep[path[i]] = 1; }

        var changed = true, round = 0;
        while (changed && round++ < 2) {
            changed = false;
            for (a = 4; a + 1 < order.length; a++) {
                c1 = order[a]; c2 = order[a + 1];
                if (!cur[c1] || !cur[c2] || keep[c1] || keep[c2]) { continue; }
                p1 = cur[c1]; p2 = cur[c2];
                cur[c1] = EMPTY; cur[c2] = EMPTY;
                line = solve(cur, BLACK, cfg.maxMoves, cfg.ms);
                bm = line ? (line.length + 1) >> 1 : 0;
                ok = bm >= cfg.minMoves && bm <= cfg.maxMoves;
                if (ok) { changed = true; }
                else { cur[c1] = p1; cur[c2] = p2; }
            }
        }
        return cur;
    }

    /* 难度档位：min/max 是黑方手数（手胜），budget 是这一档愿意花的时间 */
    var LEVELS = [
        { name: '入门', min: 3, max: 3, budget: 900 },
        { name: '基础', min: 3, max: 4, budget: 1300 },
        { name: '提高', min: 4, max: 5, budget: 2200 },
        { name: '进阶', min: 5, max: 6, budget: 3400 },
        { name: '挑战', min: 6, max: 6, budget: 6000 }
    ];

    /* 出一道题；cfg.budget 是总时间上限（毫秒），用完就返回 null 交给上层重试 */
    function makePuzzle(cfg) {
        var rnd = mulberry32((cfg.seed >>> 0) || (Date.now() ^ Math.floor(Math.random() * 1e9)));
        var t0 = Date.now(), attempts = 0;
        while (Date.now() - t0 < cfg.budget) {
            attempts++;
            var g = playQuiet(rnd, cfg);
            if (!g) { continue; }
            var bd = trim(g.bd, g.order, g.path, cfg);
            var line = solve(bd, BLACK, cfg.maxMoves, cfg.ms);
            if (!line) { continue; }
            var bm = (line.length + 1) >> 1;
            if (bm < cfg.minMoves || bm > cfg.maxMoves) { continue; }

            var stones = [], nb = 0, nw = 0, k;
            for (k = 0; k < N * N; k++) {
                if (bd[k] !== EMPTY) {
                    stones.push([k % N, (k / N) | 0, bd[k]]);
                    if (bd[k] === BLACK) { nb++; } else { nw++; }
                }
            }
            if (nb !== nw || nb < 5) { continue; }

            return {
                stones: stones,
                moves: bm,
                line: line.map(function (q) {
                    return 'ABCDEFGHIJKLMNO'.charAt(q % N) + (N - ((q / N) | 0));
                }).join(' '),
                attempts: attempts
            };
        }
        return null;
    }

    var GEN = {
        ms: 500
    };

    /* ---------- 页面 ---------- */

    function boot(win, doc) {
        var canvas = doc.getElementById('vcf-board');
        if (!canvas || canvas.dataset.booted) { return; }
        canvas.dataset.booted = '1';

        var CELL = 34, PAD = 22, SIZE = (N - 1) * CELL + PAD * 2;
        var dpr = Math.min(win.devicePixelRatio || 1, 2);
        var ctx = canvas.getContext('2d');

        /* 棋盘按容器宽度重算格子，窄屏也放得下 */
        function layout() {
            var host = canvas.parentNode;
            /* clientWidth 含内边距，先扣掉卡片左右 padding 再算格子 */
            var avail = ((host && host.clientWidth) || 552) - 36;
            CELL = Math.max(17, Math.min(34, Math.floor(Math.min(avail, 520) / 15.9)));
            PAD = Math.round(CELL * 0.72);
            SIZE = (N - 1) * CELL + PAD * 2;
            canvas.width = Math.round(SIZE * dpr);
            canvas.height = Math.round(SIZE * dpr);
            canvas.style.width = SIZE + 'px';
            canvas.style.height = SIZE + 'px';
        }

        var board = new Int8Array(N * N);
        var history = [];        /* 本题走过的点，用于撤销 */
        var hint = -1;
        var puzzle = null;
        var no = 0;              /* 出到第几题 */
        var done = 0;            /* 过关数 */
        var tries = 0;
        var cleared = false;     /* 本题是否已判过胜 */
        var busy = false;

        var elMsg = doc.getElementById('vcf-msg');
        var elCount = doc.getElementById('vcf-count');
        var elDone = doc.getElementById('vcf-done');
        var elTries = doc.getElementById('vcf-tries');
        var elLevel = doc.getElementById('vcf-level');
        var btnNext = doc.getElementById('vcf-next');
        var elDiff = doc.getElementById('vcf-diff');
        var lvIdx = elDiff ? Math.min(LEVELS.length - 1, Math.max(0, parseInt(elDiff.value, 10) || 0)) : 1;

        function stone(x, y) {
            return board[y * N + x];
        }

        function last() {
            return history.length ? history[history.length - 1] : -1;
        }

        function draw() {
            var i, x, y, cx, cy;

            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, SIZE, SIZE);
            ctx.fillStyle = '#fbf7ec';
            ctx.fillRect(0, 0, SIZE, SIZE);

            ctx.strokeStyle = 'rgba(176, 141, 87, 0.42)';
            ctx.lineWidth = 1;
            for (i = 0; i < N; i++) {
                var p = PAD + i * CELL;
                ctx.beginPath();
                ctx.moveTo(PAD, p);
                ctx.lineTo(SIZE - PAD, p);
                ctx.moveTo(p, PAD);
                ctx.lineTo(p, SIZE - PAD);
                ctx.stroke();
            }

            /* 星位 */
            ctx.fillStyle = 'rgba(138, 106, 57, 0.55)';
            [[3, 3], [11, 3], [3, 11], [11, 11], [7, 7]].forEach(function (s) {
                ctx.beginPath();
                ctx.arc(PAD + s[0] * CELL, PAD + s[1] * CELL, 2.2, 0, Math.PI * 2);
                ctx.fill();
            });

            /* 提示点：一圈虚线 */
            if (hint >= 0) {
                cx = PAD + (hint % N) * CELL;
                cy = PAD + ((hint / N) | 0) * CELL;
                ctx.save();
                ctx.setLineDash([4, 4]);
                ctx.strokeStyle = '#b0532f';
                ctx.lineWidth = 1.6;
                ctx.beginPath();
                ctx.arc(cx, cy, CELL * 0.46, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
            }

            for (y = 0; y < N; y++) {
                for (x = 0; x < N; x++) {
                    var v = stone(x, y);
                    if (!v) { continue; }
                    cx = PAD + x * CELL;
                    cy = PAD + y * CELL;
                    var r = CELL * 0.42;
                    var g = ctx.createRadialGradient(cx - r * 0.4, cy - r * 0.4, r * 0.15, cx, cy, r);
                    if (v === BLACK) {
                        g.addColorStop(0, '#4a453c');
                        g.addColorStop(1, '#16140f');
                    } else {
                        g.addColorStop(0, '#ffffff');
                        g.addColorStop(1, '#e6dcc7');
                    }
                    ctx.beginPath();
                    ctx.arc(cx, cy, r, 0, Math.PI * 2);
                    ctx.fillStyle = g;
                    ctx.fill();
                    ctx.strokeStyle = v === BLACK ? 'rgba(0,0,0,0.5)' : 'rgba(138,106,57,0.45)';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
            }

            /* 最后一手的红点 */
            if (last() >= 0) {
                cx = PAD + (last() % N) * CELL;
                cy = PAD + ((last() / N) | 0) * CELL;
                ctx.beginPath();
                ctx.arc(cx, cy, 3, 0, Math.PI * 2);
                ctx.fillStyle = stone(last() % N, (last() / N) | 0) === BLACK ? '#e2703a' : '#b0532f';
                ctx.fill();
            }
        }

        function say(text, tone) {
            elMsg.textContent = text;
            elMsg.className = 'vcf-msg' + (tone ? ' is-' + tone : '');
        }

        /* 出一道新题；按当前档位切时间片，时间片之间让出主线程，界面不会卡住 */
        function newPuzzle() {
            if (busy) { return; }
            busy = true;
            say('正在摆一盘有杀的局面…', 'wait');
            elLevel.textContent = '…';

            var lv = LEVELS[lvIdx] || LEVELS[1];
            var slice = lv.budget > 1200 ? 800 : lv.budget;
            var left = Math.max(2, Math.ceil(lv.budget / slice));

            var step = function () {
                var p = makePuzzle({
                    budget: slice,
                    ms: GEN.ms,
                    minMoves: lv.min,
                    maxMoves: lv.max,
                    seed: (Math.random() * 4294967296) >>> 0
                });
                if (p) { no++; busy = false; load(p); return; }
                if (--left > 0) { win.setTimeout(step, 20); return; }
                busy = false;
                elLevel.textContent = '—';
                say('这一档没摆出来，再点一次「下一题」。', 'bad');
            };

            win.setTimeout(step, 20);
        }

        function load(p) {
            puzzle = p;
            cleared = false;
            board = new Int8Array(N * N);
            history = [];
            hint = -1;

            p.stones.forEach(function (s) {
                board[s[1] * N + s[0]] = s[2];
            });

            elCount.textContent = '第 ' + no + ' 题 · ' + p.moves + ' 手胜';
            elLevel.textContent = (LEVELS[lvIdx] || LEVELS[1]).name;
            say('轮到你走。每一手都要冲四，白方会跟着挡。', '');
            if (btnNext) { btnNext.classList.remove('is-hot'); }
            draw();
        }

        function stat() {
            elDone.textContent = String(done);
            elTries.textContent = String(tries);
        }

        /* 白方挡棋后，黑方是否还有 VCF；顺便把这一手算成「有解」还是「死路」 */
        function stillWinnable() {
            var lv = LEVELS[lvIdx] || LEVELS[1];
            return !!solve(board, BLACK, lv.max + 2, 900);
        }

        function play(k) {
            if (busy || board[k] !== EMPTY) { return; }

            busy = true;
            hint = -1;

            var x = k % N, y = (k / N) | 0;
            board[k] = BLACK;
            history.push(k);
            draw();

            if (isFive(board, x, y, BLACK)) {
                finish(true, '成五，拿下！');
                busy = false;
                return;
            }

            var comps = completions(board, x, y, BLACK, []);
            if (!comps.length) {
                board[k] = EMPTY;
                history.pop();
                tries++;
                stat();
                draw();
                say('这一手不是冲四。VCF 要求步步冲四，白方才会被迫跟着挡。', 'bad');
                busy = false;
                return;
            }

            if (comps.length > 1) {
                finish(true, '活四，白方堵不住，赢了。');
                busy = false;
                return;
            }

            /* 唯一的挡点，白方只能下在这里 */
            var q = comps[0];
            board[q] = WHITE;
            history.push(q);
            draw();

            if (isFive(board, q % N, (q / N) | 0, WHITE)) {
                finish(false, '白棋挡上反成五，这条线不能走。');
                busy = false;
                return;
            }

            if (!stillWinnable()) {
                board[q] = EMPTY;
                board[k] = EMPTY;
                history.pop();
                history.pop();
                tries++;
                stat();
                draw();
                say('这个冲四白方守得住，后面接不上了，换条线试试。', 'bad');
                busy = false;
                return;
            }

            say('白方挡在 ' + coord(q) + '。继续冲四。', '');
            busy = false;
        }

        function finish(ok, text) {
            if (ok) {
                if (!cleared) { cleared = true; done++; }
                stat();
                say(text + ' 点「下一题」继续。', 'ok');
                if (btnNext) { btnNext.classList.add('is-hot'); }
            } else {
                tries++;
                stat();
                say(text + ' 点「撤销」退回去。', 'bad');
            }
        }

        function coord(k) {
            var letters = 'ABCDEFGHIJKLMNO';
            return letters.charAt(k % N) + (N - ((k / N) | 0));
        }

        function undo() {
            if (busy || !history.length) { return; }
            /* 退两步：自己一手 + 白方被迫挡的一手；若最后是黑子只退一步 */
            var k = history.pop();
            board[k] = EMPTY;
            if (history.length) {
                var p = last();
                if (board[p] === WHITE) {
                    board[p] = EMPTY;
                    history.pop();
                }
            }
            hint = -1;
            if (btnNext) { btnNext.classList.remove('is-hot'); }
            say('退了一手，接着来。', '');
            draw();
        }

        function showHint() {
            if (busy) { return; }
            var lv = LEVELS[lvIdx] || LEVELS[1];
            var line = solve(board, BLACK, lv.max + 2, 1500);
            if (!line) {
                say('这个局面算不出 VCF 了，试试「撤销」退回去。', 'bad');
                return;
            }
            hint = line[0];
            draw();
            say('提示：' + coord(line[0]) + ' 可以继续冲四。', '');
        }

        function reset() {
            if (puzzle) { load(puzzle); }
        }

        function next() {
            newPuzzle();
        }

        canvas.addEventListener('click', function (e) {
            var rect = canvas.getBoundingClientRect();
            var scale = SIZE / rect.width;
            var px = (e.clientX - rect.left) * scale;
            var py = (e.clientY - rect.top) * scale;
            var x = Math.round((px - PAD) / CELL);
            var y = Math.round((py - PAD) / CELL);
            if (!inside(x, y)) { return; }
            play(y * N + x);
        });

        doc.getElementById('vcf-undo').addEventListener('click', undo);
        doc.getElementById('vcf-hint').addEventListener('click', showHint);
        doc.getElementById('vcf-reset').addEventListener('click', reset);
        if (btnNext) { btnNext.addEventListener('click', next); }

        /* 换难度就换一盘：难度由用户选，不靠自己答对来爬 */
        if (elDiff) {
            elDiff.addEventListener('change', function () {
                var v = parseInt(elDiff.value, 10);
                lvIdx = Math.min(LEVELS.length - 1, Math.max(0, isNaN(v) ? 1 : v));
                if (!busy) { newPuzzle(); }
            });
        }

        layout();
        win.addEventListener('resize', function () {
            layout();
            draw();
        });

        stat();
        newPuzzle();
    }

    return {
        N: N,
        BLACK: BLACK,
        WHITE: WHITE,
        makePuzzle: makePuzzle,
        LEVELS: LEVELS,
        GEN: GEN,
        solve: solve,
        isFive: isFive,
        completions: completions,
        boot: boot
    };
});
