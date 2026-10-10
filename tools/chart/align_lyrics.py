#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = [
#   "torch==2.5.1",
#   "torchaudio==2.5.1",
#   "demucs>=4.0.1",
#   "faster-whisper>=1.0",
#   "soundfile>=0.12",
#   "numpy<2.2",
# ]
# ///
"""Find when sung words happen, to help author public/songs/<id>/overrides.json.

    # 1. rough transcript with word timestamps (whole song)
    uv run tools/chart/align_lyrics.py public/songs/<id>/audio.mp3 --whisper
    # 2. precise forced alignment of known lyrics in a time window, snapped to the chart grid
    uv run tools/chart/align_lyrics.py public/songs/<id>/audio.mp3 --range 51 60 \
        --text "arms up arms down clap clap reboot now left up right down switch mode right up left down"

Vocals are isolated with demucs first (cached in ~/.cache/wawa-hero-align/), which matters a lot
for vocoder / robot voices. Beat numbers come from chart.json next to the audio (run
make_chart.py first). Alignment scores < 0.3 mean "not confident": check those words by ear.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

CACHE = Path.home() / ".cache" / "wawa-hero-align"


def vocals(audio: Path) -> Path:
    h = hashlib.sha256(audio.read_bytes()).hexdigest()[:16]
    out = CACHE / h / "vocals16k.wav"
    if out.exists():
        return out
    sep = CACHE / h / "sep"
    print("separating vocals with demucs (one-off, ~1-2 min)...", file=sys.stderr)
    subprocess.run([sys.executable, "-m", "demucs", "-d", "cpu", "--two-stems=vocals", "-n", "htdemucs", "-o", str(sep), str(audio)],
                   check=True)
    stem = next(sep.rglob("vocals.wav"))
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(stem), "-ac", "1", "-ar", "16000", str(out)], check=True)
    return out


def grid_for(audio: Path):
    chart = audio.parent / "chart.json"
    if not chart.exists():
        return None
    c = json.loads(chart.read_text())
    return np.array(c["beats"]), 60.0 / c["bpm"]


def beat_str(t: float, grid) -> str:
    if grid is None:
        return ""
    beats, P = grid
    b = float(np.interp(t, beats, np.arange(len(beats)))) if beats[0] <= t <= beats[-1] else (t - beats[0]) / P
    half = round(b * 2) / 2
    return f"beat {b:7.2f} -> snap {half:6.1f} @ {float(np.interp(half, np.arange(len(beats)), beats)):8.3f}s"


def do_whisper(wav: Path, model: str, grid):
    from faster_whisper import WhisperModel
    m = WhisperModel(model, device="cpu", compute_type="int8")
    segs, _ = m.transcribe(str(wav), word_timestamps=True, language="en", condition_on_previous_text=False)
    for s in segs:
        print(f"[{s.start:7.2f}-{s.end:7.2f}] {s.text.strip()}")
        for w in s.words or []:
            print(f"    {w.start:8.3f} {w.word.strip():14s} p={w.probability:.2f}  {beat_str(w.start, grid)}")


def do_align(wav: Path, t0: float, t1: float, text: str, grid):
    import torch
    import torchaudio
    y, sr = sf.read(str(wav), dtype="float32")
    seg = torch.from_numpy(y[int(t0 * sr):int(t1 * sr)])[None]
    bundle = torchaudio.pipelines.MMS_FA
    model, tok, aligner = bundle.get_model(), bundle.get_tokenizer(), bundle.get_aligner()
    words = ["".join(ch for ch in w.lower() if ch.isalpha() or ch == "'") for w in text.split()]
    words = [w for w in words if w]
    with torch.inference_mode():
        em, _ = model(seg)
        spans = aligner(em[0], tok(words))
    ratio = seg.shape[1] / em.shape[1] / sr
    for w, sp in zip(words, spans):
        s, e = t0 + sp[0].start * ratio, t0 + sp[-1].end * ratio
        score = float(np.mean([x.score for x in sp]))
        flag = "" if score >= 0.3 else "  (low confidence)"
        print(f"{w:12s} {s:8.3f}-{e:8.3f}  score {score:.2f}  {beat_str(s, grid)}{flag}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("audio")
    ap.add_argument("--whisper", action="store_true", help="transcribe the vocal stem with word timestamps")
    ap.add_argument("--model", default="small")
    ap.add_argument("--range", nargs=2, type=float, metavar=("START", "END"))
    ap.add_argument("--text", help="known lyrics inside --range, for forced alignment")
    ap.add_argument("--no-separate", action="store_true", help="use the full mix instead of the vocal stem")
    a = ap.parse_args()
    audio = Path(a.audio).resolve()
    if a.no_separate:
        wav = CACHE / "mix16k.wav"
        CACHE.mkdir(parents=True, exist_ok=True)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(audio), "-ac", "1", "-ar", "16000", str(wav)], check=True)
    else:
        wav = vocals(audio)
    grid = grid_for(audio)
    if a.whisper:
        do_whisper(wav, a.model, grid)
    if a.range and a.text:
        do_align(wav, a.range[0], a.range[1], a.text, grid)
    if not a.whisper and not (a.range and a.text):
        ap.error("use --whisper and/or --range START END --text '...'")


if __name__ == "__main__":
    main()
