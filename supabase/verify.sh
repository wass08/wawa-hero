#!/usr/bin/env bash
# Wawa Hero scoreboard: end-to-end checks against the live Supabase gateway,
# using ONLY the public anon key (exactly what the browser has).
#
#   supabase/verify.sh            read-only checks (safe, writes nothing)
#   supabase/verify.sh --write    + insert / upload checks (creates ONE smoke row
#                                   with player_name 'smoke-test' on song_id
#                                   'smoke-test', and ONE tiny test image)
#   supabase/verify.sh --write --rate
#                                 + rate-limit check (inserts up to 7 more
#                                   smoke rows until the limiter answers 429)
#
# Config: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from the environment, else
# from ENV_FILE (default: <repo>/.env.local).
#
# anon cannot delete what it writes. The cleanup SQL (run as admin) is printed
# at the end of a --write run.
#
# Requires: bash, curl, base64, uuidgen (or /proc/sys/kernel/random/uuid).

set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${ENV_FILE:-$HERE/../.env.local}"
WRITE=0
RATE=0
for arg in "$@"; do
  case "$arg" in
    --write) WRITE=1 ;;
    --rate) RATE=1 ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

env_get() { # env_get NAME -> value from ENV_FILE (no sourcing, quotes stripped)
  [ -f "$ENV_FILE" ] || return 0
  grep -E "^[[:space:]]*(export[[:space:]]+)?$1=" "$ENV_FILE" | tail -n 1 \
    | sed -E "s/^[[:space:]]*(export[[:space:]]+)?$1=//; s/^[\"']//; s/[\"'][[:space:]]*$//"
}
URL="${VITE_SUPABASE_URL:-$(env_get VITE_SUPABASE_URL)}"
KEY="${VITE_SUPABASE_ANON_KEY:-$(env_get VITE_SUPABASE_ANON_KEY)}"
URL="${URL%/}"
if [ -z "$URL" ] || [ -z "$KEY" ]; then
  echo "VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set (looked in env and $ENV_FILE)" >&2
  exit 2
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PASS=0
FAIL=0
STATUS=""
BODY=""
CREATED_ROWS=""
UPLOADED=""

uuid() {
  if command -v uuidgen >/dev/null 2>&1; then uuidgen | tr 'A-Z' 'a-z'
  else cat /proc/sys/kernel/random/uuid; fi
}

# req METHOD PATH [extra curl args...]  -> sets STATUS, BODY
req() {
  local method="$1" path="$2"; shift 2
  STATUS="$(curl -sS -m 20 -o "$TMP/body" -w '%{http_code}' -X "$method" \
    -H "apikey: $KEY" -H "Authorization: Bearer $KEY" "$@" "$URL$path" 2>"$TMP/err")" || STATUS="000"
  BODY="$(cat "$TMP/body" 2>/dev/null)"
  [ "$STATUS" = "000" ] && BODY="$(cat "$TMP/err")"
}

short() { printf '%s' "$1" | tr '\n' ' ' | cut -c1-220; }

# expect LABEL PATTERN  (PATTERN is a case glob on the HTTP status, e.g. '2*' or '4*')
expect() {
  local label="$1" pattern="$2"
  # shellcheck disable=SC2254
  case "$STATUS" in
    $pattern) PASS=$((PASS + 1)); printf '  PASS  %-52s %s\n' "$label" "$STATUS" ;;
    *)        FAIL=$((FAIL + 1)); printf '  FAIL  %-52s %s  %s\n' "$label" "$STATUS" "$(short "$BODY")" ;;
  esac
}

SCHEMA_MISSING=0
schema_hint() {
  case "$BODY" in
    *PGRST205*|*PGRST202*|*"schema cache"*)
      SCHEMA_MISSING=1
      echo "        -> schema not applied yet: run supabase/migrations/20261010000000_wawa_hero_scoreboard.sql" ;;
  esac
}

json_insert() { # json_insert BODY -> POST to the scores table
  req POST "/rest/v1/wawa_hero_scores" -H 'Content-Type: application/json' \
    -H 'Prefer: return=representation' --data "$1"
}

