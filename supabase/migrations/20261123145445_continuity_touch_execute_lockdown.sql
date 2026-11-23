-- lelu_continuity_touch() is a trigger function. It is only ever invoked by
-- the four lelu_continuity_touch BEFORE INSERT OR UPDATE triggers; PostgreSQL
-- does not check EXECUTE when a trigger fires. Remove the default PUBLIC grant
-- and the anon/authenticated grants so it matches the other trigger functions.
revoke all on function public.lelu_continuity_touch() from public, anon, authenticated;
