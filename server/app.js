require('dotenv').config({ path: process.env.ENV_FILE || 'server/.env' });

const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const argon2 = require('argon2');
const jwt = require('jsonwebtoken');
const { pool } = require('./db');

const app = express();
const port = Number(process.env.PORT || 8080);
const cookieName = 'em_booking_session';
const jwtIssuer = process.env.JWT_ISSUER || 'em-booking-api';
const jwtSecret = process.env.JWT_ACCESS_SECRET;

if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error('JWT_ACCESS_SECRET must be at least 32 characters.');
}

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use(cookieParser());

function issueSession(user) {
  return jwt.sign({ sub: user.id, role: user.role, email: user.email }, jwtSecret, {
    algorithm: 'HS256',
    issuer: jwtIssuer,
    audience: 'em-booking-web',
    expiresIn: '2h'
  });
}

function setSession(res, user) {
  res.cookie(cookieName, issueSession(user), {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === 'true',
    sameSite: 'lax',
    maxAge: 2 * 60 * 60 * 1000,
    path: '/'
  });
}

function publicUser(user) {
  return { id: user.id, email: user.email, fullName: user.full_name, lab: user.lab, phone: user.phone, role: user.role };
}

function requireUser(req, res, next) {
  try {
    const token = req.cookies[cookieName];
    if (!token) return res.status(401).json({ error: '请先登录。' });
    req.auth = jwt.verify(token, jwtSecret, { algorithms: ['HS256'], issuer: jwtIssuer, audience: 'em-booking-web' });
    next();
  } catch {
    return res.status(401).json({ error: '登录状态已失效，请重新登录。' });
  }
}

function validPassword(password) {
  return typeof password === 'string' && password.length >= 10 && password.length <= 128;
}

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('select 1');
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.post('/api/auth/register', async (req, res, next) => {
  const { email, password, fullName } = req.body ?? {};
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const normalizedName = typeof fullName === 'string' ? fullName.trim() : '';
  if (!/^\S+@\S+\.\S+$/.test(normalizedEmail) || !normalizedName || !validPassword(password)) {
    return res.status(400).json({ error: '请填写姓名、有效邮箱和至少 10 位密码。' });
  }
  try {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const result = await pool.query(
      `insert into public.profiles (id, email, full_name, password_hash)
       values ($1, $2, $3, $4)
       returning id, email, full_name, lab, phone, role`,
      [crypto.randomUUID(), normalizedEmail, normalizedName, passwordHash]
    );
    const user = result.rows[0];
    setSession(res, user);
    res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: '该邮箱已注册，请直接登录。' });
    next(error);
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = req.body?.password;
  try {
    const result = await pool.query(
      `select id, email, full_name, lab, phone, role, is_active, password_hash
       from public.profiles where lower(email) = lower($1) limit 1`,
      [email]
    );
    const user = result.rows[0];
    if (!user || !user.password_hash || !user.is_active || !(await argon2.verify(user.password_hash, password || ''))) {
      return res.status(401).json({ error: '邮箱或密码不正确。' });
    }
    await pool.query('update public.profiles set last_login_at = now() where id = $1', [user.id]);
    setSession(res, user);
    res.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie(cookieName, { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', path: '/' });
  res.status(204).end();
});

app.get('/api/auth/me', requireUser, async (req, res, next) => {
  try {
    const result = await pool.query(
      'select id, email, full_name, lab, phone, role from public.profiles where id = $1 and is_active = true',
      [req.auth.sub]
    );
    if (!result.rows[0]) return res.status(401).json({ error: '账户不可用。' });
    res.json({ user: publicUser(result.rows[0]) });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: '服务暂时不可用，请稍后再试。' });
});

app.listen(port, '0.0.0.0', () => console.log(`API listening on ${port}`));
