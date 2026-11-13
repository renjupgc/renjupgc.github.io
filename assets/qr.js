/*
 * 二维码（QR Code）编码器
 * ------------------------------------------------------------
 * 只做「一串短网址 → 一张点阵」，够成绩卡用就行：
 *
 * - 字节模式，UTF-8；纠错等级 M（15% 容错，卡片印小了也扫得出来）；
 * - 版本 1〜10 自动选（最多 213 字节），再长就不生成；
 * - 八种掩模逐个算罚分，取最低的那个，与主流库一致；
 * - 不依赖任何外部库，也不发网络请求。
 *
 * 用法：
 *   var m = ZBXQR.matrix('https://example.com/');
 *   m.size    // 边长（模块数）
 *   m.get(x, y) // 该点是否涂黑
 *
 * 实现按 ISO/IEC 18004 走，表格只有版本 1〜10 —— 卡片上的网址不会更长。
 */
(function (global) {
    'use strict';

    /* 每个版本：总码字数、每块纠错码字数、块数 —— 纠错等级 M */
    var VERSIONS = [
        /* v, total, ecPerBlock, blocks */
        [1, 26, 10, 1],
        [2, 44, 16, 1],
        [3, 70, 26, 1],
        [4, 100, 18, 2],
        [5, 134, 24, 2],
        [6, 172, 16, 4],
        [7, 196, 18, 4],
        [8, 242, 22, 4],
        [9, 292, 22, 5],
        [10, 346, 26, 5]
    ];

    /* 对齐图形中心（版本 1 没有） */
    var ALIGN = {
        1: [],
        2: [6, 18],
        3: [6, 22],
        4: [6, 26],
        5: [6, 30],
        6: [6, 34],
        7: [6, 22, 38],
        8: [6, 24, 42],
        9: [6, 26, 46],
        10: [6, 28, 50]
    };

    var ECC_M = 0;   /* 格式信息里的纠错位：L=01, M=00, Q=11, H=10 */

    /* ---------- GF(256) ---------- */

    var EXP = new Uint8Array(512);
    var LOG = new Uint8Array(256);
    (function () {
        var x = 1;
        for (var i = 0; i < 255; i++) {
            EXP[i] = x;
            LOG[x] = i;
            x <<= 1;
            if (x & 0x100) { x ^= 0x11d; }
        }
        for (var j = 255; j < 512; j++) { EXP[j] = EXP[j - 255]; }
    })();

    function mul(a, b) {
        if (!a || !b) { return 0; }
        return EXP[LOG[a] + LOG[b]];
    }

    function rsGenerator(n) {
        var poly = [1];
        for (var i = 0; i < n; i++) {
            var next = new Array(poly.length + 1).fill(0);
            for (var j = 0; j < poly.length; j++) {
                next[j] ^= mul(poly[j], 1);                 /* x */
                next[j + 1] ^= mul(poly[j], EXP[i]);        /* α^i */
            }
            poly = next;
        }
        return poly;
    }

    function rsRemainder(data, ecLen) {
        var gen = rsGenerator(ecLen);
        var rem = new Array(data.length + ecLen).fill(0);
        for (var i = 0; i < data.length; i++) { rem[i] = data[i]; }
        for (var k = 0; k < data.length; k++) {
            var factor = rem[k];
            if (!factor) { continue; }
            for (var j = 0; j < gen.length; j++) {
                rem[k + j] ^= mul(gen[j], factor);
            }
        }
        return rem.slice(data.length);
    }

    /* ---------- 位流 ---------- */

    function utf8(text) {
        if (global.TextEncoder) {
            return Array.prototype.slice.call(new global.TextEncoder().encode(text));
        }
        var out = [];
        for (var i = 0; i < text.length; i++) {
            var c = text.charCodeAt(i);
            if (c < 0x80) {
                out.push(c);
            } else if (c < 0x800) {
                out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
            } else {
                out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
            }
        }
        return out;
    }

    function pickVersion(byteLen) {
        for (var i = 0; i < VERSIONS.length; i++) {
            var v = VERSIONS[i];
            var dataWords = v[1] - v[2] * v[3];
            var headerBits = 4 + (v[0] < 10 ? 8 : 16);
            if (dataWords * 8 - headerBits >= byteLen * 8) {
                return v;
            }
        }
        return null;
    }

    function buildCodewords(bytes, v) {
        var version = v[0];
        var dataWords = v[1] - v[2] * v[3];
        var blocks = v[3];
        var ecLen = v[2];

        var bits = [];
        function push(val, len) {
            for (var i = len - 1; i >= 0; i--) { bits.push((val >> i) & 1); }
        }
        push(4, 4);                                  /* 字节模式 */
        push(bytes.length, version < 10 ? 8 : 16);
        for (var i = 0; i < bytes.length; i++) { push(bytes[i], 8); }

        /* 结束符与按字节补齐 */
        var cap = dataWords * 8;
        for (var t = 0; t < 4 && bits.length < cap; t++) { bits.push(0); }
        while (bits.length % 8) { bits.push(0); }

        var words = [];
        for (var b = 0; b < bits.length; b += 8) {
            var w = 0;
            for (var k = 0; k < 8; k++) { w = (w << 1) | bits[b + k]; }
            words.push(w);
        }
        /* 补位：0xEC / 0x11 轮着来 */
        var pad = [0xec, 0x11];
        var p = 0;
        while (words.length < dataWords) {
            words.push(pad[p++ % 2]);
        }

        /* 分块。长短块差一字节：短的在前，长的在后 */
        var shortLen = Math.floor(dataWords / blocks);
        var longCount = dataWords % blocks;
        var dataBlocks = [];
        var ecBlocks = [];
        var at = 0;
        for (var i2 = 0; i2 < blocks; i2++) {
            var len = shortLen + (i2 >= blocks - longCount ? 1 : 0);
            var chunk = words.slice(at, at + len);
            at += len;
            dataBlocks.push(chunk);
            ecBlocks.push(rsRemainder(chunk, ecLen));
        }

        /* 交错 */
        var out = [];
        var maxLen = shortLen + (longCount ? 1 : 0);
        for (var c = 0; c < maxLen; c++) {
            for (var bi = 0; bi < blocks; bi++) {
                if (c < dataBlocks[bi].length) { out.push(dataBlocks[bi][c]); }
            }
        }
        for (var e = 0; e < ecLen; e++) {
            for (var bj = 0; bj < blocks; bj++) {
                out.push(ecBlocks[bj][e]);
            }
        }
        return out;
    }

    /* ---------- 画矩阵 ---------- */

    /* 格式化信息：BCH(15,5)，再异或掩码 0x5412 */
    function formatBits(ecc, mask) {
        var data = (ecc << 3) | mask;
        var rem = data << 10;
        for (var i = 4; i >= 0; i--) {
            if (rem & (1 << (i + 10))) {
                rem ^= 0x537 << i;
            }
        }
        return ((data << 10) | rem) ^ 0x5412;
    }

    /* 版本信息（版本 7 起）：BCH(18,6)，生成多项式 0x1f25 */
    function versionBits(version) {
        var rem = version << 12;
        for (var i = 5; i >= 0; i--) {
            if (rem & (1 << (i + 12))) {
                rem ^= 0x1f25 << i;
            }
        }
        return (version << 12) | rem;
    }

    function Grid(size) {
        this.size = size;
        this.m = new Array(size * size).fill(null);   /* null=空，0/1=模块 */
    }
    Grid.prototype.get = function (x, y) { return this.m[y * this.size + x]; };
    Grid.prototype.set = function (x, y, v) {
        if (x < 0 || y < 0 || x >= this.size || y >= this.size) { return; }
        this.m[y * this.size + x] = v ? 1 : 0;
    };
    Grid.prototype.free = function (x, y) {
        return x >= 0 && y >= 0 && x < this.size && y < this.size &&
            this.m[y * this.size + x] === null;
    };

    function placeFinder(g, x, y) {
        for (var dy = -1; dy <= 7; dy++) {
            for (var dx = -1; dx <= 7; dx++) {
                var xx = x + dx, yy = y + dy;
                if (xx < 0 || yy < 0 || xx >= g.size || yy >= g.size) { continue; }
                var on = (dx >= 0 && dx <= 6 && (dy === 0 || dy === 6)) ||
                    (dy >= 0 && dy <= 6 && (dx === 0 || dx === 6)) ||
                    (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4);
                g.set(xx, yy, on ? 1 : 0);
            }
        }
    }

    function placeFunctionPatterns(g, version) {
        var size = g.size;

        placeFinder(g, 0, 0);
        placeFinder(g, size - 7, 0);
        placeFinder(g, 0, size - 7);

        /* 定位线 */
        for (var i = 8; i < size - 8; i++) {
            g.set(i, 6, i % 2 === 0 ? 1 : 0);
            g.set(6, i, i % 2 === 0 ? 1 : 0);
        }

        /* 对齐图形 */
        var centers = ALIGN[version] || [];
        for (var a = 0; a < centers.length; a++) {
            for (var b = 0; b < centers.length; b++) {
                var cx = centers[a], cy = centers[b];
                if ((cx <= 8 && cy <= 8) || (cx >= size - 9 && cy <= 8) ||
                    (cx <= 8 && cy >= size - 9)) {
                    continue;
                }
                for (var dy = -2; dy <= 2; dy++) {
                    for (var dx = -2; dx <= 2; dx++) {
                        var on = Math.max(Math.abs(dx), Math.abs(dy)) !== 1;
                        g.set(cx + dx, cy + dy, on ? 1 : 0);
                    }
                }
            }
        }

        /* 固定黑点 */
        g.set(8, size - 8, 1);

        /* 预留格式信息区（先填 0，出掩模后再写） */
        for (var k = 0; k <= 8; k++) {
            if (g.get(k, 8) === null) { g.set(k, 8, 0); }
            if (g.get(8, k) === null) { g.set(8, k, 0); }
        }
        for (var k2 = 0; k2 < 8; k2++) {
            if (g.get(size - 1 - k2, 8) === null) { g.set(size - 1 - k2, 8, 0); }
            if (g.get(8, size - 1 - k2) === null) { g.set(8, size - 1 - k2, 0); }
        }

        /* 版本信息区（版本 7 起） */
        if (version >= 7) {
            for (var v = 0; v < 6; v++) {
                for (var w = 0; w < 3; w++) {
                    g.set(size - 11 + w, v, 0);
                    g.set(v, size - 11 + w, 0);
                }
            }
        }
    }

    function placeData(g, codewords) {
        var size = g.size;
        var bit = 0;
        var total = codewords.length * 8;
        var up = true;

        for (var right = size - 1; right > 0; right -= 2) {
            if (right === 6) { right = 5; }        /* 跳过定位线所在列 */
            for (var step = 0; step < size; step++) {
                var y = up ? size - 1 - step : step;
                for (var c = 0; c < 2; c++) {
                    var x = right - c;
                    if (!g.free(x, y)) { continue; }
                    var v = 0;
                    if (bit < total) {
                        v = (codewords[bit >> 3] >> (7 - (bit & 7))) & 1;
                        bit++;
                    }
                    g.set(x, y, v);
                }
            }
            up = !up;
        }
    }

    /* 掩模，下标与标准一致 */
    var MASKS = [
        function (x, y) { return (x + y) % 2 === 0; },
        function (x, y) { return y % 2 === 0; },
        function (x, y) { return x % 3 === 0; },
        function (x, y) { return (x + y) % 3 === 0; },
        function (x, y) { return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0; },
        function (x, y) { return ((x * y) % 2 + (x * y) % 3) === 0; },
        function (x, y) { return (((x * y) % 2 + (x * y) % 3) % 2) === 0; },
        function (x, y) { return (((x + y) % 2 + (x * y) % 3) % 2) === 0; }
    ];

    function isFunction(x, y, size, version) {
        if (x === 6 || y === 6) { return true; }
        if (x < 9 && y < 9) { return true; }
        if (x >= size - 8 && y < 9) { return true; }
        if (x < 9 && y >= size - 8) { return true; }
        /* 注意：第 8 行 / 第 8 列只有靠四角的那几格是格式信息，
           中段（9 到 size-9）是普通数据格，不能一并当成功能区 */
        if (version >= 7) {
            if (y < 6 && x >= size - 11 && x < size - 8) { return true; }
            if (x < 6 && y >= size - 11 && y < size - 8) { return true; }
        }
        var centers = ALIGN[version] || [];
        for (var a = 0; a < centers.length; a++) {
            for (var b = 0; b < centers.length; b++) {
                var cx = centers[a], cy = centers[b];
                if ((cx <= 8 && cy <= 8) || (cx >= size - 9 && cy <= 8) ||
                    (cx <= 8 && cy >= size - 9)) {
                    continue;
                }
                if (Math.abs(x - cx) <= 2 && Math.abs(y - cy) <= 2) { return true; }
            }
        }
        return false;
    }

    function penalty(g) {
        var size = g.size, score = 0, x, y;

        /* 规则 1：同色连排 */
        for (y = 0; y < size; y++) {
            var runRow = 1, runCol = 1;
            for (x = 1; x < size; x++) {
                runRow = (g.get(x, y) === g.get(x - 1, y)) ? runRow + 1 : 1;
                if (runRow === 5) { score += 3; } else if (runRow > 5) { score += 1; }
                runCol = (g.get(y, x) === g.get(y, x - 1)) ? runCol + 1 : 1;
                if (runCol === 5) { score += 3; } else if (runCol > 5) { score += 1; }
            }
        }

        /* 规则 2：2×2 同色 */
        for (y = 0; y < size - 1; y++) {
            for (x = 0; x < size - 1; x++) {
                var v = g.get(x, y);
                if (v === g.get(x + 1, y) && v === g.get(x, y + 1) && v === g.get(x + 1, y + 1)) {
                    score += 3;
                }
            }
        }

        /* 规则 3：类似定位图形的 1:1:3:1:1 组合 */
        var pat = [1, 0, 1, 1, 1, 0, 1];
        function hit(get, i) {
            for (var k = 0; k < 7; k++) {
                if (get(i + k) !== pat[k]) { return false; }
            }
            var before = true, after = true;
            for (var b = 1; b <= 4; b++) {
                if (i - b >= 0 && get(i - b) === 1) { before = false; }
                if (i + 6 + b < size && get(i + 6 + b) === 1) { after = false; }
            }
            return before && after;
        }
        for (y = 0; y < size; y++) {
            for (x = 0; x < size - 6; x++) {
                if (hit(function (i) { return g.get(i, y); }, x)) { score += 40; }
                if (hit(function (i) { return g.get(y, i); }, x)) { score += 40; }
            }
        }

        /* 规则 4：黑白比例偏离 50% */
        var dark = 0;
        for (y = 0; y < size * size; y++) { dark += g.m[y] ? 1 : 0; }
        var pct = dark * 100 / (size * size);
        score += Math.floor(Math.abs(pct - 50) / 5) * 10;

        return score;
    }

    function writeFormat(g, mask) {
        var size = g.size;
        var bits = formatBits(ECC_M, mask);

        /* 左上角那一份，以及拆分到右上、左下的一份 */
        for (var i = 0; i < 15; i++) {
            var bit = (bits >> i) & 1;
            if (i < 6) {
                g.set(8, i, bit);
            } else if (i < 8) {
                g.set(8, i + 1, bit);
            } else if (i === 8) {
                g.set(7, 8, bit);
            } else {
                g.set(14 - i, 8, bit);
            }
        }
        for (var j = 0; j < 15; j++) {
            var b2 = (bits >> j) & 1;
            if (j < 8) {
                g.set(size - 1 - j, 8, b2);
            } else {
                g.set(8, size - 15 + j, b2);
            }
        }
        g.set(8, size - 8, 1);          /* 固定黑点盖回来 */
    }

    function writeVersion(g, version) {
        if (version < 7) { return; }
        var size = g.size;
        var bits = versionBits(version);
        for (var i = 0; i < 18; i++) {
            var bit = (bits >> i) & 1;
            var a = size - 11 + (i % 3);
            var b = Math.floor(i / 3);
            g.set(a, b, bit);
            g.set(b, a, bit);
        }
    }

    function matrix(text, forceMask) {
        var bytes = utf8(String(text));
        var v = pickVersion(bytes.length);
        if (!v) {
            return null;
        }
        var version = v[0];
        var size = 17 + 4 * version;
        var codewords = buildCodewords(bytes, v);

        var best = null;
        var bestScore = Infinity;
        for (var mask = 0; mask < 8; mask++) {
            if (forceMask !== undefined && mask !== forceMask) { continue; }
            var g = new Grid(size);
            placeFunctionPatterns(g, version);
            placeData(g, codewords);

            /* 掩模只作用在数据模块上 */
            var masked = new Grid(size);
            masked.m = g.m.slice();
            for (var y = 0; y < size; y++) {
                for (var x = 0; x < size; x++) {
                    if (isFunction(x, y, size, version)) { continue; }
                    if (MASKS[mask](x, y)) {
                        masked.set(x, y, masked.get(x, y) ? 0 : 1);
                    }
                }
            }
            writeFormat(masked, mask);
            writeVersion(masked, version);

            var sc = penalty(masked);
            if (sc < bestScore) {
                bestScore = sc;
                best = masked;
            }
        }

        return {
            size: size,
            version: version,
            mask: forceMask === undefined ? null : forceMask,
            modules: best.m,
            get: function (x, y) { return best.get(x, y) ? 1 : 0; }
        };
    }

    global.ZBXQR = { matrix: matrix, penalty: penalty };
})(typeof window !== 'undefined' ? window : this);
