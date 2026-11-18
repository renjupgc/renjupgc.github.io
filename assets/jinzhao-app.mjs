/*
 * 棋形判断与禁手找茬 - 页面逻辑
 * ------------------------------------------------------------
 * 两种玩法共用一块盘：
 *   禁手找茬：盘上一到三处「黑棋落下去就违例」的点，全点出来才算过。
 *   棋形判断：题目点名要连五 / 活四 / 冲四 / 活三 / 眠三，盘上能做出这一手的
 *             点不止一处（活三、冲四本身就两头都能补），要全找出来。
 * 判定都只查规则（成五 / 成四 / 成三 / 长连），不跑搜索，所以秒回；
 * 规则与 VCF 做题同源（vcf-gen 的 classify / blackForbidden），没有第二套判定。
 *
 * 每点中一处：那一点标个勾、成形的几条线被圈出，金色碎屑从那里炸开；
 * 全部找齐才落子成功，给一份更大的响动。动效全在 canvas 上画，不依赖外部库。
 */

import { BLACK, px, py, pname } from './quintet-core.mjs';
import { generatePuzzle, describePoint, DENSITY } from './jinzhao-gen.mjs';
import {
    generateShapePuzzle, evaluate, DENSITY as SHAPE_DENSITY
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
        marks: [],          /* {k, kind:'bad'|'hint'|'ans'|'got'|'line'} */
        answers: [],        /* 本题所有答案点 */
        need: 0,
        found: new Set(),   /* 已经标出来的答案点 */
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
        /* 刚点中的那一处从 0.5 倍弹回原大，和棋子落盘的节奏一致 */
        const pop = (fx && fx.stone === m.k && ft < 0.45) ? popScale(ft) : 1;
        if (m.kind === 'got') {
            if (m.tone === 'ok') {
                /* 半透明的棋子：这一手真下在这儿就是这个样子，但只是标记，不是落子 */
                ctx.save();
                ctx.globalAlpha = 0.5;
                drawStone(ctx, x, y, cell * 0.44, BLACK, pop);
                ctx.restore();
            }
            ctx.beginPath();
            ctx.arc(x, y, cell * 0.56 * pop, 0, Math.PI * 2);
            ctx.strokeStyle = m.tone === 'ok' ? '#a8834a' : '#b33a2b';
            ctx.lineWidth = 2.4;
            ctx.stroke();
            /* 勾：棋形题是压在深色棋子上，用米白加一点描边才看得清 */
            const r = cell * 0.44;
            ctx.beginPath();
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.moveTo(x - r * 0.42, y + r * 0.02);
            ctx.lineTo(x - r * 0.1, y + r * 0.36);
            ctx.lineTo(x + r * 0.46, y - r * 0.36);
            if (m.tone === 'ok') {
                ctx.strokeStyle = 'rgba(40, 32, 20, 0.5)';
                ctx.lineWidth = Math.max(3, cell * 0.17);
                ctx.stroke();
                ctx.strokeStyle = '#fbf3e2';
                ctx.lineWidth = Math.max(1.8, cell * 0.11);
                ctx.stroke();
            } else {
                ctx.strokeStyle = '#b33a2b';
                ctx.lineWidth = Math.max(1.8, cell * 0.1);
                ctx.stroke();
            }
            ctx.lineCap = 'butt';
            ctx.lineJoin = 'miter';
        } else if (m.kind === 'ans') {
            ctx.beginPath();
            ctx.arc(x, y, cell * 0.56, 0, Math.PI * 2);
            ctx.strokeStyle = '#b33a2b';
            ctx.lineWidth = 2.2;
            ctx.setLineDash([5, 4]);
            ctx.stroke();
            ctx.setLineDash([]);
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
    /* 棋盘底下那行小字：要找几处、找到几处，一眼看得见 */
    if ($('jz-count') && s.puzzle) {
        let t = '第 ' + s.no + ' 题';
        if (s.cleared) { t += ' · 已答对'; }
        else if (s.need > 1) { t += ' · 找到 ' + s.found.size + '/' + s.need; }
        else { t += ' · 黑先'; }
        $('jz-count').textContent = t;
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
    s.answers = (p.answers && p.answers.length) ? p.answers.slice() : [p.answer];
    s.need = s.answers.length;
    s.found = new Set();
    s.marks = [];
    s.fx = null;
    s.over = false;
    s.cleared = false;
    s.level = levelName || '—';
    s.kind = (s.mode === 'shape' && s.need > 1) ? p.label + '×' + s.need : p.label;
    if ($('jz-ask')) {
        if (s.mode === 'shape') {
            $('jz-ask').textContent = s.need > 1
                ? '黑先 · 找全 ' + s.need + ' 处「' + p.label + '」'
                : '黑先 · 下出「' + p.label + '」';
        } else {
            $('jz-ask').textContent = s.need > 1
                ? '黑先 · 找出 ' + s.need + ' 处禁手'
                : '黑先 · 找出禁手点';
        }
    }
    stat();
    if (s.mode === 'shape') {
        say(s.need > 1
            ? '题目要的是「' + p.label + '」：' + p.tip + ' 盘上有 ' + s.need +
              ' 处能做出它，全部点出来才算过。'
            : '题目要的是「' + p.label + '」：' + p.tip + ' 点出那一点。', '');
    } else {
        say(s.need > 1
            ? '黑棋该走。盘上有 ' + s.need + ' 处落下就违例，一处一处点出来。'
            : '黑棋该走。盘上只有一个点落下就违例，点它。', '');
    }
    draw();
}

/* ---------- 走子 ---------- */
function clickCell(ev) {
    const s = state();
    if (s.busy || s.over || !s.ctx || !s.puzzle) { return; }
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
    if (s.board[k]) { return; }          /* 已经有子的地方不用点 */
    if (s.answers.indexOf(k) >= 0) { hit(k); } else { miss(k); }
}

/* 把某一点成形的几条线上的黑子圈出来 */
function ringLines(k, dirs) {
    const s = state();
    const seen = new Set();
    dirs.forEach(function (d) {
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
}

/* 点中了答案：禁手题标红勾，棋形题标成半透明的「这一手」 */
function hit(k) {
    const s = state();
    if (s.found.has(k)) {
        say(pname(k) + ' 这处已经标出来了，还有 ' + (s.need - s.found.size) + ' 处没找到。', '');
        return;
    }
    s.found.add(k);
    s.marks = s.marks.filter(m => m.kind !== 'bad' && m.kind !== 'hint' && m.kind !== 'line');
    s.marks.push({ k: k, kind: 'got', tone: s.mode === 'shape' ? 'ok' : 'no' });

    if (s.mode === 'shape') {
        const ev = evaluate(s.puzzle.board, k, BLACK);
        if (ev) { ringLines(k, ev.dirs); }
    } else {
        const info = describePoint(s.puzzle.board, k);
        if (info) { ringLines(k, info.dirs); }
    }

    const left = s.need - s.found.size;
    stat();

    if (left > 0) {
        celebrate(k, { stone: true });
        chime(false);
        try { if (navigator.vibrate) { navigator.vibrate(10); } } catch (e) { /* ignore */ }
        say('找到 ' + s.found.size + '/' + s.need + '，' + pname(k) + ' 这一处成立。' +
            '还有 ' + left + ' 处，接着找。', 'ok');
        draw();
        return;
    }

    /* 全找齐了 */
    s.over = true;
    if (!s.cleared) { s.cleared = true; cnt().done++; s.streak++; }
    stat();
    draw();

    const last = pname(k);
    const all = s.answers.map(pname).join('、');
    let title, sub;
    if (s.mode === 'shape') {
        const five = s.need === 1 && s.puzzle.shape === 'five';
        title = five ? '连五！赢了' : (s.need > 1 ? s.need + ' 处全中！' : '漂亮！' + s.puzzle.label);
        sub = s.streak >= 2 ? '连对 ' + s.streak + ' 题' : (s.need > 1 ? s.puzzle.label + '，全找齐' : '正解');
        say(s.need > 1
            ? '全找齐了！' + s.need + ' 处都能做出' + s.puzzle.label + '：' + all +
              '。' + s.puzzle.tip + ' 点「下一题」继续。'
            : '漂亮！' + last + ' 落下去正好是' + s.puzzle.label + '：' + s.puzzle.tip +
              ' 点「下一题」继续。', 'ok');
        celebrate(k, { stone: true, big: five || s.need > 1 });
        chime(five || s.need > 1);
    } else {
        const kinds = s.puzzle.kinds || [s.puzzle.label];
        title = s.need > 1 ? '全找到了！' : '找到了！';
        sub = s.need > 1 ? s.need + ' 处禁手' : s.puzzle.label + '禁手';
        say(s.need > 1
            ? s.need + ' 处禁手都找到了：' +
              s.answers.map((q, i) => pname(q) + '（' + kinds[i] + '）').join('、') +
              '。点「下一题」继续。'
            : pname(k) + ' 对了：黑棋落在这里是' + s.puzzle.label + '禁手。点「下一题」继续。', 'ok');
        celebrate(k, { stone: true, big: s.need > 1 });
        chime(s.need > 1);
    }

    flash(title, sub, s.mode === 'shape' && s.need === 1 && s.puzzle.shape === 'five' ? 'five' : 'ok', k);
    const btn = $('jz-next');
    if (btn) { btn.classList.add('is-hot'); }
    try { if (navigator.vibrate) { navigator.vibrate(s.need > 1 ? [12, 40, 18] : 14); } } catch (e) { /* ignore */ }
}

/* 点错了：说清这一手到底做出了什么，别让人猜 */
function miss(k) {
    const s = state();
    cnt().tries++;
    s.streak = 0;
    stat();
    s.marks = s.marks.filter(m => m.kind !== 'bad' && m.kind !== 'hint');
    s.marks.push({ k: k, kind: 'bad' });

    const left = s.need - s.found.size;
    const tail = left > 1 ? '（还剩 ' + left + ' 处没找到）' : '';
    let why;

    if (s.mode === 'shape') {
        const ev = evaluate(s.board, k, BLACK);
        if (!ev) { why = '这一点走不了。'; }
        else if (ev.over) {
            why = '落下连成六子以上，这是长连，黑棋违例——题目要的是恰好五子连成一线。';
        } else if (ev.forbidden) {
            why = '这一手是禁手（三三或四四），黑棋不能走，得换个点。';
        } else {
            why = '落下是' + ev.name + '（' + ev.short + '），题目要的是' +
                s.puzzle.label + '（' + s.puzzle.tip.replace(/。$/, '') + '）。';
        }
    } else {
        const info = describePoint(s.board, k);
        if (!info || info.name === '没成型') { why = '这里什么也做不出来。'; }
        else if (info.fours === 1 && info.threes >= 1) { why = '这里是四三（一根线成四、一根线成活三），四三不违例。'; }
        else if (info.fours === 1 && info.threes === 0) { why = '这里只是一个冲四，不违例。'; }
        else if (info.threes === 1) { why = '这里只成一根活三，单三不违例。'; }
        else { why = '这里只是 ' + info.name + '，不违例。'; }
    }

    say(pname(k) + '：' + why + tail + ' 再找找。', 'bad');
    draw();
}

/* ---------- 提示 ---------- */
function showHint() {
    const s = state();
    if (s.busy || s.over || !s.puzzle) { return; }
    if (s.mode === 'shape') { hintShape(); return; }

    /* 禁手题的提示指一个「看着像、其实不是」的点，讲解为什么不算 */
    const skip = new Set(s.answers.concat(s.marks.map(m => m.k)));
    const cands = [];
    for (let k = 0; k < 225; k++) {
        if (s.board[k] || skip.has(k)) { continue; }
        const info = describePoint(s.board, k);
        if (!info) { continue; }
        if (info.fours >= 1 || info.threes >= 1) { cands.push({ k: k, info: info }); }
    }
    const left = s.need - s.found.size;
    if (!cands.length) {
        say('盘上没有别的成型点了，就那 ' + left + ' 处，慢慢看。', '');
        return;
    }
    const pickOne = cands[Math.floor(Math.random() * cands.length)];
    s.marks = s.marks.filter(m => m.kind !== 'hint' && m.kind !== 'bad');
    s.marks.push({ k: pickOne.k, kind: 'hint' });
    draw();
    say('提示：' + pname(pickOne.k) + ' 落下是' + pickOne.info.name +
        '，看着热闹，但不违例——盘上还有 ' + left + ' 处真禁手没找出来。', '');
}

/* 棋形题的提示直接挑一处还没找到的答案：要全找出来，指个「差一档」的点没意义 */
function hintShape() {
    const s = state();
    const rest = s.answers.filter(k => !s.found.has(k));
    if (!rest.length) { return; }
    const k = rest[0];
    s.marks = s.marks.filter(m => m.kind !== 'hint' && m.kind !== 'bad');
    s.marks.push({ k: k, kind: 'hint' });
    draw();
    say('提示：' + pname(k) + ' 落下去就是' + s.puzzle.label + '。' +
        (rest.length > 1 ? '另外还有 ' + (rest.length - 1) + ' 处。' : ''), '');
}

/* ---------- 看答案 / 重来 ---------- */
function reveal() {
    const s = state();
    if (s.busy || s.over || !s.puzzle) { return; }
    clearFlash();
    s.over = true;
    s.marks = s.marks.filter(m => m.kind !== 'bad' && m.kind !== 'hint');

    const rest = s.answers.filter(k => !s.found.has(k));
    rest.forEach(function (k) { s.marks.push({ k: k, kind: 'ans' }); });
    const all = s.answers.map(pname).join('、');

    if (s.mode === 'shape') {
        say('这盘能做出' + s.puzzle.label + '的有 ' + s.need + ' 处：' + all +
            '（红圈是还没找到的）。点「下一题」换一盘。', 'bad');
    } else {
        say((s.need > 1 ? s.need + ' 处禁手在：' : '答案在 ') + all +
            (s.need > 1 ? '' : '，' + s.puzzle.label + '禁手') + '。点「下一题」换一盘。', 'bad');
    }
    stat();
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
    s.found = new Set();
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
