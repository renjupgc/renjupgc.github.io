/*
 * 十打判断 - 出题与判分
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

/* 书里的简称归一：黑胜就是黑必胜，黑败就是白必胜 */
const NORM = { '黑胜': '黑必胜', '黑败': '白必胜', '白胜': '白必胜' };
const cat = (r) => NORM[r] || r;

/* 十打仍可接受的那一档 */
const OK_TEN = new Set([
    '黑必胜', '黑近胜', '黑大优', '黑小优', '偏黑', '平衡', '偏白', '白小优'
]);

/* 五档：名字、包含的评估 */
const BUCKETS = [
    { key: 1, name: '黑很好', note: '黑必胜、黑近胜、黑大优',
      set: ['黑必胜', '黑近胜', '黑大优'] },
    { key: 2, name: '黑稍好', note: '黑近胜、黑大优、黑小优、偏黑、平衡',
      set: ['黑近胜', '黑大优', '黑小优', '偏黑', '平衡'] },
    { key: 3, name: '大致均势', note: '黑小优、偏黑、平衡、偏白、白小优',
      set: ['黑小优', '偏黑', '平衡', '偏白', '白小优'] },
    { key: 4, name: '白稍好', note: '白近胜、白大优、白小优、偏白、平衡',
      set: ['白近胜', '白大优', '白小优', '偏白', '平衡'] },
    { key: 5, name: '白很好', note: '白必胜、白近胜',
      set: ['白必胜', '白近胜'] }
];

/* 每个评估的「本档」：重叠时以这里为准 */
const CORE = {
    '黑必胜': 1, '黑近胜': 1, '黑大优': 1,
    '黑小优': 2, '偏黑': 2,
    '平衡': 3,
    '偏白': 4, '白小优': 4,
    '白大优': 5, '白近胜': 5, '白必胜': 5
};

