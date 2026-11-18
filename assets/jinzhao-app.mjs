/*
 * 棋形判断与禁手找茬 - 页面逻辑
 * ------------------------------------------------------------
 * 两种玩法共用一块盘：
 *   禁手找茬：盘上只有一个点，黑棋落下去就违例，点出来就算过。
 *   棋形判断：题目点名要连五 / 活四 / 冲四 / 活三 / 眠三，点出能做出这一手的点。
 * 判定都只查规则（成五 / 成四 / 成三 / 长连），不跑搜索，所以秒回；
 * 规则与 VCF 做题同源（vcf-gen 的 classify / blackForbidden），没有第二套判定。
 *
 * 答对之后：棋子按弹入落盘、成形的几条线被圈出，金色碎屑从落点炸开，
 * 连五另外给一份更大的响动。动效全在 canvas 上画，不依赖外部库。
 */

import { BLACK, px, py, pname } from './quintet-core.mjs';
import { generatePuzzle, describePoint, DENSITY } from './jinzhao-gen.mjs';
import {
    generateShapePuzzle, evaluate, DENSITY as SHAPE_DENSITY, DIR_NAME
} from './qixing-gen.mjs';

const N = 15;
/* 两种玩法各有各的密度：棋形题的干扰子要少一些，不然一眼看不出主形 */
const LEVELS = {
    forbid: [
        { name: '入门', density: DENSITY.easy },
        { name: '常用', density: DENSITY.normal },
        { name: '密集', density: DENSITY.hard }
    ],
    shape: [
        { name: '入门', density: SHAPE_DENSITY.easy },
        { name: '常用', density: SHAPE_DENSITY.normal },
        { name: '密集', density: SHAPE_DENSITY.hard }
    ]
};
let S = null;
let resized = false;

const $ = id => document.getElementById(id);

function state() {
    if (S) { return S; }
    S = {
        mode: 'forbid',
        puzzle: null,
        board: new Int8Array(225),
        marks: [],          /* {k, kind:'bad'|'hint'|'ans'|'line'} */
        no: 0,
        /* 两种玩法各记各的账，切换过来不会看见对方的数字 */
        count: { forbid: { done: 0, tries: 0 }, shape: { done: 0, tries: 0 } },
        streak: 0,
        cleared: false,
        over: false,
        busy: false,
        genId: 0,
        level: '—',
        kind: '',
        fx: null,
        raf: 0,
        ctx: null, cell: 0, pad: 0, size: 0
    };
    return S;
}

/* ---------- 画布 ---------- */
function layout(s) {
    const canvas = $('jz-board');
    if (!canvas) { return false; }
    const host = canvas.closest('.jz-main') || canvas.parentNode;
    const pad = 32;
    const avail = Math.max(240, Math.min((host.clientWidth || 560) - pad, 560));
    s.cell = Math.max(15, Math.floor(avail / 17));
    s.pad = Math.round(s.cell * 0.95);
    s.size = 14 * s.cell + 2 * s.pad;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = s.size * dpr;
    canvas.height = s.size * dpr;
    canvas.style.width = s.size + 'px';
    canvas.style.height = s.size + 'px';
    s.ctx = canvas.getContext('2d');
    s.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
}

const cx = (s, x) => s.pad + x * s.cell;
const cy = (s, y) => s.pad + (14 - y) * s.cell;

/* 弹入：先蹿出来一点，再落回原位 */
function popScale(t) {
    const c1 = 1.70158, c3 = c1 + 1;
    const u = Math.min(1, t / 0.32) - 1;
    return Math.max(0.05, 1 + c3 * u * u * u + c1 * u * u);
}

function drawStone(ctx, x, y, r, color, scale) {
    const rr = Math.max(0.5, r * (scale == null ? 1 : scale));
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(x - rr * 0.35, y - rr * 0.4, rr * 0.15, x, y, rr);
    if (color === BLACK) {
        g.addColorStop(0, '#5f584c');
        g.addColorStop(1, '#15130f');
    } else {
        g.addColorStop(0, '#ffffff');
        g.addColorStop(1, '#e3dbc9');
    }
    ctx.fillStyle = g;
    ctx.fill();
    if (color !== BLACK) {
        ctx.strokeStyle = 'rgba(120, 104, 78, 0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
    }
}

