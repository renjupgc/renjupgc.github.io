/*
 * 连珠杂箱 - 全站共用布局模板
 * ------------------------------------------------------------
 * 页头（站名）、导航栏与右下角的音乐盒集中在这里维护，各页面只保留正文。
 *
 * 页面用法：
 *   <body data-nav="杂史" data-base="../">
 *     <div class="container">
 *       <div id="site-header"></div>
 *       <main> 正文 </main>
 *     </div>
 *     <script src="../assets/layout.js"></script>
 *   </body>
 *
 * data-nav  当前页面所属栏目（对应导航文字），用于高亮
 * data-base 相对站点根目录的前缀；根目录页面留空，子目录页面写 "../"
 */

(function () {
    'use strict';

    var SITE = {
        title: '连珠杂箱',
        sub: '连珠 · 五子棋'
    };

    /* 站标：棋枰上的一子，页头与 favicon 共用同一套线条 */
    var MARK = '<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">' +
        '<path d="M11 3v26M21 3v26M3 11h26M3 21h26" fill="none" ' +
        'stroke="#c9a86f" stroke-width="1.3" opacity="0.72"/>' +
        '<circle cx="16" cy="16" r="4.7" fill="#f2d9a8"/>' +
        '<circle cx="16" cy="16" r="4.7" fill="none" stroke="#17150f" ' +
        'stroke-width="0.9" opacity="0.28"/>' +
        '</svg>';

    /*
     * 页脚：共建署名 + 友情链接，三个链接都指向对应公众号的主页
     * （__biz 取自各号文章页，在微信里点开会直接进公众号）。
     */
    var FOOTER = {
        copy: '2026 由潘冠臣创作',
        links: [
            {
                text: '连珠杂论',
                href: 'https://mp.weixin.qq.com/mp/profile_ext?action=home&__biz=Mzk0MjY4NDIyNA==&scene=124#wechat_redirect'
            },
            {
                text: '中国五子棋',
                href: 'https://mp.weixin.qq.com/mp/profile_ext?action=home&__biz=Mzk0OTQxNTc5Mw==&scene=124#wechat_redirect'
            },
            {
                text: '洛阳五子棋',
                href: 'https://mp.weixin.qq.com/mp/profile_ext?action=home&__biz=Mzk0NTQ0NjMxNQ==&scene=124#wechat_redirect'
            }
        ]
    };

    var NAV = [
        { text: '首页', href: 'index.html' },
        { text: '杂论', href: 'zalun.html' },
        { text: '杂史', href: 'zashi.html' },
        { text: '杂豫', href: 'zayu.html' },
        { text: '杂技', href: 'zaji.html' },
        { text: '关于', href: 'index.html#about' }
    ];

    var base = document.body.getAttribute('data-base') || '';
    var active = document.body.getAttribute('data-nav') || '';

    function renderHeader() {
        var navHtml = NAV.map(function (item) {
            var isActive = item.text === active;
            var href = item.href === '#' ? '#' : base + item.href;
            return '<a href="' + href + '"' +
                (isActive ? ' class="active"' : '') +
                '>' + item.text + '</a>';
        }).join('');

        var html =
            '<header class="site-head">\n' +
            '  <div class="site-head-inner">\n' +
            '    <a class="brand" href="' + base + 'index.html">\n' +
            '      <span class="brand-mark">' + MARK + '</span>\n' +
            '      <span class="brand-text">\n' +
            '        <span class="brand-name">' + SITE.title + '</span>\n' +
            '        <span class="brand-sub">' + SITE.sub + '</span>\n' +
            '      </span>\n' +
            '    </a>\n' +
            '    <nav class="site-nav">' + navHtml + '</nav>\n' +
            '  </div>\n' +
            '</header>';

        var mount = document.getElementById('site-header');
        if (mount) {
            mount.innerHTML = html;
        }
        watchSticky();
    }

    /* 页脚只挂在最外层容器末尾；无刷新换页不动 <main> 以外的部分，所以只渲染一次 */
    function renderFooter() {
        var host = document.querySelector('.container');
        if (!host) {
            return;
        }
        var el = document.getElementById('site-footer');
        if (!el) {
            el = document.createElement('footer');
            el.id = 'site-footer';
            el.className = 'site-footer';
            host.appendChild(el);
        }

        var links = FOOTER.links.map(function (item) {
            /* href 里带 & ，写进属性要转义，否则 HTML 校验不过 */
            return '<a href="' + item.href.replace(/&/g, '&amp;') +
                '" target="_blank" rel="noopener">' + item.text + '</a>';
        }).join('');

        el.innerHTML =
            '<p class="sf-copy">' + FOOTER.copy + '</p>' +
            '<p class="sf-links"><span class="sf-k">友情链接</span>' + links + '</p>';
    }

    /* 页头滚动后才显现分隔线与投影，静止时保持通透 */
    function watchSticky() {
        var head = document.querySelector('.site-head');
        if (!head || head.dataset.watched === '1') {
            return;
        }
        head.dataset.watched = '1';

        function sync() {
            head.classList.toggle('is-stuck', window.pageYOffset > 8);
        }

        window.addEventListener('scroll', sync, { passive: true });
        sync();
    }

    /* 站点图标：避免每页手写 <link>，统一在脚本里挂上 */
    function renderIcon() {
        if (document.querySelector('link[rel="icon"]')) {
            return;
        }
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
            '<rect width="32" height="32" rx="7" fill="#1e1b16"/>' +
            '<path d="M11 4v24M21 4v24M4 11h24M4 21h24" fill="none" ' +
            'stroke="#c9a86f" stroke-width="1.2" opacity="0.55"/>' +
            '<circle cx="16" cy="16" r="4.4" fill="#f0d7a6"/>' +
            '</svg>';
        var link = document.createElement('link');
        link.rel = 'icon';
        link.type = 'image/svg+xml';
        link.href = 'data:image/svg+xml,' + encodeURIComponent(svg);
        document.head.appendChild(link);
    }

    /* 长文阅读进度：顶部一条赭金细线 */
    function renderProgress() {
        var bar = document.getElementById('read-progress');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'read-progress';
            bar.className = 'read-progress';
            bar.setAttribute('aria-hidden', 'true');
            document.body.appendChild(bar);
        }

        function sync() {
            var article = document.querySelector('main article');
            if (!article) {
                bar.style.transform = 'scaleX(0)';
                return;
            }
            var top = article.offsetTop;
            var total = article.offsetHeight - window.innerHeight * 0.6;
            var done = (window.pageYOffset - top) / (total > 1 ? total : 1);
            bar.style.transform = 'scaleX(' + Math.min(1, Math.max(0, done)) + ')';
        }

        if (!window.ZBX_PROGRESS) {
            window.ZBX_PROGRESS = 1;
            window.addEventListener('scroll', sync, { passive: true });
            window.addEventListener('resize', sync);
        }
        sync();
    }

    renderHeader();
    renderFooter();
    renderIcon();
    renderProgress();

    /* 供站内无刷新跳转（见文件末尾）在换页后重新高亮导航 */
    window.ZBX = {
        renderHeader: function () {
            base = document.body.getAttribute('data-base') || '';
            active = document.body.getAttribute('data-nav') || '';
            renderHeader();
            renderFooter();
            renderProgress();
        }
    };
})();

