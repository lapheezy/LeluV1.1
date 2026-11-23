-- Security-closure validation — assertions.
--
-- Runs after 00-fixture.sql and the canonical migrations, inside ONE
-- transaction that is rolled back at the end, with synthetic identities only.
-- Every check prints "PASS <label>"; the first failure raises and stops psql.
--
-- Never run this file against a real project.

\set ON_ERROR_STOP 1
begin;

do $$ begin
  if current_database() not like 'lelu_security_closure%' then
    raise exception 'refusing to run: database % is not an isolated security-closure database', current_database();
  end if;
end $$;

create function pg_temp.ok(label text, cond boolean) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL %', label; end if;
  raise notice 'PASS %', label;
end $$;

create function pg_temp.expect_error(label text, stmt text, code text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlstate = code then
      raise notice 'PASS % (%)', label, sqlstate;
      return;
    end if;
    raise exception 'FAIL % : expected % got % %', label, code, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL % : expected error % but the statement succeeded', label, code;
end $$;

create function pg_temp.as_user(uid text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(uid, ''), true);
$$;

/* ---------------------------------------------------------------------- *
 * P — trigger-function and RPC execute permissions (catalogue)
 * ---------------------------------------------------------------------- */
select pg_temp.ok('P1 ' || f || ' not executable by ' || r,
                  not has_function_privilege(r, f, 'EXECUTE'))
from unnest(array['public.lelu_continuity_touch()', 'public.memory_record_tombstone()',
                  'public.memory_refuse_resurrection()', 'public.trim_lelu_events()']) f,
     unnest(array['anon', 'authenticated']) r;

select pg_temp.ok('P2 PUBLIC holds no EXECUTE on ' || f,
                  not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                              where p.oid = f::regprocedure and a.grantee = 0))
from unnest(array['public.lelu_continuity_touch()', 'public.memory_record_tombstone()',
                  'public.memory_refuse_resurrection()', 'public.trim_lelu_events()',
                  'public.erase_memory(text,text)']) f;

select pg_temp.ok('P3 erase_memory executable by authenticated',
                  has_function_privilege('authenticated', 'public.erase_memory(text,text)', 'EXECUTE'));
select pg_temp.ok('P4 erase_memory not executable by anon',
                  not has_function_privilege('anon', 'public.erase_memory(text,text)', 'EXECUTE'));
select pg_temp.ok('P5 lelu_continuity_touch is SECURITY INVOKER',
                  not prosecdef) from pg_proc where oid = 'public.lelu_continuity_touch()'::regprocedure;
select pg_temp.ok('P6 four continuity triggers attached and enabled',
                  count(*) = 4 and bool_and(tgenabled = 'O'))
from pg_trigger where tgfoid = 'public.lelu_continuity_touch()'::regprocedure and not tgisinternal;

set local role authenticated;
select pg_temp.expect_error('P7 authenticated cannot call lelu_continuity_touch() directly',
                            'select public.lelu_continuity_touch()', '42501');
select pg_temp.expect_error('P8 authenticated cannot call memory_record_tombstone() directly',
                            'select public.memory_record_tombstone()', '42501');
reset role;
set local role anon;
select pg_temp.expect_error('P9 anon cannot call lelu_continuity_touch() directly',
                            'select public.lelu_continuity_touch()', '42501');
select pg_temp.expect_error('P10 anon cannot call erase_memory()',
                            $q$select public.erase_memory('x', '')$q$, '42501');
reset role;

/* ---------------------------------------------------------------------- *
 * C — continuity revisions (as authenticated, which has NO execute grant)
 * ---------------------------------------------------------------------- */
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');

insert into public.projects (id, user_id, name, continuity_revision, updated_at)
values ('cs-p1', '11111111-1111-4111-8111-111111111111', 'synthetic', 99, '2000-01-01');
select pg_temp.ok('C1 insert sets revision 1 whatever the client sends', continuity_revision = 1)
from public.projects where id = 'cs-p1';
select pg_temp.ok('C2 insert sets a server timestamp', updated_at > '2001-01-01')
from public.projects where id = 'cs-p1';

update public.projects set name = 'synthetic 2', continuity_revision = 500, updated_at = '2000-01-01' where id = 'cs-p1';
select pg_temp.ok('C3 update increments the revision and ignores the client value', continuity_revision = 2)
from public.projects where id = 'cs-p1';
select pg_temp.ok('C4 update overwrites a stale client timestamp', updated_at > '2001-01-01')
from public.projects where id = 'cs-p1';

