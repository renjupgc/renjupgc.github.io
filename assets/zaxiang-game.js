/* ==========================================================================
   杂想 · 小游戏「答一句，看像不像」
   --------------------------------------------------------------------------
   十道开放题，没有唯一答案：每题给一份参考答案，把答案拆成若干「要点」
   （keys，带权重）。评分 = 0.8 × 要点覆盖 + 0.2 × 表达贴近。
   要点覆盖用同义形式组匹配，并排除「不考虑对手」这类否定句的误命中；
   表达贴近用字符 bigram 的 F1，放大一倍后封顶，只作微调。
   ≥ 95% 判过，显示参考答案与逐点对照；< 90% 只给模糊提示，不给答案。
   纯前端，无请求、无后端，进度存 localStorage。
   ========================================================================== */

(function () {
    'use strict';

    /* ---------- 题库 ---------- */

    var QS = [
        {
            id: 'q1',
            ch: '一 · 定式',
            q: '赛前十分钟，你才知道对手是谁。你手上有一套背得极熟的开局，也有一套自己只下过两三盘、但据你所知对方从没见过的冷门开局。你选哪一套？先说你的判断依据，再说你怎么在两套之间取舍。',
            ref: [
                '选哪套都不是关键，关键是先量三个数。',
                '第一，自己的熟练度：这套棋我能不能不看棋谱走到第十手，并且第十手之后自己算得动。',
                '第二，对手的信息量：我对他知道多少。如果他连我的常用开局都不清楚，冷门的收益才成立；如果他算力明显在我之上，冷门只会把局面推到我更不熟的地方。',
                '第三，这盘棋的期望值：是必须赢，还是不能输。必须赢，才值得冒信息差的风险；不能输时，熟的那套即使被研究过，也比生的那套稳。',
                '所以「熟」与「冷」不是两个流派，是同一道题的两种答案；条件变了，答案就变。'
            ],
            keys: [
                { w: 3, f: ['熟练', '熟不熟', '算得动', '算得清', '背得', '记得住', '把握', '熟记', '会不会下', '下得来'] },
                { w: 3, f: ['信息差', '对方不了解', '他没见过', '从没见过', '知道多少', '研究过', '了解对手', '对他了解', '他不了解我', '他不知道我', '知不知道我', '不清楚我', '不熟悉我'] },
                { w: 2, f: ['必须赢', '不能输', '期望', '目标', '输不起', '值不值'] },
                { w: 2, f: ['风险', '收益', '取舍', '权衡', '代价', '赌', '冒险', '划得来'] },
                { w: 2, f: ['看情况', '取决于', '条件', '因人', '不绝对', '没有标准'] }
            ],
            hint: '先量自己，再量对手，最后量这一盘棋值多少。三样都要量，只量一样就会选错。'
        },
        {
            id: 'q2',
            ch: '二 · 风险',
            q: '中盘，你算出两条路。A 是一条十五手的连续冲四，你已经验到第十二手，后面三步只是「看起来能成」；B 是一手能把优势再扩大一点、但不成杀的棋。你只剩三分钟，对手还有十二分钟。你走哪条？',
            ref: [
                '先看时间账，再看棋。',
                '三分钟要走完十五手，等于每手十二秒；而这条路的最后三步你还没验过——没验完的杀不叫杀，叫希望。',
                '对手有十二分钟，他可以在局部慢慢找唯一防点，只要找到一个，你前面十二手全部白费，还赔上了时间。',
                '所以顺序是：先用剩余时间把 A 的最后三步验完；验不完，就走 B。B 的作用不是等，是把先手留住，并且把对手的时间也吃掉——他要应对，同样要花时间。',
                '真正的错误不是选了 B，是在没验完的杀上赌对手看不见。'
            ],
            keys: [
                { w: 3, f: ['时间', '三分钟', '不够', '每手', '预算', '读秒', '来不及', '算时间', '没时间', '时间不够用'] },
                { w: 3, f: ['没验', '验完', '没算完', '没算清', '不确定', '希望', '只是看起来'] },
                { w: 2, f: ['对手的时间', '他也', '对方时间', '耗', '慢慢找', '找防点', '他也得想', '他也花时间'] },
                { w: 1, f: ['先手', '主动', '留住', '主导'] },
                { w: 1, f: ['侥幸', '赌', '指望', '看不见', '运气'] }
            ],
            hint: '时间也是棋的一部分，而且它跟棋是加在一起算的。先把两样东西各自的账算清，再决定走哪条。'
        },
        {
            id: 'q3',
            ch: '三 · 对手',
            q: '同一套变化，你下能赢，你的队友下就输。请给出你判断「这套棋适合谁」的依据——至少三条，并说明哪一条最容易被忽略。',
            ref: [
                '至少要看三样。',
                '一是算力：这套棋在第几手脱离记忆、之后每手要算多深；超过这个人的计算深度，他就只能靠猜。',
                '二是风格：有人愿意在封闭局面里慢慢磨，有人一见复杂就兴奋；同一套棋给错风格的人，他会主动把局面走成自己不会的样子。',
                '三是耐心与心理：需要长时间忍耐的棋，给一个坐不住的人，等于让他提前认输。',
                '最容易忽略的是第三条——算力和风格都能在棋谱上看出来，耐心看不出来，只有一起下过、输过、被拖到过最后一分钟才知道。',
                '所以同一套棋本身没有对错，只有配错了人。'
            ],
            keys: [
                { w: 3, f: ['算力', '计算深度', '算得动', '算不动', '算不清', '算多深', '计算力', '算不到那么深', '算不下来'] },
                { w: 2, f: ['风格', '棋风', '偏好', '喜欢', '性子', '爱乱', '爱稳'] },
                { w: 2, f: ['耐心', '心理', '坐得住', '坐不住', '忍耐', '抗压', '情绪'] },
                { w: 2, f: ['最容易忽略', '最易忽略', '看不出来', '只有一起下', '看不见的是'] },
                { w: 1, f: ['因人', '不同的人', '适合', '人不一样', '看人', '配错', '配对'] }
            ],
            hint: '三样里有两样写在棋谱上，一样要一起下过才看得见。题目问的正是那一样。'
        },
        {
            id: 'q4',
            ch: '五 · 胜负',
            q: '一盘本该赢的棋输了。复盘时你最先打开的是哪一段？为什么不是最后那手错棋？',
            ref: [
                '先找转折点，也就是局势第一次不由你掌握的那一手，而不是最后一次失手。',
                '理由有三：最后那手错棋通常只是结果，前面的让步、时间透支、把可留的资源提前冲掉，才把它逼成唯一选择；从结果倒推，容易只记住「这里不该这么走」，换个局面照样犯；而找到转折点，能顺手查出当时的判断依据是什么——是没算、算错，还是根本没打算算。',
                '真正的复盘产物不是「下次注意」，是「这个局面前我该先看什么」。'
            ],
            keys: [
                { w: 3, f: ['转折', '第一次', '拐点', '从哪开始', '局势变', '不由我', '关键手'] },
                { w: 3, f: ['只是结果', '不是根本', '表象', '症状', '最后那手', '结果倒推', '只是个结果', '表面上'] },
                { w: 2, f: ['透支', '资源', '提前', '冲掉', '让步', '逼成'] },
                { w: 1, f: ['依据', '当时想', '判断', '动机', '为什么这么'] },
                { w: 1, f: ['产物', '清单', '检查', '可执行', '下次注意'] }
            ],
            hint: '错棋不会凭空出现。它前面一定有一手，让它变成了唯一的选择——先找那一手。'
        },
        {
            id: 'q5',
            ch: '一 · 定式',
            q: '你打算在一盘正式比赛里脱谱。请给一个别人能用的判据：什么情况下脱谱是选择，什么情况下是逃。',
            ref: [
                '判据只有一条，但要能当场验：脱谱之后，我还能不能连续算清三手。',
                '能，脱谱是选择——我在用自己算得动的东西，换掉背过的东西，局面仍在我手上。',
                '不能，脱谱是逃——我背不下去了，于是把局面推到一个自己也不熟的地方，等于把胜负交给运气。',
                '再加两个辅助条件：脱谱前手上要有一个后备计划，最差也能回到能守的形状；脱谱的时机最好在对方也脱离记忆之后，否则你脱的是自己的谱，他走的还是他的谱。'
            ],
            keys: [
                { w: 4, f: ['算得清', '算得动', '还能算', '连续算', '连算', '计算', '算三手', '会不会下'] },
                { w: 2, f: ['选择', '逃', '被迫', '背不下去', '躲', '硬脱'] },
                { w: 2, f: ['后备', '退路', '最差', '能守', '保底', '计划', '兜底'] },
                { w: 1, f: ['时机', '对方也', '同时', '等对方', '他也脱'] }
            ],
            hint: '问的不是「敢不敢脱」，是「脱了之后手上还剩下什么」。剩下的那个东西，决定这是选择还是逃。'
        },
        {
            id: 'q6',
            ch: '二 · 风险',
            q: '有人说「安全棋不会死」，也有人说「安全棋是慢性死亡」。请给一个判据，用来区分一手棋是「安全」还是「缓」。',
            ref: [
                '区别不在这一手本身，在它跟谁下、换来了什么。',
                '安全是相对的：对手没有进攻资源时，一手稳而有效的棋就是安全；对手已经攒了三条活二，同样一手稳棋就是把先手白送，那是缓。',
                '所以判据有两条：一是对手当前的威胁密度；二是这手棋有没有让出先手——让出先手而没换到东西，就是缓。',
                '第三条更隐蔽：这手的子力有没有被浪费，落在没有后续的位置上，形状再好看也是缓。',
                '说到底，安全是「这手棋挡得住对方现在能做的事」，缓是「这手棋只让自己心里舒服」。'
            ],
            keys: [
                { w: 3, f: ['威胁', '进攻资源', '对方能', '活二', '相对', '对手有攻', '在进攻', '有没有攻'] },
                { w: 3, f: ['先手', '让出', '主动权', '交换', '白送'] },
                { w: 2, f: ['子力', '浪费', '后续', '效率', '位置'] },
                { w: 2, f: ['挡得住', '心里', '安慰', '舒服', '自我'] }
            ],
            hint: '同一手棋，换个对手就换个名字。判断标准不在这一手里，在这一手对面站着谁、它换回了什么。'
        },
        {
            id: 'q7',
            ch: '四 · 时间',
            q: '二十分钟包干，一局大约六十手。请给出你的时间分配，并说明哪一段最不该省、哪一段最该省。',
            ref: [
                '把它当预算，别当余额。',
                '开局到第十手最该省——下的是记得住的东西，多想的每一分钟都是从后面借的。',
                '中盘的头一手最不该省：局面第一次脱离记忆、对手的意图在这里第一次显形，这一段思考决定后面四十手是顺是逆。',
                '后段要留出定额，至少留三到四分钟给读秒，因为真正的失手多发生在「时间不够所以随手」。',
                '平均每手二十秒只是算术，实际用法是极不均匀的：十手用一分钟，关键三手用十分钟，剩下每手十秒。'
            ],
            keys: [
                { w: 3, f: ['预算', '分配', '不均匀', '定额', '极不均匀', '留出'] },
                { w: 2, f: ['开局', '前几手', '记得住', '少想', '省下', '前面快', '开局不用想'] },
                { w: 3, f: ['关键', '中盘', '不省', '多想', '最重要', '转折', '关键处', '该花时间'] },
                { w: 2, f: ['读秒', '最后', '留三', '留四', '余下'] },
                { w: 1, f: ['平均', '二十秒', '算术'] }
            ],
            hint: '时间不是流水，是预算，而预算的特点是极不均匀。想清楚哪一段花的是「本钱」，哪一段花的是「利息」。'
        },
        {
            id: 'q8',
            ch: '七 · 手筋',
            q: '什么情况下该把一个已经做成的四留着不冲？请说明留与冲各自的代价。',
            ref: [
                '留四，是因为它还是一张牌；冲掉，它就只是一步棋。',
                '留着的时候，它随时能变成先手，能在对方以为自己在进攻时把主动权抢回来，也能在最后关头换一个防守点。代价是它占着一个位置，可能挡住自己的形状，也可能在对方连续进攻时来不及用。',
                '冲掉的好处是立刻拿到一手先手、多一个落点；代价是这张牌打出去了，对方也据此知道了你的形状，而且冲完往往要接着冲，一路冲到底，冲不出杀就什么也不剩。',
                '所以判据是：局面还早、手上没别的资源，就留；已经在读秒、需要一个确定的落点，就冲。'
            ],
            keys: [
                { w: 3, f: ['资源', '一张牌', '手段', '留着', '随时', '变化', '当牌打', '留着有用'] },
                { w: 3, f: ['冲掉', '没了', '消耗', '打完', '暴露', '只知道', '打出去', '就没了'] },
                { w: 1, f: ['挡', '占位', '位置', '形状', '代价'] },
                { w: 2, f: ['时机', '还早', '读秒', '等一等', '现在'] },
                { w: 1, f: ['冲不出', '什么也不剩', '空', '白费'] }
            ],
            hint: '留着它，你多一张牌；冲掉它，你多一步棋。哪个更值，看牌桌还剩几轮，也看手里还有没有别的牌。'
        },
        {
            id: 'q9',
            ch: '六 · 自省',
            q: '什么时候「没有必要强攻」？请给三条你自己的判断，并说明这三条里哪条最常被你违反。',
            ref: [
                '三条。',
                '第一，攻下去没有第二个手段：第一波被挡住之后，你手上没有新的资源，这种强攻只是把形状提前用完。',
                '第二，对方有充分防守：他有一个明确的防点，而且防完还能反攻，你越攻越亏。',
                '第三，结果期望不允许：和棋或小胜已经够用，强攻的期望值是负的——赢一分与输一分不对称时，不该拿必须赢去换可能输。',
                '最常被违反的是第三条，因为前两条在棋盘上看得见，第三条在记分表上，人在局中容易只盯棋盘。'
            ],
            keys: [
                { w: 3, negOk: true, f: ['手段', '后续', '资源', '第二波', '没有别的', '用完', '没有后手', '后继'] },
                { w: 3, f: ['防守', '防点', '挡', '反攻', '防得住'] },
                { w: 2, f: ['期望', '够用', '和棋', '小胜', '不划算', '不对称'] },
                { w: 2, f: ['第三条', '记分', '最常', '违反', '棋盘外'] }
            ],
            hint: '攻不动，往往不是攻得不够，是没算这一攻值不值。三条里有一条不在棋盘上。'
        },
        {
            id: 'q10',
            ch: '五 · 胜负',
            q: '你连赢三盘，等级分涨了一截。这能不能说明你变强了？请说明你的判断，以及你需要补上什么证据才能这么说。',
            ref: [
                '不能，至少现在不能。',
                '三盘是一个太小的样本：其中可能有一盘是对手失误送的，有一盘是开局正好撞在你的熟型上。等级分只记录结果，不记录对手强弱与偶然性。',
                '要说明变强，需要三样证据：一是对手质量，赢的是谁比赢了几盘更重要；二是重复性，同样的判断在陌生局面里还能不能做出来；三是过程，赢的棋里有多少是算出来的、有多少是对方送出来的，把送出来的扣掉，剩下的才是你的。',
                '能力是能重复的东西，一次好结果只是状态。'
            ],
            keys: [
                { w: 2, f: ['样本', '三盘', '太少', '偶然', '运气', '不够', '几盘', '偶然性'] },
                { w: 3, f: ['对手', '强弱', '赢的是谁', '水平', '质量', '赢谁'] },
                { w: 3, f: ['重复', '稳定', '长期', '状态', '持续', '能再现'] },
                { w: 2, f: ['过程', '算出来', '送', '怎么赢', '内容', '对方失误', '白送'] },
                { w: 1, f: ['等级分', '只记', '结果', '分数'] }
            ],
            hint: '分数记的是结果，能力记的是重复。三盘之后，你手上有的到底是哪一种？'
        }
    ];

    /* ---------- 文本归一与匹配 ---------- */

    var BLANK = /[\s\u3000]+/g;
    /* 标点不删除，换成竖线当边界：这样「不能，样本太小」里的否定只作用于前半句，
       不会把后半句的「样本」也一起否掉 */
    var SEP = /[，。、；：？！“”‘’「」『』（）()《》〈〉【】〔〕—…·,.;:?!\x22'<>\[\]{}|~`@#$%^&*+=_\/\\-]/g;
    var NEG = ['不', '没', '勿', '别', '非', '未', '莫', '无'];
    /* 「能不能算得清」「有没有威胁」是疑问，不是否定，先把这些句式剔掉 */
    var QFORM = /能不能|会不会|是不是|有没有|算不算|可不可以|要不要|该不该|对不对|好不好|行不行/g;

    function norm(s) {
        return String(s === null || s === undefined ? '' : s)
            .toLowerCase().replace(BLANK, '').replace(SEP, '|').replace(/\|+/g, '|');
    }

    /* 判断 form 命中处是否处于否定语境：只看紧邻的 3 个字，遇到标点边界就截断。
       窗口放宽到 4 会把「别赌对手看不见」里的「看不见」也否掉 */
    function negBefore(text, at) {
        var seg = text.slice(Math.max(0, at - 3), at);
        var bar = seg.lastIndexOf('|');
        if (bar >= 0) { seg = seg.slice(bar + 1); }
        seg = seg.replace(QFORM, '');
        for (var i = 0; i < NEG.length; i++) {
            if (seg.indexOf(NEG[i]) >= 0) { return true; }
        }
        return false;
    }

    function hitKey(u, key) {
        var forms = key.f || [];
        for (var i = 0; i < forms.length; i++) {
            var f = norm(forms[i]);
            if (f.length < 2) { continue; }
            var at = u.indexOf(f);
            while (at >= 0) {
                if (key.negOk || !negBefore(u, at)) { return true; }
                at = u.indexOf(f, at + 1);
            }
        }
        return false;
    }

    /* 返回 { pct, cover, hit, total }
       曲线用 cover^0.6：覆盖九成上下才摸到 95，覆盖一半约 66，
       这样「说到大半」与「说到几乎全部」能分得开，又不至于差一个词就掉档。 */
    function score(answer, item) {
        var u = norm(answer);
        var keys = item.keys || [];
        var total = 0, hit = 0, hitN = 0, i;

        for (i = 0; i < keys.length; i++) {
            total += keys[i].w;
            if (hitKey(u, keys[i])) { hit += keys[i].w; hitN++; }
        }

        var cover = total ? hit / total : 0;
        var plain = u.replace(/\|/g, '');
        var pct = Math.pow(cover, 0.6) * 100;
        if (plain.length < 10) { pct *= 0.85; }
        /* 防堆词：命中好几个要点，却每个要点平均不到五个字，基本是罗列词而非说理 */
        if (hitN >= 3 && plain.length / hitN < 5) { pct *= 0.9; }
        if (pct > 99.4) { pct = 99.4; }
        if (pct < 0) { pct = 0; }

        return {
            pct: Math.round(pct * 10) / 10,
            cover: cover,
            hit: hitN,
            total: keys.length
        };
    }

    /* ---------- 评语 ---------- */

    function verdict(pct, res) {
        if (pct >= 95) {
            return { cls: 'ok', t: '过了。', s: '你这一句，和参考答案几乎是同一句话——要点' + res.hit + '/' + res.total + ' 全中。' };
        }
        if (pct >= 90) {
            return { cls: 'near', t: '差一点。', s: '意思到了，还差一个方向。你已经说到 ' + res.hit + ' 个要点，参考答案里有 ' + res.total + ' 个。' };
        }
        if (pct >= 70) {
            return { cls: 'mid', t: '说对了一半。', s: '你碰到了 ' + res.total + ' 个方向里的 ' + res.hit + ' 个。' };
        }
        if (pct >= 40) {
            return { cls: 'low', t: '只碰到边。', s: '你答的那部分也许对，但它不是这道题的主干。' };
        }
        return { cls: 'off', t: '还没接上。', s: '和参考答案几乎没有重合的地方。别急着改答案，先把题目再读一遍。' };
    }

    function hintFor(pct, item, res) {
        if (pct >= 95) { return ''; }
        if (pct >= 90) {
            return '提示：已经很近了，只剩一个方向没说到。它多半不是「更难」的那个，而是「更不好承认」的那个。';
        }
        if (pct >= 70) {
            return '提示：' + item.hint + '（还差 ' + (res.total - res.hit) + ' 个方向。）';
        }
        return '提示：先别想答案，把题干里的条件逐条抄出来——每抄一条，问自己「这条改变了什么」。条件数完，方向自然就有了。';
    }

    /* ---------- 状态 ---------- */

    var KEY = 'zxgame.v1';
    var S = { i: 0, best: {}, tries: {} };

    try {
        var saved = JSON.parse(localStorage.getItem(KEY) || 'null');
        if (saved && saved.best) { S.best = saved.best; }
    } catch (e) { /* 忽略 */ }

    function save() {
        try { localStorage.setItem(KEY, JSON.stringify({ best: S.best })); } catch (e) { /* 忽略 */ }
    }

    function passCount() {
        var n = 0, k;
        for (k in S.best) { if (S.best[k] >= 95) { n++; } }
        return n;
    }

    function avgPct() {
        var sum = 0, n = 0, k;
        for (k in S.best) { sum += S.best[k]; n++; }
        return { avg: n ? Math.round(sum / n * 10) / 10 : 0, n: n };
    }

    /* ---------- DOM ---------- */

    var root = document.getElementById('zx-game');
    if (!root) { return; }

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
        res: root.querySelector('[data-ui="res"]')
    };

    function fillDots() {
        var box = root.querySelector('[data-ui="dots"]');
        if (!box) { return; }
        var html = '', i;
        for (i = 0; i < QS.length; i++) {
            var b = S.best[QS[i].id] || 0;
            var cls = b >= 95 ? 'is-pass' : (b >= 90 ? 'is-near' : (b > 0 ? 'is-try' : ''));
            if (i === S.i) { cls += ' is-now'; }
            html += '<i class="' + cls + '" title="第 ' + (i + 1) + ' 题' + (b ? '：' + b + '%' : '') + '"></i>';
        }
        box.innerHTML = html;
    }

    function render() {
        var item = QS[S.i];
        ui.idx.textContent = '第 ' + (S.i + 1) + ' / ' + QS.length + ' 题';
        ui.pass.textContent = '通过 ' + passCount();
        ui.ch.textContent = item.ch;
        ui.q.textContent = item.q;
        ui.input.value = '';
        ui.input.placeholder = '用自己的话写，不必模仿参考答案的句子。写到你觉得说完了为止。';
        ui.res.hidden = true;
        ui.next.hidden = true;
        ui.go.hidden = false;
        ui.skip.hidden = false;
        ui.go.textContent = '提交';
        ui.bar.style.width = (S.i / QS.length * 100) + '%';
        fillDots();
        ui.input.focus();
    }

    function renderResult(res, item) {
        var v = verdict(res.pct, res);
        var pass = res.pct >= 95;
        var html = '';
        html += '<div class="zg-pct zg-pct--' + v.cls + '"><b>' + res.pct.toFixed(1) + '</b><i>%</i></div>';
        html += '<p class="zg-verdict"><b>' + v.t + '</b>' + v.s + '</p>';
        if (!pass) {
            html += '<p class="zg-hint">' + hintFor(res.pct, item, res) + '</p>';
        }
        if (pass) {
            html += '<div class="zg-ref"><h4>参考答案</h4><ol>';
            for (var i = 0; i < item.ref.length; i++) {
                html += '<li>' + item.ref[i] + '</li>';
            }
            html += '</ol></div>';
        }
        ui.res.innerHTML = html;
        ui.res.hidden = false;
        return pass;
    }

    function submit(bySkip) {
        var item = QS[S.i];
        var text = ui.input.value;

        if (!bySkip) {
            if (norm(text).length < 6) {
                ui.res.hidden = false;
                ui.res.innerHTML = '<p class="zg-hint">再多写一点。六个字以内的答案，没法判断是懂还是蒙。</p>';
                return;
            }
        }

        var res = bySkip ? { pct: 0, cover: 0, hit: 0, total: (item.keys || []).length } : score(text, item);
        var prev = S.best[item.id] || 0;
        if (!bySkip && res.pct > prev) {
            S.best[item.id] = res.pct;
            save();
        }
        ui.pass.textContent = '通过 ' + passCount();
        fillDots();

        if (bySkip) {
            ui.res.innerHTML = '<div class="zg-ref"><h4>参考答案（本题不计分）</h4><ol>' +
                item.ref.map(function (p) { return '<li>' + p + '</li>'; }).join('') + '</ol></div>';
            ui.res.hidden = false;
            ui.skip.hidden = true;
            ui.go.hidden = true;
            ui.next.hidden = false;
            ui.next.textContent = (S.i === QS.length - 1) ? '看结果' : '下一题';
            return;
        }

        var pass = renderResult(res, item);
        ui.go.hidden = pass;
        ui.go.textContent = '改一改，再交一次';
        ui.skip.hidden = true;
        ui.next.hidden = false;
        ui.next.textContent = (S.i === QS.length - 1) ? '看结果' : '下一题';
        if (pass) { ui.input.blur(); }
        ui.res.scrollIntoView({ block: 'nearest' });
    }

    function finalPanel() {
        var n = passCount(), st = avgPct(), avg = st.avg;
        var words;
        if (n >= 9) {
            words = '这不是背下来了，这是想通了。你答的不是本页的话，是本页背后的条件。';
        } else if (n >= 6) {
            words = '大部分方向你已经有了，剩下的多半是那些「不好承认」的部分——讲对手、讲自己、讲运气。';
        } else if (n >= 3) {
            words = '过了一半。回去把没过的那几题所属的章节重读一遍，再回来答，会比在这儿硬想快。';
        } else {
            words = '别把这当成考试。这些题的目的是让你把「我以为我知道」变成「我能说清」，说清之前，先抄条件。';
        }
        var html = '';
        html += '<div class="zg-final">';
        html += '<div class="zg-final-n"><b>' + n + '</b><span>/ ' + QS.length + ' 过</span></div>';
        html += '<div class="zg-final-a"><b>' + avg.toFixed(1) + '</b><span>% 平均（已答 ' + st.n + ' 题' + (st.n < QS.length ? '，其余未作答' : '') + '）</span></div>';
        html += '<p class="zg-final-t">' + words + '</p>';
        html += '<div class="zg-final-b"><button class="zg-btn" data-act="restart">从头再来</button></div>';
        html += '</div>';
        ui.res.innerHTML = html;
        ui.res.hidden = false;
        ui.q.textContent = '十题走完。';
        ui.ch.textContent = '结果';
        ui.input.hidden = true;
        var kb = root.querySelector('.zg-keys');
        if (kb) { kb.hidden = true; }
        ui.go.hidden = true;
        ui.skip.hidden = true;
        ui.next.hidden = true;
        ui.bar.style.width = '100%';
        ui.res.querySelector('[data-act="restart"]').addEventListener('click', function () {
            S.i = 0;
            S.best = {};
            save();
            ui.input.hidden = false;
            render();
        });
    }

    ui.go.addEventListener('click', function () { submit(false); });
    ui.skip.addEventListener('click', function () { submit(true); });
    ui.next.addEventListener('click', function () {
        if (S.i === QS.length - 1) { finalPanel(); return; }
        S.i++;
        render();
    });
    ui.input.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            submit(false);
        }
    });

    render();
})();
