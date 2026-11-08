/*
 * 禁手找茬 - 出题器
 * ------------------------------------------------------------
 * 造一盘黑棋局面，里面恰好有且只有一个「黑棋落子即违例」的点：
 * 三三 / 四四 / 长连。规则判定全部复用 vcf-gen.mjs 的 blackForbidden，
 * 与 VCF 做题那边同源，不另写一套。
 *
 * 流程：按类型搭出骨架（两根线各自成三 / 成四，或一线拉出长连）
 *      → 全盘扫一遍禁手点，必须只有骨架那一个
 *      → 撒白子当干扰（白子会把活三压成眠三，正是最容易看错的地方）
 *      → 撒黑子把局面填得像真对局，每撒一颗都复扫一次，多出禁手点就撤回。
 */

import { BLACK, WHITE, px, py } from './quintet-core.mjs';
import { blackForbidden, classify, makesFive, fivePoints, OPEN_FOUR, FOUR, OPEN_THREE } from './vcf-gen.mjs';

const DX = [1, 0, 1, 1], DY = [0, 1, 1, -1];
const now = () => Date.now();

export const KIND_NAME = { 33: '三三', 44: '四四', over: '长连' };

const inB = (x, y) => x >= 0 && x < 15 && y >= 0 && y < 15;
const at = (x, y) => x * 15 + y;

