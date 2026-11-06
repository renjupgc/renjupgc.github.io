/*
 * VCF 出题器
 * ------------------------------------------------------------
 * 造一盘看起来像正常对局、但轮到某一方就藏着 N 手 VCF 的局面。
 * 流程：安静自对弈铺局面 → 中途用 quintet 验杀 → 成对剪枝 → 终审。
 *
 * 搜索全部来自 quintet（见 quintet-core.mjs），这里只有规则判定
 * （重演校验、线型递归分类、黑棋禁手），没有自己的搜索。
 */

import {
    N, EMPTY, BLACK, WHITE, ix, px, py, solveBoard
} from './quintet-core.mjs';

const now = () => performance.now();

/* ---------- 线型分类：一律表述成「再填一子会变成什么」 ---------- */
export const FIVE = 7, OPEN_FOUR = 6, FOUR = 5, OPEN_THREE = 4, SLEEP_THREE = 3, OPEN_TWO = 2, SLEEP_TWO = 1, NONE = 0;
const WEIGHT = { 7: 1e6, 6: 1e5, 5: 1.2e4, 4: 6000, 3: 650, 2: 320, 1: 55, 0: 0 };

const memoBlack = new Map(), memoWhite = new Map();

/* 9 位掩码里是否已含五连：黑棋恰好 5（6 以上是长连禁手，不算胜），白棋 ≥5 */
function runFive(m, color) {
    let run = 0;
    for (let i = 0; i <= 9; i++) {
        const bit = i < 9 ? (m >> i) & 1 : 0;
        if (bit) { run++; continue; }
        if (color === BLACK ? run === 5 : run >= 5) { return true; }
        run = 0;
    }
    return false;
}

function fivePointCount(m, e, color) {
    let n = 0;
    for (let i = 0; i < 9; i++) {
        if (!((e >> i) & 1)) { continue; }
        if (runFive(m | (1 << i), color)) { n++; }
    }
    return n;
}

/*
 * 活四 = 两个不同空点填入都能成五；冲四 = 恰好一个；
 * 活三 = 某空点填入后成活四；眠三 = 填入后成冲四；活二 / 眠二 再递归一层。
 * ●●_●●、●_●●●、●__●●● 这些跳四都由「填一子成什么」自然算出，不需要模式表。
 */
export function classify(m, e, color) {
    const memo = color === BLACK ? memoBlack : memoWhite;
    const key = m * 512 + e;
    const hit = memo.get(key);
    if (hit !== undefined) { return hit; }

    let out;
    if (runFive(m, color)) {
        out = FIVE;
    } else {
        const f = fivePointCount(m, e, color);
        if (f >= 2) {
            out = OPEN_FOUR;
        } else if (f === 1) {
            out = FOUR;
        } else {
            out = NONE;
            for (let i = 0; i < 9; i++) {
                if (!((e >> i) & 1)) { continue; }
                const c = classify(m | (1 << i), e & ~(1 << i), color);
                if (c === OPEN_FOUR) { out = OPEN_THREE; break; }
                if (c === FOUR) { if (out < SLEEP_THREE) { out = SLEEP_THREE; } }
                else if (c === OPEN_THREE) { if (out < OPEN_TWO) { out = OPEN_TWO; } }
                else if (c === SLEEP_THREE) { if (out < SLEEP_TWO) { out = SLEEP_TWO; } }
            }
        }
    }
    memo.set(key, out);
    return out;
}

const DX = [1, 0, 1, 1], DY = [0, 1, 1, -1];

/* 以 (x,y) 为中心、某方向的 9 格窗口；color 指定中心那格算谁的子（0 表示算空点） */
function windowAt(bd, x, y, d, color) {
    let m = 0, e = 0;
    for (let t = -4; t <= 4; t++) {
        const bit = 1 << (t + 4);
        const nx = x + t * DX[d], ny = y + t * DY[d];
        if (nx < 0 || nx > 14 || ny < 0 || ny > 14) { continue; }
        const v = bd[nx * 15 + ny];
        if (v === 0) { e |= bit; }
        else if (v === color) { m |= bit; }
    }
    if (color) { m |= 1 << 4; } else { e |= 1 << 4; }
    return { m, e };
}

/* ---------- 全盘规则（只判不搜） ---------- */
export function makesFive(bd, k, color) {
    const x = px(k), y = py(k);
    for (let d = 0; d < 4; d++) {
        let run = 1;
        for (let s = 1; s <= 4; s++) {
            const nx = x + s * DX[d], ny = y + s * DY[d];
            if (nx < 0 || nx > 14 || ny < 0 || ny > 14 || bd[nx * 15 + ny] !== color) { break; }
            run++;
        }
        for (let s = 1; s <= 4; s++) {
            const nx = x - s * DX[d], ny = y - s * DY[d];
            if (nx < 0 || nx > 14 || ny < 0 || ny > 14 || bd[nx * 15 + ny] !== color) { break; }
            run++;
        }
        if (color === BLACK && run > 5) { return false; }        /* 长连，黑棋不算成五 */
        if (color === BLACK ? run === 5 : run >= 5) { return true; }
    }
    return false;
}

