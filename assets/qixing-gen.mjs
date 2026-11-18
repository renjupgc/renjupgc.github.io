/*
 * 棋形判断 - 出题器
 * ------------------------------------------------------------
 * 造一盘「只差一手就能做出某种棋形」的局面：连五 / 活四 / 冲四 / 活三 / 眠三。
 * 五种棋形的定义与条款号取自《中国五子棋竞赛规则》（2025 年版）第 7 条
 * 「棋形」，页面上讲棋形只引这一份原文，不另写一套（见下面 SHAPES 的 def / cite）。
 * 用户要在盘上点出那一手。判定与出题都用 vcf-gen 的 classify：线型一律表述成
 * 「再填一子会变成什么」，活三 / 活四都是递归算出来的，没有手写的棋型表；
 * 黑棋禁手同样复用 blackForbidden，与禁手找茬、VCF 做题同源。
 *
 * 流程：按目标棋形摆骨架（含堵头白子） → 验证「落子后的最高线型」正是所求
 *      → 全盘扫一遍，数出能做出这个棋形的所有点（活三、冲四天然不止一处）
 *      → 不够本档要求的处数就再摆一处骨架，直到落进区间
 *      → 撒白子黑子当干扰，每撒一颗复验一次，答案变了或跳出区间就撤回。
 */

import { BLACK, WHITE, px, py } from './quintet-core.mjs';
import {
    blackForbidden, makesFive, fivePoints,
    FIVE, OPEN_FOUR, FOUR, OPEN_THREE, SLEEP_THREE, OPEN_TWO, SLEEP_TWO, NONE
} from './vcf-gen.mjs';

const DX = [1, 0, 1, 1], DY = [0, 1, 1, -1];
const now = () => Date.now();
const inB = (x, y) => x >= 0 && x < 15 && y >= 0 && y < 15;
const at = (x, y) => x * 15 + y;

export const DIR_NAME = ['横线', '竖线', '撇捺斜线', '捺撇斜线'];

/* 五种题型。rank 就是 vcf-gen 的线型码，题目与判定都按它比大小。
   min 是这种棋形「最少也得找出几处」——活三、冲四这类，一串子两头都能补，
   天然就不止一处，这不是题目出坏了，是棋形本身如此。

   def / cite 是《中国五子棋竞赛规则》（2025 年版）第 7 条「棋形」的原文定义与条款号，
   页面上讲棋形一律引这两项，不再自己另写一套说法；tip 只讲这一手有什么用，
   不承担定义。判定那边（vcf-gen 的 classify）本来就是照条文算的：
   活四＝两个空点都能成五、冲四＝只有一个、活三＝补一子成活四、眠三＝补一子只成冲四。 */
export const SHAPES = [
    {
        key: 'five', name: '连五', rank: FIVE, min: 1, cite: '7.2',
        def: '任意一条线上，5 个同色棋子不间隔相连',
        tip: '五连即胜，这一手落下去这盘就结束了。'
    },
    {
        key: 'open4', name: '活四', rank: OPEN_FOUR, min: 1, cite: '7.3.1',
        def: '有两个点可以形成五连的四',
        tip: '两处都能成五，白棋挡哪一头都漏。'
    },
    {
        key: 'four', name: '冲四', rank: FOUR, min: 2, cite: '7.3.2',
        def: '只有一个点可以形成五连的四',
        tip: '只剩一处成五，白棋跟着挡掉就没事。'
    },
    {
        key: 'open3', name: '活三', rank: OPEN_THREE, min: 3, cite: '7.4.1',
        def: '再走一着可以形成活四的三',
        tip: '补一子成的是活四，白棋必须应。'
    },
    {
        key: 'sleep3', name: '眠三', rank: SLEEP_THREE, min: 2, cite: '7.4.2',
        def: '只能形成冲四的三',
        tip: '补一子只到冲四，威胁比活三小得多。'
    }
];

