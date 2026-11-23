-- trim_lelu_events() is a SECURITY DEFINER trigger function in the exposed
-- public schema. Postgres grants EXECUTE to PUBLIC by default, so the
-- Supabase security advisor flags it as callable by anon and authenticated
-- via /rest/v1/rpc/trim_lelu_events. Only the trigger needs it; triggers do
-- not need EXECUTE granted to the calling role.
revoke execute on function public.trim_lelu_events() from public, anon, authenticated;
