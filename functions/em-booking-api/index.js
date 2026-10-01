const crypto = require('crypto');
const { promisify } = require('util');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const cloudbase = require('@cloudbase/node-sdk');
const CloudBaseManager = require('@cloudbase/manager-node');

const port = Number(process.env.PORT || 9000);
const cookieName = 'em_booking_session';
const jwtIssuer = 'em-booking-api';
const jwtSecret = process.env.JWT_ACCESS_SECRET;
const scrypt = promisify(crypto.scrypt);

if (!process.env.CLOUDBASE_APIKEY) throw new Error('CLOUDBASE_APIKEY is required.');
if (!jwtSecret || jwtSecret.length < 32) throw new Error('JWT_ACCESS_SECRET must contain at least 32 characters.');

const cloudbaseApp = cloudbase.init({
  env: process.env.CLOUDBASE_ENV_ID || cloudbase.SYMBOL_DEFAULT_ENV,
  accessKey: process.env.CLOUDBASE_APIKEY
});
// PostgreSQL CloudBase environments use the Storage HTTP API, not the
// legacy COS-backed node-sdk uploadFile method.
const storageApp = new CloudBaseManager({
  envId: process.env.CLOUDBASE_ENV_ID || cloudbase.SYMBOL_DEFAULT_ENV
});
const analysisRequestBucket = process.env.ANALYSIS_REQUEST_BUCKET || 'analysis-requests';

function normalizeStorageObjectKey(value) {
  let key = String(value || '').replace(/^\/+/, '');
  const bucketPrefix = `${analysisRequestBucket}/`;
  // Manager SDK responses may include the bucket in Key; object APIs expect
  // the path inside the bucket only. Handle prior duplicated prefixes too.
  while (key.startsWith(bucketPrefix)) key = key.slice(bucketPrefix.length);
  return key;
}
// CloudBase SDK defaults `database` to the environment ID. For the managed
// PostgreSQL instance, this becomes the PostgREST schema header. Our tables
// are intentionally in the public schema.
const db = cloudbaseApp.rdb({
  instance: process.env.CLOUDBASE_PG_INSTANCE || 'postgres-fs26ci12',
  database: 'public'
});
const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '6mb' }));
app.use(cookieParser());

function toUser(row) {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    lab: row.lab || '',
    userType: row.user_type || 'internal',
    organization: row.organization || row.lab || '',
    bookingPermission: row.booking_permission || 'none',
    phone: row.phone || '',
    role: row.role
  };
}