export function fivePoints(bd, color) {
    const out = [];
    for (let k = 0; k < 225; k++) {
        if (bd[k]) { continue; }
        bd[k] = color;
        if (makesFive(bd, k, color)) { out.push(k); }
        bd[k] = 0;
    }
    return out;
}

/* 黑棋禁手：长连 / 四四 / 三三（三三按「该线是活三」计数，标准做法） */
export function blackForbidden(bd, k) {
    if (bd[k]) { return true; }
    bd[k] = BLACK;
    let fours = 0, threes = 0, over = false;
    for (let d = 0; d < 4; d++) {
        const w = windowAt(bd, px(k), py(k), d, BLACK);
        const c = classify(w.m, w.e, BLACK);
        if (c === OPEN_FOUR || c === FOUR) { fours++; }

        /* 长连单独数：过该点这条线上的连子长度 */
        const x = px(k), y = py(k);
        let run = 1;
        for (let s = 1; s <= 5; s++) {
            const nx = x + s * DX[d], ny = y + s * DY[d];
            if (nx < 0 || nx > 14 || ny < 0 || ny > 14 || bd[nx * 15 + ny] !== BLACK) { break; }
            run++;
        }
        for (let s = 1; s <= 5; s++) {
            const nx = x - s * DX[d], ny = y - s * DY[d];
            if (nx < 0 || nx > 14 || ny < 0 || ny > 14 || bd[nx * 15 + ny] !== BLACK) { break; }
            run++;
        }
        if (run >= 6) { over = true; }
    }
    for (let d = 0; d < 4; d++) {
        const w = windowAt(bd, px(k), py(k), d, BLACK);
        if (classify(w.m, w.e, BLACK) === OPEN_THREE) { threes++; }
    }
    bd[k] = 0;
    /* 四三 / 四三三 都算合法：只有在没做出四的时候才数三三 */
    return over || fours >= 2 || (fours === 0 && threes >= 2);
}

/*
 * 重演校验：既是出题终审，也是解题后的自证。
 * - 每步落点必须为空；
 * - 攻方每一手枚举全盘空点，找出「再落一子即连五」的点集；
 *   非末手必须恰好 1 个（冲四），且下一手守方必须落在这个点；
 *   末手允许：已直接成五 / ≥2 个五连点（双杀）/ 攻方为白且只有 1 个五连点。
 */
export function replayCheck(bd, attacker, path) {
    const b = Int8Array.from(bd);
    let color = attacker;
    for (let i = 0; i < path.length; i++) {
        const k = path[i];
        if (b[k]) { return { ok: false, why: '第 ' + i + ' 手落在已有子上' }; }
        b[k] = color;
        if (color === attacker) {
            const last = i === path.length - 1;
            const done = makesFive(b, k, color);
            const fp = fivePoints(b, color);
            if (last) {
                if (done) { /* 成五收 */ }
                else if (fp.length >= 2) { /* 双杀收 */ }
                else if (color === WHITE && fp.length === 1) { /* 唯一挡点对黑是禁手，白可强杀 */ }
                else { return { ok: false, why: '末手不成杀' }; }
            } else {
                if (done) { return { ok: false, why: '提前成五' }; }
                if (fp.length !== 1) { return { ok: false, why: '第 ' + i + ' 手不是冲四' }; }
                if (path[i + 1] !== fp[0]) { return { ok: false, why: '第 ' + (i + 1) + ' 手不是唯一挡点' }; }
            }
        }
        color = 3 - color;
    }
    return { ok: true };
}

/* ---------- 自对弈 ---------- */
function mulberry32(a) {
    return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function nearAny(bd, x, y) {
    for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx > 14 || ny < 0 || ny > 14) { continue; }
            if (bd[nx * 15 + ny]) { return true; }
        }
    }
    return false;
}

/* 候选点：开局前四手在各自框内，之后离已有棋子切比雪夫距 ≤2，且落子不成五 */
function candidates(bd, ply, color) {
    const out = [];
    const box = [0, 1, 2, 3][ply];
    for (let x = 0; x < 15; x++) {
        for (let y = 0; y < 15; y++) {
            const k = x * 15 + y;
            if (bd[k]) { continue; }
            if (ply < 4) {
                if (Math.max(Math.abs(x - 7), Math.abs(y - 7)) > box) { continue; }
            } else if (!nearAny(bd, x, y)) {
                continue;
            }
            bd[k] = color;
            const five = makesFive(bd, k, color);
            bd[k] = 0;
            if (five) { continue; }
            out.push(k);
        }
    }
    return out;
}

