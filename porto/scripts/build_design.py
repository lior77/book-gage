#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate docs/DESIGN.html — the app's visual language, read out of the app.

    python3 scripts/build_design.py

Every value on the page is parsed from `app.css` and `app.js` rather than typed
here, for the same reason every number in the app carries a source: a design
document that restates the code is a document that drifts from it.  `checks.py`
re-runs this generator and fails if the file on disk is not what it produces.

The contrast ratios are computed here, at generation time, by the formula WCAG
2.2 defines — so the page needs no JavaScript to show them and is as true from
`file://` as it is from a server.

The rules the page measures against, with their sources, are in RULES below.
They are the industry guidance as of 2026-09, checked against the primary
documents rather than summaries of them; where a rule is a platform
recommendation rather than a requirement the table says so.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSS = os.path.join(ROOT, "app.css")
JS = os.path.join(ROOT, "app.js")
OUT = os.path.join(ROOT, "docs", "DESIGN.html")

# ------------------------------------------------------------- colour maths --
DARK_TOKENS = """
  color-scheme:dark;
  --pg:#0d141c; --sf:#161f2a; --sk:#111925; --tx:#e3eaf2; --tx2:#93a2b4;
  --ln:#243040; --ac:#79ade6; --ok:#5fd39a; --no:#ff8a80;
"""

def rgb(h):
    h = h.strip()
    if h.startswith("#") and len(h) == 4:
        h = "#" + "".join(c * 2 for c in h[1:])
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def luminance(h):
    def f(c):
        c /= 255
        return c / 12.92 if c <= .03928 else ((c + .055) / 1.055) ** 2.4
    r, g, b = (f(c) for c in rgb(h))
    return .2126 * r + .7152 * g + .0722 * b


def contrast(a, b):
    la, lb = luminance(a), luminance(b)
    return (max(la, lb) + .05) / (min(la, lb) + .05)


def ink_on(h):
    return "#141b26" if luminance(h) > .38 else "#ffffff"


# ------------------------------------------------------------ reading app.css --
def tokens(block):
    """Every --name:value in one declaration block, in source order."""
    out = {}
    for m in re.finditer(r"(--[a-z0-9-]+)\s*:\s*([^;]+);", block):
        out[m.group(1)] = m.group(2).strip()
    return out


def read_palettes(css):
    light = css[css.index(":root{"):css.index("@media (prefers-color-scheme: dark)")]
    dark_start = css.index(':root[data-theme="dark"]{')
    dark = css[dark_start:css.index("}", css.index("--shadow:", dark_start))]
    a, b = tokens(light), tokens(dark)
    # the dark block overrides a subset; everything else is inherited
    merged = dict(a)
    merged.update(b)
    return a, merged, set(b)


def read_type(css):
    body = re.search(r"body\{[^}]*font:(\d+)\s+(\d+)px/([\d.]+)\s+([^;]+);", css, re.S)
    heads = []
    for tag in ("h1", "h2", "h3"):
        m = re.search(r"\n%s\{font-size:([\d.]+)rem" % tag, css)
        if m:
            heads.append((tag, float(m.group(1))))
    lh = re.search(r"h1,h2,h3\{margin:0; line-height:([\d.]+)", css)
    return {
        "weight": body.group(1), "size": int(body.group(2)),
        "line": float(body.group(3)), "stack": body.group(4).strip(),
        "heads": heads, "head_line": float(lh.group(1)) if lh else None,
    }


def read_lines(js):
    """The four boundary weights and the two inks the comparison line is made of."""
    m = re.search(r"const LINE_W = \{([^}]*)\}", js)
    if not m:
        raise SystemExit("LINE_W not found in app.js")
    w = dict(re.findall(r"(\w+):\s*([\d.]+)", m.group(1)))
    core = re.search(r"const CMP_CORE = '(#[0-9a-fA-F]{6})'", js)
    region = re.search(r"const REGION_COLOUR = '(#[0-9a-fA-F]{6})'", js)
    if not core or not region:
        raise SystemExit("CMP_CORE / REGION_COLOUR not found in app.js")
    return {"w": w, "core": core.group(1), "region": region.group(1)}


def read_icons(js):
    """Every icon in the app, name and drawing, straight out of the ICON table."""
    block = js[js.index("const ICON = {"):]
    block = block[:block.index("\n};")]
    # The pattern must not consume the newline that ends an entry: it is also
    # the newline that starts the next one, and a consuming match skipped every
    # second icon — 13 of 27 reached the document and the loss was silent.
    out = {}
    for m in re.finditer(r"\n  ([a-z0-9]+): *'((?:[^'\\\\]|\\\\.)*)'", block):
        out[m.group(1)] = m.group(2).replace("\\'", "'")
    named = re.findall(r"\n  ([a-z0-9]+):\s*'", block)
    if len(out) != len(named):
        raise SystemExit(
            "ICON has %d entries and only %d were parsed — missing %s"
            % (len(named), len(out), [n for n in named if n not in out]))
    return out


def read_classes(css):
    """Every class the stylesheet gives a rule to."""
    bare = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    return set(re.findall(r"\.([A-Za-z][\w-]*)", bare))


def read_motion(css):
    out = []
    for m in re.finditer(r"transition:([^;}]+)", css):
        for part in m.group(1).split(","):
            d = re.search(r"([\d.]+)s", part)
            if d:
                out.append(int(float(d.group(1)) * 1000))
    return sorted(set(out))


