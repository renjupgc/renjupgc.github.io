/*
 * 连珠杂箱 · 全站账号（Supabase 版）
 * ------------------------------------------------------------
 * 右上角登录 / 注册 / 会话管理。账号、密码、进度都在 Supabase，
 * 浏览器里只留一个 Supabase 自己的会话（localStorage 里 sb-*-auth-token）。
 *
 * 后端映射（Supabase 原生能力，不用自建 RPC）：
 *   注册   auth.signUp          → 触发器自动写 public.profiles
 *   登录   auth.signInWithPassword
 *   会话   auth.getSession / onAuthStateChange（自动续期）
 *   退出   auth.signOut
 *   进度   public.user_progress 表 select / upsert（RLS 限定本人）
 *
 * 用户名怎么变成邮箱：Supabase 只认邮箱，所以内部把「阿远」拼成
 * 阿远@zbx.example.com 当账号标识（域名见 supabase-config.js 的 emailDomain）。
 * 界面、数据、进度键名都还是用户名，用户完全无感。
 *
 * 为了不改动别处的代码，这里保留旧的 rpc() 入口：
 *   zbx_signup / zbx_signin / zbx_session / zbx_signout
 *   zbx_progress_load / zbx_progress_save
 *   zbx_public_docs / zbx_admin_all_docs / zbx_admin_save_docs / zbx_admin_delete_doc
 * 全部转到 Supabase 实现；不认识的 RPC 名直接报错，不再回退旧云服务
 * （旧网关已下线，悄悄回退只会让人以为保存成功）。
 *
 * 对外暴露：
 *   window.ZBX_ACCOUNT        账号对象
 *   window.ZBX_ACCOUNT_READY  Promise<account>，会话恢复完成后 resolve
 *   document 'zbx:account'    登录、退出、角色变化时触发
 */