const BY_RANK = new Map(SHAPES.map(s => [s.rank, s]));
const BY_KEY = new Map(SHAPES.map(s => [s.key, s]));

/* 低线型也给个中文名，答错时好说话 */
/* 规则第 7 条只定义到三，二在规则里没有条文，所以这里只说「二」，
   不叫活二 / 眠二，免得把俗称当成规则。 */
const LOW_NAME = new Map([
    [OPEN_TWO, '二'], [SLEEP_TWO, '二'], [NONE, '没成型']
]);

/* 一句话说清这种棋形长什么样，页面上的对错提示直接取用。
   五连 / 四 / 三 一律用规则第 7 条的措辞；「二」规则里没有定义，
   只作描述，别处也不要把它当条文引用。 */
const SHORT = {
    [FIVE]: '5 个同色棋子不间隔相连',
    [OPEN_FOUR]: '有两个点可以形成五连',
    [FOUR]: '只有一个点可以形成五连',
    [OPEN_THREE]: '再走一着可以形成活四',
    [SLEEP_THREE]: '只能形成冲四',
    [OPEN_TWO]: '两子，还够不上三',
    [SLEEP_TWO]: '两子，还够不上三',
    [NONE]: '一条线上都没连成'
};

export const shortOf = rank => SHORT[rank] || '什么也没连上';

