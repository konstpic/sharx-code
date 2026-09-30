#!/usr/bin/env python3
"""Generate the Russian voice-over for the animated help scenes with Higgsfield TTS (MiniMax).

One clip per scene: the step lines are joined with `<#1#>` (a 1 s pause tag), then the result is
cut back into one mp3 per step at those pauses, so the help player can advance step by step with
the voice. Needs the `higgsfield` CLI (logged in, workspace selected) and ffmpeg.

  python3 scripts/gen-help-audio.py [scene ...]        # generate (costs credits!)
  python3 scripts/gen-help-audio.py --cost             # only print the estimated cost
Output: public/assets/help-audio/ru/<scene>-<n>.mp3 and manifest.json (durations).
"""
import json, os, re, subprocess, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "public", "assets", "help-audio", "ru")
VOICE = "731b4ffe-e95e-59f4-8c00-81608936091f"  # Ainsley (preset)
VARIANT = "minimax"
PAUSE = "<#1#>"


def hf(*args):
    r = subprocess.run(["higgsfield", *args], capture_output=True, text=True)
    return r.returncode, (r.stdout + r.stderr).strip()


def cost(text):
    _, out = hf("generate", "cost", "text2speech_v2", "--prompt", text, "--variant", VARIANT, "--voice-id", VOICE, "--voice-type", "preset")
    return float(re.search(r"([\d.]+) credits", out).group(1))


def silences(path, noise="-35dB", dur=0.7):
    r = subprocess.run(["ffmpeg", "-i", path, "-af", f"silencedetect=noise={noise}:d={dur}", "-f", "null", "-"], capture_output=True, text=True)
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", r.stderr)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", r.stderr)]
    return list(zip(starts, ends))


def duration(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], capture_output=True, text=True)
    return float(r.stdout.strip())


def split(src, scene, n_steps):
    total = duration(src)
    gaps = [(s, e) for s, e in silences(src) if e - s >= 0.7 and s > 0.3 and e < total - 0.05]
    # keep the n_steps-1 longest pauses (the injected 1 s tags), in time order
    gaps = sorted(sorted(gaps, key=lambda g: g[0] - g[1])[: n_steps - 1])
    if len(gaps) != n_steps - 1:
        raise SystemExit(f"{scene}: found {len(gaps)} pauses, expected {n_steps - 1}")
    bounds = [0.0] + [(s + e) / 2 for s, e in gaps] + [total]
    files = []
    for i in range(n_steps):
        a, b = bounds[i], bounds[i + 1]
        dst = os.path.join(OUT, f"{scene}-{i + 1}.mp3")
        # mono 64k is plenty for speech; a short fade avoids clicks at the cut
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{a:.3f}", "-to", f"{b:.3f}", "-i", src, "-ac", "1", "-b:a", "64k",
                        "-af", "silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,afade=t=in:d=0.02",
                        dst], check=True)
        files.append({"file": f"{scene}-{i + 1}.mp3", "sec": round(duration(dst), 2)})
    return files


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    only_cost = "--cost" in sys.argv
    scenes = json.load(open(os.path.join(HERE, "help-narration.json")))["ru"]
    os.makedirs(OUT, exist_ok=True)
    manifest_path = os.path.join(OUT, "manifest.json")
    manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {}
    total = 0.0
    for scene, lines in scenes.items():
        if args and scene not in args:
            continue
        text = PAUSE.join(lines)
        c = cost(text)
        total += c
        print(f"{scene}: {len(lines)} steps, {len(text)} chars, {c} credits")
        if only_cost:
            continue
        code, out = hf("generate", "create", "text2speech_v2", "--prompt", text, "--variant", VARIANT, "--voice-id", VOICE, "--voice-type", "preset", "--wait", "--wait-timeout", "5m")
        url = out.strip().splitlines()[-1]
        if code != 0 or not url.startswith("http"):
            raise SystemExit(f"{scene}: generation failed: {out}")
        raw = os.path.join(OUT, f"{scene}.raw.mp3")
        urllib.request.urlretrieve(url, raw)
        manifest[scene] = split(raw, scene, len(lines))
        os.remove(raw)
        json.dump(manifest, open(manifest_path, "w"), ensure_ascii=False, indent=1)
    print("total credits:", round(total, 2))


if __name__ == "__main__":
    main()
