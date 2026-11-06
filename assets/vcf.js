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
                var five = isFive(b, cx, cy, p);
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
            if (comps.length > 1) {        /* 活四或双四：白方一个挡点堵不住 */
                b[k] = EMPTY;
                return [k, comps[0]];
            }

            var q = comps[0];
            b[q] = def;
            var ok = !isFive(b, q % N, (q / N) | 0, def);
            var rest = ok ? search(b, atk, depth - 1, deadline) : null;
            b[q] = EMPTY;
            b[k] = EMPTY;

            if (rest) { return [k, q].concat(rest); }
        }
        return null;
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

    /* 题库：每题的 [x, y, 颜色]，坐标 0-14，黑 1 白 2 */
    var PUZZLES = [
        { level: '提高', stones: [[9,3,2],[10,3,2],[11,3,2],[9,4,1],[11,4,2],[8,5,1],[12,5,1],[8,6,1],[9,6,1],[11,6,2],[8,7,2],[9,7,1],[11,7,1]] },
        { level: '基础', stones: [[5,9,1],[6,9,1],[5,10,1],[6,10,1],[8,10,1],[9,10,2],[5,11,2],[9,11,2],[6,12,2],[6,13,1],[7,13,1],[8,13,2],[9,13,1]] },
        { level: '基础', stones: [[3,7,2],[5,7,2],[7,7,1],[3,8,1],[4,8,1],[7,8,1],[6,9,1],[7,9,2],[6,10,1],[7,10,2],[5,11,2],[6,11,2],[7,11,1]] },
        { level: '基础', stones: [[5,2,1],[6,2,2],[4,3,2],[5,3,1],[7,3,1],[5,4,2],[6,4,1],[7,4,1],[8,4,1],[5,5,1],[7,5,2],[4,6,2],[6,6,1],[7,6,2],[8,6,1]] },
        { level: '提高', stones: [[7,3,1],[8,3,1],[6,4,1],[8,4,2],[10,4,1],[6,5,2],[9,5,1],[7,6,1],[8,6,1],[6,7,2],[7,7,2],[9,7,2],[10,7,1]] },
        { level: '进阶', stones: [[3,3,2],[5,3,1],[7,3,2],[3,4,1],[4,4,1],[6,4,2],[7,4,2],[4,5,2],[6,5,1],[7,5,2],[3,6,2],[6,6,1],[3,7,1],[6,7,1],[7,7,1]] },
        { level: '基础', stones: [[6,8,1],[7,8,2],[10,8,2],[6,9,2],[7,9,1],[8,9,2],[10,9,2],[6,10,1],[8,10,2],[9,10,1],[10,10,1],[8,11,1],[9,11,1],[6,12,1],[7,12,1],[8,12,2]] },
        { level: '基础', stones: [[4,7,2],[5,7,2],[6,7,1],[7,7,1],[8,7,2],[4,8,1],[5,8,2],[7,8,2],[8,9,1],[4,10,1],[5,10,1],[6,10,2],[8,10,1],[4,11,1],[5,11,1],[7,11,1],[8,11,2]] },
        { level: '基础', stones: [[9,7,1],[10,7,2],[12,7,1],[9,8,2],[10,8,2],[13,8,2],[9,9,2],[10,9,1],[11,9,2],[12,9,1],[13,9,1],[11,10,1],[13,10,1],[10,11,1],[13,11,1]] },
        { level: '基础', stones: [[4,6,2],[5,6,1],[6,6,1],[2,7,2],[3,7,1],[5,7,2],[3,8,1],[6,8,1],[4,9,1],[6,10,1]] },
        { level: '基础', stones: [[5,9,2],[8,9,1],[9,9,1],[5,10,1],[6,10,2],[7,10,1],[5,11,1],[6,11,2],[7,11,1],[8,11,1],[9,11,1],[5,12,1],[7,12,2],[6,13,1]] },
        { level: '基础', stones: [[7,6,1],[8,6,1],[4,7,1],[6,7,2],[8,7,1],[5,8,2],[6,8,2],[4,9,1],[5,9,2],[6,9,2],[7,9,1],[8,9,1],[5,10,1],[7,10,1],[8,10,2]] }
    ];

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
        var index = 0;
        var done = 0;
        var tries = 0;
        var solved = {};
        var busy = false;

        var elMsg = doc.getElementById('vcf-msg');
        var elCount = doc.getElementById('vcf-count');
        var elDone = doc.getElementById('vcf-done');
        var elTries = doc.getElementById('vcf-tries');
        var elLevel = doc.getElementById('vcf-level');
        var btnNext = doc.getElementById('vcf-next');

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

        function load(i) {
            index = ((i % PUZZLES.length) + PUZZLES.length) % PUZZLES.length;
            board = new Int8Array(N * N);
            history = [];
            hint = -1;

            PUZZLES[index].stones.forEach(function (s) {
                board[s[1] * N + s[0]] = s[2];
            });

            elCount.textContent = '第 ' + (index + 1) + ' 题 / 共 ' + PUZZLES.length + ' 题';
            elLevel.textContent = PUZZLES[index].level || '—';
            if (!solved[index]) {
                say('轮到你走。每一手都要冲四，白方会跟着挡。', '');
            } else {
                say('这题做过了，可以再走一遍，或者点「下一题」。', 'ok');
            }
            draw();
        }

        function stat() {
            elDone.textContent = done + ' / ' + PUZZLES.length;
            elTries.textContent = String(tries);
        }

        /* 白方挡棋后，黑方是否还有 VCF；顺便把这一手算成「有解」还是「死路」 */
        function stillWinnable() {
            return !!solve(board, BLACK, 9, 900);
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
                finish(true, '双四，白方堵不住，赢了。');
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

        function finish(win, text) {
            if (win) {
                if (!solved[index]) {
                    solved[index] = 1;
                    done++;
                }
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
            var line = solve(board, BLACK, 9, 1500);
            if (!line) {
                say('这个局面算不出 VCF 了，试试「撤销」退回去。', 'bad');
                return;
            }
            hint = line[0];
            draw();
            say('提示：' + coord(line[0]) + ' 可以继续冲四。', '');
        }

        function reset() {
            load(index);
        }

        function next() {
            load(index + 1);
            if (btnNext) { btnNext.classList.remove('is-hot'); }
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

        layout();
        win.addEventListener('resize', function () {
            layout();
            draw();
        });

        stat();
        load(0);
    }

    return {
        N: N,
        BLACK: BLACK,
        WHITE: WHITE,
        PUZZLES: PUZZLES,
        solve: solve,
        isFive: isFive,
        completions: completions,
        boot: boot
    };
});