function mulberry32(a) {
    return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

/* 该点这条线上的连子长度，用来认长连（黑棋六子以上违例，不算连五） */
function runAt(bd, k, d, color) {
    const x = px(k), y = py(k);
    let run = 1;
    for (let s = 1; s <= 5; s++) {
        const nx = x + s * DX[d], ny = y + s * DY[d];
        if (!inB(nx, ny) || bd[at(nx, ny)] !== color) { break; }
        run++;
    }
    for (let s = 1; s <= 5; s++) {
        const nx = x - s * DX[d], ny = y - s * DY[d];
        if (!inB(nx, ny) || bd[at(nx, ny)] !== color) { break; }
        run++;
    }
    return run;
}

/*
 * 线型判定：照《中国五子棋竞赛规则》第 7 条，只在这条线上数，不截 9 格窗口。
 *   五连：这条线上、含落点在内连成 5 子（黑棋 6 子以上是长连，不算成五）；
 *   活四：有两个点可以补成含落点在内的五连；冲四：只有一个点；
 *   活三：补一子能成活四；眠三：补一子只能成冲四。
 * 只认「含落点」的那一串，是因为落子之后的四 / 三一定是含它的那一串；
 * 窗口判定在这里会出错——窗口外一头再有一颗黑子，本该是长连的六子会被
 * 当成「补一子成四」，白送一个假眠三。
 */

/* 这条线上、离落点 t 格的交叉点（越界返回 -1） */
function shift(k, d, t) {
    const nx = px(k) + t * DX[d], ny = py(k) + t * DY[d];
    return inB(nx, ny) ? at(nx, ny) : -1;
}

/* 这条线上落点之外有几颗同色子：少于两颗，连三都凑不出来，不用往下算 */
function lineStones(bd, k, d, color) {
    let n = 0;
    for (let t = -4; t <= 4; t++) {
        if (!t) { continue; }
        const q = shift(k, d, t);
        if (q >= 0 && bd[q] === color) { n++; }
    }
    return n;
}

/* 这条线上，能补成「含落点在内的五连」的空点有几个——就是条文说的「可以形成五连的点」 */
function fiveLine(bd, k, d, color) {
    let n = 0;
    for (let t = -4; t <= 4; t++) {
        if (!t) { continue; }
        const q = shift(k, d, t);
        if (q < 0 || bd[q]) { continue; }
        bd[q] = color;
        const r = runAt(bd, k, d, color);
        bd[q] = 0;
        if (color === BLACK ? r === 5 : r >= 5) { n++; }
    }
    return n;
}

/* 单方向的线型（落点已经落在盘上） */
function kindLine(bd, k, d, color) {
    const r = runAt(bd, k, d, color);
    if (color === BLACK) {
        if (r > 5) { return NONE; }          /* 长连，由 evaluate 另记 */
        if (r === 5) { return FIVE; }
    } else if (r >= 5) {
        return FIVE;                          /* 白棋长连视同五连 */
    }

    const stones = lineStones(bd, k, d, color);
    if (stones < 2) { return stones ? OPEN_TWO : NONE; }

    const n = fiveLine(bd, k, d, color);
    if (n >= 2) { return OPEN_FOUR; }
    if (n === 1) { return FOUR; }

    let open4 = false, four = false;
    for (let t = -4; t <= 4; t++) {
        if (!t) { continue; }
        const q = shift(k, d, t);
        if (q < 0 || bd[q]) { continue; }
        bd[q] = color;
        const m = fiveLine(bd, k, d, color);
        bd[q] = 0;
        if (m >= 2) { open4 = true; break; }  /* 补这一子成活四 → 活三 */
        if (m === 1) { four = true; }         /* 补这一子只成冲四 → 眠三 */
    }
    if (open4) { return OPEN_THREE; }
    if (four) { return SLEEP_THREE; }
    return OPEN_TWO;
}

/*
 * 落一子之后，这一点上的最高线型。
 * 四个方向各判一次，取最高的那个；同高就把方向都收进来，
 * 好让页面把成形的几条线一起圈出来。
 */
export function evaluate(bd, k, color) {
    if (bd[k]) { return null; }
    bd[k] = color;
    let best = NONE;
    let dirs = [];
    let over = false;
    for (let d = 0; d < 4; d++) {
        if (color === BLACK && runAt(bd, k, d, BLACK) >= 6) { over = true; }
        const c = kindLine(bd, k, d, color);
        if (c > best) { best = c; dirs = [d]; }
        else if (c === best && c > NONE) { dirs.push(d); }
    }
    bd[k] = 0;
    const forbidden = color === BLACK ? blackForbidden(bd, k) : false;
    const shape = BY_RANK.get(best) || null;
    return {
        rank: best,
        shape: shape,
        name: shape ? shape.name : (LOW_NAME.get(best) || '没成型'),
        short: shortOf(best),
        dirs: dirs,
        over: over,
        forbidden: forbidden
    };
}

/* 全盘扫：落子后最高线型正好是 rank 的点（禁手点不算，黑棋根本不能走）。
   活三 / 活四 这类棋形天然不止一处能做成，所以题目收的是「一组答案」，
   点中其中任何一处都算对，看答案时一并圈出来。 */
export function answerPoints(bd, color, rank) {
    const out = [];
    for (let k = 0; k < 225; k++) {
        if (bd[k]) { continue; }
        const ev = evaluate(bd, k, color);
        if (!ev || ev.over || ev.forbidden) { continue; }
        if (ev.rank === rank) { out.push(k); }
    }
    return out;
}

/* 盘上是否已经有连五点，有的话这盘棋早该结束了。
   keep 是本该有的那些答案：连五题的答案本身就是一个连五点，不能算「早该结束」。 */
function strayFive(bd, color, keep) {
    const pts = fivePoints(bd, color);
    if (!pts.length) { return false; }
    return pts.some(k => !keep || keep.indexOf(k) < 0);
}

/* ---------- 骨架 ----------
 * ts：相对落点 p 的偏移，按方向铺黑子；blocks：堵头的白子位置。
 * 镜像时整组取反，于是横竖撇捺、左右上下都能出题。
 */
const VARIANTS = {
    five: [
        { ts: [-1, -2, -3, -4], blocks: [-5, 1] }          /* 两侧各堵一子，只有中间能连成五 */
    ],
    open4: [
        { ts: [-1, -2, -3], blocks: [] },
        { ts: [-1, -2, 1], blocks: [] }
    ],
    four: [
        { ts: [-1, -2, -3], blocks: [1] },
        { ts: [-1, -2, 1], blocks: [-3] }
    ],
    open3: [
        { ts: [-1, -2], blocks: [] },
        { ts: [-1, 1], blocks: [] }
    ],
    sleep3: [
        { ts: [-1, -2], blocks: [-3] },
        { ts: [-1, -2], blocks: [1] },
        { ts: [-1, 1], blocks: [2] }
    ]
};

function build(bd, x, y, d, sign, v) {
    const cells = [];
    for (const t of v.ts) { cells.push({ t: t * sign, c: BLACK }); }
    for (const t of v.blocks) { cells.push({ t: t * sign, c: WHITE }); }
    for (const c of cells) {
        const nx = x + c.t * DX[d], ny = y + c.t * DY[d];
        if (!inB(nx, ny)) { return false; }
        const k = at(nx, ny);
        if (bd[k]) { return false; }
    }
    for (const c of cells) {
        bd[at(x + c.t * DX[d], y + c.t * DY[d])] = c.c;
    }
    return true;
}

/* ---------- 干扰子 ---------- */
function scatter(bd, x, y, color, count, rng, answer, rank, lo, hi) {
    let placed = 0;
    for (let tries = 0; tries < count * 14 && placed < count; tries++) {
        const r = 1 + Math.floor(rng() * 4);
        const nx = x + Math.floor(rng() * (2 * r + 1)) - r;
        const ny = y + Math.floor(rng() * (2 * r + 1)) - r;
        if (!inB(nx, ny)) { continue; }
        const k = at(nx, ny);
        if (bd[k] || k === answer) { continue; }
        bd[k] = color;

        let ok = !makesFive(bd, k, color);
        if (ok) {
            const ev = evaluate(bd, answer, BLACK);
            ok = !!ev && ev.rank === rank && !ev.over && !ev.forbidden;
        }
        if (ok) {
            /* 答案数要仍在本题该有的区间里：少了白送，多了点不完 */
            const list = answerPoints(bd, BLACK, rank);
            const n = list.length;
            ok = n >= lo && n <= hi;
            if (ok) { ok = !strayFive(bd, color, color === BLACK ? list : null); }
        }
        if (ok) { placed++; } else { bd[k] = 0; }
    }
    return placed;
}

/* 再摆一处骨架，把答案数往上抬。抬不动就撤回：新骨架要是贴着旧的摆，
   两边会共用同一串子，答案数不增反减，那不算多出来一处。
   返回新的答案数，摆不成返回 0。 */
function addSkeleton(bd, shape, rng, hi, before) {
    const list = VARIANTS[shape.key];
    for (let t = 0; t < 14; t++) {
        const x = 2 + Math.floor(rng() * 11);
        const y = 2 + Math.floor(rng() * 11);
        const k = at(x, y);
        if (bd[k]) { continue; }
        const d = Math.floor(rng() * 4);
        const sign = rng() < 0.5 ? 1 : -1;
        const v = list[Math.floor(rng() * list.length)];

        const snap = bd.slice();
        if (!build(bd, x, y, d, sign, v)) { bd.set(snap); continue; }
        const ev = evaluate(bd, k, BLACK);
        if (!ev || ev.rank !== shape.rank || ev.over || ev.forbidden) {
            bd.set(snap);
            continue;
        }
        const got = answerPoints(bd, BLACK, shape.rank);
        const n = got.length;
        if (n > hi || n <= before) { bd.set(snap); continue; }
        if (strayFive(bd, BLACK, got) || strayFive(bd, WHITE, null)) { bd.set(snap); continue; }
        return n;
    }
    return 0;
}

function attempt(o, rng) {
    const key = o.shape === 'mix'
        ? SHAPES[Math.floor(rng() * SHAPES.length)].key
        : o.shape;
    const shape = BY_KEY.get(key);
    if (!shape) { return null; }

    const den = o.density;
    const band = bandOf(shape, den);
    const lo = band[0], hi = band[1];

    const bd = new Int8Array(225);
    /* 骨架最长五个偏移，落点留出五格余量，四种方向都不会出界 */
    const x = 5 + Math.floor(rng() * 5);
    const y = 5 + Math.floor(rng() * 5);
    const d = Math.floor(rng() * 4);
    const sign = rng() < 0.5 ? 1 : -1;
    const list = VARIANTS[key];
    const v = list[Math.floor(rng() * list.length)];

    if (!build(bd, x, y, d, sign, v)) { return null; }
    const answer = at(x, y);

    const ev = evaluate(bd, answer, BLACK);
    if (!ev || ev.rank !== shape.rank || ev.over || ev.forbidden) { return null; }

    /* 骨架本身常常只给一两处答案，不够本档要求的就再摆一处 */
    let n = answerPoints(bd, BLACK, shape.rank).length;
    if (n > hi) { return null; }
    if (strayFive(bd, BLACK, answerPoints(bd, BLACK, shape.rank)) ||
        strayFive(bd, WHITE, null)) { return null; }
    for (let t = 0; t < 4 && n < lo; t++) {
        const m = addSkeleton(bd, shape, rng, hi, n);
        if (!m) { return null; }
        n = m;
    }
    if (n < lo) { return null; }

    scatter(bd, x, y, WHITE, den.white, rng, answer, shape.rank, lo, hi);
    scatter(bd, x, y, BLACK, den.black, rng, answer, shape.rank, lo, hi);

    /* 终审：撒完子之后题面还得立得住，答案数也仍在区间里 */
    const fin = evaluate(bd, answer, BLACK);
    if (!fin || fin.rank !== shape.rank || fin.over || fin.forbidden) { return null; }
    const answers = answerPoints(bd, BLACK, shape.rank);
    if (answers.length < lo || answers.length > hi) { return null; }
    if (strayFive(bd, BLACK, answers) || strayFive(bd, WHITE, null)) { return null; }
    /* 摆骨架那一处排在最前：看答案先圈它，页面上的「答案」也指它 */
    const at0 = answers.indexOf(answer);
    if (at0 > 0) { answers.unshift(answers.splice(at0, 1)[0]); }

    let stones = 0, whites = 0;
    for (let k = 0; k < 225; k++) {
        if (bd[k] === BLACK) { stones++; } else if (bd[k] === WHITE) { whites++; }
    }
    return {
        board: bd,
        answer: answer,
        answers: answers,
        need: answers.length,
        shape: shape.key,
        label: shape.name,
        def: shape.def,
        cite: shape.cite,
        tip: shape.tip,
        dirs: fin.dirs,
        black: stones,
        white: whites
    };
}

/* ---------- 对外 ---------- */
/* add 是这一档在「该棋形最少几处」之上再加几处：
   入门 0、常用 1、密集 2，区间取 [min+add, min+add+1]，最多 5 处
   （再多就该满盘找了，手指比眼睛先累）。干扰子也随档位加密。 */
export const DENSITY = {
    easy: { white: 2, black: 1, add: 0 },
    normal: { white: 4, black: 3, add: 1 },
    hard: { white: 6, black: 5, add: 2 }
};

export function bandOf(shape, den) {
    const lo = Math.min(shape.min + (den.add || 0), 5);
    return [lo, Math.min(lo + 1, 5)];
}

export function* generateShapePuzzle(opts) {
    const o = {
        shape: 'mix',
        density: DENSITY.normal,
        seed: (Math.random() * 4294967296) >>> 0,
        timeoutMs: 2500
    };
    Object.assign(o, opts);

    const t0 = now();
    let n = 0;
    while (now() - t0 < o.timeoutMs) {
        n++;
        const rng = mulberry32((o.seed + n * 2654435761) >>> 0);
        const p = attempt(o, rng);
        if (p) {
            p.attempts = n;
            p.ms = now() - t0;
            return p;
        }
        yield n;
    }
    return null;
}