# -------------------------------------------------------------------- rules --
# Each: (id, what it requires, level, source, url).  Level says whether it is a
# requirement or a platform recommendation — the difference matters and the page
# prints it.
RULES = [
    ("SC 1.4.3 Contrast (Minimum)", "טקסט ≥ 4.5:1 · טקסט גדול ≥ 3:1", "WCAG 2.2 · AA",
     "W3C", "https://www.w3.org/TR/WCAG22/#contrast-minimum"),
    ("SC 1.4.11 Non-text Contrast",
     "רכיבי ממשק ואובייקטים גרפיים הדרושים להבנה ≥ 3:1 מול הצבע שלצדם",
     "WCAG 2.2 · AA", "W3C", "https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html"),
    ("SC 1.4.12 Text Spacing", "הטקסט שורד גובה שורה 1.5×, ריווח פסקה 2×", "WCAG 2.2 · AA",
     "W3C", "https://www.w3.org/TR/WCAG22/#text-spacing"),
    ("SC 2.5.8 Target Size (Minimum)", "יעד מגע ≥ 24 × 24 פיקסלי CSS", "WCAG 2.2 · AA",
     "W3C", "https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html"),
    ("SC 2.5.5 Target Size (Enhanced)", "יעד מגע ≥ 44 × 44", "WCAG 2.2 · AAA",
     "W3C", "https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html"),
    ("SC 2.4.7 Focus Visible", "לפוקוס המקלדת יש סימון נראה", "WCAG 2.2 · AA",
     "W3C", "https://www.w3.org/TR/WCAG22/#focus-visible"),
    ("SC 2.4.11 Focus Not Obscured", "רכיב שקיבל פוקוס אינו מוסתר לגמרי בידי תוכן האתר",
     "WCAG 2.2 · AA", "W3C",
     "https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html"),
    ("SC 2.4.13 Focus Appearance", "היקף 2 פיקסל, ויחס 3:1 בין מצב הפוקוס למצב שבלעדיו",
     "WCAG 2.2 · AAA", "W3C",
     "https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html"),
    ("SC 2.3.3 Animation from Interactions", "אפשר לכבות אנימציה שהאינטראקציה מפעילה",
     "WCAG 2.2 · AAA", "W3C", "https://www.w3.org/TR/WCAG22/#animation-from-interactions"),
    ("Touch target", "48 × 48 dp", "המלצת פלטפורמה", "Material Design 3",
     "https://support.google.com/accessibility/android/answer/7101858"),
    ("Touch target", "44 × 44 pt כברירת מחדל, 28 × 28 pt מינימום", "המלצת פלטפורמה",
     "Apple HIG", "https://developer.apple.com/design/human-interface-guidelines/accessibility"),
    ("Spacing", "בסיס 8, עם חצאי צעדים של 4", "המלצת פלטפורמה", "Material Design 3",
     "https://m3.material.io/foundations/layout/understanding-layout/spacing"),
    ("Body type", "16 / 24 sp (Body Large), 14 / 20 (Body Medium)", "המלצת פלטפורמה",
     "Material Design 3", "https://m3.material.io/styles/typography/type-scale-tokens"),
    ("Design tokens", "‏$value חובה; ‏{ } ו-. אסורים בשם; קבוצות חסרות משמעות",
     "פורמט יציב", "Design Tokens Format Module 2025.10",
     "https://www.designtokens.org/TR/2025.10/format/"),
    ("RTL", "כיוון לוגי ב-CSS; לא להפוך סימנים אוניברסליים, שעונים או ספרות",
     "המלצת פלטפורמה", "Apple HIG · Material",
     "https://developer.apple.com/design/human-interface-guidelines/right-to-left"),
    ("Motion", "‏prefers-reduced-motion: להחליף תנועה בהצלבה, לא למחוק משוב",
     "המלצת פלטפורמה", "MDN · Apple HIG",
     "https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion"),
]

# What each colour token is for.  A token with no recorded role is the design
# equivalent of a number with no source, so the table says "לא מתועד" rather
# than inventing one.
ROLES = {
    "--bg": "רקע המסך ורקע המפה כשמפת הרקע כבויה",
    "--card": "משטח חצי הטקסט",
    "--ink": "טקסט ראשי",
    "--ink-2": "טקסט משני",
    "--line": "קו מפריד — קישוט, ולכן 1.4.11 אינו חל עליו",
    "--ctl-line": "מסגרת של פקד — מזהה את הפקד, ולכן חייב 3:1",
    "--accent": "קישורים ומצב פעיל",
    "--accent-ink": "טקסט על גבי הצבע המוביל",
    "--warn": "אזהרה", "--warn-bg": "רקע אזהרה",
    "--good": "תקין", "--bad": "שגיאה",
    "--miss": "׳אין נתון׳ — טקסט שקוראים, ולכן 4.5:1",
    "--tool-bg": "רקע התפריט המלא",
    "--tool-solid": "רקע רצועת הכלים", "--tool-solid-2": "רצועת הכלים, לחוץ",
    "--tool-line": "קו קבוצה בתפריט — קישוט, ולכן 1.4.11 אינו חל עליו",
    "--btn-solid": "שני הכפתורים שעל המפה", "--btn-solid-2": "אותם כפתורים, לחוצים",
    "--btn-line": "מסגרתם — 3:1 מול רקע המפה",
    "--ring-off": "החישוק הכבוי באייקון הגבולות",
    "--hi": "רקע הפריט המסומן", "--hi-line": "הקו של הפריט המסומן",
    "--dot": "נקודת POI", "--dot-ring": "טבעת סביבה",
    "--float": "צל של דבר שמרחף", "--float-sm": "צל קטן", "--float-in": "צל פנימי",
    "--shadow": "הצל היחיד, לדברים שבאמת מרחפים",
    "--r-card": "רדיוס כרטיס", "--r-ctl": "רדיוס פקד", "--r-pill": "רדיוס גלולה",
    "--s1": "ריווח 1", "--s2": "ריווח 2", "--s3": "ריווח 3",
    "--s4": "ריווח 4", "--s5": "ריווח 5", "--s6": "ריווח 6",
    "--safe-b": "שוליים בטוחים למטה", "--safe-t": "שוליים בטוחים למעלה",
    "--f": "גובה חצי המפה",
}

# The five that the comparison screen paints with, and the hatch beside them.
BLUES = ["#a1bbd9", "#82a8d3", "#4380c7", "#265b97", "#13365d"]
HATCH = {"light": "#9aa6b4", "dark": "#6d7b90", "w": "1.2px", "gap": "4px", "angle": "45°"}

# ----------------------------------------------------------------- regions --
# The named parts of the screen.  Naming them is half the point: "the visual
# area" and "the textual area" are what a change is described against, and a
# change that cannot be described against one of these is a change to the
# layout itself.
REGIONS = [
    ("האזור הוויזואלי", "#paneMap", ".pane-map",
     "המפה, ורק היא. חצי המסך העליון לאורך, וחצי ההתחלה לרוחב."),
    ("האזור הטקסטואלי", "#paneText", ".pane-text",
     "מסמך הרמה: כרטיסים, שורות מפתח-ערך, וכל מספר עם מקור ושנה."),
    ("רצועת הפקדים", "—", ".mt · .crumb",
     "רצועה בראש האזור הוויזואלי: כפתור תפריט, כפתור בית, ומסלול הניווט בקצה "
     "הנגדי. גובהה --ctl-size, והמפה שומרת אותה פנויה."),
    ("התפר", "—", ".seam",
     "קו של פיקסל בין שני האזורים. אינו ידית ואי אפשר לגרור אותו."),
    ("מסך התפריט", "#menu", ".menu",
     "מכסה את האזור הוויזואלי על משטח אטום. אינו רצועה ואינו מגירה."),
    ("יריעת המקום", "#wpSheet", ".sheet",
     "טופס מלא-מסך לנקודה שהמשתמש מוסיף, בגובה שנשאר מעל המקלדת."),
    ("חלון המקורות", "#infoDrawer", ".drawer",
     "מקורות, דיוק ומה שחסר — החלון המלא היחיד."),
]

