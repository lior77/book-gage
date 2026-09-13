#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Render one of the project's markdown documents as a page for a phone.

The markdown file is the source of truth — it is what gets reviewed in a diff
and what lives beside ARCHITECTURE.md.  This turns it into the artifact copy so
there is never a second hand-written version to keep in step.

The visual language is the one docs/DESIGN.html already uses: same tokens, same
neutrals, same RTL table treatment.  A plan for this project should look like
this project's other document, not like a page from somewhere else.

    python3 scripts/build_workplan.py [out.html]
    python3 scripts/build_workplan.py --src docs/DELIVERY.md --title "..." out.html
"""
import argparse
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "docs", "WORKPLAN.md")
TITLE = "פורטולנד — תוכנית העבודה"


def esc(t):
    return (t.replace("&", "&amp;").replace("<", "&lt;")
             .replace(">", "&gt;").replace('"', "&quot;"))


def ltr_runs(t):
    """A Latin run inside Hebrew needs dir="ltr" or the bidi algorithm reorders
    its punctuation to the wrong end.  Section 11 of the architecture document
    has the rule; this applies it to the rendered prose."""
    wrap = lambda m: '<span dir="ltr">%s</span>' % m.group(0)
    # a Latin sentence
    t = re.sub(r"[A-Za-z][A-Za-z0-9 ,.:;()/_\u2018\u2019\u201c\u201d\u05f4'\-\u2013]{9,}"
               r"[A-Za-z0-9.\u05f4)]", wrap, t)
    # a fraction, a date, a version.  "17/18" renders as "18/17" in an RTL run —
    # in a document whose whole subject is coverage, that is the number saying
    # the opposite of itself.
    return re.sub(r"\d+(?:[/\-.]\d+)+", wrap, t)


def inline(t):
    """The inline markdown this document actually uses."""
    out, last = [], 0
    for m in re.finditer(r"`([^`]+)`", t):
        out.append(ltr_runs(esc(t[last:m.start()])))
        out.append('<code dir="ltr">%s</code>' % esc(m.group(1)))
        last = m.end()
    out.append(ltr_runs(esc(t[last:])))
    h = "".join(out)
    h = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", h)
    h = re.sub(r"~~(.+?)~~", r"<s>\1</s>", h)
    return h


def cells(line):
    return [c.strip() for c in line.strip().strip("|").split("|")]


def render(md):
    lines = md.split("\n")
    out, i = [], 0
    while i < len(lines):
        ln = lines[i]

        if ln.startswith("```"):                                   # code fence
            i += 1
            body = []
            while i < len(lines) and not lines[i].startswith("```"):
                body.append(lines[i])
                i += 1
            i += 1
            out.append('<pre dir="ltr"><code>%s</code></pre>' % esc("\n".join(body)))
            continue

        if ln.startswith("> "):                                    # blockquote
            body = []
            while i < len(lines) and lines[i].startswith(">"):
                body.append(lines[i].lstrip(">").strip())
                i += 1
            out.append('<blockquote>%s</blockquote>' % inline(" ".join(body)))
            continue

        if re.match(r"^\|.*\|$", ln) and i + 1 < len(lines) \
                and re.match(r"^\|[\s:\-|]+\|$", lines[i + 1]):     # table
            head = cells(ln)
            align = ["end" if c.endswith(":") else "start" for c in cells(lines[i + 1])]
            i += 2
            rows = []
            while i < len(lines) and re.match(r"^\|.*\|$", lines[i]):
                rows.append(cells(lines[i]))
                i += 1
            th = "".join('<th style="text-align:%s">%s</th>' % (align[n], inline(c))
                         for n, c in enumerate(head))
            tb = "".join(
                "<tr>%s</tr>" % "".join(
                    '<td style="text-align:%s">%s</td>'
                    % (align[n] if n < len(align) else "start", inline(c))
                    for n, c in enumerate(r))
                for r in rows)
            out.append('<div class="scroll"><table><thead><tr>%s</tr></thead>'
                       "<tbody>%s</tbody></table></div>" % (th, tb))
            continue

        m = re.match(r"^(#{1,3}) (.+)$", ln)                        # heading
        if m:
            out.append("<h%d>%s</h%d>" % (len(m.group(1)), inline(m.group(2)),
                                          len(m.group(1))))
            i += 1
            continue

        if re.match(r"^---\s*$", ln):                               # rule
            out.append("<hr>")
            i += 1
            continue

        m = re.match(r"^(\d+)\. (.+)$|^- (.+)$", ln)                # list
        if m:
            tag = "ol" if m.group(1) else "ul"
            items = []
            while i < len(lines):
                m2 = re.match(r"^(?:\d+\. |- )(.+)$", lines[i])
                if not m2:
                    # a wrapped line belongs to the item above it
                    if items and lines[i].startswith("  ") and lines[i].strip():
                        items[-1] += " " + lines[i].strip()
                        i += 1
                        continue
                    break
                items.append(m2.group(1))
                i += 1
            out.append("<%s>%s</%s>"
                       % (tag, "".join("<li>%s</li>" % inline(x) for x in items), tag))
            continue

        if ln.strip():                                              # paragraph
            para = [ln.strip()]
            i += 1
            while i < len(lines) and lines[i].strip() \
                    and not re.match(r"^(#{1,3} |[-*>|]|\d+\. |```)", lines[i]):
                para.append(lines[i].strip())
                i += 1
            out.append("<p>%s</p>" % inline(" ".join(para)))
            continue

        i += 1
    return "\n".join(out)


PAGE = """<title>%(title)s</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;700&display=swap">
<style>
:root{
  color-scheme:light;
  --pg:#f4f6f9; --sf:#ffffff; --sk:#eef2f6; --tx:#16212e; --tx2:#5b6a7d;
  --ln:#dbe2ea; --ac:#15568f; --ok:#1c7a4a; --no:#b3261e;
  --he:"Heebo","Noto Sans Hebrew",system-ui,Arial,sans-serif;
  --mo:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  color-scheme:dark;
  --pg:#0d141c; --sf:#161f2a; --sk:#111925; --tx:#e3eaf2; --tx2:#93a2b4;
  --ln:#243040; --ac:#79ade6; --ok:#5fd39a; --no:#ff8a80;
}}
:root[data-theme="dark"]{
  color-scheme:dark;
  --pg:#0d141c; --sf:#161f2a; --sk:#111925; --tx:#e3eaf2; --tx2:#93a2b4;
  --ln:#243040; --ac:#79ade6; --ok:#5fd39a; --no:#ff8a80;
}
*{box-sizing:border-box}
html{direction:rtl}
body{margin:0; background:var(--pg); color:var(--tx); direction:rtl;
  font:400 16px/1.65 var(--he); -webkit-text-size-adjust:100%%}
