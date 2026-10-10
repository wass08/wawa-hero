-- =============================================================================
-- Wawa Hero scoreboard: table, leaderboard RPC, abuse brakes, storage bucket.
-- Migration 20261010000000. Idempotent: safe to re-run (re-running also
-- re-applies edited constraints, policies and functions).
--
-- CREATES
--   public.wawa_hero_scores          one row per posted result (RLS on)
--   public.wawa_hero_rate            private insert log for the rate limiter
--                                    (RLS on, no policies, no anon grants)
--   public.wawa_hero_leaderboard()   RPC: best score per (name, country) for a
--                                    song/difficulty, ranked, hidden excluded
--   public.wawa_hero_scores_rate_limit()  BEFORE INSERT trigger function
--   public.wawa_hero_upload_allowed()     global storage upload brake
--   storage bucket 'wawa-hero'       public read, image/webp only, 200 KB max
--   storage.objects policies         wawa_hero_shots_insert (+ 3 restrictive
--                                    guards on the bucket)
--
-- SECURITY MODEL (anon = the public anon key shipped in the web client)
--   * anon/authenticated may INSERT only the "game" columns (column grants);
--     id, created_at and hidden are not writable, so they always take their
--     defaults. CHECK constraints validate every value.
--   * anon/authenticated may SELECT rows where hidden = false. Nothing else.
--   * No UPDATE / DELETE for anon on the table or on the bucket.
--   * Storage: anon may upload only 'shots/<uuid>.webp' into 'wawa-hero';
--     overwriting an existing object is impossible (no UPDATE policy, upload
--     with x-upsert: false returns 409/400 "Duplicate" if the name exists).
--   * Inserts are rate limited (20/min globally, 6/min per client IP).
--   * Scores are submitted by the browser and therefore CAN be spoofed by
--     anyone holding the anon key. Constraints only keep values plausible.
--
-- MODERATION (run as an admin: Studio SQL editor or psql)
--   -- hide an entry (disappears from the leaderboard and the wall):
--   update public.wawa_hero_scores set hidden = true where id = '<uuid>';
--   -- find entries:
--   select id, created_at, player_name, country, song_id, score, shots
--     from public.wawa_hero_scores order by created_at desc limit 50;
--   -- photos stay reachable by URL while the files exist. To remove them,
--   -- delete the objects in Studio > Storage > wawa-hero > shots (or the
--   -- Storage API with the service key). Deleting rows from storage.objects
--   -- in SQL does not delete the underlying files.
--
-- ROLLBACK
--   supabase/rollback_wawa_hero.sql
--
-- Run as a role that owns/can alter storage.objects policies (supabase_admin
-- in a self-hosted stack, or postgres in hosted Supabase).
-- =============================================================================

begin;

set local client_min_messages = warning;

-- -----------------------------------------------------------------------------
-- 1. Scores table
-- -----------------------------------------------------------------------------
create table if not exists public.wawa_hero_scores (
  id             uuid         primary key default gen_random_uuid(),
  created_at     timestamptz  not null default now(),
  song_id        text         not null,
  difficulty     text         not null,
  mode           text         not null default 'solo',
  versus_rank    smallint,
  player_name    text         not null,
  country        char(2),
  score          integer      not null,
  stars          smallint     not null default 0,
  max_combo      integer      not null default 0,
  perfect        integer      not null default 0,
  good           integer      not null default 0,
  miss           integer      not null default 0,
  kcal           numeric(6,1) not null default 0,
  duration_s     integer      not null default 0,
  shots          text[]       not null default '{}',
  share_shots    boolean      not null default false,
  hidden         boolean      not null default false,
  client_version text
);

comment on table public.wawa_hero_scores is
  'Wawa Hero public scoreboard. Anon: insert (CHECK + RLS) and select where hidden = false. Moderate with: update public.wawa_hero_scores set hidden = true where id = ...';
comment on column public.wawa_hero_scores.shots is
  'Storage paths in bucket wawa-hero (shots/<uuid>.webp), at most 4, empty unless share_shots.';
comment on column public.wawa_hero_scores.hidden is
  'Moderation flag. Not writable by anon. Hidden rows are invisible to anon.';

-- Constraints are dropped and re-added so that re-running applies edits.
alter table public.wawa_hero_scores
  drop constraint if exists wawa_hero_scores_song_id_chk,
  drop constraint if exists wawa_hero_scores_difficulty_chk,
  drop constraint if exists wawa_hero_scores_mode_chk,
  drop constraint if exists wawa_hero_scores_name_chk,
  drop constraint if exists wawa_hero_scores_country_chk,
  drop constraint if exists wawa_hero_scores_score_chk,
  drop constraint if exists wawa_hero_scores_stars_chk,
  drop constraint if exists wawa_hero_scores_counts_chk,
  drop constraint if exists wawa_hero_scores_kcal_chk,
  drop constraint if exists wawa_hero_scores_duration_chk,
  drop constraint if exists wawa_hero_scores_shots_chk,
  drop constraint if exists wawa_hero_scores_share_chk,
  drop constraint if exists wawa_hero_scores_client_version_chk;

