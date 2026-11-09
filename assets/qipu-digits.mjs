/*
 * 棋子上的手数序号 → 数字
 * ------------------------------------------------------------
 * 棋谱图里的子，白子上印黑字、黑子上印白字，字号大约是半个格距。
 * 这里只干一件事：给定一个交叉点的位置和子色，把子上的那串数字读出来。
 *
 * 三步：
 *   1. 取样
 *      · 只在交叉点周围一个椭圆里取像素（横 0.38 格、竖 0.30 格）。
 *        横着放宽是因为两位、三位数要占宽，竖着收窄是因为椭圆的角必须还落在
 *        棋子里——落到棋盘上，深色盘会被当成「墨」，白子就废了。
 *   2. 分墨
 *      · 椭圆里做一次 Otsu 二分：黑子取亮的那一类当字，白子取暗的那一类；
 *      · 再核三条：墨占的面积得占一成往上、字与底子的明暗差得够大、
 *        字高得像个字。三条有一条不过，就当作这颗子上没有序号。
 *      · 按列的空白把整串切成一个个单字；切出来的某一段要是宽得不像一个字
 *        （两位数字贴在一起），就在中间墨最少的那一列再切一刀。
 *   3. 认字
 *      · 每个单字按高度归一到 12×14 的格子，宽度按比例走——这样「1」天生
 *        就窄，靠宽度就能先排掉一半的误判；
 *      · 和十套模板比，取最像的那个；同一数字给了几种写法（比如「1」带不带
 *        底横），取分最高的那一种。
 *
 * 这里读出来的只是「这一串字符是什么」，是不是恰好凑成 1..N，
 * 由上层拿「手数不许重、不许漏」去卡，卡不上就当没有序号。
 */

export const GW = 16;
export const GH = 20;

/* 模板：'#' 是墨，'.' 是空。同一个数字可以给几种写法，认的时候取最高分 */
const ART = [
    /* 0 */ [
        [
            '....####....',
            '..########..',
            '.###....###.',
            '.##......##.',
            '##........##',
            '##........##',
            '##........##',
            '##........##',
            '##........##',
            '##........##',
            '.##......##.',
            '.###....###.',
            '..########..',
            '....####....'
        ]
    ],
    /* 1 */ [
        [
            '.....#......',
            '....##......',
            '...###......',
            '..####......',
            '.....#......',
            '.....#......',
            '.....#......',
            '.....#......',
            '.....#......',
            '.....#......',
            '.....#......',
            '.....#......',
            '.....#......',
            '.....#......'
        ],
        [
            '.....##.....',
            '....###.....',
            '..#####.....',
            '.....##.....',
            '.....##.....',
            '.....##.....',
            '.....##.....',
            '.....##.....',
            '.....##.....',
            '.....##.....',
            '.....##.....',
            '.....##.....',
            '..########..',
            '..########..'
        ]
    ],
    /* 2 */ [
        [
            '..######....',
            '.##...###...',
            '##.....##...',
            '.......##...',
            '......##....',
            '.....##.....',
            '....##......',
            '...##.......',
            '..##........',
            '.##.........',
            '##..........',
            '##########..',
            '##########..',
            '............'
        ]
    ],
    /* 3 */ [
        [
            '..#####.....',
            '.##...##....',
            '##.....##...',
            '......##....',
            '....###.....',
            '....####....',
            '.......##...',
            '........##..',
            '........##..',
            '##......##..',
            '##.....##...',
            '.##..###....',
            '...####.....',
            '............'
        ]
    ],
    /* 4 */ [
        [
            '......##....',
            '.....##.....',
            '....###.....',
            '...#.##.....',
            '..#..##.....',
            '.#...##.....',
            '#....##.....',
            '##########..',
            '.....##.....',
            '.....##.....',
            '.....##.....',
            '.....##.....',
            '............',
            '............'
        ],
        [
            '....####....',
            '....####....',
            '...#.##.....',
            '..#..##.....',
            '.#...##.....',
            '#....##.....',
            '##########..',
            '.....##.....',
            '.....##.....',
            '.....##.....',
            '.....##.....',
            '.....##.....',
            '............',
            '............'
        ]
    ],
    /* 5 */ [
        [
            '.########...',
            '.########...',
            '.##.........',
            '.##.........',
            '.##.####....',
            '.#####.##...',
            '....#..##...',
            '.......##...',
            '.......##...',
            '##.....##...',
            '##....##....',
            '.##..###....',
            '...####.....',
            '............'
        ]
    ],
    /* 6 */ [
        [
            '...####.....',
            '..##..##....',
            '.##....#....',
            '.##.........',
            '.##.####....',
            '.####..##...',
            '.##.....##..',
            '.##.....##..',
            '.##.....##..',
            '.##.....##..',
            '..##...##...',
            '...#####....',
            '............',
            '............'
        ]
    ],
    /* 7 */ [
        [
            '##########..',
            '##########..',
            '.......##...',
            '......##....',
            '......##....',
            '.....##.....',
            '.....##.....',
            '....##......',
            '....##......',
            '...##.......',
            '...##.......',
            '..##........',
            '..##........',
            '............'
        ]
    ],
    /* 8 */ [
        [
            '...####.....',
            '..##..##....',
            '.##....##...',
            '..##..##....',
            '...####.....',
            '..###.##....',
            '.##....##...',
            '##......##..',
            '##......##..',
            '##......##..',
            '.##....##...',
            '..######....',
            '............',
            '............'
        ]
    ],
    /* 9 */ [
        [
            '...####.....',
            '..##..##....',
            '.##....##...',
            '##......##..',
            '##......##..',
            '.##....##...',
            '..######....',
            '....###.....',
            '.......##...',
            '.......##...',
            '..##..##....',
            '...####.....',
            '............',
            '............'
        ]
    ]
];

