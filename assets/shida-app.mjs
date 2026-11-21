/*
 * 开局综合判断 - 出题与判分（五手两打 / 塔拉山口-10 两档）
 * ------------------------------------------------------------
 * 题面全部来自 assets/shida-data.js：也就是《漱星阁开局指南》(2026.10.25)
 * 里每个开局的打数表。四手摆好，先问第五手能不能直接给十打，再问白方挑中
 * 的那一手之后局面算什么档次。
 *
 * 判分规矩：
 *   十打之后若是 黑必胜 / 黑近胜 / 黑大优 / 黑小优 / 偏黑 / 平衡 / 偏白 /
 *   白小优，就算「可以给十打」；若是 白大优 / 白近胜 / 白必胜（书里写「黑败」），
 *   就不能给。
 *
 * 第二问的五档互有重叠（原话如此），所以分三档判：正落在本档算对，落在重叠
 * 的那一档算擦边，其余算错。
 *
 * 站内换页只换 <main>，本模块由 shida.js 重新 boot 一次；靠 dataset.ready 认领，
 * 把进行中的那一局接着摆回去。
 */

const COLS = 'ABCDEFGHIJKLMNO';
const OPEN = (window.SHIDA_OPENINGS || []).filter(function (o) {
    return o && o.m && o.m.length === 4 && o.r && o.r.length;
});

/* 塔十题库：把每个开局书里 2–14 打的每个打点都单独出成一道题，
 * 一题就是（开局 + 那一个打点），同一开局会有好几道，问的是不同落点的局面。 */
const ST_BANK = [];
OPEN.forEach(function (op) {
    op.c.forEach(function (five) {
        if (five[2] >= 2 && five[2] <= 14) {
            ST_BANK.push({ op: op, five: five });
        }
    });
});

/* 书里的简称归一：黑胜就是黑必胜，黑败就是白必胜，「有望胜」按近胜读 */
const NORM = {
    '黑胜': '黑必胜', '黑败': '白必胜', '白胜': '白必胜',
    '黑有望胜': '黑近胜', '白有望胜': '白近胜'
};
const cat = (r) => NORM[r] || r;

/* 十打仍可接受的那一档 */
const OK_TEN = new Set([
    '黑必胜', '黑近胜', '黑大优', '黑小优', '偏黑', '平衡', '偏白', '白小优'
]);

/* 五档：ok 算对，mid 算擦边（半对），all 是选项下面那行小字的完整顺序 */
const BUCKETS = [
    { key: 1, name: '黑很好',
      all: ['黑必胜', '黑近胜', '黑大优'],
      ok: ['黑必胜', '黑近胜', '黑大优'], mid: [] },
    { key: 2, name: '黑稍好',
      all: ['黑近胜', '黑大优', '黑小优', '偏黑', '平衡'],
      ok: ['黑小优', '偏黑'], mid: ['黑近胜', '黑大优', '平衡'] },
    { key: 3, name: '大致均势',
      all: ['黑小优', '偏黑', '平衡', '偏白', '白小优'],
      ok: ['黑小优', '偏黑', '平衡', '偏白', '白小优'], mid: [] },
    { key: 4, name: '白稍好',
      all: ['白近胜', '白大优', '白小优', '偏白', '平衡'],
      ok: ['白小优', '偏白'], mid: ['白近胜', '白大优', '平衡'] },
    { key: 5, name: '白很好',
      all: ['白必胜', '白近胜', '白大优'],
      ok: ['白必胜', '白近胜', '白大优'], mid: [] }
];

/* 判一档：ok 算对、mid 算半对，其余算错 */
function gradeB(key, truth) {
    const b = bucketOf(key);
    if (!b) {
        return 'bad';
    }
    if (b.ok.indexOf(truth) >= 0) {
        return 'ok';
    }
    return b.mid.indexOf(truth) >= 0 ? 'mid' : 'bad';
}

/* 选项小字：属于擦边的几项淡一点 */
function noteHTML(b) {
    return b.all.map(function (r) {
        return b.mid.indexOf(r) >= 0 ? '<i class="sd-thin">' + r + '</i>' : r;
    }).join('、');
}

/* 每个评估的「本档」：重叠时以这里为准 */
const CORE = {
    '黑必胜': 1, '黑近胜': 1, '黑大优': 1,
    '黑小优': 2, '偏黑': 2,
    '平衡': 3,
    '偏白': 4, '白小优': 4,
    '白大优': 5, '白近胜': 5, '白必胜': 5
};

const S = {
    mode: 'st',        // 'st' 塔拉山口-10 | 'ws' 五手两打
    queue: [],
    cur: null,
    five: null,
    n5: 10,
    phase: 0,          // 0 未答第一问；1 已答第一问；2 两问都答完
    ansA: null,
    ansB: null,
    forced: false,
    board: null,
    stats: { n: 0, a: 0, aOk: 0, b: 0, bOk: 0, bMid: 0 }
};

const bucketOf = (key) => BUCKETS.filter((b) => b.key === key)[0];

/* 书里的「黑败」念出来太生硬，正文里补一句同义 */
function say(r) {
    if (r === '黑败') {
        return '黑败（白必胜）';
    }
    return r;
}

function coord(i, j) {
    return COLS.charAt(i) + (15 - j);
}

function shuffle(list) {
    for (let k = list.length - 1; k > 0; k--) {
        const r = Math.floor(Math.random() * (k + 1));
        const t = list[k];
        list[k] = list[r];
        list[r] = t;
    }
    return list;
}

