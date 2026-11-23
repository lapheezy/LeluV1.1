-- Trigger functions are invoked by PostgreSQL triggers, not by API roles.
-- Remove the default PUBLIC EXECUTE grants and prevent direct RPC exposure.
revoke all on function public.memory_record_tombstone() from public, anon, authenticated;
revoke all on function public.memory_refuse_resurrection() from public, anon, authenticated;
