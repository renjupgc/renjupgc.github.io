/*
 * 棋盘图 → 棋谱
 * ------------------------------------------------------------
 * 给一张棋盘图，认出十五路上哪一格有黑子、哪一格有白子；
 * 子上印了手数序号的，顺手把序号也读出来。不判断胜负。
 *
 * 三步走：
 *   1. 找格子
 *      · 缩到 900px 以内转灰度，沿行、列各算一条「细线」响应曲线：
 *        二阶差分取绝对值——线比底色暗还是亮都算，深色木盘也吃得住；
 *      · 用梳状滤波套一组等距的 15 条线，得分是「15 条线上的响应之和
 *        减去 15 个格心的响应之和」，所以只有真压在格线上才算数；
 *      · 先按 0.5 像素的格距粗扫，挑出最好的几个格距再按 0.1 细扫。
 *        只粗扫不够：格距差 0.2，十四条线就漂出去快三像素；
 *      · 最后每条线在 ±0.3 格内找峰、按响应强弱加权拟合一次并剔除离群，
 *        缩放不齐、裁切不齐都能吃掉一点。
 *   2. 判子
 *      · 每个交叉点取半径 0.36 格的小圆盘，数里面比「当地底色」暗一截 /
 *        亮一截的像素占比：暗的过三成算黑子，亮的过三成算白子；
 *      · 当地底色逐点量：格心永远是空的（棋子只落在交叉点上，半径到不了
 *        格心），每个交叉点的底色就取周围四个格心的平均亮度，木纹渐变、
 *        打光不匀就不碍事；
 *      · 明暗两个阈值分开：黑子比底色暗一大截，白子只亮一点点。
 *   3. 读序号
 *      · 只在棋子内圈的椭圆里找墨（黑子取亮的一类，白子取暗的一类），
 *        按列的空白把一串数字切成单字，逐个和模板比；
 *      · 光靠字形不够稳，再拿「手数是 1..N 各一次」去卡：认错的字会被顶到
 *        真正空着的手数上，没读出字的子也能补上；卡不上就整盘不要序号。
 */

import { extractGlyphs, digitScores } from './qipu-digits.mjs';

export const N = 15;

const MAX_SIDE = 900;
/* 序号单独再读一遍时允许的边长：三位数挤在半个格子里，多几百万像素就多几分把握 */
const MAX_DIGIT_SIDE = 1800;

function toGray(img, maxSide) {
    const w0 = img.width || img.naturalWidth;
    const h0 = img.height || img.naturalHeight;
    const scale = Math.min(1, maxSide / Math.max(w0, h0));
    const w = Math.max(40, Math.round(w0 * scale));
    const h = Math.max(40, Math.round(h0 * scale));

    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;

    const gray = new Float32Array(w * h);
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
        gray[i] = px[p] * 0.299 + px[p + 1] * 0.587 + px[p + 2] * 0.114;
    }
    return { gray: gray, w: w, h: h, canvas: cv };
}

/* 细线响应：与上下（左右）差得越多的地方得分越高，正负都算 */
function profiles(gray, w, h) {
    const rows = new Float32Array(h);
    const cols = new Float32Array(w);
    let sum = 0, n = 0, hist = new Uint32Array(256);

    for (let y = 1; y < h - 1; y++) {
        let s = 0;
        for (let x = 0; x < w; x++) {
            const c = gray[y * w + x];
            /* 取绝对值：深色木盘上格线可能比底色还亮 */
            s += Math.abs(c * 2 - gray[(y - 1) * w + x] - gray[(y + 1) * w + x]);
        }
        rows[y] = s;
    }
    for (let x = 1; x < w - 1; x++) {
        let s = 0;
        for (let y = 0; y < h; y++) {
            const c = gray[y * w + x];
            s += Math.abs(c * 2 - gray[y * w + x - 1] - gray[y * w + x + 1]);
        }
        cols[x] = s;
    }
    for (let i = 0; i < gray.length; i++) {
        const v = gray[i] | 0;
        hist[v > 255 ? 255 : v]++;
        sum += v; n++;
    }
    let acc = 0, lo = 0, hi = 255;
    for (let v = 0; v < 256; v++) {
        acc += hist[v];
        if (acc >= n * 0.05) { lo = v; break; }
    }
    acc = 0;
    for (let v = 255; v >= 0; v--) {
        acc += hist[v];
        if (acc >= n * 0.05) { hi = v; break; }
    }
    return { rows: rows, cols: cols, mean: sum / n, lo: lo, hi: hi };
}