/* 某一档打数落在表里的哪一格；不在表里就按「其余黑败」或「比最小的打数还宽」推 */
function resultAt(op, n) {
    for (let k = 0; k < op.r.length; k++) {
        const row = op.r[k];
        if (row[0] <= n && n <= row[1]) {
            return row[2];
        }
    }
    if (n < op.r[0][0]) {
        return op.r[0][2];
    }
    return '黑败';
}

const tenResult = (op) => resultAt(op, 10);

/* 只查表，不外推 */
function tableAt(tab, n) {
    if (!tab) {
        return null;
    }
    for (let k = 0; k < tab.length; k++) {
        if (tab[k][0] <= n && n <= tab[k][1]) {
            return tab[k][2];
        }
    }
    return null;
}

/* 一个打点自己的结果：带撇号的点查 rp，表里没写到就按原图的 a/c 归类 */
function pointRes(op, c) {
    if (!c[5]) {
        return resultAt(op, c[2]);
    }
    const hit = tableAt(op.rp, c[2]);
    if (hit) {
        return hit;
    }
    return c[3] === 0 ? '黑胜' : c[3] === 1 ? '黑败' : '平衡';
}

/* 书里最多给到几打还站得住 */
function maxGood(op) {
    let best = 0;
    op.r.forEach(function (row) {
        if (OK_TEN.has(cat(row[2]))) {
            best = Math.max(best, row[1]);
        }
    });
    return best;
}

/* 标号别落在旁边的棋子上：依次试右上、左上、右下、左下、右、左 */
function noteSpot(op, five) {
    const occ = {};
    op.m.forEach(function (m) {
        occ[m[0] + ',' + m[1]] = 1;
    });
    const dirs = [[1, -1, 'start'], [-1, -1, 'end'], [1, 1, 'start'], [-1, 1, 'end'],
                  [1, 0, 'start'], [-1, 0, 'end']];
    for (let k = 0; k < dirs.length; k++) {
        const d = dirs[k];
        const i = five[0] + d[0];
        const j = five[1] + d[1];
        if (i < 0 || i > 14 || j < 0 || j > 14 || occ[i + ',' + j]) {
            continue;
        }
        return { dx: d[0] * 0.94, dy: d[1] * 0.94 + (d[1] > 0 ? 0.42 : -0.24), anchor: d[2] };
    }
    return { dx: 0.94, dy: -1.16, anchor: 'start' };
}

/* 其余打点：直接写在交叉点上，居中（dy 补一个基线偏移，视觉才正） */
function noteSide() {
    return { dx: 0, dy: 0.19, anchor: 'middle' };
}

/* 原书标号：a3、c10?、6 */
function labelOf(c) {
    return (c[3] === 0 ? 'a' : c[3] === 1 ? 'c' : '') + c[2] +
        (c[5] ? '′' : '') + (c[4] ? '?' : '');
}

function startWith(item) {
    S.cur = item.op;
    S.five = item.five;
    S.n5 = S.five[2];
    S.phase = 0;
    S.ansA = null;
    S.ansB = null;
    S.stats.n += 1;
    render();
}

/* 一轮里每个开局先只出一题，分组轮转，避免同开局的两题挨在一起 */
function stQueue() {
    const groups = {};
    ST_BANK.forEach(function (t, k) {
        const key = t.op.p;
        (groups[key] || (groups[key] = [])).push(k);
    });
    const keys = shuffle(Object.keys(groups));
    const list = [];
    let more = true;
    while (more) {
        more = false;
        keys.forEach(function (key) {
            if (groups[key].length) {
                list.push(groups[key].pop());
                more = true;
            }
        });
    }
    return list;
}

function startQuestion() {
    if (!ST_BANK.length) {
        return;
    }
    /* 地址栏 ?p=68 指定原书页码，方便对着书看；只认第一次 */
    if (!S.forced) {
        S.forced = true;
        const want = Number(new URLSearchParams(location.search).get('p'));
        const hit = want ? ST_BANK.filter((t) => t.op.p === want)[0] : null;
        if (hit) {
            startWith(hit);
            return;
        }
    }
    if (!S.queue.length) {
        S.queue = stQueue();
        /* 新一轮别跟上一题撞上同一个开局 */
        if (S.cur && S.queue.length > 1) {
            const last = S.queue[S.queue.length - 1];
            if (ST_BANK[last].op === S.cur) {
                let swap = -1;
                for (let k = S.queue.length - 2; k >= 0; k--) {
                    if (ST_BANK[S.queue[k]].op !== S.cur) {
                        swap = k;
                        break;
                    }
                }
                if (swap >= 0) {
                    S.queue[S.queue.length - 1] = S.queue[swap];
                    S.queue[swap] = last;
                }
            }
        }
    }
    startWith(ST_BANK[S.queue.pop()]);
}

/* ---------- 文案 ---------- */

/* 打数表：highlight 那一档加粗标出来 */
function rowsHTML(op, pick, prime) {
    const tab = (prime && op.rp) ? op.rp : op.r;
    const rows = tab.map(function (row) {
        return { a: row[0], b: row[1], res: row[2], hit: row[0] <= pick && pick <= row[1] };
    });
    if (!rows.some((r) => r.hit)) {
        const made = { a: pick, b: pick, res: tableAt(tab, pick) || '黑败', hit: true, guess: true };
        let at = rows.findIndex((r) => r.a > pick);
        if (at < 0) {
            rows.push(made);
        } else {
            rows.splice(at, 0, made);
        }
    }
    let html = '<div class="sd-table-cap">' + (prime ? '撇号那一点的打数表（原书 ′ 栏）' : '打数表') +
        '</div>';
    html += '<table class="sd-table"><tr><th>打数</th><th>书上评估</th></tr>';
    rows.forEach(function (r) {
        const lab = (r.a === r.b ? String(r.a) : r.a + '–' + r.b) + ' 打';
        html += '<tr class="' + (r.hit ? 'is-pick' : '') + '"><td>' + lab +
            '</td><td class="res">' + r.res + (r.guess ? '（按表推）' : '') + '</td></tr>';
    });
    html += '</table>';
    return html;
}

