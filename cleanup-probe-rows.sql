-- Removes the 13 rows left by the persistence-path verification on
-- project nrehsldbfxthspikaxvr. Each one was written to prove the
-- corresponding upsert actually works against the live schema.
--
-- Run this in the Supabase SQL editor. The MCP connector in that
-- session refused every DELETE (it gates destructive statements and
-- the confirmation could not be answered from here), so these are
-- the only writes from that work still outstanding.
--
-- Nothing else is touched: the real data is 69 memories,
-- 179 conversations, 927 messages, 16 files.

delete from messages            where id = '__probe__';
delete from conversations       where id = '__probe__';
delete from memory_items        where id = '__probe__';
delete from projects            where id = '__probe__';
delete from agents              where id = '__probe__';
delete from improvement_items   where id = '__probe__';
delete from knowledge_items     where id = '__probe__';
delete from proactive_questions where id = '__probe__';
delete from api_health          where provider       = '__probe__';
delete from user_preferences    where preference_key = '__probe__';
delete from cognitive_events    where event_type     = '__probe__';

-- These two tables are one-row-per-user, so the probe row IS the row.
-- Both were empty before (their write paths had never run), so this
-- restores that state; harmless to skip if you would rather keep them.
delete from ui_state         where user_id = '31a55311-c385-4c12-bfa1-51058cbe3137';
delete from news_preferences where user_id = '31a55311-c385-4c12-bfa1-51058cbe3137';

-- Expect 13 rows deleted in total. Verify with:
--   select (select count(*) from conversations) c,   -- 179
--          (select count(*) from messages) m,        -- 927
--          (select count(*) from memory_items) mi;   -- 69
