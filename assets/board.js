/*
 * 连珠杂箱 - 棋盘组件
 * ------------------------------------------------------------
 * 只负责摆棋与翻看：不判胜负、不算连五，纯粹当个棋盘用。
 * 横坐标 A-O（左到右），纵坐标 1-15（下到上）。
 * 棋子上的数字是该手序号，最后一手的序号标红；关掉「序号」时，
 * 最后一手改在棋子中心点一个红点。
 * 可落子的棋盘：点空点落子，双击某一颗棋子回退到那一手，其后的手数作废。
 * 打开「分析」开关后，Rapfi 引擎（连珠规则）会在后台一直算当前局面，
 * 每加深一层就把结果报回来一次，空点上随即出现圆形小标：底色就是该点
 * 胜率的颜色（红→黄→绿→蓝→白，越白越低），里面写胜率（百位整数），
 * 最优的那个圈更粗。引擎不限思考时间，只有局面变了才停。
 * 落子、回退、回看都会重新分析。候选点的个数（1-225）在工具栏下方的
 * 「分析点数」里一直摆着，默认 3 个，改完即时重算。
 *
 * 用法一，声明式（页面里直接摆一个棋盘）：
 *   <div class="board" data-board
 *        data-moves="H8 I9 J10 w:G7" data-numbers="0" data-editable></div>
 *   data-moves 用空格或逗号分隔，默认黑先、双方轮换；
 *   某一手要指定颜色就写 b:H8 / w:H8。
 *   data-numbers="0" 默认不显示序号；data-coords="0" 默认不显示坐标；
 *   data-analysis="0" 默认不开分析；data-points="9" 指定分析点数；
 *   data-editable 表示可以点着落子；data-hash 表示把局面同步到地址栏
 *   （#h8i9j10 这样，刷新、分享都能回到同一局面）。
 *
 *   开关和设置都记在 localStorage（zbx_board_numbers / zbx_board_coords /
 *   zbx_board_analysis / zbx_board_points），页面没写死 data-numbers /
 *   data-coords / data-analysis / data-points 时沿用上次的选择。
 *
 *   分析用的引擎是同目录下 engine/ 里的 Rapfi（WebAssembly，连珠规则），
 *   只在第一次打开「分析」时才加载，约 1.3 MB。
 *
 * 用法二，脚本式：
 *   var b = GomokuBoard.mount(el, {editable: true});
 *   b.place(7, 7);      // 落子（行列为 0 起的下标）
 *   b.next(); b.prev(); b.first(); b.last();
 *   b.undo(); b.truncate(3); b.clear(); b.setNumbers(false); b.setCoords(false);
 *   b.setColor('w'); b.setPoints(9);
 *   b.setMarks([{i:7, j:7, kind:'bad'}]);   // 复盘标注：bad/warn/good/idea
 *   GomokuBoard.encode(b.getMoves());   // -> 'h8i9j10'
 *   GomokuBoard.decode('#h8i9j10');     // -> [{i,j,color}, ...]
 *   b.onChange(function (s) { s.moves / s.cursor / s.numbers / s.coords / s.color });
 *
 * 站内换页是「只换 <main>」的无刷新跳转（见 layout.js），换回来的
 * 页面里的棋盘不会再执行本文件一次，所以这里用 MutationObserver
 * 盯着 DOM：一旦出现没挂过的 .board，重新挂一次。
 */

