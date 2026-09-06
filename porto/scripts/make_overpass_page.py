#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build a one-page helper for running the Overpass queries by hand.

The queries live in scripts/overpass/*.overpassql and are the single source of
truth; this only wraps them, so the page can never drift from the files. Each
card gets a copy button and a link that opens overpass-turbo with the query
already loaded and running.

    python3 scripts/make_overpass_page.py -o /tmp/overpass-porto.html
"""
import argparse
import html
import os
import re
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
QDIR = os.path.join(HERE, "overpass")

QUERIES = [
    {
        "file": "04_district_places.overpassql",
        "n": "4",
        "title": "היישובים בכל 18 העיריות",
        "save_as": "district_places.geojson",
        "colour": "#1B4F8C",
        "status": "todo",
        "why": "הרמה השלישית קיימת היום רק בפורטו, כי רק שם יש נתונים מתחת לפרגזיה. "
               "השאילתה הזאת מביאה את היישובים והשכונות של כל המחוז — כפרים, "
               "עיירות ושכונות — וכל אחד מהם יקבל אות על המפה ורישום ברשימה.",
        "note": "עובדת על תיבה ולא על מזהה יחס, בכוונה: מזהה יכול להשתנות והשאילתה "
                "תחזיר שקט במקום שגיאה. התיבה בולעת גם שוליים של בראגה ואביירו, "
                "והסקריפט מסנן אותם מול פוליגוני CAOP. הסינון על place מאונדקס — קלה.",
    },
    {
        "file": "05_district_services.overpassql",
        "n": "5",
        "title": "שירותים ומוסדות בכל המחוז",
        "save_as": "district_services.geojson",
        "colour": "#2E7D32",
        "status": "todo",
        "why": "הנקודות השחורות של רמה 3, לכל 243 הפרגזיות: תחנות רכבת ומטרו, בתי "
               "חולים, אוניברסיטאות, מוזיאונים, תיאטראות וספריות, שווקים, פארקים וחופים.",
        "note": "כל הסינונים על מפתחות מאונדקסים (railway, amenity, tourism, leisure), "
                "ולכן היא רצה גם על 76 על 52 ק״מ בלי ליפול ב-timeout.",
    },
    {
        "file": "06_district_landmarks.overpassql",
        "n": "6",
        "title": "אתרי מורשת בכל המחוז",
        "save_as": "district_landmarks.geojson",
        "colour": "#6A1B9A",
        "status": "todo",
        "why": "מנזרים, כנסיות רומנסקיות, טירות, גשרים ופילוריות — מה שבאמת מסמן מקום "
               "בעמקי הטמגה והדואורו.",
        "note": "כל אובייקט חייב לשאת גם name וגם wikidata או heritage. בלי התנאי הזה "
                "יש במחוז אלפי רשומות historic שרובן פרט אדריכלי בודד, ומפה שמסמנת "
                "את כולן לא אומרת כלום. אף אחד לא בחר ידנית.",
    },
    {
        "file": "02c_matadouro.overpassql",
        "n": "2ג",
        "title": "מטדורו — האחרון שחסר",
        "save_as": "porto_matadouro.geojson",
        "colour": "#B3261E",
        "status": "done",
        "why": "חיפוש ממוקד של שכונת מטדורו בקמפניה.",
        "note": "התקבל ריק, וזו התשובה: מטדורו פשוט לא קיימת ב‑OSM. היא רשומה "
                "בקובץ כ‑not_in_osm, והאפליקציה אומרת זאת במפורש במקום לנחש מיקום. "
                "52 מתוך 53 השכונות קיבלו נקודה.",
    },
    {
        "file": "02a_porto_places.overpassql",
        "n": "2א",
        "title": "שכונות וייעודי קרקע",
        "save_as": "porto_places.geojson",
        "colour": "#2E7D32",
        "status": "done",
        "why": "אובייקטי place ו‑landuse בעיריית פורטו — מהם נקבעו מיקומי 53 השכונות.",
        "note": "התקבל: 549 אובייקטים, 339 מהם נקודות שכונה שנכנסו לאפליקציה.",
    },
    {
        "file": "02b_porto_named_streets.overpassql",
        "n": "2ב",
        "title": "רחובות בשם של שכונה",
        "save_as": "porto_streets.geojson",
        "colour": "#6A1B9A",
        "status": "done",
        "why": "שכונות שקיימות ב‑OSM רק כשם של רחוב, כמו קושטה קברל.",
        "note": "התקבל: 40 רחובות. מהם הושלמו מיקומים לשכונות שלא היו להן נקודת place.",
    },
    {
        "file": "01_porto_pois.overpassql",
        "n": "1",
        "title": "נ״צ בעיריית פורטו",
        "save_as": "porto_pois.geojson",
        "colour": "#1B4F8C",
        "status": "done",
        "why": "מטרו, רכבת, בתי חולים, אוניברסיטה, מוזיאונים, אתרי מורשת, פארקים, "
               "כיכרות וגשרים.",
        "note": "התקבל: 1,787 נקודות, 1,652 אחרי ניקוי כפילויות. 26 מתוך 30 האתרים "
                "שהמסמך מזכיר נמצאו בו.",
    },
    {
        "file": "03_district_peaks.overpassql",
        "n": "3",
        "title": "פסגות מתויגות במחוז",
        "save_as": "porto_peaks.geojson",
        "colour": "#8a5000",
        "status": "done",
        "why": "הגובה הגבוה ביותר שמתויג ב‑OSM בכל עירייה.",
        "note": "התקבל: 414 נקודות, 408 עם תג גובה. 57 נפסלו כי הגובה הוא של מבנה "
                "ולא של הקרקע (גג מלון, טורבינת רוח). זה חסם תחתון, לא הנקודה הגבוהה.",
    },
]

STATUS_HE = {"done": "התקבל ✓", "todo": "צריך להריץ", "optional": "רשות"}


def compact(q):
    """Strip comments and blank lines, for a short enough URL."""
    q = re.sub(r"/\*.*?\*/", "", q, flags=re.S)
    return "\n".join(ln.rstrip() for ln in q.splitlines() if ln.strip())


