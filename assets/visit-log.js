/*
 * 访问统计 - 连珠杂箱
 * ------------------------------------------------------------
 * 只做一件事：把「谁（匿名访客号 + IP）在哪个页面做了什么」记下来，
 * 交给 admin/ 里的统计面板汇总。数据经 ntfy 公共通道暂存 12 小时，
 * 由 .github/workflows/snapshot-visits.yml 定期归档进 data/visits.ndjson。
 *
 * 不记录：输入框里除搜索词以外的内容、密码、任何 cookie。
 * 退出统计：localStorage['zbx.notrack'] = '1'，浏览器开启 DNT 时也自动停。
 * 本脚本由 assets/layout.js 在每页末尾注入，无需各页单独引用。
 */
(function () {
    'use strict';

    var TOPIC = 'zbx_stats_9c4k2m7q';
    var PUBLISH = 'https://ntfy.sh/' + TOPIC;

    /* 本地预览、admin 页自身不统计 */
    if (location.protocol === 'file:') { return; }
    if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(location.hostname)) { return; }
    if (/^\/admin(\/|$)/.test(location.pathname)) { return; }
    try {
        if (localStorage.getItem('zbx.notrack') === '1') { return; }
    } catch (e) { /* 隐私模式下 localStorage 可能不可用，照常统计 */ }
    if (navigator.doNotTrack === '1' || window.doNotTrack === '1' ||
        navigator.msDoNotTrack === '1') { return; }

    function rand(n) {
        var s = '';
        var chars = '0123456789abcdef';
        for (var i = 0; i < n; i++) { s += chars.charAt(Math.floor(Math.random() * 16)); }
        return s;
    }

    function box(kind, key, val) {
        try {
            var s = window[kind];
            if (val === undefined) { return s.getItem(key); }
            s.setItem(key, val);
        } catch (e) { /* 忽略 */ }
        return null;
    }

    /* 访客号：同一浏览器长期不变；会话号：同一标签页内不变 */
    var vid = box('localStorage', 'zbx.vid');
    if (!vid) {
        vid = rand(12) + Date.now().toString(36).slice(-4);
        box('localStorage', 'zbx.vid', vid);
        box('localStorage', 'zbx.first', String(Date.now()));
    }
    var sid = box('sessionStorage', 'zbx.sid');
    if (!sid) {
        sid = rand(8);
        box('sessionStorage', 'zbx.sid', sid);
    }

    function path() {
        var p = location.pathname.replace(/\/index\.html?$/i, '/');
        return p || '/';
    }

    function referrer() {
        var r = document.referrer || '';
        if (!r) { return ''; }
        try {
            var u = new URL(r);
            if (u.host === location.host) { return ''; }
            return (u.host + u.pathname).slice(0, 90);
        } catch (e) {
            return r.slice(0, 90);
        }
    }

    function text(el) {
        var t = (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))) || '';
        if (!t) { t = el.innerText || el.textContent || ''; }
        t = t.replace(/\s+/g, ' ').trim();
        return t.slice(0, 60);
    }

    /* ---------------- 发送 ---------------- */

    var pending = [];
    var ip = null;
    try { ip = sessionStorage.getItem('zbx.ip'); } catch (e) { ip = null; }
    var ipWait = (ip === null);

    function post(obj) {
        obj.h = location.hostname;
        /* IP 是异步取的：排队期间拿到的，发送时补上 */
        if (ip && !obj.i) { obj.i = ip; }
        var body;
        try {
            body = JSON.stringify(obj);
        } catch (e) {
            return;
        }
        if (body.length > 3200) {
            /* 超长就把最占地方的明细砍掉，别把整条丢掉 */
            if (obj.c) { obj.c = obj.c.slice(-8); }
            if (obj.q) { obj.q = obj.q.slice(-4); }
            obj.ti = (obj.ti || '').slice(0, 60);
            try { body = JSON.stringify(obj); } catch (e2) { return; }
        }
        /* sendBeacon 用 Blob + text/plain，跨域不触发预检 */
        try {
            if (navigator.sendBeacon) {
                var blob = new Blob([body], { type: 'text/plain;charset=UTF-8' });
                if (navigator.sendBeacon(PUBLISH, blob)) { return true; }
            }
        } catch (e) { /* 落到 fetch */ }
        try {
            fetch(PUBLISH, {
                method: 'POST',
                mode: 'no-cors',
                keepalive: true,
                headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
                body: body
            });
            return true;
        } catch (e2) {
            return false;
        }
    }

    function flush() {
        while (pending.length) { post(pending.shift()); }
    }

    function send(obj) {
        obj.v = vid;
        obj.s = sid;
        obj.t = obj.t || Date.now();
        if (ip) { obj.i = ip; }
        if (ipWait) {
            pending.push(obj);
            if (pending.length > 6) { pending.shift(); }
            return;
        }
        post(obj);
    }

    /* IP 由公共回显接口取，取不到就留空（面板显示「未取到」） */
    (function resolveIp() {
        if (!ipWait) { return; }
        var done = false;
        var timer = setTimeout(function () { finish(''); }, 2500);
        function finish(value) {
            if (done) { return; }
            done = true;
            clearTimeout(timer);
            ip = value || '';
            ipWait = false;
            try { sessionStorage.setItem('zbx.ip', ip); } catch (e) { /* 忽略 */ }
            flush();
        }
        var list = [
            'https://api.ipify.org?format=json',
            'https://api.ip.sb/geoip',
            'https://ipapi.co/json/'
        ];
        (function next(i) {
            if (done || i >= list.length) { if (!done) { finish(''); } return; }
            fetch(list[i], { mode: 'cors', cache: 'no-store' })
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    var v = d && (d.ip || d.query || d.address);
                    if (v) { finish(String(v)); } else { next(i + 1); }
                })
                .catch(function () { next(i + 1); });
        })(0);
    })();

    /* ---------------- 采集 ---------------- */

    var clicks = [];
    var searches = [];
    var start = Date.now();
    var maxScroll = 0;
    var currentPath = path();
    var flushTimer = null;

    /* 点击 / 搜索攒 1.2 秒就发一次，别等用户关页面——那时候可能来不及了 */
    function flushClicks() {
        flushTimer = null;
        if (!clicks.length && !searches.length) { return; }
        var c = clicks.splice(0, clicks.length);
        var q = searches.splice(0, searches.length);
        send({ k: 'clk', p: currentPath, c: c, q: q });
    }

    function later() {
        if (flushTimer) { return; }
        flushTimer = setTimeout(flushClicks, 1200);
    }

    function pv() {
        start = Date.now();
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        clicks = [];
        searches = [];
        maxScroll = 0;
        currentPath = path();
        send({
            k: 'pv',
            p: currentPath,
            ti: (document.title || '').slice(0, 80),
            r: referrer(),
            w: window.innerWidth || 0,
            l: (navigator.language || '').slice(0, 12),
            ua: (navigator.userAgent || '').slice(0, 160)
        });
        window.addEventListener('scroll', onScroll, { passive: true });
    }

    function onScroll() {
        var doc = document.documentElement;
        var h = doc.scrollHeight - window.innerHeight;
        var v = h > 60 ? Math.round(Math.min(1, (window.pageYOffset || doc.scrollTop) / h) * 100) : 100;
        if (v > maxScroll) { maxScroll = v; }
    }

    function bye() {
        var dwell = Math.round((Date.now() - start) / 1000);
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        if (dwell < 1 && !clicks.length && !searches.length) { return; }
        send({
            k: 'bye',
            p: currentPath,
            d: dwell,
            sc: maxScroll,
            c: clicks.slice(-12),
            q: searches.slice(-6)
        });
        start = Date.now();
        clicks = [];
        searches = [];
        maxScroll = 0;
    }

    document.addEventListener('click', function (e) {
        var el = e.target;
        while (el && el.nodeType === 1 && el !== document.body) {
            var tag = el.nodeName.toLowerCase();
            if (tag === 'a' || tag === 'button' ||
                (el.getAttribute && el.getAttribute('role') === 'button') ||
                tag === 'input' && /^(button|submit|checkbox|radio)$/i.test(el.type || '')) {
                break;
            }
            el = el.parentNode;
        }
        if (!el || el === document.body || el.nodeType !== 1) { return; }
        var tag = el.nodeName.toLowerCase();
        var item = { x: text(el) };
        if (tag === 'a') {
            var href = el.getAttribute('href') || '';
            if (href && href.charAt(0) !== '#') {
                try {
                    var u = new URL(el.href, location.href);
                    item.h = (u.host === location.host ? '' : u.host + ' ') + u.pathname.slice(0, 70);
                } catch (err) {
                    item.h = href.slice(0, 70);
                }
            }
        } else if (tag === 'input') {
            item.x = (el.value || el.type || '').slice(0, 30);
        }
        if (clicks.length < 24) { clicks.push(item); }
        later();
    }, true);

    document.addEventListener('submit', function (e) {
        var f = e.target;
        if (!f || f.nodeName.toLowerCase() !== 'form') { return; }
        var parts = [];
        var els = f.querySelectorAll('input, select');
        for (var i = 0; i < els.length && i < 4; i++) {
            var el = els[i];
            var type = (el.type || '').toLowerCase();
            if (type === 'password' || type === 'hidden' || type === 'file') { continue; }
            var v = (el.value || '').replace(/\s+/g, ' ').trim().slice(0, 40);
            var key = el.getAttribute('aria-label') || el.name || el.placeholder || el.id || '';
            if (v) { parts.push((key ? key + '=' : '') + v); }
        }
        if (parts.length && searches.length < 12) {
            searches.push(parts.join(' · '));
            later();
        }
    }, true);

    /* ---------------- 生命周期 ---------------- */

    pv();

    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') { bye(); }
    });
    window.addEventListener('pagehide', bye);

    /* layout.js 的站内无刷新跳转：换页前先把上一页收尾，再记一次新的浏览 */
    document.addEventListener('zbx:navigate', function (e) {
        var from = e && e.detail && e.detail.from;
        if (from && from !== currentPath) { bye(); }
        pv();
    });

    /* 供别的脚本手动打点：window.zbxTrack('事件名', '说明') */
    window.zbxTrack = function (kind, detail) {
        send({ k: String(kind || 'evt').slice(0, 20), p: path(), x: String(detail || '').slice(0, 120) });
    };
})();