/* ---------- 归一与比对 ---------- */

function toCov(rows) {
    const ch = rows.length, cw = rows[0].length;
    const cov = new Float32Array(cw * ch);
    for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
            cov[y * cw + x] = rows[y].charAt(x) === '#' ? 1 : 0;
        }
    }
    return { cov: cov, w: cw, h: ch };
}

/* 按面积平均缩放：目标格子覆盖到多少墨，就填多少 */
function resample(cov, cw, ch, tw, th) {
    const out = new Float32Array(tw * th);
    for (let y = 0; y < th; y++) {
        const y0 = y * ch / th, y1 = (y + 1) * ch / th;
        for (let x = 0; x < tw; x++) {
            const x0 = x * cw / tw, x1 = (x + 1) * cw / tw;
            let sum = 0, area = 0;
            for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) {
                const wy = Math.min(y1, yy + 1) - Math.max(y0, yy);
                if (wy <= 0) { continue; }
                for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
                    const wx = Math.min(x1, xx + 1) - Math.max(x0, xx);
                    if (wx <= 0) { continue; }
                    sum += cov[yy * cw + xx] * wx * wy;
                    area += wx * wy;
                }
            }
            out[y * tw + x] = area > 0 ? sum / area : 0;
        }
    }
    return out;
}

/*
 * 高度归到 14 行，宽度跟着比例走（太宽才缩），然后居中放进 12×14。
 * 不把宽高都拉满是有意的：拉满就把「1」拉成和「8」一样宽，白丢一条判据。
 */
function normalize(cov, cw, ch) {
    let tw = Math.max(1, Math.round(cw * (GH / ch))), th = GH;
    if (tw > GW) {
        const s = GW / cw;
        tw = GW;
        th = Math.max(1, Math.round(ch * s));
    }
    const small = resample(cov, cw, ch, tw, th);
    const out = new Float32Array(GW * GH);
    const ox = Math.floor((GW - tw) / 2), oy = Math.floor((GH - th) / 2);
    for (let y = 0; y < th; y++) {
        const yy = y + oy;
        if (yy < 0 || yy >= GH) { continue; }
        for (let x = 0; x < tw; x++) {
            const xx = x + ox;
            if (xx < 0 || xx >= GW) { continue; }
            out[yy * GW + xx] = small[y * tw + x];
        }
    }
    return out;
}

