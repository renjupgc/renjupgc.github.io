/*
 * 连珠杂箱 - 棋谱复盘
 * ------------------------------------------------------------
 * 棋谱页的右侧面板：读 qipu/eval/<id>.json（构建时由 tools/analyze_qipu.cjs
 * 预先算好），画一条逐手胜率曲线，并把每一手标成 败着 / 疑问 / 好手 / 正着；
 * 点曲线或点手数，左边的棋盘跟着跳到那一手，同时在那手上画圈。
 *
 * 为什么不现算：一份棋谱有三十来手，每手都要重开一次引擎，访客等不起；
 * 构建期一次算完，页面就是静态的。要重算某局，跑
 *   node tools/analyze_qipu.cjs --force
 *
 * 引擎与原局面之间只传「黑方胜率」一个数：引擎报的是走子方视角，
 * 转换在复盘脚本里做完了，这里不再换算。
 */

(function () {
    'use strict';

    var BAD = 0.20;          // 走子方胜率掉了这么多，算败着
    var WARN = 0.10;         // 掉了这么多，算疑问
    var GOOD = 0.15;         // 涨了这么多，算好手

    /* 曲线画布：与 style.css 里的 .qp-curve 一致 */
    var W = 360, H = 168, PL = 26, PR = 12, PT = 14, PB = 24;

    var COL = 'ABCDEFGHIJKLMNO';

    function $(sel, root) {
        return (root || document).querySelector(sel);
    }

    function el(name, cls, text) {
        var n = document.createElement(name);
        if (cls) { n.className = cls; }
        if (text != null) { n.textContent = text; }
        return n;
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

    function pct(v) {
        return Math.round(v * 100) + '%';
    }

    function init() {
        var host = document.getElementById('qipu');
        if (!host || host.getAttribute('data-ready') === '1') {
            return;
        }

        var layout = host.parentNode;
        var boardEl = layout ? $('.board[data-board]', layout) : null;
        var board = boardEl && window.GomokuBoard ? window.GomokuBoard.get(boardEl) : null;

        /* 站内无刷新换页时，棋盘由 board.js 的观察器稍后挂上，等它一下 */
        if (!board) {
            var tries = parseInt(host.getAttribute('data-wait') || '0', 10);
            if (tries < 40) {
                host.setAttribute('data-wait', String(tries + 1));
                window.setTimeout(init, 60);
            }
            return;
        }
        host.setAttribute('data-ready', '1');
        host.removeAttribute('data-wait');

        var id = host.getAttribute('data-id') || '';
        var moves = board.getMoves();
        var n = moves.length;

        /* ---------- 骨架：摘要、曲线、当前手、手数、图例 ---------- */
        host.innerHTML = '';
        var sum = el('p', 'qp-sum', '');
        var curveBox = el('div', 'qp-curve-box');
        var now = el('div', 'qp-now');
        var turns = el('div', 'qp-turns');
        var legend = el('p', 'qp-legend');
        legend.innerHTML =
            '<span class="qp-k qp-k-bad"></span>败着' +
            '<span class="qp-k qp-k-warn"></span>疑问' +
            '<span class="qp-k qp-k-good"></span>正着 / 好手' +
            '<span class="qp-k qp-k-idea"></span>引擎首选';

        host.appendChild(sum);
        host.appendChild(curveBox);
        host.appendChild(now);
        host.appendChild(turns);
        host.appendChild(legend);

        /* 手数按钮：先按手数摆好，判定等复盘数据到了再补 */
        var btns = [];
        for (var k = 1; k <= n; k++) {
            var btn = el('button', 'qp-mv', String(k));
            btn.type = 'button';
            btn.setAttribute('data-k', String(k));
            btn.setAttribute('aria-label', '跳到第 ' + k + ' 手');
            btn.addEventListener('click', function (e) {
                var t = parseInt(e.currentTarget.getAttribute('data-k'), 10);
                board.setCursor(t);
            });
            turns.appendChild(btn);
            btns.push(btn);
        }

        var pos = null;        // 复盘数据：pos[k] = {b, top}
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

            var d = '';
            var area = '';
            for (var t = 0; t < pts.length; t++) {
                var x = xOf(pts[t].k);
                var y = yOf(pts[t].b);
                d += (t ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
                area += (t ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
            }
            area += 'L' + xOf(pts[pts.length - 1].k).toFixed(1) + ' ' + yOf(0.5).toFixed(1) +
                ' L' + xOf(pts[0].k).toFixed(1) + ' ' + yOf(0.5).toFixed(1) + ' Z';

            svg.appendChild(s('path', {
                d: area, fill: 'rgba(176, 141, 87, 0.10)', stroke: 'none'
            }));
            svg.appendChild(s('path', {
                d: d.trim(), fill: 'none', stroke: '#6b6152',
                'stroke-width': 1.4, 'stroke-linejoin': 'round'
            }));

            /* 关键手打点：红=败着，黄=疑问，绿=好手/正着 */
            for (var k in judged) {
                if (!Object.prototype.hasOwnProperty.call(judged, k)) { continue; }
                var jd = judged[k];
                var bb = pointFor(Number(k));
                if (!jd.kind || bb == null) { continue; }
                var fill = jd.kind === 'bad' ? '#b0342c'
                    : (jd.kind === 'warn' ? '#c08a2a' : '#3f6b48');
                svg.appendChild(s('circle', {
                    cx: xOf(Number(k)).toFixed(1), cy: yOf(bb).toFixed(1),
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
            var cur = board.getCursor();
            var k = Math.min(cur, n);

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
            var jd = judged[k];
            var who = (k % 2 === 1) ? '黑方' : '白方';
            /* 最后一手没有「之后」的局面，判不了得失，但引擎当时想走哪里还有据可查 */
            var best = (pos && pos[k - 1]) ? pos[k - 1].top : '';
            var bestPt = best ? fromEngine(best) : null;
            var html = '<span class="qp-now-k">第 ' + k + ' 手</span>' +
                '<span class="qp-now-mv">' + COL.charAt(mv.i) + (15 - mv.j) + ' · ' + who + '</span>';

            if (jd) {
                html += '<span class="qp-now-tag qp-tag-' + (jd.kind || 'flat') + '">' +
                    jd.text + '</span>' +
                    '<span class="qp-now-t">' + who + '胜率 ' + pct(jd.before) +
                    ' → ' + pct(jd.after);
                if (Math.abs(jd.drop) >= 0.02) {
                    html += '（' + (jd.drop > 0 ? '掉 ' : '涨 ') +
                        Math.round(Math.abs(jd.drop) * 100) + '）';
                }
                html += '</span>';
                if (jd.picked) {
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
            if (jd && jd.kind) {
                marks.push({ i: mv.i, j: mv.j, kind: jd.kind });
            }
            if (bestPt && !(bestPt.i === mv.i && bestPt.j === mv.j) &&
                !(jd && jd.picked)) {
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

            host.appendChild(el('p', 'qp-note',
                '复盘用 ' + (data.engine || 'Rapfi') + '，每个局面 0.3 秒、到第 ' +
                (data.depth || '—') + ' 层，胜率以黑方为准。引擎的判断只是参考，' +
                '不是棋谱的一部分。'));
        }

        /* 先把棋盘翻到最后，再取复盘数据 */
        board.setCursor(n);
        board.onChange(paint);
        paint();
        sum.className = 'qp-sum qp-sum-flat';
        sum.textContent = '正在取引擎复盘…';

        var url;
        try {
            url = new URL('eval/' + id + '.json', document.baseURI).href;
        } catch (e) {
            url = 'eval/' + id + '.json';
        }
        fetch(url, { credentials: 'same-origin' })
            .then(function (res) {
                if (!res.ok) { throw new Error('HTTP ' + res.status); }
                return res.json();
            })
            .then(withEval)
            .catch(function () {
                pos = null;
                summarize();
                paint();
            });
    }

    init();

    /*
     * 无刷新换页会把 <main> 整块换掉，换进来的 #qipu 不会自己初始化。
     * 只认「新出现且还没挂过」的那一个，面板内部的增删不会引起来回挂载。
     */
    if (window.MutationObserver) {
        var queued = false;
        var obs = new MutationObserver(function () {
            if (queued) { return; }
            var host = document.getElementById('qipu');
            if (!host || host.getAttribute('data-ready') === '1') { return; }
            queued = true;
            window.requestAnimationFrame(function () {
                queued = false;
                init();
            });
        });
        obs.observe(document.body, { childList: true, subtree: true });
    }
})();
