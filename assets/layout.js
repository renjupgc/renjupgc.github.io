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
        title: '连珠杂箱'
    };

    var NAV = [
        { text: '首页', href: 'index.html' },
        { text: '杂论', href: 'zalun.html' },
        { text: '杂究', href: '#' },
        { text: '杂史', href: 'zashi.html' },
        { text: '杂豫', href: 'zayu.html' },
        { text: '关于', href: '#' }
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
        }).join('\n        ');

        var html =
            '<header>\n' +
            '    <h1 class="site-title"><a href="' + base + 'index.html">' + SITE.title + '</a></h1>\n' +
            '    <nav>\n        ' + navHtml + '\n    </nav>\n' +
            '</header>';

        var mount = document.getElementById('site-header');
        if (mount) {
            mount.innerHTML = html;
        }
    }

    renderHeader();

    /* 供站内无刷新跳转（见文件末尾）在换页后重新高亮导航 */
    window.ZBX = {
        renderHeader: function () {
            base = document.body.getAttribute('data-base') || '';
            active = document.body.getAttribute('data-nav') || '';
            renderHeader();
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

    var TRACK = {
        src: 'assets/audio/qingbawo-zailushang-jiaoxing.mp3',
        title: '请把我在路上叫醒',
        artist: '汪峰',
        album: '连珠杂箱 · 音乐盒',
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

    var DISC = [
        '<svg viewBox="0 0 64 64" aria-hidden="true">',
        '<defs>',
        '<radialGradient id="mb-disc-grad" cx="33%" cy="26%" r="80%">',
        '<stop offset="0%" stop-color="#5a5246"/>',
        '<stop offset="45%" stop-color="#3a342c"/>',
        '<stop offset="100%" stop-color="#241f1a"/>',
        '</radialGradient>',
        '</defs>',
        '<circle cx="32" cy="32" r="30.5" fill="#f8f1e0" stroke="#e0d2b2"/>',
        '<g class="mb-rotor">',
        '<circle cx="32" cy="32" r="26.5" fill="url(#mb-disc-grad)" stroke="#1d1915" stroke-width="0.8"/>',
        '<g fill="none" stroke="#d9ccb4" stroke-opacity="0.45" stroke-width="0.9">',
        '<circle cx="32" cy="32" r="23.4"/><circle cx="32" cy="32" r="20.6"/>',
        '<circle cx="32" cy="32" r="17.8"/>',
        '</g>',
        '<circle cx="32" cy="32" r="11.8" fill="#f7ebca" stroke="#d3bc8b" stroke-width="1"/>',
        '<text x="32" y="37.6" text-anchor="middle" font-size="15" font-weight="bold" fill="#7b6026"',
        ' font-family="Segoe UI Symbol, Apple Symbols, Georgia, serif">&#9834;</text>',
        '<circle cx="32" cy="32" r="1.2" fill="#8a6f36"/>',
        '</g>',
        '</svg>'
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
                album: TRACK.album
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
                document.title = doc.title;
                document.body.setAttribute('data-nav', doc.body.getAttribute('data-nav') || '');
                document.body.setAttribute('data-base', doc.body.getAttribute('data-base') || '');
                if (window.ZBX && window.ZBX.renderHeader) {
                    window.ZBX.renderHeader();
                }
                window.scrollTo(0, typeof opts.scrollY === 'number' ? opts.scrollY : 0);
                busy = false;
            })
            .catch(function () {
                busy = false;
                window.location.href = url; /* 退回整页跳转 */
            });
    }

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
        if (!/\.html?$/i.test(url.pathname) || url.hash) {
            return;
        }
        if (url.href === location.href) {
            e.preventDefault();
            return;
        }

        e.preventDefault();
        load(url.href, { scrollY: 0 });
    });

    window.addEventListener('popstate', function (e) {
        load(location.href, { push: false, scrollY: (e.state && e.state.scrollY) || 0 });
    });
})();
