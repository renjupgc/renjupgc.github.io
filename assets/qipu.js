/*
 * 连珠杂箱 - 赛事棋谱（就地展开）
 * ------------------------------------------------------------
 * 赛事成绩表里，有棋谱的对局格子带 data-qipu="<match_id>"。点一下，就在表格
 * 下方展开这一局：左边棋盘、右边逐手复盘（胜率曲线、手数表、当前手读数）。
 *
 * 数据是构建期做好的 assets/qipu/g<id>.json：落点来自 renju.db 的
 * board_record，胜率来自 tools/analyze_qipu.cjs 用 Rapfi 逐局面重算的结果。
 * 访客点开只是取一个几 KB 的静态文件，不用等引擎。
 *
 * board.js 按需加载：只有真正点开棋谱时才拉，赛事页本身的体积不变。
 * 无刷新换页只换 <main>，本脚本常驻，所以点击用 document 上的委托。
 */

(function () {
    'use strict';

    var BAD = 0.20;          // 走子方胜率掉了这么多，算败着
    var WARN = 0.10;         // 掉了这么多，算疑问
    var GOOD = 0.15;         // 涨了这么多，算好手

    /* 曲线画布：与 style.css 里的 .qp-curve 一致 */
    var W = 360, H = 168, PL = 26, PR = 12, PT = 14, PB = 24;

    var COL = 'ABCDEFGHIJKLMNO';

    /* ---------- 小工具 ---------- */

    function el(name, cls, text) {
        var n = document.createElement(name);
        if (cls) { n.className = cls; }
        if (text != null) { n.textContent = text; }
        return n;
    }

    /* 站内资源都相对页面（zayu/ 下），data-base 由 layout.js 跟着换页更新 */
    function asset(p) {
        return (document.body.getAttribute('data-base') || '') + p;
    }

    function pct(v) {
        return Math.round(v * 100) + '%';
    }

    /* 引擎坐标 "x,y"（y 自下）-> 盘面下标（j 自上） */
    function fromEngine(s) {
        var a = String(s || '').split(',');
        var x = parseInt(a[0], 10);
        var y = parseInt(a[1], 10);
        if (!isFinite(x) || !isFinite(y)) { return null; }
        return { i: x, j: 14 - y };
    }

    function toEngine(m) {
        return m.i + ',' + (14 - m.j);
    }

    /* ---------- 按需加载 ---------- */

    var cache = {};

    function getGame(id) {
        if (!cache[id]) {
            cache[id] = fetch(asset('assets/qipu/g' + id + '.json'),
                { credentials: 'same-origin' })
                .then(function (res) {
                    if (!res.ok) { throw new Error('HTTP ' + res.status); }
                    return res.json();
                })
                .catch(function (err) {
                    delete cache[id];
                    throw err;
                });
        }
        return cache[id];
    }

    var boardLoading = null;

    function loadBoard() {
        if (window.GomokuBoard) { return Promise.resolve(); }
        if (!boardLoading) {
            boardLoading = new Promise(function (resolve, reject) {
                var s = document.createElement('script');
                s.src = asset('assets/board.js');
                s.onload = function () { resolve(); };
                s.onerror = function () {
                    boardLoading = null;
                    reject(new Error('board.js 载入失败'));
                };
                document.body.appendChild(s);
            });
        }
        return boardLoading;
    }

    /* board.js 由观察器在下一帧挂载，等它把实例接上 */
    function waitBoard(node, cb, tries) {
        var b = window.GomokuBoard && window.GomokuBoard.get(node);
        if (b) {
            cb(b);
            return;
        }
        if ((tries || 0) > 60) { return; }
        window.setTimeout(function () { waitBoard(node, cb, (tries || 0) + 1); }, 50);
    }

    /* ---------- 面板 ---------- */

    function panelFor(td) {
        var main = td.closest('main') || document;
        var panel = main.querySelector('[data-qp-panel]');
        if (panel) { return panel; }

        /* 模板里没留容器（老页面）也要能展开：挂在成绩表后面 */
        panel = el('div', 'qp-panel');
        panel.setAttribute('data-qp-panel', '');
        var box = td.closest('.table-scroll');
        if (box && box.parentNode) {
            box.parentNode.insertBefore(panel, box.nextSibling);
        } else {
            main.appendChild(panel);
        }
        return panel;
    }

    function closePanel(panel) {
        if (!panel) { return; }
        panel.hidden = true;
        panel.innerHTML = '';
        panel.removeAttribute('data-id');
        var main = panel.closest('main') || document;
        Array.prototype.forEach.call(
            main.querySelectorAll('[data-qipu][aria-expanded="true"]'),
            function (td) { td.setAttribute('aria-expanded', 'false'); });
    }

    function headline(d) {
        if (d.winner) { return d.winner + ' 胜 ' + (d.winner === d.p1 ? d.p2 : d.p1); }
        return d.p1 + ' 对 ' + d.p2 + '（' + (d.resultText || '未分胜负') + '）';
    }

    function skeleton(panel, d) {
        panel.hidden = false;
        panel.innerHTML = '';
        panel.setAttribute('data-id', String(d.id));

        var inner = el('div', 'qp-inner');

        var head = el('div', 'qp-head');
        var lead = el('div', 'qp-lead');
        lead.appendChild(el('p', 'qp-eyebrow',
            (d.event || '') + ' · ' + (d.roundLabel || '') + ' · ' + d.turns + ' 手'));
        lead.appendChild(el('h3', 'qp-title', headline(d)));
        lead.appendChild(el('p', 'qp-meta',
            [d.date, d.rules, d.board ? '第 ' + d.board + ' 台' : '']
                .filter(Boolean).join(' · ')));
        head.appendChild(lead);

        var close = el('button', 'qp-close', '收起');
        close.type = 'button';
        close.setAttribute('data-qp-close', '');
        head.appendChild(close);
        inner.appendChild(head);

        var body = el('div', 'qp-body');

        var left = el('div', 'qp-board-col');
        var boardEl = el('div', 'board');
        boardEl.setAttribute('data-board', '');
        boardEl.setAttribute('data-numbers', '1');
        boardEl.setAttribute('data-moves', (d.moves || []).join(' '));
        left.appendChild(boardEl);
        left.appendChild(el('p', 'qp-tip',
            '点盘上的子可退回那一手，也可用手数跳转；局面会写进地址栏，方便把某一手发出去。'));
        body.appendChild(left);

        var side = el('div', 'qp-side');
        side.appendChild(el('p', 'qp-sum qp-sum-flat', '正在取引擎复盘…'));
        body.appendChild(side);

        inner.appendChild(body);
        panel.appendChild(inner);
        return { boardEl: boardEl, side: side };
    }

    function renderReview(side, board, d) {
        var moves = board.getMoves();
        var n = moves.length;
        var ev = d.eval || null;

        var sum = side.querySelector('.qp-sum');
        var curveBox = el('div', 'qp-curve-box');
        var now = el('div', 'qp-now');
        var turns = el('div', 'qp-turns');
        var legend = el('p', 'qp-legend');
        legend.innerHTML =
            '<span class="qp-k qp-k-bad"></span>败着' +
            '<span class="qp-k qp-k-warn"></span>疑问' +
            '<span class="qp-k qp-k-good"></span>正着 / 好手' +
            '<span class="qp-k qp-k-idea"></span>引擎首选';

        side.appendChild(curveBox);
        side.appendChild(now);
        side.appendChild(turns);
        side.appendChild(legend);

        /* 手数按钮：先按手数摆好，判定等复盘数据到了再补 */
        var btns = [];
        for (var k = 1; k <= n; k++) {
            var btn = el('button', 'qp-mv', String(k));
            btn.type = 'button';
            btn.setAttribute('data-k', String(k));
            btn.setAttribute('aria-label', '跳到第 ' + k + ' 手');
            btn.addEventListener('click', function (e) {
                board.setCursor(parseInt(e.currentTarget.getAttribute('data-k'), 10));
            });
            turns.appendChild(btn);
            btns.push(btn);
        }

        var pos = null;        // pos[k] = {b, top}
        var judged = {};       // k -> {kind, text, drop, before, after, picked, best}
        var svg = null, xOf = null, yOf = null, cursorLine = null, cursorDot = null;

        /* ---------- 判定 ---------- */
        function judge() {
            judged = {};
            if (!pos) { return; }
            for (var k = 1; k <= n; k++) {
                var b0 = pos[k - 1] && pos[k - 1].b;
                var b1 = pos[k] && pos[k].b;
                if (b0 == null || b1 == null) { continue; }

                var blackMove = (k % 2 === 1);
                var before = blackMove ? b0 : 1 - b0;
                var after = blackMove ? b1 : 1 - b1;
                var drop = before - after;

                var mv = moves[k - 1];
                var best = pos[k - 1] ? pos[k - 1].top : '';
                var picked = !!best && best === toEngine(mv);

                var kind = '', text = '寻常';
                if (drop >= BAD) {
                    kind = 'bad'; text = '败着';
                } else if (drop >= WARN) {
                    kind = 'warn'; text = '疑问';
                } else if (drop <= -GOOD) {
                    kind = 'good'; text = '好手';
                } else if (picked) {
                    kind = 'good'; text = '正着';
                }

                judged[k] = {
                    kind: kind, text: text, drop: drop,
                    before: before, after: after,
                    picked: picked, best: best, black: blackMove
                };
            }
        }

        function pointFor(k) {
            var p = pos && pos[k];
            return p && p.b != null ? p.b : null;
        }

        /* ---------- 曲线 ---------- */
        function buildCurve() {
            var pts = [];
            for (var k = 1; k <= n; k++) {
                var b = pointFor(k);
                if (b != null) { pts.push({ k: k, b: b }); }
            }
            if (pts.length < 2) { return; }

            var ns = 'http://www.w3.org/2000/svg';
            function s(name, attrs) {
                var g = document.createElementNS(ns, name);
                for (var a in attrs) {
                    if (Object.prototype.hasOwnProperty.call(attrs, a)) {
                        g.setAttribute(a, attrs[a]);
                    }
                }
                return g;
            }

            var span = pts.length - 1;
            xOf = function (k) {
                var i = 0;
                for (var t = 0; t < pts.length; t++) {
                    if (pts[t].k <= k) { i = t; }
                }
                return PL + (span ? i / span : 0) * (W - PL - PR);
            };
            yOf = function (b) {
                return PT + (1 - b) * (H - PT - PB);
            };

            svg = s('svg', {
                viewBox: '0 0 ' + W + ' ' + H,
                class: 'qp-curve',
                role: 'img',
                'aria-label': '逐手胜率曲线：横轴为手数，纵轴为黑方胜率'
            });

            /* 50% 一线：黑优还是白优，看线在上面还是在下面 */
            svg.appendChild(s('line', {
                x1: PL, y1: yOf(0.5), x2: W - PR, y2: yOf(0.5),
                stroke: '#ded4c0', 'stroke-width': 1, 'stroke-dasharray': '3 3'
            }));
            svg.appendChild(s('line', {
                x1: PL, y1: PT, x2: PL, y2: H - PB,
                stroke: '#e6dfcd', 'stroke-width': 1
            }));

            var dd = '';
            var area = '';
            for (var t = 0; t < pts.length; t++) {
                var x = xOf(pts[t].k);
                var y = yOf(pts[t].b);
                dd += (t ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
                area += (t ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
            }
            area += 'L' + xOf(pts[pts.length - 1].k).toFixed(1) + ' ' + yOf(0.5).toFixed(1) +
                ' L' + xOf(pts[0].k).toFixed(1) + ' ' + yOf(0.5).toFixed(1) + ' Z';

            svg.appendChild(s('path', {
                d: area, fill: 'rgba(176, 141, 87, 0.10)', stroke: 'none'
            }));
            svg.appendChild(s('path', {
                d: dd.trim(), fill: 'none', stroke: '#6b6152',
                'stroke-width': 1.4, 'stroke-linejoin': 'round'
            }));

            /* 关键手打点：红=败着，黄=疑问，绿=好手/正着 */
            for (var key in judged) {
                if (!Object.prototype.hasOwnProperty.call(judged, key)) { continue; }
                var jd = judged[key];
                var bb = pointFor(Number(key));
                if (!jd.kind || bb == null) { continue; }
                var fill = jd.kind === 'bad' ? '#b0342c'
                    : (jd.kind === 'warn' ? '#c08a2a' : '#3f6b48');
                svg.appendChild(s('circle', {
                    cx: xOf(Number(key)).toFixed(1), cy: yOf(bb).toFixed(1),
                    r: jd.kind === 'bad' ? 3 : 2.4, fill: fill
                }));
            }

            cursorLine = s('line', {
                x1: PL, y1: PT, x2: PL, y2: H - PB,
                stroke: '#b08d57', 'stroke-width': 1, opacity: '0.55'
            });
            cursorDot = s('circle', { cx: PL, cy: PT, r: 3.6, fill: '#b08d57' });
            svg.appendChild(cursorLine);
            svg.appendChild(cursorDot);

            /* 轴上的字：左边 0 / 50 / 100，底下一头一尾的手数 */
            function label(x, y, text, anchor) {
                var t = s('text', {
                    x: x, y: y, 'font-size': 9.5, fill: '#a79c88',
                    'font-family': 'Arial, Helvetica, sans-serif',
                    'text-anchor': anchor || 'middle'
                });
                t.textContent = text;
                svg.appendChild(t);
            }
            label(PL - 5, PT + 4, '100', 'end');
            label(PL - 5, yOf(0.5) + 3.5, '50', 'end');
            label(PL - 5, H - PB + 1, '0', 'end');
            label(PL, H - PB + 14, '1 手', 'start');
            label(W - PR, H - PB + 14, pts[pts.length - 1].k + ' 手', 'end');

            svg.addEventListener('click', function (e) {
                var r = svg.getBoundingClientRect();
                if (!r.width) { return; }
                var x = (e.clientX - r.left) * (W / r.width);
                var spanX = W - PL - PR;
                var t = Math.round(((x - PL) / spanX) * span);
                t = Math.max(0, Math.min(span, t));
                board.setCursor(pts[t].k);
            });

            curveBox.appendChild(svg);
        }

        /* ---------- 每次局面变化都重画这几处 ---------- */
        function paint() {
            var k = Math.min(board.getCursor(), n);

            for (var t = 0; t < btns.length; t++) {
                var kk = t + 1;
                var jd = judged[kk];
                btns[t].className = 'qp-mv' +
                    (jd && jd.kind ? ' qp-mv-' + jd.kind : '') +
                    (kk === k ? ' is-on' : '');
            }

            if (svg && cursorLine) {
                var b = pointFor(k);
                if (b == null) {
                    cursorLine.setAttribute('opacity', '0');
                    cursorDot.setAttribute('opacity', '0');
                } else {
                    cursorLine.setAttribute('opacity', '0.55');
                    cursorDot.setAttribute('opacity', '1');
                    var x = xOf(k);
                    cursorLine.setAttribute('x1', x);
                    cursorLine.setAttribute('x2', x);
                    cursorDot.setAttribute('cx', x);
                    cursorDot.setAttribute('cy', yOf(b));
                }
            }

            /* 当前手的读数与结论 */
            if (k === 0) {
                now.innerHTML = '<span class="qp-now-k">开局</span>' +
                    '<span class="qp-now-t">按右侧手数或曲线上的点开始复盘。</span>';
                board.setMarks([]);
                return;
            }

            var mv = moves[k - 1];
            var cur = judged[k];
            var who = (k % 2 === 1) ? '黑方' : '白方';
            /* 最后一手没有「之后」的局面，判不了得失，但引擎当时想走哪里还有据可查 */
            var best = (pos && pos[k - 1]) ? pos[k - 1].top : '';
            var bestPt = best ? fromEngine(best) : null;
            var html = '<span class="qp-now-k">第 ' + k + ' 手</span>' +
                '<span class="qp-now-mv">' + COL.charAt(mv.i) + (15 - mv.j) +
                ' · ' + who + '</span>';

            if (cur) {
                html += '<span class="qp-now-tag qp-tag-' + (cur.kind || 'flat') + '">' +
                    cur.text + '</span>' +
                    '<span class="qp-now-t">' + who + '胜率 ' + pct(cur.before) +
                    ' → ' + pct(cur.after);
                if (Math.abs(cur.drop) >= 0.02) {
                    html += '（' + (cur.drop > 0 ? '掉 ' : '涨 ') +
                        Math.round(Math.abs(cur.drop) * 100) + '）';
                }
                html += '</span>';
                if (cur.picked) {
                    html += '<span class="qp-now-t">与引擎首选一致</span>';
                } else if (bestPt) {
                    html += '<span class="qp-now-t">引擎推荐 ' +
                        COL.charAt(bestPt.i) + (15 - bestPt.j) + '</span>';
                }
            } else if (k === n) {
                html += '<span class="qp-now-t">终局，本手之后没再记录。</span>';
                if (bestPt && !(bestPt.i === mv.i && bestPt.j === mv.j)) {
                    html += '<span class="qp-now-t">当时引擎更想走 ' +
                        COL.charAt(bestPt.i) + (15 - bestPt.j) + '</span>';
                }
            }
            now.innerHTML = html;

            /* 盘上的圈：这一手的评价 + 引擎首选的空点 */
            var marks = [];
            if (cur && cur.kind) {
                marks.push({ i: mv.i, j: mv.j, kind: cur.kind });
            }
            if (bestPt && !(bestPt.i === mv.i && bestPt.j === mv.j) &&
                !(cur && cur.picked)) {
                marks.push({ i: bestPt.i, j: bestPt.j, kind: 'idea' });
            }
            board.setMarks(marks);
        }

        function summarize() {
            if (!pos) {
                sum.className = 'qp-sum qp-sum-flat';
                if (n < 4) {
                    sum.textContent = '这一局只记到第 ' + n +
                        ' 手（此后弃权或中止），没有可复盘的过程，胜负按记录原样标着。棋盘仍可翻看。';
                } else {
                    sum.textContent = '这局暂时没有引擎复盘数据（还没算）。棋盘仍可逐手翻看。';
                }
                return;
            }
            var worst = null, nBad = 0, nWarn = 0;
            for (var k in judged) {
                if (!Object.prototype.hasOwnProperty.call(judged, k)) { continue; }
                var jd = judged[k];
                if (jd.kind === 'bad') { nBad++; }
                if (jd.kind === 'warn') { nWarn++; }
                if (jd.drop > 0 && (!worst || jd.drop > worst.drop)) {
                    worst = jd;
                    worst.k = Number(k);
                }
            }
            if (!worst) {
                sum.className = 'qp-sum qp-sum-flat';
                sum.textContent = '这一局双方都没有大的起伏，逐手胜率基本贴着五五开走。';
                return;
            }
            var worstMove = moves[worst.k - 1];
            var who = (worst.k % 2 === 1) ? '黑方' : '白方';
            sum.className = 'qp-sum';
            sum.innerHTML = '引擎逐手重算：全盘最大的一次波动在第 <b>' + worst.k +
                '</b> 手，' + who + '落在 ' + COL.charAt(worstMove.i) + (15 - worstMove.j) +
                '，胜率 ' + pct(worst.before) + ' → ' + pct(worst.after) +
                '（掉 ' + Math.round(worst.drop * 100) + ' 个点）。' +
                (nBad ? '全盘标出 <b>' + nBad + '</b> 处败着' : '全盘没有明显的败着') +
                (nWarn ? '、' + nWarn + ' 处疑问' : '') + '。';
        }

        function withEval(data) {
            pos = {};
            for (var t = 0; t < data.pos.length; t++) {
                var p = data.pos[t];
                pos[p.k] = p;
            }
            judge();
            summarize();
            buildCurve();
            paint();

            side.appendChild(el('p', 'qp-note',
                '复盘用 ' + (data.engine || 'Rapfi') + '，每个局面 0.3 秒、到第 ' +
                (data.depth || '—') + ' 层，胜率以黑方为准。引擎的判断只是参考，' +
                '不是棋谱的一部分。'));
        }

        /* 先把棋盘翻到最后，再取复盘数据 */
        board.setCursor(n);
        board.onChange(paint);
        paint();

        if (!ev || !ev.pos || ev.pos.length < 2) {
            pos = null;
            /* 只记了几手、没算过复盘：不留一个空曲线框 */
            if (curveBox.parentNode) { curveBox.parentNode.removeChild(curveBox); }
            summarize();
            return;
        }
        withEval(ev);
    }

    /* ---------- 打开一局 ---------- */

    function open(td) {
        var id = td.getAttribute('data-qipu');
        if (!id) { return; }

        var panel = panelFor(td);
        var main = panel.closest('main') || document;

        if (panel.getAttribute('data-id') === id && !panel.hidden) {
            closePanel(panel);
            return;
        }

        Array.prototype.forEach.call(
            main.querySelectorAll('[data-qipu][aria-expanded="true"]'),
            function (x) { x.setAttribute('aria-expanded', 'false'); });
        td.setAttribute('aria-expanded', 'true');

        var node = panel;
        node.hidden = false;
        node.innerHTML = '<p class="qp-pending">正在取棋谱…</p>';
        node.setAttribute('data-id', id);
        if (node.scrollIntoView) {
            node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        getGame(id).then(function (d) {
            if (node.getAttribute('data-id') !== id) { return; }   /* 已经换成别的了 */
            var parts = skeleton(node, d);
            return loadBoard().then(function () {
                waitBoard(parts.boardEl, function (board) {
                    renderReview(parts.side, board, d);
                });
            });
        }).catch(function () {
            node.innerHTML = '';
            node.appendChild(el('p', 'qp-sum qp-sum-flat',
                '这局的棋谱没能取到（文件缺失或网络不通）。稍后再点一次试试。'));
        });
    }

    /* ---------- 事件 ---------- */

    document.addEventListener('click', function (e) {
        var close = e.target.closest && e.target.closest('[data-qp-close]');
        if (close) {
            closePanel(close.closest('[data-qp-panel]'));
            return;
        }
        var td = e.target.closest && e.target.closest('[data-qipu]');
        if (td) { open(td); }
    });

    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') { return; }
        var td = e.target.closest && e.target.closest('[data-qipu]');
        if (!td) { return; }
        e.preventDefault();
        open(td);
    });
})();
