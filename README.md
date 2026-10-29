# ThermaCharge AI – Express + Supabase backend

Browser → `public/*.js` → Express `/api/*` → Supabase (Auth + PostgreSQL with RLS).

## 1. Supabase setup
1. supabase.com → New project.
2. **SQL Editor** → paste all of `supabase/schema.sql` → Run (tables, trigger, RLS, permissions).
3. **Authentication → Providers → Email**: for local testing turn **Confirm email OFF** (turn ON in production; sign-up then returns "check your email").
4. **Project Settings → API**: copy the Project URL and the **anon/publishable** key.

## 2. Run locally
```
cp .env.example .env        # fill SUPABASE_URL and SUPABASE_ANON_KEY
npm install
npm start                   # http://localhost:5000
npm test                    # in a 2nd terminal: runs the integration tests
```

## 3. Security model
- Only the **anon** key is used, and only in the backend `.env`. The `service_role` key is never used or needed. Never put it in frontend code.
- The backend calls Supabase **as the logged-in user** (their JWT), so Postgres **RLS** decides access: every policy is `user_id = auth.uid()`. Other users' rows return 404.
- `profiles.name` and `simulation_runs.name/notes` are the only columns users may update (column-level grants). `user_id` is set by the database and cannot be spoofed. `anon` role has no table access.
- Passwords are handled by Supabase Auth (never stored by us). Input is validated with zod; login/register are rate-limited.

## 4. API (all JSON, `{success, ...}`)
| Method | Route | Auth | Purpose |
|---|---|---|---|
| POST | /api/register | – | name, email, password (min 8) |
| POST | /api/login | – | returns token, refresh_token, user |
| POST | /api/refresh | – | refresh_token → new tokens |
| POST | /api/logout | Bearer | revokes session |
| GET/PATCH | /api/me | Bearer | profile |
| GET/POST | /api/runs | Bearer | list (?limit&offset) / create |
| GET/PATCH/DELETE | /api/runs/:id | Bearer | read / rename+notes / delete |

## 5. Deploy
Backend on Render or Railway (Node 18+): build `npm install`, start `npm start`, add env vars `SUPABASE_URL`, `SUPABASE_ANON_KEY` (and `CLIENT_ORIGIN` if the frontend is on another domain). The server also serves `public/`. If the frontend is hosted separately, set `window.API_BASE='https://your-api'` before `api.js`/`app.js`. In Supabase → Authentication → URL Configuration, set Site URL to your deployed URL. Turn email confirmation ON for production.
