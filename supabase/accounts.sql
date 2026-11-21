-- ============================================================
-- 连珠杂箱 · 管理员查看全部账号
-- ------------------------------------------------------------
-- 用法：Supabase 控制台 → 左侧 SQL Editor → New query →
--       把本文件整段粘贴进去 → Run（只需跑一次，幂等）。
--
-- 作用：给后台「账号」页提供只读接口 zbx_admin_accounts()。
--   函数是 security definer，执行前先判 public.zbx_is_admin()：
--   管理员拿到全站账号，普通登录用户调用直接报 no permission。
--   返回：用户名、昵称、角色、注册时间、最近登录、最近同步。
-- ============================================================

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

-- 只给登录用户调用权；函数内部的判定负责挡住非管理员
revoke all on function public.zbx_admin_accounts() from public;
grant execute on function public.zbx_admin_accounts() to authenticated;

-- 让 PostgREST 立刻认识这个函数，省得等 schema 缓存过期
notify pgrst, 'reload schema';