function whyA(op) {
    const raw = tenResult(op);
    const can = OK_TEN.has(cat(raw));
    const rows = op.r;
    const lo = rows[0][0];
    const hi = rows[rows.length - 1][1];
    let why;
    if (10 < lo) {
        why = '书里这局从 ' + lo + ' 打起就已是「' + rows[0][2] + '」；十打比它少 ' +
            (lo - 10) + ' 个点，对黑只会更宽，十打自然给得。';
    } else if (10 > hi) {
        why = '书里的表开到 ' + hi + ' 打为止，再往上（含十打）一律记「黑败」，' +
            '所以十打不能给。';
    } else {
        why = '书里十打这一格是「' + say(raw) + '」，' +
            (can ? '还在「白小优」以内，可以给。' : '已经越过「白小优」，得往少里给。');
    }
    if (!can && maxGood(op)) {
        why += '按表最多给到 ' + maxGood(op) + ' 打。';
    }
    return why;
}

/* 第一问答完压成一行，让第二问就落在原位，不用往下翻 */
function doneHTML(op) {
    const raw = tenResult(op);
    const can = OK_TEN.has(cat(raw));
    const ok = S.ansA === (can ? 1 : 0);
    return '<div class="sd-done ' + (ok ? 'ok' : 'bad') + '">' +
        '<span class="sd-mark">' + (ok ? '✓' : '✗') + '</span>' +
        '<span>十打 → <b>' + say(raw) + '</b>，' + (can ? '能直接给' : '不能给') +
        (ok ? '' : '；你选了' + (S.ansA ? '「能」' : '「不能」')) + '</span></div>';
}

function fbB(op) {
    const raw = pointRes(op, S.five);
    const truth = cat(raw);
    const core = CORE[truth] || 3;
    const g = gradeB(S.ansB, truth);
    const exact = g === 'ok';
    const fits = g === 'mid';
    const name = exact ? bucketOf(S.ansB).name : bucketOf(core).name;
    const give = '黑方这次给的是 <b>' + S.n5 + ' 打</b>（原书标 ' + labelOf(S.five) + '）。';
    let tip;
    if (exact) {
        tip = give + S.n5 + ' 打摊下来是「' + say(raw) + '」，正落在「' + name + '」。';
    } else if (fits) {
        tip = give + S.n5 + ' 打摊下来是「' + say(raw) + '」。这一档只算擦边，记半分；' +
            '照书里的表更贴「' + name + '」。';
    } else {
        tip = give + S.n5 + ' 打摊下来是「' + say(raw) + '」，该归「' + name + '」。';
    }
    return '<div class="sd-fb">' +
        '<span class="sd-verdict ' + (exact ? 'ok' : (fits ? 'mid' : 'bad')) + '">' +
        (exact ? '判断正确' : (fits ? '擦边，算半对' : '判断有误')) + '</span>' +
        '<p>' + tip + '</p>' +
        rowsHTML(op, S.n5, S.five[5]) +
        '<p class="sd-note">表里到 ' + ((S.five[5] && op.rp) ? op.rp : op.r).slice(-1)[0][1] +
        ' 打为止，再往上书里一律记黑败。</p></div>';
}

/* ---------- 视图 ---------- */

function sideHTML() {
    const op = S.cur;
    let html = '<div class="sd-head"><span class="sd-opening">' + op.f + ' · ' + op.n +
        '</span><span class="sd-page">原书 ' + op.p + ' 页</span></div>';

    if (S.phase === 0) {
        html += '<div class="sd-step">第一问 · 打数</div>';
        html += '<p class="sd-q">四手已经摆好。第五手能不能<em>直接给十打</em>？' +
            '一次摊开十个打点，由白方任挑一个。</p>';
        html += '<div class="sd-opts">';
        [[1, '能，直接给十打', '十打之后黑方还站得住'],
         [0, '不能', '十打把白方喂得太饱']].forEach(function (o) {
            html += '<button type="button" class="sd-opt" data-a="' + o[0] + '"><b>' +
                o[1] + '</b><span>' + o[2] + '</span></button>';
        });
        html += '</div>';
        return html;
    }

    html += doneHTML(op);

    const bOpen = S.phase === 1;
    html += '<div class="sd-step">第二问 · 局面</div>';
    html += '<p class="sd-q">当黑方第五手落子于 <em>' +
        coord(S.five[0], S.five[1]) + '</em> 处时，局面算哪一档？</p>';
    if (S.phase === 1) {
        html += '<p class="sd-hint">黑方这次给的是几打，先不告诉你；选完再揭。</p>';
    }
    html += '<div class="sd-opts">';
    BUCKETS.forEach(function (b) {
        let cls = 'sd-opt';
        if (!bOpen) {
            const truth = cat(pointRes(op, S.five));
            const g = gradeB(b.key, truth);
            if (g === 'ok') {
                cls += ' is-ok';
            } else if (b.key === S.ansB) {
                cls += g === 'mid' ? ' is-mid' : ' is-bad';
            } else {
                cls += ' is-mute';
            }
        }
        html += '<button type="button" class="' + cls + '" data-b="' + b.key + '"' +
            (bOpen ? '' : ' disabled') + '><b>' + b.name + '</b><span>' + noteHTML(b) +
            '</span></button>';
    });
    html += '</div>';
    if (S.phase >= 2) {
        html += fbB(op);
        html += '<p class="sd-note">' + whyA(op) + '</p>';
    }
    return html;
}

