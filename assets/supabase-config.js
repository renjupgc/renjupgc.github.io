/*
 * 连珠杂箱 · Supabase 配置
 * ------------------------------------------------------------
 * 全站只有这一个文件需要你填。填两行，刷新页面就生效。
 *
 * 取值位置：Supabase 控制台 → 左下齿轮 Project Settings → API
 *   url     = Project URL                 例如 https://abcdefghijkl.supabase.co
 *   anonKey = Project API keys 里的 anon / public 那一串（很长，eyJ 开头）
 *
 * 安全提醒：这里只能放 anon public key。它是设计上公开给浏览器用的，
 *           真正的权限由数据库的 RLS 策略把关。
 *           绝对不要把 service_role / secret key 写进这个文件——
 *           那是万能钥匙，会随 GitHub Pages 一起公开给所有人。
 *
 * emailDomain：站上登录只用「用户名 + 密码」，Supabase 需要邮箱格式，
 *              所以内部把用户名拼成 用户名@zbx.example.com 当账号标识。
 *              这只是内部标识，不会真的发信；example.com 是保留域名。
 *              一旦定下来不要再改，否则老账号会全部找不到。
 */
window.ZBX_SUPABASE = {
    url: '',
    anonKey: '',
    emailDomain: 'zbx.example.com'
};
