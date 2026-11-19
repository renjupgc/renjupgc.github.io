/*
 * 连珠杂箱 · 云服务统一入口
 * ------------------------------------------------------------
 * 加载 WorkBuddy 云 SDK（CDN IIFE 版，纯静态站无需构建），用当前应用的
 * publicConfig 初始化唯一客户端实例，供全站各功能复用：
 *   - 末轮计算器 zaji/molun.html  → 云大模型识别成绩单（cloud.llm）
 *   - 访问埋点 assets/visit-log.js → 云数据库写入（cloud.database）
 *
 * 对外暴露：
 *   window.ZBX_CLOUD      云客户端（SDK 加载完成后才有值）
 *   window.ZBX_CLOUD_READY Promise<cloud>，所有调用方等待它即可
 *
 * endpoint / publishableKey / oauthRelayBaseUrl 均来自云服务 publicConfig，
 * 属于可下发到前端的公开配置，不含任何长期密钥。
 */
(function () {
    'use strict';

    if (window.ZBX_CLOUD_READY) { return; }

    var PUBLIC_CONFIG = {
        endpoint: 'https://renjubox.app.workbuddy.host',
        oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
        publishableKey: 'wbpk_3x655F3XrgCk0sjey3CBp7_sepuOHevXPwn65VqVl7Yqk8W5cqfHzC9'
    };
    var SDK_URL = 'https://cdn.jsdelivr.net/npm/@tencent-ai/workbuddy-cloud-sdk@dev/lib/index.global.js';

    var ready = new Promise(function (resolve, reject) {
        var settled = false;

        function init() {
            if (settled) { return; }
            var factory = window.WorkBuddyCloud && window.WorkBuddyCloud.createWorkBuddyCloud;
            if (!factory) {
                settled = true;
                reject(new Error('云服务 SDK 未正确加载'));
                return;
            }
            try {
                var cloud = factory({
                    endpoint: PUBLIC_CONFIG.endpoint,
                    oauthRelayBaseUrl: PUBLIC_CONFIG.oauthRelayBaseUrl,
                    publishableKey: PUBLIC_CONFIG.publishableKey
                });
                window.ZBX_CLOUD = cloud;
                settled = true;
                resolve(cloud);
            } catch (err) {
                settled = true;
                reject(err);
            }
        }

        if (window.WorkBuddyCloud && window.WorkBuddyCloud.createWorkBuddyCloud) {
            init();
            return;
        }

        var script = document.createElement('script');
        script.src = SDK_URL;
        script.async = true;
        script.onload = init;
        script.onerror = function () {
            if (settled) { return; }
            settled = true;
            reject(new Error('云服务 SDK 加载失败，请检查网络后重试'));
        };
        document.head.appendChild(script);

        setTimeout(function () {
            if (settled) { return; }
            settled = true;
            reject(new Error('云服务 SDK 加载超时'));
        }, 20000);
    });

    /* 避免未处理的 Promise 拒绝告警；具体错误由各调用点 catch 后展示给用户 */
    ready.catch(function () {});

    window.ZBX_CLOUD_READY = ready;
})();