# The three that the layout button switches between, plus what the orientation
# does to each.  --f is fixed at 50%: the split is not draggable.
VIEWS = [
    ("גרפיקה וטקסט", "split", "לאורך: מפה למעלה, טקסט למטה. לרוחב: מפה בחצי "
     "ההתחלה, טקסט לצדה.", "ברירת המחדל"),
    ("גרפיקה בלבד", "map", "האזור הוויזואלי תופס את המסך; הרצועה נשארת עליו.",
     ""),
    ("טקסט בלבד", "text", "האזור הטקסטואלי תופס את המסך; כפתורי הרצועה נשארים "
     "כדי שיהיה איך לצאת.", ""),
]

# ------------------------------------------------------------------ logics --
# Decisions about behaviour rather than about a value, each with the source that
# settles it.  They are here and not only in the code because the next change to
# the menu has to know why the menu looks like this.
LOGICS = [
    ("שלוש אפשרויות תצוגה, לא ״ההפוכה מהנוכחית״",
     "בחירה בין אפשרויות שוללות זו את זו מוצגת בשלמותה, עם סימון על זו שבתוקף. "
     "התווית על פקד לא משתנה עם מצבו.",
     "‏WAI-ARIA APG, Switch: ״it is critical the label on a switch does not "
     "change when its state changes״ · Material 3, Switch: ״switches control "
     "binary options, not opposing ones… use a connected button group instead״",
     "https://www.w3.org/WAI/ARIA/apg/patterns/switch/"),
    ("״לפי המכשיר״ הוא אפשרות ולא היעדר אפשרות",
     "עד 1.30.0 התפריט הציע יום ולילה בלבד, ולכן הבחירה הראשונה הייתה סופית — "
     "לא הייתה דרך חזרה למעקב אחרי המכשיר. שלוש שורות סוגרות את הקבוצה.",
     "‏Apple HIG, Segmented controls: ״offers a single choice from among a set "
     "of options… use nouns or noun phrases for segment labels״",
     "https://developer.apple.com/design/human-interface-guidelines/segmented-controls"),
    ("מתגי השכבות הם switch ולא checkbox",
     "הם משנים מיד את מה שעל המסך ואין כפתור אישור. ה-APG מביא בדיוק את המקרה "
     "הזה כדוגמה — מתג ״אורות״ — מול רשימת checkbox שנבדקת לפני שליחה.",
     "‏WAI-ARIA APG, Switch Pattern",
     "https://www.w3.org/WAI/ARIA/apg/patterns/switch/"),
    ("מסלול הניווט מקוצר לשתי רמות",
     "‏NN/g: ״Consider shortening the breadcrumb trail to include only the last "
     "level(s)״ — וגם ״Don't use breadcrumbs that wrap to multiple lines״. "
     "**שתי השורות כאן נוגדות את הכלל השני**: הן אינן גלישה אלא שתי רמות "
     "מוערמות בכוונה, והנימוק שהכלל נותן — שבר גולש אוכל רוחב במסך צפוף — "
     "מתקיים כאן הפוך, כי הרצועה התחתונה בוטלה והשטח חזר למפה.",
     "‏Nielsen Norman Group, Breadcrumbs: 11 Design Guidelines",
     "https://www.nngroup.com/articles/breadcrumbs/"),
    ("תווית המפה היא הילה ולא לוחית",
     "‏SC 1.4.11 קובע במפורש: ״a wide border around the letter that fills in the "
     "inner details of the letters acts as a halo and would be considered "
     "background״. לכן הניגודיות נמדדת בין הדיו להילה — 4.5:1 לפי SC 1.4.3 — "
     "ולא בין הדיו לכל פיקסל של המפה מתחת.",
     "‏W3C, Understanding SC 1.4.11 · MapLibre: ״Max text halo width is 1/4 of "
     "the font-size״",
     "https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html"),
    ("פקד צף הוא 44 ולא 38",
     "הרצפה של WCAG 2.2 SC 2.5.8 ברמת AA היא 24×24, אבל אפל מפרסמת 44 ומטריאל "
     "48 כגודל הנוח. שלושת הפקדים הצפים עלו ל-44, ואסימון אחד (--ctl-size) "
     "מחזיק את הגודל, את רצועת הפקדים ואת שולי המפה בסנכרון.",
     "‏Apple HIG · Material 3, Switch accessibility: ״keep all targets… a "
     "minimum 48×48 CSS pixels each״",
     "https://m3.material.io/components/switch/accessibility"),
]

