-- Security-closure validation — isolated fixture.
--
-- Recreates, in a THROWAWAY local Postgres, only what the five canonical
-- 2026-11-23 migrations touch: Supabase's API roles, a stub auth schema, and
-- the six public tables with the column shapes, RLS policies and table grants
-- read from production (nrehsldbfxthspikaxvr) on 2026-11-23. It is NOT
-- Supabase: auth.uid() is read from the request.jwt.claim.sub setting, the
-- same place PostgREST puts it, and supautils is absent.
--
-- Never run this file against a real project.

do $$ begin
  if current_database() not like 'lelu_security_closure%' then
    raise exception 'refusing to run: database % is not an isolated security-closure database', current_database();
  end if;
end $$;

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
grant anon, authenticated, service_role to current_user;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema public to anon, authenticated, service_role;
-- Supabase's default privileges: new tables and functions in public are granted
-- to every API role (production's ACLs show exactly this). The migrations then
-- have to revoke what they do not want exposed — which is what is under test.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create table public.projects (
  id text primary key, user_id uuid not null references auth.users(id), name text not null default '',
  description text not null default '', status text not null default 'active',
  agent_ids text[] not null default '{}', items jsonb not null default '[]', queries text[] not null default '{}',
  schedule jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'
);
create table public.conversations (
  id text primary key, user_id uuid not null references auth.users(id), title text not null default '',
  project_id text, metadata jsonb not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.knowledge_items (
  id text primary key, user_id uuid not null references auth.users(id), title text not null default '',
  domain text not null default '', detail text not null default '', source text, metadata jsonb not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.user_preferences (
  user_id uuid not null references auth.users(id), preference_key text not null, value jsonb not null default '{}',
  updated_at timestamptz not null default now(), primary key (user_id, preference_key)
);
create table public.memory_items (
  id text not null, user_id uuid not null references auth.users(id), category text not null default 'fact',
  memory_type text not null default 'semantic', prompt text not null default '', response text not null default '',
  keywords text[] not null default '{}', context jsonb not null default '{}', importance real not null default 0.5,
  confidence real not null default 0.5, successful_uses integer not null default 0, failed_uses integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

do $$ declare t text; begin
  foreach t in array array['projects','conversations','knowledge_items','user_preferences','memory_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t || '_owner', t);
    -- Production grants every API role all table privileges; RLS is the guard.
    execute format('grant all on public.%I to anon, authenticated, service_role', t);
  end loop;
end $$;

-- 20261123094147 revokes EXECUTE on this pre-existing trigger function.
create table public.cognitive_events (id bigserial primary key, created_at timestamptz not null default now());
create function public.trim_lelu_events() returns trigger language plpgsql security definer set search_path = public as $$
begin return new; end; $$;
create trigger trim_lelu_events after insert on public.cognitive_events for each row execute function public.trim_lelu_events();

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'synthetic-a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'synthetic-b@example.test');
