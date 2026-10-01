-- Registration identity and booking-permission workflow.
alter table public.profiles
  add column if not exists user_type text not null default 'internal'
    check (user_type in ('internal', 'external')),
  add column if not exists organization text not null default '',
  add column if not exists booking_permission text not null default 'none'
    check (booking_permission in ('none', 'pending', 'approved', 'rejected')),
  add column if not exists booking_permission_requested_at timestamptz,
  add column if not exists booking_permission_reviewed_at timestamptz,
  add column if not exists booking_permission_reviewed_by varchar(64);

-- Existing administrators keep their established ability to make bookings.
update public.profiles
set booking_permission = 'approved'
where role in ('admin', 'super_admin') and booking_permission <> 'approved';

create index if not exists profiles_booking_permission_idx
  on public.profiles (booking_permission, booking_permission_requested_at);
