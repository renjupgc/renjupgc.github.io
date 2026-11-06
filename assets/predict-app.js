/* 杂技 · 胜率预测：读 assets/predict.js 里的数据，在页面上算胜平负与赔率。 */
(function () {
    var D = window.ZBX_PREDICT;
    if (!D) { return; }

    var K = Math.log(10) / 400;      // 期望得分的 logit 斜率，与等级分算法一致
    var D0 = D.d0;                   // 双方同分时的和棋率
    var DC = D.dc;                   // 和棋率随等级分差衰减的特征值
    var PRIOR = 3;                   // 交手记录修正期望得分时的等效先验局数
    var PRIOR_D = 10;                // 和棋更靠运气，修正和棋率时的先验要重得多
    var MARGIN = 0.05;               // 赔率抽水

    function $(id) { return document.getElementById(id); }
    var ia = $('wp-a'), ib = $('wp-b');
    var cardA = $('wp-card-a'), cardB = $('wp-card-b');
    var boxH2H = $('wp-h2h'), boxRes = $('wp-result'), list = $('wp-names');

    var names = Object.keys(D.players).sort(function (a, b) {
        return (D.players[b].r - D.players[a].r) || a.localeCompare(b, 'zh');
    });
    var order = {};
    names.forEach(function (n, i) { order[n] = i; });

    names.forEach(function (n) {
        var o = document.createElement('option');
        o.value = n;
        list.appendChild(o);
    });

    function esc(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function findName(raw) {
        var s = (raw || '').replace(/\s+/g, '');
        if (!s) { return null; }
        if (D.players[s]) { return s; }
        var hits = names.filter(function (n) { return n.indexOf(s) >= 0; });
        if (!hits.length) { return null; }
        var starts = hits.filter(function (n) { return n.indexOf(s) === 0; });
        var pool = starts.length ? starts : hits;
        pool.sort(function (a, b) { return order[a] - order[b]; });
        return pool[0];
    }

    function pct(x) { return (x * 100).toFixed(1) + '%'; }
    function odds(x) {
        var v = 1 / (x * (1 + MARGIN));
        return v >= 100 ? '99+' : v.toFixed(2);
    }

    function evRows(ev) {
        if (!ev || !ev.length) {
            return '<li><span>—</span><span class="wp-ev-name">暂无收录的成绩</span><span class="wp-rank"></span></li>';
        }
        return ev.map(function (row) {
            var t = D.tz[row[1]] || ['', ''];
            var r = (row[2] === '' || row[2] === null || row[2] === undefined)
                ? '—' : (typeof row[2] === 'number' ? '第 ' + row[2] : String(row[2]));
            return '<li><time>' + esc(String(row[0]).slice(2)) + '</time>' +
                '<span class="wp-ev-name"><a href="../zayu/t' + row[1] + '.html">' +
                esc(t[1]) + '</a></span>' +
                '<span class="wp-rank">' + esc(r) + '</span></li>';
        }).join('');
    }

    function card(host, name) {
        if (!name) {
            host.innerHTML = '<p class="wp-warn">输入姓名，或从下拉里选一位棋手。</p>';
            return;
        }
        var p = D.players[name];
        var wr = p.g ? (p.w + 0.5 * p.d) / p.g : 0;
        var flag = p.listed ? '第 ' + p.rank + ' 位' : '未入榜 · 估算';
        var sub = [p.reg, p.uni].filter(Boolean).join(' · ') || '地区未载';
        host.innerHTML =
            '<div class="wp-card-head">' +
            '<a class="wp-name" href="../zayu/p/' + encodeURIComponent(name) + '.html">' + esc(name) + '</a>' +
            '<span class="wp-flag">' + flag + '</span></div>' +
            '<p class="wp-sub">' + esc(sub) + '</p>' +
            '<div class="wp-meta">' +
            '<div><span>等级分</span><b>' + p.r.toFixed(2) + '</b></div>' +
            '<div><span>对局</span><b>' + p.g + '</b></div>' +
            '<div><span>得分率</span><b>' + Math.round(wr * 100) + '%</b></div>' +
            '</div>' +
            '<div class="wp-ev"><h3>战绩与近期成绩</h3><ul>' +
            '<li><span>合计</span><span class="wp-ev-name">' + p.w + ' 胜 ' + p.d + ' 平 ' + p.l + ' 负</span>' +
            '<span class="wp-rank">' + p.g + ' 局</span></li>' +
            evRows(p.ev) + '</ul></div>';
    }

    function h2hRender(a, b) {
        var key = [a, b].sort().join('|');
        var rec = D.h2h[key];
        if (!rec) {
            return '<h2>交手记录</h2><p class="wp-h2h-sum">两人此前没有收录到交手，' +
                '预测只按等级分与各自战绩给出。</p>';
        }
        var aFirst = ([a, b].sort()[0] === a);
        var aw = aFirst ? rec.aw : rec.bw;
        var bw = aFirst ? rec.bw : rec.aw;
        var rows = rec.g.map(function (g) {
            var mine = g[2];
            if (!aFirst && mine !== '0.5') { mine = mine === '1' ? '0' : '1'; }
            var txt = mine === '1' ? '胜' : (mine === '0' ? '负' : '和');
            var cls = mine === '1' ? 'wp-res-w' : (mine === '0' ? 'wp-res-l' : 'wp-res-d');
            var t = D.tz[g[1]] || ['', ''];
            return '<tr><td>' + esc(String(g[0])) + '</td>' +
                '<td><a href="../zayu/t' + g[1] + '.html">' + esc(t[1]) + '</a></td>' +
                '<td class="' + cls + '">' + txt + '</td></tr>';
        }).join('');
        return '<h2>交手记录</h2>' +
            '<p class="wp-h2h-sum">共 ' + rec.n + ' 局：' + esc(a) + ' <b>' + aw + '</b> 胜 ' +
            rec.d + ' 平 <b>' + bw + '</b> 负。' +
            (rec.g.length < rec.n ? '下表只列最近 ' + rec.g.length + ' 局。' : '') + '</p>' +
            '<table><thead><tr><th>日期</th><th>赛事</th><th>' + esc(a) + ' 视角</th></tr></thead>' +
            '<tbody>' + rows + '</tbody></table>';
    }

    function predict(a, b) {
        var ra = D.players[a].r, rb = D.players[b].r;
        var delta = ra - rb;
        var e0 = 1 / (1 + Math.exp(-K * delta));
        var d0 = D0 * Math.exp(-Math.abs(delta) / DC);
        var rec = D.h2h[[a, b].sort().join('|')];
        var e = e0, pd = d0, used = 0;
        if (rec && rec.n) {
            var aFirst = ([a, b].sort()[0] === a);
            var aw = aFirst ? rec.aw : rec.bw;
            var score = (aw + 0.5 * rec.d) / rec.n;
            e = (score * rec.n + PRIOR * e0) / (rec.n + PRIOR);
            pd = (rec.d + PRIOR_D * d0) / (rec.n + PRIOR_D);
            used = rec.n;
        }
        var pw = Math.max(0.001, e - pd / 2);
        var pl = Math.max(0.001, 1 - e - pd / 2);
        var sum = pw + pd + pl;
        return { delta: delta, e0: e0, d0: d0, e: e, pd: pd / sum,
                 pw: pw / sum, pl: pl / sum, used: used };
    }

    function resultRender(a, b, r) {
        if (a === b) {
            boxRes.innerHTML = '<p class="wp-warn">左右是同一个人，换一位对手再看。</p>';
            return;
        }
        var dTxt = (r.delta >= 0 ? '+' : '') + r.delta.toFixed(2);
        var src = r.used
            ? '按交手 ' + r.used + ' 局（等效 ' + PRIOR + ' 局先验）修正后'
            : '两人无交手记录，未作修正';
        boxRes.innerHTML =
            '<h2>推测</h2>' +
            '<p class="wp-delta">等级分差 ' + esc(a) + ' − ' + esc(b) + ' = <b>' + dTxt + '</b>；' +
            '按等级分算基础期望 ' + pct(r.e0) + '、和棋率 ' + pct(r.d0) + '；' + src + '。</p>' +
            '<div class="wp-bar">' +
            '<i class="s-w" style="width:' + (r.pw * 100).toFixed(2) + '%">' +
            (r.pw > 0.12 ? esc(a) + '胜 ' + pct(r.pw) : '') + '</i>' +
            '<i class="s-d" style="width:' + (r.pd * 100).toFixed(2) + '%">' +
            (r.pd > 0.12 ? '和 ' + pct(r.pd) : '') + '</i>' +
            '<i class="s-l" style="width:' + (r.pl * 100).toFixed(2) + '%">' +
            (r.pl > 0.12 ? esc(b) + '胜 ' + pct(r.pl) : '') + '</i>' +
            '</div>' +
            '<table class="wp-odds"><thead><tr><th>结果</th><th>推测概率</th>' +
            '<th>赔率</th></tr></thead><tbody>' +
            '<tr><td>' + esc(a) + ' 胜</td><td>' + pct(r.pw) + '</td>' +
            '<td>' + odds(r.pw) + '</td></tr>' +
            '<tr><td>和棋</td><td>' + pct(r.pd) + '</td>' +
            '<td>' + odds(r.pd) + '</td></tr>' +
            '<tr><td>' + esc(b) + ' 胜</td><td>' + pct(r.pl) + '</td>' +
            '<td>' + odds(r.pl) + '</td></tr>' +
            '</tbody></table>';
    }

    function render() {
        var a = findName(ia.value), b = findName(ib.value);
        ia.classList.toggle('is-bad', !a && !!ia.value.trim());
        ib.classList.toggle('is-bad', !b && !!ib.value.trim());
        card(cardA, a);
        card(cardB, b);
        if (!a || !b) {
            boxH2H.innerHTML = '<h2>交手记录</h2><p class="wp-h2h-sum">两位棋手都选定后显示。</p>';
            boxRes.innerHTML = '<h2>推测</h2><p class="wp-warn">选好左右两位棋手，这里给出胜平负与赔率。</p>';
            return;
        }
        boxH2H.innerHTML = h2hRender(a, b);
        resultRender(a, b, predict(a, b));
    }

    $('wp-swap').addEventListener('click', function () {
        var t = ia.value; ia.value = ib.value; ib.value = t;
        render();
    });
    [ia, ib].forEach(function (el) {
        el.addEventListener('input', render);
        el.addEventListener('change', function () {
            var n = findName(el.value);
            if (n) { el.value = n; }
            render();
        });
    });

    ia.value = names[0] || '';
    ib.value = names[1] || '';
    render();
})();