def build():
    cards = []
    for i, spec in enumerate(QUERIES):
        raw = open(os.path.join(QDIR, spec["file"]), encoding="utf-8").read().strip()
        url = ("https://overpass-turbo.eu/?Q="
               + urllib.parse.quote(compact(raw), safe="") + "&R")
        cards.append(f"""
    <article class="card {'is-done' if spec['status'] == 'done' else ''}" style="--accent:{spec['colour']}">
      <header class="card-h">
        <span class="badge">{spec['n']}</span>
        <div>
          <h2>{html.escape(spec['title'])} <span class="pill pill-{spec['status']}">{STATUS_HE[spec['status']]}</span></h2>
          <p class="why">{spec['why']}</p>
        </div>
      </header>

      <dl class="meta">
        <dt>שומרים בשם</dt><dd><code>{spec['save_as']}</code></dd>
        <dt>שימו לב</dt><dd>{spec['note']}</dd>
      </dl>

      <div class="actions">
        <a class="btn btn-go" href="{html.escape(url)}" target="_blank" rel="noopener">
          פתיחה ב‑Overpass Turbo והרצה
        </a>
        <button class="btn btn-copy" type="button" data-q="{i}">העתקת השאילתה</button>
      </div>

      <details class="code">
        <summary>הצגת הקוד</summary>
        <pre id="q{i}" dir="ltr">{html.escape(raw)}</pre>
      </details>
    </article>""")

    return TEMPLATE.replace("{{CARDS}}", "\n".join(cards))


