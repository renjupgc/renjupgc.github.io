/* ==========================================================================
   杂想 · 小游戏「猜术语」
   --------------------------------------------------------------------------
   每题只有一个正解，是连珠（五子棋）术语。用户输入一个词，页面返回：
     · 与正解的相似百分比
     · 相似点（同一条路上的哪个词、差在哪）
     · 这道题的 JSON（含正解与各个相关词各自的百分比）

   分值不是算出来就完事，而是先定死：
     正解 = 100；每题另有一组「相关词」，每个词带一个互不相同的分值
     （40–92），都在提示里给出，点击即可试。所以同一题里，
     每个词与正解的相似比都不一样，也都有关系，只是远近不同。
   用户输入的词若不在这张表里，按字面相似（全等/包含/二元组重合/共字）
   落在 6–84 之间，永远不会超过任何一个相关词的上限，更到不了 100。
   ========================================================================== */

(function () {
    'use strict';

    /* ---------- 题库：答案全部是连珠术语 ---------- */

    var QS = [
        {
            id: 'q1',
            ch: '一 · 定式',
            q: '背过的东西到这儿断了，你自己把局面带到棋谱外面去。棋评里给这个动作两个字。',
            ans: '脱谱',
            note: '他讲脱谱只给一条判据：脱谱之后还能不能连续算清三手。能，是选择；不能，是逃。',
            hint: '两个字的动宾：主语是你，宾语是那本棋谱。',
            rel: [
                { w: '离谱', v: 90, d: '离谱说的也是离开棋谱，但他是从「背不下去」那一侧说的，落点在动作的名字上。' },
                { w: '变着', v: 82, d: '变着是局部的另一种走法，脱谱是把整盘棋带出书外。' },
                { w: '生路', v: 74, d: '生路是陌生局面的口语说法，不是棋评里那两个字。' },
                { w: '背谱', v: 58, d: '背谱正相反，是留在书里不出来。' },
                { w: '定式', v: 44, d: '定式是书本身，不是把书放下。' }
            ]
        },
        {
            id: 'q2',
            ch: '一 · 定式',
            q: '一套开局能不能用，第一标准不是喜不喜欢，而是这套棋走到第几手我还算得动。这两个字，棋评里常用。',
            ans: '算力',
            note: '「我算得动」——超过这个人的计算深度，他就只能靠猜；记得住不等于会下。',
            hint: '不是「会不会」，是「能算到多深」；它有一个大家都认的简称。',
            rel: [
                { w: '算路', v: 91, d: '算路说的是路怎么走，这一问要的是你能算到多深。' },
                { w: '算深', v: 80, d: '算深是它的一个侧面，不是那个名词。' },
                { w: '推演', v: 68, d: '推演是动作，答案是你做这个动作的上限。' },
                { w: '验算', v: 55, d: '验算只是把算过的再看一遍，一小段而已。' },
                { w: '记忆', v: 40, d: '记忆正是他要说「不等于会下」的那一半。' }
            ]
        },
        {
            id: 'q3',
            ch: '二 · 风险',
            q: '十五手的连续冲四，你只验到第十二手。在你验完之前，这条杀在棋评里叫什么？两个字。',
            ans: '假杀',
            note: '没验完的杀不叫杀，叫希望。真正的错误不是没走这条路，是在没验完的杀上赌对手看不见。',
            hint: '前面那个字是否定它成色的一类字：真与假之间，挑一个。',
            rel: [
                { w: '空杀', v: 92, d: '空杀说的是最后成不了，假杀说的是你还没验到底——差在「未验」这一层。' },
                { w: '虚杀', v: 84, d: '虚杀偏「看起来有其实没有」，语感比棋评那个词软。' },
                { w: '错杀', v: 70, d: '错杀是算错了；这里还没到错，只是没验完。' },
                { w: '杀棋', v: 56, d: '杀棋是成形的杀，方向反了。' },
                { w: '希望', v: 46, d: '他的原话是「叫希望」，但棋评里的术语不是这个。' }
            ]
        },
        {
            id: 'q4',
            ch: '二 · 风险',
            q: '对手的杀已经成形，你在盘上找的那一手，专门用来破它。两个字。',
            ans: '防点',
            note: '一手棋的强弱，看它有没有真的解掉那个杀：不是挡个样子，是把对手的变化按回去。',
            hint: '不是「挡」，是那个必须落下的具体位置。',
            rel: [
                { w: '唯一防', v: 90, d: '唯一防是最强的那一种防点，不是这一类东西的名字。' },
                { w: '挡点', v: 82, d: '挡点是挡冲四那一下，防点的范围更大。' },
                { w: '应手', v: 70, d: '应手是被动接住，防点是你主动挑的那一手。' },
                { w: '解杀', v: 58, d: '解杀是结果，防点是落子的那个点。' },
                { w: '反防', v: 46, d: '反防是反过来威胁，不是这一问要的。' }
            ]
        },
        {
            id: 'q5',
            ch: '三 · 对手',
            q: '赛前专为某一个对手准备、他没见过的一套冷门变化。棋评里两个字。',
            ans: '飞刀',
            note: '收益只在信息差上成立：他连我的常用开局都不清楚，冷门的收益才成立；他算力在我之上，冷门只会把我推到更不熟的地方。',
            hint: '一个字是兵器，一个字是会飞的东西；棋评里顺手就用的那个。',
            rel: [
                { w: '冷门', v: 88, d: '冷门是它的属性，不是它本身。' },
                { w: '奇兵', v: 76, d: '奇兵是军语，棋评更爱另一个。' },
                { w: '暗器', v: 64, d: '暗器偏伤人，飞刀偏算计，棋评用的是后者。' },
                { w: '生变', v: 52, d: '生变是没准备过的变化，飞刀是准备过的。' },
                { w: '套路', v: 42, d: '套路是通行的，飞刀是一次性的。' }
            ]
        },
        {
            id: 'q6',
            ch: '四 · 时间',
            q: '只剩三分钟，要走十五手，每手十二秒；对面还剩十二分钟。这个处境，两个字。',
            ans: '读秒',
            note: '先看时间账，再看棋。三分钟走十五手等于每手十二秒；对手十二分钟，够他在局部慢慢找唯一防点。',
            hint: '裁判在边上按表，一步一步报给你的那个动作。',
            rel: [
                { w: '包干', v: 88, d: '包干是赛制，读秒是赛制落到你身上那几秒。' },
                { w: '超时', v: 76, d: '超时是结果，读秒是过程。' },
                { w: '剩余时间', v: 62, d: '说的是账面上的数字，不是那个处境。' },
                { w: '快棋', v: 50, d: '快棋是一种赛制，不是这一刻的状态。' },
                { w: '用时', v: 40, d: '用时是记录表上的一栏。' }
            ]
        },
        {
            id: 'q7',
            ch: '五 · 胜负',
            q: '复盘先打开的那一段：局势第一次不由你掌握的地方。三个字。',
            ans: '胜负处',
            note: '最后那手错棋通常只是结果；前面的让步、时间透支、把可留的资源提前冲掉，才把它逼成唯一选择。',
            hint: '三个字，第三个字是「处」；前两个字是一个词的两半。',
            rel: [
                { w: '转折', v: 90, d: '转折是对的，但棋评里习惯在后面再加一个字，凑成三字。' },
                { w: '关键手', v: 82, d: '关键手可能是赢的那一手，答案要的是「不由我」的那一刻。' },
                { w: '败着', v: 68, d: '败着是那手坏棋，不是那一段局面。' },
                { w: '拐点', v: 54, d: '拐点是通用词，不是棋评术语。' },
                { w: '分水岭', v: 44, d: '分水岭太泛，什么场合都能用。' }
            ]
        },
        {
            id: 'q8',
            ch: '总 · 提要',
            q: '评价一手棋，他不问好不好看，先问走完之后轮到谁。两个字。',
            ans: '先手',
            note: '看起来好的后手棋，等于把主动权送出去，还附赠一份满足感——这是他自认最常犯的错。',
            hint: '不是感觉上的主动，是能点出来的那一步。',
            rel: [
                { w: '主动权', v: 92, d: '主动权是它的长说法，两个字的那个才是术语。' },
                { w: '反先', v: 80, d: '反先是把先手夺回来，是过程不是状态。' },
                { w: '后手', v: 64, d: '后手正相反。' },
                { w: '抢手', v: 52, d: '抢手是动作，答案是你抢到的东西。' },
                { w: '先后', v: 40, d: '先后是顺序，先手是归属。' }
            ]
        },
        {
            id: 'q9',
            ch: '七 · 手筋',
            q: '不急着一次成杀，先连着几手把对手的应手一步步逼少。这个动作，两个字。',
            ans: '做杀',
            note: '先手高于形状：几手下去，对手每次只能应一处，等到他只剩一个防点，杀就成立了。',
            hint: '动词是「做」，宾语是那个还没成立的东西。',
            rel: [
                { w: '追胜', v: 92, d: '追胜是追一个已成的胜势，做杀是把杀做出来。' },
                { w: '连冲', v: 80, d: '连冲是手段，做杀是目的。' },
                { w: 'VCF', v: 66, d: 'VCF 是连续冲四取胜，路子窄，做杀还包括做活三。' },
                { w: '成杀', v: 54, d: '成杀是结果，做杀是之前那几步。' },
                { w: '追杀', v: 42, d: '追杀偏追，做杀偏造。' }
            ]
        },
        {
            id: 'q10',
            ch: '七 · 规则',
            q: '黑棋走出某些形状，直接判负，不用下完。这一类的总称，两个字。',
            ans: '禁手',
            note: '看起来好与实际好在这里分家：形状再漂亮，落在禁手上就是判负，一手都不值。',
            hint: '第一个字是「不许」，第二个字是「你落下的那个东西」。',
            rel: [
                { w: '三三', v: 90, d: '三三是其中一种，不是总称。' },
                { w: '四四', v: 78, d: '四四也是其中一种。' },
                { w: '长连', v: 66, d: '长连是第三种，仍是一项。' },
                { w: '判负', v: 52, d: '判负是后果，不是那一类东西的名字。' },
                { w: '规则', v: 40, d: '规则太大，装得下整本竞赛规程。' }
            ]
        }
    ];

    /* ---------- 归一与相似 ---------- */

    var STOP = '的了是吗呢吧啊呀嘛哦着过和与也就都还又很太在是有个这那你我他她它们';

    function norm(s) {
        if (!s) { return ''; }
        s = String(s).replace(/[\s\u3000]+/g, '').toLowerCase();
        s = s.replace(/[，。、；：？！“”‘’（）《》〈〉「」『』,.;:?!'"()<>\[\]{}·…—\-_/\\|~`@#$%^&*+=]/g, '');
        s = s.replace(/^(我觉得是|我觉得|我认为是|我认为|应该是|可能是|大概是|或许|也许|答案|猜)/, '');
        return s;
    }

    function bigrams(s) {
        var out = [], i;
        if (s.length < 2) { return s ? [s] : []; }
        for (i = 0; i < s.length - 1; i++) { out.push(s.substr(i, 2)); }
        return out;
    }

    function dice(a, b) {
        var A = bigrams(a), B = bigrams(b);
        if (!A.length || !B.length) { return 0; }
        var pool = {}, i, hit = 0;
        for (i = 0; i < A.length; i++) { pool[A[i]] = (pool[A[i]] || 0) + 1; }
        for (i = 0; i < B.length; i++) {
            if (pool[B[i]]) { pool[B[i]]--; hit++; }
        }
        return 2 * hit / (A.length + B.length);
    }

    function shared(a, b) {
        var out = '', i, ch;
        for (i = 0; i < a.length; i++) {
            ch = a.charAt(i);
            if (STOP.indexOf(ch) >= 0 || out.indexOf(ch) >= 0) { continue; }
            if (b.indexOf(ch) >= 0) { out += ch; }
        }
        return out;
    }

    function sim(a, b) {
        if (!a || !b) { return 0; }
        if (a === b) { return 1; }
        var sh = Math.min(a.length, b.length);
        var lg = Math.max(a.length, b.length);
        var ratio = sh / lg;
        if (b.indexOf(a) >= 0) { return 0.62 + 0.14 * ratio; }
        if (a.indexOf(b) >= 0) { return 0.74 + 0.12 * ratio; }
        var d = dice(a, b);
        var common = shared(a, b);
        var jac = common.length / Math.max(1, a.length + b.length - common.length);
        var s = Math.max(d * 0.96, jac * 0.72);
        if (common.length) { s = Math.max(s, 0.34); }
        return Math.min(s, 0.80);
    }

    /* ---------- 评分 ---------- */

    function score(input, item) {
        var g = norm(input);
        var ansW = norm(item.ans);
        if (!g) { return null; }

        if (g === ansW) {
            return { pct: 100, word: g, level: 'ans', rel: null, near: ansW, share: '' };
        }

        var i;
        for (i = 0; i < item.rel.length; i++) {
            if (norm(item.rel[i].w) === g) {
                return {
                    pct: item.rel[i].v, word: g, level: 'rel',
                    rel: item.rel[i], near: item.rel[i].w, share: shared(g, ansW)
                };
            }
        }

        /* 不在表里：按字面落到 6–84，永远低于任何一个相关词的上限 */
        var pool = [{ w: item.ans }].concat(item.rel);
        var best = null;
        for (i = 0; i < pool.length; i++) {
            var s = sim(g, norm(pool[i].w));
            if (!best || s > best.s) { best = { s: s, w: pool[i].w }; }
        }
        var pct = Math.round(6 + 78 * Math.pow(best.s, 0.9));
        pct = Math.max(4, Math.min(84, pct));
        if (g.length === 1) { pct = Math.min(pct, 40); }
        return { pct: pct, word: g, level: 'lax', rel: null, near: best.w, share: shared(g, ansW) };
    }

    function verdict(pct) {
        if (pct >= 100) { return { t: '对了。', s: '就是这个术语。下面是他原话里的意思。', cls: 'ok' }; }
        if (pct >= 88) { return { t: '很近了。', s: '已经在同一条路上，只是还没落到那个词。', cls: 'near' }; }
        if (pct >= 60) { return { t: '沾到边了。', s: '方向挨着，落点还偏。', cls: 'near' }; }
        if (pct >= 35) { return { t: '还远。', s: '有一点关系，多半不是他要说的那一层。', cls: 'off' }; }
        return { t: '不在这一题。', s: '换个方向，别再往这个字上加。', cls: 'low' };
    }

    function points(res) {
        var out = [];
        if (res.level === 'ans') { return out; }
        if (res.level === 'rel') {
            out.push('「' + res.rel.w + '」也在这一条路上，差在：' + res.rel.d);
        } else if (res.pct >= 35) {
            out.push('最接近表里的「' + res.near + '」这一路，还没落到那个词上。');
        } else {
            return out;
        }
        if (res.share && res.share.length) {
            out.push('与答案共用的字：「' + res.share.split('').join('」「') + '」——同一个字，未必同一层意思。');
        }
        return out;
    }

    /* ---------- 每题一份 JSON ---------- */

    function jsonFor(res, item) {
        var cand = [{ word: item.ans, similarity: 100 }];
        item.rel.forEach(function (r) { cand.push({ word: r.w, similarity: r.v }); });
        cand.sort(function (a, b) { return b.similarity - a.similarity; });
        return {
            question: item.id,
            chapter: item.ch,
            prompt: item.q,
            target: item.ans,
            guess: res ? res.word : '',
            similarity: res ? res.pct : null,
            passed: !!(res && res.pct >= 100),
            verdict: res ? verdict(res.pct).t : '',
            candidates: cand
        };
    }

    /* ---------- 对外（供测试与取数） ---------- */

    window.ZXG = { QS: QS, score: score, sim: sim, norm: norm, points: points, verdict: verdict, jsonFor: jsonFor };

    /* ---------- URL 取 JSON：?w=词&q=3 ---------- */

    (function echo() {
        var p, box;
        try { p = new URLSearchParams(location.search); } catch (e) { return; }
        if (!p.has('w')) { return; }
        box = document.getElementById('zx-json-echo');
        if (!box) { return; }
        var qi = parseInt(p.get('q') || '1', 10) - 1;
        if (!(qi >= 0 && qi < QS.length)) { qi = 0; }
        var item = QS[qi];
        var res = score(p.get('w'), item);
        box.hidden = false;
        box.textContent = JSON.stringify(jsonFor(res, item), null, 2);
    })();

    /* ---------- DOM ---------- */

    var root = document.getElementById('zx-game');
    if (!root) { return; }

    var KEY = 'zx-guess-v2';
    var S = { i: 0, best: {}, log: {}, hint: {} };
    try {
        var raw = localStorage.getItem(KEY);
        if (raw) {
            var obj = JSON.parse(raw);
            if (obj && typeof obj === 'object') {
                S.i = Math.min(QS.length - 1, Math.max(0, obj.i || 0));
                S.best = obj.best || {};
                S.log = obj.log || {};
                S.hint = obj.hint || {};
            }
        }
    } catch (e) { /* 隐私模式忽略 */ }

    function save() {
        try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* 忽略 */ }
    }

    var ui = {
        idx: root.querySelector('[data-ui="idx"]'),
        pass: root.querySelector('[data-ui="pass"]'),
        bar: root.querySelector('[data-ui="bar"]'),
        ch: root.querySelector('[data-ui="ch"]'),
        q: root.querySelector('[data-ui="q"]'),
        input: root.querySelector('[data-ui="input"]'),
        go: root.querySelector('[data-ui="go"]'),
        hintBtn: root.querySelector('[data-ui="hint"]'),
        clues: root.querySelector('[data-ui="clues"]'),
        skip: root.querySelector('[data-ui="skip"]'),
        next: root.querySelector('[data-ui="next"]'),
        count: root.querySelector('[data-ui="count"]'),
        hist: root.querySelector('[data-ui="hist"]'),
        res: root.querySelector('[data-ui="res"]')
    };

    function passCount() {
        var n = 0, k;
        for (k in S.best) { if (S.best[k] >= 100) { n++; } }
        return n;
    }

    function fillDots() {
        var box = root.querySelector('[data-ui="dots"]');
        if (!box) { return; }
        var html = '', i;
        for (i = 0; i < QS.length; i++) {
            var b = S.best[QS[i].id] || 0;
            var cls = b >= 100 ? 'is-pass' : (b >= 88 ? 'is-near' : (b > 0 ? 'is-try' : ''));
            if (i === S.i) { cls += ' is-now'; }
            html += '<button type="button" class="' + cls + '" data-jump="' + i +
                '" title="第 ' + (i + 1) + ' 题' + (b ? '：最高 ' + b + '%' : '') + '"></button>';
        }
        box.innerHTML = html;
    }

    function fillHist(item) {
        var list = (S.log[item.id] || []);
        var best = S.best[item.id] || 0;
        if (!list.length) {
            ui.hist.innerHTML = '';
            ui.hist.hidden = true;
        } else {
            var html = '';
            for (var i = 0; i < list.length; i++) {
                var g = list[i];
                var cls = g.p >= 100 ? 'is-pass' : (g.p === best ? 'is-best' : (g.p >= 88 ? 'is-near' : ''));
                html += '<li class="' + cls + '"><span class="zg-hw">' + g.w + '</span>' +
                    '<span class="zg-hp">' + g.p + '%</span></li>';
            }
            ui.hist.innerHTML = html;
            ui.hist.hidden = false;
        }
        var n = list.length;
        var hi = n ? Math.max.apply(null, list.map(function (x) { return x.p; })) : 0;
        ui.count.textContent = n
            ? ('已猜 ' + n + ' 次 · 最高 ' + hi + '%')
            : '一个术语，两三个字。想不起来就点「提示」。';
    }

    /* 相关词：固定打乱次序，避免位置泄露分值 */
    var CLUE_ORDER = [2, 0, 4, 1, 3];

    function fillClues(item) {
        var box = root.querySelector('[data-ui="cluebox"]');
        if (!box) { return; }
        var words = CLUE_ORDER.map(function (k) { return item.rel[k]; });
        box.innerHTML = words.map(function (r) {
            return '<button type="button" class="zg-clue" data-clue="' + r.w + '">' + r.w + '</button>';
        }).join('');
        ui.clues.hidden = !S.hint[item.id];
        ui.hintBtn.textContent = S.hint[item.id] ? '收起提示' : '提示';
    }

    function render() {
        var item = QS[S.i];
        ui.idx.textContent = '第 ' + (S.i + 1) + ' / ' + QS.length + ' 题';
        ui.pass.textContent = '答对 ' + passCount();
        ui.ch.textContent = item.ch;
        ui.q.textContent = item.q;
        ui.input.value = '';
        ui.input.disabled = false;
        ui.res.innerHTML = '';
        ui.res.hidden = true;
        ui.go.hidden = false;
        ui.go.textContent = '猜';
        ui.skip.hidden = false;
        ui.hintBtn.hidden = false;
        ui.next.textContent = (S.i === QS.length - 1) ? '看结果' : '下一题';
        ui.bar.style.width = (S.i + (S.best[item.id] || 0) / 100) / QS.length * 100 + '%';
        fillDots();
        fillHist(item);
        fillClues(item);
        ui.input.focus();
    }

    function jsonBlock(res, item) {
        return '<details class="zg-json"><summary>这道题的相似度 JSON（含正解，点开即视为看答案）</summary>' +
            '<pre>' + JSON.stringify(jsonFor(res, item), null, 2) + '</pre></details>';
    }

    function submit(word) {
        var item = QS[S.i];
        var g = norm(typeof word === 'string' ? word : ui.input.value);
        if (!g) {
            ui.res.innerHTML = '<p class="zg-hint">先写一个术语，两三个字。</p>';
            ui.res.hidden = false;
            return;
        }
        if (g.length > 6) {
            ui.res.innerHTML = '<p class="zg-hint">一次只猜一个术语，最多六个字。写成一整句，就不是这套玩法了。</p>';
            ui.res.hidden = false;
            return;
        }

        var res = score(g, item);
        if (!res) { return; }

        var prevBest = S.best[item.id] || 0;
        if (res.pct > prevBest) { S.best[item.id] = res.pct; }

        var list = S.log[item.id] || (S.log[item.id] = []);
        if (!list.length || list[list.length - 1].w !== g) {
            list.push({ w: g, p: res.pct });
        } else {
            list[list.length - 1].p = Math.max(list[list.length - 1].p, res.pct);
        }
        if (list.length > 12) { list.shift(); }
        save();

        ui.pass.textContent = '答对 ' + passCount();
        ui.bar.style.width = (S.i + (S.best[item.id] || 0) / 100) / QS.length * 100 + '%';
        fillDots();
        fillHist(item);

        var v = verdict(res.pct);
        var html = '';
        html += '<div class="zg-pct zg-pct--' + v.cls + '"><b>' + res.pct + '</b><i>%</i></div>';
        html += '<p class="zg-verdict"><b>' + v.t + '</b>' + v.s + '</p>';
        var pts = points(res);
        if (pts.length) {
            html += '<ul class="zg-pts">' + pts.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul>';
        }
        if (res.pct >= 100) {
            html += '<div class="zg-ref"><h4>答案</h4><p class="zg-ansi">「' + item.ans + '」</p><p>' + item.note + '</p></div>';
            ui.input.disabled = true;
            ui.go.hidden = true;
            ui.skip.hidden = true;
            ui.hintBtn.hidden = true;
            ui.clues.hidden = true;
            ui.next.classList.add('is-hot');
        } else {
            if (res.pct < 88) {
                html += '<p class="zg-hint">' + item.hint + '</p>';
                S.hint[item.id] = true;
                fillClues(item);
            }
            ui.next.classList.remove('is-hot');
        }
        html += jsonBlock(res, item);
        ui.res.innerHTML = html;
        ui.res.hidden = false;
        ui.input.select();
    }

    ui.go.addEventListener('click', function () { submit(); });

    ui.hintBtn.addEventListener('click', function () {
        var item = QS[S.i];
        S.hint[item.id] = !S.hint[item.id];
        save();
        fillClues(item);
        if (S.hint[item.id]) { ui.clues.scrollIntoView({ block: 'nearest' }); }
    });

    root.addEventListener('click', function (e) {
        var jump = e.target.closest ? e.target.closest('[data-jump]') : null;
        if (jump) {
            S.i = parseInt(jump.getAttribute('data-jump'), 10) || 0;
            save();
            render();
            return;
        }
        var clue = e.target.closest ? e.target.closest('[data-clue]') : null;
        if (clue) {
            var w = clue.getAttribute('data-clue');
            ui.input.value = w;
            submit(w);
        }
    });

    ui.skip.addEventListener('click', function () {
        var item = QS[S.i];
        ui.res.innerHTML = '<div class="zg-ref"><h4>答案（不计分）</h4><p class="zg-ansi">「' + item.ans + '」</p><p>' + item.note + '</p></div>' +
            jsonBlock(null, item);
        ui.res.hidden = false;
        ui.go.hidden = true;
        ui.skip.hidden = true;
        ui.hintBtn.hidden = true;
        ui.clues.hidden = true;
        ui.next.classList.add('is-hot');
        ui.input.disabled = true;
    });

    ui.next.addEventListener('click', function () {
        ui.next.classList.remove('is-hot');
        if (S.i === QS.length - 1) { finalPanel(); return; }
        S.i++;
        save();
        render();
    });

    ui.input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.isComposing) {
            e.preventDefault();
            submit();
        }
    });

    function finalPanel() {
        var n = passCount(), sum = 0, c = 0, k;
        for (k in S.best) { sum += S.best[k]; c++; }
        var avg = c ? sum / c : 0;
        var words;
        if (n >= QS.length) {
            words = '十题全对。这些不是词，是他讲话时脚下的那块地——他一开口，你大概知道他要往哪落。';
        } else if (n >= 7) {
            words = '大半对了。没答对的那几题，多半是他最不爱承认的部分：讲对手、讲自己、讲运气。';
        } else if (n >= 4) {
            words = '过了一半上下。这不是考试，是认路：把这些术语记住，再读那二十六条，原文会突然变得很短。';
        } else if (n >= 1) {
            words = '刚开了个头。每题都能再猜，点「提示」会给出这一题的几个相关词——它们离答案的远近各不相同。';
        } else {
            words = '一个也没答对，不急。术语是要遇见的：先翻一遍二十题习题，再回来，很多词你会觉得眼熟。';
        }
        var html = '';
        html += '<div class="zg-final">';
        html += '<div class="zg-final-n"><b>' + n + '</b><span>/ ' + QS.length + ' 答对</span></div>';
        html += '<div class="zg-final-a"><b>' + avg.toFixed(0) + '</b><span>% 平均最高分（已猜 ' + c + ' 题' + (c < QS.length ? '，其余未猜' : '') + '）</span></div>';
        html += '<p class="zg-final-t">' + words + '</p>';
        html += '<div class="zg-final-b"><button type="button" class="zg-btn" data-act="restart">从头再猜</button></div>';
        html += '</div>';
        ui.res.innerHTML = html;
        ui.res.hidden = false;
        ui.ch.textContent = '结果';
        ui.q.textContent = '十题走完。';
        ui.input.hidden = true;
        ui.go.hidden = true;
        ui.hintBtn.hidden = true;
        ui.skip.hidden = true;
        ui.next.hidden = true;
        ui.hist.hidden = true;
        ui.count.hidden = true;
        ui.clues.hidden = true;
        var kb = root.querySelector('.zg-keys');
        if (kb) { kb.hidden = true; }
        ui.bar.style.width = '100%';
        ui.res.querySelector('[data-act="restart"]').addEventListener('click', function () {
            S = { i: 0, best: {}, log: {}, hint: {} };
            save();
            ui.input.hidden = false;
            ui.count.hidden = false;
            ui.next.hidden = false;
            if (kb) { kb.hidden = false; }
            render();
        });
    }

    render();
})();
