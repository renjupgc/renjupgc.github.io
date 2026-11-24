/*
 * 连珠杂箱 · 杂豫可视化管理后台（面向不懂代码的管理员）
 * ------------------------------------------------------------
 * 全部操作都是表单 / 表格 / 棋盘 / 富文本，不出现 JSON 编辑框。
 * 数据仍写入云端 zayu_docs，前台由 assets/zayu-cloud.js 渲染。
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var KINDS = ['competition', 'qipu', 'person', 'person_page', 'rating'];
  var LABEL = {
    competition: '比赛与台次', qipu: '棋谱', person: '人物介绍',
    person_page: '棋手个人主页', rating: '等级分', accounts: '账号'
  };
  var S = {
    kind: 'competition', docs: {}, cur: null, work: null, ord: 0,
    loaded: false, filter: '', chess: null, rtReady: false,
    accounts: null, accErr: ''
  };

  /* ---------- 小工具 ---------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function clone(o) { return JSON.parse(JSON.stringify(o == null ? {} : o)); }
  /* 主页链接在数据里是 URL 编码的，直接显示一长串 %E5 没法看，转成能读的形式 */
  function friendlyHref(href) {
    var s = String(href || '');
    if (!s) { return ''; }
    try { return decodeURIComponent(s); } catch (e) { return s; }
  }  function num(v, d) { var n = parseInt(v, 10); return isFinite(n) ? n : (d || 0); }
  function msg(text, kind) {
    var el = $('msg'); if (!el) { return; }
    el.textContent = text || ''; el.className = kind || '';
  }
  function errText(e) {
    var s = String((e && e.message) || e || '操作失败');
    return ({ 'no permission': '需要管理员权限。' })[s] || s;
  }
  function rpc(name, params, array) { return window.ZBX_ACCOUNT.rpc(name, params, array); }
  function token() { return window.ZBX_ACCOUNT.token(); }
  function guard(fn) {
    return function () {
      Promise.resolve().then(fn).catch(function (e) { msg(errText(e), 'err'); });
    };
  }
  function getPath(obj, path) {
    var parts = path.split('.'), cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) { return undefined; }
      cur = cur[parts[i]];
    }
    return cur;
  }
  function setPath(obj, path, val) {
    var parts = path.split('.'), cur = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      var k = parts[i];
      if (cur[k] == null) { cur[k] = /^\d+$/.test(parts[i + 1]) ? [] : {}; }
      cur = cur[k];
    }
    cur[parts[parts.length - 1]] = val;
  }

  /* ---------- 登录门 ---------- */
  function syncGate() {
    var acc = window.ZBX_ACCOUNT;
    if (!acc || !acc.ready()) { setTimeout(syncGate, 80); return; }
    if (!acc.isAdmin()) {
      $('panel').hidden = true; $('gate').hidden = false;
      $('gate-msg').textContent = acc.user()
        ? '当前账号「' + acc.nick() + '」不是管理员，请用管理员账号登录。'
        : '请用管理员账号登录后继续。';
      return;
    }
    $('gate').hidden = true; $('panel').hidden = false;
    if (!S.loaded) { S.loaded = true; loadAll(); }
  }

  /* ---------- 读取云端 ---------- */
  function applyRows(rows) {
    S.docs = {};
    KINDS.forEach(function (k) { S.docs[k] = []; });
    rows.forEach(function (r) {
      (S.docs[r.kind] = S.docs[r.kind] || []).push({
        doc_id: String(r.doc_id), data: r.data || {}, ord: Number(r.ord || 0)
      });
    });
    Object.keys(S.docs).forEach(function (k) {
      S.docs[k].sort(function (a, b) {
        return a.ord - b.ord || Number(a.doc_id) - Number(b.doc_id) ||
          String(a.doc_id).localeCompare(String(b.doc_id));
      });
    });
  }
  function fetchDocs() {
    return rpc('zbx_admin_all_docs', { p_token: token() }).then(function (res) {
      if (!res || !res.ok) { throw new Error((res && res.err) || '读取失败'); }
      return Array.isArray(res.rows) ? res.rows : [];
    });
  }
  function loadAll() {
    msg('正在读取云端内容…');
    return fetchDocs().then(function (rows) {
      applyRows(rows);
      return autoFill();
    }).then(function (filled) {
      return filled ? fetchDocs().then(applyRows) : null;
    }).then(function () {
      renderStat(); renderList();
      if (S.cur) { selectDoc(S.cur); }
      if (S.fillErr) {
        msg('部分内容自动准备失败：' + errText(S.fillErr) + '，请点「重新读取」重试。', 'err');
        S.fillErr = null;
      } else {
        msg('已读取云端内容。点左侧任意一条即可修改。', 'ok');
      }
    });
  }

  /* ---------- 自动补齐：打开后台就把全量内容放进云端，不用点任何按钮 ----------
   * 只补「云端还缺的」条目，绝不覆盖管理员已经改过的内容。
   * 某类数量已经足够时完全跳过，避免每次打开都重算。 */
  var MIN_COUNT = { competition: 5, qipu: 5, person: 5, rating: 5, person_page: 100 };
  var _baseline = null;
  function loadBaseline() {
    if (_baseline) { return Promise.resolve(_baseline); }
    function getJson(u, dft) {
      return fetch(u, { cache: 'no-store' }).then(function (r) {
        return r.ok ? r.json() : dft;
      }).catch(function () { return dft; });
    }
    return Promise.all([
      getJson('../data/zayu-full.json', {}),
      getJson('../data/zayu-people-pages.json', [])
    ]).then(function (res) {
      var full = res[0] || {};
      var pages = Array.isArray(res[1]) ? res[1] : [];
      _baseline = {
        competition: full.competitions || [],
        qipu: full.qipu || [],
        person: full.people || [],
        rating: full.ratings || [],
        person_page: pages
      };
      return _baseline;
    });
  }
  /* 只有真正缺数据时才去拉基准文件（约 700KB），平时打开后台零额外请求 */
  function needBaseline() {
    if (KINDS.some(function (k) { return (S.docs[k] || []).length < (MIN_COUNT[k] || 0); })) {
      return true;
    }
    return (S.docs.person_page || []).some(function (d) {
      return !(d.data && Array.isArray(d.data.stats) && d.data.stats.length);
    });
  }
  function autoFill() {
    if (!needBaseline()) { return Promise.resolve(false); }
    return loadBaseline().then(function (base) {
      var jobs = [], filled = false;
      KINDS.forEach(function (kind) {
        var remote = S.docs[kind] || [];
        var list = base[kind] || [];
        /* 数量已足够就跳过；person_page 每次都检查字段是否完整 */
        if (remote.length >= (MIN_COUNT[kind] || 0) && kind !== 'person_page') { return; }
        var have = {};
        remote.forEach(function (d) { have[d.doc_id] = true; });
        var write = [];
        /* 1) 云端缺的，补进来 */
        list.forEach(function (x, i) {
          var id = (kind === 'rating' || kind === 'person_page')
            ? String(x.name) : String(x.id != null ? x.id : i);
          if (!have[id]) { write.push({ doc_id: id, data: x, ord: i }); }
        });
        /* 2) 云端已有但字段不全的（早期人物页只有 bio），补字段、不动正文 */
        if (kind === 'person_page') {
          var byId = {};
          list.forEach(function (x) { byId[String(x.name)] = x; });
          remote.forEach(function (d) {
            var b = byId[d.doc_id];
            if (!b) { return; }
            var data = d.data || {};
            if (Array.isArray(data.stats) && data.stats.length) { return; }
            var merged = {};
            Object.keys(data).forEach(function (k) { merged[k] = data[k]; });
            merged.region = data.region || b.region || '';
            merged.unit = data.unit || b.unit || '';
            merged.dan = data.dan || b.dan || '';
            merged.stats = b.stats || [];
            write.push({ doc_id: d.doc_id, data: merged, ord: d.ord });
          });
        }
        if (!write.length) { return; }
        filled = true;
        msg('正在准备' + LABEL[kind] + '（' + write.length + ' 条），首次打开稍等…');
        for (var s = 0; s < write.length; s += 40) {
          (function (chunk) {
            jobs.push(function () {
              return rpc('zbx_admin_save_docs', {
                p_token: token(), p_kind: kind, p_rows: chunk
              }).then(function (res) {
                if (!res || !res.ok) { throw new Error(LABEL[kind] + ' 准备失败'); }
              });
            });
          })(write.slice(s, s + 40));
        }
      });
      if (!filled) { return false; }
      return jobs.reduce(function (p, fn) { return p.then(fn); }, Promise.resolve())
        .then(function () { return true; });
    }).catch(function (e) { S.fillErr = e; return false; });
  }

  function renderStat() {
    if (S.kind === 'accounts') {
      var accs = S.accounts || [];
      $('stat').innerHTML = '<span>账号 <b>' + accs.length + '</b> 个</span>' +
        '<span>管理员 <b>' + accs.filter(function (a) { return a.role === 'admin'; }).length + '</b> 个</span>';
      return;
    }
    $('stat').innerHTML = KINDS.map(function (k) {
      return '<span>' + LABEL[k] + ' <b>' + (S.docs[k] || []).length + '</b> 条</span>';
    }).join('');
  }

  /* ---------- 左侧列表 ---------- */
  function docLabel(kind, d) {
    var x = d.data || {};
    if (kind === 'competition') { return x.title || d.doc_id; }
    if (kind === 'qipu') {
      return (x.p1 || '?') + ' 对 ' + (x.p2 || '?') + '（' + (x.roundLabel || '第' + (x.round || '?') + '轮') + '）';
    }
    if (kind === 'person') { return x.name || d.doc_id; }
    if (kind === 'person_page') { return x.name || x.title || d.doc_id; }
    if (kind === 'rating') { return (x.name || d.doc_id) + ' · ' + (x.rating || ''); }
    return d.doc_id;
  }
  function docSub(kind, d) {
    var x = d.data || {};
    if (kind === 'competition') {
      var qn = 0;
      (x.rows || []).forEach(function (r) {
        (r.games || []).forEach(function (g) { if (g && g.qipu) { qn++; } });
      });
      return [x.date, Array.isArray(x.rows) ? x.rows.length + ' 人' : '',
        Array.isArray(x.rows) && x.rows[0] && Array.isArray(x.rows[0].games)
          ? x.rows[0].games.length + ' 轮' : '',
        qn ? qn + ' 局有棋谱' : '暂无棋谱'].filter(Boolean).join(' · ');
    }
    if (kind === 'qipu') {
      return [x.event, Array.isArray(x.moves) ? x.moves.length + ' 手' : '',
        x.rules, x.swap ? '交换 ' + x.swap : '',
        x.m5a ? '5A ' + x.m5a : ''].filter(Boolean).join(' · ');
    }
    if (kind === 'person') { return [x.dan, x.tag].filter(Boolean).join(' · '); }
    if (kind === 'person_page') {
      return [x.region, x.unit, x.dan].filter(Boolean).join(' · ');
    }
    if (kind === 'rating') { return [x.region, x.uni].filter(Boolean).join(' · '); }
    return '';
  }
  /* ---------- 账号（只读，管理员可见全站账号） ---------- */
  function fmtDate(v) {
    if (!v) { return ''; }
    var d = new Date(v);
    if (isNaN(d.getTime())) { return String(v); }
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function accName(a) { return a.username || ('未命名 ' + String(a.id || '').slice(0, 8)); }
  function accFind(id) {
    var list = S.accounts || [];
    for (var i = 0; i < list.length; i++) { if (String(list[i].id) === id) { return list[i]; } }
    return null;
  }
  function loadAccounts(force) {
    if (S.accounts && !force) { renderList(); renderPane(); return Promise.resolve(); }
    S.accounts = null; S.accErr = '';
    renderList(); renderPane(); renderStat();
    msg('正在读取账号…');
    return rpc('zbx_admin_accounts', { p_token: token() }).then(function (res) {
      if (!res || !res.ok) { throw new Error((res && res.err) || '读取账号失败'); }
      S.accounts = Array.isArray(res.rows) ? res.rows : [];
      renderList(); renderPane(); renderStat();
      msg('共 ' + S.accounts.length + ' 个账号。这里只能看，不能改。', 'ok');
    }).catch(function (e) {
      S.accErr = errText(e);
      renderList(); renderPane(); renderStat();
      msg(S.accErr, 'err');
    });
  }
  function renderAccList() {
    var list = S.accounts;
    if (list === null) {
      $('list-title').textContent = '账号';
      $('doclist').innerHTML = '<p class="hint" style="padding:6px">' +
        esc(S.accErr || '正在读取账号…') + '</p>';
      return;
    }
    var f = S.filter.trim().toLowerCase();
    var shown = f ? list.filter(function (a) {
      return (accName(a) + ' ' + (a.nick || '') + ' ' + (a.role || '')).toLowerCase().indexOf(f) >= 0;
    }) : list;
    $('list-title').textContent = '账号 · ' + list.length + ' 个';
    $('doclist').innerHTML = shown.map(function (a) {
      return '<button type="button" class="d' + (S.cur === String(a.id) ? ' on' : '') +
        '" data-doc="' + esc(String(a.id)) + '">' + esc(accName(a)) +
        '<small>' + esc([a.nick && a.nick !== a.username ? a.nick : '',
          a.role === 'admin' ? '管理员' : '普通账号',
          fmtDate(a.created_at)].filter(Boolean).join(' · ')) + '</small></button>';
    }).join('') || '<p class="hint" style="padding:6px">' +
      (f ? '没有匹配的账号。' : '站内还没有注册账号。') + '</p>';
  }
  function accPane() {
    if (S.accounts === null) {
      return '<div class="empty"><b>' + (S.accErr ? '读不到账号' : '正在读取账号…') + '</b>' +
        esc(S.accErr || '稍等一下，正在从云端取账号列表。') + '</div>';
    }
    var a = S.cur ? accFind(S.cur) : null;
    if (!a) {
      return '<div class="empty"><b>站内共 ' + S.accounts.length + ' 个账号</b>' +
        (S.accounts.length ? '从左侧选一个，看它的用户名、角色、注册时间与最近同步。'
          : '目前还没有人注册。') + '</div>';
    }
    var rows = [
      ['用户名', accName(a)],
      ['昵称', a.nick || '—'],
      ['角色', a.role === 'admin' ? '管理员' : '普通账号'],
      ['注册', fmtDate(a.created_at) || '—'],
      ['最近登录', fmtDate(a.last_sign_in_at) || '—'],
      ['最近同步', fmtDate(a.synced_at) || '还没同步过'],
      ['账号 ID', String(a.id || '')]
    ];
    return '<div class="pane-head"><div class="grow"><b>账号</b> · ' + esc(accName(a)) + '</div></div>' +
      '<div class="kvlist">' + rows.map(function (r) {
        return '<div class="kvrow"><span class="kvk" style="flex-basis:4.6em">' + esc(r[0]) + '</span>' +
          '<span class="kvv">' + esc(r[1]) + '</span></div>';
      }).join('') + '</div>' +
      '<p class="hint">账号资料在注册时写入，这里只读。改角色或删账号请到 Supabase 控制台。</p>';
  }

  function renderList() {
    if (S.kind === 'accounts') { renderAccList(); return; }
    var list = S.docs[S.kind] || [];
    var f = S.filter.trim().toLowerCase();
    var shown = f ? list.filter(function (d) {
      return (docLabel(S.kind, d) + ' ' + docSub(S.kind, d)).toLowerCase().indexOf(f) >= 0;
    }) : list;
    $('list-title').textContent = LABEL[S.kind] + ' · ' + list.length + ' 条';
    $('doclist').innerHTML = shown.map(function (d) {
      return '<button type="button" class="d' + (S.cur === d.doc_id ? ' on' : '') +
        '" data-doc="' + esc(d.doc_id) + '">' + esc(docLabel(S.kind, d)) +
        '<small>' + esc(docSub(S.kind, d)) + '</small></button>';
    }).join('') || '<p class="hint" style="padding:6px">' +
      (f ? '没有匹配的条目。' : '这一类还没有数据，可点下方「新建」添加。') + '</p>';
  }

  function selectDoc(id) {
    if (S.kind === 'accounts') { S.cur = id; renderList(); renderPane(); return; }
    var list = S.docs[S.kind] || [], found = null;
    for (var i = 0; i < list.length; i++) { if (list[i].doc_id === id) { found = list[i]; break; } }
    if (!found) { S.cur = null; S.work = null; S.infoState = null; renderList(); renderPane(); return; }
    S.cur = found.doc_id; S.ord = found.ord; S.work = clone(found.data); S.infoState = null;
    renderList(); renderPane();
  }

  function tab(kind) {
    S.kind = kind; S.cur = null; S.work = null; S.filter = ''; S.infoState = null;
    $('search').value = '';
    Array.prototype.forEach.call($('tabs').querySelectorAll('button'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-kind') === kind);
    });
    var acc = kind === 'accounts';
    $('new-id').parentNode.style.display = acc ? 'none' : '';
    $('search').placeholder = acc ? '搜索用户名、昵称或角色…' : '搜索姓名、比赛或轮次…';
    var sid = acc ? '' : suggestId(kind);
    $('new-id').placeholder = sid ? ('新 ID，留空即 ' + sid) : '新内容 ID（姓名）';
    renderList(); renderPane(); renderStat();
    if (acc) { loadAccounts(); }
  }

  /* ---------- 编辑区调度 ---------- */
  function renderPane() {
    var pane = $('pane');
    if (S.kind === 'accounts') { pane.innerHTML = accPane(); return; }
    if (!S.work) {
      pane.innerHTML = '<div class="empty"><b>从左侧选一条，或直接新建</b>' +
        '左侧列表里点一条即可修改；也可以新建一条。' +
        '<div style="margin-top:18px"><button type="button" class="btn primary" data-act="addnew">' +
        '＋ 新建一条</button></div></div>';
      return;
    }
    var head = '<div class="pane-head">' +
      '<div class="grow"><b>' + LABEL[S.kind] + '</b> · 文档 ID：<code>' + esc(S.cur) + '</code></div>' +
      '<button type="button" class="btn primary sm" data-act="save">保存修改</button>' +
      '<button type="button" class="btn warn sm" data-act="del">删除</button>' +
      '</div>';
    var body = '';
    if (S.kind === 'competition') { body = editCompetition(); }
    else if (S.kind === 'qipu') { body = editQipu(); }
    else if (S.kind === 'person') { body = editPerson(); }
    else if (S.kind === 'person_page') { body = editPersonPage(); }
    else if (S.kind === 'rating') { body = editRating(); }
    pane.innerHTML = head + body;
    afterRender();
  }

  /* 渲染后钩子：挂载棋盘与富文本等需要 DOM 的控件 */
  function afterRender() {
    if (S.kind === 'qipu' && $('chess-host')) { mountChess(); }
    if (S.kind === 'person_page' && $('rt-content')) { mountRichText(); }
    if (S.kind === 'qipu') {
      /* 胜负下拉框写的是棋手姓名：改了姓名，选项文字跟着换 */
      var pane = $('pane');
      var rsel = pane.querySelector('select[data-bind="_result"]');
      var p1i = pane.querySelector('input[data-bind="p1"]');
      var p2i = pane.querySelector('input[data-bind="p2"]');
      var refresh = function () {
        refreshResultLabels(rsel, p1i ? p1i.value : '', p2i ? p2i.value : '');
      };
      if (p1i) { p1i.addEventListener('input', refresh); }
      if (p2i) { p2i.addEventListener('input', refresh); }
    }
  }

  /* ---------- 通用控件模板 ---------- */
  function field(label, bind, value, type, attrs) {
    type = type || 'text';
    if (type === 'textarea') {
      return '<div class="field"><label>' + label + '</label><textarea data-bind="' + bind + '" ' +
        (attrs || '') + '>' + esc(value) + '</textarea></div>';
    }
    return '<div class="field"><label>' + label + '</label><input type="' + type +
      '" data-bind="' + bind + '" value="' + esc(value) + '" ' + (attrs || '') + '></div>';
  }
  function selectField(label, bind, value, options) {
    return '<div class="field"><label>' + label + '</label><select data-bind="' + bind + '">' +
      options.map(function (o) {
        var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o;
        return '<option value="' + esc(v) + '"' + (String(v) === String(value) ? ' selected' : '') +
          '>' + esc(t) + '</option>';
      }).join('') + '</select></div>';
  }
  /* 可增减列表：每行一个输入框 */
  function repeater(title, path, arr, opts) {
    opts = opts || {};
    if (opts.plain) {
      var plainRows = (arr || []).map(function (v, i) {
        return '<div class="rep-row">' +
          '<input data-bind="' + path + '.' + i + '" value="' + esc(v) + '" placeholder="' + esc(opts.ph || '') + '">' +
          '<button type="button" class="btn icon warn" data-act="delrow" data-path="' + path + '" data-i="' + i + '" title="删除这条">×</button></div>';
      }).join('');
      return '<div class="repeater">' + plainRows + '</div>' +
        '<button type="button" class="btn sm ghost" data-act="addrow" data-path="' + path +
        '" data-pair="0">＋ 添加一行</button>';
    }
    var rows = (arr || []).map(function (v, i) {
      if (opts.pairs) {
        var kk = opts.kkey || 'k', vk = opts.vkey || 'v';
        var kv = v[kk] != null ? v[kk] : (v.year != null ? v.year : (v.text != null ? v.text : (v.k || '')));
        var vv = v[vk] != null ? v[vk] : '';
        return '<div class="rep-row">' +
          '<input class="k" data-bind="' + path + '.' + i + '.' + kk + '" value="' + esc(kv) + '" placeholder="' + esc(opts.kph || '键') + '">' +
          '<input class="v" data-bind="' + path + '.' + i + '.' + vk + '" value="' + esc(vv) + '" placeholder="' + esc(opts.vph || '内容') + '">' +
          '<button type="button" class="btn icon warn" data-act="delrow" data-path="' + path + '" data-i="' + i + '" title="删除">×</button></div>';
      }
      return '<div class="rep-row">' +
        '<input data-bind="' + path + '.' + i + '" value="' + esc(v) + '" placeholder="' + esc(opts.ph || '') + '">' +
        '<button type="button" class="btn icon warn" data-act="delrow" data-path="' + path + '" data-i="' + i + '" title="删除">×</button></div>';
    }).join('');
    return '<h3>' + esc(title) + '</h3><div class="repeater">' + rows + '</div>' +
      '<button type="button" class="btn sm" data-act="addrow" data-path="' + path +
      '" data-pair="' + (opts.pairs ? '1' : '0') + '">＋ 添加一行</button>';
  }

  /* ---------- 赛事信息：固定维度表单 ----------
   * 主办/裁判/规则/用时/棋手/轮次/对局/弃权 本来就是每场比赛都有的，
   * 直接把标签摆好让管理员填空；不常见的维度才放进「其他信息」自由增删。
   */
  var INFO_KEYS = ['主办', '裁判', '规则', '用时', '棋手', '轮次', '对局', '弃权'];
  var INFO_PH = {
    '主办': '河南省高校棋类协会',
    '裁判': '潘冠臣',
    '规则': '五手两打 / 塔拉山口-10',
    '用时': '30 分钟，共用时后 5 分钟包干',
    '棋手': '8 人',
    '轮次': '3 轮',
    '对局': '12 局',
    '弃权': '例如：6 台'
  };
  function parseInfo(arr) {
    var map = {}, extra = [], order = [];
    (arr || []).forEach(function (s) {
      s = String(s == null ? '' : s);
      var m = /^\s*([^：:]{1,10})\s*[：:]\s*([\s\S]*)$/.exec(s);
      if (m && INFO_KEYS.indexOf(m[1].trim()) >= 0) {
        map[m[1].trim()] = m[2];
        order.push(m[1].trim());
      } else if (s.trim()) {
        extra.push(s);
      }
    });
    return { map: map, extra: extra };
  }
  function flushInfo() {
    if (!S.work || S.kind !== 'competition' || !S.infoState) { return; }
    var st = S.infoState, out = [];
    INFO_KEYS.forEach(function (k) {
      var v = String(st.map[k] == null ? '' : st.map[k]).trim();
      if (v) { out.push(k + '：' + v); }
    });
    ((S.work.infoExtra) || []).forEach(function (s) {
      s = String(s == null ? '' : s).trim();
      if (s) { out.push(s); }
    });
    S.work.info = out;
  }
  function infoEditor(w) {
    if (!S.infoState) { S.infoState = parseInfo(w.info); }
    if (!w.infoExtra) { w.infoExtra = S.infoState.extra.slice(); }
    var map = S.infoState.map;
    var grid = INFO_KEYS.map(function (k) {
      return '<div class="kvrow"><label class="kvk">' + esc(k) + '</label>' +
        '<input class="kvv" data-infokey="' + esc(k) + '" value="' + esc(map[k] || '') +
        '" placeholder="' + esc(INFO_PH[k] || '') + '"></div>';
    }).join('');
    return '<h3>赛事信息<span class="badge">填值即可，留空的不会显示</span></h3>' +
      '<div class="kvlist">' + grid + '</div>' +
      '<div class="kvlabel">其他信息<span>不常用的维度可以自己加，例如「地点：河南省棋院」「赛制：瑞士制 7 轮」</span></div>' +
      repeater('', 'infoExtra', w.infoExtra, { plain: true, ph: '名称：内容' });
  }

  /* ---------- 编辑器：比赛与台次 ---------- */
  function editCompetition() {
    var w = S.work;
    w.band = w.band || {}; w.info = w.info || []; w.rounds = w.rounds || [];
    w.rows = w.rows || []; w.qipu_ids = w.qipu_ids || [];
    var rounds = w.rounds;
    var head = '<h3>基本信息</h3><div class="grid2">' +
      field('比赛名称', 'title', w.title || '', 'text', 'placeholder="例如：2026 河南省高校联赛"') +
      field('比赛日期', 'date', w.date || '', 'date') +
      field('平均等级分', 'band.选手平均等级分', w.band['选手平均等级分'] || '') +
      selectField('赛事等级', 'band.等级', w.band['等级'] || '',
        ['A', 'B', 'C', 'D', 'E', '未定']) +
      '</div>' +
      field('页面链接（一般不用改）', 'url', w.url || ('zayu/' + (S.cur || '') + '.html')) +
      field('赛事介绍（一段文字，显示在比赛标题下方）', 'intro', w.intro || '', 'textarea') +
      field('棋谱提示语', 'qp_hint', w.qp_hint || '', 'text', 'placeholder="提示访客点击棋谱格子"');
    var info = infoEditor(w);
    var roundsEd = '<h3>轮次与列<span class="badge">修改后成绩表会自动跟着变</span></h3>' +
      '<div class="repeater">' + rounds.map(function (h, i) {
        var isRoundCol = i >= 2 && i < rounds.length - 5;
        return '<div class="rep-row"><input data-bind="rounds.' + i + '" value="' + esc(h) + '">' +
          (isRoundCol ? '<button type="button" class="btn icon warn" data-act="delcol" data-i="' + i + '" title="删除这一轮">×</button>' : '<span style="width:32px"></span>') +
          '</div>';
      }).join('') + '</div>' +
      '<button type="button" class="btn sm" data-act="addcol">＋ 添加一轮</button>' +
      '<p class="hint" style="color:var(--muted);font-size:12px">提示：前两列一般是「编号」「姓名」，最后五列一般是「积分、对手分、中间对手分、胜局数、名次」。新增的轮次会插在「积分」之前。</p>';
    var start = 2, end = Math.max(start, rounds.length - 5);
    var nRound = end - start;
    var thead = '<tr><th>编号</th><th>姓名 / 主页</th>';
    for (var r = 0; r < nRound; r++) { thead += '<th>' + esc(rounds[start + r] || ('R' + (r + 1))) + '</th>'; }
    thead += '<th>积分</th><th>对手分</th><th>中间对手分</th><th>胜局数</th><th>名次</th><th>操作</th></tr>';
    var rowsHtml = w.rows.map(function (row, ri) {
      row.games = row.games || []; row.tb = row.tb || [];
      var tds = '<td><input class="wpt" data-bind="rows.' + ri + '.no" value="' + esc(row.no || '') + '"></td>' +
        '<td class="namein"><input data-bind="rows.' + ri + '.name" value="' + esc(row.name || '') + '" placeholder="姓名">' +
        '<input class="hrefin" data-bind="rows.' + ri + '.href" value="' + esc(friendlyHref(row.href)) +
        '" placeholder="主页链接（可留空）" title="' + esc(row.href || '') + '"></td>';
      for (var g = 0; g < nRound; g++) {
        var c = row.games[g] || {};
        var oppName = c.opp ? nameOfNo(c.opp) : '';
        tds += '<td><div class="gcell">' +
          '<input class="wopp" data-bind="rows.' + ri + '.games.' + g + '.opp" value="' + esc(c.opp || '') +
          '" placeholder="对手" title="' + esc(oppName ? '对手：' + oppName : '对手的编号') + '">' +
          selectField('', 'rows.' + ri + '.games.' + g + '.res', c.res || '',
            [['', '—'], ['1', '胜'], ['0', '负'], ['0.5', '和']]).replace('<div class="field"><label></label>', '<span>').replace('</select></div>', '</select></span>') +
          '<span class="first-lab' + (c.first ? ' on' : '') + '" data-act="togglefirst" data-r="' + ri + '" data-g="' + g + '" title="先手（黑）">先</span>' +
          qipuChip(ri, g, c) +
          '</div></td>';
      }
      tds += '<td><input class="wpt" data-bind="rows.' + ri + '.pt" value="' + esc(row.pt || '') + '"></td>';
      for (var t = 0; t < 3; t++) {
        tds += '<td><input class="wpt" data-bind="rows.' + ri + '.tb.' + t + '" value="' + esc(row.tb[t] || '') + '"></td>';
      }
      tds += '<td><input class="wpt" data-bind="rows.' + ri + '.rank" value="' + esc(row.rank || '') + '"></td>' +
        '<td><div class="rowops"><button type="button" class="btn icon warn" data-act="delplayer" data-i="' + ri + '">×</button></div></td>';
      return '<tr>' + tds + '</tr>';
    }).join('');
    var table = '<h3>台次成绩表<span class="badge">格子里点「＋棋谱」就能直接在棋盘上录这一局</span></h3>' +
      '<div class="tipbox">每格依次是：对手编号、「胜 / 负 / 和」、「先」手标记、棋谱。' +
      '点「＋棋谱」会弹出棋盘，落子顺序点完点保存，棋谱自动编号并挂到这一台，胜负和先后手一起对上。' +
      '已经录过的显示为「#编号」，点它可以继续改。</div>' +
      '<div class="tblwrap"><table class="editgrid"><thead>' + thead + '</thead><tbody>' +
      rowsHtml + '</tbody></table></div>' +
      '<button type="button" class="btn sm" data-act="addplayer" style="margin-top:8px">＋ 添加棋手</button>';
    return head + info + roundsEd + table;
  }

  /* ---------- 编辑器：棋谱（棋盘录入） ---------- */
  function editQipu() {
    var w = S.work;
    w.moves = Array.isArray(w.moves) ? w.moves : [];
    var evs = (S.docs.competition || []).map(function (d) {
      return [d.data.title || d.doc_id, d.data.title || d.doc_id];
    });
    if (w.event && evs.indexOf) {
      var has = false; evs.forEach(function (o) { if (o[0] === w.event) { has = true; } });
      if (!has) { evs.unshift([w.event, w.event]); }
    }
    var base = '<h3>这一局的信息</h3><div class="grid2">' +
      selectField('所属比赛', 'event', w.event || '', [['', '（不指定）']].concat(evs)) +
      field('比赛日期', 'date', w.date || '', 'date') +
      field('轮次（第几轮，填数字）', 'round', num(w.round, 1), 'number', 'min="1"') +
      field('台次（第几台）', 'board', w.board || '', 'number', 'min="1"') +
      field('黑方（先手）姓名', 'p1', w.p1 || '', 'text', 'placeholder="例如：宋之杰"') +
      field('白方（后手）姓名', 'p2', w.p2 || '', 'text', 'placeholder="例如：张晋超"') +
      '</div>';
    var ex = selectField('规则', 'rules', w.rules || '', ruleList(w.rules || ''));
    var result = selectField('胜负结果（按胜者录）', '_result', resultKey(w), resultChoices(w.p1, w.p2));
    var swap = '<div id="swap-box">' + swapField(w.rules || '', w.swap || '') + '</div>';
    var m5a = field('5A（第五手被拿掉的点）', 'm5a', w.m5a || '', 'text',
      'placeholder="坐标 H8 或 第5手，多个用空格分开"');
    var info = '<h3>规则与胜负</h3><div class="grid2">' + ex + result + '</div>' + swap + m5a +
      '<p class="hint" style="color:var(--muted);font-size:12px">交换情况按规则填：' +
      '五手两打填 1 位，塔拉山口-10 填前五手共 5 位；+ 表示交换，- 表示不交换。' +
      '5A 填被拿掉的那一点：棋盘坐标（H8）或第几手（5、第五手）都行，多个用空格分开。' +
      '胜负按胜者录：下拉框里是谁的名字就是谁赢，不再分黑白——对局临时换先也不怕记错人。</p>';
    var board = '<h3>在棋盘上录入落子<span class="badge">点交叉点落子，黑先白后自动交替</span></h3>' +
      '<div class="steps"><span><b>1</b> 填好双方姓名</span><span><b>2</b> 点棋盘落子</span>' +
      '<span><b>3</b> 选规则与胜负</span><span><b>4</b> 点「保存修改」</span></div>' +
      '<div class="chess-layout"><div class="chess-board-wrap">' +
      '<div class="board" id="chess-host"></div>' +
      '<div class="chess-ctrl">' +
      '<button type="button" class="btn sm" data-act="chess-undo">悔一步</button>' +
      '<button type="button" class="btn sm" data-act="chess-clear">清空重摆</button>' +
      '</div><div class="moves-str" id="moves-str"></div></div>' +
      '<div><div class="tipbox">落子会按顺序记录，坐标与站点复盘完全一致。双击棋盘上的某颗子可回退到那一手，' +
      '也可以点「悔一步」；摆错就「清空重摆」从头来。棋盘上方的 &lt; &gt; 用来回看检查。</div>' +
      '<div class="field"><label>本局手数（自动生成）</label><input id="move-count" value="' + w.moves.length + '" readonly></div>' +
      field('胜者姓名（选胜负后自动填，一般不用改）', 'winner', w.winner || '') +
      '<div class="tipbox">更省事的做法：到比赛的「台次成绩表」里点这一格的「＋棋谱」，' +
      '比赛、轮次、台次、双方姓名都会自动带上，棋谱也会自动挂到成绩表上。</div>' +
      '</div></div>';
    var link = '<h3>关联到成绩表</h3><div class="tipbox">这局的棋谱编号是 <b>#' + esc(S.cur) +
      '</b>。回到对应比赛的「台次成绩表」，找到这一对棋手那一格，点「＋棋谱」或「#编号」即可关联。</div>';
    return base + info + board + link;
  }
  function resultKey(w) {
    if (w.result === '1-0' || w.winner === w.p1) { return 'p1'; }
    if (w.result === '0-1' || w.winner === w.p2) { return 'p2'; }
    if (w.result === '1/2-1/2' || w.result === 'draw') { return 'draw'; }
    return '';
  }
  /*
   * 赛果按「谁赢了」录：选项文字是棋手姓名，不是黑方/白方。
   * 对局最后临时换先时黑白会反，记姓名就不会把胜方记到对手头上。
   * 值仍用 p1 / p2（先手 / 后手这一台的定义），落库时按这一台的先后手换算。
   */
  function resultChoices(p1, p2) {
    var a = String(p1 || '').trim() || '先手';
    var b = String(p2 || '').trim() || '后手';
    return [['p1', a + ' 胜'], ['p2', b + ' 胜'], ['draw', '和棋'], ['', '未定']];
  }
  /* 姓名改了，下拉框上的名字跟着改，别停在旧名字上 */
  function refreshResultLabels(sel, p1, p2) {
    if (!sel) { return; }
    var map = {};
    resultChoices(p1, p2).forEach(function (o) { map[o[0]] = o[1]; });
    Array.prototype.forEach.call(sel.options, function (o) {
      if (Object.prototype.hasOwnProperty.call(map, o.value)) { o.textContent = map[o.value]; }
    });
  }

  /* ---------- 编辑器：人物介绍卡片 ---------- */
  function editPerson() {
    var w = S.work;
    w.facts = w.facts || []; w.honors = w.honors || []; w.links = w.links || [];
    var base = '<h3>基本信息</h3><div class="grid2">' +
      field('姓名', 'name', w.name || '') +
      field('段位', 'dan', w.dan || '', 'text', 'placeholder="例如：专业二段"') +
      field('地区标签', 'tag', w.tag || '', 'text', 'placeholder="例如：山东 · 临沂"') +
      '</div>' + field('人物简介（一段话）', 'bio', w.bio || '', 'textarea');
    var facts = repeater('资料卡（单位、等级分、对局、身份……）', 'facts', w.facts,
      { pairs: true, kph: '名称', kkey: 'k', vkey: 'v', vph: '内容' });
    var honors = repeater('主要战绩（每行一条）', 'honors', w.honors,
      { pairs: true, kph: '年份', kkey: 'year', vkey: 'text', vph: '战绩描述' });
    var links = repeater('相关链接（文字 + 网址）', 'links', w.links,
      { pairs: true, kph: '文字', kkey: 'text', vkey: 'href', vph: '网址' });
    return base + facts + honors + links;
  }

  /* ---------- 编辑器：棋手个人主页（富文本） ---------- */
  function editPersonPage() {
    var w = S.work;
    w.stats = w.stats || [];
    var head = '<h3>基本信息</h3><div class="grid2">' +
      field('棋手姓名', 'name', w.name || '') +
      field('页面标题', 'title', w.title || '') +
      field('地区', 'region', w.region || '', 'text', 'placeholder="例如：河南省 郑州市"') +
      field('单位', 'unit', w.unit || '', 'text', 'placeholder="例如：郑州经贸学院"') +
      field('段位', 'dan', w.dan || '', 'text', 'placeholder="例如：专业二段（可留空）"') +
      '</div>';
    var stats = repeater('等级分等统计（名称 + 数值，可增删）', 'stats', w.stats,
      { pairs: true, kph: '名称', kkey: 'k', vkey: 'v', vph: '数值' });
    var rt = '<h3>个人主页正文<span class="badge">像 Word 一样编辑，不用写代码</span></h3>' +
      '<div class="rt-box"><div class="rt-bar">' +
      '<button type="button" data-act="rt" data-cmd="bold" title="加粗"><b>B</b></button>' +
      '<button type="button" data-act="rt" data-cmd="italic" title="斜体"><i>I</i></button>' +
      '<button type="button" data-act="rt" data-cmd="formatBlock" data-val="h3" title="小标题">标题</button>' +
      '<button type="button" data-act="rt" data-cmd="formatBlock" data-val="p" title="正文">正文</button>' +
      '<button type="button" data-act="rt" data-cmd="insertUnorderedList" title="项目符号">• 列表</button>' +
      '<button type="button" data-act="rt" data-cmd="insertOrderedList" title="编号列表">1. 列表</button>' +
      '<button type="button" data-act="rt" data-cmd="createLink" title="插入链接">链接</button>' +
      '<button type="button" data-act="rt" data-cmd="removeFormat" title="清除格式">清除格式</button>' +
      '</div><div class="rt-content" id="rt-content" contenteditable="true" data-ph="在这里写这位棋手的介绍……">' +
      (w.bioHtml || esc(w.bio) || '') + '</div></div>' +
      '<p class="hint" style="color:var(--muted);font-size:12px">选中文字再点工具栏按钮即可加粗、设标题、加链接。支持直接粘贴网页文字。</p>';
    var note = '<div class="tipbox">左侧共 ' + (S.docs.person_page || []).length +
      ' 位棋手，可用搜索框按姓名快速定位。保存后，访客打开这位棋手的个人主页就能看到新内容。' +
      '文档 ID 与页面文件绑定，请勿修改 ID。</div>';
    return head + stats + rt + note;
  }

  /* ---------- 编辑器：等级分 ---------- */
  function editRating() {
    var w = S.work;
    return '<h3>棋手等级分</h3><div class="grid2">' +
      field('姓名', 'name', w.name || '') +
      field('名次', 'rank', w.rank || '', 'number', 'min="1"') +
      field('等级分', 'rating', w.rating || '', 'text', 'placeholder="例如：2634.69"') +
      field('主页链接', 'href', w.href || '', 'text', 'placeholder="p/姓名.html，可留空"') +
      field('地区', 'region', w.region || '') +
      field('单位', 'uni', w.uni || '') +
      '</div><div class="tipbox">名次可直接改；要按分数重新排名，请用页面顶部的「更新等级分」按钮。</div>';
  }

  /* ---------- 棋盘：直接用前台的 assets/board.js ----------
   * 外观、坐标、手数标记与访客复盘时看到的完全一样。 */
  var COLS = 'ABCDEFGHIJKLMNO';
  function coord(i, j) { return COLS.charAt(i) + (15 - j); }

  /* 5A 支持两种写法，可混填多个，用空格分开：
   *   棋盘坐标 H8（A–O 与 1–15）；
   *   第几手 5 / 第5手 / 第五手，统一记成「第5手」。
   * 写别的就报错，别把脏值存进棋谱。 */
  var CN_NUM = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };

  /* 「第五手」「十二」「二十」这类中文数字，认不出就返回 0 */
  function cnNum(t) {
    if (/^十$/.test(t)) { return 10; }
    var a = /^([一二三四五六七八九])?十([一二三四五六七八九])?$/.exec(t);
    if (a) { return (a[1] ? CN_NUM[a[1]] : 1) * 10 + (a[2] ? CN_NUM[a[2]] : 0); }
    if (t.length === 1 && CN_NUM[t]) { return CN_NUM[t]; }
    return 0;
  }

  function norm5a(v) {
    var raw = String(v == null ? '' : v).toUpperCase()
      .replace(/[，,、\/|;；]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!raw) { return ''; }
    var out = [];
    raw.split(' ').forEach(function (pt) {
      var w = pt.replace(/^5A[:：]?/, '');
      var m = /^([A-O])(1[0-5]|[1-9])$/.exec(w);
      if (m) {
        var one = m[1] + m[2];
        if (out.indexOf(one) < 0) { out.push(one); }
        return;
      }
      var n = /^第?([0-9]{1,3})手?$/.exec(w);
      var num = n ? parseInt(n[1], 10) : 0;
      if (!num) {
        n = /^第?([一二三四五六七八九十]{1,3})手?$/.exec(w);
        num = n ? cnNum(n[1]) : 0;
      }
      if (!num) {
        throw new Error('5A 要填棋盘坐标（例如 H8）或第几手（例如 5、第五手）；「' +
          pt + '」看不懂');
      }
      var mv = '第' + num + '手';
      if (out.indexOf(mv) < 0) { out.push(mv); }
    });
    return out.join(' ');
  }
  /* 黑白交换：+ 交换、- 不交换。
   * 五手两打记 1 位（整局是否换过先后手），塔拉山口-10 记前五手共 5 位。 */
  var SWAP_OPTS = [['', '（未填）'], ['-', '不交换 -'], ['+', '交换 +']];

  function normSwap(v, rules) {
    var raw = String(v == null ? '' : v)
      .replace(/＋/g, '+').replace(/[－—–−]/g, '-')
      .replace(/[，,、\/|;；\s]+/g, '');
    if (!raw) { return ''; }
    if (!/^[+-]+$/.test(raw)) {
      throw new Error('交换情况只填 + 或 -（+ 交换、- 不交换）；「' + v + '」看不懂');
    }
    var need = rules === '塔拉山口-10' ? 5 : (rules ? 1 : 0);
    if (need ? raw.length !== need : (raw.length !== 1 && raw.length !== 5)) {
      throw new Error(rules === '塔拉山口-10'
        ? '塔拉山口-10 要填前五手的交换情况，正好 5 位，例如 +-+--；填了 ' + raw.length + ' 位'
        : '五手两打只填 1 位（+ 交换、- 不交换），例如 -；填了 ' + raw.length + ' 位');
    }
    return raw;
  }

  /* 编辑器里的控件：塔拉山口-10 用 5 位文本框，其余用一个下拉；
   * 老数据里存着多位值时继续用文本框，免得下拉把原值吞掉。 */
  function swapField(rules, value) {
    var v = value || '';
    if (rules === '塔拉山口-10' || v.length > 1) {
      return field('前五手交换情况（+ 交换 / - 不交换）', 'swap', v, 'text',
        'placeholder="例如 +-+--，正好 5 位"');
    }
    return selectField('是否交换（+ 交换 / - 不交换）', 'swap', v, SWAP_OPTS);
  }

  /* 弹窗里的同名控件：值直接挂在 REC 上，不走 data-bind */
  function swapFieldRec(rules, value) {
    var v = value || '';
    if (rules === '塔拉山口-10' || v.length > 1) {
      return '<div class="field"><label>前五手交换情况（+ 交换 / - 不交换）</label>' +
        '<input type="text" id="rec-swap" value="' + esc(v) + '" placeholder="例如 +-+--，正好 5 位"></div>';
    }
    return '<div class="field"><label>是否交换（+ 交换 / - 不交换）</label>' +
      '<select id="rec-swap">' + SWAP_OPTS.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (o[0] === v ? ' selected' : '') + '>' +
          esc(o[1]) + '</option>';
      }).join('') + '</select></div>';
  }

  function bindRecSwap() {
    var el = $('rec-swap');
    if (!el || !REC) { return; }
    el.addEventListener('input', function () { REC.swap = el.value; });
    el.addEventListener('change', function () { REC.swap = el.value; });
  }

  /* 规则一改，交换情况的填法跟着换 */
  function refreshSwapBox() {
    /* 弹窗与编辑器各有一个容器，哪边在就刷哪边 */
    var rbox = $('rec-swap-box');
    if (rbox && REC) {
      rbox.innerHTML = swapFieldRec(REC.rules || '', REC.swap || '');
      bindRecSwap();
    }
    var box = $('swap-box');
    if (box && S.work) { box.innerHTML = swapField(S.work.rules || '', S.work.swap || ''); }
  }

  function movesOfBoard(b) {
    if (!b) { return []; }
    return b.getMoves().map(function (m) { return coord(m.i, m.j); });
  }
  function mountBoard(hostId, moves, onChange) {
    var host = $(hostId);
    if (!host || !window.GomokuBoard) { return null; }
    host.setAttribute('data-ready', '1');   /* 自己挂载，别让观察器再挂一次 */
    var b = window.GomokuBoard.mount(host, {
      editable: true,
      moves: window.GomokuBoard.parse((moves || []).join(' '))
    });
    if (onChange) {
      b.onChange(function () { onChange(movesOfBoard(b)); });
      onChange(movesOfBoard(b));
    }
    return b;
  }

  /* 棋谱编辑页的棋盘 */
  function mountChess() {
    var b = mountBoard('chess-host', S.work.moves || [], function (arr) {
      S.work.moves = arr;
      var str = $('moves-str');
      if (str) { str.textContent = arr.join(' ') || '（还没有落子，点棋盘开始）'; }
      var cnt = $('move-count');
      if (cnt) { cnt.value = String(arr.length); }
    });
    if (b) { S.chess = { board: b }; }
  }
  function chessUndo() {
    if (!S.chess || !S.chess.board) { return; }
    S.chess.board.undo();
  }
  function chessClear() {
    if (!S.chess || !S.chess.board) { return; }
    if (!window.confirm('清空棋盘上所有落子，重新摆？')) { return; }
    S.chess.board.clear();
  }

  /* ---------- 成绩表里的「＋棋谱」：就地录落子 ---------- */
  var REC = null;

  function findDoc(kind, id) {
    var list = S.docs[kind] || [];
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].doc_id) === String(id)) { return list[i]; }
    }
    return null;
  }
  function nextQipuId() {
    var max = 0;
    (S.docs.qipu || []).forEach(function (d) {
      var n = num(d.doc_id, 0);
      if (n > max) { max = n; }
    });
    return String(max + 1);
  }
  function nameOfNo(no) {
    var rows = (S.work && S.work.rows) || [];
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].no) === String(no)) { return String(rows[i].name || '').trim(); }
    }
    return '';
  }
  /* 成绩表明细里的一个小按钮：没棋谱显示「＋棋谱」，有则显示编号 */
  function qipuChip(ri, gi, c) {
    var id = c && c.qipu ? String(c.qipu) : '';
    if (!id) {
      return '<button type="button" class="qchip" data-act="rec" data-r="' + ri + '" data-g="' + gi +
        '" title="在棋盘上录入这一局的落子">＋ 棋谱</button>';
    }
    var doc = findDoc('qipu', id);
    var turns = doc && Array.isArray(doc.data.moves) ? doc.data.moves.length : 0;
    return '<button type="button" class="qchip on" data-act="rec" data-r="' + ri + '" data-g="' + gi +
      '" title="' + (turns ? '已录 ' + turns + ' 手，点开继续编辑' : '已关联棋谱，点开录入落子') + '">#' + esc(id) +
      (turns ? ' · ' + turns + '手' : ' · 空') + '</button>';
  }

  /* 比赛棋谱只记这两种规则；遇到旧数据里的其它写法原样留一项，免得保存时被清掉 */
  var RULES = ['五手两打', '塔拉山口-10'];
  function ruleList(v) {
    var arr = [['', '（未填）']].concat(RULES.map(function (r) { return [r, r]; }));
    if (v && RULES.indexOf(v) < 0) { arr.push([v, v]); }
    return arr;
  }
  function ruleOptions(v) {
    return ruleList(v).map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (o[0] === v ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('');
  }
  function resultOptions(v, p1, p2) {
    return resultChoices(p1, p2)
      .map(function (o) {
        return '<option value="' + o[0] + '"' + (o[0] === v ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
      }).join('');
  }

  /*
   * 打开录入棋谱弹窗。
   * mode 不传：沿用这一格里已关联的棋谱；传 'new'：强制新建；传编号：改用那份棋谱。
   */
  function openRecorder(ri, gi, mode) {
    var rows = (S.work && S.work.rows) || [];
    var row = rows[ri];
    if (!row) { return; }
    row.games = row.games || [];
    var game = row.games[gi] || (row.games[gi] = {});
    var me = String(row.name || '').trim();
    var oppName = nameOfNo(game.opp);

    var docRec = null;
    if (mode === 'new') { docRec = null; }
    else if (mode) { docRec = findDoc('qipu', mode); }
    else if (game.qipu) { docRec = findDoc('qipu', game.qipu); }
    var doc = docRec ? clone(docRec.data) : null;

    var black = me, white = oppName;
    if (doc) {
      black = doc.p1 || me;
      white = doc.p2 || oppName;
    } else if (game.first === false) {
      black = oppName;
      white = me;
    }

    var rk = '';
    if (doc) {
      rk = resultKey(doc);
    } else if (game.res === '1') {
      rk = (game.first === false) ? 'p2' : 'p1';
    } else if (game.res === '0') {
      rk = (game.first === false) ? 'p1' : 'p2';
    } else if (game.res === '0.5') {
      rk = 'draw';
    }

    REC = {
      ri: ri, gi: gi, me: me,
      id: docRec ? String(docRec.doc_id) : '',
      doc: doc,
      board: null
    };

    var roundNo = gi + 1;
    var oppShow = oppName || '待填';
    var links = [['', '（新建一份棋谱 #' + nextQipuId() + '）']].concat(
      (S.docs.qipu || []).map(function (d) {
        var t = '#' + d.doc_id + ' ' + (d.data.p1 || '?') + '对' + (d.data.p2 || '?');
        return [String(d.doc_id), t];
      }));
    var curLink = docRec ? String(docRec.doc_id) : '';

    var html =
      '<div class="modal-mask" data-act="rec-mask">' +
      '<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="rec-title">' +
      '<div class="modal-head"><div>' +
      '<p class="modal-eyebrow">录入棋谱</p>' +
      '<h2 class="modal-title" id="rec-title">第 ' + roundNo + ' 轮 · 第 ' + (ri + 1) + ' 台</h2>' +
      '<p class="modal-sub">' + esc(S.work.title || ('比赛 ' + S.cur)) + ' · ' +
      esc(me || '待填') + ' 对 ' + esc(oppShow) + '</p>' +
      '</div><button type="button" class="btn icon" data-act="rec-close" aria-label="关闭">×</button></div>' +
      '<div class="modal-body">' +
      '<div>' +
      '<div class="board" id="rec-board"></div>' +
      '<div class="chess-ctrl">' +
      '<button type="button" class="btn sm" data-act="rec-undo">悔一步</button>' +
      '<button type="button" class="btn sm" data-act="rec-clear">清空重摆</button>' +
      '<span class="rec-count" id="rec-count">0 手</span>' +
      '</div>' +
      '<div class="moves-str" id="rec-moves"></div>' +
      '</div>' +
      '<div class="rec-side">' +
      '<div class="field"><label>黑方（先手）</label><input type="text" id="rec-p1" value="' + esc(black) + '" placeholder="先手姓名"></div>' +
      '<div class="field"><label>白方（后手）</label><input type="text" id="rec-p2" value="' + esc(white) + '" placeholder="后手姓名"></div>' +
      '<div class="swap-line"><button type="button" class="btn sm" data-act="rec-swap">⇅ 交换先后手</button>' +
      '<span class="vs">黑先白后</span></div>' +
      '<div class="grid2">' +
      '<div class="field"><label>胜负（按胜者录）</label><select id="rec-result">' + resultOptions(rk, black, white) + '</select></div>' +
      '<div class="field"><label>规则</label><select id="rec-rules">' + ruleOptions(doc ? (doc.rules || '') : '') + '</select></div>' +
      '</div>' +
      '<div id="rec-swap-box">' +
      swapFieldRec(doc ? (doc.rules || '') : '', doc ? (doc.swap || '') : '') + '</div>' +
      '<div class="field"><label>5A（第五手被拿掉的点）</label><input type="text" id="rec-m5a" value="' +
      esc(doc ? (doc.m5a || '') : '') + '" placeholder="坐标 H8 或 第5手，多个用空格分开"></div>' +
      '<div class="field"><label>这一格对应哪份棋谱</label><select id="rec-link">' +
      links.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (o[0] === curLink ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
      }).join('') + '</select></div>' +
      '<div class="tipbox">点棋盘落子，黑先白后自动交替，最后一手标红。双击某颗子回退到那一手，' +
      '也可以用上面的「悔一步」。点「保存并关联」后，棋谱会按编号存好，并挂到这一台；' +
      '胜负按人记（选了谁的名字就是谁赢），先后手临时换了点「⇅ 交换先后手」，胜方不会跟着换人。</div>' +
      '<div class="rec-foot">' +
      '<button type="button" class="btn primary" data-act="rec-save">保存并关联</button>' +
      '<button type="button" class="btn" data-act="rec-close">取消</button>' +
      '</div>' +
      '</div></div></div></div>';

    var host = $('rec-host');
    host.innerHTML = html;
    document.body.classList.add('is-modal');

    REC.board = mountBoard('rec-board', (doc && doc.moves) || [], function (arr) {
      var mv = $('rec-moves');
      if (mv) { mv.textContent = arr.join(' ') || '（还没有落子，点棋盘开始）'; }
      var ct = $('rec-count');
      if (ct) { ct.textContent = arr.length + ' 手'; }
    });

    var s1 = $('rec-p1'), s2 = $('rec-p2');
    if (s1) { s1.focus(); s1.select(); }
    /* 弹窗里输入框自己保存到 REC，避免关掉再开会丢 */
    [['rec-p1', 'p1'], ['rec-p2', 'p2'], ['rec-result', 'rk'],
      ['rec-rules', 'rules'], ['rec-m5a', 'm5a']].forEach(function (p) {
      var el = p[0] ? $(p[0]) : null;
      if (!el) { return; }
      el.addEventListener('input', function () { REC[p[1]] = el.value; });
      el.addEventListener('change', function () { REC[p[1]] = el.value; });
    });
    REC.p1 = black; REC.p2 = white; REC.rk = rk; REC.rules = doc ? (doc.rules || '') : '';
    REC.m5a = doc ? (doc.m5a || '') : '';
    REC.swap = doc ? (doc.swap || '') : '';
    /* 改了姓名，胜负下拉框里的名字立刻跟上 */
    var rsel = $('rec-result');
    var syncResultLabels = function () {
      refreshResultLabels(rsel, (($('rec-p1') || {}).value || ''), (($('rec-p2') || {}).value || ''));
    };
    ['rec-p1', 'rec-p2'].forEach(function (id) {
      var el = $(id);
      if (el) { el.addEventListener('input', syncResultLabels); }
    });
    bindRecSwap();
    var rr = $('rec-rules');
    if (rr) {
      rr.addEventListener('change', function () {
        REC.rules = rr.value;
        refreshSwapBox();
      });
    }
  }

  function closeRecorder() {
    var host = $('rec-host');
    if (host) { host.innerHTML = ''; }
    document.body.classList.remove('is-modal');
    REC = null;
  }

  function swapRecSides() {
    if (!REC) { return; }
    var a = $('rec-p1'), b = $('rec-p2');
    if (!a || !b) { return; }
    var t = a.value; a.value = b.value; b.value = t;
    REC.p1 = a.value; REC.p2 = b.value;
    /* 先后手换了：胜方还是原来那个人，所以把选择换到同一个人的位置上，
     * 下拉框上的名字也随之更新（p1/p2 只是「这一台的先手/后手」，不代表人）。 */
    var r = $('rec-result');
    if (r && r.value === 'p1') { r.value = 'p2'; } else if (r && r.value === 'p2') { r.value = 'p1'; }
    if (r) { REC.rk = r.value; refreshResultLabels(r, a.value, b.value); }
  }

  function switchRecLink(v) {
    if (!REC) { return; }
    var hasMoves = REC.board && REC.board.getMoves().length > 0;
    if (hasMoves && !window.confirm('切换到另一份棋谱会替换棋盘上的落子，确定继续？')) {
      var sel = $('rec-link');
      if (sel) { sel.value = REC.id || ''; }
      return;
    }
    openRecorder(REC.ri, REC.gi, v || 'new');
  }

  function saveRecorder() {
    if (!REC) { throw new Error('请先选择要录入的对局'); }
    var p1 = (($('rec-p1') || {}).value || '').trim();
    var p2 = (($('rec-p2') || {}).value || '').trim();
    if (!p1 || !p2) { throw new Error('请先填好双方姓名'); }
    var moves = movesOfBoard(REC.board);
    if (!moves.length) { throw new Error('棋盘上还没有落子，先点几手再保存'); }

    var rk = ($('rec-result') || {}).value || '';
    var rules = ($('rec-rules') || {}).value || '';
    var id = REC.id || nextQipuId();
    var doc = clone(REC.doc || {});
    var oldMoves = Array.isArray(doc.moves) ? doc.moves.join(' ') : '';

    if (/^\d+$/.test(String(id))) { doc.id = num(id, 0); }
    doc.tid = num(S.work.tid, 0);
    doc.event = S.work.title || doc.event || '';
    doc.date = S.work.date || doc.date || '';
    doc.round = REC.gi + 1;
    doc.roundLabel = '第 ' + (REC.gi + 1) + ' 轮';
    doc.board = REC.ri + 1;
    doc.p1 = p1;
    doc.p2 = p2;
    doc.rules = rules;
    var m5a = norm5a(($('rec-m5a') || {}).value || '');
    if (m5a) { doc.m5a = m5a; } else { delete doc.m5a; }
    var sw = normSwap(($('rec-swap') || {}).value || '', rules);
    if (sw) { doc.swap = sw; } else { delete doc.swap; }
    doc.moves = moves;
    doc.turns = moves.length;

    if (rk === 'p1') { doc.result = '1-0'; doc.resultText = '先胜'; doc.winner = p1; }
    else if (rk === 'p2') { doc.result = '0-1'; doc.resultText = '后胜'; doc.winner = p2; }
    else if (rk === 'draw') { doc.result = '1/2-1/2'; doc.resultText = '和棋'; doc.winner = ''; }
    else { doc.result = ''; doc.resultText = ''; doc.winner = ''; }

    /* 落子变了，旧的引擎评估就不作数了 */
    if (oldMoves !== moves.join(' ')) { delete doc.eval; }

    var ri = REC.ri, gi = REC.gi;
    var me = String((((S.work.rows || [])[ri]) || {}).name || '').trim();
    var round = gi + 1, boardNo = ri + 1;

    msg('正在保存棋谱 #' + id + '…');
    return rpc('zbx_admin_save_docs', {
      p_token: token(), p_kind: 'qipu',
      p_rows: [{ doc_id: String(id), data: doc, ord: num(id, 0) }]
    }).then(function (res) {
      if (!res || !res.ok) { throw new Error((res && res.err) || '棋谱保存失败'); }
      /* 把棋谱写回这一格：编号、先后手、胜负 */
      var row = S.work.rows[ri];
      row.games = row.games || [];
      var g = row.games[gi] || (row.games[gi] = {});
      g.qipu = String(id);
      if (me) { g.first = (p1 === me); }
      if (doc.result === '1-0') { g.res = (p1 === me) ? '1' : '0'; }
      else if (doc.result === '0-1') { g.res = (p1 === me) ? '0' : '1'; }
      else if (doc.result === '1/2-1/2') { g.res = '0.5'; }
      S.work.qipu_ids = S.work.qipu_ids || [];
      var nid = num(id, -1);
      if (nid >= 0 && S.work.qipu_ids.indexOf(nid) < 0) { S.work.qipu_ids.push(nid); }

      return rpc('zbx_admin_save_docs', {
        p_token: token(), p_kind: 'competition',
        p_rows: [{ doc_id: S.cur, data: S.work, ord: S.ord }]
      }).then(function (r2) {
        if (!r2 || !r2.ok) { throw new Error((r2 && r2.err) || '关联到成绩表失败'); }
        closeRecorder();
        return loadAll().then(function () {
          var el = $('msg');
          if (el) {
            el.className = 'ok';
            el.innerHTML = '棋谱 #' + esc(id) + ' 已保存（' + moves.length + ' 手），并关联到第 ' +
              round + ' 轮第 ' + boardNo + ' 台。' +
              ' <a href="' + esc(viewUrlOf('competition', S.cur, S.work)) +
              '" target="_blank" rel="noopener">看这一页 ↗</a>';
          }
        });
      });
    });
  }

  /* ---------- 富文本组件 ---------- */
  function mountRichText() {
    var el = $('rt-content');
    if (!el) { return; }
    /* 每次输入同步到 work，避免切换列表项后丢失未保存的编辑 */
    el.addEventListener('input', function () { S.work.bioHtml = el.innerHTML; });
  }
  function richCommand(cmd, val) {
    var el = $('rt-content'); if (!el) { return; }
    el.focus();
    if (cmd === 'createLink') {
      var url = window.prompt('请输入网址（http:// 或 https:// 开头）', 'https://');
      if (!url) { return; }
      document.execCommand('createLink', false, url);
    } else {
      document.execCommand(cmd, false, val || null);
    }
  }

  /* ---------- 保存 / 删除 ---------- */
  function applySpecial() {
    var w = S.work;
    if (S.kind === 'competition') {
      flushInfo();
      delete w.infoExtra;
      delete w._infoExtra;
    }
    if (S.kind === 'qipu') {
      /* 只有管理员这一次明确动了「胜负」下拉框，才覆盖胜负字段；
       * 否则保留原有结果，避免改落子时把已有胜负清掉。 */
      if (Object.prototype.hasOwnProperty.call(w, '_result')) {
        var k = w._result || '';
        if (k === 'p1') { w.result = '1-0'; w.resultText = '先胜'; w.winner = w.p1 || '先手'; }
        else if (k === 'p2') { w.result = '0-1'; w.resultText = '后胜'; w.winner = w.p2 || '后手'; }
        else if (k === 'draw') { w.result = '1/2-1/2'; w.resultText = '和棋'; w.winner = ''; }
        else { w.result = ''; w.resultText = ''; w.winner = ''; }
        delete w._result;
      }
      w.m5a = norm5a(w.m5a);
      if (!w.m5a) { delete w.m5a; }
      w.swap = normSwap(w.swap, w.rules);
      if (!w.swap) { delete w.swap; }
      w.turns = (w.moves || []).length;
      w.roundLabel = '第 ' + num(w.round, 1) + ' 轮';
      w.id = num(S.cur, 0);
      w.tid = w.tid || 0;
      delete w._result;
    }
    if (S.kind === 'person_page') {
      var rt = $('rt-content');
      if (rt) { w.bioHtml = rt.innerHTML; }
    }
  }
  function saveCurrent() {
    if (!S.work) { throw new Error('请先选择一条内容'); }
    var id = S.cur;
    if (!id) {
      id = (window.prompt('给这条内容起一个 ID（英文或数字，例如 t21、99、张三）：', '') || '').trim();
      if (!id) { throw new Error('没有填写 ID，未保存'); }
    }
    applySpecial();
    var rows = [{ doc_id: id, data: S.work, ord: S.ord }];
    return rpc('zbx_admin_save_docs', { p_token: token(), p_kind: S.kind, p_rows: rows })
      .then(function (res) {
        if (!res || !res.ok) { throw new Error((res && res.err) || '保存失败'); }
        S.cur = id;
        return loadAll().then(function () { showSaved(id); });
      });
  }

  /* 保存后给出「立即查看这页」链接，确认改动确实到了站点 */
  function viewUrlOf(kind, id, data) {
    if (kind === 'competition') { return '../zayu/' + id + '.html'; }
    if (kind === 'person_page') { return '../zayu/p/' + encodeURIComponent((data && data.name) || id) + '.html'; }
    if (kind === 'person') { return '../zayu/renwu.html#' + encodeURIComponent((data && data.id) || id); }
    if (kind === 'rating') { return '../zayu/rating.html'; }
    return '';
  }
  function showSaved(id) {
    var el = $('msg');
    if (!el) { return; }
    var u = viewUrlOf(S.kind, id, S.work);
    el.className = 'ok';
    el.innerHTML = '已保存「' + esc(docLabel(S.kind, { doc_id: id, data: S.work })) + '」。' +
      (u ? ' <a href="' + u + '" target="_blank" rel="noopener">立即查看这页 ↗</a>' : '');
  }
  function delCurrent() {
    if (!S.cur) { throw new Error('请先选中要删除的内容'); }
    if (!window.confirm('删除「' + docLabel(S.kind, { doc_id: S.cur, data: S.work }) + '」？此操作不可撤销。')) { return; }
    return rpc('zbx_admin_delete_doc', { p_token: token(), p_kind: S.kind, p_doc_id: S.cur })
      .then(function (res) {
        if (!res || !res.ok) { throw new Error((res && res.err) || '删除失败'); }
        msg('已删除。', 'ok'); S.cur = null; S.work = null;
        return loadAll().then(function () { renderPane(); });
      });
  }

  /* ---------- 新建 / 更新等级分 ---------- */
  /* 比赛与棋谱的 ID 是编号，可以直接给一个下一个可用值；其余按姓名建 */
  function suggestId(kind) {
    if (kind === 'qipu') { return nextQipuId(); }
    if (kind === 'competition') {
      var m = 0;
      (S.docs.competition || []).forEach(function (d) {
        var n = num(String(d.doc_id).replace(/[^0-9]/g, ''), 0);
        if (n > m) { m = n; }
      });
      return 't' + (m + 1);
    }
    return '';
  }
  function addDoc() {
    var id = ($('new-id').value || '').trim() || suggestId(S.kind);
    if (!id) { throw new Error('请填写新内容的 ID（一般是姓名）'); }
    for (var i = 0; i < (S.docs[S.kind] || []).length; i++) {
      if (S.docs[S.kind][i].doc_id === id) { throw new Error('这个 ID 已存在，请换一个'); }
    }
    var seed = {};
    if (S.kind === 'competition') { seed = { title: id, date: '', info: [], intro: '', rounds: ['编号', '姓名', 'R1', '积分', '对手分', '中间对手分', '胜局数', '名次'], rows: [], qipu_ids: [] }; }
    else if (S.kind === 'qipu') { seed = { event: '', date: '', round: 1, board: 1, p1: '', p2: '', rules: '', swap: '', m5a: '', moves: [], winner: '', result: '' }; }
    else if (S.kind === 'person') { seed = { name: id, facts: [], honors: [], links: [] }; }
    else if (S.kind === 'person_page') { seed = { name: id, title: id, region: '', unit: '', dan: '', stats: [], bioHtml: '<p></p>' }; }
    else if (S.kind === 'rating') { seed = { name: id, rank: '', rating: '', region: '', uni: '' }; }
    S.cur = id; S.work = seed; S.ord = (S.docs[S.kind] || []).length;
    $('new-id').value = '';
    renderList(); renderPane();
    msg('已新建，填好内容后点「保存修改」。');
  }
  function recalc() {
    if (!window.confirm('按尚未更新的对局重算等级分？')) { return; }
    return rpc('zbx_admin_recalc_ratings', { p_token: token() }).then(function (res) {
      if (!res || !res.ok) { throw new Error((res && res.err) || '更新失败'); }
      msg('等级分已更新：应用 ' + (res.applied || 0) + ' 局。', 'ok');
      return loadAll();
    });
  }

  /* ---------- 事件绑定 ---------- */
  function onInput(e) {
    var t = e.target;
    if (!S.work) { return; }
    var ik = t.getAttribute && t.getAttribute('data-infokey');
    if (ik) {
      if (!S.infoState) { S.infoState = parseInfo(S.work.info); }
      S.infoState.map[ik] = t.value;
      flushInfo();
      return;
    }
    var bind = t.getAttribute && t.getAttribute('data-bind');
    if (!bind) { return; }
    var v = t.value;
    setPath(S.work, bind, v);
    if (bind === 'rules') { refreshSwapBox(); }
    if (bind.indexOf('infoExtra') === 0) { flushInfo(); }
    var kindAttr = t.getAttribute('data-bind');
    if (kindAttr === '_result') {
      /* 胜负变化时立即同步隐藏字段，保存时还会再算一次 */
    }
  }
  function onClick(e) {
    var tabBtn = e.target.closest('#tabs [data-kind]');
    if (tabBtn) { tab(tabBtn.getAttribute('data-kind')); return; }
    var docBtn = e.target.closest('[data-doc]');
    if (docBtn) { selectDoc(docBtn.getAttribute('data-doc')); return; }
    var act = e.target.closest('[data-act]');
    if (!act) { return; }
    var a = act.getAttribute('data-act');

    if (a === 'login') { window.ZBX_ACCOUNT.openPanel('login'); }
    else if (a === 'refresh') { guard(S.kind === 'accounts' ? function () { return loadAccounts(true); } : loadAll)(); }
    else if (a === 'recalc') { guard(recalc)(); }
    else if (a === 'add') { guard(addDoc)(); }
    else if (a === 'addnew') { guard(addDoc)(); }
    else if (a === 'save') { guard(saveCurrent)(); }
    else if (a === 'del') { guard(delCurrent)(); }
    else if (a === 'addrow') {
      var path = act.getAttribute('data-path'), pair = act.getAttribute('data-pair') === '1';
      var arr = getPath(S.work, path) || (function () { setPath(S.work, path, []); return getPath(S.work, path); })();
      var blank = '';
      if (pair) {
        if (path === 'honors') { blank = { year: '', text: '' }; }
        else if (path === 'links') { blank = { text: '', href: '' }; }
        else { blank = { k: '', v: '' }; }
      }
      arr.push(blank);
      renderPane();
    }
    else if (a === 'delrow') {
      var p = act.getAttribute('data-path'), idx = num(act.getAttribute('data-i'), 0);
      (getPath(S.work, p) || []).splice(idx, 1); renderPane();
    }
    else if (a === 'addcol') {
      var rounds = S.work.rounds || (S.work.rounds = []);
      var pt = rounds.indexOf('积分');
      if (pt < 0) { pt = Math.max(2, rounds.length - 5); }
      rounds.splice(pt, 0, 'R' + Math.max(1, rounds.length - 6));
      (S.work.rows || []).forEach(function (row) { (row.games = row.games || []).splice(pt - 2, 0, {}); });
      renderPane();
    }
    else if (a === 'delcol') {
      var ci = num(act.getAttribute('data-i'), 0);
      (S.work.rounds || []).splice(ci, 1);
      (S.work.rows || []).forEach(function (row) { (row.games || []).splice(ci - 2, 1); });
      renderPane();
    }
    else if (a === 'addplayer') {
      var rows = S.work.rows || (S.work.rows = []);
      var n = (S.work.rounds || []).length - 7;
      rows.push({ no: String(rows.length + 1), name: '', href: '', games: [], pt: '', tb: ['', '', ''], rank: '' });
      renderPane();
    }
    else if (a === 'delplayer') {
      (S.work.rows || []).splice(num(act.getAttribute('data-i'), 0), 1); renderPane();
    }
    else if (a === 'togglefirst') {
      var ri = num(act.getAttribute('data-r'), 0), gi = num(act.getAttribute('data-g'), 0);
      var row = (S.work.rows || [])[ri]; if (!row) { return; }
      row.games = row.games || []; row.games[gi] = row.games[gi] || {};
      row.games[gi].first = !row.games[gi].first; renderPane();
    }
    else if (a === 'chess-undo') { chessUndo(); }
    else if (a === 'chess-clear') { chessClear(); }
    else if (a === 'rec') { openRecorder(num(act.getAttribute('data-r'), 0), num(act.getAttribute('data-g'), 0)); }
    else if (a === 'rec-close') { closeRecorder(); }
    else if (a === 'rec-mask') { if (e.target === act) { closeRecorder(); } }
    else if (a === 'rec-undo') { if (REC && REC.board) { REC.board.undo(); } }
    else if (a === 'rec-clear') {
      if (REC && REC.board && window.confirm('清空棋盘上所有落子，重新摆？')) { REC.board.clear(); }
    }
    else if (a === 'rec-swap') { swapRecSides(); }
    else if (a === 'rec-save') { guard(saveRecorder)(); }
    else if (a === 'rt') { richCommand(act.getAttribute('data-cmd'), act.getAttribute('data-val')); }
  }

  document.addEventListener('input', onInput);
  document.addEventListener('change', onInput);
  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'rec-link') { switchRecLink(e.target.value); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && REC) { closeRecorder(); }
  });
  document.addEventListener('click', onClick);
  $('search').addEventListener('input', function () { S.filter = this.value; renderList(); });
  document.addEventListener('zbx:account', syncGate);
  syncGate();
})();
