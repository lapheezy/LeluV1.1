-- LÉLU M22.7 — server-side deletion evidence for `memory_items`.
--
-- WHY THIS EXISTS
--   A client-side ledger can only stop a record coming back on the device that
--   holds the ledger. The mirror table could not: deleting a row left no trace,
--   so any stale client (another device, a delayed retry, a tab that never saw
--   the deletion) could upsert the same id straight back and the statement was
--   live again for every device that hydrated after it.
--
-- WHAT THIS DOES
--   1. `memory_tombstones` records that an id was deleted, per user. It holds
--      the id, an optional fingerprint hash and a timestamp — never the text.
--   2. Deleting a `memory_items` row writes the tombstone in the SAME
--      transaction, so a delete cannot commit without its evidence.
--   3. A row whose id is tombstoned cannot be inserted or updated. A stale
--      upload therefore fails at the database, not at the client's discretion.
--   4. `erase_memory(id, fingerprint)` is the atomic path the app uses: it
--      tombstones and deletes in one statement scope, is idempotent, and is
--      scoped to auth.uid() so it cannot reach another user's rows.
--
-- Rows are deleted, not soft-deleted: the tombstone is evidence, not the row.
-- Safe to re-run.

create table if not exists public.memory_tombstones (
  user_id uuid not null references auth.users(id) on delete cascade,
  memory_id text not null,
  -- Six-token-window hash from the client ledger. An evidence aid: it lets a
  -- later scan recognise a quoted statement. It is not a proof of deletion and
  -- cannot be read back into text.
  fingerprint text not null default '',
  -- 'row-delete' when it came from the trigger, 'rpc' from erase_memory().
  source text not null default 'client',
  deleted_at timestamptz not null default now(),
  primary key (user_id, memory_id)
);

create index if not exists memory_tombstones_user_deleted_idx
  on public.memory_tombstones(user_id, deleted_at desc);

alter table public.memory_tombstones enable row level security;

drop policy if exists memory_tombstones_owner on public.memory_tombstones;
create policy memory_tombstones_owner on public.memory_tombstones
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

/* ------------------------------------------------------------------ *
 * Deleting a memory row records its tombstone in the same transaction
 * ------------------------------------------------------------------ */

create or replace function public.memory_record_tombstone() returns trigger
language plpgsql security definer set search_path = public as $function$
begin
  insert into public.memory_tombstones (user_id, memory_id, fingerprint, source, deleted_at)
  values (
    old.user_id,
    old.id,
    coalesce(old.context ->> 'deletionFingerprint', ''),
    'row-delete',
    now()
  )
  on conflict (user_id, memory_id) do update
    set deleted_at = now(),
        source = excluded.source;
  return old;
end;
$function$;

drop trigger if exists memory_items_record_tombstone on public.memory_items;
create trigger memory_items_record_tombstone
  after delete on public.memory_items
  for each row execute function public.memory_record_tombstone();

/* ------------------------------------------------------------------ *
 * A tombstoned id cannot come back — the resurrection block
 * ------------------------------------------------------------------ */

create or replace function public.memory_refuse_resurrection() returns trigger
language plpgsql security definer set search_path = public as $function$
begin
  if exists (
    select 1 from public.memory_tombstones t
    where t.user_id = new.user_id and t.memory_id = new.id
  ) then
    raise exception 'memory_deleted'
      using errcode = 'P0001',
            detail = 'This memory was deleted and cannot be recreated.';
  end if;
  return new;
end;
$function$;

drop trigger if exists memory_items_refuse_resurrection on public.memory_items;
create trigger memory_items_refuse_resurrection
  before insert or update on public.memory_items
  for each row execute function public.memory_refuse_resurrection();

/* ------------------------------------------------------------------ *
 * The atomic erase the application calls
 * ------------------------------------------------------------------ *
 * One function, because a delete without a tombstone is the bug: if the row
 * never reached the server, a plain DELETE would remove nothing and leave no
 * evidence, and the next upload would create it. This tombstones first, so it
 * holds even when there was no row to delete.
 *
 * Idempotent: calling it twice returns 0 the second time and refreshes the
 * same tombstone rather than adding a second one.
 */
create or replace function public.erase_memory(p_id text, p_fingerprint text default '')
returns integer
language plpgsql security definer set search_path = public as $function$
declare
  removed integer := 0;
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_id is null or length(btrim(p_id)) = 0 then
    raise exception 'memory id required' using errcode = '22023';
  end if;

  insert into public.memory_tombstones (user_id, memory_id, fingerprint, source, deleted_at)
  values (uid, p_id, coalesce(p_fingerprint, ''), 'rpc', now())
  on conflict (user_id, memory_id) do update
    set deleted_at = now(),
        fingerprint = case
          when excluded.fingerprint = '' then memory_tombstones.fingerprint
          else excluded.fingerprint
        end;

  delete from public.memory_items where id = p_id and user_id = uid;
  get diagnostics removed = row_count;
  return removed;
end;
$function$;

revoke all on function public.erase_memory(text, text) from public;
revoke all on function public.erase_memory(text, text) from anon;
grant execute on function public.erase_memory(text, text) to authenticated;
