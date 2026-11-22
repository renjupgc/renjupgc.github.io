/*
 * 连珠杂箱 · 3D 对局场景
 * ------------------------------------------------------------
 * 用 three.js 搭一间安静的对局室：木桌、棋盘、两只棋盒、一台棋钟，
 * 以及一只会从棋盒里捏子、落子的手。
 *
 * 设计要点：
 *   · 视角是「坐着的」——机位在座椅高度，略微俯视棋盘，和别人坐下来
 *     看棋盘的角度一致；落座时从站立的全景压到座位上，有个明显的下沉。
 *   · 棋盘、木纹、卷轴、LCD 数字全部用 canvas 现画，不带图片资源。
 *   · 环境反射用一张画出来的等高图经 PMREM 处理，石头才有真正的光泽。
 *   · 落子是逐段的：探手 → 入盒 → 捏起（盒里响一声）→ 抬起 → 过盘 →
 *     落下 → 松手（木头上一声）→ 收手。每段可乘速度系数。
 *
 * 对外：window.DJ_TABLE.create(canvas) 返回下面这个 T。
 */
(function () {
    'use strict';

    var THREE = window.THREE;
    if (!THREE) { return; }
    var TEXTURE_ANISOTROPY = 16;

    /* ---------- 尺寸（1 单位 = 一格 = 3cm） ---------- */

    var N = 15;
    var HALF = 7;                 // 线段从 -7 到 7
    var TABLE_TOP = 23.5;         // 桌面高度 ≈ 70cm
    var BOARD_T = 0.7;
    var BOARD_TOP = TABLE_TOP + BOARD_T;
    var STONE_R = 0.455;
    var STONE_HALF = 0.188;

    var SEAT_SIGN = { black: 1, white: -1 };   // 视角在 +z / -z

    /* ---------- 小工具 ---------- */

    function lerp(a, b, t) { return a + (b - a) * t; }
    function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
    function easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }
    function easeInOutSine(t) { return -(Math.cos(Math.PI * t) - 1) / 2; }
    function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
    function rnd(a, b) { return a + Math.random() * (b - a); }

    function canvas2d(w, h) {
        var c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        return c;
    }

    function texFromCanvas(c, repeat) {
        var t = new THREE.CanvasTexture(c);
        t.encoding = THREE.sRGBEncoding;
        t.anisotropy = TEXTURE_ANISOTROPY;
        t.magFilter = THREE.LinearFilter;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.generateMipmaps = true;
        if (repeat) {
            t.wrapS = t.wrapT = THREE.RepeatWrapping;
            t.repeat.set(repeat[0], repeat[1]);
        }
        return t;
    }

    /* ---------- 现画的贴图 ---------- */

    /* 木纹：底色 + 一层层深浅不一的年轮曲线 */
    function woodCanvas(w, h, base, dark, light, lines) {
        var c = canvas2d(w, h), x = c.getContext('2d');
        x.fillStyle = base;
        x.fillRect(0, 0, w, h);

        for (var i = 0; i < (lines || 90); i++) {
            var y0 = Math.random() * h;
            var amp = rnd(2, 14);
            var freq = rnd(0.004, 0.02);
            var ph = Math.random() * 6.28;
            x.beginPath();
            for (var px = 0; px <= w; px += 8) {
                var py = y0 + Math.sin(px * freq + ph) * amp + Math.sin(px * freq * 3.1 + ph) * amp * 0.25;
                if (px === 0) { x.moveTo(px, py); } else { x.lineTo(px, py); }
            }
            x.strokeStyle = (Math.random() < 0.5 ? dark : light);
            x.globalAlpha = rnd(0.03, 0.11);
            x.lineWidth = rnd(0.7, 3.4);
            x.stroke();
        }
        x.globalAlpha = 1;

        /* 细颗粒 */
        var img = x.getImageData(0, 0, w, h);
        var d = img.data;
        for (var k = 0; k < d.length; k += 4) {
            var n = (Math.random() - 0.5) * 12;
            d[k] += n; d[k + 1] += n; d[k + 2] += n;
        }
        x.putImageData(img, 0, 0);
        return c;
    }

    /* 棋盘面：4K 高清榧木纹理 + 与三维坐标严格对齐的 15×15 网格。
       不再使用高频随机噪点，避免缩小时发糊、发脏。 */
    function boardCanvas() {
        var S = 4096;
        var c = canvas2d(S, S), x = c.getContext('2d');
        var boardWidth = 18.36;
        var margin = (boardWidth - (N - 1)) / 2;
        var pad = S * margin / boardWidth;
        var step = (S - pad * 2) / (N - 1);

        var base = x.createLinearGradient(0, 0, S, S);
        base.addColorStop(0, '#d7ad68');
        base.addColorStop(0.45, '#c99a55');
        base.addColorStop(1, '#b98543');
        x.fillStyle = base;
        x.fillRect(0, 0, S, S);

        /* 细而连续的纵向木纹，低对比度，不干扰棋线。 */
        for (var i = 0; i < 150; i++) {
            var gx = (i / 150) * S + rnd(-8, 8);
            var amp = rnd(3, 18);
            var freq = rnd(0.0015, 0.004);
            var ph = Math.random() * 6.28;
            x.beginPath();
            for (var py = 0; py <= S; py += 16) {
                var px = gx + Math.sin(py * freq + ph) * amp;
                if (py === 0) { x.moveTo(px, py); } else { x.lineTo(px, py); }
            }
            x.strokeStyle = i % 3 === 0 ? 'rgba(112,72,28,0.10)' : 'rgba(246,220,166,0.10)';
            x.lineWidth = rnd(1.2, 4.5);
            x.stroke();
        }

        /* 边缘轻微压暗，模拟打磨后的棋盘边框。 */
        var edge = x.createRadialGradient(S / 2, S / 2, S * 0.34, S / 2, S / 2, S * 0.76);
        edge.addColorStop(0, 'rgba(70,42,12,0)');
        edge.addColorStop(1, 'rgba(70,42,12,0.18)');
        x.fillStyle = edge;
        x.fillRect(0, 0, S, S);

        /* 棋线：先画极浅的压痕，再画清晰主线。 */
        var lw = 6.5;
        x.lineCap = 'square';
        for (var pass = 0; pass < 2; pass++) {
            x.strokeStyle = pass === 0 ? 'rgba(255,236,190,0.28)' : 'rgba(35,22,9,0.96)';
            x.lineWidth = pass === 0 ? lw + 2 : lw;
            var offset = pass === 0 ? 1.5 : 0;
            for (var j = 0; j < N; j++) {
                var p = pad + j * step + offset;
                x.beginPath(); x.moveTo(pad, p); x.lineTo(S - pad, p); x.stroke();
                x.beginPath(); x.moveTo(p, pad); x.lineTo(p, S - pad); x.stroke();
            }
        }

        /* 棋盘坐标：上/下 A–O，左/右 1–15。 */
        x.save();
        x.fillStyle = 'rgba(45,29,13,0.92)';
        x.textAlign = 'center';
        x.textBaseline = 'middle';
        x.font = '700 54px Georgia, "Times New Roman", serif';
        for (var ci = 0; ci < N; ci++) {
            var cp = pad + ci * step, letter = String.fromCharCode(65 + ci);
            x.fillText(letter, cp, pad * 0.48);
            x.fillText(letter, cp, S - pad * 0.48);
        }
        x.font = '700 50px Georgia, "Times New Roman", serif';
        for (var ri = 0; ri < N; ri++) {
            var rp = pad + ri * step, number = String(ri + 1);
            x.fillText(number, pad * 0.48, rp);
            x.fillText(number, S - pad * 0.48, rp);
        }
        x.restore();

        var stars = [[3, 3], [3, 11], [11, 3], [11, 11], [7, 7]];
        x.fillStyle = 'rgba(30,18,7,0.98)';
        stars.forEach(function (s) {
            x.beginPath();
            x.arc(pad + s[0] * step, pad + s[1] * step, 14, 0, 6.2832);
            x.fill();
        });
        return c;
    }

    /* 竹节纹理：横向分段、深浅相间的黄褐色竹木，带清漆光泽的底色。
       参考实拍围棋棋罐——鼓形罐身由竹条拼接，竹节处颜色略深。 */
    function bambooCanvas(w, h) {
        var c = canvas2d(w, h), x = c.getContext('2d');

        /* 底色：暖黄褐，带轻微纵向渐变模拟弧面受光 */
        var g = x.createLinearGradient(0, 0, w, 0);
        g.addColorStop(0, '#b98a4e');
        g.addColorStop(0.5, '#cf9d5c');
        g.addColorStop(1, '#a97b43');
        x.fillStyle = g;
        x.fillRect(0, 0, w, h);

        /* 竹节：横向一条条，颜色深浅交替，节处压一条深线 */
        var seg = h / 11;
        for (var i = 0; i < 11; i++) {
            var y0 = i * seg;
            var tone = i % 2 ? 'rgba(120,74,30,0.28)' : 'rgba(255,214,150,0.20)';
            x.fillStyle = tone;
            x.fillRect(0, y0, w, seg);

            /* 竹节缝 */
            x.fillStyle = 'rgba(72,44,18,0.55)';
            x.fillRect(0, y0 - 1.5, w, 3);
        }

        /* 细竖向竹纤维纹 */
        for (var k = 0; k < 80; k++) {
            var gx = Math.random() * w;
            x.strokeStyle = Math.random() < 0.5 ? 'rgba(90,56,22,0.10)' : 'rgba(255,220,170,0.10)';
            x.lineWidth = rnd(0.6, 1.8);
            x.beginPath();
            x.moveTo(gx, 0);
            x.lineTo(gx + rnd(-3, 3), h);
            x.stroke();
        }

        /* 清漆高光带 */
        var hl = x.createLinearGradient(0, 0, 0, h);
        hl.addColorStop(0, 'rgba(255,240,210,0.28)');
        hl.addColorStop(0.5, 'rgba(255,240,210,0)');
        hl.addColorStop(1, 'rgba(255,240,210,0.18)');
        x.fillStyle = hl;
        x.fillRect(0, 0, w, h);

        return c;
    }

    /* 白子贝壳纹理：极细的暖色生长纹，近看有材质，远看干净。 */
    function shellCanvas() {
        var w = 1024, h = 512;
        var c = canvas2d(w, h), x = c.getContext('2d');
        x.fillStyle = '#f4efe2';
        x.fillRect(0, 0, w, h);
        for (var i = 0; i < 90; i++) {
            var y = (i / 90) * h + rnd(-2, 2);
            x.beginPath();
            for (var px = 0; px <= w; px += 12) {
                var py = y + Math.sin(px * 0.012 + i) * rnd(1, 4);
                if (px === 0) { x.moveTo(px, py); } else { x.lineTo(px, py); }
            }
            x.strokeStyle = i % 2 ? 'rgba(205,190,160,0.16)' : 'rgba(255,252,244,0.22)';
            x.lineWidth = rnd(0.6, 1.8);
            x.stroke();
        }
        return c;
    }

    /* 卷轴：竖排两个字 */
    function scrollCanvas() {
        var w = 220, h = 620;
        var c = canvas2d(w, h), x = c.getContext('2d');
        var g = x.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, '#efe5cd');
        g.addColorStop(0.5, '#e7dbc0');
        g.addColorStop(1, '#dfd0b1');
        x.fillStyle = g;
        x.fillRect(0, 0, w, h);

        x.fillStyle = 'rgba(20,14,6,0.86)';
        x.textAlign = 'center';
        x.textBaseline = 'middle';
        x.font = '700 108px "Songti SC","STSong","SimSun","Noto Serif CJK SC",serif';
        x.fillText('連', w / 2, h * 0.34);
        x.fillText('珠', w / 2, h * 0.66);

        /* 边上的细线 */
        x.strokeStyle = 'rgba(60,38,14,0.35)';
        x.lineWidth = 4;
        x.strokeRect(12, 12, w - 24, h - 24);
        return c;
    }

    /* 环境反射：上亮下暗的室内光。石头靠它才有清透的高光。 */
    function envCanvas() {
        var w = 512, h = 256;
        var c = canvas2d(w, h), x = c.getContext('2d');
        var g = x.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, '#221b12');
        g.addColorStop(0.42, '#4a4034');
        g.addColorStop(0.62, '#7d7059');
        g.addColorStop(0.78, '#241d15');
        g.addColorStop(1, '#0a0806');
        x.fillStyle = g;
        x.fillRect(0, 0, w, h);

        /* 顶部一盏大灯 */
        var r = x.createRadialGradient(w * 0.5, h * 0.1, 4, w * 0.5, h * 0.1, w * 0.42);
        r.addColorStop(0, 'rgba(255,246,224,1)');
        r.addColorStop(0.25, 'rgba(255,228,178,0.65)');
        r.addColorStop(1, 'rgba(255,214,150,0)');
        x.fillStyle = r;
        x.fillRect(0, 0, w, h);

        /* 侧面一点冷光，免得全暖 */
        var r2 = x.createRadialGradient(w * 0.12, h * 0.46, 2, w * 0.12, h * 0.46, w * 0.3);
        r2.addColorStop(0, 'rgba(170,196,220,0.55)');
        r2.addColorStop(1, 'rgba(170,196,220,0)');
        x.fillStyle = r2;
        x.fillRect(0, 0, w, h);

        /* 两块柔光箱反射，让黑子和白子都有清晰、自然的高光带。 */
        x.fillStyle = 'rgba(255,250,238,0.95)';
        x.fillRect(w * 0.16, h * 0.10, w * 0.22, h * 0.16);
        x.fillStyle = 'rgba(220,232,245,0.75)';
        x.fillRect(w * 0.66, h * 0.18, w * 0.16, h * 0.12);
        return c;
    }

    /* LCD 数字：棋钟上那两块屏 */
    function clockCanvas() {
        var w = 512, h = 256;
        var c = canvas2d(w, h), x = c.getContext('2d');
        x.fillStyle = '#0c0d0a';
        x.fillRect(0, 0, w, h);
        return c;
    }

    function drawClockDigits(c, text, low) {
        var x = c.getContext('2d');
        x.fillStyle = '#0c0d0a';
        x.fillRect(0, 0, c.width, c.height);

        x.textAlign = 'center';
        x.textBaseline = 'middle';
        x.font = '600 132px "SF Mono","Consolas","Courier New",monospace';
        x.fillStyle = low ? '#e2694f' : '#8fe0a8';
        x.shadowColor = low ? 'rgba(226,105,79,0.55)' : 'rgba(143,224,168,0.4)';
        x.shadowBlur = 22;
        x.fillText(text, c.width / 2, c.height / 2 + 4);
        x.shadowBlur = 0;
    }

    /* ---------- create ---------- */

    function create(canvas) {

        var renderer = new THREE.WebGLRenderer({
            canvas: canvas,
            antialias: true,
            alpha: false,
            powerPreference: 'high-performance'
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 3));
        TEXTURE_ANISOTROPY = renderer.capabilities.getMaxAnisotropy();
        renderer.outputEncoding = THREE.sRGBEncoding;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.28;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        var scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0a0908);
        scene.fog = new THREE.Fog(0x0a0908, 120, 320);

        var camera = new THREE.PerspectiveCamera(50, 1, 0.6, 900);
        camera.position.set(0, 72, 58);

        /* 环境反射 */
        try {
            var pmrem = new THREE.PMREMGenerator(renderer);
            pmrem.compileEquirectangularShader();
            var envTex = new THREE.CanvasTexture(envCanvas());
            envTex.mapping = THREE.EquirectangularReflectionMapping;
            envTex.encoding = THREE.sRGBEncoding;
            scene.environment = pmrem.fromEquirectangular(envTex).texture;
            envTex.dispose();
            pmrem.dispose();
        } catch (e) { /* 环境图失败不影响主体 */ }

        /* ---------- 光 ----------
           参考图是明亮均匀的室内光：提高环境亮度，暖主光 + 冷补光，
           让白子透亮、黑子有清晰的高光带，棋罐有柔和的清漆反光。 */

        scene.add(new THREE.HemisphereLight(0x8a7f6c, 0x1c150d, 0.95));

        var key = new THREE.SpotLight(0xffe3b8, 1.62, 260, 0.82, 0.85, 1.3);
        key.position.set(6, 96, 26);
        key.target.position.set(0, TABLE_TOP, 0);
        key.castShadow = true;
        key.shadow.mapSize.set(2048, 2048);
        key.shadow.bias = -0.0007;
        key.shadow.radius = 4;
        key.shadow.camera.near = 40;
        key.shadow.camera.far = 220;
        scene.add(key, key.target);

        var fill = new THREE.DirectionalLight(0xc2d2e2, 0.52);
        fill.position.set(-46, 42, -30);
        scene.add(fill);

        /* 顶部柔光，补亮棋盘与棋子顶面 */
        var top = new THREE.DirectionalLight(0xfff0d8, 0.4);
        top.position.set(0, 80, 0);
        scene.add(top);

        /* 侧后方的落地灯，给墙面一点暖 */
        var lamp = new THREE.PointLight(0xffb469, 1.0, 190, 1.6);
        lamp.position.set(-46, 34, -18);
        scene.add(lamp);

        /* ---------- 房间 ---------- */

        var floorMat = new THREE.MeshStandardMaterial({
            map: texFromCanvas(woodCanvas(512, 512, '#3b2f22', '#1c150e', '#5b4a35', 60), [10, 10]),
            roughness: 0.88,
            metalness: 0
        });
        var floor = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        scene.add(floor);

        var wallMat = new THREE.MeshStandardMaterial({
            map: texFromCanvas(woodCanvas(512, 512, '#2a241c', '#15110b', '#3d3427', 50), [4, 1.4]),
            roughness: 0.96
        });
        var wall = new THREE.Mesh(new THREE.PlaneGeometry(300, 130), wallMat);
        wall.position.set(0, 55, -86);
        wall.receiveShadow = true;
        scene.add(wall);

        /* 卷轴 */
        var scrollTex = texFromCanvas(scrollCanvas());
        var scroll = new THREE.Mesh(
            new THREE.PlaneGeometry(18, 40),
            new THREE.MeshStandardMaterial({ map: scrollTex, roughness: 0.92 })
        );
        scroll.position.set(-44, 30, -85.2);
        scene.add(scroll);
        var rodMat = new THREE.MeshStandardMaterial({ color: 0x2c2318, roughness: 0.5, metalness: 0.25 });
        [-1, 1].forEach(function (s) {
            var rod = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 22, 12), rodMat);
            rod.rotation.z = Math.PI / 2;
            rod.position.set(-44, 30 + s * 20.5, -85);
            scene.add(rod);
        });

        /* 墙边的矮柜与灯，给全景一点生活气 */
        var cabinetMat = new THREE.MeshStandardMaterial({ color: 0x2a1f16, roughness: 0.7 });
        var cabinet = new THREE.Mesh(new THREE.BoxGeometry(30, 17, 15), cabinetMat);
        cabinet.position.set(-46, 8.5, -8);
        cabinet.castShadow = true;
        cabinet.receiveShadow = true;
        scene.add(cabinet);

        var lampPole = new THREE.Mesh(
            new THREE.CylinderGeometry(0.5, 0.6, 26, 10),
            new THREE.MeshStandardMaterial({ color: 0x1d1710, roughness: 0.5, metalness: 0.3 })
        );
        lampPole.position.set(-46, 21, -8);
        scene.add(lampPole);

        var shadeMat = new THREE.MeshStandardMaterial({
            color: 0xd8b98a, roughness: 0.9, side: THREE.DoubleSide,
            emissive: 0xffbb77, emissiveIntensity: 0.45
        });
        var shade = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 7.4, 7.5, 26, 1, true), shadeMat);
        shade.position.set(-46, 34, -8);
        scene.add(shade);

        /* ---------- 桌子 ---------- */

        var tableMat = new THREE.MeshStandardMaterial({
            map: texFromCanvas(woodCanvas(1024, 512, '#4a3524', '#241a10', '#6b5038', 80), [2, 1]),
            roughness: 0.55,
            metalness: 0.05
        });
        var tableBody = new THREE.Mesh(new THREE.BoxGeometry(46, 2.2, 32), tableMat);
        tableBody.position.set(0, TABLE_TOP - 1.1, 0);
        tableBody.castShadow = true;
        tableBody.receiveShadow = true;
        scene.add(tableBody);

        /* ---------- 双人赛事台签（位于桌面左侧） ---------- */
        var signCanvas = canvas2d(1200, 600);
        var signCtx = signCanvas.getContext('2d');
        function drawPlayerSign(myName, peerName) {
            var g = signCtx.createLinearGradient(0, 0, 1200, 600);
            g.addColorStop(0, '#33251a');
            g.addColorStop(0.5, '#60452b');
            g.addColorStop(1, '#2b2017');
            signCtx.fillStyle = g;
            signCtx.fillRect(0, 0, 1200, 600);
            signCtx.strokeStyle = '#d6b477';
            signCtx.lineWidth = 12;
            signCtx.strokeRect(18, 18, 1164, 564);
            signCtx.strokeStyle = 'rgba(235,207,153,0.55)';
            signCtx.lineWidth = 3;
            signCtx.strokeRect(36, 36, 1128, 528);
            signCtx.textAlign = 'center';
            signCtx.textBaseline = 'middle';
            signCtx.fillStyle = '#f5e4c3';
            signCtx.font = '700 62px "Songti SC","STSong","SimSun","Noto Serif CJK SC",serif';
            signCtx.fillText('“冠臣杯”第一届五子棋公开赛', 600, 166, 1080);
            signCtx.strokeStyle = 'rgba(226,190,128,0.7)';
            signCtx.lineWidth = 2;
            signCtx.beginPath(); signCtx.moveTo(90, 286); signCtx.lineTo(1110, 286); signCtx.stroke();
            signCtx.font = '600 48px "Songti SC","STSong","SimSun","Noto Serif CJK SC",serif';
            signCtx.fillStyle = '#f0d9ad';
            signCtx.fillText(String(myName || '棋友').slice(0, 12), 320, 430, 430);
            signCtx.fillStyle = '#d7c6a6';
            signCtx.font = '500 34px Georgia,serif';
            signCtx.fillText('VS', 600, 430);
            signCtx.fillStyle = '#f0d9ad';
            signCtx.font = '600 48px "Songti SC","STSong","SimSun","Noto Serif CJK SC",serif';
            signCtx.fillText(String(peerName || '棋友').slice(0, 12), 880, 430, 430);
            signTexture.needsUpdate = true;
        }
        var signTexture = texFromCanvas(signCanvas);
        drawPlayerSign('棋友', '棋友');
        var signGroup = new THREE.Group();
        var signFrame = new THREE.Mesh(
            new THREE.BoxGeometry(13.2, 7.2, 0.48),
            new THREE.MeshStandardMaterial({ color: 0x4a321d, roughness: 0.48, metalness: 0.12 })
        );
        signFrame.castShadow = true;
        signGroup.add(signFrame);
        var signFace = new THREE.Mesh(
            new THREE.PlaneGeometry(12.75, 6.75),
            new THREE.MeshStandardMaterial({ map: signTexture, roughness: 0.72, metalness: 0.04 })
        );
        signFace.position.z = 0.255;
        signGroup.add(signFace);
        var signBase = new THREE.Mesh(
            new THREE.BoxGeometry(13.8, 0.55, 3.2),
            new THREE.MeshStandardMaterial({ color: 0x3a2819, roughness: 0.58 })
        );
        signBase.position.y = -3.9;
        signBase.castShadow = true;
        signGroup.add(signBase);
        signGroup.position.set(-16.1, TABLE_TOP + 4.6, 0);
        signGroup.rotation.x = -0.10;
        scene.add(signGroup);

        var legMat = new THREE.MeshStandardMaterial({ color: 0x241a12, roughness: 0.7 });
        [[-20, -13], [20, -13], [-20, 13], [20, 13]].forEach(function (p) {
            var leg = new THREE.Mesh(new THREE.BoxGeometry(2.4, TABLE_TOP - 2.2, 2.4), legMat);
            leg.position.set(p[0], (TABLE_TOP - 2.2) / 2, p[1]);
            leg.castShadow = true;
            scene.add(leg);
        });

        /* ---------- 棋盘 ---------- */

        var boardBody = new THREE.Mesh(
            new THREE.BoxGeometry(18.34, BOARD_T, 18.34),
            new THREE.MeshStandardMaterial({ color: 0x8a5c2a, roughness: 0.66 })
        );
        boardBody.position.set(0, TABLE_TOP + BOARD_T / 2, 0);
        boardBody.castShadow = true;
        boardBody.receiveShadow = true;
        scene.add(boardBody);

        var boardFace = new THREE.Mesh(
            new THREE.PlaneGeometry(18.36, 18.36),
            new THREE.MeshStandardMaterial({
                map: texFromCanvas(boardCanvas()),
                roughness: 0.58,
                metalness: 0,
                envMapIntensity: 0.45
            })
        );
        boardFace.rotation.x = -Math.PI / 2;
        boardFace.position.set(0, BOARD_TOP + 0.004, 0);
        boardFace.receiveShadow = true;
        scene.add(boardFace);

        /* ---------- 棋子 ---------- */

        /* 双凸透镜形棋子，比压扁球体更接近真实云子/蛤碁石。
           按参考图做成略扁的片状：中间厚、边缘薄，整体比标准棋子更扁平。 */
        var stoneProfile = [
            new THREE.Vector2(0.001, -0.188),
            new THREE.Vector2(0.15, -0.182),
            new THREE.Vector2(0.30, -0.158),
            new THREE.Vector2(0.405, -0.105),
            new THREE.Vector2(0.455, -0.045),
            new THREE.Vector2(0.455, 0.045),
            new THREE.Vector2(0.405, 0.105),
            new THREE.Vector2(0.30, 0.158),
            new THREE.Vector2(0.15, 0.182),
            new THREE.Vector2(0.001, 0.188)
        ];
        var stoneGeo = new THREE.LatheGeometry(stoneProfile, 96);
        stoneGeo.computeVertexNormals();

        /* 云子质感：黑子如墨玉，白子如温润羊脂玉；清亮高光与细腻表面
           保留天然石材的通透感，避免金属或塑料质感。 */
        var blackStoneMat = new THREE.MeshPhysicalMaterial({
            color: 0x000000,
            roughness: 0.13,
            metalness: 0.0,
            clearcoat: 0.98,
            clearcoatRoughness: 0.055,
            envMapIntensity: 1.18,
            reflectivity: 0.78
        });
        var whiteStoneMat = new THREE.MeshPhysicalMaterial({
            color: 0xf4efe2,
            map: texFromCanvas(shellCanvas()),
            roughness: 0.17,
            metalness: 0.0,
            clearcoat: 0.98,
            clearcoatRoughness: 0.075,
            envMapIntensity: 1.28,
            reflectivity: 0.68
        });
        /* 棋子材质稍后才挂到实例上，这里先做色彩空间转换，避免黑子发灰。 */
        if (blackStoneMat.color.convertSRGBToLinear) { blackStoneMat.color.convertSRGBToLinear(); }
        if (whiteStoneMat.color.convertSRGBToLinear) { whiteStoneMat.color.convertSRGBToLinear(); }

        var stoneLayer = new THREE.Group();
        scene.add(stoneLayer);

        function stoneMesh(color) {
            var m = new THREE.Mesh(stoneGeo, color === 'black' ? blackStoneMat : whiteStoneMat);
            m.castShadow = true;
            m.receiveShadow = true;
            return m;
        }

        /* 落子时的轻微偏心与自转，别让一盘子像贴上去的 */
        var stones = {};       // "x,y" -> mesh

        function addStone(x, y, color) {
            var m = stoneMesh(color);
            m.position.set(x - HALF, BOARD_TOP + STONE_HALF, y - HALF);
            m.position.x += rnd(-0.035, 0.035);
            m.position.z += rnd(-0.035, 0.035);
            m.rotation.y = rnd(0, 6.28);
            stoneLayer.add(m);
            stones[x + ',' + y] = m;
            return m;
        }

        function clearStones() {
            Object.keys(stones).forEach(function (k) {
                stoneLayer.remove(stones[k]);
            });
            stones = {};
            if (pickedStone && pickedStone.parent) { pickedStone.parent.remove(pickedStone); }
            pickedStone = null;
        }

        /* ---------- 棋盒 ---------- */

        /* 鼓形竹罐：罐身中间微凸，罐口略收，带竹节纹理与清漆光泽。
           比例参考实拍：罐高约 1.9，口径约 3.0，棋子直径约为口径 1/3。 */
        var bowlProfile = [
            new THREE.Vector2(0.001, 0.00),
            new THREE.Vector2(2.55, 0.04),
            new THREE.Vector2(3.10, 0.42),
            new THREE.Vector2(3.36, 1.00),   // 鼓肚最凸处
            new THREE.Vector2(3.30, 1.60),
            new THREE.Vector2(2.90, 1.92)
        ];
        var bowlGeo = new THREE.LatheGeometry(bowlProfile, 64);
        var bowlMat = new THREE.MeshStandardMaterial({
            map: texFromCanvas(bambooCanvas(512, 256)),
            roughness: 0.30,
            metalness: 0.06,
            envMapIntensity: 0.55,
            side: THREE.DoubleSide
        });

        function makeBowl(px, pz) {
            var g = new THREE.Group();
            var cup = new THREE.Mesh(bowlGeo, bowlMat);
            cup.castShadow = true;
            cup.receiveShadow = true;
            g.add(cup);

            /* 内壁的暗影 */
            var inner = new THREE.Mesh(
                new THREE.CircleGeometry(2.9, 64),
                new THREE.MeshStandardMaterial({ color: 0x140c06, roughness: 1 })
            );
            inner.rotation.x = -Math.PI / 2;
            inner.position.y = 0.26;
            g.add(inner);

            var heap = new THREE.Group();
            g.add(heap);

            g.position.set(px, TABLE_TOP, pz);
            scene.add(g);
            g.userData.heap = heap;
            return g;
        }

        var bowlNear = makeBowl(11.6, 9.6);
        var bowlFar = makeBowl(-11.6, -9.6);

        function fillBowl(bowl, color) {
            var heap = bowl.userData.heap;
            while (heap.children.length) {
                var old = heap.children[0];
                heap.remove(old);
                if (old.dispose) { old.dispose(); }
            }
            /* 132 颗用 InstancedMesh 一次绘制，容量足且不掉帧。
               堆满而蓬松：顶部略高出罐口一点，中间鼓起，边缘贴着内壁。 */
            var count = 132;
            var inst = new THREE.InstancedMesh(stoneGeo, color === 'black' ? blackStoneMat : whiteStoneMat, count);
            var mat4 = new THREE.Matrix4();
            var pos = new THREE.Vector3();
            var quat = new THREE.Quaternion();
            var scl = new THREE.Vector3(1, 1, 1);
            var euler = new THREE.Euler();
            for (var i = 0; i < count; i++) {
                var layer = Math.floor(i / 44);
                var a = i * 2.399963 + rnd(-0.18, 0.18);
                var r = Math.sqrt(Math.random()) * (2.22 - layer * 0.10);
                var h = 0.34 + layer * 0.37 + (1 - r / 2.22) * 0.22 + rnd(-0.025, 0.025);
                pos.set(Math.cos(a) * r, h, Math.sin(a) * r);
                euler.set(rnd(-0.4, 0.4), rnd(0, 6.28), rnd(-0.4, 0.4));
                quat.setFromEuler(euler);
                mat4.compose(pos, quat, scl);
                inst.setMatrixAt(i, mat4);
            }
            inst.instanceMatrix.needsUpdate = true;
            inst.castShadow = true;
            inst.receiveShadow = true;
            heap.add(inst);
            bowl.userData.heapMesh = inst;
        }

        /* ---------- 棋钟 ---------- */

        var clockGroup = new THREE.Group();
        clockGroup.position.set(14.6, TABLE_TOP, 0);
        scene.add(clockGroup);

        var clockCaseMat = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.62, metalness: 0.08 });
        var clockCase = new THREE.Mesh(new THREE.BoxGeometry(5.8, 2.15, 7.2), clockCaseMat);
        clockCase.position.y = 1.08;
        clockCase.castShadow = true;
        clockCase.receiveShadow = true;
        clockGroup.add(clockCase);

        var clockTopMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1f, roughness: 0.55, metalness: 0.1 });
        var clockTop = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.2, 7.0), clockTopMat);
        clockTop.position.y = 2.26;
        clockGroup.add(clockTop);

        var clockScreens = {};
        ['near', 'far'].forEach(function (side) {
            var c = clockCanvas();
            var tex = texFromCanvas(c);
            var mat = new THREE.MeshStandardMaterial({
                map: tex,
                emissive: 0xffffff,
                emissiveMap: tex,
                emissiveIntensity: 0.85,
                roughness: 0.35
            });
            var plane = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 2.4), mat);
            plane.rotation.x = -Math.PI / 2;
            plane.position.set(0, 2.37, side === 'near' ? 1.5 : -1.5);
            if (side === 'far') { plane.rotation.z = Math.PI; }
            clockGroup.add(plane);
            clockScreens[side] = { canvas: c, tex: tex, last: '' };
        });

        /* 拍钟的按键：两头各一片，按下时下沉 */
        var paddleMat = new THREE.MeshStandardMaterial({ color: 0x3b3833, roughness: 0.66, metalness: 0.08 });
        var paddles = {};
        ['near', 'far'].forEach(function (side) {
            var p = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.4, 0.95), paddleMat);
            p.position.set(0, 2.42, side === 'near' ? 3.3 : -3.3);
            p.castShadow = true;
            p.userData.side = side;
            p.userData.baseY = 2.42;
            clockGroup.add(p);
            paddles[side] = p;
        });

        /* 棋钟外壳正面的小铭牌 */
        var badge = new THREE.Mesh(
            new THREE.BoxGeometry(0.02, 0.8, 2.6),
            new THREE.MeshStandardMaterial({ color: 0x8a6a39, roughness: 0.35, metalness: 0.6 })
        );
        badge.position.set(2.91, 1.1, 0);
        clockGroup.add(badge);

        function setClockText(side, text, low) {
            var s = clockScreens[side];
            if (!s || s.last === text) { return; }
            s.last = text;
            drawClockDigits(s.canvas, text, low);
            s.tex.needsUpdate = true;
        }

        /* ---------- 对手 ---------- */

        var peerGroup = new THREE.Group();
        peerGroup.position.set(0, 0, -27);
        peerGroup.visible = false;
        scene.add(peerGroup);

        var clothMat = new THREE.MeshStandardMaterial({ color: 0x2b3238, roughness: 0.92 });
        var skinMat = new THREE.MeshStandardMaterial({ color: 0x8a6a4e, roughness: 0.85 });

        /* 椅子 */
        var chairMat = new THREE.MeshStandardMaterial({ color: 0x1d160f, roughness: 0.75 });
        var chairSeat = new THREE.Mesh(new THREE.BoxGeometry(15, 1.3, 12), chairMat);
        chairSeat.position.set(0, 14.6, 0);
        chairSeat.castShadow = true;
        peerGroup.add(chairSeat);
        var chairBack = new THREE.Mesh(new THREE.BoxGeometry(15, 13, 1.4), chairMat);
        chairBack.position.set(0, 22.2, -6.2);
        chairBack.castShadow = true;
        peerGroup.add(chairBack);

        /* 坐着的人：胯、躯干、肩、两条手臂、脖子、头。
           不去做五官——坐在对面逆着光，本来也看不清脸，靠轮廓就够了。 */
        var hips = new THREE.Mesh(new THREE.SphereGeometry(1, 22, 16), clothMat);
        hips.scale.set(7.2, 3.8, 5.0);
        hips.position.set(0, 19.4, 0.4);
        hips.castShadow = true;
        peerGroup.add(hips);

        var torso = new THREE.Mesh(new THREE.CylinderGeometry(7.5, 6.5, 12.6, 28, 1), clothMat);
        torso.position.set(0, 26.2, 0.2);
        torso.castShadow = true;
        peerGroup.add(torso);

        var shoulders = new THREE.Mesh(new THREE.SphereGeometry(1, 22, 16), clothMat);
        shoulders.scale.set(8.9, 3.2, 4.4);
        shoulders.position.set(0, 32.3, 0.4);
        shoulders.castShadow = true;
        peerGroup.add(shoulders);

        /* 对手的活动手臂由唯一的 handGroup 驱动，避免静态手臂与动画手叠加。 */

        /* 衣领 */
        var collar = new THREE.Mesh(new THREE.TorusGeometry(3.1, 0.55, 8, 26), clothMat);
        collar.rotation.x = Math.PI / 2 - 0.22;
        collar.position.set(0, 33.6, 0.5);
        peerGroup.add(collar);

        var neck = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.2, 3.4, 16), skinMat);
        neck.position.set(0, 34.8, 0.5);
        peerGroup.add(neck);

        var head = new THREE.Mesh(new THREE.SphereGeometry(3.55, 26, 20), skinMat);
        head.scale.set(1, 1.1, 1.02);
        head.position.set(0, 38.9, 0.7);
        head.rotation.x = 0.1;
        head.castShadow = true;
        peerGroup.add(head);

        /* 头发：半个球壳 */
        var hair = new THREE.Mesh(
            new THREE.SphereGeometry(3.7, 26, 16, 0, 6.2832, 0, 1.62),
            new THREE.MeshStandardMaterial({ color: 0x120f0b, roughness: 0.9 })
        );
        hair.scale.set(1.03, 1.08, 1.05);
        hair.position.set(0, 39.05, 0.65);
        hair.rotation.x = 0.1;
        peerGroup.add(hair);

        /* 名牌 */
        var plateCanvas = canvas2d(512, 128);
        var plateTex = texFromCanvas(plateCanvas);
        var plate = new THREE.Sprite(new THREE.SpriteMaterial({
            map: plateTex, transparent: true, depthWrite: false
        }));
        plate.scale.set(22, 5.5, 1);
        plate.position.set(0, 49.5, 2);
        peerGroup.add(plate);

        function drawPlate(text) {
            var x = plateCanvas.getContext('2d');
            x.clearRect(0, 0, 512, 128);
            x.fillStyle = 'rgba(12,10,8,0.72)';
            x.beginPath();
            x.moveTo(24, 14); x.lineTo(488, 14);
            x.quadraticCurveTo(504, 14, 504, 34);
            x.lineTo(504, 94);
            x.quadraticCurveTo(504, 114, 488, 114);
            x.lineTo(24, 114);
            x.quadraticCurveTo(8, 114, 8, 94);
            x.lineTo(8, 34);
            x.quadraticCurveTo(8, 14, 24, 14);
            x.fill();
            x.strokeStyle = 'rgba(201,168,111,0.5)';
            x.lineWidth = 2;
            x.stroke();
            x.fillStyle = '#f0dcb4';
            x.textAlign = 'center';
            x.textBaseline = 'middle';
            x.font = '600 52px "PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif';
            var t = text || '等待棋友';
            if (t.length > 10) { t = t.slice(0, 10) + '…'; }
            x.fillText(t, 256, 66);
            plateTex.needsUpdate = true;
        }
        drawPlate('等待棋友');

        /* 对手背后的冷光，只为了让轮廓浮出来 */
        var rim = new THREE.PointLight(0xa8c0d8, 1.1, 110, 1.5);
        rim.position.set(-15, 44, -12);
        peerGroup.add(rim);

        /* ---------- 手 ---------- */

        var handGroup = new THREE.Group();
        var handModel = new THREE.Group();
        handGroup.add(handModel);
        handGroup.visible = false;
        scene.add(handGroup);

        var handSkin = new THREE.MeshStandardMaterial({ color: 0xe2b48b, roughness: 0.74, metalness: 0 });
        var sleeveMat = new THREE.MeshStandardMaterial({ color: 0x333b45, roughness: 0.93 });

        function bone(a, b, r1, r2, mat) {
            var dir = new THREE.Vector3().subVectors(b, a);
            var len = dir.length();
            var m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r1, len, 14, 1, false), mat);
            m.position.copy(a).addScaledVector(dir, 0.5);
            m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
            m.castShadow = true;
            return m;
        }

        function joint(p, r, mat) {
            var m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 12), mat);
            m.position.copy(p);
            m.castShadow = true;
            return m;
        }

        (function buildHand() {
            var V = function (x, y, z) { return new THREE.Vector3(x, y, z); };

            /* 手背：掌心朝下，虎口在原点上方，指尖捏着的那颗子正好落在原点。
               一根食指引下来，拇指从另一侧包过去，其余三指松着收在掌心下。 */
            var back = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), handSkin);
            back.scale.set(2.05, 0.78, 2.25);
            back.position.set(0, 2.55, 2.65);
            back.castShadow = true;
            handModel.add(back);

            /* 食指 */
            var f = [
                [V(0.92, 2.35, 1.55), V(0.78, 1.28, 0.82), V(0.52, 0.30, 0.26), 0.32],
                [V(0.10, 2.35, 1.45), V(0.02, 1.30, 0.78), V(-0.02, 0.40, 0.34), 0.33],
                [V(-0.72, 2.30, 1.36), V(-0.72, 1.45, 0.92), V(-0.60, 0.66, 0.62), 0.31],
                [V(-1.45, 2.22, 1.20), V(-1.42, 1.60, 0.88), V(-1.20, 0.94, 0.72), 0.28]
            ];
            f.forEach(function (g) {
                var a = g[0], b = g[1], c = g[2], r = g[3];
                handModel.add(bone(a, b, r, r * 0.94, handSkin));
                handModel.add(bone(b, c, r * 0.94, r * 0.82, handSkin));
                handModel.add(joint(a, r * 1.08, handSkin));
                handModel.add(joint(b, r * 0.96, handSkin));
                handModel.add(joint(c, r * 0.86, handSkin));
            });

            /* 拇指 */
            var t0 = V(-1.75, 2.28, 2.25);
            var t1 = V(-1.02, 1.36, 1.15);
            var t2 = V(-0.44, 0.56, 0.48);
            handModel.add(bone(t0, t1, 0.42, 0.36, handSkin), bone(t1, t2, 0.36, 0.31, handSkin));
            handModel.add(joint(t0, 0.44, handSkin), joint(t1, 0.38, handSkin), joint(t2, 0.32, handSkin));

            /* 腕、前臂和衣袖连续延伸到画面外，不再出现悬浮的“断手”。
               手臂随手腕一起移动，末端始终位于玩家肩侧。 */
            var wrist = V(0.03, 2.66, 4.0);
            handModel.add(bone(V(0.04, 2.58, 4.7), wrist, 1.26, 1.14, handSkin));
            handModel.add(joint(V(0.03, 2.62, 4.5), 1.24, handSkin));

            var forearm = bone(wrist, V(0.34, 3.45, 12.8), 1.14, 1.52, handSkin);
            handModel.add(forearm);

            /* 长袖从手腕连续延伸到肩侧；对手侧会按肩部方向旋转并缩短，
               使袖管与对手躯干相接，而不是穿进身体后消失。 */
            var sleeve = bone(V(0.22, 3.2, 10.4), V(1.1, 5.6, 31.0), 1.55, 2.35, sleeveMat);
            handModel.add(sleeve);

            var cuff = new THREE.Mesh(new THREE.CylinderGeometry(1.58, 1.45, 1.15, 24), sleeveMat);
            cuff.position.set(0.18, 3.1, 9.9);
            cuff.rotation.x = Math.atan2(0.85, 8.8);
            handModel.add(cuff);
        })();

        /* r128 没有色彩管理：材质里写的十六进制会被当成线性值，
           暗色一律偏灰。这里统一把颜色转成线性，深色才压得住。 */
        (function fixColors() {
            var seen = [];
            scene.traverse(function (o) {
                if (!o.material) { return; }
                var list = Array.isArray(o.material) ? o.material : [o.material];
                list.forEach(function (m) {
                    if (seen.indexOf(m) >= 0) { return; }
                    seen.push(m);
                    if (m.color && m.color.convertSRGBToLinear) { m.color.convertSRGBToLinear(); }
                    if (m.emissive && m.emissive.convertSRGBToLinear) { m.emissive.convertSRGBToLinear(); }
                });
            });
        })();

        /* ---------- 相机与视角 ---------- */

        var VIEW = {
            black: { pos: new THREE.Vector3(0, 37.2, 27.0), look: new THREE.Vector3(0, 24.8, -1.2) },
            white: { pos: new THREE.Vector3(0, 37.2, -27.0), look: new THREE.Vector3(0, 24.8, 1.2) },
            stand: { pos: new THREE.Vector3(3, 48, 35), look: new THREE.Vector3(0, 23.2, -3) }
        };

        var view = {
            mode: 'stand',
            seat: 'black',
            yaw: 0,
            pitch: 0,
            zoom: 1,
            tYaw: 0,
            tPitch: 0,
            tZoom: 1,
            camPos: VIEW.stand.pos.clone(),
            camLook: VIEW.stand.look.clone(),
            idle: 0,
            orbit: 0
        };

        var camTarget = new THREE.Vector3();

        function baseView() {
            return view.mode === 'stand' ? VIEW.stand : VIEW[view.seat];
        }

        function updateCamera(dt) {
            var b = baseView();
            var t = 1 - Math.pow(0.0016, dt);          // 与帧率无关的平滑

            view.yaw += (view.tYaw - view.yaw) * t;
            view.pitch += (view.tPitch - view.pitch) * t;
            view.zoom += (view.tZoom - view.zoom) * t;
            view.idle += dt;

            var pos = b.pos.clone();
            var look = b.look.clone();

            if (view.mode !== 'stand') {
                /* 坐着：只有玩家拖动或缩放时才改变视角，没有自动摇摆。 */
                var pivot = look.clone();
                var off = pos.clone().sub(pivot);
                off.multiplyScalar(view.zoom);
                off.applyAxisAngle(new THREE.Vector3(0, 1, 0), view.yaw);
                var right = new THREE.Vector3(-off.z, 0, off.x).normalize();
                off.applyAxisAngle(right, -view.pitch);
                pos = pivot.clone().add(off);
            }

            var k = 1 - Math.pow(0.0009, dt);
            view.camPos.lerp(pos, k);
            view.camLook.lerp(look, k);

            camera.position.copy(view.camPos);
            camTarget.copy(view.camLook);
            camera.lookAt(camTarget);
        }

        /* ---------- 手部动画 ---------- */

        var anim = null;

        function bowlOf(side) {
            return side === 'me' ? bowlNear : bowlFar;
        }

        function restOf(side) {
            var nearZ = view.seat === 'black' ? 19.5 : -19.5;
            return side === 'me'
                ? new THREE.Vector3(13.2, TABLE_TOP + 3.4, nearZ)
                : new THREE.Vector3(-13.2, TABLE_TOP + 3.4, -nearZ);
        }

        function worldOf(x, y) {
            return new THREE.Vector3(x - HALF, BOARD_TOP, y - HALF);
        }

        /*
         * 一段落子。
         *   side  'me' | 'peer'   —— 从哪一侧过来（视角永远是自己的座）
         *   color 'black' | 'white'
         *   speed 1 = 正常，2.4 = 快速
         *   onPlace / onGrab / onDone
         */
        var pickedStone = null;

        function takeStone(side, color, onDone) {
            if (anim || pickedStone) { return; }
            side = side === 'peer' ? 'peer' : 'me';
            var bowl = bowlOf(side), rest = restOf(side);
            var top = bowl.position.clone().add(new THREE.Vector3(0, 3.0, 0));
            var stone = null;
            handGroup.visible = true;
            handGroup.position.copy(rest);
            /* 手臂轴线从手腕指向对应座位的肩部中心，袖管因此能连续接入躯干。 */
            var shoulderZ = ((side === 'me') === (view.seat === 'black')) ? 34 : -34;
            var armYaw = Math.atan2(-rest.x, shoulderZ - rest.z);
            handGroup.rotation.set(0, armYaw, 0);
            handModel.scale.set(1, 1, 0.68);
            handModel.rotation.set(0, 0, 0);
            var segs = [
                { d: 380, to: top.clone(), arc: 1.8, e: easeInOutCubic },
                { d: 260, to: top.clone().add(new THREE.Vector3(0, -1.45, 0)), e: easeInOutSine,
                    onEnd: function () {
                        var inst = bowl.userData.heapMesh;
                        if (inst && inst.count > 0) { inst.count -= 1; inst.instanceMatrix.needsUpdate = true; }
                        stone = stoneMesh(color);
                        stoneLayer.add(stone);
                        stone.position.copy(handGroup.position);
                        stone.userData.held = true;
                        stone.userData.grow = 0;
                    }
                },
                { d: 300, to: top.clone().add(new THREE.Vector3(0, 0.55, 0)), arc: 0.4, e: easeOutCubic },
                { d: 300, to: rest.clone(), arc: 1.2, e: easeInOutCubic,
                    onEnd: function () {
                        pickedStone = stone;
                        handGroup.visible = false;
                        if (onDone) { onDone(); }
                    }
                }
            ];
            anim = { segs: segs, i: 0, t: 0, speed: 1, from: rest.clone(), sign: side === 'me' ? 1 : -1, stone: function () { return stone; } };
        }

        function playMove(o) {
            var side = o.side === 'peer' ? 'peer' : 'me';
            var speed = o.speed || 1;
            var target = worldOf(o.x, o.y);
            var bowl = bowlOf(side);
            var rest = restOf(side);

            var stone = o.prePicked && pickedStone ? pickedStone : null;
            if (stone) { pickedStone = null; stone.userData.held = true; }
            /* 预先从棋罐取子的路径也必须完成“移动—下压—放子—收手”；
               旧逻辑只有一段移动动画，没有 onPlace，导致棋盘永远不落子。 */
            function placeHeldStone() {
                if (stone) {
                    stone.userData.held = false;
                    stone.userData.settle = 1;
                    stone.position.set(target.x + rnd(-0.03, 0.03), BOARD_TOP + STONE_HALF, target.z + rnd(-0.03, 0.03));
                    stone.rotation.y = rnd(0, 6.28);
                    stones[o.x + ',' + o.y] = stone;
                }
                if (o.onPlace) { o.onPlace(stone); }
            }

            handGroup.visible = true;
            handGroup.position.copy(rest);
            /* 同一套肩部朝向用于真人与机器人，避免袖管朝错方向而从躯干脱开。 */
            var shoulderZ = ((side === 'me') === (view.seat === 'black')) ? 34 : -34;
            var armYaw = Math.atan2(-rest.x, shoulderZ - rest.z);
            handGroup.rotation.set(0, armYaw, 0);
            handModel.scale.set(1, 1, 0.68);
            handModel.rotation.set(0, 0, 0);

            var sign = side === 'me' ? 1 : -1;
            var bowlTop = bowl.position.clone().add(new THREE.Vector3(0, 3.0, 0));

            var segs = o.prePicked && stone ? [
                { d: 540, to: target.clone().add(new THREE.Vector3(0, 2.5, 0)), arc: 1.9, e: easeInOutCubic },
                { d: 210, to: target.clone().add(new THREE.Vector3(0, 0.62, 0)), e: easeInOutCubic },
                { d: 130, to: target.clone().add(new THREE.Vector3(0, STONE_HALF + 0.08, 0)), e: easeOutCubic,
                    onEnd: placeHeldStone },
                { d: 480, to: rest.clone(), arc: 1.6, e: easeInOutCubic,
                    onEnd: function () {
                        handGroup.visible = false;
                        if (o.onDone) { o.onDone(); }
                    }
                }
            ] : [
                { d: 430, to: bowlTop.clone(), arc: 2.2, e: easeInOutCubic },
                {
                    d: 220, to: bowlTop.clone().add(new THREE.Vector3(0, -1.5, 0)), e: easeInOutSine,
                    onEnd: function () {
                        var inst = bowl.userData.heapMesh;
                        if (inst && inst.count > 0) { inst.count -= 1; inst.instanceMatrix.needsUpdate = true; }
                        stone = stoneMesh(o.color);
                        stoneLayer.add(stone);
                        stone.position.copy(handGroup.position);
                        stone.userData.held = true;
                        stone.userData.grow = 0;
                        if (o.onGrab) { o.onGrab(); }
                    }
                },
                { d: 260, to: bowlTop.clone().add(new THREE.Vector3(0, 0.5, 0)), arc: 0.4, e: easeOutCubic },
                { d: 200, to: bowlTop.clone().add(new THREE.Vector3(0, 0.7, 0)), e: easeInOutSine },
                { d: 520, to: target.clone().add(new THREE.Vector3(0, 2.4, 0)), arc: 1.9, e: easeInOutCubic },
                /* 6. 下压对准落点 */
                {
                    d: 210, to: target.clone().add(new THREE.Vector3(0, 0.62, 0)), e: easeInOutCubic,
                    onStart: function () { handModel.rotation.x = 0; },
                    onEnd: function () { handModel.rotation.x = 0; }
                },
                /* 7. 落子松手 */
                {
                    d: 130, to: target.clone().add(new THREE.Vector3(0, STONE_HALF + 0.08, 0)), e: easeOutCubic,
                    onEnd: function () {
                        if (stone) {
                            stone.userData.held = false;
                            stone.userData.settle = 1;
                            stone.position.set(target.x + rnd(-0.03, 0.03), BOARD_TOP + STONE_HALF, target.z + rnd(-0.03, 0.03));
                            stone.rotation.y = rnd(0, 6.28);
                            stones[o.x + ',' + o.y] = stone;
                        }
                        if (o.onPlace) { o.onPlace(stone); }
                    }
                },
                /* 8. 收手回休息位 */
                {
                    d: 480, to: rest.clone(), arc: 1.6, e: easeInOutCubic,
                    onEnd: function () {
                        handGroup.visible = false;
                        if (o.onDone) { o.onDone(); }
                    }
                }
            ];

            /* 段与段之间插一点「手腕侧倾」，别像机器人 */
            anim = {
                segs: segs,
                i: 0,
                t: 0,
                speed: speed,
                from: rest.clone(),
                mid: rest.clone(),
                sign: sign,
                stone: function () { return stone; }
            };

            segs.forEach(function (s) { s.d = Math.max(50, s.d / speed); });
        }

        function stepAnim(dt) {
            if (!anim) { return; }
            var seg = anim.segs[anim.i];
            if (!seg) { anim = null; return; }

            if (anim.t === 0 && seg.onStart) { seg.onStart(); }

            anim.t += dt * 1000;
            var p = clamp(anim.t / seg.d, 0, 1);
            var e = seg.e(p);

            var from = anim.from;
            var pos = new THREE.Vector3().lerpVectors(from, seg.to, e);
            if (seg.arc) {
                pos.y += Math.sin(Math.PI * e) * seg.arc;
            }
            handGroup.position.copy(pos);

            /* 手随行进方向稍微转一点 */
            var sway = Math.sin(Math.PI * e) * 0.16 * anim.sign;
            handGroup.rotation.z = sway * 0.35;
            handModel.rotation.x = -0.08 * Math.sin(Math.PI * e);

            var st = anim.stone();
            if (st && st.userData.held) {
                st.position.copy(pos);
                /* 与手指捏取点保持一致，确保落子时棋子始终在掌前。 */
                if (st.userData.grow < 1) {
                    st.userData.grow = Math.min(1, st.userData.grow + dt * 6);
                    st.scale.setScalar(easeOutCubic(st.userData.grow));
                }
            }

            if (p >= 1) {
                if (seg.onEnd) { seg.onEnd(); }
                anim.from = seg.to.clone();
                anim.i += 1;
                anim.t = 0;
                if (anim.i >= anim.segs.length) { anim = null; }
            }
        }

        /* 落子后在木头上轻微一顿 */
        function settleStones(dt) {
            Object.keys(stones).forEach(function (k) {
                var m = stones[k];
                if (m.userData.settle > 0) {
                    m.userData.settle = Math.max(0, m.userData.settle - dt * 3.4);
                    var s = Math.sin(m.userData.settle * Math.PI) * 0.06;
                    m.position.y = BOARD_TOP + STONE_HALF + s;
                }
            });
        }

        /* ---------- 悬停提示 ---------- */

        var ghost = new THREE.Mesh(
            stoneGeo,
            new THREE.MeshStandardMaterial({
                color: 0xffffff, transparent: true, opacity: 0.26,
                roughness: 0.3, depthWrite: false
            })
        );
        ghost.visible = false;
        scene.add(ghost);

        var ghostRing = new THREE.Mesh(
            new THREE.RingGeometry(STONE_R * 1.25, STONE_R * 1.42, 40),
            new THREE.MeshBasicMaterial({
                color: 0xffdca8, transparent: true, opacity: 0.5,
                side: THREE.DoubleSide, depthWrite: false
            })
        );
        ghostRing.rotation.x = -Math.PI / 2;
        ghostRing.visible = false;
        scene.add(ghostRing);

        function setGhost(cell, color) {
            if (!cell) {
                ghost.visible = false;
                ghostRing.visible = false;
                return;
            }
            var p = worldOf(cell.x, cell.y);
            ghost.position.set(p.x, BOARD_TOP + STONE_HALF, p.z);
            ghost.material.color.set(color === 'black' ? 0x1a1a1a : 0xffffff);
            ghost.visible = true;
            ghostRing.position.set(p.x, BOARD_TOP + 0.02, p.z);
            ghostRing.visible = true;
        }

        /* 最后一手的记号：一圈浅光 */
        var lastMark = new THREE.Mesh(
            new THREE.RingGeometry(STONE_R * 1.3, STONE_R * 1.45, 44),
            new THREE.MeshBasicMaterial({
                color: 0xffcf82, transparent: true, opacity: 0.55,
                side: THREE.DoubleSide, depthWrite: false
            })
        );
        lastMark.rotation.x = -Math.PI / 2;
        lastMark.visible = false;
        scene.add(lastMark);

        function markLast(cell) {
            if (!cell) { lastMark.visible = false; return; }
            var p = worldOf(cell.x, cell.y);
            lastMark.position.set(p.x, BOARD_TOP + 0.03, p.z);
            lastMark.visible = true;
        }

        /* 胜利的五子：加一圈跳动的环 */
        var winRings = [];
        function setWin(list) {
            winRings.forEach(function (r) { scene.remove(r); });
            winRings = [];
            if (!list || !list.length) { return; }
            list.forEach(function (c) {
                var p = worldOf(c.x, c.y);
                var ring = new THREE.Mesh(
                    new THREE.RingGeometry(STONE_R * 1.5, STONE_R * 1.95, 44),
                    new THREE.MeshBasicMaterial({
                        color: 0xffbf5e, transparent: true, opacity: 0.75,
                        side: THREE.DoubleSide, depthWrite: false
                    })
                );
                ring.rotation.x = -Math.PI / 2;
                ring.position.set(p.x, BOARD_TOP + 0.035, p.z);
                scene.add(ring);
                winRings.push(ring);
            });
        }

        /* ---------- 拍钟 ---------- */

        var paddleAnim = { near: 0, far: 0 };

        function bumpClock(side) {
            if (!paddleAnim.hasOwnProperty(side)) { return; }
            paddleAnim[side] = 1;
        }

        function stepPaddles(dt) {
            ['near', 'far'].forEach(function (side) {
                var p = paddles[side];
                if (paddleAnim[side] > 0) {
                    paddleAnim[side] = Math.max(0, paddleAnim[side] - dt * 3.2);
                    var k = Math.sin(paddleAnim[side] * Math.PI);
                    p.position.y = p.userData.baseY - k * 0.28;
                } else {
                    p.position.y = p.userData.baseY;
                }
            });
        }

        /* ---------- 拾取 ---------- */

        var raycaster = new THREE.Raycaster();
        var ndc = new THREE.Vector2();
        var plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BOARD_TOP);

        function toNdc(clientX, clientY) {
            var r = canvas.getBoundingClientRect();
            ndc.x = ((clientX - r.left) / r.width) * 2 - 1;
            ndc.y = -((clientY - r.top) / r.height) * 2 + 1;
            return ndc;
        }

        function pickBoard(clientX, clientY) {
            raycaster.setFromCamera(toNdc(clientX, clientY), camera);
            var hit = new THREE.Vector3();
            if (!raycaster.ray.intersectPlane(plane, hit)) { return null; }
            var gx = hit.x + HALF;
            var gy = hit.z + HALF;
            var x = Math.round(gx), y = Math.round(gy);
            if (x < 0 || x >= N || y < 0 || y >= N) { return null; }
            if (Math.abs(gx - x) > 0.56 || Math.abs(gy - y) > 0.56) { return null; }
            return { x: x, y: y };
        }

        function pickBowl(clientX, clientY) {
            raycaster.setFromCamera(toNdc(clientX, clientY), camera);
            var hits = raycaster.intersectObjects([bowlNear, bowlFar], true);
            if (!hits.length) { return null; }
            var node = hits[0].object;
            while (node && node.parent !== scene) { node = node.parent; }
            return node === bowlNear ? 'me' : (node === bowlFar ? 'peer' : null);
        }

        function pickClock(clientX, clientY) {
            raycaster.setFromCamera(toNdc(clientX, clientY), camera);
            var hits = raycaster.intersectObjects([paddles.near, paddles.far, clockCase], false);
            if (!hits.length) { return null; }
            var o = hits[0].object;
            if (o === paddles.near) { return 'me'; }
            if (o === paddles.far) { return 'peer'; }
            /* 点到钟体：按离自己近的那半算 */
            var local = clockGroup.worldToLocal(hits[0].point.clone());
            return local.z >= 0 ? 'me' : 'peer';
        }

        /* ---------- 座位 ---------- */

        function refillBowls() {
            fillBowl(bowlNear, view.seat);
            fillBowl(bowlFar, view.seat === 'black' ? 'white' : 'black');
        }

        function setSeat(color) {
            view.seat = color === 'white' ? 'white' : 'black';
            refillBowls();
            /* 对手永远在对座 */
            peerGroup.position.z = view.seat === 'black' ? -27 : 27;
            peerGroup.rotation.y = view.seat === 'black' ? 0 : Math.PI;
            /* 棋盒与棋钟随座位翻转，确保自己始终从身边棋罐取子。 */
            var nearZ = view.seat === 'black' ? 9.6 : -9.6;
            bowlNear.position.set(11.6, TABLE_TOP, nearZ);
            bowlFar.position.set(-11.6, TABLE_TOP, -nearZ);
            clockGroup.position.z = 0;
            clockGroup.rotation.y = view.seat === 'black' ? 0 : Math.PI;
        }

        function sit() { view.mode = 'sit'; view.tYaw = 0; view.tPitch = 0; view.tZoom = 1; }
        function stand() { view.mode = 'stand'; view.tYaw = 0; view.tPitch = 0; view.tZoom = 1; }

        /* ---------- 尺寸 ---------- */

        function resize() {
            var w = canvas.clientWidth || 1;
            var h = canvas.clientHeight || 1;
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        }

        /* ---------- 每帧 ---------- */

        var t0 = 0;
        function frame(dt) {
            t0 += dt;
            updateCamera(dt);
            stepAnim(dt);
            stepPaddles(dt);
            settleStones(dt);
            if (ghostRing.visible) {
                ghostRing.material.opacity = 0.34 + Math.sin(t0 * 4) * 0.14;
            }
            if (lastMark.visible) {
                lastMark.material.opacity = 0.34 + Math.sin(t0 * 2.2) * 0.16;
            }
            winRings.forEach(function (r, i) {
                r.material.opacity = 0.5 + Math.sin(t0 * 3 - i * 0.5) * 0.28;
            });
            renderer.render(scene, camera);
        }

        return {
            resize: resize,
            frame: frame,
            setSeat: setSeat,
            refillBowls: refillBowls,
            sit: sit,
            stand: stand,
            look: function (dx, dy) {
                view.tYaw = clamp(view.tYaw + dx, -0.34, 0.34);
                view.tPitch = clamp(view.tPitch + dy, -0.22, 0.3);
            },
            zoom: function (f) { view.tZoom = clamp(view.tZoom * f, 0.62, 1.7); },
            worldOf: worldOf,
            pickBoard: pickBoard,
            pickClock: pickClock,
            pickBowl: pickBowl,
            takeStone: takeStone,
            playMove: playMove,
            isAnimating: function () { return !!anim; },
            cancelAnimation: function () {
                var held = anim && anim.stone ? anim.stone() : null;
                if (held && held.parent) { held.parent.remove(held); }
                anim = null;
                handGroup.visible = false;
            },
            dispose: function () {
                try { renderer.dispose(); } catch (e) { /* noop */ }
            },
            addStone: addStone,
            clearStones: clearStones,
            setGhost: setGhost,
            markLast: markLast,
            setWin: setWin,
            bumpClock: bumpClock,
            setClockText: setClockText,
            setPeer: function (name, present) {
                peerGroup.visible = !!present;
                if (name) { drawPlate(name); }
            },
            setPlayerNames: function (myName, peerName) {
                drawPlayerSign(myName, peerName);
            },
            setPeerPlate: drawPlate
        };
    }

    window.DJ_TABLE = { create: create };
})();