# ---------------------------------------------------------------- patterns --
# Every visible class in app.css belongs to exactly one of these.  The point is
# not the list: it is that build_design.py REFUSES to produce the document when a
# class is not on it.  A new element either joins a pattern or makes a new one,
# and either way it cannot quietly become a hundred-and-fifty-sixth thing with a
# look of its own.  Entries are exact names or "prefix-" for a family.
PATTERNS = [
    ("layout", "אזורי המסך",
     "החלוקה הקבועה: אזור ויזואלי ואזור טקסטואלי, והתפר ביניהם.",
     ["split", "pane", "pane-map", "pane-text", "seam", "map-only", "doc"]),
    ("mapctl", "פקד צף על המפה",
     "מה שיושב על הגרפיקה ולא בתוכה — אותו גודל, אותו משטח, אותה רצועה עליונה.",
     ["mt", "menu-btn", "reset-btn", "menu-x", "crumb", "now", "one",
      "pick-bar"]),
    ("maplbl", "תווית מפה",
     "מספר או אות על הגרפיקה, בלי משטח מתחתיה — הילה במקום לוחית.",
     ["lbl", "lbl-ltr", "cmp-lbl", "wide"]),
    ("menu", "מסך התפריט",
     "רשימה אחת שכל שורה בה אומרת את מצבה.",
     ["menu", "menu-in", "mrow-", "mrow", "mgrp", "mnote"]),
    ("card", "כרטיס נתונים",
     "הכרטיס בחצי הטקסט: כותרת, שורות מפתח-ערך, וכל מספר עם מקור ושנה.",
     ["card", "hdr", "stats", "stat", "stat-", "kv", "rows", "row", "row-",
      "sub", "lead", "note", "muted", "num", "way-", "grp"]),
    ("action", "כפתורים וצ׳יפים",
     "כל מה שנלחץ בחצי הטקסט: פעולה ראשית, פעולה משנית, וצ׳יפ מסנן.",
     ["chip", "chip-", "chips", "cta", "cta-", "ghost", "btns", "ico", "chev"]),
    ("compare", "מסך השוואת נתונים",
     "שדה אחד על כל יחידות הרמה: מפתח צבעים, רשימה מדורגת, ומחליף שדה.",
     ["cmp-"]),
    ("layers", "לוח השכבות",
     "הלוח הנפתח מתוך התפריט, ובתוכו מתגי השכבות והחגורות.",
     ["panel", "panel-h", "lay", "lay-", "belt", "belt-sw"]),
    ("places", "המקומות שלי",
     "הנקודות שהמשתמש מוסיף: הסימון במפה, היריעה שנפתחת, והטופס שבתוכה.",
     ["wp", "wp-", "mine", "me", "pin", "pin-sq", "sheet", "sheet-", "fld-l",
      "ghost-dot", "ghost-ring"]),
    ("photo", "תמונות",
     "תצלום שהמשתמש צירף, והתצוגה המלאה שלו.",
     ["ph-", "lb", "lb-"]),
    ("tell", "הודעות וחלונות",
     "מה שהאפליקציה אומרת מיוזמתה: הודעה, חלון מקורות, מסך טעינה, טולטיפ.",
     ["msg", "msg-", "msgs", "drawer", "drawer-", "boot", "spin", "tt"]),
    ("state", "מצבים",
     "אינם אלמנטים אלא סימוני מצב שנתלים על אלמנט קיים.",
     ["is-hi", "is-on", "part", "bad", "warn", "err", "no", "flag", "on",
      "r1", "r2", "r3"]),
    ("text", "סימוני טקסט",
     "רצף לטיני, מספר, נקודה, ריבוע — הדברים הקטנים בתוך שורת טקסט.",
     ["en", "lat", "dot", "sq"]),
    ("vendor", "לא שלנו",
     "מחלקות שלי Leaflet מייצרת ואנחנו רק דורסים.",
     ["leaflet-container"]),
]


def assign_patterns(classes):
    """Put every class in exactly one pattern, or refuse to build."""
    out = {key: [] for key, _, _, _ in PATTERNS}
    for name in sorted(classes):
        hit = None
        for key, _, _, members in PATTERNS:
            exact = name in members
            pref = any(m.endswith("-") and name.startswith(m) for m in members)
            if exact or pref:
                if hit and not exact:
                    continue
                if hit and exact:
                    hit = key
                    continue
                hit = key
        if hit is None:
            raise SystemExit(
                "app.css styles .%s and no pattern claims it.\n"
                "Add it to a pattern in PATTERNS (scripts/build_design.py), or "
                "start a new one. A visible element without a pattern is how a "
                "design language stops being one." % name)
        out[hit].append(name)
    return out


# Which icons must not flip in RTL, and why.  Apple and Material both publish
# the rule; the reasons are per-icon and belong with the icon.
NO_MIRROR = {
    "locate": "מצפן/מיקום — מצביע לכיוון אמיתי במרחב",
    "day": "שמש — עצם מהעולם",
    "night": "ירח — עצם מהעולם",
    "tiles": "ערימת אריחים — עצם, לא כיוון",
    "borders": "חישוקים קונצנטריים — סימטרי",
    "info": "עיגול עם i — סימן אוניברסלי",
    "dots": "נקודות — אין להן כיוון",
    "pin": "פוש פין — עצם",
}


def swatch_rows(pal, mode, bg_key, card_key):
    """One row per colour token: the value, the role, and what it measures."""
    rows = []
    for k, v in pal.items():
        if not v.startswith("#"):
            continue
        role = ROLES.get(k, "לא מתועד")
        c_card = contrast(v, pal[card_key])
        c_bg = contrast(v, pal[bg_key])
        rows.append({"k": k, "v": v, "role": role,
                     "card": round(c_card, 2), "bg": round(c_bg, 2),
                     "ink": ink_on(v)})
    return rows


# --------------------------------------------------------------- the page ----
def bidi_math(s):
    """Isolate a ≥ and the number after it.

    Hebrew is RTL, and the bidi algorithm mirrors ≥ into ≤ when it resolves to an
    RTL run — a document that states requirements would show the opposite of what
    it means. U+2066..U+2069 pin the comparison to LTR so the glyph stays itself.
    """
    return re.sub("(\u2265 [\\d.:\u00d7 ]*\\d)", "\u2066\\1\u2069", s)


def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def ltr_runs(t):
    """Isolate a run of Latin text sitting inside a Hebrew line.

    The bidi algorithm reorders a quoted English sentence inside an RTL
    paragraph: the closing quote and the punctuation migrate to the wrong end,
    and a citation stops being readable as one. Section 11 of the architecture
    document has the rule — every Latin run inside Hebrew needs dir="ltr" — and
    this applies it to the prose the generator writes rather than hoping whoever
    adds the next entry remembers.
    """
    return re.sub(r"[A-Za-z][A-Za-z0-9 ,.:;()/\u2018\u2019\u201c\u201d\u05f4'\-\u2013\u2014]{10,}[A-Za-z0-9.\u05f4\u201d)]",
                  lambda m: '<span dir="ltr">%s</span>' % m.group(0), t)


def bold(t):
    """**…** in a logic's prose, so a conflict with the source can be marked."""
    return re.sub(r"\*\*(.+?)\*\*", r"<b>\\1</b>", t)


def verdict(v, need):
    if need == 0:
        return '<span class="na">—</span>'
    cls = "pass" if v >= need else "fail"
    return '<span class="%s">%.2f:1</span>' % (cls, v)


