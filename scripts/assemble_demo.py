#!/usr/bin/env python3
"""Assemble Strata9 V6 1080p Esports Broadcast Demo Film + Synchronized SRT."""

from __future__ import annotations

import json
import math
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

AUDIO_DIR = Path("/Volumes/Extra/datasets/wave2_studio_audio/A4_Cloud9")
PROJECT_DIR = Path(__file__).resolve().parent.parent
MATERIALS_DIR = (PROJECT_DIR / "../../materials").resolve()

# Exact master broadcast timeline (total = 88.00s, inside 75-90s window)
ACTS = [
    ("act1_console", "act1_console.wav", 24.80, 0.50),
    ("act2_replay", "act2_replay.wav", 24.00, 25.10),
    ("act3_radar_lol", "act3_radar_lol.wav", 18.90, 49.10),
    ("act4_ai_coach", "act4_ai_coach.wav", 20.30, 68.00),
]
TOTAL_DURATION = sum(a[2] for a in ACTS)  # 88.00s

# Word-for-word SRT cues calibrated directly to measured ZONOS3-Mini (Wyatt) WAV RMS boundaries
SRT_CUES: list[tuple[float, float, str]] = [
    # Act 1 (audio starts at 0.50s)
    (1.10, 4.80, "Strata9 is an industrial broadcast-grade\nesports coaching console"),
    (4.80, 8.45, "built on real Cloud9 VALORANT"),
    (9.05, 14.05, "and Cloud9 Kia League of Legends\nGRID telemetry streams."),
    (14.85, 16.85, "Zero synthetic mocks."),
    (17.35, 20.85, "Every stat streams live from compressed\nZstandard official match feeds"),
    (20.85, 24.35, "and ability supplements."),
    # Act 2 (audio starts at 25.10s)
    (25.60, 31.30, "Scrub the win probability timeline\nto pinpoint the exact turning points,"),
    (31.70, 33.80, "like Fracture Round 18."),
    (34.45, 38.95, "Launch our real-time 2D Canvas tactical replay\nto watch all 10 players move,"),
    (38.95, 43.35, "cast abilities with 3D aim vectors,"),
    (43.80, 48.45, "plant the Spike, and trade kills\nat half to four times speed."),
    # Act 3 (audio starts at 49.10s)
    (49.80, 55.30, "Switch seamlessly between the 775-cast\nspatial ability radar,"),
    (55.80, 57.85, "opponent scouting dossiers,"),
    (58.05, 62.75, "and Cloud9 Kia's League of Legends\nminute-by-minute gold differential"),
    (63.15, 67.25, "and Baron tempo curves across\nfull best-of-three series."),
    # Act 4 (audio starts at 68.00s)
    (68.60, 72.85, "Finally, the Strata9 AI Tactical Coach grounds"),
    (73.10, 78.15, "live large language model reasoning\nstrictly in verified round telemetry,"),
    (78.45, 83.60, "diagnosing man-advantage leaks\nand prescribing actionable scrim drills,"),
    (83.85, 87.35, "exportable in one click for Cloud9 coaches."),
]


def fmt_srt_time(sec: float) -> str:
    ms = int(round(sec * 1000))
    hrs, rem = divmod(ms, 3_600_000)
    mins, rem = divmod(rem, 60_000)
    secs, millis = divmod(rem, 1000)
    return f"{hrs:02d}:{mins:02d}:{secs:02d},{millis:03d}"


def write_srt(path: Path) -> None:
    lines: list[str] = []
    for idx, (start, end, text) in enumerate(SRT_CUES, start=1):
        lines.append(str(idx))
        lines.append(f"{fmt_srt_time(start)} --> {fmt_srt_time(end)}")
        lines.append(text)
        lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


def run_ffmpeg(args: list[str], log_path: Path) -> None:
    cmd = ["ffmpeg", "-y", "-hide_banner", *args]
    with log_path.open("w", encoding="utf-8") as log_f:
        proc = subprocess.run(cmd, stdin=subprocess.DEVNULL, stdout=log_f, stderr=log_f)
    if proc.returncode != 0:
        tail = "\n".join(log_path.read_text(encoding="utf-8", errors="ignore").splitlines()[-30:])
        raise RuntimeError(f"ffmpeg failed (rc={proc.returncode}), log={log_path}:\n{tail}")


