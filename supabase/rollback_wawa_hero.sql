-- =============================================================================
-- Rollback for supabase/migrations/20261010000000_wawa_hero_scoreboard.sql
-- Removes every wawa_hero_* object. DESTROYS ALL SCORES. Idempotent.
--
-- The 'wawa-hero' bucket is removed only if it is empty. Empty it first in
-- Studio > Storage > wawa-hero (or via the Storage API with the service key):
-- deleting rows from storage.objects in SQL would orphan the files on disk.
-- =============================================================================

begin;

set local client_min_messages = warning;

-- Storage policies first (one of them depends on wawa_hero_upload_allowed()).
drop policy if exists wawa_hero_shots_insert on storage.objects;
drop policy if exists wawa_hero_shots_select on storage.objects;
drop policy if exists wawa_hero_guard_insert on storage.objects;
drop policy if exists wawa_hero_guard_update on storage.objects;
drop policy if exists wawa_hero_guard_delete on storage.objects;

drop function if exists public.wawa_hero_upload_allowed();
drop function if exists public.wawa_hero_leaderboard(text, text, integer);

drop table if exists public.wawa_hero_scores;   -- also drops its trigger, policies, indexes
drop table if exists public.wawa_hero_rate;
drop function if exists public.wawa_hero_scores_rate_limit();

do $$
begin
  if exists (select 1 from storage.objects where bucket_id = 'wawa-hero') then
    raise warning 'bucket wawa-hero still has objects: empty it in Studio, then re-run this script to remove the bucket';
  else
    -- The bucket is empty, so removing its row orphans nothing. Recent storage
    -- versions guard direct deletes with storage.protect_delete(); allow it for
    -- this transaction only. (Alternative: DELETE /storage/v1/bucket/wawa-hero
    -- with the service key.)
    perform set_config('storage.allow_delete_query', 'true', true);
    delete from storage.buckets where id = 'wawa-hero';
  end if;
end;
$$;

commit;

notify pgrst, 'reload schema';