function renderScore() {
    const el = document.getElementById('sd-score');
    if (!el) {
        return;
    }
    const bOk = Math.round(S.stats.bOk * 10) / 10;
    el.innerHTML = '第 <b>' + S.stats.n + '</b> 题 · 打数对 <b>' + S.stats.aOk + '/' +
        S.stats.a + '</b> · 局面对 <b>' + bOk + '/' + S.stats.b +
        '</b>（擦边 ' + S.stats.bMid + ' 个）';
}

function bindSide() {
    Array.prototype.forEach.call(
        document.querySelectorAll('#sd-side [data-a]'),
        function (btn) {
            if (S.phase !== 0) {
                return;
            }
            btn.addEventListener('click', function () {
                S.ansA = Number(btn.getAttribute('data-a'));
                S.phase = 1;
                S.stats.a += 1;
                if (S.ansA === (OK_TEN.has(cat(tenResult(S.cur))) ? 1 : 0)) {
                    S.stats.aOk += 1;
                }
                render();
            });
        });

    Array.prototype.forEach.call(
        document.querySelectorAll('#sd-side [data-b]'),
        function (btn) {
            if (S.phase !== 1) {
                return;
            }
            btn.addEventListener('click', function () {
                const key = Number(btn.getAttribute('data-b'));
                const truth = cat(pointRes(S.cur, S.five));
                const g = gradeB(key, truth);
                S.ansB = key;
                S.phase = 2;
                S.stats.b += 1;
                if (g === 'ok') {
                    S.stats.bOk += 1;
                } else if (g === 'mid') {
                    S.stats.bOk += 0.5;
                    S.stats.bMid += 1;
                }
                render();
            });
        });
}

/* ==========================================================================
 * 五手两打
 * --------------------------------------------------------------------------
 * 一题两步。先问白方换不换；再让黑方在盘上点两个点当第五手的两打。
 *
 * 交换只有 26 种开局，按书里的强弱分档：
 *   疏星、瑞星      纯平衡      → 视情况
 *   丘月、斜月      黑小优      → 视情况
 *   长星、流星      白优        → 视情况 / 不交换
 *   彗星、游星      白必胜      → 不交换
 *   其余                         → 交换
 *
 * 两打：书里 1 打、2 打那两个点就是黑方该先摆出来的两手。用户点两下即判。
 * 若白方最舒服的两手本身就是白必胜（黑方怎么给都挡不住），把这两点亮在盘
 * 上，换成用户执白挑一手：哪一手对白更好。
 *
 * 判分：踩中 1、2 打算对；两手都没越过白小优算擦边（半分）；任一手落到
 * 白大优 / 白近胜 / 白必胜算错。
 * ========================================================================== */

const FAM_CN = { '鬆月': '松月' };
const famName = (f) => FAM_CN[f] || f;

const SWAP = {
    '疏星': { take: ['dep'], tag: '纯平衡', why: '两边都差不多，换与不换看你熟哪一边。' },
    '瑞星': { take: ['dep'], tag: '纯平衡', why: '两边都差不多，换与不换看你熟哪一边。' },
    '丘月': { take: ['dep'], tag: '黑小优', why: '黑方略占便宜，换了能接着这点便宜下。' },
    '斜月': { take: ['dep'], tag: '黑小优', why: '黑方略占便宜，换了能接着这点便宜下。' },
    '长星': { take: ['dep', 'no'], tag: '白优', why: '白方本来就舒服，换与不换都说得过去。' },
    '流星': { take: ['dep', 'no'], tag: '白优', why: '白方本来就舒服，换与不换都说得过去。' },
    '彗星': { take: ['no'], tag: '白必胜', why: '书里记这一路白必胜，白方没必要交换。' },
    '游星': { take: ['no'], tag: '白必胜', why: '书里记这一路白必胜，白方没必要交换。' }
};

const SWAP_DEF = { take: ['swap'], tag: '黑不亏', why: '这一路黑方不亏，白方该换。' };
const swapRule = (f) => SWAP[f] || SWAP_DEF;

const SWAP_WORD = { swap: '交换', dep: '视情况', no: '不交换' };

/* 白视角打分：数字越大越偏黑，用来比「哪一手更好」 */
const WSCORE = {
    '白必胜': 0, '白近胜': 1, '白大优': 2, '白小优': 3, '偏白': 4,
    '平衡': 5, '偏黑': 6, '黑小优': 7, '黑大优': 8, '黑近胜': 9, '黑必胜': 10
};

/* 越过白小优就算把局面送掉 */
const WS_BAD = new Set(['白大优', '白近胜', '白必胜']);

const W = {
    op: null,
    pool: [],
    seen: {},
    phase: 0,        // 0 未答交换；1 待点两打；2 已判
    swap: null,
    picks: [],
    mode2: 'free',   // 'free' 自己点 | 'pick2' 二选一
    res: null,
    msg: '',
    stats: { n: 0, s: 0, sOk: 0, t: 0, tOk: 0, tMid: 0 }
};

