"""Validate the chart of every song in public/songs/index.json (+ unit tests of the generator).

One chart per song: public/songs/<id>/chart.json (no difficulty levels).

    uv run --with pytest --with numpy pytest -q tests/chart
    python3 -I tests/chart/test_charts.py          # stdlib-only fallback (generator unit tests skipped)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "public"
INDEX = PUBLIC / "songs" / "index.json"

DANCE_MOVES = {"up", "down", "clap", "split_lu", "split_ld", "sweep"}
PHOTO = "photo"                       # free pose, not judged, not a dance move
MOVES = DANCE_MOVES | {PHOTO}
EASY_MOVES = {"up", "down", "clap", "sweep", PHOTO}
N_PHOTOS, PHOTO_BEFORE, PHOTO_AFTER, PHOTO_MIN_T, PHOTO_SPREAD = 4, 2.0, 1.0, 29.5, 15.0
MIN_GAP, EASY_MIN_GAP = 0.40, 0.90
CLAP_PAIR_BEATS = 0.5                 # "Clap. Clap." exception: clap -> clap may be half a beat apart
SWEEP_BEATS = (2.0, 4.0)
SWEEP_FREE_BEFORE, SWEEP_FREE_AFTER = 2.0, 1.0   # beats (note -> sweep start, sweep end -> note)
REST_BEATS, MAX_CHAIN = 2.0, 6
TOL = 0.02
SHOTS = {"front", "wide", "close", "low_left", "low_right", "high", "orbit", "drop"}
CAM_MIN_BARS, DOWNBEAT_TOL = 2, 0.03
PREVIEW_SEC = (12.0, 20.0)
# vocal "Clap. Clap." onsets found by MMS forced alignment on the demucs vocal stem (tools/chart/align_lyrics.py)
SYSTEM_ONLINE_SUNG_CLAPS = [53.606, 53.846, 125.987, 126.207]


def load_index():
    with open(INDEX) as f:
        return json.load(f)


def load_chart(song: dict) -> dict:
    with open(PUBLIC / song["chart"]) as f:
        return json.load(f)


def end(n):
    return n["t"] + (n.get("dur", 0.0) if n["move"] == "sweep" else 0.0)


def beat_pos(c: dict, t: float) -> float:
    """fractional beat index of time t on the chart's beat grid (tempo may drift); linear outside"""
    bs = c.get("beats") or []
    if len(bs) < 2:
        return (t - c.get("offset", 0.0)) * c["bpm"] / 60.0
    if t <= bs[0]:
        return (t - bs[0]) / (bs[1] - bs[0])
    if t >= bs[-1]:
        return len(bs) - 1 + (t - bs[-1]) / (bs[-1] - bs[-2])
    lo, hi = 0, len(bs) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        lo, hi = (mid, hi) if bs[mid] <= t else (lo, mid)
    return lo + (t - bs[lo]) / (bs[hi] - bs[lo])


def beats_between(c: dict, t0: float, t1: float) -> float:
    return beat_pos(c, t1) - beat_pos(c, t0)


def local_beat(c: dict, t: float) -> float:
    """seconds per beat around t"""
    return 1.0 / max(1e-6, beats_between(c, t - 0.25, t + 0.25)) * 0.5


BTOL = 0.05                            # beats of tolerance for grid-based rules


def min_gap(a: dict, b: dict, c: dict, density: str) -> float:
    if density != "easy" and a["move"] == "clap" and b["move"] == "clap":
        return CLAP_PAIR_BEATS * local_beat(c, b["t"])
    return EASY_MIN_GAP if density == "easy" else MIN_GAP


