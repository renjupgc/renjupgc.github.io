/*
 * 棋手成绩卡
 * ------------------------------------------------------------
 * 把棋手页上的几个数字画成一张图：等级分、段位、名次、胜负环、二维码。
 * 群里发战绩，截图往往糊，还带着别人的头像；这张图是干净的。
 *
 * - 数据全部从当前页面读，不额外请求接口；
 * - 二维码按需加载 qr.js（约 10KB），首屏不为它付钱；万一没加载上，卡片照出，只是少了码；
 * - 点击事件挂在整个文档上，所以站内无刷新换页之后按钮照样好使。
 */
(function () {
    'use strict';

    var SELF = document.currentScript;
    var BASE = SELF && SELF.src ? SELF.src.replace(/[^/]*$/, '') : '../../assets/';

    var W = 1000, H = 1250;
    var C = {
        paper: '#f6f2e9',
        card: '#fffdf7',
        ink: '#1e1b16',
        ink2: '#3a352d',
        muted: '#837a6b',
        faint: '#a79c88',
        line: '#e2d9c6',
        gold: '#b08d57',
        goldDeep: '#8a6a39',
        goldTint: '#f5ecd8',
        win: '#a8453f',
        loss: '#4d7256',
        draw: '#8d8574'
    };
    var SERIF = '"Noto Serif CJK SC","Noto Serif SC","Songti SC","SimSun",serif';
    var SANS = '"Noto Sans CJK SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif';
    var MONO = '"SF Mono","JetBrains Mono",Consolas,monospace';

    function text(el, sel) {
        var n = el.querySelector(sel);
        return n ? n.textContent.trim() : '';
    }

    function num(s) {
        var m = String(s).replace(/[，,\s]/g, '').match(/-?\d+(\.\d+)?/);
        return m ? parseFloat(m[0]) : null;
    }

    /* 从页面读一位棋手的资料。页面结构见 tools/build_players.py。 */
    function profile() {
        var main = document.querySelector('main');
        if (!main) { return null; }
        var name = text(main, '.article-title');
        if (!name) { return null; }

        var meta = Array.prototype.map.call(
            main.querySelectorAll('.article-header .article-meta span'),
            function (s) { return s.textContent.trim(); });

        var stats = {};
        Array.prototype.forEach.call(main.querySelectorAll('.player-stats .ps'), function (ps) {
            var k = text(ps, '.ps-k');
            var v = text(ps, '.ps-v');
            if (k) { stats[k] = v; }
        });

        var wdl = (stats['胜 / 和 / 负'] || '').split('/').map(function (x) { return num(x); });

        /* 段位写在「人物」一节的开头。那一栏偶尔放的是职务或名次（「协会执行会长」
           「公开组冠军」），只有真像段位／棋士等级的才往卡片上放。 */
        var danEl = main.querySelector('.p-renwu .rh-dan');
        var dan = danEl ? danEl.textContent.trim() : '';
        if (!/段|棋士/.test(dan) || dan.indexOf('未载') >= 0) { dan = ''; }

        return {
            name: name,
            dan: dan,
            region: meta[1] && meta[1] !== '—' ? meta[1] : '',
            uni: meta[2] && meta[2] !== '—' ? meta[2] : '',
            rating: stats['等级分'] || '',
            rank: stats['榜上名次'] || '',
            games: stats['对局'] || '',
            wins: wdl[0] || 0,
            draws: wdl[1] || 0,
            losses: wdl[2] || 0,
            events: stats['参赛'] || '',
            asOf: (function () {
                var m = document.body.textContent.match(/等级分截至\s*(\d{4}-\d{2}-\d{2})/);
                return m ? m[1] : '';
            })()
        };
    }

    /* ---------- 画 ---------- */

    function roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    function drawGrid(ctx) {
        /* 淡淡的棋枰格线，和首页、分享图一个调子 */
        ctx.save();
        ctx.strokeStyle = 'rgba(176,141,87,0.10)';
        ctx.lineWidth = 1;
        for (var x = 0; x < W; x += 60) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        }
        for (var y = 0; y < H; y += 60) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        }
        ctx.restore();
    }

    function drawDonut(ctx, cx, cy, r, thick, p) {
        var total = p.wins + p.draws + p.losses;
        if (!total) {
            ctx.strokeStyle = C.line;
            ctx.lineWidth = thick;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.stroke();
            return;
        }
        var parts = [
            [p.wins, C.win],
            [p.draws, C.draw],
            [p.losses, C.loss]
        ];
        var start = -Math.PI / 2;
        parts.forEach(function (part) {
            var val = part[0];
            if (!val) { return; }
            var angle = (val / total) * Math.PI * 2;
            ctx.beginPath();
            ctx.strokeStyle = part[1];
            ctx.lineWidth = thick;
            ctx.lineCap = 'butt';
            ctx.arc(cx, cy, r, start + 0.012, start + angle - 0.012);
            ctx.stroke();
            start += angle;
        });
    }

    function drawCard(p, qr) {
        var cv = document.createElement('canvas');
        var scale = 2;
        cv.width = W * scale;
        cv.height = H * scale;
        var ctx = cv.getContext('2d');
        ctx.scale(scale, scale);

        ctx.fillStyle = C.paper;
        ctx.fillRect(0, 0, W, H);
        drawGrid(ctx);

        /* 卡片 */
        ctx.save();
        ctx.shadowColor = 'rgba(74,56,26,0.16)';
        ctx.shadowBlur = 28;
        ctx.shadowOffsetY = 10;
        ctx.fillStyle = C.card;
        roundRect(ctx, 40, 40, W - 80, H - 80, 28);
        ctx.fill();
        ctx.restore();
        ctx.strokeStyle = C.line;
        ctx.lineWidth = 1;
        roundRect(ctx, 40.5, 40.5, W - 81, H - 81, 28);
        ctx.stroke();

        var L = 96;

        /* 抬头 */
        ctx.fillStyle = C.faint;
        ctx.font = '500 15px ' + SANS;
        ctx.textBaseline = 'alphabetic';
        ctx.fillText('连 珠 杂 箱  ·  棋 手 成 绩 卡', L, 132);

        /* 姓名 */
        ctx.fillStyle = C.ink;
        ctx.font = '600 66px ' + SERIF;
        ctx.fillText(p.name, L, 236);

        /* 段位：有段位就在名字右边挂一枚小印；名字太长放不下时并入下一行 */
        var nameW = ctx.measureText(p.name).width;
        var danInline = false;
        if (p.dan) {
            ctx.save();
            ctx.font = '500 22px ' + SANS;
            var dw = ctx.measureText(p.dan).width;
            ctx.restore();

            var bx = L + nameW + 26;
            var bw = dw + 38;
            if (bx + bw <= W - L - 170) {          /* 右边留出给名次的位置 */
                danInline = true;
                ctx.fillStyle = C.goldTint;
                roundRect(ctx, bx, 184, bw, 46, 10);
                ctx.fill();
                ctx.strokeStyle = 'rgba(176,141,87,0.55)';
                ctx.lineWidth = 1.4;
                roundRect(ctx, bx + 0.5, 184.5, bw - 1, 45, 10);
                ctx.stroke();

                ctx.fillStyle = C.goldDeep;
                ctx.font = '500 22px ' + SANS;
                ctx.textAlign = 'center';
                ctx.fillText(p.dan, bx + bw / 2, 215);
                ctx.textAlign = 'left';
            }
        }

        /* 地区、学校 */
        var sub = [danInline ? '' : p.dan, p.region, p.uni].filter(Boolean).join('　·　');
        ctx.fillStyle = danInline ? C.muted : C.ink2;
        ctx.font = '20px ' + SANS;
        ctx.fillText(sub || '—', L, 288);

        /* 分隔线 */
        ctx.strokeStyle = C.gold;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(L, 330);
        ctx.lineTo(L + 120, 330);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = C.line;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(L + 136, 330);
        ctx.lineTo(W - L, 330);
        ctx.stroke();

        /* 等级分 */
        ctx.fillStyle = C.muted;
        ctx.font = '16px ' + SANS;
        ctx.fillText('等 级 分', L, 392);

        var rating = p.rating && p.rating !== '—' ? p.rating : '—';
        ctx.fillStyle = p.rating && p.rating !== '—' ? C.ink : C.faint;
        ctx.font = '600 104px ' + MONO;
        ctx.fillText(rating, L - 4, 492);

        /* 名次 */
        if (p.rank) {
            ctx.textAlign = 'right';
            ctx.fillStyle = C.goldDeep;
            ctx.font = '500 34px ' + SERIF;
            ctx.fillText(p.rank, W - L, 470);
            ctx.fillStyle = C.faint;
            ctx.font = '15px ' + SANS;
            ctx.fillText(p.events ? '参赛 ' + p.events : '', W - L, 498);
            ctx.textAlign = 'left';
        }

        /* 胜负环 */
        var cx = 330, cy = 800, r = 116, thick = 34;
        drawDonut(ctx, cx, cy, r, thick, p);

        ctx.textAlign = 'center';
        ctx.fillStyle = C.ink;
        ctx.font = '500 40px ' + MONO;
        ctx.fillText(String(p.wins + p.draws + p.losses), cx, cy + 4);
        ctx.fillStyle = C.faint;
        ctx.font = '15px ' + SANS;
        ctx.fillText('局', cx, cy + 32);
        ctx.textAlign = 'left';

        ctx.fillStyle = C.muted;
        ctx.font = '15px ' + SANS;
        ctx.fillText('胜 和 负', cx, cy + r + 52);

        /* 图例 */
        var lx = 520, ly = 704;
        var rows = [['胜', p.wins, C.win], ['和', p.draws, C.draw], ['负', p.losses, C.loss]];
        rows.forEach(function (row, i) {
            var y = ly + i * 62;
            ctx.fillStyle = row[2];
            roundRect(ctx, lx, y - 14, 14, 14, 3);
            ctx.fill();
            ctx.fillStyle = C.muted;
            ctx.font = '16px ' + SANS;
            ctx.fillText(row[0], lx + 26, y);
            ctx.fillStyle = C.ink2;
            ctx.font = '600 30px ' + MONO;
            ctx.fillText(String(row[1]), lx + 62, y + 2);
            ctx.strokeStyle = C.line;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(lx, y + 24);
            ctx.lineTo(lx + 180, y + 24);
            ctx.stroke();
        });

        /* 二维码 */
        var qs = 208, qx = W - L - qs, qy = 620;
        if (qr) {
            ctx.fillStyle = '#ffffff';
            roundRect(ctx, qx - 14, qy - 14, qs + 28, qs + 28, 12);
            ctx.fill();
            ctx.strokeStyle = C.line;
            ctx.stroke();

            var n = qr.size;
            var cell = qs / n;
            ctx.fillStyle = C.ink;
            for (var y = 0; y < n; y++) {
                for (var x = 0; x < n; x++) {
                    if (qr.get(x, y)) {
                        ctx.fillRect(qx + x * cell, qy + y * cell,
                            Math.ceil(cell), Math.ceil(cell));
                    }
                }
            }
            ctx.fillStyle = C.faint;
            ctx.font = '14px ' + SANS;
            ctx.textAlign = 'center';
            ctx.fillText('扫码看对局记录', qx + qs / 2, qy + qs + 42);
            ctx.textAlign = 'left';
        } else {
            ctx.fillStyle = C.faint;
            ctx.font = '14px ' + SANS;
            ctx.fillText('（二维码未能生成）', qx, qy + qs / 2);
        }

        /* 页脚 */
        ctx.strokeStyle = C.line;
        ctx.beginPath();
        ctx.moveTo(L, H - 148);
        ctx.lineTo(W - L, H - 148);
        ctx.stroke();

        ctx.fillStyle = C.faint;
        ctx.font = '15px ' + SANS;
        ctx.fillText('renjupgc.github.io' + (p.asOf ? '　·　等级分截至 ' + p.asOf : ''),
            L, H - 108);
        ctx.textAlign = 'right';
        ctx.fillStyle = C.goldDeep;
        ctx.font = '15px ' + SANS;
        ctx.fillText('连珠杂箱', W - L, H - 108);
        ctx.textAlign = 'left';

        return cv;
    }

    /* ---------- 弹层 ---------- */

    function overlay(cv, filename) {
        var old = document.getElementById('pcard-modal');
        if (old && old.parentNode) { old.parentNode.removeChild(old); }

        var box = document.createElement('div');
        box.id = 'pcard-modal';
        box.className = 'pcard-modal';
        box.innerHTML =
            '<div class="pcard-panel" role="dialog" aria-modal="true" aria-label="成绩卡">' +
            '<div class="pcard-head"><b>成绩卡</b><span>右键或长按图片可另存</span>' +
            '<button class="pcard-x" type="button" aria-label="关闭">×</button></div>' +
            '<div class="pcard-shot"></div>' +
            '<div class="pcard-acts">' +
            '<button class="pcard-btn is-primary" type="button" data-save>下载图片</button>' +
            '<button class="pcard-btn" type="button" data-close>关闭</button>' +
            '</div></div>';

        var shot = box.querySelector('.pcard-shot');
        cv.className = 'pcard-img';
        cv.setAttribute('aria-label', '成绩卡预览');
        shot.appendChild(cv);

        function close() {
            if (box.parentNode) { box.parentNode.removeChild(box); }
            document.removeEventListener('keydown', onKey);
        }
        function onKey(e) {
            if (e.key === 'Escape') { close(); }
        }

        box.querySelector('[data-close]').addEventListener('click', close);
        box.querySelector('.pcard-x').addEventListener('click', close);
        box.addEventListener('click', function (e) {
            if (e.target === box) { close(); }
        });
        box.querySelector('[data-save]').addEventListener('click', function () {
            if (!cv.toBlob) { return; }
            cv.toBlob(function (blob) {
                var url = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
            }, 'image/png');
        });

        document.body.appendChild(box);
        document.addEventListener('keydown', onKey);
        box.querySelector('[data-save]').focus();
    }

    /* ---------- 入口 ---------- */

    function withQR(cb) {
        if (window.ZBXQR) { return cb(window.ZBXQR); }
        var s = document.createElement('script');
        s.src = BASE + 'qr.js';
        s.onload = function () { cb(window.ZBXQR || null); };
        s.onerror = function () { cb(null); };
        document.head.appendChild(s);
    }

    function open() {
        var p = profile();
        if (!p) { return; }
        /* 页面自己的地址，中文路径已经是百分号编码，二维码里直接用 */
        var url = location.origin + location.pathname;

        withQR(function (QR) {
            var qr = null;
            if (QR) {
                try {
                    qr = QR.matrix(url);
                } catch (e) {
                    qr = null;
                }
            }
            overlay(drawCard(p, qr), p.name + '-成绩卡.png');
        });
    }

    document.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('[data-card]') : null;
        if (!btn) { return; }
        e.preventDefault();
        open();
    });

    /* 直接带 #card 打开链接时自动弹出成绩卡，方便把「展开图」的地址发出去 */
    function autoOpen() {
        if (location.hash === '#card' && profile()) { open(); }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoOpen);
    } else {
        window.setTimeout(autoOpen, 0);
    }
    document.addEventListener('zbx:page', autoOpen);

    window.ZBX_CARD = { open: open, draw: drawCard, profile: profile };
})();
