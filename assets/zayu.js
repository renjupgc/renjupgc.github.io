/*
 * 杂豫栏目渲染脚本
 * 数据来源：data/zayu.js（由 tools/build_zayu.py 从 data/renju.db 导出）
 */

(function () {
    'use strict';

    var D = window.ZAYU_DATA;
    if (!D) { return; }

    var statsBox = document.getElementById('zayu-stats');
    var listBox = document.getElementById('zayu-list');
    var yearSel = document.getElementById('zayu-year');
    var searchBox = document.getElementById('zayu-search');

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function num(n) {
        return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    /* ---------- 概览 ---------- */
    var years = D.tournaments.map(function (t) { return (t.date || '').slice(0, 4); })
        .filter(Boolean).sort();
    var span = years.length ? years[0] + '–' + years[years.length - 1] : '';

    statsBox.innerHTML =
        '<div class="stat"><span class="num">' + num(D.stats.tournaments) + '</span><span class="label">赛事</span></div>' +
        '<div class="stat"><span class="num">' + num(D.stats.matches) + '</span><span class="label">对局</span></div>' +
        '<div class="stat"><span class="num">' + num(D.stats.players) + '</span><span class="label">棋手</span></div>' +
        '<div class="stat"><span class="num">' + esc(span) + '</span><span class="label">年份</span></div>';

    /* ---------- 年份筛选 ---------- */
    var yearSet = {};
    D.tournaments.forEach(function (t) { yearSet[(t.date || '').slice(0, 4)] = 1; });
    var yearList = Object.keys(yearSet).filter(Boolean).sort().reverse();

    yearSel.innerHTML = '<option value="">全部</option>' +
        yearList.map(function (y) { return '<option value="' + y + '">' + y + '</option>'; }).join('');

    /* ---------- 渲染赛事 ---------- */
    function matchRows(ms) {
        return ms.map(function (m) {
            var p1 = m.win === 'player1' ? '<b>' + esc(m.p1) + '</b>' : esc(m.p1);
            var p2 = m.win === 'player2' ? '<b>' + esc(m.p2) + '</b>' : esc(m.p2);
            return '<tr>' +
                '<td class="c-round">' + (m.r == null ? '—' : m.r) + '</td>' +
                '<td class="c-board">' + (m.b == null ? '—' : m.b) + '</td>' +
                '<td class="c-player">' + p1 + (m.rec ? '<span class="rec" title="有棋谱">谱</span>' : '') + '</td>' +
                '<td class="c-result">' + esc(m.res || '—') + '</td>' +
                '<td class="c-player">' + p2 + '</td>' +
                '<td class="c-date">' + esc(m.date || '') + '</td>' +
                '</tr>';
        }).join('');
    }

    function tournamentHtml(t, isOpen) {
        var ms = t.matches || [];
        var meta = [];
        if (t.organizer) { meta.push(['主办', t.organizer]); }
        if (t.arbiter) { meta.push(['裁判', t.arbiter]); }
        if (t.rules) { meta.push(['规则', t.rules]); }
        if (t.timeLimit) { meta.push(['用时', t.timeLimit]); }
        if (t.players.length) { meta.push(['参赛', t.players.length + ' 人']); }

        var metaHtml = meta.map(function (kv) {
            return '<div><span class="k">' + kv[0] + '</span>' + esc(kv[1]) + '</div>';
        }).join('');

        var body = '';
        if (t.desc) { body += '<p class="event-desc">' + esc(t.desc) + '</p>'; }
        if (t.players.length) {
            body += '<p class="event-players"><span class="k">棋手</span>' +
                t.players.map(esc).join('、') + '</p>';
        }

        if (ms.length) {
            body += '<table class="matches"><thead><tr>' +
                '<th>轮</th><th>台</th><th>选手一</th><th>结果</th><th>选手二</th><th>日期</th>' +
                '</tr></thead><tbody>' + matchRows(ms) + '</tbody></table>';
        } else {
            body += '<p class="empty">该赛事暂无对局记录。</p>';
        }

        return '<details class="event"' + (isOpen ? ' open' : '') + '>' +
            '<summary>' +
            '<span class="event-name">' + esc(t.name) + '</span>' +
            '<span class="event-meta">' + esc(t.date || '') + ' · ' + ms.length + ' 局</span>' +
            '</summary>' +
            '<div class="event-body">' +
            '<div class="event-info">' + metaHtml + '</div>' +
            body +
            '</div>' +
            '</details>';
    }

    function render() {
        var y = yearSel.value;
        var q = (searchBox.value || '').trim().toLowerCase();

        var list = D.tournaments.filter(function (t) {
            if (y && (t.date || '').slice(0, 4) !== y) { return false; }
            if (!q) { return true; }
            var hay = (t.name + ' ' + t.players.join(' ') + ' ' +
                (t.matches || []).map(function (m) { return m.p1 + ' ' + m.p2; }).join(' ')).toLowerCase();
            return hay.indexOf(q) >= 0;
        });

        if (!list.length) {
            listBox.innerHTML = '<p class="empty">没有符合条件的赛事。</p>';
            return;
        }

        // 默认展开最近一个「有对局」的赛事
        var openId = null;
        for (var i = 0; i < list.length; i++) {
            if ((list[i].matches || []).length) { openId = list[i].id; break; }
        }

        listBox.innerHTML = list.map(function (t) {
            return tournamentHtml(t, t.id === openId);
        }).join('');
    }

    yearSel.addEventListener('change', render);
    searchBox.addEventListener('input', render);
    render();
})();