const sample = (prof, x) => {
    const i = Math.round(x);
    if (i < 0 || i >= prof.length) { return 0; }
    return prof[i];
};

/*
 * 一个格距下的最佳起点：等距 15 条线，线上得分高、格心得分低。
 * 起点要在整幅图上扫，因为图上留白可能比一个格距还宽；
 * 步长 0.5 像素，线只有一两个像素宽，压偏两像素就等于没压上。
 */
function bestPhase(prof, p) {
    const len = prof.length;
    const oMax = len - 1 - (N - 1) * p;
    if (oMax < 1) { return null; }
    let best = null;
    for (let o = 0; o <= oMax; o += 0.5) {
        let on = 0, off = 0, bad = false;
        for (let i = 0; i < N; i++) {
            const a = o + i * p;
            if (a < 1 || a > len - 2) { bad = true; break; }
            on += sample(prof, a);
            /* 最后一条线的格心可能已经出画，那就不算它，不能因此把整组否掉 */
            const m = a + p / 2;
            if (m < len - 2) { off += sample(prof, m); }
        }
        if (bad) { continue; }
        const score = on - off * 1.15;
        if (!best || score > best.score) { best = { p: p, o: o, score: score }; }
    }
    return best;
}

/*
 * 先按 0.5 的格距粗扫，挑出分数最高的几个格距，再在它们附近按 0.1 细扫。
 * 只做粗扫不够：格距差 0.2，十四条线就漂出去快三像素，正确的起点反而输给
 * 一个「贴着半边、少压两条线」的错位起点。细扫把格距找回来，起点才跟着回来。
 */
function lattice(prof, minP, maxP) {
    const all = [];
    for (let p = minP; p <= maxP; p += 0.5) {
        const b = bestPhase(prof, p);
        if (b) { all.push(b); }
    }
    if (!all.length) { return null; }
    all.sort((a, b) => b.score - a.score);

    const seeds = [];
    for (let i = 0; i < all.length && seeds.length < 6; i++) {
        let dup = false;
        for (const s of seeds) { if (Math.abs(s.p - all[i].p) < 1.5) { dup = true; break; } }
        if (!dup) { seeds.push(all[i]); }
    }

    let best = all[0];
    for (const s of seeds) {
        for (let p = s.p - 0.4; p <= s.p + 0.4; p += 0.1) {
            const b = bestPhase(prof, p);
            if (b && b.score > best.score) { best = b; }
        }
    }
    return best;
}

/* 在粗解附近再搜一遍，把格距收到 0.1 像素 */
function refine(prof, p, o) {
    let best = { p: p, o: o, score: -Infinity };
    const len = prof.length;
    for (let pp = p - 0.2; pp <= p + 0.2; pp += 0.05) {
        for (let oo = o - 1; oo <= o + 1; oo += 0.25) {
            let on = 0, off = 0, bad = false;
            for (let i = 0; i < N; i++) {
                const a = oo + i * pp;
                if (a < 1 || a > len - 2) { bad = true; break; }
                on += sample(prof, a);
                const m = a + pp / 2;
                if (m < len - 2) { off += sample(prof, m); }
            }
            if (bad) { continue; }
            const score = on - off * 1.15;
            if (score > best.score) { best = { p: pp, o: oo, score: score }; }
        }
    }
    return best;
}