/* 我方棋型分 + 对方棋型分 × 0.92；自己造出冲四或活四重罚，于是双方都退一步铺二铺三 */
function scoreAt(bd, k, me) {
    const opp = 3 - me;
    const x = px(k), y = py(k);
    let mine = 0, theirs = 0;
    for (let d = 0; d < 4; d++) {
        const a = windowAt(bd, x, y, d, me);
        const ca = classify(a.m, a.e, me);
        mine += (ca >= FOUR ? -5e4 : WEIGHT[ca]);
        const b = windowAt(bd, x, y, d, opp);
        theirs += WEIGHT[classify(b.m, b.e, opp)];
    }
    return mine + theirs * 0.92;
}

function pick(bd, cands, color, rng) {
    const scored = cands.map(k => ({ k, v: scoreAt(bd, k, color) + rng() * 40 }))
        .sort((a, b) => b.v - a.v);
    const opp = 3 - color;

    /* 前 16 名里若有「对方下一手就能成五」的点，强制去挡 */
    for (const s of scored.slice(0, 16)) {
        bd[s.k] = opp;
        const five = makesFive(bd, s.k, opp);
        bd[s.k] = 0;
        if (five) { return s.k; }
    }

    const n = Math.min(4, scored.length);
    return scored[Math.min(n - 1, Math.floor(Math.pow(rng(), 1.5) * n))].k;
}

/* 落子后自己是否立刻握有四：只扫该子四方向 ±4 格 */
function hasFourNear(bd, k, color) {
    const x = px(k), y = py(k);
    for (let d = 0; d < 4; d++) {
        for (let t = -4; t <= 4; t++) {
            const nx = x + t * DX[d], ny = y + t * DY[d];
            if (nx < 0 || nx > 14 || ny < 0 || ny > 14) { continue; }
            const p = nx * 15 + ny;
            if (bd[p]) { continue; }
            bd[p] = color;
            const five = makesFive(bd, p, color);
            bd[p] = 0;
            if (five) { return true; }
        }
    }
    return false;
}

function fourExists(bd) {
    return fivePoints(bd, BLACK).length > 0 || fivePoints(bd, WHITE).length > 0;
}

function boardOf(moves) {
    const bd = new Int8Array(225);
    moves.forEach((k, i) => { bd[k] = i % 2 === 0 ? BLACK : WHITE; });
    return bd;
}

/* 一盘安静自对弈；命中杀局就返回局面 */
function playAttempt(o, rng, t0) {
    const bd = new Int8Array(225);
    const moves = [];
    const attacker = o.attacker;

    for (let ply = 0; ply < 60; ply++) {
        if (now() - t0 > o.timeoutMs) { return null; }
        const color = ply % 2 === 0 ? BLACK : WHITE;

        /* 从第 16 手起，轮到攻方就验一次杀 */
        if (moves.length >= 16 && color === attacker) {
            const r = solveBoard(bd, attacker);
            if (r.path && r.depth >= o.minMoves && r.depth <= o.maxMoves
                && replayCheck(bd, attacker, r.path).ok) {
                return { moves: moves.slice(), bd: Int8Array.from(bd), depth: r.depth, path: r.path };
            }
        }

        const cands = candidates(bd, ply, color);
        if (!cands.length) { return null; }
        const k = pick(bd, cands, color, rng);
        bd[k] = color;
        moves.push(k);

        if (makesFive(bd, k, color)) { return null; }
        if (hasFourNear(bd, k, color)) { return null; }   /* 出四就停手，这盘不收 */
    }
    return null;
}

/* ---------- 成对剪枝 ---------- */
function prune(game, o) {
    let moves = game.moves.slice();
    let path = game.path;
    const guard = new Set(moves.slice(0, 4));
    path.forEach(k => guard.add(k));

    for (let pass = 0; pass < 2; pass++) {
        let i = 4;
        while (i + 1 < moves.length) {
            if (guard.has(moves[i]) || guard.has(moves[i + 1])) { i += 2; continue; }
            const trial = moves.slice(0, i).concat(moves.slice(i + 2));
            const bd = boardOf(trial);
            const r = solveBoard(bd, o.attacker);
            if (r.path && r.depth >= o.minMoves && r.depth <= o.maxMoves
                && replayCheck(bd, o.attacker, r.path).ok) {
                moves = trial;
                path = r.path;
                path.forEach(k => guard.add(k));
            } else {
                i += 2;
            }
        }
    }
    return { moves, path };
}

