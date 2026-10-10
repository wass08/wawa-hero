# Wawa Hero scoreboard backend (self-hosted Supabase)

Everything the game needs on the server side: one table, one RPC, a storage
bucket for hero shots, RLS policies and an insert rate limiter. The browser
talks to it with plain `fetch` (`src/net/scoreboard.js`) using the public anon key.

| File | Purpose |
|---|---|
| `migrations/20261010000000_wawa_hero_scoreboard.sql` | Creates everything. Idempotent: safe to re-run, and re-running applies edits. |
| `rollback_wawa_hero.sql` | Drops everything (destroys scores). Removes the bucket only if it is empty. |
| `verify.sh` | End-to-end checks with the anon key (read-only by default). |

## Environment

The web client reads, at build time (`.env.local`, see `.env.example`):

```
VITE_SUPABASE_URL=https://<your-gateway>      # Kong gateway, no trailing slash needed
VITE_SUPABASE_ANON_KEY=<anon key (JWT) or sb_publishable_... key>
```

If either is missing, `scoreboardEnabled` is `false` and the game runs offline-only.
Never put the service-role key in a `VITE_` variable: it would ship to every browser.

## Apply

Run it as an admin role that can create policies on `storage.objects`
(`supabase_admin` on a self-hosted stack; `postgres` also works on recent images).

**Studio:** SQL Editor > paste the migration file > Run.

**psql:**

```sh
psql "postgresql://supabase_admin:<password>@<db-host>:5432/postgres" \
  -v ON_ERROR_STOP=1 -f supabase/migrations/20261010000000_wawa_hero_scoreboard.sql
```

The script ends with `notify pgrst, 'reload schema'`, so PostgREST sees the new
table and function at once. Then run `supabase/verify.sh --write` (below).

## What it creates

- `public.wawa_hero_scores`: one row per posted result. CHECK constraints:
  name 1–16 code points, trimmed, with no control or invisible/bidi characters;
  `country` `^[A-Z]{2}$` or null; `difficulty` easy|normal; `mode` solo (no rank) or
  versus (rank 1|2); score 0..2,000,000; stars 0..3; counts 0..20,000;
  kcal 0..2000; duration 0..3600 s; `shots` at most 4 paths matching
  `shots/<uuid>.webp`, and empty unless `share_shots`; `client_version` at most 32 chars.
- `public.wawa_hero_leaderboard(p_song_id, p_difficulty, p_limit)`: best row per
  (case-insensitive name, country), ranked by score (ties share a rank). It is
  security invoker, so RLS applies.
- `public.wawa_hero_rate`: private log used by the insert trigger. It stores a
  SHA-256 of the client IP and purges entries after 10 minutes.
- Storage bucket `wawa-hero`: public read, `image/webp` only, 200 KB (204800 B) max.

## Security model

| Who | Can |
|---|---|
| anon / authenticated | `INSERT` game columns only (column grants: `id`, `created_at` and `hidden` can't be written). `SELECT` rows where `hidden = false`. Call the leaderboard RPC. Upload `shots/<uuid>.webp` (WebP, under 200 KB, no overwrite). Read files by public URL. |
| anon / authenticated | Cannot `UPDATE`/`DELETE` rows, read hidden rows, read `wawa_hero_rate`, list the bucket, or overwrite/delete files. Restrictive policies also block this if another app on the same instance adds broad `storage.objects` policies. |
| service_role / admin | Everything (moderation). |

Abuse brakes:

- At most **20 inserts per minute** globally and **6 per minute per client IP**
  (HTTP 429, `message = wawa_hero_rate_limited`). Tune these in
  `wawa_hero_scores_rate_limit()`.
- The client IP is the right-most *public* address in `X-Forwarded-For`, so a
  spoofed header can't pick another IP's bucket, and the private hops (nginx,
  Kong) are skipped. If the gateway does not forward the client IP at all, only
  the global limit applies.
- At most **40 uploads per minute** into the bucket (`wawa_hero_upload_allowed()`).

Residual risks (accepted, by design of a client-only game):

- **Scores can be spoofed.** Anyone can read the anon key from the bundle and
  POST any plausible score. The constraints only bound values to plausible
  ranges. The answer is moderation (hide), not prevention.
- Uploaded photos are public as soon as they are uploaded, even before (or
  without) the score row that references them. Paths are random UUIDs and the
  bucket can't be listed, so an orphan photo is only reachable by someone who
  knows its URL.
- Hiding a row hides it from the leaderboard and wall, but its photo URLs keep
  working until the files are deleted.
- The global rate limit means a flood of inserts can briefly block real players
  from posting.
- Names are free text: rude names need moderation.

## Moderation

Find recent entries:

```sql
select id, created_at, player_name, country, song_id, difficulty, score, share_shots, shots
from public.wawa_hero_scores order by created_at desc limit 50;
```

Hide one (it disappears from the leaderboard and wall at once, since there is no server cache):

```sql
update public.wawa_hero_scores set hidden = true where id = '<uuid>';
```

Unhide: `set hidden = false`. To remove the photos, delete the files in
**Studio > Storage > wawa-hero > shots**, or with the Storage API and the service key:

```sh
curl -X DELETE "$URL/storage/v1/object/wawa-hero" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  -H 'Content-Type: application/json' -d '{"prefixes":["shots/<uuid>.webp"]}'
```

(Don't `delete from storage.objects` in SQL. Recent storage versions block it,
and older ones would leave the files orphaned on disk.)

## Verify

```sh
supabase/verify.sh                  # read-only: leaderboard, wall, bucket exists / not listable
supabase/verify.sh --write          # + valid smoke insert, ~30 invalid payloads, update/delete
                                    #   attempts, storage upload rules (tiny 1x1 WebP)
supabase/verify.sh --write --rate   # + fires inserts until the limiter answers 429
```

It reads `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` from the environment or
`.env.local`. A `--write` run leaves one row with `player_name = 'smoke-test'` on
`song_id = 'smoke-test'` (a song that doesn't exist, so it never appears on real
boards; `share_shots = false`, so it's not on the wall either) and one test
image. The script prints the cleanup:

```sql
delete from public.wawa_hero_scores where song_id = 'smoke-test' or player_name = 'smoke-test';
delete from public.wawa_hero_rate;
```

If the `--rate` check fails behind your proxy, the per-IP limit isn't seeing
client IPs (only the global limit applies). Check what reaches PostgREST in
`X-Forwarded-For`.

Manual curl checks:

```sh
URL=...; KEY=...   # from .env.local
# leaderboard
curl "$URL/rest/v1/rpc/wawa_hero_leaderboard?p_song_id=system-online&p_difficulty=normal&p_limit=10" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
# wall
curl "$URL/rest/v1/wawa_hero_scores?select=id,player_name,country,score,shots&share_shots=is.true&shots=neq.%7B%7D&order=created_at.desc&limit=24" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
# must fail with 401 (column hidden not insertable)
curl -X POST "$URL/rest/v1/wawa_hero_scores" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
  -H 'Content-Type: application/json' \
  -d '{"song_id":"smoke-test","difficulty":"easy","player_name":"smoke-test","score":1,"hidden":true}'
```

## Rollback

```sh
psql "$ADMIN_DB_URL" -v ON_ERROR_STOP=1 -f supabase/rollback_wawa_hero.sql
```

Empty the bucket first (Studio > Storage > wawa-hero) if you also want the
bucket removed. Otherwise the script keeps it and prints a warning.
