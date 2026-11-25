/*
 * 错题本 · 做题页共用的一小块
 * ------------------------------------------------------------
 * 数据在进度档案里（window.ZBX_PROGRESS 的 bookList / bookAdd / bookDel），
 * 跟分数一起按账号同步；这里只管列表面板的长相和按钮。
 *
 *   ZBX_WRONG.add(module, {pid, k, d})   记一道错题（同一 pid 只留一条）
 *   ZBX_WRONG.done(module, pid)         订正做对了，把这条拿走
 *   ZBX_WRONG.paint(el, module, opts)   把面板画出来
 *
 * opts.label(e)  → 标题一行（必填）
 * opts.sub(e)    → 副标题一行（选填）
 * opts.onRedo(e) → 点「重做」干什么（不传就不出这个按钮）
 */
(function () {
    'use strict';

    function prog() { return window.ZBX_PROGRESS || null; }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function add(module, entry) {
        var p = prog();
        if (!p || !p.ready() || !p.bookAdd) { return false; }
        return p.bookAdd(module, entry);
    }

    function done(module, pid) {
        var p = prog();
        if (!p || !p.ready() || !p.bookDel || !pid) { return false; }
        return p.bookDel(module, pid);
    }

    function stamp(ms) {
        if (!ms) { return ''; }
        var d = new Date(ms);
        var pad = function (n) { return ('0' + n).slice(-2); };
        return (d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    function paint(el, module, opts) {
        if (!el) { return; }
        var o = opts || {};
        var p = prog();
        var list = (p && p.ready() && p.bookList) ? p.bookList(module) : [];
        var n = el.querySelector('[data-vb-count]');
        if (n) { n.textContent = p && p.ready() ? list.length + ' 题' : '未登录'; }

        var box = el.querySelector('[data-vb-list]');
        if (!box) { return; }

        if (!p || !p.ready()) {
            box.innerHTML = '<li class="vb-empty">登录账号后，做错的题才会记在这里，换设备也跟着走。</li>';
            return;
        }
        if (!list.length) {
            box.innerHTML = '<li class="vb-empty">' + esc(o.empty || '还没有错题。') + '</li>';
            return;
        }

        box.innerHTML = list.map(function (e) {
            var label = o.label ? o.label(e) : (e.k || '—');
            var sub = o.sub ? o.sub(e) : '';
            var when = stamp(e.t);
            return '<li class="vb-item" data-pid="' + esc(e.pid) + '">' +
                '<div class="vb-main"><b>' + esc(label) + '</b><span>' +
                esc(sub) + (sub && when ? ' · ' : '') + esc(when) + '</span></div>' +
                '<div class="vb-acts">' +
                (o.onRedo ? '<button type="button" data-vb-redo>重做</button>' : '') +
                '<button type="button" class="vb-del" data-vb-del title="从错题本移除">删</button>' +
                '</div></li>';
        }).join('');

        Array.prototype.forEach.call(box.querySelectorAll('li[data-pid]'), function (li) {
            var pid = li.getAttribute('data-pid');
            var pick = null;
            for (var i = 0; i < list.length; i++) {
                if (list[i].pid === pid) { pick = list[i]; break; }
            }
            if (!pick) { return; }
            var redo = li.querySelector('[data-vb-redo]');
            if (redo && o.onRedo) {
                redo.addEventListener('click', function () { o.onRedo(pick); });
            }
            var del = li.querySelector('[data-vb-del]');
            if (del) {
                del.addEventListener('click', function () {
                    if (p.bookDel) { p.bookDel(module, pid); }
                    paint(el, module, o);
                    if (o.onChange) { o.onChange(); }
                });
            }
        });
    }

    window.ZBX_WRONG = { add: add, done: done, paint: paint, esc: esc };
})();