/* ---------- 终审 ---------- */
function finalCheck(moves, path, depth, o) {
    if (depth < o.minMoves || depth > o.maxMoves) { return '深度越界'; }
    if (moves.length < 10) { return '子数不足'; }
    if ((moves.length % 2 === 0 ? BLACK : WHITE) !== o.attacker) { return '轮走方不对'; }
    if (new Set(moves).size !== moves.length) { return '有幽灵子'; }
    for (let i = 0; i < 4; i++) {
        const x = px(moves[i]), y = py(moves[i]);
        if (Math.max(Math.abs(x - 7), Math.abs(y - 7)) > [0, 1, 2, 3][i]) { return '开局框越界'; }
    }
    const bd = boardOf(moves);
    if (fourExists(bd)) { return '题面已有四'; }
    if (!replayCheck(bd, o.attacker, path).ok) { return '重演失败'; }
    const r = solveBoard(bd, o.attacker);
    if (!r.path || r.depth !== depth) { return '复算深度不一致'; }
    return null;
}

/* ---------- 对外 ---------- */
export function* generatePuzzle(opts) {
    const o = {
        minMoves: 3, maxMoves: 5,
        attacker: 'black',
        seed: (Math.random() * 4294967296) >>> 0,
        timeoutMs: 12000
    };
    Object.assign(o, opts);
    if (o.attacker === 'random') { o.attacker = Math.random() < 0.5 ? 'black' : 'white'; }
    o.attacker = o.attacker === 'white' ? WHITE : BLACK;

    const t0 = now();
    let attempt = 0;
    while (now() - t0 < o.timeoutMs) {
        attempt++;
        yield { attempt, elapsed: now() - t0 };

        const rng = mulberry32((o.seed + attempt * 2654435761) >>> 0);
        const game = playAttempt(o, rng, t0);
        if (!game) { continue; }

        const pr = prune(game, o);
        const bd = boardOf(pr.moves);
        const r = solveBoard(bd, o.attacker);
        if (!r.path) { continue; }
        if (finalCheck(pr.moves, r.path, r.depth, o)) { continue; }

        return {
            moves: pr.moves,
            path: r.path,
            depth: r.depth,
            attacker: o.attacker,
            attempts: attempt,
            ms: Math.round(now() - t0)
        };
    }
    return null;
}

export const lineOf = p =>
    p.moves.map(k => String.fromCharCode(97 + px(k)) + (py(k) + 1)).join('') + ' ' +
    p.path.map(k => String.fromCharCode(97 + px(k)) + (py(k) + 1)).join('');

/* ---------- 对拍：位掩码实现 vs 朴素枚举 ---------- */
function naiveFive(m, color) {
    for (let s = 0; s + 5 <= 9; s++) {
        let all = true;
        for (let i = 0; i < 5; i++) { if (!((m >> (s + i)) & 1)) { all = false; break; } }
        if (!all) { continue; }
        if (color === WHITE) { return true; }
        const left = s > 0 && ((m >> (s - 1)) & 1);
        const right = s + 5 < 9 && ((m >> (s + 5)) & 1);
        if (!left && !right) { return true; }
    }
    return false;
}

function naiveClassify(m, e, color) {
    if (naiveFive(m, color)) { return FIVE; }
    let pts = 0;
    for (let i = 0; i < 9; i++) {
        if (((e >> i) & 1) && naiveFive(m | (1 << i), color)) { pts++; }
    }
    if (pts >= 2) { return OPEN_FOUR; }
    if (pts === 1) { return FOUR; }
    let best = NONE;
    for (let i = 0; i < 9; i++) {
        if (!((e >> i) & 1)) { continue; }
        const c = naiveClassify(m | (1 << i), e & ~(1 << i), color);
        if (c === OPEN_FOUR) { return OPEN_THREE; }
        if (c === FOUR && best < SLEEP_THREE) { best = SLEEP_THREE; }
        if (c === OPEN_THREE && best < OPEN_TWO) { best = OPEN_TWO; }
        if (c === SLEEP_THREE && best < SLEEP_TWO) { best = SLEEP_TWO; }
    }
    return best;
}

export function crossCheck(samples) {
    const rng = mulberry32(20261106);
    let diff = 0;
    const detail = [];
    for (let n = 0; n < samples; n++) {
        const p = [0.55, 0.4, 0.25, 0.6][n % 4];
        let m = 0, e = 0;
        for (let i = 0; i < 9; i++) {
            const r = rng();
            if (r < p) { m |= 1 << i; } else if (r < p + 0.3) { e |= 1 << i; }
        }
        for (const color of [BLACK, WHITE]) {
            const a = classify(m, e, color), b = naiveClassify(m, e, color);
            if (a !== b) {
                diff++;
                if (detail.length < 5) { detail.push({ m, e, color, mask: a, naive: b }); }
            }
        }
    }
    return { samples, count: samples * 2, diff, detail };
}

export { N, EMPTY, BLACK, WHITE, ix, px, py };
