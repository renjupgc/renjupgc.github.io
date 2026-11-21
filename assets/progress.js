/*
 * 连珠杂箱 · 统一进度档案（随账号存云端）
 * ------------------------------------------------------------
 * 登录后四项分数各自独立、互不打通：
 *   禁手找茬 / 棋形判断 / VCF 做题 / 连珠英语，初始各 1000 分。
 * 分数与连珠英语的背词记录都放在云端账号下，换设备登录同一个账号即恢复，
 * 不再需要导出 / 导入备份文件。本机 localStorage 只做离线缓存。
 *
 * 做对加、做错扣，快加满分慢加少分；题目难度分最低 1000，显示在题旁。
 */
(function () {
    'use strict';

    if (window.ZBX_PROGRESS) { return; }

    var KEY = 'zbx.progress.v2';
    var OLD_KEY = 'zbx.progress.v1';
    var BASE = 1000;
    var STYLE_ID = 'zbx-progress-style';
    var NAME_RE = /^[一-龥A-Za-z0-9_-]{2,20}$/;

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

    /* 老版本（单档案）迁上来，归到当前账号名下，不丢分 */
    function migrateOld() {
        var raw = null;
        try { raw = JSON.parse(window.localStorage.getItem(OLD_KEY) || 'null'); } catch (e) { raw = null; }
        if (!raw || typeof raw !== 'object' || !raw.scores) { return; }
        var store = blankStore();
        var name = curUser || '旧进度';
        store.users[name] = normalizeProfile(raw);
        try {
            window.localStorage.setItem(KEY, JSON.stringify(store));
        } catch (e) { /* 忽略 */ }
    }

    /* ---------- 当前账号 ---------- */
    function account() { return window.ZBX_ACCOUNT || null; }

    function readUser() {
        var a = account();
        if (a && typeof a.user === 'function') { return a.user() || ''; }
        return '';
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

    /* 连珠英语的背词档案，和分数一起存进同一个云端进度对象 */
    var E = null;
    var cloudTimer = 0;
    var cloudBusy = false;
    var syncFail = false;   /* 连续重试仍失败：提示改成「稍后自动重试」 */
    var loadedFor = '';     /* 已经拉过云端档案的账号，避免重复请求 */

    function profile() {
        if (!curUser) { return null; }
        if (!D.users[curUser]) { D.users[curUser] = blankProfile(); }
        return D.users[curUser];
    }

    function writeLocal() {
        D.at = Date.now();
        try { window.localStorage.setItem(KEY, JSON.stringify(D)); return true; }
        catch (e) { return false; }
    }

    function save() {
        writeLocal();
        scheduleCloudSave();
    }

    /* ---------- 云端同步 ---------- */
    function envelope() {
        var p = normalizeStore(D);
        p.at = Date.now();
        return { app: 'zbx-progress-cloud', v: 3, at: p.at, progress: p, english: E || null };
    }

    function cloudRpc(name, params) {
        var a = account();
        if (!a || typeof a.rpc !== 'function') {
            return Promise.resolve(null);
        }
        /* 以「会话是否可用」判断，而不是只看 token 字符串：
           刷新页面时 token 可能比账号状态晚几毫秒就位。 */
        var ok = typeof a.canSync === 'function' ? a.canSync() : !!(a.token && a.token());
        if (!ok) { return Promise.resolve(null); }
        return a.rpc(name, params);
    }

    function canSync() {
        var a = account();
        if (!a) { return false; }
        return typeof a.canSync === 'function' ? a.canSync() : !!(a.token && a.token());
    }

    function scheduleCloudSave() {
        if (!curUser) { return; }
        window.clearTimeout(cloudTimer);
        flagSaved(true);
        cloudTimer = window.setTimeout(function () { saveCloud(false); }, 450);
    }

    /* 同步失败不会静悄悄丢掉：按 2s / 6s / 15s 再试，
       仍不行就把提示改成「稍后自动重试」，下次做题还会继续尝试。 */
    var saveRetry = 0;

    function retrySave() {
        if (saveRetry >= 3) { syncFail = true; render(); return; }
        saveRetry += 1;
        window.clearTimeout(cloudTimer);
        cloudTimer = window.setTimeout(function () {
            if (canSync()) { saveCloud(true); }
        }, [2000, 6000, 15000][saveRetry - 1]);
    }

    function saveCloud(force) {
        if (!curUser || !canSync()) {
            if (curUser) { retrySave(); }
            return Promise.resolve(false);
        }
        if (cloudBusy && !force) {
            window.clearTimeout(cloudTimer);
            cloudTimer = window.setTimeout(function () { saveCloud(false); }, 600);
            return Promise.resolve(false);
        }
        cloudBusy = true;
        return cloudRpc('zbx_progress_save', { p_data: envelope() })
            .then(function (res) {
                cloudBusy = false;
                if (res && res.ok) {
                    saveRetry = 0;
                    syncFail = false;
                    flagSaved(false);
                    return true;
                }
                retrySave();
                return false;
            })
            .catch(function () {
                cloudBusy = false;
                retrySave();
                return false;
            });
    }

    function loadCloud() {
        if (!curUser || !canSync()) { render(); return Promise.resolve(false); }
        loadedFor = curUser;
        var localEnglish = E && typeof E === 'object' ? E : null;
        /* 只有本机真的存过档，才谈得上「本地比云端新」；
           否则空白档案的 at（模块加载时间）会把云端的分数压掉。 */
        var localAt = 0;
        try {
            if (window.localStorage.getItem(KEY)) { localAt = Number(D.at) || 0; }
        } catch (e) { /* 隐私模式 */ }
        return cloudRpc('zbx_progress_load', {}).then(function (res) {
            if (!res || res.ok === false) { render(); return false; }
            /* 正常返回是 {ok,data:{v,at,progress,english}}；account.rpc 的 unwrap
               剥掉信封后，res 本身就是档案对象，两种形状都要认。 */
            var data = res.data && typeof res.data === 'object' && !res.progress ? res.data : res;
            var cloud = null;
            if (data && typeof data === 'object' && data.progress) {
                cloud = data;
            } else if (data && data.users) {
                /* 兼容最早的直接档案结构 */
                cloud = { progress: data, at: Number(data.at) || 0 };
            } else {
                /* 第一次登录：把本机缓存带上去，不丢旧分 */
                if (!D.users[curUser]) { D.users[curUser] = blankProfile(); }
                return saveCloud(true).then(function () { render(); return true; });
            }

            var cloudAt = Number(cloud.at || (cloud.progress && cloud.progress.at)) || 0;
            /* 本机比云端新（离线期间做过题）：以本机为准推上去，别把新分数冲掉 */
            if (localAt > cloudAt + 2000 && D.users[curUser]) {
                if (!E && cloud.english && typeof cloud.english === 'object') { E = cloud.english; }
                return saveCloud(true).then(function () { render(); return true; });
            }

            var cloudStore = normalizeStore(cloud.progress);
            /* 云端没有的本地其它账号（同一浏览器多人用）保留，不被覆盖掉 */
            Object.keys(D.users).forEach(function (name) {
                if (!cloudStore.users[name]) { cloudStore.users[name] = D.users[name]; }
            });
            D = cloudStore;
            E = cloud.english && typeof cloud.english === 'object' ? cloud.english : null;

            /* 云端若还没有连珠英语那段（老档案），别把本机已有背词记录清空 */
            if (!E && localEnglish) { E = localEnglish; }
            if (!D.users[curUser]) { D.users[curUser] = blankProfile(); }
            writeLocal();
            render();
            return true;
        }).catch(function () {
            loadedFor = '';
            render();
            return false;
        });
    }

    function englishData() {
        return E && typeof E === 'object' ? E : null;
    }

    function setEnglishData(d) {
        E = d && typeof d === 'object' ? d : null;
        save();
    }

    /* 兼容旧调用：不再支持「填名字就进」，统一走右上角登录 */
    function setUser(name) {
        var a = account();
        if (a && typeof a.openPanel === 'function') {
            a.openPanel('login');
            return false;
        }
        name = String(name || '').trim();
        if (!name) {
            curUser = '';
            save();
            render();
            return true;
        }
        if (!NAME_RE.test(name)) { return false; }
        if (name !== curUser) {
            curUser = name;
            if (!D.users[name]) { D.users[name] = blankProfile(); }
            save();
        }
        render();
        return true;
    }

    function userName() { return curUser; }
    function userNames() {
        var names = Object.keys(D.users);
        if (curUser && names.indexOf(curUser) < 0) { names.push(curUser); }
        return names.sort();
    }

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

    /* ---------- 难度分：同一类型也按局面实际难度给分 ----------
     * 只看档位会让同档题分都一样；这里把处数、子数、白子干扰、类型混合、
     * 取胜手数、生成尝试次数都算进去，题与题之间自然拉开。 */
    function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
    function round10(n) { return Math.round(n / 10) * 10; }

    function jzDifficulty(levelIdx, p) {
        p = p || {};
        var stones = Math.max(0, (Number(p.black) || 0) + (Number(p.white) || 0));
        var white = Math.max(0, Number(p.white) || 0);
        var need = Math.max(1, Number(p.need) || 1);
        var idx = clamp(Math.round(Number(levelIdx) || 0), 0, 2);
        var d = 1000 + idx * 130 + (need - 1) * 110;
        d += clamp((stones - 8) * 9, 0, 260);
        d += clamp(white * 7, 0, 180);
        var kinds = p.kinds;
        if (Array.isArray(kinds) && kinds.length > 1) { d += clamp((kinds.length - 1) * 35, 0, 105); }
        if (p.shape === 'sleep3') { d += 60; }
        else if (p.shape === 'open3') { d += 30; }
        else if (p.shape === 'four') { d += 15; }
        return clamp(round10(d), 1000, 2200);
    }

    function vcfDifficulty(depth, p) {
        p = p || {};
        var dep = clamp(Math.round(Number(depth) || 3), 1, 15);
        var moves = Math.max(0, Number(p.moves ? p.moves.length : p.stones) || 0);
        var att = clamp(Math.round(Number(p.attempts) || 0), 0, 40);
        var d = 1000 + (dep - 3) * 95;
        d += clamp((moves - 16) * 11, 0, 240);
        if (p.attacker === 1) { d += 60; }   /* 黑方进攻受禁手约束，更难 */
        d += clamp(att * 3, 0, 90);
        return clamp(round10(d), 1000, 2200);
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
        if (!curUser) { notify('先登录账号。', 'bad'); return; }
        if (!window.confirm('清空「' + curUser + '」的云端进度？四项分数都会回到 1000，英语背词记录也一起清空。')) { return; }
        D.users[curUser] = blankProfile();
        E = null;
        save();
        render();
        notify('进度已清空，云端会在片刻后更新。', 'ok');
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
            '.zbx-user.is-global{position:relative;flex-wrap:nowrap;gap:0}' +
            '.zbx-user.is-global .zu-login,.zbx-user.is-global .zu-face{border:1px solid rgba(176,141,87,.42);border-radius:999px;' +
            'background:rgba(176,141,87,.1);color:var(--gold-deep,#7a5c22);font-size:12.5px;font-weight:600;padding:5px 12px;display:flex;align-items:center;gap:6px;white-space:nowrap}' +
            '.zbx-user.is-global .zu-face i{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;font-style:normal;' +
            'background:var(--gold-deep,#7a5c22);color:#fff7e6;font-size:11px}' +
            '.zbx-user.is-global .zu-face em{font-style:normal;opacity:.6;font-size:10px}' +
            '.zbx-user.is-global .zu-edit{position:absolute;right:0;top:calc(100% + 8px);z-index:80;display:flex;gap:6px;' +
            'align-items:center;background:#fffdf7;border:1px solid var(--zp-line);border-radius:10px;padding:8px;' +
            'box-shadow:0 12px 28px rgba(60,44,18,.18)}' +
            '.zbx-user.is-global .zu-edit[hidden]{display:none}' +
            '.zbx-user.is-global .zu-edit input{width:130px}' +
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
        Array.prototype.forEach.call(document.querySelectorAll('[data-zbx-progress]'), function (box) {
            if (box.dataset.bound === '1') { return; }
            box.dataset.bound = '1';
            box.addEventListener('click', function (ev) {
                var b = ev.target.closest('button');
                if (!b) { return; }
                var act = b.getAttribute('data-act');
                if (act === 'reset') { reset(); }
                else if (act === 'login') {
                    var a = account();
                    if (a && a.openPanel) { a.openPanel('login'); }
                }
            });
        });
    }

    function userChipHtml(compact) {
        if (compact) {
            if (!curUser) {
                return '<button type="button" class="zu-login" data-act="toggleuser">＋ 用户名</button>' +
                    '<span class="zu-edit" hidden>' +
                    '<input type="text" maxlength="16" data-act="username" placeholder="填名字" value="">' +
                    '<button type="button" data-act="setuser">进入</button></span>';
            }
            var initial = curUser.charAt(0);
            return '<button type="button" class="zu-face" data-act="toggleuser" title="点击切换用户名">' +
                '<i>' + escHtml(initial) + '</i>' + escHtml(curUser) + '<em>▾</em></button>' +
                '<span class="zu-edit" hidden>' +
                '<input type="text" maxlength="16" data-act="username" placeholder="填名字" value="' + escHtml(curUser) + '">' +
                '<button type="button" data-act="setuser">切换</button></span>';
        }
        return '<span>用户名</span>' +
            '<input type="text" maxlength="16" data-act="username" placeholder="填名字" value="' + escHtml(curUser) + '">' +
            '<button type="button" data-act="setuser">' + (curUser ? '切换' : '进入') + '</button>' +
            (curUser ? '<b>' + escHtml(curUser) + '</b>' : '<span>未登录，分数不会记</span>');
    }

    function render() {
        injectStyle();
        Array.prototype.forEach.call(document.querySelectorAll('[data-zbx-progress]'), function (box) {
            var P = profile();
            var cells = MODULES.map(function (m) {
                var sc = P ? P.scores[m.k] : BASE;
                var st = P ? P.stats[m.k] : blankStats();
                return '<div class="zbx-prog-cell"><b>' + sc + '</b><span>' + m.name + '</span>' +
                    '<i>做 ' + st.n + ' · 平均 ' + fmtMs(avgMs(m.k)) + '</i></div>';
            }).join('');
            box.className = 'zbx-prog' + (dirty ? ' is-dirty' : '');
            box.innerHTML = '<h3>我的进度 <small>四项分数各自独立 · 初始 1000 分 · 云端同步</small></h3>' +
                '<div class="zbx-prog-user">' +
                '<span class="zbx-prog-names">当前账号：<b>' + (curUser ? escHtml(curUser) : '未登录') + '</b></span>' +
                (curUser
                    ? '<span style="font-size:12px;color:var(--zp-sub)">进度自动保存在云端</span>'
                    : '<button type="button" data-act="login">登录 / 注册</button>') +
                '</div>' +
                (curUser ? '<div class="zbx-prog-grid">' + cells + '</div>' :
                    '<p class="zbx-prog-tip">登录后就能开始记分，分数会按账号同步到云端。</p>') +
                '<div class="zbx-prog-btns">' +
                (curUser ? '<button type="button" data-act="reset">清空进度</button>' : '') +
                '</div>' +
                '<p class="zbx-prog-tip zbx-prog-hint">' +
                (dirty ? (syncFail ? '云端暂时连不上，稍后会自动重试；本机记录已经保存。' : '正在同步到云端…') :
                    (curUser ? '已同步到云端，换设备登录同一个账号就能接着做题。' :
                        '不再需要导出 / 导入备份文件。')) +
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
            var boxes = document.querySelectorAll('[data-zbx-progress]');
            if (!boxes.length) { return; }
            var empty = false;
            Array.prototype.forEach.call(boxes, function (b) { if (!b.innerHTML.trim()) { empty = true; } });
            if (empty) { render(); }
        }).observe(document.body, { childList: true, subtree: true });
    }

    /* 账号就绪后从云端取档案；登录 / 退出切换时重新取对应账号的数据 */
    document.addEventListener('zbx:account', function (e) {
        var detail = e && e.detail ? e.detail : {};
        var name = detail.user || '';
        if (name === curUser) {
            /* restore / 续期后重复触发：只补一次没做完的云端读取 */
            if (curUser && loadedFor !== curUser) { loadCloud(); }
            return;
        }
        curUser = name;
        D = loadStore();
        E = null;
        loadedFor = '';
        syncFail = false;
        if (curUser) {
            if (!D.users[curUser]) { D.users[curUser] = blankProfile(); }
            loadCloud();
        } else {
            render();
        }
    });

    /* account.js 由 layout.js 异步注入，可能比本文件晚到：
       先等 ZBX_ACCOUNT_READY，等不到就轮询一会儿，别直接当成未登录。 */
    function start() {
        render();
        watch();

        function adopt(info) {
            var name = (info && info.user) ||
                (window.ZBX_ACCOUNT && window.ZBX_ACCOUNT.user ? window.ZBX_ACCOUNT.user() : '');
            if (!name) { render(); return; }
            if (name === curUser && loadedFor === name) { return; }
            curUser = name;
            if (!D.users[curUser]) { D.users[curUser] = blankProfile(); }
            loadCloud();
        }

        function waitAccount(tries) {
            if (window.ZBX_ACCOUNT_READY) {
                window.ZBX_ACCOUNT_READY.then(adopt);
                return;
            }
            if (tries > 75) { render(); return; }   /* 15 秒还没到就按未登录显示 */
            window.setTimeout(function () { waitAccount(tries + 1); }, 200);
        }

        waitAccount(0);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
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
        englishData: englishData,
        setEnglishData: setEnglishData,
        loadCloud: loadCloud,
        saveCloud: saveCloud,
        render: render,
        snapshot: snapshot,
        base: BASE,
        jzDifficulty: jzDifficulty,
        vcfDifficulty: vcfDifficulty,
        diffForDepth: function (depth) { return vcfDifficulty(depth, null); },
        parForDepth: function (depth) { return (2 + Math.max(1, depth) * 2) * 1000; }
    };
})();
