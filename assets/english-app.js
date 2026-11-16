/* 杂技 · 连珠英语：四级词汇与连珠术语的记忆卡。
 * ---------------------------------------------------------------------------
 * 数据：assets/words-cet4.js、assets/words-renju.js（tools/build_english_words.py 生成）
 * 账号：只存在本机浏览器。用户名明文，密码用 PBKDF2-SHA256 加盐取哈希后保存，
 *       不存明文；换设备靠「导出/导入」把进度带走。
 * 换页：全站是无刷新换页，这个脚本只会被注入一次，所以状态挂在 window.ZBX_EN 上，
 *       每次进入页面用 boot() 重建 DOM，监听器只绑一次（document 级委托）。
 */
(function () {
    'use strict';

    if (window.ZBX_EN) {
        window.ZBX_EN.boot();
        return;
    }

    /* ---------- 常量与存取 ---------- */

    var K_USERS = 'zbxEn.users';
    var K_SESSION = 'zbxEn.session';
    var K_PROG = 'zbxEn.p.';
    var K_SYNC = 'zbxEn.sync';
    /* 同步专用固定盐（base64 of "zbx-sync-v1"）。登录密码经它派生出的 key
       在同一账号的任意设备上都相同， unlike 每设备随机盐的登录 hash。 */
    var SYNC_SALT = 'enZiLXN5bmMtdjE=';

    var STEPS = [0, 1, 2, 4, 8, 16, 32, 60];   // 第 n 盒的复习间隔（天）
    var MASTER = 5;                            // 第 5 盒以上算「掌握」
    var SPELL_ROUND = 30;

    var state = {
        user: null,
        data: null,
        mode: 'study',
        queue: [], idx: 0, flipped: false,
        sess: { n: 0, ok: 0, bad: 0 },
        tab: 'login',
        note: '',
        spell: null,
        listFilter: 'all',
        listQuery: '',
        listShown: 60,
        read: { id: null, idx: 0, picked: -1, answers: [] },
        gateSync: false,
        sync: { busy: false, msg: '', at: null }
    };

    function $(sel, root) { return (root || document).querySelector(sel); }
    function el(id) { return document.getElementById(id); }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function storeGet(k) {
        try { return window.localStorage.getItem(k); } catch (err) { return null; }
    }
    function storeSet(k, v) {
        try { window.localStorage.setItem(k, v); return true; } catch (err) { return false; }
    }
    function storeDel(k) {
        try { window.localStorage.removeItem(k); } catch (err) { /* 忽略 */ }
    }
    function hasStore() {
        try {
            window.localStorage.setItem('zbxEn.probe', '1');
            window.localStorage.removeItem('zbxEn.probe');
            return true;
        } catch (err) { return false; }
    }

    /* ---------- 日期 ---------- */

    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    function dstr(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
    function today() { return dstr(new Date()); }
    function shift(n) { var d = new Date(); d.setDate(d.getDate() + n); return dstr(d); }

    /* ---------- 词库 ---------- */

    var WORDS = null;      // [{k,w,ph,tr,tag,bk,ex}]
    var BYKEY = null;      // k -> 词条

    function buildWords() {
        if (WORDS) { return; }
        var list = [];
        var cet = window.ZBX_WORDS_CET4;
        var rj = window.ZBX_WORDS_RENJU;
        if (cet && cet.words) {
            cet.words.forEach(function (r) {
                list.push({ k: 'c:' + r[0], w: r[0], ph: r[1], tr: r[2], tag: '四级', bk: 'cet4', ex: '' });
            });
        }
        if (rj && rj.words) {
            rj.words.forEach(function (r) {
                list.push({ k: 'r:' + r[0], w: r[0], ph: r[1], tr: r[2], tag: r[3] || '术语', bk: 'renju', ex: r[4] || '' });
            });
        }
        WORDS = list;
        BYKEY = {};
        list.forEach(function (w) { BYKEY[w.k] = w; });
    }

    function bookWords(bk) {
        buildWords();
        if (bk === 'all' || !bk) { return WORDS; }
        return WORDS.filter(function (w) { return w.bk === bk; });
    }

    function wordCounts() {
        buildWords();
        var c = { all: WORDS.length, cet4: 0, renju: 0 };
        WORDS.forEach(function (w) { c[w.bk] += 1; });
        return c;
    }

    /* ---------- 进度模型 ---------- */

    function blankData() {
        return { v: 2, book: 'all', dir: 'en2cn', goal: 20, speech: 1,
            cards: {}, days: {}, reading: {},
            rev: 0, updatedMs: 0, created: today(), updated: today() };
    }

    function loadData(name) {
        var raw = storeGet(K_PROG + name);
        if (!raw) { return blankData(); }
        var d = null;
        try { d = JSON.parse(raw); } catch (err) { d = null; }
        if (!d || typeof d !== 'object') { return blankData(); }
        var base = blankData();
        ['book', 'dir', 'goal', 'speech'].forEach(function (k) {
            if (d[k] == null) { d[k] = base[k]; }
        });
        if (!d.cards || typeof d.cards !== 'object') { d.cards = {}; }
        if (!d.days || typeof d.days !== 'object') { d.days = {}; }
        if (!d.reading || typeof d.reading !== 'object') { d.reading = {}; }
        if (!d.rev) { d.rev = 0; }
        if (!d.updatedMs) { d.updatedMs = 0; }
        d.v = 2;
        return d;
    }

    var saveTimer = null;
    var quotaWarned = false;
    function writeData(payload) {
        if (storeSet(K_PROG + state.user, payload)) {
            scheduleSync();
            return;
        }
        if (quotaWarned) { return; }
        quotaWarned = true;
        alert('本机存储写不进去了，进度可能没有保存。\n先用「导出进度」备份一下，再清掉别的站点数据。');
    }
    function saveData(now) {
        if (!state.user || !state.data) { return; }
        state.data.updated = today();
        state.data.rev = (state.data.rev || 0) + 1;
        state.data.updatedMs = Date.now();
        var payload = JSON.stringify(state.data);
        if (now) {
            writeData(payload);
            return;
        }
        clearTimeout(saveTimer);
        saveTimer = setTimeout(function () { writeData(payload); }, 250);
    }

    function day() {
        var t = today();
        var d = state.data.days[t];
        if (!d) { d = state.data.days[t] = { n: 0, r: 0, ok: 0, bad: 0 }; }
        return d;
    }

    function dueKeys() {
        var t = today();
        var cards = state.data.cards;
        var out = [];
        Object.keys(cards).forEach(function (k) {
            var c = cards[k];
            var w = BYKEY[k];
            if (!w) { return; }
            if (state.data.book !== 'all' && w.bk !== state.data.book) { return; }
            if (c.due && c.due > t) { return; }
            out.push({ k: k, c: c });
        });
        out.sort(function (a, b) {
            return (a.c.due || '').localeCompare(b.c.due || '') || (a.c.b - b.c.b);
        });
        return out.map(function (x) { return x.k; });
    }

    function masteredCount() {
        var n = 0;
        Object.keys(state.data.cards).forEach(function (k) {
            if (state.data.cards[k].b >= MASTER) { n += 1; }
        });
        return n;
    }

    function streak() {
        var days = state.data.days;
        var n = 0;
        var i = 0;
        if (!days[today()]) { i = 1; }
        for (; i < 400; i += 1) {
            var d = days[shift(-i)];
            if (d && (d.n + d.r) > 0) { n += 1; } else { break; }
        }
        return n;
    }

    /* 每天的新词顺序换个样：用「用户名 + 日期」做种子的线性同余洗牌，稳定又不乱跳 */
    function seededOrder(list, seedText) {
        var seed = 2166136261;
        for (var i = 0; i < seedText.length; i += 1) {
            seed ^= seedText.charCodeAt(i);
            seed = (seed * 16777619) >>> 0;
        }
        var arr = list.slice();
        for (var j = arr.length - 1; j > 0; j -= 1) {
            seed = (seed * 1103515245 + 12345) >>> 0;
            var r = seed % (j + 1);
            var tmp = arr[j]; arr[j] = arr[r]; arr[r] = tmp;
        }
        return arr;
    }

    function newKeys(limit) {
        if (limit <= 0) { return []; }
        var pool = bookWords(state.data.book).filter(function (w) {
            return !state.data.cards[w.k];
        });
        pool = seededOrder(pool, (state.user || '') + today());
        return pool.slice(0, limit).map(function (w) { return w.k; });
    }

    function buildQueue(kind) {
        var due = dueKeys();
        if (kind === 'review') { return due; }
        var left = Math.max(0, state.data.goal - day().n);
        return due.concat(newKeys(left));
    }

    /* ---------- 账号 ---------- */

    function users() {
        var raw = storeGet(K_USERS);
        if (!raw) { return {}; }
        try { return JSON.parse(raw) || {}; } catch (err) { return {}; }
    }

    function saveUsers(u) { storeSet(K_USERS, JSON.stringify(u)); }

    function b64(buf) {
        var bytes = new Uint8Array(buf);
        var s = '';
        for (var i = 0; i < bytes.length; i += 1) { s += String.fromCharCode(bytes[i]); }
        return window.btoa(s);
    }

    function unb64(s) {
        var raw = window.atob(s);
        var out = new Uint8Array(raw.length);
        for (var i = 0; i < raw.length; i += 1) { out[i] = raw.charCodeAt(i); }
        return out;
    }

    /* PBKDF2-SHA256；老浏览器没有 crypto.subtle 时退化成慢速哈希，并在账号上标弱 */
    function hashPw(pw, saltB64) {
        var subtle = window.crypto && window.crypto.subtle;
        if (subtle) {
            var enc = new TextEncoder();
            return subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits'])
                .then(function (key) {
                    return subtle.deriveBits({
                        name: 'PBKDF2',
                        salt: unb64(saltB64),
                        iterations: 120000,
                        hash: 'SHA-256'
                    }, key, 256);
                })
                .then(function (bits) { return b64(bits); })
                .catch(function () { return weakHash(pw, saltB64); });
        }
        return Promise.resolve(weakHash(pw, saltB64));
    }

    function weakHash(pw, saltB64) {
        var s = saltB64 + '|' + pw;
        var h1 = 2166136261;
        var h2 = 5381;
        for (var i = 0; i < s.length; i += 1) {
            h1 ^= s.charCodeAt(i); h1 = (h1 * 16777619) >>> 0;
            h2 = (((h2 << 5) + h2) + s.charCodeAt(i)) >>> 0;
        }
        return 'w' + h1.toString(36) + h2.toString(36);
    }

    function newSalt() {
        var buf = new Uint8Array(16);
        if (window.crypto && window.crypto.getRandomValues) {
            window.crypto.getRandomValues(buf);
        } else {
            for (var i = 0; i < 16; i += 1) { buf[i] = Math.floor(Math.random() * 256); }
        }
        return b64(buf);
    }

    function validName(n) { return /^[\u4e00-\u9fa5A-Za-z0-9_]{2,16}$/.test(n); }

    function doRegister(name, pw) {
        if (!validName(name)) { return Promise.reject('用户名 2–16 位，可用中文、字母、数字、下划线'); }
        if (!pw || pw.length < 6) { return Promise.reject('密码至少 6 位'); }
        var u = users();
        if (u[name]) { return Promise.reject('这个用户名已经被注册了（就在这台设备上）'); }
        var salt = newSalt();
        return hashPw(pw, salt).then(function (h) {
            return hashPw(pw, SYNC_SALT).then(function (sk) {
                u[name] = { salt: salt, hash: h, sk: sk, weak: h.charAt(0) === 'w' ? 1 : 0, at: today() };
                saveUsers(u);
                storeSet(K_SESSION, name);
                state.user = name;
                state.data = loadData(name);
                state.mode = 'study';
                state.queue = buildQueue('study');
                state.idx = 0;
                state.flipped = false;
                state.sess = { n: 0, ok: 0, bad: 0 };
                saveData(true);
                render();
                syncNow('auto');
            });
        });
    }

    function doLogin(name, pw) {
        var u = users();
        var rec = u[name];
        /* 新设备：本机没有这个账号，但云端有——用同一套账号钥匙把进度拉回来 */
        if (!rec) {
            var cfg = syncCfg();
            if (!cfg.provider) {
                return Promise.reject(new Error('这台设备还没有这个账号；新设备请先在侧栏配好同步方式，再登录同一账号'));
            }
            var freshSalt = newSalt();
            return hashPw(pw, freshSalt).then(function (h) {
                return hashPw(pw, SYNC_SALT).then(function (sk) {
                    return syncKeyFor(name, sk).then(function (key) {
                        return remoteGet(cfg, key).then(function (remote) {
                            if (!remote || remote.user !== name || !remote.data) {
                                throw new Error('云端没有这个账号的进度，请先在一台设备上注册并同步');
                            }
                            u[name] = { salt: freshSalt, hash: h, sk: sk, weak: h.charAt(0) === 'w' ? 1 : 0, at: today() };
                            saveUsers(u);
                            storeSet(K_SESSION, name);
                            state.user = name;
                            state.data = mergeData(blankData(), remote.data);
                            saveData(true);
                            state.mode = 'study';
                            state.queue = buildQueue('study');
                            state.idx = 0;
                            state.flipped = false;
                            state.sess = { n: 0, ok: 0, bad: 0 };
                            state.note = '';
                            render();
                            syncStatus('已从云端建好本机账号');
                            return true;
                        });
                    });
                });
            });
        }
        return hashPw(pw, rec.salt).then(function (h) {
            if (h !== rec.hash) { throw new Error('bad'); }
            return Promise.resolve(rec.sk || hashPw(pw, SYNC_SALT)).then(function (sk) {
                rec.sk = sk;
                saveUsers(u);
                storeSet(K_SESSION, name);
                enter(name);
            });
        }).catch(function () { throw new Error('密码不对'); });
    }

    function enter(name) {
        state.user = name;
        state.data = loadData(name);
        state.mode = 'study';
        state.spell = null;
        state.listFilter = 'all';
        state.listQuery = '';
        state.listShown = 60;
        state.queue = buildQueue('study');
        state.idx = 0;
        state.flipped = false;
        state.sess = { n: 0, ok: 0, bad: 0 };
        state.note = '';
        state.read = { id: null, idx: 0, picked: -1, answers: [] };
        render();
        syncNow('auto');
    }

    function logout() {
        saveData(true);
        storeDel(K_SESSION);
        state.user = null;
        state.data = null;
        state.queue = [];
        state.spell = null;
        state.tab = 'login';
        state.note = '';
        render();
    }

    /* ---------- 判分与推进 ---------- */

    function cardOf(k) {
        var c = state.data.cards[k];
        if (!c) {
            c = state.data.cards[k] = { b: 0, due: today(), n: 0, ok: 0, bad: 0, f: today(), t: today() };
        }
        return c;
    }

    function grade(g) {
        if (!state.queue.length || state.idx >= state.queue.length) { return; }
        var item = state.queue[state.idx];
        var k = item.key || item;
        var c = cardOf(k);
        var fresh = c.n === 0;
        c.n += 1;
        c.t = today();
        var d = day();
        if (fresh) {
            c.f = today();
            d.n += 1;
        } else {
            d.r += 1;
        }
        if (g === 'good') {
            c.ok += 1;
            c.b = Math.min(STEPS.length - 1, c.b + 1);
            c.due = shift(STEPS[c.b]);
            state.sess.ok += 1;
            d.ok += 1;
        } else if (g === 'hard') {
            c.ok += 1;
            c.b = Math.max(1, c.b);
            c.due = shift(Math.max(1, Math.floor(STEPS[c.b] / 2)));
            state.sess.ok += 1;
            d.ok += 1;
        } else {
            c.bad += 1;
            c.b = 0;
            c.due = today();
            state.sess.bad += 1;
            d.bad += 1;
            /* 不认识的词三步之后再问一次，别让它立刻原地重来 */
            var again = { key: k, again: true };
            var at = Math.min(state.queue.length, state.idx + 4);
            state.queue.splice(at, 0, again);
        }
        state.sess.n += 1;
        saveData();
        state.idx += 1;
        state.flipped = false;
        renderStage();
        renderNums();
    }

    /* ---------- 渲染 ---------- */

    function render() {
        var gate = el('en-gate');
        var body = el('en-body');
        if (!gate || !body) { return; }
        if (!state.user) {
            body.hidden = true;
            gate.hidden = false;
            renderGate();
        } else {
            gate.hidden = true;
            body.hidden = false;
            renderSide();
            renderStage();
        }
    }

    function gateSyncHtml() {
        var c = syncCfg();
        return ''
            + '<div class="en-gate-sync">'
            + '  <button type="button" class="en-link" data-act="gate-sync">'
            + (state.gateSync ? '收起同步设置' : '换设备了？先填同步设置，再登录同一账号') + '</button>'
            + '  <div id="en-gate-sync-box"' + (state.gateSync ? '' : ' hidden') + '>'
            + '    <p class="en-sync-status" id="en-g-sync-status">' + esc(state.sync.msg || '') + '</p>'
            + '    <label class="en-sync-field"><span>同步方式</span><select id="en-g-sync-provider">'
            + [['', '只存本机'], ['gist', 'GitHub Gist'], ['rest', '自定义接口']].map(function (o) {
                return '<option value="' + o[0] + '"' + (c.provider === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
            }).join('') + '</select></label>'
            + '    <label class="en-sync-field"><span>Gist ID</span><input id="en-g-gist-id" type="text" spellcheck="false" placeholder="Gist 地址末尾那串" value="' + esc(c.gistId) + '"></label>'
            + '    <label class="en-sync-field"><span>令牌</span><input id="en-g-token" type="password" spellcheck="false" placeholder="只需 gist 权限" value="' + esc(c.token) + '"></label>'
            + '    <label class="en-sync-field"><span>接口地址</span><input id="en-g-sync-url" type="text" spellcheck="false" placeholder="https://…" value="' + esc(c.url) + '"></label>'
            + '    <label class="en-row en-row-sw"><span>自动同步</span><input id="en-g-sync-auto" type="checkbox"' + (c.auto ? ' checked' : '') + '></label>'
            + '    <div class="en-tools"><button type="button" class="en-btn en-btn-ghost" data-act="sync-save">保存同步设置</button></div>'
            + '  </div>'
            + '</div>';
    }

    function renderGate() {
        var gate = el('en-gate');
        if (!gate) { return; }
        var loginTab = state.tab !== 'register';
        var u = users();
        var names = Object.keys(u);
        gate.innerHTML = ''
            + '<div class="en-gate-in">'
            + '  <div class="en-gate-head">'
            + '    <p class="en-kicker">RENJU ENGLISH</p>'
            + '    <h2 class="en-gate-title">先登个记，再背词</h2>'
            + '    <p class="en-gate-sub">进度跟着账号走。账号只存在这台设备的浏览器里，密码经加盐哈希后保存，不存明文；换设备用「导出 / 导入」带走。</p>'
            + '  </div>'
            + '  <div class="en-tabs" role="tablist">'
            + '    <button type="button" class="en-tab' + (loginTab ? ' is-on' : '') + '" data-act="tab" data-tab="login">登录</button>'
            + '    <button type="button" class="en-tab' + (loginTab ? '' : ' is-on') + '" data-act="tab" data-tab="register">注册</button>'
            + '  </div>'
            + '  <form class="en-form" id="en-form" autocomplete="on">'
            + '    <label class="en-field"><span>用户名</span>'
            + '      <input id="en-name" name="username" type="text" inputmode="text" autocomplete="username" maxlength="16" placeholder="2–16 位，中文或字母" value="' + esc(names.length === 1 ? names[0] : '') + '"></label>'
            + '    <label class="en-field"><span>密码</span>'
            + '      <input id="en-pw" name="password" type="password" autocomplete="' + (loginTab ? 'current-password' : 'new-password') + '" placeholder="' + (loginTab ? '输入密码' : '至少 6 位') + '"></label>'
            + (loginTab ? '' : '    <label class="en-field"><span>再输一次</span><input id="en-pw2" type="password" autocomplete="new-password" placeholder="确认密码"></label>')
            + '    <p class="en-err" id="en-err" role="alert">' + esc(state.note || '') + '</p>'
            + '    <button type="submit" class="en-btn en-btn-main" data-act="' + (loginTab ? 'login' : 'register') + '">'
            + (loginTab ? '登录，接着上次背' : '注册并开始') + '</button>'
            + '  </form>'
            + '  <p class="en-gate-foot">词库：大学英语四级 ' + wordCounts().cet4 + ' 词 ＋ 连珠术语 ' + wordCounts().renju + ' 条；另有 ' + articles().length + ' 篇五子棋英语阅读。'
            + (names.length ? '本机已有账号：' + names.map(function (n) { return esc(n); }).join('、') : '还没有账号，注册一个就行。')
            + '</p>'
            + gateSyncHtml()
            + '</div>';
        var nm = el('en-name');
        if (nm) { try { nm.focus(); } catch (err) { /* 忽略 */ } }
    }

    function renderSide() {
        var side = el('en-side');
        if (!side) { return; }
        var d = state.data;
        var counts = wordCounts();
        var due = dueKeys().length;
        var modes = [
            ['study', '今日学习', '到期复习 + 新词'],
            ['review', '只复习', '把到期的再过一遍'],
            ['spell', '拼写', '看释义写单词'],
            ['reading', '阅读', '五子棋短文与四道题'],
            ['list', '词表', '检索与浏览']
        ];
        side.innerHTML = ''
            + '<div class="en-user">'
            + '  <span class="en-avatar">' + esc((state.user || '?').charAt(0)) + '</span>'
            + '  <span class="en-user-name">' + esc(state.user) + '</span>'
            + '  <button type="button" class="en-link" data-act="logout">退出</button>'
            + '</div>'
            + '<div class="en-nums" id="en-nums">' + numsHtml(due) + '</div>'
            + '<nav class="en-modes">'
            + modes.map(function (m) {
                return '<button type="button" class="en-mode' + (state.mode === m[0] ? ' is-on' : '') + '" data-act="mode" data-mode="' + m[0] + '">'
                    + '<b>' + m[1] + '</b><span>' + m[2] + '</span></button>';
            }).join('')
            + '</nav>'
            + '<div class="en-set">'
            + '  <p class="en-set-title">设置</p>'
            + '  <label class="en-row"><span>每日新词</span><select data-act="set" data-key="goal">'
            + [10, 20, 30, 50].map(function (n) {
                return '<option value="' + n + '"' + (d.goal === n ? ' selected' : '') + '>' + n + ' 个</option>';
            }).join('') + '</select></label>'
            + '  <label class="en-row"><span>词库</span><select data-act="set" data-key="book">'
            + [['all', '全部 ' + counts.all], ['cet4', '四级 ' + counts.cet4], ['renju', '连珠术语 ' + counts.renju]].map(function (o) {
                return '<option value="' + o[0] + '"' + (d.book === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
            }).join('') + '</select></label>'
            + '  <label class="en-row"><span>出题方向</span><select data-act="set" data-key="dir">'
            + [['en2cn', '英 → 中'], ['cn2en', '中 → 英'], ['mix', '随机混合']].map(function (o) {
                return '<option value="' + o[0] + '"' + (d.dir === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
            }).join('') + '</select></label>'
            + '  <label class="en-row en-row-sw"><span>发音</span><input type="checkbox" data-act="set" data-key="speech"' + (d.speech ? ' checked' : '') + '></label>'
            + '  <div class="en-tools">'
            + '    <button type="button" class="en-btn en-btn-ghost" data-act="export">导出进度</button>'
            + '    <button type="button" class="en-btn en-btn-ghost" data-act="import">导入</button>'
            + '    <input type="file" id="en-file" accept="application/json,.json" hidden>'
            + '    <button type="button" class="en-btn en-btn-ghost en-btn-warn" data-act="reset">清空</button>'
            + '  </div>'
            + '</div>'
            + syncPanelHtml();
    }

    function syncPanelHtml() {
        var c = syncCfg();
        return ''
            + '<div class="en-set en-sync-box">'
            + '  <p class="en-set-title">多端同步</p>'
            + '  <p class="en-sync-status' + (state.sync.msg && /失败|没填|不对|没开|先登录/.test(state.sync.msg) ? ' is-bad' : '') + '" id="en-sync-status">'
            + esc(state.sync.msg || '只存本机，未开启同步') + '</p>'
            + '  <label class="en-row"><span>同步方式</span><select id="en-sync-provider">'
            + [['', '只存本机'], ['gist', 'GitHub Gist'], ['rest', '自定义接口']].map(function (o) {
                return '<option value="' + o[0] + '"' + (c.provider === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
            }).join('') + '</select></label>'
            + '  <label class="en-sync-field"><span>Gist ID</span><input id="en-gist-id" type="text" spellcheck="false" placeholder="Gist 地址末尾那串" value="' + esc(c.gistId) + '"></label>'
            + '  <label class="en-sync-field"><span>令牌</span><input id="en-token" type="password" spellcheck="false" placeholder="只需 gist 权限" value="' + esc(c.token) + '"></label>'
            + '  <label class="en-sync-field"><span>接口地址</span><input id="en-sync-url" type="text" spellcheck="false" placeholder="https://…" value="' + esc(c.url) + '"></label>'
            + '  <label class="en-row en-row-sw"><span>自动同步</span><input id="en-sync-auto" type="checkbox"' + (c.auto ? ' checked' : '') + '></label>'
            + '  <div class="en-tools">'
            + '    <button type="button" class="en-btn en-btn-ghost" data-act="sync-save">保存设置</button>'
            + '    <button type="button" class="en-btn en-btn-ghost" data-act="sync-now">立即同步</button>'
            + '  </div>'
            + '  <textarea id="en-code" class="en-code" spellcheck="false" placeholder="同步码：一台设备点「生成」，另一台粘进来点「合并」"></textarea>'
            + '  <div class="en-tools">'
            + '    <button type="button" class="en-btn en-btn-ghost" data-act="sync-code-make">生成同步码</button>'
            + '    <button type="button" class="en-btn en-btn-ghost" data-act="sync-code-use">用同步码合并</button>'
            + '  </div>'
            + '</div>';
    }

    function numsHtml(due) {
        var d = day();
        var ms = masteredCount();
        var total = bookWords(state.data.book).length;
        return ''
            + '<div class="en-num"><b>' + (due == null ? dueKeys().length : due) + '</b><span>待复习</span></div>'
            + '<div class="en-num"><b>' + d.n + '</b><span>今日新词</span></div>'
            + '<div class="en-num"><b>' + ms + '</b><span>已掌握</span></div>'
            + '<div class="en-num"><b>' + streak() + '</b><span>连续天数</span></div>'
            + '<div class="en-prog"><i style="width:' + Math.min(100, ms / Math.max(1, total) * 100).toFixed(1) + '%"></i></div>'
            + '<p class="en-prog-text">词库 ' + total + ' 词，掌握 ' + ms
            + ' · 阅读 ' + Object.keys(state.data.reading || {}).length + '/' + articles().length + ' 篇</p>';
    }

    function renderNums() {
        var box = el('en-nums');
        if (box) { box.innerHTML = numsHtml(); }
    }

    function dirOf(k) {
        var dir = state.data.dir;
        if (dir === 'en2cn') { return 'en2cn'; }
        if (dir === 'cn2en') { return 'cn2en'; }
        var h = 0;
        for (var i = 0; i < k.length; i += 1) { h = (h * 31 + k.charCodeAt(i)) >>> 0; }
        return h % 2 ? 'cn2en' : 'en2cn';
    }

    function speak(text) {
        if (!state.data.speech || !window.speechSynthesis) { return; }
        try {
            window.speechSynthesis.cancel();
            var u = new SpeechSynthesisUtterance(text);
            u.lang = 'en-US';
            u.rate = 0.95;
            window.speechSynthesis.speak(u);
        } catch (err) { /* 忽略 */ }
    }

    function renderStage() {
        var main = el('en-main');
        if (!main) { return; }
        if (state.mode === 'list') { renderList(main); return; }
        if (state.mode === 'spell') { renderSpell(main); return; }
        if (state.mode === 'reading') { renderReading(main); return; }
        renderCards(main);
    }

    function renderCards(main) {
        var q = state.queue;
        if (!q.length) {
            main.innerHTML = emptySession('还没有到期要复习的词', '去「今日学习」拿一批新词，或者换个词库。');
            return;
        }
        if (state.idx >= q.length) {
            var acc = state.sess.n ? Math.round(state.sess.ok / state.sess.n * 100) : 0;
            main.innerHTML = ''
                + '<div class="en-done">'
                + '  <p class="en-kicker">' + (state.mode === 'review' ? '复习完成' : '这一轮走完了') + '</p>'
                + '  <h2 class="en-done-num">' + state.sess.n + ' <small>词</small></h2>'
                + '  <p class="en-done-line">答对 ' + state.sess.ok + '，没记住 ' + state.sess.bad + '，正确率 ' + acc + '%</p>'
                + '  <div class="en-done-btns">'
                + '    <button type="button" class="en-btn en-btn-main" data-act="mode" data-mode="study">再来一轮</button>'
                + '    <button type="button" class="en-btn en-btn-ghost" data-act="mode" data-mode="review">只复习</button>'
                + '  </div>'
                + '</div>';
            return;
        }
        var item = q[state.idx];
        var k = item.key || item;
        var w = BYKEY[k];
        if (!w) { state.idx += 1; renderCards(main); return; }
        var c = state.data.cards[k];
        var dir = dirOf(k);
        var total = q.length;
        var pct = Math.round(state.idx / total * 100);
        var front, back;
        if (dir === 'en2cn') {
            front = '<p class="en-word">' + esc(w.w) + '</p>'
                + (w.ph ? '<p class="en-ph">/' + esc(w.ph) + '/</p>' : '');
            back = '<p class="en-tr">' + esc(w.tr) + '</p>';
        } else {
            front = '<p class="en-ask">' + esc(w.tr) + '</p>';
            back = '<p class="en-word en-word-sm">' + esc(w.w) + '</p>'
                + (w.ph ? '<p class="en-ph">/' + esc(w.ph) + '/</p>' : '');
        }
        var extra = (state.flipped && w.ex) ? '<p class="en-ex">' + esc(w.ex) + '</p>' : '';
        var badge = (!c || c.n === 0) ? '新词' : ('第 ' + (c.b + 1) + ' 盒');
        main.innerHTML = ''
            + '<div class="en-bar"><i style="width:' + pct + '%"></i></div>'
            + '<p class="en-count">' + (state.idx + 1) + ' / ' + total
            + (item.again ? ' · 回头再看' : '') + '</p>'
            + '<div class="en-card' + (state.flipped ? ' is-back' : '') + '" data-act="flip" role="button" tabindex="0">'
            + '  <div class="en-card-top"><span class="en-badge">' + esc(w.tag) + '</span><span class="en-box">' + badge + '</span></div>'
            + '  <div class="en-face">' + front + (state.flipped ? '<hr class="en-rule">' + back + extra : '') + '</div>'
            + '  <div class="en-hint">' + (state.flipped ? '记住了按 3，拿不准按 2，没见过按 1' : '想一下，再翻面（空格）') + '</div>'
            + '</div>'
            + (state.flipped
                ? '<div class="en-actions">'
                + '<button type="button" class="en-btn en-grade en-grade-bad" data-act="grade" data-g="bad"><b>不认识</b><span>1</span></button>'
                + '<button type="button" class="en-btn en-grade en-grade-hard" data-act="grade" data-g="hard"><b>模糊</b><span>2</span></button>'
                + '<button type="button" class="en-btn en-grade en-grade-good" data-act="grade" data-g="good"><b>认识</b><span>3</span></button>'
                + '</div>'
                : '<div class="en-actions"><button type="button" class="en-btn en-btn-main" data-act="flip">翻面看释义（空格）</button></div>');
    }

    function emptySession(title, sub) {
        return ''
            + '<div class="en-done">'
            + '  <p class="en-kicker">空空如也</p>'
            + '  <h2 class="en-done-num">0 <small>词</small></h2>'
            + '  <p class="en-done-line">' + esc(title) + '</p>'
            + '  <p class="en-done-sub">' + esc(sub || '') + '</p>'
            + '  <div class="en-done-btns">'
            + '    <button type="button" class="en-btn en-btn-main" data-act="mode" data-mode="study">今日学习</button>'
            + '    <button type="button" class="en-btn en-btn-ghost" data-act="mode" data-mode="list">翻词表</button>'
            + '  </div>'
            + '</div>';
    }

    /* ---------- 拼写 ---------- */

    function startSpell() {
        var keys = Object.keys(state.data.cards).filter(function (k) {
            var w = BYKEY[k];
            if (!w) { return false; }
            if (state.data.book !== 'all' && w.bk !== state.data.book) { return false; }
            return state.data.cards[k].b >= 1;
        });
        keys = seededOrder(keys, (state.user || '') + today() + 'spell').slice(0, SPELL_ROUND);
        state.spell = { keys: keys, i: 0, shown: false, ok: 0, bad: 0 };
        renderStage();
    }

    function renderSpell(main) {
        if (!state.spell) { startSpell(); return; }
        var sp = state.spell;
        if (!sp.keys.length) {
            main.innerHTML = emptySession('还没有学过的词可以拼', '先在「今日学习」里过一遍，认识的词才会进拼写池。');
            return;
        }
        if (sp.i >= sp.keys.length) {
            main.innerHTML = ''
                + '<div class="en-done">'
                + '  <p class="en-kicker">拼写完成</p>'
                + '  <h2 class="en-done-num">' + sp.ok + '<small>/' + sp.keys.length + '</small></h2>'
                + '  <p class="en-done-line">拼对 ' + sp.ok + '，拼错 ' + sp.bad + '</p>'
                + '  <div class="en-done-btns"><button type="button" class="en-btn en-btn-main" data-act="spell-again">再来一组</button>'
                + '<button type="button" class="en-btn en-btn-ghost" data-act="mode" data-mode="study">回到学习</button></div>'
                + '</div>';
            return;
        }
        var w = BYKEY[sp.keys[sp.i]];
        var pct = Math.round(sp.i / sp.keys.length * 100);
        main.innerHTML = ''
            + '<div class="en-bar"><i style="width:' + pct + '%"></i></div>'
            + '<p class="en-count">' + (sp.i + 1) + ' / ' + sp.keys.length + '</p>'
            + '<div class="en-card en-card-spell">'
            + '  <div class="en-card-top"><span class="en-badge">' + esc(w.tag) + '</span><span class="en-box">拼写</span></div>'
            + '  <div class="en-face"><p class="en-ask en-ask-lg">' + esc(w.tr) + '</p>'
            + '  <p class="en-spell-tip">首字母 ' + esc(w.w.charAt(0)) + '，共 ' + w.w.replace(/[^A-Za-z]/g, '').length + ' 个字母</p>'
            + (sp.shown ? '<hr class="en-rule"><p class="en-word en-word-sm">' + esc(w.w) + '</p>' + (w.ph ? '<p class="en-ph">/' + esc(w.ph) + '/</p>' : '') : '')
            + '  </div>'
            + '  <div class="en-spell-in"><input id="en-spell" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="写单词，回车提交"' + (sp.shown ? ' disabled' : '') + '></div>'
            + '  <p class="en-err" id="en-spell-msg" role="status">' + esc(state.note && sp.shown ? state.note : '') + '</p>'
            + '</div>'
            + '<div class="en-actions">'
            + (sp.shown
                ? '<button type="button" class="en-btn en-btn-main" data-act="spell-next">下一个（回车）</button>'
                : '<button type="button" class="en-btn en-btn-main" data-act="spell-check">检查</button>'
                + '<button type="button" class="en-btn en-btn-ghost" data-act="spell-reveal">不会，看答案</button>')
            + '</div>';
        var inp = el('en-spell');
        if (inp && !sp.shown) {
            try { inp.focus(); } catch (err) { /* 忽略 */ }
        }
    }

    function normWord(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }

    function spellCheck() {
        var sp = state.spell;
        if (!sp || sp.shown) { return; }
        var w = BYKEY[sp.keys[sp.i]];
        var inp = el('en-spell');
        var val = inp ? inp.value : '';
        var right = normWord(val) === normWord(w.w);
        sp.shown = true;
        if (right) { sp.ok += 1; } else { sp.bad += 1; }
        state.note = right ? '对了：' + w.w : '写的是「' + (val || '空') + '」，答案是 ' + w.w;
        var c = cardOf(w.k);
        c.n += 1;
        c.t = today();
        if (right) {
            c.ok += 1;
            c.b = Math.min(STEPS.length - 1, c.b + 1);
            c.due = shift(STEPS[c.b]);
            day().ok += 1;
        } else {
            c.bad += 1;
            c.b = 0;
            c.due = today();
            day().bad += 1;
        }
        day().r += 1;
        saveData();
        renderStage();
    }

    function spellNext() {
        var sp = state.spell;
        if (!sp) { return; }
        sp.i += 1;
        sp.shown = false;
        state.note = '';
        renderStage();
    }

    /* ---------- 词表 ---------- */

    function statusOf(k) {
        var c = state.data.cards[k];
        if (!c || c.n === 0) { return ['new', '未学']; }
        if (c.b >= MASTER) { return ['done', '已掌握']; }
        return ['doing', '第 ' + (c.b + 1) + ' 盒'];
    }

    function matchedWords() {
        var list = bookWords(state.data.book);
        var q = state.listQuery.trim().toLowerCase();
        var f = state.listFilter;
        return list.filter(function (w) {
            if (q && w.w.toLowerCase().indexOf(q) < 0 && w.tr.indexOf(q) < 0) { return false; }
            var st = statusOf(w.k)[0];
            if (f === 'new') { return st === 'new'; }
            if (f === 'doing') { return st === 'doing'; }
            if (f === 'done') { return st === 'done'; }
            return true;
        });
    }

    function renderListBody() {
        var all = matchedWords();
        var rows = all.slice(0, state.listShown).map(function (w) {
            var st = statusOf(w.k);
            return '<li class="en-row-item">'
                + '<span class="en-row-w">' + esc(w.w) + (w.ph ? '<i>/' + esc(w.ph) + '/</i>' : '') + '</span>'
                + '<span class="en-row-t">' + esc(w.tr) + '</span>'
                + '<span class="en-dot en-dot-' + st[0] + '" title="' + esc(st[1]) + '"></span>'
                + '</li>';
        }).join('');
        return '<p class="en-list-count">' + all.length + ' 个词'
            + (all.length > state.listShown ? '，先看前 ' + state.listShown + ' 个' : '') + '</p>'
            + (rows ? '<ul class="en-list">' + rows + '</ul>' : '<p class="en-empty">没有匹配的词。</p>')
            + (all.length > state.listShown
                ? '<div class="en-actions"><button type="button" class="en-btn en-btn-ghost" data-act="list-more">再看 60 个</button></div>'
                : '');
    }

    /* 搜索框重绘会丢焦点、也会打断中文输入法的组字，所以只换列表本体 */
    function renderList(main) {
        main.innerHTML = ''
            + '<div class="en-list-head">'
            + '  <input id="en-q" class="en-search" type="search" placeholder="搜单词或释义" value="' + esc(state.listQuery) + '" autocomplete="off">'
            + '  <div class="en-chips">'
            + [['all', '全部'], ['new', '未学'], ['doing', '学习中'], ['done', '已掌握']].map(function (c) {
                return '<button type="button" class="en-chip' + (state.listFilter === c[0] ? ' is-on' : '') + '" data-act="filter" data-f="' + c[0] + '">' + c[1] + '</button>';
            }).join('')
            + '  </div>'
            + '</div>'
            + '<div id="en-list-body">' + renderListBody() + '</div>';
        var q = el('en-q');
        if (q && state.listQuery) {
            try { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } catch (err) { /* 忽略 */ }
        }
    }

    function refreshListBody() {
        var body = el('en-list-body');
        if (body) { body.innerHTML = renderListBody(); }
    }

    /* ---------- 导入导出 ---------- */

    function exportData() {
        if (!state.user) { return; }
        saveData(true);
        var payload = {
            app: 'zbx-english',
            v: 2,
            user: state.user,
            exported: today(),
            data: state.data
        };
        var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = '连珠英语-' + state.user + '-' + today() + '.json';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
            URL.revokeObjectURL(a.href);
            if (a.parentNode) { a.parentNode.removeChild(a); }
        }, 0);
        state.note = '已导出，文件里是这台设备上的全部练习进度';
        alert('已导出进度文件：' + a.download + '\n\n换设备时用「导入」选这个文件即可。');
    }

    function importData(file) {
        if (!file) { return; }
        var reader = new FileReader();
        reader.onload = function () {
            var pack = null;
            try { pack = JSON.parse(String(reader.result)); } catch (err) { pack = null; }
            if (!pack || pack.app !== 'zbx-english' || !pack.data) {
                alert('这个文件不是连珠英语导出的进度。');
                return;
            }
            var inc = pack.data;
            if (!inc.cards) { alert('文件里没有练习记录。'); return; }
            var n = Object.keys(inc.cards).length;
            if (!window.confirm('导入 ' + n + ' 条练习记录？\n同一条取「记得更牢」的那份，不会把已有的进度冲掉。')) { return; }
            var cards = state.data.cards;
            Object.keys(inc.cards).forEach(function (k) {
                var a = cards[k];
                var b = inc.cards[k];
                if (!a) { cards[k] = b; return; }
                if ((b.b || 0) > (a.b || 0) || ((b.b || 0) === (a.b || 0) && (b.t || '') > (a.t || ''))) {
                    cards[k] = b;
                }
            });
            var days = state.data.days;
            Object.keys(inc.days || {}).forEach(function (d) {
                var a = days[d] || (days[d] = { n: 0, r: 0, ok: 0, bad: 0 });
                var b = inc.days[d];
                a.n = Math.max(a.n, b.n || 0);
                a.r = Math.max(a.r, b.r || 0);
                a.ok = Math.max(a.ok, b.ok || 0);
                a.bad = Math.max(a.bad, b.bad || 0);
            });
            Object.keys(inc.reading || {}).forEach(function (id) {
                var x = state.data.reading[id] || { attempts: 0, best: -1, last: '' };
                var y = inc.reading[id];
                x.attempts = Math.max(x.attempts || 0, y.attempts || 0);
                x.best = Math.max(x.best == null ? -1 : x.best, y.best == null ? -1 : y.best);
                x.last = (x.last || '') > (y.last || '') ? x.last : y.last;
                state.data.reading[id] = x;
            });
            saveData(true);
            state.queue = buildQueue('study');
            state.idx = 0;
            render();
            alert('导入完成，进度已合并。');
        };
        reader.readAsText(file, 'utf-8');
    }

    function resetData() {
        if (!state.user) { return; }
        if (!window.confirm('清空「' + state.user + '」的全部练习记录？\n这个操作不可撤销，导出过的话还能再导回来。')) { return; }
        state.data = blankData();
        saveData(true);
        state.queue = buildQueue('study');
        state.idx = 0;
        state.spell = null;
        render();
    }

    /* ---------- 多端同步：Gist / 自定义 REST / 加密同步码 ---------- */

    function syncCfg() {
        var raw = storeGet(K_SYNC);
        var c = null;
        try { c = raw ? JSON.parse(raw) : null; } catch (err) { c = null; }
        if (!c || typeof c !== 'object') { c = {}; }
        return {
            provider: c.provider || '',
            gistId: c.gistId || '',
            token: c.token || '',
            url: c.url || '',
            auto: c.auto === 0 ? 0 : 1
        };
    }

    function saveSyncCfg(c) { return storeSet(K_SYNC, JSON.stringify(c)); }

    function syncStatus(msg, bad) {
        state.sync.msg = msg || '';
        ['en-sync-status', 'en-g-sync-status'].forEach(function (id) {
            var box = el(id);
            if (box) {
                box.textContent = msg || '只存本机，未开启同步';
                box.className = 'en-sync-status' + (bad ? ' is-bad' : '');
            }
        });
    }

    function hex(bytes) {
        var out = '';
        for (var i = 0; i < bytes.length; i += 1) {
            out += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
        }
        return out;
    }

    function simpleHex(str) {
        var h1 = 2166136261, h2 = 5381, i;
        for (i = 0; i < str.length; i += 1) {
            h1 ^= str.charCodeAt(i); h1 = (h1 * 16777619) >>> 0;
            h2 = (((h2 << 5) + h2) + str.charCodeAt(i)) >>> 0;
        }
        return h1.toString(16) + h2.toString(16);
    }

    /* 账号钥匙由用户名 + 固定盐下的密码派生，同一账号跨设备一致 */
    function syncKey() {
        var u = users()[state.user] || {};
        return syncKeyFor(state.user, u.sk || u.hash || '');
    }

    function syncKeyFor(name, key) {
        var seed = name + '|' + (key || '');
        if (window.crypto && window.crypto.subtle && window.TextEncoder) {
            return window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed))
                .then(function (buf) { return hex(new Uint8Array(buf)).slice(0, 16); })
                .catch(function () { return simpleHex(seed).slice(0, 16); });
        }
        return Promise.resolve(simpleHex(seed).slice(0, 16));
    }

    function syncFile(key) { return 'zbx-english-' + key + '.json'; }

    function checkRes(r, label) {
        if (r.ok) { return Promise.resolve(r); }
        return r.text().then(function (t) {
            var m = '';
            try { m = JSON.parse(t).message || ''; } catch (err) { m = String(t).slice(0, 80); }
            throw new Error(label + '失败（' + r.status + '）' + (m ? '：' + m : ''));
        });
    }

    function remoteGet(cfg, key) {
        if (cfg.provider === 'gist') {
            if (!/^[0-9a-f]{5,40}$/i.test(cfg.gistId)) { throw new Error('Gist ID 填得不对'); }
            if (!cfg.token) { throw new Error('还没填 Gist 令牌'); }
            return fetch('https://api.github.com/gists/' + cfg.gistId, {
                headers: {
                    'Accept': 'application/vnd.github+json',
                    'Authorization': 'token ' + cfg.token,
                    'X-GitHub-Api-Version': '2022-11-28'
                }
            }).then(function (r) {
                if (r.status === 404) { return null; }
                return checkRes(r, '读取 Gist').then(function (ok) { return ok.json(); });
            }).then(function (j) {
                if (!j) { return null; }
                var f = j.files && j.files[syncFile(key)];
                if (!f || f.truncated) { return null; }
                try { return JSON.parse(f.content); } catch (err) { return null; }
            });
        }
        if (cfg.provider === 'rest') {
            if (cfg.url.indexOf('https://') !== 0 && cfg.url.indexOf('http://localhost') !== 0) {
                throw new Error('自定义地址要用 https（本地调试可用 localhost）');
            }
            var u = cfg.url + (cfg.url.indexOf('?') >= 0 ? '&' : '?') + 'k=' + encodeURIComponent(key);
            var h = { 'Accept': 'application/json' };
            if (cfg.token) { h.Authorization = 'Bearer ' + cfg.token; }
            return fetch(u, { headers: h }).then(function (r) {
                if (r.status === 404) { return null; }
                return checkRes(r, '读取同步接口').then(function (ok) { return ok.json(); });
            }).then(function (j) { return j && j.data ? j : null; });
        }
        return Promise.resolve(null);
    }

    function remotePut(cfg, key, pack) {
        var body = JSON.stringify(pack);
        if (cfg.provider === 'gist') {
            var files = {};
            files[syncFile(key)] = { content: body };
            return fetch('https://api.github.com/gists/' + cfg.gistId, {
                method: 'PATCH',
                headers: {
                    'Accept': 'application/vnd.github+json',
                    'Content-Type': 'application/json',
                    'Authorization': 'token ' + cfg.token,
                    'X-GitHub-Api-Version': '2022-11-28'
                },
                body: JSON.stringify({ files: files })
            }).then(function (r) { return checkRes(r, '写入 Gist'); });
        }
        var u = cfg.url + (cfg.url.indexOf('?') >= 0 ? '&' : '?') + 'k=' + encodeURIComponent(key);
        var h = { 'Content-Type': 'application/json' };
        if (cfg.token) { h.Authorization = 'Bearer ' + cfg.token; }
        return fetch(u, { method: 'PUT', headers: h, body: body })
            .then(function (r) { return checkRes(r, '写入同步接口'); });
    }

    function betterCard(a, b) {
        if (!a) { return b; }
        if (!b) { return a; }
        if ((a.b || 0) !== (b.b || 0)) { return (a.b || 0) > (b.b || 0) ? a : b; }
        if ((a.t || '') !== (b.t || '')) { return (a.t || '') > (b.t || '') ? a : b; }
        return (a.n || 0) >= (b.n || 0) ? a : b;
    }

    function mergeData(a, b) {
        var out = JSON.parse(JSON.stringify(a));
        var k;
        for (k in b.cards || {}) {
            if (Object.prototype.hasOwnProperty.call(b.cards, k)) { out.cards[k] = betterCard(out.cards[k], b.cards[k]); }
        }
        for (k in b.days || {}) {
            if (!Object.prototype.hasOwnProperty.call(b.days, k)) { continue; }
            var x = out.days[k] || (out.days[k] = { n: 0, r: 0, ok: 0, bad: 0 });
            var y = b.days[k];
            ['n', 'r', 'ok', 'bad'].forEach(function (f) { x[f] = Math.max(x[f] || 0, y[f] || 0); });
        }
        for (k in b.reading || {}) {
            if (!Object.prototype.hasOwnProperty.call(b.reading, k)) { continue; }
            var ra = out.reading[k] || { attempts: 0, best: -1, last: '' };
            var rb = b.reading[k];
            ra.attempts = Math.max(ra.attempts || 0, rb.attempts || 0);
            ra.best = Math.max(ra.best == null ? -1 : ra.best, rb.best == null ? -1 : rb.best);
            ra.last = (ra.last || '') > (rb.last || '') ? ra.last : rb.last;
            out.reading[k] = ra;
        }
        var newer = (b.updatedMs || 0) > (a.updatedMs || 0) ? b : a;
        ['book', 'dir', 'goal', 'speech'].forEach(function (f) {
            if (newer[f] != null) { out[f] = newer[f]; }
        });
        out.created = a.created || b.created || today();
        out.rev = Math.max(a.rev || 0, b.rev || 0);
        out.updatedMs = Math.max(a.updatedMs || 0, b.updatedMs || 0);
        out.updated = today();
        return out;
    }

    var syncTimer = null;
    function scheduleSync() {
        if (!syncCfg().auto || !state.user || state.sync.busy) { return; }
        clearTimeout(syncTimer);
        syncTimer = setTimeout(function () { syncNow('auto'); }, 1200);
    }

    function syncNow(mode) {
        if (!state.user || !state.data) {
            if (mode !== 'auto') { syncStatus('先登录再同步', true); }
            return Promise.resolve();
        }
        var cfg = syncCfg();
        if (!cfg.provider) {
            if (mode !== 'auto') { syncStatus('没开同步：先填 Gist 或接口地址', true); }
            return Promise.resolve();
        }
        if (state.sync.busy) {
            if (mode !== 'auto') { syncStatus('正在同步，稍等一下'); }
            return Promise.resolve();
        }
        clearTimeout(syncTimer);
        state.sync.busy = true;
        syncStatus('同步中…');
        return syncKey().then(function (key) {
            return remoteGet(cfg, key).then(function (remote) {
                if (remote && remote.data && remote.user === state.user) {
                    var merged = mergeData(state.data, remote.data);
                    var changed = (merged.rev || 0) > (state.data.rev || 0)
                        || JSON.stringify(merged.cards) !== JSON.stringify(state.data.cards)
                        || JSON.stringify(merged.reading) !== JSON.stringify(state.data.reading);
                    if (changed) {
                        state.data = merged;
                        storeSet(K_PROG + state.user, JSON.stringify(merged));
                        renderNums();
                        if (state.mode === 'reading') { renderStage(); }
                    }
                }
                var pack = {
                    app: 'zbx-english', v: 2, user: state.user, key: key,
                    rev: state.data.rev || 0, updatedMs: state.data.updatedMs || 0,
                    updated: today(), data: state.data
                };
                return remotePut(cfg, key, pack);
            }).then(function () {
                state.sync.at = Date.now();
                syncStatus('已同步 ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
            });
        }).catch(function (err) {
            syncStatus('同步失败：' + (err && err.message ? err.message : String(err)), true);
        }).then(function () { state.sync.busy = false; });
    }

    function saveSyncSettings() {
        var g = state.gateSync && el('en-gate-sync-box') && !el('en-gate-sync-box').hidden;
        var p = function (id) { return el(g ? 'en-g-' + id : 'en-' + id); };
        var cfg = {
            provider: p('sync-provider') ? p('sync-provider').value : '',
            gistId: p('gist-id') ? p('gist-id').value.trim() : '',
            token: p('token') ? p('token').value.trim() : '',
            url: p('sync-url') ? p('sync-url').value.trim() : '',
            auto: p('sync-auto') && !p('sync-auto').checked ? 0 : 1
        };
        if (!saveSyncCfg(cfg)) { syncStatus('本机存储写不进去，设置没保存', true); return; }
        syncStatus('设置已保存' + (g ? '，现在用同一账号登录就能拉回进度' : ''));
        if (!g) { syncNow('manual'); }
    }

    function syncCodeKey() {
        var u = users()[state.user] || {};
        if (!window.crypto || !window.crypto.subtle || !(u.sk || u.hash)) {
            return Promise.reject(new Error('这个浏览器不支持加密同步码'));
        }
        return window.crypto.subtle.importKey('raw', unb64(u.sk || u.hash), 'AES-GCM', false, ['encrypt', 'decrypt']);
    }

    function makeSyncCode() {
        syncCodeKey().then(function (key) {
            var iv = new Uint8Array(12);
            window.crypto.getRandomValues(iv);
            var text = JSON.stringify({ app: 'zbx-english-code', v: 1, user: state.user, data: state.data });
            return window.crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(text))
                .then(function (buf) { return 'ZBX1.' + b64(iv) + '.' + b64(buf); });
        }).then(function (code) {
            var box = el('en-code');
            if (box) { box.value = code; }
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(code)
                    .then(function () { syncStatus('同步码已生成并复制，粘到另一台设备即可'); })
                    .catch(function () { syncStatus('同步码已生成，请手动复制'); });
            } else {
                syncStatus('同步码已生成，请手动复制');
            }
        }).catch(function (err) { syncStatus('生成失败：' + err.message, true); });
    }

    function useSyncCode() {
        var box = el('en-code');
        var code = box ? box.value.trim() : '';
        if (!/^ZBX1\./.test(code)) { syncStatus('这不是连珠英语的同步码', true); return; }
        var parts = code.split('.');
        if (parts.length !== 3) { syncStatus('同步码不完整，请整段复制', true); return; }
        syncCodeKey().then(function (key) {
            return window.crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: unb64(parts[1]) }, key, unb64(parts[2])
            );
        }).then(function (buf) {
            var pack = JSON.parse(new TextDecoder().decode(buf));
            if (pack.app !== 'zbx-english-code' || !pack.data) { throw new Error('同步码内容不对'); }
            if (pack.user !== state.user && !window.confirm('同步码属于「' + pack.user + '」，当前账号是「' + state.user + '」，仍要合并吗？')) { return; }
            if (!window.confirm('把同步码里的进度合并进当前账号？同一条取记得更牢的那份。')) { return; }
            state.data = mergeData(state.data, pack.data);
            saveData(true);
            state.queue = buildQueue(state.mode === 'review' ? 'review' : 'study');
            state.idx = 0;
            render();
            syncStatus('同步码已合并');
        }).catch(function (err) {
            syncStatus('同步码用不了：' + (err && err.message ? err.message : '密码或内容不匹配'), true);
        });
    }

    /* ---------- 五子棋主题阅读理解 ---------- */

    var ARTICLES = null;
    function articles() {
        if (ARTICLES) { return ARTICLES; }
        var d = window.ZBX_READING;
        ARTICLES = (d && (d.words || d.passages)) || [];
        return ARTICLES;
    }

    function currentArticle() {
        var id = state.read.id;
        if (!id) { return null; }
        var list = articles();
        for (var i = 0; i < list.length; i += 1) { if (list[i].id === id) { return list[i]; } }
        return null;
    }

    function wordCount(p) { return String(p.text.join(' ')).trim().split(/\s+/).length; }

    function renderReading(main) {
        var list = articles();
        if (!state.read.id) {
            var done = list.filter(function (p) { return state.data.reading[p.id]; }).length;
            main.innerHTML = ''
                + '<div class="en-read-intro">'
                + '  <p class="en-kicker">READING PRACTICE</p>'
                + '  <h2 class="en-gate-title">读一篇，再做四道题</h2>'
                + '  <p class="en-gate-sub">文章都和五子棋、连珠有关，长篇短句按四级阅读的尺度写。做完立刻看答案和讲解，成绩会跟着账号一起同步。'
                + '  已完成 ' + done + ' / ' + list.length + ' 篇。</p>'
                + '</div>'
                + (list.length
                    ? '<div class="en-read-grid">' + list.map(function (p) {
                        var rec = state.data.reading[p.id] || {};
                        var best = rec.best == null ? '还没做' : ('最好 ' + rec.best + ' / ' + p.questions.length);
                        return '<button type="button" class="en-read-card" data-act="read-open" data-id="' + esc(p.id) + '">'
                            + '<span class="en-read-top"><span class="en-badge">' + esc(p.topic) + '</span><span class="en-box">' + esc(best) + '</span></span>'
                            + '<b>' + esc(p.title) + '</b>'
                            + '<span>' + wordCount(p) + ' 词 · ' + p.questions.length + ' 题' + (rec.attempts ? ' · 做过 ' + rec.attempts + ' 次' : '') + '</span>'
                            + '</button>';
                    }).join('') + '</div>'
                    : '<p class="en-empty">阅读文章还没生成，先运行 tools/build_english_words.py。</p>');
            return;
        }

        var p = currentArticle();
        if (!p) { state.read.id = null; renderReading(main); return; }
        var q = p.questions[state.read.idx];
        var picked = state.read.picked;
        var total = p.questions.length;
        var pct = Math.round(state.read.idx / total * 100);

        if (!q) {
            var ok = state.read.answers.filter(function (a, i) { return a === p.questions[i].a; }).length;
            main.innerHTML = ''
                + '<div class="en-bar"><i style="width:100%"></i></div>'
                + '<div class="en-done">'
                + '  <p class="en-kicker">阅读完成</p>'
                + '  <h2 class="en-done-num">' + ok + ' <small>/ ' + total + ' 题</small></h2>'
                + '  <p class="en-done-line">' + esc(p.title) + '</p>'
                + '  <p class="en-done-sub">正确率 ' + Math.round(ok / total * 100) + '% · 成绩已记进账号</p>'
                + '  <div class="en-done-btns">'
                + '    <button type="button" class="en-btn en-btn-main" data-act="read-retry">再做一次</button>'
                + '    <button type="button" class="en-btn en-btn-ghost" data-act="read-back">返回文章列表</button>'
                + '  </div>'
                + '</div>';
            return;
        }

        main.innerHTML = ''
            + '<div class="en-bar"><i style="width:' + pct + '%"></i></div>'
            + '<p class="en-count">' + esc(p.title) + ' · 第 ' + (state.read.idx + 1) + ' / ' + total + ' 题</p>'
            + '<article class="en-article">'
            + p.text.map(function (t) { return '<p>' + esc(t) + '</p>'; }).join('')
            + '</article>'
            + '<div class="en-gloss">'
            + '  <span class="en-gloss-title">生词</span>'
            + p.gloss.map(function (g) { return '<span class="en-gloss-item"><b>' + esc(g[0]) + '</b> ' + esc(g[1]) + '</span>'; }).join('')
            + '  <button type="button" class="en-btn en-btn-ghost" data-act="read-words">加入背词</button>'
            + '</div>'
            + '<div class="en-quiz">'
            + '  <p class="en-qtitle">' + esc(q.q) + '</p>'
            + '  <div class="en-opts">' + q.options.map(function (o, i) {
                var cls = 'en-opt';
                if (picked >= 0) {
                    if (i === q.a) { cls += ' is-right'; }
                    else if (i === picked) { cls += ' is-wrong'; }
                }
                return '<button type="button" class="' + cls + '" data-act="read-pick" data-i="' + i + '">'
                    + '<span>' + 'ABCD'[i] + '</span>' + esc(o) + '</button>';
            }).join('') + '</div>'
            + (picked >= 0
                ? '<div class="en-why"><b>' + (picked === q.a ? '答对了。' : '正确答案：' + 'ABCD'[q.a]) + '</b>' + esc(q.why) + '</div>'
                    + '<div class="en-actions"><button type="button" class="en-btn en-btn-main" data-act="read-next">'
                    + (state.read.idx + 1 >= total ? '看成绩' : '下一题') + '</button></div>'
                : '')
            + '</div>'
            + '<div class="en-read-foot"><button type="button" class="en-link" data-act="read-back">← 返回文章列表</button></div>';
    }

    function openArticle(id) {
        state.read = { id: id, idx: 0, picked: -1, answers: [] };
        renderStage();
        try { window.scrollTo(0, 0); } catch (err) { /* 忽略 */ }
    }

    function finishReading() {
        var p = currentArticle();
        if (!p) { return; }
        var ok = state.read.answers.filter(function (a, i) { return a === p.questions[i].a; }).length;
        var rec = state.data.reading[p.id] || { attempts: 0, best: -1, last: '' };
        rec.attempts = (rec.attempts || 0) + 1;
        rec.best = Math.max(rec.best == null ? -1 : rec.best, ok);
        rec.last = today();
        state.data.reading[p.id] = rec;
        saveData(true);
        renderNums();
    }

    function addReadingWords() {
        var p = currentArticle();
        if (!p) { return; }
        var n = 0;
        p.gloss.forEach(function (g) {
            var w = String(g[0]).toLowerCase();
            ['r:', 'c:'].forEach(function (prefix) {
                var k = prefix + w;
                if (BYKEY[k] && !state.data.cards[k]) {
                    state.data.cards[k] = { b: 0, due: today(), n: 0, ok: 0, bad: 0, f: today(), t: today() };
                    n += 1;
                }
            });
        });
        saveData(true);
        renderNums();
        alert(n ? ('已把 ' + n + ' 个生词放进今日学习。') : '这些词已经在词表里了，直接从「今日学习」过一遍吧。');
    }

    /* ---------- 事件（document 级委托，绑一次） ---------- */

    function bindOnce() {
        if (window.__zbxEnglishBound) { return; }
        window.__zbxEnglishBound = 1;

        document.addEventListener('click', function (e) {
            var t = e.target;
            var btn = t && t.closest ? t.closest('[data-act]') : null;
            if (!btn || !el('en-app')) { return; }
            var act = btn.getAttribute('data-act');
            if (!act) { return; }
            if (btn.tagName === 'SELECT' || btn.tagName === 'INPUT') { return; }

            if (act === 'tab') {
                state.tab = btn.getAttribute('data-tab') || 'login';
                state.note = '';
                renderGate();
                return;
            }
            if (act === 'login' || act === 'register') { return; }
            if (act === 'logout') { logout(); return; }
            if (act === 'mode') {
                var m = btn.getAttribute('data-mode');
                state.mode = m;
                if (m === 'study' || m === 'review') {
                    state.queue = buildQueue(m);
                    state.idx = 0;
                    state.flipped = false;
                    state.sess = { n: 0, ok: 0, bad: 0 };
                } else if (m === 'spell') {
                    startSpell();
                } else if (m === 'reading') {
                    state.read = { id: null, idx: 0, picked: -1, answers: [] };
                }
                renderSide();
                renderStage();
                return;
            }
            if (act === 'flip') {
                if (!state.queue.length) { return; }
                state.flipped = !state.flipped;
                if (state.flipped) {
                    var it = state.queue[state.idx];
                    var w = it && BYKEY[it.key || it];
                    if (w && dirOf(w.k) === 'en2cn') { speak(w.w); }
                }
                renderStage();
                return;
            }
            if (act === 'grade') { grade(btn.getAttribute('data-g')); return; }
            if (act === 'spell-check') { spellCheck(); return; }
            if (act === 'spell-next') { spellNext(); return; }
            if (act === 'spell-reveal') {
                if (!state.spell) { return; }
                state.spell.shown = true;
                state.note = '答案是 ' + BYKEY[state.spell.keys[state.spell.i]].w;
                var c = cardOf(BYKEY[state.spell.keys[state.spell.i]].k);
                c.n += 1; c.bad += 1; c.b = 0; c.due = today(); c.t = today();
                day().r += 1; day().bad += 1;
                state.spell.bad += 1;
                saveData();
                renderStage();
                return;
            }
            if (act === 'spell-again') { startSpell(); return; }
            if (act === 'filter') {
                state.listFilter = btn.getAttribute('data-f') || 'all';
                state.listShown = 60;
                renderStage();
                return;
            }
            if (act === 'list-more') {
                state.listShown += 60;
                renderStage();
                return;
            }
            if (act === 'read-open') { openArticle(btn.getAttribute('data-id')); return; }
            if (act === 'read-pick') {
                if (!currentArticle() || state.read.picked >= 0) { return; }
                var pick = parseInt(btn.getAttribute('data-i'), 10);
                state.read.picked = pick;
                state.read.answers[state.read.idx] = pick;
                renderStage();
                return;
            }
            if (act === 'read-next') {
                var art = currentArticle();
                if (!art) { return; }
                if (state.read.idx + 1 >= art.questions.length) { finishReading(); }
                state.read.idx += 1;
                state.read.picked = -1;
                renderStage();
                return;
            }
            if (act === 'read-retry') { openArticle(state.read.id); return; }
            if (act === 'read-back') {
                state.read = { id: null, idx: 0, picked: -1, answers: [] };
                renderStage();
                return;
            }
            if (act === 'read-words') { addReadingWords(); return; }
            if (act === 'gate-sync') {
                state.gateSync = !state.gateSync;
                renderGate();
                return;
            }
            if (act === 'sync-save') { saveSyncSettings(); return; }
            if (act === 'sync-now') { syncNow('manual'); return; }
            if (act === 'sync-code-make') { makeSyncCode(); return; }
            if (act === 'sync-code-use') { useSyncCode(); return; }
            if (act === 'export') { exportData(); return; }
            if (act === 'import') {
                var f = el('en-file');
                if (f) { f.click(); }
                return;
            }
            if (act === 'reset') { resetData(); return; }
        });

        document.addEventListener('submit', function (e) {
            var form = e.target;
            if (!form || form.id !== 'en-form' || !el('en-app')) { return; }
            e.preventDefault();
            var nameEl = el('en-name');
            var pwEl = el('en-pw');
            var pw2El = el('en-pw2');
            var name = nameEl ? nameEl.value.trim() : '';
            var pw = pwEl ? pwEl.value : '';
            var err = el('en-err');
            function fail(msg) {
                state.note = msg;
                if (err) { err.textContent = msg; }
            }
            if (!hasStore()) { fail('浏览器禁用了本地存储，进度存不下来'); return; }
            if (state.tab === 'register') {
                if (pw2El && pw2El.value !== pw) { fail('两次输入的密码不一样'); return; }
                state.note = '';
                doRegister(name, pw).catch(function (msg) { fail(typeof msg === 'string' ? msg : '注册失败'); });
            } else {
                state.note = '';
                doLogin(name, pw).catch(function (msg) { fail(typeof msg === 'string' ? msg : '登录失败'); });
            }
        });

        document.addEventListener('change', function (e) {
            var t = e.target;
            if (!t || !el('en-app')) { return; }
            if (t.id === 'en-file') {
                if (t.files && t.files[0]) { importData(t.files[0]); }
                t.value = '';
                return;
            }
            var key = t.getAttribute && t.getAttribute('data-key');
            if (!key) { return; }
            if (key === 'speech') {
                state.data.speech = t.checked ? 1 : 0;
            } else if (key === 'goal') {
                state.data.goal = parseInt(t.value, 10) || 20;
            } else if (key === 'book' || key === 'dir') {
                state.data[key] = t.value;
                state.queue = buildQueue(state.mode === 'review' ? 'review' : 'study');
                state.idx = 0;
                state.flipped = false;
                state.spell = null;
            }
            saveData(true);
            renderSide();
            renderStage();
        });

        document.addEventListener('input', function (e) {
            var t = e.target;
            if (!t || !el('en-app')) { return; }
            if (t.id === 'en-q') {
                if (t.value === state.listQuery) { return; }
                state.listQuery = t.value;
                state.listShown = 60;
                refreshListBody();
            }
        });

        document.addEventListener('keydown', function (e) {
            if (!el('en-app') || !state.user) { return; }
            var tag = (e.target && e.target.tagName) || '';
            var typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
            if (state.mode === 'reading') {
                if (e.key === 'Enter' && state.read.picked >= 0) {
                    e.preventDefault();
                    var art = currentArticle();
                    if (art) {
                        if (state.read.idx + 1 >= art.questions.length) { finishReading(); }
                        state.read.idx += 1;
                        state.read.picked = -1;
                        renderStage();
                    }
                } else if (/^[1-4]$/.test(e.key) && state.read.picked < 0) {
                    e.preventDefault();
                    state.read.picked = parseInt(e.key, 10) - 1;
                    state.read.answers[state.read.idx] = state.read.picked;
                    renderStage();
                } else if (e.key === 'Escape') {
                    state.read = { id: null, idx: 0, picked: -1, answers: [] };
                    renderStage();
                }
                return;
            }
            if (state.mode === 'spell') {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (state.spell && state.spell.shown) { spellNext(); } else { spellCheck(); }
                }
                return;
            }
            if (typing) { return; }
            if (state.mode !== 'study' && state.mode !== 'review') { return; }
            if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                if (!state.queue.length) { return; }
                if (!state.flipped) {
                    state.flipped = true;
                    renderStage();
                } else {
                    grade('good');
                }
                return;
            }
            if (!state.flipped) { return; }
            if (e.key === '1') { grade('bad'); }
            if (e.key === '2') { grade('hard'); }
            if (e.key === '3') { grade('good'); }
        });
    }

    /* ---------- 启动 ---------- */

    function boot() {
        if (!el('en-app')) { return; }
        buildWords();
        bindOnce();
        var sess = storeGet(K_SESSION);
        if (sess && users()[sess]) {
            state.user = sess;
            state.data = loadData(sess);
            state.queue = buildQueue('study');
            state.idx = 0;
            state.flipped = false;
            state.sess = { n: 0, ok: 0, bad: 0 };
        } else {
            state.user = null;
            state.data = null;
            state.queue = [];
        }
        render();
    }

    window.ZBX_EN = { boot: boot };
    boot();
    document.addEventListener('zbx:navigate', function () {
        if (el('en-app')) { boot(); }
    });
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden && state.user && syncCfg().auto) { syncNow('auto'); }
    });
})();
