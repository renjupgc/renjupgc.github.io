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
let clockId = 0;

const $ = id => document.getElementById(id);

/* ---------- 进度档案 ---------- */
function prog() { return window.ZBX_PROGRESS || null; }
/* 难度分：以取胜手数为主，再算落子数、攻方颜色、生成尝试次数，
 * 同档题也按局面拉开。满分时间线仍只看手数，保证 4 手胜 10 秒内满分。 */
function difficulty(depth, puzzle) {
    const p = prog();
    if (p && p.vcfDifficulty) { return p.vcfDifficulty(depth, puzzle || state().puzzle); }
    return p ? p.diffForDepth(depth) : 1000;
}
function parTime(depth) {
    const p = prog();
    return p ? p.parForDepth(depth) : 10000;
}

/* ---------- 计时 ----------
 * 每题一个表：局面摆好起表，过关停表，换题 / 重来归零；切后台暂停。
 * tAcc 是之前几段累计的毫秒，tMark 是这一段开始走的时刻（0＝停着）。 */
function fmtTime(ms) {
    const t = Math.max(0, ms) / 1000;
    const m = Math.floor(t / 60);
    const sec = t - m * 60;
    return m + ':' + (sec < 10 ? '0' : '') + sec.toFixed(1);
}

const elapsed = s => s.tAcc + (s.tMark ? performance.now() - s.tMark : 0);

function paintTime() {
    const s = state();
    const num = $('vcf-time');
    if (!num) { return; }
    num.textContent = fmtTime(elapsed(s));
    const box = $('vcf-time-box');
    if (box) { box.classList.toggle('is-done', !!(s.puzzle && s.cleared)); }
    const k = $('vcf-time-k');
    if (k) { k.textContent = (s.puzzle && s.over) ? '用时' : '计时'; }
}

function clockRun() {
    window.clearInterval(clockId);
    clockId = window.setInterval(paintTime, 100);
}

function clockIdle() {
    window.clearInterval(clockId);
    clockId = 0;
    const s = state();
    s.tAcc = 0;
    s.tMark = 0;
    paintTime();
}

function clockStart() {
    clockIdle();
    if (!document.hidden) {
        const s = state();
        s.tMark = performance.now();
        clockRun();
    }
}

function clockPause() {
    const s = state();
    if (!s.tMark) { return; }
    s.tAcc += performance.now() - s.tMark;
    s.tMark = 0;
    window.clearInterval(clockId);
    clockId = 0;
    paintTime();
}

function clockResume() {
    const s = state();
    if (s.tMark || !s.puzzle || s.busy || s.over) { return; }
    s.tMark = performance.now();
    clockRun();
}

function clockStop() {
    clockPause();
    paintTime();
}

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
        tAcc: 0,
        tMark: 0,
        /* 习题挑战：5 题一组，按分数配难度，逐题变难 */
        chal: null,
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

/* 过关弹牌：和禁手找茬/棋形判定一致的那一套 */
let flashTimer = 0;
function flash(title, sub) {
    const el = $('vcf-flash');
    if (!el) { return; }
    el.innerHTML = '';
    const chip = document.createElement('div');
    chip.className = 'vcf-flash-chip';
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

let AC = null;
function chime() {
    try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) { return; }
        if (!AC) { AC = new Ctx(); }
        if (AC.state === 'suspended') { AC.resume(); }
        const notes = [523.25, 659.25, 783.99, 1046.5];
        const t0 = AC.currentTime;
        notes.forEach(function (f, i) {
            const o = AC.createOscillator(), g = AC.createGain();
            o.type = 'triangle';
            o.frequency.value = f;
            const a = t0 + i * 0.085;
            g.gain.setValueAtTime(0, a);
            g.gain.linearRampToValueAtTime(0.16, a + 0.015);
            g.gain.exponentialRampToValueAtTime(0.001, a + 0.42);
            o.connect(g); g.connect(AC.destination);
            o.start(a); o.stop(a + 0.45);
        });
    } catch (e) { /* ignore */ }
}