.w{max-width:860px; margin:0 auto; padding-block:0 80px; padding-inline:20px}
h1,h2,h3{margin:0; line-height:1.22; text-wrap:balance; font-weight:700}
h1{font-size:clamp(27px,6vw,38px); letter-spacing:-.015em}
h2{font-size:22px; margin-block-start:46px; padding-block-end:8px;
  border-block-end:2px solid var(--tx)}
h3{font-size:16px; margin-block-start:28px; color:var(--ac)}
p{margin:12px 0 0; color:var(--tx2); font-size:15px; max-width:68ch}
b{color:var(--tx); font-weight:700}
s{color:var(--tx2); text-decoration-thickness:1px}
code,pre{font-family:var(--mo); font-variant-numeric:tabular-nums}
code{font-size:12.5px; background:var(--sk); padding:1px 5px; border-radius:2px;
  unicode-bidi:isolate; color:var(--tx)}
pre{background:var(--sk); border:1px solid var(--ln); border-radius:3px;
  padding:14px 16px; overflow-x:auto; margin-block-start:14px; font-size:12.5px;
  line-height:1.6}
pre code{background:none; padding:0}
ul,ol{margin:12px 0 0; padding-inline-start:22px; color:var(--tx2);
  font-size:15px; display:flex; flex-direction:column; gap:7px}
li{padding-inline-start:4px}
li::marker{color:var(--ac); font-weight:700}
blockquote{margin:16px 0 0; padding:12px 16px; background:var(--sf);
  border:1px solid var(--ln); border-inline-start:3px solid var(--ac);
  border-radius:3px; font-size:14px; color:var(--tx2); line-height:1.6}
hr{border:0; border-block-start:1px solid var(--ln); margin-block:40px 0}
.scroll{overflow-x:auto; margin-block-start:16px; border:1px solid var(--ln);
  border-radius:3px}
table{border-collapse:collapse; width:100%%; min-width:340px; background:var(--sf)}
th,td{padding:9px 12px; font-size:13.5px; border-block-end:1px solid var(--ln);
  vertical-align:top; line-height:1.5}
thead th{background:var(--sk); font-size:11px; letter-spacing:.06em;
  color:var(--tx2); font-weight:500; white-space:nowrap}
tbody tr:last-child td{border-block-end:0}
td b{font-weight:700}
header{padding-block:46px 6px}
.sub{color:var(--tx2); font-size:15.5px; margin-block-start:12px; max-width:60ch}
footer{margin-block-start:56px; padding-block-start:18px;
  border-block-start:1px solid var(--ln); font-size:12.5px; color:var(--tx2)}
a{color:var(--ac)}
a:focus-visible,summary:focus-visible{outline:2px solid var(--ac);
  outline-offset:2px}
</style>
<div class="w">
%(body)s
<footer><p>נוצר מ-<code dir="ltr">docs/WORKPLAN.md</code> על ידי
  <code dir="ltr">scripts/build_workplan.py</code>. הקובץ במאגר הוא המקור.</p></footer>
</div>
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out", nargs="?", default=os.path.join(ROOT, "workplan.html"))
    ap.add_argument("--src", default=SRC, help="the markdown file to render")
    ap.add_argument("--title", default=TITLE, help="the page's own title")
    args = ap.parse_args()

    md = open(args.src, encoding="utf-8").read()
    body = render(md)
    # the first heading becomes the page's own header block
    body = body.replace("<h1>", "<header><h1>", 1)
    body = re.sub(r"(</h1>)(\s*<blockquote>.*?</blockquote>)", r"\1\2</header>",
                  body, count=1, flags=re.S)
    html = PAGE % {"body": body, "title": esc(args.title)}
    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write(html)
    print("wrote %s  (%.1f KB)" % (args.out, len(html.encode()) / 1024))
    return 0


if __name__ == "__main__":
    sys.exit(main())