/* 答对的碎屑：金色为主，掺两色压一压，免得像塑料彩带 */
const SPARK = ['#c9a227', '#b33a2b', '#e8c96a', '#f6ead0', '#8f6a2a'];

function celebrate(k, opts) {
    const s = state();
    const o = opts || {};
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const big = !!o.big;
    if (reduce) {
        s.fx = { t0: performance.now(), dur: 0.5, parts: [], rings: [], at: k, stone: o.stone ? k : null };
    } else {
        const x0 = cx(s, px(k)), y0 = cy(s, py(k));
        const n = big ? 58 : 34;
        const parts = [];
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
            const v = (big ? 150 : 110) + Math.random() * (big ? 210 : 150);
            parts.push({
                x: x0, y: y0,
                vx: Math.cos(a) * v,
                vy: Math.sin(a) * v - 40,
                r: 1.6 + Math.random() * 3.2,
                c: SPARK[i % SPARK.length],
                rot: Math.random() * Math.PI,
                vr: (Math.random() - 0.5) * 9
            });
        }
        s.fx = {
            t0: performance.now(),
            dur: big ? 1.5 : 1.15,
            at: k,
            parts: parts,
            rings: [
                { t0: 0, r0: s.cell * 0.4, sp: s.cell * (big ? 7 : 5), w: 3 },
                { t0: 0.1, r0: s.cell * 0.4, sp: s.cell * (big ? 5 : 3.6), w: 2 }
            ],
            stone: o.stone ? k : null,
            glow: big ? 0.3 : 0.2
        };
    }
    if (!s.raf) { s.raf = window.requestAnimationFrame(tick); }
}

function tick() {
    const s = state();
    s.raf = 0;
    if (!s.fx) { draw(); return; }
    const t = (performance.now() - s.fx.t0) / 1000;
    if (t > s.fx.dur) {
        s.fx = null;
        draw();
        return;
    }
    draw();
    s.raf = window.requestAnimationFrame(tick);
}

