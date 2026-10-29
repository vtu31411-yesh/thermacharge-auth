// Shared API helper: sends the token and silently refreshes an expired session once.
const API = window.API_BASE || '';
async function api(path, opt = {}) {
  const send = () => fetch(API + '/api' + path, {
    method: opt.method || 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + sessionStorage.getItem('token') },
    body: opt.body ? JSON.stringify(opt.body) : undefined
  });
  let r = await send();
  const rt = sessionStorage.getItem('refresh');
  if (r.status === 401 && rt) {
    const rr = await fetch(API + '/api/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: rt }) });
    if (rr.ok) { const d = await rr.json(); sessionStorage.setItem('token', d.token); sessionStorage.setItem('refresh', d.refresh_token); r = await send(); }
  }
  if (r.status === 401) { sessionStorage.clear(); location.href = 'index.html'; throw new Error('Session expired. Please log in again.'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.success === false) throw new Error(d.message || 'Request failed.');
  return d;
}
