/*
 * 禁手找茬 - 页面逻辑
 * ------------------------------------------------------------
 * 每道题由 jinzhao-gen.mjs 现场摆出来：盘上恰好有一个点，黑棋落下去就违例。
 * 用户点一个点，只判规则（成五 / 成四 / 成三 / 长连），不跑搜索，所以秒回。
 * 规则和 VCF 做题同源（vcf-gen 里的 blackForbidden），没有第二套判定。
 */

import { BLACK, px, py, pname } from './quintet-core.mjs';
import { generatePuzzle, describePoint, DENSITY } from './jinzhao-gen.mjs';

const N = 15;
const LEVELS = [
    { name: '入门', density: DENSITY.easy },
    { name: '常用', density: DENSITY.normal },
    { name: '密集', density: DENSITY.hard }
];
const DIR_NAME = ['横线', '竖线', '撇捺斜线', '捺撇斜线'];

let S = null;
let resized = false;

const $ = id => document.getElementById(id);

function state() {
    if (S) { return S; }
    S = {
        puzzle: null,
        board: new Int8Array(225),
        marks: [],          /* {k, kind:'bad'|'hint'|'ans'} */
        no: 0,
        done: 0,
        tries: 0,
        cleared: false,
        over: false,
        busy: false,
        genId: 0,
        level: '—',
        kind: '',
        ctx: null, cell: 0, pad: 0, size: 0
    };
    return S;
}

/* ---------- 画布 ---------- */
function layout(s) {
    const canvas = $('jz-board');
    if (!canvas) { return false; }
    const avail = Math.max(240, Math.min((canvas.parentNode.clientWidth || 560) - 4, 560));
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

function draw() {
    const s = state();
    if (!s.ctx) { return; }
    const ctx = s.ctx, cell = s.cell, size = s.size;

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

    for (let k = 0; k < 225; k++) {
        const v = s.board[k];
        if (!v) { continue; }
        const x = cx(s, px(k)), y = cy(s, py(k)), r = cell * 0.44;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.15, x, y, r);
        if (v === BLACK) {
            g.addColorStop(0, '#5f584c');
            g.addColorStop(1, '#15130f');
            ctx.fillStyle = g;
            ctx.fill();
        } else {
            g.addColorStop(0, '#ffffff');
            g.addColorStop(1, '#e3dbc9');
            ctx.fillStyle = g;
            ctx.fill();
            ctx.strokeStyle = 'rgba(120, 104, 78, 0.5)';
            ctx.lineWidth = 1;
            ctx.stroke();
        }
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
}

/* ---------- 文案 ---------- */
function say(text, kind) {
    const el = $('jz-msg');
    if (!el) { return; }
    el.textContent = text;
    el.className = 'jz-msg' + (kind ? ' is-' + kind : '');
}

function stat() {
    const s = state();
    if ($('jz-done')) { $('jz-done').textContent = String(s.done); }
    if ($('jz-tries')) { $('jz-tries').textContent = String(s.tries); }
    if ($('jz-kind')) { $('jz-kind').textContent = s.kind || '—'; }
}

/* ---------- 出题 ---------- */
function newPuzzle() {
    const s = state();
    s.busy = true;
    s.over = false;
    s.cleared = false;
    s.marks = [];
    const id = ++s.genId;

    const idx = $('jz-level') ? Number($('jz-level').value) : 1;
    const lv = LEVELS[idx] || LEVELS[1];
    const gen = generatePuzzle({ density: lv.density, timeoutMs: 2500 });
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
    s.over = false;
    s.cleared = false;
    s.level = levelName || '—';
    s.kind = p.label;
    if ($('jz-count')) {
        $('jz-count').textContent = '第 ' + s.no + ' 题 · 黑先';
    }
    stat();
    say('黑棋该走。盘上只有一个点落下就违例，点它。', '');
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
    probe(gx * 15 + (14 - gy));
}

function probe(k) {
    const s = state();
    if (!s.puzzle || s.board[k]) { return; }
    const info = describePoint(s.board, k);

    if (info && info.bad) {
        s.marks = s.marks.filter(m => m.kind !== 'bad' && m.kind !== 'hint');
        s.marks.push({ k: k, kind: 'ans' });
        /* 把构成禁手的那两条线牵出来的棋子圈一下 */
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

    s.tries++;
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
    if (!s.cleared) { s.cleared = true; s.done++; }
    stat();
    draw();
    const dirs = info.dirs.map(d => DIR_NAME[d]).join(' + ');
    say(pname(k) + ' 对了：黑棋落在这里是' + info.name + '禁手（' + dirs +
        '）。点「下一题」继续。', 'ok');
    const btn = $('jz-next');
    if (btn) { btn.classList.add('is-hot'); }
}

/* 提示：点一个「看着像、其实合法」的点，比直接给答案有用 */
function showHint() {
    const s = state();
    if (s.busy || s.over || !s.puzzle) { return; }
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

function reveal() {
    const s = state();
    if (s.busy || s.over || !s.puzzle) { return; }
    s.marks = s.marks.filter(m => m.kind !== 'bad' && m.kind !== 'hint');
    s.marks.push({ k: s.puzzle.answer, kind: 'ans' });
    s.over = true;
    say('答案在 ' + pname(s.puzzle.answer) + '，' + s.puzzle.label +
        '禁手。点「下一题」换一盘。', 'bad');
    draw();
}

function reset() {
    const s = state();
    if (s.busy || !s.puzzle) { return; }
    s.marks = [];
    s.over = false;
    s.board = Int8Array.from(s.puzzle.board);
    say('回到本题开局。', '');
    draw();
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
        const bind = function (id, fn) {
            const el = $(id);
            if (el) { el.addEventListener('click', fn); }
        };
        bind('jz-hint', showHint);
        bind('jz-reveal', reveal);
        bind('jz-reset', reset);
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
    newPuzzle();
}
