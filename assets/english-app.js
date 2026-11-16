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
        listShown: 60
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
        return { v: 1, book: 'all', dir: 'en2cn', goal: 20, speech: 1, cards: {}, days: {}, created: today(), updated: today() };
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
        return d;
    }

    var saveTimer = null;
    var quotaWarned = false;
    function writeData(payload) {
        if (storeSet(K_PROG + state.user, payload)) { return; }
        if (quotaWarned) { return; }
        quotaWarned = true;
        alert('本机存储写不进去了，进度可能没有保存。\n先用「导出进度」备份一下，再清掉别的站点数据。');
    }
    function saveData(now) {
        if (!state.user || !state.data) { return; }
        state.data.updated = today();
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
            u[name] = { salt: salt, hash: h, weak: h.charAt(0) === 'w' ? 1 : 0, at: today() };
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
        });
    }

    function doLogin(name, pw) {
        var u = users();
        var rec = u[name];
        if (!rec) { return Promise.reject('没有这个用户名'); }
        return hashPw(pw, rec.salt).then(function (h) {
            if (h !== rec.hash) { throw new Error('bad'); }
            storeSet(K_SESSION, name);
            enter(name);
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
        render();
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
            + '  <p class="en-gate-foot">词库：大学英语四级 ' + wordCounts().cet4 + ' 词 ＋ 连珠术语 ' + wordCounts().renju + ' 条。'
            + (names.length ? '本机已有账号：' + names.map(function (n) { return esc(n); }).join('、') : '还没有账号，注册一个就行。')
            + '</p>'
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
            + '<p class="en-prog-text">词库 ' + total + ' 词，掌握 ' + ms + '</p>';
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
            v: 1,
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
})();