function draw() {
    const s = state();
    if (!s.ctx) { return; }
    const ctx = s.ctx, cell = s.cell, size = s.size;
    const fx = s.fx;
    const ft = fx ? (performance.now() - fx.t0) / 1000 : 0;

    ctx.clearRect(0, 0, size, size);
    const bg = ctx.createLinearGradient(0, 0, size, size);
    bg.addColorStop(0, '#f8f2e5');
    bg.addColorStop(1, '#f0e6d0');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = 'rgba(120, 100, 70, 0.34)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
        const g = Math.round(s.pad + i * cell) + 0.5;
        ctx.moveTo(s.pad, g); ctx.lineTo(s.pad + 14 * cell, g);
        ctx.moveTo(g, s.pad); ctx.lineTo(g, s.pad + 14 * cell);
    }
    ctx.stroke();

    ctx.fillStyle = 'rgba(90, 74, 52, 0.62)';
    [[3, 3], [11, 3], [3, 11], [11, 11], [7, 7]].forEach(function (p) {
        ctx.beginPath();
        ctx.arc(cx(s, p[0]), cy(s, p[1]), Math.max(2, cell * 0.09), 0, Math.PI * 2);
        ctx.fill();
    });

    ctx.fillStyle = 'rgba(110, 96, 74, 0.55)';
    ctx.font = Math.max(8, Math.round(cell * 0.33)) + 'px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < N; i++) {
        ctx.fillText(String.fromCharCode(97 + i), cx(s, i), s.pad * 0.46);
        ctx.fillText(String(i + 1), s.pad * 0.46, cy(s, i));
    }

    /* 落点光晕：先亮一下再退掉 */
    if (fx && fx.at != null) {
        const gx = cx(s, px(fx.at)), gy = cy(s, py(fx.at));
        const a = Math.max(0, fx.glow * (1 - ft / 0.8));
        if (a > 0) {
            const rg = ctx.createRadialGradient(gx, gy, cell * 0.2, gx, gy, cell * 2.6);
            rg.addColorStop(0, 'rgba(201, 162, 39, ' + a.toFixed(3) + ')');
            rg.addColorStop(1, 'rgba(201, 162, 39, 0)');
            ctx.fillStyle = rg;
            ctx.beginPath();
            ctx.arc(gx, gy, cell * 2.6, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    for (let k = 0; k < 225; k++) {
        const v = s.board[k];
        if (!v) { continue; }
        const sc = (fx && fx.stone === k && ft < 0.4) ? popScale(ft) : 1;
        drawStone(ctx, cx(s, px(k)), cy(s, py(k)), cell * 0.44, v, sc);
    }

    s.marks.forEach(function (m) {
        const x = cx(s, px(m.k)), y = cy(s, py(m.k));
        if (m.kind === 'ans') {
            ctx.beginPath();
            ctx.arc(x, y, cell * 0.56, 0, Math.PI * 2);
            ctx.strokeStyle = '#b33a2b';
            ctx.lineWidth = 2.4;
            ctx.stroke();
        } else if (m.kind === 'hint') {
            ctx.beginPath();
            ctx.arc(x, y, cell * 0.5, 0, Math.PI * 2);
            ctx.strokeStyle = '#c08f2e';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 3]);
            ctx.stroke();
            ctx.setLineDash([]);
        } else if (m.kind === 'bad') {
            const d = cell * 0.24;
            ctx.strokeStyle = 'rgba(179, 58, 43, 0.72)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x - d, y - d); ctx.lineTo(x + d, y + d);
            ctx.moveTo(x + d, y - d); ctx.lineTo(x - d, y + d);
            ctx.stroke();
        } else if (m.kind === 'line') {
            ctx.beginPath();
            ctx.arc(x, y, cell * 0.48, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(176, 141, 87, 0.9)';
            ctx.lineWidth = 1.8;
            ctx.stroke();
        }
    });

    /* 碎屑与光环画在最上面，不遮住棋盘线 */
    if (fx) {
        fx.rings.forEach(function (r) {
            const t = ft - r.t0;
            if (t <= 0) { return; }
            const rad = r.r0 + r.sp * t;
            const a = Math.max(0, 0.55 * (1 - t / (fx.dur * 0.8)));
            if (a <= 0) { return; }
            const g = fx.at;
            ctx.beginPath();
            ctx.arc(cx(s, px(g)), cy(s, py(g)), rad, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(201, 162, 39, ' + a.toFixed(3) + ')';
            ctx.lineWidth = r.w;
            ctx.stroke();
        });
        const grav = 420;
        fx.parts.forEach(function (p) {
            const t = ft;
            const x = p.x + p.vx * t;
            const y = p.y + p.vy * t + 0.5 * grav * t * t;
            const a = Math.max(0, 1 - t / (fx.dur * 0.9));
            if (a <= 0) { return; }
            ctx.save();
            ctx.globalAlpha = a;
            ctx.translate(x, y);
            ctx.rotate(p.rot + p.vr * t);
            ctx.fillStyle = p.c;
            ctx.fillRect(-p.r, -p.r * 0.55, p.r * 2, p.r * 1.1);
            ctx.restore();
        });
    }
}

/* ---------- 文案 ---------- */
function say(text, kind) {
    const el = $('jz-msg');
    if (!el) { return; }
    el.textContent = text;
    el.className = 'jz-msg' + (kind ? ' is-' + kind : '');
}

function cnt() {
    const s = state();
    return s.count[s.mode] || s.count.forbid;
}

function stat() {
    const s = state();
    const c = cnt();
    if ($('jz-done')) { $('jz-done').textContent = String(c.done); }
    if ($('jz-tries')) { $('jz-tries').textContent = String(c.tries); }
    if ($('jz-kind')) { $('jz-kind').textContent = s.kind || '—'; }
    if ($('jz-done-k')) { $('jz-done-k').textContent = s.mode === 'shape' ? '已答对' : '已找出'; }
    /* 棋盘底下那行小字：答完之后换成结果，不必再回头瞟右边的数字 */
    if ($('jz-count') && s.puzzle) {
        $('jz-count').textContent = '第 ' + s.no + ' 题 · ' + (s.cleared ? '已答对' : '黑先');
    }
}

/* 答对时从棋盘中央弹出来的那块牌子 */
let flashTimer = 0;

function clearFlash() {
    window.clearTimeout(flashTimer);
    const el = $('jz-flash');
    if (!el) { return; }
    el.classList.remove('is-on');
    el.innerHTML = '';
}

function flash(title, sub, tone, k) {
    const el = $('jz-flash');
    if (!el) { return; }
    el.innerHTML = '';
    /* 牌子躲着落点站：棋子在盘上半就落到下边，反之站上边，别把刚做出来的棋形盖住 */
    const upper = k == null ? false : py(k) >= 7;
    el.classList.toggle('is-bottom', upper);
    el.classList.toggle('is-top', !upper);
    const chip = document.createElement('div');
    chip.className = 'jz-flash-chip' + (tone ? ' is-' + tone : '');
    const b = document.createElement('b');
    b.textContent = title;
    chip.appendChild(b);
    if (sub) {
        const i = document.createElement('i');
        i.textContent = sub;
        chip.appendChild(i);
    }
    el.appendChild(chip);
    el.classList.add('is-on');
    window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(function () {
        el.classList.remove('is-on');
        el.innerHTML = '';
    }, 1600);
}

/* ---------- 音效：两三个音的小拨弦，默认开，可关 ---------- */
const K_SOUND = 'zbx.jz.sound';
let AC = null;

function soundOn() {
    try { return window.localStorage.getItem(K_SOUND) !== 'off'; } catch (e) { return true; }
}

function chime(big) {
    if (!soundOn()) { return; }
    try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) { return; }
        AC = AC || new Ctx();
        if (AC.state === 'suspended') { AC.resume(); }
        const t0 = AC.currentTime + 0.01;
        const notes = big ? [523.25, 659.25, 783.99, 1046.5] : [659.25, 987.77];
        notes.forEach(function (f, i) {
            const at = t0 + i * 0.075;
            const osc = AC.createOscillator();
            const gain = AC.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(f, at);
            gain.gain.setValueAtTime(0.0001, at);
            gain.gain.exponentialRampToValueAtTime(0.07, at + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.55);
            osc.connect(gain).connect(AC.destination);
            osc.start(at);
            osc.stop(at + 0.6);
        });
    } catch (e) { /* 没有音频就当没这回事 */ }
}