/*
 * 比字形的办法：倒角距离（chamfer），不是逐像素点乘。
 * 图上的数字是粗笔画的实心块，模板是细笔画的骨架，直接比覆盖率会一起糊掉：
 * 一个「1」能跟「4」有七成像。倒角只问「我这块墨离你最近的墨有多远」，
 * 笔画粗细就不碍事了，形状不像才是真的不像。
 */
function binarize(grid) {
    const m = new Uint8Array(GW * GH);
    for (let i = 0; i < GW * GH; i++) { m[i] = grid[i] >= 0.4 ? 1 : 0; }
    return m;
}

/*
 * 每个格子到最近的墨有多远（像素）。两遍扫描的 3-4 倒角近似，
 * 比逐格枚举所有墨点快两个数量级——格子加宽到 16×20 也顶得住。
 */
function distances(mask) {
    let any = false;
    const out = new Float32Array(GW * GH);
    for (let i = 0; i < GW * GH; i++) {
        if (mask[i]) { out[i] = 0; any = true; } else { out[i] = 1e6; }
    }
    if (!any) { return null; }
    const at = function (x, y) {
        if (x < 0 || y < 0 || x >= GW || y >= GH) { return 1e6; }
        return out[y * GW + x];
    };
    for (let y = 0; y < GH; y++) {
        for (let x = 0; x < GW; x++) {
            const i = y * GW + x;
            if (!out[i]) { continue; }
            let v = out[i];
            v = Math.min(v, at(x - 1, y) + 3, at(x, y - 1) + 3,
                at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
            out[i] = v;
        }
    }
    for (let y = GH - 1; y >= 0; y--) {
        for (let x = GW - 1; x >= 0; x--) {
            const i = y * GW + x;
            if (!out[i]) { continue; }
            let v = out[i];
            v = Math.min(v, at(x + 1, y) + 3, at(x, y + 1) + 3,
                at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
            out[i] = v;
        }
    }
    for (let i = 0; i < GW * GH; i++) { out[i] /= 3; }
    return out;
}

/*
 * 模板：能在浏览器里就用真字体渲一遍。
 * 图上的数字是粗笔画的实心块，手画的细骨架跟它比，十个数一起糊成七成像——
 * 真字体渲出来、按同一套归一化走一遍，笔画粗细才对得上。
 * 没有 canvas 的时候退回手画的那一套。
 */
const FONTS = [
    'Arial, Helvetica, sans-serif',
    'Verdana, sans-serif',
    'Georgia, serif',
    'Times New Roman, serif'
];
const WEIGHTS = ['600', '400'];

function fromMask(mask) {
    return { mask: mask, far: distances(mask) };
}

/* 把一段文字画出来，取墨的包围盒，归一成 12×14 */
function renderGlyph(text, font, weight) {
    const size = 64;
    const cv = document.createElement('canvas');
    cv.width = size * 2;
    cv.height = size * 2;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#ffffff';
    ctx.font = weight + ' ' + size + 'px ' + font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, size, size);
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;

    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (let y = 0; y < cv.height; y++) {
        for (let x = 0; x < cv.width; x++) {
            if (d[(y * cv.width + x) * 4] > 128) {
                if (x < x0) { x0 = x; }
                if (x > x1) { x1 = x; }
                if (y < y0) { y0 = y; }
                if (y > y1) { y1 = y; }
            }
        }
    }
    if (x1 < x0 || y1 < y0) { return null; }
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    const cov = new Float32Array(cw * ch);
    for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
            cov[y * cw + x] = d[((y + y0) * cv.width + (x + x0)) * 4] > 128 ? 1 : 0;
        }
    }
    return binarize(normalize(cov, cw, ch));
}