TEMPLATE = r"""<title>שאילתות פורטו ל‑Overpass</title>
<script>document.documentElement.lang='he';document.documentElement.dir='rtl';</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;700&family=JetBrains+Mono:wght@400;500&display=swap">
<style>
:root{
  --bg:#f2f4f7; --card:#ffffff; --ink:#151a24; --ink-2:#59637a; --line:#dde2ea;
  --accent:#1B4F8C; --ok:#1c7a4a; --warn-bg:#fff6e8; --warn:#8a5000;
  --code-bg:#f7f8fb; --shadow:0 1px 2px rgba(18,26,44,.06),0 8px 24px rgba(18,26,44,.07);
}
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]){
    --bg:#0e1524; --card:#172033; --ink:#e9edf5; --ink-2:#98a3ba;
    --line:#27324a; --ok:#5fd39a; --warn-bg:#3a2c12; --warn:#ffd28a;
    --code-bg:#0f1727; --shadow:0 1px 2px rgba(0,0,0,.4),0 10px 28px rgba(0,0,0,.35);
  }
}
:root[data-theme="dark"]{
  --bg:#0e1524; --card:#172033; --ink:#e9edf5; --ink-2:#98a3ba; --line:#27324a;
  --ok:#5fd39a; --warn-bg:#3a2c12; --warn:#ffd28a; --code-bg:#0f1727;
  --shadow:0 1px 2px rgba(0,0,0,.4),0 10px 28px rgba(0,0,0,.35);
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font:400 16px/1.6 Heebo,system-ui,"Noto Sans Hebrew",Arial,sans-serif}
.wrap{max-width:760px;margin:0 auto;padding:26px 16px 56px}
h1{font-size:1.7rem;line-height:1.2;margin:0 0 6px;text-wrap:balance}
h2{font-size:1.12rem;margin:0 0 3px;text-wrap:balance}
p{margin:0 0 10px}
.lede{color:var(--ink-2);margin-bottom:22px}
code,pre{font-family:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace}
code{font-size:.86em;background:var(--code-bg);border:1px solid var(--line);
  border-radius:5px;padding:1px 5px;direction:ltr;unicode-bidi:isolate;display:inline-block}

/* the three steps, numbered because they really are a sequence */
.steps{counter-reset:s;list-style:none;margin:0 0 26px;padding:0;
  border-inline-start:2px solid var(--line);padding-inline-start:18px}
.steps li{counter-increment:s;position:relative;margin-block-end:8px;color:var(--ink-2)}
.steps li::before{content:counter(s);position:absolute;inset-inline-start:-28px;top:2px;
  width:19px;height:19px;border-radius:50%;background:var(--ink-2);color:var(--bg);
  font-size:.7rem;font-weight:700;display:grid;place-items:center}
.steps b{color:var(--ink)}

.card{background:var(--card);border:1px solid var(--line);border-radius:14px;
  padding:16px;margin-block-end:16px;box-shadow:var(--shadow);
  border-top:3px solid var(--accent)}
.card.is-done{opacity:.62}
.card-h{display:flex;gap:12px;align-items:flex-start;margin-block-end:12px}
.pill{display:inline-block;vertical-align:middle;font-size:.66rem;font-weight:500;
  padding:2px 8px;border-radius:999px;border:1px solid currentColor;white-space:nowrap}
.pill-done{color:var(--ok)} .pill-todo{color:#b3261e} .pill-optional{color:var(--ink-2)}
.badge{flex:0 0 auto;width:30px;height:30px;border-radius:9px;background:var(--accent);
  color:#fff;font-weight:700;display:grid;place-items:center;font-size:1rem}
.why{color:var(--ink-2);font-size:.93rem;margin:0}

.meta{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:0 0 14px;
  font-size:.88rem}
.meta dt{color:var(--ink-2);white-space:nowrap}
.meta dd{margin:0}

.actions{display:flex;flex-wrap:wrap;gap:9px}
.btn{flex:1 1 200px;min-height:46px;padding:11px 14px;border-radius:11px;
  font:inherit;font-weight:500;font-size:.95rem;text-align:center;cursor:pointer;
  border:1px solid var(--line);background:var(--code-bg);color:var(--ink);
  text-decoration:none;display:flex;align-items:center;justify-content:center}
.btn-go{background:var(--accent);border-color:var(--accent);color:#fff}
.btn-copy.done{background:var(--ok);border-color:var(--ok);color:#fff}
.btn:focus-visible{outline:3px solid var(--accent);outline-offset:2px}

.code{margin-block-start:12px}
.code>summary{cursor:pointer;color:var(--ink-2);font-size:.88rem;
  padding-block:6px;list-style:none}
.code>summary::-webkit-details-marker{display:none}
.code>summary::before{content:"⌄ ";}
.code[open]>summary::before{content:"⌃ ";}
pre{background:var(--code-bg);border:1px solid var(--line);border-radius:10px;
  padding:12px;margin:0;overflow-x:auto;font-size:12px;line-height:1.55;
  text-align:left;white-space:pre}

.note{background:var(--warn-bg);color:var(--warn);border:1px solid currentColor;
  border-radius:12px;padding:13px 15px;margin-block-start:26px;font-size:.92rem}
.note h2{color:inherit;font-size:1rem;margin-block-end:6px}
.note p{margin-block-end:8px}
.note p:last-child{margin:0}
.foot{color:var(--ink-2);font-size:.84rem;margin-block-start:22px}
a{color:var(--accent)}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style>

<div class="wrap">
  <h1>שאילתות Overpass למחוז פורטו</h1>
  <p class="lede">חמש השאילתות הראשונות כבר רצו והקבצים נקלטו — הן נשארות כאן
    לתיעוד. שלוש החדשות שבראש הן מה שצריך עכשיו: הן פותחות את הרמה השלישית
    לכל 18 העיריות, ולא רק לפורטו.</p>

  <ol class="steps">
    <li><b>פתיחה ב‑Overpass Turbo והרצה</b> — הכפתור הכחול פותח את האתר עם
      השאילתה כבר בפנים והיא רצה לבד. אם משהו לא נטען, אפשר להעתיק ולהדביק ידנית.</li>
    <li>כשהריצה נגמרת: <b>Export ▾ → data → download as GeoJSON</b></li>
    <li>לשמור בשם שכתוב בכרטיס ולהחזיר לי את הקובץ.</li>
  </ol>

{{CARDS}}

  <div class="note">
    <h2>שני דברים ש‑Overpass לא ייתן</h2>
    <p><b>אחוז שטח בנוי.</b> יש ב‑OSM ייעודי קרקע ובניינים, אבל המיפוי התנדבותי
      ולא אחיד — היחס שיוצא הוא חסם תחתון עם שגיאה לא ידועה, לא סטטיסטיקה.
      המקור הנכון: COS של DGT, או Imperviousness Density של Copernicus.</p>
    <p><b>גובה מעל פני הים.</b> ל‑OSM אין מודל גבהים; יש תג גובה על נקודות
      בודדות בלבד. המקור הנכון: DEM — Copernicus GLO‑30 או SRTM. שווה לדעת
      מראש שהמינימום כמעט תמיד יהיה 0, כי חמש העיריות נוגעות בים.</p>
  </div>

  <p class="foot">הנתונים שיחזרו הם © OpenStreetMap contributors, ברישיון ODbL.</p>
</div>

<script>
document.querySelectorAll('.btn-copy').forEach(function (btn) {
  btn.addEventListener('click', async function () {
    var text = document.getElementById('q' + btn.dataset.q).textContent;
    var ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch (e) {
      // clipboard API needs a secure context and permission; fall back
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      document.body.removeChild(ta);
    }
    var was = btn.textContent;
    if (ok) {
      btn.textContent = 'הועתק ✓';
      btn.classList.add('done');
    } else {
      // nothing to apologise for - just open the code so it can be selected
      btn.textContent = 'לא הצלחתי להעתיק — הקוד נפתח למטה';
      btn.closest('.card').querySelector('.code').open = true;
    }
    setTimeout(function () {
      btn.textContent = was;
      btn.classList.remove('done');
    }, 2200);
  });
});
</script>
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-o", "--out", required=True)
    args = ap.parse_args()
    page = build()
    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write(page)
    print("wrote %s  (%.1f KB)" % (args.out, os.path.getsize(args.out) / 1024))


if __name__ == "__main__":
    main()
