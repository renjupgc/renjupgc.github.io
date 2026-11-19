/* 杂技 · 连珠英语：四级词汇与连珠术语的记忆卡。
 * ---------------------------------------------------------------------------
 * 数据：assets/words-cet4.js、assets/words-renju.js（tools/build_english_words.py 生成）
 * 账号：右上角登录 / 注册，和全站共用一个云端账号（window.ZBX_ACCOUNT）。
 *       背词进度随账号存在云端，换设备登录同一账号即恢复，不用备份文件。
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
        note: '',
        spell: null,
        listFilter: 'all',
        listQuery: '',
        listShown: 60,
        read: { id: null, idx: 0, picked: -1, answers: [], match: {}, done: false }
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
        var gp = progMod();
        if (gp && typeof gp.englishData === 'function') {
            var cloud = gp.englishData();
            if (cloud && typeof cloud === 'object') {
                var c = normalizeEnData(cloud);
                return c;
            }
        }
        var raw = storeGet(K_PROG + name);
        if (!raw) { return blankData(); }
        var local = null;
        try { local = JSON.parse(raw); } catch (err) { local = null; }
        return normalizeEnData(local);
    }

    function normalizeEnData(d) {
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
        var gp = progMod();
        if (gp && typeof gp.setEnglishData === 'function') {
            try {
                gp.setEnglishData(JSON.parse(payload));
                return;
            } catch (err) { /* 落到本机缓存 */ }
        }
        if (storeSet(K_PROG + state.user, payload)) { return; }
        if (quotaWarned) { return; }
        quotaWarned = true;
        alert('进度暂时没能保存，请检查网络后重试。');
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

    /* ---------- 用户名（全站共用，来自进度档案） ---------- */

    function progMod() { return window.ZBX_PROGRESS || null; }

    function validName(n) {
        var gp = progMod();
        if (gp && gp.validName) { return gp.validName(n); }
        return /^[\u4e00-\u9fa5A-Za-z0-9_-]{1,16}$/.test(String(n || '').trim());
    }

    function doEnter(name) {
        name = String(name || '').trim();
        if (!validName(name)) { return Promise.reject('用户名 2–20 位，可用中文、字母、数字、下划线或短横'); }
        enter(name);
        return Promise.resolve();
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
        state.read = blankRead();
        render();
    }

    function logout() {
        saveData(true);
        var acc = window.ZBX_ACCOUNT;
        if (acc && typeof acc.logout === 'function') {
            acc.logout().catch(function () {});
            return;
        }
        var gp = progMod();
        if (gp) { gp.setUser(''); }
        state.user = null;
        state.data = null;
        state.queue = [];
        state.spell = null;
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
        var acc = window.ZBX_ACCOUNT;
        var nick = acc && acc.nick ? acc.nick() : '';
        gate.innerHTML = ''
            + '<div class="en-gate-in">'
            + '  <div class="en-gate-head">'
            + '    <p class="en-kicker">RENJU ENGLISH</p>'
            + '    <h2 class="en-gate-title">登录后开始背词</h2>'
            + '    <p class="en-gate-sub">用页面右上角的「登录 / 注册」进入。背词进度和四项分数都保存在云端账号下，换设备登录同一个账号就能接着用，不用再导出备份文件。</p>'
            + '  </div>'
            + '  <div class="en-form">'
            + '    <p class="en-err" role="alert">' + esc(state.note || '') + '</p>'
            + '    <button type="button" class="en-btn en-btn-main" data-act="login">登录 / 注册</button>'
            + (nick ? '<p class="en-gate-foot">当前账号：' + esc(nick) + '，正在读取云端进度…</p>' : '')
            + '  </div>'
            + '  <p class="en-gate-foot">词库：大学英语四级 ' + wordCounts().cet4 + ' 词 ＋ 连珠术语 ' + wordCounts().renju + ' 条；另有 ' + articles().length + ' 篇五子棋英语阅读。'
            + '</p>'
            + '</div>';
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
            ['reading', '阅读', '仔细阅读 + 长篇匹配'],
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
            + '    <button type="button" class="en-btn en-btn-ghost en-btn-warn" data-act="reset">清空背词进度</button>'
            + '  </div>'
            + '  <p class="en-tip">进度自动保存到云端账号，换设备登录同一个账号即可接着背，不用备份文件。</p>'
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
            /* 进度档案：按这一轮的正确率记一次分，一轮只记一次 */
            try {
                var gp = window.ZBX_PROGRESS;
                if (gp && state.sess.n && !state.sess.scored) {
                    var ok = acc >= 60;
                    gp.commit('english', { ok: ok, ms: 0, diff: 1000 + Math.round(acc / 10) * 40, par: 0 });
                    gp.changed();
                    state.sess.scored = true;
                }
            } catch (err) { /* 进度模块没加载也不影响练习 */ }
            main.innerHTML = ''
                + '<div class="en-done">'
                + '  <p class="en-kicker">' + (state.mode === 'review' ? '复习完成' : '这一轮走完了') + '</p>'
                + '  <h2 class="en-done-num">' + state.sess.n + ' <small>词</small></h2>'
                + '  <p class="en-done-line">答对 ' + state.sess.ok + '，没记住 ' + state.sess.bad + '，正确率 ' + acc + '%</p>'
                + '  <p class="en-done-line">进度分已记入档案，记得在下方「导出进度」存一份。</p>'
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
        state.note = '已备份，文件里是这台设备上的全部练习进度';
        alert('已备份进度文件：' + a.download + '\n\n换设备时用「恢复进度」选这个文件即可。');
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
            if (!window.confirm('恢复 ' + n + ' 条练习记录？\n同一条取「记得更牢」的那份，不会把已有的进度冲掉。')) { return; }
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
            alert('恢复完成，进度已合并。');
        };
        reader.readAsText(file, 'utf-8');
    }

    function resetData() {
        if (!state.user) { return; }
        if (!window.confirm('清空「' + state.user + '」的全部练习记录？\n这个操作不可撤销，备份过的话还能再恢复回来。')) { return; }
        state.data = blankData();
        saveData(true);
        state.queue = buildQueue('study');
        state.idx = 0;
        state.spell = null;
        render();
    }


    /* ---------- 五子棋主题阅读理解 ----------
     * 两种题型，按四级卷面来：
     *   careful  —— 仔细阅读：一篇短文配四道四选一
     *   matching —— 长篇阅读（信息匹配）：一篇分 A–J 段，十个句子各归哪一段
     */

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

    function isMatch(p) { return !!(p && p.type === 'matching'); }

    function blankRead() {
        return { id: null, idx: 0, picked: -1, answers: [], match: {}, done: false };
    }

    function wordCount(p) {
        var raw = isMatch(p)
            ? p.sections.map(function (x) { return x.text; }).join(' ')
            : String((p.text || []).join(' '));
        return raw.trim().split(/\s+/).length;
    }

    function itemCount(p) { return isMatch(p) ? p.statements.length : p.questions.length; }

    function scoreOf(p) {
        if (isMatch(p)) {
            return p.statements.filter(function (s, i) { return state.read.match[i] === s.a; }).length;
        }
        return state.read.answers.filter(function (a, i) { return a === p.questions[i].a; }).length;
    }

    function typeLabel(p) { return isMatch(p) ? '长篇阅读 · 信息匹配' : '仔细阅读'; }

    function glossHtml(p) {
        if (!p.gloss || !p.gloss.length) { return ''; }
        return ''
            + '<div class="en-gloss">'
            + '  <span class="en-gloss-title">生词</span>'
            + p.gloss.map(function (g) { return '<span class="en-gloss-item"><b>' + esc(g[0]) + '</b> ' + esc(g[1]) + '</span>'; }).join('')
            + '  <button type="button" class="en-btn en-btn-ghost" data-act="read-words">加入背词</button>'
            + '</div>';
    }

    function readFoot() {
        return '<div class="en-read-foot"><button type="button" class="en-link" data-act="read-back">← 返回文章列表</button></div>';
    }

    function renderReading(main) {
        var list = articles();
        if (!state.read.id) {
            var done = list.filter(function (p) { return state.data.reading[p.id]; }).length;
            main.innerHTML = ''
                + '<div class="en-read-intro">'
                + '  <p class="en-kicker">READING PRACTICE</p>'
                + '  <h2 class="en-gate-title">仔细阅读，也有长篇匹配</h2>'
                + '  <p class="en-gate-sub">文章都写五子棋和连珠。前面十几篇是五道选择题的仔细阅读（300–375 词），后面三篇是四级那套「长篇阅读·信息匹配」：八百词以上分成 A–J 段，十个句子要各自找到出处。做完立刻看答案和讲解。'
                + '  已完成 ' + done + ' / ' + list.length + ' 篇。</p>'
                + '</div>'
                + (list.length
                    ? '<div class="en-read-grid">' + list.map(function (p) {
                        var rec = state.data.reading[p.id] || {};
                        var best = rec.best == null ? '还没做' : ('最好 ' + rec.best + ' / ' + itemCount(p));
                        return '<button type="button" class="en-read-card" data-act="read-open" data-id="' + esc(p.id) + '">'
                            + '<span class="en-read-top"><span class="en-badge' + (isMatch(p) ? ' en-badge-alt' : '') + '">' + esc(p.topic) + '</span><span class="en-box">' + esc(best) + '</span></span>'
                            + '<b>' + esc(p.title) + '</b>'
                            + '<span>' + esc(typeLabel(p)) + ' · ' + wordCount(p) + ' 词 · ' + itemCount(p) + ' 题' + (rec.attempts ? ' · 做过 ' + rec.attempts + ' 次' : '') + '</span>'
                            + '</button>';
                    }).join('') + '</div>'
                    : '<p class="en-empty">阅读文章还没生成，先运行 tools/build_english_words.py。</p>');
            return;
        }

        var p = currentArticle();
        if (!p) { state.read = blankRead(); renderReading(main); return; }

        if (isMatch(p)) { renderMatching(main, p); return; }

        var q = p.questions[state.read.idx];
        var picked = state.read.picked;
        var total = p.questions.length;
        var pct = Math.round(state.read.idx / total * 100);

        if (!q) { renderDone(main, p); return; }

        main.innerHTML = ''
            + '<div class="en-bar"><i style="width:' + pct + '%"></i></div>'
            + '<p class="en-count">' + esc(p.title) + ' · 第 ' + (state.read.idx + 1) + ' / ' + total + ' 题</p>'
            + '<article class="en-article">'
            + p.text.map(function (t) { return '<p>' + esc(t) + '</p>'; }).join('')
            + '</article>'
            + glossHtml(p)
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
            + readFoot();
    }

    /* 长篇阅读：段落 A–J 连着排，十句各选一段，一次交卷 */
    function renderMatching(main, p) {
        var total = p.statements.length;
        var done = state.read.done;
        var pickedN = Object.keys(state.read.match).length;
        var got = done ? scoreOf(p) : 0;

        main.innerHTML = ''
            + '<div class="en-bar"><i style="width:' + (done ? 100 : Math.round(pickedN / total * 100)) + '%"></i></div>'
            + '<p class="en-count">' + esc(p.title) + ' · 长篇阅读 · 已选 ' + pickedN + ' / ' + total + '</p>'
            + (done
                ? '<div class="en-score"><b>' + got + '</b> / ' + total + ' 题 · 正确率 ' + Math.round(got / total * 100) + '%</div>'
                : '')
            + '<article class="en-article en-sections">'
            + p.sections.map(function (x) {
                return '<section class="en-sec"><b class="en-sec-l">' + esc(x.l) + '</b>'
                    + (x.t ? '<span class="en-sec-t">' + esc(x.t) + '</span>' : '')
                    + '<p>' + esc(x.text) + '</p></section>';
            }).join('')
            + '</article>'
            + glossHtml(p)
            + '<div class="en-quiz en-match">'
            + '  <p class="en-qtitle">下面每句话出自哪一段？为每句选一个段落（可重复选同一段）。</p>'
            + '  <ol class="en-mlist">'
            + p.statements.map(function (s, i) {
                var mine = state.read.match[i] || '';
                var cls = 'en-mitem';
                if (done) { cls += mine === s.a ? ' is-right' : ' is-wrong'; }
                var opts = '<option value=""' + (mine ? '' : ' selected') + '>—</option>'
                    + p.sections.map(function (x) {
                        return '<option value="' + esc(x.l) + '"' + (mine === x.l ? ' selected' : '') + '>' + esc(x.l) + '</option>';
                    }).join('');
                return '<li class="' + cls + '">'
                    + '<div class="en-mrow"><span class="en-mnum">' + (36 + i) + '</span>'
                    + '<p class="en-mtext">' + esc(s.q) + '</p>'
                    + '<select class="en-mpick" data-act="match-pick" data-i="' + i + '"' + (done ? ' disabled' : '') + '>' + opts + '</select></div>'
                    + (done
                        ? '<p class="en-mres">' + (mine === s.a ? '✓ 对了' : '✗ 应为 ' + esc(s.a) + (mine ? '，你选了 ' + esc(mine) : '，没选')) + '</p>'
                            + '<p class="en-mwhy">' + esc(s.why) + '</p>'
                        : '')
                    + '</li>';
            }).join('')
            + '  </ol>'
            + (done
                ? '<div class="en-actions">'
                    + '<button type="button" class="en-btn en-btn-main" data-act="read-retry">再做一次</button>'
                    + '<button type="button" class="en-btn en-btn-ghost" data-act="read-back">返回文章列表</button>'
                    + '</div>'
                : '<div class="en-actions"><button type="button" class="en-btn en-btn-main" data-act="match-submit">交卷，看答案</button></div>')
            + '</div>'
            + readFoot();
    }

    function matchProgress(p) {
        var n = Object.keys(state.read.match).length;
        var cnt = document.querySelector('.en-count');
        if (cnt) { cnt.textContent = p.title + ' · 长篇阅读 · 已选 ' + n + ' / ' + p.statements.length; }
        var bar = document.querySelector('.en-bar i');
        if (bar) { bar.style.width = Math.round(n / p.statements.length * 100) + '%'; }
    }

    function renderDone(main, p) {
        var total = itemCount(p);
        var ok = scoreOf(p);
        main.innerHTML = ''
            + '<div class="en-bar"><i style="width:100%"></i></div>'
            + '<div class="en-done">'
            + '  <p class="en-kicker">阅读完成</p>'
            + '  <h2 class="en-done-num">' + ok + ' <small>/ ' + total + ' 题</small></h2>'
            + '  <p class="en-done-line">' + esc(p.title) + '</p>'
            + '  <p class="en-done-sub">' + esc(typeLabel(p)) + ' · 正确率 ' + Math.round(ok / total * 100) + '% · 成绩已记进账号</p>'
            + '  <div class="en-done-btns">'
            + '    <button type="button" class="en-btn en-btn-main" data-act="read-retry">再做一次</button>'
            + '    <button type="button" class="en-btn en-btn-ghost" data-act="read-back">返回文章列表</button>'
            + '  </div>'
            + '</div>';
    }

    function openArticle(id) {
        state.read = blankRead();
        state.read.id = id;
        renderStage();
        try { window.scrollTo(0, 0); } catch (err) { /* 忽略 */ }
    }

    function finishReading() {
        var p = currentArticle();
        if (!p) { return; }
        var ok = scoreOf(p);
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
        if (!p || !p.gloss) { return; }
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
                    state.read = blankRead();
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
            if (act === 'match-submit') {
                var mp = currentArticle();
                if (!mp || !isMatch(mp) || state.read.done) { return; }
                var left = mp.statements.length - Object.keys(state.read.match).length;
                if (left > 0 && !window.confirm('还有 ' + left + ' 句没选段落，直接交卷吗？')) { return; }
                state.read.done = true;
                finishReading();
                renderStage();
                try { window.scrollTo(0, 0); } catch (err) { /* 忽略 */ }
                return;
            }
            if (act === 'read-retry') { openArticle(state.read.id); return; }
            if (act === 'read-back') {
                state.read = blankRead();
                renderStage();
                return;
            }
            if (act === 'read-words') { addReadingWords(); return; }
            if (act === 'login' || act === 'signup') {
                var acc0 = window.ZBX_ACCOUNT;
                if (acc0 && acc0.openPanel) { acc0.openPanel(act); }
                return;
            }
            if (act === 'reset') { resetData(); return; }
        });

        document.addEventListener('submit', function (e) {
            var form = e.target;
            if (!form || form.id !== 'en-form' || !el('en-app')) { return; }
            e.preventDefault();
            var nameEl = el('en-name');
            var name = nameEl ? nameEl.value.trim() : '';
            var err = el('en-err');
            function fail(msg) {
                state.note = msg;
                if (err) { err.textContent = msg; }
            }
            state.note = '';
            doEnter(name).catch(function (msg) { fail(typeof msg === 'string' ? msg : '进入失败'); });
        });

        document.addEventListener('change', function (e) {
            var t = e.target;
            if (!t || !el('en-app')) { return; }
            if (t.getAttribute && t.getAttribute('data-act') === 'match-pick') {
                var mi = parseInt(t.getAttribute('data-i'), 10);
                if (t.value) { state.read.match[mi] = t.value; } else { delete state.read.match[mi]; }
                var art0 = currentArticle();
                if (art0) { matchProgress(art0); }
                return;
            }
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
                var cur = currentArticle();
                if (e.key === 'Escape') {
                    state.read = blankRead();
                    renderStage();
                    return;
                }
                /* 长篇匹配是选择题下拉，不接管数字键 */
                if (isMatch(cur)) { return; }
                if (e.key === 'Enter' && state.read.picked >= 0) {
                    e.preventDefault();
                    if (cur) {
                        if (state.read.idx + 1 >= cur.questions.length) { finishReading(); }
                        state.read.idx += 1;
                        state.read.picked = -1;
                        renderStage();
                    }
                } else if (/^[1-4]$/.test(e.key) && state.read.picked < 0 && !typing) {
                    e.preventDefault();
                    state.read.picked = parseInt(e.key, 10) - 1;
                    state.read.answers[state.read.idx] = state.read.picked;
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

    function enterAfterCloud(name) {
        var gp = progMod();
        if (gp && typeof gp.loadCloud === 'function') {
            gp.loadCloud().then(function () { enter(name); });
            return;
        }
        enter(name);
    }

    function showGate() {
        state.user = null;
        state.data = null;
        state.queue = [];
        state.spell = null;
        state.note = '';
        render();
    }

    function boot() {
        if (!el('en-app')) { return; }
        buildWords();
        bindOnce();
        var acc = window.ZBX_ACCOUNT;
        var name = acc && acc.user ? acc.user() : '';
        if (name && validName(name)) {
            enterAfterCloud(name);
            return;
        }
        if (window.ZBX_ACCOUNT_READY) {
            window.ZBX_ACCOUNT_READY.then(function (info) {
                var n = info && info.user ? info.user() : '';
                if (n && validName(n)) { enterAfterCloud(n); } else { showGate(); }
            });
            return;
        }
        showGate();
    }

    window.ZBX_EN = { boot: boot };
    boot();
    document.addEventListener('zbx:navigate', function () {
        if (el('en-app')) { boot(); }
    });
    /* 账号在右上角或管理页切换时，这边跟着切换 */
    document.addEventListener('zbx:account', function (e) {
        if (!el('en-app')) { return; }
        var name = e && e.detail ? e.detail.user : '';
        if (name && validName(name)) {
            if (name !== state.user) { enterAfterCloud(name); }
        } else if (state.user) {
            saveData(true);
            showGate();
        }
    });
})();
