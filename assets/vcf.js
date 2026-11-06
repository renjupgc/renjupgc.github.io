/*
 * VCF 做题 - 引导
 * ------------------------------------------------------------
 * 站内换页是无刷新替换 <main>，同 src 的脚本不会再次执行，所以这里只做两件事：
 * 动态 import 一次应用模块，然后盯着 main 的变化重新挂载。
 */
(function () {
    'use strict';

    var self = document.currentScript;
    var appUrl = new URL('vcf-app.mjs', self && self.src ? self.src : location.href).href;
    var app = null;

    function check() {
        if (!app || !document.getElementById('vcf-board')) { return; }
        app.boot();
    }

    import(appUrl).then(function (m) {
        app = m;
        check();
    }).catch(function (err) {
        var msg = document.getElementById('vcf-msg');
        if (msg) {
            msg.className = 'vcf-msg is-bad';
            msg.textContent = '应用加载失败：' + (err && err.message ? err.message : err);
        }
    });

    if (window.MutationObserver) {
        new window.MutationObserver(check).observe(document.body, { childList: true, subtree: true });
    }
})();
