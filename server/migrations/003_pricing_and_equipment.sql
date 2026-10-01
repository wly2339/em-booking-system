-- Fee schedule from "华南理工大学电子显微中心收费标准".
-- Internal self-service reservations use the 校内自主 price; delivery-service
-- prices are kept for reference. Existing equipment and historical bookings remain intact.

alter table public.microscopes
  add column if not exists billing_unit text not null default 'hour'
    check (billing_unit in ('hour', 'sample')),
  add column if not exists equipment_category text not null default 'preparation'
    check (equipment_category in ('tem', 'fib_sem', 'sem', 'xray', 'preparation')),
  add column if not exists internal_delivery_rate numeric(10, 2) not null default 0,
  add column if not exists internal_self_rate numeric(10, 2) not null default 0,
  add column if not exists external_rate numeric(10, 2) not null default 0,
  add column if not exists pricing_note text not null default '',
  add column if not exists pricing_options jsonb not null default '[]'::jsonb;

update public.microscopes
set internal_delivery_rate = hourly_rate,
    internal_self_rate = hourly_rate,
    external_rate = hourly_rate
where internal_delivery_rate = 0 and internal_self_rate = 0 and external_rate = 0 and hourly_rate > 0;

alter table public.bookings
  add column if not exists billing_unit text not null default 'hour'
    check (billing_unit in ('hour', 'sample')),
  add column if not exists sample_count integer not null default 1 check (sample_count > 0),
  add column if not exists pricing_option_id text not null default '',
  add column if not exists accessory_id text not null default '',
  add column if not exists rate_snapshot numeric(10, 2) not null default 0,
  add column if not exists accessory_rate_snapshot numeric(10, 2) not null default 0,
  add column if not exists estimated_fee numeric(10, 2) not null default 0,
  add column if not exists price_breakdown jsonb not null default '[]'::jsonb;

create table if not exists public.booking_accessories (
  id text primary key,
  name text not null,
  internal_delivery_rate numeric(10, 2) not null,
  internal_self_rate numeric(10, 2) not null,
  external_rate numeric(10, 2) not null,
  notes text not null default '',
  is_active boolean not null default true
);

insert into public.booking_accessories (id, name, internal_delivery_rate, internal_self_rate, external_rate, notes)
values
  ('vacuum-transfer-tem', '制样存样系统_真空转移 TEM 样品杆', 50, 40, 100, '元/小时'),
  ('dens-heating', 'DENS 原位热电样品杆系统', 200, 160, 400, '元/小时'),
  ('dens-gas', 'DENS 原位气氛样品杆系统', 200, 160, 400, '元/小时'),
  ('dens-liquid-electrochemistry', 'DENS 原位液体电化学样品杆系统', 200, 160, 400, '元/小时'),
  ('gatan-double-tilt-heating', 'Gatan 双倾加热杆', 100, 80, 200, '元/小时'),
  ('gatan-double-tilt-ln2', 'Gatan 双倾液氮冷杆', 100, 80, 200, '元/小时'),
  ('gatan-single-tilt-ln2', 'Gatan 单倾液氮冷杆', 100, 80, 200, '元/小时'),
  ('gatan-single-tilt-3d-ln2', 'Gatan 单倾三维液氮冷杆', 100, 80, 200, '元/小时'),
  ('zeyi-fe-02-st', '泽仪单倾探针样品杆（FE-02-ST）', 100, 80, 200, '元/小时'),
  ('zeyi-foe-02-st', '泽仪单倾光电探针样品杆（FOE-02-ST）', 100, 80, 200, '元/小时')
on conflict (id) do update set
  name = excluded.name,
  internal_delivery_rate = excluded.internal_delivery_rate,
  internal_self_rate = excluded.internal_self_rate,
  external_rate = excluded.external_rate,
  notes = excluded.notes;

