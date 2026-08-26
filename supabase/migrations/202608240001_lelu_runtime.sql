-- LÉLU runtime persistence. Apply through Supabase migrations.
-- Browser writes are scoped by auth.uid(); no service-role key is used.

create extension if not exists pgcrypto;

create table if not exists public.memory_items (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  memory_type text not null default 'user',
  prompt text not null,
  response text not null,
  keywords text[] not null default '{}',
  context jsonb not null default '{}'::jsonb,
  importance real not null default 0.5,
  confidence real not null default 0.5,
  successful_uses integer not null default 0,
  failed_uses integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id, user_id)
);

create table if not exists public.conversations (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  project_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id, user_id)
);

create table if not exists public.messages (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id text not null,
  role text not null check (role in ('user', 'assistant')),
  text text not null,
  provider text,
  confidence real,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (id, user_id),
  constraint messages_conversation_owner foreign key (conversation_id, user_id)
    references public.conversations(id, user_id) on delete cascade
);

create table if not exists public.projects (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text not null default '',
  status text not null,
  agent_ids text[] not null default '{}',
  items jsonb not null default '[]'::jsonb,
  queries text[] not null default '{}',
  schedule jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id, user_id)
);

create table if not exists public.agents (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  role text not null default '',
  status text not null,
  enabled boolean not null default true,
  project_id text,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (id, user_id)
);

create table if not exists public.proactive_questions (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  question text not null,
  question_key text not null,
  category text not null,
  reason text not null,
  priority text not null,
  related_project_id text,
  related_task text,
  blocks_execution boolean not null default false,
  remember_answer boolean not null default true,
  status text not null,
  user_response text,
  asked_at timestamptz not null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id, user_id),
  unique (user_id, question_key)
);

create table if not exists public.ui_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.cognitive_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  task_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.api_health (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  status text not null,
  latency_ms integer,
  details jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default now(),
  primary key (user_id, provider)
);

create table if not exists public.user_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  preference_key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, preference_key)
);

create table if not exists public.improvement_items (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (id, user_id)
);

create table if not exists public.news_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  topics text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.knowledge_items (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  domain text not null,
  detail text not null,
  source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id, user_id)
);

create index if not exists memory_items_user_updated_idx on public.memory_items(user_id, updated_at desc);
create index if not exists projects_user_updated_idx on public.projects(user_id, updated_at desc);
create index if not exists agents_user_updated_idx on public.agents(user_id, updated_at desc);
create index if not exists questions_user_status_idx on public.proactive_questions(user_id, status, updated_at desc);
create index if not exists events_user_created_idx on public.cognitive_events(user_id, created_at desc);

alter table public.memory_items enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.projects enable row level security;
alter table public.agents enable row level security;
alter table public.proactive_questions enable row level security;
alter table public.ui_state enable row level security;
alter table public.cognitive_events enable row level security;
alter table public.api_health enable row level security;
alter table public.user_preferences enable row level security;
alter table public.improvement_items enable row level security;
alter table public.news_preferences enable row level security;
alter table public.knowledge_items enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'memory_items', 'conversations', 'messages', 'projects', 'agents',
    'proactive_questions', 'ui_state', 'cognitive_events', 'api_health',
    'user_preferences', 'improvement_items', 'news_preferences', 'knowledge_items'
  ] loop
    execute format('drop policy if exists %I on public.%I', table_name || '_owner', table_name);
    execute format(
      'create policy %I on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
      table_name || '_owner', table_name
    );
  end loop;
end $$;

-- Only meaningful state transitions are subscribed to by the browser.
do $$
begin
  begin alter publication supabase_realtime add table public.projects; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.agents; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.proactive_questions; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.ui_state; exception when duplicate_object then null; end;
end $$;

-- Keep the event stream bounded on the free tier.
create or replace function public.trim_lelu_events() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.cognitive_events
  where user_id = new.user_id
    and id in (
      select id from public.cognitive_events
      where user_id = new.user_id
      order by created_at desc
      offset 500
    );
  return new;
end;
$$;

drop trigger if exists trim_lelu_events on public.cognitive_events;
create trigger trim_lelu_events after insert on public.cognitive_events
for each row execute function public.trim_lelu_events();
