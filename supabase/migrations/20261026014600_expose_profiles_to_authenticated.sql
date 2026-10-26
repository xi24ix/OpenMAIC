-- Keep Data API privileges explicit for projects created after Supabase's
-- public-schema auto-exposure change. RLS still limits rows to auth.uid().
revoke all on table public.profiles from anon;
grant select, insert, update on table public.profiles to authenticated;