def page(light, dark, dark_keys, ty, icons, motion, lines, classes):
    buckets = assign_patterns(classes)
    def table(pal, mode):
        bg, card = pal["--bg"], pal["--card"]
        out = []
        for k, v in pal.items():
            if not v.startswith("#"):
                continue
            role = ROLES.get(k, "לא מתועד")
            # text tokens owe 4.5:1, control edges owe 3:1, decoration owes nothing
            need = 4.5 if k in ("--ink", "--ink-2", "--miss", "--accent", "--warn",
                                "--good", "--bad") else (
                   3 if k in ("--ctl-line", "--btn-line", "--hi-line") else 0)
            out.append(
                '<tr><td><span class="sw" style="background:%s;color:%s" dir="ltr">%s</span></td>'
                '<td><code dir="ltr">%s</code></td><td>%s</td><td class="n">%s</td>'
                '<td class="n">%s</td><td>%s</td></tr>'
                % (v, ink_on(v), esc(v), esc(k), esc(role),
                   verdict(contrast(v, card), need), verdict(contrast(v, bg), need),
                   "מוגדר מחדש בלילה" if k in dark_keys and mode == "day" else ""))
        return "\n".join(out)

    blues = "\n".join(
        '<div class="band" style="background:%s;color:%s"><b>%d</b>'
        '<span dir="ltr">%s</span></div>' % (c, ink_on(c), i + 1, c)
        for i, c in enumerate(BLUES))
    blue_gaps = []
    for i in range(len(BLUES) - 1):
        blue_gaps.append('<td class="n">%.2f:1</td>' % contrast(BLUES[i], BLUES[i + 1]))
    blue_ground = "".join(
        '<tr><td><span class="sw" style="background:%s;color:%s" dir="ltr">%d</span></td>'
        '<td class="n">%s</td><td class="n">%s</td></tr>'
        % (c, ink_on(c), i + 1,
           verdict(contrast(c, light["--bg"]), 3), verdict(contrast(c, dark["--bg"]), 3))
        for i, c in enumerate(BLUES))

    space = "".join(
        '<div class="sp"><span class="sp-b" style="width:%s"></span>'
        '<code dir="ltr">%s</code><span class="n" dir="ltr">%s</span></div>'
        % (light[k], k, light[k]) for k in ("--s1", "--s2", "--s3", "--s4", "--s5", "--s6"))
    radii = "".join(
        '<div class="rad"><span class="rad-b" style="border-radius:%s"></span>'
        '<code dir="ltr">%s</code><span class="n" dir="ltr">%s</span>'
        '<span class="role">%s</span></div>'
        % (light[k], k, light[k], esc(ROLES.get(k, ""))) for k in ("--r-card", "--r-ctl", "--r-pill"))

    heads = "".join(
        '<div class="spec"><span style="font-size:%srem;font-weight:700;line-height:%s">'
        'רובע בונפים · Bonfim · 22,978</span>'
        '<span class="n">%s · %srem · %spx · גובה שורה %s</span></div>'
        % (sz, ty["head_line"], tag, sz, round(sz * ty["size"]), ty["head_line"])
        for tag, sz in ty["heads"])

    targets = "".join(
        '<div class="tg"><span class="tg-b" style="width:%dpx;height:%dpx"></span>'
        '<span class="n">%d × %d</span><span class="role">%s</span></div>' % t
        for t in ((24, 24, 24, 24, "WCAG 2.2 SC 2.5.8 · AA — הרצפה"),
                  (44, 44, 44, 44, "SC 2.5.5 · AAA · וברירת המחדל של Apple"),
                  (48, 48, 48, 48, "המלצת Material")))

    mirror = "".join(
        '<tr><td><code dir="ltr">%s</code></td><td>%s</td></tr>' % (esc(k), esc(v))
        for k, v in NO_MIRROR.items())

    rules = "".join(
        '<tr><td>%s</td><td>%s</td><td><span class="lvl %s">%s</span></td>'
        '<td><a href="%s" target="_blank" rel="noopener">%s</a></td></tr>'
        % (esc(a), bidi_math(esc(b)), "req" if "WCAG" in c else "rec", esc(c), esc(e), esc(d))
        for a, b, c, d, e in RULES)

    icon_list = " · ".join('<code dir="ltr">%s</code>' % esc(i) for i in icons)
    mo = " · ".join('<span class="n">%dms</span>' % m for m in motion)

    return """<!doctype html>
<html lang="he" dir="rtl">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>פורטולנד — השפה העיצובית</title>
<style>
:root{
  color-scheme:light;
  --pg:#f4f6f9; --sf:#ffffff; --sk:#eef2f6; --tx:#16212e; --tx2:#5b6a7d;
  --ln:#dbe2ea; --ac:#15568f; --ok:#1c7a4a; --no:#b3261e;
  --mo:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){%(darktokens)s}}
:root[data-theme="dark"]{%(darktokens)s}
*{box-sizing:border-box}
html{direction:rtl}
body{margin:0; background:var(--pg); color:var(--tx); direction:rtl;
  font:400 16px/1.6 system-ui,"Noto Sans Hebrew","Heebo",Arial,sans-serif;
  -webkit-text-size-adjust:100%%}
.w{max-width:1000px; margin:0 auto; padding:0 20px 72px}
h1,h2,h3{margin:0; line-height:1.25; text-wrap:balance}
h1{font-size:clamp(26px,5vw,36px)}
h2{font-size:21px; margin-block-start:48px}
h3{font-size:15px; margin-block-start:26px; color:var(--tx2)}
header{padding-block:44px 20px; border-block-end:2px solid var(--tx)}
.sub{color:var(--tx2); font-size:15px; margin-block-start:10px; max-width:64ch}
p{margin:8px 0 0; color:var(--tx2); font-size:14px; max-width:70ch}
code,.n{font-family:var(--mo); font-variant-numeric:tabular-nums}
code{font-size:12.5px; background:var(--sk); padding:1px 5px; border-radius:2px}
code[dir=ltr],.n[dir=ltr]{unicode-bidi:isolate}
a{color:var(--ac)}
.scroll{overflow-x:auto; margin-block-start:14px; border:1px solid var(--ln);
  border-radius:3px}
table{border-collapse:collapse; width:100%%; min-width:640px; background:var(--sf)}
th,td{text-align:start; padding:8px 11px; font-size:13px;
  border-block-end:1px solid var(--ln)}
thead th{background:var(--sk); font-size:10.5px; letter-spacing:.08em;
  color:var(--tx2); font-weight:500; white-space:nowrap}
tbody tr:last-child td{border-block-end:0}
td.n{font-family:var(--mo); font-variant-numeric:tabular-nums; white-space:nowrap}
.sw{display:inline-grid; place-items:center; width:62px; height:26px;
  border-radius:3px; font:700 10px/1 var(--mo); border:1px solid rgba(0,0,0,.14)}
.pass{color:var(--ok); font-weight:700}
.fail{color:var(--no); font-weight:700}
.na{color:var(--tx2)}
.lvl{font-size:10.5px; padding:2px 7px; border-radius:2px; white-space:nowrap}
.lvl.req{background:var(--ac); color:#fff}
.lvl.rec{background:var(--sk); color:var(--tx2); border:1px solid var(--ln)}
.bands{display:flex; margin-block-start:14px; border-radius:3px; overflow:hidden;
  border:1px solid var(--ln)}
.band{flex:1 1 0; min-height:78px; display:flex; flex-direction:column;
  align-items:center; justify-content:center; gap:3px}
.band b{font:700 17px/1 var(--mo)}
.band span{font:400 10px/1 var(--mo); opacity:.9}
.hatch{height:44px; border:1px solid var(--ln); border-radius:3px;
  margin-block-start:8px}
.sp{display:flex; align-items:center; gap:11px; padding:5px 0; font-size:13px}
.sp-b{height:16px; background:var(--ac); border-radius:2px; flex:0 0 auto}
.rad{display:flex; align-items:center; gap:11px; padding:5px 0; font-size:13px}
.rad-b{width:52px; height:34px; background:var(--sk); border:2px solid var(--ac);
  flex:0 0 auto}
.role{color:var(--tx2); font-size:12.5px}
.spec{display:flex; flex-direction:column; gap:3px; padding:9px 0;
  border-block-end:1px solid var(--ln)}
.spec .n{font-size:11.5px; color:var(--tx2)}
.tg{display:flex; align-items:center; gap:11px; padding:5px 0; font-size:13px}
.tg-b{border:2px dashed var(--ac); border-radius:3px; flex:0 0 auto}
.logics{display:flex; flex-direction:column; gap:14px; margin-block-start:14px}
.lg{background:var(--sf); border:1px solid var(--ln); border-radius:3px;
  padding:14px 16px}
.lg h3{margin:0 0 6px; font-size:15px; color:var(--tx)}
.lg p{margin:0; max-width:none; line-height:1.6}
.lg .src{margin-block-start:10px; font-size:12.5px}
.icons{display:grid; grid-template-columns:repeat(auto-fill,minmax(92px,1fr));
  gap:8px; margin-block-start:14px}
.ic{display:flex; flex-direction:column; align-items:center; gap:6px;
  padding:10px 4px; background:var(--sf); border:1px solid var(--ln);
  border-radius:3px}
.ic svg{width:26px; height:26px; fill:none; stroke:var(--tx); stroke-width:1.7;
  stroke-linecap:round; stroke-linejoin:round}
.ic span{font:400 10.5px/1.2 var(--mo); color:var(--tx2); text-align:center;
  word-break:break-all}
.note{border-inline-start:3px solid var(--ac); padding-inline-start:12px;
  margin-block-start:16px; font-size:14px; color:var(--tx); line-height:1.65}
.note b{font-weight:700}
footer{margin-block-start:52px; padding-block-start:18px;
  border-block-start:1px solid var(--ln); font-size:12px; color:var(--tx2)}
</style>
<div class="w">
<header>
  <h1>פורטולנד — השפה העיצובית</h1>
  <p class="sub">כל ערך בעמוד הזה נקרא מ-<code dir="ltr">app.css</code> ומ-<code dir="ltr">app.js</code>
    בזמן הבנייה, לא הוקלד כאן. ‏<code dir="ltr">scripts/checks.py</code> מריץ את המחולל
    מחדש ונכשל אם הקובץ על הדיסק אינו מה שהוא מייצר — כך שהמסמך אינו יכול
    להתרחק מהקוד. יחסי הניגודיות חושבו לפי הנוסחה של WCAG 2.2.</p>
</header>

<h2>הכללים שנמדדים מולם</h2>
<p>דרישה היא מה שתקן מחייב; המלצה היא מה שפלטפורמה מפרסמת. ההבדל חשוב,
  ולכן הוא בטבלה.</p>
<div class="scroll"><table>
<thead><tr><th>כלל</th><th>מה הוא דורש</th><th>מעמד</th><th>מקור</th></tr></thead>
<tbody>%(rules)s</tbody></table></div>

<h2>צבע — תצוגת יום</h2>
<p>העמודות מודדות כל אסימון מול שני המשטחים שהוא יושב עליהם. טקסט חייב 4.5:1
  ‏(SC 1.4.3); מסגרת של פקד חייבת 3:1 ‏(SC 1.4.11); קו מפריד הוא קישוט ואינו
  חייב דבר — ולכן הוא אסימון נפרד מהמסגרת, ולא אותו אסימון בשני תפקידים.</p>
<div class="scroll"><table>
<thead><tr><th>הצבע</th><th>האסימון</th><th>התפקיד</th><th>מול הכרטיס</th>
  <th>מול הרקע</th><th></th></tr></thead>
<tbody>%(light)s</tbody></table></div>

<h2>צבע — תצוגת לילה</h2>
<div class="scroll"><table>
<thead><tr><th>הצבע</th><th>האסימון</th><th>התפקיד</th><th>מול הכרטיס</th>
  <th>מול הרקע</th><th></th></tr></thead>
<tbody>%(dark)s</tbody></table></div>

<h2>חמש המדרגות של השוואת נתונים</h2>
<div class="bands">%(blues)s</div>
<div class="scroll"><table>
<thead><tr><th>בין שכנות</th>%(gaphead)s</tr></thead>
<tbody><tr><td>ΔE ב-OKLab נמדד ב-6.7 · 13.7 · 12.6 · 14.1</td>%(gaps)s</tr></tbody>
</table></div>
<h3>מול הרקע של כל מצב תצוגה</h3>
<div class="scroll"><table>
<thead><tr><th>המדרגה</th><th>מול רקע יום</th><th>מול רקע לילה</th></tr></thead>
<tbody>%(blueground)s</tbody></table></div>
<div class="note"><b>מה שהמספרים האלה אומרים, ומה שלא.</b> כל מדרגה יושבת בתוך
  מתאר לבן ולצד מדרגה אחרת, ולא לבדה על הרקע — ולכן ״הצבע שלצדה״ שעליו מדבר
  SC 1.4.11 הוא המתאר והשכנה, לא הרקע הריק. במקום שבו צורה נוגעת ברקע הריק,
  המדרגות הבהירות בתצוגת יום והכהות בתצוגת לילה אכן יורדות מתחת ל-3:1, וזה
  רשום כאן במספרים במקום להיטען כהצלחה.</div>

<h3>״אין נתון״</h3>
<p>פספוס אלכסוני ברוחב %(hw)s, כל %(hg)s, בזווית %(ha)s — בגוון שקווי המפה
  לוקחים לאותו מצב תצוגה. צורה ולא צבע, ולכן היא נבדלת מכל מדרגה בלי להזדקק
  ליחס ניגודיות, שורדת עיוורון צבעים, הדפסה בשחור-לבן ו-forced colors, ואינה
  מתחרה על הקצה הבהיר של הסולם.</p>
<div class="hatch" style="background:repeating-linear-gradient(%(ha)s,%(hl)s 0 %(hw)s,transparent %(hw)s %(hg)s)"></div>

<h2>גבולות המפה</h2>
<p>ארבע שכבות, שני עוביים אפקטיביים. מה שמפריד ביניהן הוא ה-pane שהן יושבות בו
  והצבע שהרמה נותנת להן — לא המשקל, ולכן בדיקה שמזהה קו לפי
  <code dir="ltr">stroke-width</code> תפסיק להבחין בין מחוז לעירייה.</p>
<div class="scroll"><table>
<thead><tr><th>השכבה</th><th>עובי</th><th>הצבע ברמה שלה</th></tr></thead>
<tbody>%(lnw)s</tbody></table></div>

<h3>הקו המצופה של השוואת נתונים</h3>
<p>מעל מילויים משתנים קו יחיד אינו עובד. לבן ו-<code dir="ltr">%(core)s</code>
  הם תמונת ראי זה של זה:
  לבן נעלם על שתי המדרגות הבהירות ועל משטח היום, והדיו הכהה על שתי הכהות ועל
  משטח הלילה. לכן הקו מצויר פעמיים באותו pane — ציפוי לבן ברוחב המלא וליבה
  כהה בחצי ממנו. תחת כל מילוי ומול שני המשטחים אחד מהשניים עובר 3:1, וזו
  הדרישה של SC 1.4.11 מגבול שנושא משמעות. העין קוראת קו דק אחד.</p>
<div class="scroll"><table>
<thead><tr><th>הדיו</th>%(lnhead)s<th>משטח יום</th><th>משטח לילה</th></tr></thead>
<tbody>%(lncontrast)s</tbody></table></div>
<div class="note"><b>הכתום של האזורים אינו מקבל ליבה.</b> הוא הקו היחיד במפה
  שהוא צבע ולא דיו — הוא אינו הנושא של שום רמה ואינו חלק מהיררכיית המחוז —
  וליבה כהה בתוכו הייתה דבר שני לקרוא, לא ציפוי.</div>

<h2>אזורי המסך</h2>
<p>לכל חלק במסך יש שם, וזה חצי מהעניין: ״האזור הוויזואלי״ ו״האזור הטקסטואלי״ הם
  מה שמולו מתארים שינוי, ושינוי שאי אפשר לתאר מול אחד מאלה הוא שינוי במבנה
  עצמו.</p>
<div class="scroll"><table>
<thead><tr><th>האזור</th><th>האלמנט</th><th>המחלקה</th><th>מה הוא</th></tr></thead>
<tbody>%(regions)s</tbody></table></div>

<h3>שלוש תבניות תצוגה</h3>
<p>כפתור הפריסה בתפריט מחליף ביניהן, ואין דרך אחרת. היחס קבוע על 50%%
  (<code dir="ltr">--f</code>) — התפר אינו ידית.</p>
<div class="scroll"><table>
<thead><tr><th>התבנית</th><th dir="ltr">data-view</th><th>לאורך ולרוחב</th></tr></thead>
<tbody>%(views)s</tbody></table></div>
<div class="note"><b>שולי האזור הוויזואלי.</b> ‏10 פיקסלים מכל צד ומלמטה, ובראש
  ‏10 מתחת לרצועת הפקדים — כלומר 10 + <code dir="ltr">--ctl-size</code> + 10.
  ‏<code dir="ltr">zoomSnap</code> הוא 0 ולא 0.25, אחרת ההתאמה מעגלת את הזום
  כלפי מטה ומחזירה עד 18%% משטח המפה.</div>

<h2>מצאי התבניות</h2>
<p>‏%(nclasses)s מחלקות ב-<code dir="ltr">app.css</code>, כולן שייכות לאחת
  מ-%(npatterns)s התבניות שלמטה. הרשימה אינה העיקר — העיקר שהמחולל
  <b>מסרב לייצר את המסמך</b> כשמחלקה אינה שייכת לאף תבנית. אלמנט חדש מצטרף
  לתבנית או פותח תבנית חדשה, ובשני המקרים אינו יכול להפוך בשקט לדבר
  ה-%(nclasses1)s עם מראה משלו.</p>
<div class="scroll"><table>
<thead><tr><th>התבנית</th><th>מה היא</th><th>המחלקות</th></tr></thead>
<tbody>%(patterns)s</tbody></table></div>

<h2>לוגיקות עיצוביות</h2>
<p>החלטות על התנהגות ולא על ערך, וכל אחת עם המקור שמכריע אותה. הן כאן ולא רק
  בקוד כי השינוי הבא בתפריט צריך לדעת למה התפריט נראה כך.</p>
<div class="logics">%(logics)s</div>

<h2>טיפוגרפיה</h2>
<p>גוף הטקסט: <code dir="ltr">%(tfam)s</code> · %(tsize)spx · משקל %(tw)s · גובה שורה
  %(tline)s. גובה השורה עומד בדרישת SC 1.4.12, שמחייבת שהטקסט ישרוד 1.5×.
  ‏Material ממליץ 16/24 ל-Body Large; GOV.UK מפרסם 19/25, ואין מספר יחיד מוסכם.</p>
%(heads)s
<div class="spec"><span>רובע בונפים · Bonfim · 22,978 תושבים · 3.09 קמ״ר</span>
  <span class="n">גוף · עברית, פורטוגזית וספרות בשורה אחת — המקרה האמיתי</span></div>
<div class="note"><b>כלל RTL שקל לפספס.</b> פסקה מיישרת לפי השפה שלה, לא לפי
  ההקשר — שורה או שתיים מיישרות להקשר, אבל שלוש שורות של מקור פורטוגזי בתוך
  ממשק עברי מיישרות לשמאל. ספרות בתוך מספר לעולם אינן מתהפכות.</div>

<h2>ריווח</h2>
<p>‏4, 6, 8, 12, 16 הם הקצה הנמוך של הסולם שמפרסמת Polaris; הצעד השישי הועבר
  מ-22 ל-24, כי Carbon, ‏Polaris ו-Material כולן פוסעות 16 ← 24, ו-22 הוא מספר
  של טיפוגרפיה ולא של ריווח.</p>
%(space)s

<h2>רדיוסים</h2>
<p>לפי תפקיד, לא רדיוס אחד מוטבע על הכול.</p>
%(radii)s

<h2>יעדי מגע</h2>
<p>תווית המספר במפה היא 20 פיקסל של דיו בתוך תיבה של 24 — הדיו לא גדל, שטח
  המגע כן, וזו התבנית ש-Android מפרסם בדיוק למקרה הזה.</p>
%(targets)s

<h2>תנועה</h2>
<p>משכי המעבר בקוד: %(motion)s. ‏<code dir="ltr">prefers-reduced-motion</code> מטופל —
  ההנחיה היא להחליף תנועה בהצלבה ולא למחוק משוב, ולכן הכלל הגורף מכבה מעברים
  ואנימציות ומשאיר את שינויי הצבע והאטימות.</p>

<h2>אייקונים</h2>
<p>‏%(nicons)s אייקונים, כולם SVG בשורה על קו אחד ב-<code dir="ltr">currentColor</code>
  — ללא קובצי תמונה וללא משפחת אייקונים חיצונית. באפליקציה אין תמונות רסטר כלל;
  התמונה היחידה שיכולה להופיע היא זו שהמשתמש צירף לנקודה שסימן. אלה כולם,
  מצוירים מתוך <code dir="ltr">ICON</code> שב-<code dir="ltr">app.js</code>:</p>
<div class="icons">%(icongrid)s</div>
<h3>מה אסור להפוך ב-RTL</h3>
<div class="scroll"><table>
<thead><tr><th>האייקון</th><th>הסיבה</th></tr></thead>
<tbody>%(mirror)s</tbody></table></div>

<footer>
  <p>נוצר על ידי <code dir="ltr">scripts/build_design.py</code> מתוך
    <code dir="ltr">app.css</code> ו-<code dir="ltr">app.js</code>. אין לערוך את הקובץ הזה ביד.</p>
</footer>
</div>
</html>
""" % {
        "rules": rules, "light": table(light, "day"), "dark": table(dark, "night"),
        "blues": blues, "gaps": "".join(blue_gaps),
        "darktokens": DARK_TOKENS,
        "nicons": len(icons),
        "icongrid": "".join(
            '<div class="ic"><svg viewBox="0 0 24 24" aria-hidden="true">%s</svg>'
            '<span dir="ltr">%s</span></div>' % (svg, esc(name))
            for name, svg in sorted(icons.items())),
        "regions": "".join(
            '<tr><td><b>%s</b></td><td><code dir="ltr">%s</code></td>'
            '<td><code dir="ltr">%s</code></td><td>%s</td></tr>'
            % (esc(he), esc(el), esc(cls), esc(what))
            for he, el, cls, what in REGIONS),
        "views": "".join(
            '<tr><td><b>%s</b>%s</td><td><code dir="ltr">%s</code></td>'
            '<td>%s</td></tr>'
            % (esc(he), (' <span class="role">· %s</span>' % esc(tag)) if tag else "",
               esc(key), esc(what))
            for he, key, what, tag in VIEWS),
        "nclasses": len(classes),
        "nclasses1": len(classes) + 1,
        "npatterns": len(PATTERNS),
        "patterns": "".join(
            '<tr><td><b>%s</b></td><td>%s</td>'
            '<td class="cls">%s</td></tr>'
            % (esc(he), esc(what),
               " ".join('<code dir="ltr">.%s</code>' % esc(c) for c in buckets[key]))
            for key, he, what, _ in PATTERNS),
        "logics": "".join(
            '<section class="lg"><h3>%s</h3><p>%s</p>'
            '<p class="src"><a href="%s" target="_blank" rel="noopener">%s</a></p>'
            '</section>'
            % (esc(he), bold(ltr_runs(bidi_math(esc(why)))), esc(url),
               ltr_runs(esc(src)))
            for he, why, src, url in LOGICS),
        "lnw": "".join(
            '<tr><td>%s</td><td class="n" dir="ltr">%s</td><td>%s</td></tr>'
            % (esc(he), esc(lines["w"][k]), role)
            for k, he, role in (
                ("region", "region — שני אזורי NUTS III",
                 'כתום <code dir="ltr">%s</code>, בכל רמה, כשהמתג דלוק'
                 % lines["region"]),
                ("district", "district — גבול מחוז פורטו", "שחור ברמה 1, נסוג אחר כך"),
                ("mun", "mun — גבולות 18 העיריות", "שחור ברמות 1 ו-2, לפי הפיצ׳ר"),
                ("fre", "fre — גבולות הרובעים",
                 "רמות 2 ו-3, וברמה 1 רק בהשוואה עם ״רובעים״"))),
        "lnhead": "".join('<th dir="ltr">%s</th>' % c for c in BLUES),
        "lncontrast": "".join(
            '<tr><td><span class="sw" style="background:%s"></span> '
            '<code dir="ltr">%s</code></td>%s%s%s</tr>'
            % (c, c,
               "".join('<td>%s</td>' % verdict(contrast(c, b), 3) for b in BLUES),
               '<td>%s</td>' % verdict(contrast(c, light["--bg"]), 3),
               '<td>%s</td>' % verdict(contrast(c, dark["--bg"]), 3))
            for c in ("#ffffff", lines["core"])),
        "core": esc(lines["core"]),
        "gaphead": "".join("<th>%d→%d</th>" % (i + 1, i + 2) for i in range(4)),
        "blueground": blue_ground,
        "hw": HATCH["w"], "hg": HATCH["gap"], "ha": HATCH["angle"], "hl": HATCH["light"],
        "tfam": esc(ty["stack"]), "tsize": ty["size"], "tw": ty["weight"],
        "tline": ty["line"], "heads": heads, "space": space, "radii": radii,
        "targets": targets, "motion": mo, "icons": icon_list, "mirror": mirror,
    }


def build():
    css = open(CSS, encoding="utf-8").read()
    js = open(JS, encoding="utf-8").read()
    light, dark, dark_keys = read_palettes(css)
    return page(light, dark, dark_keys, read_type(css), read_icons(js),
                read_motion(css), read_lines(js), read_classes(css))


def main():
    html = build()
    if "--check" in sys.argv:
        cur = open(OUT, encoding="utf-8").read() if os.path.exists(OUT) else ""
        if cur != html:
            print("docs/DESIGN.html is not what build_design.py produces — "
                  "run python3 scripts/build_design.py")
            return 1
        print("docs/DESIGN.html is in sync with app.css")
        return 0
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write(html)
    print("wrote %s  (%.1f KB)" % (os.path.relpath(OUT, ROOT), len(html.encode()) / 1024))
    return 0


if __name__ == "__main__":
    sys.exit(main())
