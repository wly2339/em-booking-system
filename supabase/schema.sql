create extension if not exists btree_gist;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  lab text not null default '',
  phone text not null default '',
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.microscopes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  model text not null default '',
  location text not null default '',
  status text not null default 'available' check (status in ('available', 'maintenance', 'offline')),
  hourly_rate numeric(10, 2) not null default 0,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  microscope_id uuid not null references public.microscopes(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  purpose text not null default '',
  sample_type text not null default '',
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  operator_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at > start_at),
  constraint bookings_no_time_overlap exclude using gist (
    microscope_id with =,
    tstzrange(start_at, end_at, '[)') with &&
  ) where (status in ('pending', 'approved'))
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists bookings_set_updated_at on public.bookings;
create trigger bookings_set_updated_at
before update on public.bookings
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.microscopes enable row level security;
alter table public.bookings enable row level security;

create or replace function public.is_admin()
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

create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.role <> 'user' and not public.is_admin() then
    raise exception 'Only admins can create admin profiles.';
  end if;

  if tg_op = 'UPDATE' and old.role <> new.role and not public.is_admin() then
    raise exception 'Only admins can change profile roles.';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_protect_role on public.profiles;
create trigger profiles_protect_role
before insert or update on public.profiles
for each row execute function public.protect_profile_role();

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
on public.profiles for select
to authenticated
using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_insert_own_user" on public.profiles;
create policy "profiles_insert_own_user"
on public.profiles for insert
to authenticated
with check (id = auth.uid() and role = 'user');

drop policy if exists "profiles_update_own_or_admin" on public.profiles;
create policy "profiles_update_own_or_admin"
on public.profiles for update
to authenticated
using (id = auth.uid() or public.is_admin())
with check (id = auth.uid() or public.is_admin());

drop policy if exists "microscopes_read_authenticated" on public.microscopes;
create policy "microscopes_read_authenticated"
on public.microscopes for select
to authenticated
using (true);

drop policy if exists "microscopes_admin_write" on public.microscopes;
create policy "microscopes_admin_write"
on public.microscopes for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "bookings_select_authenticated" on public.bookings;
create policy "bookings_select_authenticated"
on public.bookings for select
to authenticated
using (true);

drop policy if exists "bookings_insert_own" on public.bookings;
create policy "bookings_insert_own"
on public.bookings for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "bookings_update_own_cancel_or_admin" on public.bookings;
create policy "bookings_update_own_cancel_or_admin"
on public.bookings for update
to authenticated
using (public.is_admin() or user_id = auth.uid())
with check (
  public.is_admin()
  or (user_id = auth.uid() and status = 'cancelled')
);

insert into public.microscopes (name, model, location, hourly_rate, notes)
values
  ('TEM-01 透射电镜', 'Thermo Fisher Talos F200X', '材料中心 A201', 260.00, '适合常规明场、暗场和 STEM 预约'),
  ('SEM-01 场发射扫描电镜', 'Zeiss GeminiSEM 500', '材料中心 B103', 180.00, '支持二次电子、背散射和 EDS'),
  ('FIB-SEM 双束系统', 'Thermo Fisher Helios 5 UX', '材料中心 B105', 420.00, '需管理员确认实验方案')
on conflict do nothing;

-- 创建首个管理员后，在 Supabase SQL Editor 中执行：
-- update public.profiles set role = 'admin' where email = 'your-email@example.com';