/* 书里的打点摊成一张表：n 是第几打，res 是这一打的结果 */
function wsCands(op) {
    return op.c.map(function (c) {
        return { i: c[0], j: c[1], n: c[2], res: cat(pointRes(op, c)), raw: c };
    });
}

/* 黑方最强的两手 = 打数最小的两个点 */
function wsTop2(op) {
    const list = wsCands(op).sort(function (a, b) {
        if (a.n !== b.n) {
            return a.n - b.n;
        }
        return WSCORE[b.res] - WSCORE[a.res];
    });
    const out = [];
    list.forEach(function (c) {
        if (out.length < 2 && !out.some((o) => o.n === c.n)) {
            out.push(c);
        }
    });
    return out;
}

/* 白方最舒服的两手：白优在前，同档时打数大的更松，排前面 */
function wsBestWhite(op) {
    return wsCands(op).sort(function (a, b) {
        const d = WSCORE[a.res] - WSCORE[b.res];
        return d !== 0 ? d : b.n - a.n;
    }).slice(0, 2);
}

/* 书里第一个「黑胜」档从几打起；没有这一档就是整局都到不了黑胜 */
function wsFirstWin(op) {
    for (let k = 0; k < op.r.length; k++) {
        if (cat(op.r[k][2]) === '黑必胜') {
            return op.r[k][0];
        }
    }
    return null;
}

/*
 * 出题按四组配额抽：2 打就黑必胜 55%、整局没有黑胜档 12%、
 * 3–4 打才见黑胜 18%、5 打往上才黑胜 15%。
 * 组内洗牌不放回，抽完再洗，免得同一局连着来；配额管的是长期比例，
 * 不受各组局数多少影响（5 打以上那一组局最多，但不能因此霸屏）。
 */
const WS_QUOTA = [['g2', 55], ['g0', 12], ['g34', 18], ['g5', 15]];
const WS_SRC = {};
const WS_BAG = {};

function wsBucket(op) {
    const s = wsFirstWin(op);
    if (s === null) {
        return 'g0';
    }
    if (s <= 2) {
        return 'g2';
    }
    return s <= 4 ? 'g34' : 'g5';
}

function wsFill() {
    Object.keys(WS_SRC).forEach(function (k) { delete WS_SRC[k]; });
    Object.keys(WS_BAG).forEach(function (k) { delete WS_BAG[k]; });
    OPEN.forEach(function (o) {
        if (!o.c || o.c.length < 2) {
            return;
        }
        const k = wsBucket(o);
        (WS_SRC[k] || (WS_SRC[k] = [])).push(o);
    });
    Object.keys(WS_SRC).forEach(function (k) {
        WS_BAG[k] = shuffle(WS_SRC[k].slice());
    });
}

function wsPick() {
    if (!WS_SRC.g2) {
        wsFill();
    }
    let roll = Math.random() * 100;
    let key = 'g5';
    for (let k = 0; k < WS_QUOTA.length; k++) {
        roll -= WS_QUOTA[k][1];
        if (roll <= 0) {
            key = WS_QUOTA[k][0];
            break;
        }
    }
    if (!WS_BAG[key] || !WS_BAG[key].length) {
        WS_BAG[key] = shuffle((WS_SRC[key] || []).slice());
    }
    const bag = WS_BAG[key];
    return bag.length ? bag.pop() : OPEN[0];
}

function wsStart() {
    let op = null;
    /* 地址栏 ?p=68 直接跳到原书那一页，方便对着书看；只认第一次 */
    if (!S.forced) {
        S.forced = true;
        const want = Number(new URLSearchParams(location.search).get('p'));
        if (want) {
            op = OPEN.filter(function (o) {
                return o.p === want && o.c && o.c.length >= 2;
            })[0] || null;
        }
    }
    W.op = op || wsPick();
    W.phase = 0;
    W.swap = null;
    W.picks = [];
    W.mode2 = 'free';
    W.res = null;
    W.msg = '';
    W.stats.n += 1;
    wsRender();
}

function wsAnswerSwap(word) {
    const op = W.op;
    W.swap = word;
    W.phase = 1;
    W.stats.s += 1;
    if (swapRule(op.f).take.indexOf(word) >= 0) {
        W.stats.sOk += 1;
    }
    /* 白方最舒服的两手本身就是白必胜，就把这俩亮出来改问「哪一手对白更好」 */
    const two = wsBestWhite(op);
    W.mode2 = two.length === 2 && two.every(function (c) { return c.res === '白必胜'; })
        ? 'pick2' : 'free';
    wsRender();
}

function wsPoint(p) {
    const op = W.op;
    if (!p || p.i < 0 || p.i > 14 || p.j < 0 || p.j > 14) {
        return;
    }
    if (W.phase !== 1) {
        return;
    }
    if (op.m.some(function (m) { return m[0] === p.i && m[1] === p.j; })) {
        return;
    }
    if (W.mode2 === 'pick2') {
        const top = wsTop2(op);
        const k = top.findIndex(function (c) { return c.i === p.i && c.j === p.j; });
        if (k >= 0) {
            wsChoose(k);
        }
        return;
    }
    if (W.picks.length >= 2 || W.picks.some(function (q) { return q.i === p.i && q.j === p.j; })) {
        return;
    }
    W.picks.push({ i: p.i, j: p.j });
    W.msg = '';
    if (W.picks.length === 2) {
        wsGrade();
    }
    wsRender();
}

