/*
 * 连珠杂箱 · 杂论意象词云
 * ------------------------------------------------------------
 * 词条与频次在 data/zalun-words.json（由后台「杂论词云」页读取）；
 * 管理员勾选的入云词表存在云数据库 zayu_docs 里：
 *     kind = 'zalun_word' , doc_id = 'cloud'
 *     data = { words: [{w, c, k}], updated, editor }
 * 访客页面只读这一行，然后本地排布成 SVG；云端读不到时保留页面里
 * 已经写好的静态词云（兜底，不闪空）。
 *
 *   window.ZBX_WORDCLOUD.render(el, words, opt)   把词表画进容器
 *   window.ZBX_WORDCLOUD.loadData()               读全量词表（后台用）
 *   window.ZBX_WORDCLOUD.loadSelection()          读当前入云词表
 *   window.ZBX_WORDCLOUD.KIND_LABEL               分类中文名
 */
(function () {
    'use strict';

    if (window.ZBX_WORDCLOUD) { return; }

    var SERIF = '"Noto Serif SC","Source Han Serif SC","Songti SC","STSong","SimSun","宋体",serif';

    var KIND_LABEL = {
        cloud: '已入云', theme: '主题词', chess: '棋局术语', noun: '名词/意象',
        verb: '动词', adj: '形容词', place: '专名/地名', name: '人名',
        func: '虚词/通用', other: '其他'
    };

    var PALETTE = {
        ink: ['#1e1b16', '#3a352d', '#565044'],
        warm: ['#8a6a39', '#b08d57', '#a8453f', '#4d7256'],
        grey: ['#6d6557', '#837a6b', '#8d8574']
    };

    function base() {
        return (document.body && document.body.getAttribute('data-base')) || '';
    }

    /* ---------- 云数据库 ---------- */

    function ensureCloud() {
        if (window.ZBX_SB_GET) { return window.ZBX_SB_GET(); }
        if (window.ZBX_SB_READY) { return window.ZBX_SB_READY; }
        if (!window.__zbxWordCloudLoad) {
            window.__zbxWordCloudLoad = 1;
            var s = document.createElement('script');
            s.src = base() + 'assets/supabase-client.js';
            s.async = true;
            document.head.appendChild(s);
        }
        return new Promise(function (resolve, reject) {
            var i = 0;
            (function poll() {
                if (window.ZBX_SB_READY) { resolve(window.ZBX_SB_READY); return; }
                if (i++ > 200) { reject(new Error('云服务加载超时')); return; }
                setTimeout(poll, 100);
            })();
        });
    }

    function loadSelection() {
        return ensureCloud().then(function (sb) {
            return sb.from('zayu_docs').select('data')
                .eq('kind', 'zalun_word').eq('doc_id', 'cloud').limit(1);
        }).then(function (res) {
            if (!res || res.error) { throw new Error((res && res.error && res.error.message) || '读取失败'); }
            var row = (res.data || [])[0];
            if (!row || !row.data || !Array.isArray(row.data.words)) { return null; }
            return row.data;
        });
    }

    function loadData() {
        return fetch(base() + 'data/zalun-words.json', { cache: 'no-cache' })
            .then(function (r) {
                if (!r.ok) { throw new Error('词表读取失败'); }
                return r.json();
            });
    }

    /* ---------- 排布 ---------- */

    var measurer = null;
    function measure(text, size, weight) {
        if (!measurer) {
            var c = document.createElement('canvas');
            measurer = c.getContext('2d');
        }
        measurer.font = weight + ' ' + size + 'px ' + SERIF;
        return measurer.measureText(text).width;
    }

    function sizeFor(count, min, max, top) {
        var t = (count - min) / (max - min || 1);
        return 15 + (top || 64) * Math.pow(t, 0.58);
    }

    function render(el, words, opt) {
        if (!el || !words || !words.length) { return null; }
        opt = opt || {};
        var n = words.length;
        var dense = n >= 34;              /* 词少的时候把画布压扁，免得四周全是空白 */
        var narrow = el.clientWidth < 560;
        var W = opt.width || (narrow ? 520 : 1000);
        var H = opt.height || (narrow ? (dense ? 720 : 520) : (dense ? 560 : 400));
        var GRID = 2;
        var gw = Math.ceil(W / GRID), gh = Math.ceil(H / GRID);
        var occ = new Uint8Array(gw * gh);
        var PAD = 4;

        function fits(x0, y0, w, h) {
            if (x0 < 4 || y0 < 4 || x0 + w > W - 4 || y0 + h > H - 4) { return false; }
            var gx0 = Math.max(0, Math.floor(x0 / GRID)), gy0 = Math.max(0, Math.floor(y0 / GRID));
            var gx1 = Math.min(gw - 1, Math.floor((x0 + w) / GRID));
            var gy1 = Math.min(gh - 1, Math.floor((y0 + h) / GRID));
            for (var gy = gy0; gy <= gy1; gy++) {
                var off = gy * gw;
                for (var gx = gx0; gx <= gx1; gx++) {
                    if (occ[off + gx]) { return false; }
                }
            }
            return true;
        }

        function mark(x0, y0, w, h) {
            var gx0 = Math.max(0, Math.floor(x0 / GRID)), gy0 = Math.max(0, Math.floor(y0 / GRID));
            var gx1 = Math.min(gw - 1, Math.floor((x0 + w) / GRID));
            var gy1 = Math.min(gh - 1, Math.floor((y0 + h) / GRID));
            for (var gy = gy0; gy <= gy1; gy++) {
                var off = gy * gw;
                for (var gx = gx0; gx <= gx1; gx++) { occ[off + gx] = 1; }
            }
        }

        var list = words.slice().sort(function (a, b) { return b.c - a.c; });
        var counts = list.map(function (d) { return d.c; });
        var cmin = Math.min.apply(null, counts), cmax = Math.max.apply(null, counts);
        var cx = W / 2, cy = H / 2;
        var out = [];
        var maxSize = narrow ? (dense ? 46 : 40) : (dense ? 64 : 78);

        for (var i = 0; i < list.length; i++) {
            var d = list[i];
            var fs = Math.round(sizeFor(d.c, cmin, cmax, maxSize) * 10) / 10;
            var weight = (d.c >= 14 ? 600 : 400);
            var vertical = (d.w.length >= 2 && d.c <= cmax * 0.25 && i % 3 === 0);
            var tw = measure(d.w, fs, weight) + PAD * 2 + 2;
            var th = fs * 1.34 + PAD + 3;
            var bw = vertical ? th : tw;
            var bh = vertical ? tw : th;
            var step = 1.9 + i * 0.03;
            var a = vertical ? 2.4 : 1.9;
            var ox = (narrow ? 0 : (i % 2 === 0 ? 26 : -26));
            var placed = false;
            for (var t = 0; t < 9000 && !placed; t += step) {
                var ang = t * 0.42 + i * 0.9;
                var r = a * Math.pow(t, 0.88);
                var x = cx + ox + r * Math.cos(ang) * (narrow ? 1.26 : 1.52) - bw / 2;
                var y = cy + r * Math.sin(ang) * (narrow ? 1.02 : 0.88) - bh / 2;
                if (fits(x, y, bw, bh)) {
                    mark(x, y, bw, bh);
                    out.push({
                        w: d.w, c: d.c, k: d.k, fs: fs, weight: weight, vertical: vertical,
                        x: x + bw / 2, y: y + bh / 2
                    });
                    placed = true;
                }
            }
        }

        var inkI = 0, warmI = 0, greyI = 0;
        var svg = ['<svg class="wc-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" ' +
            'aria-label="杂论栏目文章高频意象词云" xmlns="http://www.w3.org/2000/svg">'];
        out.forEach(function (o) {
            var pal, color;
            if (o.k === 'cloud' || o.k === 'theme' || o.k === 'chess') {
                pal = PALETTE.ink; color = pal[inkI++ % pal.length];
            } else if (o.k === 'func' || o.k === 'name' || o.k === 'place') {
                pal = PALETTE.grey; color = pal[greyI++ % pal.length];
            } else {
                pal = PALETTE.warm; color = pal[warmI++ % pal.length];
            }
            var tf = o.vertical ? ' transform="rotate(-90 ' + o.x.toFixed(1) + ' ' + o.y.toFixed(1) + ')"' : '';
            svg.push('<text x="' + o.x.toFixed(1) + '" y="' + o.y.toFixed(1) + '" font-size="' + o.fs +
                '" fill="' + color + '" font-weight="' + o.weight + '" text-anchor="middle" ' +
                'dominant-baseline="central"' + tf + ' data-n="' + o.c + '">' + esc(o.w) +
                '<title>「' + esc(o.w) + '」出现 ' + o.c + ' 次</title></text>');
        });
        svg.push('</svg>');
        el.innerHTML = svg.join('');
        return out.length;
    }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /* ---------- 访客页自动渲染 ---------- */

    function autoInit() {
        var el = document.getElementById('zc-canvas');
        if (!el) { return; }
        var last = null;
        var timer = null;

        function paint(data) {
            if (!data || !Array.isArray(data.words) || data.words.length < 4) { return; }
            last = data;
            try { render(el, data.words, {}); } catch (e) { /* 保留静态兜底 */ }
        }

        loadSelection().then(paint, function () { /* 云端不可用：保留静态词云 */ });

        window.addEventListener('resize', function () {
            if (!last) { return; }
            clearTimeout(timer);
            timer = setTimeout(function () {
                var w = el.clientWidth;
                if (Math.abs(w - (el.__wcw || 0)) > 80) { el.__wcw = w; paint(last); }
            }, 240);
        });
        el.__wcw = el.clientWidth;
    }

    window.ZBX_WORDCLOUD = {
        render: render,
        loadData: loadData,
        loadSelection: loadSelection,
        KIND_LABEL: KIND_LABEL,
        base: base
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoInit);
    } else {
        autoInit();
    }
})();