with equipment(name, model, billing_unit, delivery_rate, self_rate, outside_rate, note, options) as (
  values
    ('Spectra Ultra 双球差校正透射电子显微镜', 'Spectra Ultra', 'hour', 1500, 1200, 3000, '透射电子显微镜；元/小时', '[]'::jsonb),
    ('Spectra 300 双球差校正透射电子显微镜', 'Spectra 300', 'hour', 1250, 1000, 2500, '透射电子显微镜；元/小时', '[]'::jsonb),
    ('Spectra 300 单球差校正磁成像透射电镜', 'Spectra 300', 'hour', 1000, 800, 2000, '透射电子显微镜；元/小时', '[]'::jsonb),
    ('Talos F200X 高分辨透射电子显微镜', 'Talos F200X', 'hour', 500, 400, 1000, '透射电子显微镜；元/小时', '[]'::jsonb),
    ('Talos F200C 软物质成像透射电子显微镜', 'Talos F200C', 'hour', 500, 400, 1000, '透射电子显微镜；元/小时', '[]'::jsonb),
    ('Helios 5 Hydra UX PFIB-SEM 双束电镜', 'Helios 5 Hydra UX PFIB-SEM', 'hour', 800, 600, 1600, '双束电子显微镜；元/小时', '[]'::jsonb),
    ('Helios 5 CX FIB-SEM 双束电镜', 'Helios 5 CX FIB-SEM', 'hour', 800, 600, 1600, '双束电子显微镜；元/小时', '[]'::jsonb),
    ('Verios 5 UC 超高分辨场发射扫描电镜', 'Verios 5 UC', 'hour', 300, 240, 600, '扫描电子显微镜；请选择子系统后计费', '[{"id":"imaging-eds","name":"电子束成像及能谱仪","billingUnit":"hour","internalDeliveryRate":300,"internalSelfRate":240,"externalRate":600},{"id":"ebsd","name":"背散射衍射成像仪","billingUnit":"hour","internalDeliveryRate":400,"internalSelfRate":320,"externalRate":800},{"id":"fluorescence","name":"荧光探测器","billingUnit":"hour","internalDeliveryRate":400,"internalSelfRate":320,"externalRate":800}]'::jsonb),
    ('Quattro S 环境扫描电镜', 'Quattro S', 'hour', 250, 200, 500, '扫描电子显微镜；元/小时', '[]'::jsonb),
    ('Zeiss Xradia 610 Versa', 'Zeiss Xradia 610 Versa', 'hour', 1200, 1000, 2500, 'X 射线断层扫描；元/小时', '[]'::jsonb),
    ('Gatan Solaris II 955 精密等离子清洗仪', 'Gatan Solaris II 955', 'sample', 25, 20, 50, '制样设备；元/样品', '[]'::jsonb),
    ('Leica EM UC 7 生物冷冻超薄切片机', 'Leica EM UC 7', 'sample', 100, 80, 200, '制样设备；请选择样品类型后计费', '[{"id":"room-temperature","name":"室温样品","billingUnit":"sample","internalDeliveryRate":100,"internalSelfRate":80,"externalRate":200},{"id":"low-temperature","name":"低温样品","billingUnit":"sample","internalDeliveryRate":200,"internalSelfRate":160,"externalRate":400}]'::jsonb),
    ('PECSII 685.C 氩离子抛光镀膜系统', 'PECSII 685.C', 'hour', 200, 160, 400, '制样设备；元/小时', '[]'::jsonb),
    ('TEM Mill 1051 精密离子减薄仪', 'TEM Mill 1051', 'hour', 200, 160, 400, '制样设备；元/小时', '[]'::jsonb),
    ('Quorum K850 临界点干燥仪', 'Quorum K850', 'sample', 250, 200, 500, '制样设备；元/样品', '[]'::jsonb),
    ('Leica EM ACE 600 高真空镀膜仪（Pt/Au/C，4 nm）', 'Leica EM ACE 600', 'sample', 50, 40, 100, '制样设备；元/样品', '[]'::jsonb)
)
update public.microscopes m
set model = e.model,
    billing_unit = e.billing_unit,
    internal_delivery_rate = e.delivery_rate,
    internal_self_rate = e.self_rate,
    external_rate = e.outside_rate,
    hourly_rate = e.self_rate,
    pricing_note = e.note,
    pricing_options = e.options,
    notes = e.note
from equipment e
where lower(m.name) = lower(e.name);