do $$ declare n int; begin
  update public.projects set name = 'stale writer' where id = 'cs-p1' and continuity_revision = 1;
  get diagnostics n = row_count;
  perform pg_temp.ok('C5 compare-and-swap on a stale revision changes nothing', n = 0);
  update public.projects set name = 'fresh writer' where id = 'cs-p1' and continuity_revision = 2;
  get diagnostics n = row_count;
  perform pg_temp.ok('C6 compare-and-swap on the current revision succeeds', n = 1);
end $$;
select pg_temp.ok('C7 revision is 3 after the successful conditional write', continuity_revision = 3)
from public.projects where id = 'cs-p1';

insert into public.conversations (id, user_id, title) values ('cs-c1', '11111111-1111-4111-8111-111111111111', 't');
update public.conversations set title = 't2' where id = 'cs-c1';
insert into public.knowledge_items (id, user_id, title) values ('cs-k1', '11111111-1111-4111-8111-111111111111', 'k');
update public.knowledge_items set title = 'k2' where id = 'cs-k1';
insert into public.user_preferences (user_id, preference_key, value) values ('11111111-1111-4111-8111-111111111111', 'cs-pref', '1');
update public.user_preferences set value = '2' where preference_key = 'cs-pref';
select pg_temp.ok('C8 conversations revision 1 -> 2', (select continuity_revision from public.conversations where id = 'cs-c1') = 2);
select pg_temp.ok('C9 knowledge_items revision 1 -> 2', (select continuity_revision from public.knowledge_items where id = 'cs-k1') = 2);
select pg_temp.ok('C10 user_preferences revision 1 -> 2', (select continuity_revision from public.user_preferences where preference_key = 'cs-pref') = 2);

/* ---------------------------------------------------------------------- *
 * M — deletion tombstones and resurrection prevention
 * ---------------------------------------------------------------------- */
insert into public.memory_items (id, user_id, prompt, response, context)
values ('cs-m1', '11111111-1111-4111-8111-111111111111', 'synthetic', 'synthetic', '{"deletionFingerprint":"fp-1"}');
delete from public.memory_items where id = 'cs-m1';
select pg_temp.ok('M1 deleting a row writes its tombstone in the same transaction',
                  exists (select 1 from public.memory_tombstones where memory_id = 'cs-m1' and source = 'row-delete' and fingerprint = 'fp-1'));
select pg_temp.expect_error('M2 re-inserting a deleted id is refused',
                            $q$insert into public.memory_items (id, user_id) values ('cs-m1', '11111111-1111-4111-8111-111111111111')$q$, 'P0001');
select pg_temp.expect_error('M3 upserting a deleted id is refused',
                            $q$insert into public.memory_items (id, user_id) values ('cs-m1', '11111111-1111-4111-8111-111111111111')
                               on conflict (user_id, id) do update set prompt = 'back'$q$, 'P0001');

insert into public.memory_items (id, user_id) values ('cs-m2', '11111111-1111-4111-8111-111111111111');
insert into public.memory_tombstones (user_id, memory_id) values ('11111111-1111-4111-8111-111111111111', 'cs-m2');
select pg_temp.expect_error('M4 updating a row whose id is tombstoned is refused',
                            $q$update public.memory_items set prompt = 'x' where id = 'cs-m2'$q$, 'P0001');
select pg_temp.ok('M5 tombstone table holds no memory text',
                  not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'memory_tombstones'
                              and column_name in ('prompt', 'response', 'text', 'content')));

/* ---------------------------------------------------------------------- *
 * E — erase_memory(p_id, p_fingerprint) authorisation
 * ---------------------------------------------------------------------- */
