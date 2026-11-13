/*
 * 等级分时光机
 * ------------------------------------------------------------
 * 数据来自 assets/rating-history.js（由 tools/build_rating_history.py 生成）：
 * 每个时点一行分数，时点取「每场赛事结束那天」。
 *
 * 页面上的排名不预先算好，都在这里现排——252 人、几十个时点，排起来是瞬时的，
 * 数据文件也能小一半。
 *
 * 站内是无刷新跳转，换页时本文件不会重跑，所以逻辑挂在 boot() 上，
 * 由页面末尾的内联脚本再叫一次；新换进来的 DOM 没有 data-ready，会重新初始化。
 */
(function () {
    'use strict';

    var D = window.ZBX_RATING_HISTORY;
    if (!D || !D.snaps || !D.players) {
        return;
    }

    var SNAPS = D.snaps;
    var N = SNAPS.length;
    var PLAYERS = D.players;

    /* 排名缓存：拖滑块会反复取同一批时点，算过就存着 */
    var rankCache = {};

    function rowsAt(i) {
        if (rankCache[i]) {
            return rankCache[i];
        }
        var rows = [];
        for (var k = 0; k < PLAYERS.length; k++) {
            var v = PLAYERS[k][1][i];
            if (v === null || v === undefined) {
                continue;
            }
            rows.push({ n: PLAYERS[k][0], v: v, rank: 0 });
        }
        rows.sort(function (a, b) {
            if (b.v !== a.v) { return b.v - a.v; }
            return a.n < b.n ? -1 : (a.n > b.n ? 1 : 0);
        });
        for (var r = 0; r < rows.length; r++) {
            rows[r].rank = r + 1;
        }
        rankCache[i] = rows;
        return rows;
    }

    function rankMap(i) {
        if (i < 0) { return {}; }
        var rows = rowsAt(i);
        var m = {};
        for (var k = 0; k < rows.length; k++) {
            m[rows[k].n] = rows[k].rank;
        }
        return m;
    }

    function playerIndex(name) {
        for (var i = 0; i < PLAYERS.length; i++) {
            if (PLAYERS[i][0] === name) { return i; }
        }
        return -1;
    }

    function esc(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /* 地址栏里带 #s=时点&p=棋手，方便把某一帧直接发给别人 */
    function readHash() {
        var out = {};
        var h = String(location.hash || '').replace(/^#/, '');
        if (!h) { return out; }
        h.split('&').forEach(function (kv) {
            var p = kv.split('=');
            if (p.length === 2) { out[p[0]] = decodeURIComponent(p[1]); }
        });
        return out;
    }

    function writeHash(state) {
        var h = '#s=' + state.idx + (state.sel ? '&p=' + encodeURIComponent(state.sel) : '');
        if (location.hash === h) { return; }
        try {
            history.replaceState(history.state, '', location.pathname + location.search + h);
        } catch (e) { /* file:// 下忽略 */ }
    }

    function boot() {
        var rowsBox = document.getElementById('tm-rows');
        if (!rowsBox || rowsBox.dataset.ready === '1') {
            return;
        }
        rowsBox.dataset.ready = '1';

        var slider = document.getElementById('tm-slider');
        var dateEl = document.getElementById('tm-date');
        var eventEl = document.getElementById('tm-event');
        var countEl = document.getElementById('tm-count');
        var moreBtn = document.getElementById('tm-more');
        var prevBtn = document.getElementById('tm-prev');
        var nextBtn = document.getElementById('tm-next');
        var side = document.getElementById('tm-side');
        var ticks = document.getElementById('tm-ticks');
        var foot = document.getElementById('tm-foot');

        slider.min = '0';
        slider.max = String(N - 1);

        var hash = readHash();
        var state = {
            idx: Math.max(0, Math.min(N - 1, parseInt(hash.s, 10) || (N - 1))),
            sel: hash.p && playerIndex(hash.p) >= 0 ? hash.p : '',
            limit: 20
        };

        /* ---------- 刻度：年份变了才打一个 ---------- */

        var years = [];
        var lastYear = '';
        SNAPS.forEach(function (s, i) {
            var y = s.d.slice(0, 4);
            if (y !== lastYear) {
                years.push({ i: i, y: y });
                lastYear = y;
            }
        });
        ticks.innerHTML = years.map(function (t) {
            var pct = N > 1 ? (t.i / (N - 1)) * 100 : 0;
            return '<i style="left:' + pct.toFixed(2) + '%">' + t.y + '</i>';
        }).join('');

        /* ---------- 榜单 ---------- */

        function renderRows() {
            var rows = rowsAt(state.idx);
            var prev = rankMap(state.idx - 1);
            var n = state.limit >= rows.length ? rows.length : state.limit;
            var html = '';
            for (var k = 0; k < n; k++) {
                var r = rows[k];
                var d = '';
                if (prev[r.n] !== undefined) {
                    var dv = prev[r.n] - r.rank;
                    if (dv > 0) { d = '<span class="tm-d up">▲' + dv + '</span>'; }
                    else if (dv < 0) { d = '<span class="tm-d down">▼' + (-dv) + '</span>'; }
                    else { d = '<span class="tm-d">—</span>'; }
                } else {
                    d = '<span class="tm-d">新</span>';
                }
                html += '<li class="tm-row' + (r.n === state.sel ? ' is-on' : '') +
                    '" data-n="' + esc(r.n) + '">' +
                    '<span class="tm-r">' + r.rank + '</span>' +
                    '<span class="tm-n">' + esc(r.n) + '</span>' +
                    d +
                    '<span class="tm-p">' + r.v.toFixed(1) + '</span>' +
                    '</li>';
            }
            rowsBox.innerHTML = html;

            countEl.textContent = '在榜 ' + rows.length + ' 人';
            var rest = rows.length - n;
            moreBtn.hidden = rest <= 0;
            if (rest > 0) {
                moreBtn.textContent = '再看 ' + Math.min(rest, 60) + ' 位（共 ' + rows.length + ' 人）';
            }
        }

        rowsBox.addEventListener('click', function (e) {
            var li = e.target.closest ? e.target.closest('.tm-row') : null;
            if (!li) { return; }
            var name = li.getAttribute('data-n');
            state.sel = (state.sel === name) ? '' : name;
            renderRows();
            renderSide();
            writeHash(state);
        });

        moreBtn.addEventListener('click', function () {
            state.limit += 60;
            renderRows();
        });

        /* ---------- 个人曲线 ---------- */

        function seriesOf(pi) {
            var raw = PLAYERS[pi][1];
            var first = -1;
            for (var i = 0; i < raw.length; i++) {
                if (raw[i] !== null) { first = i; break; }
            }
            if (first < 0) { return null; }
            return { name: PLAYERS[pi][0], v: raw, first: first };
        }

        function chartSVG(s, idx) {
            var W = 340, H = 168;
            var padL = 36, padR = 10, padT = 12, padB = 20;
            var pw = W - padL - padR, ph = H - padT - padB;

            var lo = Infinity, hi = -Infinity;
            for (var i = s.first; i < s.v.length; i++) {
                if (s.v[i] === null) { continue; }
                if (s.v[i] < lo) { lo = s.v[i]; }
                if (s.v[i] > hi) { hi = s.v[i]; }
            }
            if (!isFinite(lo)) { return ''; }
            if (hi - lo < 40) { hi += 20; lo -= 20; }

            var span = s.v.length - 1 - s.first;
            function X(k) {
                return padL + (span ? ((k - s.first) / span) * pw : pw / 2);
            }
            function Y(val) {
                return padT + ph - ((val - lo) / (hi - lo)) * ph;
            }

            var line = [];
            var area = [];
            var dots = '';
            for (var k = s.first; k < s.v.length; k++) {
                if (s.v[k] === null) { continue; }
                var x = X(k).toFixed(1), y = Y(s.v[k]).toFixed(1);
                line.push((line.length ? 'L' : 'M') + x + ' ' + y);
                area.push((area.length ? 'L' : 'M') + x + ' ' + y);
                if (k === idx) {
                    dots = '<circle class="now-ring" cx="' + x + '" cy="' + y + '" r="6.2"/>' +
                        '<circle class="now" cx="' + x + '" cy="' + y + '" r="3.2"/>';
                }
            }
            var baseY = (padT + ph).toFixed(1);
            if (area.length) {
                area.push('L' + X(s.v.length - 1).toFixed(1) + ' ' + baseY);
                area.push('L' + X(s.first).toFixed(1) + ' ' + baseY + 'Z');
            }

            /* 三条横线：顶、中、底，标出量程 */
            var grid = '';
            [hi, (hi + lo) / 2, lo].forEach(function (val) {
                var y = Y(val).toFixed(1);
                grid += '<line class="grid" x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) +
                    '" y2="' + y + '"></line>' +
                    '<text class="axis" x="' + (padL - 5) + '" y="' + (parseFloat(y) + 3) +
                    '" text-anchor="end">' + Math.round(val) + '</text>';
            });

            var y0 = SNAPS[s.first].d.slice(0, 4);
            var y1 = SNAPS[N - 1].d.slice(0, 4);

            return '<svg class="tm-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' +
                esc(s.name) + ' 的等级分曲线">' +
                grid +
                '<path class="area" d="' + area.join('') + '"></path>' +
                '<path class="line" d="' + line.join('') + '"></path>' +
                dots +
                '<text class="axis" x="' + padL + '" y="' + (H - 4) + '">' + y0 + '</text>' +
                '<text class="axis" x="' + (W - padR) + '" y="' + (H - 4) +
                '" text-anchor="end">' + y1 + '</text>' +
                '</svg>';
        }

        function renderSide() {
            if (!state.sel) {
                side.innerHTML = '<p class="tm-side-empty">在左边点一位棋手，这里会画出他从首次出场到现在的等级分曲线。</p>';
                return;
            }
            var pi = playerIndex(state.sel);
            var s = seriesOf(pi);
            if (!s) {
                side.innerHTML = '<p class="tm-side-empty">这位棋手在数据里还没有出场记录。</p>';
                return;
            }
            var now = s.v[state.idx];
            var rank = 0;
            if (now !== null) {
                var rows = rowsAt(state.idx);
                for (var k = 0; k < rows.length; k++) {
                    if (rows[k].n === s.name) { rank = rows[k].rank; break; }
                }
            }
            var peak = -Infinity;
            for (var i = s.first; i < s.v.length; i++) {
                if (s.v[i] !== null && s.v[i] > peak) { peak = s.v[i]; }
            }

            side.innerHTML =
                '<p class="tm-side-name">' + esc(s.name) + '</p>' +
                '<p class="tm-side-meta">' +
                (now === null
                    ? '此时尚未出场'
                    : '此时第 <b>' + rank + '</b> 名 · <b>' + now.toFixed(1) + '</b> 分') +
                '　｜　最高 <b>' + peak.toFixed(1) + '</b>' +
                '</p>' +
                chartSVG(s, state.idx) +
                '<p class="tm-foot">横轴自 ' + SNAPS[s.first].d + ' 起，每个点是一场赛事。' +
                '空档表示那段时间没参赛。</p>';
        }

        /* ---------- 整体刷新 ---------- */

        function render() {
            var s = SNAPS[state.idx];
            dateEl.textContent = s.d;
            eventEl.textContent = s.t + '　·　' + s.g + ' 局';
            slider.value = String(state.idx);
            slider.style.setProperty('--p', (N > 1 ? (state.idx / (N - 1)) * 100 : 0) + '%');
            prevBtn.disabled = state.idx === 0;
            nextBtn.disabled = state.idx === N - 1;
            renderRows();
            renderSide();
        }

        slider.addEventListener('input', function () {
            state.idx = parseInt(slider.value, 10) || 0;
            render();
            writeHash(state);
        });

        prevBtn.addEventListener('click', function () {
            if (state.idx > 0) {
                state.idx--;
                render();
                writeHash(state);
            }
        });

        nextBtn.addEventListener('click', function () {
            if (state.idx < N - 1) {
                state.idx++;
                render();
                writeHash(state);
            }
        });

        var games = 0;
        SNAPS.forEach(function (x) { games += x.g || 0; });
        if (foot) {
            foot.textContent = '共 ' + N + ' 个时点、' + games + ' 局对局、' + PLAYERS.length +
                ' 位入榜棋手。曲线按当时的对局重放，末端数值与等级分表一致；' +
                '久未参赛者不另作衰减，所以平段＝那段时间没下棋。';
        }

        render();
    }

    window.ZBX_TIMEMACHINE = { boot: boot };
    if (document.getElementById('tm-rows')) {
        boot();
    }
})();