/* ---------- 出题 ---------- */
function newPuzzle() {
    const s = state();
    clearFlash();
    s.busy = true;
    s.over = false;
    s.cleared = false;
    s.marks = [];
    s.fx = null;
    const id = ++s.genId;

    const idx = $('jz-level') ? Number($('jz-level').value) : 1;
    const ladder = LEVELS[s.mode] || LEVELS.forbid;
    const lv = ladder[idx] || ladder[1];
    const shapeKey = ($('jz-shape') && $('jz-shape').value) || 'mix';

    const gen = s.mode === 'shape'
        ? generateShapePuzzle({ shape: shapeKey, density: lv.density, timeoutMs: 2200 })
        : generatePuzzle({ density: lv.density, timeoutMs: 2500 });
    say('正在摆局面…', 'wait');

    const step = function () {
        if (s.genId !== id) { return; }
        const deadline = performance.now() + 18;
        for (;;) {
            const r = gen.next();
            if (r.done) {
                s.busy = false;
                if (r.value) { s.no++; load(r.value, lv.name); }
                else { say('这次没摆出来，再点一次「下一题」。', 'bad'); }
                return;
            }
            if (performance.now() > deadline) { window.setTimeout(step, 0); return; }
        }
    };
    window.setTimeout(step, 0);
}