// Node.js built-in scrypt avoids native add-ons, which makes Cloud Function
// deployments portable across its Linux runtime versions.
async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const derivedKey = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${Buffer.from(derivedKey).toString('base64url')}`;
}

async function verifyPassword(password, storedHash) {
  if (typeof password !== 'string' || typeof storedHash !== 'string') return false;
  const [algorithm, salt, encodedKey] = storedHash.split('$');
  if (algorithm !== 'scrypt' || !salt || !encodedKey) return false;
  const expected = Buffer.from(encodedKey, 'base64url');
  const actual = Buffer.from(await scrypt(password, salt, expected.length));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function issueSession(user) {
  return jwt.sign({ sub: user.id, role: user.role }, jwtSecret, {
    algorithm: 'HS256', issuer: jwtIssuer, audience: 'em-booking-web', expiresIn: '2h'
  });
}

function setSession(res, user) {
  const token = issueSession(user);
  res.cookie(cookieName, token, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE !== 'false',
    sameSite: 'lax',
    path: '/',
    maxAge: 2 * 60 * 60 * 1000
  });
  return token;
}

function clearSession(res) {
  res.clearCookie(cookieName, {
    httpOnly: true, secure: process.env.COOKIE_SECURE !== 'false', sameSite: 'lax', path: '/'
  });
}

function requireUser(req, res, next) {
  try {
    // CloudBase HTTP Gateway may reserve the standard Authorization header.
    // Use an application-specific header for browser-to-function sessions.
    const sessionHeader = req.get('x-em-session') || '';
    const authorization = req.get('authorization') || '';
    const bearerToken = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
    const token = sessionHeader || bearerToken || req.cookies[cookieName];
    if (!token) return res.status(401).json({ error: '请先登录。' });
    req.auth = jwt.verify(token, jwtSecret, {
      algorithms: ['HS256'], issuer: jwtIssuer, audience: 'em-booking-web'
    });
    next();
  } catch (_error) {
    return res.status(401).json({ error: '登录状态已失效，请重新登录。' });
  }
}

async function getUserById(id) {
  const { data, error } = await db.from('profiles')
    .select('id, email, full_name, lab, user_type, organization, booking_permission, phone, role, is_active')
    .eq('id', id)
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

async function requireAdmin(req, res, next) {
  try {
    const user = await getUserById(req.auth.sub);
    if (!user || !user.is_active || !['admin', 'super_admin'].includes(user.role)) {
      return res.status(403).json({ error: '需要管理员权限。' });
    }
    req.currentUser = user;
    return next();
  } catch (error) {
    return apiError(res, error);
  }
}

async function requireSuperAdmin(req, res, next) {
  try {
    const user = await getUserById(req.auth.sub);
    if (!user || !user.is_active || user.role !== 'super_admin') {
      return res.status(403).json({ error: '需要超级管理员权限。' });
    }
    req.currentUser = user;
    return next();
  } catch (error) {
    return apiError(res, error);
  }
}

function isEmail(value) {
  return typeof value === 'string' && /^\S+@\S+\.\S+$/.test(value);
}

function apiError(res, error, fallback) {
  console.error(error);
  return res.status(500).json({ error: fallback || '服务暂时不可用，请稍后重试。' });
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function pricingOptions(microscope) {
  const raw = microscope?.pricing_options;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch (_error) { return []; }
  }
  return [];
}

function selectedRate(row, userType, serviceMode) {
  if (userType === 'external') return Number(row.external_rate ?? row.externalRate) || 0;
  if (serviceMode === 'delivery') return Number(row.internal_delivery_rate ?? row.internalDeliveryRate) || 0;
  return Number(row.internal_self_rate ?? row.internalSelfRate) || 0;
}

function supportsAccelerationVoltage(microscope) {
  const name = String(microscope?.name || '');
  return [
    'Spectra Ultra 双球差校正透射电子显微镜',
    'Spectra 300 双球差校正透射电子显微镜'
  ].includes(name);
}

function parseAnalysisRequestFile(value) {
  const name = typeof value?.name === 'string' ? value.name.trim() : '';
  const dataUrl = typeof value?.dataUrl === 'string' ? value.dataUrl : '';
  if (!name || !/^data:application\/pdf(?:;[^,]*)?;base64,/i.test(dataUrl)) return null;
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const content = Buffer.from(base64, 'base64');
  if (content.length < 5 || content.length > 4 * 1024 * 1024 || content.subarray(0, 5).toString() !== '%PDF-') return null;
  const safeName = name.replace(/[^0-9a-zA-Z\u4e00-\u9fff._-]/g, '_').slice(0, 100);
  if (!safeName.toLowerCase().endsWith('.pdf')) return null;
  return { name: safeName, content };
}

function getShanghaiParts(date) {
  // China has no daylight-saving changes; working in this timezone keeps the
  // discounted evening/weekend periods stable even if the function runs in UTC.
  const local = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return { day: local.getUTCDay(), hour: local.getUTCHours() };
}

function getShanghaiDateKey(date) {
  const local = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}-${String(local.getUTCDate()).padStart(2, '0')}`;
}

function timeMultiplier(date, holidayDates = new Set()) {
  const { day, hour } = getShanghaiParts(date);
  const night = hour < 8 || hour >= 18;
  if (day === 0 || day === 6 || holidayDates.has(getShanghaiDateKey(date))) return night ? 0.25 : 0.5;
  return night ? 0.5 : 1;
}

function calculateTimedFee(startAt, endAt, rate, label, applySelfServiceDiscount = true, holidayDates = new Set()) {
  let cursor = new Date(startAt);
  let fee = 0;
  const slots = [];
  while (cursor < endAt) {
    const next = new Date(cursor.getTime() + 30 * 60 * 1000);
    const multiplier = applySelfServiceDiscount ? timeMultiplier(cursor, holidayDates) : 1;
    const amount = rate * 0.5 * multiplier;
    fee += amount;
    slots.push({ multiplier, hours: 0.5, amount });
    cursor = next;
  }
  const grouped = slots.reduce((result, slot) => {
    const key = String(slot.multiplier);
    result[key] = result[key] || { multiplier: slot.multiplier, hours: 0, amount: 0 };
    result[key].hours += slot.hours;
    result[key].amount += slot.amount;
    return result;
  }, {});
  return {
    fee: roundMoney(fee),
    breakdown: Object.values(grouped).map((item) => ({
      item: label,
      unit: 'hour',
      rate,
      multiplier: item.multiplier,
      quantity: item.hours,
      amount: roundMoney(item.amount)
    }))
  };
}

