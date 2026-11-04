/*
 * 连珠杂箱 - 全站共用布局模板
 * ------------------------------------------------------------
 * 页头（站名）与导航栏集中在这里维护，各页面只保留正文。
 *
 * 页面用法：
 *   <body data-nav="杂史" data-base="../">
 *     <div class="container">
 *       <div id="site-header"></div>
 *       <main> 正文 </main>
 *     </div>
 *     <script src="../assets/layout.js"></script>
 *   </body>
 *
 * data-nav  当前页面所属栏目（对应导航文字），用于高亮
 * data-base 相对站点根目录的前缀；根目录页面留空，子目录页面写 "../"
 */

(function () {
    'use strict';

    var SITE = {
        title: '连珠杂箱'
    };

    var NAV = [
        { text: '首页', href: 'index.html' },
        { text: '杂论', href: '#' },
        { text: '杂究', href: '#' },
        { text: '杂史', href: 'zashi.html' },
        { text: '关于', href: '#' }
    ];

    var base = document.body.getAttribute('data-base') || '';
    var active = document.body.getAttribute('data-nav') || '';

    var navHtml = NAV.map(function (item) {
        var isActive = item.text === active;
        var href = item.href === '#' ? '#' : base + item.href;
        return '<a href="' + href + '"' +
            (isActive ? ' class="active"' : '') +
            '>' + item.text + '</a>';
    }).join('\n        ');

    var html =
        '<header>\n' +
        '    <h1 class="site-title"><a href="' + base + 'index.html">' + SITE.title + '</a></h1>\n' +
        '    <nav>\n        ' + navHtml + '\n    </nav>\n' +
        '</header>';

    var mount = document.getElementById('site-header');
    if (mount) {
        mount.innerHTML = html;
    }
})();
