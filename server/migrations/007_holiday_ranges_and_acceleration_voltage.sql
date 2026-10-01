-- Acceleration-voltage selections are available only for the three Spectra TEMs.
alter table public.microscopes
  add column if not exists supports_acceleration_voltage boolean not null default false;

update public.microscopes
set supports_acceleration_voltage = true
where name in (
  'Spectra Ultra 双球差校正透射电子显微镜',
  'Spectra 300 双球差校正透射电子显微镜',
  'Spectra 300 单球差校正磁成像透射电镜'
);

alter table public.bookings
  add column if not exists acceleration_voltage integer not null default 300
    check (acceleration_voltage in (60, 80, 100, 200, 300));