function validHalfHour(date) {
  return date.getSeconds() === 0 && date.getMilliseconds() === 0 && [0, 30].includes(date.getMinutes());
}

app.get('/health', async (_req, res) => {
  const { error } = await db.from('microscopes').select('id').limit(1);
  if (error) return apiError(res, error);
  return res.json({ ok: true });
});

app.post('/auth/register', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const fullName = typeof req.body?.fullName === 'string' ? req.body.fullName.trim() : '';
  const userType = req.body?.userType;
  const organization = typeof req.body?.organization === 'string' ? req.body.organization.trim() : '';
  const password = req.body?.password;
  if (!isEmail(email) || !fullName || !['internal', 'external'].includes(userType) || !organization || organization.length > 100 || typeof password !== 'string' || password.length < 10 || password.length > 128) {
    return res.status(400).json({ error: '请填写姓名、用户类别、单位或学院、有效邮箱和至少 10 位密码。' });
  }

  const { data: existing, error: lookupError } = await db.from('profiles').select('id').eq('email', email).limit(1);
  if (lookupError) return apiError(res, lookupError);
  if (existing?.length) return res.status(409).json({ error: '该邮箱已注册，请直接登录。' });

  try {
    const user = { id: crypto.randomUUID(), email, full_name: fullName, lab: organization, user_type: userType, organization, booking_permission: 'none', phone: '', role: 'user' };
    const passwordHash = await hashPassword(password);
    const { error } = await db.from('profiles').insert({ ...user, password_hash: passwordHash, is_active: true });
    if (error) return apiError(res, error);
    const token = setSession(res, user);
    return res.status(201).json({ user: toUser(user), token });
  } catch (error) {
    return apiError(res, error);
  }
});

app.post('/auth/login', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = req.body?.password;
  const { data, error } = await db.from('profiles')
    .select('id, email, full_name, lab, user_type, organization, booking_permission, phone, role, is_active, password_hash')
    .eq('email', email)
    .limit(1);
  if (error) return apiError(res, error);
  const user = data?.[0];
  if (!user || !user.is_active || !user.password_hash || !(await verifyPassword(password || '', user.password_hash))) {
    return res.status(401).json({ error: '邮箱或密码不正确。' });
  }
  await db.from('profiles').update({ last_login_at: new Date().toISOString() }).eq('id', user.id);
  const token = setSession(res, user);
  return res.json({ user: toUser(user), token });
});

app.post('/auth/logout', (_req, res) => {
  clearSession(res);
  return res.status(204).end();
});

app.get('/auth/me', requireUser, async (req, res) => {
  const { data, error } = await db.from('profiles')
    .select('id, email, full_name, lab, user_type, organization, booking_permission, phone, role, is_active')
    .eq('id', req.auth.sub)
    .limit(1);
  if (error) return apiError(res, error);
  const user = data?.[0];
  if (!user || !user.is_active) return res.status(401).json({ error: '账户不可用。' });
  return res.json({ user: toUser(user) });
});

app.patch('/profile', requireUser, async (req, res) => {
  const fullName = typeof req.body?.fullName === 'string' ? req.body.fullName.trim() : '';
  const lab = typeof req.body?.lab === 'string' ? req.body.lab.trim() : '';
  const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';
  if (!fullName || fullName.length > 100 || lab.length > 100 || phone.length > 50) {
    return res.status(400).json({ error: '请填写有效的个人资料。' });
  }
  const { error } = await db.from('profiles')
    .update({ full_name: fullName, lab, phone })
    .eq('id', req.auth.sub);
  if (error) return apiError(res, error);
  const user = await getUserById(req.auth.sub);
  return res.json({ user: toUser(user) });
});

app.get('/microscopes', requireUser, async (_req, res) => {
  const { data, error } = await db.from('microscopes').select('*').order('name');
  if (error) return apiError(res, error);
  return res.json({ microscopes: data || [] });
});

app.get('/booking-accessories', requireUser, async (_req, res) => {
  const { data, error } = await db.from('booking_accessories').select('*').eq('is_active', true).order('name');
  if (error) return apiError(res, error);
  return res.json({ accessories: data || [] });
});

app.get('/holidays', requireUser, async (_req, res) => {
  const { data, error } = await db.from('holidays').select('holiday_date, name, created_at').order('holiday_date');
  if (error) return apiError(res, error);
  return res.json({ holidays: data || [] });
});

