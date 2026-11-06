/*
 * VCF 做题 - 页面逻辑
 * ------------------------------------------------------------
 * 题目由 vcf-gen.mjs 现场生成（安静自对弈铺局面 → 满深度验杀 → 成对剪枝 → 终审）。
 * 解题时每手只判规则（成五 / 冲四 / 双杀 / 挡点禁手），不跑搜索；
 * 走完一对再复算一次「这里还有没有杀」，没有就退回重走。
 */

import { init, solveBoard, BLACK, WHITE, px, py, pname } from './quintet-core.mjs';
import { generatePuzzle, makesFive, fivePoints, blackForbidden } from './vcf-gen.mjs';

const N = 15;

/* 难度档位：括号里是这一档要几手取胜（攻方手数） */
const LEVELS = [
    { name: '入门', min: 3, max: 4, timeout: 12000 },
    { name: '基础', min: 5, max: 6, timeout: 12000 },
    { name: '提高', min: 7, max: 8, timeout: 12000 },
    { name: '进阶', min: 9, max: 10, timeout: 25000 },
    { name: '挑战', min: 11, max: 13, timeout: 25000 }
];

let S = null;
let resized = false;

const $ = id => document.getElementById(id);

function state() {
    if (S) { return S; }
    S = {
        puzzle: null,      /* { moves, depth, attacker } */
        board: new Int8Array(225),
        attacker: BLACK,
        played: [],        /* 本次尝试按顺序落下的点，攻守交替 */
        hint: -1,
        no: 0,
        done: 0,
        tries: 0,
        cleared: false,
        busy: false,
        over: false,
        genId: 0,
        level: '',
        depth: 0,
        ctx: null, cell: 0, pad: 0, size: 0
    };
    return S;
}

function boardOf(moves) {
    const bd = new Int8Array(225);
    moves.forEach((k, i) => { bd[k] = i % 2 === 0 ? BLACK : WHITE; });
    return bd;
}

/* ---------- 画布 ---------- */
function layout(s) {
    const canvas = $('vcf-board');
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

    /* 坐标：列 a-o，底边为第 1 行 */
    ctx.fillStyle = 'rgba(110, 96, 74, 0.55)';
    ctx.font = Math.max(8, Math.round(cell * 0.33)) + 'px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < N; i++) {
        ctx.fillText(String.fromCharCode(97 + i), cx(s, i), s.pad * 0.46);
        ctx.fillText(String(i + 1), s.pad * 0.46, cy(s, i));
    }

    const last = s.played.length ? s.played[s.played.length - 1] : -1;

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

    if (s.hint >= 0) {
        ctx.beginPath();
        ctx.arc(cx(s, px(s.hint)), cy(s, py(s.hint)), cell * 0.52, 0, Math.PI * 2);
        ctx.strokeStyle = '#c08f2e';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    if (last >= 0) {
        ctx.beginPath();
        ctx.arc(cx(s, px(last)), cy(s, py(last)), Math.max(1.6, cell * 0.1), 0, Math.PI * 2);
        ctx.fillStyle = s.board[last] === BLACK ? 'rgba(246, 240, 226, 0.92)' : 'rgba(60, 50, 38, 0.72)';
        ctx.fill();
    }
}

/* ---------- 文案 ---------- */
function say(text, kind) {
    const el = $('vcf-msg');
    if (!el) { return; }
    el.textContent = text;
    el.className = 'vcf-msg' + (kind ? ' is-' + kind : '');
}

function stat() {
    const s = state();
    if ($('vcf-done')) { $('vcf-done').textContent = String(s.done); }
    if ($('vcf-tries')) { $('vcf-tries').textContent = String(s.tries); }
    if ($('vcf-level')) { $('vcf-level').textContent = s.level || '—'; }
}

function turnLabel() {
    const s = state();
    const el = $('vcf-turn');
    if (!el) { return; }
    const dot = el.querySelector('.vcf-dot');
    el.textContent = '';
    if (dot) {
        dot.classList.toggle('is-light', s.attacker !== BLACK);
        el.appendChild(dot);
    }
    el.appendChild(document.createTextNode(s.attacker === BLACK ? '黑先 · 你执黑' : '白先 · 你执白'));
}