(function () {
    'use strict';

    if (window.ZBX_ACCOUNT) { return; }

    var CACHE_KEY = 'zbx.account.cache';
    var STYLE_ID = 'zbx-account-style';
    var USER_RE = /^[一-龥A-Za-z0-9_-]{2,20}$/;
    var DEFAULT_DOMAIN = 'zbx.example.com';

    var state = {
        uid: '',
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

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

    /* ---------- 配置 ---------- */

    /* 配置是懒加载的：先确保 supabase-config.js 到位，否则页面刚打开那几百毫秒
       会把「还没加载」误判成「没填配置」，已登录用户会瞬间显示成未登录。 */
    var cfgLoaded = false;
    var configPromise = null;

    /* 进站就先取配置会给每页多加一个请求；访客用不到，改成谁需要谁调用 */
    function configReady() {
        if (configPromise) { return configPromise; }
        configPromise = new Promise(function (resolve) {
            if (window.ZBX_SUPABASE && window.ZBX_SUPABASE.url) {
                cfgLoaded = true;
                resolve();
                return;
            }
            var s = document.createElement('script');
            s.src = base() + 'assets/supabase-config.js';
            s.async = true;
            s.onload = function () { cfgLoaded = true; resolve(); };
            s.onerror = function () { cfgLoaded = true; resolve(); };
            document.head.appendChild(s);
            setTimeout(resolve, 3000);
        });
        return configPromise;
    }

    function configured() {
        var cfg = window.ZBX_SUPABASE;
        return !!(cfg && cfg.url && cfg.anonKey);
    }

    /* ---------- 客户端 ---------- */

    function client() {
        /* ZBX_SB_GET 每次失败都不缓存，网络恢复后再调用一次就能接上；
           ZBX_SB_READY 是旧接口，只作为兜底。 */
        if (window.ZBX_SB_GET) { return window.ZBX_SB_GET(); }
        if (window.ZBX_SB_READY) { return window.ZBX_SB_READY; }
        if (!window.__zbxSbLoad && !window.__zbxSbLoaded) {
            window.__zbxSbLoad = true;
            var s = document.createElement('script');
            s.src = base() + 'assets/supabase-client.js';
            s.async = true;
            document.head.appendChild(s);
        }
        return new Promise(function (resolve, reject) {
            var waited = 0;
            (function poll() {
                if (window.ZBX_SB_READY) { resolve(window.ZBX_SB_READY); return; }
                if (waited++ > 300) {
                    reject(new Error('云服务加载超时，请刷新重试'));
                    return;
                }
                setTimeout(poll, 100);
            })();
        });
    }

    function domain() {
        var cfg = window.ZBX_SUPABASE;
        return (cfg && cfg.emailDomain) || DEFAULT_DOMAIN;
    }

    /* 用户名 → 合成邮箱（内部账号标识，不发信）
     *
     * Supabase 的邮箱校验不认非 ASCII：直接拼「本站验收@zbx.example.com」会被
     * 判成 invalid format。所以纯 ASCII 用户名原样（转小写，与不分大小写的
     * 唯一索引一致），含中文等字符的把 UTF-8 字节转成十六进制，加 u- 前缀：
     *   阿远  →  u-e998bfe8bf9c@zbx.example.com
     * 这个映射是确定且可逆的，同一个用户名永远得到同一个邮箱。 */
    function emailLocal(user) {
        var name = String(user || '').trim();
        if (!name) { return ''; }
        /* 只有「字母/数字开头，且只含字母数字下划线短横」才原样用；
           其余一律转十六进制，免得碰上邮件本地部分的边角规则。 */
        if (/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name) && !/^u-/i.test(name)) {
            return name.toLowerCase();
        }
        var bin = encodeURIComponent(name).replace(/%([0-9A-F]{2})/g, function (_, h) {
            return String.fromCharCode(parseInt(h, 16));
        });
        var out = '';
        for (var i = 0; i < bin.length; i++) {
            out += ('0' + bin.charCodeAt(i).toString(16)).slice(-2);
        }
        return 'u-' + out;
    }

    /* 反向还原（仅在注册元数据丢失、只能从邮箱读用户名时用） */
    function localToName(local) {
        if (!/^u-[0-9a-f]+$/i.test(local)) { return local; }
        var hex = local.slice(2);
        var pct = '';
        for (var i = 0; i < hex.length; i += 2) {
            pct += '%' + hex.substr(i, 2);
        }
        try { return decodeURIComponent(pct); } catch (e) { return local; }
    }

    function emailOf(user) {
        return emailLocal(user) + '@' + domain();
    }

    /* 合成邮箱 / 元数据 → 用户名 */
    function usernameOf(sbUser) {
        if (!sbUser) { return ''; }
        var meta = sbUser.user_metadata || {};
        if (meta.username) { return String(meta.username); }
        return localToName(String(sbUser.email || '').split('@')[0]);
    }

    function mapErr(err) {
        var msg = String((err && err.message) || err || '操作失败');
        var map = {
            'Invalid login credentials': '用户名或密码不对。',
            'User already registered': '这个用户名已经被注册，换个名字或去登录。',
            'Email not confirmed': '账号还需邮箱确认：请在 Supabase 后台关闭 Confirm email。',
            'Signups not allowed for this instance': '项目关闭了注册：请在 Supabase Authentication 里开启 Allow new users to sign up。',
            'Failed to fetch': '连不上 Supabase：检查网络，或核对 assets/supabase-config.js 里的 url。',
            'Load failed': '连不上 Supabase：检查网络，或核对 assets/supabase-config.js 里的 url。'
        };
        if (map[msg]) { return new Error(map[msg]); }
        if (/failed to fetch|network\s?error|network request failed|load failed/i.test(msg)) {
            return new Error('连不上 Supabase：检查网络，或核对 assets/supabase-config.js 里的 url。');
        }
        if (/timed?\s?out|timeout|abort/i.test(msg)) {
            return new Error('连接 Supabase 超时，请稍后重试。');
        }
        if (/duplicate key|unique/i.test(msg)) { return new Error('这个用户名已经被注册，换个名字或去登录。'); }
        if (/relation .* does not exist|schema cache/i.test(msg)) {
            return new Error('数据库表还没建好，请先在 Supabase SQL Editor 里执行 supabase/schema.sql。');
        }
        return new Error(msg);
    }

    /* ---------- 会话 ---------- */

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

    /* 档案表里的昵称与角色；表还不存在时退回注册元数据，不影响登录 */
    function loadProfile(sb) {
        if (!state.uid) { return Promise.resolve(); }
        return sb.from('profiles').select('username,nick,role').eq('id', state.uid).maybeSingle()
            .then(function (r) {
                if (r.error) { return; }
                var row = r.data;
                if (!row) { return; }
                if (row.username) { state.user = row.username; }
                if (row.nick) { state.nick = row.nick; }
                if (row.role) { state.role = row.role; }
            })
            .catch(function () { /* 网络抖动就先用缓存展示 */ });
    }

    function applySession(session, action) {
        if (!session || !session.user) {
            throw new Error('登录失败，没拿到会话');
        }
        state.uid = session.user.id;
        state.token = session.access_token || '';
        state.user = usernameOf(session.user);
        state.nick = (session.user.user_metadata && session.user.user_metadata.nick) || state.user;
        state.role = 'user';

        return client().then(function (sb) {
            return loadProfile(sb);
        }).then(function () {
            writeCache();
            closePanel();
            render();
            bindAuthEvents().catch(function () { /* 配置错误在点登录时才提示 */ });
            emit(action);
            return sessionInfo();
        });
    }

    function wait(ms) {
        return new Promise(function (resolve) { window.setTimeout(resolve, ms); });
    }

    /* localStorage 里是否还留着 supabase 的会话（用来判断「本来登录过」） */
    function hasStoredToken() {
        try {
            for (var i = 0; i < window.localStorage.length; i++) {
                var k = window.localStorage.key(i);
                if (k && /^sb-.*-auth-token/.test(k)) { return true; }
            }
        } catch (e) { /* 隐私模式下忽略 */ }
        return false;
    }

    /* 取会话。本地明明有会话痕迹却拿不到时，显式续期再试几次：
       supabase 的 getSession 在续期请求抖动时会返回 null，一次抖动就把人
       踢成「未登录」，这是刷新后掉登录的主因。 */
    function getStoredSession(allowRetry, tries) {
        tries = tries || 1;
        return client().then(function (sb) {
            return sb.auth.getSession().then(function (r) {
                var session = r && r.data ? r.data.session : null;
                if (session) { return session; }
                if (!allowRetry || tries >= 3) { return null; }
                return wait(400 * tries).then(function () {
                    return sb.auth.refreshSession().then(function (rr) {
                        var next = rr && rr.data ? rr.data.session : null;
                        if (next) { return next; }
                        return getStoredSession(true, tries + 1);
                    }, function () {
                        return getStoredSession(true, tries + 1);
                    });
                });
            });
        });
    }

    /* 启动时网络失败：先按缓存显示，后台慢慢再试，连上就补一次 restore */
    function retryRestore(n) {
        if (n > 3 || state.uid || !configured()) { return; }
        window.setTimeout(function () {
            if (state.uid || !configured()) { return; }
            getStoredSession(true).then(function (session) {
                if (!session) { retryRestore(n + 1); return null; }
                return applySession(session, 'restore').catch(function () { retryRestore(n + 1); });
            }, function () {
                retryRestore(n + 1);
            });
        }, 1200 * (n + 1));
    }

    function restore() {
        var cached = readCache();
        if (cached.user) {
            state.user = cached.user;
            state.role = cached.role || 'user';
            state.nick = cached.nick || cached.user;
            render();
        }

        /* 本机既没有缓存账号，也没有 supabase 会话痕迹 = 访客。
           连配置文件都不必取，更不为一个「未登录」去下载并初始化
           100KB+ 的 SDK：等用户真的点开登录框时，client() 会按需加载。 */
        if (!cached.user && !hasStoredToken()) {
            state.ready = true;
            render();
            return Promise.resolve(sessionInfo());
        }

        return configReady().then(function () {
            if (!configured()) {
                /* 还没填配置：保持未登录外观，点登录会给明确提示 */
                state.ready = true;
                render();
                return sessionInfo();
            }
            return getStoredSession(true).then(function (session) {
                if (!session) {
                    clearLocal();
                    state.ready = true;
                    render();
                    return sessionInfo();
                }
                return applySession(session, 'restore').then(function (info) {
                    state.ready = true;
                    return info;
                });
            });
        }).catch(function () {
            /* 网络失败时保留缓存展示，后台继续尝试恢复会话 */
            state.ready = true;
            render();
            retryRestore(0);
            return sessionInfo();
        });
    }

    function clearLocal() {
        state.uid = '';
        state.token = '';
        state.user = '';
        state.role = '';
        state.nick = '';
        try { window.localStorage.removeItem(CACHE_KEY); } catch (e) { /* 忽略 */ }
    }

    function login(user, pw) {
        if (state.busy) { return Promise.reject(new Error('处理中…')); }
        var name = String(user || '').trim();
        if (!name || !pw) { return Promise.reject(new Error('用户名和密码必填。')); }
        state.busy = true;
        return client().then(function (sb) {
            return sb.auth.signInWithPassword({ email: emailOf(name), password: String(pw) });
        }).then(function (r) {
            if (r.error) { throw mapErr(r.error); }
            return applySession(r.data.session, 'login');
        }).catch(function (err) {
            throw (err instanceof Error) ? err : mapErr(err);
        }).finally(function () { state.busy = false; });
    }

    function signup(user, pw, nick) {
        if (state.busy) { return Promise.reject(new Error('处理中…')); }
        var name = String(user || '').trim();
        var pass = String(pw || '');
        if (!name) { return Promise.reject(new Error('用户名必填。')); }
        if (pass.length < 6) { return Promise.reject(new Error('密码至少 6 位。')); }

        state.busy = true;
        var sbRef = null;
        return client().then(function (sb) {
            sbRef = sb;
            /* 先查重名，能给出人话提示，而不是数据库 500 */
            return sb.rpc('zbx_username_taken', { p_username: name });
        }).then(function (r) {
            if (r && !r.error && r.data === true) {
                throw new Error('这个用户名已经被注册，换个名字或去登录。');
            }
            return sbRef.auth.signUp({
                email: emailOf(name),
                password: pass,
                options: { data: { username: name, nick: String(nick || '').trim() || name } }
            });
        }).then(function (r) {
            if (r.error) { throw mapErr(r.error); }
            var session = r.data && r.data.session;
            var sbUser = r.data && r.data.user;
            if (!session) {
                /* 邮箱确认没关：注册成功但拿不到会话，登录不了 */
                if (sbUser && Array.isArray(sbUser.identities) && sbUser.identities.length === 0) {
                    throw new Error('这个用户名已经被注册，换个名字或去登录。');
                }
                throw new Error('注册已提交，但项目开着邮箱确认，本站合成邮箱收不到信。' +
                    '请在 Supabase → Authentication → Sign In / Providers → Email 关闭 Confirm email 后重试。');
            }
            return applySession(session, 'signup');
        }).catch(function (err) {
            throw (err instanceof Error) ? err : mapErr(err);
        }).finally(function () { state.busy = false; });
    }

    function logout() {
        clearLocal();
        render();
        emit('logout');
        if (!configured()) { return Promise.resolve(true); }
        return client().then(function (sb) {
            /* 网络不通时普通的 signOut 不会清掉本地会话，刷新后又被自动登录；
               失败就退回 scope=local，至少本机是真退出了。 */
            return sb.auth.signOut().catch(function () {
                return sb.auth.signOut({ scope: 'local' }).catch(function () { /* 忽略 */ });
            });
        }).then(function () { return true; })
            .catch(function () { return false; });
    }

    function sessionInfo() {
        return {
            uid: state.uid,
            user: state.user,
            nick: state.nick || state.user,
            role: state.role,
            isAdmin: state.role === 'admin',
            token: state.token,
            ready: state.ready
        };
    }

    /* ---------- 旧 RPC 兼容层 ---------- */

    function currentUid() {
        return state.uid;
    }

    function loadProgress() {
        if (!currentUid()) { return Promise.resolve({ ok: true, data: null }); }
        return client().then(function (sb) {
            return sb.from('user_progress').select('data').eq('user_id', currentUid()).maybeSingle();
        }).then(function (r) {
            if (r.error) { throw mapErr(r.error); }
            return { ok: true, data: (r.data && r.data.data) || null };
        });
    }

    function saveProgress(data) {
        if (!currentUid()) { return Promise.resolve({ ok: false, err: 'not signed in' }); }
        return client().then(function (sb) {
            return sb.from('user_progress').upsert({
                user_id: currentUid(),
                data: data || {},
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id' });
        }).then(function (r) {
            if (r.error) {
                var e = mapErr(r.error);
                return { ok: false, err: e.message };
            }
            return { ok: true };
        });
    }

    /* ---------- 杂豫内容与后台 ---------- */

    function docErr(r) {
        if (r && r.error) {
            var e = mapErr(r.error);
            if (r.error.code === '42501' || /row-level security|permission denied/i.test(String(r.error.message))) {
                return '没有写入权限：当前账号不是管理员（profiles.role 需为 admin）。';
            }
            return e.message;
        }
        return '';
    }

    /* 公开读：站点正文，未登录也能读 */
    function publicDocs(kind) {
        return client().then(function (sb) {
            var q = sb.from('zayu_docs').select('kind,doc_id,data,ord');
            if (kind) { q = q.eq('kind', kind); }
            return q.order('ord', { ascending: true }).order('doc_id', { ascending: true });
        }).then(function (r) {
            if (r.error) { throw mapErr(r.error); }
            return { ok: true, rows: r.data || [] };
        });
    }

    /* 后台：读全部（含未公开的草稿类） */
    function adminAllDocs() {
        return client().then(function (sb) {
            return sb.from('zayu_docs').select('kind,doc_id,data,ord')
                .order('kind').order('ord').order('doc_id');
        }).then(function (r) {
            if (r.error) { return { ok: false, err: docErr(r) || '读取失败' }; }
            return { ok: true, rows: r.data || [] };
        });
    }

    /* 后台：批量写入（一条条 upsert，同 kind+doc_id 覆盖） */
    function adminSaveDocs(kind, rows) {
        if (!kind || !Array.isArray(rows) || !rows.length) { return Promise.resolve({ ok: true }); }
        var now = new Date().toISOString();
        var payload = rows.map(function (row) {
            return {
                kind: String(kind),
                doc_id: String(row && row.doc_id != null ? row.doc_id : ''),
                data: (row && row.data) || {},
                ord: Number(row && row.ord != null ? row.ord : 0) || 0,
                updated_at: now
            };
        }).filter(function (row) { return row.doc_id !== ''; });

        if (!payload.length) { return Promise.resolve({ ok: false, err: '没有有效的 doc_id' }); }

        return client().then(function (sb) {
            return sb.from('zayu_docs').upsert(payload, { onConflict: 'kind,doc_id' });
        }).then(function (r) {
            if (r.error) { return { ok: false, err: docErr(r) || '保存失败' }; }
            return { ok: true };
        });
    }

    /* 后台：删除一条 */
    function adminDeleteDoc(kind, docId) {
        return client().then(function (sb) {
            return sb.from('zayu_docs').delete().eq('kind', String(kind)).eq('doc_id', String(docId));
        }).then(function (r) {
            if (r.error) { return { ok: false, err: docErr(r) || '删除失败' }; }
            return { ok: true };
        });
    }

    /* 等级分重算：WHR 全历史拟合算法在 tools/recompute_ratings.py（Python），
       旧云服务里那份 PL/pgSQL 实现没有随仓库留存，硬写会算错分，所以这里明确报错，
       宁可让管理员看到提示，也不要悄悄把分数改坏。 */
    function recalcRatings() {
        return Promise.resolve({
            ok: false,
            err: '等级分重算还没迁到 Supabase。请在本地运行 python tools/recompute_ratings.py，' +
                '再用后台「保存修改」写回 rating 文档。'
        });
    }

    function rpc(name, params) {
        params = params || {};
        switch (name) {
            case 'zbx_signup':
                return signup(params.p_user, params.p_pw, params.p_nick);
            case 'zbx_signin':
                return login(params.p_user, params.p_pw);
            case 'zbx_signout':
                return logout().then(function () { return { ok: true }; });
            case 'zbx_session':
                return Promise.resolve({
                    ok: !!state.user,
                    user: state.user,
                    nick: state.nick || state.user,
                    role: state.role,
                    token: state.token
                });
            case 'zbx_progress_load':
                return loadProgress();
            case 'zbx_progress_save':
                return saveProgress(params.p_data);
            case 'zbx_public_docs':
                return publicDocs(params.p_kind);
            case 'zbx_admin_all_docs':
                return adminAllDocs();
            case 'zbx_admin_save_docs':
                return adminSaveDocs(params.p_kind, params.p_rows);
            case 'zbx_admin_delete_doc':
                return adminDeleteDoc(params.p_kind, params.p_doc_id);
            case 'zbx_admin_recalc_ratings':
                return recalcRatings();
            default:
                return Promise.reject(new Error('未知接口：' + name + '（旧云服务已下线）'));
        }
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
            '.za-note{margin-top:8px;font-size:11px;color:#9c8b70}' +
            '@media(prefers-color-scheme:dark){' +
            '.za-menu,.za-dialog{background:#242019;color:#efe4cd;border-color:#5c4e3c}' +
            '.za-menu a,.za-menu button,.za-field input,.za-tabs button{color:#efe4cd;background:transparent;border-color:#5c4e3c}' +
            '.za-field input{background:#17150f}.za-menu-name{color:#b6a688;border-color:#5c4e3c}' +
            '.za-dialog p,.za-field span,.za-note{color:#b6a688}' +
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
        drawPanel(cfgLoaded && !configured()
            ? '尚未配置 Supabase：请打开 assets/supabase-config.js 填入 url 与 anonKey。'
            : '');
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
            '<p>进度存于云端，登录后任意设备接着用。</p>' +
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
            '" minlength="6" maxlength="64" placeholder="至少 6 位" required></label>' +
            '<button type="submit" class="za-submit"' + (state.busy ? ' disabled' : '') + '>' +
            (isSignup ? '注册并登录' : '登录') + '</button>' +
            '<div class="za-err" role="alert">' + esc(msg || '') + '</div>' +
            '<div class="za-note">只用用户名和密码，不需要邮箱验证。</div>' +
            '</form></div>';
    }

    function errText(err) {
        var s = String((err && err.message) || err || '操作失败');
        if (s === 'bad credentials') { return '用户名或密码不对。'; }
        if (s === 'invalid username') { return '用户名 2–20 位，可用中文、字母、数字、下划线或短横。'; }
        if (s === 'invalid password') { return '密码需 6–64 位。'; }
        if (s === 'username taken') { return '这个用户名已经被注册，换个名字或去登录。'; }
        return s;
    }

    document.addEventListener('click', function (e) {
        /* 点遮罩空白处关闭（先判遮罩，否则会被下面的 data-za 查找拦掉） */
        if (e.target && e.target.id === 'zbx-account-mask') {
            closePanel();
            return;
        }
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
            drawPanel('');
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
            if (window.confirm('退出登录？本机进度会保留，下次登录从云端恢复。')) {
                logout().catch(function () {});
            }
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
            drawPanel('用户名 2–20 位，可用中文、字母、数字、下划线或短横。');
            return;
        }
        if (state.panel === 'signup' && pw.length < 6) {
            drawPanel('密码至少 6 位。');
            return;
        }
        if (state.busy) { return; }  /* 已有请求在处理，忽略重复提交 */
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

    /* 会话自动续期 / 被踢下线 / 别的标签页登录时同步本地状态 */
    var authBound = false;

    function bindAuthEvents() {
        if (authBound) { return Promise.resolve(); }
        return client().then(function (sb) {
            /* 客户端真的建起来才算绑定成功，失败下次登录还能再试 */
            if (authBound) { return; }
            authBound = true;
            sb.auth.onAuthStateChange(function (event, session) {
                /* 回调里直接再调 supabase 会去抢同一把锁，容易卡住；
                   统一挪到下一轮事件循环再处理。 */
                window.setTimeout(function () {
                    if (session && session.user) {
                        if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' ||
                            event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
                            if (!state.uid || state.uid !== session.user.id) {
                                /* 首次恢复，或另一个标签页换了账号：走完整流程 */
                                applySession(session, state.ready ? 'login' : 'restore')
                                    .catch(function () { /* 档案读不到不影响登录态 */ });
                            } else {
                                state.token = session.access_token || state.token;
                            }
                        }
                        return;
                    }
                    if (event === 'SIGNED_OUT' && state.user) {
                        clearLocal();
                        state.ready = true;
                        render();
                        emit('logout');
                    }
                }, 0);
            });
        });
    }

    /* 会话续期监听只在确实登录后才有意义，放在 applySession 里绑定 */

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
        uid: function () { return state.uid; },
        /* 云端是否可读写：有会话才成立。进度模块用它判断现在能不能同步，
           避免刚刷新页面那几百毫秒把本地数据当成「未登录」丢掉。 */
        canSync: function () { return !!(state.uid && state.token); },
        info: sessionInfo,
        login: login,
        signup: signup,
        logout: logout,
        openPanel: openPanel,
        closePanel: closePanel,
        render: render,
        configured: configured,
        validName: function (n) { return USER_RE.test(String(n || '').trim()); }
    };
})();