function wsGrade() {
    const op = W.op;
    const all = wsCands(op);
    const top = wsTop2(op);
    const key = (c) => c.i + ',' + c.j;
    const keys = top.map(key);
    /* 书里没记这一点：mine 里留 null，下面按「黑方走到这儿就败」处理 */
    const mine = W.picks.map(function (p) {
        return all.filter(function (c) { return c.i === p.i && c.j === p.j; })[0] || null;
    });
    const same = mine.every(function (c) { return c && keys.indexOf(key(c)) >= 0; });
    const wins = all.filter(function (c) { return c.res === '黑必胜'; });
    const allWin = wins.length > 2 && mine.every(function (c) { return c && c.res === '黑必胜'; });
    const ok = same || allWin;
    const bad = mine.filter(function (c) { return !c || WS_BAD.has(c.res); });
    W.res = {
        kind: ok ? 'ok' : (bad.length ? 'bad' : 'mid'),
        top: top,
        mine: mine,
        same: same,
        allWin: allWin
    };
    W.phase = 2;
    W.stats.t += 1;
    if (ok) {
        W.stats.tOk += 1;
    } else if (!bad.length) {
        W.stats.tOk += 0.5;
        W.stats.tMid += 1;
    }
}

function wsChoose(k) {
    const two = wsBestWhite(W.op);
    const me = two[k];
    const other = two[1 - k];
    /* 你执白：白优越大越好；同为白必胜时，书里打数大的那手更松，对白更有利 */
    const mine = WSCORE[me.res];
    const theirs = WSCORE[other.res];
    const ok = mine < theirs || (mine === theirs && me.n >= other.n);
    W.res = { kind: ok ? 'ok' : 'bad', top: two, pick2: true, k: k };
    W.phase = 2;
    W.stats.t += 1;
    if (ok) {
        W.stats.tOk += 1;
    }
}

/* ---------- 两打的视图 ---------- */

const TAG_TEXT = {
    '纯平衡': '是纯平衡局',
    '黑小优': '黑方略占优',
    '白优': '白方占优',
    '白必胜': '白方必胜',
    '黑不亏': '黑方不亏'
};

function wsDoneHTML() {
    const op = W.op;
    const rule = swapRule(op.f);
    const ok = rule.take.indexOf(W.swap) >= 0;
    const want = rule.take.length > 1
        ? '「' + SWAP_WORD[rule.take[0]] + '」或「' + SWAP_WORD[rule.take[1]] + '」'
        : '「' + SWAP_WORD[rule.take[0]] + '」';
    return '<div class="sd-done ' + (ok ? 'ok' : 'bad') + '">' +
        '<span class="sd-mark">' + (ok ? '✓' : '✗') + '</span>' +
        '<span>该<b>' + want + '</b>：' + famName(op.f) +
        (TAG_TEXT[rule.tag] || '') + '。你选了「' + SWAP_WORD[W.swap] + '」</span></div>';
}

function wsPickText() {
    if (!W.res.mine) {
        return '';
    }
    return W.picks.map(function (p, k) {
        const c = W.res.mine[k];
        return coord(p.i, p.j) + '（' + (c ? c.n + ' 打 · ' + c.res : 'c · 书里未记') + '）';
    }).join('、');
}

function wsFB() {
    const op = W.op;
    const res = W.res;
    const two = res.top.map(function (c) {
        return '<b>' + coord(c.i, c.j) + '</b>（' + c.n + ' 打 · ' + c.res + '）';
    }).join('、');
    const mineTxt = wsPickText();
    let tip;
    if (res.pick2) {
        const a = res.top[0];
        const b = res.top[1];
        tip = '你执白，这两点是盘上最舒服的两手，都是白必胜：' +
            coord(a.i, a.j) + ' 记 ' + a.n + ' 打，' + coord(b.i, b.j) + ' 记 ' + b.n +
            ' 打。摊得越多白方越松，所以 ' + coord(a.i, a.j) + ' 更值得拿。';
    } else if (res.kind === 'ok') {
        tip = res.allWin
            ? '黑必胜的点不止两个，你给的两手都在里面，够了。书里排在最前的是 ' + two + '。'
            : '正是书里的两打：' + two + '。';
    } else if (res.kind === 'mid') {
        tip = '书里的两打是 ' + two + '。你给的是 ' + mineTxt +
            '，都没越过白小优，局面还守得住，只是没踩到最紧的两手。';
    } else {
        const lost = res.mine.filter(function (c) { return !c || WS_BAD.has(c.res); });
        const words = lost.map(function (c) {
            return c ? ('「' + c.res + '」') : '书里没记的那手（c，黑败）';
        }).join('、');
        tip = '你给的是 ' + mineTxt + '，其中' + words +
            '，白方接着走就把局面收下了。书里的两打是 ' + two + '。';
    }
    const head = res.pick2
        ? (res.kind === 'ok' ? '选对了' : '选错了')
        : (res.kind === 'ok' ? '两打正确' : (res.kind === 'mid' ? '擦边，算半对' : '判断有误'));
    const note = res.pick2
        ? '这题换了边：你执白，只挑一手。'
        : '金圈是书里的两打，圈里的数字就是第几打；你点的位置若不在两打里，' +
          '盘上会写出它自己的打数，书里没记的写 c（黑败）。你点的那几手用绿圈标出，' +
          '已经送掉的（或书里没记的）用红圈。';
    return '<div class="sd-fb">' +
        '<span class="sd-verdict ' + res.kind + '">' + head + '</span>' +
        '<p>' + tip + '</p>' +
        '<p class="sd-note">' + note + '</p></div>';
}