# payload [key=json ...]: a valid smoke row with fields overridden; "key=-"
# drops a field, unknown keys are appended (e.g. hidden=true).
FIELDS="song_id difficulty mode versus_rank player_name country score stars max_combo perfect good miss kcal duration_s shots share_shots client_version"
default_of() {
  case "$1" in
    song_id|player_name) echo '"smoke-test"' ;;
    difficulty) echo '"easy"' ;;
    mode) echo '"solo"' ;;
    versus_rank) echo '-' ;;
    country) echo '"FR"' ;;
    score|max_combo|perfect|duration_s) echo 1 ;;
    stars|good|miss) echo 0 ;;
    kcal) echo 0.1 ;;
    shots) echo '[]' ;;
    share_shots) echo false ;;
    client_version) echo '"verify.sh"' ;;
  esac
}
payload() {
  local out="" k v pair
  for k in $FIELDS; do
    v="$(default_of "$k")"
    for pair in "$@"; do case "$pair" in "$k="*) v="${pair#*=}" ;; esac; done
    [ "$v" = "-" ] && continue
    out="$out,\"$k\":$v"
  done
  for pair in "$@"; do
    k="${pair%%=*}"
    case " $FIELDS " in *" $k "*) ;; *) out="$out,\"$k\":${pair#*=}" ;; esac
  done
  printf '{%s}' "${out#,}"
}

echo "Wawa Hero scoreboard verification against ${URL%%.*}.***"
echo

# ---------------------------------------------------------------------------
echo "[read] REST"
req GET "/rest/v1/rpc/wawa_hero_leaderboard?p_song_id=system-online&p_difficulty=normal&p_limit=10"
expect "leaderboard RPC (system-online / normal)" '200'
schema_hint
[ "$STATUS" = "200" ] && echo "        $(short "$BODY")"

req GET "/rest/v1/wawa_hero_scores?select=id,created_at,player_name,country,score,shots&share_shots=is.true&shots=neq.%7B%7D&order=created_at.desc&limit=5"
expect "wall query (recent rows with shots)" '200'
schema_hint

req GET "/rest/v1/wawa_hero_scores?select=id&hidden=is.true&limit=1"
if [ "$STATUS" = "200" ] && [ "$BODY" != "[]" ]; then STATUS="LEAK"; fi
expect "hidden rows are invisible to anon" '200'

req GET "/rest/v1/wawa_hero_rate?select=*&limit=1"
expect "rate-limit log not readable by anon" '4*'

echo "[read] Storage"
req GET "/storage/v1/object/public/wawa-hero/shots/00000000-0000-4000-8000-000000000000.webp"
case "$BODY" in *"Bucket not found"*) STATUS="NOBUCKET" ;; esac
expect "bucket 'wawa-hero' exists (missing object -> 4xx)" '4*'
[ "$STATUS" = "NOBUCKET" ] && echo "        -> bucket not created yet: apply the migration"

req POST "/storage/v1/object/list/wawa-hero" -H 'Content-Type: application/json' \
  --data '{"prefix":"shots/","limit":5}'
case "$STATUS" in 2*) [ "$BODY" = "[]" ] || STATUS="LISTABLE" ;; esac
expect "bucket is not listable by anon" '[24]*'

if [ "$WRITE" != 1 ]; then
  echo
  echo "read-only run: $PASS passed, $FAIL failed (use --write for insert/upload checks)"
  [ "$FAIL" = 0 ]; exit $?
fi

if [ "$SCHEMA_MISSING" = 1 ]; then
  echo
  echo "schema missing: skipping write checks"
  exit 1
fi

# ---------------------------------------------------------------------------
echo
echo "[write] valid insert"
json_insert "$(payload)"
expect "valid smoke row is accepted" '201'
SMOKE_ID="$(printf '%s' "$BODY" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([0-9a-f-]\{36\}\)".*/\1/p')"
[ -n "$SMOKE_ID" ] && CREATED_ROWS="$SMOKE_ID" && echo "        id=$SMOKE_ID"
case "$BODY" in *'"hidden":false'*|*'"hidden": false'*) ;; *) [ "$STATUS" = 201 ] && echo "        WARN: hidden not echoed as false" ;; esac

req GET "/rest/v1/rpc/wawa_hero_leaderboard?p_song_id=smoke-test&p_difficulty=easy&p_limit=5"
case "$BODY" in *smoke-test*) ;; *) STATUS="MISSING" ;; esac
expect "smoke row appears on its own leaderboard" '200'