function stat() {
    const s = state();
    if ($('vcf-done')) { $('vcf-done').textContent = String(s.done); }
    if ($('vcf-tries')) { $('vcf-tries').textContent = String(s.tries); }
    if ($('vcf-level')) { $('vcf-level').textContent = s.level || '—'; }
    if ($('vcf-score')) { $('vcf-score').textContent = prog() && prog().ready() ? String(prog().score('vcf')) : '—'; }
    if ($('vcf-difficulty')) { $('vcf-difficulty').textContent = '难度分 ' + difficulty(s.depth || 3, s.puzzle); }
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

/* ---------- 习题挑战：5 题一组，按分数配难度，逐题变难 ---------- */
function updateChalTip(html) {
    const el = $('vcf-chal-tip');
    if (el) { el.innerHTML = html; }
}

function paintChallenge() {
    const s = state();
    const banner = $('vcf-chal-banner');
    if (banner) {
        banner.hidden = !s.chal;
        if (s.chal) {
            const ok = s.chal.results.filter(function (x) { return x.ok; }).length;
            banner.innerHTML = '<b>习题挑战</b> 第 ' + (s.chal.i + 1) + ' / ' + s.chal.total +
                ' 题 · 难度「' + LEVELS[s.chal.levels[s.chal.i]].name + '」' +
                ' · 已答对 ' + ok + ' 题';
        }
    }
    const sec = document.querySelector('.vcf');
    if (sec) { sec.classList.toggle('is-challenge', !!s.chal); }
}

function startChallenge() {
    const s = state();
    if (s.busy) { return; }
    const p = prog();
    if (!p || !p.ready()) {
        say('先在右侧填一个用户名，挑战的分数才记得住。', 'bad');
        return;
    }
    const base = p.recommendLevel('vcf');
    /* 五题：从推荐档起步，逐题升档，封顶在「挑战」 */
    const levels = [];
    for (let i = 0; i < 5; i++) { levels.push(Math.min(LEVELS.length - 1, base + Math.floor(i / 2))); }
    s.chal = { i: 0, total: 5, levels: levels, results: [] };
    const startBtn = $('vcf-chal-start');
    if (startBtn) { startBtn.disabled = true; }
    updateChalTip('习题挑战进行中 · <b>第 1/5 题</b>，从「' + LEVELS[levels[0]].name + '」起步，逐题加难。');
    paintChallenge();
    cancelGen();
    newPuzzle();
}

function endChallenge() {
    const s = state();
    const p = prog();
    const r = s.chal.results.filter(x => x.ok);
    const totalMs = r.reduce((a, x) => a + x.ms, 0);
    const avg = r.length ? Math.round(totalMs / r.length) : 0;
    const delta = s.chal.results.reduce((a, x) => a + x.delta, 0);
    const before = s.chal.score0;
    const after = p ? p.score('vcf') : before + delta;
    const secs = (avg / 1000).toFixed(1);
    updateChalTip('挑战完成：答对 <b>' + r.length + '/' + s.chal.total + '</b> 题 · 平均 ' +
        secs + ' 秒 · 分数 <b>' + before + ' → ' + after + '</b>（' +
        (delta >= 0 ? '+' : '') + delta + '）。记得导出存档。');
    const startBtn = $('vcf-chal-start');
    if (startBtn) { startBtn.disabled = false; startBtn.textContent = '再来一组 · 5 题'; }
    s.chal = null;
    paintChallenge();
    if (p) { p.saved(); }
}

function newPuzzle() {
    const s = state();
    if (s.busy) { return; }
    clockIdle();
    s.busy = true;
    s.over = false;
    s.cleared = false;
    s.hint = -1;
    const id = ++s.genId;

    let idx = $('vcf-diff') ? Number($('vcf-diff').value) : 1;
    if (s.chal) {
        idx = s.chal.levels[s.chal.i];
        if ($('vcf-diff')) { $('vcf-diff').value = String(idx); }
        if (s.chal.i === 0) { s.chal.score0 = prog() ? prog().score('vcf') : 1000; }
    }
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
    clockStart();
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
    clockStop();
    const ms = Math.round(s.tAcc);
    const secs = (ms / 1000).toFixed(1);
    /* 记分：做对加分，快（<=par）拿满；难题 par 宽 */
    let gain = null;
    const pr = prog();
    if (pr) { gain = pr.commit('vcf', { ok: true, ms: ms, diff: difficulty(s.depth, s.puzzle), par: parTime(s.depth) }); pr.changed(); }
    const d = gain ? (gain.delta >= 0 ? '+' : '') + gain.delta : '';
    stat();
    draw();
    flash('赢了！', (s.depth + ' 手胜 · ' + secs + ' 秒') + (d ? ' · ' + d + ' 分' : ''));
    chime();
    try { if (navigator.vibrate) { navigator.vibrate([12, 40, 18]); } } catch (e) { /* ignore */ }
    const btn = $('vcf-next');
    if (btn) { btn.classList.add('is-hot'); }

    if (s.chal) {
        s.chal.results.push({ ok: true, ms: ms, depth: s.depth, delta: gain ? gain.delta : 0 });
        paintChallenge();
        say(text + ' 第 ' + s.chal.results.length + '/' + s.chal.total + ' 题。' +
            (gain ? '分数 ' + d + '。' : '') + '点「下一题」继续。', 'ok');
    } else {
        say(text + (gain ? ' 用时 ' + secs + ' 秒，分数 ' + d + '（现 ' + gain.after + '）。' : '') +
            ' 点「下一题」继续，' + (pr && pr.ready() ? '分数已同步到云端。' : '先在右上角登录，分数才记得住。'), 'ok');
    }
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
    say('回到本题开局，表也从头开始走。', '');
    clockStart();
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
    paintTime();
    draw();

    if (!canvas.dataset.bound) {
        canvas.dataset.bound = '1';
        canvas.addEventListener('click', clickCell);
        document.addEventListener('zbx:user', function () { stat(); });
        /* 切到后台就停表：数的是做题的那段时间，不是开着页面的时间 */
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) { clockPause(); } else { clockResume(); }
        });
        const diff = $('vcf-diff');
        if (diff) {
            diff.addEventListener('change', function () {
                cancelGen();
                if (state().chal) {
                    state().chal = null;
                    const startBtn = $('vcf-chal-start');
                    if (startBtn) { startBtn.disabled = false; }
                    updateChalTip('按你的分数配难度，五题一组，越做越难；做完给平均用时和分数变化。');
                    paintChallenge();
                }
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
        bind('vcf-chal-start', startChallenge);
        bind('vcf-next', function () {
            const btn = $('vcf-next');
            if (btn) { btn.classList.remove('is-hot'); }
            const s = state();
            if (s.chal) {
                s.chal.i++;
                if (s.chal.i >= s.chal.total) { endChallenge(); return; }
                updateChalTip('习题挑战进行中 · <b>第 ' + (s.chal.i + 1) + '/' + s.chal.total +
                    ' 题</b>，难度「' + LEVELS[s.chal.levels[s.chal.i]].name + '」。');
                paintChallenge();
            }
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

    paintChallenge();
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