app.post('/holidays', requireUser, requireAdmin, async (req, res) => {
  const holidayDate = typeof req.body?.holidayDate === 'string' ? req.body.holidayDate.trim() : '';
  const startDate = typeof req.body?.startDate === 'string' ? req.body.startDate.trim() : holidayDate;
  const endDate = typeof req.body?.endDate === 'string' ? req.body.endDate.trim() : startDate;
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 100) : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || Number.isNaN(new Date(`${startDate}T00:00:00`).getTime()) || Number.isNaN(new Date(`${endDate}T00:00:00`).getTime()) || endDate < startDate) {
    return res.status(400).json({ error: '请输入有效的节假日起止日期。' });
  }
  const dates = [];
  for (let cursor = new Date(`${startDate}T00:00:00Z`); cursor <= new Date(`${endDate}T00:00:00Z`); cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)) {
    dates.push({ holiday_date: cursor.toISOString().slice(0, 10), name });
    if (dates.length > 366) return res.status(400).json({ error: '一次最多设置连续 366 天。' });
  }
  const { data, error } = await db.from('holidays').upsert(dates).select('holiday_date, name, created_at');
  if (error) return apiError(res, error);
  return res.status(201).json({ holidays: data || [] });
});

app.delete('/holidays/:date', requireUser, requireAdmin, async (req, res) => {
  const holidayDate = req.params.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(holidayDate)) return res.status(400).json({ error: '节假日日期无效。' });
  const { error } = await db.from('holidays').delete().eq('holiday_date', holidayDate);
  if (error) return apiError(res, error);
  return res.status(204).end();
});

app.post('/microscopes', requireUser, requireAdmin, async (req, res) => {
  const payload = microscopePayload(req.body);
  if (!payload) return res.status(400).json({ error: '设备信息不完整。' });
  const { data, error } = await db.from('microscopes').insert(payload).select('*');
  if (error) return apiError(res, error);
  return res.status(201).json({ microscope: data?.[0] });
});

app.patch('/microscopes/:id', requireUser, requireAdmin, async (req, res) => {
  const payload = microscopePayload(req.body);
  if (!payload) return res.status(400).json({ error: '设备信息不完整。' });
  const { data, error } = await db.from('microscopes').update(payload).eq('id', req.params.id).select('*');
  if (error) return apiError(res, error);
  if (!data?.[0]) return res.status(404).json({ error: '设备不存在。' });
  return res.json({ microscope: data[0] });
});

app.delete('/microscopes/:id', requireUser, requireAdmin, async (req, res) => {
  const { error } = await db.from('microscopes').delete().eq('id', req.params.id);
  if (error) return apiError(res, error, '设备已有预约记录，不能删除。');
  return res.status(204).end();
});

app.get('/bookings', requireUser, async (req, res) => {
  const start = new Date(req.query.start);
  const end = new Date(req.query.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return res.status(400).json({ error: '查询日期无效。' });
  }
  let query = db.from('bookings').select('*').lt('start_at', end.toISOString()).gt('end_at', start.toISOString()).order('start_at');
  if (req.query.mine === 'true') query = query.eq('user_id', req.auth.sub);
  if (typeof req.query.microscopeId === 'string' && req.query.microscopeId) query = query.eq('microscope_id', req.query.microscopeId);
  const [{ data: bookings, error }, { data: microscopes, error: microscopeError }, { data: profiles, error: profileError }] = await Promise.all([
    query,
    db.from('microscopes').select('id, name, location'),
    db.from('profiles').select('id, full_name, lab, organization, email')
  ]);
  if (error || microscopeError || profileError) return apiError(res, error || microscopeError || profileError);
  const microscopeById = new Map((microscopes || []).map((item) => [item.id, item]));
  const profileById = new Map((profiles || []).map((item) => [item.id, item]));
  return res.json({ bookings: (bookings || []).map((booking) => ({
    ...booking,
    microscopes: microscopeById.get(booking.microscope_id) || null,
    profiles: profileById.get(booking.user_id) || null
  })) });
});

