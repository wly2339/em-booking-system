-- Voltage selection is limited to the two double-corrected Spectra microscopes.
update public.microscopes
set supports_acceleration_voltage = false;

update public.microscopes
set supports_acceleration_voltage = true
where name in (
  'Spectra Ultra 双球差校正透射电子显微镜',
  'Spectra 300 双球差校正透射电子显微镜'
);
