/* ==========================================================================
   杂想 · 猜术语（AI 版）—— 界面与流程
   --------------------------------------------------------------------------
   题目不预置：每次「新题」都现出一道。接入模型后由模型出题、模型判分；
   没接入时退到本地组合器与字面估分，页面照样能玩，只是标注为「本地估算」。

   一次猜测返回：
     · 相似百分比（0–100，判的是与「正解 + 同一条路上的其它说法」的相对远近）
     · 相似点 / 差在哪 / 一句模糊方向
     · 这次判定的完整 JSON
   ========================================================================== */

(function () {
    'use strict';

    var root = document.getElementById('game');
    if (!root || !window.ZXAI) { return; }

    var AI = window.ZXAI;
    var PLAY_KEY = 'zx-play-v1';

    var ui = {};
    ['idx', 'src', 'pass', 'bar', 'ch', 'q', 'input', 'go', 'count', 'hist',
        'clues', 'cluebox', 'res', 'hint', 'skip', 'next', 'aistate', 'aitxt', 'aibtn',
        'aipanel', 'preset', 'base', 'key', 'model', 'aisave', 'aiclear', 'aimsg'
    ].forEach(function (k) {
        ui[k] = root.querySelector('[data-ui="' + k + '"]');
    });

    var echo = document.getElementById('zx-json-echo');

    var state = {
        q: null,
        hist: [],
        busy: false,
        passed: false,
        seen: [],
        recent: [],
        stats: loadStats()
    };

    /* ---------- 进度存本机 ---------- */

    function loadStats() {
        try {
            var o = JSON.parse(localStorage.getItem(PLAY_KEY) || '{}');
            return {
                n: Number(o.n) || 0,
                hit: Number(o.hit) || 0,
                sum: Number(o.sum) || 0,
                q: Number(o.q) || 0
            };
        } catch (e) {
            return { n: 0, hit: 0, sum: 0, q: 0 };
        }
    }

    function saveStats() {
        try { localStorage.setItem(PLAY_KEY, JSON.stringify(state.stats)); } catch (e) { /* 隐私模式 */ }
    }

    /* ---------- 小工具 ---------- */

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m];
        });
    }

    function pctClass(p) {
        if (p >= 95) { return 'zg-pct--ok'; }
        if (p >= 88) { return 'zg-pct--near'; }
        if (p >= 60) { return 'zg-pct--off'; }
        return 'zg-pct--low';
    }

    function setBusy(on, label) {
        state.busy = on;
        ui.input.disabled = on;
        ui.go.disabled = on;
        if (on) {
            ui.go.textContent = label || '…';
            ui.go.classList.add('is-busy');
        } else {
            ui.go.textContent = '猜';
            ui.go.classList.remove('is-busy');
        }
    }

    /* ---------- 出题 ---------- */

    function newQuestion() {
        state.passed = false;
        state.hist = [];
        ui.res.hidden = true;
        ui.res.innerHTML = '';
        ui.hist.hidden = true;
        ui.hist.innerHTML = '';
        ui.clues.hidden = true;
        ui.cluebox.innerHTML = '';
        ui.count.textContent = '';
        ui.hint.classList.remove('is-on');
        ui.next.classList.remove('is-hot');
        ui.go.hidden = false;
        ui.skip.hidden = false;
        ui.q.textContent = '正在出题…';
        ui.q.classList.add('is-loading');
        ui.ch.textContent = '';
        ui.src.textContent = AI.isReady() ? 'AI 出题中' : '本地出题';
        setBusy(true, '出题');
        ui.input.value = '';

        AI.makeQuestion(state.seen, state.recent).then(function (q) {
            state.q = q;
            if (q.target) { state.seen.push(q.target); }
            if (state.seen.length > 24) { state.seen.shift(); }
            state.recent.push(q.prompt.slice(0, 60));
            if (state.recent.length > 8) { state.recent.shift(); }

            ui.q.classList.remove('is-loading');
            ui.q.textContent = q.prompt;
            ui.ch.textContent = q.chapter || '';
            ui.src.textContent = (q.src === 'ai' ? 'AI 出题' : '本地出题') + (q.ref ? ' · ' + q.ref : '');
            state.stats.q += 1;
            saveStats();
            renderScore();
            ui.src.className = 'zg-src ' + (q.src === 'ai' ? 'is-ai' : 'is-local');
            if (q.fallbackReason) {
                ui.count.textContent = '这次没走通模型：' + q.fallbackReason + ' 题改由本地组合，仍在同一套语料上。';
            }
            setBusy(false);
            ui.input.disabled = false;
            /* 不要因为聚焦把页面拽到半截去 */
            try { ui.input.focus({ preventScroll: true }); } catch (e) { /* 老浏览器 */ }
            renderScore();
        }).catch(function (err) {
            ui.q.classList.remove('is-loading');
            ui.q.textContent = '出题失败：' + (err && err.message ? err.message : '未知原因');
            setBusy(false);
        });
    }

    function renderScore() {
        var s = state.stats;
        ui.idx.textContent = '第 ' + Math.max(1, s.q) + ' 题';
        ui.pass.textContent = s.n
            ? '猜 ' + s.n + ' 次 · 命中 ' + s.hit + ' · 均 ' + Math.round(s.sum / s.n) + '%'
            : '还没开口';
        ui.bar.style.width = Math.min(100, ((s.q || 1) % 10) / 10 * 100) + '%';
    }

    /* ---------- 判分 ---------- */

    function submit(word) {
        var w = String(word || '').trim();
        if (!w || state.busy) { return; }
        if (w.length > 10) {
            ui.res.hidden = false;
            ui.res.innerHTML = '<p class="zg-err">太长了。这里只等一个词：两三个字，最多四五个字。</p>';
            return;
        }
        if (!state.q) { return; }
        var dup = state.hist.some(function (h) { return h.w.toLowerCase() === w.toLowerCase(); });
        if (dup) { return; }

        setBusy(true, '判定');

        AI.rate(state.q, w).then(function (r) {
            state.hist.push({ w: w, p: r.similarity });
            state.stats.n += 1;
            state.stats.sum += r.similarity;
            if (r.similarity >= 95) { state.stats.hit += 1; }
            saveStats();

            state.passed = r.similarity >= 95;
            renderResult(r, w);
            renderHist();
            renderScore();

            if (state.passed) {
                ui.input.disabled = true;
                ui.go.hidden = true;
                ui.skip.hidden = true;
                ui.next.classList.add('is-hot');
            } else {
                setBusy(false);
            }
            ui.input.value = '';
            echoJson(makeJson(r, w));
        }).catch(function (err) {
            ui.res.hidden = false;
            ui.res.innerHTML = '<p class="zg-err">判分失败：' + esc(err && err.message ? err.message : '未知原因') + '</p>';
            setBusy(false);
        });
    }

    function renderResult(r, word) {
        var html = '';
        html += '<p class="zg-pct ' + pctClass(r.similarity) + '"><b>' + r.similarity +
            '</b><i>%</i><em class="zg-tag">' + (r.engine === 'ai' ? '模型判分' : '本地估算') + '</em></p>';
        html += '<p class="zg-verdict"><b>' + esc(r.verdict) + '</b>你猜「' + esc(word) + '」' +
            (r.similarity >= 95 ? '——就是它。' : '。') + '</p>';

        if (r.matched && r.matched.length) {
            html += '<ul class="zg-pts">' + r.matched.map(function (t) {
                return '<li>' + esc(t) + '</li>';
            }).join('') + '</ul>';
        }
        if (r.gap) { html += '<p class="zg-gap">' + esc(r.gap) + '</p>'; }
        if (r.hint && r.similarity < 90) {
            html += '<p class="zg-hint">往这边想：' + esc(r.hint) + '</p>';
        }
        if (r.fallbackReason) {
            html += '<p class="zg-warn">这次没走通模型（' + esc(r.fallbackReason) +
                '），分数是本地按字面估的，看个方向就行。</p>';
        }
        if (r.similarity >= 95) {
            html += '<div class="zg-ansi">';
            html += '<p class="zg-ansi-w">正解 · ' + esc(state.q.target) + '</p>';
            if (state.q.note) { html += '<p class="zg-ansi-n">' + esc(state.q.note) + '</p>'; }
            html += '</div>';
        }

        html += '<details class="zg-json">';
        html += '<summary>这次判定的 JSON（含正解，点开即看答案）</summary>';
        html += '<pre>' + esc(JSON.stringify(makeJson(r, word), null, 2)) + '</pre>';
        html += '</details>';

        ui.res.hidden = false;
        ui.res.innerHTML = html;
    }

    function renderHist() {
        if (!state.hist.length) { ui.hist.hidden = true; return; }
        var best = 0;
        state.hist.forEach(function (h) { if (h.p > best) { best = h.p; } });
        ui.hist.hidden = false;
        ui.hist.innerHTML = state.hist.map(function (h) {
            var cls = h.p >= 95 ? 'is-pass' : (h.p >= 88 ? 'is-near' : (h.p === best ? 'is-best' : ''));
            return '<li class="' + cls + '"><span class="zg-hw">' + esc(h.w) + '</span>' +
                '<span class="zg-hp">' + h.p + '%</span></li>';
        }).join('');
    }

    function makeJson(r, word) {
        var q = state.q || {};
        return {
            engine: r.engine,
            model: r.engine === 'ai' ? (AI.loadCfg().model || '') : 'local-estimate',
            at: new Date().toISOString(),
            question: {
                id: q.id || '',
                source: q.src || '',
                chapter: q.chapter || '',
                prompt: q.prompt || '',
                target: q.target || '',
                accept: (q.accept || []).map(function (a) { return { word: a.w, note: a.note }; }),
                hint: q.hint || '',
                ref: q.ref || ''
            },
            guess: word,
            similarity: r.similarity,
            verdict: r.verdict,
            matched: r.matched || [],
            gap: r.gap || '',
            hint: r.hint || '',
            passed: r.similarity >= 95,
            tried: state.hist.map(function (h) { return { word: h.w, similarity: h.p }; }),
            stats: {
                asked: state.stats.n,
                hits: state.stats.hit,
                avg: state.stats.n ? Math.round(state.stats.sum / state.stats.n) : 0
            },
            note: r.fallbackReason ? ('本地兜底：' + r.fallbackReason) : ''
        };
    }

    function echoJson(json) {
        if (!echo || echo.hidden) { return; }
        echo.textContent = JSON.stringify(json, null, 2);
    }

    /* ---------- 提示 ---------- */

    function toggleHint() {
        if (!state.q) { return; }
        if (!ui.clues.hidden) {
            ui.clues.hidden = true;
            ui.hint.classList.remove('is-on');
            return;
        }
        var html = '';
        if (state.q.hint) {
            html += '<p class="zg-clues-k">方向：' + esc(state.q.hint) + '</p>';
        }
        var acc = state.q.accept || [];
        if (acc.length) {
            html += '<p class="zg-clues-k">同一条路上还有这些说法，都算对，只是远近不同；点一下即算一次猜测。</p>';
            html += '<div class="zg-clues-b">' + acc.map(function (a) {
                return '<button type="button" class="zg-clue" data-clue="' + esc(a.w) + '">' + esc(a.w) + '</button>';
            }).join('') + '</div>';
        } else {
            html += '<p class="zg-clues-k">这道题没有旁的说法，只有一个落点。</p>';
        }
        ui.cluebox.innerHTML = html;
        ui.clues.hidden = false;
        ui.hint.classList.add('is-on');
    }

    /* ---------- 模型配置面板 ---------- */

    function renderAiBar() {
        var c = AI.loadCfg();
        var on = AI.isReady();
        ui.aistate.className = 'zx-ai-dot' + (on ? ' is-on' : '');
        ui.aitxt.textContent = on
            ? '模型已接入 · ' + c.model
            : '未接入模型：题目与分数都走本地估算';
        fillForm(c);
    }

    function fillForm(c) {
        ui.preset.innerHTML = AI.PRESETS.map(function (p) {
            return '<option value="' + p.id + '">' + p.name + '</option>';
        }).join('');
        var pid = c.preset || 'deepseek';
        ui.preset.value = pid;
        var p = AI.PRESETS.filter(function (x) { return x.id === pid; })[0];
        ui.base.value = c.base || (p && p.base) || '';
        ui.key.value = c.key || '';
        ui.model.value = c.model || (p && p.model) || '';
    }

    if (ui.preset) {
        ui.preset.addEventListener('change', function () {
            var p = AI.PRESETS.filter(function (x) { return x.id === ui.preset.value; })[0];
            if (p) {
                ui.base.value = p.base || '';
                ui.model.value = p.model || '';
            }
        });
    }

    if (ui.aibtn) {
        ui.aibtn.addEventListener('click', function () {
            ui.aipanel.hidden = !ui.aipanel.hidden;
            ui.aibtn.textContent = ui.aipanel.hidden ? '接入 AI' : '收起';
            if (!ui.aipanel.hidden) { ui.key.focus(); }
        });
    }

    if (ui.aisave) {
        ui.aisave.addEventListener('click', function () {
            var base = ui.base.value.trim();
            var key = ui.key.value.trim();
            var model = ui.model.value.trim();
            if (!base || !key || !model) {
                ui.aimsg.className = 'zx-ai-msg is-bad';
                ui.aimsg.textContent = '三项都要填。';
                return;
            }
            AI.saveCfg({ base: base, key: key, model: model, preset: ui.preset.value });
            ui.aimsg.className = 'zx-ai-msg';
            ui.aimsg.textContent = '测试中…';
            renderAiBar();
            AI.test().then(function () {
                ui.aimsg.className = 'zx-ai-msg is-ok';
                ui.aimsg.textContent = '通了。之后的题由模型出、模型判。';
                ui.aipanel.hidden = true;
                ui.aibtn.textContent = '接入 AI';
                newQuestion();
            }).catch(function (err) {
                ui.aimsg.className = 'zx-ai-msg is-bad';
                ui.aimsg.textContent = '没通：' + (err && err.message ? err.message : '未知原因');
            });
        });
    }

    if (ui.aiclear) {
        ui.aiclear.addEventListener('click', function () {
            AI.clearCfg();
            fillForm({ base: '', key: '', model: '', preset: 'deepseek' });
            ui.aimsg.className = 'zx-ai-msg';
            ui.aimsg.textContent = '已清除本机保存的密钥。';
            renderAiBar();
        });
    }

    /* ---------- 事件 ---------- */

    ui.go.addEventListener('click', function () {
        if (state.passed) { newQuestion(); return; }
        submit(ui.input.value);
    });

    ui.input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (!state.busy) { submit(ui.input.value); }
        }
    });

    ui.hint.addEventListener('click', toggleHint);

    ui.cluebox.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('[data-clue]') : null;
        if (!b || state.busy) { return; }
        submit(b.getAttribute('data-clue'));
    });

    ui.skip.addEventListener('click', function () {
        if (!state.q) { return; }
        var q = state.q;
        var html = '<div class="zg-ansi">';
        html += '<p class="zg-ansi-w">正解 · ' + esc(q.target) + '</p>';
        if (q.note) { html += '<p class="zg-ansi-n">' + esc(q.note) + '</p>'; }
        html += '</div>';
        if ((q.accept || []).length) {
            html += '<ul class="zg-pts"><li>同一路上还算对的说法：' +
                q.accept.map(function (a) { return esc(a.w); }).join('、') + '</li></ul>';
        }
        html += '<p class="zg-warn">看答案不计分。换一题继续。</p>';
        ui.res.hidden = false;
        ui.res.innerHTML = html;
        ui.input.disabled = true;
        ui.go.hidden = true;
        ui.skip.hidden = true;
        ui.next.classList.add('is-hot');
    });

    ui.next.addEventListener('click', function () {
        ui.go.hidden = false;
        ui.skip.hidden = false;
        ui.input.disabled = false;
        newQuestion();
    });

    /* ---------- 启动 ---------- */

    renderAiBar();
    renderScore();
    newQuestion();

    /* 地址栏直取 JSON：?w=脱谱 —— 对当前题判一次，结果吐在页首 */
    (function () {
        var w = '';
        try {
            w = new URLSearchParams(location.search).get('w') || '';
        } catch (e) {
            var m = /[?&]w=([^&]+)/.exec(location.search);
            w = m ? decodeURIComponent(m[1]) : '';
        }
        if (!w) { return; }
        var tries = 0;
        var timer = setInterval(function () {
            tries += 1;
            if (tries > 40) { clearInterval(timer); return; }
            if (!state.q || state.busy) { return; }
            clearInterval(timer);
            if (echo) { echo.hidden = false; echo.textContent = '判定中…'; }
            submit(w);
            document.documentElement.scrollTop = 0;
        }, 250);
    })();
})();