function wsSideHTML() {
    const op = W.op;
    let html = '<div class="sd-head"><span class="sd-opening">' + famName(op.f) +
        ' · ' + op.n + '</span><span class="sd-page">原书 ' + op.p + ' 页</span></div>';

    if (W.phase === 0) {
        html += '<div class="sd-step">第一问 · 交换</div>';
        html += '<p class="sd-q">对方执黑摆出「<em>' + famName(op.f) +
            '</em>」。你执白，换不换？</p>';
        html += '<div class="sd-opts sd-opts-row">';
        [['swap', '交换', '接过来执黑'], ['dep', '视情况', '看白4再定'],
         ['no', '不交换', '接着执白']].forEach(function (o) {
            html += '<button type="button" class="sd-opt" data-w="' + o[0] + '"><b>' +
                o[1] + '</b><span>' + o[2] + '</span></button>';
        });
        html += '</div>';
        html += '<p class="sd-hint">塔拉山口：白方一句话定，换了就是执黑。盘上先只摆开局三手，白 4 等你定完再落。</p>';
        return html;
    }

    html += wsDoneHTML();
    html += '<div class="sd-step">第二问 · ' +
        (W.mode2 === 'pick2' ? '挑一手' : '五手两打') + '</div>';

    if (W.mode2 === 'pick2') {
        html += '<p class="sd-q">盘上 <em>A</em>、<em>B</em> 是白方最舒服的两手，都是白必胜。' +
            '轮到你执白挑一个：哪个对你更好？</p>';
        if (W.phase === 1) {
            html += '<div class="sd-opts sd-opts-row">';
            wsBestWhite(op).forEach(function (c, k) {
                html += '<button type="button" class="sd-opt" data-c="' + k +
                    '"><b>' + 'AB'.charAt(k) + '</b><span>' + coord(c.i, c.j) +
                    '</span></button>';
            });
            html += '</div>';
            html += '<p class="sd-hint">两手都是白必胜，挑白方拿得更松的那手。</p>';
        }
    } else {
        html += '<p class="sd-q">白方走了 <em>' + coord(op.m[3][0], op.m[3][1]) +
            '</em>。轮到你给两打：在盘上点两个点。</p>';
        if (W.phase === 1) {
            html += '<p class="sd-hint">' + (W.picks.length
                ? '已点 ' + W.picks.length + ' 个，再点 ' + (2 - W.picks.length) + ' 个。'
                : '点到交叉点上，两个点凑齐立刻判。') + '</p>';
            if (W.msg) {
                html += '<p class="sd-hint sd-warn">' + W.msg + '</p>';
            }
            if (W.picks.length) {
                html += '<button type="button" class="sd-next sd-ghost" data-w="again">重选</button>';
            }
        }
    }

    if (W.phase === 2) {
        html += wsFB();
        html += '<p class="sd-note">' + swapRule(op.f).why + '</p>';
    }
    return html;
}

function wsScore() {
    const el = document.getElementById('sd-score');
    if (!el) {
        return;
    }
    const t = Math.round(W.stats.tOk * 10) / 10;
    el.innerHTML = '第 <b>' + W.stats.n + '</b> 局 · 交换对 <b>' + W.stats.sOk + '/' +
        W.stats.s + '</b> · 两打对 <b>' + t + '/' + W.stats.t + '</b>（擦边 ' +
        W.stats.tMid + ' 个）';
}