echo "[write] invalid payloads must be rejected"
U1="$(uuid)"; U2="$(uuid)"; U3="$(uuid)"; U4="$(uuid)"; U5="$(uuid)"
S="shots/"
BIDI="$(printf '\\%s' u202e)"  # JSON escape text for U+202E (RIGHT-TO-LEFT OVERRIDE)
json_insert "$(payload 'country="fr"')";                                  expect "country 'fr' (lowercase)" '4*'
json_insert "$(payload 'country="FRA"')";                                 expect "country 'FRA' (3 letters)" '4*'
json_insert "$(payload 'country="F1"')";                                  expect "country 'F1'" '4*'
json_insert "$(payload 'share_shots=true' "shots=[\"$S$U1.webp\",\"$S$U2.webp\",\"$S$U3.webp\",\"$S$U4.webp\",\"$S$U5.webp\"]")"
expect "5 shots" '4*'
json_insert "$(payload 'share_shots=true' "shots=[\"$S$U1.png\"]")";      expect "non-webp shot path" '4*'
json_insert "$(payload 'share_shots=true' "shots=[\"other/$U1.webp\"]")"; expect "shot outside shots/" '4*'
json_insert "$(payload 'share_shots=true' 'shots=["https://evil.example/x.webp"]')"; expect "shot as external URL" '4*'
json_insert "$(payload 'share_shots=true' 'shots=[null]')";               expect "null shot element" '4*'
json_insert "$(payload "shots=[\"$S$U1.webp\"]")";                        expect "shots while share_shots = false" '4*'
json_insert "$(payload 'hidden=true')";                                   expect "setting hidden = true" '4*'
json_insert "$(payload 'hidden=false')";                                  expect "setting hidden at all (column not granted)" '4*'
json_insert "$(payload "id=\"$U1\"")";                                    expect "setting id" '4*'
json_insert "$(payload 'created_at="2020-01-01T00:00:00Z"')";             expect "setting created_at" '4*'
json_insert "$(payload 'player_name="seventeen-chars-x"')";               expect "name of 17 chars" '4*'
json_insert "$(payload 'player_name=" smoke"')";                          expect "name with leading space" '4*'
json_insert "$(payload 'player_name=""')";                                expect "empty name" '4*'
json_insert "$(payload 'player_name="smo\u0007ke"')";                     expect "name with control char" '4*'
json_insert "$(payload "player_name=\"smo${BIDI}ke\"")";                  expect "name with bidi override (U+202E)" '4*'
json_insert "$(payload 'score=2000001')";                               expect "score > 2,000,000" '4*'
json_insert "$(payload 'score=-1')";                                    expect "negative score" '4*'
json_insert "$(payload 'stars=4')";                                     expect "stars = 4" '4*'
json_insert "$(payload 'kcal=2000.1')";                                 expect "kcal > 2000" '4*'
json_insert "$(payload 'duration_s=3601')";                             expect "duration > 3600" '4*'
json_insert "$(payload 'miss=-3')";                                     expect "negative miss" '4*'
json_insert "$(payload 'difficulty="hard"')";                           expect "difficulty 'hard'" '4*'
json_insert "$(payload 'mode="versus"')";                               expect "versus without versus_rank" '4*'
json_insert "$(payload 'versus_rank=1')";                               expect "solo with versus_rank" '4*'
json_insert "$(payload 'song_id="../etc"')";                            expect "bad song_id" '4*'
json_insert "$(payload 'client_version="0123456789012345678901234567890123"')"; expect "client_version > 32 chars" '4*'

echo "[write] anon cannot modify or delete"
if [ -n "$SMOKE_ID" ]; then
  req PATCH "/rest/v1/wawa_hero_scores?id=eq.$SMOKE_ID" -H 'Content-Type: application/json' \
    -H 'Prefer: return=representation' --data '{"score":2000000}'
  case "$STATUS" in 2*) [ "$BODY" = "[]" ] && STATUS="403-ish" ;; esac
  expect "PATCH smoke row" '4*'
  req PATCH "/rest/v1/wawa_hero_scores?id=eq.$SMOKE_ID" -H 'Content-Type: application/json' \
    -H 'Prefer: return=representation' --data '{"hidden":true}'
  case "$STATUS" in 2*) [ "$BODY" = "[]" ] && STATUS="403-ish" ;; esac
  expect "PATCH hidden on smoke row" '4*'
  req DELETE "/rest/v1/wawa_hero_scores?id=eq.$SMOKE_ID" -H 'Prefer: return=representation'
  case "$STATUS" in 2*) [ "$BODY" = "[]" ] && STATUS="403-ish" ;; esac
  expect "DELETE smoke row" '4*'
else
  echo "  SKIP  (no smoke row id)"
fi

# ---------------------------------------------------------------------------
echo "[write] storage"
# 1x1 lossless WebP (26 bytes).
printf '%s' 'UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==' | base64 --decode > "$TMP/tiny.webp"
printf 'not an image\n' > "$TMP/note.txt"
{ printf 'RIFF\0\0\0\0WEBPVP8L'; head -c 215000 /dev/zero; } > "$TMP/big.webp"

