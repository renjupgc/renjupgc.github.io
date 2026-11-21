/*
 * 连珠杂箱 · 3D 对局的声音
 * ------------------------------------------------------------
 * 不加载任何音频文件，全部用 WebAudio 现场合成：
 *   stone()  棋子磕在木盘上的一声
 *   rattle() 手探进棋盒、石子相互摩擦的几声
 *   press()  拍钟的机械声
 *   win()    终局的一点轻响
 * 浏览器要求先有用户手势，所以 unlock() 在第一下点击时调用。
 */
(function () {
    'use strict';

    var ctx = null;
    var master = null;
    var enabled = true;
    var noise = null;

    function ensure() {
        if (ctx) { return ctx; }
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { return null; }
        try {
            ctx = new AC();
            master = ctx.createGain();
            master.gain.value = 0.5;
            master.connect(ctx.destination);
        } catch (e) {
            ctx = null;
        }
        return ctx;
    }

    function unlock() {
        var c = ensure();
        if (c && c.state === 'suspended') { c.resume(); }
    }

    function noiseBuffer() {
        if (noise) { return noise; }
        var c = ensure();
        var len = Math.floor(c.sampleRate * 0.25);
        var buf = c.createBuffer(1, len, c.sampleRate);
        var d = buf.getChannelData(0);
        for (var i = 0; i < len; i++) {
            d[i] = (Math.random() * 2 - 1) * (1 - i / len);
        }
        noise = buf;
        return buf;
    }

    function burst(opts) {
        var c = ensure();
        if (!c || !enabled) { return; }
        var t = opts.at || c.currentTime;
        var src = c.createBufferSource();
        src.buffer = noiseBuffer();
        src.playbackRate.value = opts.rate || 1;

        var f = c.createBiquadFilter();
        f.type = opts.type || 'bandpass';
        f.frequency.value = opts.freq || 1800;
        f.Q.value = opts.q || 1.2;

        var g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(opts.gain || 0.2, t + (opts.attack || 0.002));
        g.gain.exponentialRampToValueAtTime(0.0001, t + (opts.dur || 0.08));

        src.connect(f);
        f.connect(g);
        g.connect(master);
        src.start(t);
        src.stop(t + (opts.dur || 0.08) + 0.02);
    }

    function tone(opts) {
        var c = ensure();
        if (!c || !enabled) { return; }
        var t = opts.at || c.currentTime;
        var o = c.createOscillator();
        o.type = opts.type || 'sine';
        o.frequency.setValueAtTime(opts.freq || 440, t);
        if (opts.to) {
            o.frequency.exponentialRampToValueAtTime(opts.to, t + (opts.dur || 0.12));
        }
        var g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(opts.gain || 0.12, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + (opts.dur || 0.12));
        o.connect(g);
        g.connect(master);
        o.start(t);
        o.stop(t + (opts.dur || 0.12) + 0.02);
    }

    /* 棋子落在木头上：一声脆的 + 一点木腔共鸣 */
    function stone() {
        var c = ensure();
        if (!c || !enabled) { return; }
        var t = c.currentTime;
        burst({ at: t, freq: 2100 + Math.random() * 500, q: 1.6, gain: 0.22, dur: 0.045, rate: 1.4 });
        tone({ at: t, type: 'triangle', freq: 760 + Math.random() * 90, to: 420, gain: 0.11, dur: 0.1 });
        tone({ at: t + 0.004, type: 'sine', freq: 196, to: 150, gain: 0.08, dur: 0.13 });
    }

    /* 手在棋盒里摸子 */
    function rattle() {
        var c = ensure();
        if (!c || !enabled) { return; }
        var t = c.currentTime;
        for (var i = 0; i < 4; i++) {
            burst({
                at: t + i * (0.032 + Math.random() * 0.03),
                freq: 2600 + Math.random() * 1400,
                q: 2.4,
                gain: 0.055 + Math.random() * 0.03,
                dur: 0.03,
                rate: 1.6
            });
        }
    }

    /* 拍钟：塑料按键下去的「嗒」 */
    function press() {
        var c = ensure();
        if (!c || !enabled) { return; }
        var t = c.currentTime;
        burst({ at: t, freq: 900, q: 0.9, gain: 0.24, dur: 0.05, rate: 0.8 });
        tone({ at: t, type: 'square', freq: 132, to: 96, gain: 0.1, dur: 0.07 });
        burst({ at: t + 0.055, freq: 1500, q: 1.4, gain: 0.08, dur: 0.03, rate: 1.2 });
    }

    function tick() {
        var c = ensure();
        if (!c || !enabled) { return; }
        burst({ freq: 3200, q: 3, gain: 0.03, dur: 0.02, rate: 1.8 });
    }

    function win() {
        var c = ensure();
        if (!c || !enabled) { return; }
        var t = c.currentTime;
        [523.25, 659.25, 783.99].forEach(function (f, i) {
            tone({ at: t + i * 0.11, type: 'sine', freq: f, gain: 0.09, dur: 0.5 });
        });
    }

    function lose() {
        var c = ensure();
        if (!c || !enabled) { return; }
        var t = c.currentTime;
        [392, 329.63].forEach(function (f, i) {
            tone({ at: t + i * 0.13, type: 'sine', freq: f, gain: 0.08, dur: 0.55 });
        });
    }

    function nope() {
        tone({ type: 'sine', freq: 220, to: 180, gain: 0.05, dur: 0.1 });
    }

    window.DJ_AUDIO = {
        unlock: unlock,
        stone: stone,
        rattle: rattle,
        press: press,
        tick: tick,
        win: win,
        lose: lose,
        nope: nope,
        setEnabled: function (v) { enabled = !!v; },
        isEnabled: function () { return enabled; }
    };
})();
