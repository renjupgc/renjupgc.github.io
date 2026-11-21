/*
 * 连珠杂箱 · 3D 对局的联机层
 * Supabase 实时广播负责跨设备联机；断线后自动重连，消息先入队，
 * 恢复后由 app.js 重新同步完整棋局。实时服务初次连接多次失败时才
 * 降级到 BroadcastChannel，避免对局中途误切成本机模式造成分房。
 */
(function () {
    'use strict';

    var PREFIX = 'zbx-duiju3d-';
    var SUBSCRIBE_TIMEOUT = 12000;

    function connect(opts) {
        var code = String(opts.code || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
        var sendQueue = [];
        var closed = false;
        var ready = false;
        var impl = null;
        var retryTimer = 0;
        var connectTimer = 0;
        var pendingCleanup = null;
        var generation = 0;
        var attempts = 0;
        var everOnline = false;

        function status(mode) {
            if (opts.onStatus) { opts.onStatus(mode); }
        }

        var net = {
            mode: 'pending',
            code: code,
            send: function (msg) {
                if (closed || !msg) { return; }
                if (!ready) {
                    /* 心跳没有补发价值，关键落子、拍钟和同步消息必须保留。 */
                    if (msg.t === 'ping') { return; }
                    sendQueue.push(msg);
                    if (sendQueue.length > 1000) { sendQueue.shift(); }
                    return;
                }
                try { impl.send(msg); } catch (e) {
                    if (msg.t !== 'ping') { sendQueue.push(msg); }
                }
            },
            close: function () {
                closed = true;
                ready = false;
                generation += 1;
                window.clearTimeout(retryTimer);
                window.clearTimeout(connectTimer);
                if (pendingCleanup) {
                    try { pendingCleanup(); } catch (e) { /* noop */ }
                    pendingCleanup = null;
                }
                if (impl) {
                    try { impl.close(); } catch (e) { /* noop */ }
                    impl = null;
                }
            }
        };

        function boot(transport, mode) {
            if (closed) { transport.close(); return; }
            impl = transport;
            net.mode = mode;
            ready = true;
            status(mode);
            var queued = sendQueue;
            sendQueue = [];
            queued.forEach(function (m) {
                try { impl.send(m); } catch (e) { sendQueue.push(m); }
            });
        }

        function localFallback() {
            if (closed) { return; }
            var bc;
            try {
                bc = new BroadcastChannel(PREFIX + 'local-' + code);
            } catch (e) {
                status('error');
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

        function scheduleReconnect() {
            if (closed) { return; }
            attempts += 1;
            status('reconnecting');
            var delay = Math.min(12000, 700 * Math.pow(2, attempts));
            retryTimer = window.setTimeout(startRemote, delay);
        }

        function startRemote() {
            if (closed) { return; }
            var getClient = window.ZBX_SB_GET;
            if (typeof getClient !== 'function') { localFallback(); return; }

            var gen = ++generation;
            var failed = false;
            var subscribed = false;
            var sb = null;
            var ch = null;
            ready = false;

            function cleanup() {
                window.clearTimeout(connectTimer);
                if (ch && sb) {
                    try { sb.removeChannel(ch); } catch (e) { /* noop */ }
                }
                ch = null;
                pendingCleanup = null;
            }
            pendingCleanup = cleanup;

            function fail() {
                if (closed || failed || gen !== generation) { return; }
                failed = true;
                cleanup();
                ready = false;
                impl = null;
                net.mode = 'reconnecting';
                /* 已经成功联机过就始终重连，绝不中途切到本机频道。 */
                if (everOnline || attempts < 2) { scheduleReconnect(); }
                else { localFallback(); }
            }

            connectTimer = window.setTimeout(fail, SUBSCRIBE_TIMEOUT);

            getClient().then(function (client) {
                if (closed || failed || gen !== generation) { return; }
                sb = client;
                ch = sb.channel(PREFIX + code, {
                    config: {
                        broadcast: { self: false },
                        presence: { key: opts.id }
                    }
                });

                ch.on('broadcast', { event: 'm' }, function (payload) {
                    if (!closed && !failed && gen === generation && payload && opts.onMessage) {
                        opts.onMessage(payload.payload);
                    }
                });

                ch.subscribe(function (state) {
                    if (closed || failed || gen !== generation) { return; }
                    if (state === 'SUBSCRIBED') {
                        if (subscribed) { return; }
                        subscribed = true;
                        window.clearTimeout(connectTimer);
                        pendingCleanup = null;
                        everOnline = true;
                        attempts = 0;
                        boot({
                            send: function (m) {
                                ch.send({ type: 'broadcast', event: 'm', payload: m });
                            },
                            close: cleanup
                        }, 'online');
                    } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') {
                        fail();
                    }
                });
            }).catch(fail);
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
