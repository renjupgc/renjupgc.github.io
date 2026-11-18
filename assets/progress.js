/*
 * 连珠杂箱 · 统一进度档案（按用户名分档）
 * ------------------------------------------------------------
 * 先填用户名，再做题。四项的分数各自独立、互不打通：
 *   禁手找茬 / 棋形判断 / VCF 做题 / 连珠英语，初始各 1000 分。
 * 每个用户名一套独立档案，换设备按用户名导出/导入，不会串分。
 * 做对加、做错扣，快加满分慢加少分；题目难度分最低 1000，显示在题旁。
 *
 * 存档是本地 JSON 文件，导出时算 HMAC-SHA256 签名，导入先验签，
 * 再核对「分数 = 1000 + 历史增减之和」。直接改文件里的分数会被挡回来。
 * 但要说清楚：这是纯静态站，签名密钥必然写在前端，懂代码的人仍能重签。
 * 它能防手改、防误改，防不了蓄意伪造——真防伪造得有服务端。
 */
(function () {
    'use strict';

    if (window.ZBX_PROGRESS) { return; }

    var KEY = 'zbx.progress.v2';
    var OLD_KEY = 'zbx.progress.v1';
    var UKEY = 'zbx.user';
    var BASE = 1000;
    var SEED = 'lianzhu-zaxiang-progress-2026-9f3c7a2e';
    var STYLE_ID = 'zbx-progress-style';
    var NAME_RE = /^[\u4e00-\u9fa5A-Za-z0-9_-]{1,16}$/;

    var MODULES = [
        { k: 'jz_forbid', name: '禁手找茬' },
        { k: 'jz_shape', name: '棋形判断' },
        { k: 'vcf', name: 'VCF 做题' },
        { k: 'english', name: '连珠英语' }
    ];

    /* ---------- 档案（每个用户名一份） ---------- */
    function blankStats() { return { n: 0, ok: 0, bad: 0, sumMs: 0, bestMs: 0 }; }

    function blankProfile() {
        var scores = {}, stats = {};
        MODULES.forEach(function (m) { scores[m.k] = BASE; stats[m.k] = blankStats(); });
        return { scores: scores, stats: stats, hist: [] };
    }

    function normalizeProfile(raw) {
        var d = blankProfile();
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
        return d;
    }

    /* 整座档案库：用户名 -> 档案 */
    function blankStore() { return { app: 'zbx-progress', v: 2, at: Date.now(), users: {} }; }

    function normalizeStore(raw) {
        var d = blankStore();
        if (!raw || typeof raw !== 'object') { return d; }
        if (raw.users && typeof raw.users === 'object') {
            Object.keys(raw.users).forEach(function (name) {
                if (NAME_RE.test(name)) { d.users[name] = normalizeProfile(raw.users[name]); }
            });
        }
        if (Number(raw.at)) { d.at = Math.round(Number(raw.at)); }
        return d;
    }

    /* 老版本（单档案）迁上来，归到当前用户名名下，不丢分 */
    function migrateOld() {
        var raw = null;
        try { raw = JSON.parse(window.localStorage.getItem(OLD_KEY) || 'null'); } catch (e) { raw = null; }
        if (!raw || typeof raw !== 'object' || !raw.scores) { return; }
        var store = blankStore();
        var name = curUser || '旧进度';
        store.users[name] = normalizeProfile(raw);
        try {
            window.localStorage.setItem(KEY, JSON.stringify(store));
            window.localStorage.setItem(UKEY, name);
        } catch (e) { /* 忽略 */ }
        curUser = name;
    }

    /* ---------- 当前用户名 ---------- */
    function readUser() {
        var name = '';
        try { name = String(window.localStorage.getItem(UKEY) || ''); } catch (e) { name = ''; }
        return NAME_RE.test(name) ? name : '';
    }
    var curUser = readUser();

    function loadStore() {
        var raw = null;
        try { raw = JSON.parse(window.localStorage.getItem(KEY) || 'null'); } catch (e) { raw = null; }
        if (!raw && !window.localStorage.getItem(KEY)) { migrateOld(); }
        try { raw = JSON.parse(window.localStorage.getItem(KEY) || 'null'); } catch (e) { raw = null; }
        return normalizeStore(raw);
    }

    var D = loadStore();
    if (curUser && !D.users[curUser]) { D.users[curUser] = blankProfile(); }

    function profile() {
        if (!curUser) { return null; }
        if (!D.users[curUser]) { D.users[curUser] = blankProfile(); }
        return D.users[curUser];
    }

    function save() {
        D.at = Date.now();
        try { window.localStorage.setItem(KEY, JSON.stringify(D)); return true; }
        catch (e) { return false; }
    }

    function setUser(name) {
        name = String(name || '').trim();
        /* 空名＝退出登录，回到未登录态；档案保留在本机，下次填名字还能进来 */
        if (!name) {
            curUser = '';
            try { window.localStorage.removeItem(UKEY); } catch (e) { /* 忽略 */ }
            save();
            render();
            try { document.dispatchEvent(new CustomEvent('zbx:user', { detail: { user: '' } })); } catch (e) { /* 老浏览器 */ }
            return true;
        }
        if (!NAME_RE.test(name)) { return false; }
        if (name !== curUser) {
            curUser = name;
            try { window.localStorage.setItem(UKEY, name); } catch (e) { /* 忽略 */ }
            if (!D.users[name]) { D.users[name] = blankProfile(); }
            save();
            notify('已切到「' + name + '」的档案。', 'ok');
        }
        render();
        try { document.dispatchEvent(new CustomEvent('zbx:user', { detail: { user: name } })); } catch (e) { /* 老浏览器 */ }
        return true;
    }

    function userName() { return curUser; }
    function userNames() { return Object.keys(D.users).sort(); }

    /* ---------- 计分 ---------- */
    function speedFactor(ms, par) {
        if (!par || par <= 0 || !ms || ms <= par) { return 1; }
        var x = ms / par;
        return Math.max(0.35, 1 - (x - 1) * 0.325);
    }

    function commit(module, opt) {
        var P = profile();
        if (!P || !MODULES.some(function (m) { return m.k === module; })) { return null; }
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
        var P = profile();
        if (!P) { return 0; }
        var st = P.stats[module];
        return st && st.ok ? Math.round(st.sumMs / st.ok) : 0;
    }

    function recommendLevel(module) {
        var P = profile();
        var s = (P && P.scores[module]) || BASE;
        var i = Math.floor((s - 900) / 160);
        return Math.max(0, Math.min(4, i));
    }

    function snapshot() {
        var p = normalizeStore(D);
        p.at = Date.now();
        return p;
    }

    /* ---------- 签名 ---------- */
    function canonical(p) {
        var lines = ['app=' + p.app, 'v=' + p.v, 'at=' + p.at];
        Object.keys(p.users).sort().forEach(function (name) {
            var u = p.users[name];
            lines.push('u=' + name);
            MODULES.forEach(function (m) {
                lines.push('s.' + name + '.' + m.k + '=' + u.scores[m.k]);
                lines.push('n.' + name + '.' + m.k + '=' + u.stats[m.k].n);
                lines.push('ok.' + name + '.' + m.k + '=' + u.stats[m.k].ok);
            });
            u.hist.forEach(function (h, i) {
                lines.push('h' + i + '.' + name + '=' + h.t + ',' + h.m + ',' + h.ok + ',' + h.ms + ',' + h.diff + ',' + h.d);
            });
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

    function weakSig(s) {
        var a = 2166136261, b = 5381;
        for (var i = 0; i < s.length; i++) {
            a = (a ^ s.charCodeAt(i)) * 16777619 >>> 0;
            b = ((b << 5) + b + s.charCodeAt(i)) >>> 0;
        }
        return 'w' + ('00000000' + a.toString(16)).slice(-8) + ('00000000' + b.toString(16)).slice(-8);
    }

    function consistent(p) {
        for (var name in p.users) {
            if (!Object.prototype.hasOwnProperty.call(p.users, name)) { continue; }
            var u = p.users[name];
            for (var j = 0; j < MODULES.length; j++) {
                var m = MODULES[j].k;
                var sum = BASE, n = 0, ok = 0;
                for (var i = 0; i < u.hist.length; i++) {
                    if (u.hist[i].m !== m) { continue; }
                    sum += u.hist[i].d;
                    n += 1;
                    if (u.hist[i].ok) { ok += 1; }
                }
                sum = Math.max(0, sum);
                if (u.scores[m] !== sum) { return false; }
                if (u.stats[m].n !== n || u.stats[m].ok !== ok) { return false; }
            }
        }
        return true;
    }

    function exportFile() {
        if (!curUser) { notify('先填用户名，再导出进度。', 'bad'); return; }
        /* 只导出当前用户这一份：一个人的存档不夹带别人的分数 */
        var plain = blankStore();
        plain.users[curUser] = normalizeProfile(D.users[curUser]);
        hmac(canonical(plain)).then(function (sig) {
            var payload = { app: 'zbx-progress', v: 2, exported: new Date().toISOString(), data: plain, sig: sig };
            var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            var d = new Date();
            var tag = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
            a.download = '连珠杂箱-' + curUser + '-进度-' + tag + '.json';
            document.body.appendChild(a);
            a.click();
            setTimeout(function () {
                URL.revokeObjectURL(a.href);
                if (a.parentNode) { a.parentNode.removeChild(a); }
            }, 0);
            flagSaved(false);
            notify('已导出「' + curUser + '」的存档：' + a.download, 'ok');
        });
    }

    /* 导入：按用户名合并——只覆盖文件里带的用户名，不动本机其他人的分 */
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
                var data = normalizeStore(pack.data);
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
                    var names = Object.keys(data.users);
                    if (!names.length) { notify('这份存档里没有用户名档案。', 'bad'); resolve(false); return; }
                    names.forEach(function (name) { D.users[name] = data.users[name]; });
                    save();
                    render();
                    notify('读档成功：' + names.join('、') + ' 的分数已按用户名恢复。', 'ok');
                    resolve(true);
                });
            };
            reader.onerror = function () { notify('文件读不出来。', 'bad'); resolve(false); };
            reader.readAsText(file, 'utf-8');
        });
    }

    function reset() {
        if (!curUser) { notify('先填用户名。', 'bad'); return; }
        if (!window.confirm('清掉「' + curUser + '」在本机的全部进度，分数回到 1000？\n其他用户名不受影响。先导出存档再清，还能恢复回来。')) { return; }
        D.users[curUser] = blankProfile();
        save();
        render();
        notify('「' + curUser + '」的进度已清空，分数回到 1000。', 'ok');
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
            '.zbx-prog-user{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px;padding-bottom:12px;border-bottom:1px dashed var(--zp-line)}' +
            '.zbx-prog-user label{font-size:13px;color:var(--zp-sub);display:flex;align-items:center;gap:6px}' +
            '.zbx-prog-user input{width:150px;border:1px solid var(--zp-line);border-radius:8px;padding:5px 9px;font-size:14px;background:#fffdf7;color:var(--zp-ink)}' +
            '.zbx-prog-user button,.zbx-prog-btns button,.zbx-prog-btns label{cursor:pointer;border:1px solid var(--zp-line);' +
            'border-radius:9px;padding:6px 12px;background:#fffdf7;color:var(--zp-ink);font-size:13px;font-weight:600}' +
            '.zbx-prog-user button:hover,.zbx-prog-btns button:hover,.zbx-prog-btns label:hover{background:#fff6df}' +
            '.zbx-prog-user .zbx-prog-names{font-size:12px;color:var(--zp-sub);flex:1;min-width:120px}' +
            '.zbx-prog-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:10px}' +
            '.zbx-prog-cell{border:1px solid var(--zp-line);border-radius:10px;padding:8px 10px;background:rgba(255,255,255,.5)}' +
            '.zbx-prog-cell b{display:block;font-size:20px;line-height:1.2;font-variant-numeric:tabular-nums}' +
            '.zbx-prog-cell span{font-size:12px;color:var(--zp-sub)}' +
            '.zbx-prog-cell i{font-style:normal;font-size:11px;color:var(--zp-sub)}' +
            '.zbx-prog-btns{display:flex;gap:8px;flex-wrap:wrap}' +
            '.zbx-prog-btns input{display:none}' +
            '.zbx-prog-tip{margin:8px 0 0;font-size:12px;color:var(--zp-sub)}' +
            '.zbx-prog-note{margin:8px 0 0;font-size:13px;min-height:20px}' +
            '.zbx-prog-note.is-ok{color:#2f7d42}.zbx-prog-note.is-bad{color:#b23b2e}' +
            '.zbx-prog.is-dirty .zbx-prog-hint{color:#b26a12;font-weight:700}' +
            '.zbx-user{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:13px;color:var(--zp-sub)}' +
            '.zbx-user span{white-space:nowrap}' +
            '.zbx-user input{width:120px;border:1px solid var(--zp-line);border-radius:8px;padding:4px 8px;font-size:13px;background:#fffdf7;color:var(--zp-ink)}' +
            '.zbx-user button{cursor:pointer;border:1px solid var(--zp-line);border-radius:8px;padding:4px 9px;background:#fffdf7;color:var(--zp-ink);font-size:12px;font-weight:600}' +
            '.zbx-user button:hover{background:#fff6df}' +
            '.zbx-user b{color:var(--zp-ink);font-weight:700}' +
            '@media(prefers-color-scheme:dark){.zbx-prog{--zp-line:#5c4e3c;--zp-ink:#efe4cd;--zp-sub:#b6a688;background:rgba(40,34,26,.55)}' +
            '.zbx-prog-cell,.zbx-prog-user button,.zbx-prog-user input,.zbx-prog-btns button,.zbx-prog-btns label,.zbx-user input,.zbx-user button{background:rgba(255,255,255,.06)}}';
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
    function flagSaved(isDirty) { dirty = !!isDirty; render(); }

    function bind() {
        Array.prototype.forEach.call(document.querySelectorAll('[data-zbx-progress],[data-zbx-user]'), function (box) {
            if (box.dataset.bound === '1') { return; }
            box.dataset.bound = '1';
            box.addEventListener('click', function (ev) {
                var b = ev.target.closest('button');
                if (!b) { return; }
                var act = b.getAttribute('data-act');
                if (act === 'export') { exportFile(); }
                else if (act === 'reset') { reset(); }
                else if (act === 'setuser') {
                    var inp = box.querySelector('[data-act="username"]');
                    if (inp) { setUser(inp.value); }
                }
            });
            box.addEventListener('keydown', function (ev) {
                if (ev.key === 'Enter' && ev.target && ev.target.getAttribute('data-act') === 'username') {
                    setUser(ev.target.value);
                }
            });
            box.addEventListener('change', function (ev) {
                if (ev.target && ev.target.getAttribute('data-act') === 'import' && ev.target.files) {
                    importFile(ev.target.files[0]);
                    ev.target.value = '';
                }
            });
        });
    }

    function userChipHtml() {
        return '<span>用户名</span>' +
            '<input type="text" maxlength="16" data-act="username" placeholder="填名字" value="' + escHtml(curUser) + '">' +
            '<button type="button" data-act="setuser">' + (curUser ? '切换' : '进入') + '</button>' +
            (curUser ? '<b>' + escHtml(curUser) + '</b>' : '<span>未登录，分数不会记</span>');
    }

    function render() {
        injectStyle();
        Array.prototype.forEach.call(document.querySelectorAll('[data-zbx-user]'), function (chip) {
            chip.className = 'zbx-user';
            chip.innerHTML = userChipHtml();
        });
        Array.prototype.forEach.call(document.querySelectorAll('[data-zbx-progress]'), function (box) {
            var P = profile();
            var cells = MODULES.map(function (m) {
                var sc = P ? P.scores[m.k] : BASE;
                var st = P ? P.stats[m.k] : blankStats();
                return '<div class="zbx-prog-cell"><b>' + sc + '</b><span>' + m.name + '</span>' +
                    '<i>做 ' + st.n + ' · 平均 ' + fmtMs(avgMs(m.k)) + '</i></div>';
            }).join('');
            var names = userNames();
            var namesHtml = names.length ? '本机档案：' + names.map(function (n) {
                return escHtml(n) + (n === curUser ? '（当前）' : '');
            }).join('、') : '还没有档案，填个名字开始。';
            box.className = 'zbx-prog' + (dirty ? ' is-dirty' : '');
            box.innerHTML = '<h3>我的进度 <small>四项分数各自独立 · 初始 1000 分</small></h3>' +
                '<div class="zbx-prog-user">' +
                '<label>用户名 <input type="text" maxlength="16" data-act="username" placeholder="填中文或字母，1–16 位" value="' + escHtml(curUser) + '"></label>' +
                '<button type="button" data-act="setuser">切换 / 建立</button>' +
                '<span class="zbx-prog-names">' + namesHtml + '</span>' +
                '</div>' +
                (curUser ? '<div class="zbx-prog-grid">' + cells + '</div>' :
                    '<p class="zbx-prog-tip">填好用户名并按「切换 / 建立」，就能开始记分。</p>') +
                '<div class="zbx-prog-btns">' +
                '<button type="button" data-act="export">导出进度</button>' +
                '<label>导入进度<input type="file" accept="application/json,.json" data-act="import"></label>' +
                '<button type="button" data-act="reset">清空</button>' +
                '</div>' +
                '<p class="zbx-prog-tip zbx-prog-hint">' +
                (dirty ? '进度有更新，记得点「导出进度」存一份。' :
                    '进度按用户名自动存在本机；换设备就导出文件带过去，导入时按用户名归位，不会串分。存档带签名，改分数会被拦下。') +
                '</p>' +
                '<p class="zbx-prog-note" role="status" aria-live="polite"></p>';
        });
        bind();
    }

    function escHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function watch() {
        if (!window.MutationObserver) { return; }
        new window.MutationObserver(function () {
            var boxes = document.querySelectorAll('[data-zbx-progress],[data-zbx-user]');
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
        score: function (m) { var P = profile(); return (P && P.scores[m]) || BASE; },
        stats: function (m) { var P = profile(); return (P && P.stats[m]) || blankStats(); },
        user: userName,
        setUser: setUser,
        userNames: userNames,
        validName: function (n) { return NAME_RE.test(String(n || '').trim()); },
        ready: function () { return !!curUser; },
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
