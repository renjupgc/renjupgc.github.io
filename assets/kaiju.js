/*
 * 连珠杂箱 - 打谱页的「开局」小节
 * ------------------------------------------------------------
 * 把 assets/openings.js 的判定接到棋盘上：摆到第三手就报开局名，同时拿当前
 * 局面去 assets/openings-data.js 的语料里找同型局。点一行，那一局就摆回棋盘，
 * 地址栏跟着变（局面链接本来就是棋盘自己写的），可以直接发给棋友。
 *
 * 站内换页只换 <main>，本文件不会重跑，所以用 MutationObserver 盯着「开局」
 * 这一节重新出现时再挂一次；棋盘由 board.js 自己重新挂，这里只负责等它。
 */
(function () {
    'use strict';

    var K = window.ZBX_OPENINGS;
    var DATA = window.ZBX_OPENING_GAMES;

    function boot() {
        var list = document.getElementById('kj-list');
        var nameBox = document.getElementById('kj-name');
        if (!K || !list || !nameBox || list.dataset.ready === '1') {
            return;
        }
        list.dataset.ready = '1';

        var codeBox = document.getElementById('kj-code');
        var whyBox = document.getElementById('kj-why');
        var metaBox = document.getElementById('kj-meta');
        var noteBox = document.getElementById('kj-side-note');
        var bookBox = document.getElementById('kj-book');
        var host = document.querySelector('.board[data-board]');

        var games = (DATA && DATA.games) || [];
        var total = (DATA && DATA.total) || 0;

        /* ---------- 语料概况：一句话说清「能比的有多少」 ---------- */

        if (noteBox) {
            if (!games.length) {
                noteBox.textContent = '';
            } else {
                var t = K.tally(games).slice(0, 3).map(function (x) {
                    return x.name + ' ' + x.n;
                }).join(' · ');
                noteBox.textContent = '语料 ' + games.length + ' 局（全站 ' + total +
                    ' 局里录了手顺的）· ' + t;
            }
        }

        /* ---------- 二十六种：点一个就摆上去 ---------- */

        if (bookBox && bookBox.dataset.ready !== '1') {
            bookBox.dataset.ready = '1';
            var fams = [['direct', '直指'], ['indirect', '斜指']];
            bookBox.innerHTML = fams.map(function (f) {
                var cells = K.book().filter(function (e) { return e.family === f[0]; })
                    .map(function (e) {
                        return '<button class="kj-chip" type="button" data-book="' +
                            e.code + '"><b>' + e.name + '</b><i>' + e.code + '</i></button>';
                    }).join('');
                return '<div class="kj-fam"><span>' + f[1] + '</span>' + cells + '</div>';
            }).join('');
        }

        /* ---------- 与棋盘的往返 ---------- */

        function board() {
            return host && window.GomokuBoard ? window.GomokuBoard.get(host) : null;
        }

        function withBoard(fn, tries) {
            var b = board();
            if (b) { fn(b); return; }
            if ((tries || 0) < 15) {
                window.setTimeout(function () { withBoard(fn, (tries || 0) + 1); }, 60);
            }
        }

        function movesOf(b) {
            return b.getMoves();
        }

        /* ---------- 渲染 ---------- */

        function paintName(moves) {
            var r = K.classify(moves);
            nameBox.textContent = r.ok ? r.full : '—';
            codeBox.textContent = r.ok ? r.code : '';
            whyBox.textContent = r.why || '摆到第三手，这里会给出开局名。';

            var bits = [];
            if (r.ok) {
                bits.push(r.familyName);
                bits.push(r.star + '形');
                bits.push(r.note);
                bits.push('第三手 ' + r.third);
                if (!r.center) { bits.push('首手不在天元，按首手为原点判'); }
            } else if (r.familyName) {
                bits.push(r.familyName);
            }
            metaBox.textContent = bits.join(' · ');
        }

        function paintList(moves) {
            if (!games.length) {
                list.innerHTML = '<li class="kj-empty">没有可比的对局语料</li>';
                return;
            }
            if (moves.length < 3) {
                list.innerHTML = '<li class="kj-empty">摆几手再看</li>';
                return;
            }
            var rows = K.similar(moves, games, { n: 10 }).slice(0, 6);
            list.innerHTML = rows.map(function (r) {
                var g = r.game;
                var c = K.classify(K.decode(g.m));
                var sub = [];
                if (c.ok) { sub.push(c.name); }
                sub.push(g.d);
                if (g.r) { sub.push('第 ' + g.r + ' 轮'); }
                if (g.res) { sub.push(g.res); }
                return '<li><button class="kj-row" type="button" data-game="' + g.id + '">' +
                    '<span class="kj-score">' + r.score.toFixed(0) + '</span>' +
                    '<span class="kj-who">' + esc(g.a) + '<i>对</i>' + esc(g.b) + '</span>' +
                    '<span class="kj-sub">' + esc(sub.join(' · ')) + '</span>' +
                    '</button></li>';
            }).join('');
        }

        function esc(s) {
            return String(s == null ? '' : s).replace(/[&<>"]/g, function (ch) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
            });
        }

        function paint(b) {
            var moves = movesOf(b);
            paintName(moves);
            paintList(moves);
        }

        /* ---------- 交互 ---------- */

        list.addEventListener('click', function (e) {
            var btn = e.target.closest ? e.target.closest('[data-game]') : null;
            if (!btn) { return; }
            var id = Number(btn.dataset.game);
            var g = games.filter(function (x) { return x.id === id; })[0];
            if (!g) { return; }
            withBoard(function (b) {
                b.setMoves(K.decode(g.m));
                b.last();
                paint(b);
            });
        });

        if (bookBox) {
            bookBox.addEventListener('click', function (e) {
                var btn = e.target.closest ? e.target.closest('[data-book]') : null;
                if (!btn) { return; }
                var want = btn.dataset.book;
                var entry = K.book().filter(function (x) { return x.code === want; })[0];
                if (!entry) { return; }
                withBoard(function (b) {
                    b.setMoves(entry.stones);
                    b.last();
                    paint(b);
                });
            });
        }

        withBoard(function (b) {
            paint(b);
            b.onChange(function () { paint(b); });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
    if (window.MutationObserver) {
        new window.MutationObserver(boot).observe(document.body, { childList: true, subtree: true });
    }
})();
