/*
 * 打谱页 - 引导
 * ------------------------------------------------------------
 * 站内换页是无刷新替换 <main>，同 src 的脚本不会再次执行，
 * 所以这里动态 import 一次应用模块，再盯着 DOM 变化重新挂。
 */
(function () {
    'use strict';

    var self = document.currentScript;
    var appUrl = new URL('dapu-app.mjs', self && self.src ? self.src : location.href).href;
    var app = null;

    function check() {
        if (!app || !document.getElementById('scan-drop')) { return; }
        app.boot();
    }

    import(appUrl).then(function (m) {
        app = m;
        check();
    }).catch(function (err) {
        var msg = document.getElementById('scan-msg');
        if (msg) {
            msg.className = 'scan-msg is-bad';
            msg.textContent = '功能加载失败：' + (err && err.message ? err.message : err);
        }
    });

    if (window.MutationObserver) {
        new window.MutationObserver(check).observe(document.body, { childList: true, subtree: true });
    }
})();
