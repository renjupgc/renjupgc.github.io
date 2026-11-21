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
        { id: 'std', label: '10 分 + 5 秒', main: 600000, inc: 5000 },
        { id: 'fast', label: '5 分 + 3 秒', main: 300000, inc: 3000 },
        { id: 'long', label: '15 分 + 10 秒', main: 900000, inc: 10000 },
        { id: 'none', label: '不限时', main: 0, inc: 0 }
    ];

    var S = {
        id: '',
        name: '',
        want: 'any',
        preset: 'std',
        conf: { main: 600000, inc: 5000 },
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
        pendingPress: false,
        autoPress: 0,
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

    function $(id) { return document.getElementById(id); }

    function pad2(n) { return (n < 10 ? '0' : '') + n; }

    function fmtClock(ms) {
        if (!S.conf.main) { return '∞'; }
        ms = Math.max(0, ms);
        var t = ms / 1000;
        var m = Math.floor(t / 60);
        var s = t - m * 60;
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
        S.autoPress = 0;
        S.result = null;
        S.queue = [];
        S.clocks[1] = S.conf.main;
        S.clocks[2] = S.conf.main;
        lastClocks = { 1: '', 2: '' };
        clockDigest = '';
        if (T) {
            T.clearStones();
            T.setWin(null);
            T.markLast(null);
            T.setGhost(null);
        }
        renderClocks(true);
        if (el.press) { el.press.classList.remove('is-pulse'); }
    }

    function beginSeated() {
        S.phase = 'seated';
        showOverlay(null);
        el.hud.hidden = false;
        el.code.textContent = S.code;
        if (el.clockMeName) { el.clockMeName.textContent = '我 · ' + colorName(S.myColor); }
        if (el.clockPeerName) { el.clockPeerName.textContent = '对手 · ' + (S.peerName || '棋友'); }
        T.setSeat(S.myColor === BLACK ? 'black' : 'white');
        T.setPeer(S.peerName, true);
        resetGame();
        S.running = BLACK;
        if (el.stage && el.stage.scrollIntoView) {
            try { el.stage.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* noop */ }
        }
        toast(colorName(S.myColor) + '方落座');
        hint(S.myColor === BLACK
            ? '你执黑先行。点棋盘落子。'
            : '你执白。黑方先行，等他落子。');
        DJ_AUDIO.tick();
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
    }

    function updateHintForTurn() {
        if (S.phase !== 'seated') { return; }
        if (S.pendingPress) {
            hint('这手已落下，<em>拍钟</em>把时间交给对方。');
            return;
        }
        if (S.turn === S.myColor) {
            hint('轮到你走。从右手的棋盒里取子。');
        } else {
            hint('轮到 ' + (S.peerName || '对手') + '。');
        }
    }

    function endGame(winner, reason, cells) {
        if (S.phase === 'over') { return; }
        S.phase = 'over';
        S.running = 0;
        S.busy = false;
        S.pendingPress = false;
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

        /* 落子后没拍钟，过一会儿替你拍，别让人白白掉时间 */
        if (S.autoPress > 0) {
            S.autoPress -= dt;
            if (S.autoPress <= 0) {
                S.autoPress = 0;
                if (S.pendingPress) { pressClock(S.myColor, false); }
            }
        }

        renderClocks(false);
    }

    function pressClock(color, remote) {
        if (S.phase !== 'seated') { return; }
        if (!remote && S.running !== color) {
            toast('现在不是你的用时');
            DJ_AUDIO.nope();
            return;
        }

        if (!remote) {
            /* 本地拍钟：加秒、发出去；远端的加秒在它自己那边已经算过了 */
            S.clocks[color] += S.conf.inc;
        }
        S.running = other(color);
        S.autoPress = 0;
        if (color === S.myColor) {
            S.pendingPress = false;
            if (el.press) { el.press.classList.remove('is-pulse'); }
        }

        T.bumpClock(color === S.myColor ? 'me' : 'peer');
        DJ_AUDIO.press();
        renderClocks(true);

        if (!remote) {
            S.net.send({ t: 'press', c: color, b: S.clocks[1], w: S.clocks[2] });
            updateHintForTurn();
        }
    }

    /* ---------- 走子 ---------- */

    function myMove(x, y) {
        if (S.phase !== 'seated') { return; }
        if (S.busy) { return; }
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
                S.net.send({
                    t: 'move', x: x, y: y, c: color, n: S.moves.length,
                    b: S.clocks[1], w: S.clocks[2]
                });
            },
            onDone: function () {
                S.busy = false;
                if (S.phase === 'seated') {
                    S.pendingPress = true;
                    S.autoPress = 6;
                    if (el.press) { el.press.classList.add('is-pulse'); }
                    updateHintForTurn();
                }
                drainQueue();
            }
        });
    }

    function peerMove(m) {
        if (S.busy) { S.queue.push(m); return; }
        if (S.phase !== 'seated' && S.phase !== 'over') { return; }
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
        S.conf = { main: conf.main | 0, inc: conf.inc | 0 };
        S.phase = 'seated';
        beginSeated();
    }

    function dispatch(m) {
        if (!m || !m.t) { return; }
        if (m.t !== 'ping') { S.lastPingFromPeer = performance.now(); }

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
                        conf: { main: S.conf.main, inc: S.conf.inc },
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

    function joinRoom() {
        var name = (el.nameInput.value || '').trim().slice(0, 12);
        var code = (el.codeInput.value || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
        if (!name) { toast('先起个名字'); el.nameInput.focus(); return; }
        if (code.length < 4) { toast('房间号至少 4 位'); el.codeInput.focus(); return; }

        S.name = name;
        S.code = code;
        S.want = el.seatBtns.filter(function (b) { return b.classList.contains('is-on'); })[0].dataset.want;
        S.preset = el.presetBtns.filter(function (b) { return b.classList.contains('is-on'); })[0].dataset.preset;
        var p = PRESETS.filter(function (x) { return x.id === S.preset; })[0] || PRESETS[0];
        S.conf = { main: p.main, inc: p.inc };

        try {
            localStorage.setItem('zbx-dj-name', S.name);
            localStorage.setItem('zbx-dj-preset', S.preset);
        } catch (e) { /* 隐私模式忽略 */ }

        if (S.net) { S.net.close(); }
        S.myColor = 0;
        S.peerId = '';
        S.peerName = '';
        S.helloRetry = 0;

        showLobbyWait('正在连上房间…');
        S.phase = 'waiting';
        hint('正在连上房间…');

        S.net = window.DJ_NET.connect({
            code: S.code,
            id: S.id,
            name: S.name,
            onMessage: dispatch,
            onStatus: function (mode) {
                if (mode === 'online') {
                    el.waitNote.textContent = '房间已开好，把号子告诉棋友，等他进来。';
                } else if (mode === 'local') {
                    el.waitNote.textContent = '实时服务没连上，已切到本机模式：同一个浏览器开两个标签页，进同一个房间号可以对下。';
                } else if (mode === 'slow') {
                    el.waitNote.textContent = '实时服务响应很慢，正在换本机模式…';
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

    function bindPointer() {
        var c = el.canvas;

        c.addEventListener('pointerdown', function (e) {
            if (S.phase !== 'seated') { return; }
            DJ_AUDIO.unlock();
            drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: 0, t: performance.now() };
            try { c.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
        });

        c.addEventListener('pointermove', function (e) {
            if (S.phase !== 'seated') { return; }

            if (drag) {
                var dx = e.clientX - drag.x;
                var dy = e.clientY - drag.y;
                drag.moved += Math.abs(dx) + Math.abs(dy);
                drag.x = e.clientX;
                drag.y = e.clientY;
                if (drag.moved > 6) {
                    T.look(dx * 0.0022, dy * 0.0016);
                    T.setGhost(null);
                }
                return;
            }

            var cell = T.pickBoard(e.clientX, e.clientY);
            if (cell && S.turn === S.myColor && !S.busy && !cellAt(cell.x, cell.y)) {
                T.setGhost(cell, S.myColor === BLACK ? 'black' : 'white');
            } else {
                T.setGhost(null);
            }
        });

        function finish(e) {
            if (!drag) { return; }
            var d = drag;
            drag = null;
            if (S.phase !== 'seated') { return; }
            if (d.moved > 6 || performance.now() - d.t > 700) { return; }

            /* 先看是不是点了棋钟 */
            var side = T.pickClock(e.clientX, e.clientY);
            if (side) {
                if (side === 'me') { pressClock(S.myColor, false); }
                else { toast('那是对方的钟'); DJ_AUDIO.nope(); }
                return;
            }

            var cell = T.pickBoard(e.clientX, e.clientY);
            if (cell) { myMove(cell.x, cell.y); }
        }

        c.addEventListener('pointerup', finish);
        c.addEventListener('pointercancel', function () { drag = null; });
        c.addEventListener('pointerleave', function () { if (!drag) { T.setGhost(null); } });

        c.addEventListener('wheel', function (e) {
            if (S.phase !== 'seated') { return; }
            e.preventDefault();
            T.zoom(e.deltaY > 0 ? 1.06 : 0.94);
        }, { passive: false });

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
            });
        });

        el.seatBtns.forEach(function (b) {
            b.addEventListener('click', function () {
                el.seatBtns.forEach(function (o) { o.classList.remove('is-on'); });
                b.classList.add('is-on');
            });
        });

        el.joinBtn.addEventListener('click', function () {
            DJ_AUDIO.unlock();
            joinRoom();
        });

        el.codeInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { joinRoom(); }
        });

        el.copyBtn.addEventListener('click', copyInvite);
        el.copyBtn2.addEventListener('click', copyInvite);
        el.cancelBtn.addEventListener('click', leaveRoom);

        el.press.addEventListener('click', function () {
            DJ_AUDIO.unlock();
            pressClock(S.myColor, false);
        });

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
            send({ t: 'again' });
            if (S.phase === 'over') { S.phase = 'seated'; }
            resetGame();
            S.running = BLACK;
            showOverlay(null);
            toast('新的一局');
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
        var dtReal = Math.min(600, span);

        stepClocks(dtReal);

        /* 心跳，顺便看看对手还在不在 */
        S.pingAt += dt;
        if (S.pingAt > 4 && S.net && (S.phase === 'seated' || S.phase === 'waiting')) {
            S.pingAt = 0;
            send({ t: 'ping' });
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
        el.copyBtn = $('dj-copy');
        el.copyBtn2 = $('dj-copy2');
        el.cancelBtn = $('dj-cancel');
        el.seatBtns = Array.prototype.slice.call(document.querySelectorAll('[data-want]'));
        el.presetBtns = Array.prototype.slice.call(document.querySelectorAll('[data-preset]'));

        el.press = $('dj-press');
        el.resign = $('dj-resign');
        el.leave = $('dj-leave');
        el.helpBtn = $('dj-help-btn');
        el.help = $('dj-help');
        el.helpClose = $('dj-help-close');
        el.animBtn = $('dj-anim');
        el.soundBtn = $('dj-sound');

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
        } catch (e) { /* noop */ }

        el.loading.hidden = true;
        showOverlay(el.lobby);
        mounted = true;
        window.requestAnimationFrame(loop);
    }

    /*
     * 站内换页只换 <main>，脚本却只注入一次（见 layout.js），
     * 所以这里自己盯着 DOM：换回来时画布是新的一枚，得重新挂一遍；
     * 离开这一页就把渲染循环和实时通道都收掉。
     */
    function unmount() {
        mounted = false;
        drag = null;
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
        S.autoPress = 0;
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
            if (!mounted || S.phase !== 'seated') { return; }
            if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                pressClock(S.myColor, false);
            }
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