function bakeTemplates() {
    const fallback = ART.map(function (variants) {
        return variants.map(function (rows) {
            const g = toCov(rows);
            return fromMask(binarize(normalize(g.cov, g.w, g.h)));
        });
    });
    if (typeof document === 'undefined' || !document.createElement) { return fallback; }

    let cv = null;
    try {
        cv = document.createElement('canvas').getContext('2d');
    } catch (err) {
        return fallback;
    }
    if (!cv) { return fallback; }

    const baked = [];
    for (let d = 0; d < 10; d++) {
        const list = [];
        for (const font of FONTS) {
            for (const weight of WEIGHTS) {
                const mask = renderGlyph(String(d), font, weight);
                if (mask) { list.push(fromMask(mask)); }
            }
        }
        /* 一种都没渲出来（字体全缺）就用手画的顶上 */
        baked.push(list.length ? list : fallback[d]);
    }
    return baked;
}

const TEMPLATES = bakeTemplates();

/* 两撇墨互相「够不着」的平均距离，越小越像 */
function chamfer(maskA, farA, maskB, farB) {
    let s1 = 0, n1 = 0, s2 = 0, n2 = 0;
    for (let i = 0; i < GW * GH; i++) {
        if (maskA[i]) { s1 += farB[i]; n1++; }
        if (maskB[i]) { s2 += farA[i]; n2++; }
    }
    if (!n1 || !n2) { return 5; }
    return (s1 / n1 + s2 / n2) / 2;
}

/* ---------- 取像素 ---------- */

function otsu(hist, total) {
    let sum = 0;
    for (let i = 0; i < 256; i++) { sum += i * hist[i]; }
    let wb = 0, sb = 0, best = -1, thr = 128;
    for (let t = 0; t < 256; t++) {
        wb += hist[t];
        if (!wb) { continue; }
        const wf = total - wb;
        if (!wf) { break; }
        sb += t * hist[t];
        const mb = sb / wb, mf = (sum - sb) / wf;
        const v = wb * wf * (mb - mf) * (mb - mf);
        if (v > best) { best = v; thr = t; }
    }
    return thr;
}

/*
 * 读一颗子上的数字。
 *   gray/w/h  整图灰度
 *   cx, cy    交叉点像素坐标
 *   cell      格距
 *   color     'b' 或 'w'
 *   span      整图明暗跨度，用来定「差得够不够多」
 *   zoom      取像素的椭圆放大几倍（小字、细字第一次取不到时放大再试）
 * 返回 { glyphs: [归一后的字形], ink: 墨占比, clipped: 墨顶到取样框了 }。
 */
