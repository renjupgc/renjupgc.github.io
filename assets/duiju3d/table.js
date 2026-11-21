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

    /* ---------- 尺寸（1 单位 = 一格 = 3cm） ---------- */

    var N = 15;
    var HALF = 7;                 // 线段从 -7 到 7
    var TABLE_TOP = 23.5;         // 桌面高度 ≈ 70cm
    var BOARD_T = 0.7;
    var BOARD_TOP = TABLE_TOP + BOARD_T;
    var STONE_R = 0.385;
    var STONE_HALF = 0.155;

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
        t.anisotropy = 16;
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

    /* 棋盘面：木底 + 15×15 线 + 五个星位 */
    function boardCanvas() {
        var S = 2048;
        var c = woodCanvas(S, S, '#c2914f', '#7d5222', '#dfbd86', 70);
        var x = c.getContext('2d');

        var pad = Math.round(S * (2 / 18));
        var step = (S - pad * 2) / (N - 1);
        var lw = 4.4;

        /* 边部压暗一点，像打磨过的棋盘边 */
        var g = x.createRadialGradient(S / 2, S / 2, S * 0.32, S / 2, S / 2, S * 0.78);
        g.addColorStop(0, 'rgba(90,58,22,0)');
        g.addColorStop(1, 'rgba(90,58,22,0.22)');
        x.fillStyle = g;
        x.fillRect(0, 0, S, S);

        x.strokeStyle = 'rgba(26,15,4,0.96)';
        x.lineWidth = lw;
        x.lineCap = 'square';
        for (var i = 0; i < N; i++) {
            var p = pad + i * step;

            x.beginPath();
            x.moveTo(pad, p);
            x.lineTo(S - pad, p);
            x.stroke();

            x.beginPath();
            x.moveTo(p, pad);
            x.lineTo(p, S - pad);
            x.stroke();
        }

        /* 星位 */
        var stars = [[3, 3], [3, 11], [11, 3], [11, 11], [7, 7]];
        x.fillStyle = 'rgba(28,17,6,0.92)';
        stars.forEach(function (s) {
            x.beginPath();
            x.arc(pad + s[0] * step, pad + s[1] * step, lw * 2.1, 0, 6.2832);
            x.fill();
        });

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
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.outputEncoding = THREE.sRGBEncoding;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.18;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        var scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0a0908);
        scene.fog = new THREE.Fog(0x0a0908, 120, 320);

        var camera = new THREE.PerspectiveCamera(56, 1, 0.6, 900);
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

        /* ---------- 光 ---------- */

        scene.add(new THREE.HemisphereLight(0x4b4438, 0x0f0c08, 0.55));

        var key = new THREE.SpotLight(0xffdfb0, 1.15, 260, 0.8, 0.9, 1.4);
        key.position.set(6, 96, 26);
        key.target.position.set(0, TABLE_TOP, 0);
        key.castShadow = true;
        key.shadow.mapSize.set(2048, 2048);
        key.shadow.bias = -0.0007;
        key.shadow.radius = 4;
        key.shadow.camera.near = 40;
        key.shadow.camera.far = 220;
        scene.add(key, key.target);

        var fill = new THREE.DirectionalLight(0x9fb6cc, 0.22);
        fill.position.set(-46, 42, -30);
        scene.add(fill);

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
                roughness: 0.42,
                metalness: 0.02
            })
        );
        boardFace.rotation.x = -Math.PI / 2;
        boardFace.position.set(0, BOARD_TOP + 0.004, 0);
        boardFace.receiveShadow = true;
        scene.add(boardFace);

        /* ---------- 棋子 ---------- */

        var stoneGeo = new THREE.SphereGeometry(STONE_R, 40, 22);
        stoneGeo.scale(1, 0.42, 1);
        stoneGeo.computeVertexNormals();

        var blackStoneMat = new THREE.MeshPhysicalMaterial({
            color: 0x0a0a0c,
            roughness: 0.16,
            metalness: 0.0,
            clearcoat: 1,
            clearcoatRoughness: 0.06,
            envMapIntensity: 1.9
        });
        var whiteStoneMat = new THREE.MeshPhysicalMaterial({
            color: 0xfbf7ec,
            roughness: 0.26,
            metalness: 0.0,
            clearcoat: 0.9,
            clearcoatRoughness: 0.1,
            envMapIntensity: 1.45
        });

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
        }

        /* ---------- 棋盒 ---------- */

        var bowlR = 3.05;
        var bowlProfile = [
            new THREE.Vector2(0.02, 0.02),
            new THREE.Vector2(2.1, 0.06),
            new THREE.Vector2(2.52, 0.5),
            new THREE.Vector2(2.86, 1.15),
            new THREE.Vector2(3.02, 1.72)
        ];
        var bowlGeo = new THREE.LatheGeometry(bowlProfile, 48);
        var bowlMat = new THREE.MeshStandardMaterial({
            map: texFromCanvas(woodCanvas(512, 256, '#5a3b23', '#2b1a0d', '#7b5535', 60)),
            roughness: 0.46,
            metalness: 0.04,
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
                new THREE.CircleGeometry(2.78, 40),
                new THREE.MeshStandardMaterial({ color: 0x140c06, roughness: 1 })
            );
            inner.rotation.x = -Math.PI / 2;
            inner.position.y = 0.22;
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
            while (heap.children.length) { heap.remove(heap.children[0]); }
            /* 三层共 78 颗，远看是装满的棋罐，近看也有自然的堆叠。 */
            for (var i = 0; i < 78; i++) {
                var m = stoneMesh(color);
                var layer = Math.floor(i / 26);
                var a = i * 2.399963 + rnd(-0.18, 0.18);
                var r = Math.sqrt(Math.random()) * (2.28 - layer * 0.2);
                var h = 0.72 + layer * 0.48 + (1 - r / 2.28) * 0.22 + rnd(-0.08, 0.08);
                m.position.set(Math.cos(a) * r, h, Math.sin(a) * r);
                m.rotation.set(rnd(-0.45, 0.45), rnd(0, 6.28), rnd(-0.45, 0.45));
                m.castShadow = layer === 2;
                heap.add(m);
            }
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

        [-1, 1].forEach(function (sg) {
            var a = new THREE.Vector3(sg * 6.6, 31.2, 0.8);
            var b = new THREE.Vector3(sg * 8.0, 25.4, 3.0);
            var c = new THREE.Vector3(sg * 6.2, 21.0, 5.6);
            peerGroup.add(bone(a, b, 2.2, 1.95, clothMat));
            peerGroup.add(bone(b, c, 1.95, 1.6, clothMat));
            peerGroup.add(joint(a, 2.3, clothMat), joint(b, 2.0, clothMat));
            var hd = new THREE.Mesh(new THREE.SphereGeometry(1.5, 14, 12), skinMat);
            hd.scale.set(1, 0.8, 1.25);
            hd.position.copy(c);
            peerGroup.add(hd);
        });

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

            /* 腕与袖口。
               不下往前臂——机位就在座位上，自己的小臂几乎贴着镜头，
               画出来会变成一根横在眼前的黑筒，反倒把手挡住。
               只留一截腕子收进袖口，剩下交给想象。 */
            var wrist = V(0.03, 2.66, 4.0);
            handModel.add(bone(V(0.04, 2.58, 4.7), wrist, 1.26, 1.14, handSkin));
            handModel.add(joint(V(0.03, 2.62, 4.5), 1.24, handSkin));

            var forearm = bone(V(0.03, 2.66, 4.1), V(0.16, 2.92, 6.6), 1.18, 1.42, handSkin);
            handModel.add(forearm);

            var sleeve = bone(V(0.08, 2.76, 5.5), V(0.3, 3.12, 8.2), 1.48, 1.62, sleeveMat);
            handModel.add(sleeve);
            handModel.add(joint(V(0.3, 3.12, 8.2), 1.62, sleeveMat));

            var cuff = new THREE.Mesh(new THREE.CylinderGeometry(1.56, 1.5, 1.0, 22, 1, true), sleeveMat);
            cuff.position.set(0.08, 2.78, 5.62);
            cuff.rotation.x = Math.atan2(0.2, 2.4);
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
            black: { pos: new THREE.Vector3(0, 39.8, 31.0), look: new THREE.Vector3(0, 27.4, -4.2) },
            white: { pos: new THREE.Vector3(0, 39.8, -31.0), look: new THREE.Vector3(0, 27.4, 4.2) },
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

            if (view.mode === 'stand') {
                /* 站着的全景自己慢慢转一点，像在打量这间屋子 */
                view.orbit += dt * 0.055;
                var a = Math.sin(view.orbit) * 0.34 + view.yaw;
                var r = pos.length();
                pos.applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
                look.applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
            } else {
                /* 坐着：绕注视点转一点头，再呼吸 */
                var pivot = look.clone();
                var off = pos.clone().sub(pivot);
                off.multiplyScalar(view.zoom);
                off.applyAxisAngle(new THREE.Vector3(0, 1, 0), view.yaw);
                var right = new THREE.Vector3(-off.z, 0, off.x).normalize();
                off.applyAxisAngle(right, -view.pitch);
                pos = pivot.clone().add(off);

                var br = Math.sin(view.idle * 1.15) * 0.055;
                pos.y += br;
                pos.x += Math.sin(view.idle * 0.63) * 0.09;
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
            return side === 'me'
                ? new THREE.Vector3(13.2, TABLE_TOP + 3.4, 19.5)
                : new THREE.Vector3(-13.2, TABLE_TOP + 3.4, -19.5);
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
        function playMove(o) {
            var side = o.side === 'peer' ? 'peer' : 'me';
            var speed = o.speed || 1;
            var target = worldOf(o.x, o.y);
            var bowl = bowlOf(side);
            var rest = restOf(side);

            var stone = null;

            handGroup.visible = true;
            handGroup.position.copy(rest);
            handGroup.rotation.set(0, side === 'me' ? 0.5 : Math.PI + 0.5, 0);
            handModel.rotation.set(0, 0, 0);

            var sign = side === 'me' ? 1 : -1;
            var bowlTop = bowl.position.clone().add(new THREE.Vector3(0, 3.0, 0));

            var segs = [
                { d: 430, to: bowlTop.clone(), arc: 2.2, e: easeInOutCubic },
                {
                    d: 200, to: bowlTop.clone().add(new THREE.Vector3(0, -1.5, 0)), e: easeInOutSine,
                    onEnd: function () {
                        stone = stoneMesh(o.color);
                        stone.position.copy(handGroup.position);
                        stone.scale.setScalar(0.001);
                        stoneLayer.add(stone);
                        if (o.onGrab) { o.onGrab(); }
                    }
                },
                {
                    d: 260, to: bowlTop.clone().add(new THREE.Vector3(0, 0.5, 0)), e: easeOutCubic,
                    onStart: function () {
                        /* 捏起来，棋子跟着手 */
                        if (stone) {
                            stone.userData.held = true;
                            stone.userData.grow = 0;
                        }
                    }
                },
                { d: 520, to: target.clone().add(new THREE.Vector3(0, 2.4, 0)), arc: 1.9, e: easeInOutCubic },
                {
                    d: 210, to: target.clone().add(new THREE.Vector3(0, 0.62, 0)), e: easeInOutCubic,
                    onStart: function () { handModel.rotation.x = 0; },
                    onEnd: function () { handModel.rotation.x = 0; }
                },
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
            new THREE.SphereGeometry(STONE_R * 1.06, 24, 16),
            new THREE.MeshStandardMaterial({
                color: 0xffffff, transparent: true, opacity: 0.26,
                roughness: 0.3, depthWrite: false
            })
        );
        ghost.geometry.scale(1, 0.42, 1);
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
            if (Math.abs(gx - x) > 0.46 || Math.abs(gy - y) > 0.46) { return null; }
            return { x: x, y: y };
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

        function setSeat(color) {
            view.seat = color === 'white' ? 'white' : 'black';
            /* 近处棋盒放自己的子，远处放对手的 */
            fillBowl(bowlNear, color);
            fillBowl(bowlFar, color === 'black' ? 'white' : 'black');
            /* 对手永远在对座 */
            peerGroup.position.z = view.seat === 'black' ? -27 : 27;
            peerGroup.rotation.y = view.seat === 'black' ? 0 : Math.PI;
            clockGroup.position.z = 0;
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
            playMove: playMove,
            isAnimating: function () { return !!anim; },
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
            setPeerPlate: drawPlate
        };
    }

    window.DJ_TABLE = { create: create };
})();
