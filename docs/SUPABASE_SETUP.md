# 用 Supabase 接账号登录 + 存用户数据

这份文档对应站上已经改好的代码。你只要按顺序做完 **4 件事**，右上角的「登录 / 注册」就变成 Supabase 在管了。

改动的文件（已经在仓库里，不需要你再动）：

| 文件 | 作用 |
| --- | --- |
| `assets/supabase-config.js` | **唯一需要你填的文件**：Project URL + anon key |
| `assets/supabase-client.js` | 从 CDN 加载 supabase-js，建单例客户端 |
| `assets/account.js` | 登录 / 注册 / 会话 / 进度，全部改走 Supabase（界面没变） |
| `supabase/schema.sql` | 建表 + 权限，在 Supabase 控制台执行一次 |

`progress.js`、`english-app.js`、660 个页面**一行都没改**——账号对象的对外方法（`user()` / `login()` / `rpc()` …）完全保留，所以背词进度、换设备恢复这些照旧工作。

---

## 第 1 步：建项目（约 3 分钟）

1. 打开 <https://supabase.com> → 右上角 **Start your project**，用 GitHub 账号登录最省事。
2. **New project**：
   - **Name**：随便，例如 `renjubox`
   - **Database Password**：点 Generate 生成，**复制存下来**（连数据库时才用，站点不用它）
   - **Region**：选 **Southeast Asia (Singapore)** 或 **Northeast Asia (Tokyo)**，国内访问延迟低
   - Plan 选 **Free**
3. 点 **Create new project**，等 1～2 分钟初始化。

## 第 2 步：建表（约 1 分钟）

1. 左侧栏 → **SQL Editor** → **New query**。
2. 打开仓库里的 `supabase/schema.sql`，**整段复制**粘贴进去。
3. 右下角 **Run**（或 Ctrl+Enter）。看到 `Success. No rows returned` 就对了。

它会建好：

- `profiles` —— 用户名、昵称、角色
- `user_progress` —— 每个账号的进度 JSON（背词、四项分数、阅读记录）
- `zayu_docs` —— 杂豫的正文内容（比赛 / 棋谱 / 人物 / 等级分），所有人可读、仅管理员可写
- `site_visits` —— 访问埋点，访客未登录也能写，只有管理员能读
- 两个触发器：注册时自动建档；普通用户改不了自己的角色（防提权）
- 函数 `zbx_username_taken()` —— 注册前查重名；`zbx_is_admin()` —— 后台写权限判定
- 函数 `zbx_admin_accounts()` —— 后台「账号」页列出全站账号（函数内部判管理员，普通账号调不动）
- 表级授权（GRANT）—— RLS 管「能碰哪一行」，GRANT 管「能不能碰这张表」，缺了会报 permission denied
- 所有表都开了 RLS

> 脚本是幂等的，重复执行不会报错也不会清数据，放心重跑。
>
> 已经建过表、只想补「后台看账号」这一项：执行 `supabase/accounts.sql` 即可（内容和 `schema.sql` 第 11 节一致）。

## 第 3 步：关掉邮箱验证（关键，很多人卡在这）

站点用的是「用户名 + 密码」，但 Supabase 只认邮箱，所以内部把用户名拼成 `xxx@zbx.example.com` 当账号标识。这个假邮箱收不到信，**邮箱确认必须关掉**，否则注册完登不进去。

用户名怎么变成邮箱前缀（Supabase 不认中文，所以中文要被编码）：

| 用户名 | 内部邮箱 |
| --- | --- |
| `renju` | `renju@zbx.example.com`（纯字母数字原样，转小写） |
| `阿远` | `u-e998bfe8bf9c@zbx.example.com`（UTF-8 字节转十六进制） |
| `本站验收` | `u-e69cace7ab99e9aa8ce694b6@zbx.example.com` |

所以你在 **Authentication → Users** 里会看到一串 `u-xxxx` 的邮箱 —— 这是正常的，**真实用户名看 `profiles` 表的 `username` 列**。这个映射是确定且可逆的，同一个用户名永远得到同一个邮箱，用户完全无感。

1. 左侧栏 → **Authentication**
2. → **Sign In / Providers**（旧版界面叫 **Providers**）→ 展开 **Email**
3. 把 **Confirm email** 关掉（Toggle off），**Save**

顺手确认这两项：

- **Allow new users to sign up** —— 要打开（否则注册报 "Signups not allowed"）
- **Minimum password length** —— 默认 6，和界面提示「至少 6 位」一致，不用改

## 第 4 步：填配置（1 分钟）

1. 左侧栏最下面 **Project Settings**（齿轮）→ **API**
2. 复制两个值：
   - **Project URL** → 形如 `https://abcdefghijklmnop.supabase.co`
   - **Project API keys** 里的 **anon / public** → 很长一串 `eyJ...`
3. 打开 `assets/supabase-config.js`，填进去：

```js
window.ZBX_SUPABASE = {
    url: 'https://abcdefghijklmnop.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9....（很长，整串复制）',
    emailDomain: 'zbx.example.com'
};
```

4. 保存 → 刷新站点 → 右上角点「登录 / 注册」→ 注册一个账号试试。

> `emailDomain` 一旦上线就**别改**，改了等于换了账号体系，老账号全部找不到。

---

## 验证清单

按顺序点一遍，五项全过就是通了：

