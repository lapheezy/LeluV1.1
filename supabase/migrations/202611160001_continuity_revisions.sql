-- Mission 14.5 — atomic continuity revisions.
--
-- M14.4 conditioned writes on the client-supplied `updated_at` value. That
-- prevents most stale writes, but two clients can produce the same
-- millisecond timestamp, and a client can send a timestamp that does not
-- advance. `updated_at` is therefore a useful ordering fact, not a strict
-- compare-and-swap token.
--
-- This migration adds the strict token without introducing a new database,
-- table or persistence framework: a per-row monotonic revision on the four
-- existing authorities that continuity writes conditionally, plus a trigger
-- that owns both the revision and the server timestamp.
--
-- The continuity adapter reads the revision when present and falls back to
-- `updated_at` only for projects that have not applied this migration yet.
-- Apply this through the normal Supabase migration process.

alter table public.projects
  add column if not exists continuity_revision bigint not null default 1;

alter table public.conversations
  add column if not exists continuity_revision bigint not null default 1;

alter table public.knowledge_items
  add column if not exists continuity_revision bigint not null default 1;

alter table public.user_preferences
  add column if not exists continuity_revision bigint not null default 1;

-- The trigger is the only writer of the revision and the timestamp. A client
-- cannot fake a newer revision, repeat an old one, or preserve a stale
-- updated_at by sending it in the update payload.
create or replace function public.lelu_continuity_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.continuity_revision := 1;
  else
    new.continuity_revision := coalesce(old.continuity_revision, 1) + 1;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists lelu_continuity_touch on public.projects;
create trigger lelu_continuity_touch
  before insert or update on public.projects
  for each row execute function public.lelu_continuity_touch();

drop trigger if exists lelu_continuity_touch on public.conversations;
create trigger lelu_continuity_touch
  before insert or update on public.conversations
  for each row execute function public.lelu_continuity_touch();

drop trigger if exists lelu_continuity_touch on public.knowledge_items;
create trigger lelu_continuity_touch
  before insert or update on public.knowledge_items
  for each row execute function public.lelu_continuity_touch();

drop trigger if exists lelu_continuity_touch on public.user_preferences;
create trigger lelu_continuity_touch
  before insert or update on public.user_preferences
  for each row execute function public.lelu_continuity_touch();

comment on column public.projects.continuity_revision is
  'Monotonic per-row token owned by lelu_continuity_touch(); used for conditional continuity writes.';
comment on column public.conversations.continuity_revision is
  'Monotonic per-row token owned by lelu_continuity_touch(); used for conditional continuity writes.';
comment on column public.knowledge_items.continuity_revision is
  'Monotonic per-row token owned by lelu_continuity_touch(); used for conditional continuity writes.';
comment on column public.user_preferences.continuity_revision is
  'Monotonic per-row token owned by lelu_continuity_touch(); used for conditional continuity writes.';
