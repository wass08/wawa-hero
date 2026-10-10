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


def min_gap(a: dict, b: dict, P: float, density: str) -> float:
    if density != "easy" and a["move"] == "clap" and b["move"] == "clap":
        return CLAP_PAIR_BEATS * P
    return EASY_MIN_GAP if density == "easy" else MIN_GAP


def validate_chart(song: dict, c: dict, density: str = "normal") -> list[str]:
    """density: the generator's note-density rules the chart was built with (the game ships "normal")."""
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
    P = 60.0 / bpm
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
            elif not (SWEEP_BEATS[0] * P - TOL <= d <= SWEEP_BEATS[1] * P + TOL):
                e(f"{tag}: sweep dur {d:.3f}s not in 2-4 beats")
        elif "dur" in n:
            e(f"{tag}: tap note with dur")
        if density == "easy" and n["move"] not in EASY_MOVES:
            e(f"{tag}: move {n['move']} not allowed on easy")
    for i, (a, b) in enumerate(zip(notes, notes[1:])):
        tag = f"notes#{i}->{i+1} ({a['t']:.3f} {a['move']} -> {b['t']:.3f} {b['move']})"
        if b["t"] <= a["t"]:
            e(f"{tag}: not sorted")
        gap = b["t"] - end(a)
        need = min_gap(a, b, P, density)
        if gap < need - TOL:
            e(f"{tag}: gap {gap:.3f}s < {need:.3f}s")
        if b["move"] == "sweep" and gap < SWEEP_FREE_BEFORE * P - TOL:
            e(f"{tag}: needs a free beat before the sweep (gap {gap/P:.2f} beats)")
        if a["move"] == "sweep" and gap < SWEEP_FREE_AFTER * P - TOL:
            e(f"{tag}: needs >=1 beat after the sweep (gap {gap/P:.2f} beats)")
        if b["move"] == PHOTO and gap < PHOTO_BEFORE * P - TOL:
            e(f"{tag}: needs 2 free beats before the photo (gap {gap/P:.2f} beats)")
        if a["move"] == PHOTO and gap < PHOTO_AFTER * P - TOL:
            e(f"{tag}: needs >=1 free beat after the photo (gap {gap/P:.2f} beats)")
    if density != "hard":
        chain = 1
        for a, b in zip(notes, notes[1:]):
            if PHOTO in (a["move"], b["move"]):      # photos are outside the density rules
                chain = 0 if b["move"] == PHOTO else 1
            elif b["t"] - end(a) < REST_BEATS * P - TOL and "sweep" not in (a["move"], b["move"]):
                chain += 1
                if chain > MAX_CHAIN:
                    e(f">{MAX_CHAIN} notes without a 1-beat rest ending at {b['t']:.3f}")
                    break
            else:
                chain = 1
        opp = {"split_lu": "split_ld", "split_ld": "split_lu"}
        for a, b in zip(notes, notes[1:]):
            if opp.get(a["move"]) == b["move"] and b["t"] - a["t"] < REST_BEATS * P - TOL:
                e(f"split flip {a['t']:.3f}->{b['t']:.3f} faster than 2 beats")
    if "camera" in c:
        errs += validate_camera(c, dur)
    if density == "easy":
        sweeps = sum(n["move"] == "sweep" for n in notes)
        if sweeps > max(1, len(c.get("sections", [])) // 3):
            e(f"easy: too many sweeps ({sweeps})")
    return errs


def validate_camera(c: dict, dur: float) -> list[str]:
    errs = []
    cam = c.get("camera")
    if cam is None:
        return ["no camera track"]
    if not cam:
        return ["empty camera track"]
    bar = 4 * 60.0 / c["bpm"]
    dbs = c.get("downbeats") or []
    for i, q in enumerate(cam):
        tag = f"camera#{i} t={q.get('t')}"
        if q.get("shot") not in SHOTS:
            errs.append(f"{tag}: invalid shot {q.get('shot')}")
        if not (0 <= q["t"] < dur):
            errs.append(f"{tag}: outside the song")
        if not (0 <= q.get("ease", -1) <= 4):
            errs.append(f"{tag}: bad ease {q.get('ease')}")
        if q["t"] > 0 and dbs and min(abs(q["t"] - d) for d in dbs) > DOWNBEAT_TOL:
            errs.append(f"{tag}: not on a downbeat")
    for a, b in zip(cam, cam[1:]):
        if b["t"] <= a["t"]:
            errs.append(f"camera not sorted at {b['t']}")
        elif b["t"] - a["t"] < CAM_MIN_BARS * bar - DOWNBEAT_TOL:
            errs.append(f"camera cues {a['t']} -> {b['t']} closer than {CAM_MIN_BARS} bars")
    return errs


def validate_preview(song: dict, downbeats: list[float]) -> list[str]:
    pv = song.get("preview")
    if not pv:
        return ["no preview"]
    errs = []
    s, d = pv["start"], pv["dur"]
    if not (0 <= s and s + d <= song["duration"]):
        errs.append(f"preview {s}+{d} outside the song")
    if not (PREVIEW_SEC[0] - TOL <= d <= PREVIEW_SEC[1] + TOL):
        errs.append(f"preview dur {d} not in {PREVIEW_SEC}")
    bar = 4 * 60.0 / song["bpm"]
    if abs(d / bar - round(d / bar)) * bar > DOWNBEAT_TOL:
        errs.append(f"preview dur {d} is not a whole number of bars ({d / bar:.3f})")
    if downbeats and min(abs(s - x) for x in downbeats) > DOWNBEAT_TOL:
        errs.append(f"preview start {s} not on a downbeat")
    return errs


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
        for n in ph:
            assert min(abs(n["t"] - x) for x in c["downbeats"]) <= DOWNBEAT_TOL, f"photo {n['t']} not on a downbeat"
        ts = [n["t"] for n in ph]
        assert ts[0] >= PHOTO_MIN_T, f"first photo at {ts[0]} (< ~30 s)"
        assert all(b - a >= PHOTO_SPREAD for a, b in zip(ts, ts[1:])), f"photos not spread: {ts}"
        # the free-beats-around-a-photo rule is checked in validate_chart


def test_previews():
    for song in load_index()["songs"]:
        errs = validate_preview(song, load_chart(song).get("downbeats", []))
        assert not errs, f"{song['id']}: " + "; ".join(errs)


def _has(notes, t, move, tol=0.06):
    return any(abs(n["t"] - t) <= tol and n["move"] == move for n in notes)


def _system_online():
    return next((s for s in load_index()["songs"] if s["id"] == "system-online"), None)


def test_system_online_follows_the_voice():
    """Regression for the hand-pinned vocal commands (public/songs/system-online/overrides.json)."""
    song = _system_online()
    if song is None:
        return
    c = load_chart(song)
    ns = c["notes"]
    for shift in (0.0, 72.381):           # chorus 2 is chorus 1 + 152 beats @126 BPM
        assert _has(ns, 51.951 + shift, "up"), ("Arms. Up.", shift)
        assert _has(ns, 53.141 + shift, "down"), ("Arms. Down.", shift)
        assert _has(ns, 55.760 + shift, "split_lu"), ("Left up.", shift)
        assert any(n["move"] == "split_ld" and 57.9 + shift <= n["t"] <= 58.9 + shift for n in ns), shift
    assert any(n["move"] == "sweep" and abs(n["t"] - 114.32) < 0.06 for n in ns), "top to floor"
    assert not any(n["t"] < 21.0 for n in ns), "notes during the spoken intro"
    assert abs(song["preview"]["start"] - 51.71) < 0.05, "preview should start on chorus 1 ('Arms. Up.')"
    cam = {round(q["t"], 1): q for q in c["camera"]}
    assert cam[51.7]["shot"] == "close" and cam[51.7]["ease"] == 0, "close cut on chorus 1 commands"
    assert cam[124.1]["shot"] == "close", "close on chorus 2 commands"
    assert cam[139.3]["shot"] == "drop", "drop on the drop"
    photos = [n["t"] for n in ns if n["move"] == PHOTO]
    assert photos == [65.046, 122.189, 139.332, 160.284], photos


def test_system_online_double_claps_on_the_vocal():
    song = _system_online()
    if song is None:
        return
    c = load_chart(song)
    claps = [n["t"] for n in c["notes"] if n["move"] == "clap"]
    P = 60.0 / c["bpm"]
    for sung in SYSTEM_ONLINE_SUNG_CLAPS:
        near = min(claps, key=lambda t: abs(t - sung))
        assert abs(near - sung) <= DOWNBEAT_TOL, f"sung clap at {sung}: nearest chart clap {near}"
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
