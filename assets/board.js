/*
 * 连珠杂箱 - 棋盘组件
 * ------------------------------------------------------------
 * 只负责摆棋与翻看：不判胜负、不算连五，纯粹当个棋盘用。
 * 横坐标 A-O（左到右），纵坐标 1-15（下到上）。
 * 棋子上的数字是该手序号，最后一手的序号标红；关掉「序号」时，
 * 最后一手改在棋子中心点一个红点。
 * 可落子的棋盘：点空点落子，点已有棋子跳回那一手，右键退掉一手。
 *
 * 用法一，声明式（页面里直接摆一个棋盘）：
 *   <div class="board" data-board
 *        data-moves="H8 I9 J10 w:G7" data-numbers="0" data-editable></div>
 *   data-moves 用空格或逗号分隔，默认黑先、双方轮换；
 *   某一手要指定颜色就写 b:H8 / w:H8。
 *   data-numbers="0" 默认不显示序号；data-coords="0" 默认不显示坐标；
 *   data-editable 表示可以点着落子；data-hash 表示把局面同步到地址栏
 *   （#h8i9j10 这样，刷新、分享都能回到同一局面）。
 *
 *   两个开关的状态记在 localStorage（zbx_board_numbers / zbx_board_coords），
 *   页面没写死 data-numbers / data-coords 时沿用上次的选择。
 *
 * 用法二，脚本式：
 *   var b = GomokuBoard.mount(el, {editable: true});
 *   b.place(7, 7);      // 落子（行列为 0 起的下标）
 *   b.next(); b.prev(); b.first(); b.last();
 *   b.undo(); b.clear(); b.setNumbers(false); b.setCoords(false);
 *   b.setColor('w');
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

    /* 两个开关的状态存在 localStorage，全站同一套 */
    var PREF = {
        numbers: 'zbx_board_numbers',
        coords: 'zbx_board_coords'
    };

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

        /* 落点提示：只在可摆棋时出现，鼠标移到空点上浮一个淡子 */
        this.ghost = svgEl('circle', {
            r: R, fill: 'none', stroke: 'none', 'pointer-events': 'none'
        });
        svg.appendChild(this.ghost);

        this.stoneLayer = svgEl('g', {});
        svg.appendChild(this.stoneLayer);

        svg.addEventListener('click', function (e) {
            var p = self.hit(e);
            if (!p) {
                return;
            }
            var idx = self.indexOf(p.i, p.j);
            if (self.editable && idx >= 0 && idx < self.cursor) {
                self.setCursor(idx + 1);       /* 点到棋子：跳回那一手 */
                return;
            }
            if (!self.editable) {
                return;
            }
            self.place(p.i, p.j, self.color || undefined);
        });

        if (this.editable) {
            svg.classList.add('is-editable');
            svg.addEventListener('mousemove', function (e) {
                self.hint(e);
            });
            svg.addEventListener('mouseleave', function () {
                self.ghost.setAttribute('fill', 'none');
                self.ghost.setAttribute('stroke', 'none');
            });
            /* 右键退掉最后一手（移动端长按也会触发 contextmenu） */
            svg.addEventListener('contextmenu', function (e) {
                e.preventDefault();
                self.undo();
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

        /* 右侧两个开关：序号、坐标 */
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

        bar.appendChild(box);
        this.bar = bar;
        this.host.appendChild(bar);
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

    Board.prototype.hint = function (e) {
        var p = this.hit(e);
        var empty = p && this.indexOf(p.i, p.j) < 0;
        if (!empty) {
            this.ghost.setAttribute('fill', 'none');
            this.ghost.setAttribute('stroke', 'none');
            return;
        }
        var color = this.color || (this.moves.length % 2 === 0 ? 'b' : 'w');
        this.ghost.setAttribute('cx', px(p.i));
        this.ghost.setAttribute('cy', py(p.j));
        this.ghost.setAttribute('fill', color === 'b' ? 'rgba(31,31,31,.22)' : 'rgba(255,255,255,.9)');
        this.ghost.setAttribute('stroke', color === 'b' ? 'rgba(31,31,31,.35)' : '#b3ab99');
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
        if (!this.moves.length) {
            return;
        }
        if (this.cursor < this.moves.length) {
            this.moves.length = this.cursor;
        }
        this.moves.pop();
        this.cursor = this.moves.length;
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

        this.updateButtons();
        if (this.checkbox && this.checkbox.checked !== this.numbers) {
            this.checkbox.checked = this.numbers;
        }
        if (this.coordBox && this.coordBox.checked !== this.coords) {
            this.coordBox.checked = this.coords;
        }
        this.syncHash();
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

    function mount(host, opts) {
        var board = new Board(host, opts);
        host._board = board;
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
