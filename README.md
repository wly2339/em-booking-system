# 电镜预约系统

用于电镜预约。一个面向腾讯云 CloudBase for Supabase（PostgreSQL 模式）的静态电镜预约系统。前端不需要构建，CloudBase 提供登录、数据库、权限控制和预约冲突校验。

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

1. 在腾讯云 CloudBase 创建 PostgreSQL 模式环境，并启用“邮箱验证码”和“用户名密码”认证。
2. 打开 PostgreSQL SQL 编辑器，执行 `supabase/cloudbase-schema.sql`。
3. 复制配置文件：

```powershell
Copy-Item public/config.example.js public/config.js
```

4. 将 `public/config.js` 中的 `cloudbaseEnvId` 和 `cloudbasePublishableKey` 改成环境配置。
5. 本地预览：

```powershell
npm.cmd run dev
```

如果你的终端允许执行 npm 脚本，也可以使用 `npm run dev`。服务地址为 `http://127.0.0.1:4173`。

首次注册后，如需设置超级管理员，在 CloudBase SQL 编辑器执行：

```sql
update public.profiles set role = 'super_admin' where email = 'your-email@example.com';
```

## 静态网站部署

- Framework preset: `None`
- Build command: `npm run build`
- Build output directory: `public`

在部署平台的构建环境变量中添加：

```text
CLOUDBASE_ENV_ID=你的 CloudBase 环境 ID
CLOUDBASE_PUBLISHABLE_KEY=你的 Publishable Key
CLOUDBASE_REGION=ap-shanghai
```

部署时 `npm run build` 会根据这些环境变量自动生成 `public/config.js`。Publishable Key 可公开用于浏览器端；真正的权限由 CloudBase 的表级 GRANT 与 RLS 控制。不要使用或提交 API Key、管理员 key 或数据库密码。

## CloudBase 设置建议

- 身份认证 > 登录方式：开启“邮箱验证码”和“用户名密码”，保持“匿名登录”关闭。
- 部署正式域名后，在身份认证的登录态配置中加入正式域名。
