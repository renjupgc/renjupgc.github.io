/**
 * @param {number} code
 * @returns {number}
 */
export function decode_x(code) {
    const ret = wasm.decode_x(code);
    return ret;
}

/**
 * @param {number} code
 * @returns {number}
 */
export function decode_y(code) {
    const ret = wasm.decode_y(code);
    return ret;
}

/**
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
export function encode_xy(x, y) {
    const ret = wasm.encode_xy(x, y);
    return ret;
}

/**
 * @param {number} mode
 * @param {number} limit
 * @param {Uint8Array} blacks
 * @param {Uint8Array} whites
 * @param {boolean} black
 * @param {number} threat_limit
 * @returns {Uint8Array | undefined}
 */
export function solve(mode, limit, blacks, whites, black, threat_limit) {
    const ptr0 = passArray8ToWasm0(blacks, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(whites, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.solve(mode, limit, ptr0, len0, ptr1, len1, black, threat_limit);
    let v3;
    if (ret[0] !== 0) {
        v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v3;
}

/**
 * @param {Uint8Array} blacks
 * @param {Uint8Array} whites
 * @param {boolean} black
 * @param {number} limit
 * @returns {Uint8Array | undefined}
 */
export function solve_vcf(blacks, whites, black, limit) {
    const ptr0 = passArray8ToWasm0(blacks, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(whites, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.solve_vcf(ptr0, len0, ptr1, len1, black, limit);
    let v3;
    if (ret[0] !== 0) {
        v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v3;
}

/**
 * @param {Uint8Array} blacks
 * @param {Uint8Array} whites
 * @param {boolean} black
 * @param {number} limit
 * @returns {Uint8Array | undefined}
 */
export function solve_vct(blacks, whites, black, limit) {
    const ptr0 = passArray8ToWasm0(blacks, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(whites, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.solve_vct(ptr0, len0, ptr1, len1, black, limit);
    let v3;
    if (ret[0] !== 0) {
        v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v3;
}

/**
 * @param {Uint8Array} blacks
 * @param {Uint8Array} whites
 * @param {boolean} black
 * @param {number} limit
 * @returns {Uint8Array | undefined}
 */
export function solve_vct_dfpn(blacks, whites, black, limit) {
    const ptr0 = passArray8ToWasm0(blacks, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(whites, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.solve_vct_dfpn(ptr0, len0, ptr1, len1, black, limit);
    let v3;
    if (ret[0] !== 0) {
        v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v3;
}
/*
 * 原版这里是给 wasm 的 externref 表预热 undefined / null / true / false。
 * 那种写法要求模块声明两张表（funcref + externref），而部分设备的引擎
 * 只允许一张表，会直接报 “table count of 2 exceeds internal limit of 1”。
 * quintet 的导出全是数字与 TypedArray，没有一处用到 externref，
 * 所以模块里的 externref 表已经摘掉，这里保持空实现即可。
 */
export function __wbindgen_init_externref_table() {}
function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

let WASM_VECTOR_LEN = 0;


let wasm;
export function __wbg_set_wasm(val) {
    wasm = val;
}
