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
        '<button class="mb-btn mb-play" type="button" aria-label="播放">' + ICON_PLAY + '</button>' +
        '<button class="mb-btn mb-mute" type="button" aria-label="静音" aria-pressed="false">' + ICON_SOUND + '</button>' +
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

    function render() {
        var playing = !audio.paused;
        box.classList.toggle('is-playing', playing);
        box.classList.toggle('is-paused', !playing);
        playBtn.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
        playBtn.setAttribute('aria-label', playing ? '暂停' : '播放');
        muteBtn.innerHTML = audio.muted ? ICON_MUTE : ICON_SOUND;
        muteBtn.setAttribute('aria-label', audio.muted ? '取消静音' : '静音');
        muteBtn.setAttribute('aria-pressed', audio.muted ? 'true' : 'false');
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

    audio.addEventListener('play', render);
    audio.addEventListener('pause', render);
    audio.addEventListener('volumechange', render);

    audio.addEventListener('loadedmetadata', function () {
        var t = parseFloat(read('sessionStorage', K_TIME) || '0');
        if (t > 2 && audio.duration && t < audio.duration - 4) {
            try {
                audio.currentTime = t;
            } catch (e) {
                /* 忽略 */
            }
        }
    });

    window.addEventListener('pagehide', function () {
        write('sessionStorage', K_TIME, String(audio.currentTime || 0));
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

    if (!muted && !stopped) {
        play();
    }
})();
