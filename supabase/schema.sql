-- ThermaCharge AI: run this whole file once in Supabase -> SQL Editor.

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 60),
  created_at  timestamptz not null default now(),
  last_login  timestamptz,
  login_count int not null default 0
);

create table public.simulation_runs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name             text not null check (char_length(name) between 1 and 80),
  mode             text not null check (mode in ('ai','fast')),
  temp             numeric not null check (temp between 15 and 60),
  soc              numeric not null check (soc between 0 and 100),
  soh              numeric not null check (soh between 50 and 100),
  volt             numeric not null check (volt between 300 and 500),
  cur              numeric not null check (cur between 0 and 400),
  amb              numeric not null check (amb between 10 and 50),
  max_power        numeric not null check (max_power between 20 and 200),
  rec_power        numeric not null check (rec_power between 0 and 200),
  pred_temp        numeric not null check (pred_temp between 0 and 100),
  risk             text not null check (risk in ('LOW','MEDIUM','HIGH','CRITICAL')),
  charge_time_min  numeric check (charge_time_min >= 0),
  protection_score numeric check (protection_score between 0 and 100),
  degradation_risk numeric check (degradation_risk between 0 and 100),
  notes            text check (char_length(notes) <= 500),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index simulation_runs_user_idx on public.simulation_runs (user_id, created_at desc);

-- keep updated_at fresh
create function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger runs_touch before update on public.simulation_runs
  for each row execute function public.touch_updated_at();

-- create a profile automatically when someone signs up
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, name)
  values (new.id, left(coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1)), 60));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- users cannot edit login stats directly; this function does it safely
create function public.record_login() returns void
language sql security definer set search_path = '' as $$
  update public.profiles set last_login = now(), login_count = login_count + 1 where id = auth.uid();
$$;
revoke all on function public.record_login() from public, anon;
grant execute on function public.record_login() to authenticated;

-- ===== Row Level Security =====
alter table public.profiles        enable row level security;
alter table public.simulation_runs enable row level security;

create policy profiles_select_own on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy runs_select_own on public.simulation_runs for select to authenticated
  using (user_id = (select auth.uid()));
create policy runs_insert_own on public.simulation_runs for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy runs_update_own on public.simulation_runs for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy runs_delete_own on public.simulation_runs for delete to authenticated
  using (user_id = (select auth.uid()));

-- least privilege: anonymous visitors get nothing; users get only what the app needs
revoke all on public.profiles, public.simulation_runs from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (name) on public.profiles to authenticated;
grant select, insert, delete on public.simulation_runs to authenticated;
grant update (name, notes) on public.simulation_runs to authenticated;