alter table public.wawa_hero_scores
  add constraint wawa_hero_scores_song_id_chk
    check (song_id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  add constraint wawa_hero_scores_difficulty_chk
    check (difficulty in ('easy', 'normal')),
  add constraint wawa_hero_scores_mode_chk
    check ((mode = 'solo' and versus_rank is null)
        or (mode = 'versus' and versus_rank is not null and versus_rank in (1, 2))),
  -- 1..16 characters (code points), no leading/trailing whitespace, no control
  -- characters, no invisible/bidi-override characters.
  add constraint wawa_hero_scores_name_chk
    check (char_length(player_name) between 1 and 16
       and player_name !~ '^[[:space:]]|[[:space:]]$'
       and player_name !~ '[\u0001-\u001f\u007f-\u009f\u200b\u200e\u200f\u2028-\u202e\u2060\u2066-\u2069\ufeff]'),
  add constraint wawa_hero_scores_country_chk
    check (country is null or country ~ '^[A-Z]{2}$'),
  add constraint wawa_hero_scores_score_chk
    check (score between 0 and 2000000),
  add constraint wawa_hero_scores_stars_chk
    check (stars between 0 and 3),
  add constraint wawa_hero_scores_counts_chk
    check (max_combo between 0 and 20000
       and perfect between 0 and 20000
       and good between 0 and 20000
       and miss between 0 and 20000
       and perfect + good + miss <= 20000),
  add constraint wawa_hero_scores_kcal_chk
    check (kcal between 0 and 2000),
  add constraint wawa_hero_scores_duration_chk
    check (duration_s between 0 and 3600),
  -- <= 4 one-dimensional, non-null elements, each 'shots/<lowercase uuid>.webp'
  -- (nulls are rendered as '#' by array_to_string and so fail the pattern).
  add constraint wawa_hero_scores_shots_chk
    check (cardinality(shots) <= 4
       and coalesce(array_ndims(shots), 1) = 1
       and (cardinality(shots) = 0
            or array_to_string(shots, ',', '#') ~
               '^shots/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp(,shots/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp)*$')),
  add constraint wawa_hero_scores_share_chk
    check (share_shots or cardinality(shots) = 0),
  add constraint wawa_hero_scores_client_version_chk
    check (client_version is null
       or (char_length(client_version) <= 32 and client_version !~ '[[:cntrl:]]'));

-- Leaderboard: filter by song/difficulty, best score first.
create index if not exists wawa_hero_scores_board_idx
  on public.wawa_hero_scores (song_id, difficulty, score desc);
-- Wall: most recent rows that shared photos.
create index if not exists wawa_hero_scores_wall_idx
  on public.wawa_hero_scores (created_at desc) where share_shots;

-- -----------------------------------------------------------------------------
-- 2. Privileges and RLS on the scores table
-- -----------------------------------------------------------------------------
alter table public.wawa_hero_scores enable row level security;

-- Supabase's default privileges grant ALL to anon/authenticated on new tables.
revoke all on table public.wawa_hero_scores from public, anon, authenticated;
grant select on table public.wawa_hero_scores to anon, authenticated;
-- Column-level INSERT: id, created_at and hidden are deliberately absent, so a
-- payload containing them fails with 42501 (permission denied).
grant insert (song_id, difficulty, mode, versus_rank, player_name, country,
              score, stars, max_combo, perfect, good, miss, kcal, duration_s,
              shots, share_shots, client_version)
  on table public.wawa_hero_scores to anon, authenticated;
grant all on table public.wawa_hero_scores to service_role;

drop policy if exists wawa_hero_scores_insert_public on public.wawa_hero_scores;
create policy wawa_hero_scores_insert_public
  on public.wawa_hero_scores
  for insert to anon, authenticated
  with check (
    hidden = false
    and created_at between now() - interval '1 minute' and now() + interval '1 minute'
  );

drop policy if exists wawa_hero_scores_select_public on public.wawa_hero_scores;
create policy wawa_hero_scores_select_public
  on public.wawa_hero_scores
  for select to anon, authenticated
  using (hidden = false);

-- No UPDATE / DELETE policies (and no grants): anon can never modify rows.

-- -----------------------------------------------------------------------------
-- 3. Abuse brake: insert rate limiter
-- -----------------------------------------------------------------------------
-- Private log of recent successful inserts (rows of failed inserts roll back
-- with the failed statement). The client IP is stored only as a SHA-256 hash
-- and purged after 10 minutes.
create table if not exists public.wawa_hero_rate (
  at      timestamptz not null default now(),
  ip_hash text
);
create index if not exists wawa_hero_rate_at_idx on public.wawa_hero_rate (at);
alter table public.wawa_hero_rate enable row level security;
revoke all on table public.wawa_hero_rate from public, anon, authenticated;
comment on table public.wawa_hero_rate is
  'Wawa Hero insert rate-limit log (private; written by wawa_hero_scores_rate_limit()).';

create or replace function public.wawa_hero_scores_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Tune here.
  c_global_per_min constant integer := 20;
  c_ip_per_min     constant integer := 6;
  v_role    text;
  v_headers json;
  v_hops    text[];
  v_ip      inet;
  v_hash    text;
  i         integer;
begin
  -- Only throttle API callers (anon / authenticated). service_role and direct
  -- SQL sessions (no JWT claims) are not limited.
  begin
    v_role := coalesce(
      nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role',
      nullif(current_setting('request.jwt.claim.role', true), ''));
  exception when others then
    v_role := 'anon';
  end;
  if v_role is null or v_role not in ('anon', 'authenticated') then
    return new;
  end if;

  -- Client IP: the right-most public address in X-Forwarded-For. Hops to the
  -- left of it are client-controlled; hops to the right are our own proxies
  -- (Elestio nginx, Kong) on private addresses. Missing/garbled header: only
  -- the global limit applies.
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
    v_hops := string_to_array(coalesce(v_headers ->> 'x-forwarded-for', ''), ',');
    if v_hops is not null then
      for i in reverse coalesce(array_length(v_hops, 1), 0) .. 1 loop
        begin
          v_ip := btrim(v_hops[i])::inet;
        exception when others then
          v_ip := null;
          continue;
        end;
        exit when not (v_ip << '10.0.0.0/8'::inet or v_ip << '172.16.0.0/12'::inet
                    or v_ip << '192.168.0.0/16'::inet or v_ip << '127.0.0.0/8'::inet
                    or v_ip << '169.254.0.0/16'::inet or v_ip << '100.64.0.0/10'::inet
                    or v_ip = '::1'::inet or v_ip << 'fc00::/7'::inet
                    or v_ip << 'fe80::/10'::inet);
        v_ip := null;
      end loop;
    end if;
  exception when others then
    v_ip := null;
  end;
  if v_ip is not null then
    v_hash := encode(sha256(convert_to(host(v_ip), 'UTF8')), 'hex');
  end if;

  -- Serialise concurrent inserts so the counts are exact.
  perform pg_advisory_xact_lock(hashtext('wawa_hero_scores_rate_limit'));
  delete from public.wawa_hero_rate where at < now() - interval '10 minutes';

  if (select count(*) from public.wawa_hero_rate
       where at > now() - interval '1 minute') >= c_global_per_min then
    raise exception using
      errcode = 'PT429',  -- PostgREST maps PTxyz to HTTP status xyz
      message = 'wawa_hero_rate_limited',
      detail  = 'global',
      hint    = 'Too many scores were posted in the last minute. Try again shortly.';
  end if;

  if v_hash is not null
     and (select count(*) from public.wawa_hero_rate
           where ip_hash = v_hash and at > now() - interval '1 minute') >= c_ip_per_min then
    raise exception using
      errcode = 'PT429',
      message = 'wawa_hero_rate_limited',
      detail  = 'ip',
      hint    = 'Too many scores from this network in the last minute. Try again shortly.';
  end if;

  insert into public.wawa_hero_rate (at, ip_hash) values (now(), v_hash);
  return new;
end;
$$;

revoke all on function public.wawa_hero_scores_rate_limit() from public, anon, authenticated;

drop trigger if exists wawa_hero_scores_rate_limit on public.wawa_hero_scores;
create trigger wawa_hero_scores_rate_limit
  before insert on public.wawa_hero_scores
  for each row execute function public.wawa_hero_scores_rate_limit();

-- -----------------------------------------------------------------------------
-- 4. Leaderboard RPC
--    GET /rest/v1/rpc/wawa_hero_leaderboard?p_song_id=..&p_difficulty=..&p_limit=10
--    Best row per (lower(player_name), country), ranked by score (ties share a
--    rank; earliest achiever listed first). SECURITY INVOKER: RLS applies, so
--    hidden rows are excluded for anon even without the explicit filter.
-- -----------------------------------------------------------------------------
drop function if exists public.wawa_hero_leaderboard(text, text, integer);
create function public.wawa_hero_leaderboard(
  p_song_id    text,
  p_difficulty text,
  p_limit      integer default 10
)
returns table (
  rank        bigint,
  id          uuid,
  created_at  timestamptz,
  song_id     text,
  difficulty  text,
  mode        text,
  player_name text,
  country     text,
  score       integer,
  stars       smallint,
  max_combo   integer,
  perfect     integer,
  good        integer,
  miss        integer,
  kcal        numeric,
  duration_s  integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with best as (
    select distinct on (lower(s.player_name), s.country) s.*
      from public.wawa_hero_scores s
     where s.song_id = p_song_id
       and s.difficulty = p_difficulty
       and s.hidden = false
     order by lower(s.player_name), s.country, s.score desc, s.created_at asc
  )
  select rank() over (order by b.score desc) as rank,
         b.id, b.created_at, b.song_id, b.difficulty, b.mode, b.player_name,
         b.country::text, b.score, b.stars, b.max_combo, b.perfect, b.good,
         b.miss, b.kcal, b.duration_s
    from best b
   order by b.score desc, b.created_at asc
   limit least(greatest(coalesce(p_limit, 10), 1), 100);
$$;

comment on function public.wawa_hero_leaderboard(text, text, integer) is
  'Wawa Hero leaderboard: best score per (player_name, country) for a song/difficulty, ranked. Hidden rows excluded.';
revoke all on function public.wawa_hero_leaderboard(text, text, integer) from public;
grant execute on function public.wawa_hero_leaderboard(text, text, integer)
  to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. Storage bucket + policies
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wawa-hero', 'wawa-hero', true, 204800, array['image/webp'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Global upload brake: at most 40 new objects per minute in the bucket.
-- SECURITY DEFINER so it can count objects anon cannot see. Fails open (true)
-- if it cannot read storage.objects, so a privilege quirk never blocks uploads.
create or replace function public.wawa_hero_upload_allowed()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return (select count(*) < 40
            from storage.objects o
           where o.bucket_id = 'wawa-hero'
             and o.created_at > now() - interval '1 minute');
exception when others then
  return true;
end;
$$;
-- Must stay executable by anon/authenticated: it is evaluated inside their
-- storage INSERT policy. (It only returns a boolean.)
revoke all on function public.wawa_hero_upload_allowed() from public;
grant execute on function public.wawa_hero_upload_allowed() to anon, authenticated, service_role;

-- Permissive: the only way anon/authenticated can write to the bucket.
drop policy if exists wawa_hero_shots_insert on storage.objects;
create policy wawa_hero_shots_insert
  on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'wawa-hero'
    and name ~ '^shots/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
    and public.wawa_hero_upload_allowed()
  );

-- Restrictive guards: even if some other (broad) policy on storage.objects
-- exists in this shared instance, it cannot be used to write odd paths into,
-- overwrite, or delete from the wawa-hero bucket. No effect on other buckets.
drop policy if exists wawa_hero_guard_insert on storage.objects;
create policy wawa_hero_guard_insert
  on storage.objects
  as restrictive
  for insert to anon, authenticated
  with check (
    bucket_id is distinct from 'wawa-hero'
    or name ~ '^shots/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
  );

drop policy if exists wawa_hero_guard_update on storage.objects;
create policy wawa_hero_guard_update
  on storage.objects
  as restrictive
  for update to anon, authenticated
  using (bucket_id is distinct from 'wawa-hero')
  with check (bucket_id is distinct from 'wawa-hero');

drop policy if exists wawa_hero_guard_delete on storage.objects;
create policy wawa_hero_guard_delete
  on storage.objects
  as restrictive
  for delete to anon, authenticated
  using (bucket_id is distinct from 'wawa-hero');

-- Reads: the bucket is public, so GET /storage/v1/object/public/wawa-hero/...
-- works without any SELECT policy. We intentionally add NO select policy for
-- anon: that keeps the bucket non-listable (no enumeration of every photo,
-- including those of hidden entries).
--
-- Upload path note: a plain upload (x-upsert: false) needs only INSERT. An
-- upsert (x-upsert: true) needs SELECT + UPDATE and therefore always fails for
-- anon here, which is what we want (no overwrite). If a storage-api version
-- ever requires SELECT for plain uploads (verify.sh reports it as a failed
-- "valid upload"), enable this narrowly scoped policy:
--
--   drop policy if exists wawa_hero_shots_select on storage.objects;
--   create policy wawa_hero_shots_select on storage.objects
--     for select to anon, authenticated
--     using (bucket_id = 'wawa-hero' and name ~ '^shots/[0-9a-f-]{36}\.webp$');
--
-- (it makes the bucket listable through /storage/v1/object/list/wawa-hero).

commit;

-- Make PostgREST pick up the new table/function immediately.
notify pgrst, 'reload schema';