function load(p, levelName) {
    const s = state();
    s.puzzle = p;
    s.board = Int8Array.from(p.board);
    s.marks = [];
    s.fx = null;
    s.over = false;
    s.cleared = false;
    s.level = levelName || '—';
    s.kind = p.label;
    if ($('jz-ask')) {
        $('jz-ask').textContent = s.mode === 'shape'
            ? '黑先 · 下出「' + p.label + '」'
            : '黑先 · 找出禁手点';
    }
    stat();
    say(s.mode === 'shape'
        ? '题目要的是「' + p.label + '」：' + p.tip + ' 点出那一点。'
        : '黑棋该走。盘上只有一个点落下就违例，点它。', '');
    draw();
}

/* ---------- 走子 ---------- */
function clickCell(ev) {
    const s = state();
    if (s.busy || s.over || !s.ctx) { return; }
    const canvas = $('jz-board');
    const r = canvas.getBoundingClientRect();
    const mx = (ev.clientX - r.left) * (s.size / r.width);
    const my = (ev.clientY - r.top) * (s.size / r.height);
    const gx = Math.round((mx - s.pad) / s.cell);
    const gy = Math.round((my - s.pad) / s.cell);
    if (gx < 0 || gx > 14 || gy < 0 || gy > 14) { return; }
    if (Math.abs(mx - (s.pad + gx * s.cell)) > s.cell * 0.55) { return; }
    if (Math.abs(my - (s.pad + gy * s.cell)) > s.cell * 0.55) { return; }
    const k = gx * 15 + (14 - gy);
    if (s.mode === 'shape') { probeShape(k); } else { probe(k); }
}

/* ---------- 禁手找茬 ---------- */
function probe(k) {
    const s = state();
    if (!s.puzzle || s.board[k]) { return; }
    const info = describePoint(s.board, k);

    if (info && info.bad) {
        s.marks = s.marks.filter(m => m.kind !== 'bad' && m.kind !== 'hint');
        s.marks.push({ k: k, kind: 'ans' });
        /* 把构成禁手的那几条线牵出来的棋子圈一下 */
        const seen = new Set();
        info.dirs.forEach(function (d) {
            const dx = [1, 0, 1, 1][d], dy = [0, 1, 1, -1][d];
            for (let t = -4; t <= 4; t++) {
                if (!t) { continue; }
                const nx = px(k) + t * dx, ny = py(k) + t * dy;
                if (nx < 0 || nx > 14 || ny < 0 || ny > 14) { continue; }
                const q = nx * 15 + ny;
                if (s.board[q] !== BLACK || seen.has(q)) { continue; }
                seen.add(q);
                s.marks.push({ k: q, kind: 'line' });
            }
        });
        finish(k, info);
        return;
    }

    cnt().tries++;
    s.streak = 0;
    stat();
    s.marks = s.marks.filter(m => m.kind !== 'bad');
    s.marks.push({ k: k, kind: 'bad' });
    let why;
    if (!info || info.name === '没成型') {
        why = '这里什么也做不出来。';
    } else if (info.fours === 1 && info.threes >= 1) {
        why = '这里是四三（一根线成四、一根线成活三），四三不违例。';
    } else if (info.fours === 1 && info.threes === 0) {
        why = '这里只是一个冲四，不违例。';
    } else if (info.threes === 1) {
        why = '这里只成一根活三，单三不违例。';
    } else {
        why = '这里只是 ' + info.name + '，不违例。';
    }
    say(pname(k) + '：' + why + ' 再找找。', 'bad');
    draw();
}