/*
 * 每条线在 ±0.3 格内找峰，再按响应强弱加权拟合。
 * 线被棋子压住时会找不到峰，所以只有「够强、且够多」的线才允许改斜率，
 * 否则老老实实用梳状滤波给出的等距解，只整体平移。
 */
function fitLines(prof, p, o) {
    const win = Math.max(2, p * 0.3);
    const list = [];
    for (let i = 0; i < N; i++) {
        const at = o + i * p;
        let bx = at, bv = sample(prof, at);
        for (let t = -win; t <= win; t += 0.5) {
            const v = sample(prof, at + t);
            if (v > bv) { bv = v; bx = at + t; }
        }
        list.push({ i: i, x: bx, w: bv });
    }
    const maxW = Math.max.apply(null, list.map(s => s.w)) || 1;
    let use = list.filter(s => s.w > maxW * 0.18);

    const shift = function (set, b) {
        const r = set.map(s => s.x - b * s.i).sort((x, y) => x - y);
        if (!r.length) { return o; }
        return r[r.length >> 1];
    };

    let line = { a: shift(use, p), b: p };

    if (use.length >= 8) {
        const fit = function (set) {
            let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
            set.forEach(function (s) {
                sw += s.w; sx += s.w * s.i; sy += s.w * s.x;
                sxx += s.w * s.i * s.i; sxy += s.w * s.i * s.x;
            });
            const den = sw * sxx - sx * sx;
            if (Math.abs(den) < 1e-6) { return null; }
            return { b: (sw * sxy - sx * sy) / den, a: 0 };
        };
        let f = fit(use);
        if (f && Math.abs(f.b - p) < p * 0.04) {
            use = use.filter(s => Math.abs(s.x - (shift(use, f.b) + f.b * s.i)) < p * 0.2);
            const g = fit(use);
            if (g && Math.abs(g.b - p) < p * 0.04) { f = g; }
            line = { a: shift(use, f.b), b: f.b };
        }
    }

    const xs = [];
    for (let i = 0; i < N; i++) { xs.push(line.a + line.b * i); }
    return { xs: xs, cell: line.b, strong: use.length };
}

/* 一小块的平均亮度：取来当「当地底色」，木纹渐变、打光不匀就不碍事了 */
function patch(gray, w, h, cx, cy, r) {
    let s = 0, n = 0;
    const r2 = r * r;
    for (let dy = -r; dy <= r; dy++) {
        const y = Math.round(cy + dy);
        if (y < 1 || y >= h - 1) { continue; }
        for (let dx = -r; dx <= r; dx++) {
            if (dx * dx + dy * dy > r2) { continue; }
            const x = Math.round(cx + dx);
            if (x < 1 || x >= w - 1) { continue; }
            s += gray[y * w + x];
            n++;
        }
    }
    return n ? s / n : -1;
}

/* 圆盘里比当地底色暗 / 亮一大截的像素占比 */
function disk(gray, w, h, cx, cy, r, bg, thrDark, thrLight) {
    let dark = 0, light = 0, n = 0;
    const r2 = r * r;
    for (let dy = -r; dy <= r; dy++) {
        const y = Math.round(cy + dy);
        if (y < 1 || y >= h - 1) { continue; }
        for (let dx = -r; dx <= r; dx++) {
            if (dx * dx + dy * dy > r2) { continue; }
            const x = Math.round(cx + dx);
            if (x < 1 || x >= w - 1) { continue; }
            const v = gray[y * w + x];
            n++;
            if (v < bg - thrDark) { dark++; }
            else if (v > bg + thrLight) { light++; }
        }
    }
    if (!n) { return { dark: 0, light: 0 }; }
    return { dark: dark / n, light: light / n };
}