with equipment(name, model, billing_unit, delivery_rate, self_rate, outside_rate, note, options) as (
  values
    ('Spectra Ultra 双球差校正透射电子显微镜', 'Spectra Ultra', 'hour', 1500, 1200, 3000, '透射电子显微镜；元/小时', '[]'::jsonb),
    ('Spectra 300 双球差校正透射电子显微镜', 'Spectra 300', 'hour', 1250, 1000, 2500, '透射电子显微镜；元/小时', '[]'::jsonb),
    ('Spectra 300 单球差校正磁成像透射电镜', 'Spectra 300', 'hour', 1000, 800, 2000, '透射电子显微镜；元/小时', '[]'::jsonb),
    ('Talos F200X 高分辨透射电子显微镜', 'Talos F200X', 'hour', 500, 400, 1000, '透射电子显微镜；元/小时', '[]'::jsonb),
    ('Talos F200C 软物质成像透射电子显微镜', 'Talos F200C', 'hour', 500, 400, 1000, '透射电子显微镜；元/小时', '[]'::jsonb),
    ('Helios 5 Hydra UX PFIB-SEM 双束电镜', 'Helios 5 Hydra UX PFIB-SEM', 'hour', 800, 600, 1600, '双束电子显微镜；元/小时', '[]'::jsonb),
    ('Helios 5 CX FIB-SEM 双束电镜', 'Helios 5 CX FIB-SEM', 'hour', 800, 600, 1600, '双束电子显微镜；元/小时', '[]'::jsonb),
    ('Verios 5 UC 超高分辨场发射扫描电镜', 'Verios 5 UC', 'hour', 300, 240, 600, '扫描电子显微镜；请选择子系统后计费', '[{"id":"imaging-eds","name":"电子束成像及能谱仪","billingUnit":"hour","internalDeliveryRate":300,"internalSelfRate":240,"externalRate":600},{"id":"ebsd","name":"背散射衍射成像仪","billingUnit":"hour","internalDeliveryRate":400,"internalSelfRate":320,"externalRate":800},{"id":"fluorescence","name":"荧光探测器","billingUnit":"hour","internalDeliveryRate":400,"internalSelfRate":320,"externalRate":800}]'::jsonb),
    ('Quattro S 环境扫描电镜', 'Quattro S', 'hour', 250, 200, 500, '扫描电子显微镜；元/小时', '[]'::jsonb),
    ('Zeiss Xradia 610 Versa', 'Zeiss Xradia 610 Versa', 'hour', 1200, 1000, 2500, 'X 射线断层扫描；元/小时', '[]'::jsonb),
    ('Gatan Solaris II 955 精密等离子清洗仪', 'Gatan Solaris II 955', 'sample', 25, 20, 50, '制样设备；元/样品', '[]'::jsonb),
    ('Leica EM UC 7 生物冷冻超薄切片机', 'Leica EM UC 7', 'sample', 100, 80, 200, '制样设备；请选择样品类型后计费', '[{"id":"room-temperature","name":"室温样品","billingUnit":"sample","internalDeliveryRate":100,"internalSelfRate":80,"externalRate":200},{"id":"low-temperature","name":"低温样品","billingUnit":"sample","internalDeliveryRate":200,"internalSelfRate":160,"externalRate":400}]'::jsonb),
    ('PECSII 685.C 氩离子抛光镀膜系统', 'PECSII 685.C', 'hour', 200, 160, 400, '制样设备；元/小时', '[]'::jsonb),
    ('TEM Mill 1051 精密离子减薄仪', 'TEM Mill 1051', 'hour', 200, 160, 400, '制样设备；元/小时', '[]'::jsonb),
    ('Quorum K850 临界点干燥仪', 'Quorum K850', 'sample', 250, 200, 500, '制样设备；元/样品', '[]'::jsonb),
    ('Leica EM ACE 600 高真空镀膜仪（Pt/Au/C，4 nm）', 'Leica EM ACE 600', 'sample', 50, 40, 100, '制样设备；元/样品', '[]'::jsonb)
)
insert into public.microscopes (name, model, location, status, hourly_rate, billing_unit, internal_delivery_rate, internal_self_rate, external_rate, pricing_note, pricing_options, notes)
select name, model, '', 'available', self_rate, billing_unit, delivery_rate, self_rate, outside_rate, note, options, note
from equipment e
where not exists (select 1 from public.microscopes m where lower(m.name) = lower(e.name));

-- The public booking list has exactly these five categories. Original sample rods
-- are stored in booking_accessories instead of appearing as standalone devices.
update public.microscopes
set equipment_category = case
  when name ilike 'Spectra%' or name ilike 'Talos%' or name = 'TEM-01 透射电镜' then 'tem'
  when name ilike 'Helios%' or name = 'FIB-SEM 双束系统' then 'fib_sem'
  when name ilike 'Verios%' or name ilike 'Quattro%' or name = 'SEM-01 场发射扫描电镜' then 'sem'
  when name ilike 'Zeiss Xradia%' then 'xray'
  else 'preparation'
end
where name in (
  'Spectra Ultra 双球差校正透射电子显微镜',
  'Spectra 300 双球差校正透射电子显微镜',
  'Spectra 300 单球差校正磁成像透射电镜',
  'Talos F200X 高分辨透射电子显微镜',
  'Talos F200C 软物质成像透射电子显微镜',
  'Helios 5 Hydra UX PFIB-SEM 双束电镜',
  'Helios 5 CX FIB-SEM 双束电镜',
  'Verios 5 UC 超高分辨场发射扫描电镜',
  'Quattro S 环境扫描电镜',
  'Zeiss Xradia 610 Versa',
  'Gatan Solaris II 955 精密等离子清洗仪',
  'Leica EM UC 7 生物冷冻超薄切片机',
  'PECSII 685.C 氩离子抛光镀膜系统',
  'TEM Mill 1051 精密离子减薄仪',
  'Quorum K850 临界点干燥仪',
  'Leica EM ACE 600 高真空镀膜仪（Pt/Au/C，4 nm）',
  'TEM-01 透射电镜',
  'SEM-01 场发射扫描电镜',
  'FIB-SEM 双束系统'
);

-- These three names were demonstration rows from the initial template, not rows
-- in the supplied fee schedule. Keep any linked history, but remove them from
-- the public reservation choices.
update public.microscopes
set status = 'offline',
    notes = '旧模板设备：未列入当前收费标准，已停止公开预约。'
where name in ('TEM-01 透射电镜', 'SEM-01 场发射扫描电镜', 'FIB-SEM 双束系统');