(function () {
    'use strict';

    var SIZE = 15;              // 十五路
    var COLS = 'ABCDEFGHIJKLMNO';
    var M = 26;                 // 棋盘四周留白，给坐标用
    var C = 34;                 // 格距
    var W = M * 2 + C * (SIZE - 1);
    var R = C * 0.44;           // 棋子半径
    var NS = 'http://www.w3.org/2000/svg';

    var PAPER = '#faf6ec';      // 盘面
    var GRID = '#c3b89e';       // 细线
    var EDGE = '#a2957a';       // 边框与星位
    var LABEL = '#8d8574';      // 坐标

    /*
     * Rapfi 引擎（连珠规则）跑在 Worker 里，见 engine/rapfi-worker.js。
     * 用本文件自己的地址推目录，子页面（zaji/dapu.html）也不会算错。
     */
    var SELF_SRC = (document.currentScript && document.currentScript.src) || '';
    var ENGINE_URL = SELF_SRC
        ? SELF_SRC.replace(/[^\/]*$/, 'engine/rapfi-worker.js')
        : 'assets/engine/rapfi-worker.js';

    /* ---------------------------------------------------------- 小工具 */

    function svgEl(name, attrs) {
        var n = document.createElementNS(NS, name);
        if (attrs) {
            for (var k in attrs) {
                if (Object.prototype.hasOwnProperty.call(attrs, k)) {
                    n.setAttribute(k, attrs[k]);
                }
            }
        }
        return n;
    }

    /*
     * 胜率配色：一条红→黄→绿→蓝→白的色带，满盘胜率（100%）是红，
     * 依次往下是黄、五五开的绿、蓝，0% 收到白。中间线性过渡。
     */
    var WR_STOPS = [
        { w: 1.00, c: [176, 52, 40] },      // 红
        { w: 0.75, c: [212, 168, 58] },     // 黄
        { w: 0.50, c: [88, 148, 90] },      // 绿
        { w: 0.25, c: [48, 104, 152] },     // 蓝
        { w: 0.00, c: [250, 248, 241] }     // 白
    ];

    function wrRgb(w) {
        w = Math.max(0, Math.min(1, w));
        for (var k = 0; k < WR_STOPS.length - 1; k++) {
            var hi = WR_STOPS[k];
            var lo = WR_STOPS[k + 1];
            if (w <= hi.w && w >= lo.w) {
                var t = (hi.w - w) / (hi.w - lo.w);
                return [
                    Math.round(hi.c[0] + (lo.c[0] - hi.c[0]) * t),
                    Math.round(hi.c[1] + (lo.c[1] - hi.c[1]) * t),
                    Math.round(hi.c[2] + (lo.c[2] - hi.c[2]) * t)
                ];
            }
        }
        return WR_STOPS[WR_STOPS.length - 1].c.slice();
    }

    function rgbStr(c) {
        return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
    }

    /* 数字用本色压暗，配浅色圆底 */
    function inkRgb(c, k) {
        return 'rgb(' + Math.round(c[0] * k) + ','
            + Math.round(c[1] * k) + ','
            + Math.round(c[2] * k) + ')';
    }

    /* 圆底从红到白都有，按亮度挑字色：越浅的底，字越深 */
    function textOn(c) {
        var l = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
        if (l > 0.82) {
            return '#4a4a4a';              /* 接近白底（低胜率） */
        }
        return l > 0.58 ? inkRgb(c, 0.4) : '#fffdf7';
    }

    function px(i) { return M + i * C; }        // 列下标 -> x
    function py(j) { return M + j * C; }        // 行下标（自上而下）-> y

    function coordOf(i, j) { return COLS.charAt(i) + (SIZE - j); }

    function parseCoord(t) {
        var m = /^([A-Oa-o])\s*(\d{1,2})$/.exec(t || '');
        if (!m) {
            return null;
        }
        var i = COLS.indexOf(m[1].toUpperCase());
        var n = parseInt(m[2], 10);
        if (i < 0 || n < 1 || n > SIZE) {
            return null;
        }
        return { i: i, j: SIZE - n };
    }

    function parseMoves(str) {
        var out = [];
        (str || '').split(/[\s,;]+/).forEach(function (tok) {
            if (!tok) {
                return;
            }
            var color = null;
            var text = tok;
            var m = /^([bwBW])[:：]?(.+)$/.exec(tok);
            if (m) {
                color = m[1].toLowerCase();
                text = m[2];
            }
            var p = parseCoord(text);
            if (!p) {
                return;
            }
            out.push({
                i: p.i,
                j: p.j,
                color: color || (out.length % 2 === 0 ? 'b' : 'w')
            });
        });
        return out;
    }

    /* ---------------------------------------------------------- 局面路由 */

    /*
     * 局面编码：把棋子按手数写成 h8i9j10 这样的串（小写，无分隔）。
     * 每步是「字母 + 1~2 位数字」，行号最长两位，所以贪心取两位不会有歧义。
     */
    function encodeMoves(moves) {
        return moves.map(function (m) {
            return coordOf(m.i, m.j).toLowerCase();
        }).join('');
    }

    function decodeRoute(str) {
        var out = [];
        var s = String(str || '').replace(/^#/, '').toLowerCase();
        var k = 0;
        while (k < s.length) {
            var m = /^([a-o])(\d{1,2})/.exec(s.slice(k));
            if (!m) {
                break;
            }
            var p = parseCoord(m[1] + m[2]);
            if (!p) {
                break;                     /* 编号越界（如 h16）就到此为止 */
            }
            out.push({
                i: p.i,
                j: p.j,
                color: out.length % 2 === 0 ? 'b' : 'w'
            });
            k += m[0].length;
        }
        return out;
    }

    /* ---------------------------------------------------------- 本地偏好 */

    /* 开关和设置都存在 localStorage，全站同一套 */
    var PREF = {
        numbers: 'zbx_board_numbers',
        coords: 'zbx_board_coords',
        analysis: 'zbx_board_analysis',
        points: 'zbx_board_points'
    };

    var POINTS_MIN = 1;         // 分析点数下限：只看最优点
    var POINTS_MAX = 225;       // 上限：十五路盘的空点总数
    var POINTS_DEF = 3;

    function readPref(key, fallback) {
        try {
            var v = window.localStorage.getItem(PREF[key]);
            return v === '1' ? true : (v === '0' ? false : fallback);
        } catch (e) {
            return fallback;
        }
    }

    function writePref(key, on) {
        try {
            window.localStorage.setItem(PREF[key], on ? '1' : '0');
        } catch (e) {
            /* 隐私模式下写不了，忽略 */
        }
    }

    /* 数值型设置：越界或写坏了都退回默认值 */
    function clampPoints(n) {
        n = Math.round(Number(n));
        if (!isFinite(n)) {
            return POINTS_DEF;
        }
        return Math.max(POINTS_MIN, Math.min(POINTS_MAX, n));
    }

    function readNumPref(key, fallback) {
        try {
            var v = parseInt(window.localStorage.getItem(PREF[key]), 10);
            return isFinite(v) ? clampPoints(v) : fallback;
        } catch (e) {
            return fallback;
        }
    }

    function writeNumPref(key, n) {
        try {
            window.localStorage.setItem(PREF[key], String(n));
        } catch (e) {
            /* 同上 */
        }
    }

    /* ---------------------------------------------------------- 棋盘 */

    function Board(host, opts) {
        opts = opts || {};
        this.host = host;
        this.moves = [];
        this.cursor = 0;                      // 已经走到第几手（0 = 空盘）
        this.numbers = opts.numbers === undefined
            ? readPref('numbers', true) : !!opts.numbers;
        this.coords = opts.coords === undefined
            ? readPref('coords', true) : !!opts.coords;   // A-O / 1-15 坐标
        this.editable = !!opts.editable;
        this.color = opts.color || null;      // null = 黑白轮换
        this.hash = !!opts.hash;              // 局面写进地址栏 #h8i9j10
        /* 引擎分析只对可落子的棋盘开放；开关状态同样记忆 */
        this.analysis = !!this.editable && (opts.analysis === undefined
            ? readPref('analysis', false) : !!opts.analysis);
        /* 分析点数（1-225）：引擎每轮报几个候选点，同样记忆 */
        this.points = opts.points === undefined
            ? readNumPref('points', POINTS_DEF) : clampPoints(opts.points);
        this.pv = null;                       // 引擎给回来的候选点
        this.marks = [];                      // 复盘标注（见 setMarks）
        this.depth = 0;                       // 算到第几层
        this.seq = 0;                         // 每次交给引擎一个新编号
        this.wantKey = '';                    // 当前想算的局面
        this.sentKey = null;                  // 已经交给引擎的局面
        this.sentNbest = null;
        this.engineReady = false;
        this.engineBusy = false;              // 引擎是否正卡在一轮里
        this.listeners = [];

        host.classList.add('board');
        host.innerHTML = '';

        this.buildGrid();
        this.buildToolbar();

        /* 初始局面：地址栏里有局面就先用它，其次 data-moves */
        var init = null;
        if (this.hash) {
            var fromHash = decodeRoute(location.hash);
            if (fromHash.length) {
                init = fromHash;
            }
        }
        if (!init && opts.moves && opts.moves.length) {
            init = opts.moves;
        }
        if (init) {
            this.setMoves(init);
        } else {
            this.render();
        }

        /* 地址栏被改（手输、粘贴、前进后退）时按新局面上盘 */
        if (this.hash) {
            var self = this;
            this.onHash = function () {
                /* 无刷新换页后旧棋盘已离场：摘掉监听，免得在别的页面上改地址栏 */
                if (!document.documentElement.contains(self.host)) {
                    window.removeEventListener('hashchange', self.onHash);
                    return;
                }
                self.setMoves(decodeRoute(location.hash));
            };
            window.addEventListener('hashchange', this.onHash);
        }

        if (this.analysis) {
            this.startEngine();
        }
    }

    Board.prototype.buildGrid = function () {
        var self = this;
        var svg = svgEl('svg', {
            viewBox: '0 0 ' + W + ' ' + W,
            role: 'img',
            'aria-label': '十五路棋盘'
        });

        svg.appendChild(svgEl('rect', {
            x: 0.5, y: 0.5, width: W - 1, height: W - 1, rx: 3,
            fill: PAPER, stroke: EDGE, 'stroke-width': 1
        }));

        var grid = svgEl('g', { stroke: GRID, 'stroke-width': 1 });
        for (var k = 0; k < SIZE; k++) {
            grid.appendChild(svgEl('line', {
                x1: px(0), y1: py(k), x2: px(SIZE - 1), y2: py(k)
            }));
            grid.appendChild(svgEl('line', {
                x1: px(k), y1: py(0), x2: px(k), y2: py(SIZE - 1)
            }));
        }
        svg.appendChild(grid);

        /* 星位：天元 + 四角 */
        [[3, 3], [3, 11], [7, 7], [11, 3], [11, 11]].forEach(function (s) {
            svg.appendChild(svgEl('circle', {
                cx: px(s[0]), cy: py(s[1]), r: 2.4, fill: EDGE
            }));
        });

        /* 坐标：下方 A-O，左侧 1-15（最下一行为 1） */
        var labels = svgEl('g', {
            fill: LABEL,
            'font-family': 'Arial, Helvetica, sans-serif',
            'font-size': 11,
            'text-anchor': 'middle'
        });
        for (var i = 0; i < SIZE; i++) {
            var bx = svgEl('text', { x: px(i), y: W - 6 });
            bx.textContent = COLS.charAt(i);
            labels.appendChild(bx);
        }
        for (var j = 0; j < SIZE; j++) {
            var by = svgEl('text', { x: 12, y: py(j) + 4 });
            by.textContent = String(SIZE - j);
            labels.appendChild(by);
        }
        if (!this.coords) {
            labels.setAttribute('display', 'none');
        }
        this.labels = labels;
        svg.appendChild(labels);

        this.stoneLayer = svgEl('g', {});
        svg.appendChild(this.stoneLayer);

        /* 复盘标注：败着红圈、疑问黄圈、正着绿圈、引擎首选金虚线，画在棋子之上 */
        this.markLayer = svgEl('g', { 'pointer-events': 'none' });
        svg.appendChild(this.markLayer);

        /* 引擎胜率标注：只画在空点上，不挡鼠标 */
        this.evalLayer = svgEl('g', { 'pointer-events': 'none' });
        svg.appendChild(this.evalLayer);

        svg.addEventListener('click', function (e) {
            if (!self.editable) {
                return;
            }
            var p = self.hit(e);
            if (!p || self.indexOf(p.i, p.j) >= 0) {
                return;                        /* 点到已有的子：不动，交给双击 */
            }
            self.place(p.i, p.j, self.color || undefined);
        });

        if (this.editable) {
            svg.classList.add('is-editable');
            /*
             * 双击某一颗棋子：回退到这一手，其后的手数一并作废。
             * 单击只落子，点到已有的子不响应。
             */
            svg.addEventListener('dblclick', function (e) {
                var p = self.hit(e);
                if (!p) {
                    return;
                }
                var idx = self.indexOf(p.i, p.j);
                if (idx < 0) {
                    return;
                }
                self.truncate(idx + 1);
            });
        }

        this.svg = svg;
        this.host.appendChild(svg);
    };

    Board.prototype.buildToolbar = function () {
        var self = this;
        var bar = document.createElement('div');
        bar.className = 'board-toolbar';

        [
            ['first', '<<', '回到开局'],
            ['prev', '<', '上一手'],
            ['next', '>', '下一手'],
            ['last', '>>', '跳到最后一手']
        ].forEach(function (def) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'board-btn';
            btn.setAttribute('data-act', def[0]);
            btn.title = def[2];
            btn.textContent = def[1];
            btn.addEventListener('click', function () {
                self[def[0]]();
            });
            bar.appendChild(btn);
            self.buttons = self.buttons || {};
            self.buttons[def[0]] = btn;
        });

        /* 右侧开关：序号、坐标，可落子的棋盘再加一个分析 */
        var box = document.createElement('div');
        box.className = 'board-switches';

        this.checkbox = this.makeSwitch(box, '序号', '显示或隐藏手数',
            this.numbers, function (on) {
                self.setNumbers(on);
            });
        this.coordBox = this.makeSwitch(box, '坐标', '显示或隐藏棋盘坐标',
            this.coords, function (on) {
                self.setCoords(on);
            });
        if (this.editable) {
            this.analyzeBox = this.makeSwitch(box, '分析',
                '用 Rapfi 引擎分析当前局面，在空点上标出胜率',
                this.analysis, function (on) {
                    self.setAnalysis(on);
                });
        }

        bar.appendChild(box);
        this.bar = bar;
        this.host.appendChild(bar);

        /* 分析点数不藏在「设置」里，一直摆在工具栏下面 */
        if (this.editable) {
            this.host.appendChild(this.buildPanel());
        }
    };

    /* 设置面板：常显一行，放分析点数与当前算到第几层 */
    Board.prototype.buildPanel = function () {
        var self = this;
        var panel = document.createElement('div');
        panel.className = 'board-panel';

        var row = document.createElement('div');
        row.className = 'bp-row';

        var key = document.createElement('span');
        key.className = 'bp-k';
        key.textContent = '分析点数';

        /* 步进器：－ [值] ＋，值也可以直接改 */
        var step = document.createElement('div');
        step.className = 'bp-step';

        var minus = document.createElement('button');
        minus.type = 'button';
        minus.className = 'bp-btn';
        minus.textContent = '\u2212';
        minus.title = '少一个候选点';
        minus.setAttribute('aria-label', '减少分析点数');

        var num = document.createElement('input');
        num.type = 'number';
        num.className = 'bp-num';
        num.min = POINTS_MIN;
        num.max = POINTS_MAX;
        num.step = 1;
        num.value = this.points;
        num.setAttribute('aria-label', '分析点数');

        var plus = document.createElement('button');
        plus.type = 'button';
        plus.className = 'bp-btn';
        plus.textContent = '+';
        plus.title = '多一个候选点';
        plus.setAttribute('aria-label', '增加分析点数');

        minus.addEventListener('click', function () {
            self.setPoints(self.points - 1);
        });
        plus.addEventListener('click', function () {
            self.setPoints(self.points + 1);
        });
        num.addEventListener('change', function () {
            self.setPoints(num.value);
        });

        step.appendChild(minus);
        step.appendChild(num);
        step.appendChild(plus);

        row.appendChild(key);
        row.appendChild(step);

        /* 右边实时显示算到第几层，用来判断引擎还活着没 */
        var state = document.createElement('span');
        state.className = 'bp-state';
        row.appendChild(state);

        panel.appendChild(row);

        this.panel = panel;
        this.stateEl = state;
        this.pointsNum = num;
        this.pointsMinus = minus;
        this.pointsPlus = plus;
        minus.disabled = this.points <= POINTS_MIN;
        plus.disabled = this.points >= POINTS_MAX;
        return panel;
    };

    /* 面板右侧那行小字：一直显示算到第几层 */
    Board.prototype.showDepth = function (n) {
        this.depth = n || 0;
        if (!this.stateEl) {
            return;
        }
        this.stateEl.textContent = n > 0 ? '第 ' + n + ' 层' : '';
    };

    /* 一个胶囊开关：label 里套隐藏的 checkbox + 轨道 + 文字 */
    Board.prototype.makeSwitch = function (parent, text, title, on, onChange) {
        var sw = document.createElement('label');
        sw.className = 'board-switch';
        sw.title = title;

        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!on;
        cb.addEventListener('change', function () {
            onChange(cb.checked);
        });

        var track = document.createElement('span');
        track.className = 'sw';

        var label = document.createElement('span');
        label.className = 'sw-text';
        label.textContent = text;

        sw.appendChild(cb);
        sw.appendChild(track);
        sw.appendChild(label);
        parent.appendChild(sw);
        return cb;
    };

    /* 鼠标位置 -> 最近的交叉点 */
    Board.prototype.hit = function (e) {
        var r = this.svg.getBoundingClientRect();
        if (!r.width || !r.height) {
            return null;
        }
        var x = (e.clientX - r.left) * (W / r.width);
        var y = (e.clientY - r.top) * (W / r.height);
        /* 落在盘外的坐标栏上不算落子 */
        var lo = M - C * 0.45;
        var hi = px(SIZE - 1) + C * 0.45;
        if (x < lo || x > hi || y < lo || y > hi) {
            return null;
        }
        return {
            i: Math.round((x - M) / C),
            j: Math.round((y - M) / C)
        };
    };

    /* 已经走到的那几手里，第一个落在 (i,j) 的下标；没有则 -1 */
    Board.prototype.indexOf = function (i, j) {
        var n = Math.min(this.cursor, this.moves.length);
        for (var k = 0; k < n; k++) {
            if (this.moves[k].i === i && this.moves[k].j === j) {
                return k;
            }
        }
        return -1;
    };

    /* ---------------------------------------------------------- 摆棋 */

    Board.prototype.place = function (i, j, color) {
        if (i < 0 || i >= SIZE || j < 0 || j >= SIZE) {
            return;
        }
        if (this.indexOf(i, j) >= 0) {
            return;
        }
        /* 退回中间某一手再落子，等于从这里另开一路变化，后面的手作废 */
        if (this.cursor < this.moves.length) {
            this.moves.length = this.cursor;
        }
        this.moves.push({
            i: i,
            j: j,
            color: color || (this.moves.length % 2 === 0 ? 'b' : 'w')
        });
        this.cursor = this.moves.length;
        this.render();
    };

    Board.prototype.undo = function () {
        this.truncate(Math.min(this.cursor, this.moves.length) - 1);
    };

    /* 局面截到第 n 手（含第 n 手），其后的手数作废 */
    Board.prototype.truncate = function (n) {
        n = Math.max(0, Math.min(this.moves.length, n));
        if (n < this.moves.length) {
            this.moves.length = n;
        }
        this.cursor = n;
        this.render();
    };

    Board.prototype.clear = function () {
        this.moves = [];
        this.cursor = 0;
        this.render();
    };

    Board.prototype.setMoves = function (moves) {
        this.moves = moves.map(function (m) {
            return { i: m.i, j: m.j, color: m.color || 'b' };
        });
        this.cursor = this.moves.length;
        this.render();
    };

    Board.prototype.getMoves = function () {
        return this.moves.map(function (m) {
            return { i: m.i, j: m.j, color: m.color };
        });
    };

    Board.prototype.getCursor = function () {
        return this.cursor;
    };

    Board.prototype.setCursor = function (n) {
        this.cursor = Math.max(0, Math.min(this.moves.length, n));
        this.render();
    };

    Board.prototype.first = function () { this.setCursor(0); };
    Board.prototype.prev = function () { this.setCursor(this.cursor - 1); };
    Board.prototype.next = function () { this.setCursor(this.cursor + 1); };
    Board.prototype.last = function () { this.setCursor(this.moves.length); };

    Board.prototype.setNumbers = function (on) {
        this.numbers = !!on;
        writePref('numbers', this.numbers);
        this.render();
    };

    Board.prototype.setCoords = function (on) {
        this.coords = !!on;
        writePref('coords', this.coords);
        if (this.labels) {
            if (this.coords) {
                this.labels.removeAttribute('display');
            } else {
                this.labels.setAttribute('display', 'none');
            }
        }
        if (this.coordBox && this.coordBox.checked !== this.coords) {
            this.coordBox.checked = this.coords;
        }
    };

    Board.prototype.setColor = function (color) {
        this.color = color || null;
        this.render();
    };

    Board.prototype.setPoints = function (n) {
        n = clampPoints(n);
        this.points = n;
        writeNumPref('points', n);
        if (this.pointsNum && Number(this.pointsNum.value) !== n) {
            this.pointsNum.value = n;
        }
        if (this.pointsMinus) {
            this.pointsMinus.disabled = n <= POINTS_MIN;
        }
        if (this.pointsPlus) {
            this.pointsPlus.disabled = n >= POINTS_MAX;
        }
        this.renderEval();
        if (this.analysis) {
            this.scheduleAnalysis(true);   /* 点数变了，同一局面也要重算 */
        }
        return this;
    };

    /* ---------------------------------------------------------- 引擎分析 */

    Board.prototype.setAnalysis = function (on) {
        on = !!on && this.editable;
        this.analysis = on;
        writePref('analysis', on);
        if (this.analyzeBox && this.analyzeBox.checked !== on) {
            this.analyzeBox.checked = on;
        }
        if (on) {
            this.startEngine();
        } else {
            this.stopEngine();
        }
        if (!on) {
            this.showDepth(0);
        }
        return this;
    };

    Board.prototype.startEngine = function () {
        if (this.worker || !this.editable) {
            return;
        }
        var self = this;
        this.engineReady = false;
        this.engineBusy = false;
        try {
            this.worker = new Worker(ENGINE_URL);
        } catch (e) {
            this.failEngine('引擎加载失败');
            return;
        }
        this.worker.onmessage = function (e) {
            self.onEngine(e.data || {});
        };
        this.worker.onerror = function () {
            self.failEngine('引擎运行出错');
        };
    };

    /* 引擎起不来（离线、浏览器不支持 wasm）就悄悄把开关退回去 */
    Board.prototype.failEngine = function (why) {
        this.stopEngine();
        this.analysis = false;
        writePref('analysis', false);
        if (this.analyzeBox) {
            this.analyzeBox.checked = false;
        }
        this.showDepth(0);
        if (window.console) {
            window.console.warn('[board] ' + why + '：' + ENGINE_URL);
        }
    };

    Board.prototype.stopEngine = function () {
        if (this.worker) {
            try {
                this.worker.postMessage({ type: 'stop' });
            } catch (e) { /* 已经没了 */ }
            this.worker.terminate();
            this.worker = null;
        }
        this.engineReady = false;
        this.engineBusy = false;
        this.sentKey = null;
        this.pv = null;
        this.renderEval();
    };

    /*
     * 引擎在一个命令里是同步阻塞的：不限时（timeout_turn 0）时它要一直算到
     * 局面变了才该停，可它压根收不到外面发来的消息。所以换局面时只能把整个
     * Worker 掐掉重开一个（wasm 有缓存，起一个约两百毫秒）。
     */
    Board.prototype.restartEngine = function () {
        this.stopEngine();
        this.showDepth(0);
        this.startEngine();
    };

    Board.prototype.onEngine = function (d) {
        if (d.type === 'ready') {
            this.engineReady = true;
            this.pumpEngine();
        } else if (d.type === 'eval') {
            if (d.seq !== this.seq) {
                return;                        /* 旧局面的结果，丢掉 */
            }
            this.pv = d.pv || [];
            this.showDepth(d.depth || 0);
            this.renderEval();
        } else if (d.type === 'round') {
            this.engineBusy = false;           /* 这一轮自己结束了，可以接着用 */
            this.pumpEngine();
        } else if (d.type === 'error') {
            this.failEngine(String(d.message || '引擎出错'));
        }
    };

    /* 当前局面的指纹：棋子位置 + 颜色，同一局面不重复算 */
    Board.prototype.positionKey = function () {
        var n = Math.min(this.cursor, this.moves.length);
        var key = [];
        for (var k = 0; k < n; k++) {
            key.push(this.moves[k].i + '.' + this.moves[k].j + this.moves[k].color);
        }
        return key.join(',');
    };

    /* 局面变了（落子、回退、回看）就重新分析 */
    Board.prototype.scheduleAnalysis = function (force) {
        if (!this.analysis || !this.editable) {
            return;
        }
        var key = this.positionKey();
        if (!force && key === this.wantKey) {
            return;
        }
        this.wantKey = key;
        /* 连点几下棋时先攒一攒，免得每按一次都重启一个 Worker */
        var self = this;
        clearTimeout(this.anTimer);
        this.anTimer = setTimeout(function () {
            self.pumpEngine();
        }, 80);
    };

    /* 把「想要的局面」与「已经交出去的」对一对，不一致就交给引擎 */
    Board.prototype.pumpEngine = function () {
        if (!this.analysis || !this.editable) {
            return;
        }
        if (!this.worker) {
            this.startEngine();                /* 起来后 ready 会再叫一次 */
            return;
        }
        if (!this.engineReady) {
            return;                            /* 还在解 wasm */
        }
        if (this.sentKey === this.wantKey && this.sentNbest === this.points) {
            return;                            /* 这个局面已经在算 */
        }
        if (this.engineBusy) {
            this.restartEngine();              /* 卡在一轮里，叫不停，整个换掉 */
            return;
        }
        this.sendAnalysis();
    };

    Board.prototype.sendAnalysis = function () {
        if (!this.worker || !this.engineReady) {
            return;
        }
        var n = Math.min(this.cursor, this.moves.length);
        var lines = [];
        for (var k = 0; k < n; k++) {
            var m = this.moves[k];
            /* 引擎坐标：x 从左 0 起，y 从下 0 起 */
            lines.push(m.i + ',' + (SIZE - 1 - m.j) + ',' + (m.color === 'b' ? 1 : 2));
        }
        this.seq = (this.seq || 0) + 1;
        this.sentKey = this.wantKey;
        this.sentNbest = this.points;
        this.engineBusy = true;
        this.pv = null;
        this.showDepth(0);
        this.renderEval();
        this.worker.postMessage({
            type: 'analyze',
            seq: this.seq,
            moves: lines,
            nbest: this.points
        });
    };

    /* 在空点上标胜率；已经落子的点不标 */
    Board.prototype.renderEval = function () {
        var layer = this.evalLayer;
        if (!layer) {
            return;
        }
        while (layer.firstChild) {
            layer.removeChild(layer.firstChild);
        }
        if (!this.analysis || !this.pv || !this.pv.length) {
            return;
        }

        var n = Math.min(this.cursor, this.moves.length);
        var taken = {};
        for (var k = 0; k < n; k++) {
            taken[this.moves[k].i + ',' + this.moves[k].j] = 1;
        }

        var list = this.pv.slice(0, this.points);
        for (var p = 0; p < list.length; p++) {
            var item = list[p];
            var i = item.x;
            var j = SIZE - 1 - item.y;
            if (i < 0 || i >= SIZE || j < 0 || j >= SIZE || taken[i + ',' + j]) {
                continue;
            }
            var w = Math.max(0, Math.min(1, item.winrate));
            var cx = px(i);
            var cy = py(j);
            var c = wrRgb(w);
            var col = rgbStr(c);
            var top = p === 0;
            var label = String(Math.round(w * 100));

            /* 圆框比棋子小一圈：底色就是这手胜率的颜色 */
            layer.appendChild(svgEl('circle', {
                cx: cx, cy: cy, r: top ? C * 0.43 : C * 0.4,
                fill: col,
                stroke: inkRgb(c, 0.7),
                'stroke-width': top ? 1.3 : 0.7,
                'stroke-opacity': top ? 0.85 : 0.4
            }));

            /* 一位数写大些，三位数缩小才对得进圆里 */
            var size = label.length >= 3 ? 8.4 : (label.length === 2 ? 10 : 11.5);
            var text = svgEl('text', {
                x: cx, y: cy + size * 0.35,
                'text-anchor': 'middle',
                'font-family': 'Arial, Helvetica, sans-serif',
                'font-size': size,
                'font-weight': top ? 700 : 600,
                fill: textOn(c)
            });
            text.textContent = label;
            layer.appendChild(text);
        }
    };

    /*
     * 复盘标注：给某一手加圈。
     *   [{ i, j, kind }]，kind = 'bad'（败着）| 'warn'（疑问）|
     *   'good'（正着）| 'idea'（引擎首选，通常落在空点上）
     * 标注只影响画面，不参与落子判定；传空数组即清空。
     */
    Board.prototype.setMarks = function (list) {
        this.marks = list || [];
        this.renderMarks();
    };

    var MARKS = {
        bad: { color: '#b0342c', dash: null, width: 1.8 },
        warn: { color: '#c08a2a', dash: null, width: 1.6 },
        good: { color: '#3f6b48', dash: null, width: 1.6 },
        idea: { color: '#a8863f', dash: '3 2.4', width: 1.4 }
    };

    Board.prototype.renderMarks = function () {
        var layer = this.markLayer;
        if (!layer) {
            return;
        }
        while (layer.firstChild) {
            layer.removeChild(layer.firstChild);
        }
        for (var k = 0; k < this.marks.length; k++) {
            var mk = this.marks[k];
            var style = MARKS[mk.kind] || MARKS.idea;
            var attrs = {
                cx: px(mk.i), cy: py(mk.j),
                r: mk.kind === 'idea' ? R * 0.62 : R + 2.6,
                fill: 'none',
                stroke: style.color,
                'stroke-width': style.width,
                'stroke-linecap': 'round'
            };
            if (style.dash) {
                attrs['stroke-dasharray'] = style.dash;
            }
            layer.appendChild(svgEl('circle', attrs));
        }
    };

    Board.prototype.onChange = function (fn) {
        if (typeof fn === 'function') {
            this.listeners.push(fn);
        }
    };

    /*
     * 把当前看到的局面写回地址栏：#h8i9j10。
     * 只写「已经摆出来的那几手」，所以按 < 回看时地址栏跟着变短，
     * 再按 > 又会长回来；用 replaceState 是为了不往历史里堆条目，
     * 否则每落一子就多一条后退记录。
     */
    Board.prototype.syncHash = function () {
        if (!this.hash) {
            return;
        }
        var code = encodeMoves(this.moves.slice(0, Math.min(this.cursor, this.moves.length)));
        var bare = location.pathname + location.search;
        var url = bare + (code ? '#' + code : '');
        if (url === bare + location.hash) {
            return;
        }
        try {
            history.replaceState(history.state, '', url);
        } catch (e) {
            /* file:// 等环境下不让改，退回直接设 hash（下面有比对，不会循环） */
            location.hash = code;
        }
    };

    /* ---------------------------------------------------------- 渲染 */

    Board.prototype.render = function () {
        var n = Math.min(this.cursor, this.moves.length);
        var layer = this.stoneLayer;

        while (layer.firstChild) {
            layer.removeChild(layer.firstChild);
        }

        for (var k = 0; k < n; k++) {
            var mv = this.moves[k];
            var x = px(mv.i);
            var y = py(mv.j);
            var isLast = (k === n - 1);
            var black = mv.color === 'b';

            layer.appendChild(svgEl('circle', {
                cx: x, cy: y, r: R,
                fill: black ? '#1f1f1f' : '#ffffff',
                stroke: black ? '#000000' : '#b3ab99',
                'stroke-width': 1
            }));

            if (this.numbers) {
                var num = svgEl('text', {
                    x: x,
                    y: y + (k + 1 >= 100 ? 3.4 : 4),
                    'text-anchor': 'middle',
                    'font-family': 'Arial, Helvetica, sans-serif',
                    'font-size': k + 1 >= 100 ? 9 : 12,
                    'font-weight': 600,
                    fill: isLast
                        ? (black ? '#ff5a5a' : '#d42626')
                        : (black ? '#eeeeee' : '#3a3a3a')
                });
                num.textContent = String(k + 1);
                layer.appendChild(num);
            } else if (isLast) {
                layer.appendChild(svgEl('circle', {
                    cx: x, cy: y, r: R * 0.3, fill: '#e03434'
                }));
            }
        }

        this.renderMarks();                        /* 标注跟着局面重画 */
        this.updateButtons();
        if (this.checkbox && this.checkbox.checked !== this.numbers) {
            this.checkbox.checked = this.numbers;
        }
        if (this.coordBox && this.coordBox.checked !== this.coords) {
            this.coordBox.checked = this.coords;
        }
        this.syncHash();
        this.renderEval();
        this.scheduleAnalysis();
        this.emit();
    };

    Board.prototype.updateButtons = function () {
        if (!this.buttons) {
            return;
        }
        var atStart = this.cursor <= 0;
        var atEnd = this.cursor >= this.moves.length;
        this.buttons.first.disabled = atStart;
        this.buttons.prev.disabled = atStart;
        this.buttons.next.disabled = atEnd;
        this.buttons.last.disabled = atEnd;
    };

    Board.prototype.emit = function () {
        var state = {
            moves: this.getMoves(),
            cursor: this.cursor,
            numbers: this.numbers,
            coords: this.coords,
            color: this.color
        };
        this.listeners.forEach(function (fn) {
            fn(state);
        });
    };

    /* ---------------------------------------------------------- 挂载 */

    /* 在场的棋盘：无刷新换页把旧棋盘换掉时，要顺手把它的引擎停掉 */
    var LIVE = [];

    function prune() {
        for (var k = LIVE.length - 1; k >= 0; k--) {
            var b = LIVE[k];
            if (document.documentElement.contains(b.host)) {
                continue;
            }
            b.stopEngine();
            if (b.onHash) {
                window.removeEventListener('hashchange', b.onHash);
            }
            LIVE.splice(k, 1);
        }
    }

    function mount(host, opts) {
        var board = new Board(host, opts);
        host._board = board;
        LIVE.push(board);
        return board;
    }

    function initBoard(el) {
        if (el.getAttribute('data-ready')) {
            return el._board || null;
        }
        el.setAttribute('data-ready', '1');
        var opts = {
            moves: parseMoves(el.getAttribute('data-moves')),
            editable: el.hasAttribute('data-editable'),
            hash: el.hasAttribute('data-hash')
        };
        /* 没有显式写死的属性，就沿用上次的开关状态（见 readPref） */
        if (el.hasAttribute('data-numbers')) {
            opts.numbers = el.getAttribute('data-numbers') !== '0';
        }
        if (el.hasAttribute('data-coords')) {
            opts.coords = el.getAttribute('data-coords') !== '0';
        }
        if (el.hasAttribute('data-analysis')) {
            opts.analysis = el.getAttribute('data-analysis') !== '0';
        }
        if (el.hasAttribute('data-points')) {
            opts.points = el.getAttribute('data-points');
        }
        return mount(el, opts);
    }

    /* 页面上所有 data-board 的棋盘都挂上（无刷新换页后由下面的观察器再调一次） */
    function initAll(scope) {
        Array.prototype.forEach.call(
            scope.querySelectorAll('.board[data-board]'), initBoard);
    }

    window.GomokuBoard = {
        mount: mount,
        get: function (el) { return el && el._board; },
        coord: coordOf,
        parse: parseMoves,
        encode: encodeMoves,
        decode: decodeRoute
    };

    initAll(document);

    /*
     * 无刷新跳转会把 <main> 整块换掉，换进来的棋盘不会自己初始化。
     * 这里只盯着「新出现且还没挂过」的节点，棋盘内部画子的增删不会
     * 触发重新挂载（初始化时就先打上 data-ready）。
     */
    if (window.MutationObserver) {
        var pending = false;
        var obs = new MutationObserver(function (records) {
            if (pending) {
                return;
            }
            prune();                    /* 先把离场棋盘的引擎停掉 */
            for (var i = 0; i < records.length; i++) {
                var added = records[i].addedNodes;
                for (var k = 0; k < added.length; k++) {
                    var node = added[k];
                    if (node.nodeType !== 1) {
                        continue;
                    }
                    if (node.matches('.board:not([data-ready])') ||
                        node.querySelector('.board:not([data-ready])')) {
                        pending = true;
                        window.requestAnimationFrame(function () {
                            pending = false;
                            initAll(document);
                        });
                        return;
                    }
                }
            }
        });
        obs.observe(document.body, { childList: true, subtree: true });
    }
})();