export function extractGlyphs(gray, w, h, cx, cy, cell, color, span, zoom) {
    const z = zoom || 1;
    const ax = Math.max(3, Math.round(cell * 0.38 * z));
    const by = Math.max(2, Math.round(cell * 0.30 * z));
    const dark = color === 'b';

    const hist = new Int32Array(256);
    const vals = [];
    const xs = [], ys = [];
    for (let dy = -by; dy <= by; dy++) {
        const y = Math.round(cy + dy);
        if (y < 1 || y >= h - 1) { continue; }
        for (let dx = -ax; dx <= ax; dx++) {
            /* 椭圆里才要：椭圆的四个角必须还落在棋子里 */
            const q = (dx * dx) / (ax * ax) + (dy * dy) / (by * by);
            if (q > 1) { continue; }
            const x = Math.round(cx + dx);
            if (x < 1 || x >= w - 1) { continue; }
            const v = gray[y * w + x];
            vals.push(v);
            xs.push(x);
            ys.push(y);
            hist[Math.max(0, Math.min(255, Math.round(v)))]++;
        }
    }
    const n = vals.length;
    if (n < 24) { return { glyphs: [], why: '小' }; }

    const thr = otsu(hist, n);
    let ink = 0, inkSum = 0, bodySum = 0, bodyN = 0;
    for (let k = 0; k < n; k++) {
        const v = vals[k];
        const isInk = dark ? v > thr : v < thr;
        if (isInk) { ink++; inkSum += v; } else { bodySum += v; bodyN++; }
    }
    if (!ink || !bodyN) { return { glyphs: [], why: '无墨' }; }
    const inkFrac = ink / n;
    if (inkFrac < 0.05 || inkFrac > 0.58) { return { glyphs: [], why: '墨占比' + inkFrac.toFixed(2) }; }

    const inkMean = inkSum / ink, bodyMean = bodySum / bodyN;
    if (Math.abs(inkMean - bodyMean) < Math.max(28, span * 0.28)) {
        return { glyphs: [], why: '对比' + Math.round(Math.abs(inkMean - bodyMean)) };
    }

    /*
     * 取墨图时把阈值往底子那边让一截：细笔画（衬线体尤其）的抗锯齿边缘
     * 往往卡在阈值上，按 Otsu 的刀口切，字会被自己的空列切断。
     * 让一截只是把笔画接上，不判定「这里有没有字」——那是上面的事。
     */
    const soft = dark ? thr - (thr - bodyMean) * 0.35 : thr + (bodyMean - thr) * 0.35;
    const isInk = function (v) { return dark ? v > soft : v < soft; };
    /* 画字形用「一半亮度」那条线：笔画粗细才不会被放宽的阈值撑胖 */
    const mid = (inkMean + bodyMean) / 2;
    const isCore = function (v) { return dark ? v > mid : v < mid; };

    /* 墨的包围盒（按局部坐标） */
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (let k = 0; k < n; k++) {
        const v = vals[k];
        if (isInk(v)) {
            const x = xs[k], y = ys[k];
            if (x < x0) { x0 = x; }
            if (x > x1) { x1 = x; }
            if (y < y0) { y0 = y; }
            if (y > y1) { y1 = y; }
        }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    /* 字各有各的高矮：Georgia 的数字就比同字号的 Arial 矮一截，
     * 只把「矮得不像字」的挡掉，别把字体差异当噪声 */
    if (bh < 6 || bh < by * 0.55) { return { glyphs: [], why: '高' + bh }; }
    if (bw < 2) { return { glyphs: [], why: '窄' }; }

    /* 铺一张墨图（只在包围盒里） */
    const mask = new Uint8Array(bw * bh);       /* 切字用，宽一点 */
    const core = new Uint8Array(bw * bh);       /* 画字形用，按半亮 */
    for (let k = 0; k < n; k++) {
        const v = vals[k];
        const at = (ys[k] - y0) * bw + (xs[k] - x0);
        if (isInk(v)) { mask[at] = 1; }
        if (isCore(v)) { core[at] = 1; }
    }

    /* 按列的空白切字 */
    const col = new Int32Array(bw);
    for (let x = 0; x < bw; x++) {
        let s = 0;
        for (let y = 0; y < bh; y++) { s += mask[y * bw + x]; }
        col[x] = s;
    }
    /*
     * 只认「够宽」的空白当分隔：细笔画的字常被自己的一条空列拦腰截断
     * （「2」的上弧和底横之间就有一列没墨），一条空列两边还都有墨，
     * 那多半是字内空档，不是两个字之间。
     */
    const on = new Uint8Array(bw);
    for (let x = 0; x < bw; x++) {
        on[x] = col[x] > 0
            || (x > 0 && x + 1 < bw && col[x - 1] > 0 && col[x + 1] > 0);
    }
    let segs = [];
    let start = -1;
    for (let x = 0; x <= bw; x++) {
        const lit = x < bw && on[x];
        if (lit && start < 0) { start = x; }
        if (!lit && start >= 0) { segs.push([start, x - 1]); start = -1; }
    }
    /* 碎渣并到隔壁去，最多认三个字 */
    const minInk = Math.max(2, Math.round(ink * 0.02));
    const inkOf = function (seg) {
        let s = 0;
        for (let x = seg[0]; x <= seg[1]; x++) { s += col[x]; }
        return s;
    };
    const spanOf = function (seg) {
        let sy0 = 1e9, sy1 = -1e9;
        for (let x = seg[0]; x <= seg[1]; x++) {
            for (let y = 0; y < bh; y++) {
                if (mask[y * bw + x]) {
                    if (y < sy0) { sy0 = y; }
                    if (y > sy1) { sy1 = y; }
                }
            }
        }
        return sy1 < sy0 ? null : { y0: sy0, y1: sy1, h: sy1 - sy0 + 1 };
    };
    segs = segs.filter(function (s) { return inkOf(s) >= minInk; });
    if (!segs.length) { return { glyphs: [], why: '碎' }; }

    /* 把一组段子做成字形 */
    const glyphsOf = function (list) {
        const out = [];
        for (const seg of list) {
            if (seg[1] - seg[0] + 1 < 2) { continue; }
            const sp = spanOf(seg);
            if (!sp || sp.h < 4) { continue; }
            const sw = seg[1] - seg[0] + 1, sh = sp.h;
            const cov = new Float32Array(sw * sh);
            for (let y = 0; y < sh; y++) {
                for (let x = 0; x < sw; x++) {
                    cov[y * sw + x] = core[(y + sp.y0) * bw + (x + seg[0])];
                }
            }
            out.push(normalize(cov, sw, sh));
        }
        return out;
    };

    /*
     * 切分本身就有歧义：「4」的斜笔和竖笔之间、两个紧贴的「1」之间，
     * 都是一条空列，宽度也差不离。与其猜，不如把几种切法都留着——
     * 哪种切法最后读出来最像数字，就用哪种（见下面的 pick）。
     */
    const plans = [segs];

    if (segs.length > 1) {
        let at = 0, gap = 1e9;
        for (let k = 0; k + 1 < segs.length; k++) {
            const g = segs[k + 1][0] - segs[k][1];
            if (g < gap) { gap = g; at = k; }
        }
        const merged = segs.slice();
        merged[at] = [merged[at][0], merged[at + 1][1]];
        merged.splice(at + 1, 1);
        plans.push(merged);
    }

    if (segs.length < 3) {
        let at = -1, widest = 0;
        for (let k = 0; k < segs.length; k++) {
            const wseg = segs[k][1] - segs[k][0] + 1;
            if (wseg > widest) { widest = wseg; at = k; }
        }
        if (at >= 0 && widest > bh * 0.85) {
            let cut = -1, low = 1e9;
            const lo = segs[at][0] + Math.round(widest * 0.35), hi = segs[at][0] + Math.round(widest * 0.65);
            for (let x = lo; x <= hi; x++) {
                if (col[x] < low) { low = col[x]; cut = x; }
            }
            if (cut > segs[at][0] && cut < segs[at][1]) {
                const split = segs.slice();
                split.splice(at, 1, [segs[at][0], cut - 1], [cut + 1, segs[at][1]]);
                plans.push(split);
            }
        }
    }

    let best = null, bestConf = -1;
    for (const plan of plans) {
        const gs = glyphsOf(plan);
        if (!gs.length || gs.length > 3) { continue; }
        let conf = 0;
        for (const g of gs) {
            const sc = digitScores(g);
            let top = -9;
            for (let d = 0; d < 10; d++) { if (sc[d] > top) { top = sc[d]; } }
            conf += top;
        }
        conf /= gs.length;
        if (conf > bestConf) { bestConf = conf; best = gs; }
    }
    if (!best) { return { glyphs: [], why: '碎' }; }
    /* 墨一直顶到取样椭圆的边上：字多半被切掉了一角，该放大重取 */
    const clipped = (y0 <= 1 && y1 >= bh - 2) || (x1 - x0 + 1) >= (2 * ax - 1);
    return { glyphs: best, ink: inkFrac, clipped: clipped };
}

/*
 * 一个字形对 0~9 各像几分：1 是最像，0 是八竿子打不着，越不像越往负数去。
 * 不在 0 上截断——认得很准的几个数字倒角都只有零点几，一截断就全变成 1.00，
 * 「第一和第二差多少」这条线索就没了。负数只是「不像」，不参与任何判定。
 */
export function digitScores(glyph) {
    const mask = binarize(glyph);
    const far = distances(mask);
    const out = new Array(10);
    for (let d = 0; d < 10; d++) {
        let best = -9;
        for (const t of TEMPLATES[d]) {
            const v = 1 - chamfer(mask, far, t.mask, t.far) / 4.2;
            if (v > best) { best = v; }
        }
        out[d] = best;
    }
    return out;
}

export const __masks = {
    glyph: function (g) { return binarize(g); },
    template: function (d) { return TEMPLATES[d][0].mask; },
    allTemplates: function (d) { return TEMPLATES[d].map(function (t) { return t.mask; }); }
};