function finish(k, info) {
    const s = state();
    s.over = true;
    if (!s.cleared) { s.cleared = true; cnt().done++; s.streak++; }
    stat();
    draw();
    const dirs = info.dirs.map(d => DIR_NAME[d]).join(' + ');
    say(pname(k) + ' 对了：黑棋落在这里是' + info.name + '禁手（' + dirs +
        '）。点「下一题」继续。', 'ok');
    const btn = $('jz-next');
    if (btn) { btn.classList.add('is-hot'); }
    celebrate(k, {});
    flash('找到了！', info.name + '禁手', 'ok', k);
    chime(false);
    try { if (navigator.vibrate) { navigator.vibrate(14); } } catch (e) { /* ignore */ }
}

/* ---------- 棋形判断 ---------- */
function probeShape(k) {
    const s = state();
    if (!s.puzzle || s.board[k]) { return; }
    const target = s.puzzle.shape;
    const ev = evaluate(s.board, k, BLACK);
    if (!ev) { return; }

    if (ev.over) {
        cnt().tries++;
        s.streak = 0;
        stat();
        s.marks = s.marks.filter(m => m.kind !== 'bad');
        s.marks.push({ k: k, kind: 'bad' });
        say(pname(k) + ' 落下连成六子以上，这是长连，黑棋违例——题目要的是恰好五子连成一线。', 'bad');
        draw();
        return;
    }
    if (ev.forbidden) {
        cnt().tries++;
        s.streak = 0;
        stat();
        s.marks = s.marks.filter(m => m.kind !== 'bad');
        s.marks.push({ k: k, kind: 'bad' });
        say(pname(k) + ' 这一手是禁手（三三或四四），黑棋不能走，得换个点。', 'bad');
        draw();
        return;
    }

    if (ev.shape && ev.shape.key === target) {
        rightShape(k, ev);
        return;
    }

    cnt().tries++;
    s.streak = 0;
    stat();
    s.marks = s.marks.filter(m => m.kind !== 'bad' && m.kind !== 'hint');
    s.marks.push({ k: k, kind: 'bad' });
    say(pname(k) + ' 落下是' + ev.name + '（' + ev.short + '），题目要的是' +
        s.puzzle.label + '（' + s.puzzle.tip.replace(/。$/, '') + '）。再找找。', 'bad');
    draw();
}

function rightShape(k, ev) {
    const s = state();
    s.over = true;
    s.board[k] = BLACK;             /* 落子真摆上去，让人看见棋形成立 */
    s.marks = s.marks.filter(m => m.kind !== 'bad' && m.kind !== 'hint');
    s.marks.push({ k: k, kind: 'ans' });

    /* 把成形的线上那几颗子圈出来 */
    const seen = new Set();
    ev.dirs.forEach(function (d) {
        const dx = [1, 0, 1, 1][d], dy = [0, 1, 1, -1][d];
        for (let t = -4; t <= 4; t++) {
            if (!t) { continue; }
            const nx = px(k) + t * dx, ny = py(k) + t * dy;
            if (nx < 0 || nx > 14 || ny < 0 || ny > 14) { continue; }
            const q = nx * 15 + ny;
            if (s.board[q] !== BLACK || seen.has(q)) { continue; }
            seen.add(q);
            s.marks.push({ k: q, kind: 'line' });
        }
    });

    if (!s.cleared) { s.cleared = true; cnt().done++; s.streak++; }
    stat();

    const five = s.puzzle.shape === 'five';
    say('漂亮！' + pname(k) + ' 落下去正好是' + s.puzzle.label + '：' +
        s.puzzle.tip + ' 点「下一题」继续。', 'ok');
    const btn = $('jz-next');
    if (btn) { btn.classList.add('is-hot'); }

    celebrate(k, { stone: true, big: five });
    flash(five ? '连五！赢了' : '漂亮！' + s.puzzle.label,
        s.streak >= 2 ? '连对 ' + s.streak + ' 题' : '正解',
        five ? 'five' : 'ok', k);
    chime(five);
    try { if (navigator.vibrate) { navigator.vibrate(five ? [12, 40, 18] : 12); } } catch (e) { /* ignore */ }
}

