-- LÉLU usage accounting and budget enforcement (Phase 9).
--
--   usage_records       append-only ledger of AI and knowledge-source calls,
--                       one row per call, owned by the signed-in user.
--   usage_budgets       per-user caps (requests / tokens / reported cost),
--                       per provider or source, or '*' for every one of a kind.
--   usage_reservations  in-flight calls. Written ONLY by the functions below,
--                       so a client cannot reserve around a cap or delete a
--                       reservation that is holding budget.
--
-- Honesty rules carried into the schema:
--   • token columns are NULL when the provider reported none (never 0);
--   • cost_usd is set only for cost_kind = 'reported'; 'unknown' keeps it NULL;
--   • nothing here estimates a token count or a price.
--
-- Concurrency: reserve_usage / settle_usage / release_usage all take the
-- same transaction-scoped advisory lock per (user, kind), so "count used +
-- reserved, then reserve" is atomic against every other call of that user.

create table if not exists public.usage_records (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null check (length(id) between 8 and 80),
  kind text not null check (kind in ('ai', 'api')),
  source text not null check (length(source) between 1 and 120),
  model text check (length(model) <= 200),
  operation text check (length(operation) <= 60),
  ok boolean not null,
  rate_limited boolean not null default false,
  latency_ms integer check (latency_ms >= 0),
  results integer check (results >= 0),
  input_tokens bigint check (input_tokens >= 0),
  output_tokens bigint check (output_tokens >= 0),
  cached_input_tokens bigint check (cached_input_tokens >= 0),
  reasoning_tokens bigint check (reasoning_tokens >= 0),
  cost_usd numeric(14, 8) check (cost_usd >= 0),
  cost_kind text not null check (cost_kind in ('reported', 'unknown')),
  error text check (length(error) <= 200),
  reservation_id text,
  occurred_at timestamptz not null check (occurred_at < now() + interval '1 day'),
  recorded_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint usage_records_cost_consistent check ((cost_kind = 'reported') = (cost_usd is not null))
);

create index if not exists usage_records_user_time on public.usage_records (user_id, occurred_at desc);
create index if not exists usage_records_user_kind_source_time on public.usage_records (user_id, kind, source, occurred_at desc);

create table if not exists public.usage_budgets (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('ai', 'api')),
  source text not null check (length(source) between 1 and 120),
  daily_requests integer check (daily_requests > 0),
  monthly_requests integer check (monthly_requests > 0),
  daily_tokens bigint check (daily_tokens > 0),
  monthly_tokens bigint check (monthly_tokens > 0),
  daily_cost_usd numeric(12, 4) check (daily_cost_usd > 0),
  monthly_cost_usd numeric(12, 4) check (monthly_cost_usd > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, source)
);