function wsRender() {
    const op = W.op;
    if (!op || !S.board) {
        return;
    }
    /* 开局先只摆三手（26 种开局本身），白 4 等第一问答完再落 */
    const shown = W.phase === 0 ? op.m.slice(0, 3) : op.m;
    S.board.setMoves(shown.map(function (m) {
        return { i: m[0], j: m[1], color: m[2] };
    }));

    const marks = [];
    const notes = [];
    const push = function (c, text, size, tone, dx, dy, anchor) {
        notes.push({ i: c.i, j: c.j, text: text, size: size, tone: tone, dx: dx, dy: dy, anchor: anchor });
    };

    if (W.phase === 1 && W.mode2 === 'pick2') {
        wsBestWhite(op).forEach(function (c, k) {
            marks.push({ i: c.i, j: c.j, kind: 'warn' });
            push(c, 'AB'.charAt(k), 0.95, 'warn', 0, 0.19, 'middle');
        });
    } else if (W.phase === 1) {
        W.picks.forEach(function (p, k) {
            marks.push({ i: p.i, j: p.j, kind: 'warn' });
            push({ i: p.i, j: p.j }, String(k + 1), 0.95, 'warn', 0, 0.19, 'middle');
        });
    }

    if (W.phase === 2) {
        /* 只钉住书里的两点，其余打点不铺，免得二十几行字挤成一团 */
        const top = W.res ? W.res.top : [];
        top.forEach(function (c) {
            push(c, String(c.n), 0.9, 'warn', 0, 0.19, 'middle');
            marks.push({ i: c.i, j: c.j, kind: 'warn' });
        });
        if (W.res.pick2) {
            const me = top[W.res.k];
            if (me) {
                marks.push({ i: me.i, j: me.j, kind: W.res.kind === 'ok' ? 'good' : 'bad' });
            }
        } else {
            W.picks.forEach(function (p, k) {
                const isTop = top.some(function (t) { return t.i === p.i && t.j === p.j; });
                const c = W.res.mine[k];
                /* 这一点自己的成色：没记或越过白小优是红的，还没送掉就是绿的 */
                const tone = (!c || WS_BAD.has(c.res)) ? 'bad' : 'good';
                marks.push({ i: p.i, j: p.j, kind: isTop ? 'good' : tone });
                if (!isTop) {
                    /* 不是最紧的两手：把这一点自己的打数写出来，书里没记的写 c */
                    push({ i: p.i, j: p.j }, c ? String(c.n) : 'c', 0.9, tone, 0, 0.19, 'middle');
                }
            });
        }
    }

    S.board.setMarks(marks);
    S.board.setNotes(notes);

    const side = document.getElementById('sd-side');
    if (side) {
        side.innerHTML = wsSideHTML();
        wsBind();
        if (W.phase === 1 && window.innerWidth <= 820) {
            const box = side.getBoundingClientRect();
            if (box.top < 0 || box.top > window.innerHeight * 0.6) {
                side.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }
    }
    wsScore();
}

function wsBind() {
    Array.prototype.forEach.call(
        document.querySelectorAll('#sd-side [data-w]'),
        function (btn) {
            btn.addEventListener('click', function () {
                const what = btn.getAttribute('data-w');
                if (W.phase === 0) {
                    wsAnswerSwap(what);
                } else if (what === 'again') {
                    W.picks = [];
                    W.msg = '';
                    wsRender();
                }
            });
        });

    Array.prototype.forEach.call(
        document.querySelectorAll('#sd-side [data-c]'),
        function (btn) {
            btn.addEventListener('click', function () {
                if (W.phase === 1 && W.mode2 === 'pick2') {
                    wsChoose(Number(btn.getAttribute('data-c')));
                    wsRender();
                }
            });
        });
}

function render() {
    if (S.mode === 'ws') {
        wsRender();
        return;
    }
    const op = S.cur;
    if (!op || !S.board) {
        return;
    }
    const moves = op.m.map((m) => ({ i: m[0], j: m[1], color: m[2] }));
    if (S.phase >= 1 && S.five) {
        moves.push({ i: S.five[0], j: S.five[1], color: 'b' });
    }
    S.board.setMoves(moves);
    S.board.setMarks(S.phase >= 1 && S.five
        ? [{ i: S.five[0], j: S.five[1], kind: 'warn' }]
        : []);

    if (S.phase >= 2 && S.five) {
        /* 答完把整盘打点摊出来，题目那一点用金圈压住 */
        const list = op.c.map(function (c) {
            const isFive = c[0] === S.five[0] && c[1] === S.five[1];
            const spot = isFive ? noteSpot(op, c) : noteSide(c);
            return {
                i: c[0], j: c[1], text: labelOf(c), size: isFive ? 0.92 : 0.62,
                tone: isFive ? 'warn' : (c[3] === 0 ? 'good' : (c[3] === 1 ? 'bad' : 'mute')),
                dx: spot.dx, dy: spot.dy, anchor: spot.anchor
            };
        });
        S.board.setNotes(list);
    } else {
        S.board.setNotes([]);
    }

    const side = document.getElementById('sd-side');
    if (side) {
        side.innerHTML = sideHTML();
        bindSide();
        /* 窄屏上第二问落在棋盘下面，答完第一问把它带到眼前 */
        if (S.phase === 1 && window.innerWidth <= 820) {
            const box = side.getBoundingClientRect();
            if (box.top < 0 || box.top > window.innerHeight * 0.6) {
                side.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }
    }
    renderScore();
}

function setMode(m) {
    if (S.mode === m) {
        return;
    }
    S.mode = m;
    Array.prototype.forEach.call(
        document.querySelectorAll('[data-sd-mode]'),
        function (b) {
            b.classList.toggle('is-on', b.getAttribute('data-sd-mode') === m);
        });
    S.board.setNotes([]);
    S.board.setMarks([]);
    if (m === 'ws') {
        wsStart();
    } else if (!S.cur) {
        startQuestion();
    } else {
        render();
    }
}

export function boot() {
    const host = document.getElementById('sd-board');
    if (!host || !OPEN.length) {
        return;
    }
    if (host.dataset.ready === '1') {
        return;
    }
    host.dataset.ready = '1';

    S.board = window.GomokuBoard.mount(host, {
        numbers: true,
        coords: true,
        moves: [],
        editable: false
    });

    /* 盘上点两下就是两打 */
    host.addEventListener('click', function (e) {
        if (S.mode !== 'ws' || !S.board) {
            return;
        }
        wsPoint(S.board.hit(e));
    });

    Array.prototype.forEach.call(
        document.querySelectorAll('[data-sd-mode]'),
        function (b) {
            b.classList.toggle('is-on', b.getAttribute('data-sd-mode') === S.mode);
            b.addEventListener('click', function () {
                setMode(b.getAttribute('data-sd-mode'));
            });
        });

    const next = document.getElementById('sd-next');
    if (next) {
        next.addEventListener('click', function () {
            if (S.mode === 'ws') {
                wsStart();
            } else {
                startQuestion();
            }
        });
    }

    const reset = document.getElementById('sd-reset');
    if (reset) {
        reset.addEventListener('click', function () {
            if (S.mode === 'ws') {
                W.stats = { n: 0, s: 0, sOk: 0, t: 0, tOk: 0, tMid: 0 };
                W.seen = {};
                wsScore();
            } else {
                S.stats = { n: 0, a: 0, aOk: 0, b: 0, bOk: 0, bMid: 0 };
                renderScore();
            }
        });
    }

    if (S.mode === 'ws') {
        if (!W.op) {
            wsStart();
        } else {
            wsRender();
        }
    } else if (!S.cur) {
        startQuestion();
    } else {
        render();
    }
}
