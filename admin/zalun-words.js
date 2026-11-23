/*
 * 连珠杂箱 · 后台「杂论词云」
 * ------------------------------------------------------------
 * 词条来自 data/zalun-words.json（离线分词结果，含次数与分类），
 * 入选名单存进 zayu_docs：kind='zalun_word'、doc_id='cloud'，
 * data.words 里带上每个词的次数，访客页拿到就能直接排布。
 */
(function () {
    'use strict';

    var $ = function (id) { return document.getElementById(id); };
    var WC = window.ZBX_WORDCLOUD;
    var KIND_ORDER = ['cloud', 'theme', 'chess', 'noun', 'verb', 'adj', 'place', 'name', 'func', 'other'];

    var S = {
        all: [],
        byWord: {},
        sel: {},           /* word -> {w,c,k} */
        defaults: [],
        updated: '',
        loaded: false,
        dirty: false,
        filter: { q: '', mode: 'all', cat: '', sort: 'c', dir: -1 },
        limit: 300,
        previewTimer: null
    };

    function msg(text, kind) {
        var el = $('msg');
        if (!el) { return; }
        el.textContent = text || '';
        el.className = kind || '';
    }

    function errText(e) {
        var s = String((e && e.message) || e || '操作失败');
        if (/no permission|42501/i.test(s)) { return '需要管理员权限。'; }
        return s;
    }

    /* ---------- 登录门 ---------- */

    function syncGate() {
        var acc = window.ZBX_ACCOUNT;
        if (!acc || !acc.ready()) { setTimeout(syncGate, 80); return; }
        if (!acc.isAdmin()) {
            $('panel').hidden = true;
            $('gate').hidden = false;
            $('gate-msg').textContent = acc.user()
                ? '当前账号「' + acc.nick() + '」不是管理员，请用管理员账号登录。'
                : '请用管理员账号登录后继续。';
            return;
        }
        $('gate').hidden = true;
        $('panel').hidden = false;
        if (!S.loaded) {
            S.loaded = true;
            load();
        }
    }

    /* ---------- 读取 ---------- */

    function normalize(words) {
        var out = [];
        (words || []).forEach(function (x) {
            if (!x) { return; }
            var w = String(x.w || x.word || '').replace(/\s+/g, '');
            if (!w) { return; }
            out.push({ w: w, c: Number(x.c || 1) || 1, k: x.k || 'noun' });
        });
        return out;
    }

    function applyData(data) {
        S.all = (data.words || []).slice();
        S.byWord = {};
        S.all.forEach(function (d) { S.byWord[d.w] = d; });
        S.defaults = S.all.filter(function (d) { return d.on; }).map(function (d) {
            return { w: d.w, c: d.c, k: d.k };
        });
        fillCats();
    }

    function applySelection(list) {
        S.sel = {};
        (list || []).forEach(function (d) { S.sel[d.w] = d; });
    }

    function renderAll() {
        renderStat();
        renderTable();
        renderPreview();
    }

    /* 先渲染本地词表，再异步补上云端的入选名单：云端慢或不通都不挡后台 */
    function load() {
        msg('正在读取词表…');
        return WC.loadData().then(function (data) {
            applyData(data || {});
            applySelection(S.defaults);
            S.dirty = false;
            renderAll();
            msg('词表 ' + S.all.length + ' 条已就绪，正在读取云端入选名单…');
            return WC.loadSelection().then(function (sel) {
                var saved = sel && normalize(sel.words);
                S.updated = sel && sel.updated ? fmtTime(sel.updated) : '';
                if (saved && saved.length) {
                    applySelection(saved);
                    renderAll();
                    msg('已读取云端词云：' + saved.length + ' 个词。改动后点「保存词云」生效。', 'ok');
                } else {
                    msg('云端还没有保存过词云，先按默认的 ' + S.defaults.length + ' 个词显示。', 'ok');
                }
            }, function () {
                msg('云端词表读不到（可能没联网），先按默认的 ' + S.defaults.length + ' 个词显示。', 'err');
            });
        }).catch(function (e) {
            msg('词表读取失败：' + errText(e), 'err');
        });
    }

    function fmtTime(iso) {
        var d = new Date(iso);
        if (isNaN(d.getTime())) { return ''; }
        var p = function (n) { return (n < 10 ? '0' : '') + n; };
        return (d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }

    function fillCats() {
        var sel = $('cat');
        var have = {};
        S.all.forEach(function (d) { have[d.k] = (have[d.k] || 0) + 1; });
        sel.innerHTML = '<option value="">全部分类</option>' + KIND_ORDER.filter(function (k) {
            return have[k];
        }).map(function (k) {
            return '<option value="' + k + '">' + WC.KIND_LABEL[k] + '（' + have[k] + '）</option>';
        }).join('');
    }

    /* ---------- 状态 ---------- */

    function selectedList() {
        return Object.keys(S.sel).map(function (k) { return S.sel[k]; })
            .sort(function (a, b) { return b.c - a.c || a.w.localeCompare(b.w); });
    }

    function renderStat() {
        var n = Object.keys(S.sel).length;
        var hot = 0;
        S.all.forEach(function (d) { if (S.sel[d.w]) { hot++; } });
        $('stat').innerHTML = '<span>已选 <b>' + n + '</b> 个词</span>' +
            '<span>词表共 <b>' + S.all.length + '</b> 条</span>' +
            '<span>其中 ≥8 次的 <b>' + S.all.filter(function (d) { return d.c >= 8; }).length + '</b> 条</span>' +
            (S.updated ? '<span>上次保存 <b>' + S.updated + '</b></span>' : '') +
            (S.dirty ? '<span class="warn"><b>有改动未保存</b></span>' : '');
    }

    /* ---------- 词表 ---------- */

    function filtered() {
        var f = S.filter;
        var rows = S.all.filter(function (d) {
            if (f.q && d.w.indexOf(f.q) < 0) { return false; }
            if (f.cat && d.k !== f.cat) { return false; }
            if (f.mode === 'on' && !S.sel[d.w]) { return false; }
            if (f.mode === 'cand' && (S.sel[d.w] || d.c < 8)) { return false; }
            return true;
        });
        var key = f.sort, dir = f.dir;
        rows.sort(function (a, b) {
            var va = key === 'word' ? a.w : a[key];
            var vb = key === 'word' ? b.w : b[key];
            if (va === vb) { return b.c - a.c; }
            return (va > vb ? 1 : -1) * dir;
        });
        return rows;
    }

    function renderTable() {
        var rows = filtered();
        var view = rows.slice(0, S.limit);
        var html = view.map(function (d) {
            var on = !!S.sel[d.w];
            var label = WC.KIND_LABEL[d.k] || '其他';
            var hot = (d.k === 'theme' || d.k === 'chess') ? ' hot' : '';
            return '<tr' + (on ? ' class="on"' : '') + '>' +
                '<td class="word">' + esc(d.w) + '</td>' +
                '<td class="num"><b>' + d.c + '</b></td>' +
                '<td class="doc">' + d.d + '</td>' +
                '<td class="cat"><span class="tag' + hot + '">' + label + '</span></td>' +
                '<td class="act"><label class="sw"><input type="checkbox" data-w="' + esc(d.w) + '"' +
                (on ? ' checked' : '') + '><i></i></label></td></tr>';
        }).join('');
        $('rows').innerHTML = html || '<tr><td colspan="5" style="padding:26px;text-align:center;color:var(--faint)">没有符合条件的词</td></tr>';

        var more = $('more');
        if (rows.length > view.length) {
            more.hidden = false;
            more.textContent = '只显示前 ' + view.length + ' 条，还有 ' + (rows.length - view.length) +
                ' 条 —— 搜一下或者再筛一筛。';
        } else {
            more.hidden = true;
        }
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /* ---------- 预览 ---------- */

    function renderPreview() {
        var el = $('wc-canvas');
        var list = selectedList();
        $('pcount').textContent = list.length + ' 个词';
        if (!list.length) {
            el.innerHTML = '<div class="wcp-empty">还没选词。勾几个再来看。</div>';
            return;
        }
        try {
            WC.render(el, list, {});
        } catch (e) {
            el.innerHTML = '<div class="wcp-empty">预览渲染失败：' + esc(errText(e)) + '</div>';
        }
    }

    function schedulePreview() {
        clearTimeout(S.previewTimer);
        S.previewTimer = setTimeout(renderPreview, 220);
    }

    /* ---------- 操作 ---------- */

    function toggle(word, on) {
        var d = S.byWord[word];
        if (!d) { return; }
        if (on) { S.sel[word] = { w: d.w, c: d.c, k: d.k }; }
        else { delete S.sel[word]; }
        S.dirty = true;
        renderStat();
        schedulePreview();
    }

    function save() {
        var list = selectedList();
        if (list.length < 6) { msg('至少选 6 个词，不然词云会太空。', 'err'); return; }
        if (list.length > 160) { msg('已选 ' + list.length + ' 个，太多了会挤成一团，建议 40–100 个。', 'err'); return; }
        var acc = window.ZBX_ACCOUNT;
        msg('正在保存…');
        return acc.rpc('zbx_admin_save_docs', {
            p_token: acc.token(),
            p_kind: 'zalun_word',
            p_rows: [{
                doc_id: 'cloud',
                ord: 0,
                data: {
                    words: list,
                    count: list.length,
                    updated: new Date().toISOString(),
                    editor: acc.nick ? acc.nick() : ''
                }
            }]
        }).then(function (res) {
            if (!res || !res.ok) { throw new Error((res && res.err) || '保存失败'); }
            S.dirty = false;
            renderStat();
            msg('已保存 ' + list.length + ' 个词，访客刷新杂论页即可看到。', 'ok');
        }).catch(function (e) {
            msg('保存失败：' + errText(e), 'err');
        });
    }

    function setMode(mode) {
        S.filter.mode = mode;
        [].forEach.call(document.querySelectorAll('.fbar .chip'), function (c) {
            c.classList.toggle('on', c.getAttribute('data-mode') === mode);
        });
        S.limit = 300;
        renderTable();
    }

    function onClick(e) {
        var act = e.target.closest('[data-act]');
        if (act) {
            var a = act.getAttribute('data-act');
            if (a === 'login') { window.ZBX_ACCOUNT.openPanel('login'); }
            else if (a === 'save') { save(); }
            else if (a === 'reload') { load(); }
            else if (a === 'default') {
                S.sel = {};
                S.defaults.forEach(function (d) { S.sel[d.w] = d; });
                S.dirty = true;
                renderStat(); renderTable(); renderPreview();
                msg('已恢复默认词表（' + S.defaults.length + ' 个），记得保存。', 'ok');
            } else if (a === 'clear') {
                if (!window.confirm('把所有词都取消？')) { return; }
                S.sel = {};
                S.dirty = true;
                renderStat(); renderTable(); renderPreview();
                msg('已清空，重新挑吧。', 'ok');
            } else if (a === 'top') {
                var add = 0;
                S.all.forEach(function (d) {
                    if (d.c >= 8 && !S.sel[d.w] && d.k !== 'func' && d.k !== 'name' && d.k !== 'place') {
                        S.sel[d.w] = { w: d.w, c: d.c, k: d.k };
                        add++;
                    }
                });
                S.dirty = true;
                renderStat(); renderTable(); renderPreview();
                msg('补选了 ' + add + ' 个 ≥8 次的实词，可以再手动删几个。', 'ok');
            }
            return;
        }
        var chip = e.target.closest('.fbar .chip');
        if (chip) { setMode(chip.getAttribute('data-mode')); }
    }

    function onChange(e) {
        var t = e.target;
        if (t && t.type === 'checkbox' && t.getAttribute('data-w')) {
            toggle(t.getAttribute('data-w'), t.checked);
            var tr = t.closest('tr');
            if (tr) { tr.classList.toggle('on', t.checked); }
        }
    }

    function onSearch() {
        S.filter.q = $('search').value.trim();
        S.limit = 300;
        renderTable();
    }

    function onSort(e) {
        var th = e.target.closest('th[data-sort]');
        if (!th) { return; }
        var k = th.getAttribute('data-sort');
        if (S.filter.sort === k) { S.filter.dir *= -1; }
        else { S.filter.sort = k; S.filter.dir = (k === 'word' ? 1 : -1); }
        renderTable();
    }

    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    document.addEventListener('zbx:account', syncGate);
    document.addEventListener('DOMContentLoaded', function () {
        $('search').addEventListener('input', onSearch);
        $('cat').addEventListener('change', function () {
            S.filter.cat = this.value;
            S.limit = 300;
            renderTable();
        });
        document.querySelector('.wtable thead').addEventListener('click', onSort);
        $('more').addEventListener('click', function () {
            S.limit += 300;
            renderTable();
        });
    });

    syncGate();
})();
