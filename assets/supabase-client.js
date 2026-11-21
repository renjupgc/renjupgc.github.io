/*
 * 连珠杂箱 · Supabase 客户端
 * ------------------------------------------------------------
 * 纯静态站没有构建步骤，所以用 CDN 上的 UMD 版 supabase-js，
 * 全局变量 window.supabase.createClient 直接用。
 *
 * 加载顺序：config → SDK → createClient，全程只做一次。
 *
 * 对外暴露：
 *   window.ZBX_SB_GET(force)   Promise<client>，失败不缓存，可以再调一次重试
 *   window.ZBX_SB_READY        兼容旧调用的惰性对象，.then/.catch/await 都行，
 *                              但只有真的有人等它时才去下载 SDK
 *   window.ZBX_SUPABASE_CLIENT  客户端实例（就绪后才有值）
 *
 * 两条链路都可能因为网络抖动失败（国内直连 supabase.co 尤其不稳）：
 *   - SDK 脚本加载：单个 CDN 12 秒不响应就换下一个，全失败后下次调用可重来；
 *   - 数据/登录请求：单次 15 秒超时，网络层失败自动重试一次。
 * createClient 不再缓存失败结果，否则一次抖动会让整页到刷新为止都用不了。
 *
 * 没填配置时 Promise 会 reject 一个带中文说明的错误，
 * 调用方 catch 后展示给用户，页面其它功能不受影响。
 */
(function () {
    'use strict';

    if (window.ZBX_SB_READY) { return; }

    /* 国内访问 jsdelivr 偶尔不稳，备一个 unpkg，按顺序降级 */
    var SDK_URLS = [
        'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js',
        'https://unpkg.com/@supabase/supabase-js@2/dist/umd/supabase.js'
    ];

    var SDK_TIMEOUT = 12000;
    var REQ_TIMEOUT = 15000;

    /* 最近一次初始化尝试；失败后置空，下一次调用重新走一遍 */
    var pending = null;

    function base() {
        return (document.body && document.body.getAttribute('data-base')) || '';
    }

    function wait(ms) {
        return new Promise(function (resolve) { window.setTimeout(resolve, ms); });
    }

    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            var done = false;
            var timer = window.setTimeout(function () {
                if (done) { return; }
                done = true;
                reject(new Error('脚本加载超时：' + src));
            }, SDK_TIMEOUT);

            s.src = src;
            s.async = true;
            s.onload = function () {
                if (done) { return; }
                done = true;
                window.clearTimeout(timer);
                resolve();
            };
            s.onerror = function () {
                if (done) { return; }
                done = true;
                window.clearTimeout(timer);
                reject(new Error('脚本加载失败：' + src));
            };
            document.head.appendChild(s);
        });
    }

    function loadFirst(urls, i) {
        i = i || 0;
        if (i >= urls.length) {
            return Promise.reject(new Error('Supabase SDK 加载失败，请检查网络后重试'));
        }
        return loadScript(urls[i]).catch(function () { return loadFirst(urls, i + 1); });
    }

    /* 只有网络层失败才值得重试，业务错误（4xx 等）原样交给调用方 */
    function retryable(err) {
        if (!err) { return false; }
        var name = String(err.name || '');
        var msg = String(err.message || err);
        return name === 'AbortError' || name === 'TypeError' ||
            /failed to fetch|network\s?error|network request failed|load failed|timed?\s?out|timeout/i.test(msg);
    }

    function fetchOnce(input, init) {
        if (!window.AbortController) { return window.fetch(input, init); }
        var ctrl = new window.AbortController();
        var opts = {};
        if (init) {
            for (var k in init) {
                if (Object.prototype.hasOwnProperty.call(init, k)) { opts[k] = init[k]; }
            }
        }
        opts.signal = ctrl.signal;
        var timer = window.setTimeout(function () {
            try { ctrl.abort(); } catch (e) { /* 忽略 */ }
        }, REQ_TIMEOUT);

        return window.fetch(input, opts).then(function (res) {
            window.clearTimeout(timer);
            return res;
        }, function (err) {
            window.clearTimeout(timer);
            throw err;
        });
    }

    function fetchWithRetry(input, init) {
        return fetchOnce(input, init).catch(function (err) {
            if (!retryable(err)) { throw err; }
            return wait(700).then(function () { return fetchOnce(input, init); });
        });
    }

    function createOnce() {
        var waitConfig = Promise.resolve();

        /* 配置没被页面预先引入时，自己补一个 <script> */
        if (!(window.ZBX_SUPABASE && window.ZBX_SUPABASE.url)) {
            waitConfig = loadScript(base() + 'assets/supabase-config.js').catch(function () {});
        }

        return waitConfig.then(function () {
            var cfg = window.ZBX_SUPABASE || {};
            if (!cfg.url || !cfg.anonKey) {
                throw new Error('尚未配置 Supabase：请在 assets/supabase-config.js 填入 url 与 anonKey');
            }
            if (window.supabase && window.supabase.createClient) { return null; }
            return loadFirst(SDK_URLS);
        }).then(function () {
            if (!(window.supabase && window.supabase.createClient)) {
                throw new Error('Supabase SDK 未正确加载');
            }
            if (window.ZBX_SUPABASE_CLIENT) { return window.ZBX_SUPABASE_CLIENT; }

            var cfg = window.ZBX_SUPABASE;
            var client = window.supabase.createClient(cfg.url, cfg.anonKey, {
                auth: {
                    persistSession: true,     /* 会话存 localStorage，刷新不用重登 */
                    autoRefreshToken: true,   /* 自动续期 access token */
                    detectSessionInUrl: false /* 不做 magic link 回调，纯用户名密码 */
                },
                global: { fetch: fetchWithRetry }
            });
            window.ZBX_SUPABASE_CLIENT = client;
            return client;
        });
    }

    /* 允许重试：失败的那次不留在缓存里 */
    function getClient() {
        if (window.ZBX_SUPABASE_CLIENT) { return Promise.resolve(window.ZBX_SUPABASE_CLIENT); }
        if (pending) { return pending; }
        pending = createOnce().then(function (client) {
            window.ZBX_SUPABASE_CLIENT = client;
            return client;
        }, function (err) {
            pending = null;
            throw err;
        });
        return pending;
    }

    window.ZBX_SB_GET = getClient;

    /*
     * 兼容旧调用点：ZBX_SB_READY 仍然可以 .then / .catch / await，
     * 但脚本载入时不再主动建连——真的有人等它时才去下载 SDK。
     * 访客页面因此完全不用碰 CDN 上那 100KB+ 的 SDK。
     */
    var readyPromise = null;

    function ready() {
        if (!readyPromise) {
            readyPromise = getClient();
            /* 避免未处理的 Promise 拒绝告警；具体错误由各调用点 catch */
            readyPromise.catch(function () {});
        }
        return readyPromise;
    }

    window.ZBX_SB_READY = {
        then: function (a, b) { return ready().then(a, b); },
        'catch': function (b) { return ready().catch(b); },
        'finally': function (f) { return ready().finally(f); }
    };
})();
