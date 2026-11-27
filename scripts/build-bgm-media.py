#!/usr/bin/env python3
"""
Deterministic BGM Media Builder for AI Werewolf (Lobby + Adaptive Match Soundtrack).

Produces:
- `public/assets/bgm/hongchen-kezhan.mp3`: Mastered Jay Chou "Red Dust Inn"
  pure piano & strings instrumental for the Lobby playlist (`-16 LUFS`).
- `public/assets/bgm/game-night-bgm.mp3`: "Night Vigil" — nocturnal Jianghu
  Piano, Guzheng, Tremolo Strings & Bamboo Xiao suspense loop (`-17.5 LUFS`).
- `public/assets/bgm/game-day-bgm.mp3`: "Dawn & Teahouse Debate" — lyrical
  C-major/A-minor pentatonic Piano, Guzheng & Cello loop (`-17.0 LUFS`).
- `public/assets/bgm/game-vote-bgm.mp3`: "Blade of Exile" — dynamic fast-slow
  rubato/accelerando Piano, Guzheng, Pizzicato & Taiko duel loop (`-16.8 LUFS`).
"""
from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MASTER_DIR = ROOT / "scripts" / "assets" / "bgm"
COMPOSE_SWIFT = ROOT / "scripts" / "compose-game-bgm.swift"
OUT_DIR = ROOT / "public" / "assets" / "bgm"
FFMPEG = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
FFPROBE = shutil.which("ffprobe") or "/opt/homebrew/bin/ffprobe"


@dataclass(frozen=True)
class BgmSpec:
    slug: str
    title: str
    master_stem: str
    target_lufs: float = -16.0
    fade_in_sec: float = 0.85
    fade_out_sec: float = 1.80
    bitrate: str = "128k"


LOBBY_TRACK_SPECS: tuple[BgmSpec, ...] = (
    BgmSpec(
        slug="hongchen-kezhan",
        title="Red Dust Inn (Jianghu Instrumental)",
        master_stem="hongchen-kezhan-master",
    ),
)

GAME_SYNTH_SPECS: tuple[tuple[str, str, str, float], ...] = (
    ("game-night-raw.wav", "game-night-bgm", "Night Vigil", -17.5),
    ("game-day-raw.wav", "game-day-bgm", "Teahouse Debate", -17.0),
    ("game-vote-raw.wav", "game-vote-bgm", "Blade of Exile", -16.8),
)


def find_master_file(stem: str) -> Path | None:
    for ext in (".m4a", ".flac", ".wav", ".mp3", ".ogg", ".aac"):
        candidate = MASTER_DIR / f"{stem}{ext}"
        if candidate.exists():
            return candidate
    return None


def probe_duration(path: Path) -> float:
    out = subprocess.check_output(
        [
            FFPROBE,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        text=True,
    ).strip()
    return float(out)


def encode_master_track(
    in_path: Path,
    out_slug: str,
    title: str,
    target_lufs: float,
    fade_in_sec: float,
    fade_out_sec: float,
    bitrate: str = "128k",
) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / f"{out_slug}.mp3"
    duration = probe_duration(in_path)
    fade_out_start = max(0.0, duration - fade_out_sec)

    af_chain = (
        f"highpass=f=32,"
        f"loudnorm=I={target_lufs}:TP=-1.5:LRA=12,"
        f"afade=t=in:st=0:d={fade_in_sec:.2f}:curve=qsin,"
        f"afade=t=out:st={fade_out_start:.2f}:d={fade_out_sec:.2f}:curve=qsin"
    )

    subprocess.run(
        [
            FFMPEG,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(in_path),
            "-vn",
            "-map_metadata",
            "-1",
            "-metadata",
            f"title={title}",
            "-metadata",
            "artist=AI Werewolf Jianghu Ensemble",
            "-af",
            af_chain,
            "-ar",
            "44100",
            "-ac",
            "2",
            "-c:a",
            "libmp3lame",
            "-b:a",
            bitrate,
            str(out_path),
        ],
        check=True,
    )
    size_kb = out_path.stat().st_size / 1024.0
    final_dur = probe_duration(out_path)
    print(f"[bgm] {out_path.relative_to(ROOT)} ({final_dur:.1f}s, {size_kb:.1f} KB)")
    return out_path


def main() -> int:
    only_game = "--game-only" in sys.argv
    if not only_game:
        for spec in LOBBY_TRACK_SPECS:
            master = find_master_file(spec.master_stem)
            if master is None:
                raise FileNotFoundError(
                    f"Missing master audio for {spec.slug} under {MASTER_DIR}/{spec.master_stem}.*"
                )
            encode_master_track(
                in_path=master,
                out_slug=spec.slug,
                title=spec.title,
                target_lufs=spec.target_lufs,
                fade_in_sec=spec.fade_in_sec,
                fade_out_sec=spec.fade_out_sec,
                bitrate=spec.bitrate,
            )

    with tempfile.TemporaryDirectory(prefix="aiwerewolf-bgm-") as tmp:
        subprocess.run(["swift", str(COMPOSE_SWIFT), tmp], check=True)
        for raw_name, slug, title, lufs in GAME_SYNTH_SPECS:
            raw_path = Path(tmp) / raw_name
            encode_master_track(
                in_path=raw_path,
                out_slug=slug,
                title=title,
                target_lufs=lufs,
                fade_in_sec=0.45,
                fade_out_sec=1.60,
                bitrate="112k",
            )
    return 0


if __name__ == "__main__":
    sys.exit(main())
