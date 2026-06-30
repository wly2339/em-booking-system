# 电镜预约系统

用于电镜预约。一个面向 Cloudflare Pages + Supabase 的静态电镜预约系统。前端不需要构建，Supabase 提供登录、数据库、权限控制和预约冲突校验。

## 功能

- 邮箱注册 / 登录 / 退出
- 个人资料维护：姓名、课题组、手机号
- 电镜列表与状态展示
- 按设备和日期查看预约
- 提交预约申请
- 用户查看和取消自己的预约
- 管理员审批、拒绝预约
- Supabase Row Level Security 权限隔离

## 本地配置

1. 在 Supabase 新建项目。
2. 打开 Supabase SQL Editor，执行 `supabase/schema.sql`。
3. 复制配置文件：

```powershell
Copy-Item public/config.example.js public/config.js
```

4. 将 `public/config.js` 中的 `supabaseUrl` 和 `supabaseAnonKey` 改成你的项目配置。
5. 本地预览：

```powershell
npm.cmd run dev
```

如果你的终端允许执行 npm 脚本，也可以使用 `npm run dev`。服务地址为 `http://127.0.0.1:4173`。

首次注册后，如需设置超级管理员，在 Supabase SQL Editor 执行：

```sql
update public.profiles set role = 'super_admin' where email = 'your-email@example.com';
```

## Cloudflare Pages 部署

- Framework preset: `None`
- Build command: `npm run build`
- Build output directory: `public`

在 Cloudflare Pages > Settings > Environment variables 中添加：

```text
SUPABASE_URL=https://yvsoovjbqntnuinjvilk.supabase.co
SUPABASE_ANON_KEY=你的 anon public key
```

部署时 `npm run build` 会根据这两个环境变量自动生成 `public/config.js`。`anon key` 是前端可公开使用的密钥，真正的权限由 Supabase RLS 控制；不要使用或提交 `service_role key`。

## Supabase 设置建议

- Authentication > Providers > Email：开启 Email。
- 开发阶段可关闭 Confirm email，正式部署建议开启邮件确认。
- Production URL 部署后，在 Authentication > URL Configuration 中加入 Cloudflare Pages 域名。