-- (Separate statements: a sibling subquery cannot see the RPC's own insert.)
select pg_temp.ok('E1 erasing an id with no row returns 0', public.erase_memory('cs-ghost', 'fp-g') = 0);
select pg_temp.ok('E1b ...and still tombstones it',
                  exists (select 1 from public.memory_tombstones where memory_id = 'cs-ghost' and source = 'rpc' and fingerprint = 'fp-g'));

insert into public.memory_items (id, user_id) values ('cs-m3', '11111111-1111-4111-8111-111111111111');
select pg_temp.ok('E2 erasing an existing row returns 1', public.erase_memory('cs-m3', 'fp-3') = 1);
select pg_temp.ok('E3 a second erase is idempotent (returns 0)', public.erase_memory('cs-m3', '') = 0);
select pg_temp.ok('E4 one tombstone, fingerprint kept when the retry sends none',
                  (select count(*) = 1 and min(fingerprint) = 'fp-3' from public.memory_tombstones where memory_id = 'cs-m3'));
select pg_temp.expect_error('E5 empty id is refused', $q$select public.erase_memory('  ', '')$q$, '22023');

-- user B owns a row with the same id as user A erases
reset role;
insert into public.memory_items (id, user_id, prompt) values ('cs-shared', '22222222-2222-4222-8222-222222222222', 'b-owned');
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
select pg_temp.ok('E6 erase_memory cannot delete another user''s row', public.erase_memory('cs-shared', '') = 0);
reset role;
select pg_temp.ok('E7 the other user''s row and tombstone state are untouched',
                  exists (select 1 from public.memory_items where id = 'cs-shared' and user_id = '22222222-2222-4222-8222-222222222222')
                  and not exists (select 1 from public.memory_tombstones where memory_id = 'cs-shared' and user_id = '22222222-2222-4222-8222-222222222222'));
set local role authenticated;
select pg_temp.as_user(null);
select pg_temp.expect_error('E8 erase_memory without a signed-in user is refused',
                            $q$select public.erase_memory('cs-x', '')$q$, '28000');

/* ---------------------------------------------------------------------- *
 * R — RLS owner isolation (user B looking at user A's data)
 * ---------------------------------------------------------------------- */
select pg_temp.as_user('22222222-2222-4222-8222-222222222222');
select pg_temp.ok('R1 user B sees none of A''s rows in ' || t, n = 0)
from (select 'projects' t, count(*) n from public.projects where user_id = '11111111-1111-4111-8111-111111111111'
      union all select 'conversations', count(*) from public.conversations where user_id = '11111111-1111-4111-8111-111111111111'
      union all select 'knowledge_items', count(*) from public.knowledge_items where user_id = '11111111-1111-4111-8111-111111111111'
      union all select 'user_preferences', count(*) from public.user_preferences where user_id = '11111111-1111-4111-8111-111111111111'
      union all select 'memory_items', count(*) from public.memory_items where user_id = '11111111-1111-4111-8111-111111111111'
      union all select 'memory_tombstones', count(*) from public.memory_tombstones where user_id = '11111111-1111-4111-8111-111111111111') x;
select pg_temp.ok('R2 user B sees their own row', exists (select 1 from public.memory_items where id = 'cs-shared'));
do $$ declare n int; begin
  update public.projects set name = 'hijack' where id = 'cs-p1';
  get diagnostics n = row_count;
  perform pg_temp.ok('R3 user B cannot update A''s project', n = 0);
  delete from public.memory_tombstones where user_id = '11111111-1111-4111-8111-111111111111';
  get diagnostics n = row_count;
  perform pg_temp.ok('R4 user B cannot delete A''s tombstones', n = 0);
end $$;
select pg_temp.expect_error('R5 user B cannot insert a row claiming user A',
                            $q$insert into public.memory_items (id, user_id) values ('cs-forged', '11111111-1111-4111-8111-111111111111')$q$, '42501');
-- (Its own id: A tombstoned 'cs-shared' in E6, so the resurrection block would fire first there.)
insert into public.memory_items (id, user_id) values ('cs-b-own', '22222222-2222-4222-8222-222222222222');
select pg_temp.expect_error('R6 user B cannot reassign their row to user A',
                            $q$update public.memory_items set user_id = '11111111-1111-4111-8111-111111111111' where id = 'cs-b-own'$q$, '42501');

/* ---------------------------------------------------------------------- *
 * A — anonymous access denial
 * ---------------------------------------------------------------------- */
reset role;
set local role anon;
select pg_temp.as_user(null);
select pg_temp.ok('A1 anon reads no rows from ' || t, n = 0)
from (select 'projects' t, count(*) n from public.projects
      union all select 'conversations', count(*) from public.conversations
      union all select 'knowledge_items', count(*) from public.knowledge_items
      union all select 'user_preferences', count(*) from public.user_preferences
      union all select 'memory_items', count(*) from public.memory_items
      union all select 'memory_tombstones', count(*) from public.memory_tombstones) x;
select pg_temp.expect_error('A2 anon cannot insert a memory',
                            $q$insert into public.memory_items (id, user_id) values ('cs-anon', '11111111-1111-4111-8111-111111111111')$q$, '42501');
select pg_temp.expect_error('A3 anon cannot insert a tombstone',
                            $q$insert into public.memory_tombstones (user_id, memory_id) values ('11111111-1111-4111-8111-111111111111', 'cs-anon')$q$, '42501');
reset role;

\echo ALL SECURITY-CLOSURE ASSERTIONS PASSED
rollback;
