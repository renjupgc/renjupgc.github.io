-- ============================================================
-- 连珠杂箱 · Supabase 后端初始化
-- ------------------------------------------------------------
-- 用法：Supabase 控制台 → 左侧 SQL Editor → New query →
--       把本文件整段粘贴进去 → Run（只跑一次即可）
-- 特性：幂等，重复执行不会报错、不会清数据。
--
-- 建的东西：
--   public.profiles        账号档案（用户名 / 昵称 / 角色）
--   public.user_progress   每个账号的进度 JSON（背词、分数、阅读）
--   public.zayu_docs       杂豫内容（比赛 / 棋谱 / 人物 / 等级分），公开可读
--   public.site_visits     访问埋点，匿名可写、仅管理员可读
--   zbx_username_taken()   注册前查重名
--   zbx_is_admin()         后台写权限判定
--   两个触发器             注册自动建档案 / 禁止改自己的角色
-- 所有表都开了 RLS，并显式写了表级 GRANT（两者缺一不可）。
-- ============================================================


-- ---------- 1. 账号档案 ----------
create table if not exists public.profiles (
    id          uuid primary key references auth.users (id) on delete cascade,
    username    text not null,
    nick        text,
    role        text not null default 'user',
    created_at  timestamptz not null default now()
);

-- 用户名不分大小写唯一（Renju 与 renju 视为同一个）
create unique index if not exists profiles_username_lower_key
    on public.profiles (lower(username));

alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
    for select to authenticated
    using (auth.uid() = id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
    for insert to authenticated
    with check (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
    for update to authenticated
    using (auth.uid() = id)
    with check (auth.uid() = id);


-- ---------- 2. 防提权：前端改不了 role / username ----------
-- 说明：走 PostgREST 的普通登录用户（JWT 里 role=authenticated）改这两列会被
-- 静默还原；在 SQL Editor 里直接 UPDATE（auth.uid() 为空，role 不是 authenticated）
-- 不受影响，所以「设置管理员」照旧用 SQL 做，见 docs/SUPABASE_SETUP.md。
create or replace function public.zbx_profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_claim_role text;
begin
    v_claim_role := coalesce(
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
        ''
    );

    if v_claim_role = 'authenticated' then
        if new.role is distinct from old.role then
            new.role := old.role;
        end if;
        if new.username is distinct from old.username then
            new.username := old.username;
        end if;
    end if;

    new.id := old.id;
    return new;
end;
$$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard
    before update on public.profiles
    for each row execute function public.zbx_profiles_guard();


-- ---------- 3. 注册即建档 ----------
create or replace function public.zbx_on_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_username text;
    v_nick     text;
begin
    v_username := coalesce(
        nullif(new.raw_user_meta_data ->> 'username', ''),
        split_part(coalesce(new.email, ''), '@', 1)
    );
    v_nick := coalesce(nullif(new.raw_user_meta_data ->> 'nick', ''), v_username);

    insert into public.profiles (id, username, nick)
    values (new.id, v_username, v_nick)
    on conflict (id) do nothing;

    return new;
end;
$$;

drop trigger if exists zbx_on_auth_user_created on auth.users;
create trigger zbx_on_auth_user_created
    after insert on auth.users
    for each row execute function public.zbx_on_auth_user_created();


-- ---------- 4. 注册前查重名 ----------
-- 前端注册时先调这个，能给出「这个名字被占了」的明确提示，
-- 而不是让 Supabase 抛一个 500。
create or replace function public.zbx_username_taken(p_username text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
    select exists (
        select 1 from public.profiles
        where lower(username) = lower(btrim(coalesce(p_username, '')))
    );
$$;

revoke all on function public.zbx_username_taken(text) from public;
grant execute on function public.zbx_username_taken(text) to anon, authenticated;


-- ---------- 5. 用户进度（背词、分数、阅读） ----------
create table if not exists public.user_progress (
    user_id     uuid primary key references auth.users (id) on delete cascade,
    data        jsonb not null default '{}'::jsonb,
    updated_at  timestamptz not null default now()
);

alter table public.user_progress enable row level security;

drop policy if exists user_progress_select_own on public.user_progress;
create policy user_progress_select_own on public.user_progress
    for select to authenticated
    using (auth.uid() = user_id);

drop policy if exists user_progress_insert_own on public.user_progress;
create policy user_progress_insert_own on public.user_progress
    for insert to authenticated
    with check (auth.uid() = user_id);

drop policy if exists user_progress_update_own on public.user_progress;
create policy user_progress_update_own on public.user_progress
    for update to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);


-- ---------- 6. 管理员判定 ----------
-- 后台写权限统一走这个函数：profiles.role = 'admin' 才为真。
-- security definer 是为了绕开 profiles 的「只能读自己」策略。
create or replace function public.zbx_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.profiles
        where id = auth.uid() and role = 'admin'
    );
$$;

grant execute on function public.zbx_is_admin() to anon, authenticated;


-- ---------- 7. 杂豫内容（比赛 / 棋谱 / 人物 / 等级分） ----------
-- 取代旧的 zayu_docs：站点内容以这张表为准，静态 HTML 只是兜底。
-- kind: competition / qipu / person / person_page / rating
create table if not exists public.zayu_docs (
    kind        text not null,
    doc_id      text not null,
    data        jsonb not null default '{}'::jsonb,
    ord         integer not null default 0,
    updated_at  timestamptz not null default now(),
    primary key (kind, doc_id)
);

alter table public.zayu_docs enable row level security;

-- 所有访客都能读（这就是站点正文），只有管理员能写
drop policy if exists zayu_docs_select_all on public.zayu_docs;
create policy zayu_docs_select_all on public.zayu_docs
    for select to anon, authenticated
    using (true);

drop policy if exists zayu_docs_insert_admin on public.zayu_docs;
create policy zayu_docs_insert_admin on public.zayu_docs
    for insert to authenticated
    with check (public.zbx_is_admin());

drop policy if exists zayu_docs_update_admin on public.zayu_docs;
create policy zayu_docs_update_admin on public.zayu_docs
    for update to authenticated
    using (public.zbx_is_admin())
    with check (public.zbx_is_admin());

drop policy if exists zayu_docs_delete_admin on public.zayu_docs;
create policy zayu_docs_delete_admin on public.zayu_docs
    for delete to authenticated
    using (public.zbx_is_admin());


-- ---------- 8. 访问埋点 ----------
-- 访客不需要登录，所以 anon 也能写；读只给管理员。
create table if not exists public.site_visits (
    id          bigserial primary key,
    created_at  timestamptz not null default now(),
    visitor_id  text,
    session_id  text,
    page        text,
    kind        text,
    host        text,
    payload     jsonb
);

create index if not exists site_visits_created_at_idx on public.site_visits (created_at desc);

alter table public.site_visits enable row level security;

drop policy if exists site_visits_insert_any on public.site_visits;
create policy site_visits_insert_any on public.site_visits
    for insert to anon, authenticated
    with check (true);

drop policy if exists site_visits_select_admin on public.site_visits;
create policy site_visits_select_admin on public.site_visits
    for select to authenticated
    using (public.zbx_is_admin());


-- ---------- 9. 表级授权 ----------
-- RLS 管「能碰哪一行」，GRANT 管「能不能碰这张表」，两样都要。
-- 部分项目的默认权限没覆盖到，只开 RLS 不写 GRANT 会得到
-- 「permission denied for table profiles」（登录成功但读不到进度）。
grant usage on schema public to anon, authenticated;

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.user_progress to authenticated;

-- 杂豫内容：匿名只读，登录用户（配合 RLS 里的 zbx_is_admin）才写得动
grant select on public.zayu_docs to anon, authenticated;
grant insert, update, delete on public.zayu_docs to authenticated;

-- 访问埋点：匿名可写，读靠 RLS 限定管理员
grant insert on public.site_visits to anon, authenticated;
grant select on public.site_visits to authenticated;
grant usage, select on sequence public.site_visits_id_seq to anon, authenticated;


-- ---------- 10. 自检 ----------
-- 跑完可以执行下面两句确认结构就位：
--   select tablename, rowsecurity from pg_tables
--    where schemaname = 'public' and tablename in ('profiles', 'user_progress');
--   select tgname from pg_trigger where not tgisinternal;


-- ---------- 11. 管理员查看全部账号 ----------
-- 后台「账号」页用。security definer + 内部判 zbx_is_admin()：
-- 管理员能拿到全站账号，普通登录用户调用直接抛 no permission。
-- 单文件版本见 supabase/accounts.sql（只补这一段时跑那份即可）。
create or replace function public.zbx_admin_accounts()
returns table (
    id              uuid,
    username        text,
    nick            text,
    role            text,
    created_at      timestamptz,
    last_sign_in_at timestamptz,
    synced_at       timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.zbx_is_admin() then
        raise exception 'no permission' using errcode = '42501';
    end if;

    return query
        select u.id,
               coalesce(p.username, '')::text   as username,
               coalesce(p.nick, '')::text       as nick,
               coalesce(p.role, 'user')::text   as role,
               u.created_at,
               u.last_sign_in_at,
               pr.updated_at                    as synced_at
        from auth.users u
        left join public.profiles p        on p.id = u.id
        left join public.user_progress pr  on pr.user_id = u.id
        order by u.created_at desc nulls last;
end;
$$;

revoke all on function public.zbx_admin_accounts() from public;
grant execute on function public.zbx_admin_accounts() to authenticated;

notify pgrst, 'reload schema';