/*
 * 读手数序号
 * ------------------------------------------------------------
 * 图上的数字就是手数，1..N 各出现一次。这条「不重不漏」比字形本身管用得多：
 *   · 两颗子都读成 47，分高的那颗留 47，另一颗被顶到真正空着的手数上去；
 *   · 某颗子的字没读出来（比如正好被最后一步的红点盖了），也能补上空位。
 * 另外还有一条软约束：黑先走，黑子的手数该是奇数。字号小的图上 3/8、5/6、
 * 6/9 最容易串，奇偶正好能把它们分开，所以只在判得出来的时候当减分项用。
 *
 * 卡不上 1..N 就整盘不要序号——宁可没有，也不能给一串错的手数。
 */
function readNumbers(stones, xs, ys, gray, w, h, cell, span) {
    const M = stones.length;
    if (!M) { return null; }

    const ds = [];
    let read = 0;
    for (const s of stones) {
        const first = extractGlyphs(gray, w, h, xs[s.i], ys[s.j], cell, s.color, span);
        let list = first.glyphs || [];
        /*
         * 两种情况下重取一次：一个字都没读到（字太小、笔画太细），
         * 或者墨顶到了取样框（三位数常把椭圆撑满，边上那位被切掉一角）。
         */
        if (!list.length || first.clipped) {
            const again = extractGlyphs(gray, w, h, xs[s.i], ys[s.j], cell, s.color, span, 1.25);
            if (again.glyphs && again.glyphs.length >= list.length) { list = again.glyphs; }
        }
        if (!list.length) { ds.push(null); continue; }
        read++;
        ds.push(list.map(digitScores));
    }
    /* 一半以上的子都读不出字，这图大概压根没印序号 */
    if (read < M * 0.6) { return { ok: false, read: read, M: M }; }

    const valueScore = function (k, v) {
        const d = ds[k];
        if (!d) { return -1; }
        const str = String(v);
        if (str.length !== d.length) { return -1; }
        let sum = 0;
        for (let q = 0; q < d.length; q++) { sum += d[q][str.charCodeAt(q) - 48]; }
        return sum / d.length;
    };
    /* 最优的手数，顺手带出第二名：差得越少，这颗子读得越含糊 */
    const bestOf = function (k) {
        let bv = 0, bs = -1, b2 = -1;
        for (let v = 1; v <= M; v++) {
            const s = valueScore(k, v);
            if (s > bs) { b2 = bs; bs = s; bv = v; }
            else if (s > b2) { b2 = s; }
        }
        return bv ? { v: bv, s: bs, gap: bs - b2 } : null;
    };

    /* 先看黑子是奇是偶，判不出来就不管奇偶 */
    let bOdd = 0, bEven = 0, wOdd = 0, wEven = 0;
    for (let k = 0; k < M; k++) {
        const b = bestOf(k);
        if (!b || b.s < 0.70) { continue; }
        const odd = b.v % 2 === 1;
        if (stones[k].color === 'b') { odd ? bOdd++ : bEven++; }
        else { odd ? wOdd++ : wEven++; }
    }
    let want = null;
    if (bOdd + bEven >= 6 && bOdd >= (bOdd + bEven) * 0.8) { want = { b: 1, w: 0 }; }
    else if (wOdd + wEven >= 6 && wOdd >= (wOdd + wEven) * 0.8) { want = { b: 0, w: 1 }; }

    const scoreOf = function (k, v) {
        const base = valueScore(k, v);
        if (base < 0 || !want) { return base; }
        return base - ((v % 2) === want[stones[k].color] ? 0 : 0.08);
    };

    const chosen = new Array(M).fill(0);
    for (let k = 0; k < M; k++) {
        let bv = 0, bs = -1;
        for (let v = 1; v <= M; v++) {
            const s = scoreOf(k, v);
            if (s > bs) { bs = s; bv = v; }
        }
        chosen[k] = bv;
    }

    /* 抢同一个手数的先让给分高的，空出来的子去认剩下空着的手数 */
    for (let round = 0; round < 3; round++) {
        const cnt = new Map();
        for (const v of chosen) { if (v) { cnt.set(v, (cnt.get(v) || 0) + 1); } }
        let freed = false;
        for (const pair of cnt) {
            if (pair[1] < 2) { continue; }
            const group = [];
            for (let k = 0; k < M; k++) { if (chosen[k] === pair[0]) { group.push(k); } }
            group.sort(function (a, c) { return scoreOf(c, pair[0]) - scoreOf(a, pair[0]); });
            for (let q = 1; q < group.length; q++) { chosen[group[q]] = 0; freed = true; }
        }

        const used = new Set(chosen.filter(function (v) { return v > 0; }));
        const miss = [];
        for (let v = 1; v <= M; v++) { if (!used.has(v)) { miss.push(v); } }
        if (!miss.length) { break; }

        const free = [];
        for (let k = 0; k < M; k++) { if (!chosen[k]) { free.push(k); } }
        if (!free.length) { break; }

        const pairs = [];
        for (const k of free) {
            for (const v of miss) {
                const s = scoreOf(k, v);
                if (s >= 0) { pairs.push({ k: k, v: v, s: s }); }
            }
        }
        if (!pairs.length) { break; }
        pairs.sort(function (a, c) { return c.s - a.s; });
        const tookK = new Set(), tookV = new Set();
        for (const p of pairs) {
            if (tookK.has(p.k) || tookV.has(p.v)) { continue; }
            tookK.add(p.k); tookV.add(p.v);
            chosen[p.k] = p.v;
        }
        if (!freed) { break; }
    }

    /*
     * 还剩一类：读岔了位数（「15」只读出一个「6」），这位子按位数根本配不上
     * 任何空着的手数。这时候就看谁剩下了——剩的子和剩的手数按分最高的配，
     * 位数对不上也认，反正它是唯一说得通的去处。
     */
    const restK = [], restV = [];
    const taken = new Set(chosen.filter(function (v) { return v > 0; }));
    for (let k = 0; k < M; k++) { if (!chosen[k]) { restK.push(k); } }
    for (let v = 1; v <= M; v++) { if (!taken.has(v)) { restV.push(v); } }
    let forced = 0;
    while (restK.length && restV.length) {
        let pick = null;
        for (const k of restK) {
            for (const v of restV) {
                const sc = scoreOf(k, v);
                if (!pick || sc > pick.s) { pick = { k: k, v: v, s: sc }; }
            }
        }
        chosen[pick.k] = pick.v;
        if (pick.s < 0) { forced++; }
        restK.splice(restK.indexOf(pick.k), 1);
        restV.splice(restV.indexOf(pick.v), 1);
    }

    /*
     * 还剩一类错：两颗子把彼此的手数接了过去（4 认成 9、9 认成 4 之类）。
     * 重不漏已经满足了，约束管不着，只能看谁换回来更像——两两试换，
     * 换完总分涨了就换，几轮就收敛。
     */
    for (let pass = 0; pass < 4; pass++) {
        let moved = false;
        for (let a = 0; a < M; a++) {
            if (!chosen[a]) { continue; }
            for (let c = a + 1; c < M; c++) {
                if (!chosen[c] || chosen[a] === chosen[c]) { continue; }
                const now = scoreOf(a, chosen[a]) + scoreOf(c, chosen[c]);
                const alt = scoreOf(a, chosen[c]) + scoreOf(c, chosen[a]);
                if (alt > now + 0.02) {
                    const t = chosen[a];
                    chosen[a] = chosen[c];
                    chosen[c] = t;
                    moved = true;
                }
            }
        }
        if (!moved) { break; }
    }

    let sum = 0, reps = 0, blank = 0, seen = 0, scored = 0, vague = 0;
    for (let k = 0; k < M; k++) {
        const b = ds[k] ? bestOf(k) : null;
        if (!b) { blank++; }
        else {
            if (b.v !== chosen[k]) { reps++; }
            if (b.gap < 0.005) { vague++; }    /* 头两名咬死分不开 */
        }
        if (!chosen[k]) { continue; }
        seen++;
        const sc = scoreOf(k, chosen[k]);
        if (sc >= 0) { sum += sc; scored++; }
    }
    const mean = scored ? sum / scored : 0;
    const complete = seen === M && new Set(chosen).size === M;
    /*
     * 宁可没有序号，也不给一串看着挺顺、其实是错的数字：
     * 平均分要够高、改动的处数要少、硬凑的位子要几乎没有。三条都过了才认。
     */
    const ok = complete && mean >= 0.86
        && forced <= Math.max(2, Math.round(M * 0.05))
        && vague <= Math.max(3, Math.round(M * 0.15))
        && reps <= Math.max(4, Math.round(M * 0.1));
    if (ok) {
        for (let k = 0; k < M; k++) { stones[k].num = chosen[k]; }
    }

    return {
        ok: ok,
        M: M, read: read, blank: blank,
        mean: Math.round(mean * 1000) / 1000,
        fixed: reps,
        forced: forced,
        vague: vague,
        map: chosen.slice()
    };
}

