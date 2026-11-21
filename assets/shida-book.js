/*
 * 连珠杂箱 - 打谱页的「开局库 · 打点」小节
 * ------------------------------------------------------------
 * 把 assets/shida-data.js 里 249 个开局的打数表接到打谱棋盘上：摆满前四手，
 * 就用这四手的形去书里认这一路（八种对称都试一遍，所以摆在哪、摆成什么朝向
 * 都认得出），然后
 *   1. 在盘上把书里每个打点标出来——数字正落在交叉点上，颜色是评估，
 *   2. 在开局卡上补一行小开局名（寒预、寒通这种），
 *   3. 在右边列出这一路的打点，点一下就把这一手摆上去当第五手（超过四手的先退掉）。
 * 下面还有一份按族分组的 249 局清单，点一个就把那四手摆回盘上。
 *
 * 站内换页只换 <main>，本文件不会重跑，所以用 MutationObserver 盯着这一节
 * 重新出现时再挂一次；棋盘由 board.js 自己重新挂，这里只负责等它。
 */
(function () {
    'use strict';

    var BOOK = window.SHIDA_OPENINGS || [];
    var SIZE = 15;
    var COLS = 'ABCDEFGHIJKLMNO';

    /* 八种对称，坐标按书里的写法（x 向右、y 向下）；INV 是各自的逆 */
    var T8 = [
        function (x, y) { return [x, y]; },
        function (x, y) { return [-y, x]; },
        function (x, y) { return [-x, -y]; },
        function (x, y) { return [y, -x]; },
        function (x, y) { return [-x, y]; },
        function (x, y) { return [x, -y]; },
        function (x, y) { return [y, x]; },
        function (x, y) { return [-y, -x]; }
    ];
    var INV = [0, 3, 2, 1, 4, 5, 6, 7];

    /* 四手形 → 局。key 用相对黑 1 的坐标串，八种对称留给匹配时试 */
    var MAP = {};
    BOOK.forEach(function (op) {
        var m = op.m;
        var rel = m.map(function (s) { return [s[0] - m[0][0], s[1] - m[0][1]]; });
        MAP[rel.map(function (q) { return q[0] + ',' + q[1]; }).join('|')] = op;
    });

    function toBook(p) { return [p.i, SIZE - 1 - p.j]; }
    function toBoard(c, r) { return { i: c, j: SIZE - 1 - r }; }
    function coord(p) { return COLS.charAt(p.i) + (SIZE - p.j); }

    /* 用前四手在书里找这一路；找得到就带回「书→盘」要用的那个变换 */
    function match(moves) {
        if (!BOOK.length || moves.length < 4) {
            return null;
        }
        if (moves[0].color && moves[0].color !== 'b') {
            return null;
        }
        var pts = moves.slice(0, 4).map(toBook);
        var org = pts[0];
        var rel = pts.map(function (p) { return [p[0] - org[0], p[1] - org[1]]; });
        for (var k = 0; k < T8.length; k++) {
            var key = rel.map(function (p) {
                var q = T8[k](p[0], p[1]);
                return q[0] + ',' + q[1];
            }).join('|');
            if (MAP[key]) {
                return { op: MAP[key], inv: INV[k], org: org };
            }
        }
        return null;
    }

    /* 书里的一个打点 → 盘上的坐标（书里的原点就是黑 1 那一手） */
    function pointOf(op, hit, c, r) {
        var o = op.m[0];
        var q = T8[hit.inv](c - o[0], r - o[1]);
        var col = hit.org[0] + q[0];
        var row = hit.org[1] + q[1];
        if (col < 0 || col > SIZE - 1 || row < 0 || row > SIZE - 1) {
            return null;
        }
        return toBoard(col, row);
    }

    function label(c) {
        return (c[3] === 0 ? 'a' : c[3] === 1 ? 'c' : '') + c[2] +
            (c[5] ? '′' : '') + (c[4] ? '?' : '');
    }

    /* 这一点自己的评估：带 ′ 的查原书右栏，表里没写到就按 a/c/无前缀归 */
    function resOf(op, c) {
        var tab = (c[5] && op.rp) ? op.rp : op.r;
        for (var k = 0; k < tab.length; k++) {
            if (tab[k][0] <= c[2] && c[2] <= tab[k][1]) {
                return tab[k][2];
            }
        }
        return c[3] === 0 ? '黑胜' : c[3] === 1 ? '黑败' : '平衡';
    }

    var BAD = { '白大优': 1, '白近胜': 1, '白必胜': 1, '黑败': 1, '白胜': 1 };
    var GOOD = { '黑必胜': 1, '黑近胜': 1, '黑大优': 1, '黑小优': 1, '黑胜': 1 };
    function tone(r) {
        return GOOD[r] ? 'good' : BAD[r] ? 'bad' : 'warn';
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (ch) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
        });
    }

    function boot() {
        var box = document.getElementById('kj-sd');
        var listBox = document.getElementById('kj-sd-list');
        if (!box || !listBox || box.dataset.ready === '1') {
            return;
        }
        box.dataset.ready = '1';

        var aliasBox = document.getElementById('kj-alias');
        var subBox = document.getElementById('kj-sub-name');
        var subMetaBox = document.getElementById('kj-sub-meta');
        var metaBox = document.getElementById('kj-sd-meta');
        var bandBox = document.getElementById('kj-sd-band');
        var bookBox = document.getElementById('kj-sd-book');
        var markBox = document.getElementById('kj-sd-mark');
        var host = document.querySelector('.board[data-board]');
        if (!bandBox) {
            return;
        }

        /* ---------- 249 局清单：点一个摆上盘 ---------- */
        if (bookBox) {
            var fams = [];
            var byFam = {};
            BOOK.forEach(function (op) {
                if (!byFam[op.f]) {
                    byFam[op.f] = [];
                    fams.push(op.f);
                }
                byFam[op.f].push(op);
            });
            bookBox.innerHTML = fams.map(function (f) {
                var chips = byFam[f].sort(function (a, b) { return a.p - b.p; }).map(function (op) {
                    return '<button class="kj-chip" type="button" data-sd="' + op.p + '" title="原书 ' +
                        op.p + ' 页"><b>' + esc(op.n) + '</b><i>' + op.p + '</i></button>';
                }).join('');
                return '<div class="kj-fam"><span>' + esc(f) + '</span>' + chips + '</div>';
            }).join('');
        }

        /* ---------- 与棋盘的往返 ---------- */

        function board() {
            return host && window.GomokuBoard ? window.GomokuBoard.get(host) : null;
        }

        function withBoard(fn, tries) {
            var b = board();
            if (b) { fn(b); return; }
            if ((tries || 0) < 15) {
                window.setTimeout(function () { withBoard(fn, (tries || 0) + 1); }, 60);
            }
        }

        /* ---------- 盘上标注：数字落在交叉点上 ---------- */

        function drawMarks(b, rows) {
            if (!markBox || !markBox.checked) {
                b.setMarks([]);
                b.setNotes([]);
                return;
            }
            var taken = {};
            b.getMoves().forEach(function (m) { taken[m.i + ',' + m.j] = 1; });
            var notes = [];
            rows.forEach(function (r) {
                if (taken[r.p.i + ',' + r.p.j]) {
                    return;
                }
                notes.push({
                    i: r.p.i, j: r.p.j, text: String(r.c[2]),
                    size: 0.84, tone: tone(r.res),
                    dx: 0, dy: 0.3, anchor: 'middle'
                });
            });
            b.setMarks([]);
            b.setNotes(notes);
        }

        /* ---------- 渲染 ---------- */

        function clearAlias() {
            if (aliasBox) { aliasBox.hidden = true; }
            if (subBox) { subBox.textContent = ''; }
            if (subMetaBox) { subMetaBox.textContent = ''; }
        }

        function paint(b) {
            var moves = b.getMoves();
            var hit = match(moves);

            if (!hit) {
                clearAlias();
                if (metaBox) { metaBox.textContent = ''; }
                bandBox.textContent = moves.length >= 4
                    ? '前四手对不上书里的 249 局，这一路没有打点表。'
                    : '摆到白 4，这里给出书里这一路的打点。';
                listBox.innerHTML = '';
                drawMarks(b, []);
                return;
            }

            var op = hit.op;
            var rows = [];
            op.c.forEach(function (c) {
                var p = pointOf(op, hit, c[0], c[1]);
                if (p) {
                    rows.push({ p: p, c: c, res: resOf(op, c) });
                }
            });
            rows.sort(function (a, b2) {
                return a.c[2] - b2.c[2] || a.p.i - b2.p.i || b2.p.j - a.p.j;
            });

            /* 开局卡的第二行：这一路在小书里的名字 */
            if (aliasBox) { aliasBox.hidden = false; }
            if (subBox) { subBox.textContent = op.n; }
            if (subMetaBox) {
                subMetaBox.textContent = '原书 ' + op.p + ' 页 · 十打 ' + (op.t || '—');
            }

            if (metaBox) {
                metaBox.textContent = rows.length
                    ? rows.length + ' 个 · 打数 ' + rows[0].c[2] + '–' + rows[rows.length - 1].c[2]
                    : '';
            }
            bandBox.textContent = '盘上的数字就是打数，颜色是输赢；点一个摆上第五手。' +
                (op.rp ? '带 ′ 的点查原书右栏。' : '');

            listBox.innerHTML = rows.map(function (r) {
                return '<button class="kj-sd-chip is-' + tone(r.res) + '" type="button" data-i="' +
                    r.p.i + '" data-j="' + r.p.j + '" title="原书 ' + esc(label(r.c)) + ' · ' +
                    r.c[2] + ' 打 · ' + esc(r.res) + '">' +
                    '<b>' + r.c[2] + '</b>' +
                    '<span class="kj-sd-at">' + coord(r.p) + (r.c[5] ? '′' : '') + '</span>' +
                    '<span class="kj-sd-res">' + esc(r.res) + '</span>' +
                    '</button>';
            }).join('');

            drawMarks(b, rows);
        }

        /* ---------- 交互 ---------- */

        listBox.addEventListener('click', function (e) {
            var btn = e.target.closest ? e.target.closest('[data-i]') : null;
            if (!btn) { return; }
            var i = Number(btn.dataset.i);
            var j = Number(btn.dataset.j);
            withBoard(function (b) {
                if (b.getMoves().length > 4) {
                    b.truncate(4);
                }
                b.place(i, j);
                b.last();
                paint(b);
            });
        });

        if (markBox) {
            markBox.addEventListener('change', function () {
                withBoard(function (b) { paint(b); });
            });
        }

        if (bookBox) {
            bookBox.addEventListener('click', function (e) {
                var btn = e.target.closest ? e.target.closest('[data-sd]') : null;
                if (!btn) { return; }
                var want = Number(btn.dataset.sd);
                var op = BOOK.filter(function (x) { return x.p === want; })[0];
                if (!op) { return; }
                withBoard(function (b) {
                    b.setMoves(op.m.map(function (s) {
                        var q = toBoard(s[0], s[1]);
                        return { i: q.i, j: q.j, color: s[2] };
                    }));
                    b.last();
                    paint(b);
                });
            });
        }

        withBoard(function (b) {
            paint(b);
            b.onChange(function () { paint(b); });
        });
    }

    /* 给控制台和测试用：认一路、取打点 */
    window.ZBX_SHIDA_BOOK = { match: match, pointOf: pointOf, resOf: resOf, entries: BOOK };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
    if (window.MutationObserver) {
        new window.MutationObserver(boot).observe(document.body, { childList: true, subtree: true });
    }
})();
