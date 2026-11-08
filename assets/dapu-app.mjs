/*
 * 打谱页 - 图片转棋谱的界面
 * ------------------------------------------------------------
 * 只负责把图弄进来（选文件 / 拖进来 / 粘贴）、跑识别、把结果摆到上面的棋盘上，
 * 识别本身全在 qipu-scan.mjs 里。
 *
 * 识别出来的子按从上到下、从左到右的顺序摆上去，颜色各归各的，
 * 但手数顺序认不出来，所以摆完顺手把「序号」关掉——省得数字看不懂。
 * 认错的地方：少子就在空点点一下补，多子就双击那颗棋回退，再补。
 */

import { recognize, paintOverlay } from './qipu-scan.mjs';

const $ = id => document.getElementById(id);

function board() {
    const el = document.querySelector('.board[data-board]');
    return el && window.GomokuBoard ? window.GomokuBoard.get(el) : null;
}

function say(text, kind) {
    const el = $('scan-msg');
    if (!el) { return; }
    el.textContent = text;
    el.className = 'scan-msg' + (kind ? ' is-' + kind : '');
}

async function decode(file) {
    if (window.createImageBitmap) {
        try {
            return await window.createImageBitmap(file, { imageOrientation: 'from-image' });
        } catch (err) { /* Safari 老版本不认参数，退回老办法 */ }
    }
    const url = URL.createObjectURL(file);
    try {
        const img = new Image();
        img.decoding = 'async';
        await new Promise(function (ok, bad) {
            img.onload = ok;
            img.onerror = bad;
            img.src = url;
        });
        return img;
    } finally {
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }
}

function applyStones(res) {
    const b = board();
    if (!b) { return 0; }
    const list = res.stones.slice().sort(function (a, c) {
        return a.j - c.j || a.i - c.i;
    });
    b.setMoves(list.map(function (s) {
        return { i: s.i, j: s.j, color: s.color };
    }));
    b.setNumbers(false);          /* 手数顺序认不出来，数字留着只会误导 */
    return list.length;
}

async function handle(file) {
    if (!file || !/^image\//.test(file.type || '')) {
        say('这不是图片文件。', 'bad');
        return;
    }
    say('正在认这张图…', 'wait');
    const shot = $('scan-shot');
    const grid = $('scan-grid');
    if (shot) { shot.hidden = true; }
    if (grid) { grid.classList.add('is-empty'); }

    let img;
    try {
        img = await decode(file);
    } catch (err) {
        say('图片读不出来：' + (err && err.message ? err.message : err), 'bad');
        return;
    }

    /* 让「正在认」这一帧先画出来 */
    await new Promise(function (r) { window.setTimeout(r, 16); });

    let res;
    try {
        res = recognize(img);
    } catch (err) {
        say('识别出错：' + (err && err.message ? err.message : err), 'bad');
        return;
    }

    if (!res.ok) {
        say(res.why || '没认出来。换一张正向、周边不留太多空白的棋盘图再试。', 'bad');
        return;
    }
    if (!res.stones.length) {
        say('图上没找到棋子。换一张对比更清楚的图再试。', 'bad');
        return;
    }

    const n = applyStones(res);
    const canvas = $('scan-canvas');
    if (canvas && shot) {
        paintOverlay(canvas, res);
        shot.hidden = false;
        if (grid) { grid.classList.remove('is-empty'); }
    }

    const weak = res.strong < 10;
    say('识别到 ' + n + ' 子（黑 ' + res.black + ' / 白 ' + res.white + '），已经在上面摆好了。' +
        (weak ? '这张图的格线不太清楚，认得未必准，对着原图核一遍。' : '认错的地方，少子就在空点点一下补，多子就双击那颗棋回退。'),
        weak ? '' : 'ok');
}

export function boot() {
    const drop = $('scan-drop');
    const input = $('scan-file');
    if (!drop || !input || drop.dataset.booted === '1') { return; }
    drop.dataset.booted = '1';

    input.addEventListener('change', function () {
        const f = input.files && input.files[0];
        input.value = '';
        if (f) { handle(f); }
    });

    ['dragenter', 'dragover'].forEach(function (t) {
        drop.addEventListener(t, function (e) {
            e.preventDefault();
            drop.classList.add('is-over');
        });
    });
    ['dragleave', 'dragend'].forEach(function (t) {
        drop.addEventListener(t, function () { drop.classList.remove('is-over'); });
    });
    drop.addEventListener('drop', function (e) {
        e.preventDefault();
        drop.classList.remove('is-over');
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) { handle(f); }
    });

    /* 粘贴：只在打谱页上生效 */
    document.addEventListener('paste', function (e) {
        if (!document.getElementById('scan-drop')) { return; }
        const items = e.clipboardData && e.clipboardData.items;
        if (!items) { return; }
        for (let i = 0; i < items.length; i++) {
            if (items[i].type && /^image\//.test(items[i].type)) {
                const f = items[i].getAsFile();
                if (f) {
                    e.preventDefault();
                    handle(f);
                }
                return;
            }
        }
    });
}
