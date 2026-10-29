require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { client, userClient, URL, KEY } = require('./supabase');

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CLIENT_ORIGIN || true }));
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ---------- helpers ---------- */
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ok = (res, data = {}, code = 200) => res.status(code).json({ success: true, ...data });
const parse = (schema, data) => {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, r.error.issues.map(i => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '));
  return r.data;
};
function authErr(e) {
  const m = e.message || '';
  if (/already registered/i.test(m)) return new HttpError(409, 'This email is already registered.');
  if (/invalid login/i.test(m)) return new HttpError(401, 'Incorrect email or password.');
  if (/not confirmed/i.test(m)) return new HttpError(403, 'Please confirm your email first.');
  if (e.status === 429) return new HttpError(429, 'Too many attempts. Try again later.');
  if (/refresh token|jwt|session/i.test(m)) return new HttpError(401, 'Session expired. Please log in again.');
  return new HttpError(400, m || 'Authentication failed.');
}
function dbErr(e) {
  if (['23514', '22P02', '23502'].includes(e.code)) return new HttpError(400, 'Invalid data.');
  console.error('DB error:', e.code, e.message);
  return new HttpError(500, 'Database error. Try again.');
}
const sessionPayload = (s, user) => ({
  token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at,
  user: { id: user.id, name: user.user_metadata?.name || user.email.split('@')[0], email: user.email }
});

/* ---------- validation ---------- */
const email = z.string().trim().toLowerCase().email('enter a valid email').max(254);
const password = z.string().min(8, 'at least 8 characters').max(72);
const registerSchema = z.object({ name: z.string().trim().min(2, 'enter your name').max(60), email, password });
const loginSchema = z.object({ email, password: z.string().min(1, 'required').max(72) });
const num = (a, b) => z.number().min(a).max(b);
const runSchema = z.object({
  name: z.string().trim().min(1).max(80), mode: z.enum(['ai', 'fast']),
  temp: num(15, 60), soc: num(0, 100), soh: num(50, 100), volt: num(300, 500), cur: num(0, 400), amb: num(10, 50),
  max_power: num(20, 200), rec_power: num(0, 200), pred_temp: num(0, 100),
  risk: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  charge_time_min: z.number().min(0).max(100000).nullable().optional(),
  protection_score: num(0, 100).optional(), degradation_risk: num(0, 100).optional(),
  notes: z.string().trim().max(500).optional()
});
const patchRun = z.object({ name: z.string().trim().min(1).max(80).optional(), notes: z.string().trim().max(500).optional() })
  .refine(o => Object.keys(o).length > 0, 'nothing to update');
const idSchema = z.string().uuid('invalid id');
const pageSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).default(0) });

/* ---------- auth middleware ---------- */
const auth = wrap(async (req, res, next) => {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!token) throw new HttpError(401, 'Please log in.');
  const { data, error } = await client().auth.getUser(token);   // verified by Supabase
  if (error || !data.user) throw new HttpError(401, 'Session expired. Please log in again.');
  req.token = token; req.user = data.user; req.db = userClient(token);
  next();
});
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: { success: false, message: 'Too many attempts. Try again in 15 minutes.' } });

/* ---------- auth routes ---------- */
app.get('/api/health', (req, res) => ok(res, { status: 'up' }));

app.post('/api/register', limiter, wrap(async (req, res) => {
  const b = parse(registerSchema, req.body);
  const { data, error } = await client().auth.signUp({ email: b.email, password: b.password, options: { data: { name: b.name } } });
  if (error) throw authErr(error);
  if (data.user?.identities?.length === 0) throw new HttpError(409, 'This email is already registered.');
  if (!data.session) return ok(res, { needsConfirmation: true, message: 'Account created. Check your email to confirm, then log in.' }, 201);
  ok(res, sessionPayload(data.session, data.user), 201);
}));

app.post('/api/login', limiter, wrap(async (req, res) => {
  const b = parse(loginSchema, req.body);
  const { data, error } = await client().auth.signInWithPassword(b);
  if (error) throw authErr(error);
  await userClient(data.session.access_token).rpc('record_login');   // updates login stats
  ok(res, sessionPayload(data.session, data.user));
}));

