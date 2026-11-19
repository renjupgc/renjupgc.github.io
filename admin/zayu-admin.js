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
    person_page: '棋手个人主页', rating: '等级分'
  };
  var S = {
    kind: 'competition', docs: {}, cur: null, work: null, ord: 0,
    loaded: false, filter: '', chess: null, rtReady: false
  };

  /* ---------- 小工具 ---------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function clone(o) { return JSON.parse(JSON.stringify(o == null ? {} : o)); }
  function num(v, d) { var n = parseInt(v, 10); return isFinite(n) ? n : (d || 0); }
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
      return [x.date, Array.isArray(x.rows) ? x.rows.length + ' 人' : '',
        Array.isArray(x.rows) && x.rows[0] && Array.isArray(x.rows[0].games)
          ? x.rows[0].games.length + ' 轮' : ''].filter(Boolean).join(' · ');
    }
    if (kind === 'qipu') {
      return [x.event, Array.isArray(x.moves) ? x.moves.length + ' 手' : '',
        x.rules].filter(Boolean).join(' · ');
    }
    if (kind === 'person') { return [x.dan, x.tag].filter(Boolean).join(' · '); }
    if (kind === 'person_page') {
      return [x.region, x.unit, x.dan].filter(Boolean).join(' · ');
    }
    if (kind === 'rating') { return [x.region, x.uni].filter(Boolean).join(' · '); }
    return '';
  }
  function renderList() {
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
    var list = S.docs[S.kind] || [], found = null;
    for (var i = 0; i < list.length; i++) { if (list[i].doc_id === id) { found = list[i]; break; } }
    if (!found) { S.cur = null; S.work = null; renderList(); renderPane(); return; }
    S.cur = found.doc_id; S.ord = found.ord; S.work = clone(found.data);
    renderList(); renderPane();
  }

  function tab(kind) {
    S.kind = kind; S.cur = null; S.work = null; S.filter = '';
    $('search').value = '';
    Array.prototype.forEach.call($('tabs').querySelectorAll('button'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-kind') === kind);
    });
    renderList(); renderPane();
  }

  /* ---------- 编辑区调度 ---------- */
  function renderPane() {
    var pane = $('pane');
    if (!S.work) {
      pane.innerHTML = '<div class="empty"><b>从左侧选择一条内容</b>' +
        '点左侧列表里的条目来修改，或点「＋ 新建一条」添加新内容。</div>';
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
    var info = repeater('赛事信息（主办、裁判、规则、用时……每行一条）', 'info', w.info,
      { ph: '例如：主办：河南省高校棋类协会' });
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
    var qopts = [['', '无棋谱']].concat((S.docs.qipu || []).map(function (d) {
      return [d.doc_id, '#' + d.doc_id + ' ' + (d.data.p1 || '') + '对' + (d.data.p2 || '')];
    }));
    var rowsHtml = w.rows.map(function (row, ri) {
      row.games = row.games || []; row.tb = row.tb || [];
      var tds = '<td><input class="wpt" data-bind="rows.' + ri + '.no" value="' + esc(row.no || '') + '"></td>' +
        '<td class="namein"><input data-bind="rows.' + ri + '.name" value="' + esc(row.name || '') + '" placeholder="姓名">' +
        '<input data-bind="rows.' + ri + '.href" value="' + esc(row.href || '') + '" placeholder="主页链接（可留空）"></td>';
      for (var g = 0; g < nRound; g++) {
        var c = row.games[g] || {};
        tds += '<td><div class="gcell">' +
          '<input class="wopp" data-bind="rows.' + ri + '.games.' + g + '.opp" value="' + esc(c.opp || '') + '" placeholder="对手">' +
          selectField('', 'rows.' + ri + '.games.' + g + '.res', c.res || '',
            [['', '—'], ['1', '胜'], ['0', '负'], ['0.5', '和']]).replace('<div class="field"><label></label>', '<span>').replace('</select></div>', '</select></span>') +
          '<span class="first-lab' + (c.first ? ' on' : '') + '" data-act="togglefirst" data-r="' + ri + '" data-g="' + g + '" title="先手（黑）">先</span>' +
          selectField('', 'rows.' + ri + '.games.' + g + '.qipu', c.qipu || '', qopts).replace('<div class="field"><label></label>', '<span>').replace('</select></div>', '</select></span>') +
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
    var table = '<h3>台次成绩表<span class="badge">直接在格子里填，先手点「先」，有棋谱就从下拉里选</span></h3>' +
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
    var ex = selectField('交换 / 规则', 'rules', w.rules || '', [
      ['', '无交换'], ['五手两打', '五手两打'], ['三手交换', '三手交换'],
      ['三手交换五手两打', '三手交换 + 五手两打'], ['自由开局', '自由开局']
    ]);
    var result = selectField('胜负结果', '_result', resultKey(w), [
      ['p1', '黑方（先手）胜'], ['p2', '白方（后手）胜'], ['draw', '和棋'], ['', '未定']
    ]);
    var info = '<h3>交换与胜负</h3><div class="grid2">' + ex + result + '</div>' +
      '<p class="hint" style="color:var(--muted);font-size:12px">选好胜负后会自动填写结果文字和胜者，不用手动改其它字段。</p>';
    var board = '<h3>在棋盘上录入落子<span class="badge">点交叉点落子，黑先白后自动交替</span></h3>' +
      '<div class="steps"><span><b>1</b> 填好双方姓名</span><span><b>2</b> 点棋盘落子</span>' +
      '<span><b>3</b> 选交换与胜负</span><span><b>4</b> 点「保存修改」</span></div>' +
      '<div class="chess-layout"><div class="chess-board-wrap">' +
      '<div id="chess-host"></div>' +
      '<div class="chess-ctrl">' +
      '<button type="button" class="btn sm" data-act="chess-undo">悔一步</button>' +
      '<button type="button" class="btn sm" data-act="chess-clear">清空重摆</button>' +
      '<button type="button" class="btn sm" data-act="chess-prev">◀ 上一手</button>' +
      '<button type="button" class="btn sm" data-act="chess-next">下一手 ▶</button>' +
      '<button type="button" class="btn sm" data-act="chess-last">到最新</button>' +
      '</div><div class="moves-str" id="moves-str"></div></div>' +
      '<div><div class="tipbox">落子会按顺序记录，输出的坐标与站点复盘完全一致。摆错时可「悔一步」，或点「清空重摆」从头来。' +
      '回放按钮用来检查；检查完记得点右上角「到最新」，再保存。</div>' +
      '<div class="field"><label>本局手数（自动生成）</label><input id="move-count" value="' + w.moves.length + '" readonly></div>' +
      field('胜者姓名（选胜负后自动填，一般不用改）', 'winner', w.winner || '') +
      '</div></div>';
    var link = '<h3>关联到成绩表</h3><div class="tipbox">这局的棋谱编号是 <b>#' + esc(S.cur) +
      '</b>。要到对应比赛的「台次成绩表」里，找到这一对棋手那一格，在棋谱下拉里选中「#' + esc(S.cur) +
      '」，访客才能在成绩表里点开它。</div>';
    return base + info + board + link;
  }
  function resultKey(w) {
    if (w.result === '1-0' || w.winner === w.p1) { return 'p1'; }
    if (w.result === '0-1' || w.winner === w.p2) { return 'p2'; }
    if (w.result === '1/2-1/2' || w.result === 'draw') { return 'draw'; }
    return '';
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
      (w.bioHtml || w.bio || '') + '</div></div>' +
      '<p class="hint" style="color:var(--muted);font-size:12px">选中文字再点工具栏按钮即可加粗、设标题、加链接。支持直接粘贴网页文字。</p>';
    var note = '<div class="tipbox">左侧共 595 位棋手，可用搜索框按姓名快速定位。保存后，访客打开这位棋手的个人主页就能看到新内容。' +
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

  /* ---------- 棋盘组件（自绘 SVG，点击落子） ---------- */
  var COLS = 'ABCDEFGHIJKLMNO';
  function coord(i, j) { return COLS.charAt(i) + (15 - j); }
  function svgEl(tag, attrs) {
    var n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (var k in attrs) { if (attrs.hasOwnProperty(k)) { n.setAttribute(k, attrs[k]); } }
    return n;
  }
  function mountChess() {
    var host = $('chess-host');
    if (!host) { return; }
    var M = 20, C = 26, SZ = M * 2 + C * 14;
    var svg = svgEl('svg', {
      viewBox: '0 0 ' + SZ + ' ' + SZ, class: 'chess-svg', role: 'img',
      'aria-label': '15 路棋盘，点击交叉点落子'
    });
    var i, j;
    for (i = 0; i < 15; i++) {
      svg.appendChild(svgEl('line', { x1: M, y1: M + i * C, x2: M + 14 * C, y2: M + i * C, class: 'ln' }));
      svg.appendChild(svgEl('line', { x1: M + i * C, y1: M, x2: M + i * C, y2: M + 14 * C, class: 'ln' }));
    }
    [[3, 3], [3, 11], [11, 3], [11, 11], [7, 7]].forEach(function (p) {
      svg.appendChild(svgEl('circle', { cx: M + p[0] * C, cy: M + p[1] * C, r: 1.6, class: 'star' }));
    });
    for (i = 0; i < 15; i++) {
      var t1 = svgEl('text', { x: M + i * C, y: M - 11, class: 'lbl' }); t1.textContent = COLS.charAt(i); svg.appendChild(t1);
      var t2 = svgEl('text', { x: M - 12, y: M + i * C, class: 'lbl' }); t2.textContent = String(15 - i); svg.appendChild(t2);
    }
    var pieces = svgEl('g', {});
    var hits = svgEl('g', {});
    svg.appendChild(pieces); svg.appendChild(hits);
    for (i = 0; i < 15; i++) {
      for (j = 0; j < 15; j++) {
        (function (ci, cj) {
          var h = svgEl('circle', {
            cx: M + ci * C, cy: M + cj * C, r: C * 0.46,
            class: 'hit', fill: 'transparent'
          });
          h.addEventListener('click', function () { placeMove(ci, cj); });
          hits.appendChild(h);
        })(i, j);
      }
    }
    host.innerHTML = ''; host.appendChild(svg);
    S.chess = { svg: svg, pieces: pieces, cursor: 0 };
    S.chess.cursor = S.work.moves.length;
    drawChess();
  }
  function placeMove(i, j) {
    var coords = S.work.moves || (S.work.moves = []);
    var at = coords.indexOf(coord(i, j));
    if (at >= 0) { return; }
    if (S.chess.cursor < coords.length) { coords.length = S.chess.cursor; }
    coords.push(coord(i, j));
    S.chess.cursor = coords.length;
    drawChess();
  }
  function drawChess() {
    if (!S.chess || !S.chess.pieces) { return; }
    var M = 20, C = 26, coords = S.work.moves || [], cursor = S.chess.cursor;
    var g = S.chess.pieces;
    while (g.firstChild) { g.removeChild(g.firstChild); }
    var n = Math.min(cursor, coords.length);
    for (var k = 0; k < n; k++) {
      var m = /^([A-O])(\d{1,2})$/.exec(coords[k]); if (!m) { continue; }
      var i = COLS.indexOf(m[1]), j = 15 - num(m[2], 1);
      if (i < 0 || j < 0 || i > 14 || j > 14) { continue; }
      var color = (k % 2 === 0) ? 'b' : 'w';
      g.appendChild(svgEl('circle', { cx: M + i * C, cy: M + j * C, r: C * 0.42, class: 'stone ' + color }));
      var numT = svgEl('text', { x: M + i * C, y: M + j * C, class: 'num ' + color });
      numT.textContent = String(k + 1); g.appendChild(numT);
    }
    if (n > 0) {
      var lm = /^([A-O])(\d{1,2})$/.exec(coords[n - 1]);
      if (lm) {
        var li = COLS.indexOf(lm[1]), lj = 15 - num(lm[2], 1);
        g.appendChild(svgEl('circle', {
          cx: M + li * C, cy: M + lj * C, r: C * 0.42, class: 'last'
        }));
      }
    }
    var str = $('moves-str'); if (str) { str.textContent = coords.join(' ') || '（还没有落子，点棋盘开始）'; }
    var cnt = $('move-count'); if (cnt) { cnt.value = String(coords.length); }
  }
  function chessUndo() {
    var coords = S.work.moves || [];
    if (!coords.length) { return; }
    if (S.chess.cursor > coords.length) { S.chess.cursor = coords.length; }
    coords.pop(); S.chess.cursor = coords.length; drawChess();
  }
  function chessClear() {
    if (!window.confirm('清空棋盘上所有落子，重新摆？')) { return; }
    S.work.moves = []; S.chess.cursor = 0; drawChess();
  }
  function chessMove(delta) {
    var coords = S.work.moves || [];
    S.chess.cursor = Math.max(0, Math.min(coords.length, S.chess.cursor + delta));
    drawChess();
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
    if (S.kind === 'qipu') {
      /* 只有管理员这一次明确动了「胜负」下拉框，才覆盖胜负字段；
       * 否则保留原有结果，避免改落子时把已有胜负清掉。 */
      if (Object.prototype.hasOwnProperty.call(w, '_result')) {
        var k = w._result || '';
        if (k === 'p1') { w.result = '1-0'; w.resultText = '先胜'; w.winner = w.p1 || '黑方'; }
        else if (k === 'p2') { w.result = '0-1'; w.resultText = '后胜'; w.winner = w.p2 || '白方'; }
        else if (k === 'draw') { w.result = '1/2-1/2'; w.resultText = '和棋'; w.winner = ''; }
        else { w.result = ''; w.resultText = ''; w.winner = ''; }
        delete w._result;
      }
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
  function addDoc() {
    var id = ($('new-id').value || '').trim();
    if (!id) { throw new Error('请填写新内容的 ID'); }
    for (var i = 0; i < (S.docs[S.kind] || []).length; i++) {
      if (S.docs[S.kind][i].doc_id === id) { throw new Error('这个 ID 已存在，请换一个'); }
    }
    var seed = {};
    if (S.kind === 'competition') { seed = { title: id, date: '', info: [], intro: '', rounds: ['编号', '姓名', 'R1', '积分', '对手分', '中间对手分', '胜局数', '名次'], rows: [], qipu_ids: [] }; }
    else if (S.kind === 'qipu') { seed = { event: '', date: '', round: 1, board: 1, p1: '', p2: '', rules: '', moves: [], winner: '', result: '' }; }
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
    var bind = t.getAttribute && t.getAttribute('data-bind');
    if (!bind || !S.work) { return; }
    var v = t.value;
    setPath(S.work, bind, v);
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
    else if (a === 'refresh') { guard(loadAll)(); }
    else if (a === 'recalc') { guard(recalc)(); }
    else if (a === 'add') { guard(addDoc)(); }
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
    else if (a === 'chess-prev') { chessMove(-1); }
    else if (a === 'chess-next') { chessMove(1); }
    else if (a === 'chess-last') { S.chess.cursor = (S.work.moves || []).length; drawChess(); }
    else if (a === 'rt') { richCommand(act.getAttribute('data-cmd'), act.getAttribute('data-val')); }
  }

  document.addEventListener('input', onInput);
  document.addEventListener('change', onInput);
  document.addEventListener('click', onClick);
  $('search').addEventListener('input', function () { S.filter = this.value; renderList(); });
  document.addEventListener('zbx:account', syncGate);
  syncGate();
})();