/* ---------- 提示 ---------- */
function showHint() {
    const s = state();
    if (s.busy || s.over || !s.puzzle) { return; }
    if (s.mode === 'shape') { hintShape(); return; }

    const marked = new Set(s.marks.filter(m => m.kind !== 'line').map(m => m.k));
    const cands = [];
    for (let k = 0; k < 225; k++) {
        if (s.board[k] || marked.has(k) || k === s.puzzle.answer) { continue; }
        const info = describePoint(s.board, k);
        if (!info) { continue; }
        if (info.fours >= 1 || info.threes >= 1) { cands.push({ k: k, info: info }); }
    }
    if (!cands.length) {
        say('盘上没有别的成型点了，就那一处，慢慢看。', '');
        return;
    }
    const pickOne = cands[Math.floor(Math.random() * cands.length)];
    s.marks = s.marks.filter(m => m.kind !== 'hint' && m.kind !== 'bad');
    s.marks.push({ k: pickOne.k, kind: 'hint' });
    draw();
    say('提示：' + pname(pickOne.k) + ' 落下是' + pickOne.info.name +
        '，看着热闹，但不违例——这盘只有一处禁手。', '');
}

/* 棋形题不分对错，只看这一手做出了什么，所以提示拿「差一档」的点来讲 */
function hintShape() {
    const s = state();
    const target = s.puzzle.shape;
    const order = { five: 5, open4: 4, four: 3, open3: 2, sleep3: 1 };
    const want = order[target];
    const marked = new Set(s.marks.map(m => m.k));
    let best = null;
    for (let k = 0; k < 225; k++) {
        if (s.board[k] || marked.has(k)) { continue; }
        const ev = evaluate(s.board, k, BLACK);
        if (!ev || !ev.shape || ev.over || ev.forbidden) { continue; }
        const gap = Math.abs(order[ev.shape.key] - want);
        if (gap !== 1) { continue; }
        if (!best || gap < best.gap) { best = { k: k, ev: ev, gap: gap }; }
    }
    if (!best) {
        say('提示：跟着三子、四子的两头看，哪一头补上还能再长一格，就是它。', '');
        return;
    }
    s.marks = s.marks.filter(m => m.kind !== 'hint' && m.kind !== 'bad');
    s.marks.push({ k: best.k, kind: 'hint' });
    draw();
    say('提示：' + pname(best.k) + ' 落下是' + best.ev.name + '，就差一档——' +
        '再想想另一头是不是还空着。', '');
}

/* ---------- 看答案 / 重来 ---------- */
function reveal() {
    const s = state();
    if (s.busy || s.over || !s.puzzle) { return; }
    clearFlash();
    s.over = true;
    s.marks = s.marks.filter(m => m.kind !== 'bad' && m.kind !== 'hint');

    if (s.mode === 'shape') {
        const list = s.puzzle.answers.slice(0, 6);
        list.forEach(function (k) { s.marks.push({ k: k, kind: 'ans' }); });
        const extra = s.puzzle.answers.length > list.length
            ? '等 ' + s.puzzle.answers.length + ' 处' : '';
        say('这盘能做出' + s.puzzle.label + '的有 ' + s.puzzle.answers.length + ' 处：' +
            s.puzzle.answers.map(pname).join('、') + (extra ? '（图上圈出前 ' + list.length + ' 处）' : '') +
            '。点「下一题」换一盘。', 'bad');
        draw();
        return;
    }

    s.marks.push({ k: s.puzzle.answer, kind: 'ans' });
    say('答案在 ' + pname(s.puzzle.answer) + '，' + s.puzzle.label +
        '禁手。点「下一题」换一盘。', 'bad');
    draw();
}

function reset() {
    const s = state();
    if (s.busy || !s.puzzle) { return; }
    clearFlash();
    s.genId++;
    s.marks = [];
    s.fx = null;
    s.over = false;
    s.cleared = false;
    s.board = Int8Array.from(s.puzzle.board);
    say(s.mode === 'shape' ? '回到本题开局，重新点。' : '回到本题开局。', '');
    draw();
}