app.post('/bookings', requireUser, async (req, res) => {
  const startAt = new Date(req.body?.startAt);
  const endAt = new Date(req.body?.endAt);
  const microscopeId = req.body?.microscopeId;
  const purpose = typeof req.body?.purpose === 'string' ? req.body.purpose.trim() : '';
  const pricingOptionId = typeof req.body?.pricingOptionId === 'string' ? req.body.pricingOptionId.trim() : '';
  const accessoryId = typeof req.body?.accessoryId === 'string' ? req.body.accessoryId.trim() : '';
  const currentUser = await getUserById(req.auth.sub);
  const canBook = ['admin', 'super_admin'].includes(currentUser?.role) || currentUser?.booking_permission === 'approved';
  if (!canBook) return res.status(403).json({ error: '当前账号仅可查看。请先提交预约权限申请并等待管理员批准。' });
  const serviceMode = currentUser.user_type === 'external' ? 'external' : req.body?.serviceMode;
  const validServiceMode = currentUser.user_type === 'external'
    ? serviceMode === 'external'
    : ['self', 'delivery'].includes(serviceMode);
  if (!validServiceMode || !microscopeId || !purpose || Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt || !validHalfHour(startAt) || !validHalfHour(endAt)) {
    return res.status(400).json({ error: '预约信息不完整或时间无效。' });
  }
  let analysisRequest = null;
  if (serviceMode === 'delivery') {
    analysisRequest = parseAnalysisRequestFile(req.body?.analysisRequestFile);
    if (!analysisRequest) return res.status(400).json({ error: '送样测试必须上传不超过 4 MB 的 PDF 分析测试需求单。' });
  }
  const { data: microscopeRows, error: microscopeError } = await db.from('microscopes').select('*').eq('id', microscopeId).limit(1);
  if (microscopeError) return apiError(res, microscopeError);
  const microscope = microscopeRows?.[0];
  if (!microscope || microscope.status !== 'available') return res.status(400).json({ error: '该设备当前不可预约。' });

  const options = pricingOptions(microscope);
  const priceOption = pricingOptionId ? options.find((item) => item.id === pricingOptionId) : null;
  if (options.length && !priceOption) return res.status(400).json({ error: '请选择设备的收费子项目。' });
  if (!options.length && pricingOptionId) return res.status(400).json({ error: '该设备没有收费子项目。' });
  const priceSource = priceOption || microscope;
  const billingUnit = priceOption?.billingUnit || microscope.billing_unit || 'hour';
  const mainRate = selectedRate(priceSource, currentUser.user_type, serviceMode);
  const requestedSampleCount = Number(req.body?.sampleCount ?? 1);
  const sampleCount = microscope.equipment_category === 'preparation' ? requestedSampleCount : 1;
  if (!Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > 1000) {
    return res.status(400).json({ error: '样品数量应为 1 至 1000 的整数。' });
  }
  const requestedVoltage = Number(req.body?.accelerationVoltage ?? 300);
  const accelerationVoltage = supportsAccelerationVoltage(microscope) ? requestedVoltage : 300;
  if (!Number.isInteger(accelerationVoltage) || ![60, 80, 100, 200, 300].includes(accelerationVoltage)) {
    return res.status(400).json({ error: '加速电压只能选择 60、80、100、200 或 300 kV。' });
  }
  const startDateKey = getShanghaiDateKey(startAt);
  const endDateKey = getShanghaiDateKey(new Date(endAt.getTime() - 1));
  const { data: holidayRows, error: holidayError } = await db.from('holidays').select('holiday_date').gte('holiday_date', startDateKey).lte('holiday_date', endDateKey);
  if (holidayError) return apiError(res, holidayError);
  const holidayDates = new Set((holidayRows || []).map((item) => item.holiday_date));

  let accessory = null;
  if (accessoryId) {
    if (microscope.equipment_category !== 'tem') return res.status(400).json({ error: '原位样品杆仅可随透射电子显微镜预约。' });
    const { data, error } = await db.from('booking_accessories').select('*').eq('id', accessoryId).eq('is_active', true).limit(1);
    if (error) return apiError(res, error);
    accessory = data?.[0];
    if (!accessory) return res.status(400).json({ error: '所选原位样品杆不可用。' });
  }

  const mainCalculation = billingUnit === 'sample'
    ? { fee: roundMoney(mainRate * sampleCount), breakdown: [{ item: `${microscope.name}${priceOption ? `（${priceOption.name}）` : ''}`, unit: 'sample', rate: mainRate, multiplier: 1, quantity: sampleCount, amount: roundMoney(mainRate * sampleCount) }] }
    : calculateTimedFee(startAt, endAt, mainRate, `${microscope.name}${priceOption ? `（${priceOption.name}）` : ''}`, serviceMode === 'self', holidayDates);
  const accessoryRate = accessory ? selectedRate(accessory, currentUser.user_type, serviceMode) : 0;
  const accessoryCalculation = accessory ? calculateTimedFee(startAt, endAt, accessoryRate, accessory.name, serviceMode === 'self', holidayDates) : { fee: 0, breakdown: [] };
  const estimatedFee = roundMoney(mainCalculation.fee + accessoryCalculation.fee);

  let analysisRequestFileId = '';
  if (analysisRequest) {
    const nonce = crypto.randomBytes(8).toString('hex');
    const objectName = `${req.auth.sub}/${Date.now()}-${nonce}-${analysisRequest.name}`;
    try {
      const upload = await storageApp.storage.uploadObject({
        bucketId: analysisRequestBucket,
        objectName,
        body: analysisRequest.content,
        contentType: 'application/pdf',
        contentLength: analysisRequest.content.length,
        metadata: {
          bookingUserId: req.auth.sub,
          originalName: analysisRequest.name
        },
        accessToken: process.env.CLOUDBASE_APIKEY
      });
      const objectKey = normalizeStorageObjectKey(upload.Key || objectName);
      // Keep the bucket/key pair, because PG Storage signing APIs address the
      // object by key rather than by its internal object ID.
      analysisRequestFileId = `${analysisRequestBucket}/${objectKey}`;
      if (!objectKey) throw new Error('Storage did not return an object key');
    } catch (error) {
      console.error('Analysis request storage upload failed:', error?.message || error);
      return apiError(res, error, '分析测试需求单上传失败，请稍后重试。');
    }
  }

  const { data, error } = await db.from('bookings').insert({
    microscope_id: microscopeId,
    user_id: req.auth.sub,
    title: `${microscope.name} 预约`,
    purpose,
    sample_type: '',
    start_at: startAt.toISOString(),
    end_at: endAt.toISOString(),
    status: 'pending',
    billing_unit: billingUnit,
    sample_count: sampleCount,
    service_mode: serviceMode,
    pricing_option_id: pricingOptionId,
    accessory_id: accessoryId,
    rate_snapshot: mainRate,
    accessory_rate_snapshot: accessoryRate,
    estimated_fee: estimatedFee,
    price_breakdown: [...mainCalculation.breakdown, ...accessoryCalculation.breakdown],
    analysis_request_file_id: analysisRequestFileId,
    analysis_request_file_name: analysisRequest?.name || '',
    acceleration_voltage: accelerationVoltage
  }).select('*');
  if (error) {
    if (String(error.message || '').includes('bookings_no_time_overlap')) {
      return res.status(409).json({ error: '该时间段已经被预约，请换一个时间。' });
    }
    return apiError(res, error);
  }
  return res.status(201).json({ booking: data?.[0] });
});