/* ---------- 出题 ---------- */
function cancelGen() {
    const s = state();
    s.genId++;
    s.busy = false;
}

function newPuzzle() {
    const s = state();
    if (s.busy) { return; }
    s.busy = true;
    s.over = false;
    s.cleared = false;
    s.hint = -1;
    const id = ++s.genId;

    const idx = $('vcf-diff') ? Number($('vcf-diff').value) : 1;
    const lv = LEVELS[idx] || LEVELS[1];
    const gen = generatePuzzle({
        minMoves: lv.min,
        maxMoves: lv.max,
        attacker: 'random',
        timeoutMs: lv.timeout
    });

    say('正在摆一盘有杀的局面…', 'wait');
    if ($('vcf-count')) { $('vcf-count').textContent = ''; }

    /* 时间片：每 22ms 让出主线程，深档位也不会把页面卡死 */
    const step = () => {
        if (s.genId !== id) { return; }
        const canvas = $('vcf-board');
        if (!canvas) { s.busy = false; return; }
        const deadline = performance.now() + 22;
        for (;;) {
            const r = gen.next();
            if (r.done) {
                s.busy = false;
                if (r.value) { s.no++; load(r.value, lv.name); }
                else { say('这一档这次没摆出来，再点一次「下一题」。', 'bad'); }
                return;
            }
            if (performance.now() > deadline) {
                say('正在摆局面…第 ' + r.value.attempt + ' 次尝试，已用 ' +
                    (r.value.elapsed / 1000).toFixed(1) + ' 秒', 'wait');
                window.setTimeout(step, 0);
                return;
            }
        }
    };
    window.setTimeout(step, 0);
}

function load(p, levelName) {
    const s = state();
    s.puzzle = p;
    s.board = boardOf(p.moves);
    s.attacker = p.attacker;
    s.played = [];
    s.hint = -1;
    s.over = false;
    s.cleared = false;
    s.depth = p.depth;
    s.level = levelName || '—';

    if ($('vcf-count')) { $('vcf-count').textContent = '第 ' + s.no + ' 题 · ' + p.depth + ' 手胜'; }
    turnLabel();
    stat();
    say('轮到你走。每一手都要冲四，对方会跟着挡。', '');
    draw();
}

/* ---------- 走子 ---------- */
function rebuild(s) {
    s.board = boardOf(s.puzzle.moves);
    s.played.forEach(function (k, i) {
        s.board[k] = i % 2 === 0 ? s.attacker : 3 - s.attacker;
    });
    s.over = false;
    s.hint = -1;
}

function clickCell(ev) {
    const s = state();
    if (s.busy || s.over || !s.ctx) { return; }
    const canvas = $('vcf-board');
    const r = canvas.getBoundingClientRect();
    const mx = (ev.clientX - r.left) * (s.size / r.width);
    const my = (ev.clientY - r.top) * (s.size / r.height);
    const gx = Math.round((mx - s.pad) / s.cell);
    const gy = Math.round((my - s.pad) / s.cell);
    if (gx < 0 || gx > 14 || gy < 0 || gy > 14) { return; }
    if (Math.abs(mx - (s.pad + gx * s.cell)) > s.cell * 0.55) { return; }
    if (Math.abs(my - (s.pad + gy * s.cell)) > s.cell * 0.55) { return; }
    play(gx * 15 + (14 - gy));
}

