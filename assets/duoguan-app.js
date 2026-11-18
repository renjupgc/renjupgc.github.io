/* ==========================================================================
   绝对冠感 · 页面交互
   承接 assets/duoguan.js 里的引擎：表、算、判、出题、判分。
   ========================================================================== */
(function () {
    'use strict';

    var E = window.DGEngine;
    var host = document.getElementById('dg-calc');
    if (!E || !host || host.__bound) { return; }
    host.__bound = true;

    var N = E.N;
    var D = window.DG = window.DG || {};
    var S = D.state || (D.state = {});
    var KEY = 'zbx.dg.stats';
    if (!S.stats) { S.stats = loadStats(); }

    /* ---------- 存取 ---------- */

    function loadStats() {
        var o = null;
        try { o = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { o = null; }
        if (!o || typeof o.n !== 'number') {
            return { n: 0, err: 0, score: 0, best: null, streak: 0, bestStreak: 0 };
        }
        return {
            n: o.n, err: o.err || 0, score: o.score || 0,
            best: (o.best === null || o.best === undefined) ? null : o.best,
            streak: o.streak || 0, bestStreak: o.bestStreak || 0
        };
    }

    function saveStats() {
        try { localStorage.setItem(KEY, JSON.stringify(S.stats)); } catch (e) { /* 存不了就算了 */ }
    }

    /* ---------- 格子 ---------- */

    function parseCell(text) {
        var t = String(text).trim();
        if (!t) { return null; }
        if (/^(胜|w|W|\+|√|✓)$/.test(t)) { return 1000; }
        if (/^(负|l|L|-|×|✗)$/.test(t)) { return 0; }
        var isPct = /%$/.test(t);
        var x = parseFloat(isPct ? t.slice(0, -1) : t);
        if (!isFinite(x)) { return null; }
        if (isPct) { x = x * 10; }
        else if (x <= 1.0000001) { x = x * 1000; }
        x = Math.round(x);
        if (x < 0) { x = 0; }
        if (x > 1000) { x = 1000; }
        return x;
    }

    function fmt(p) {
        if (p === null || p === undefined) { return ''; }
        if (p <= 0) { return '负'; }
        if (p >= 1000) { return '胜'; }
        return String(p);
    }

    /* 镜像格只给胜负；未定的场画一个点，免得和上面的千分率混起来 */
    function fmtMirror(p) {
        if (p === null || p === undefined) { return ''; }
        if (p <= 0) { return '负'; }
        if (p >= 1000) { return '胜'; }
        return '·';
    }

    function cellKind(p) {
        if (p === null || p === undefined) { return 'is-blank'; }
        if (p <= 0) { return 'is-loss'; }
        if (p >= 1000) { return 'is-win'; }
        return 'is-open';
    }

    /* 概率小到千分比看不出来，就别写 0——那不是零 */
    function pmText(pm, acc) {
        return (pm === 0 && acc > 0) ? '&lt;1' : String(pm);
    }

    function paintGrid(el, P, opt) {
        opt = opt || {};
        var html = ['<table class="dg-grid"><thead><tr><th class="dg-corner">行\\列</th>'];
        var i, j, k;
        for (j = 0; j < N; j++) { html.push('<th>' + (j + 1) + '</th>'); }
        html.push('</tr></thead><tbody>');
        for (i = 0; i < N; i++) {
            var rowFocus = opt.focusFirst && i === 0;
            html.push('<tr' + (rowFocus ? ' class="is-focus"' : '') + '>');
            html.push('<th' + (rowFocus ? ' class="is-focus"' : '') + '>' + (i + 1) + '</th>');
            for (j = 0; j < N; j++) {
                if (i === j) { html.push('<td class="dg-diag"></td>'); continue; }
                var colFocus = opt.focusFirst && (i === 0 || j === 0);
                var f = colFocus ? ' is-focus' : '';
                if (i < j) {
                    k = cellKind(P[i][j]);
                    if (opt.editable) {
                        html.push('<td class="dg-td ' + k + f + '"><input class="dg-in ' + k + '" data-i="' + i +
                            '" data-j="' + j + '" value="' + fmt(P[i][j]) + '" autocomplete="off" spellcheck="false"></td>');
                    } else {
                        html.push('<td class="dg-cell ' + k + f + '">' + fmt(P[i][j]) + '</td>');
                    }
                } else {
                    var mp = (P[j][i] === null || P[j][i] === undefined) ? null : 1000 - P[j][i];
                    html.push('<td class="dg-mirror' + f + '" data-m="' + i + '_' + j + '">' + fmtMirror(mp) + '</td>');
                }
            }
            html.push('</tr>');
        }
        html.push('</tbody></table>');
        el.innerHTML = html.join('');
    }

    /* ---------- 计算器 ---------- */

    var gridEl = document.getElementById('dg-grid');
    var outEl = document.getElementById('dg-out');
    var statEl = document.getElementById('dg-meta');
    var timer = null;

    function schedule() {
        if (timer) { clearTimeout(timer); }
        timer = setTimeout(function () { timer = null; compute(); }, 140);
    }

    function onCellInput() {
        var i = Number(this.getAttribute('data-i'));
        var j = Number(this.getAttribute('data-j'));
        var v = parseCell(this.value);
        S.P[i][j] = v;
        S.P[j][i] = (v === null) ? null : 1000 - v;
        var mirror = gridEl.querySelector('.dg-mirror[data-m="' + j + '_' + i + '"]');
        if (mirror) {
            var mp = (v === null) ? null : 1000 - v;
            mirror.textContent = fmtMirror(mp);
        }
        var k = cellKind(v);
        this.className = 'dg-in ' + k;
        this.parentNode.className = 'dg-td ' + k;
        schedule();
    }

    function onCellBlur() {
        var v = parseCell(this.value);
        this.value = fmt(v);
    }

    function bindGrid() {
        var inputs = gridEl.querySelectorAll('input.dg-in');
        for (var a = 0; a < inputs.length; a++) {
            inputs[a].addEventListener('input', onCellInput);
            inputs[a].addEventListener('blur', onCellBlur);
        }
    }

    function compute() {
        if (!S.P) { return; }
        var r = E.solve(S.P);
        S.last = r;
        var i;
        var meta = r.mode === 'mc'
            ? '未定 ' + r.openCount + ' 场 · 抽样 ' + Math.round(r.samples / 10000) + ' 万次 · ' + r.ms + ' ms'
            : '未定 ' + r.openCount + ' 场 · 精确 · ' + r.ms + ' ms';
        statEl.textContent = meta;

        var rows = [];
        for (i = 0; i < N; i++) {
            var st = r.status[i];
            var tag = st === 'lock' ? '已锁定' : (st === 'out' ? '出局' : '有戏');
            var cls = st === 'lock' ? 'is-lock' : (st === 'out' ? 'is-out' : 'is-live');
            rows.push(
                '<div class="dg-row">' +
                '<span class="dg-no">' + (i + 1) + '</span>' +
                '<span class="dg-exp">' + r.expWins[i].toFixed(2) + ' 胜</span>' +
                '<span class="dg-bar"><i style="width:' + (r.permille[i] / 10) + '%"></i></span>' +
                '<span class="dg-pm">' + pmText(r.permille[i], r.acc[i]) + '‰</span>' +
                '<span class="dg-tag ' + cls + '">' + tag + '</span>' +
                '</div>');
        }
        outEl.innerHTML = '<div class="dg-list">' + rows.join('') + '</div>';
    }

    function loadManual(seed) {
        S.P = E.puzzle(seed).P;
        paintGrid(gridEl, S.P, { editable: true });
        bindGrid();
        compute();
    }

    /* ---------- 小测验 ---------- */

    var qGrid = document.getElementById('dg-qgrid');
    var qMeta = document.getElementById('dg-qmeta');
    var ansEl = document.getElementById('dg-ans');
    var fbEl = document.getElementById('dg-fb');
    var stEl = document.getElementById('dg-stats');

    function newQuiz(seed) {
        if (seed === undefined || seed === null) { seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0; }
        S.quiz = E.question(seed);
        paintGrid(qGrid, S.quiz.P, { editable: false, focusFirst: true });
        qMeta.textContent = '#' + S.quiz.seed;
        ansEl.value = '';
        ansEl.disabled = false;
        fbEl.innerHTML = '<p class="dg-quiet">概率的一千倍取整，如三成填 300。</p>';
        renderStats();
    }

    function submitAnswer() {
        var q = S.quiz;
        if (!q) { return; }
        var v = parseCell(ansEl.value);
        if (v === null) {
            fbEl.innerHTML = '<p class="dg-quiet">先填个数，0 到 1000。</p>';
            ansEl.focus();
            return;
        }
        var ans = q.ans.permille[0];
        var diff = Math.abs(v - ans);
        var score = Math.max(0, 100 - diff);

        S.stats.n += 1;
        S.stats.err += diff;
        S.stats.score += score;
        S.stats.best = (S.stats.best === null) ? diff : Math.min(S.stats.best, diff);
        S.stats.streak = diff <= 10 ? S.stats.streak + 1 : 0;
        S.stats.bestStreak = Math.max(S.stats.bestStreak, S.stats.streak);
        saveStats();

        var tone = diff <= 10 ? 'is-good' : (diff <= 40 ? 'is-ok' : 'is-bad');
        var st = q.ans.status[0];
        var flow = st === 'lock' ? '最大流：已锁定' : (st === 'out' ? '最大流：出局' : '最大流：有戏');

        var dist = [];
        var order = [];
        var i;
        for (i = 0; i < N; i++) { order.push(i); }
        order.sort(function (a, b) { return q.ans.permille[b] - q.ans.permille[a]; });
        for (i = 0; i < N; i++) {
            var p = order[i];
            dist.push('<div class="dg-row">' +
                '<span class="dg-no' + (p === 0 ? ' is-me' : '') + '">' + (p + 1) + '</span>' +
                '<span class="dg-exp">' + q.ans.expWins[p].toFixed(2) + ' 胜</span>' +
                '<span class="dg-bar"><i style="width:' + (q.ans.permille[p] / 10) + '%"></i></span>' +
                '<span class="dg-pm">' + pmText(q.ans.permille[p], q.ans.acc[p]) + '‰</span>' +
                '<span class="dg-tag is-' + q.ans.status[p] + '">' +
                (q.ans.status[p] === 'lock' ? '已锁定' : (q.ans.status[p] === 'out' ? '出局' : '有戏')) +
                '</span></div>');
        }

        fbEl.innerHTML =
            '<div class="dg-verdict ' + tone + '">' +
            '<span class="dg-v-k">正解</span><b>' + ans + '‰</b>' +
            '<span class="dg-v-sub">' + (ans / 10).toFixed(1) + '%</span>' +
            '<span class="dg-v-me">你填 ' + v + '‰ · 差 ' + diff + '‰ · 得分 ' + score + '</span>' +
            '</div>' +
            '<p class="dg-quiet">' + flow + '</p>' +
            '<div class="dg-list">' + dist.join('') + '</div>';

        ansEl.disabled = true;
        renderStats();
    }

    function renderStats() {
        var s = S.stats;
        if (!s.n) {
            stEl.innerHTML = '<span>还没做题。</span>';
            return;
        }
        stEl.innerHTML =
            '<span>做题 <b>' + s.n + '</b></span>' +
            '<span>平均差 <b>' + Math.round(s.err / s.n) + '‰</b></span>' +
            '<span>最好 <b>' + (s.best === null ? '—' : s.best + '‰') + '</b></span>' +
            '<span>连准 <b>' + s.streak + '</b>（最长 ' + s.bestStreak + '）</span>' +
            '<span>均分 <b>' + Math.round(s.score / s.n) + '</b></span>';
    }

    function copyLink() {
        if (!S.quiz) { return; }
        var url = location.origin + location.pathname + '?t=' + S.quiz.seed;
        var done = function () { fbEl.insertAdjacentHTML('afterbegin', '<p class="dg-quiet">链接已复制：' + url + '</p>'); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(done, function () { window.prompt('复制这道题的链接', url); });
        } else {
            window.prompt('复制这道题的链接', url);
        }
    }

    /* ---------- 挂载 ---------- */

    if (!S.P) { loadManual((Date.now() ^ 0x9e3779b9) >>> 0); }
    else { paintGrid(gridEl, S.P, { editable: true }); bindGrid(); compute(); }

    document.getElementById('dg-rand').addEventListener('click', function () {
        loadManual((Date.now() ^ (Math.random() * 1e9)) >>> 0);
    });

    document.getElementById('dg-clear').addEventListener('click', function () {
        var i, j;
        var P = [];
        for (i = 0; i < N; i++) { P.push(new Array(N)); }
        for (i = 0; i < N; i++) {
            for (j = 0; j < N; j++) { P[i][j] = null; }
        }
        S.P = P;
        paintGrid(gridEl, S.P, { editable: true });
        bindGrid();
        compute();
    });

    var m = /[?&]t=([0-9]+)/.exec(location.search);
    newQuiz(m ? Number(m[1]) : null);

    document.getElementById('dg-next').addEventListener('click', function () { newQuiz(null); });
    document.getElementById('dg-submit').addEventListener('click', submitAnswer);
    ansEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { submitAnswer(); }
    });
    document.getElementById('dg-copy').addEventListener('click', copyLink);
    document.getElementById('dg-reset').addEventListener('click', function () {
        S.stats = { n: 0, err: 0, score: 0, best: null, streak: 0, bestStreak: 0 };
        saveStats();
        renderStats();
    });

}());
