-- 从 CloudBase Auth 切换为应用后端自行认证。
-- 在 CloudBase PostgreSQL SQL 编辑器中，以数据库管理员身份执行一次。
-- 不会删除现有设备或预约数据。

create extension if not exists pgcrypto;

-- CloudBase Auth 不再维护 profiles；后端负责创建和更新用户资料。
drop trigger if exists on_auth_user_created on auth.users;

alter table public.profiles
  add column if not exists password_hash text,
  add column if not exists is_active boolean not null default true,
  add column if not exists last_login_at timestamptz;

-- 后端统一执行鉴权，浏览器不再通过 PostgREST 直接访问这些表。
alter table public.profiles disable row level security;
alter table public.microscopes disable row level security;
alter table public.bookings disable row level security;

create unique index if not exists profiles_email_unique
  on public.profiles (lower(email));

create index if not exists bookings_user_start_at_idx
  on public.bookings (user_id, start_at desc);

create index if not exists bookings_microscope_start_at_idx
  on public.bookings (microscope_id, start_at);

-- 首个超级管理员须在第一次注册后由管理员手工提升，示例：
-- update public.profiles set role = 'super_admin' where email = 'admin@example.com';
