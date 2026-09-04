#!/usr/bin/env python3
"""
Compare a HebSub output against a reference subtitle for the same film.

    python3 tools/compare_subs.py REFERENCE.srt|.ass CANDIDATE.srt|.ass [--window 300]

Reports, for each file: cue count, minutes of subtitle on screen, characters,
gaps longer than a minute; then a per-window table of cue counts so the scenes
the candidate lost can be read off directly. Windows where the candidate has
fewer than half the reference's cues are flagged.

This is the yardstick used to judge the transcription path: the reference is
the professional subtitle (uploaded, or from a disc), the candidate is what the
app produced from the soundtrack.
"""
import re
import sys


def parse_srt(path):
    text = open(path, encoding="utf-8-sig").read()
    out = []
    for m in re.finditer(
        r"(\d+)\s*\n(\d\d):(\d\d):(\d\d)[,.](\d{1,3}) --> (\d\d):(\d\d):(\d\d)[,.](\d{1,3})\s*\n(.*?)(?=\n\s*\n|\Z)",
        text, re.S,
    ):
        g = m.groups()
        s = int(g[1]) * 3600 + int(g[2]) * 60 + int(g[3]) + int(g[4].ljust(3, "0")) / 1000
        e = int(g[5]) * 3600 + int(g[6]) * 60 + int(g[7]) + int(g[8].ljust(3, "0")) / 1000
        out.append((s, e, clean(g[9])))
    return out


def parse_ass(path):
    out = []
    for line in open(path, encoding="utf-8-sig"):
        if not line.startswith("Dialogue:"):
            continue
        f = line.rstrip("\n").split(",", 9)
        if len(f) < 10:
            continue
        out.append((ass_time(f[1]), ass_time(f[2]), clean(re.sub(r"\{[^}]*\}", "", f[9]).replace("\\N", " "))))
    return out


def ass_time(t):
    h, m, s = t.split(":")
    return int(h) * 3600 + int(m) * 60 + float(s)


def clean(t):
    t = re.sub(r"[‪-‮​-‏]", "", t)
    return re.sub(r"\s+", " ", t).strip()


def load(path):
    return parse_ass(path) if path.lower().endswith(".ass") else parse_srt(path)


def fmt(x):
    x = int(x)
    return "%02d:%02d:%02d" % (x // 3600, (x % 3600) // 60, x % 60)


def summary(name, cues):
    on = sum(e - s for s, e, _ in cues)
    chars = sum(len(t) for _, _, t in cues)
    gaps = [(cues[i][1], cues[i + 1][0]) for i in range(len(cues) - 1) if cues[i + 1][0] - cues[i][1] > 60]
    print(f"{name:10s} cues={len(cues):4d}  on-screen={on / 60:5.1f} min  chars={chars:6d}  "
          f"first={fmt(cues[0][0])} last={fmt(cues[-1][1])}  gaps>60s={len(gaps)} ({sum(b - a for a, b in gaps) / 60:.1f} min)")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    window = 300
    for i, a in enumerate(sys.argv):
        if a == "--window":
            window = int(sys.argv[i + 1])
    if len(args) != 2:
        print(__doc__)
        sys.exit(2)
    ref, cand = load(args[0]), load(args[1])
    if not ref or not cand:
        print("could not parse one of the files")
        sys.exit(1)
    summary("reference", ref)
    summary("candidate", cand)
    end = max(ref[-1][1], cand[-1][1])
    print(f"\ncues per {window}s window   (reference | candidate)")
    lost = 0
    for w in range(0, int(end) + 1, window):
        r = sum(1 for s, _, _ in ref if w <= s < w + window)
        c = sum(1 for s, _, _ in cand if w <= s < w + window)
        flag = ""
        if r >= 8 and c < r * 0.5:
            flag = "  <<< lost"
            lost += 1
        print(f"{fmt(w)}  {r:4d} | {c:4d}{flag}")
    ratio = sum(e - s for s, e, _ in cand) / max(1e-9, sum(e - s for s, e, _ in ref))
    print(f"\ncandidate on-screen time = {ratio * 100:.0f}% of reference; windows lost: {lost}")


if __name__ == "__main__":
    main()
