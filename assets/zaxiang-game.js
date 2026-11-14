/* ==========================================================================
   杂想 · 小游戏「猜一句，看差几里」
   --------------------------------------------------------------------------
   玩法改成猜词：每题只答两三个字，页面返回与「本题答案（一组说法）」的
   相似百分比，以及相似点。可以一直猜，一轮轮往上逼近；≥ 95% 算摸到，
   揭示他那句话；< 90% 只给一句模糊的方向，不告诉差在哪。

   评分：每题答案不是一个词，而是一组候选说法 cand[]（各带权重分值 v）。
   用户输入 g 与每个候选做字面相似 sim()（全等 / 包含 / 字二元组 Dice /
   共字），得分 = v × (0.35 + 0.65 × sim)，取最高者。
   所以同义的说法都能拿到 95 上下，边缘方向落在 60–85，无关在 40 以下。
   纯前端，无请求，进度存 localStorage。
   ========================================================================== */

(function () {
    'use strict';

    /* ---------- 题库 ---------- */

    var QS = [
        {
            id: 'g1',
            ch: '题记',
            q: '全篇他反复只讲一个动作，比「算」和「忍」都靠前。用一个字说它。',
            ans: '停',
            hint: '不是情绪上的稳，也不是多算几手；是一个让「算」变得有意义的空档。',
            ref: '题记那一句：停一下。很多棋不是算错，是没停——没停就开了算不清的局，没停就在出杀前一手出了鬼招。停不是不动，是先把这一步断开，看清条件再动。',
            cand: [
                { w: '停', v: 99, say: '就是动手之前那一下「先别动」：断开，才看得见条件。', gap: '' },
                { w: '止', v: 95, say: '同一件事的另一种说法：承认此刻不该再往下走。', gap: '' },
                { w: '缓', v: 88, say: '方向接近，但缓只是把速度放慢，停是把这一步断掉。', gap: '差一层：缓还是同一条路，只是走得慢；停是暂时离开这条路。' },
                { w: '冷静', v: 74, say: '沾到了心理那一侧，可冷是情绪，停是动作。', gap: '差一层：情绪稳下来，不等于手上停一下。' },
                { w: '想', v: 64, say: '想是停之后才发生的事。', gap: '差一层：你给的是「怎么想」，他要的是「先别动」。' },
                { w: '忍', v: 62, say: '忍是压住冲动，停是不让冲动发生。', gap: '差一层：忍还带着「想下但不能下」，停是根本不急着下。' }
            ]
        },
        {
            id: 'g2',
            ch: '一 · 定式',
            q: '一套开局该不该用，第一标准不是喜不喜欢。两个字：看什么？',
            ans: '算力',
            hint: '不是背了多少，是背完之后还能接着算多少。',
            ref: '「我算得动」——这套棋走到第几手脱离棋谱，之后每手要算多深。超过这个人的计算深度，他就只能靠猜；记得住不等于会下。',
            cand: [
                { w: '算力', v: 99, say: '这套棋走到第几手我还算得动——超过那条线，背下来的东西就不算我的。', gap: '' },
                { w: '计算', v: 95, say: '几乎同一件事，只是没点出「有深浅」这一层。', gap: '' },
                { w: '算得动', v: 96, say: '他本人的说法，比名词更贴。', gap: '' },
                { w: '深度', v: 84, say: '说的是算力里的那根线，不是全部。', gap: '差一层：深度是那条线，算力是站在线这边的人。' },
                { w: '熟练', v: 78, say: '熟练是算力的结果，不是判据。', gap: '差一层：熟是背下来的部分，题目问的是背完之后还能算的部分。' },
                { w: '记忆', v: 64, say: '记忆恰恰是他不信任的那样东西。', gap: '差一层：记得住是他要说「不等于会下」的那一半。' }
            ]
        },
        {
            id: 'g3',
            ch: '一 · 定式',
            q: '冷门开局凭什么能赢？那份收益从哪来？三个字。',
            ans: '信息差',
            hint: '不是这套棋强，是他没准备。',
            ref: '收益只在信息差上成立：如果他连我的常用开局都不清楚，冷门的收益才成立；如果他算力明显在我之上，冷门只会把局面推到我更不熟的地方。',
            cand: [
                { w: '信息差', v: 99, say: '他连我的常用开局都不清楚，冷门的收益才成立。', gap: '' },
                { w: '他不知道', v: 93, say: '同一件事的口语版，方向没错。', gap: '差一层：不是「他不知道」这么笼统，是「他和我之间知道的多少不一样」。' },
                { w: '陌生', v: 80, say: '陌生是双向的，收益只在单侧。', gap: '差一层：局面陌生对两边都成立；收益只在你比他多知道一点时才有。' },
                { w: '冷门', v: 72, say: '冷门是手段，不是收益。', gap: '差一层：你答的是「用什么」，问的是「凭什么管用」。' },
                { w: '研究', v: 62, say: '研究是准备的动作，不是收益本身。', gap: '差一层：研究过的人拿到的正是这个差，但方向要落在「差」上。' }
            ]
        },
        {
            id: 'g4',
            ch: '二 · 风险',
            q: '一条十五手的连续冲四，你只验到第十二手。他说，这时候它已经不叫杀了——那它叫什么？两个字。',
            ans: '希望',
            hint: '不是「杀不杀」的问题，是你手上有没有把它验完。',
            ref: '没验完的杀不叫杀，叫希望。而真正的错误不是没走这条路，是在没验完的杀上赌对手看不见。',
            cand: [
                { w: '希望', v: 99, say: '他的原话：没验完的杀不叫杀，叫希望。', gap: '' },
                { w: '假杀', v: 94, say: '术语上站得住，也点出了「未验」这一层。', gap: '' },
                { w: '没算完', v: 90, say: '说的是同一个状态，只是没有他那句的锋利。', gap: '' },
                { w: '空想', v: 86, say: '意思很近，只是他讲得更客气一点。', gap: '差一层：空想是说根本没有；希望是说还差三步没验，舍不得放。' },
                { w: '赌博', v: 76, say: '沾到了赌，但赌说的是心态，不是这条棋的性质。', gap: '差一层：赌是你选的动作，希望是这条棋现在的位置。' }
            ]
        },
        {
            id: 'g5',
            ch: '二 · 风险',
            q: '评价一手棋，他不问好不好看，先问一句。两个字。',
            ans: '先手',
            hint: '不是形状，是走完之后轮到谁。',
            ref: '走完之后谁先手。看起来好的后手棋，等于把主动权送出去，还附赠一份满足感——这是他自认最常犯的错。',
            cand: [
                { w: '先手', v: 99, say: '走完之后谁先手——形状再好看，后手就是后手。', gap: '' },
                { w: '主动权', v: 95, say: '同一件事的长说法。', gap: '' },
                { w: '主动', v: 88, say: '方向对，还差一个字的那层具体。', gap: '差一层：主动是感觉，先手是能点出来的那一手。' },
                { w: '轮到谁', v: 84, say: '问法很准，只是不太像术语。', gap: '差一层：你问对了，答案本身是那个词。' },
                { w: '形状', v: 58, say: '形状正是他要往后放的那一样。', gap: '差一层：形状是问完之后才看的东西。' }
            ]
        },
        {
            id: 'g6',
            ch: '三 · 对手',
            q: '同一套变化，你下能赢，队友下就输。差的不在棋上——两个字。',
            ans: '因人',
            hint: '三样里两样写在棋谱上，一样要一起下过才看得见。',
            ref: '同一套棋本身没有对错，只有配错了人：算力、风格、耐心，三样里有一样不配，这套棋在他手上就是另一套。',
            cand: [
                { w: '因人', v: 99, say: '棋是同一套，人是不同的人——同一个答案配错人就作废。', gap: '' },
                { w: '配人', v: 95, say: '同一层意思，说法更口语。', gap: '' },
                { w: '挑人', v: 90, say: '方向对，带一点「先选人」的主动。', gap: '' },
                { w: '风格', v: 82, say: '风格是三样里的一样，不是全部。', gap: '差一层：风格只是一条，算力和耐心同样会让人输。' },
                { w: '算力', v: 78, say: '算力也是那三样里的一条。', gap: '差一层：只答一样，就漏了「配错」这个动作。' },
                { w: '适合', v: 74, say: '说的是结果，没说清在哪儿适合。', gap: '差一层：适合是一句话的结论，题目要的是那句结论背后的那层。' }
            ]
        },
        {
            id: 'g7',
            ch: '四 · 时间',
            q: '只剩三分钟，要走一条十五手的杀。他说，你最先算的不是棋。两个字。',
            ans: '时间',
            hint: '三分钟走十五手，等于每手十二秒；而另一边还剩十二分钟。',
            ref: '先看时间账，再看棋。三分钟走十五手，每手十二秒；对手还有十二分钟，他能在局部慢慢找唯一防点，找到一个，你前面十二手全白费。',
            cand: [
                { w: '时间', v: 99, say: '时间也是棋的一部分，而且它跟棋是加在一起算的。', gap: '' },
                { w: '时间账', v: 97, say: '更准的说法：不是时间本身，是账。', gap: '' },
                { w: '读秒', v: 88, say: '读秒是那笔账最紧的一段，不是全账。', gap: '差一层：读秒只算自己，那笔账里还有对手剩多少。' },
                { w: '预算', v: 84, say: '方向对，偏财务的说法，意思到了。', gap: '差一层：预算说的是你打算花多少，账说的是两个人各剩多少。' },
                { w: '对手', v: 74, say: '对手的时间确实是账的一半。', gap: '差一层：只算对手，漏了自己这三分钟。' },
                { w: '速度', v: 66, say: '速度是这个账算完之后的结论。', gap: '差一层：快慢不是原因，是算完账才有的判断。' }
            ]
        },
        {
            id: 'g8',
            ch: '五 · 胜负',
            q: '一盘该赢的棋输了。复盘时最先打开的不是最后一手。两个字。',
            ans: '转折',
            hint: '错棋不会凭空出现，它前面一定有一手把它逼成唯一选择。',
            ref: '先找转折点，也就是局势第一次不由你掌握的那一手。最后那手错棋通常只是结果：前面的让步、时间透支、把可留的资源提前冲掉，才把它逼成唯一选择。',
            cand: [
                { w: '转折', v: 99, say: '局势第一次不由你掌握的那一手，才是要打开的那一段。', gap: '' },
                { w: '拐点', v: 95, say: '同一件事的另一种叫法。', gap: '' },
                { w: '关键手', v: 91, say: '方向对，但关键手不一定是转折点。', gap: '差一层：关键手可能是赢的那一手，也可能是输的那一手；要找的是「不由我」。' },
                { w: '第一次', v: 86, say: '你说到了它的位置：第一次。', gap: '差一层：第一次什么？第一次失控——那个东西有个名字。' },
                { w: '错棋', v: 62, say: '错棋是结果，不是入口。', gap: '差一层：错棋正是你说「不是它」的那一样。' }
            ]
        },
        {
            id: 'g9',
            ch: '总 · 提要',
            q: '他几乎不给通用结论。那他给什么？两个字。',
            ans: '条件',
            hint: '同一个问题，他总要先问三样：对谁、我算不算得动、这一局值多少。',
            ref: '棋理是条件的函数：同一手棋的强弱，取决于对面是谁、我算不算得动、这一局是比赛还是推广。所以他不给通用结论，只给条件。',
            cand: [
                { w: '条件', v: 99, say: '对谁、在哪一档算力下、什么场合——他每次都先补齐这三样。', gap: '' },
                { w: '前提', v: 93, say: '同一层意思，语气更硬一点。', gap: '' },
                { w: '因人', v: 86, say: '因人只是三样里的第一样。', gap: '差一层：还有算力和场合；只答人，还是给了一个通用结论。' },
                { w: '看情况', v: 80, say: '方向对，但这四个字本身太滑，什么都能套。', gap: '差一层：他不是「看情况」，是说得出看哪几样。' },
                { w: '场合', v: 74, say: '场合是三样里的一样。', gap: '差一层：漏了人，也漏了算力。' },
                { w: '具体', v: 66, say: '具体是形容词，没说出具体在哪。', gap: '差一层：落到哪几样上，才叫具体。' }
            ]
        },
        {
            id: 'g10',
            ch: '总 · 提要',
            q: '状态不可靠，眼力不可靠。他说只有一样靠得住——两个字。',
            ans: '流程',
            hint: '不是「下次注意」，是「下次还照这个顺序走一遍」。',
            ref: '能重复的才算能力。只有流程可靠：固定的检查顺序、固定的复盘动作、固定的练习量。凡是「下次注意」能解决的，其实都没解决。',
            cand: [
                { w: '流程', v: 99, say: '固定的检查顺序、固定的复盘动作、固定的练习量——可重复的那一套。', gap: '' },
                { w: '重复', v: 95, say: '说的正是「能重复的才算能力」这半句。', gap: '' },
                { w: '固定', v: 88, say: '固定是流程的属性，不是流程本身。', gap: '差一层：固定说的是它不变，流程说的是它由几步组成。' },
                { w: '习惯', v: 80, say: '习惯接近，但习惯可以是坏的。', gap: '差一层：习惯不保证对，流程是验过对的那一套。' },
                { w: '复盘', v: 76, say: '复盘只是流程里的一步。', gap: '差一层：复盘是一个动作，流程是一串动作的顺序。' },
                { w: '练习', v: 70, say: '练习也是流程里的一步。', gap: '差一层：练多少是量，按什么顺序练才是流程。' }
            ]
        }
    ];

    /* ---------- 归一与相似 ---------- */

    var STOP = '的了是吗呢吧啊呀嘛哦着过和与也就都还又很太在是有个这那你我他她它们';

    function norm(s) {
        if (!s) { return ''; }
        s = String(s).replace(/[\s\u3000]+/g, '');
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
        if (b.indexOf(a) >= 0) {
            /* 猜的是备选说法的一个碎片，比整词弱 */
            return 0.62 + 0.14 * ratio;
        }
        if (a.indexOf(b) >= 0) {
            /* 猜的句子/长词里含着备选说法，比整词弱一点 */
            return 0.74 + 0.12 * ratio;
        }
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
        var best = null;
        for (var i = 0; i < item.cand.length; i++) {
            var c = item.cand[i];
            var s = sim(g, norm(c.w));
            var p = (s >= 1) ? c.v : c.v * (0.10 + 0.90 * Math.pow(s, 0.85));
            if (!best || p > best.raw) { best = { raw: p, s: s, c: c }; }
        }
        var pct = Math.max(0, Math.min(99, Math.round(best.raw)));
        /* 单字不成词：除非正对上一个单字答案，否则封顶 55 */
        if (g.length === 1 && best.s < 1) { pct = Math.min(pct, 55); }
        return {
            pct: pct,
            word: g,
            cand: best.c,
            s: best.s,
            share: shared(g, norm(best.c.w)),
            ans: norm(item.ans)
        };
    }

    function verdict(pct) {
        if (pct >= 95) { return { t: '摸到了。', s: '这就是他那个词。下面是他原话里的意思。', cls: 'ok' }; }
        if (pct >= 88) { return { t: '很近了。', s: '方向对，还差一层没点破。', cls: 'near' }; }
        if (pct >= 70) { return { t: '沾到边了。', s: '大概在同一片区域，但落点偏了一点。', cls: 'near' }; }
        if (pct >= 45) { return { t: '还远。', s: '有一点关系，多半不是他要说的那一层。', cls: 'off' }; }
        return { t: '不在这一题。', s: '换个方向，别再往这个字上加。', cls: 'low' };
    }

    function points(res) {
        var out = [];
        var same = res.word === norm(res.cand.w);
        if (res.pct < 45) {
            /* 太远，没什么可比的 */
            return out;
        }
        if (res.pct >= 95) {
            out.push('就是这个方向：' + res.cand.say);
        } else if (same) {
            out.push('「' + res.cand.w + '」在本题只是相邻的一路：' + res.cand.say);
        } else {
            out.push('最近的是「' + res.cand.w + '」这一路：' + res.cand.say);
        }
        if (!same && res.pct < 95 && res.share && res.share.length) {
            out.push('共用的字：「' + res.share.split('').join('」「') + '」——同一个字，未必同一层意思。');
        }
        if (res.pct < 95 && res.pct >= 70 && res.cand.gap) {
            out.push(res.cand.gap);
        }
        return out;
    }

    /* ---------- 对外（供测试） ---------- */

    window.ZXG = { QS: QS, score: score, sim: sim, norm: norm, points: points, verdict: verdict };

    /* ---------- DOM ---------- */

    var root = document.getElementById('zx-game');
    if (!root) { return; }

    var KEY = 'zx-guess-v1';
    var S = { i: 0, best: {}, log: {} };
    try {
        var raw = localStorage.getItem(KEY);
        if (raw) {
            var obj = JSON.parse(raw);
            if (obj && typeof obj === 'object') {
                S.i = Math.min(QS.length - 1, Math.max(0, obj.i || 0));
                S.best = obj.best || {};
                S.log = obj.log || {};
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
        skip: root.querySelector('[data-ui="skip"]'),
        next: root.querySelector('[data-ui="next"]'),
        count: root.querySelector('[data-ui="count"]'),
        hist: root.querySelector('[data-ui="hist"]'),
        res: root.querySelector('[data-ui="res"]')
    };

    function passCount() {
        var n = 0, k;
        for (k in S.best) { if (S.best[k] >= 95) { n++; } }
        return n;
    }

    function dotsEl() { return root.querySelector('[data-ui="dots"]'); }

    function fillDots() {
        var box = dotsEl();
        if (!box) { return; }
        var html = '', i;
        for (i = 0; i < QS.length; i++) {
            var b = S.best[QS[i].id] || 0;
            var cls = b >= 95 ? 'is-pass' : (b >= 88 ? 'is-near' : (b > 0 ? 'is-try' : ''));
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
                var cls = g.p >= 95 ? 'is-pass' : (g.p === best ? 'is-best' : (g.p >= 70 ? 'is-near' : ''));
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
            : '还没猜过。两三个字就够，不必写成句子。';
    }

    function render() {
        var item = QS[S.i];
        ui.idx.textContent = '第 ' + (S.i + 1) + ' / ' + QS.length + ' 题';
        ui.pass.textContent = '摸到 ' + passCount();
        ui.ch.textContent = item.ch;
        ui.q.textContent = item.q;
        ui.input.value = '';
        ui.input.disabled = false;
        ui.res.innerHTML = '';
        ui.res.hidden = true;
        ui.go.hidden = false;
        ui.go.textContent = '猜';
        ui.skip.hidden = false;
        ui.next.textContent = (S.i === QS.length - 1) ? '看结果' : '下一题';
        ui.bar.style.width = (S.i + (S.best[item.id] || 0) / 100) / QS.length * 100 + '%';
        fillDots();
        fillHist(item);
        ui.input.focus();
    }

    function reveal(item, title) {
        return '<div class="zg-ref"><h4>' + title + '</h4><p class="zg-ansi">「' + item.ans + '」</p><p>' + item.ref + '</p></div>';
    }

    function submit() {
        var item = QS[S.i];
        var g = norm(ui.input.value);
        if (!g) {
            ui.res.innerHTML = '<p class="zg-hint">先写一个词，两个字最好。</p>';
            ui.res.hidden = false;
            return;
        }
        if (g.length > 6) {
            ui.res.innerHTML = '<p class="zg-hint">一次只猜一个词，最多六个字。写成一句话，就不是猜词了。</p>';
            ui.res.hidden = false;
            return;
        }

        var res = score(g, item);
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

        ui.pass.textContent = '摸到 ' + passCount();
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
        if (res.pct >= 95) {
            html += reveal(item, '答案');
            ui.input.disabled = true;
            ui.go.hidden = true;
            ui.skip.hidden = true;
            ui.next.classList.add('is-hot');
        } else {
            /* 九十以下才给模糊方向；九十到九十四只留上面的相似点 */
            if (res.pct < 90) {
                html += '<p class="zg-hint">' + item.hint + '</p>';
            }
            ui.next.classList.remove('is-hot');
        }
        ui.res.innerHTML = html;
        ui.res.hidden = false;
        ui.input.select();
    }

    ui.go.addEventListener('click', submit);

    ui.skip.addEventListener('click', function () {
        var item = QS[S.i];
        ui.res.innerHTML = '<div class="zg-ref"><h4>答案（不计分）</h4><p class="zg-ansi">「' + item.ans + '」</p><p>' + item.ref + '</p></div>';
        ui.res.hidden = false;
        ui.go.hidden = true;
        ui.skip.hidden = true;
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

    root.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('[data-jump]') : null;
        if (!btn) { return; }
        S.i = parseInt(btn.getAttribute('data-jump'), 10) || 0;
        save();
        render();
    });

    function finalPanel() {
        var n = passCount(), sum = 0, c = 0, k;
        for (k in S.best) { sum += S.best[k]; c++; }
        var avg = c ? sum / c : 0;
        var words;
        if (n >= QS.length) {
            words = '十题全摸到。说明你已经不是在猜词，而是在猜他的条件——他一开口，你大概知道他要往哪落。往下读那二十六条，会比第一遍快得多。';
        } else if (n >= 7) {
            words = '大半摸到了。没摸到的那几题，多半是他最不爱承认的部分：讲对手、讲自己、讲运气。回去把对应章节重读一遍再猜，会比在这儿硬凑快。';
        } else if (n >= 4) {
            words = '过了一半上下。这不是考试，是认路：把这些词记住，再读那二十六条，原文会突然变得很短。';
        } else if (n >= 1) {
            words = '刚刚上手。别急着往下猜，先看一眼提示里的方向——这些题考的不是词汇量，是他把哪两样东西搁在一起说。';
        } else {
            words = '猜得少，说明这些词还没进你的手。别急，从「题记」那一题往回走一遍，每题看一眼提示再猜。';
        }
        var html = '';
        html += '<div class="zg-final">';
        html += '<div class="zg-final-n"><b>' + n + '</b><span>/ ' + QS.length + ' 摸到</span></div>';
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
        ui.skip.hidden = true;
        ui.next.hidden = true;
        ui.hist.hidden = true;
        ui.count.hidden = true;
        var kb = root.querySelector('.zg-keys');
        if (kb) { kb.hidden = true; }
        ui.bar.style.width = '100%';
        ui.res.querySelector('[data-act="restart"]').addEventListener('click', function () {
            S = { i: 0, best: {}, log: {} };
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
