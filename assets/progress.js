/*
 * 连珠杂箱 · 统一进度档案
 * ------------------------------------------------------------
 * 一处管理四个模块的分数、用时和做题数：禁手找茬、棋形判断、VCF、连珠英语。
 * 分数从 1000 起，做对加、做错扣，快加满分慢加少分；题目难度分最低 1000。
 *
 * 存档是本地 JSON 文件，导出时算一个 HMAC-SHA256 签名，导入先验签，
 * 再核对「分数 = 1000 + 历史增减之和」。直接改文件里的分数会被挡回来。
 * 但要说清楚：这是纯静态站，签名密钥必然写在前端，懂代码的人仍能重签。
 * 它能防手改、防误改，防不了蓄意伪造——真防伪造得有服务端。
 */
(function () {
    'use strict';

    if (window.ZBX_PROGRESS) { return; }

    var KEY = 'zbx.progress.v1';
    var BASE = 1000;
    var SEED = 'lianzhu-zaxiang-progress-2026-9f3c7a2e';
    var STYLE_ID = 'zbx-progress-style';

    var MODULES = [
        { k: 'jz_forbid', name: '禁手找茬' },
        { k: 'jz_shape', name: '棋形判断' },
        { k: 'vcf', name: 'VCF 做题' },
        { k: 'english', name: '连珠英语' }
    ];

    /* ---------- 工具 ---------- */
    function blankStats() { return { n: 0, ok: 0, bad: 0, sumMs: 0, bestMs: 0 }; }

    function blank() {
        var scores = {}, stats = {};
        MODULES.forEach(function (m) {
            scores[m.k] = BASE;
            stats[m.k] = blankStats();
        });
        return { app: 'zbx-progress', v: 1, at: Date.now(), scores: scores, stats: stats, hist: [] };
    }

    function normalize(raw) {
        var d = blank();
        if (!raw || typeof raw !== 'object') { return d; }
        var i, m;
        if (raw.scores && typeof raw.scores === 'object') {
            for (i = 0; i < MODULES.length; i++) {
                m = MODULES[i].k;
                var sc = Number(raw.scores[m]);
                if (isFinite(sc) && sc >= 0 && sc < 1e7) { d.scores[m] = Math.round(sc); }
            }
        }
        if (raw.stats && typeof raw.stats === 'object') {
            for (i = 0; i < MODULES.length; i++) {
                m = MODULES[i].k;
                var st = raw.stats[m];
                if (!st || typeof st !== 'object') { continue; }
                ['n', 'ok', 'bad', 'sumMs', 'bestMs'].forEach(function (f) {
                    var v = Number(st[f]);
                    if (isFinite(v) && v >= 0 && v < 1e12) { d.stats[m][f] = Math.round(v); }
                });
            }
        }
        if (Array.isArray(raw.hist)) {
            d.hist = raw.hist.filter(function (h) {
                return h && typeof h === 'object' && MODULES.some(function (x) { return x.k === h.m; });
            }).map(function (h) {
                return {
                    t: Number(h.t) || 0,
                    m: h.m,
                    ok: h.ok ? 1 : 0,
                    ms: Math.max(0, Math.round(Number(h.ms) || 0)),
                    diff: Math.max(1000, Math.round(Number(h.diff) || 1000)),
                    d: Math.round(Number(h.d) || 0)
                };
            }).slice(-2000);
        }
        if (Number(raw.at)) { d.at = Math.round(Number(raw.at)); }
        return d;
    }

    function load() {
        var raw = null;
        try { raw = JSON.parse(window.localStorage.getItem(KEY) || 'null'); } catch (e) { raw = null; }
        return normalize(raw);
    }

    var P = load();

    function save() {
        P.at = Date.now();
        try { window.localStorage.setItem(KEY, JSON.stringify(P)); return true; }
        catch (e) { return false; }
    }

    /* ---------- 计分 ----------
     * 难度分 diff 最低 1000；par 是该难度「拿满分的时间线」，
     * 用时不超过 par 满系数，超过就衰减，最低留 0.35，免得慢的人白做。 */
    function speedFactor(ms, par) {
        if (!par || par <= 0 || !ms || ms <= par) { return 1; }
        var x = ms / par;
        return Math.max(0.35, 1 - (x - 1) * 0.325);
    }

    function commit(module, opt) {
        if (!MODULES.some(function (m) { return m.k === module; })) { return null; }
        opt = opt || {};
        var ok = !!opt.ok;
        var ms = Math.max(0, Math.round(Number(opt.ms) || 0));
        var diff = Math.max(1000, Math.round(Number(opt.diff) || 1000));
        var par = Math.max(0, Math.round(Number(opt.par) || 0));
        var d = ok
            ? Math.max(1, Math.round(14 * (diff / 1000) * speedFactor(ms, par)))
            : -Math.max(1, Math.round(7 * (diff / 1000)));
        var before = P.scores[module];
        var after = Math.max(0, before + d);
        P.scores[module] = after;
        var st = P.stats[module];
        st.n += 1;
        if (ok) { st.ok += 1; st.sumMs += ms; if (!st.bestMs || ms < st.bestMs) { st.bestMs = ms; } }
        else { st.bad += 1; }
        P.hist.push({ t: Date.now(), m: module, ok: ok ? 1 : 0, ms: ms, diff: diff, d: after - before });
        if (P.hist.length > 2000) { P.hist.shift(); }
        save();
        return { delta: after - before, before: before, after: after, diff: diff, ms: ms, ok: ok };
    }

    function avgMs(module) {
        var st = P.stats[module];
        return st && st.ok ? Math.round(st.sumMs / st.ok) : 0;
    }

    function recommendLevel(module) {
        var s = P.scores[module] || BASE;
        var i = Math.floor((s - 900) / 160);
        return Math.max(0, Math.min(4, i));
    }

    function snapshot() {
        var p = normalize(P);
        p.at = Date.now();
        return p;
    }

    /* ---------- 签名 ----------
     * 规范化串只取白名单字段，顺序固定，避免对象键序不同导致验签失败。 */
    function canonical(p) {
        var lines = ['app=' + p.app, 'v=' + p.v, 'at=' + p.at];
        MODULES.forEach(function (m) {
            lines.push('s.' + m.k + '=' + p.scores[m.k]);
            lines.push('n.' + m.k + '=' + p.stats[m.k].n);
            lines.push('ok.' + m.k + '=' + p.stats[m.k].ok);
        });
        p.hist.forEach(function (h, i) {
            lines.push('h' + i + '=' + h.t + ',' + h.m + ',' + h.ok + ',' + h.ms + ',' + h.diff + ',' + h.d);
        });
        return lines.join('\n');
    }

    function hex(buf) {
        var out = '';
        var u = new Uint8Array(buf);
        for (var i = 0; i < u.length; i++) { out += ('0' + u[i].toString(16)).slice(-2); }
        return out;
    }

    function hmac(text) {
        var subtle = window.crypto && window.crypto.subtle;
        if (!subtle || !window.TextEncoder) { return Promise.resolve(weakSig(text)); }
        return subtle.importKey('raw', new TextEncoder().encode(SEED),
            { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
            .then(function (key) {
                return subtle.sign('HMAC', key, new TextEncoder().encode(text));
            })
            .then(hex)
            .catch(function () { return weakSig(text); });
    }

    /* 没有 Web Crypto 时的退路：两轮 FNV，仍是签名，只是弱一些 */
    function weakSig(s) {
        var a = 2166136261, b = 5381;
        for (var i = 0; i < s.length; i++) {
            a = (a ^ s.charCodeAt(i)) * 16777619 >>> 0;
            b = ((b << 5) + b + s.charCodeAt(i)) >>> 0;
        }
        return 'w' + ('00000000' + a.toString(16)).slice(-8) + ('00000000' + b.toString(16)).slice(-8);
    }

    /* 一致性：分数必须等于 1000 + 历史增减之和，做题数也要对得上 */
    function consistent(p) {
        var i, m;
        for (i = 0; i < MODULES.length; i++) {
            m = MODULES[i].k;
            var sum = BASE, n = 0, ok = 0;
            for (var j = 0; j < p.hist.length; j++) {
                if (p.hist[j].m !== m) { continue; }
                sum += p.hist[j].d;
                n += 1;
                if (p.hist[j].ok) { ok += 1; }
            }
            sum = Math.max(0, sum);
            if (p.scores[m] !== sum) { return false; }
            if (p.stats[m].n !== n || p.stats[m].ok !== ok) { return false; }
        }
        return true;
    }

    function exportFile() {
        var plain = snapshot();
        hmac(canonical(plain)).then(function (sig) {
            var payload = { app: 'zbx-progress', v: 1, exported: new Date().toISOString(), data: plain, sig: sig };
            var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            var d = new Date();
            var tag = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
            a.download = '连珠杂箱-进度-' + tag + '.json';
            document.body.appendChild(a);
            a.click();
            setTimeout(function () {
                URL.revokeObjectURL(a.href);
                if (a.parentNode) { a.parentNode.removeChild(a); }
            }, 0);
            flagSaved(false);
            notify('已导出存档：' + a.download, 'ok');
        });
    }

    function importFile(file) {
        if (!file) { return Promise.resolve(false); }
        return new Promise(function (resolve) {
            var reader = new FileReader();
            reader.onload = function () {
                var pack = null;
                try { pack = JSON.parse(String(reader.result)); } catch (e) { pack = null; }
                if (!pack || pack.app !== 'zbx-progress' || !pack.data || typeof pack.sig !== 'string') {
                    notify('这不是连珠杂箱的进度存档。', 'bad');
                    resolve(false);
                    return;
                }
                var data = normalize(pack.data);
                hmac(canonical(data)).then(function (sig) {
                    if (sig !== pack.sig) {
                        notify('签名不对：文件被改过，或不是本站点导出的。已拒绝导入。', 'bad');
                        resolve(false);
                        return;
                    }
                    if (!consistent(data)) {
                        notify('档案内部对不上：分数和历史记录不一致，已拒绝导入。', 'bad');
                        resolve(false);
                        return;
                    }
                    P = data;
                    save();
                    render();
                    notify('读档成功：分数、用时和做题数已恢复。', 'ok');
                    resolve(true);
                });
            };
            reader.onerror = function () { notify('文件读不出来。', 'bad'); resolve(false); };
            reader.readAsText(file, 'utf-8');
        });
    }

    function reset() {
        if (!window.confirm('清掉本机全部进度，分数回到 1000？\n先导出存档再清，还能恢复回来。')) { return; }
        P = blank();
        save();
        render();
        notify('进度已清空，分数回到 1000。', 'ok');
    }

    /* ---------- 面板 ---------- */
    function fmtMs(ms) {
        if (!ms) { return '—'; }
        var t = Math.round(ms / 1000);
        if (t < 60) { return t + ' 秒'; }
        return Math.floor(t / 60) + ' 分 ' + (t % 60) + ' 秒';
    }

    function injectStyle() {
        if (document.getElementById(STYLE_ID)) { return; }
        var css = '' +
            '.zbx-prog{--zp-line:#d8cbb0;--zp-ink:#4a3b28;--zp-sub:#85745a;' +
            'margin:16px 0;padding:14px 16px;border:1px solid var(--zp-line);border-radius:14px;' +
            'background:rgba(255,255,255,.62);font:14px/1.6 ui-sans-serif,system-ui,sans-serif;color:var(--zp-ink)}' +
            '.zbx-prog h3{margin:0 0 10px;font-size:15px;font-weight:700;display:flex;align-items:center;gap:8px;flex-wrap:wrap}' +
            '.zbx-prog h3 small{font-weight:400;color:var(--zp-sub);font-size:12px}' +
            '.zbx-prog-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:10px}' +
            '.zbx-prog-cell{border:1px solid var(--zp-line);border-radius:10px;padding:8px 10px;background:rgba(255,255,255,.5)}' +
            '.zbx-prog-cell b{display:block;font-size:20px;line-height:1.2;font-variant-numeric:tabular-nums}' +
            '.zbx-prog-cell span{font-size:12px;color:var(--zp-sub)}' +
            '.zbx-prog-cell i{font-style:normal;font-size:11px;color:var(--zp-sub)}' +
            '.zbx-prog-btns{display:flex;gap:8px;flex-wrap:wrap}' +
            '.zbx-prog-btns button,.zbx-prog-btns label{cursor:pointer;border:1px solid var(--zp-line);' +
            'border-radius:9px;padding:6px 12px;background:#fffdf7;color:var(--zp-ink);font-size:13px;font-weight:600}' +
            '.zbx-prog-btns button:hover,.zbx-prog-btns label:hover{background:#fff6df}' +
            '.zbx-prog-btns input{display:none}' +
            '.zbx-prog-tip{margin:8px 0 0;font-size:12px;color:var(--zp-sub)}' +
            '.zbx-prog-note{margin:8px 0 0;font-size:13px;min-height:20px}' +
            '.zbx-prog-note.is-ok{color:#2f7d42}.zbx-prog-note.is-bad{color:#b23b2e}' +
            '.zbx-prog.is-dirty .zbx-prog-hint{color:#b26a12;font-weight:700}' +
            '@media(prefers-color-scheme:dark){.zbx-prog{--zp-line:#5c4e3c;--zp-ink:#efe4cd;--zp-sub:#b6a688;background:rgba(40,34,26,.55)}' +
            '.zbx-prog-cell,.zbx-prog-btns button,.zbx-prog-btns label{background:rgba(255,255,255,.06)}}';
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = css;
        (document.head || document.body).appendChild(st);
    }

    var noteTimer = 0;
    function notify(text, kind) {
        Array.prototype.forEach.call(document.querySelectorAll('.zbx-prog-note'), function (el) {
            el.textContent = text;
            el.className = 'zbx-prog-note' + (kind ? ' is-' + kind : '');
        });
        window.clearTimeout(noteTimer);
        noteTimer = window.setTimeout(function () {
            Array.prototype.forEach.call(document.querySelectorAll('.zbx-prog-note'), function (el) {
                el.textContent = '';
                el.className = 'zbx-prog-note';
            });
        }, 5000);
    }

    var dirty = false;
    function flagSaved(isDirty) {
        dirty = !!isDirty;
        render();
    }

    function bind() {
        Array.prototype.forEach.call(document.querySelectorAll('[data-zbx-progress]'), function (box) {
            if (box.dataset.bound === '1') { return; }
            box.dataset.bound = '1';
            box.addEventListener('click', function (ev) {
                var b = ev.target.closest('button');
                if (!b) { return; }
                var act = b.getAttribute('data-act');
                if (act === 'export') { exportFile(); }
                else if (act === 'reset') { reset(); }
            });
            box.addEventListener('change', function (ev) {
                if (ev.target && ev.target.getAttribute('data-act') === 'import' && ev.target.files) {
                    importFile(ev.target.files[0]);
                    ev.target.value = '';
                }
            });
        });
    }

    function render() {
        injectStyle();
        Array.prototype.forEach.call(document.querySelectorAll('[data-zbx-progress]'), function (box) {
            var cells = MODULES.map(function (m) {
                var sc = P.scores[m.k];
                var st = P.stats[m.k];
                return '<div class="zbx-prog-cell"><b>' + sc + '</b><span>' + m.name + '</span>' +
                    '<i>做 ' + st.n + ' · 平均 ' + fmtMs(avgMs(m.k)) + '</i></div>';
            }).join('');
            box.className = 'zbx-prog' + (dirty ? ' is-dirty' : '');
            box.innerHTML = '<h3>我的进度 <small>初始 1000 分 · 做对加、做错扣，越快越多</small></h3>' +
                '<div class="zbx-prog-grid">' + cells + '</div>' +
                '<div class="zbx-prog-btns">' +
                '<button type="button" data-act="export">导出进度</button>' +
                '<label>导入进度<input type="file" accept="application/json,.json" data-act="import"></label>' +
                '<button type="button" data-act="reset">清空</button>' +
                '</div>' +
                '<p class="zbx-prog-tip zbx-prog-hint">' +
                (dirty ? '进度有更新，记得点「导出进度」存一份。' :
                    '进度自动存在本机；换设备就导出文件带过去。存档带签名，改分数会被拦下。') +
                '</p>' +
                '<p class="zbx-prog-note" role="status" aria-live="polite"></p>';
        });
        bind();
    }

    function watch() {
        if (!window.MutationObserver) { return; }
        new window.MutationObserver(function () {
            var boxes = document.querySelectorAll('[data-zbx-progress]');
            if (boxes.length) {
                var empty = false;
                Array.prototype.forEach.call(boxes, function (b) { if (!b.innerHTML.trim()) { empty = true; } });
                if (empty) { render(); }
            }
        }).observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { render(); watch(); });
    } else {
        render();
        watch();
    }

    window.ZBX_PROGRESS = {
        commit: commit,
        avgMs: avgMs,
        recommendLevel: recommendLevel,
        score: function (m) { return (P.scores[m] || BASE); },
        stats: function (m) { return P.stats[m] || blankStats(); },
        changed: function () { flagSaved(true); },
        saved: function () { flagSaved(false); },
        exportFile: exportFile,
        importFile: importFile,
        render: render,
        snapshot: snapshot,
        base: BASE,
        diffForDepth: function (depth) {
            return 1000 + Math.max(0, Math.min(4, Math.floor((depth - 3) / 2))) * 200;
        },
        parForDepth: function (depth) { return (2 + Math.max(1, depth) * 2) * 1000; }
    };
})();
