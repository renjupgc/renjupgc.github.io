/*
 * 棋形判断 - 出题器
 * ------------------------------------------------------------
 * 造一盘「只差一手就能做出某种棋形」的局面：连五 / 活四 / 冲四 / 活三 / 眠三。
 * 用户要在盘上点出那一手。判定与出题都用 vcf-gen 的 classify：线型一律表述成
 * 「再填一子会变成什么」，活三 / 活四都是递归算出来的，没有手写的棋型表；
 * 黑棋禁手同样复用 blackForbidden，与禁手找茬、VCF 做题同源。
 *
 * 流程：按目标棋形摆骨架（含堵头白子） → 验证「落子后的最高线型」正是所求
 *      → 全盘扫一遍，确认这样的点只有骨架那一处（不然题目有第二个答案）
 *      → 撒白子黑子当干扰，每撒一颗复验一次，破坏了就撤回。
 */

import { BLACK, WHITE, px, py } from './quintet-core.mjs';
import {
    classify, windowAt, blackForbidden, makesFive, fivePoints,
    FIVE, OPEN_FOUR, FOUR, OPEN_THREE, SLEEP_THREE, OPEN_TWO, SLEEP_TWO, NONE
} from './vcf-gen.mjs';

const DX = [1, 0, 1, 1], DY = [0, 1, 1, -1];
const now = () => Date.now();
const inB = (x, y) => x >= 0 && x < 15 && y >= 0 && y < 15;
const at = (x, y) => x * 15 + y;

export const DIR_NAME = ['横线', '竖线', '撇捺斜线', '捺撇斜线'];

/* 五种题型。rank 就是 vcf-gen 的线型码，题目与判定都按它比大小。 */
export const SHAPES = [
    { key: 'five', name: '连五', rank: FIVE, tip: '五子连成一线，直接赢棋。' },
    { key: 'open4', name: '活四', rank: OPEN_FOUR, tip: '四子连成一线、两端都空，白棋堵哪头都漏。' },
    { key: 'four', name: '冲四', rank: FOUR, tip: '四子只差一子成五，但只有一处能成五。' },
    { key: 'open3', name: '活三', rank: OPEN_THREE, tip: '三子两端都空，再补一子就是活四。' },
    { key: 'sleep3', name: '眠三', rank: SLEEP_THREE, tip: '三子被白子堵住一头，补一子只能成冲四。' }
];

const BY_RANK = new Map(SHAPES.map(s => [s.rank, s]));
const BY_KEY = new Map(SHAPES.map(s => [s.key, s]));

/* 低线型也给个中文名，答错时好说话 */
const LOW_NAME = new Map([
    [OPEN_TWO, '活二'], [SLEEP_TWO, '眠二'], [NONE, '什么也没连上']
]);

/* 一句话说清这种棋形长什么样，页面上的对错提示直接取用 */
const SHORT = {
    [FIVE]: '五子连成一线',
    [OPEN_FOUR]: '四子两端都空',
    [FOUR]: '四子只有一处能成五',
    [OPEN_THREE]: '三子两端都空',
    [SLEEP_THREE]: '三子被堵了一头',
    [OPEN_TWO]: '两子两端都空',
    [SLEEP_TWO]: '两子被堵了一头',
    [NONE]: '什么也没连上'
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
 * 落一子之后，这一点上的最高线型。
 * 四个方向各取一个 9 格窗口分类，取最高的那个；同高就把方向都收进来，
 * 好让页面把成形的几条线一起圈出来。
 */
export function evaluate(bd, k, color) {
    if (bd[k]) { return null; }
    bd[k] = color;
    let best = NONE;
    let dirs = [];
    let over = false;
    for (let d = 0; d < 4; d++) {
        const w = windowAt(bd, px(k), py(k), d, color);
        const c = classify(w.m, w.e, color);
        if (c > best) { best = c; dirs = [d]; }
        else if (c === best && c > NONE) { dirs.push(d); }
        if (color === BLACK && runAt(bd, k, d, BLACK) >= 6) { over = true; }
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

/* 盘上是否已经有连五点（除了答案那一处），有的话这盘棋早该结束了 */
function strayFive(bd, color, answer) {
    return fivePoints(bd, color).some(k => k !== answer);
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
function scatter(bd, x, y, color, count, rng, answer, rank, cap) {
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
        if (ok) { ok = !strayFive(bd, color, answer); }
        if (ok) {
            const ev = evaluate(bd, answer, BLACK);
            ok = !!ev && ev.rank === rank && !ev.over && !ev.forbidden;
        }
        if (ok) {
            /* 答案不能满地都是：撒完这一颗，能做出该棋形的点仍在可数的几处之内 */
            const n = answerPoints(bd, BLACK, rank).length;
            ok = n >= 1 && n <= cap;
        }
        if (ok) { placed++; } else { bd[k] = 0; }
    }
    return placed;
}

function attempt(o, rng) {
    const key = o.shape === 'mix'
        ? SHAPES[Math.floor(rng() * SHAPES.length)].key
        : o.shape;
    const shape = BY_KEY.get(key);
    if (!shape) { return null; }

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
    if (strayFive(bd, BLACK, answer) || strayFive(bd, WHITE, answer)) { return null; }

    const den = o.density;
    const cap = den.cap || 8;
    if (answerPoints(bd, BLACK, shape.rank).length > cap) { return null; }
    scatter(bd, x, y, WHITE, den.white, rng, answer, shape.rank, cap);
    scatter(bd, x, y, BLACK, den.black, rng, answer, shape.rank, cap);

    /* 终审：撒完子之后题面还得立得住 */
    const fin = evaluate(bd, answer, BLACK);
    if (!fin || fin.rank !== shape.rank || fin.over || fin.forbidden) { return null; }
    if (strayFive(bd, BLACK, answer) || strayFive(bd, WHITE, answer)) { return null; }
    const answers = answerPoints(bd, BLACK, shape.rank);
    if (!answers.length || answers.length > cap) { return null; }
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
        shape: shape.key,
        label: shape.name,
        tip: shape.tip,
        dirs: fin.dirs,
        answers: answers,
        black: stones,
        white: whites
    };
}

/* ---------- 对外 ---------- */
/* cap 是「这一手不止一处」的上限：能做出该棋形的点超过这个数，题目就太水了 */
export const DENSITY = {
    easy: { white: 2, black: 1, cap: 3 },
    normal: { white: 4, black: 3, cap: 5 },
    hard: { white: 6, black: 5, cap: 8 }
};

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
