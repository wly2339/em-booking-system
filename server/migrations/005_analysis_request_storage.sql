-- Private PostgreSQL-native Storage bucket for delivery-test requirement PDFs.
-- Run once in CloudBase PostgreSQL SQL editor before deploying API v10.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types,
  created_at,
  updated_at
)
values (
  'analysis-requests',
  'analysis-requests',
  false,
  4194304,
  array['application/pdf'],
  now(),
  now()
)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types,
  updated_at = now();