export function recognize(img) {
    const g = toGray(img, MAX_SIDE);
    const gray = g.gray, w = g.w, h = g.h;

    const pr = profiles(gray, w, h);
    const minP = Math.max(6, Math.floor(Math.min(w, h) / 22));
    const maxP = Math.max(minP + 4, Math.floor(Math.min(w, h) / 7));

    const rowL = lattice(pr.rows, minP, maxP);
    const colL = lattice(pr.cols, minP, maxP);
    if (!rowL || !colL) { return { ok: false, why: '没找到棋盘格线' }; }
    const rowComb = refine(pr.rows, rowL.p, rowL.o);
    const colComb = refine(pr.cols, colL.p, colL.o);

    const rows = fitLines(pr.rows, rowComb.p, rowComb.o);
    const cols = fitLines(pr.cols, colComb.p, colComb.o);

    const cell = (rows.cell + cols.cell) / 2;
    if (!isFinite(cell) || cell < 5) { return { ok: false, why: '格距量不出来' }; }

    /*
     * 阴影阈值按整图明暗跨度自适应，但「当地底色」逐点量：
     * 格心永远是空的（棋子只落在交叉点上，半径到不了格心），
     * 于是每个交叉点的底色就用它周围四个格心的平均亮度。
     */
    const span = Math.max(40, pr.hi - pr.lo);
    /* 黑子比底色暗一大截，白子只亮一点点，两个阈值不能共用一个 */
    const thrDark = Math.max(10, span * 0.09);
    const thrLight = Math.max(5, span * 0.04);
    const radius = Math.max(2, Math.round(cell * 0.36));
    const pr2 = Math.max(1, Math.round(cell * 0.12));

    const cc = [];
    for (let i = 0; i < N - 1; i++) {
        cc.push([]);
        for (let j = 0; j < N - 1; j++) {
            cc[i].push(patch(gray, w, h, (cols.xs[i] + cols.xs[i + 1]) / 2,
                (rows.xs[j] + rows.xs[j + 1]) / 2, pr2));
        }
    }
    const bgAt = function (i, j) {
        let s = 0, n = 0;
        for (const a of [i - 1, i]) {
            for (const b of [j - 1, j]) {
                if (a < 0 || b < 0 || a >= N - 1 || b >= N - 1) { continue; }
                const v = cc[a][b];
                if (v < 0) { continue; }
                s += v; n++;
            }
        }
        return n ? s / n : pr.mean;
    };

    const stones = [];
    let b = 0, ws = 0;
    for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
            const d = disk(gray, w, h, cols.xs[i], rows.xs[j], radius,
                bgAt(i, j), thrDark, thrLight);
            let color = null;
            if (d.dark >= 0.30 && d.dark >= d.light) { color = 'b'; }
            else if (d.light >= 0.28) { color = 'w'; }
            if (!color) { continue; }
            stones.push({ i: i, j: j, color: color });
            if (color === 'b') { b++; } else { ws++; }
        }
    }

    let nums = null;
    try {
        nums = readNumbers(stones, cols.xs, rows.xs, gray, w, h, cell, span);
    } catch (err) {
        nums = null;                 /* 读序号是加分项，出错就当没有 */
    }

    /*
     * 序号没读利索，而原图比 900 像素还大：拿原分辨率再读一遍序号。
     * 格线在 900 像素上找已经够了，但三位数挤在半个格子里，缩一次就糊成一片——
     * 大图上多花几十毫秒只读小窗，往往就认出来了。
     */
    if (!nums || !nums.ok) {
        const w0 = img.width || img.naturalWidth || 0;
        if (w0 > w * 1.25) {
            try {
                const hi = toGray(img, MAX_DIGIT_SIDE);
                const k = hi.w / w;
                const hx = cols.xs.map(function (v) { return v * k; });
                const hy = rows.xs.map(function (v) { return v * k; });
                const again = readNumbers(stones, hx, hy, hi.gray, hi.w, hi.h, cell * k, span);
                if (again && again.ok) { nums = again; }
            } catch (err) {
                /* 读不出来就维持原判 */
            }
        }
    }

    return {
        ok: true,
        w: w, h: h,
        gray: gray,
        canvas: g.canvas,
        cell: cell,
        xs: cols.xs,
        ys: rows.xs,
        strong: Math.min(rows.strong, cols.strong),
        stones: stones,
        black: b,
        white: ws,
        nums: nums,
        numbered: !!(nums && nums.ok)
    };
}

