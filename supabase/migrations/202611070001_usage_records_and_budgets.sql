-- LÉLU usage accounting and budget enforcement (Phase 9).
-- Applied to lelu-v11-test as migration "usage_records_budgets_reservations".
--
--   usage_records       append-only ledger of AI and knowledge-source calls,
--                       one row per call, owned by the signed-in user.
--                       No update or delete policy: spent budget cannot be
--                       "refunded" by editing or removing a record.
--   usage_budgets       per-user caps (requests / tokens / reported cost),
--                       per provider or source, or '*' for every one of a kind.
--   usage_reservations  in-flight calls. A device INSERTS its reservation,
--                       then ranks it by the database clock (created_at =
--                       clock_timestamp()) among live reservations, and
--                       proceeds only if used + earlier reservations + 1 fits
--                       the cap (src/core/observability/UsageSync.ts). A later
--                       insert always ranks after an earlier check, so two
--                       devices can never both take the last unit; the worst
--                       case is that both refuse.
--
-- Honesty rules carried into the schema:
--   • token columns are NULL when the provider reported none (never 0);
--   • cost_usd is set only for cost_kind = 'reported'; 'unknown' keeps it NULL;
--   • nothing here estimates a token count or a price.
--
-- No SECURITY DEFINER functions: every read and write runs as the user,
-- under these policies.

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
  occurred_at timestamptz not null,
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
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null check (length(id) between 8 and 80),
  kind text not null check (kind in ('ai', 'api')),
  source text not null check (length(source) between 1 and 120),
  reserved_tokens bigint not null default 0 check (reserved_tokens >= 0),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '10 minutes'),
  primary key (user_id, id)
);
create index if not exists usage_reservations_user_kind_time on public.usage_reservations (user_id, kind, created_at);

alter table public.usage_records enable row level security;
alter table public.usage_budgets enable row level security;
alter table public.usage_reservations enable row level security;

create policy usage_records_select_own on public.usage_records for select to authenticated using ((select auth.uid()) = user_id);
create policy usage_records_insert_own on public.usage_records for insert to authenticated with check ((select auth.uid()) = user_id);
create policy usage_budgets_owner on public.usage_budgets for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy usage_reservations_select_own on public.usage_reservations for select to authenticated using ((select auth.uid()) = user_id);
create policy usage_reservations_insert_own on public.usage_reservations for insert to authenticated with check ((select auth.uid()) = user_id);
create policy usage_reservations_remove_own on public.usage_reservations for delete to authenticated using ((select auth.uid()) = user_id);

grant select, insert on public.usage_records to authenticated;
grant select, insert, update, delete on public.usage_budgets to authenticated;
grant select, insert, delete on public.usage_reservations to authenticated;

create or replace view public.usage_daily with (security_invoker = true) as
select user_id, (occurred_at at time zone 'utc')::date as day, kind, source,
  count(*) as requests, count(*) filter (where ok) as ok_requests, count(*) filter (where not ok) as failed_requests,
  count(*) filter (where rate_limited) as rate_limited_requests,
  count(*) filter (where input_tokens is not null or output_tokens is not null) as token_reported_requests,
  sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens, sum(cached_input_tokens) as cached_input_tokens,
  sum(reasoning_tokens) as reasoning_tokens, sum(cost_usd) as reported_cost_usd,
  count(*) filter (where cost_kind = 'unknown') as unknown_cost_requests, sum(latency_ms) as total_latency_ms
from public.usage_records group by user_id, day, kind, source;

create or replace view public.usage_monthly with (security_invoker = true) as
select user_id, date_trunc('month', day)::date as month, kind, source,
  sum(requests)::bigint as requests, sum(ok_requests)::bigint as ok_requests, sum(failed_requests)::bigint as failed_requests,
  sum(rate_limited_requests)::bigint as rate_limited_requests, sum(token_reported_requests)::bigint as token_reported_requests,
  sum(input_tokens)::bigint as input_tokens, sum(output_tokens)::bigint as output_tokens,
  sum(cached_input_tokens)::bigint as cached_input_tokens, sum(reasoning_tokens)::bigint as reasoning_tokens,
  sum(reported_cost_usd) as reported_cost_usd, sum(unknown_cost_requests)::bigint as unknown_cost_requests,
  sum(total_latency_ms)::bigint as total_latency_ms
from public.usage_daily group by user_id, month, kind, source;

grant select on public.usage_daily, public.usage_monthly to authenticated;
