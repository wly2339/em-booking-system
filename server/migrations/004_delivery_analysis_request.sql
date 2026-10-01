-- Delivery testing is a different service from internal self-service testing.
alter table public.bookings
  add column if not exists service_mode text not null default 'self'
    check (service_mode in ('self', 'delivery', 'external')),
  add column if not exists analysis_request_file_id text not null default '',
  add column if not exists analysis_request_file_name text not null default '';
