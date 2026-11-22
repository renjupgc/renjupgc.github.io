/*
 * 连珠杂箱 · 3D 对局 — 人机对弈的机器人
 * ------------------------------------------------------------
 * 无禁手五子棋的落点选择。规则与站里的对局一致（黑先、连五即胜、
 * 没有禁手），所以不套用 Rapfi 的连珠规则，而是用棋型评估自己算：
 * 对一个空点，分别假设我和对方落子，按四个方向数连续子与两端开放，
 * 进攻分 + 防守分（略偏防守）取最高。
 *
 * 只暴露 window.DJ_BOT.choose(board, color) -> {x, y}
 *   board: 长度 225 的 Uint8Array，索引 y*15+x，0 空 / 1 黑 / 2 白
 *   color: 机器人执子（1 黑 / 2 白）
 */
(function () {
    'use strict';

    var N = 15;
    var DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

    function inBoard(x, y) {
        return x >= 0 && x < N && y >= 0 && y < N;
    }

    /* 一端是不是还能往外接子：界内且空才算活口，边界算堵死 */
    function openEnd(board, x, y) {
        return inBoard(x, y) && board[y * N + x] === 0;
    }

    /* 假设 (x,y) 落了 color，算这一个方向的棋型分 */
    function dirScore(board, x, y, dx, dy, color) {
        var neg = 0, pos = 0, i, nx, ny;

        for (i = 1; i < N; i++) {
            nx = x - dx * i; ny = y - dy * i;
            if (!inBoard(nx, ny) || board[ny * N + nx] !== color) { break; }
            neg++;
        }
        for (i = 1; i < N; i++) {
            nx = x + dx * i; ny = y + dy * i;
            if (!inBoard(nx, ny) || board[ny * N + nx] !== color) { break; }
            pos++;
        }

        var total = neg + 1 + pos;
        var openNeg = openEnd(board, x - dx * (neg + 1), y - dy * (neg + 1));
        var openPos = openEnd(board, x + dx * (pos + 1), y + dy * (pos + 1));
        var both = openNeg && openPos;
        var one = openNeg || openPos;

        if (total >= 5) { return 10000000; }
        if (total === 4) { return both ? 500000 : (one ? 50000 : 0); }
        if (total === 3) { return both ? 30000 : (one ? 3000 : 0); }
        if (total === 2) { return both ? 2000 : (one ? 200 : 0); }
        return both ? 100 : 10;
    }

    /* 只看已有棋子附近两格，空旷处不用算；空盘直接下天元 */
    function nearStone(board, x, y) {
        for (var dy = -2; dy <= 2; dy++) {
            for (var dx = -2; dx <= 2; dx++) {
                if (!dx && !dy) { continue; }
                var nx = x + dx, ny = y + dy;
                if (inBoard(nx, ny) && board[ny * N + nx]) { return true; }
            }
        }
        return false;
    }

    function choose(board, color) {
        var stones = 0, i;
        for (i = 0; i < board.length; i++) {
            if (board[i]) { stones++; }
        }
        if (!stones) { return { x: 7, y: 7 }; }

        var opp = color === 1 ? 2 : 1;
        var best = null;
        var bestScore = -1;

        for (var y = 0; y < N; y++) {
            for (var x = 0; x < N; x++) {
                if (board[y * N + x] || !nearStone(board, x, y)) { continue; }

                var atk = 0, def = 0;
                for (var d = 0; d < DIRS.length; d++) {
                    atk += dirScore(board, x, y, DIRS[d][0], DIRS[d][1], color);
                    def += dirScore(board, x, y, DIRS[d][0], DIRS[d][1], opp);
                }

                var center = (7 - Math.abs(x - 7)) + (7 - Math.abs(y - 7));
                var score;

                /* 优先级分层，避免只会一比一跟着对手补：
                   1) 自己能连五 → 立刻走；2) 对手下一手能连五 → 必须挡；
                   3) 其余按棋型分，进攻略高于防守，中心作微小加成。 */
                if (atk >= 10000000) {
                    score = 100000000 + center;              // 成五，收
                } else if (def >= 10000000) {
                    score = 90000000 + center;               // 挡对方的五
                } else if (atk >= 500000 || def >= 500000) {
                    score = atk * 1.2 + def * 1.0 + center;  // 活四/冲四阶段偏进攻
                } else {
                    score = atk * 1.15 + def * 0.9 + center * 2;
                }

                if (score > bestScore) {
                    bestScore = score;
                    best = { x: x, y: y };
                }
            }
        }
        return best;
    }

    window.DJ_BOT = { choose: choose };
})();