/* ---------- 模式 ---------- */
function setMode(mode, fresh) {
    const s = state();
    if (mode !== 'shape' && mode !== 'forbid') { mode = 'forbid'; }
    if (s.mode !== mode) { s.streak = 0; }
    s.mode = mode;
    document.querySelectorAll('.jz-tab').forEach(function (tab) {
        const on = tab.dataset.mode === mode;
        tab.classList.toggle('is-on', on);
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const row = $('jz-shape-row');
    if (row) { row.hidden = mode !== 'shape'; }
    const hf = $('jz-help-forbid');
    const hs = $('jz-help-shape');
    if (hf) { hf.hidden = mode === 'shape'; }
    if (hs) { hs.hidden = mode !== 'shape'; }
    const ask = $('jz-ask');
    if (ask) { ask.textContent = mode === 'shape' ? '黑先 · 下出棋形' : '黑先 · 找出禁手点'; }
    stat();
    if (fresh) {
        s.no = 0;
        newPuzzle();
    }
}

function bootTabs() {
    const tabs = document.querySelectorAll('.jz-tab');
    if (!tabs.length) { return; }
    tabs.forEach(function (tab) {
        if (tab.dataset.bound === '1') { return; }
        tab.dataset.bound = '1';
        tab.addEventListener('click', function () {
            const mode = tab.dataset.mode;
            if (state().mode === mode) { return; }
            try {
                const u = new URL(location.href);
                if (mode === 'shape') { u.searchParams.set('m', 'shape'); }
                else { u.searchParams.delete('m'); }
                history.replaceState(null, '', u.pathname + u.search + u.hash);
            } catch (e) { /* 不想改地址就改不了 */ }
            setMode(mode, true);
        });
    });
}

/* ---------- 音效开关 ---------- */
function syncSoundBtn() {
    const btn = $('jz-sound');
    if (!btn) { return; }
    const on = soundOn();
    btn.textContent = on ? '音效 开' : '音效 关';
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.classList.toggle('is-off', !on);
}

/* 调试用 */
export const __debug = () => S;

/* ---------- 挂载 ---------- */
export function boot() {
    const canvas = $('jz-board');
    if (!canvas || canvas.dataset.booted === '1') { return; }
    const s = state();
    s.genId++;
    s.busy = false;
    s.fx = null;
    if (!layout(s)) { return; }
    canvas.dataset.booted = '1';
    draw();

    if (!canvas.dataset.bound) {
        canvas.dataset.bound = '1';
        canvas.addEventListener('click', clickCell);
        const lv = $('jz-level');
        if (lv) {
            lv.addEventListener('change', function () {
                state().genId++;
                newPuzzle();
            });
        }
        const sp = $('jz-shape');
        if (sp) {
            sp.addEventListener('change', function () {
                state().genId++;
                newPuzzle();
            });
        }
        const bind = function (id, fn) {
            const el = $(id);
            if (el) { el.addEventListener('click', fn); }
        };
        bind('jz-hint', showHint);
        bind('jz-reveal', reveal);
        bind('jz-reset', reset);
        bind('jz-sound', function () {
            try {
                window.localStorage.setItem(K_SOUND, soundOn() ? 'off' : 'on');
            } catch (e) { /* 存不了就只管这一次 */ }
            syncSoundBtn();
            if (soundOn()) { chime(false); }
        });
        bind('jz-next', function () {
            const btn = $('jz-next');
            if (btn) { btn.classList.remove('is-hot'); }
            newPuzzle();
        });
        if (!resized) {
            resized = true;
            window.addEventListener('resize', function () {
                if (!document.getElementById('jz-board')) { return; }
                layout(state());
                draw();
            });
        }
    }

    bootTabs();
    syncSoundBtn();
    const q = new URLSearchParams(location.search).get('m');
    setMode(q === 'shape' ? 'shape' : s.mode, false);
    newPuzzle();
}
