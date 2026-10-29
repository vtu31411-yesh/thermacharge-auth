// Supabase clients. Only the ANON key is used: the service_role key is never needed or loaded.
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_ANON_KEY;
if (!URL || !KEY) { console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env'); process.exit(1); }

const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
// A NEW client per operation, so one user's session can never leak into another request.
const client = () => createClient(URL, KEY, opts);
// Acts as the logged-in user: Postgres RLS then enforces what they can see.
const userClient = token => createClient(URL, KEY, { ...opts, global: { headers: { Authorization: 'Bearer ' + token } } });

module.exports = { client, userClient, URL, KEY };