def validate_chart(song: dict, c: dict, density: str = "normal") -> list[str]:
    """density: the generator's note-density rules the chart was built with (the game ships "normal").
    Beat-based rules use the chart's own beat grid, so they hold on songs whose tempo drifts."""
    errs = []
    e = errs.append
    if c.get("version") != 1:
        e("version != 1")
    if c.get("songId") != song["id"]:
        e("songId mismatch")
    bpm = c.get("bpm", 0)
    if not (40 <= bpm <= 250):
        e(f"bad bpm {bpm}")
        return errs
    dur = song["duration"]
    off = c.get("offset", -1)
    if not (0 <= off < dur):
        e(f"bad offset {off}")
    beats = c.get("beats", [])
    if beats and any(b2 <= b1 for b1, b2 in zip(beats, beats[1:])):
        e("beats not strictly ascending")
    dbs = c.get("downbeats", [])
    if dbs and beats and not set(dbs) <= set(beats):
        e("downbeats not a subset of beats")
    if dbs and abs(dbs[0] - off) > 1e-3:
        e("offset != first downbeat")
    notes = c.get("notes", [])
    if not notes:
        e("no notes")
    for i, n in enumerate(notes):
        tag = f"note#{i} t={n.get('t')}"
        if n.get("move") not in MOVES:
            e(f"{tag}: invalid move {n.get('move')}")
            continue
        if not (0 <= n["t"] and end(n) <= dur):
            e(f"{tag}: outside song (0..{dur})")
        if n["move"] == "sweep":
            d = n.get("dur")
            if d is None:
                e(f"{tag}: sweep without dur")
            else:
                nb = beats_between(c, n["t"], n["t"] + d)
                if not (SWEEP_BEATS[0] - BTOL <= nb <= SWEEP_BEATS[1] + BTOL):
                    e(f"{tag}: sweep lasts {nb:.2f} beats, not 2-4")
        elif "dur" in n:
            e(f"{tag}: tap note with dur")
        if density == "easy" and n["move"] not in EASY_MOVES:
            e(f"{tag}: move {n['move']} not allowed on easy")
    for i, (a, b) in enumerate(zip(notes, notes[1:])):
        tag = f"notes#{i}->{i+1} ({a['t']:.3f} {a['move']} -> {b['t']:.3f} {b['move']})"
        if b["t"] <= a["t"]:
            e(f"{tag}: not sorted")
        gap = b["t"] - end(a)
        gb = beats_between(c, end(a), b["t"])
        need = min_gap(a, b, c, density)
        if gap < need - TOL:
            e(f"{tag}: gap {gap:.3f}s < {need:.3f}s")
        if b["move"] == "sweep" and gb < SWEEP_FREE_BEFORE - BTOL:
            e(f"{tag}: needs a free beat before the sweep (gap {gb:.2f} beats)")
        if a["move"] == "sweep" and gb < SWEEP_FREE_AFTER - BTOL:
            e(f"{tag}: needs >=1 beat after the sweep (gap {gb:.2f} beats)")
        if b["move"] == PHOTO and gb < PHOTO_BEFORE - BTOL:
            e(f"{tag}: needs 2 free beats before the photo (gap {gb:.2f} beats)")
        if a["move"] == PHOTO and gb < PHOTO_AFTER - BTOL:
            e(f"{tag}: needs >=1 free beat after the photo (gap {gb:.2f} beats)")
    if density != "hard":
        chain = 1
        for a, b in zip(notes, notes[1:]):
            if PHOTO in (a["move"], b["move"]):      # photos are outside the density rules
                chain = 0 if b["move"] == PHOTO else 1
            elif beats_between(c, end(a), b["t"]) < REST_BEATS - BTOL and "sweep" not in (a["move"], b["move"]):
                chain += 1
                if chain > MAX_CHAIN:
                    e(f">{MAX_CHAIN} notes without a 1-beat rest ending at {b['t']:.3f}")
                    break
            else:
                chain = 1
        opp = {"split_lu": "split_ld", "split_ld": "split_lu"}
        for a, b in zip(notes, notes[1:]):
            if opp.get(a["move"]) == b["move"] and beats_between(c, a["t"], b["t"]) < REST_BEATS - BTOL:
                e(f"split flip {a['t']:.3f}->{b['t']:.3f} faster than 2 beats")
    if "camera" in c:
        errs += validate_camera(c, dur)
    if density == "easy":
        sweeps = sum(n["move"] == "sweep" for n in notes)
        if sweeps > max(1, len(c.get("sections", [])) // 3):
            e(f"easy: too many sweeps ({sweeps})")
    return errs


def _nearest(xs: list[float], t: float) -> tuple[int, float]:
    i = min(range(len(xs)), key=lambda k: abs(xs[k] - t))
    return i, abs(xs[i] - t)


def validate_camera(c: dict, dur: float) -> list[str]:
    errs = []
    cam = c.get("camera")
    if cam is None:
        return ["no camera track"]
    if not cam:
        return ["empty camera track"]
    dbs = c.get("downbeats") or []
    bar_of = []
    for i, q in enumerate(cam):
        tag = f"camera#{i} t={q.get('t')}"
        if q.get("shot") not in SHOTS:
            errs.append(f"{tag}: invalid shot {q.get('shot')}")
        if not (0 <= q["t"] < dur):
            errs.append(f"{tag}: outside the song")
        if not (0 <= q.get("ease", -1) <= 4):
            errs.append(f"{tag}: bad ease {q.get('ease')}")
        if dbs:
            k, d = _nearest(dbs, q["t"])
            bar_of.append(0 if q["t"] == 0 else k)
            if q["t"] > 0 and d > DOWNBEAT_TOL:
                errs.append(f"{tag}: not on a downbeat")
    for i, (a, b) in enumerate(zip(cam, cam[1:])):
        if b["t"] <= a["t"]:
            errs.append(f"camera not sorted at {b['t']}")
        elif bar_of and bar_of[i + 1] - bar_of[i] < CAM_MIN_BARS:
            errs.append(f"camera cues {a['t']} -> {b['t']} closer than {CAM_MIN_BARS} bars")
    return errs


def validate_preview(song: dict, downbeats: list[float]) -> list[str]:
    """inside the song, 12-20 s, starts AND ends on downbeats (= a whole number of bars, even if the tempo drifts)"""
    pv = song.get("preview")
    if not pv:
        return ["no preview"]
    errs = []
    s, d = pv["start"], pv["dur"]
    if not (0 <= s and s + d <= song["duration"]):
        errs.append(f"preview {s}+{d} outside the song")
    if not (PREVIEW_SEC[0] - TOL <= d <= PREVIEW_SEC[1] + TOL):
        errs.append(f"preview dur {d} not in {PREVIEW_SEC}")
    if downbeats:
        if _nearest(downbeats, s)[1] > DOWNBEAT_TOL:
            errs.append(f"preview start {s} not on a downbeat")
        if _nearest(downbeats, s + d)[1] > DOWNBEAT_TOL:
            errs.append(f"preview end {s + d:.3f} not on a downbeat (not a whole number of bars)")
    else:
        bar = 4 * 60.0 / song["bpm"]
        if abs(d / bar - round(d / bar)) * bar > DOWNBEAT_TOL:
            errs.append(f"preview dur {d} is not a whole number of bars")
    return errs


MOVE_WEIGHT = {"up": 1.0, "down": 1.0, "clap": 1.0, "split_lu": 1.6, "split_ld": 1.6, "sweep": 2.0}


def difficulty_score(c: dict) -> float:
    """same definition as tools/chart/make_chart.py difficulty_score (independent re-implementation)"""
    ms = [n for n in c["notes"] if n["move"] != PHOTO]
    span = max(1.0, ms[-1]["t"] - ms[0]["t"])
    load = sum(MOVE_WEIGHT[n["move"]] for n in ms)
    for a, b in zip(ms, ms[1:]):
        if beats_between(c, end(a), b["t"]) < 1.05:
            load += MOVE_WEIGHT[b["move"]]
    return load / span


# ------------------------------------------------------------------ pytest tests

def test_index_entries():
    data = load_index()
    assert data["songs"], "index has no songs"
    ids = [s["id"] for s in data["songs"]]
    assert len(ids) == len(set(ids)), "duplicate song ids"
    for s in data["songs"]:
        for k in ("id", "title", "artist", "audio", "cover", "bpm", "duration", "energy", "moves", "chart", "preview"):
            assert k in s, f"{s.get('id')}: missing {k}"
        assert "charts" not in s, f"{s['id']}: per-difficulty 'charts' is gone; use 'chart'"
        assert s["chart"] == f"songs/{s['id']}/chart.json", s["chart"]
        assert (PUBLIC / s["audio"]).is_file(), s["audio"]
        assert (PUBLIC / s["cover"]).is_file(), s["cover"]
        assert s["energy"] in (1, 2, 3)
        used = {n["move"] for n in load_chart(s)["notes"]} - {PHOTO}
        assert set(s["moves"]) == used, f"{s['id']}: moves {s['moves']} != used {sorted(used)}"
        assert PHOTO not in s["moves"], "photo is not a dance move"
        assert s.get("photos") == N_PHOTOS, f"{s['id']}: index photos field"


def test_one_chart_per_song():
    for song in load_index()["songs"]:
        sdir = PUBLIC / "songs" / song["id"]
        assert (sdir / "chart.json").is_file()
        assert not (sdir / "charts").exists(), f"{song['id']}: old per-difficulty charts/ dir still there"


def test_all_charts_valid():
    problems = []
    for song in load_index()["songs"]:
        problems += [f"{song['id']}: {m}" for m in validate_chart(song, load_chart(song))]
    assert not problems, "\n".join(problems[:50])


def test_camera_tracks():
    for song in load_index()["songs"]:
        c = load_chart(song)
        errs = validate_camera(c, song["duration"])
        assert not errs, f"{song['id']}: " + "; ".join(errs)
        assert c["camera"][0]["shot"] == "wide", "camera must start wide (intro)"
        assert c["camera"][-1]["shot"] == "wide", "camera must end wide (outro)"


def test_photo_cues():
    for song in load_index()["songs"]:
        c = load_chart(song)
        ph = [n for n in c["notes"] if n["move"] == PHOTO]
        assert len(ph) == N_PHOTOS, f"{song['id']}: {len(ph)} photo cues"
        assert all(set(n) == {"t", "move"} for n in ph), "photo notes are {t, move} only"
        for n in ph:   # on the beat grid (the app counts 3-2-1 on the beat); downbeat unless pinned on a sung word
            assert _nearest(c["beats"], n["t"])[1] <= DOWNBEAT_TOL, f"{song['id']}: photo {n['t']} not on a beat"
        ts = [n["t"] for n in ph]
        assert ts[0] >= PHOTO_MIN_T, f"{song['id']}: first photo at {ts[0]} (< ~30 s)"
        assert all(b - a >= PHOTO_SPREAD for a, b in zip(ts, ts[1:])), f"{song['id']}: photos not spread: {ts}"
        # the free-beats-around-a-photo rule is checked in validate_chart


def test_previews():
    for song in load_index()["songs"]:
        errs = validate_preview(song, load_chart(song).get("downbeats", []))
        assert not errs, f"{song['id']}: " + "; ".join(errs)


# ---- per-song regression: hand-pinned vocal commands, photos, camera, preview (public/songs/<id>/overrides.json)
# "vocal" times were measured on the demucs vocal stem: MMS forced alignment (System Online) or vocal attacks
# = 300-3000 Hz onsets near the whisper/forced-alignment word (Arms Up / Wawa Hero). Each note must sit within
# +-30 ms of the sung command. (t_vocal, move); sweeps also check where they end.
SONGS = {
    "arms-up-arms-down": {
        "energy": 1,
        "commands": [(35.720, "up"), (37.465, "down"), (39.030, "clap"), (39.610, "clap"), (40.555, "clap"),
                     (40.980, "clap"), (42.740, "up"), (44.500, "down"), (46.675, "sweep"),
                     (81.150, "up"), (82.890, "down"), (84.355, "clap"), (85.025, "clap"), (85.960, "clap"),
                     (86.375, "clap"), (88.140, "up"), (89.845, "down"), (92.000, "sweep")],
        "sweep_ends": [47.985, 93.365],          # "...sweep down LOW"
        "photos": [33.959, 49.784, 65.503, 95.097],
        "camera": {33.959: "drop", 37.489: "close", 49.784: "orbit", 77.717: "drop", 81.189: "close", 95.097: "drop"},
        "preview_start": 33.959,
        "no_notes_before": 5.7,                  # fiddle/banjo kick-off
        "last_note": (104.871, "clap"),          # the hard stop
    },
    "wawa-hero": {
        "energy": 2,
        "commands": [(45.090, "clap"), (46.085, "up"), (47.020, "clap"), (48.010, "down"), (48.440, "clap"),
                     (48.900, "clap"), (52.790, "split_lu"), (55.010, "split_ld"), (58.575, "sweep"),
                     (121.975, "clap"), (123.025, "up"), (123.920, "clap"), (124.905, "down"), (125.385, "clap"),
                     (125.865, "clap"), (129.685, "split_lu")],
        "sweep_ends": [60.390],                  # "...to the GROUND" (chorus 2 does not sing it)
        "photos_on_words": [40.295, 113.375],    # "Strike a POSE" vocal attacks (photo on the nearest beat)
        "camera": {43.201: "drop", 120.117: "drop"},
        "camera_last": "wide",
        "preview_start": 43.201,
        "no_notes_before": 6.4,                  # solo wah-wah riff
        "nothing_after": 143.11,                 # hard stop
    },
    "system-online": {
        "energy": 3,
        "commands": [(51.951, "up"), (53.141, "down"), (53.606, "clap"), (53.846, "clap"), (55.760, "split_lu"),
                     (124.332, "up"), (125.522, "down"), (125.987, "clap"), (126.207, "clap"), (128.141, "split_lu"),
                     (114.332, "sweep")],
        "photos": [65.046, 122.189, 139.332, 160.284],
        "camera": {51.713: "close", 124.094: "close", 139.332: "drop"},
        "preview_start": 51.713,
        "no_notes_before": 21.0,                 # spoken intro
    },
}


def _songs_by_id():
    return {s["id"]: s for s in load_index()["songs"]}


def test_index_order_and_energy():
    """song select lists the easiest first; pips 1/2/3 match a measured difficulty that really increases"""
    songs = load_index()["songs"]
    ids = [s["id"] for s in songs]
    assert ids[:3] == ["arms-up-arms-down", "wawa-hero", "system-online"], ids
    assert [s["energy"] for s in songs] == sorted(s["energy"] for s in songs), "index must be sorted easiest first"
    for sid, exp in SONGS.items():
        assert _songs_by_id()[sid]["energy"] == exp["energy"], sid
    scores = [difficulty_score(load_chart(_songs_by_id()[sid])) for sid in ("arms-up-arms-down", "wawa-hero", "system-online")]
    assert scores[0] < scores[1] < scores[2], f"difficulty must increase with the song order: {scores}"


def test_songs_follow_the_voice():
    by_id = _songs_by_id()
    for sid, exp in SONGS.items():
        if sid not in by_id:
            continue
        c = load_chart(by_id[sid])
        ns = c["notes"]
        for t, mv in exp["commands"]:
            near = [n for n in ns if n["move"] == mv and abs(n["t"] - t) <= DOWNBEAT_TOL]
            assert near, f"{sid}: no {mv} within 30 ms of the sung command at {t}"
        for te in exp.get("sweep_ends", []):
            assert any(n["move"] == "sweep" and abs(n["t"] + n["dur"] - te) <= DOWNBEAT_TOL for n in ns), (sid, te)
        assert not any(n["t"] < exp["no_notes_before"] for n in ns), f"{sid}: notes during the intro"
        if "nothing_after" in exp:
            assert all(end(n) < exp["nothing_after"] for n in ns), f"{sid}: note after the hard stop"
        if "last_note" in exp:
            t, mv = exp["last_note"]
            assert ns[-1]["move"] == mv and abs(ns[-1]["t"] - t) <= DOWNBEAT_TOL, (sid, ns[-1])
        photos = [n["t"] for n in ns if n["move"] == PHOTO]
        if "photos" in exp:
            assert photos == exp["photos"], (sid, photos)
        for t in exp.get("photos_on_words", []):
            assert any(abs(p - t) <= 0.5 * local_beat(c, t) for p in photos), f"{sid}: no photo on the sung word at {t}"
        cam = c["camera"]
        for t, shot in exp["camera"].items():
            assert any(abs(q["t"] - t) <= DOWNBEAT_TOL and q["shot"] == shot for q in cam), (sid, t, shot)
        if "camera_last" in exp:
            assert cam[-1]["shot"] == exp["camera_last"], sid
        assert abs(by_id[sid]["preview"]["start"] - exp["preview_start"]) <= DOWNBEAT_TOL, sid


def test_system_online_double_claps_on_the_vocal():
    song = _songs_by_id().get("system-online")
    if song is None:
        return
    c = load_chart(song)
    claps = [n["t"] for n in c["notes"] if n["move"] == "clap"]
    P = 60.0 / c["bpm"]
    for first in SYSTEM_ONLINE_SUNG_CLAPS[0::2]:
        a = min(claps, key=lambda t: abs(t - first))
        b = claps[claps.index(a) + 1]
        assert abs((b - a) - CLAP_PAIR_BEATS * P) < 0.005, f"double clap {a} -> {b} should be half a beat apart"


def test_clap_pair_exception():
    song = {"id": "x", "duration": 30.0}
    base = {"version": 1, "songId": "x", "bpm": 120.0, "offset": 0.5}          # half a beat = 0.25 s
    ok = [{"t": 5.0, "move": "down"}, {"t": 5.5, "move": "clap"}, {"t": 5.75, "move": "clap"}, {"t": 6.5, "move": "up"}]
    assert validate_chart(song, dict(base, notes=ok)) == [], validate_chart(song, dict(base, notes=ok))
    too_fast = [{"t": 5.0, "move": "clap"}, {"t": 5.2, "move": "clap"}]           # < half a beat
    assert validate_chart(song, dict(base, notes=too_fast))
    not_claps = [[{"t": 5.0, "move": "clap"}, {"t": 5.25, "move": "up"}],          # 0.4 s rule for every other pair
                 [{"t": 5.0, "move": "up"}, {"t": 5.25, "move": "clap"}],
                 [{"t": 5.0, "move": "clap"}, {"t": 5.25, "move": "clap"}, {"t": 5.5, "move": "up"}]]
    for ns in not_claps:
        assert validate_chart(song, dict(base, notes=ns)), ns
    assert validate_chart(song, dict(base, notes=ok), density="easy"), "no clap-pair exception on easy"
    mc = _tool()
    if mc is None:
        return
    an = _fake_analysis(mc)
    N = mc.Note
    out = mc.enforce([N(5.5, "clap", pinned=True), N(5.75, "clap", pinned=True), N(6.0, "up"), N(6.5, "up")],
                     an, "normal", warn=lambda *a: None)
    assert [(n.t, n.move) for n in out] == [(5.5, "clap"), (5.75, "clap"), (6.5, "up")]
    gen = mc.enforce([N(5.5, "clap"), N(5.75, "clap"), N(5.95, "up")], an, "normal", warn=lambda *a: None)
    assert [(n.t, n.move) for n in gen] == [(5.5, "clap"), (5.75, "clap")]


def test_validator_catches_violations():
    song = {"id": "x", "duration": 30.0}
    base = {"version": 1, "songId": "x", "bpm": 120.0, "offset": 0.5}
    bad = {
        "normal": [{"t": 5.0, "move": "up"}, {"t": 5.2, "move": "down"}],                      # gap < 0.4
        "hard": [{"t": 5.0, "move": "jump"}],                                                   # invalid move
        "easy": [{"t": 5.0, "move": "up"}, {"t": 5.6, "move": "clap"}],                          # easy < 0.9 s
    }
    for d, ns in bad.items():
        assert validate_chart(song, dict(base, notes=ns), density=d), d
    sweeps = [
        [{"t": 5.0, "move": "up"}, {"t": 5.5, "move": "sweep", "dur": 1.5}],                    # no free beat before
        [{"t": 5.0, "move": "sweep", "dur": 1.5}, {"t": 6.7, "move": "up"}],                    # < 1 beat after
        [{"t": 5.0, "move": "sweep", "dur": 3.0}],                                              # 6 beats long
        [{"t": 29.0, "move": "sweep", "dur": 1.5}],                                             # past the end
        [{"t": 6.0, "move": "up"}, {"t": 5.0, "move": "down"}],                                 # unsorted
    ]
    for ns in sweeps:
        assert validate_chart(song, dict(base, notes=ns)), ns
    crowded = [[{"t": 5.0, "move": "up"}, {"t": 5.5, "move": "photo"}],                     # < 2 beats before
               [{"t": 5.0, "move": "photo"}, {"t": 5.3, "move": "up"}]]                     # < 1 beat after
    for ns in crowded:
        assert validate_chart(song, dict(base, notes=ns)), ns
    chain = [{"t": 5.0 + 0.5 * i, "move": "clap"} for i in range(7)]
    assert validate_chart(song, dict(base, notes=chain))


# ---- unit tests of the generator's ergonomics pass (need numpy; librosa not required)

def _tool():
    import importlib.util
    try:
        import numpy  # noqa: F401
    except ImportError:
        return None
    spec = importlib.util.spec_from_file_location("make_chart", ROOT / "tools" / "chart" / "make_chart.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["make_chart"] = mod
    spec.loader.exec_module(mod)
    return mod


def _fake_analysis(mc, bpm=120.0, dur=60.0):
    import numpy as np
    P = 60.0 / bpm
    beats = np.arange(0.5, dur, P)
    return mc.Analysis(duration=dur, bpm=bpm, period=P, beats=beats, db_phase=0, sections=[], play_start=2.0,
                       play_end=dur - 1, rms_t=np.array([0.0, dur]), rms_db=np.array([0.0, 0.0]),
                       bar_pulse=np.ones(int(dur)) * 5)


def test_enforce_rules():
    mc = _tool()
    if mc is None:
        return
    an = _fake_analysis(mc)
    N = mc.Note
    raw = [N(10.0, "up"), N(10.2, "down"), N(10.5, "clap"), N(11.0, "up"), N(11.6, "sweep", 1.5),
           N(13.2, "clap"), N(13.6, "up", pinned=True)]
    out = mc.enforce(raw, an, "normal", warn=lambda *a: None)
    song = {"id": "x", "duration": 60.0}
    c = {"version": 1, "songId": "x", "difficulty": "normal", "bpm": 120.0, "offset": 0.5,
         "notes": [n.to_json() for n in out]}
    assert validate_chart(song, c) == [], validate_chart(song, c)
    assert any(n.t == 13.6 for n in out), "pinned note must survive"
    easy = mc.enforce([N(10.0 + 0.5 * i, "up") for i in range(10)], an, "easy", warn=lambda *a: None)
    assert all(b.t - a.t >= 0.9 - 0.02 for a, b in zip(easy, easy[1:]))
    long_chain = mc.enforce([N(10.0 + 0.5 * i, "clap") for i in range(16)], an, "normal", warn=lambda *a: None)
    c["notes"] = [n.to_json() for n in long_chain]
    assert validate_chart(song, c) == []


def test_override_pins_and_pattern():
    mc = _tool()
    if mc is None:
        return
    an = _fake_analysis(mc)
    gen = [mc.Note(t, "up") for t in (5.5, 6.5, 7.5, 8.5, 9.5, 10.5)]
    ov = {"pins": [{"start": 6.0, "end": 8.0, "snap": "half", "notes": [{"t": 6.52, "move": "split_lu"}],
                    "easy": [{"t": 7.0, "move": "sweep", "durBeats": 2}]},
                   {"start": 9.0, "end": 11.0, "pattern": {"moves": ["clap", None], "stepBeats": 1}}]}
    normal = mc.apply_overrides(an, gen, ov, "normal")
    assert [(round(n.t, 3), n.move) for n in normal if 6.0 <= n.t < 8.0] == [(6.5, "split_lu")]
    assert [n.move for n in normal if 9.0 <= n.t < 11.0] == ["clap", "clap"]
    easy = mc.apply_overrides(an, gen, ov, "easy")
    sw = [n for n in easy if n.move == "sweep"]
    assert len(sw) == 1 and abs(sw[0].dur - 1.0) < 1e-6


def test_camera_generator_rules():
    mc = _tool()
    if mc is None:
        return
    an = _fake_analysis(mc, dur=120.0)
    bar = 4 * an.period
    S = mc.Section
    an.sections = [S(0, 8, 0.0, 8 * bar + 0.5, level=0, label="intro"),
                   S(8, 24, 8 * bar + 0.5, 24 * bar + 0.5, level=1, label="verse"),
                   S(24, 40, 24 * bar + 0.5, 40 * bar + 0.5, level=2, label="chorus"),
                   S(40, 59, 40 * bar + 0.5, 120.0, level=0, label="outro")]
    an.play_end = 110.0
    ov = {"camera": [{"t": 24 * bar + 0.47, "shot": "orbit", "ease": 0.5, "until": 32 * bar + 0.5}]}
    cam = mc.camera_track(an, 1, ov, warn=lambda *a: None)
    c = {"bpm": an.bpm, "downbeats": [float(x) for x in an.downbeats], "camera": [q.to_json() for q in cam]}
    assert validate_camera(c, 120.0) == [], validate_camera(c, 120.0)
    assert cam[0].shot == "wide" and cam[-1].shot == "wide"
    pin = [q for q in cam if q.pinned]
    assert len(pin) == 1 and abs(pin[0].t - (24 * bar + 0.5)) < 1e-6, "pins snap to the downbeat"
    assert not any(24 * bar + 0.5 < q.t < 32 * bar + 0.5 for q in cam), "'until' holds the pinned shot"
    pv = mc.choose_preview(an, {})
    assert pv["start"] == round(24 * bar + 0.5, 3) and abs(pv["dur"] - 8 * bar) < 1e-3   # the chorus, 8 bars
    pv = mc.choose_preview(an, {"preview": {"start": 8 * bar + 0.4, "dur": 14.2}})
    assert pv["start"] == round(8 * bar + 0.5, 3) and abs(pv["dur"] - 7 * bar) < 1e-3


def test_photo_auto_placement():
    mc = _tool()
    if mc is None:
        return
    an = _fake_analysis(mc, dur=180.0)
    bar = 4 * an.period
    S = mc.Section
    edges = [0, 8, 24, 40, 56, 72, 89]
    levels = [0, 1, 2, 0, 2, 1]
    an.sections = [S(a, b, a * bar + 0.5, b * bar + 0.5, level=lv, label="x") for a, b, lv in zip(edges, edges[1:], levels)]
    an.play_start, an.play_end = 16.5, 170.0
    pin = {"start": 60.0, "end": 70.0, "notes": [{"t": 64.5, "move": "sweep", "durBeats": 4}]}
    ov = {"pins": [pin]}
    pinned = mc.pinned_notes(an, ov, ["easy", "normal"])
    photos = mc.choose_photos(an, ov, pinned, warn=lambda *a: None)
    ts = [p.t for p in photos]
    assert len(ts) == 4 and ts[0] >= 30 and all(b - a >= 15 for a, b in zip(ts, ts[1:])), ts
    for d in ("easy", "normal"):
        ns = sorted(pinned[d] + [mc.Note(t, "up") for t in [x * 0.5 + 20 for x in range(300)]]
                    + [mc.Note(p.t, "photo", pinned=True) for p in photos], key=lambda n: n.t)
        out = mc.enforce(ns, an, d, warn=lambda *a: None)
        c = {"version": 1, "songId": "x", "difficulty": d, "bpm": an.bpm, "offset": 0.5,
             "notes": [n.to_json() for n in out]}
        assert validate_chart({"id": "x", "duration": 180.0}, c, density=d) == [], validate_chart({"id": "x", "duration": 180.0}, c, density=d)[:3]
        assert sorted(n.t for n in out if n.move == "photo") == ts


def test_tempo_folding():
    mc = _tool()
    if mc is None:
        return
    assert mc._fold_tempo(63.0) == 126.0
    assert mc._fold_tempo(252.0) == 126.0
    assert mc._fold_tempo(100.0) == 100.0
    assert mc._fold_tempo(170.0) == 170.0 or mc._fold_tempo(170.0) == 85.0


if __name__ == "__main__":
    failed = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"ok   {name}")
            except AssertionError as ex:
                failed += 1
                print(f"FAIL {name}: {ex}")
    sys.exit(1 if failed else 0)