function play(k) {
    const s = state();
    if (!s.puzzle || s.board[k]) { return; }
    const atk = s.attacker, def = 3 - atk;
    s.hint = -1;

    /* 禁手先判：blackForbidden 会临时落子再撤回，不能在落子之后调 */
    if (atk === BLACK && blackForbidden(s.board, k)) {
        s.tries++;
        stat();
        say(pname(k) + ' 是黑棋禁手（三三 / 四四 / 长连），不能走。', 'bad');
        draw();
        return;
    }

    s.board[k] = atk;
    if (makesFive(s.board, k, atk)) {
        s.played.push(k);
        finish('成五，赢了。');
        return;
    }

    const fp = fivePoints(s.board, atk);
    if (fp.length >= 2) {
        s.played.push(k);
        finish('双杀，对方堵不住，赢了。');
        return;
    }
    if (fp.length === 0) {
        s.board[k] = 0;
        s.tries++;
        stat();
        say(pname(k) + ' 不是冲四。每一手都要做出一个只有一个补五点的四。', 'bad');
        draw();
        return;
    }

    const block = fp[0];
    if (def === BLACK && blackForbidden(s.board, block)) {
        s.played.push(k);
        finish('白方唯一的挡点 ' + pname(block) + ' 是黑棋禁手，白胜。');
        return;
    }

    s.board[block] = def;
    const r = solveBoard(s.board, atk);
    if (!r.path) {
        s.board[k] = 0;
        s.board[block] = 0;
        s.tries++;
        stat();
        say(pname(k) + ' 之后对方挡在 ' + pname(block) + '，后面接不上杀，退回来重走。', 'bad');
        draw();
        return;
    }

    s.played.push(k, block);
    draw();
    say('对方挡 ' + pname(block) + '。继续。', '');
}

function finish(text) {
    const s = state();
    s.over = true;
    if (!s.cleared) {
        s.cleared = true;
        s.done++;
    }
    stat();
    draw();
    say(text + ' 点「下一题」继续。', 'ok');
    const btn = $('vcf-next');
    if (btn) { btn.classList.add('is-hot'); }
}

function undo() {
    const s = state();
    if (s.busy || !s.puzzle) { return; }
    if (!s.played.length) { return; }
    s.played.pop();
    if (s.played.length % 2 === 1) { s.played.pop(); }   /* 退回攻方该走的那一步 */
    rebuild(s);
    say('退回上一步。', '');
    draw();
}

function showHint() {
    const s = state();
    if (s.busy || s.over || !s.puzzle) { return; }
    const r = solveBoard(s.board, s.attacker);
    if (!r.path || !r.path.length) {
        say('这里查不到杀法了，点「重来」从头走一遍。', 'bad');
        return;
    }
    s.hint = r.path[0];
    say('提示：下一手在 ' + pname(r.path[0]) + '，这条线还剩 ' + r.depth + ' 手胜。', '');
    draw();
}

function reset() {
    const s = state();
    if (s.busy || !s.puzzle) { return; }
    s.played = [];
    rebuild(s);
    say('回到本题开局。', '');
    draw();
}

/* 调试用：Node 里跑交互测试时读内部状态 */
export const __debug = () => S;

/* ---------- 挂载 ---------- */
export async function boot() {
    const canvas = $('vcf-board');
    if (!canvas || canvas.dataset.booted === '1') { return; }
    const s = state();
    cancelGen();
    if (!layout(s)) { return; }
    canvas.dataset.booted = '1';

    s.hint = -1;
    s.played = s.played || [];
    draw();

    if (!canvas.dataset.bound) {
        canvas.dataset.bound = '1';
        canvas.addEventListener('click', clickCell);
        const diff = $('vcf-diff');
        if (diff) {
            diff.addEventListener('change', function () {
                cancelGen();
                newPuzzle();
            });
        }
        const bind = function (id, fn) {
            const el = $(id);
            if (el) { el.addEventListener('click', fn); }
        };
        bind('vcf-undo', undo);
        bind('vcf-hint', showHint);
        bind('vcf-reset', reset);
        bind('vcf-next', function () {
            const btn = $('vcf-next');
            if (btn) { btn.classList.remove('is-hot'); }
            newPuzzle();
        });
        if (!resized) {
            resized = true;
            window.addEventListener('resize', function () {
                const c = $('vcf-board');
                if (!c) { return; }
                layout(state());
                draw();
            });
        }
    }

    say('正在加载求解引擎…', 'wait');
    try {
        await init();
    } catch (err) {
        say('求解引擎加载失败：' + (err && err.message ? err.message : err), 'bad');
        return;
    }
    if ($('vcf-board') !== canvas) { return; }
    newPuzzle();
}