/*
 * 音乐盒
 * ------------------------------------------------------------
 * 全站常驻的悬浮音乐盒，进站尝试自动播放，可随时暂停或静音。
 *
 * - 浏览器禁止带声音的自动播放时，盒子转成提示态，首次点击页面即开始；
 * - 静音与"手动暂停"分别记在 localStorage 与 sessionStorage，
 *   因此在站内翻页不会反复响起，换标签页再进站则自动播放；
 * - 翻页时记住播放位置（sessionStorage），接着往下听。
 */
(function () {
    'use strict';

    if (document.querySelector('.music-box')) {
        return;
    }

    var TRACK = {
        src: 'assets/audio/qingbawo-zailushang-jiaoxing.mp3',
        cover: 'assets/img/music-cover-born-in-hesitation.jpg',
        title: '请把我在路上叫醒',
        artist: '汪峰',
        album: '生来彷徨',
        volume: 0.5
    };

    var K_MUTED = 'zbx_music_muted';
    var K_OFF = 'zbx_music_off';
    var K_TIME = 'zbx_music_time';

    var base = document.body.getAttribute('data-base') || '';

    function read(area, key) {
        try {
            return window[area].getItem(key);
        } catch (e) {
            return null;
        }
    }

    function write(area, key, val) {
        try {
            window[area].setItem(key, val);
        } catch (e) {
            /* 隐私模式下忽略 */
        }
    }

    var ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.8 5.6v12.8L18.6 12z" fill="currentColor"/></svg>';
    var ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7.2" y="5.2" width="3.4" height="13.6" rx="1" fill="currentColor"/><rect x="13.4" y="5.2" width="3.4" height="13.6" rx="1" fill="currentColor"/></svg>';
    var ICON_SOUND = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.2 9.5h3.1L12 5.1v13.8L7.3 14.5H4.2z" fill="currentColor"/><path d="M15.4 8.7a5 5 0 0 1 0 6.6M17.8 6.4a8.3 8.3 0 0 1 0 11.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    var ICON_MUTE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.2 9.5h3.1L12 5.1v13.8L7.3 14.5H4.2z" fill="currentColor"/><path d="M15.6 9.7l5 4.6m0-4.6l-5 4.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

    /* 唱片用专辑封面：播放时缓缓转动，暂停时停在原角度 */
    var DISC = [
        '<span class="mb-rotor">',
        '<img class="mb-cover" src="' + base + TRACK.cover + '" alt="" draggable="false">',
        '</span>'
    ].join('');

    var box = document.createElement('div');
    box.className = 'music-box is-paused';
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', '背景音乐 · 音乐盒');
    box.innerHTML =
        '<button class="mb-disc" type="button" aria-label="播放或暂停">' + DISC + '</button>' +
        '<span class="mb-meta">' +
        '<span class="mb-title">' + TRACK.title + '</span>' +
        '<span class="mb-sub">' + TRACK.artist + ' · 音乐盒</span>' +
        '</span>' +
        '<span class="mb-actions">' +
        '<button class="mb-btn mb-play" type="button" aria-label="播放">' +
        '<span class="ico ico-play">' + ICON_PLAY + '</span>' +
        '<span class="ico ico-pause">' + ICON_PAUSE + '</span>' +
        '</button>' +
        '<button class="mb-btn mb-mute" type="button" aria-label="静音" aria-pressed="false">' +
        '<span class="ico ico-sound">' + ICON_SOUND + '</span>' +
        '<span class="ico ico-mute">' + ICON_MUTE + '</span>' +
        '</button>' +
        '</span>';
    document.body.appendChild(box);

    var audio = document.createElement('audio');
    audio.className = 'mb-audio';
    audio.src = base + TRACK.src;
    audio.loop = true;
    audio.preload = 'auto';
    audio.volume = TRACK.volume;
    audio.setAttribute('playsinline', '');
    audio.muted = read('localStorage', K_MUTED) === '1';
    document.body.appendChild(audio);

    var discBtn = box.querySelector('.mb-disc');
    var playBtn = box.querySelector('.mb-play');
    var muteBtn = box.querySelector('.mb-mute');
    var subEl = box.querySelector('.mb-sub');
    var subText = subEl.textContent;
    var hinting = false;
    var armed = false;

    /*
     * 只切 class 与 aria 属性，不动 innerHTML。
     * 早先这里是重写按钮的 innerHTML 来换图标，结果点击时事件目标
     * （按钮里的 <svg>）被换掉、脱离文档，冒泡到盒子时 e.target.closest('button')
     * 已经查不到祖先，盒子误判成「点了空白」又 toggle 一次——暂停刚生效就被重新 play。
     */
    function render() {
        var playing = !audio.paused;
        box.classList.toggle('is-playing', playing);
        box.classList.toggle('is-paused', !playing);
        box.classList.toggle('is-muted', audio.muted);
        playBtn.setAttribute('aria-label', playing ? '暂停' : '播放');
        playBtn.setAttribute('title', playing ? '暂停' : '播放');
        muteBtn.setAttribute('aria-label', audio.muted ? '取消静音' : '静音');
        muteBtn.setAttribute('aria-pressed', audio.muted ? 'true' : 'false');
        muteBtn.setAttribute('title', audio.muted ? '取消静音' : '静音');
        subEl.textContent = audio.muted ? '已静音 · 点喇叭' : (hinting ? '轻触开始播放' : subText);
    }

    function disarm() {
        if (!armed) {
            return;
        }
        armed = false;
        GESTURES.forEach(function (type) {
            document.removeEventListener(type, unlock, true);
        });
    }

    function clearHint() {
        hinting = false;
        box.classList.remove('is-hint');
        disarm();
        render();
    }

    function showHint() {
        if (hinting) {
            return;
        }
        hinting = true;
        box.classList.add('is-hint');
        arm();
        render();
    }

    function play() {
        var promise;
        try {
            promise = audio.play();
        } catch (e) {
            showHint();
            return;
        }
        if (promise && typeof promise.then === 'function') {
            promise.then(function () {
                write('sessionStorage', K_OFF, '0');
                clearHint();
                render();
            }).catch(function () {
                showHint();
                render();
            });
        }
    }

    function pause() {
        audio.pause();
        write('sessionStorage', K_OFF, '1');
        render();
    }

    function togglePlay() {
        if (audio.paused) {
            play();
        } else {
            pause();
        }
    }

    function toggleMute() {
        audio.muted = !audio.muted;
        write('localStorage', K_MUTED, audio.muted ? '1' : '0');
        if (!audio.muted && audio.paused) {
            play();
        }
        render();
    }

    var GESTURES = ['pointerdown', 'touchstart', 'keydown'];

    function unlock(e) {
        if (e && e.target && e.target.closest && e.target.closest('.music-box')) {
            return;
        }
        if (audio.muted) {
            return;
        }
        play();
    }

    function arm() {
        if (armed) {
            return;
        }
        armed = true;
        GESTURES.forEach(function (type) {
            document.addEventListener(type, unlock, true);
        });
    }

    discBtn.addEventListener('click', togglePlay);
    playBtn.addEventListener('click', togglePlay);
    muteBtn.addEventListener('click', toggleMute);

    /* 点盒子的空白或文字区域也算播放/暂停（按钮各管各的） */
    box.addEventListener('click', function (e) {
        /* 用 composedPath 判断：按钮自己的处理函数可能已经改过 DOM，
           e.target 有可能已脱离文档，closest 就不准了 */
        var path = e.composedPath ? e.composedPath() : [];
        for (var i = 0; i < path.length; i++) {
            if (path[i] && path[i].nodeName === 'BUTTON') {
                return;
            }
        }
        if (e.target && e.target.closest && e.target.closest('button')) {
            return;
        }
        togglePlay();
    });

    audio.addEventListener('play', render);
    audio.addEventListener('pause', render);
    audio.addEventListener('volumechange', render);

    /*
     * 播放位置：边播边存，翻页接着放
     * ------------------------------------------------------------
     * 只在 pagehide 保存是不够的——页面卸载的瞬间，部分浏览器已经把
     * currentTime 复位成 0，反而会把刚存好的位置覆盖掉，导致翻页后重播。
     * 所以改为播放中即时记录，离开时只补最后一笔，并且拒绝用 0 覆盖进度。
     */

    var savedPos = parseFloat(read('sessionStorage', K_TIME) || '0') || 0;
    var lastWrite = -1;
    var seekTries = 0;

    function applySeek() {
        if (!(savedPos > 2) || !isFinite(savedPos)) {
            return;
        }
        var total = audio.duration;
        if (!total || !isFinite(total) || savedPos > total - 3) {
            return;
        }
        if (audio.currentTime > savedPos - 1) {
            return; /* 已在这个位置之后，不往回拉 */
        }
        if (seekTries >= 4) {
            return; /* 媒体不可定位时不要反复试 */
        }
        seekTries++;
        try {
            audio.currentTime = savedPos;
        } catch (e) {
            /* 忽略 */
        }
    }

    function saveTime(force) {
        var t = audio.currentTime;
        if (!t || !isFinite(t) || t <= 0.5) {
            return; /* 不用 0 覆盖已有进度 */
        }
        if (!force && Math.abs(t - lastWrite) < 1.5) {
            return;
        }
        lastWrite = t;
        write('sessionStorage', K_TIME, String(Math.floor(t)));
    }

    audio.addEventListener('loadedmetadata', applySeek);
    audio.addEventListener('canplay', applySeek);
    audio.addEventListener('playing', applySeek);
    audio.addEventListener('timeupdate', function () {
        saveTime(false);
    });
    window.setInterval(function () {
        saveTime(false);
    }, 1000);

    window.addEventListener('pagehide', function () {
        saveTime(true);
    });
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
            saveTime(true);
        }
    });

    if ('mediaSession' in navigator && typeof window.MediaMetadata === 'function') {
        try {
            navigator.mediaSession.metadata = new window.MediaMetadata({
                title: TRACK.title,
                artist: TRACK.artist,
                album: TRACK.album,
                artwork: [{ src: base + TRACK.cover, sizes: '220x220', type: 'image/jpeg' }]
            });
            navigator.mediaSession.setActionHandler('play', play);
            navigator.mediaSession.setActionHandler('pause', pause);
        } catch (e) {
            /* 忽略 */
        }
    }

    var muted = read('localStorage', K_MUTED) === '1';
    var stopped = read('sessionStorage', K_OFF) === '1';

    render();
    applySeek();

    if (!muted && !stopped) {
        play();
    }
})();