const S = {
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

/* 第二问随机挑一档打数，上限压到 12，免得问出十六打这种没人会用的数 */
function pickN(op) {
    const list = [];
    op.r.forEach(function (row) {
        const top = Math.min(row[1], 12);
        for (let n = Math.max(row[0], 2); n <= top; n++) {
            list.push(n);
        }
    });
    return list.length ? list[Math.floor(Math.random() * list.length)] : 10;
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

/* 第五手就从一个打点里随手取一个 */
function pickFive(op) {
    return op.c.length ? op.c[Math.floor(Math.random() * op.c.length)] : [7, 8, 1];
}

function startWith(op) {
    S.cur = op;
    S.five = pickFive(op);
    S.n5 = pickN(op);
    S.phase = 0;
    S.ansA = null;
    S.ansB = null;
    S.stats.n += 1;
    render();
}

function startQuestion() {
    if (!OPEN.length) {
        return;
    }
    /* 地址栏 ?p=68 指定原书页码，方便对着书看；只认第一次 */
    if (!S.forced) {
        S.forced = true;
        const want = Number(new URLSearchParams(location.search).get('p'));
        const hit = want ? OPEN.filter((o) => o.p === want)[0] : null;
        if (hit) {
            startWith(hit);
            return;
        }
    }
    if (!S.queue.length) {
        S.queue = shuffle(OPEN.map((o, k) => k));
        /* 新一轮别跟上一题撞上同一个开局 */
        if (S.cur && S.queue.length > 1 && OPEN[S.queue[S.queue.length - 1]] === S.cur) {
            S.queue.unshift(S.queue.pop());
        }
    }
    startWith(OPEN[S.queue.pop()]);
}

/* ---------- 文案 ---------- */

/* 打数表：highlight 那一档加粗标出来 */
function rowsHTML(op, pick) {
    const rows = op.r.map(function (row) {
        return { a: row[0], b: row[1], res: row[2], hit: row[0] <= pick && pick <= row[1] };
    });
    if (!rows.some((r) => r.hit)) {
        const made = { a: pick, b: pick, res: resultAt(op, pick), hit: true, guess: true };
        let at = rows.findIndex((r) => r.a > pick);
        if (at < 0) {
            rows.push(made);
        } else {
            rows.splice(at, 0, made);
        }
    }
    let html = '<table class="sd-table"><tr><th>打数</th><th>书上评估</th></tr>';
    rows.forEach(function (r) {
        const lab = (r.a === r.b ? String(r.a) : r.a + '–' + r.b) + ' 打';
        html += '<tr class="' + (r.hit ? 'is-pick' : '') + '"><td>' + lab +
            '</td><td class="res">' + r.res + (r.guess ? '（按表推）' : '') + '</td></tr>';
    });
    html += '</table>';
    return html;
}

function fbA(op) {
    const raw = tenResult(op);
    const can = OK_TEN.has(cat(raw));
    const ok = S.ansA === (can ? 1 : 0);
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
    return '<div class="sd-fb">' +
        '<span class="sd-verdict ' + (ok ? 'ok' : 'bad') + '">' +
        (ok ? '判断正确' : '判断有误') + '</span>' +
        '<p>十打之后是 <b>' + say(raw) + '</b>，' +
        (can ? '在可给的范围里，所以<b>能</b>直接给十打。' :
            '已经出了可给的范围，所以<b>不能</b>。') + '</p>' +
        '<p class="sd-note">' + why + '</p></div>';
}

function fbB(op) {
    const raw = resultAt(op, S.n5);
    const truth = cat(raw);
    const core = CORE[truth] || 3;
    const chosen = bucketOf(S.ansB);
    const fits = chosen && chosen.set.indexOf(truth) >= 0;
    const exact = S.ansB === core;
    const name = bucketOf(core).name;
    let tip;
    if (exact) {
        tip = S.n5 + ' 打摊下来是「' + say(raw) + '」，正落在「' + name + '」。';
    } else if (fits) {
        tip = S.n5 + ' 打摊下来是「' + say(raw) + '」。你挑的这一档也收了它，算擦边；' +
            '照书里的表更贴「' + name + '」。';
    } else {
        tip = S.n5 + ' 打摊下来是「' + say(raw) + '」，该归「' + name + '」。';
    }
    return '<div class="sd-fb">' +
        '<span class="sd-verdict ' + (exact ? 'ok' : (fits ? 'mid' : 'bad')) + '">' +
        (exact ? '判断正确' : (fits ? '擦边，算对一半' : '判断有误')) + '</span>' +
        '<p>' + tip + '</p>' +
        rowsHTML(op, S.n5) +
        '<p class="sd-note">表里到 ' + op.r[op.r.length - 1][1] +
        ' 打为止，再往上书里一律记黑败。</p></div>';
}

/* ---------- 视图 ---------- */

function sideHTML() {
    const op = S.cur;
    let html = '<div class="sd-head"><span class="sd-opening">' + op.f + ' · ' + op.n +
        '</span><span class="sd-page">原书 ' + op.p + ' 页</span></div>';

    const can = OK_TEN.has(cat(tenResult(op)));
    const aOpen = S.phase === 0;

    html += '<div class="sd-step">第一问 · 打数</div>';
    html += '<p class="sd-q">四手已经摆好。第五手能不能<em>直接给十打</em>？' +
        '一次摊开十个打点，由白方任挑一个。</p>';
    html += '<div class="sd-opts">';
    [[1, '能，直接给十打', '十打之后黑方还站得住'],
     [0, '不能', '十打把白方喂得太饱']].forEach(function (o) {
        let cls = 'sd-opt';
        if (!aOpen) {
            if (o[0] === (can ? 1 : 0)) {
                cls += ' is-ok';
            } else if (o[0] === S.ansA) {
                cls += ' is-bad';
            } else {
                cls += ' is-mute';
            }
        }
        html += '<button type="button" class="' + cls + '" data-a="' + o[0] + '"' +
            (aOpen ? '' : ' disabled') + '><b>' + o[1] + '</b><span>' + o[2] +
            '</span></button>';
    });
    html += '</div>';
    if (!aOpen) {
        html += fbA(op);
    }

    if (S.phase >= 1) {
        const bOpen = S.phase === 1;
        html += '<hr class="sd-sep">';
        html += '<div class="sd-step">第二问 · 局面</div>';
        html += '<p class="sd-q">黑方这次给 <em>' + S.n5 + ' 打</em>，白方挑中的一手落在 <em>' +
            coord(S.five[0], S.five[1]) + '</em>。摊下来，局面算哪一档？</p>';
        html += '<div class="sd-opts">';
        BUCKETS.forEach(function (b) {
            let cls = 'sd-opt';
            if (!bOpen) {
                const truth = cat(resultAt(op, S.n5));
                const core = CORE[truth] || 3;
                const pick = bucketOf(S.ansB);
                const fits = pick && pick.set.indexOf(truth) >= 0;
                if (b.key === core) {
                    cls += ' is-ok';
                } else if (b.key === S.ansB) {
                    cls += fits ? ' is-mid' : ' is-bad';
                } else {
                    cls += ' is-mute';
                }
            }
            html += '<button type="button" class="' + cls + '" data-b="' + b.key + '"' +
                (bOpen ? '' : ' disabled') + '><b>' + b.name + '</b><span>' + b.note +
                '</span></button>';
        });
        html += '</div>';
        if (S.phase >= 2) {
            html += fbB(op);
        }
    }
    return html;
}

function renderScore() {
    const el = document.getElementById('sd-score');
    if (!el) {
        return;
    }
    el.innerHTML = '第 <b>' + S.stats.n + '</b> 局 · 打数对 <b>' + S.stats.aOk + '/' +
        S.stats.a + '</b> · 局面对 <b>' + S.stats.bOk + '/' + S.stats.b +
        '</b>（擦边 ' + S.stats.bMid + '）';
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
                const truth = cat(resultAt(S.cur, S.n5));
                const core = CORE[truth] || 3;
                S.ansB = key;
                S.phase = 2;
                S.stats.b += 1;
                if (key === core) {
                    S.stats.bOk += 1;
                } else if (bucketOf(key).set.indexOf(truth) >= 0) {
                    S.stats.bMid += 1;
                }
                render();
            });
        });
}

function render() {
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

    const side = document.getElementById('sd-side');
    if (side) {
        side.innerHTML = sideHTML();
        bindSide();
    }
    renderScore();
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

    const next = document.getElementById('sd-next');
    if (next) {
        next.addEventListener('click', function () {
            startQuestion();
        });
    }

    const reset = document.getElementById('sd-reset');
    if (reset) {
        reset.addEventListener('click', function () {
            S.stats = { n: 0, a: 0, aOk: 0, b: 0, bOk: 0, bMid: 0 };
            renderScore();
        });
    }

    if (!S.cur) {
        startQuestion();
    } else {
        render();
    }
}
