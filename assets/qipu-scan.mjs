/*
 * 棋盘图 → 棋谱
 * ------------------------------------------------------------
 * 只做一件事：给一张棋盘图，认出十五路上哪一格有黑子、哪一格有白子。
 * 不认手数序号（图上的数字一律忽略），也不判断胜负。
 *
 * 两步走：
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
 */

export const N = 15;

const MAX_SIDE = 900;

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
        white: ws
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
}
