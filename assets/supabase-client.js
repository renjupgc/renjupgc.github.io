/*
 * 连珠杂箱 · Supabase 客户端
 * ------------------------------------------------------------
 * 纯静态站没有构建步骤，所以用 CDN 上的 UMD 版 supabase-js，
 * 全局变量 window.supabase.createClient 直接用。
 *
 * 加载顺序：config → SDK → createClient，全程只做一次。
 *
 * 对外暴露：
 *   window.ZBX_SB_READY         Promise<client>，所有调用方等它
 *   window.ZBX_SUPABASE_CLIENT  客户端实例（就绪后才有值）
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

    function base() {
        return (document.body && document.body.getAttribute('data-base')) || '';
    }

    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = src;
            s.async = true;
            s.onload = function () { resolve(); };
            s.onerror = function () { reject(new Error('脚本加载失败：' + src)); };
            document.head.appendChild(s);
        });
    }

    function loadFirst(urls, i) {
        i = i || 0;
        if (i >= urls.length) {
            return Promise.reject(new Error('Supabase SDK 加载失败，请检查网络或换用其他网络环境'));
        }
        return loadScript(urls[i]).catch(function () { return loadFirst(urls, i + 1); });
    }

    var ready = new Promise(function (resolve, reject) {
        var waitConfig = Promise.resolve();

        /* 配置没被页面预先引入时，自己补一个 <script> */
        if (!(window.ZBX_SUPABASE && window.ZBX_SUPABASE.url)) {
            waitConfig = loadScript(base() + 'assets/supabase-config.js').catch(function () {});
        }

        waitConfig.then(function () {
            var cfg = window.ZBX_SUPABASE || {};
            if (!cfg.url || !cfg.anonKey) {
                throw new Error('尚未配置 Supabase：请打开 assets/supabase-config.js，填入 url 与 anonKey');
            }
            if (window.supabase && window.supabase.createClient) { return null; }
            return loadFirst(SDK_URLS);
        }).then(function () {
            if (!(window.supabase && window.supabase.createClient)) {
                throw new Error('Supabase SDK 未正确加载');
            }
            if (window.ZBX_SUPABASE_CLIENT) {
                resolve(window.ZBX_SUPABASE_CLIENT);
                return;
            }
            var cfg = window.ZBX_SUPABASE;
            var client = window.supabase.createClient(cfg.url, cfg.anonKey, {
                auth: {
                    persistSession: true,     /* 会话存 localStorage，刷新不用重登 */
                    autoRefreshToken: true,   /* 自动续期 access token */
                    detectSessionInUrl: false /* 不做 magic link 回调，纯用户名密码 */
                }
            });
            window.ZBX_SUPABASE_CLIENT = client;
            resolve(client);
        }).catch(function (err) {
            reject(err);
        });
    });

    /* 避免未处理的 Promise 拒绝告警；具体错误由各调用点 catch */
    ready.catch(function () {});

    window.ZBX_SB_READY = ready;
})();