function mulberry32(a) {
    return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

/* ---------- 规则侧：这个点落黑会做出什么 ---------- */
export function moveShapes(bd, k) {
    if (bd[k]) { return null; }
    bd[k] = BLACK;
    let fours = 0, threes = 0, over = 0;
    const dirs = [];
    for (let d = 0; d < 4; d++) {
        let run = 1;
        for (let s = 1; s <= 5; s++) {
            const nx = px(k) + s * DX[d], ny = py(k) + s * DY[d];
            if (!inB(nx, ny) || bd[at(nx, ny)] !== BLACK) { break; }
            run++;
        }
        for (let s = 1; s <= 5; s++) {
            const nx = px(k) - s * DX[d], ny = py(k) - s * DY[d];
            if (!inB(nx, ny) || bd[at(nx, ny)] !== BLACK) { break; }
            run++;
        }
        if (run >= 6) { over++; dirs.push(d); continue; }
        const x = px(k), y = py(k);
        let m = 0, e = 0;
        for (let t = -4; t <= 4; t++) {
            const bit = 1 << (t + 4);
            const nx = x + t * DX[d], ny = y + t * DY[d];
            if (!inB(nx, ny)) { continue; }
            const v = bd[at(nx, ny)];
            if (v === BLACK) { m |= bit; } else if (!v) { e |= bit; }
        }
        const c = classify(m, e, BLACK);
        if (c === OPEN_FOUR || c === FOUR) { fours++; dirs.push(d); }
        else if (c === OPEN_THREE) { threes++; dirs.push(d); }
    }
    bd[k] = 0;
    return { fours, threes, over, dirs };
}

/* 一句话说清这个点：禁手 / 不是禁手 */
export function describePoint(bd, k) {
    const s = moveShapes(bd, k);
    if (!s) { return null; }
    const bad = s.over > 0 || s.fours >= 2 || (s.fours === 0 && s.threes >= 2);
    let name;
    if (s.over > 0) { name = '长连'; }
    else if (s.fours >= 2) { name = '四四'; }
    else if (s.fours === 0 && s.threes >= 2) { name = '三三'; }
    else if (s.fours && s.threes) { name = '四三'; }
    else if (s.fours === 1 && s.threes === 0) { name = '冲四'; }
    else if (s.fours === 0 && s.threes === 1) { name = '单活三'; }
    else { name = '没成型'; }
    return { bad, name, fours: s.fours, threes: s.threes, over: s.over, dirs: s.dirs };
}

/* 全盘扫禁手点（找茬的答案必须整盘唯一） */
export function forbiddenPoints(bd) {
    const out = [];
    for (let k = 0; k < 225; k++) {
        if (!bd[k] && blackForbidden(bd, k)) { out.push(k); }
    }
    return out;
}

/* ---------- 骨架 ---------- */
/*
 * 每个方向给出「落子前后都合法的两三颗黑子」，填进去之后 p 就在这一线上
 * 成三或成四。p 附近三格以内必须干净，所以先探一遍再填。
 */
const THREES = [
    [-1, -2],
    [-1, 1],
    [1, 2]
];
const FOURS = [
    [-1, -2, -3],
    [-1, -2, 1],
    [-1, 1, 2]
];
const OVER = [-1, -2, 1, 2, 3];

function skeleton(bd, x, y, kind, rng) {
    const p = at(x, y);
    const dirs = [0, 1, 2, 3];
    for (let i = dirs.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const t = dirs[i]; dirs[i] = dirs[j]; dirs[j] = t;
    }

    /* 沿方向 d 距 p 为 t 的点；pattern 里是一串 t */
    const put = function (d, ts, ends) {
        for (const t of ts) {
            const nx = x + t * DX[d], ny = y + t * DY[d];
            if (!inB(nx, ny) || bd[at(nx, ny)]) { return false; }
            bd[at(nx, ny)] = BLACK;
        }
        /* 线两端留空，否则成不了活三 / 活四，判出来只是眠三 */
        if (ends) {
            for (const t of [-4, -3, 3, 4]) {
                if (ts.indexOf(t) >= 0) { continue; }
                const nx = x + t * DX[d], ny = y + t * DY[d];
                if (inB(nx, ny) && bd[at(nx, ny)]) { return false; }
            }
        }
        return true;
    };

    if (kind === 'over') {
        /* 长连：p 两侧各有一串，落子后连成六子，落子前手里还没有五 */
        return put(dirs[0], OVER, false);
    }
    const set = kind === '33' ? THREES : FOURS;
    for (const d of [dirs[0], dirs[1]]) {
        if (!put(d, set[Math.floor(rng() * set.length)], true)) { return false; }
    }
    return true;
}

/* ---------- 干扰子 ---------- */
function scatter(bd, x, y, color, count, rng, answer) {
    let placed = 0;
    for (let tries = 0; tries < count * 12 && placed < count; tries++) {
        const r = 1 + Math.floor(rng() * 4);
        const nx = x + Math.floor(rng() * (2 * r + 1)) - r;
        const ny = y + Math.floor(rng() * (2 * r + 1)) - r;
        if (!inB(nx, ny)) { continue; }
        const k = at(nx, ny);
        if (bd[k] || k === answer) { continue; }
        bd[k] = color;

        let ok = true;
        if (makesFive(bd, k, color)) { ok = false; }
        if (ok) {
            const pts = forbiddenPoints(bd);
            if (pts.length !== 1 || pts[0] !== answer) { ok = false; }
        }
        if (ok && color === BLACK) {
            /* 手里不能已经有连五点，不然这盘棋早该结束了 */
            if (fivePoints(bd, BLACK).length) { ok = false; }
        }
        if (ok) { placed++; } else { bd[k] = 0; }
    }
    return placed;
}

/* 一颗棋子的尝试；失败返回 null */
function attempt(o, rng) {
    const kind = o.kind === 'mix'
        ? ['33', '44', 'over'][Math.floor(rng() * 3)]
        : o.kind;

    const bd = new Int8Array(225);
    const x = 3 + Math.floor(rng() * 9);
    const y = 3 + Math.floor(rng() * 9);

    if (!skeleton(bd, x, y, kind, rng)) { return null; }
    const answer = at(x, y);

    if (!blackForbidden(bd, answer)) { return null; }
    let pts = forbiddenPoints(bd);
    if (pts.length !== 1 || pts[0] !== answer) { return null; }

    const d = o.density;
    scatter(bd, x, y, WHITE, d.white, rng, answer);
    scatter(bd, x, y, BLACK, d.black, rng, answer);

    if (!blackForbidden(bd, answer)) { return null; }
    pts = forbiddenPoints(bd);
    if (pts.length !== 1 || pts[0] !== answer) { return null; }

    /* 题面要干净：答案点必须是空的，双方手里都不能已经握着连五点 */
    if (bd[answer]) { return null; }
    if (fivePoints(bd, BLACK).length || fivePoints(bd, WHITE).length) { return null; }
    const info = describePoint(bd, answer);
    if (!info || !info.bad) { return null; }

    let stones = 0, whites = 0;
    for (let k = 0; k < 225; k++) {
        if (bd[k] === BLACK) { stones++; } else if (bd[k] === WHITE) { whites++; }
    }
    return {
        board: bd,
        answer: answer,
        kind: info.over ? 'over' : (info.fours >= 2 ? '44' : '33'),
        label: info.name,
        dirs: info.dirs,
        black: stones,
        white: whites
    };
}

/* ---------- 对外 ---------- */
export const DENSITY = {
    easy: { white: 2, black: 2 },
    normal: { white: 4, black: 4 },
    hard: { white: 7, black: 7 }
};

export function* generatePuzzle(opts) {
    const o = {
        kind: 'mix',
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
