/*
 * 连珠杂箱 - Rapfi 引擎的 Web Worker 封装
 * ------------------------------------------------------------
 * 引擎是单线程的 WebAssembly（Rapfi，连珠规则，见同目录 NOTICE.md），
 * 搜索时会把线程完全占住，所以必须放在 Worker 里跑，否则界面会卡死。
 *
 * 主线程发过来一局棋，这里就一轮一轮地分析，每轮把各候选点的胜率
 * 报回去；局面没变就继续加深，局面变了就换新的。
 *
 * 收：{type: 'analyze', seq, moves, nbest}   nbest = 候选点数量（1-225）
 *     {type: 'stop'}
 * 发：{type: 'ready'} / {type: 'eval', seq, depth, pv: [{x, y, winrate}]}
 *     {type: 'error', message}
 */

'use strict';

var PV_MIN = 1;
var PV_MAX = 225;       // 十五路盘的空点总数
var PV_DEF = 3;         // 主线程没指定时用这个（与分析点数默认值一致）

var MODULE = null;
var ready = false;
var current = null;     // 当前要分析的局面
var timer = null;

var pvMap = {};         // pvIdx -> {winrate, move}
var cur = null;         // 正在收的候选点
var numpv = 1;
var depth = 0;

function send(msg) {
    self.postMessage(msg);
}

/* "7,9" 与 "H7" 两种坐标写法都认，统一成 0 起、y 自下而上 */
function parseCoord(s) {
    if (!s) {
        return null;
    }
    if (s.indexOf(',') >= 0) {
        var a = s.split(',');
        var x = parseInt(a[0], 10);
        var y = parseInt(a[1], 10);
        return isFinite(x) && isFinite(y) ? { x: x, y: y } : null;
    }
    var m = /^([a-o])(\d{1,2})$/i.exec(s);
    if (!m) {
        return null;
    }
    return { x: m[1].toLowerCase().charCodeAt(0) - 97, y: parseInt(m[2], 10) - 1 };
}

function firstCoord(line) {
    return parseCoord(String(line || '').trim().split(/\s+/)[0]);
}

function flush() {
    var list = [];
    for (var k in pvMap) {
        if (!Object.prototype.hasOwnProperty.call(pvMap, k)) {
            continue;
        }
        var item = pvMap[k];
        if (item.move) {
            list.push({ x: item.move.x, y: item.move.y, winrate: item.winrate });
        }
    }
    if (!list.length) {
        return;
    }
    list.sort(function (a, b) { return b.winrate - a.winrate; });
    send({
        type: 'eval',
        seq: current ? current.seq : -1,
        depth: depth,
        pv: list.slice(0, current ? current.nbest : PV_DEF)
    });
}

function onLine(line) {
    /* 引擎在每轮结束时单独打一行落点（如 "8,7"），当作一轮的句号 */
    if (/^(\d+,\d+|[a-o]\d{1,2})$/i.test(line)) {
        flush();
        return;
    }
    if (line.slice(0, 5) !== 'INFO ') {
        return;
    }
    var rest = line.slice(5);
    var sp = rest.indexOf(' ');
    var key = sp < 0 ? rest : rest.slice(0, sp);
    var val = sp < 0 ? '' : rest.slice(sp + 1);

    if (key === 'PV') {
        if (val === 'DONE') {
            if (cur && cur.winrate != null && cur.line) {
                pvMap[cur.idx] = { winrate: cur.winrate, move: firstCoord(cur.line) };
            }
            cur = null;
        } else {
            cur = { idx: parseInt(val, 10) || 0, winrate: null, line: null };
        }
    } else if (key === 'NUMPV') {
        numpv = parseInt(val, 10) || 1;
    } else if (key === 'DEPTH') {
        depth = parseInt(val, 10) || 0;
    } else if (key === 'WINRATE' && cur) {
        cur.winrate = parseFloat(val);
    } else if (key === 'BESTLINE' && cur) {
        cur.line = val;
    }
}

function run() {
    if (!ready || !current) {
        return;
    }
    var seq = current.seq;
    pvMap = {};
    cur = null;
    numpv = 1;
    depth = 0;

    /*
     * 不限思考时间：turnTime 与 matchTime 都是 0 时 Rapfi 进入「分析模式」，
     * 一轮会一直搜到算完（没有时间上限），出来后再接着下一轮加深。
     * 顺序不能反：先清 matchTime，再把 turnTime 归零，两个都为 0 才算无限。
     */
    MODULE.sendCommand('INFO timeout_match 0');
    MODULE.sendCommand('INFO timeout_turn 0');
    /* YXBOARD 只摆局面不思考，接下来由 YXNBEST 起算 */
    MODULE.sendCommand(['YXBOARD'].concat(current.moves).concat(['DONE']).join('\n'));
    MODULE.sendCommand('YXNBEST ' + current.nbest);
    /* 上面这行是同步阻塞的，返回时这一轮已经算完 */

    if (!current) {
        return;
    }
    if (current.seq === seq) {
        timer = setTimeout(run, 30);       /* 同一局面：继续加深 */
    } else {
        timer = setTimeout(run, 0);        /* 有新局面：马上换 */
    }
}

self.onmessage = function (e) {
    var d = e.data || {};
    if (d.type === 'analyze') {
        var n = Math.round(Number(d.nbest));
        current = {
            seq: d.seq,
            moves: d.moves || [],
            nbest: isFinite(n) ? Math.max(PV_MIN, Math.min(PV_MAX, n)) : PV_DEF
        };
        if (ready) {
            clearTimeout(timer);
            timer = setTimeout(run, 0);
        }
    } else if (d.type === 'stop') {
        current = null;
        clearTimeout(timer);
    }
};

importScripts('rapfi-single.js');

Rapfi({
    locateFile: function (p) { return p; },
    onReceiveStdout: onLine,
    onReceiveStderr: function () {},
    onExit: function () {}
}).then(function (m) {
    MODULE = m;
    m.sendCommand('START 15');
    m.sendCommand('INFO rule 4');          /* 4 = renju（黑有禁手，白无） */
    m.sendCommand('INFO show_detail 2');   /* 每个候选点都报胜率 */
    m.sendCommand('INFO timeout_match 0');
    m.sendCommand('INFO timeout_turn 0');       /* 0 = 不限时间（分析模式） */
    m.sendCommand('INFO thread_num 1');
    m.sendCommand('INFO max_memory 64');
    ready = true;
    send({ type: 'ready' });
    if (current) {
        run();
    }
}).catch(function (e) {
    send({ type: 'error', message: String((e && e.message) || e) });
});
