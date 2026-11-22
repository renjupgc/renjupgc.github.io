/*
 * 连珠杂箱 · 3D 对局
 * ------------------------------------------------------------
 * 一张桌子、两只棋盒、一台棋钟。进房间要报个号，两个人各坐一边，
 * 落子靠一只看得见的手，走完一手还得自己拍钟。
 *
 * 分工：
 *   table.js  场景与那只手
 *   net.js    房间与消息
 *   audio.js  声音
 *   本文件    规则、棋钟、界面、消息分发
 *
 * 规则按无禁手五子棋：黑先，横竖斜连成五个或更多即胜。
 */
(function () {
    'use strict';

    var N = 15;

    var WHITE = 2, BLACK = 1;

    var PRESETS = [
        { id: 'main30', label: '包干 30 分', mode: 'sudden', main: 1800000, inc: 0 },
        { id: 'main60', label: '包干 60 分', mode: 'sudden', main: 3600000, inc: 0 },
        { id: 'inc20', label: '20 分 + 5 秒', mode: 'increment', main: 1200000, inc: 5000 },
        { id: 'inc45', label: '45 分 + 30 秒', mode: 'increment', main: 2700000, inc: 30000 },
        { id: 'custom', label: '自定义', mode: 'sudden', main: 1800000, inc: 0 }
    ];

    var S = {
        id: '',
        name: '',
        want: 'any',
        preset: 'main30',
        conf: { mode: 'sudden', main: 1800000, inc: 0 },
        code: '',
        net: null,
        myColor: 0,          // 1 黑 2 白
        peerId: '',
        peerName: '',
        peerSeen: 0,
        phase: 'lobby',      // lobby | waiting | seated | over
        board: new Uint8Array(N * N),
        moves: [],
        turn: BLACK,
        clocks: { 1: 0, 2: 0 },
        running: 0,
        busy: false,
        pendingPress: false,      // 兼容旧字段；主逻辑用 awaitingPress
        awaitingPress: 0,         // 落子后待拍钟的一方（0/1/2）——棋钟一律由人按
        aiMode: false,            // 人机对弈（房间里的机器人座位）
        aiColor: 0,               // 机器人执子：1 黑 2 白
        aiThinking: false,
        aiTimer: 0,
        animFast: false,
        result: null,
        helloRetry: 0,
        pingAt: 0,
        lastPingFromPeer: 0,
        queue: []
    };

    var T = null;
    var el = {};
    var mounted = false;
    var resizeObserver = null;
    var lastClocks = { 1: '', 2: '' };
    var clockDigest = '';
    var rafLast = 0;
    var pendingRestore = null;
    var lastSessionSave = 0;
    var SESSION_KEY = 'zbx-dj-session-v2';

    function $(id) { return document.getElementById(id); }

    function pad2(n) { return (n < 10 ? '0' : '') + n; }

    function fmtClock(ms) {
        if (!S.conf.main) { return '∞'; }
        ms = Math.max(0, ms);
        var tenths = Math.floor(ms / 100);
        var m = Math.floor(tenths / 600);
        var s = (tenths % 600) / 10;
        return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
    }

    function fmtShort(ms) {
        if (!S.conf.main) { return '∞'; }
        ms = Math.max(0, ms);
        var t = Math.floor(ms / 1000);
        return Math.floor(t / 60) + ':' + pad2(t % 60);
    }

    function colorName(c) { return c === BLACK ? '黑' : '白'; }

    function other(c) { return c === BLACK ? WHITE : BLACK; }

    /* 刷新只保留当前标签页的身份和棋局；主动离开时立即清除。 */
    function readSession() {
        try {
            var data = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
            return data && data.code && data.id ? data : null;
        } catch (e) { return null; }
    }

    function clearSession() {
        pendingRestore = null;
        try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* noop */ }
    }

    function saveSession() {
        if (!S.code || !S.id) { return; }
        var data = {
            code: S.code, id: S.id, name: S.name, want: S.want, preset: S.preset,
            conf: S.conf, myColor: S.myColor, peerId: S.peerId, peerName: S.peerName,
            phase: S.phase, moves: S.moves, turn: S.turn, clocks: S.clocks,
            running: S.running, pendingPress: S.pendingPress, result: S.result,
            awaitingPress: S.awaitingPress, aiMode: S.aiMode, aiColor: S.aiColor,
            at: Date.now()
        };
        try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(data)); } catch (e) { /* noop */ }
    }

    function syncMessage(to) {
        return {
            t: 'sync', to: to, from: S.id, conf: S.conf,
            moves: S.moves, clocks: S.clocks, running: S.running,
            phase: S.phase, pendingFor: S.awaitingPress,
            aiMode: S.aiMode, aiColor: S.aiColor,
            result: S.result, at: Date.now()
        };
    }

    function restoreSnapshot(snap) {
        if (!snap || !snap.conf || !Array.isArray(snap.moves)) { return; }
        var conf = {
            mode: snap.conf.mode === 'increment' ? 'increment' : 'sudden',
            main: Math.max(0, Number(snap.conf.main) || 0),
            inc: Math.max(0, Number(snap.conf.inc) || 0)
        };
        resetGame(conf);
        var seen = new Uint8Array(N * N);
        for (var i = 0; i < snap.moves.length && i < N * N; i++) {
            var m = snap.moves[i];
            var x = Number(m.x), y = Number(m.y), c = Number(m.c);
            if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= N || y < 0 || y >= N || (c !== BLACK && c !== WHITE)) { continue; }
            var k = y * N + x;
            if (seen[k]) { continue; }
            seen[k] = 1;
            S.board[k] = c;
            S.moves.push({ x: x, y: y, c: c });
            T.addStone(x, y, c === BLACK ? 'black' : 'white');
        }
        S.turn = S.moves.length % 2 ? WHITE : BLACK;
        S.clocks[1] = Math.max(0, Number(snap.clocks && snap.clocks[1]) || 0);
        S.clocks[2] = Math.max(0, Number(snap.clocks && snap.clocks[2]) || 0);
        S.running = snap.running === BLACK || snap.running === WHITE ? snap.running : 0;
        S.phase = snap.phase === 'over' ? 'over' : 'seated';
        if (S.phase === 'seated' && S.running && conf.main > 0) {
            S.clocks[S.running] = Math.max(0, S.clocks[S.running] - Math.max(0, Date.now() - (Number(snap.at) || Date.now())));
        }
        S.aiMode = !!snap.aiMode;
        S.aiColor = snap.aiColor === BLACK || snap.aiColor === WHITE ? snap.aiColor : other(S.myColor);
        S.result = snap.result || null;
        /* 棋钟一律由人按：恢复后不设自动拍，落子待拍状态原样带回。 */
        S.awaitingPress = snap.pendingFor === BLACK || snap.pendingFor === WHITE ? snap.pendingFor : 0;
        S.pendingPress = S.awaitingPress === S.myColor;
        if (el.press && S.awaitingPress) { el.press.classList.add('is-pulse'); }
        var last = S.moves[S.moves.length - 1];
        if (last) { T.markLast(last); }
        el.hud.hidden = false;
        showOverlay(null);
        renderClocks(true);
        updateHintForTurn();
        if (S.phase === 'over' && S.result) {
            S.phase = 'seated';
            endGame(S.result.winner, S.result.reason, S.result.cells || null);
        } else {
            maybeAiTurn();
        }
        saveSession();
    }

    /* ---------- 界面小工具 ---------- */

    var toastTimer = 0;
    function toast(text) {
        el.toast.textContent = text;
        el.toast.classList.add('is-on');
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(function () {
            el.toast.classList.remove('is-on');
        }, 1500);
    }

    function hint(html) {
        el.hint.innerHTML = html;
    }

    function showOverlay(node) {
        [el.lobby, el.result, el.help].forEach(function (n) {
            if (n !== node) { n.hidden = true; }
        });
        if (node) { node.hidden = false; }
    }

    /* ---------- 规则 ---------- */

    function cellAt(x, y) { return S.board[y * N + x]; }

    var DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

    function findFive(x, y, c) {
        for (var d = 0; d < DIRS.length; d++) {
            var dx = DIRS[d][0], dy = DIRS[d][1];
            var cells = [{ x: x, y: y }];
            var i, nx, ny;

            for (i = 1; i < N; i++) {
                nx = x + dx * i; ny = y + dy * i;
                if (nx < 0 || nx >= N || ny < 0 || ny >= N) { break; }
                if (cellAt(nx, ny) !== c) { break; }
                cells.push({ x: nx, y: ny });
            }
            for (i = 1; i < N; i++) {
                nx = x - dx * i; ny = y - dy * i;
                if (nx < 0 || nx >= N || ny < 0 || ny >= N) { break; }
                if (cellAt(nx, ny) !== c) { break; }
                cells.push({ x: nx, y: ny });
            }
            if (cells.length >= 5) { return cells; }
        }
        return null;
    }

    /* ---------- 对局流程 ---------- */

    function resetGame(conf) {
        if (conf) { S.conf = conf; }
        S.board = new Uint8Array(N * N);
        S.moves = [];
        S.turn = BLACK;
        S.running = 0;
        S.busy = false;
        S.pendingPress = false;
        S.awaitingPress = 0;
        S.aiThinking = false;
        if (S.aiTimer) { window.clearTimeout(S.aiTimer); S.aiTimer = 0; }
        S.result = null;
        S.queue = [];
        S.clocks[1] = S.conf.main;
        S.clocks[2] = S.conf.main;
        lastClocks = { 1: '', 2: '' };
        clockDigest = '';
        if (T) {
            if (T.cancelAnimation) { T.cancelAnimation(); }
            if (S.myColor && T.refillBowls) { T.refillBowls(); }
            T.clearStones();
            T.setWin(null);
            T.markLast(null);
            T.setGhost(null);
        }
        renderClocks(true);
        if (el.press) { el.press.classList.remove('is-pulse'); }
        saveSession();
    }

    function beginSeated() {
        S.phase = 'seated';
        S.lastPingFromPeer = performance.now();
        showOverlay(null);
        el.hud.hidden = false;
        el.code.textContent = S.code;
        if (el.clockMeName) { el.clockMeName.textContent = '我 · ' + colorName(S.myColor); }
        if (el.clockPeerName) { el.clockPeerName.textContent = '对手 · ' + (S.peerName || '棋友'); }
        T.setSeat(S.myColor === BLACK ? 'black' : 'white');
        T.sit();
        T.setPeer(S.peerName, true);
        resetGame();
        S.running = BLACK;
        if (el.stage && el.stage.scrollIntoView) {
            try { el.stage.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* noop */ }
        }
        toast(S.aiMode ? '机器人已入座' : colorName(S.myColor) + '方落座');
        if (S.aiMode) {
            hint(S.myColor === BLACK
                ? '你执黑先行。点棋盘落子，走完自己拍钟。'
                : '你执白。机器人执黑先行，它落子后你替它拍钟。');
        } else {
            hint(S.myColor === BLACK
                ? '你执黑先行。点棋盘落子。'
                : '你执白。黑方先行，等他落子。');
        }
        DJ_AUDIO.tick();
        maybeAiTurn();
    }

    function commit(x, y, color) {
        S.board[y * N + x] = color;
        S.moves.push({ x: x, y: y, c: color });
        T.markLast({ x: x, y: y });
        S.turn = other(color);

        var win = findFive(x, y, color);
        if (win) {
            endGame(color, 'five', win);
            return;
        }
        if (S.moves.length >= N * N) {
            endGame(0, 'full', null);
            return;
        }
        updateHintForTurn();
        saveSession();
    }

    function updateHintForTurn() {
        if (S.phase !== 'seated') { return; }
        if (S.aiThinking) {
            hint('机器人正在想…');
            return;
        }
        if (S.awaitingPress) {
            if (S.aiMode && S.awaitingPress === S.aiColor) {
                hint('机器人落子了。<em>拍钟</em>把时间交给你。');
            } else {
                hint('这手已落下，<em>拍钟</em>把时间交给对方。');
            }
            return;
        }
        if (S.turn === S.myColor) {
            hint('轮到你走。从右手的棋盒里取子。');
        } else if (S.aiMode) {
            hint('轮到机器人走。');
        } else {
            hint('轮到 ' + (S.peerName || '对手') + '。');
        }
    }

    function endGame(winner, reason, cells) {
        if (S.phase === 'over') { return; }
        S.phase = 'over';
        S.result = { winner: winner, reason: reason, cells: cells || null };
        S.running = 0;
        S.busy = false;
        S.pendingPress = false;
        S.awaitingPress = 0;
        S.aiThinking = false;
        if (S.aiTimer) { window.clearTimeout(S.aiTimer); S.aiTimer = 0; }
        if (el.press) { el.press.classList.remove('is-pulse'); }
        if (cells) { T.setWin(cells); }
        T.setGhost(null);

        var iWon = winner === S.myColor;
        var verdict, detail;

        if (winner === 0) {
            verdict = '和棋';
            detail = '棋盘满了，谁也没连成五子。';
        } else if (reason === 'timeout') {
            verdict = iWon ? '你赢了' : '你输了';
            detail = (winner === S.myColor ? '对方' : '你') + '的棋钟先走完了。';
        } else if (reason === 'resign') {
            verdict = iWon ? '你赢了' : '你输了';
            detail = (winner === S.myColor ? '对方' : '你') + '认输。';
        } else if (reason === 'leave') {
            verdict = iWon ? '你赢了' : '你输了';
            detail = '对手离开了房间。';
        } else {
            verdict = iWon ? '你赢了' : '你输了';
            detail = colorName(winner) + '方连成五子。';
        }

        el.verdict.textContent = verdict;
        el.verdict.className = 'dj-verdict' + (winner && !iWon ? ' is-lose' : '');
        el.verdictDetail.textContent = detail;
        el.result.hidden = false;
        el.hud.hidden = false;

        if (winner && iWon) { DJ_AUDIO.win(); } else if (winner) { DJ_AUDIO.lose(); }
        saveSession();
    }

    /* ---------- 棋钟 ---------- */

    function renderClocks(force) {
        var me = S.myColor || BLACK;
        var peer = other(me);

        var dMe = fmtClock(S.clocks[me]);
        var dPeer = fmtClock(S.clocks[peer]);
        var key = dMe + '|' + dPeer + '|' + S.running;

        if (force || key !== clockDigest) {
            clockDigest = key;
            el.clockMeTime.textContent = dMe;
            el.clockPeerTime.textContent = dPeer;
            el.clockMe.classList.toggle('is-active', S.running === me);
            el.clockPeer.classList.toggle('is-active', S.running === peer);
            el.clockMe.classList.toggle('is-low', S.conf.main > 0 && S.clocks[me] < 20000);
            el.clockPeer.classList.toggle('is-low', S.conf.main > 0 && S.clocks[peer] < 20000);
        }

        /* 桌上的那块表，只画整秒，免得每帧重画贴图 */
        if (T) {
            T.setClockText('near', fmtShort(S.clocks[me]), S.conf.main > 0 && S.clocks[me] < 20000);
            T.setClockText('far', fmtShort(S.clocks[peer]), S.conf.main > 0 && S.clocks[peer] < 20000);
        }
    }

    function stepClocks(dt) {
        if (S.phase !== 'seated') { return; }
        if (S.conf.main > 0 && S.running) {
            S.clocks[S.running] -= dt * 1000;
            if (S.clocks[S.running] <= 0) {
                S.clocks[S.running] = 0;
                var loser = S.running;
                renderClocks(true);
                S.net.send({ t: 'timeout', c: loser, b: S.clocks[1], w: S.clocks[2] });
                endGame(other(loser), 'timeout', null);
                return;
            }
        }

        /* 棋钟一律由人按：没有自动拍钟，落子后计时留在这方，直到拍钟。 */
        renderClocks(false);
    }

    /*
     * 拍钟。color 是要拍停的那一方的钟，也总是当前 awaitingPress。
     * 真人模式：本地只按自己的钟，对手的钟由对方的 press 消息带来（remote）。
     * 人机模式：人既按自己的钟，也在机器人落子后替它按——钟不会自己跳。
     */
    function pressClock(color, remote) {
        if (S.phase !== 'seated') { return; }
        if (!remote) {
            if (!S.awaitingPress) {
                toast('先落子，再拍钟');
                DJ_AUDIO.nope();
                return;
            }
            /* 真人只拍自己那一手的钟；人机模式还要替机器人拍。 */
            var allowed = S.aiMode
                ? (S.awaitingPress === color && (color === S.myColor || color === S.aiColor))
                : (color === S.myColor && S.awaitingPress === S.myColor);
            if (!allowed) {
                toast(S.aiMode ? '还不到拍这块钟的时候' : '这手不是你走的，等对方拍钟');
                DJ_AUDIO.nope();
                return;
            }
            if (S.running !== color) {
                toast('现在不是这方的用时');
                DJ_AUDIO.nope();
                return;
            }
            /* 本地拍钟：加秒、发出去；远端的加秒在它自己那边已经算过了 */
            S.clocks[color] += S.conf.inc;
        }

        S.running = other(color);
        S.awaitingPress = 0;
        S.pendingPress = false;
        if (el.press) { el.press.classList.remove('is-pulse'); }

        T.bumpClock(color === S.myColor ? 'me' : 'peer');
        DJ_AUDIO.press();
        renderClocks(true);

        if (!remote) {
            /* 人机模式机器人是本地的，不必也没有对手可同步。 */
            if (!S.aiMode) { S.net.send({ t: 'press', c: color, b: S.clocks[1], w: S.clocks[2] }); }
            updateHintForTurn();
            maybeAiTurn();
        }
        saveSession();
    }

    /* ---------- 走子 ---------- */

    function myMove(x, y) {
        if (S.phase !== 'seated') { return; }
        if (S.busy) { return; }
        if (S.awaitingPress) { toast('先拍钟，再走下一手'); DJ_AUDIO.nope(); return; }
        if (S.turn !== S.myColor) { toast('还没轮到你'); return; }
        if (cellAt(x, y)) { toast('这里已经有子了'); return; }

        var color = S.myColor;
        S.busy = true;
        T.setGhost(null);

        T.playMove({
            side: 'me',
            x: x, y: y,
            color: color === BLACK ? 'black' : 'white',
            speed: S.animFast ? 2.3 : 1,
            onGrab: function () { DJ_AUDIO.rattle(); },
            onPlace: function () {
                DJ_AUDIO.stone();
                commit(x, y, color);
                if (!S.aiMode) {
                    S.net.send({
                        t: 'move', x: x, y: y, c: color, n: S.moves.length,
                        b: S.clocks[1], w: S.clocks[2]
                    });
                }
            },
            onDone: function () {
                S.busy = false;
                if (S.phase === 'seated') {
                    S.awaitingPress = color;
                    S.pendingPress = true;
                    if (el.press) { el.press.classList.add('is-pulse'); }
                    updateHintForTurn();
                    saveSession();
                }
                drainQueue();
            }
        });
    }

    function peerMove(m) {
        if (S.busy) { S.queue.push(m); return; }
        if (S.phase !== 'seated') { return; }
        if (cellAt(m.x, m.y)) { return; }

        S.busy = true;
        T.playMove({
            side: 'peer',
            x: m.x, y: m.y,
            color: m.c === BLACK ? 'black' : 'white',
            speed: S.animFast ? 2.3 : 1,
            onGrab: function () { DJ_AUDIO.rattle(); },
            onPlace: function () {
                DJ_AUDIO.stone();
                commit(m.x, m.y, m.c);
            },
            onDone: function () {
                S.busy = false;
                /* 真人模式：本地的 awaitingPress 只反映「我这一手待拍」，
                   不替对方维护，避免 move/press 消息乱序时把状态设回去卡住。
                   对方落子后的钟由对方自己拍，其 press 消息会把 running 切回来。 */
                updateHintForTurn();
                drainQueue();
            }
        });
    }

    function drainQueue() {
        if (S.busy || !S.queue.length) { return; }
        var m = S.queue.shift();
        peerMove(m);
    }

    /* ---------- 人机对弈 ---------- */

    /* 轮到机器人、且没有待拍的钟时，想一手并落子。落子后照旧等人拍钟。 */
    function maybeAiTurn() {
        if (!S.aiMode || S.phase !== 'seated') { return; }
        if (S.awaitingPress) { return; }         // 上一手还没拍钟，先等用户拍
        if (S.turn !== S.aiColor) { return; }    // 没轮到机器人
        if (S.aiThinking || S.busy) { return; }
        if (cellCount() >= N * N) { return; }

        S.aiThinking = true;
        updateHintForTurn();
        if (S.aiTimer) { window.clearTimeout(S.aiTimer); }
        /* 思考留一点停顿，像在真人座位上抬手 */
        S.aiTimer = window.setTimeout(function () {
            S.aiTimer = 0;
            if (!S.aiMode || S.phase !== 'seated' || S.turn !== S.aiColor) {
                S.aiThinking = false;
                return;
            }
            var pick = (window.DJ_BOT && window.DJ_BOT.choose)
                ? window.DJ_BOT.choose(S.board, S.aiColor)
                : fallbackPick();
            if (!pick || cellAt(pick.x, pick.y)) {
                pick = fallbackPick();
            }
            S.aiThinking = false;
            if (!pick) { return; }

            S.busy = true;
            T.setGhost(null);
            T.playMove({
                side: 'peer',
                x: pick.x, y: pick.y,
                color: S.aiColor === BLACK ? 'black' : 'white',
                speed: S.animFast ? 2.3 : 1,
                onGrab: function () { DJ_AUDIO.rattle(); },
                onPlace: function () {
                    DJ_AUDIO.stone();
                    commit(pick.x, pick.y, S.aiColor);
                },
                onDone: function () {
                    S.busy = false;
                    if (S.phase === 'seated') {
                        /* 机器人落子后，自己拍下对侧棋钟并交出行棋权。 */
                        S.awaitingPress = S.aiColor;
                        pressClock(S.aiColor, false);
                        updateHintForTurn();
                        saveSession();
                    }
                    drainQueue();
                }
            });
        }, 520);
    }

    /* 引擎没加载出来时的兜底：找天元附近第一个空点 */
    function fallbackPick() {
        var order = [];
        for (var y = 0; y < N; y++) {
            for (var x = 0; x < N; x++) {
                order.push({ x: x, y: y, d: Math.abs(x - 7) + Math.abs(y - 7) + Math.random() });
            }
        }
        order.sort(function (a, b) { return a.d - b.d; });
        for (var i = 0; i < order.length; i++) {
            if (!cellAt(order[i].x, order[i].y)) { return { x: order[i].x, y: order[i].y }; }
        }
        return null;
    }

    function cellCount() { return S.moves.length; }

    /* 从大厅直接开一局人机：跳过联机座位分配，自己坐一个颜色，机器人坐对面。 */
    function startAiGame() {
        DJ_AUDIO.unlock();
        var name = (el.nameInput.value || '').trim().slice(0, 12) || '棋友';
        S.name = name;
        S.code = (el.codeInput.value || '').toUpperCase().replace(/[^0-9A-Z]/g, '') || window.DJ_NET.newCode();
        S.want = el.seatBtns.filter(function (b) { return b.classList.contains('is-on'); })[0].dataset.want;

        var p = PRESETS.filter(function (x) { return x.id === S.preset; })[0] || PRESETS[0];
        S.conf = { mode: p.mode, main: p.main, inc: p.inc };
        if (S.preset === 'custom') {
            var minutes = Math.max(1, Math.min(180, Math.round(Number(el.mainMinutes.value) || 30)));
            var mode = selectedClockMode();
            var inc = mode === 'increment' ? Math.max(0, Math.min(60, Math.round(Number(el.incSeconds.value) || 0))) : 0;
            S.conf = { mode: mode, main: minutes * 60000, inc: inc * 1000 };
        }

        var myColor = S.want === 'white' ? WHITE : BLACK;   // 都行默认执黑
        S.myColor = myColor;
        S.aiColor = other(myColor);
        S.peerId = 'robot';
        S.peerName = '机器人';
        S.aiMode = true;
        S.aiThinking = false;
        S.helloRetry = 0;

        /* 不连实时频道：机器人就在本机这一侧 */
        if (S.net) { S.net.close(); S.net = null; }
        pendingRestore = null;
        beginSeated();
        saveSession();
    }

    /* ---------- 消息 ---------- */

    function send(msg) { if (S.net) { S.net.send(msg); } }

    function decideSeats(peerWant) {
        var mine = S.want;
        var theirs = peerWant || 'any';

        if (mine === 'any' && theirs === 'any') { return { me: BLACK, peer: WHITE }; }
        if (mine === 'any') { return { me: other(theirs === 'black' ? BLACK : WHITE), peer: theirs === 'black' ? BLACK : WHITE }; }
        /* 我先到，就按我的来 */
        var myColor = mine === 'black' ? BLACK : WHITE;
        return { me: myColor, peer: other(myColor) };
    }

    function onAssign(m) {
        if (S.myColor) { return; }          /* 已经坐下了，不重复处理 */
        if (m.black !== S.id && m.white !== S.id) {
            return;
        }
        S.myColor = m.black === S.id ? BLACK : WHITE;
        S.peerId = S.myColor === BLACK ? m.white : m.black;
        S.peerName = (m.names && m.names[S.myColor === BLACK ? m.white : m.black]) || '棋友';
        var conf = m.conf || S.conf;
        S.conf = {
            mode: conf.mode === 'increment' ? 'increment' : 'sudden',
            main: conf.main | 0,
            inc: conf.inc | 0
        };
        S.phase = 'seated';
        beginSeated();
        if (pendingRestore && pendingRestore.code === S.code) {
            restoreSnapshot(pendingRestore);
            pendingRestore = null;
            toast('已恢复刷新前的棋局');
        }
        saveSession();
    }

    function dispatch(m) {
        if (!m || !m.t) { return; }
        S.lastPingFromPeer = performance.now();

        switch (m.t) {
            case 'hello':
                if (m.id === S.id) { return; }
                if (S.myColor) {
                    if (m.id !== S.peerId) {
                        /* 两张椅子都有人了 */
                        send({ t: 'full', to: m.id });
                        return;
                    }
                    /* 对手的 hello 发丢了，把座位表再送一遍 */
                    var tbl = {};
                    tbl[S.id] = S.name;
                    tbl[m.id] = m.name;
                    send({
                        t: 'assign',
                        black: S.myColor === BLACK ? S.id : m.id,
                        white: S.myColor === WHITE ? S.id : m.id,
                        conf: S.conf,
                        names: tbl
                    });
                    /* 刷新回来的还是原来的座位，直接把完整棋局送过去。 */
                    send(syncMessage(m.id));
                    return;
                }
                /* 谁的号小谁是房主，避免两边同时安排座位 */
                if (S.id < m.id) {
                    var seats = decideSeats(m.want);
                    var names = {};
                    names[S.id] = S.name;
                    names[m.id] = m.name;
                    var msg = {
                        t: 'assign',
                        black: seats.me === BLACK ? S.id : m.id,
                        white: seats.me === BLACK ? m.id : S.id,
                        conf: { mode: S.conf.mode, main: S.conf.main, inc: S.conf.inc },
                        names: names
                    };
                    /* 广播收不到自己发的，房主也得照这份座位表坐下 */
                    send(msg);
                    onAssign(msg);
                }
                break;

            case 'assign':
                onAssign(m);
                break;

            case 'sync':
                if ((!m.to || m.to === S.id) && S.myColor && (!S.peerId || m.from === S.peerId)) {
                    restoreSnapshot(m);
                    toast('棋局与棋钟已同步');
                }
                break;

            case 'full':
                if (!S.myColor && (!m.to || m.to === S.id)) {
                    toast('这个房间已经坐满了');
                    leaveRoom(true);
                }
                break;

            case 'move':
                S.clocks[1] = m.b | 0;
                S.clocks[2] = m.w | 0;
                peerMove({ x: m.x, y: m.y, c: m.c });
                break;

            case 'press':
                S.clocks[1] = m.b | 0;
                S.clocks[2] = m.w | 0;
                pressClock(m.c, true);
                break;

            case 'resign':
                if (S.phase === 'seated') { endGame(other(m.c), 'resign', null); }
                break;

            case 'timeout':
                if (S.phase === 'seated') {
                    S.clocks[1] = m.b | 0;
                    S.clocks[2] = m.w | 0;
                    renderClocks(true);
                    endGame(other(m.c), 'timeout', null);
                }
                break;

            case 'again':
                if (S.phase === 'over' || S.phase === 'seated') {
                    resetGame();
                    if (S.phase === 'over') { S.phase = 'seated'; showOverlay(null); }
                    S.running = BLACK;
                    saveSession();
                    toast('新的一局');
                }
                break;

            case 'bye':
                if (!m.from || m.from === S.peerId) { peerLeft(); }
                break;

            case 'ping':
                break;
        }
    }

    function peerLeft() {
        if (S.phase === 'lobby') { return; }
        var wasPlaying = S.phase === 'seated';
        S.phase = 'waiting';
        S.running = 0;
        S.busy = false;
        S.queue = [];
        /* 释放座位，保留原执子偏好，房间才能接下一位棋友。 */
        if (S.myColor) { S.want = S.myColor === BLACK ? 'black' : 'white'; }
        S.myColor = 0;
        S.peerId = '';
        S.peerName = '';
        S.pendingPress = false;
        S.awaitingPress = 0;
        S.result = null;
        if (T) {
            T.setPeer(S.peerName, false);
            T.setWin(null);
            T.markLast(null);
            T.setGhost(null);
        }
        resetGame();
        el.hud.hidden = true;
        el.result.hidden = true;
        showLobbyWait(wasPlaying
            ? '对手离开了，这一局散了。房间还开着，等下一个棋友进来。'
            : '对手离开了。房间还开着。');
    }

    /* ---------- 大厅 ---------- */

    function showLobbyWait(text) {
        el.lobbyForm.hidden = true;
        el.lobbyWait.hidden = false;
        el.waitCode.textContent = S.code;
        el.waitNote.textContent = text || '房间已开好，把号子告诉棋友，等他进来。';
        el.lobby.hidden = false;
    }

    function joinRoom(resume) {
        var saved = resume ? readSession() : null;
        var name = saved ? saved.name : (el.nameInput.value || '').trim().slice(0, 12);
        var code = saved ? saved.code : (el.codeInput.value || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
        if (!name) { toast('先起个名字'); el.nameInput.focus(); return; }
        if (code.length < 4) { toast('房间号至少 4 位'); el.codeInput.focus(); return; }

        S.name = name;
        S.code = code;
        S.want = saved ? (saved.want || 'any') : el.seatBtns.filter(function (b) { return b.classList.contains('is-on'); })[0].dataset.want;
        S.preset = saved ? (saved.preset || 'custom') : el.presetBtns.filter(function (b) { return b.classList.contains('is-on'); })[0].dataset.preset;
        var p = PRESETS.filter(function (x) { return x.id === S.preset; })[0] || PRESETS[0];
        S.conf = saved
            ? { mode: saved.conf.mode === 'increment' ? 'increment' : 'sudden', main: saved.conf.main, inc: saved.conf.inc }
            : { mode: p.mode, main: p.main, inc: p.inc };
        if (!saved && S.preset === 'custom') {
            var minutes = Math.max(1, Math.min(180, Math.round(Number(el.mainMinutes.value) || 30)));
            var mode = selectedClockMode();
            var increment = mode === 'increment' ? Math.max(0, Math.min(60, Math.round(Number(el.incSeconds.value) || 0))) : 0;
            el.mainMinutes.value = minutes;
            el.incSeconds.value = increment;
            S.conf = { mode: mode, main: minutes * 60000, inc: increment * 1000 };
        }
        pendingRestore = saved;

        try {
            localStorage.setItem('zbx-dj-name', S.name);
            localStorage.setItem('zbx-dj-preset', S.preset);
            localStorage.setItem('zbx-dj-main', String(S.conf.main / 60000));
            localStorage.setItem('zbx-dj-inc', String(S.conf.inc / 1000));
            localStorage.setItem('zbx-dj-clock-mode', S.conf.mode);
        } catch (e) { /* 隐私模式忽略 */ }

        if (S.net) { S.net.close(); }
        S.myColor = 0;
        S.peerId = '';
        S.peerName = '';
        S.helloRetry = 0;

        showLobbyWait(saved ? '正在恢复原来的座位和棋局…' : '正在连上房间…');
        S.phase = 'waiting';
        hint('正在连上房间…');
        saveSession();

        S.net = window.DJ_NET.connect({
            code: S.code,
            id: S.id,
            name: S.name,
            onMessage: dispatch,
            onStatus: function (mode) {
                if (mode === 'online') {
                    el.waitNote.textContent = '房间已开好，把号子告诉棋友，等他进来。';
                    if (S.myColor) {
                        toast('连接已恢复，正在同步棋局');
                        send({ t: 'hello', id: S.id, name: S.name, want: S.want });
                    }
                } else if (mode === 'local') {
                    el.waitNote.textContent = '实时服务没连上，已切到本机模式：同一个浏览器开两个标签页，进同一个房间号可以对下。';
                } else if (mode === 'reconnecting') {
                    el.waitNote.textContent = '连接中断，正在自动重连；棋局已保留。';
                    if (S.myColor) { toast('网络波动，正在自动重连'); }
                } else if (mode === 'error') {
                    el.waitNote.textContent = '暂时无法连接，请检查网络后刷新，棋局会尝试恢复。';
                }
            }
        });

        /* hello 发几次，怕刚订阅上就发丢了 */
        var tries = 0;
        var timer = window.setInterval(function () {
            if (S.myColor || S.phase === 'lobby') { window.clearInterval(timer); return; }
            tries += 1;
            send({ t: 'hello', id: S.id, name: S.name, want: S.want });
            if (tries >= 5) { window.clearInterval(timer); }
        }, 1400);
        send({ t: 'hello', id: S.id, name: S.name, want: S.want });
    }

    function leaveRoom(quiet) {
        clearSession();
        if (!quiet) { send({ t: 'bye', from: S.id }); }
        if (S.net) { S.net.close(); S.net = null; }
        S.phase = 'lobby';
        S.myColor = 0;
        S.queue = [];
        el.hud.hidden = true;
        el.result.hidden = true;
        T.setPeer('等待棋友', false);
        T.stand();
        T.clearStones();
        T.setWin(null);
        T.markLast(null);
        el.lobbyForm.hidden = false;
        el.lobbyWait.hidden = true;
        showOverlay(el.lobby);
    }

    /* ---------- 交互 ---------- */

    var drag = null;
    var activePointers = {};
    var pinchDistance = 0;

    function bindPointer() {
        var c = el.canvas;
        function distance(a, b) {
            var dx = a.x - b.x, dy = a.y - b.y;
            return Math.sqrt(dx * dx + dy * dy);
        }

        c.addEventListener('pointerdown', function (e) {
            if (S.phase !== 'seated') { return; }
            DJ_AUDIO.unlock();
            activePointers[e.pointerId] = { x: e.clientX, y: e.clientY };
            try { c.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
            var keys = Object.keys(activePointers);
            if (keys.length === 1) {
                drag = { x: e.clientX, y: e.clientY, moved: 0, t: performance.now() };
            } else if (keys.length === 2) {
                var pts = keys.map(function (k) { return activePointers[k]; });
                pinchDistance = distance(pts[0], pts[1]);
                if (drag) { drag.moved = 999; }
                T.setGhost(null);
            }
        });

        c.addEventListener('pointermove', function (e) {
            if (S.phase !== 'seated') { return; }
            if (activePointers[e.pointerId]) {
                activePointers[e.pointerId].x = e.clientX;
                activePointers[e.pointerId].y = e.clientY;
            }
            var keys = Object.keys(activePointers);
            if (keys.length >= 2) {
                var pts = keys.slice(0, 2).map(function (k) { return activePointers[k]; });
                var nextDistance = distance(pts[0], pts[1]);
                if (pinchDistance > 0 && nextDistance > 0) { T.zoom(pinchDistance / nextDistance); }
                pinchDistance = nextDistance;
                if (drag) { drag.moved = 999; }
                T.setGhost(null);
                return;
            }
            if (drag && activePointers[e.pointerId]) {
                var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
                drag.moved += Math.abs(dx) + Math.abs(dy);
                drag.x = e.clientX; drag.y = e.clientY;
                if (drag.moved > 6) {
                    T.look(dx * 0.0022, dy * 0.0016);
                    T.setGhost(null);
                }
                return;
            }
            var cell = T.pickBoard(e.clientX, e.clientY);
            if (cell && S.turn === S.myColor && !S.busy && !cellAt(cell.x, cell.y)) {
                T.setGhost(cell, S.myColor === BLACK ? 'black' : 'white');
            } else { T.setGhost(null); }
        });

        function finish(e) {
            var d = drag;
            delete activePointers[e.pointerId];
            var remaining = Object.keys(activePointers);
            if (remaining.length < 2) { pinchDistance = 0; }
            if (remaining.length) {
                var p = activePointers[remaining[0]];
                drag = { x: p.x, y: p.y, moved: 999, t: performance.now() };
                return;
            }
            drag = null;
            if (!d || S.phase !== 'seated') { return; }
            if (d.moved > 6 || performance.now() - d.t > 700) { return; }
            /* 只有直接点按 3D 棋钟才能拍钟。 */
            var side = T.pickClock(e.clientX, e.clientY);
            if (side) {
                if (!S.awaitingPress) { toast('先落子，再拍钟'); DJ_AUDIO.nope(); return; }
                var wantSide = S.awaitingPress === S.myColor ? 'me' : 'peer';
                if (side === wantSide) { pressClock(S.awaitingPress, false); }
                else { toast('请拍当前待交接的一侧棋钟'); DJ_AUDIO.nope(); }
                return;
            }
            var cell = T.pickBoard(e.clientX, e.clientY);
            if (cell) { myMove(cell.x, cell.y); }
        }
        c.addEventListener('pointerup', finish);
        c.addEventListener('pointercancel', finish);
        c.addEventListener('pointerleave', function () { if (!drag) { T.setGhost(null); } });
        c.addEventListener('wheel', function (e) {
            if (S.phase !== 'seated') { return; }
            e.preventDefault();
            T.zoom(e.deltaY > 0 ? 1.06 : 0.94);
        }, { passive: false });
    }

    /* ---------- 全屏 ---------- */

    function isFullscreen() {
        return document.fullscreenElement === el.stage;
    }

    function updateFullscreenButton() {
        if (el.fullscreenBtn) { el.fullscreenBtn.textContent = isFullscreen() ? '退出全屏' : '全屏'; }
        if (!isFullscreen() && screen.orientation && screen.orientation.unlock) {
            try { screen.orientation.unlock(); } catch (e) { /* 部分浏览器不允许解锁 */ }
        }
        if (T) { window.setTimeout(function () { if (T) { T.resize(); } }, 60); }
    }

    function lockLandscape() {
        if (screen.orientation && screen.orientation.lock) {
            try {
                var locked = screen.orientation.lock('landscape');
                if (locked && locked.catch) { locked.catch(function () { /* 桌面端可能不支持锁向 */ }); }
            } catch (e) { /* 全屏仍然可用 */ }
        }
    }

    function toggleFullscreen() {
        if (isFullscreen()) {
            if (document.exitFullscreen) { document.exitFullscreen(); }
            return;
        }
        if (!el.stage.requestFullscreen) {
            toast('当前浏览器不支持原生全屏，请横屏后使用最新版浏览器');
            return;
        }
        try {
            var request = el.stage.requestFullscreen({ navigationUI: 'hide' });
            if (request && request.then) {
                request.then(lockLandscape).catch(function () { toast('浏览器未允许全屏，请再点一次'); });
            } else {
                lockLandscape();
            }
        } catch (e) { toast('浏览器未允许全屏，请再点一次'); }
    }

    function selectedClockMode() {
        var selected = el.clockModeBtns.filter(function (b) { return b.classList.contains('is-on'); })[0];
        return selected && selected.dataset.clockMode === 'increment' ? 'increment' : 'sudden';
    }

    function updateCustomClock() {
        var selected = el.presetBtns.filter(function (b) { return b.classList.contains('is-on'); })[0];
        el.customClock.classList.toggle('is-on', !!selected && selected.dataset.preset === 'custom');
        el.customInc.hidden = selectedClockMode() !== 'increment';
    }

    function bindUI() {
        el.nameInput.value = (function () {
            try { return localStorage.getItem('zbx-dj-name') || ''; } catch (e) { return ''; }
        })() || ('棋友' + Math.floor(Math.random() * 900 + 100));

        el.codeInput.addEventListener('input', function () {
            this.value = this.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 8);
        });

        el.genBtn.addEventListener('click', function () {
            el.codeInput.value = window.DJ_NET.newCode();
        });

        el.presetBtns.forEach(function (b) {
            b.addEventListener('click', function () {
                el.presetBtns.forEach(function (o) { o.classList.remove('is-on'); });
                b.classList.add('is-on');
                updateCustomClock();
            });
        });

        el.seatBtns.forEach(function (b) {
            b.addEventListener('click', function () {
                el.seatBtns.forEach(function (o) { o.classList.remove('is-on'); });
                b.classList.add('is-on');
            });
        });

        el.clockModeBtns.forEach(function (b) {
            b.addEventListener('click', function () {
                el.clockModeBtns.forEach(function (o) { o.classList.remove('is-on'); });
                b.classList.add('is-on');
                updateCustomClock();
            });
        });

        el.joinBtn.addEventListener('click', function () {
            DJ_AUDIO.unlock();
            joinRoom();
        });

        if (el.aiBtn) {
            el.aiBtn.addEventListener('click', startAiGame);
        }
        if (el.aiBtnWait) {
            el.aiBtnWait.addEventListener('click', function () {
                if (S.phase !== 'waiting') { return; }
                /* 用当前房间号和计时设置，把等待中的房间转成人机局 */
                startAiGame();
            });
        }

        el.codeInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { joinRoom(); }
        });

        el.copyBtn.addEventListener('click', copyInvite);
        el.copyBtn2.addEventListener('click', copyInvite);
        el.cancelBtn.addEventListener('click', leaveRoom);

        /* 拍钟只允许直接点击 3D 棋钟，不保留独立按钮。 */
        if (el.press && el.press.parentNode) { el.press.parentNode.removeChild(el.press); }

        el.resign.addEventListener('click', function () {
            if (S.phase !== 'seated') { return; }
            if (!window.confirm('认输这一局？')) { return; }
            send({ t: 'resign', c: S.myColor });
            endGame(other(S.myColor), 'resign', null);
        });

        el.leave.addEventListener('click', function () {
            if (S.phase === 'seated' && !window.confirm('离开房间？这一局就散了。')) { return; }
            leaveRoom();
        });

        el.helpBtn.addEventListener('click', function () {
            showOverlay(el.help);
        });
        el.helpClose.addEventListener('click', function () {
            showOverlay(S.phase === 'over' ? el.result : null);
        });

        el.againBtn.addEventListener('click', function () {
            if (!S.aiMode) { send({ t: 'again' }); }
            if (S.phase === 'over') { S.phase = 'seated'; }
            resetGame();
            S.running = BLACK;
            showOverlay(null);
            updateHintForTurn();
            saveSession();
            toast('新的一局');
            maybeAiTurn();
        });

        el.quitBtn.addEventListener('click', leaveRoom);

        el.animBtn.addEventListener('click', function () {
            S.animFast = !S.animFast;
            el.animBtn.textContent = S.animFast ? '动画：快' : '动画：细';
        });

        el.soundBtn.addEventListener('click', function () {
            DJ_AUDIO.setEnabled(!DJ_AUDIO.isEnabled());
            el.soundBtn.textContent = DJ_AUDIO.isEnabled() ? '声音：开' : '声音：关';
        });

        el.fullscreenBtn.addEventListener('click', toggleFullscreen);
        document.addEventListener('fullscreenchange', updateFullscreenButton);
    }

    function copyInvite() {
        var url = location.origin + location.pathname + '?room=' + S.code;
        var text = url;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () {
                toast('邀请链接已复制');
            }).catch(function () { toast(url); });
        } else {
            toast(url);
        }
    }

    /* ---------- 主循环 ---------- */

    function loop(now) {
        if (!mounted) { return; }
        window.requestAnimationFrame(loop);
        if (!rafLast) { rafLast = now; }
        var span = (now - rafLast) / 1000;
        rafLast = now;

        /* 动画按小步走，免得切回标签页时一跳；
           棋钟按真实流逝算——切到别的窗口不等于时间停了。 */
        var dt = Math.min(0.06, span);
        var dtReal = Math.max(0, span);

        stepClocks(dtReal);
        if (S.code && now - lastSessionSave > 2000) {
            lastSessionSave = now;
            saveSession();
        }

        /* 心跳，顺便看看对手还在不在 */
        S.pingAt += dt;
        if (S.pingAt > 4 && S.net && (S.phase === 'seated' || S.phase === 'waiting')) {
            S.pingAt = 0;
            send({ t: 'ping' });
        }
        if (!S.aiMode && S.phase === 'seated' && S.lastPingFromPeer && performance.now() - S.lastPingFromPeer > 20000) {
            S.lastPingFromPeer = performance.now();
            send({ t: 'hello', id: S.id, name: S.name, want: S.want });
        }

        T.frame(dt);
    }

    /* ---------- 启动 ---------- */

    function mount() {
        if (mounted) { return; }
        el.canvas = $('dj-canvas');
        if (!el.canvas) { return; }
        el.stage = $('dj-stage');
        el.toast = $('dj-toast');
        el.hud = $('dj-hud');
        el.hint = $('dj-hint');
        el.code = $('dj-room-code');
        el.clockMe = $('dj-clock-me');
        el.clockPeer = $('dj-clock-peer');
        el.clockMeTime = el.clockMe.querySelector('b');
        el.clockPeerTime = el.clockPeer.querySelector('b');
        el.clockMeName = el.clockMe.querySelector('span');
        el.clockPeerName = el.clockPeer.querySelector('span');

        el.lobby = $('dj-lobby');
        el.lobbyForm = $('dj-lobby-form');
        el.lobbyWait = $('dj-lobby-wait');
        el.waitCode = $('dj-wait-code');
        el.waitNote = $('dj-wait-note');
        el.nameInput = $('dj-name');
        el.codeInput = $('dj-code');
        el.genBtn = $('dj-gen');
        el.joinBtn = $('dj-join');
        el.aiBtn = $('dj-ai');
        el.aiBtnWait = $('dj-ai-wait');
        el.copyBtn = $('dj-copy');
        el.copyBtn2 = $('dj-copy2');
        el.cancelBtn = $('dj-cancel');
        el.seatBtns = Array.prototype.slice.call(document.querySelectorAll('[data-want]'));
        el.presetBtns = Array.prototype.slice.call(document.querySelectorAll('[data-preset]'));
        el.customClock = $('dj-custom-clock');
        el.customInc = $('dj-custom-inc');
        el.mainMinutes = $('dj-main-minutes');
        el.incSeconds = $('dj-inc-seconds');
        el.clockModeBtns = Array.prototype.slice.call(document.querySelectorAll('[data-clock-mode]'));

        el.press = $('dj-press');
        el.resign = $('dj-resign');
        el.leave = $('dj-leave');
        el.helpBtn = $('dj-help-btn');
        el.help = $('dj-help');
        el.helpClose = $('dj-help-close');
        el.animBtn = $('dj-anim');
        el.soundBtn = $('dj-sound');
        el.fullscreenBtn = $('dj-fullscreen');

        el.result = $('dj-result');
        el.verdict = $('dj-verdict');
        el.verdictDetail = $('dj-verdict-detail');
        el.againBtn = $('dj-again');
        el.quitBtn = $('dj-quit');

        el.loading = $('dj-loading');

        /* 身份：每个标签页一个。
           用 sessionStorage 而不是 localStorage —— 同一个浏览器开两个标签页
           互相对下的时候，两边得是两个人才行。 */
        try {
            S.id = sessionStorage.getItem('zbx-dj-id') || '';
            if (!S.id) {
                S.id = 'p' + Math.random().toString(36).slice(2, 10);
                sessionStorage.setItem('zbx-dj-id', S.id);
            }
        } catch (e) {
            S.id = 'p' + Math.random().toString(36).slice(2, 10);
        }

        if (!window.THREE) {
            el.loading.textContent = '三维引擎没加载出来，刷新试试。';
            return;
        }

        try {
            T = window.DJ_TABLE.create(el.canvas);
        } catch (e) {
            el.loading.textContent = '这台设备跑不动 WebGL，换个浏览器或开下硬件加速。';
            return;
        }

        T.resize();
        T.setSeat('black');
        T.setPeer('等待棋友', false);

        if (window.ResizeObserver) {
            resizeObserver = new ResizeObserver(function () { if (T) { T.resize(); } });
            resizeObserver.observe(el.stage);
        }

        bindUI();
        bindPointer();
        resetGame();

        /* 地址里带房间号就直接填上 */
        var q = (location.search.match(/[?&]room=([0-9A-Za-z]+)/) || [])[1];
        if (q) { el.codeInput.value = q.toUpperCase(); }

        try {
            var preset = localStorage.getItem('zbx-dj-preset');
            if (preset) {
                el.presetBtns.forEach(function (b) {
                    b.classList.toggle('is-on', b.dataset.preset === preset);
                });
            }
            if (!el.presetBtns.some(function (b) { return b.classList.contains('is-on'); })) {
                el.presetBtns[0].classList.add('is-on');
            }
            el.mainMinutes.value = localStorage.getItem('zbx-dj-main') || '30';
            el.incSeconds.value = localStorage.getItem('zbx-dj-inc') || '5';
            var savedMode = localStorage.getItem('zbx-dj-clock-mode') || 'sudden';
            el.clockModeBtns.forEach(function (b) {
                b.classList.toggle('is-on', b.dataset.clockMode === savedMode);
            });
            updateCustomClock();
        } catch (e) { /* noop */ }

        el.loading.hidden = true;
        showOverlay(el.lobby);
        mounted = true;
        window.requestAnimationFrame(loop);

        /* sessionStorage 会随当前标签页刷新保留，因此可以无感回房。 */
        var resume = readSession();
        if (resume && resume.code) { joinRoom(true); }
    }

    /*
     * 站内换页只换 <main>，脚本却只注入一次（见 layout.js），
     * 所以这里自己盯着 DOM：换回来时画布是新的一枚，得重新挂一遍；
     * 离开这一页就把渲染循环和实时通道都收掉。
     */
    function unmount() {
        mounted = false;
        drag = null;
        document.body.style.overflow = '';
        if (S.net) {
            try { S.net.close(); } catch (e) { /* noop */ }
            S.net = null;
        }
        if (resizeObserver) {
            try { resizeObserver.disconnect(); } catch (e) { /* noop */ }
            resizeObserver = null;
        }
        if (T && T.dispose) {
            try { T.dispose(); } catch (e) { /* noop */ }
        }
        T = null;
        S.myColor = 0;
        S.peerId = '';
        S.peerName = '';
        S.code = '';
        S.phase = 'lobby';
        S.board = new Uint8Array(N * N);
        S.moves = [];
        S.turn = BLACK;
        S.clocks = { 1: 0, 2: 0 };
        S.running = 0;
        S.busy = false;
        S.pendingPress = false;
        S.awaitingPress = 0;
        S.aiThinking = false;
        if (S.aiTimer) { window.clearTimeout(S.aiTimer); S.aiTimer = 0; }
        S.aiMode = false;
        S.aiColor = 0;
        S.result = null;
        S.queue = [];
        clockDigest = '';
        lastClocks = { 1: '', 2: '' };
    }

    function boot() {
        mount();

        if (window.__zbxDjBound) { return; }
        window.__zbxDjBound = 1;

        window.addEventListener('resize', function () {
            if (T) { T.resize(); }
        });

        window.addEventListener('keydown', function (e) {
            if (!mounted) { return; }
            if ((e.key === 'f' || e.key === 'F') && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
                e.preventDefault();
                toggleFullscreen();
                return;
            }
            if (S.phase !== 'seated') { return; }
        });

        document.addEventListener('zbx:navigate', function () {
            var c = $('dj-canvas');
            if (c === el.canvas) { return; }
            unmount();
            if (c) { mount(); }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