/* 把识别结果画在原图上，方便核对自己有没有认错 */
export function paintOverlay(canvas, res) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = res.w, bh = res.h;
    canvas.width = bw * dpr;
    canvas.height = bh * dpr;
    canvas.style.width = '100%';
    canvas.style.maxWidth = bw + 'px';
    canvas.style.height = 'auto';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.drawImage(res.canvas, 0, 0, bw, bh);

    const r = Math.max(2, res.cell * 0.34);
    ctx.lineWidth = Math.max(1, res.cell * 0.05);

    /* 先淡淡描一遍认出来的格线，看着心里有底 */
    ctx.strokeStyle = 'rgba(200, 60, 40, 0.28)';
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
        ctx.moveTo(res.xs[i], res.ys[0]);
        ctx.lineTo(res.xs[i], res.ys[N - 1]);
        ctx.moveTo(res.xs[0], res.ys[i]);
        ctx.lineTo(res.xs[N - 1], res.ys[i]);
    }
    ctx.stroke();

    const seen = new Set();
    res.stones.forEach(function (s) {
        seen.add(s.i + ',' + s.j);
        const x = res.xs[s.i], y = res.ys[s.j];
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.strokeStyle = s.color === 'b' ? 'rgba(40, 150, 90, 0.95)' : 'rgba(40, 110, 190, 0.95)';
        ctx.stroke();
    });

    ctx.fillStyle = 'rgba(200, 60, 40, 0.5)';
    for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
            if (seen.has(i + ',' + j)) { continue; }
            ctx.beginPath();
            ctx.arc(res.xs[i], res.ys[j], Math.max(1, res.cell * 0.07), 0, Math.PI * 2);
            ctx.fill();
        }
    }

    /* 读出手数的，在旁边标一下，方便对着原图核 */
    if (res.numbered) {
        const size = Math.max(9, Math.round(res.cell * 0.34));
        ctx.font = '600 ' + size + 'px Arial, Helvetica, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = Math.max(2, size * 0.45);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
        ctx.fillStyle = 'rgba(200, 60, 40, 0.95)';
        res.stones.forEach(function (s) {
            if (!s.num) { return; }
            const x = res.xs[s.i] + res.cell * 0.36;
            const y = res.ys[s.j] - res.cell * 0.36;
            const t = String(s.num);
            ctx.strokeText(t, x, y);
            ctx.fillText(t, x, y);
        });
    }
}
