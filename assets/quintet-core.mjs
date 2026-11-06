/*
 * quintet 运行时封装
 * ------------------------------------------------------------
 * 搜索一律交给 @renju-note/quintet（Rust + WebAssembly，完整连珠规则：
 * 黑方三三 / 四四 / 长连禁手，含真假活三递归判定）。这里只负责加载 wasm
 * 和把棋盘拆成 blacks / whites 两个点码数组。
 *
 * 点码约定（已用 encode_xy / decode_x / decode_y 实测核对）：
 *   code = x * 15 + y，x = 列 0..14，y = 行 0..14，decode 与之互逆。
 *
 * 求解不设手数上限：LIMIT = 225（攻方一手最多占一个点，等价于无穷）。
 */

import * as bg from './quintet/quintet_bg.js';

export const N = 15;
export const EMPTY = 0, BLACK = 1, WHITE = 2;
export const LIMIT = 225;

export const ix = (x, y) => x * 15 + y;
export const px = k => (k / 15) | 0;
export const py = k => k % 15;
export const pname = k => String.fromCharCode(97 + px(k)) + (py(k) + 1);

let bootPaint = null;

export function init() {
    if (bootPaint) { return bootPaint; }
    bootPaint = (async () => {
        const url = new URL('./quintet/quintet_bg.wasm', import.meta.url);
        let bytes;
        if (url.protocol === 'file:') {
            const fs = await import('node:fs/promises');   /* 仅 Node 校验脚本走这里 */
            bytes = await fs.readFile(url);
        } else {
            const res = await fetch(url);
            if (!res.ok) { throw new Error('quintet wasm 加载失败：' + res.status); }
            bytes = await res.arrayBuffer();
        }
        const { instance } = await WebAssembly.instantiate(bytes, {
            './quintet_bg.js': { __wbindgen_init_externref_table: bg.__wbindgen_init_externref_table }
        });
        bg.__wbg_set_wasm(instance.exports);
        instance.exports.__wbindgen_start();
        return true;
    })();
    return bootPaint;
}

/*
 * 两段式求最短手数：
 *   1) limit = 225 满深度搜一次，拿到任意一条杀法；
 *   2) 有解则 depth = ceil(len / 2)，再对 1..depth-1 迭代加深，第一个有解的即最短；
 *      这一段意外无解（不该发生）就退回第 1 步那条。
 * 无解直接返回 { path: null }，不做任何重试。
 */
export function solveArr(black, white, attacker, mode) {
    const fn = mode === 'vct' ? bg.solve_vct_dfpn : bg.solve_vcf;
    const bl = Uint8Array.from(black), wh = Uint8Array.from(white);
    const isBlack = attacker === BLACK;
    const t0 = performance.now();
    const p = fn(bl, wh, isBlack, LIMIT);
    if (!p || p.length === 0) { return { path: null, depth: 0, ms: performance.now() - t0 }; }
    let path = Array.from(p);
    let depth = Math.ceil(path.length / 2);
    for (let d = 1; d < depth; d++) {
        const p2 = fn(bl, wh, isBlack, d);
        if (p2 && p2.length) {
            path = Array.from(p2);
            depth = Math.ceil(path.length / 2);
            break;
        }
    }
    return { path, depth, ms: performance.now() - t0 };
}

export function solveBoard(bd, attacker, mode) {
    const black = [], white = [];
    for (let k = 0; k < 225; k++) {
        if (bd[k] === BLACK) { black.push(k); }
        else if (bd[k] === WHITE) { white.push(k); }
    }
    return solveArr(black, white, attacker, mode);
}

/* 对拍 / 自检用：把 enum 出的原始导出透出去 */
export const wasm = bg;