/*
 * 站内无刷新跳转
 * ------------------------------------------------------------
 * 点站内链接时不再整页重载，只把目标页的 <main> 换进来。
 * 常驻的 <audio> 因此不会被销毁——音乐一路接着放，不会重播。
 *
 * - 地址栏由 History API 维护，前进/后退、刷新、直接访问、收藏都照常；
 * - 换页后同步 data-nav / data-base 并重绘导航高亮；
 * - fetch 失败（离线、404、被拦截）就退回整页跳转，功能不受影响；
 * - 外站链接、带修饰键、中键、target=_blank、锚点、非 .html 资源
 *   一律交给浏览器默认行为。
 */
(function () {
    'use strict';

    if (!window.fetch || !window.DOMParser || !window.history || !history.pushState) {
        return;
    }

    var busy = false;

    /*
     * 换页只换 <main>，目标页自己带的 <script>（比如打谱页的 board.js）
     * 不会跟着执行，页面就用不了。这里把它们补跑一次：
     * - src 按「目标页地址」解析成绝对地址，../assets/ 这类相对路径才对；
     * - 同一个脚本只注入一次，来回翻页不会重复加载；
     * - 内联脚本每次进入该页执行一次，与整页加载时一致。
     */
    if (window.__zbxRouterBound) {
        return;
    }
    window.__zbxRouterBound = 1;

    var injected = {};
    Array.prototype.forEach.call(document.querySelectorAll('script[src]'), function (s) {
        if (s.src) {
            injected[s.src] = 1;
        }
    });

    /* 无刷新换页时，把目标页 <head> 里的内联 <style> 也带过来。
     * 全站只有少数页面（如末轮计算器）有页面专属样式；只换 <main> 会丢掉这些样式，
     * 导致「第一次进入样式没加载」。切页时先清掉上一页注入的，再挂新页的。 */
    function runStyles(doc) {
        Array.prototype.forEach.call(document.querySelectorAll('style[data-zbx-page]'), function (s) {
            if (s.parentNode) { s.parentNode.removeChild(s); }
        });
        var head = document.head || document.getElementsByTagName('head')[0];
        Array.prototype.forEach.call(doc.querySelectorAll('head > style'), function (old) {
            if (!old.textContent || !old.textContent.trim()) { return; }
            var el = document.createElement('style');
            el.setAttribute('data-zbx-page', '1');
            el.textContent = old.textContent;
            head.appendChild(el);
        });
    }

    function runScripts(doc, pageUrl) {
        Array.prototype.forEach.call(doc.querySelectorAll('script'), function (old) {
            var src = old.getAttribute('src');
            var el = document.createElement('script');
            if (src) {
                var abs = src;
                try {
                    abs = new URL(src, pageUrl).href;
                } catch (err) { /* 老浏览器：原样用 */ }
                if (injected[abs] || /\/assets\/layout\.js(?:[?#]|$)/i.test(abs)) {
                    return;
                }
                injected[abs] = 1;
                el.src = abs;
                el.async = false;
            } else if (old.textContent && old.textContent.trim()) {
                el.textContent = old.textContent;
            } else {
                return;
            }
            document.body.appendChild(el);
        });
    }

    function load(url, opts) {
        opts = opts || {};
        if (busy) {
            return;
        }
        busy = true;

        fetch(url, { credentials: 'same-origin' })
            .then(function (res) {
                if (!res.ok) {
                    throw new Error('HTTP ' + res.status);
                }
                return res.text();
            })
            .then(function (text) {
                var doc = new DOMParser().parseFromString(text, 'text/html');
                var incoming = doc.querySelector('main');
                var current = document.querySelector('main');
                if (!incoming || !current) {
                    throw new Error('缺少 main 容器');
                }

                if (opts.push !== false) {
                    history.replaceState({ zbx: 1, scrollY: window.pageYOffset }, '', location.href);
                    history.pushState({ zbx: 1, scrollY: 0 }, '', url);
                }

                current.innerHTML = incoming.innerHTML;
                runStyles(doc);
                document.title = doc.title;
                document.body.setAttribute('data-nav', doc.body.getAttribute('data-nav') || '');
                document.body.setAttribute('data-base', doc.body.getAttribute('data-base') || '');
                if (window.ZBX && window.ZBX.renderHeader) {
                    window.ZBX.renderHeader();
                }
                /* 重放一次淡入：先摘掉再强制回流，动画才会重新触发 */
                current.classList.remove('is-entering');
                void current.offsetWidth;
                current.classList.add('is-entering');

                runScripts(doc, url);
                currentPath = location.pathname + location.search;
                var hashTarget = location.hash ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
                if (hashTarget && typeof opts.scrollY !== 'number') {
                    hashTarget.scrollIntoView();
                } else {
                    window.scrollTo(0, typeof opts.scrollY === 'number' ? opts.scrollY : 0);
                }
                busy = false;
            })
            .catch(function () {
                busy = false;
                window.location.href = url; /* 退回整页跳转 */
            });
    }

    var currentPath = location.pathname + location.search;

    document.addEventListener('click', function (e) {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
            return;
        }

        var el = e.target;
        while (el && el.nodeType === 1 && el.nodeName.toLowerCase() !== 'a') {
            el = el.parentNode;
        }
        if (!el || el.nodeName.toLowerCase() !== 'a') {
            return;
        }
        if ((el.target && el.target !== '_self') || el.hasAttribute('download') || el.hasAttribute('data-full')) {
            return;
        }

        var href = el.getAttribute('href');
        if (!href || href.charAt(0) === '#' || /^(mailto:|tel:|javascript:)/i.test(href)) {
            return;
        }

        var url;
        try {
            url = new URL(el.href, location.href);
        } catch (err) {
            return;
        }

        if (url.protocol !== location.protocol || url.host !== location.host) {
            return;
        }
        if (!(/\.html?$/i.test(url.pathname) || /\/$/.test(url.pathname))) {
            return;
        }
        if (url.pathname === location.pathname && url.search === location.search && url.hash) {
            return;
        }
        if (url.href === location.href) {
            e.preventDefault();
            return;
        }

        e.preventDefault();
        load(url.href, url.hash ? {} : { scrollY: 0 });
    });

    window.addEventListener('popstate', function (e) {
        if (location.pathname + location.search === currentPath) {
            return;
        }
        load(location.href, { push: false, scrollY: (e.state && e.state.scrollY) || 0 });
    });
})();
