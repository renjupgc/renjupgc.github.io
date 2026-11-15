/* ==========================================================================
   杂想 · 猜术语（AI 版）—— 模型接口与出题/判分引擎
   --------------------------------------------------------------------------
   两个职责：
     1. 出题：题目不预置。每次「新题」都由模型现场造一道，语料取自本页的
        二十六条（运行时从 DOM 读，页面改了语料自动跟上）；调不通模型时，
        退到本地组合器，用二十六条 × 若干提问方式组题，永远出不完。
     2. 判分：用户猜的词交给模型，对着一组「都算对」的说法算相对远近，
        返回 JSON：similarity（0–100）、verdict、matched、gap、hint。
        没有绝对答案，只有「离他的说法多远」。

   接的是一律 OpenAI 兼容的 /chat/completions：DeepSeek、智谱、Moonshot、
   通义、OpenAI 或自建代理都行。密钥只写在浏览器 localStorage，不上传。
   ========================================================================== */

(function (global) {
    'use strict';

    var CFG_KEY = 'zx-ai-cfg-v1';

    var PRESETS = [
        { id: 'deepseek', name: 'DeepSeek', base: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
        { id: 'zhipu', name: '智谱 GLM', base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
        { id: 'moonshot', name: 'Moonshot', base: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
        { id: 'dashscope', name: '通义千问', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
        { id: 'openai', name: 'OpenAI', base: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
        { id: 'custom', name: '自定义（OpenAI 兼容）', base: '', model: '' }
    ];

    /* ---------- 配置 ---------- */

    function loadCfg() {
        try {
            var raw = global.localStorage.getItem(CFG_KEY);
            if (!raw) { return { base: '', key: '', model: '', preset: '' }; }
            var o = JSON.parse(raw);
            return {
                base: String(o.base || ''),
                key: String(o.key || ''),
                model: String(o.model || ''),
                preset: String(o.preset || '')
            };
        } catch (e) {
            return { base: '', key: '', model: '', preset: '' };
        }
    }

    function saveCfg(o) {
        var c = {
            base: String(o.base || '').trim(),
            key: String(o.key || '').trim(),
            model: String(o.model || '').trim(),
            preset: String(o.preset || '')
        };
        global.localStorage.setItem(CFG_KEY, JSON.stringify(c));
        return c;
    }

    function clearCfg() {
        global.localStorage.removeItem(CFG_KEY);
    }

    function isReady() {
        var c = loadCfg();
        return !!(c.base && c.key && c.model);
    }

    /* ---------- 一次对话调用 ---------- */

    function endPoint(base) {
        var b = String(base || '').replace(/\s+/g, '').replace(/\/+$/, '');
        if (!b) { return ''; }
        if (/\/chat\/completions$/.test(b)) { return b; }
        return b + '/chat/completions';
    }

    function errText(status, body) {
        var msg = '';
        try {
            var o = JSON.parse(body);
            msg = (o.error && (o.error.message || o.error.code)) || o.message || '';
        } catch (e) { /* 非 JSON */ }
        if (status === 401 || status === 403) { return '密钥无效或没有权限（' + status + '）。' + (msg ? ' ' + msg : ''); }
        if (status === 404) { return '接口地址不对（404），检查 Base URL 是否少了或多了 /v1。'; }
        if (status === 429) { return '被限流或余额不足（429）。' + (msg ? ' ' + msg : ''); }
        if (status >= 500) { return '服务端报错（' + status + '）。' + (msg ? ' ' + msg : ''); }
        return '请求失败（' + status + '）。' + (msg ? ' ' + msg : '');
    }

    function chat(messages, opts) {
        opts = opts || {};
        var c = loadCfg();
        if (!c.base || !c.key || !c.model) {
            return Promise.reject(new Error('还没接入模型：填 Base URL、密钥、模型名。'));
        }
        var url = endPoint(c.base);
        var body = {
            model: c.model,
            messages: messages,
            temperature: (opts.temp === undefined ? 0.8 : opts.temp),
            max_tokens: opts.max || 800,
            stream: false
        };

        var ctl = null;
        var timer = null;
        var init = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + c.key
            },
            body: JSON.stringify(body)
        };
        if (global.AbortController) {
            ctl = new global.AbortController();
            init.signal = ctl.signal;
            timer = global.setTimeout(function () { ctl.abort(); }, opts.timeout || 30000);
        }

        return global.fetch(url, init).then(function (res) {
            if (timer) { global.clearTimeout(timer); }
            return res.text().then(function (txt) {
                if (!res.ok) { throw new Error(errText(res.status, txt)); }
                var data;
                try { data = JSON.parse(txt); } catch (e) { throw new Error('返回不是 JSON，可能被网关拦了。'); }
                var picked = data && data.choices && data.choices[0];
                var content = picked && ((picked.message && picked.message.content) || picked.text) || '';
                if (!content) { throw new Error('模型返回空内容。'); }
                return String(content);
            });
        }, function (err) {
            if (timer) { global.clearTimeout(timer); }
            if (err && err.name === 'AbortError') { throw new Error('请求超时，模型没在 30 秒内回话。'); }
            throw new Error('连不上接口（多为浏览器跨域被拦）。可换一家，或把 Base URL 填成你自己的转发地址。');
        });
    }

    /* 从模型回话里抠出 JSON：容忍 ```json 围栏、前后废话、尾逗号 */
    function pickJson(text) {
        if (!text) { return null; }
        var s = String(text).replace(/```json/gi, '```').replace(/```/g, '').trim();
        var i = s.indexOf('{');
        while (i >= 0) {
            var depth = 0, inStr = false, esc = false, end = -1;
            for (var k = i; k < s.length; k++) {
                var ch = s.charAt(k);
                if (inStr) {
                    if (esc) { esc = false; }
                    else if (ch === '\\') { esc = true; }
                    else if (ch === '"') { inStr = false; }
                    continue;
                }
                if (ch === '"') { inStr = true; }
                else if (ch === '{') { depth++; }
                else if (ch === '}') {
                    depth--;
                    if (depth === 0) { end = k; break; }
                }
            }
            if (end > i) {
                var chunk = s.slice(i, end + 1);
                try { return JSON.parse(chunk); } catch (e) {
                    try { return JSON.parse(chunk.replace(/,\s*([}\]])/g, '$1')); } catch (e2) { /* 继续找 */ }
                }
            }
            i = s.indexOf('{', i + 1);
        }
        return null;
    }

    function chatJson(messages, opts) {
        return chat(messages, opts).then(function (txt) {
            var obj = pickJson(txt);
            if (obj) { return obj; }
            /* 一次重试：把回话塞回去，要求只输出 JSON */
            return chat(messages.concat([
                { role: 'assistant', content: String(txt).slice(0, 1200) },
                { role: 'user', content: '上一条不是合法 JSON。只输出那个 JSON 对象，不要解释、不要代码围栏。' }
            ]), opts).then(function (txt2) {
                var o2 = pickJson(txt2);
                if (!o2) { throw new Error('模型两次都没有给出合法 JSON。'); }
                return o2;
            });
        });
    }

    /* ---------- 语料：运行时从页面读二十六条 ---------- */

    var CORPUS = null;

    function clean(t) {
        return String(t || '').replace(/\s+/g, ' ').trim();
    }

    function corpus() {
        if (CORPUS) { return CORPUS; }
        var out = [];
        var entries = global.document ? global.document.querySelectorAll('.zx-entry') : [];
        var chTitles = {};
        if (global.document) {
            var chs = global.document.querySelectorAll('.zx-ch');
            for (var c = 0; c < chs.length; c++) {
                var no = chs[c].querySelector('.zx-ch-no');
                var h2 = chs[c].querySelector('h2');
                if (no && h2) {
                    chTitles[clean(no.textContent)] = clean(h2.textContent).replace(/^[一二三四五六七八九十]\s*/, '');
                }
            }
        }
        for (var i = 0; i < entries.length; i++) {
            var el = entries[i];
            var num = clean((el.querySelector('.zx-no') || {}).textContent);
            var title = clean((el.querySelector('h3') || {}).textContent);
            var raw = clean((el.querySelector('.zx-raw p') || {}).textContent);
            var gloss = clean((el.querySelector('.zx-rows dd') || {}).textContent);
            var chNo = '';
            var prev = el.previousElementSibling;
            while (prev && !chNo) {
                if (prev.classList && prev.classList.contains('zx-ch')) {
                    var n = prev.querySelector('.zx-ch-no');
                    chNo = n ? clean(n.textContent) : '';
                }
                prev = prev.previousElementSibling;
            }
            out.push({
                no: num.replace(/[^0-9]/g, ''),
                label: num,
                ch: chNo,
                chName: chTitles[chNo] || '',
                title: title,
                raw: raw,
                gloss: gloss
            });
        }
        CORPUS = out;
        return out;
    }

    /* ---------- 本地兜底：二十六条的术语落点 ----------
       target 是「一句话落到哪个词」，alt 是同一路上其它也对的说法。
       模型调不通时，本地出题与估分都用这张表。 */

    var TERMS = {
        '01': { t: '脱谱', alt: ['变化', '算力', '准备'] },
        '02': { t: '暴算', alt: ['硬算', '记忆', '临场'] },
        '03': { t: '半谱', alt: ['残谱', '背谱', '算路'] },
        '04': { t: '弃谱', alt: ['脱谱', '定式', '简谱'] },
        '05': { t: '通用棋', alt: ['强手', '冒险', '翻车'] },
        '06': { t: '安全棋', alt: ['稳棋', '守和', '保守'] },
        '07': { t: '安全棋', alt: ['稳棋', '守势', '手感'] },
        '08': { t: '绝路', alt: ['孤注', '无退路', '一条路'] },
        '09': { t: '因人', alt: ['定制', '适配', '对手'] },
        '10': { t: '对手', alt: ['名字', '定制', '错觉'] },
        '11': { t: '过度准备', alt: ['牛刀', '备招', '浪费'] },
        '12': { t: '态度', alt: ['认真', '省力', '敷衍'] },
        '13': { t: '零失误', alt: ['完美', '幻觉', '波动'] },
        '14': { t: '鬼招', alt: ['漏着', '失误', '鬼手'] },
        '15': { t: '机会', alt: ['运气', '时机', '不可控'] },
        '16': { t: '麻木', alt: ['疲惫', '钝化', '习惯'] },
        '17': { t: '收获', alt: ['教训', '底线', '最劣成绩'] },
        '18': { t: '分寸', alt: ['居安思危', '知止', '冒险'] },
        '19': { t: '自知', alt: ['定位', '够用', '八百里'] },
        '20': { t: '眼高手低', alt: ['知行', '会说不会下', '练习'] },
        '21': { t: '后手', alt: ['假先手', '次序', '主动权'] },
        '22': { t: '假VCT', alt: ['连续冲四', 'VCT', '后手'] },
        '23': { t: '留四', alt: ['变化', '不冲四', '保留'] },
        '24': { t: '长杀', alt: ['短杀', '漏算', 'VCF'] },
        '25': { t: '两打', alt: ['规则', '交换', '禁手'] },
        '26': { t: '推广局', alt: ['表演', '胜负', '另一回事'] }
    };

    /* 提问方式：同一张表，问法不同就是不同的题。
       一律先把术语本身从题面里抹掉，否则等于把答案写在脸上。 */
    var FRAMES = [
        function (x) { return '他的判断是「' + x + '」。这个判断落到哪一个两三个字的术语？'; },
        function (x) { return '「' + x + '」——说这话的人，棋评里会给他这个想法一个什么名字？'; },
        function (x) { return '把这一句翻成一个术语（两三个字）：' + x; },
        function (x) { return '他在笔记里写过：' + x + ' 此处该填的那两三个字，是什么？'; },
        function (x) { return x + ' —— 这样一条，压在棋评里是哪两三个字？'; }
    ];

    function rnd(n) { return Math.floor(Math.random() * n); }

    function shuffle(arr) {
        var a = arr.slice();
        for (var i = a.length - 1; i > 0; i--) {
            var j = rnd(i + 1);
            var t = a[i]; a[i] = a[j]; a[j] = t;
        }
        return a;
    }

    function clip(text, n) {
        var t = String(text || '').trim();
        if (t.length <= n) { return t; }
        var cut = t.slice(0, n);
        var p = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('；'), cut.lastIndexOf('，'));
        return (p > n * 0.5 ? cut.slice(0, p) : cut) + '……';
    }

    /* 本地出题：不遮不猜。
       做法是反过来的——先在他的原话里找一个「没出现过的」术语当正解，
       题面就能原样引用他的话，既读得通，也不漏答案。答案本来就只论远近，
       所以落到同一条路上的哪个词上都算数，只是分不同。 */

    var FRAMES = [
        function (x) { return '他说：' + x + ' 这句话落到哪个两三个字的术语上？'; },
        function (x) { return '「' + x + '」——这个判断，棋评里怎么称呼？两三个字。'; },
        function (x) { return '把这一句压成一个术语（两三个字）：' + x; },
        function (x) { return x + ' —— 这样一条，压在棋评里是哪两三个字？'; },
        function (x) { return '如果只能用两三个字记住这一条，你记哪三个字？他原话是：' + x; }
    ];

    function localQuestion(avoid) {
        var C = corpus();
        if (!C.length) { throw new Error('页面语料没读到。'); }
        avoid = avoid || [];
        var pool = C.filter(function (e) {
            return avoid.indexOf(TERMS[e.no] && TERMS[e.no].t) < 0;
        });
        if (!pool.length) { pool = C; }
        var e = pool[rnd(pool.length)];
        var term = TERMS[e.no] || { t: e.title.slice(0, 3), alt: [] };

        var texts = [e.title || '', e.raw || '', e.gloss || ''].join(' ');
        var cands = shuffle([term.t].concat(term.alt));
        var usable = cands.filter(function (c) { return c && texts.indexOf(c) < 0; });
        var answer = usable[0] || term.t;

        var acc = cands.filter(function (c) { return c !== answer; }).slice(0, 3).map(function (w) {
            return { w: w, note: '同一条路上的另一种说法，离正解隔着一层。' };
        });

        var title = clip(e.title || '', 40);
        var prompt = clean(FRAMES[rnd(FRAMES.length)](title));
        /* 原话更完整时，偶尔直接引原话 */
        if (e.raw && e.raw.length <= 70 && e.raw.indexOf(answer) < 0 && Math.random() < 0.4) {
            prompt = '他写过：「' + e.raw + '」——这句话落到哪个两三个字的术语上？';
        }
        if (prompt.indexOf(answer) >= 0) {
            prompt = '他写过：「' + title + '」——这句话落到哪个两三个字的术语上？';
        }
        /* 题面里已经写着的词，不能再当作「同一条路上的答案」白送分 */
        acc = acc.filter(function (a) { return prompt.indexOf(a.w) < 0; });

        var chName = String(e.chName || '').split('：')[0];
        return {
            id: 'loc-' + Date.now().toString(36) + '-' + rnd(999),
            src: 'local',
            chapter: (e.ch ? e.ch + ' · ' : '') + (chName || '杂想'),
            prompt: prompt,
            target: answer,
            accept: acc,
            hint: '落点在这一句上：' + clip(e.gloss || e.title, 34),
            note: e.gloss || e.title,
            ref: e.label || ('ZX-' + e.no)
        };
    }

    /* ---------- 模型出题 ---------- */

    function aiQuestion(avoid, recent) {
        var C = corpus();
        var sample = shuffle(C).slice(0, 6).map(function (e) {
            return e.label + '｜' + e.title + '｜原文：' + e.raw.slice(0, 90) + '｜释义：' + e.gloss.slice(0, 110);
        }).join('\n');

        var sys = [
            '你是五子棋（连珠）教练，出题人。你要根据用户给的语料，现场出一道「一句话落到一个词」的题。',
            '规矩：',
            '1. 只出一道题，题目问的是「他这句话对应哪个连珠术语」，答案必须是一个真实的连珠/棋评术语（2–4 个汉字），例如：脱谱、算力、假杀、防点、先手、后手、做杀、VCF、VCT、留四、禁手、两打、读秒、定式、飞刀、收官、收官手、眼位、活三、冲四。',
            '2. prompt 是题面，50–110 字，要像棋评里的提问：可以引他的原话，也可以造一个同样的局面。prompt 里绝对不能出现 target 本身，也不能出现 target 的连续两个字。',
            '3. accept 给 4 条「也算对、但落点不同」的说法，都是真实说法，每条 2–5 字，各带一句 note（15–40 字，说清它与 target 差在哪一侧）。它们与 target 有明确关系，但都不是 target 本身。',
            '4. hint 一句模糊方向（20–35 字），不点破答案。',
            '5. note 是命中后的释义（30–60 字），引他自己的理由。',
            '6. ref 填语料里对应的编号，如 ZX-09；没有对应就填「杂论」。',
            '输出一个 JSON 对象，不要任何解释，不要代码围栏。'
        ].join('\n');

        var user = [
            '语料（本页二十六条里抽出的六条）：',
            sample,
            '',
            '已经出过的正解（不要重复）：' + (avoid && avoid.length ? avoid.join('、') : '（无）'),
            recent && recent.length ? '近期题面（别再出同一种问法）：\n' + recent.slice(-4).join('\n') : '',
            '',
            '按此 schema 输出：',
            '{"chapter":"三 · 对手","prompt":"……","target":"因人","accept":[{"w":"定制","note":"……"},{"w":"适配","note":"……"},{"w":"对手","note":"……"},{"w":"一视同仁","note":"……"}],"hint":"……","note":"……","ref":"ZX-09"}'
        ].join('\n');

        return chatJson([
            { role: 'system', content: sys },
            { role: 'user', content: user }
        ], { temp: 0.95, max: 900 }).then(function (o) {
            var q = normQuestion(o);
            if (!q) { throw new Error('模型出的题不完整。'); }
            q.id = 'ai-' + Date.now().toString(36);
            q.src = 'ai';
            return q;
        });
    }

    function normQuestion(o) {
        if (!o || !o.prompt || !o.target) { return null; }
        var t = clean(o.target).replace(/[「」“”"'\s]/g, '');
        if (t.length < 2 || t.length > 5) { return null; }
        var acc = [];
        if (Array.isArray(o.accept)) {
            for (var i = 0; i < o.accept.length && acc.length < 5; i++) {
                var a = o.accept[i];
                var w = clean(typeof a === 'string' ? a : a && a.w).replace(/[「」“”"'\s]/g, '');
                if (!w || w === t || w.length > 6) { continue; }
                if (clean(o.prompt).indexOf(w) >= 0) { continue; }
                acc.push({ w: w, note: clean(a && a.note) || '同一条路上的另一种说法。' });
            }
        }
        return {
            chapter: clean(o.chapter) || '杂想',
            prompt: clean(o.prompt),
            target: t,
            accept: acc,
            hint: clean(o.hint) || '',
            note: clean(o.note) || '',
            ref: clean(o.ref) || ''
        };
    }

    /* ---------- 模型判分 ---------- */

    function aiRate(q, guess) {
        var sys = [
            '你是五子棋教练，判一个学员猜的词，与「题库正解」的相对远近。',
            '这里没有绝对答案，只有相对远近：学员说的可能是正解，也可能是同一条路上的另一种说法，也可能是反方向，也可能毫无关系。',
            '给分规矩：',
            '· 与正解完全相同（或只是写法不同）：100。',
            '· 同一条路上、落点不同的说法：60–95，要按它离正解差多远给，不许都给同一个数。',
            '· 方向相反或把因果说反：20–45。',
            '· 沾边但不在这一层（比如说了个更泛的上位词）：35–60。',
            '· 与本题无关：0–20。',
            '· 别因为「不是正解」就一律压低：判的是意思，不是字符串是否相等。',
            'verdict 只能是这五个之一：完全就是、很近了、同一条路、沾点边、差得远。',
            '输出 JSON，不要解释，不要代码围栏。'
        ].join('\n');

        var accTxt = (q.accept || []).map(function (a) { return a.w + '（' + a.note + '）'; }).join('；') || '（无）';

        var user = [
            '题面：' + q.prompt,
            '正解：' + q.target,
            '同一路上其它也算对的说法：' + accTxt,
            '依据：' + (q.note || ''),
            '学员猜的是：「' + guess + '」',
            '',
            '按此 schema 输出：',
            '{"similarity":88,"verdict":"同一条路","matched":["共用的意思：都在说离开棋谱这件事"],"gap":"它说的是背不下去，正解说的是把整盘棋带到书外。","hint":"再往「整盘」那一层想一步。"}'
        ].join('\n');

        return chatJson([
            { role: 'system', content: sys },
            { role: 'user', content: user }
        ], { temp: 0.2, max: 500 }).then(function (o) {
            var sim = Number(o.similarity);
            if (!isFinite(sim)) { throw new Error('模型没给分数。'); }
            sim = Math.max(0, Math.min(100, Math.round(sim)));
            var matched = [];
            if (Array.isArray(o.matched)) {
                matched = o.matched.map(function (x) { return clean(x); }).filter(Boolean).slice(0, 3);
            } else if (typeof o.matched === 'string' && clean(o.matched)) {
                matched = [clean(o.matched)];
            }
            return {
                similarity: sim,
                verdict: clean(o.verdict) || verdictOf(sim),
                matched: matched,
                gap: clean(o.gap),
                hint: clean(o.hint),
                engine: 'ai'
            };
        });
    }

    /* ---------- 本地估分（模型不通时）---------- */

    function nn(s) { return String(s || '').replace(/[\s，。、！？：；「」“”'"（）()·—…]/g, '').replace(/[A-Za-z]/g, function (m) { return m.toLowerCase(); }); }

    function bigrams(s) {
        var out = [];
        for (var i = 0; i < s.length - 1; i++) { out.push(s.substr(i, 2)); }
        return out;
    }

    function dice(a, b) {
        var A = bigrams(a), B = bigrams(b);
        if (!A.length || !B.length) { return 0; }
        var used = {}, hit = 0;
        A.forEach(function (x) {
            for (var i = 0; i < B.length; i++) {
                if (!used[i] && B[i] === x) { used[i] = 1; hit++; break; }
            }
        });
        return 2 * hit / (A.length + B.length);
    }

    function jac(a, b) {
        var A = {}, B = {}, na = 0, nb = 0, inter = 0;
        for (var i = 0; i < a.length; i++) { if (!A[a.charAt(i)]) { A[a.charAt(i)] = 1; na++; } }
        for (var j = 0; j < b.length; j++) { if (!B[b.charAt(j)]) { B[b.charAt(j)] = 1; nb++; } }
        for (var k in A) { if (B[k]) { inter++; } }
        return (na && nb) ? inter / (na + nb - inter) : 0;
    }

    function simScore(a, b) {
        if (!a || !b) { return 0; }
        if (a === b) { return 1; }
        if (a.indexOf(b) >= 0 || b.indexOf(a) >= 0) {
            var sh = Math.min(a.length, b.length), lg = Math.max(a.length, b.length);
            return 0.60 + 0.26 * (sh / lg);
        }
        return Math.max(0.95 * dice(a, b), 0.72 * jac(a, b));
    }

    function localRate(q, guess) {
        var g = nn(guess);
        var t = nn(q.target);
        if (!g) { return { similarity: 0, verdict: '差得远', matched: [], gap: '', hint: '', engine: 'local' }; }

        var cands = [{ w: t, base: 100, note: '就是正解。' }];
        (q.accept || []).forEach(function (a, i) {
            cands.push({ w: nn(a.w), base: 92 - i * 8, note: a.note || '' });
        });

        var best = null;
        cands.forEach(function (c) {
            var s = simScore(g, c.w);
            var p = (s >= 1) ? c.base : c.base * (0.16 + 0.84 * s);
            if (!best || p > best.p) { best = { p: p, s: s, c: c }; }
        });

        var exact = best.s >= 1;
        var pct = exact ? best.c.base : Math.min(96, Math.round(best.p));
        if (!exact && g.length === 1) { pct = Math.min(pct, 42); }
        pct = Math.max(3, Math.min(100, pct));

        var matched = [];
        if (pct >= 40) {
            var shared = '';
            for (var i = 0; i < g.length; i++) { if (best.c.w.indexOf(g.charAt(i)) >= 0) { shared += g.charAt(i); } }
            if (shared) { matched.push('共用的字：「' + shared.split('').join('」「') + '」——同一个字，未必同一层意思。'); }
            if (best.c.note) { matched.push('最近的说法是「' + best.c.w + '」：' + best.c.note); }
        }
        return {
            similarity: pct,
            verdict: verdictOf(pct),
            matched: matched,
            gap: pct < 96 && pct >= 60 ? '落点差一层：' + (q.target === best.c.w ? '字面已经对上，说的是不是同一层，还得看你的意思。' : '同一个方向，' + q.target + '是那一步的名字。') : '',
            hint: '',
            engine: 'local'
        };
    }

    function verdictOf(p) {
        if (p >= 100) { return '完全就是'; }
        if (p >= 95) { return '就是它'; }
        if (p >= 88) { return '很近了'; }
        if (p >= 60) { return '同一条路'; }
        if (p >= 35) { return '沾点边'; }
        return '差得远';
    }

    /* ---------- 对外的两个动作 ---------- */

    function makeQuestion(avoid, recent) {
        if (!isReady()) {
            return Promise.resolve(localQuestion(avoid));
        }
        return aiQuestion(avoid, recent).catch(function (err) {
            var q = localQuestion(avoid);
            q.fallbackReason = err && err.message ? err.message : '模型这次没出成题。';
            return q;
        });
    }

    function rate(q, guess) {
        if (!isReady()) { return Promise.resolve(localRate(q, guess)); }
        return aiRate(q, guess).catch(function (err) {
            var r = localRate(q, guess);
            r.fallbackReason = err && err.message ? err.message : '模型这次没判成。';
            return r;
        });
    }

    function test() {
        return chat([
            { role: 'system', content: '你是一个连通性测试。只回一个 JSON：{"ok":true,"say":"在"}' },
            { role: 'user', content: 'ping' }
        ], { temp: 0, max: 60 }).then(function (txt) {
            var o = pickJson(txt);
            if (!o) { throw new Error('接口通了，但回话不是 JSON（换一家或换模型试试）。'); }
            return o;
        });
    }

    global.ZXAI = {
        PRESETS: PRESETS,
        loadCfg: loadCfg,
        saveCfg: saveCfg,
        clearCfg: clearCfg,
        isReady: isReady,
        corpus: corpus,
        makeQuestion: makeQuestion,
        rate: rate,
        localRate: localRate,
        test: test,
        pickJson: pickJson,
        TERMS: TERMS
    };
})(window);
