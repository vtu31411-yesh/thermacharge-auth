// Integration test. Start the server first (npm start), then: npm test
// Needs email confirmation OFF in Supabase (Authentication -> Providers -> Email) for the test accounts to log in.
const BASE = process.env.BASE_URL || 'http://localhost:5000';
let pass = 0, fail = 0;
const call = async (method, path, { token, body } = {}) => {
  const r = await fetch(BASE + '/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let d = {}; try { d = await r.json(); } catch {} return { status: r.status, d };
};
const t = (name, cond) => { cond ? pass++ : fail++; console.log((cond ? 'PASS  ' : 'FAIL  ') + name); };
const run = { name: 'Test run', mode: 'ai', temp: 36, soc: 30, soh: 90, volt: 400, cur: 200, amb: 30, max_power: 120, rec_power: 85, pred_temp: 39.5, risk: 'MEDIUM', charge_time_min: 30, protection_score: 80, degradation_risk: 40 };

(async () => {
  const id0 = Math.random().toString(36).slice(2, 8), pw = 'Test-pass-123';
  const A = { name: 'Tester A', email: `tc_a_${id0}@example.com`, password: pw }, B = { name: 'Tester B', email: `tc_b_${id0}@example.com`, password: pw };
  let r = await call('GET', '/health'); t('health check', r.status === 200);
  r = await call('POST', '/register', { body: { name: 'x', email: 'bad', password: '1' } }); t('register: bad input -> 400', r.status === 400);
  r = await call('POST', '/register', { body: A });
  if (r.d.needsConfirmation) { console.log('Email confirmation is ON. Turn it off in Supabase for testing, then re-run.'); process.exit(1); }
  t('register A -> 201 + token', r.status === 201 && !!r.d.token);
  r = await call('POST', '/register', { body: A }); t('register: duplicate email -> 409', r.status === 409);
  r = await call('POST', '/register', { body: B }); t('register B', r.status === 201);
  r = await call('POST', '/login', { body: { email: A.email, password: 'wrong-password' } }); t('login: wrong password -> 401', r.status === 401);
  r = await call('POST', '/login', { body: A }); const ta = r.d.token, ra = r.d.refresh_token; t('login A', r.status === 200 && !!ta && !!ra);
  r = await call('POST', '/login', { body: B }); const tb = r.d.token;
  r = await call('GET', '/me'); t('/me without token -> 401', r.status === 401);
  r = await call('GET', '/me', { token: ta }); t('/me returns own profile', r.status === 200 && r.d.user.name === 'Tester A' && r.d.user.loginCount >= 1);
  r = await call('PATCH', '/me', { token: ta, body: { name: 'Tester A2' } }); t('update profile name', r.status === 200 && r.d.user.name === 'Tester A2');
  r = await call('POST', '/refresh', { body: { refresh_token: ra } }); t('refresh session', r.status === 200 && !!r.d.token);
  r = await call('POST', '/runs', { token: ta, body: { ...run, temp: 99 } }); t('create run: invalid data -> 400', r.status === 400);
  r = await call('POST', '/runs', { token: ta, body: run }); const id = r.d.run && r.d.run.id; t('create run -> 201', r.status === 201 && !!id);
  r = await call('POST', '/runs', { token: ta, body: { ...run, user_id: '00000000-0000-0000-0000-000000000000' } });
  t('user_id cannot be spoofed', r.status === 201 && r.d.run.user_id !== '00000000-0000-0000-0000-000000000000');
  r = await call('GET', '/runs', { token: ta }); t('list own runs', r.status === 200 && r.d.runs.length >= 2);
  r = await call('GET', '/runs', { token: tb }); t("RLS: B cannot see A's runs", r.status === 200 && r.d.runs.length === 0);
  r = await call('GET', '/runs/' + id, { token: tb }); t("RLS: B cannot read A's run -> 404", r.status === 404);
  r = await call('PATCH', '/runs/' + id, { token: tb, body: { name: 'hacked' } }); t("RLS: B cannot update A's run -> 404", r.status === 404);
  r = await call('DELETE', '/runs/' + id, { token: tb }); t("RLS: B cannot delete A's run -> 404", r.status === 404);
  r = await call('GET', '/runs/not-a-uuid', { token: ta }); t('bad id -> 400', r.status === 400);
  r = await call('GET', '/runs/' + id, { token: ta }); t('read own run', r.status === 200 && r.d.run.name === 'Test run');
  r = await call('PATCH', '/runs/' + id, { token: ta, body: { name: 'Renamed', notes: 'hello' } }); t('update own run', r.status === 200 && r.d.run.name === 'Renamed');
  r = await call('DELETE', '/runs/' + id, { token: ta }); t('delete own run', r.status === 200);
  r = await call('GET', '/runs/' + id, { token: ta }); t('deleted run -> 404', r.status === 404);
  r = await call('POST', '/logout', { token: ta }); t('logout', r.status === 200);
  r = await call('POST', '/refresh', { body: { refresh_token: ra } }); t('refresh token revoked after logout', r.status === 401);
  console.log(`\n${pass} passed, ${fail} failed. (Test users remain in Supabase -> Authentication -> Users; delete them there.)`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('Cannot reach server:', e.message); process.exit(1); });
