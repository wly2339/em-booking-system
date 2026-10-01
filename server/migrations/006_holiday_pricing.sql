-- Dates entered here are treated like weekends for internal self-service pricing.
create table if not exists public.holidays (
  holiday_date date primary key,
  name text not null default '',
  created_at timestamptz not null default now()
);