create table if not exists public.usage_reservations (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (length(id) between 8 and 80),
  kind text not null check (kind in ('ai', 'api')),
  source text not null,
  reserved_requests integer not null default 1 check (reserved_requests >= 0),
  reserved_tokens bigint not null default 0 check (reserved_tokens >= 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (user_id, id)
);

create index if not exists usage_reservations_user_kind on public.usage_reservations (user_id, kind, source);

-- ---------------- row level security ----------------

alter table public.usage_records enable row level security;
alter table public.usage_budgets enable row level security;
alter table public.usage_reservations enable row level security;

drop policy if exists usage_records_select_own on public.usage_records;
create policy usage_records_select_own on public.usage_records
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists usage_records_insert_own on public.usage_records;
create policy usage_records_insert_own on public.usage_records
  for insert to authenticated with check ((select auth.uid()) = user_id);
-- No update or delete policy: a record, once written, cannot be rewritten or
-- removed by the client, so spent budget cannot be "refunded" by editing it.

drop policy if exists usage_budgets_owner on public.usage_budgets;
create policy usage_budgets_owner on public.usage_budgets
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists usage_reservations_select_own on public.usage_reservations;
create policy usage_reservations_select_own on public.usage_reservations
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.usage_records, public.usage_budgets, public.usage_reservations from anon;
revoke update, delete, truncate on public.usage_records from authenticated;
revoke insert, update, delete, truncate on public.usage_reservations from authenticated;
grant select, insert on public.usage_records to authenticated;
grant select, insert, update, delete on public.usage_budgets to authenticated;
grant select on public.usage_reservations to authenticated;

-- ---------------- aggregation views (caller's RLS applies) ----------------

create or replace view public.usage_daily with (security_invoker = true) as
select
  user_id,
  (occurred_at at time zone 'utc')::date as day,
  kind,
  source,
  count(*) as requests,
  count(*) filter (where ok) as ok_requests,
  count(*) filter (where not ok) as failed_requests,
  count(*) filter (where rate_limited) as rate_limited_requests,
  count(*) filter (where input_tokens is not null or output_tokens is not null) as token_reported_requests,
  sum(input_tokens) as input_tokens,
  sum(output_tokens) as output_tokens,
  sum(cached_input_tokens) as cached_input_tokens,
  sum(reasoning_tokens) as reasoning_tokens,
  sum(cost_usd) as reported_cost_usd,
  count(*) filter (where cost_kind = 'unknown') as unknown_cost_requests,
  sum(latency_ms) as total_latency_ms
from public.usage_records
group by user_id, day, kind, source;

create or replace view public.usage_monthly with (security_invoker = true) as
select
  user_id,
  date_trunc('month', day)::date as month,
  kind,
  source,
  sum(requests)::bigint as requests,
  sum(ok_requests)::bigint as ok_requests,
  sum(failed_requests)::bigint as failed_requests,
  sum(rate_limited_requests)::bigint as rate_limited_requests,
  sum(token_reported_requests)::bigint as token_reported_requests,
  sum(input_tokens)::bigint as input_tokens,
  sum(output_tokens)::bigint as output_tokens,
  sum(cached_input_tokens)::bigint as cached_input_tokens,
  sum(reasoning_tokens)::bigint as reasoning_tokens,
  sum(reported_cost_usd) as reported_cost_usd,
  sum(unknown_cost_requests)::bigint as unknown_cost_requests,
  sum(total_latency_ms)::bigint as total_latency_ms
from public.usage_daily
group by user_id, month, kind, source;

revoke all on public.usage_daily, public.usage_monthly from anon;
grant select on public.usage_daily, public.usage_monthly to authenticated;

-- ---------------- reservation functions ----------------

-- Reserve one call against every budget that covers (kind, source).
-- Returns {allowed, reservation, reason?, warnings[], usage}. Idempotent on
-- p_id: retrying the same reservation never reserves twice.
create or replace function public.reserve_usage(
  p_id text,
  p_kind text,
  p_source text,
  p_reserve_tokens bigint default 0,
  p_ttl_seconds integer default 600
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  day_start timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  month_start timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  b record;
  d_req bigint; d_tok bigint; d_cost numeric; d_unknown bigint;
  m_req bigint; m_tok bigint; m_cost numeric; m_unknown bigint;
  r_req bigint; r_tok bigint;
  warnings text[] := '{}';
  scope text;
begin
  if uid is null then
    raise exception 'reserve_usage: not authenticated' using errcode = '28000';
  end if;
  if p_kind not in ('ai', 'api') or p_source is null or length(p_source) not between 1 and 120
     or p_id is null or length(p_id) not between 8 and 80
     or p_reserve_tokens is null or p_reserve_tokens < 0
     or p_ttl_seconds not between 30 and 3600 then
    raise exception 'reserve_usage: invalid arguments' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(uid::text || ':' || p_kind, 0));

  delete from public.usage_reservations where user_id = uid and expires_at < now();

  if exists (select 1 from public.usage_reservations where user_id = uid and id = p_id) then
    return jsonb_build_object('allowed', true, 'reservation', p_id, 'replayed', true, 'warnings', '[]'::jsonb);
  end if;

  for b in
    select * from public.usage_budgets
    where user_id = uid and kind = p_kind and source in (p_source, '*')
    order by source desc
  loop
    scope := case when b.source = '*' then 'all ' || p_kind || ' providers' else p_source end;

    select count(*),
           coalesce(sum(coalesce(input_tokens, 0) + coalesce(output_tokens, 0)), 0),
           coalesce(sum(cost_usd), 0),
           count(*) filter (where cost_kind = 'unknown')
      into d_req, d_tok, d_cost, d_unknown
      from public.usage_records
     where user_id = uid and kind = p_kind and (b.source = '*' or source = p_source) and occurred_at >= day_start;

    select count(*),
           coalesce(sum(coalesce(input_tokens, 0) + coalesce(output_tokens, 0)), 0),
           coalesce(sum(cost_usd), 0),
           count(*) filter (where cost_kind = 'unknown')
      into m_req, m_tok, m_cost, m_unknown
      from public.usage_records
     where user_id = uid and kind = p_kind and (b.source = '*' or source = p_source) and occurred_at >= month_start;

    select coalesce(sum(reserved_requests), 0), coalesce(sum(reserved_tokens), 0)
      into r_req, r_tok
      from public.usage_reservations
     where user_id = uid and kind = p_kind and (b.source = '*' or source = p_source);

    if b.daily_requests is not null and d_req + r_req + 1 > b.daily_requests then
      return jsonb_build_object('allowed', false, 'limit', 'daily_requests', 'scope', scope,
        'reason', format('%s: daily request budget reached (%s used + %s in flight of %s).', scope, d_req, r_req, b.daily_requests));
    end if;
    if b.monthly_requests is not null and m_req + r_req + 1 > b.monthly_requests then
      return jsonb_build_object('allowed', false, 'limit', 'monthly_requests', 'scope', scope,
        'reason', format('%s: monthly request budget reached (%s used + %s in flight of %s).', scope, m_req, r_req, b.monthly_requests));
    end if;
    if b.daily_tokens is not null and (d_tok + r_tok >= b.daily_tokens or d_tok + r_tok + p_reserve_tokens > b.daily_tokens) then
      return jsonb_build_object('allowed', false, 'limit', 'daily_tokens', 'scope', scope,
        'reason', format('%s: daily token budget reached (%s reported + %s reserved of %s).', scope, d_tok, r_tok + p_reserve_tokens, b.daily_tokens));
    end if;
    if b.monthly_tokens is not null and (m_tok + r_tok >= b.monthly_tokens or m_tok + r_tok + p_reserve_tokens > b.monthly_tokens) then
      return jsonb_build_object('allowed', false, 'limit', 'monthly_tokens', 'scope', scope,
        'reason', format('%s: monthly token budget reached (%s reported + %s reserved of %s).', scope, m_tok, r_tok + p_reserve_tokens, b.monthly_tokens));
    end if;
    -- Cost caps count REPORTED cost only; an unknown cost is never estimated.
    if b.daily_cost_usd is not null and d_cost >= b.daily_cost_usd then
      return jsonb_build_object('allowed', false, 'limit', 'daily_cost_usd', 'scope', scope,
        'reason', format('%s: daily spending budget reached ($%s reported of $%s).', scope, round(d_cost, 4), b.daily_cost_usd));
    end if;
    if b.monthly_cost_usd is not null and m_cost >= b.monthly_cost_usd then
      return jsonb_build_object('allowed', false, 'limit', 'monthly_cost_usd', 'scope', scope,
        'reason', format('%s: monthly spending budget reached ($%s reported of $%s).', scope, round(m_cost, 4), b.monthly_cost_usd));
    end if;
    if (b.daily_cost_usd is not null and d_unknown > 0) or (b.monthly_cost_usd is not null and m_unknown > 0) then
      warnings := warnings || format('%s: %s call(s) this month reported no cost; the spending cap counts reported cost only.', scope, m_unknown);
    end if;
  end loop;

  insert into public.usage_reservations (user_id, id, kind, source, reserved_requests, reserved_tokens, expires_at)
  values (uid, p_id, p_kind, p_source, 1, p_reserve_tokens, now() + make_interval(secs => p_ttl_seconds));

  return jsonb_build_object('allowed', true, 'reservation', p_id, 'warnings', to_jsonb(warnings));
end;
$$;

-- Replace a reservation with the call's actual record (provider-reported
-- usage). Idempotent: settling twice writes one record.
create or replace function public.settle_usage(p_reservation_id text, p_record jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  r public.usage_reservations%rowtype;
begin
  if uid is null then
    raise exception 'settle_usage: not authenticated' using errcode = '28000';
  end if;
  if coalesce(p_record->>'kind', '') not in ('ai', 'api') or p_reservation_id is null then
    raise exception 'settle_usage: invalid arguments' using errcode = '22023';
  end if;
  -- Lock BEFORE reading the reservation, so the read and the swap
  -- (insert record, delete reservation) are one step for reserve_usage.
  perform pg_advisory_xact_lock(hashtextextended(uid::text || ':' || (p_record->>'kind'), 0));
  select * into r from public.usage_reservations where user_id = uid and id = p_reservation_id;

  insert into public.usage_records (
    user_id, id, kind, source, model, operation, ok, rate_limited, latency_ms, results,
    input_tokens, output_tokens, cached_input_tokens, reasoning_tokens, cost_usd, cost_kind,
    error, reservation_id, occurred_at
  ) values (
    uid,
    p_reservation_id,
    coalesce(r.kind, p_record->>'kind'),
    coalesce(r.source, p_record->>'source'),
    p_record->>'model',
    p_record->>'operation',
    coalesce((p_record->>'ok')::boolean, false),
    coalesce((p_record->>'rate_limited')::boolean, false),
    (p_record->>'latency_ms')::integer,
    (p_record->>'results')::integer,
    (p_record->>'input_tokens')::bigint,
    (p_record->>'output_tokens')::bigint,
    (p_record->>'cached_input_tokens')::bigint,
    (p_record->>'reasoning_tokens')::bigint,
    (p_record->>'cost_usd')::numeric,
    coalesce(p_record->>'cost_kind', 'unknown'),
    left(p_record->>'error', 200),
    p_reservation_id,
    coalesce((p_record->>'occurred_at')::timestamptz, now())
  ) on conflict (user_id, id) do nothing;

  delete from public.usage_reservations where user_id = uid and id = p_reservation_id;
end;
$$;

-- A call that never reached the provider: give the reservation back.
create or replace function public.release_usage(p_reservation_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  k text;
begin
  if uid is null then
    raise exception 'release_usage: not authenticated' using errcode = '28000';
  end if;
  select kind into k from public.usage_reservations where user_id = uid and id = p_reservation_id;
  if k is null then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text || ':' || k, 0));
  delete from public.usage_reservations where user_id = uid and id = p_reservation_id;
end;
$$;

revoke execute on function public.reserve_usage(text, text, text, bigint, integer) from public, anon;
revoke execute on function public.settle_usage(text, jsonb) from public, anon;
revoke execute on function public.release_usage(text) from public, anon;
grant execute on function public.reserve_usage(text, text, text, bigint, integer) to authenticated;
grant execute on function public.settle_usage(text, jsonb) to authenticated;
grant execute on function public.release_usage(text) to authenticated;
