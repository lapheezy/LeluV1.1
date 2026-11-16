-- Recovered from production (migration 20261008130913,
-- add_proactive_question_lifecycle), which was applied directly to the
-- project and never committed. SupabasePersistence writes this column, so a
-- database built from the repository alone was missing it.
--
-- Additive only. Existing rows keep every value they have and gain an
-- empty lifecycle, which the client treats as "derive it from status" —
-- so a question dismissed before this migration stays dismissed.
alter table public.proactive_questions
  add column if not exists lifecycle jsonb not null default '{}'::jsonb;

comment on column public.proactive_questions.lifecycle is
  'Notification lifecycle: state, evidence fingerprint, surfaced/ignored/deferred counts, workstream id. Written by ProactiveCore; empty object means pre-lifecycle row.';