def probe_duration(path: Path) -> float:
    out = subprocess.check_output(
        [
            "ffprobe",
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


def load_wav_mono(path: Path) -> tuple[int, np.ndarray]:
    with wave.open(str(path), "rb") as wf:
        sr = wf.getframerate()
        n = wf.getnframes()
        ch = wf.getnchannels()
        data = np.frombuffer(wf.readframes(n), dtype=np.int16).astype(np.float32) / 32768.0
        if ch > 1:
            data = data.reshape(-1, ch).mean(axis=1)
        return sr, data


def build_master_audio(scratch: Path) -> Path:
    sr = 44100
    total_samples = int(round(TOTAL_DURATION * sr))
    t = np.arange(total_samples, dtype=np.float32) / sr

    # Low-frequency tactical esports pulse soundscape (55 Hz obsidian sub + 110 Hz harmonic + 120 BPM telemetry pulse)
    sub_drone = 0.45 * np.sin(2.0 * math.pi * 55.0 * t) + 0.25 * np.sin(2.0 * math.pi * 110.0 * t + 0.4)
    fifth_pad = 0.14 * np.sin(2.0 * math.pi * 164.81 * t + 0.2 * np.sin(2.0 * math.pi * 0.15 * t))
    beat_phase = (t * 2.0) % 1.0
    pulse_env = np.exp(-beat_phase * 7.5).astype(np.float32)
    pulse_tone = 0.22 * pulse_env * np.sin(2.0 * math.pi * 82.41 * t)
    bar_phase = (t / 4.0) % 1.0
    ping_env = np.exp(-bar_phase * 18.0).astype(np.float32)
    radar_ping = 0.06 * ping_env * np.sin(2.0 * math.pi * 440.0 * t)

    bed_l = (sub_drone + fifth_pad + pulse_tone + 0.8 * radar_ping) * 0.068
    bed_r = (sub_drone + 0.92 * fifth_pad + pulse_tone + 1.15 * radar_ping) * 0.068

    fade_in = int(1.2 * sr)
    fade_out = int(2.0 * sr)
    bed_l[:fade_in] *= np.linspace(0.0, 1.0, fade_in, dtype=np.float32)
    bed_r[:fade_in] *= np.linspace(0.0, 1.0, fade_in, dtype=np.float32)
    bed_l[-fade_out:] *= np.linspace(1.0, 0.0, fade_out, dtype=np.float32)
    bed_r[-fade_out:] *= np.linspace(1.0, 0.0, fade_out, dtype=np.float32)

    voice = np.zeros(total_samples, dtype=np.float32)
    duck = np.ones(total_samples, dtype=np.float32)
    for _, wav_name, _, offset_sec in ACTS:
        wav_path = AUDIO_DIR / wav_name
        w_sr, w_data = load_wav_mono(wav_path)
        if w_sr != sr:
            raise RuntimeError(f"Expected {sr}Hz audio for {wav_path}, got {w_sr}Hz")
        start_i = int(round(offset_sec * sr))
        end_i = min(total_samples, start_i + len(w_data))
        seg = w_data[: end_i - start_i]
        voice[start_i:end_i] += seg * 0.92
        duck[start_i:end_i] = 0.58

    mix_l = np.clip(voice + bed_l * duck, -0.98, 0.98)
    mix_r = np.clip(voice + bed_r * duck, -0.98, 0.98)
    stereo = np.stack([mix_l, mix_r], axis=1)
    pcm = (stereo * 32767.0).astype(np.int16)

    raw_wav = scratch / "master_audio_raw.wav"
    with wave.open(str(raw_wav), "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(pcm.tobytes())

    norm_wav = scratch / "master_audio_14lufs.wav"
    run_ffmpeg(
        [
            "-i",
            str(raw_wav),
            "-af",
            "loudnorm=I=-14:TP=-1.5:LRA=9",
            "-ar",
            "48000",
            "-ac",
            "2",
            str(norm_wav),
        ],
        scratch / "ffmpeg_loudnorm.log",
    )
    return norm_wav


def normalize_act_video(act_meta: dict, target_dur: float, scratch: Path) -> Path:
    src = Path(act_meta["video_path"])
    actual_dur = probe_duration(src)
    wall_end = max(0.1, float(act_meta["trim_end_sec"]))
    scale_ratio = actual_dur / wall_end

    trim_start = max(0.0, float(act_meta["trim_start_sec"]) * scale_ratio)
    marks = act_meta.get("marks") or {}
    out_mp4 = scratch / f"{act_meta['name']}_norm.mp4"

    # Special editorial tightening for Act 4 when live LLM inference takes >3.5s:
    # Keep pre-click + brief Thinking beat, then reveal live answer card + Export .MD/.JSON synced to narration!
    if act_meta["name"] == "act4_ai_coach" and marks.get("ask_done_sec") and marks.get("ask_click_sec"):
        ask_click = float(marks["ask_click_sec"]) * scale_ratio
        ask_done = float(marks["ask_done_sec"]) * scale_ratio
        export_click = float(marks.get("export_click_sec", ask_done + 3.0)) * scale_ratio
        wait_dur = ask_done - ask_click
        if wait_dur > 2.4:
            # Segment B covers live answer reveal through Export .MD + Export .JSON + clean tail
            seg_b_start = trim_start + max(ask_click + 1.4, ask_done - 0.35)
            seg_b_len = max(1.0, actual_dur - seg_b_start)
            # We want seg_a + seg_b ~= target_dur (20.30s), with export_click landing around 15.2s into Act 4
            desired_seg_a = max(ask_click + 1.4, target_dur - seg_b_len)
            seg_a_end = min(seg_b_start, trim_start + desired_seg_a)
            seg_a = scratch / "act4_seg_a.mp4"
            seg_b = scratch / "act4_seg_b.mp4"
            run_ffmpeg(
                [
                    "-ss",
                    f"{trim_start:.3f}",
                    "-to",
                    f"{seg_a_end:.3f}",
                    "-i",
                    str(src),
                    "-vf",
                    "scale=1920:1080:flags=lanczos,fps=30,format=yuv420p",
                    "-an",
                    "-c:v",
                    "libx264",
                    "-preset",
                    "fast",
                    "-crf",
                    "16",
                    str(seg_a),
                ],
                scratch / "ffmpeg_act4_a.log",
            )
            run_ffmpeg(
                [
                    "-ss",
                    f"{seg_b_start:.3f}",
                    "-i",
                    str(src),
                    "-vf",
                    "scale=1920:1080:flags=lanczos,fps=30,format=yuv420p",
                    "-an",
                    "-c:v",
                    "libx264",
                    "-preset",
                    "fast",
                    "-crf",
                    "16",
                    str(seg_b),
                ],
                scratch / "ffmpeg_act4_b.log",
            )
            concat_list = scratch / "act4_parts.txt"
            concat_list.write_text(f"file '{seg_a}'\nfile '{seg_b}'\n", encoding="utf-8")
            joined = scratch / "act4_joined.mp4"
            run_ffmpeg(
                ["-f", "concat", "-safe", "0", "-i", str(concat_list), "-c", "copy", str(joined)],
                scratch / "ffmpeg_act4_join.log",
            )
            src = joined
            trim_start = 0.0
            actual_dur = probe_duration(joined)

    # Fit actual available duration smoothly to EXACT target_dur using gentle PTS retiming (compensates Playwright VFR drift)
    avail_dur = max(0.5, actual_dur - trim_start)
    pts_factor = target_dur / avail_dur
    # Clamp retiming within natural 0.85x..1.20x; pad tail if still shorter
    pts_clamped = min(1.20, max(0.85, pts_factor))
    retimed_dur = avail_dur * pts_clamped
    pad_sec = max(0.5, target_dur - retimed_dur + 0.5)

    vf = (
        f"setpts={pts_clamped:.6f}*(PTS-STARTPTS),"
        f"scale=1920:1080:flags=lanczos,fps=30,"
        f"tpad=stop_mode=clone:stop_duration={pad_sec:.2f},format=yuv420p"
    )
    run_ffmpeg(
        [
            "-ss",
            f"{trim_start:.3f}",
            "-i",
            str(src),
            "-t",
            f"{target_dur:.3f}",
            "-vf",
            vf,
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "17",
            "-movflags",
            "+faststart",
            str(out_mp4),
        ],
        scratch / f"ffmpeg_{act_meta['name']}.log",
    )
    got = probe_duration(out_mp4)
    print(f"  -> {out_mp4.name}: avail={avail_dur:.2f}s pts={pts_clamped:.3f}x -> exact={got:.2f}s (target={target_dur:.2f}s)")
    return out_mp4


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("Usage: assemble_demo.py <scratch_dir>")
    scratch = Path(sys.argv[1]).resolve()
    manifest = json.loads((scratch / "recording_manifest.json").read_text(encoding="utf-8"))
    by_name = {a["name"]: a for a in manifest["acts"]}

    MATERIALS_DIR.mkdir(parents=True, exist_ok=True)
    srt_path = MATERIALS_DIR / "Strata9_Cloud9_Demo_1080p.srt"
    mp4_path = MATERIALS_DIR / "Strata9_Cloud9_Demo_1080p.mp4"

    print("[ASSEMBLE] Writing synchronized SRT ->", srt_path)
    write_srt(srt_path)

    print("[ASSEMBLE] Mastering -14 LUFS audio (4x ZONOS3-Mini Wyatt WAV + tactical pulse bed)...")
    master_audio = build_master_audio(scratch)

    norm_clips: list[Path] = []
    for act_name, _, target_dur, _ in ACTS:
        print(f"[ASSEMBLE] Normalizing {act_name} -> {target_dur:.2f}s @ 1920x1080 30fps")
        norm_clips.append(normalize_act_video(by_name[act_name], target_dur, scratch))

    concat_txt = scratch / "all_acts.txt"
    concat_txt.write_text("".join(f"file '{c}'\n" for c in norm_clips), encoding="utf-8")
    video_raw = scratch / "video_concat.mp4"
    run_ffmpeg(
        ["-f", "concat", "-safe", "0", "-i", str(concat_txt), "-c", "copy", str(video_raw)],
        scratch / "ffmpeg_concat.log",
    )

    srt_ascii = scratch / "subtitles.srt"
    srt_ascii.write_text(srt_path.read_text(encoding="utf-8"), encoding="utf-8")

    # Swiss Industrial broadcast lower-third captions (libass PlayResY=288 -> FontSize=11 renders crisp ~40px on 1080p!)
    style = (
        "FontName=Helvetica Neue,FontSize=11,Bold=1,"
        "PrimaryColour=&H00F6F4F3,OutlineColour=&H000D0C0B,BackColour=&HB00B0C0D,"
        "BorderStyle=3,Outline=1.0,Shadow=0,MarginV=16,Alignment=2"
    )
    sub_filter = (
        f"subtitles='{srt_ascii.as_posix()}':force_style='{style}',"
        f"fade=t=in:st=0:d=0.35,fade=t=out:st={TOTAL_DURATION - 0.65:.2f}:d=0.65"
    )

    print("[ASSEMBLE] Burning crisp English captions & encoding final 88.0s 1080p H.264/AAC MP4...")
    run_ffmpeg(
        [
            "-i",
            str(video_raw),
            "-i",
            str(master_audio),
            "-vf",
            sub_filter,
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "libx264",
            "-profile:v",
            "high",
            "-level",
            "4.1",
            "-pix_fmt",
            "yuv420p",
            "-preset",
            "medium",
            "-crf",
            "19",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-ar",
            "48000",
            "-shortest",
            "-movflags",
            "+faststart",
            str(mp4_path),
        ],
        scratch / "ffmpeg_final.log",
    )

    # Extract 9 verification frames spanning all V6 highlights (Console, Replay, Telestrator, What-If, Corpus, LoL, AI Coach, JetBrains)
    frames_dir = scratch / "frames"
    for old_f in frames_dir.glob("*.png"):
        old_f.unlink()
    frames_dir.mkdir(exist_ok=True)
    for ts in [5, 20, 36, 46, 52, 58, 65, 76, 86]:
        run_ffmpeg(
            ["-ss", str(ts), "-i", str(mp4_path), "-frames:v", "1", "-q:v", "2", str(frames_dir / f"frame_{ts:02d}s.png")],
            scratch / f"ffmpeg_frame_{ts}.log",
        )

    dur = probe_duration(mp4_path)
    size_mb = mp4_path.stat().st_size / (1024 * 1024)
    print(f"[ASSEMBLE] DONE -> {mp4_path} ({dur:.2f}s, {size_mb:.2f} MB) + {srt_path} ({srt_path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
