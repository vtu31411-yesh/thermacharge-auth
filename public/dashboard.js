// Dashboard: loads profile + saved runs (create/read/update/delete) through the Express/Supabase API.
const $ = id => document.getElementById(id);
const out = () => { sessionStorage.clear(); location.href = 'index.html'; };
if (!sessionStorage.getItem('token')) out();
$('logout').onclick = async () => { try { await api('/logout', { method: 'POST' }); } catch (e) {} out(); };

const fmt = iso => (iso ? new Date(iso).toLocaleString() : '—');
const show = (m, cls = 'err') => { $('msg').textContent = m; $('msg').className = 'msg ' + cls; };
function el(tag, text, cls) { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; }  // textContent = safe from HTML injection

async function loadMe() {
  const { user: u } = await api('/me');
  $('hello').textContent = 'Welcome, ' + u.name;
  $('stats').replaceChildren(...[['Email', u.email], ['Total logins', u.loginCount], ['Last login', fmt(u.lastLogin)], ['Member since', fmt(u.createdAt)]]
    .map(([k, v]) => { const s = el('div', null, 'stat'); s.append(el('small', k), el('div', v)); return s; }));
}
async function loadRuns() {
  const { runs } = await api('/runs'), box = $('runs');
  box.replaceChildren();
  if (!runs.length) { box.append(el('p', 'No saved runs yet. Open the simulator and press Save Run.', 'k')); return; }
  runs.forEach(r => {
    const row = el('div', null, 'run'), info = el('div'), acts = el('div', null, 'acts');
    info.append(el('b', r.name), el('div', `${r.mode === 'fast' ? 'Fast' : 'AI'} · ${r.rec_power} kW · ${r.pred_temp}°C · ${r.risk} · ${fmt(r.created_at)}`, 'k'));
    const ren = el('button', 'Rename', 'sm ghost'), del = el('button', 'Delete', 'sm ghost');
    ren.onclick = async () => { const n = prompt('New name', r.name); if (n && n.trim()) try { await api('/runs/' + r.id, { method: 'PATCH', body: { name: n } }); loadRuns(); } catch (e) { show(e.message); } };
    del.onclick = async () => { if (confirm('Delete this run?')) try { await api('/runs/' + r.id, { method: 'DELETE' }); loadRuns(); } catch (e) { show(e.message); } };
    acts.append(ren, del); row.append(info, acts); box.append(row);
  });
}
(async () => {
  try { await loadMe(); await loadRuns(); }
  catch (e) { $('hello').textContent = 'Dashboard'; show(e.message === 'Failed to fetch' ? 'Cannot reach the server. Is the backend running?' : e.message); }
})();
