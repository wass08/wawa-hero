#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "librosa>=0.10.2",
#   "numpy>=1.24",
#   "scipy>=1.10",
#   "soundfile>=0.12",
# ]
# ///
"""Wawa Hero chart importer.

    uv run tools/chart/make_chart.py <song.mp3> --id <song-id> [options]

Copies the song into public/songs/<id>/ (audio.mp3 + cover.jpg extracted from the tags),
analyses it (tempo, beat grid, downbeats, energy sections), generates deterministic
ONE chart per song (public/songs/<id>/chart.json, "normal" density; --difficulty easy|hard is
an opt-in density switch) with a phrase-based choreographer, photo cues, a camera-shot track and
a song-select preview loop, applies the optional hand-authored
public/songs/<id>/overrides.json, enforces the ergonomic rules and upserts the song into
public/songs/index.json.  See tools/chart/README.md.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

SR = 22050
HOP = 256
MOVES = ["up", "down", "clap", "split_lu", "split_ld", "sweep"]
TAPS = ["up", "down", "clap", "split_lu", "split_ld"]
DEFAULT_DIFFICULTY = "normal"                  # the game has one chart per song, at this density
ALL_DIFFICULTIES = ["easy", "normal", "hard"]  # other densities are an opt-in CLI switch
DIFFICULTIES = [DEFAULT_DIFFICULTY]
SHOTS = ["front", "wide", "close", "low_left", "low_right", "high", "orbit", "drop"]
CAM_MIN_BARS = 2          # no camera change faster than every 2 bars
PREVIEW_SEC = (12.0, 20.0)
PREVIEW_BARS = 8
PHOTO = "photo"           # free-pose "strike a pose" cue (not a dance move, never judged)
N_PHOTOS = 4
PHOTO_FREE_BEFORE, PHOTO_FREE_AFTER = 2.0, 1.0   # beats of free arms around a photo
FINAL_PHOTO_FREE_BEFORE = 1.0   # exception: a photo that is the chart's LAST note (the song's final hit / hard stop)
PHOTO_MIN_T, PHOTO_SPREAD = 30.0, 15.0           # first photo not before 30 s; photos >= 15 s apart

# ---- ergonomic rules (physical: the player dances with their arms) ----
MIN_GAP = 0.40            # s between any two notes (end of a sweep -> next note too)
EASY_MIN_GAP = 0.90       # s: easy = max one note per 0.9 s
SWEEP_MIN_BEATS, SWEEP_MAX_BEATS = 2.0, 4.0
SWEEP_FREE_BEFORE = 2.0   # beats from previous note to sweep start (= one whole free beat)
SWEEP_FREE_AFTER = 1.0    # beats from sweep end to the next note
REST_BEATS = 2.0          # a gap of >= 2 beats (one empty beat) counts as a rest
MAX_CHAIN = {"easy": 99, "normal": 6, "hard": 8}  # max consecutive notes without a rest
LEAD_IN = 2.0             # s: no note before this
TAIL = 1.0                # s: no note in the last second
EPS = 0.02
PULSE_WEAK = 1.4          # bar on-beat/off-beat onset ratio below this = no drums -> sparse notes only
PULSE_STRONG = 2.0        # play window = first..last bar with a pulse at least this clear


# =====================================================================================
# I/O helpers
# =====================================================================================

def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=True, capture_output=True, **kw)


def probe(path: Path) -> dict:
    out = run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)]).stdout
    info = json.loads(out)
    tags = {k.lower(): v for k, v in (info.get("format", {}).get("tags") or {}).items()}
    has_cover = any(s.get("codec_type") == "video" for s in info.get("streams", []))
    return {
        "duration": float(info["format"].get("duration", 0.0)),
        "title": tags.get("title"),
        "artist": tags.get("artist") or tags.get("album_artist"),
        "has_cover": has_cover,
    }


def decode(path: Path, sr: int = SR) -> np.ndarray:
    """Decode with ffmpeg (same gapless handling as the browser decoder) to mono float32."""
    raw = run(["ffmpeg", "-v", "error", "-i", str(path), "-vn", "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"]).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


# =====================================================================================
# Analysis
# =====================================================================================

@dataclass
class Section:
    start_bar: int
    end_bar: int            # exclusive
    start: float
    end: float
    level: int = 1          # 0 low / 1 mid / 2 high energy
    label: str = "verse"
    energy: float = 0.0     # raw (dB-ish) energy score
    key: str = ""           # routine key: sections with the same key share a routine
    moves: list[str] | None = None   # optional whitelist of moves for generated notes (overrides)


@dataclass
class Analysis:
    duration: float
    bpm: float
    period: float
    beats: np.ndarray        # beat times (s)
    db_phase: int            # beats[db_phase::4] are downbeats
    sections: list[Section]
    play_start: float
    play_end: float
    rms_t: np.ndarray
    rms_db: np.ndarray       # relative to max
    bar_pulse: np.ndarray    # per bar rhythmic clarity
    notes: list[str] = field(default_factory=list)

    @property
    def downbeats(self) -> np.ndarray:
        return self.beats[self.db_phase::4]

    @property
    def offset(self) -> float:
        return float(self.downbeats[0])

    def bar_beat(self, bar: int) -> int:
        """global beat index of the downbeat of bar `bar`"""
        return self.db_phase + 4 * bar

    def n_bars(self) -> int:
        return (len(self.beats) - self.db_phase) // 4

    def time_at(self, b: float) -> float:
        """time of (fractional) global beat index b; extrapolates linearly outside the grid."""
        n = len(self.beats)
        if b <= 0:
            return float(self.beats[0] + b * self.period)
        if b >= n - 1:
            return float(self.beats[-1] + (b - (n - 1)) * self.period)
        i = int(np.floor(b))
        return float(self.beats[i] + (b - i) * (self.beats[i + 1] - self.beats[i]))

    def beat_at(self, t: float) -> float:
        n = len(self.beats)
        if t <= self.beats[0]:
            return float((t - self.beats[0]) / self.period)
        if t >= self.beats[-1]:
            return float(n - 1 + (t - self.beats[-1]) / self.period)
        return float(np.interp(t, self.beats, np.arange(n)))

    def local_period(self, t: float) -> float:
        """beat length around t (= period on a rigid grid; follows tempo drift on tracked grids)"""
        b = self.beat_at(t)
        return self.time_at(b + 0.5) - self.time_at(b - 0.5)

    def beats_later(self, t: float, nbeats: float) -> float:
        return self.time_at(self.beat_at(t) + nbeats)

    def snap(self, t: float, step: float = 0.5) -> float:
        return self.time_at(round(self.beat_at(t) / step) * step)

    def level_db_at(self, t0: float, t1: float) -> float:
        m = (self.rms_t >= t0) & (self.rms_t < t1)
        return float(self.rms_db[m].mean()) if m.any() else -120.0


def _comb_scores(env: np.ndarray, ft: np.ndarray, bpms: np.ndarray, phase_step: float):
    """For each bpm, best mean onset strength on a rigid grid (max over phases)."""
    best = np.zeros(len(bpms))
    phase = np.zeros(len(bpms))
    t_end = ft[-1] - 0.05
    for i, bpm in enumerate(bpms):
        p = 60.0 / bpm
        ph = np.arange(0.0, p, phase_step)
        k = np.arange(0, int((t_end - p) / p))
        grid = ph[:, None] + k[None, :] * p
        s = np.interp(grid, ft, env).mean(axis=1)
        j = int(np.argmax(s))
        best[i], phase[i] = s[j], ph[j]
    return best, phase


def _fold_tempo(bpm: float, lo: float = 90.0, hi: float = 150.0) -> float:
    """Resolve half/double ambiguity: pick the octave-equivalent tempo a dancer would step to."""
    cands = [bpm * f for f in (0.25, 0.5, 1.0, 2.0, 4.0)]

    def dist(b):
        if lo <= b <= hi:
            return 0.0
        return np.log(lo / b) if b < lo else np.log(b / hi)
    return min(cands, key=lambda b: (dist(b), abs(np.log(b / 120.0))))


def analyze(y: np.ndarray, sr: int = SR, force_bpm: float | None = None,
            force_offset: float | None = None, log=print) -> Analysis:
    import librosa
    import scipy.ndimage as ndi
    import scipy.signal as sps

    duration = len(y) / sr
    notes: list[str] = []

    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=HOP))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
    ft = librosa.frames_to_time(np.arange(S.shape[1]), sr=sr, hop_length=HOP)
    oenv = librosa.onset.onset_strength(S=librosa.amplitude_to_db(S, ref=np.max), sr=sr, hop_length=HOP)
    oenv = oenv[: len(ft)]
    det = oenv - ndi.uniform_filter1d(oenv, size=int(2.0 * sr / HOP))   # remove slow trend

    rms = librosa.feature.rms(S=S, frame_length=2048)[0][: len(ft)]
    rms_db = 20 * np.log10(rms + 1e-9)
    rms_db -= rms_db.max()

    # ---------------- tempo ----------------
    if force_bpm:
        bpm = float(force_bpm)
        notes.append(f"bpm forced by overrides: {bpm}")
    else:
        coarse = np.arange(60.0, 200.0, 0.25)
        sc, _ = _comb_scores(det, ft, coarse, 0.01)
        raw = float(coarse[int(np.argmax(sc))])
        folded = _fold_tempo(raw)
        if abs(folded - raw) > 1e-6:
            notes.append(f"tempo octave: comb peak {raw:.2f} BPM folded to {folded:.2f} (dance range 90-150)")
        fine = np.arange(folded * 0.985, folded * 1.015, 0.01)
        sc2, _ = _comb_scores(det, ft, fine, 0.002)
        bpm = float(fine[int(np.argmax(sc2))])
        if abs(bpm - round(bpm)) < 0.06:      # produced music is almost always on an integer BPM
            bpm = float(round(bpm))
    period = 60.0 / bpm

    # ---------------- beat grid ----------------
    ph = np.arange(0.0, period, 0.002)
    k = np.arange(0, int((ft[-1] - 0.05 - period) / period))
    s = np.interp(ph[:, None] + k[None, :] * period, ft, det).mean(axis=1)
    phase = float(ph[int(np.argmax(s))])
    grid = np.arange(phase, duration, period)

    # does a rigid grid fit? compare with a dynamic-programming tracker
    _, bf = librosa.beat.beat_track(onset_envelope=oenv, sr=sr, hop_length=HOP, start_bpm=bpm, tightness=300)
    tracked = librosa.frames_to_time(bf, sr=sr, hop_length=HOP)
    if len(tracked) > 16:
        # signed deviation of tracked beats from the rigid grid, judged per 32-beat window: a tempo
        # that wanders section by section (common in generated music) shows up as window offsets
        dev = np.array([t - grid[np.argmin(np.abs(grid - t))] for t in tracked])
        wins = [np.median(dev[i:i + 32]) for i in range(0, len(dev) - 16, 16)]
        drift = float(np.max(np.abs(wins))) if wins else 0.0
    else:
        drift = 0.0
    notes.append(f"rigid-grid fit: worst 32-beat window off by {drift * 1000:.0f} ms")
    if drift > 0.030 and len(tracked) > 16 and not force_bpm:
        # tempo really moves (live-feel / accelerating track): follow the tracked beats, but repair
        # glitches = beats > 25 ms off a local quadratic fit over 9 beats
        beats = np.array(tracked, dtype=float)
        smooth = sps.savgol_filter(beats, 9, 2, mode="interp")
        bad = np.abs(beats - smooth) > 0.025
        beats[bad] = smooth[bad]
        ibi = np.diff(beats)
        bpm = float(60.0 * (len(beats) - 1) / (beats[-1] - beats[0]))   # mean tempo (median IBI is frame-quantised)
        period = 60.0 / bpm
        notes.append(f"tempo drifts: using tracked beats "
                     f"({60 / np.percentile(ibi, 90):.1f}-{60 / np.percentile(ibi, 10):.1f} BPM, "
                     f"{int(bad.sum())} glitches repaired)")
    else:
        beats = grid

    # ---------------- downbeats (bar phase) ----------------
    def band_flux(lo, hi):
        b = np.log1p(100 * S[(freqs >= lo) & (freqs < hi)])
        return np.concatenate([[0.0], np.maximum(0.0, np.diff(b, axis=1)).sum(0)])
    low = band_flux(20, 150)
    chroma = librosa.feature.chroma_stft(S=S ** 2, sr=sr)
    bfr = np.clip(librosa.time_to_frames(beats, sr=sr, hop_length=HOP), 0, len(ft) - 1)
    edges = np.concatenate([bfr, [len(ft)]])
    nb = len(beats)
    csync = np.stack([chroma[:, edges[i]:max(edges[i] + 1, edges[i + 1])].mean(1) for i in range(nb)], 1)
    esync = np.array([rms[edges[i]:max(edges[i] + 1, edges[i + 1])].mean() for i in range(nb)])
    cn = csync / (np.linalg.norm(csync, axis=0, keepdims=True) + 1e-9)
    chg = np.concatenate([[0.0], 1 - (cn[:, 1:] * cn[:, :-1]).sum(0)])
    ejump = np.concatenate([[0.0], np.abs(np.diff(np.log(esync + 1e-6)))])
    lowat = np.array([low[max(0, f - 2):f + 3].max() for f in bfr])

    def z(v):
        return (v - v.mean()) / (v.std() + 1e-9)
    dscore = z(chg) + z(lowat) + 0.5 * z(ejump)
    ph_scores = [float(dscore[p::4].mean()) for p in range(4)]
    db_phase = int(np.argmax(ph_scores))
    srt = sorted(ph_scores)
    if srt[-1] - srt[-2] < 0.1:
        notes.append(f"downbeat phase ambiguous (scores {np.round(ph_scores, 2).tolist()})")

    if force_offset is not None:
        # overrides pin the first downbeat: shift the grid phase (keeps bpm)
        if beats is grid:
            first = force_offset % period
            beats = np.arange(first, duration, period)
        db_phase = int(round((force_offset - beats[0]) / period)) % 4
        notes.append(f"offset forced by overrides: {force_offset}")

    # ---------------- bars, features, sections ----------------
    nbars = (len(beats) - db_phase) // 4
    bar_t = [beats[db_phase + 4 * j] for j in range(nbars)] + [
        beats[db_phase + 4 * nbars] if db_phase + 4 * nbars < len(beats) else duration]
    bar_t = np.array(bar_t)
    mfcc = librosa.feature.mfcc(S=librosa.power_to_db(librosa.feature.melspectrogram(S=S ** 2, sr=sr)), n_mfcc=13)
    feats, bar_db, bar_on, pulse = [], [], [], []
    for j in range(nbars):
        a, b = np.searchsorted(ft, bar_t[j]), np.searchsorted(ft, bar_t[j + 1])
        b = max(b, a + 1)
        feats.append(np.concatenate([mfcc[:, a:b].mean(1) / 20.0, chroma[:, a:b].mean(1) * 2.0]))
        bar_db.append(float(rms_db[a:b].mean()))
        bar_on.append(float(oenv[a:b].mean()))
        on_b = [np.interp(beats[db_phase + 4 * j + q], ft, oenv) for q in range(4) if db_phase + 4 * j + q < len(beats)]
        off_b = [np.interp(beats[db_phase + 4 * j + q] + period * f, ft, oenv)
                 for q in range(4) for f in (0.25, 0.75) if db_phase + 4 * j + q < len(beats)]
        pulse.append(float(np.mean(on_b) / (np.mean(off_b) + 1e-6)))
    F = np.array(feats)
    F = (F - F.mean(0)) / (F.std(0) + 1e-6)
    bar_db = np.array(bar_db)
    bar_on = np.array(bar_on)
    bar_pulse = np.array(pulse)

    # Foote novelty on the bar self-similarity matrix + loudness novelty
    Fn = F / (np.linalg.norm(F, axis=1, keepdims=True) + 1e-9)
    ssm = Fn @ Fn.T
    K = 4
    g = np.outer(*(2 * [sps.windows.gaussian(2 * K, K / 1.5)]))
    ker = g * np.block([[np.ones((K, K)), -np.ones((K, K))], [-np.ones((K, K)), np.ones((K, K))]])
    pad = np.pad(ssm, K, mode="edge")
    foote = np.array([(pad[j:j + 2 * K, j:j + 2 * K] * ker).sum() for j in range(nbars)])
    sm_db = ndi.uniform_filter1d(bar_db, 2)
    edb = np.array([abs(bar_db[j:j + 2].mean() - bar_db[max(0, j - 2):j].mean()) if 2 <= j < nbars - 1 else 0.0
                    for j in range(nbars)])
    nov = z(np.maximum(foote, 0)) + z(edb)
    # phrase grid parity: section changes land on a 2-bar grid
    parity = int(np.argmax([np.sort(nov[p::2])[-6:].sum() for p in (0, 1)]))
    min_len = 4
    cands = [j for j in range(min_len, nbars - min_len + 1) if j % 2 == parity]
    bounds = [0]
    max_sections = max(3, int(duration / 12))
    for j in sorted(cands, key=lambda j: -nov[j]):
        if nov[j] < 0.6 or len(bounds) >= max_sections:
            break
        if all(abs(j - b) >= min_len for b in bounds):
            bounds.append(j)
    bounds = sorted(bounds) + [nbars]

    # play window: music present (fade-in / fade-out / silence excluded)
    med = float(np.median(rms_db))
    sm = ndi.uniform_filter1d(rms_db, int(1.0 * sr / HOP))
    loud = np.where(sm > med - 12.0)[0]
    play_start = max(LEAD_IN, float(ft[loud[0]]) if len(loud) else 0.0)
    play_end = min(duration - TAIL, float(ft[loud[-1]]) - 0.5 if len(loud) else duration)

    # drums-based play window: first / last bar with a clear beat pulse (skips ambient intros,
    # spoken intros and the fade-out / power-down tail)
    strong = np.where(bar_pulse >= PULSE_STRONG)[0]
    if len(strong):
        play_start = max(play_start, float(bar_t[strong[0]]))
        play_end = min(play_end, float(bar_t[strong[-1] + 1]))

    sections: list[Section] = []
    for a, b in zip(bounds[:-1], bounds[1:]):
        e = float(np.mean(bar_db[a:b]) + 2.0 * np.log(np.mean(bar_on[a:b]) + 1e-6))
        sections.append(Section(a, b, float(bar_t[a]), float(bar_t[b]), energy=e))
    if bar_t[0] > 0 and sections:
        sections[0].start = 0.0          # pickup beats belong to the first section
    sections[-1].end = duration
    es = np.array([s.energy for s in sections])
    lo_t, hi_t = np.percentile(es, 35), np.percentile(es, 70)
    span = es.max() - es.min()
    for i, s in enumerate(sections):
        if span < 1.5:           # flat song: everything mid
            s.level = 1
        else:
            s.level = 0 if s.energy <= lo_t else (2 if s.energy >= hi_t else 1)
        if i == 0 and s.level < 2:
            s.label = "intro"
        elif i == len(sections) - 1 and s.level < 2:
            s.label = "outro"
        else:
            s.label = {0: "break", 1: "verse", 2: "chorus"}[s.level]
    _assign_keys(sections, F)

    return Analysis(duration=duration, bpm=bpm, period=period, beats=np.asarray(beats, float), db_phase=db_phase,
                    sections=sections, play_start=play_start, play_end=play_end, rms_t=ft, rms_db=rms_db,
                    bar_pulse=bar_pulse, notes=notes)


def _assign_keys(sections: list[Section], F: np.ndarray | None):
    """Sections that sound alike share a routine key (choruses repeat their dance)."""
    reps: list[tuple[str, np.ndarray | None, int]] = []
    for i, s in enumerate(sections):
        v = F[s.start_bar:s.end_bar].mean(0) if F is not None and s.end_bar > s.start_bar else None
        hit = None
        for key, rv, lvl in reps:
            if lvl == s.level and v is not None and rv is not None:
                c = float(v @ rv / (np.linalg.norm(v) * np.linalg.norm(rv) + 1e-9))
                if c > 0.8:
                    hit = key
                    break
        if hit is None:
            hit = f"{s.label}{i}"
            reps.append((hit, v, s.level))
        s.key = hit


# =====================================================================================
# Choreography
# =====================================================================================

# rhythm templates: beat offsets inside an 8-beat (2-bar) phrase, per difficulty and energy level
RHYTHMS = {
    "easy": {0: [[0, 4]], 1: [[0, 2, 4, 6], [0, 4, 6]], 2: [[0, 2, 4, 6]]},
    "normal": {
        0: [[0, 4], [0, 2, 4]],
        1: [[0, 2, 4, 6], [0, 2, 3, 4, 6], [0, 1, 2, 4, 6]],
        2: [[0, 1, 2, 4, 5, 6], [0, 1, 2, 3, 4, 6], [0, 2, 3, 4, 5, 6]],
    },
    "hard": {
        0: [[0, 2, 4, 6], [0, 2, 3, 4, 6]],
        1: [[0, 1, 2, 4, 5, 6], [0, 1, 2, 3.5, 5, 6], [0, 2, 3, 4, 5, 6]],
        2: [[0, 1, 2, 3, 4, 5, 6], [0, 1, 2, 3.5, 4.5, 5.5, 7], [0, 1.5, 2.5, 4, 5, 6, 7], [0, 1, 2, 3, 4.5, 5.5, 6.5]],
    },
}
EASY_MOTIFS = [["up", "clap", "down", "clap"], ["clap", "up", "clap", "down"], ["up", "down", "clap", "clap"],
               ["down", "clap", "up", "clap"], ["up", "down"], ["up", "up", "down", "clap"]]
SPLIT_MOTIFS = [["split_lu", "split_ld"], ["up", "split_lu", "down", "split_ld"], ["split_lu", "clap", "split_ld", "clap"],
                ["up", "down", "split_lu", "split_ld"], ["clap", "split_lu", "clap", "split_ld"],
                ["split_lu", "split_ld", "up", "clap"]]


@dataclass
class Note:
    t: float
    move: str
    dur: float = 0.0
    pinned: bool = False
    final: bool = False       # photo on the song's final hit (relaxed free-before rule)

    def end(self) -> float:
        return self.t + (self.dur if self.move == "sweep" else 0.0)

    def to_json(self) -> dict:
        d = {"t": round(self.t, 3), "move": self.move}
        if self.move == "sweep":
            d["dur"] = round(self.dur, 3)
        return d


def _routine(rng: random.Random, diff: str, level: int, allowed: list[str] | None = None) -> dict:
    rhythms = RHYTHMS[diff][level]
    if diff == "easy":
        motifs = EASY_MOTIFS
    elif diff == "normal":
        motifs = EASY_MOTIFS + SPLIT_MOTIFS
    else:
        motifs = SPLIT_MOTIFS * 2 + EASY_MOTIFS      # hard leans on split alternations
    if allowed:
        ok = [m for m in motifs if set(m) <= set(allowed)]
        motifs = ok or [[m for m in TAPS if m in allowed] or ["clap"]]
    ra = rng.choice(rhythms)
    rb = rng.choice(rhythms)
    ma = rng.choice(motifs)
    mb = rng.choice([m for m in motifs if m != ma] or motifs)
    return {"A": (ra, ma), "B": (rb, mb)}


def choreograph(an: Analysis, diff: str, seed: int, no_notes: list[tuple[float, float]]) -> list[Note]:
    rng = random.Random(f"{seed}:{diff}")
    cache: dict[str, dict] = {}
    notes: list[Note] = []
    P = an.period
    easy_step_ok = 2 * P >= EASY_MIN_GAP - EPS
    for si, sec in enumerate(an.sections):
        if sec.label == "intro" and sec.level == 0:
            continue     # intros (often speech / pads) stay empty
        key = f"{sec.key}:{sec.level}"
        if key not in cache:
            cache[key] = _routine(rng, diff, sec.level, sec.moves)
        rt = cache[key]
        nbeats = 4 * (sec.end_bar - sec.start_bar)
        base = an.bar_beat(sec.start_bar)
        nphr = int(np.ceil(nbeats / 8))
        long_sec = (sec.end_bar - sec.start_bar) >= 8
        cursor = {"A": 0, "B": 0}       # motif position runs on across phrases of the same kind
        for p in range(nphr):
            which = "B" if p % 4 == 2 else "A"
            rhythm, motif = rt[which]
            if diff == "easy" and not easy_step_ok:
                rhythm = [r for r in rhythm if r % 4 == 0]
            last = p == nphr - 1
            mid_end = long_sec and p % 4 == 3 and not last and nphr - p > 2
            sweep_here = False
            if diff == "normal" and sec.level >= 1 and (last or mid_end):
                sweep_here = True
            elif diff == "hard" and (last or (mid_end and sec.level == 2)) and sec.level >= 1:
                sweep_here = True
            elif diff == "easy" and last and long_sec and sec.level == 2:
                sweep_here = True
            for i, off in enumerate(rhythm):
                if p * 8 + off >= nbeats:
                    break
                if sweep_here and off > 2:
                    break
                mv = motif[cursor[which] % len(motif)]
                cursor[which] += 1
                if off != int(off):
                    mv = "clap"    # syncopated (half-beat) hits are claps
                notes.append(Note(an.time_at(base + p * 8 + off), mv))
            if sec.moves is not None and "sweep" not in sec.moves:
                sweep_here = False
            if sweep_here and p * 8 + 4 < nbeats:
                room = min(nbeats - (p * 8 + 4) - 1, SWEEP_MAX_BEATS)   # keep a free beat after
                dur_b = 3.0 if room >= 3 else room
                if diff == "hard" and sec.level == 2 and mid_end:
                    dur_b = 2.0
                if dur_b >= SWEEP_MIN_BEATS:
                    t0 = an.time_at(base + p * 8 + 4)
                    notes.append(Note(t0, "sweep", an.time_at(base + p * 8 + 4 + dur_b) - t0))
    # remove notes in no-play zones
    out = []
    for n in notes:
        if n.t < an.play_start or n.end() > an.play_end - 0.1:
            continue
        if any(a <= n.t < b or a < n.end() <= b for a, b in no_notes):
            continue
        if an.level_db_at(n.t - 0.05, n.t + 0.3) < -40.0:   # local silence
            continue
        b = an.beat_at(n.t) - an.db_phase
        bar = int(np.floor(b / 4 + 1e-6))
        if 0 <= bar < len(an.bar_pulse) and an.bar_pulse[bar] < PULSE_WEAK and n.move != "sweep":
            pos = b - 4 * bar
            if not any(abs(pos - q) < 0.1 for q in ((0,) if diff == "easy" else (0, 2))):
                continue      # no drums here: only half-bar hits survive
        out.append(n)
    return out


# =====================================================================================
# Overrides
# =====================================================================================

def load_overrides(path: Path) -> dict:
    if not path.exists():
        return {}
    with open(path) as f:
        return json.load(f)


def _pin_notes(an: Analysis, pin: dict, diff: str) -> list[Note] | None:
    spec = pin.get(diff)
    seen = set()
    while isinstance(spec, str):          # alias: "hard": "normal"
        if spec in seen:
            raise ValueError(f"override alias loop in pin {pin.get('label')}")
        seen.add(spec)
        spec = pin.get(spec)
    if spec is None:
        spec = pin.get("notes")
    step = {"beat": 1.0, "half": 0.5, "quarter": 0.25}.get(pin.get("snap", ""), None)
    res: list[Note] = []
    if spec is not None:
        for n in spec:
            mv = n["move"]
            if mv not in MOVES:
                raise ValueError(f"override note with unknown move {mv!r}")
            t = float(n["t"])
            if step and n.get("snap", True) is not False:     # per-note "snap": false keeps the exact time
                t = an.snap(t, step)
            dur = 0.0
            if mv == "sweep":
                if "durBeats" in n:
                    dur = an.time_at(an.beat_at(t) + float(n["durBeats"])) - t
                else:
                    dur = float(n.get("dur", 3 * an.period))
            res.append(Note(t, mv, dur, pinned=True))
        return res
    pat = pin.get("pattern")
    if pat and diff in pat.get("difficulties", ALL_DIFFICULTIES):
        moves = pat["moves"]
        stepb = float(pat.get("stepBeats", 1))
        b = an.beat_at(float(pin["start"]))
        b = np.ceil(b / stepb - 1e-6) * stepb
        i = 0
        while an.time_at(b) < float(pin["end"]) - 1e-6:
            mv = moves[i % len(moves)]
            if mv:
                if mv not in MOVES:
                    raise ValueError(f"override pattern with unknown move {mv!r}")
                t = an.time_at(b)
                dur = an.time_at(b + float(pat.get("sweepBeats", 3))) - t if mv == "sweep" else 0.0
                res.append(Note(t, mv, dur, pinned=True))
            b += stepb
            i += 1
        return res
    return None


def apply_overrides(an: Analysis, gen: list[Note], ov: dict, diff: str) -> list[Note]:
    notes = list(gen)
    for pin in ov.get("pins", []):
        pn = _pin_notes(an, pin, diff)
        if pn is None:
            continue
        a, b = float(pin["start"]), float(pin["end"])
        notes = [n for n in notes if not (a <= n.t < b or a < n.end() <= b)]
        notes += pn
    return sorted(notes, key=lambda n: n.t)


def apply_section_overrides(an: Analysis, ov: dict):
    sm = ov.get("sectionMap")
    if sm:
        # hand-authored structure replaces the detected one (boundaries snapped to downbeats)
        nb = an.n_bars()
        starts = [0 if i == 0 else max(0, min(nb, bar_index(an, float(x["start"])))) for i, x in enumerate(sm)]
        secs = []
        for i, x in enumerate(sm):
            a = starts[i]
            b = starts[i + 1] if i + 1 < len(sm) else nb
            if b <= a:
                continue
            lvl = int(x.get("level", 1))
            secs.append(Section(a, b, 0.0 if i == 0 else bar_time(an, a),
                                bar_time(an, b) if b < nb else an.duration,
                                level=lvl, label=str(x.get("label", "verse")), energy=float(lvl),
                                key=str(x.get("key", x.get("label", f"s{i}"))), moves=x.get("moves")))
        an.sections = secs
    for so in ov.get("sections", []):
        a, b = float(so["start"]), float(so["end"])
        for s in an.sections:
            mid = (s.start + s.end) / 2
            if a <= mid < b:
                if "level" in so:
                    s.level = int(so["level"])
                if "label" in so:
                    s.label = str(so["label"])
                if "key" in so:
                    s.key = str(so["key"])


# =====================================================================================
# Ergonomics
# =====================================================================================

CLAP_PAIR_BEATS = 0.5     # "Clap. Clap.": two claps may sit half a beat apart (not on easy)


def min_gap_between(a: Note, b: Note, P: float, diff: str) -> float:
    need = EASY_MIN_GAP if diff == "easy" else MIN_GAP
    if diff != "easy" and a.move == "clap" and b.move == "clap":
        need = CLAP_PAIR_BEATS * P
    if a.move == "sweep":
        need = max(need, SWEEP_FREE_AFTER * P)
    if b.move == "sweep":
        need = max(need, SWEEP_FREE_BEFORE * P)
    if b.move == PHOTO:
        need = max(need, (FINAL_PHOTO_FREE_BEFORE if b.final else PHOTO_FREE_BEFORE) * P)
    if a.move == PHOTO:
        need = max(need, PHOTO_FREE_AFTER * P)
    return need - EPS


def enforce(notes: list[Note], an: Analysis, diff: str, warn=print) -> list[Note]:
    def need(a: Note, b: Note) -> float:          # gap rules measured in LOCAL beats (tempo may drift)
        return min_gap_between(a, b, an.local_period(0.5 * (a.end() + b.t)), diff)

    def rest_between(a: Note, b: Note) -> float:
        return REST_BEATS * an.local_period(0.5 * (a.end() + b.t)) - EPS

    notes = sorted(notes, key=lambda n: (n.t, not n.pinned))
    # clamp sweep durations
    for n in notes:
        if n.move == "sweep":
            lo = an.beats_later(n.t, SWEEP_MIN_BEATS) - n.t
            hi = an.beats_later(n.t, SWEEP_MAX_BEATS) - n.t
            if not (lo - EPS <= n.dur <= hi + EPS):
                if n.pinned:
                    warn(f"  ! {diff}: pinned sweep at {n.t:.3f} has dur {n.dur:.3f}s outside 2-4 beats; clamped")
                n.dur = float(min(max(n.dur, lo), hi))
    pinned = [n for n in notes if n.pinned]
    # generated notes may never crowd a pinned one
    keep = []
    for n in notes:
        if n.pinned:
            keep.append(n)
            continue
        ok = True
        for p in pinned:
            a, b = (p, n) if p.t <= n.t else (n, p)
            if b.t - a.end() < need(a, b):
                ok = False
                break
        if ok:
            keep.append(n)
    # greedy forward pass
    out: list[Note] = []
    for n in keep:
        drop = False
        while out:
            prev = out[-1]
            if n.t - prev.end() >= need(prev, n):
                break
            if not prev.pinned and (n.pinned or (n.move == "sweep" and prev.move != "sweep")):
                out.pop()             # pinned notes win over generated ones; sweeps over generated taps
                continue
            if n.pinned and prev.pinned:
                warn(f"  ! {diff}: pinned notes at {prev.t:.3f} and {n.t:.3f} break the gap rules (kept)")
                break
            drop = True
            break
        if not drop:
            out.append(n)
    # fairness (easy/normal): flipping split_lu <-> split_ld reverses both forearms; give it 2 beats
    if diff != "hard":
        opp = {"split_lu": "split_ld", "split_ld": "split_lu"}
        for a, b in zip(out, out[1:]):
            if not b.pinned and opp.get(a.move) == b.move and b.t - a.t < rest_between(a, b):
                b.move = "clap"
    # consecutive-notes-without-rest limit
    lim = MAX_CHAIN[diff]
    res: list[Note] = []
    chain = 0
    for n in out:
        if n.move == PHOTO:            # photos are outside the density rules (gap rule only)
            res.append(n)
            chain = 0
            continue
        if res and n.move == "clap" and res[-1].move == "clap":
            pass                       # clapping along on the beat changes no pose: clap->clap doesn't extend the run
        elif res and n.t - res[-1].end() < rest_between(res[-1], n) and n.move != "sweep" and res[-1].move != "sweep" \
                and res[-1].move != PHOTO:
            chain += 1
        else:
            chain = 1
        if chain > lim and not n.pinned:
            chain = 0          # dropping this note creates the rest
            continue
        res.append(n)
    return res


# =====================================================================================
# Output
# =====================================================================================

def seed_for(song_id: str) -> int:
    return int(hashlib.sha256(song_id.encode()).hexdigest()[:8], 16)


@dataclass
class Photo:
    t: float
    why: str
    pinned: bool = False


def _photo_ok(an: Analysis, t: float, pinned: dict[str, list[Note]]) -> bool:
    """A photo at t must not crowd any hand-pinned note in any difficulty."""
    ph = Note(t, PHOTO, pinned=True, final=all(n.end() <= t for ns in pinned.values() for n in ns))
    for diff, notes in pinned.items():
        for n in notes:
            a, b = (n, ph) if n.t <= t else (ph, n)
            if b.t - a.end() < min_gap_between(a, b, an.local_period(0.5 * (a.end() + b.t)), diff):
                return False
    return True


def choose_photos(an: Analysis, ov: dict, pinned: dict[str, list[Note]], warn=print) -> list[Photo]:
    """Exactly N_PHOTOS free-pose cues: pinned ones from overrides (on the nearest beat, e.g. on a sung
    "pose"), the rest auto-placed on downbeats at drops / section ends, spread across the play window."""
    photos = []
    for p in ov.get("photos", []):
        t = float(p["t"])           # pinned photos snap to the nearest beat ("snap": "downbeat" | "half" | false)
        snap = p.get("snap", "beat")
        if snap == "downbeat":
            t = bar_time(an, bar_index(an, t))
        elif snap == "half":
            t = an.snap(t, 0.5)
        elif snap is not False:
            t = an.snap(t, 1.0)
        if not _photo_ok(an, t, pinned):
            warn(f"  ! photo pinned at {t:.3f} crowds a pinned note (needs {PHOTO_FREE_BEFORE:g} beats before, "
                 f"{PHOTO_FREE_AFTER:g} after)")
        photos.append(Photo(t, p.get("why", "pinned"), True))
    lo = max(PHOTO_MIN_T, an.play_start)
    hi = an.play_end - 4 * an.period
    # candidate downbeats with a musical score
    score: dict[int, tuple[float, str]] = {}
    prev_level = None
    for s in an.sections:
        if prev_level is not None and s.level > prev_level:
            score[s.start_bar] = (3.0, f"{s.label} entry (energy up)")
        if s.end_bar - 1 > s.start_bar:
            score.setdefault(s.end_bar - 1, (2.0, f"last bar of {s.label}"))
        for j in range(s.start_bar + 4, s.end_bar - 1, 4):
            score.setdefault(j, (1.0, f"{s.label} phrase start"))
        prev_level = s.level
    cands = []
    for j in range(an.n_bars()):
        t = bar_time(an, j)
        if lo - EPS <= t <= hi:
            sc, why = score.get(j, (0.0, "downbeat"))
            cands.append((t, sc, why))
    need = N_PHOTOS - len(photos)
    if need > 0 and cands:
        span = (hi - lo) / N_PHOTOS
        for k in range(N_PHOTOS):
            if len(photos) >= N_PHOTOS:
                break
            c0 = lo + span * (k + 0.5)
            seg = [c for c in cands if lo + span * k - EPS <= c[0] < lo + span * (k + 1)]
            seg = [c for c in seg if _photo_ok(an, c[0], pinned)
                   and all(abs(c[0] - p.t) >= PHOTO_SPREAD for p in photos)]
            if not seg:
                continue
            t, sc, why = max(seg, key=lambda c: (c[1], -abs(c[0] - c0)))
            photos.append(Photo(t, f"auto: {why}"))
        # fallback: any feasible downbeat far enough from the others
        for t, sc, why in sorted(cands, key=lambda c: -c[1]):
            if len(photos) >= N_PHOTOS:
                break
            if _photo_ok(an, t, pinned) and all(abs(t - p.t) >= PHOTO_SPREAD for p in photos):
                photos.append(Photo(t, f"auto: {why}"))
    if len(photos) != N_PHOTOS:
        warn(f"  ! {len(photos)} photo cues (expected {N_PHOTOS})")
    return sorted(photos, key=lambda p: p.t)[:N_PHOTOS]


def pinned_notes(an: Analysis, ov: dict, diffs: list[str]) -> dict[str, list[Note]]:
    out = {}
    for d in diffs:
        ns = []
        for pin in ov.get("pins", []):
            ns += _pin_notes(an, pin, d) or []
        out[d] = ns
    return out


def build_charts(an: Analysis, song_id: str, ov: dict, log=print,
                 diffs: list[str] = DIFFICULTIES, photos: list[Photo] | None = None) -> dict[str, list[Note]]:
    seed = seed_for(song_id)
    no_notes = [(float(r["start"]), float(r["end"])) for r in ov.get("noNotes", [])]
    charts = {}
    for diff in diffs:
        gen = choreograph(an, diff, seed, no_notes)
        merged = apply_overrides(an, gen, ov, diff)
        merged += [Note(p.t, PHOTO, pinned=True) for p in (photos or [])]
        last = max(merged, key=lambda n: n.end(), default=None)
        if last is not None and last.move == PHOTO:
            last.final = True
        charts[diff] = enforce(merged, an, diff, warn=log)
    return charts


# =====================================================================================
# Camera track + preview
# =====================================================================================

@dataclass
class Cue:
    t: float
    shot: str
    ease: float
    why: str = ""
    pinned: bool = False
    until: float | None = None

    def to_json(self) -> dict:
        return {"t": round(self.t, 3), "shot": self.shot, "ease": round(self.ease, 2)}


def bar_time(an: Analysis, j: int) -> float:
    return an.time_at(an.bar_beat(j))


def bar_index(an: Analysis, t: float) -> int:
    return int(round((an.beat_at(t) - an.db_phase) / 4))


def camera_track(an: Analysis, seed: int, ov: dict, warn=print) -> list[Cue]:
    """Show-camera cues on downbeats: section boundaries + every 4 (high energy) / 8 bars;
    hard cuts into high-energy sections, glides in calm parts; wide at both ends."""
    rng = random.Random(f"{seed}:camera")
    cyc = {2: ["front", "low_left", "close", "low_right"],
           1: ["front", "low_right", "high", "low_left"],
           0: ["orbit", "high", "wide"]}
    for k in cyc:
        r = rng.randrange(len(cyc[k]))
        cyc[k] = cyc[k][r:] + cyc[k][:r]
    ptr = {0: 0, 1: 0, 2: 0}
    ease_for = {2: 0.0, 1: 1.2, 0: 2.0}
    cues = [Cue(0.0, "wide", 0.0, "intro: establishing wide")]

    def next_shot(level):
        for _ in range(len(cyc[level])):
            sh = cyc[level][ptr[level] % len(cyc[level])]
            ptr[level] += 1
            if sh != cues[-1].shot:
                return sh
        return "front"

    last_bar = bar_index(an, an.play_end) - 1          # last bar with drums -> pull back to wide
    prev_level = an.sections[0].level if an.sections else 0
    for i, s in enumerate(an.sections):
        if i == 0 and s.label == "intro":
            continue
        step = 4 if s.level == 2 else 8
        j, first = max(s.start_bar, 0), True
        while j <= s.end_bar - CAM_MIN_BARS and j <= last_bar - CAM_MIN_BARS:
            if first and s.level == 2 and prev_level < 2:
                shot, ease, why = "drop", 0.0, f"{s.label} entry, energy up: cut + push-in"
            elif first and s.label == "outro" and s.level < 2:
                shot, ease, why = "wide", 2.0, "outro"
            else:
                shot, ease = next_shot(s.level), ease_for[s.level]
                why = f"{s.label} start" if first else f"{s.label}: every {step} bars"
            if j > 0:
                cues.append(Cue(bar_time(an, j), shot, ease, why))
            j += step
            first = False
        prev_level = s.level
    if last_bar > 0:
        cues = [c for c in cues if c.t < bar_time(an, last_bar - CAM_MIN_BARS) + EPS]
        cues.append(Cue(bar_time(an, last_bar), "wide", 2.0, "music winds down: pull back wide"))

    # ---- pinned cues from overrides ----
    pins = []
    for c in ov.get("camera", []):
        if c["shot"] not in SHOTS:
            raise ValueError(f"override camera cue with unknown shot {c['shot']!r}")
        t = float(c["t"])
        t = 0.0 if t <= 0 else bar_time(an, bar_index(an, t))
        until = float(c["until"]) if "until" in c else None
        pins.append(Cue(t, c["shot"], float(c.get("ease", 0.0)), c.get("why", "pinned"), True, until))
    if pins:
        def clash(g):
            for p in pins:
                if abs(bar_index(an, g.t) - bar_index(an, p.t)) < CAM_MIN_BARS:
                    return True
                if p.until is not None and p.t <= g.t < p.until - EPS:
                    return True
            return False
        cues = [c for c in cues if not clash(c)] + pins
    cues.sort(key=lambda c: (c.t, not c.pinned))
    out: list[Cue] = []
    for c in cues:
        if out and bar_index(an, c.t) - bar_index(an, out[-1].t) < CAM_MIN_BARS:
            if c.pinned and not out[-1].pinned:
                out.pop()
            elif not c.pinned:
                continue
            else:
                warn(f"  ! camera: pinned cues at {out[-1].t:.3f} and {c.t:.3f} are < {CAM_MIN_BARS} bars apart")
        if out and c.shot == out[-1].shot and not c.pinned:
            continue
        out.append(c)
    for a, b in zip(out, out[1:]):
        a.ease = min(a.ease, round(0.5 * (b.t - a.t), 2))
    return out


def choose_preview(an: Analysis, ov: dict) -> dict:
    """Bar-aligned loop for song select: most recognisable part (high energy, repeated section)."""
    bar_len = 4 * an.period
    fits = [n for n in range(1, 64) if PREVIEW_SEC[0] - EPS <= n * bar_len <= PREVIEW_SEC[1] + EPS]
    if fits:
        nbars = min(fits, key=lambda n: (abs(n - PREVIEW_BARS), n % 2))
    else:
        nbars = max(1, round(16.0 / bar_len))
    po = ov.get("preview")
    last_ok = bar_index(an, an.play_end)
    if po:
        j = bar_index(an, float(po["start"]))
        if "bars" in po:
            nbars = int(po["bars"])
        elif "dur" in po:
            nbars = max(1, int(round(float(po["dur"]) / bar_len)))
    else:
        reps = {}
        for s in an.sections:
            reps[s.key] = reps.get(s.key, 0) + 1
        cands = [s for s in an.sections if s.label != "intro" and s.start_bar + nbars <= last_ok] or an.sections
        best = max(cands, key=lambda s: (s.level, reps[s.key], s.energy, -s.start_bar))
        j = best.start_bar
    j = max(0, min(j, max(0, an.n_bars() - nbars)))
    start = bar_time(an, j)
    return {"start": round(start, 3), "dur": round(bar_time(an, j + nbars) - start, 3)}


def chart_json(an: Analysis, song_id: str, notes: list[Note], camera: list[Cue] | None = None) -> dict:
    return {
        "version": 1,
        "songId": song_id,
        "bpm": round(an.bpm, 3),
        "offset": round(an.offset, 3),
        "beats": [round(float(b), 3) for b in an.beats],
        "downbeats": [round(float(b), 3) for b in an.downbeats],
        "sections": [{"t": round(s.start, 3), "end": round(s.end, 3), "label": s.label, "level": s.level}
                     for s in an.sections],
        "notes": [n.to_json() for n in notes],
        "camera": [c.to_json() for c in (camera or [])],
    }


MOVE_WEIGHT = {"up": 1.0, "down": 1.0, "clap": 1.0, "split_lu": 1.6, "split_ld": 1.6, "sweep": 2.0}
ENERGY_THRESHOLDS = (1.0, 1.35)   # difficulty score -> 1 / 2 / 3 pips


def difficulty_score(an: Analysis, notes: list[Note]) -> float:
    """Physical load per second: each move weighs by kind (splits/sweeps cost more) and counts double
    when it follows the previous move within ~1 beat (fast changes; clap->clap clapping along excluded).
    Photos are free."""
    ms = [n for n in notes if n.move != PHOTO]
    if len(ms) < 2:
        return 0.0
    span = max(1.0, ms[-1].t - ms[0].t)
    load = sum(MOVE_WEIGHT[n.move] for n in ms)
    for a, b in zip(ms, ms[1:]):
        if a.move == "clap" and b.move == "clap":
            continue                  # clapping along: no pose change
        if b.t - a.end() < 1.05 * an.local_period(b.t):
            load += MOVE_WEIGHT[b.move]
    return load / span


def song_energy(an: Analysis, notes: list[Note]) -> int:
    """1-3 pips shown in song select = how demanding the chart is (see difficulty_score)."""
    d = difficulty_score(an, notes)
    return 1 if d < ENERGY_THRESHOLDS[0] else (2 if d < ENERGY_THRESHOLDS[1] else 3)


def upsert_index(index_path: Path, entry: dict):
    data = {"songs": []}
    if index_path.exists():
        with open(index_path) as f:
            data = json.load(f)
    songs = [s for s in data.get("songs", []) if s.get("id") != entry["id"]]
    pos = next((i for i, s in enumerate(data.get("songs", [])) if s.get("id") == entry["id"]), len(songs))
    songs.insert(pos, entry)
    # song select lists the easiest first: stable sort by energy pips (ties keep their order)
    data["songs"] = sorted(songs, key=lambda s: s.get("energy", 2))
    write_json(index_path, data)


def write_json(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w") as f:
        json.dump(obj, f, indent=1)
        f.write("\n")
    os.replace(tmp, path)


def fmt_t(t: float) -> str:
    return f"{int(t // 60)}:{t % 60:06.3f}"


def main(argv=None):
    ap = argparse.ArgumentParser(description="Import a song and generate Wawa Hero charts.")
    ap.add_argument("song", help="audio file (mp3). May already be public/songs/<id>/audio.mp3")
    ap.add_argument("--id", required=True, help="song id (folder name, also seeds the generator)")
    ap.add_argument("--title")
    ap.add_argument("--artist", help="artist shown in song select (never taken from the file's tags; "
                                     "or set \"artist\" in overrides.json to keep it across re-imports)")
    ap.add_argument("--public", default=None, help="public/ dir (default: <repo>/public)")
    ap.add_argument("--force", action="store_true", help="overwrite an existing different audio.mp3")
    ap.add_argument("--no-index", action="store_true", help="do not touch public/songs/index.json")
    ap.add_argument("--difficulty", choices=ALL_DIFFICULTIES, default=DEFAULT_DIFFICULTY,
                    help="density of the single chart (default: normal; easy/hard are opt-in experiments)")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args(argv)
    log = (lambda *a, **k: None) if args.quiet else print

    song_id = args.id
    if not song_id or any(c not in "abcdefghijklmnopqrstuvwxyz0123456789-_" for c in song_id):
        ap.error("--id must be lowercase [a-z0-9-_]")
    public = Path(args.public) if args.public else Path(__file__).resolve().parents[2] / "public"
    sdir = public / "songs" / song_id
    sdir.mkdir(parents=True, exist_ok=True)
    src = Path(args.song).resolve()
    audio = sdir / "audio.mp3"
    cover = sdir / "cover.jpg"

    if not src.exists():
        ap.error(f"{src} not found")
    if src != audio.resolve():
        if src.suffix.lower() != ".mp3":
            ap.error("only .mp3 input is supported (convert with ffmpeg first)")
        if audio.exists() and not args.force:
            if audio.read_bytes() != src.read_bytes():
                ap.error(f"{audio} exists and differs; use --force to replace it")
        else:
            shutil.copyfile(src, audio)
            log(f"copied audio -> {audio}")
    meta = probe(audio)
    if not cover.exists():
        if meta["has_cover"]:
            run(["ffmpeg", "-v", "error", "-y", "-i", str(audio), "-an", "-frames:v", "1", "-vf",
                 "scale='min(512,iw)':-2", str(cover)])
            log(f"extracted cover -> {cover}")
        else:
            h = hashlib.sha256(song_id.encode()).hexdigest()
            run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c=0x{h[:6]}:s=360x360", "-frames:v", "1",
                 str(cover)])
            log(f"no embedded art: wrote placeholder cover -> {cover}")

    ov = load_overrides(sdir / "overrides.json")
    oa = ov.get("analysis", {})
    log(f"analysing {audio} ...")
    y = decode(audio)
    an = analyze(y, force_bpm=oa.get("bpm"), force_offset=oa.get("offset"), log=log)
    apply_section_overrides(an, ov)
    diff = args.difficulty
    photos = choose_photos(an, ov, pinned_notes(an, ov, [diff]), warn=log)
    charts = build_charts(an, song_id, ov, log=log, diffs=[diff], photos=photos)
    notes = charts[diff]
    camera = camera_track(an, seed_for(song_id), ov, warn=log)
    preview = choose_preview(an, ov)

    write_json(sdir / "chart.json", chart_json(an, song_id, notes, camera))
    old = sdir / "charts"                 # per-difficulty charts are gone (one chart per song)
    if old.is_dir():
        for f in old.glob("*.json"):
            f.unlink()
        try:
            old.rmdir()
            log(f"removed old per-difficulty charts dir {old}")
        except OSError:
            log(f"  ! {old} not empty; left in place")

    moves = [m for m in MOVES if any(n.move == m for n in notes)]
    title = args.title or meta["title"] or song_id.replace("-", " ").title()
    artist = args.artist or ov.get("artist")    # explicit only: ID3 artist tags are NOT copied (often an account name)
    entry = {
        "id": song_id, "title": title,
        "audio": f"songs/{song_id}/audio.mp3", "cover": f"songs/{song_id}/cover.jpg",
        "bpm": round(an.bpm, 2), "duration": round(an.duration, 2),
        "energy": int(ov["energy"]) if "energy" in ov else song_energy(an, notes),
        "moves": moves,
        "photos": sum(n.move == PHOTO for n in notes),
        "preview": preview,
        "chart": f"songs/{song_id}/chart.json",
    }
    if artist:
        entry = {**{k: entry[k] for k in ("id", "title")}, "artist": artist,
                 **{k: v for k, v in entry.items() if k not in ("id", "title")}}
    if not args.no_index:
        upsert_index(public / "songs" / "index.json", entry)

    # ---- report ----
    log(f"\n{title}{' — ' + artist if artist else ''}  ({fmt_t(an.duration)})")
    log(f"bpm {an.bpm:.2f}  beat {an.period*1000:.1f} ms  first downbeat (offset) {an.offset:.3f}s  "
        f"play window {an.play_start:.2f}-{an.play_end:.2f}s  energy {entry['energy']} "
        f"(difficulty score {difficulty_score(an, notes):.2f} -> {song_energy(an, notes)} pips"
        f"{', pinned by overrides' if 'energy' in ov else ''})")
    for n in an.notes:
        log(f"  note: {n}")
    log("sections:")
    for s in an.sections:
        log(f"  {fmt_t(s.start)} - {fmt_t(s.end)}  bars {s.start_bar:3d}-{s.end_bar:3d}  {s.label:7s} "
            f"level {s.level}  [{s.key}]")
    cnt = {m: sum(n.move == m for n in notes) for m in MOVES + [PHOTO]}
    log(f"chart ({diff} density): {len(notes)} notes  " + " ".join(f"{m}={c}" for m, c in cnt.items() if c))
    log("photos:")
    for p in photos:
        log(f"  {fmt_t(p.t)} ({p.t:7.3f}) bar {bar_index(an, p.t):3d}  {'[pin] ' if p.pinned else ''}{p.why}")
    log(f"preview: {preview['start']:.3f}s + {preview['dur']:.3f}s "
        f"({round(preview['dur'] / (4 * an.period))} bars)")
    log("camera:")
    for c in camera:
        log(f"  {fmt_t(c.t)} ({c.t:7.3f}) bar {bar_index(an, c.t):3d}  {c.shot:9s} ease {c.ease:3.1f}  "
            f"{'[pin] ' if c.pinned else ''}{c.why}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
