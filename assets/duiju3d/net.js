/*
 * 连珠杂箱 · 3D 对局的联机层
 * ------------------------------------------------------------
 * 房间号就是频道名，两个人进同一个号就在同一张桌子上。
 * 走站上已有的 Supabase 实时通道（broadcast），不落库、不留档，
 * 落子只在两台浏览器之间传，频道一关就散。
 *
 *   在线：supabase.channel('zbx-duiju3d-<房间号>')，public 频道，
 *         只发广播、不读表，所以不需要建任何数据库对象。
 *   兜底：实时服务连不上时降级成 BroadcastChannel —— 同一个浏览器
 *         开两个标签页也能对下，只是跨设备就不行了，界面上会说明。
 *
 * 所有消息都是同一个格式：{ t: '类型', ... }，见 app.js 里的 dispatch。
 */
(function () {
    'use strict';

    var PREFIX = 'zbx-duiju3d-';
    var SUBSCRIBE_TIMEOUT = 9000;

    function connect(opts) {
        var code = String(opts.code || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
        var sendQueue = [];
        var closed = false;
        var ready = false;
        var impl = null;

        var net = {
            mode: 'pending',
            code: code,
            send: function (msg) {
                if (closed || !msg) { return; }
                if (!ready) {
                    sendQueue.push(msg);
                    if (sendQueue.length > 40) { sendQueue.shift(); }
                    return;
                }
                try { impl.send(msg); } catch (e) { /* 忽略单条失败 */ }
            },
            close: function () {
                closed = true;
                ready = false;
                try { if (impl) { impl.close(); } } catch (e) { /* noop */ }
            }
        };

        function boot(transport, mode) {
            if (closed) { transport.close(); return; }
            impl = transport;
            net.mode = mode;
            ready = true;
            if (opts.onStatus) { opts.onStatus(mode); }
            sendQueue.forEach(function (m) { try { impl.send(m); } catch (e) { /* noop */ } });
            sendQueue = [];
        }

        function localFallback() {
            if (closed) { return; }
            var bc;
            try {
                bc = new BroadcastChannel(PREFIX + 'local-' + code);
            } catch (e) {
                if (opts.onStatus) { opts.onStatus('error'); }
                return;
            }
            bc.onmessage = function (ev) {
                if (!closed && opts.onMessage) { opts.onMessage(ev.data); }
            };
            boot({
                send: function (m) { bc.postMessage(m); },
                close: function () { bc.close(); }
            }, 'local');
        }

        function startRemote() {
            var getClient = window.ZBX_SB_GET;
            if (typeof getClient !== 'function') {
                localFallback();
                return;
            }

            var settled = false;
            var timer = window.setTimeout(function () {
                if (settled) { return; }
                settled = true;
                if (opts.onStatus) { opts.onStatus('slow'); }
                localFallback();
            }, SUBSCRIBE_TIMEOUT);

            getClient().then(function (sb) {
                if (closed) { return; }
                var ch = sb.channel(PREFIX + code, {
                    config: {
                        broadcast: { self: false },
                        presence: { key: opts.id }
                    }
                });

                ch.on('broadcast', { event: 'm' }, function (payload) {
                    if (!closed && payload && opts.onMessage) { opts.onMessage(payload.payload); }
                });

                ch.subscribe(function (status) {
                    if (closed) { return; }
                    if (status === 'SUBSCRIBED') {
                        if (settled) { return; }
                        settled = true;
                        window.clearTimeout(timer);
                        boot({
                            send: function (m) {
                                ch.send({ type: 'broadcast', event: 'm', payload: m });
                            },
                            close: function () { try { sb.removeChannel(ch); } catch (e) { /* noop */ } }
                        }, 'online');
                    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                        if (settled) { return; }
                        settled = true;
                        window.clearTimeout(timer);
                        try { sb.removeChannel(ch); } catch (e) { /* noop */ }
                        localFallback();
                    }
                });
            }).catch(function () {
                if (settled) { return; }
                settled = true;
                window.clearTimeout(timer);
                localFallback();
            });
        }

        startRemote();
        return net;
    }

    /* 六位房间号，去掉了 0/O/1/I 这类看串的字符 */
    function newCode() {
        var ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        var s = '';
        for (var i = 0; i < 6; i++) {
            s += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length));
        }
        return s;
    }

    window.DJ_NET = {
        connect: connect,
        newCode: newCode
    };
})();