GOOD="shots/$(uuid).webp"
req POST "/storage/v1/object/wawa-hero/$GOOD" -H 'Content-Type: image/webp' -H 'x-upsert: false' \
  -H 'cache-control: max-age=31536000' --data-binary "@$TMP/tiny.webp"
expect "valid tiny webp upload ($GOOD)" '200'
[ "$STATUS" = 200 ] && UPLOADED="$GOOD"
if [ "$STATUS" != 200 ]; then
  case "$BODY" in *"row-level security"*|*Unauthorized*|*403*)
    echo "        -> if INSERT policy looks right, this storage-api version may need the optional SELECT policy (see migration)" ;;
  esac
fi

req GET "/storage/v1/object/public/wawa-hero/$GOOD"
expect "uploaded shot is publicly readable" '200'

req POST "/storage/v1/object/wawa-hero/$GOOD" -H 'Content-Type: image/webp' -H 'x-upsert: false' \
  --data-binary "@$TMP/tiny.webp"
expect "re-upload same name, x-upsert false (no overwrite)" '4*'

req POST "/storage/v1/object/wawa-hero/$GOOD" -H 'Content-Type: image/webp' -H 'x-upsert: true' \
  --data-binary "@$TMP/tiny.webp"
expect "re-upload same name, x-upsert true (no overwrite)" '4*'

req PUT "/storage/v1/object/wawa-hero/$GOOD" -H 'Content-Type: image/webp' --data-binary "@$TMP/tiny.webp"
expect "PUT (update) existing object" '4*'

req DELETE "/storage/v1/object/wawa-hero/$GOOD"
req GET "/storage/v1/object/public/wawa-hero/$GOOD"
expect "DELETE by anon has no effect (still readable)" '200'

req POST "/storage/v1/object/wawa-hero/shots/$(uuid).webp" -H 'Content-Type: text/plain' \
  -H 'x-upsert: false' --data-binary "@$TMP/note.txt"
expect "text/plain upload to a valid path" '4*'

req POST "/storage/v1/object/wawa-hero/other/$(uuid).webp" -H 'Content-Type: image/webp' \
  -H 'x-upsert: false' --data-binary "@$TMP/tiny.webp"
expect "webp upload outside shots/" '4*'

req POST "/storage/v1/object/wawa-hero/shots/not-a-uuid.webp" -H 'Content-Type: image/webp' \
  -H 'x-upsert: false' --data-binary "@$TMP/tiny.webp"
expect "webp upload with non-uuid name" '4*'

req POST "/storage/v1/object/wawa-hero/shots/$(uuid).png" -H 'Content-Type: image/webp' \
  -H 'x-upsert: false' --data-binary "@$TMP/tiny.webp"
expect "upload with .png extension" '4*'

req POST "/storage/v1/object/wawa-hero/shots/$(uuid).webp" -H 'Content-Type: image/webp' \
  -H 'x-upsert: false' --data-binary "@$TMP/big.webp"
expect "upload > 200 KB" '4*'

# ---------------------------------------------------------------------------
if [ "$RATE" = 1 ]; then
  echo "[write] rate limit (per-IP 6/min, global 20/min)"
  HIT=""
  i=0
  while [ $i -lt 7 ]; do
    i=$((i + 1))
    json_insert "$(payload)"
    case "$STATUS" in
      201) RID="$(printf '%s' "$BODY" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([0-9a-f-]\{36\}\)".*/\1/p')"
           CREATED_ROWS="$CREATED_ROWS $RID" ;;
      *) HIT="$STATUS"; break ;;
    esac
  done
  STATUS="${HIT:-none}"
  case "$BODY" in *wawa_hero_rate_limited*) ;; *) [ -n "$HIT" ] && STATUS="other:$HIT" ;; esac
  expect "limiter answers 429 within 7 rapid inserts" '429'
fi

# ---------------------------------------------------------------------------
echo
echo "write run: $PASS passed, $FAIL failed"
echo
echo "Cleanup (run as admin in Studio SQL editor / psql):"
echo "  delete from public.wawa_hero_scores where song_id = 'smoke-test' or player_name = 'smoke-test';"
echo "  delete from public.wawa_hero_rate;"
[ -n "$CREATED_ROWS" ] && echo "  -- rows created by this run: $CREATED_ROWS"
if [ -n "$UPLOADED" ]; then
  echo "  -- and delete the test image in Studio > Storage > wawa-hero: $UPLOADED"
fi
[ "$FAIL" = 0 ]
