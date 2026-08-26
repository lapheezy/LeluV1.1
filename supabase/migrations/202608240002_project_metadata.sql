-- LÉLU project metadata: structured request fields (full original
-- instruction, objective, context, actionable tasks, priority,
-- location, execution plan) round-trip through this jsonb column.
-- Apply through Supabase migrations alongside 202608240001.

alter table public.projects
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- The column is user-scoped like every other project field: RLS policies
-- on public.projects already restrict reads/writes to auth.uid().
comment on column public.projects.metadata is
  'Structured project request fields (originalRequest, objective, context, actionableTasks, priority, location, executionPlan). User-scoped via existing RLS.';
