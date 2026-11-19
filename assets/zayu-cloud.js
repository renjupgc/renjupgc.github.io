/*
 * 连珠杂箱 · 杂豫云端数据
 * ------------------------------------------------------------
 * 比赛、台次成绩表、棋谱、赛事介绍、人物介绍、等级分，全部以云数据库
 * zayu_docs 为准。管理员在后台改完即时生效。静态 HTML 保留为兜底：
 * 云端某类数据为空时，对应区域不改动，页面照常显示原来的内容。
 *
 * 文档分类(kind)：competition / qipu / person / person_page / rating
 * 由 assets/layout.js 注入；也支持页面直接引用。
 */
(function () {
    'use strict';

    if (window.ZBX_ZAYU_CLOUD) { return; }

    var cache = {};
    /* 缓存只有 8 秒：管理员改完，访客刷新即可看到最新内容 */
    var TTL = 8 * 1000;

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

    /* SDK 对 rpc 返回值的包装各版本不同，统一拆成数组 */
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
            if (v.length && v[0] && typeof v[0] === 'object' &&
                Object.prototype.hasOwnProperty.call(v[0], 'rows')) {
                return Array.isArray(v[0].rows) ? v[0].rows : [];
            }
            return v;
        }
        if (v && typeof v === 'object') {
            if (Object.prototype.hasOwnProperty.call(v, name)) {
                var x = v[name];
                return Array.isArray(x) ? x : [];
            }
            if (Object.prototype.hasOwnProperty.call(v, 'rows')) {
                return Array.isArray(v.rows) ? v.rows : [];
            }
        }
        return [];
    }

    function rpcDocs(kind) {
        if (cache[kind] && Date.now() - cache[kind].t < TTL) {
            return Promise.resolve(cache[kind].v);
        }
        return ensureCloud().then(function (cloud) {
            if (!cloud || !cloud.database || typeof cloud.database.rpc !== 'function') {
                throw new Error('云服务不可用');
            }
            return cloud.database.rpc('zbx_public_docs', { p_kind: kind });
        }).then(function (res) {
            var docs = unwrap(res, 'zbx_public_docs');
            /* 文档行：{kind, doc_id, data, ord}；按 ord 排序 */
            docs = docs.slice().sort(function (a, b) {
                var oa = Number(a.ord || 0), ob = Number(b.ord || 0);
                return oa - ob || String(a.doc_id).localeCompare(String(b.doc_id));
            });
            cache[kind] = { t: Date.now(), v: docs };
            return docs;
        }).catch(function () { return []; });
    }

    function byId(docs, id) {
        for (var i = 0; i < docs.length; i++) {
            if (String(docs[i].doc_id) === String(id)) { return docs[i].data || {}; }
        }
        return null;
    }

    /* ---------- 赛事列表 ---------- */
    function renderCompetitionList(docs) {
        var list = document.querySelector('.tournament-list');
        /* 云端有数据就以云端为准（增删都即时生效）；云端为空才保留静态列表。 */
        if (!list || !docs.length) { return; }
        list.innerHTML = docs.map(function (d) {
            var r = d.data || {};
            var id = d.doc_id;
            var url = r.url || ('zayu/' + id + '.html');
            var games = Array.isArray(r.rows) ? r.rows.length : r.games;
            var date = [r.date, (games != null ? games + ' 局' : '')].filter(Boolean).join(' · ');
            return '<li><a href="' + esc(url) + '">' + esc(r.title || id) + '</a>' +
                (date ? '<span class="date">' + esc(date) + '</span>' : '') + '</li>';
        }).join('');
    }

    /* ---------- 比赛详情（含台次成绩表） ---------- */
    function cellHtml(c) {
        c = c || {};
        var cls = ['rt'];
        if (c.first) { cls.push('first'); }
        if (c.qipu) { cls.push('has-qipu'); }
        if (c.bye) { cls.push('bye'); }
        var attrs = '';
        if (c.qipu) {
            attrs = ' data-qipu="' + esc(c.qipu) + '" tabindex="0" role="button" aria-expanded="false" title="点开看棋谱与复盘"';
        }
        var inner;
        if (c.bye) {
            inner = esc(c.opp || c.raw || '轮空');
        } else if (c.opp != null || c.res != null) {
            inner = '<span class="opp">' + esc(c.opp || '') + '</span><span class="res">' + esc(c.res || '') + '</span>';
        } else {
            inner = esc(c.raw || '');
        }
        return '<td class="' + cls.join(' ') + '"' + attrs + '>' + inner + '</td>';
    }

    function renderCompetitionDetail(docs) {
        var titleEl = document.querySelector('.article-title');
        var table = document.querySelector('table.crosstab');
        if (!titleEl || !table) { return; }
        var name = (location.pathname.split('/').pop() || '').replace(/\.html?$/i, '');
        var r = byId(docs, name);
        if (!r) { return; }

        if (r.title) { titleEl.textContent = r.title; document.title = r.title + ' - 杂豫 - 连珠杂箱'; }
        var metas = document.querySelectorAll('.article-meta span');
        if (r.date && metas.length) { metas[metas.length - 1].textContent = r.date; }

        if (r.band && Object.keys(r.band).length) {
            document.querySelectorAll('.band-hero .band-figure').forEach(function (f) {
                var k = (f.querySelector('.band-k') || {}).textContent || '';
                var v = r.band[k];
                if (v == null) { return; }
                var slot = f.querySelector('.band-v') || f.querySelector('.band-g');
                if (slot) { slot.textContent = v; }
            });
        }

        var info = document.querySelector('.event-info');
        if (info && Array.isArray(r.info) && r.info.length) {
            info.innerHTML = r.info.map(function (s) { return '<span>' + esc(s) + '</span>'; }).join('');
        }

        /* 赛事介绍：article-header 之后第一个普通 p（非 qp-hint） */
        if (r.intro) {
            var anchor = document.querySelector('.article-header');
            var p = anchor ? anchor.nextElementSibling : null;
            while (p && (p.classList && (p.classList.contains('band-hero') || p.classList.contains('event-info')))) {
                p = p.nextElementSibling;
            }
            if (p && p.tagName === 'P' && !(p.classList && p.classList.contains('qp-hint'))) {
                p.textContent = r.intro;
            }
        }
        if (r.qp_hint) {
            var qh = document.querySelector('.qp-hint');
            if (qh) { qh.textContent = r.qp_hint; }
        }

        var thead = table.querySelector('thead tr');
        if (thead && Array.isArray(r.rounds) && r.rounds.length) {
            thead.innerHTML = r.rounds.map(function (h, i) {
                var cls = i === 0 ? 'c-no' : i === 1 ? 'c-name' : i >= r.rounds.length - 5 && i < r.rounds.length - 1 ? 'c-tb' : (i === r.rounds.length - 1 ? 'c-rank' : 'c-round');
                if (h === '积分') { cls = 'c-pt'; }
                return '<th class="' + cls + '">' + esc(h) + '</th>';
            }).join('');
        }

        var tbody = table.querySelector('tbody');
        if (tbody && Array.isArray(r.rows) && r.rows.length) {
            tbody.innerHTML = r.rows.map(function (row) {
                var games = Array.isArray(row.games) ? row.games : [];
                var tb = Array.isArray(row.tb) ? row.tb : [];
                return '<tr>' +
                    '<td class="c-no">' + esc(row.no || '') + '</td>' +
                    '<td class="c-name"><a href="' + esc(row.href || '') + '">' + esc(row.name || '') + '</a></td>' +
                    games.map(cellHtml).join('') +
                    '<td class="c-pt">' + esc(row.pt || '') + '</td>' +
                    tb.map(function (v) { return '<td class="c-tb">' + esc(v) + '</td>'; }).join('') +
                    '<td class="c-rank">' + esc(row.rank || '') + '</td>' +
                    '</tr>';
            }).join('');
        }

        /* 棋谱 JSON 注入给 qipu.js（优先云端） */
        window.ZAYU_QIPU_OVERRIDE = window.ZAYU_QIPU_OVERRIDE || {};
        (r.qipu_ids || []).forEach(function (id) {
            window.ZAYU_QIPU_OVERRIDE[id] = true;
        });
    }

    /* ---------- 人物卡片 ---------- */
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
            var item = typeof h === 'string' ? { year: '', text: h } : (h || {});
            return '<li><span class="rh-year">' + esc(item.year || item.y || '') + '</span>' +
                '<span class="rh-txt">' + esc(item.text || item.t || '') + '</span></li>';
        }).join('') + '</ul>';
    }

    function cardHtml(p) {
        var facts = Array.isArray(p.facts) ? p.facts : (Array.isArray(p.stats) ? p.stats : []);
        var links = Array.isArray(p.links) ? p.links : [];
        return '<div class="rh-head">' +
            '<h3 class="rh-name">' + esc(p.name || '') + '</h3>' +
            (p.dan ? '<span class="rh-dan">' + esc(p.dan) + '</span>' : '') +
            (p.tag || p.region ? '<span class="rh-tag">' + esc(p.tag || p.region) + '</span>' : '') +
            '</div>' +
            '<dl class="rh-facts">' + facts.map(function (it) {
                return '<div><dt>' + esc(it.k || '') + '</dt><dd>' + esc(it.v || '') + '</dd></div>';
            }).join('') + '</dl>' +
            '<p class="rh-bio">' + esc(p.bio || '') + '</p>' + honorsHtml(p.honors) +
            (links.length ? '<p class="rh-links">' + links.map(function (a) {
                return '<a href="' + esc(a.href || '') + '">' + esc(a.text || '') + '</a>';
            }).join(' · ') + '</p>' : '');
    }

    function renderPeople(docs) {
        if (!docs.length || !document.querySelector('.rh-card')) { return; }
        docs.forEach(function (d) {
            var p = d.data || {};
            var card = document.getElementById(p.id || d.doc_id);
            if (card) { card.innerHTML = cardHtml(p); }
        });
    }

    /* ---------- 人物详情页介绍 ---------- */
    function renderPersonPage(docs) {
        var main = document.querySelector('main');
        if (!main || !docs.length) { return; }
        var name = decodeURIComponent((location.pathname.split('/').pop() || '').replace(/\.html?$/i, ''));
        var r = byId(docs, name);
        if (!r) { return; }

        /* 标题 */
        var h1 = main.querySelector('.article-title');
        if (h1 && r.title) { h1.textContent = r.title; }

        /* 地区、单位（article-meta 第 2、3 个 span，第 1 个是「栏目」）
         * 只有地区没有单位的页面，管理员补了单位就追加一个 span。 */
        var metas = main.querySelectorAll('.article-meta');
        if (metas.length) {
            var box = metas[0];
            var spans = box.querySelectorAll('span');
            if (r.region && spans[1]) { spans[1].textContent = r.region; }
            if (r.unit) {
                if (spans[2]) { spans[2].textContent = r.unit; }
                else if (spans[1]) {
                    var add = document.createElement('span');
                    add.textContent = r.unit;
                    box.appendChild(add);
                }
            }
        }

        /* 统计项：按名称匹配，改哪项就更新哪项 */
        if (Array.isArray(r.stats) && r.stats.length) {
            var box = main.querySelector('.player-stats');
            if (box) {
                var psList = box.querySelectorAll('.ps');
                r.stats.forEach(function (it) {
                    for (var i = 0; i < psList.length; i++) {
                        var kEl = psList[i].querySelector('.ps-k');
                        if (kEl && kEl.textContent.replace(/\s+/g, '') === String(it.k || '').replace(/\s+/g, '')) {
                            var vEl = psList[i].querySelector('.ps-v');
                            if (vEl) { vEl.textContent = it.v; }
                            break;
                        }
                    }
                });
            }
        }

        /* 段位 */
        if (r.dan) {
            var danEl = main.querySelector('.rh-dan');
            if (danEl) { danEl.textContent = r.dan; }
        }

        /* 介绍：管理员用富文本写的是 bioHtml，原样渲染；老数据 bio 是纯文本 */
        var bio = main.querySelector('.pr-bio');
        if (r.bioHtml) {
            if (bio) { bio.innerHTML = r.bioHtml; }
            else {
                var host = main.querySelector('.player-note') ||
                    main.querySelector('.player-stats') || main.querySelector('.article-header');
                if (host && host.parentNode) {
                    var p = document.createElement('p');
                    p.className = 'pr-bio';
                    p.innerHTML = r.bioHtml;
                    host.parentNode.insertBefore(p, host.nextSibling);
                }
            }
        } else if (r.bio && bio) {
            bio.textContent = r.bio;
        }
    }

    /* ---------- 等级分 ---------- */
    function renderRatings(docs) {
        var tbody = document.querySelector('table.ratings tbody');
        if (!tbody || !docs.length) { return; }
        tbody.innerHTML = docs.map(function (d) {
            var r = d.data || {};
            var name = r.name || d.doc_id;
            var href = r.href || ('p/' + encodeURIComponent(name) + '.html');
            var rank = r.rank == null ? '—' : r.rank;
            var rating = Number(r.rating || 0).toFixed(2);
            return '<tr><td class="r-rank">' + esc(rank) + '</td>' +
                '<td class="r-name"><a href="' + esc(href) + '">' + esc(name) + '</a></td>' +
                '<td class="r-region">' + esc(r.region || '—') + '</td>' +
                '<td class="r-uni">' + esc(r.uni || '—') + '</td>' +
                '<td class="r-pt">' + rating + '</td></tr>';
        }).join('');
    }

    /* ---------- 棋谱：整篇注入，供 qipu.js 优先读取 ---------- */
    function loadQipu() {
        return rpcDocs('qipu').then(function (docs) {
            window.ZAYU_QIPU = window.ZAYU_QIPU || {};
            docs.forEach(function (d) { window.ZAYU_QIPU[d.doc_id] = d.data || {}; });
            return docs;
        });
    }

    function run() {
        var jobs = [];

        if (document.querySelector('.tournament-list')) {
            jobs.push(rpcDocs('competition').then(renderCompetitionList));
        }
        if (document.querySelector('table.crosstab')) {
            jobs.push(rpcDocs('competition').then(renderCompetitionDetail));
        }
        if (document.querySelector('.rh-card')) {
            jobs.push(rpcDocs('person').then(renderPeople));
        }
        /* 人物页用 .player-stats 识别（595 个页面都有），不能只看 .pr-bio：
         * 大多数页面原本没有介绍段落，管理员新写的介绍也要能显示出来。 */
        if (document.querySelector('.player-stats')) {
            jobs.push(rpcDocs('person_page').then(renderPersonPage));
        }
        if (document.querySelector('table.ratings tbody')) {
            jobs.push(rpcDocs('rating').then(renderRatings));
        }
        if (document.querySelector('[data-qipu]')) {
            jobs.push(loadQipu());
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
        docs: rpcDocs,
        competitions: function () { return rpcDocs('competition'); },
        qipu: function () { return rpcDocs('qipu'); },
        people: function () { return rpcDocs('person'); },
        personPages: function () { return rpcDocs('person_page'); },
        ratings: function () { return rpcDocs('rating'); }
    };
})();