app.post('/api/refresh', limiter, wrap(async (req, res) => {
  const { refresh_token } = parse(z.object({ refresh_token: z.string().min(10).max(500) }), req.body);
  const { data, error } = await client().auth.refreshSession({ refresh_token });
  if (error || !data.session) throw new HttpError(401, 'Session expired. Please log in again.');
  ok(res, sessionPayload(data.session, data.user));
}));

app.post('/api/logout', auth, wrap(async (req, res) => {
  // Revokes this session's refresh token at Supabase (scope=local = this device only)
  await fetch(`${URL}/auth/v1/logout?scope=local`, { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + req.token } }).catch(() => {});
  ok(res, { message: 'Logged out.' });
}));

/* ---------- profile ---------- */
const profileOut = (p, u) => ({ name: p.name, email: u.email, loginCount: p.login_count, lastLogin: p.last_login, createdAt: p.created_at });
app.get('/api/me', auth, wrap(async (req, res) => {
  const { data, error } = await req.db.from('profiles').select('name,created_at,last_login,login_count').eq('id', req.user.id).maybeSingle();
  if (error) throw dbErr(error);
  if (!data) throw new HttpError(404, 'Profile not found.');
  ok(res, { user: profileOut(data, req.user) });
}));
app.patch('/api/me', auth, wrap(async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(2).max(60) }), req.body);
  const { data, error } = await req.db.from('profiles').update({ name: b.name }).eq('id', req.user.id)
    .select('name,created_at,last_login,login_count').maybeSingle();
  if (error) throw dbErr(error);
  if (!data) throw new HttpError(404, 'Profile not found.');
  ok(res, { user: profileOut(data, req.user) });
}));

/* ---------- simulation runs: CRUD (RLS limits every query to the caller's rows) ---------- */
app.get('/api/runs', auth, wrap(async (req, res) => {
  const { limit, offset } = parse(pageSchema, req.query);
  const { data, error, count } = await req.db.from('simulation_runs').select('*', { count: 'exact' })
    .order('created_at', { ascending: false }).range(offset, offset + limit - 1);
  if (error) throw dbErr(error);
  ok(res, { runs: data, count });
}));
app.post('/api/runs', auth, wrap(async (req, res) => {
  const { data, error } = await req.db.from('simulation_runs').insert(parse(runSchema, req.body)).select().single();
  if (error) throw dbErr(error);
  ok(res, { run: data }, 201);
}));
app.get('/api/runs/:id', auth, wrap(async (req, res) => {
  const id = parse(idSchema, req.params.id);
  const { data, error } = await req.db.from('simulation_runs').select('*').eq('id', id).maybeSingle();
  if (error) throw dbErr(error);
  if (!data) throw new HttpError(404, 'Run not found.');
  ok(res, { run: data });
}));
app.patch('/api/runs/:id', auth, wrap(async (req, res) => {
  const id = parse(idSchema, req.params.id), patch = parse(patchRun, req.body);
  const { data, error } = await req.db.from('simulation_runs').update(patch).eq('id', id).select().maybeSingle();
  if (error) throw dbErr(error);
  if (!data) throw new HttpError(404, 'Run not found.');
  ok(res, { run: data });
}));
app.delete('/api/runs/:id', auth, wrap(async (req, res) => {
  const id = parse(idSchema, req.params.id);
  const { data, error } = await req.db.from('simulation_runs').delete().eq('id', id).select('id');
  if (error) throw dbErr(error);
  if (!data.length) throw new HttpError(404, 'Run not found.');
  ok(res, { message: 'Deleted.' });
}));

/* ---------- errors ---------- */
app.use('/api', (req, res) => res.status(404).json({ success: false, message: 'Not found.' }));
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.code).json({ success: false, message: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ success: false, message: 'Invalid JSON.' });
  console.error(err);
  res.status(500).json({ success: false, message: 'Server error. Try again.' });
});
app.listen(process.env.PORT || 5000, () => console.log('Running on http://localhost:' + (process.env.PORT || 5000)));