app.get('/admin/bookings/:id/analysis-request-file', requireUser, requireAdmin, async (req, res) => {
  const { data: bookings, error } = await db.from('bookings')
    .select('id, analysis_request_file_id, analysis_request_file_name')
    .eq('id', req.params.id)
    .limit(1);
  if (error) return apiError(res, error);
  const booking = bookings?.[0];
  if (!booking?.analysis_request_file_id || !booking.analysis_request_file_name) {
    return res.status(404).json({ error: '该预约没有上传分析测试需求单。' });
  }

  const prefix = `${analysisRequestBucket}/`;
  let objectName = booking.analysis_request_file_id.startsWith(prefix)
    ? normalizeStorageObjectKey(booking.analysis_request_file_id)
    : '';
  // API v10 persisted only the PG Storage object ID. Recover its key from the
  // private bucket so PDFs uploaded before v11 remain downloadable.
  if (!objectName) {
    try {
      const listed = await storageApp.storage.listObjects({
        bucketId: analysisRequestBucket,
        limit: 1000,
        accessToken: process.env.CLOUDBASE_APIKEY
      });
      const matched = (listed?.objects || []).find((item) => String(item.id || item.Id) === booking.analysis_request_file_id);
      objectName = matched?.name || matched?.Key || '';
    } catch (storageError) {
      console.error('Analysis request storage lookup failed:', storageError?.message || storageError);
      return apiError(res, storageError, '暂时无法定位附件，请稍后重试。');
    }
  }
  if (!objectName) return res.status(404).json({ error: '附件路径无效。' });

  try {
    const download = await storageApp.storage.downloadAuthenticatedObject({
      bucketId: analysisRequestBucket,
      objectName,
      accessToken: process.env.CLOUDBASE_APIKEY,
      method: 'GET'
    });
    if (!download?.body) throw new Error('Storage did not return a file stream');
    res.setHeader('Content-Type', download.headers?.['content-type'] || 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="analysis-request.pdf"');
    if (download.headers?.['content-length']) res.setHeader('Content-Length', download.headers['content-length']);
    download.body.on('error', (streamError) => {
      console.error('Analysis request storage stream failed:', streamError?.message || streamError);
      if (!res.headersSent) apiError(res, streamError, '附件读取失败，请稍后重试。');
      else res.destroy(streamError);
    });
    return download.body.pipe(res);
  } catch (storageError) {
    console.error('Analysis request storage download failed:', storageError?.message || storageError);
    return apiError(res, storageError, '暂时无法读取附件，请稍后重试。');
  }
});

app.patch('/bookings/:id/status', requireUser, async (req, res) => {
  const status = req.body?.status;
  const operatorNotes = typeof req.body?.operatorNotes === 'string' ? req.body.operatorNotes.trim() : '';
  if (!['approved', 'rejected', 'cancelled'].includes(status)) return res.status(400).json({ error: '无效的预约状态。' });
  const bookingRows = await db.from('bookings').select('*').eq('id', req.params.id).limit(1);
  if (bookingRows.error) return apiError(res, bookingRows.error);
  const booking = bookingRows.data?.[0];
  if (!booking) return res.status(404).json({ error: '预约不存在。' });
  const currentUser = await getUserById(req.auth.sub);
  const admin = ['admin', 'super_admin'].includes(currentUser?.role);
  if (!(admin || (booking.user_id === req.auth.sub && status === 'cancelled'))) {
    return res.status(403).json({ error: '没有权限修改这条预约。' });
  }
  const updates = admin ? { status, operator_notes: operatorNotes } : { status: 'cancelled' };
  const { data, error } = await db.from('bookings').update(updates).eq('id', booking.id).select('*');
  if (error) return apiError(res, error);
  return res.json({ booking: data?.[0] });
});

app.delete('/admin/bookings/:id', requireUser, requireAdmin, async (req, res) => {
  const { data, error } = await db.from('bookings').delete().eq('id', req.params.id).select('id').limit(1);
  if (error) return apiError(res, error);
  if (!data?.[0]) return res.status(404).json({ error: '预约不存在或已被删除。' });
  return res.status(204).end();
});

app.get('/admin/users', requireUser, requireSuperAdmin, async (_req, res) => {
  const [{ data: users, error: usersError }, { data: bookings, error: bookingsError }] = await Promise.all([
    db.from('profiles').select('id, email, full_name, lab, user_type, organization, booking_permission, booking_permission_requested_at, role, created_at').order('created_at', { ascending: false }),
    db.from('bookings').select('user_id, status, estimated_fee')
  ]);
  if (usersError || bookingsError) return apiError(res, usersError || bookingsError);
  const summaries = new Map();
  for (const booking of bookings || []) {
    const summary = summaries.get(booking.user_id) || { count: 0, approvedCount: 0, approvedFee: 0, pendingCount: 0, pendingFee: 0 };
    summary.count += 1;
    if (booking.status === 'approved') {
      summary.approvedCount += 1;
      summary.approvedFee += Number(booking.estimated_fee || 0);
    } else if (booking.status === 'pending') {
      summary.pendingCount += 1;
      summary.pendingFee += Number(booking.estimated_fee || 0);
    }
    summaries.set(booking.user_id, summary);
  }
  return res.json({ users: (users || []).map((user) => ({
    ...user,
    booking_summary: summaries.get(user.id) || { count: 0, approvedCount: 0, approvedFee: 0, pendingCount: 0, pendingFee: 0 }
  })) });
});

app.get('/admin/users/:id/bookings', requireUser, requireSuperAdmin, async (req, res) => {
  const [{ data: userRows, error: userError }, { data: bookings, error: bookingsError }] = await Promise.all([
    db.from('profiles').select('id, full_name, email').eq('id', req.params.id).limit(1),
    db.from('bookings').select('id, microscope_id, title, start_at, end_at, status, service_mode, estimated_fee, acceleration_voltage, purpose, created_at').eq('user_id', req.params.id).order('start_at', { ascending: false })
  ]);
  if (userError || bookingsError) return apiError(res, userError || bookingsError);
  const user = userRows?.[0];
  if (!user) return res.status(404).json({ error: '用户不存在。' });
  return res.json({
    user,
    // title is the device name snapshot saved at booking time. Returning it directly
    // also preserves historical records when a device was later deleted or disabled.
    bookings: (bookings || []).map((booking) => ({ ...booking, microscopes: null }))
  });
});

app.patch('/admin/users/:id/role', requireUser, requireSuperAdmin, async (req, res) => {
  const role = req.body?.role;
  if (!['user', 'admin'].includes(role) || req.params.id === req.auth.sub) {
    return res.status(400).json({ error: '无法执行该角色变更。' });
  }
  const { data, error } = await db.from('profiles').update({ role }).eq('id', req.params.id).select('id, email, full_name, lab, user_type, organization, booking_permission, role, created_at');
  if (error) return apiError(res, error);
  if (!data?.[0]) return res.status(404).json({ error: '用户不存在。' });
  return res.json({ user: data[0] });
});

app.post('/booking-permission/request', requireUser, async (req, res) => {
  const user = await getUserById(req.auth.sub);
  if (!user?.is_active) return res.status(401).json({ error: '账户不可用。' });
  if (['admin', 'super_admin'].includes(user.role) || user.booking_permission === 'approved') {
    return res.status(400).json({ error: '当前账号已具备预约权限。' });
  }
  if (user.booking_permission === 'pending') return res.status(400).json({ error: '预约权限申请正在审核中。' });
  const { error } = await db.from('profiles').update({
    booking_permission: 'pending',
    booking_permission_requested_at: new Date().toISOString(),
    booking_permission_reviewed_at: null,
    booking_permission_reviewed_by: null
  }).eq('id', user.id);
  if (error) return apiError(res, error);
  return res.json({ message: '预约权限申请已提交。' });
});

app.patch('/admin/users/:id/booking-permission', requireUser, requireSuperAdmin, async (req, res) => {
  const bookingPermission = req.body?.bookingPermission;
  if (!['approved', 'rejected'].includes(bookingPermission) || req.params.id === req.auth.sub) {
    return res.status(400).json({ error: '无效的预约权限操作。' });
  }
  const { data, error } = await db.from('profiles').update({
    booking_permission: bookingPermission,
    booking_permission_reviewed_at: new Date().toISOString(),
    booking_permission_reviewed_by: req.auth.sub
  }).eq('id', req.params.id).select('id, booking_permission');
  if (error) return apiError(res, error);
  if (!data?.[0]) return res.status(404).json({ error: '用户不存在。' });
  return res.json({ user: data[0] });
});

function microscopePayload(value) {
  const name = typeof value?.name === 'string' ? value.name.trim() : '';
  const status = value?.status;
  const hourlyRate = Number(value?.hourly_rate);
  const billingUnit = value?.billing_unit === 'sample' ? 'sample' : 'hour';
  const equipmentCategory = value?.equipment_category;
  const deliveryRate = Number(value?.internal_delivery_rate);
  const selfRate = Number(value?.internal_self_rate);
  const externalRate = Number(value?.external_rate);
  const supportsAccelerationVoltage = typeof value?.supports_acceleration_voltage === 'boolean' ? value.supports_acceleration_voltage : undefined;
  if (!name || !['available', 'maintenance', 'offline'].includes(status) || !['tem', 'fib_sem', 'sem', 'xray', 'preparation'].includes(equipmentCategory) || !Number.isFinite(hourlyRate) || hourlyRate < 0 || ![deliveryRate, selfRate, externalRate].every((rate) => Number.isFinite(rate) && rate >= 0)) return null;
  return {
    name,
    model: typeof value?.model === 'string' ? value.model.trim() : '',
    location: typeof value?.location === 'string' ? value.location.trim() : '',
    status,
    hourly_rate: hourlyRate,
    billing_unit: billingUnit,
    equipment_category: equipmentCategory,
    internal_delivery_rate: deliveryRate,
    internal_self_rate: selfRate,
    external_rate: externalRate,
    ...(supportsAccelerationVoltage === undefined ? {} : { supports_acceleration_voltage: supportsAccelerationVoltage }),
    pricing_note: typeof value?.pricing_note === 'string' ? value.pricing_note.trim() : '',
    pricing_options: Array.isArray(value?.pricing_options) ? value.pricing_options : [],
    notes: typeof value?.notes === 'string' ? value.notes.trim() : ''
  };
}

app.use((_req, res) => res.status(404).json({ error: '接口不存在。' }));
app.listen(port, '0.0.0.0', () => console.log(`em-booking-api listening on ${port}`));
