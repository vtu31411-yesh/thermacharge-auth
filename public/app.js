// Login / Register: Login button -> JS -> POST /api/login -> Node backend -> Supabase -> response -> dashboard
const API = window.API_BASE || '';           // same origin by default; set to your backend URL if hosted separately
let mode = 'login';
const $ = id => document.getElementById(id);

if (sessionStorage.getItem('token')) location.href = 'dashboard.html';

function setMode(m) {
  mode = m;
  $('nameRow').hidden = m === 'login';
  $('btn').textContent = m === 'login' ? 'Login' : 'Create account';
  $('sub').textContent = m === 'login' ? 'Log in to open your dashboard.' : 'Create your account.';
  $('password').autocomplete = m === 'login' ? 'current-password' : 'new-password';
  $('sw').innerHTML = m === 'login' ? 'New here? <a id="toggle" tabindex="0" role="button">Create an account</a>' : 'Have an account? <a id="toggle" tabindex="0" role="button">Login</a>';
  $('toggle').onclick = () => setMode(mode === 'login' ? 'register' : 'login');
  $('msg').className = 'msg';
}
$('toggle').onclick = () => setMode('register');

$('form').addEventListener('submit', async e => {
  e.preventDefault();
  const msg = $('msg'), btn = $('btn');
  const body = { email: $('email').value, password: $('password').value };
  if (mode === 'register') body.name = $('name').value;
  btn.disabled = true; btn.textContent = 'Please wait…'; msg.className = 'msg';
  try {
    const res = await fetch(API + '/api/' + mode, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || 'Something went wrong.');
    if (data.needsConfirmation) { msg.textContent = data.message; msg.className = 'msg ok'; btn.disabled = false; btn.textContent = 'Create account'; return; }
    sessionStorage.setItem('token', data.token);
    sessionStorage.setItem('refresh', data.refresh_token || '');
    location.href = 'dashboard.html';
  } catch (err) {
    msg.textContent = err.message === 'Failed to fetch' ? 'Cannot reach the server. Is the backend running?' : err.message;
    msg.className = 'msg err';
    btn.disabled = false; btn.textContent = mode === 'login' ? 'Login' : 'Create account';
  }
});
