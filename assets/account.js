/*
 * 连珠杂箱 · 全站账号
 * ------------------------------------------------------------
 * 右上角登录 / 注册 / 会话管理。账号、密码哈希、进度都放在云端，
 * 前端只保存一个登录令牌；不再有「只填用户名、进度存本机」的旧逻辑。
 *
 * 云端通过 SECURITY DEFINER RPC 暴露：
 *   zbx_signup / zbx_signin / zbx_session / zbx_signout
 *
 * 对外暴露：
 *   window.ZBX_ACCOUNT        账号对象
 *   window.ZBX_ACCOUNT_READY  Promise<account>，云端会话恢复完成后 resolve
 *   document 'zbx:account'    登录、退出、角色变化时触发
 */
(function () {
    'use strict';

    if (window.ZBX_ACCOUNT) { return; }

    var TOKEN_KEY = 'zbx.account.token';
    var CACHE_KEY = 'zbx.account.cache';
    var STYLE_ID = 'zbx-account-style';
    var USER_RE = /^[一-龥A-Za-z0-9_-]{2,20}$/;

    var state = {
        token: '',
        user: '',
        role: '',
        nick: '',
        ready: false,
        busy: false,
        panel: ''
    };

    function base() {
        return (document.body && document.body.getAttribute('data-base')) || '';
    }

    function readCache() {
        try {
            return JSON.parse(window.localStorage.getItem(CACHE_KEY) || 'null') || {};
        } catch (e) { return {}; }
    }

    function writeCache() {
        try {
            window.localStorage.setItem(CACHE_KEY, JSON.stringify({
                user: state.user, role: state.role, nick: state.nick
            }));
        } catch (e) { /* 隐私模式忽略 */ }
    }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function ensureCloud() {
        if (window.ZBX_CLOUD_READY) { return window.ZBX_CLOUD_READY; }
        var b = base();
        if (!window.__zbxAccountCloudLoad) {
            window.__zbxAccountCloudLoad = true;
            var s = document.createElement('script');
            s.src = b + 'assets/cloud.js';
            s.async = true;
            document.head.appendChild(s);
        }
        return new Promise(function (resolve, reject) {
            var waited = 0;
            (function poll() {
                if (window.ZBX_CLOUD_READY) { resolve(window.ZBX_CLOUD_READY); return; }
                if (waited++ > 200) { reject(new Error('云服务加载超时')); return; }
                setTimeout(poll, 100);
            })();
        });
    }

    /* 不同 SDK 版本对 RPC 返回值包装略有差异，这里统一拆出 jsonb 对象。
     * expectArray=true 时保留数组（公开列表函数返回的是 jsonb 数组）。 */
    function unwrap(res, name, expectArray) {
        var v = res;
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            if (Object.prototype.hasOwnProperty.call(v, 'error') && v.error) {
                throw new Error(typeof v.error === 'string' ? v.error : (v.error.message || '云端请求失败'));
            }
            if (Object.prototype.hasOwnProperty.call(v, 'data')) { v = v.data; }
        }

        if (expectArray) {
            if (Array.isArray(v)) {
                if (v.length && Array.isArray(v[0])) { return v[0]; }
                if (v.length && v[0] && typeof v[0] === 'object' &&
                    Object.prototype.hasOwnProperty.call(v[0], name)) { return v[0][name]; }
                return v;
            }
            if (v && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, name)) {
                return Array.isArray(v[name]) ? v[name] : [];
            }
            return [];
        }

        if (Array.isArray(v)) { v = v.length ? v[0] : null; }
        if (v && typeof v === 'object' && !Array.isArray(v) &&
            Object.prototype.hasOwnProperty.call(v, name)) { v = v[name]; }
        if (Array.isArray(v)) { v = v.length ? v[0] : null; }
        if (v && typeof v === 'object' && !Array.isArray(v) &&
            Object.prototype.hasOwnProperty.call(v, 'data')) { v = v.data; }
        return v;
    }

    function rpc(name, params, expectArray) {
        return ensureCloud().then(function (ready) {
            return ready;
        }).then(function (cloud) {
            if (!cloud || !cloud.database || typeof cloud.database.rpc !== 'function') {
                throw new Error('当前云服务不支持账号接口');
            }
            return cloud.database.rpc(name, params || {});
        }).then(function (res) {
            return unwrap(res, name, !!expectArray);
        });
    }

    function emit(action) {
        try {
            document.dispatchEvent(new CustomEvent('zbx:account', {
                detail: {
                    user: state.user,
                    nick: state.nick || state.user,
                    role: state.role,
                    token: state.token,
                    action: action || 'change'
                }
            }));
        } catch (e) { /* 老浏览器 */ }
    }

    function applySession(res, action) {
        if (!res || !res.ok) {
            throw new Error((res && res.err) || '登录失败');
        }
        state.token = res.token || state.token || '';
        state.user = res.user || '';
        state.role = res.role || 'user';
        state.nick = res.nick || res.user || state.user;
        try { window.localStorage.setItem(TOKEN_KEY, state.token); } catch (e) { /* 忽略 */ }
        writeCache();
        closePanel();
        render();
        emit(action);
        return sessionInfo();
    }

    function restore() {
        var cached = readCache();
        if (cached.user) {
            state.user = cached.user;
            state.role = cached.role || 'user';
            state.nick = cached.nick || cached.user;
            render();
        }
        var token = '';
        try { token = window.localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { token = ''; }
        if (!token) {
            state.ready = true;
            render();
            return Promise.resolve(sessionInfo());
        }
        state.token = token;
        return rpc('zbx_session', { p_token: token }).then(function (res) {
            if (res && res.ok) {
                state.user = res.user || '';
                state.role = res.role || 'user';
                state.nick = res.nick || res.user || state.user;
            } else {
                clearLocal();
            }
            state.ready = true;
            render();
            emit('restore');
            return sessionInfo();
        }).catch(function () {
            /* 网络失败时保留缓存展示，但不把用户当成已登录去写云端 */
            state.ready = true;
            render();
            return sessionInfo();
        });
    }

    function clearLocal() {
        state.token = '';
        state.user = '';
        state.role = '';
        state.nick = '';
        try { window.localStorage.removeItem(TOKEN_KEY); } catch (e) { /* 忽略 */ }
        try { window.localStorage.removeItem(CACHE_KEY); } catch (e) { /* 忽略 */ }
    }

    function login(user, pw) {
        if (state.busy) { return Promise.reject(new Error('正在处理，请稍候')); }
        state.busy = true;
        return rpc('zbx_signin', { p_user: String(user || '').trim(), p_pw: String(pw || '') })
            .then(function (res) { return applySession(res, 'login'); })
            .finally(function () { state.busy = false; });
    }

    function signup(user, pw, nick) {
        if (state.busy) { return Promise.reject(new Error('正在处理，请稍候')); }
        state.busy = true;
        return rpc('zbx_signup', {
            p_user: String(user || '').trim(),
            p_pw: String(pw || ''),
            p_nick: String(nick || '').trim() || null
        }).then(function (res) { return applySession(res, 'signup'); })
            .finally(function () { state.busy = false; });
    }

    function logout() {
        var token = state.token;
        clearLocal();
        render();
        emit('logout');
        if (!token) { return Promise.resolve(true); }
        return rpc('zbx_signout', { p_token: token })
            .then(function () { return true; })
            .catch(function () { return false; });
    }

    function sessionInfo() {
        return {
            user: state.user,
            nick: state.nick || state.user,
            role: state.role,
            isAdmin: state.role === 'admin',
            token: state.token,
            ready: state.ready
        };
    }

    /* ---------- 界面 ---------- */

    function injectStyle() {
        if (document.getElementById(STYLE_ID)) { return; }
        var css = '' +
            '.za-slot{position:relative;display:flex;align-items:center}' +
            '.za-btn{font:600 12.5px/1 ui-sans-serif,system-ui,sans-serif;cursor:pointer;' +
            'border:1px solid rgba(176,141,87,.45);border-radius:999px;padding:7px 13px;' +
            'background:rgba(176,141,87,.1);color:var(--gold-deep,#7a5c22);white-space:nowrap;' +
            'transition:background .18s ease,border-color .18s ease}' +
            '.za-btn:hover{background:rgba(176,141,87,.2);border-color:rgba(176,141,87,.7)}' +
            '.za-face{display:flex;align-items:center;gap:7px}' +
            '.za-face i{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;' +
            'font-style:normal;background:var(--gold-deep,#7a5c22);color:#fff7e6;font-size:11px}' +
            '.za-face em{font-style:normal;opacity:.55;font-size:10px}' +
            '.za-admin{font-size:10px;line-height:1;padding:3px 5px;border-radius:5px;' +
            'background:#b26a12;color:#fff}' +
            '.za-menu{position:absolute;right:0;top:calc(100% + 8px);z-index:90;min-width:168px;' +
            'padding:8px;background:#fffdf7;border:1px solid #d8cbb0;border-radius:11px;' +
            'box-shadow:0 14px 32px rgba(60,44,18,.18)}' +
            '.za-menu[hidden]{display:none}' +
            '.za-menu a,.za-menu button{display:block;width:100%;text-align:left;cursor:pointer;' +
            'font:13px/1.6 ui-sans-serif,system-ui,sans-serif;color:#4a3b28;background:transparent;' +
            'border:0;border-radius:7px;padding:7px 9px;text-decoration:none}' +
            '.za-menu a:hover,.za-menu button:hover{background:#fff3da}' +
            '.za-menu .za-menu-name{padding:5px 9px 8px;margin-bottom:4px;border-bottom:1px dashed #d8cbb0;' +
            'font-size:12px;color:#85745a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '.za-mask{position:fixed;inset:0;z-index:200;display:grid;place-items:center;padding:18px;' +
            'background:rgba(23,21,15,.45);backdrop-filter:blur(2px)}' +
            '.za-mask[hidden]{display:none}' +
            '.za-dialog{width:min(390px,100%);background:#fffdf7;color:#4a3b28;' +
            'border:1px solid #d8cbb0;border-radius:16px;padding:22px;' +
            'box-shadow:0 24px 70px rgba(23,21,15,.3);font:14px/1.6 ui-sans-serif,system-ui,sans-serif}' +
            '.za-dialog h2{margin:0 0 4px;font-size:18px;color:#272117}' +
            '.za-dialog p{margin:0 0 14px;font-size:12px;color:#85745a}' +
            '.za-tabs{display:flex;gap:6px;margin-bottom:16px}' +
            '.za-tabs button{flex:1;cursor:pointer;border:1px solid #d8cbb0;border-radius:9px;' +
            'padding:7px;background:transparent;color:#85745a;font:600 13px/1 ui-sans-serif,system-ui,sans-serif}' +
            '.za-tabs button.is-on{background:#b98d43;border-color:#b98d43;color:#fffaf0}' +
            '.za-field{display:block;margin-bottom:12px}' +
            '.za-field span{display:block;margin-bottom:5px;font-size:12px;color:#85745a}' +
            '.za-field input{width:100%;box-sizing:border-box;border:1px solid #d8cbb0;border-radius:9px;' +
            'padding:9px 11px;background:#fff;color:#4a3b28;font:14px/1.4 ui-sans-serif,system-ui,sans-serif}' +
            '.za-submit{width:100%;cursor:pointer;border:0;border-radius:9px;padding:10px;' +
            'background:#7a5c22;color:#fff7e6;font:600 14px/1 ui-sans-serif,system-ui,sans-serif}' +
            '.za-submit:disabled{opacity:.6;cursor:wait}' +
            '.za-close{float:right;cursor:pointer;border:0;background:transparent;color:#85745a;font-size:20px;line-height:1}' +
            '.za-err{min-height:20px;margin-top:10px;font-size:12px;color:#b23b2e}' +
            '@media(prefers-color-scheme:dark){' +
            '.za-menu,.za-dialog{background:#242019;color:#efe4cd;border-color:#5c4e3c}' +
            '.za-menu a,.za-menu button,.za-field input,.za-tabs button{color:#efe4cd;background:transparent;border-color:#5c4e3c}' +
            '.za-field input{background:#17150f}.za-menu-name{color:#b6a688;border-color:#5c4e3c}' +
            '.za-dialog p,.za-field span{color:#b6a688}' +
            '.za-tabs button.is-on{background:#b98d43;color:#17150f}' +
            '.za-dialog h2{color:#f6ead0}}';
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = css;
        document.head.appendChild(st);
    }

    function render() {
        injectStyle();
        var slots = document.querySelectorAll('[data-zbx-user="global"]');
        Array.prototype.forEach.call(slots, function (slot) {
            slot.className = 'site-user-slot za-slot';
            if (!state.user) {
                slot.innerHTML = '<button type="button" class="za-btn" data-za="open" data-mode="login">' +
                    '登录 / 注册</button>';
                return;
            }
            var initial = (state.nick || state.user).charAt(0);
            slot.innerHTML =
                '<button type="button" class="za-btn za-face" data-za="menu" aria-haspopup="true">' +
                '<i>' + esc(initial) + '</i><span>' + esc(state.nick || state.user) + '</span>' +
                (state.role === 'admin' ? '<b class="za-admin">管理</b>' : '') +
                '<em>▾</em></button>' +
                '<div class="za-menu" hidden>' +
                '<div class="za-menu-name">' + esc(state.user) +
                (state.role === 'admin' ? ' · 管理员' : '') + '</div>' +
                (state.role === 'admin'
                    ? '<a href="' + base() + 'admin/zayu.html">杂豫管理后台</a>' : '') +
                '<button type="button" data-za="logout">退出登录</button>' +
                '</div>';
        });
    }

    function openPanel(mode) {
        injectStyle();
        state.panel = mode === 'signup' ? 'signup' : 'login';
        var mask = document.getElementById('zbx-account-mask');
        if (!mask) {
            mask = document.createElement('div');
            mask.id = 'zbx-account-mask';
            mask.className = 'za-mask';
            document.body.appendChild(mask);
        }
        mask.hidden = false;
        drawPanel();
        var first = mask.querySelector('input');
        if (first) { try { first.focus(); } catch (e) { /* 忽略 */ } }
    }

    function closePanel() {
        var mask = document.getElementById('zbx-account-mask');
        if (mask) { mask.hidden = true; }
        state.panel = '';
    }

    function drawPanel(msg) {
        var mask = document.getElementById('zbx-account-mask');
        if (!mask) { return; }
        var isSignup = state.panel === 'signup';
        mask.innerHTML =
            '<div class="za-dialog" role="dialog" aria-modal="true" aria-label="账号">' +
            '<button type="button" class="za-close" data-za="close" aria-label="关闭">×</button>' +
            '<h2>' + (isSignup ? '注册账号' : '登录') + '</h2>' +
            '<p>进度保存在云端，登录后在任意设备接着用。</p>' +
            '<div class="za-tabs">' +
            '<button type="button" data-za="tab" data-mode="login"' +
            (isSignup ? '' : ' class="is-on"') + '>登录</button>' +
            '<button type="button" data-za="tab" data-mode="signup"' +
            (isSignup ? ' class="is-on"' : '') + '>注册</button>' +
            '</div>' +
            '<form id="za-form" autocomplete="on">' +
            '<label class="za-field"><span>用户名</span>' +
            '<input name="user" type="text" autocomplete="username" maxlength="20" ' +
            'placeholder="2–20 位，中文 / 字母 / 数字" required></label>' +
            (isSignup ? '<label class="za-field"><span>昵称（选填）</span>' +
                '<input name="nick" type="text" maxlength="20" placeholder="显示用名字"></label>' : '') +
            '<label class="za-field"><span>密码</span>' +
            '<input name="pw" type="password" autocomplete="' + (isSignup ? 'new-password' : 'current-password') +
            '" minlength="4" maxlength="64" placeholder="至少 4 位" required></label>' +
            '<button type="submit" class="za-submit"' + (state.busy ? ' disabled' : '') + '>' +
            (isSignup ? '注册并登录' : '登录') + '</button>' +
            '<div class="za-err" role="alert">' + esc(msg || '') + '</div>' +
            '</form></div>';
    }

    function errText(err) {
        var s = String((err && err.message) || err || '操作失败');
        var map = {
            'bad credentials': '用户名或密码不对。',
            'invalid username': '用户名需 2–20 位，可用中文、字母、数字、下划线或短横。',
            'invalid password': '密码需 4–64 位。',
            'username taken': '这个用户名已经被注册，换个名字或去登录。'
        };
        return map[s] || s;
    }

    document.addEventListener('click', function (e) {
        var t = e.target;
        while (t && t.nodeType === 1 && !t.hasAttribute('data-za')) {
            t = t.parentNode;
        }
        if (!t || !t.hasAttribute) { return; }
        var act = t.getAttribute('data-za');
        if (act === 'open') {
            openPanel(t.getAttribute('data-mode'));
            return;
        }
        if (act === 'tab') {
            state.panel = t.getAttribute('data-mode') === 'signup' ? 'signup' : 'login';
            drawPanel();
            return;
        }
        if (act === 'close') {
            closePanel();
            return;
        }
        if (act === 'menu') {
            var menu = t.parentNode.querySelector('.za-menu');
            if (menu) { menu.hidden = !menu.hidden; }
            return;
        }
        if (act === 'logout') {
            if (window.confirm('退出登录？本机的进度缓存会保留，下次登录会从云端恢复。')) {
                logout().catch(function () {});
            }
            return;
        }
        if (e.target && e.target.id === 'zbx-account-mask') {
            closePanel();
        }
    }, false);

    document.addEventListener('submit', function (e) {
        if (!e.target || e.target.id !== 'za-form') { return; }
        e.preventDefault();
        var f = e.target;
        var user = f.elements.user.value;
        var pw = f.elements.pw.value;
        var nick = f.elements.nick ? f.elements.nick.value : '';
        if (!USER_RE.test(user.trim())) {
            drawPanel('用户名需 2–20 位，可用中文、字母、数字、下划线或短横。');
            return;
        }
        state.busy = true;
        var job = state.panel === 'signup' ? signup(user, pw, nick) : login(user, pw);
        job.then(function () {
            state.busy = false;
            drawPanel('');
        }).catch(function (err) {
            state.busy = false;
            drawPanel(errText(err));
        });
    }, false);

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { closePanel(); }
    });

    document.addEventListener('zbx:navigate', function () { render(); });
    document.addEventListener('zbx:account', function () { render(); });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { render(); });
    } else {
        render();
    }

    var ready = new Promise(function (resolve) {
        restore().then(function () { resolve(sessionInfo()); });
    });

    window.ZBX_ACCOUNT_READY = ready;
    window.ZBX_ACCOUNT = {
        rpc: rpc,
        ready: function () { return state.ready; },
        user: function () { return state.user; },
        nick: function () { return state.nick || state.user; },
        role: function () { return state.role; },
        isAdmin: function () { return state.role === 'admin'; },
        token: function () { return state.token; },
        info: sessionInfo,
        login: login,
        signup: signup,
        logout: logout,
        openPanel: openPanel,
        closePanel: closePanel,
        render: render,
        validName: function (n) { return USER_RE.test(String(n || '').trim()); }
    };
})();
