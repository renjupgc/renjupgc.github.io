/*
 * 连珠杂箱 · 杂豫云端数据
 * ------------------------------------------------------------
 * 比赛、人物、等级分以云端数据库为准。静态 HTML 保留为兜底：
 * 云端没有数据时什么都不改，页面照常显示原来的表格与卡片。
 *
 * 由 assets/layout.js 注入；也支持页面直接引用。
 */
(function () {
    'use strict';

    if (window.ZBX_ZAYU_CLOUD) { return; }

    var cache = {};
    var TTL = 5 * 60 * 1000;

    function base() {
        return (document.body && document.body.getAttribute('data-base')) || '';
    }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function ensureCloud() {
        if (window.ZBX_CLOUD_READY) { return window.ZBX_CLOUD_READY; }
        if (!window.__zbxZayuCloudLoad) {
            window.__zbxZayuCloudLoad = 1;
            var s = document.createElement('script');
            s.src = base() + 'assets/cloud.js';
            s.async = true;
            document.head.appendChild(s);
        }
        return new Promise(function (resolve, reject) {
            var i = 0;
            (function poll() {
                if (window.ZBX_CLOUD_READY) { resolve(window.ZBX_CLOUD_READY); return; }
                if (i++ > 200) { reject(new Error('云服务加载超时')); return; }
                setTimeout(poll, 100);
            })();
        });
    }

    function unwrap(res, name) {
        var v = res;
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            if (Object.prototype.hasOwnProperty.call(v, 'error') && v.error) { return []; }
            if (Object.prototype.hasOwnProperty.call(v, 'data')) { v = v.data; }
        }
        if (Array.isArray(v)) {
            if (v.length && Array.isArray(v[0])) { return v[0]; }
            if (v.length && v[0] && typeof v[0] === 'object' &&
                Object.prototype.hasOwnProperty.call(v[0], name)) {
                var inner = v[0][name];
                return Array.isArray(inner) ? inner : [];
            }
            return v;
        }
        if (v && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, name)) {
            return Array.isArray(v[name]) ? v[name] : [];
        }
        return [];
    }

    function rpcList(name) {
        if (cache[name] && Date.now() - cache[name].t < TTL) {
            return Promise.resolve(cache[name].v);
        }
        return ensureCloud().then(function (cloud) {
            if (!cloud || !cloud.database || typeof cloud.database.rpc !== 'function') {
                throw new Error('云服务不可用');
            }
            return cloud.database.rpc(name, {});
        }).then(function (res) {
            var list = unwrap(res, name);
            cache[name] = { t: Date.now(), v: list };
            return list;
        }).catch(function () { return []; });
    }

    /* ---------- 比赛列表 ---------- */
    function renderCompetitions(rows) {
        var list = document.querySelector('.tournament-list');
        if (!list || !rows.length) { return; }
        list.innerHTML = rows.map(function (r) {
            var url = r.url || ('zayu/' + r.id + '.html');
            var date = [r.date, (r.games != null ? r.games + ' 局' : '')].filter(Boolean).join(' · ');
            var note = r.note ? '<span class="date">' + esc(r.note) + '</span>' : '';
            return '<li><a href="' + esc(url) + '">' + esc(r.title || r.id) + '</a>' +
                (date ? '<span class="date">' + esc(date) + '</span>' : '') + note + '</li>';
        }).join('');
    }

    /* ---------- 等级分 ---------- */
    function renderRatings(rows) {
        var tbody = document.querySelector('table.ratings tbody');
        if (!tbody || !rows.length) { return; }
        tbody.innerHTML = rows.map(function (r) {
            var name = r.name || '';
            var href = 'p/' + encodeURIComponent(name) + '.html';
            var rank = r.rank == null ? '—' : r.rank;
            var rating = Number(r.rating || 0).toFixed(2);
            return '<tr><td class="r-rank">' + esc(rank) + '</td>' +
                '<td class="r-name"><a href="' + href + '">' + esc(name) + '</a></td>' +
                '<td class="r-region">' + esc(r.region || '—') + '</td>' +
                '<td class="r-uni">' + esc(r.uni || '—') + '</td>' +
                '<td class="r-pt">' + rating + '</td></tr>';
        }).join('');
    }

    /* ---------- 人物 ---------- */
    function province(region) {
        var s = String(region || '');
        if (s.indexOf('山东') === 0) { return 'sd'; }
        if (s.indexOf('山西') === 0) { return 'sx'; }
        if (s.indexOf('河南') === 0) { return 'hn'; }
        if (s.indexOf('河北') === 0) { return 'hb'; }
        return '';
    }

    function honorsHtml(list) {
        if (!Array.isArray(list) || !list.length) { return ''; }
        return '<ul class="rh-honors">' + list.map(function (h) {
            var item = typeof h === 'string' ? { y: '', t: h } : (h || {});
            return '<li><span class="rh-year">' + esc(item.y || '') + '</span>' +
                '<span class="rh-txt">' + esc(item.t || '') + '</span></li>';
        }).join('') + '</ul>';
    }

    function cardHtml(p) {
        var stats = Array.isArray(p.stats) ? p.stats : [];
        return '<div class="rh-head">' +
            '<h3 class="rh-name">' + esc(p.name || '') + '</h3>' +
            (p.dan ? '<span class="rh-dan">' + esc(p.dan) + '</span>' : '') +
            (p.region ? '<span class="rh-tag">' + esc(p.region) + '</span>' : '') +
            '</div>' +
            '<dl class="rh-facts">' + stats.map(function (it) {
                return '<div><dt>' + esc(it.k || '') + '</dt><dd>' + esc(it.v || '') + '</dd></div>';
            }).join('') + '</dl>' +
            '<p class="rh-bio">' + esc(p.bio || '') + '</p>' + honorsHtml(p.honors);
    }

    function renderPeople(rows) {
        if (!rows.length || !document.querySelector('.rh-card')) { return; }
        rows.forEach(function (p) {
            var card = document.getElementById(p.id);
            if (card) {
                card.innerHTML = cardHtml(p);
            } else {
                var sec = document.getElementById(province(p.region));
                if (sec) {
                    var el = document.createElement('article');
                    el.className = 'rh-card';
                    el.id = p.id;
                    el.innerHTML = cardHtml(p);
                    sec.appendChild(el);
                }
            }
        });
    }

    function run() {
        var jobs = [];
        if (document.querySelector('.tournament-list')) {
            jobs.push(rpcList('zbx_public_competitions').then(renderCompetitions));
        }
        if (document.querySelector('table.ratings tbody')) {
            jobs.push(rpcList('zbx_public_ratings').then(renderRatings));
        }
        if (document.querySelector('.rh-card')) {
            jobs.push(rpcList('zbx_public_people').then(renderPeople));
        }
        return Promise.all(jobs);
    }

    function start() {
        run();
        document.addEventListener('zbx:navigate', run);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }

    window.ZBX_ZAYU_CLOUD = {
        refresh: function () { cache = {}; return run(); },
        competitions: function () { return rpcList('zbx_public_competitions'); },
        people: function () { return rpcList('zbx_public_people'); },
        ratings: function () { return rpcList('zbx_public_ratings'); }
    };
})();