1. **注册**：右上角 → 注册 → 用户名 `测试`、密码 `abc123` → 提示成功，右上角变成「测试 ▾」
2. **有数据**：Supabase → **Table Editor** → `profiles` 里能看到一行，`user_progress` 里能看到一行 `data`
3. **刷新不掉线**：F5，右上角还是「测试 ▾」
4. **进度能存**：进 <https://renjupgc.github.io/zaji/english.html> 背两个词 → 回 `user_progress` 表看 `data` 变大了
5. **换设备能取**：换浏览器 / 无痕窗口登录同一个账号 → 背词进度还在

第 4、5 项是这次改造的真正目的：**用户数据跟着账号走，不跟着浏览器走。**

---

## 怎么设管理员

`admin/zayu.html` 后台靠 `profiles.role = 'admin'` 判断。设管理员用 SQL（前端改不了，这是故意的）：

```sql
update public.profiles set role = 'admin' where username = '你的用户名';
```

设完让那人重新登录（或刷新页面），导航栏会出现「管理」标记和管理后台入口。

---

## 各模块现在用什么

| 模块 | 后端 | 说明 |
| --- | --- | --- |
| 账号 / 登录 / 会话 | Supabase Auth | `assets/account.js` |
| 进度（背词、四项分数） | `user_progress` | 换设备自动恢复 |
| 杂豫正文（比赛/棋谱/人物/等级分） | `zayu_docs` | 公开可读，管理员可写；空表时自动退回静态 HTML |
| 管理后台读写 | `zayu_docs` | `admin/zayu.html`，靠 `profiles.role` 判权 |
| 访问埋点 | `site_visits` | 匿名可写、管理员可读 |
| 末轮计算器的成绩单识别 | **仍是 WorkBuddy 云服务** | 用它的大模型；只在 `zaji/molun.html` 按需加载 `assets/cloud.js`，其它页面不再加载 |

### 两个已知缺口

1. **等级分重算**：后台那个「按尚未更新的对局重算等级分」按钮现在会明确报错。WHR 全历史拟合的算法在 `tools/recompute_ratings.py`（Python）里，旧云服务那份 PL/pgSQL 实现没随仓库留存，硬写会算错分。正确做法：本机跑 `python tools/recompute_ratings.py`，再把 `rating` 文档用后台「保存修改」写回。
2. **成绩单 OCR**：`cloud.js` 还留着，只为这一页的大模型能力。要去掉它得另接一个视觉模型接口（需要服务端代理放密钥），属于独立改造。

---

## 常见报错对照

| 界面提示 | 原因 | 怎么办 |
| --- | --- | --- |
| 尚未配置 Supabase | `supabase-config.js` 里 url / anonKey 还是空的 | 回第 4 步 |
| 连不上 Supabase | URL 填错，或网络被挡 | 检查 url 是否以 `.supabase.co` 结尾且没多余空格 |
| 数据库表还没建好 | 第 2 步 SQL 没跑 | 回第 2 步，整段重跑 |
| permission denied for table profiles / user_progress | 表建了但没授权（RLS 之外还需要 GRANT） | 回第 2 步整段重跑；或单独执行 `supabase/schema.sql` 第 6 节那几行 GRANT |
| 注册信息已提交，但项目还开着「邮箱确认」 | 第 3 步没关 Confirm email | 回第 3 步 |
| 这个用户名已经被注册 | 重名（不分大小写） | 换名字或直接登录 |
| 用户名或密码不对 | 密码错，或这账号是旧云服务时代注册的 | 旧账号迁不过来，重新注册（见下） |
| 一直转圈 | CDN 被墙 | 换网络；代码已备 jsdelivr → unpkg 自动降级 |

---

## 老账号怎么办

旧账号的密码哈希在旧云服务里，**拿不出来**，所以老用户需要重新注册一次。

好消息是**进度不会丢**：本机 `localStorage` 里还留着那份进度，用**相同的用户名**注册后首次登录，代码发现云端没有档案，会自动把本机记录推上去（`progress.js` 的 `loadCloud()` 逻辑）。所以对老用户只有一句话：**用原来的用户名重新注册，分数还在。**

---

## 三条安全红线

1. **绝不要把 `service_role` key 写进 `supabase-config.js`。** 它是万能钥匙，会随 GitHub Pages 公开给所有人。前端只用 `anon` key。
2. **RLS 不要关。** 两张表的策略就是「只能碰自己那行」，关掉等于全站数据裸奔。
3. 数据库密码、service_role key 只放在你自己电脑的密码管理器里，不进仓库。

---

## 以后想加功能

- 加字段（比如头像）：`alter table public.profiles add column avatar_url text;`，前端读 `profiles` 即可。
- 加一张新表：建表 → `enable row level security` → 写 policy → 前端 `client.from('表名')`。
- 想上 OAuth（GitHub / 微信登录）：Authentication → Providers 里开，前端调 `client.auth.signInWithOAuth()`，此时 `emailDomain` 那套就不用了。

## 免费版的现实限制

- **7 天没有任何请求，项目会被自动暂停**（Paused）。站点有人访问就不会暂停；真被暂停了，去控制台点 **Restore project** 就能唤醒，数据不丢。
- 数据库 500 MB、每月 5 GB 流量，对这个站绰绰有余。
- 想稳妥不被暂停：把站点加个每日定时任务，或升级到 Pro。也可以让 WorkBuddy 帮你建个每天访问一次的健康检查自动化。
