# פתיחת גישה לאתרי המקור

הסביבה שבה הסשן רץ קובעת לאילו אתרים אפשר לצאת. ברמת ברירת המחדל,
**Trusted**, מותרים מאגרי חבילות ו-GitHub בלבד.

`scripts/check_network.py` מדפיס בכל רגע מה נגיש ומה לא.

---

## עדכון 2026-09-07 — ההנחה שכל המקורות חסומים אינה נכונה

הסביבה שבה נכתב המסמך הזה אכן חסמה הכול. הסביבה שרצה היום לא: אחרי תיקון
שיטת הבדיקה, **16 מתוך 20 המארחים עונים** — וביניהם `www.ine.pt`, המקור
בעדיפות הראשונה בכל `DATA-REQUEST.md`. עם שיטת הבדיקה הישנה אותה סביבה בדיוק
דיווחה 10 מתוך 17.

**שתי טעויות הסתירו את זה, ושתיהן תוקנו:**

1. `check_network.py` בדק ב-`curl -I`, כלומר בבקשת HEAD. השרתים של INE עונים
   ל-HEAD בסגירת החיבור ומגישים GET כרגיל, ולכן `www.ine.pt` ו-`mapas.ine.pt`
   הופיעו כחסומים בזמן שה-API שלהם עבד. הסקריפט מבקש היום GET אמיתי, ומנסה
   שלוש פעמים כי חלק מהמארחים מפילים את ה-handshake הראשון.
2. ההנחה שאין מאגר PDM ארצי, ושצריך לחזר אחרי שמונה-עשרה גאופורטלים עירוניים.
   יש: `ogcapi.dgterritorio.gov.pt` מגישה את CAOP2025, את כל מרשם ה-SRUP
   (REN, RAN, סכנת שריפות, רשת נטורה, שטחים מוגנים) ואת CRUS — הקרטוגרפיה
   הארצית של משטר השימוש בקרקע — כ-GeoJSON, עם סינון בצד השרת.

מה שנמשך בפועל מתועד ב-`DATA-ACQUIRED.md`. מה שעדיין חסום, ולמה, מתועד שם גם כן.

**ארבעה מארחים עדיין נופלים**, ובשבילם עדיין שווה `Full` או `Custom`:
`geo2.apambiente.pt` (נדחה בפירוש במדיניות — 502 ל-CONNECT), `overpass-api.de`,
`snit.dgterritorio.gov.pt` ו-`websig.cm-amarante.pt`. שניים מהם כבר לא נדרשים:
ה-SRUP מגיע מ-`ogcapi.`, וה-PDM של אמרנטה מ-CRUS. הרשימה שלמטה נשארת נכונה —
היא פשוט כבר לא תנאי לכל משיכת נתונים, אלא רק למה שנשאר.

---

## הדרך המהירה — מהנייד

באפליקציה במובייל יש שלוש רמות בלבד: `Trusted`, `None`, `Full`. הרמה
`Custom`, שמאפשרת רשימת מארחים מדויקת, מוצעת רק בממשק המלא בדפדפן.

1. פתח סשן חדש על המאגר `lior77/book-gage`
2. במסך **Select environment** → **`Create new environment`**
3. **Name:** `Portugal data`
4. **Network access:** **`Full`**
5. **`Create`**
6. חזרה במסך בחירת הסביבה — סמן **`Portugal data`**
7. חץ ← לפתיחת הסשן

`Default` נשארת כפי שהיא, ואפשר לחזור אליה בכל רגע.

---

## הדרך המהודקת — ממחשב

אותה סביבה, אבל עם רשימת מארחים מוגדרת במקום גישה חופשית. אפשר גם לערוך כך
סביבה שכבר נוצרה מהנייד.

לפי התיעוד של Anthropic, לבורר הסביבות **אין עמוד הגדרות ואין כתובת ישירה** —
מגיעים אליו רק מתוך `claude.ai/code`:

1. פתח **[claude.ai/code](https://claude.ai/code)**
2. בשורה **מעל תיבת ההודעה** יש **אייקון ענן** עם שם הסביבה. לחץ עליו.
3. תחת **Cloud**, רחף מעל הסביבה — מימין מופיע **גלגל שיניים**. לחץ.
4. **Network access** → **`Custom`**
5. **Allowed domains** → הדבק את הרשימה שלמטה, שורה לכל מארח
6. ✅ **סמן `Also include default list of common package managers`** — בלעדיה
   נסגרים PyPI ו-npm, ולא ניתן להתקין ספריות כמו `pyproj` ו-`pyshp` שמשמשות
   לעיבוד הגאומטריה
7. שמור

**GitHub עובד בכל רמה** — הוא עובר דרך פרוקסי נפרד ולא דרך הרשימה הזו.

---

## הרשימה להדבקה

```
ine.pt
*.ine.pt
dgterritorio.gov.pt
*.dgterritorio.gov.pt
ogcapi.dgterritorio.gov.pt
dgadr.gov.pt
*.dgadr.gov.pt
apambiente.pt
*.apambiente.pt
icnf.pt
*.icnf.pt
pordata.pt
*.pordata.pt
overpass-api.de
*.overpass-api.de
*.arcgis.com
epsg.io
cm-amarante.pt
*.cm-amarante.pt
cm-baiao.pt
*.cm-baiao.pt
cm-marco-canaveses.pt
*.cm-marco-canaveses.pt
cm-gondomar.pt
*.cm-gondomar.pt
cm-maia.pt
*.cm-maia.pt
cm-matosinhos.pt
*.cm-matosinhos.pt
cm-porto.pt
*.cm-porto.pt
cm-gaia.pt
*.cm-gaia.pt
cm-valongo.pt
*.cm-valongo.pt
cm-viladoconde.pt
*.cm-viladoconde.pt
cm-pvarzim.pt
*.cm-pvarzim.pt
cm-stirso.pt
*.cm-stirso.pt
mun-trofa.pt
*.mun-trofa.pt
cm-paredes.pt
*.cm-paredes.pt
cm-penafiel.pt
*.cm-penafiel.pt
cm-pacosdeferreira.pt
*.cm-pacosdeferreira.pt
cm-lousada.pt
*.cm-lousada.pt
cm-felgueiras.pt
*.cm-felgueiras.pt
```

---

## מה כל מארח נותן

| מארח | מה מגיע ממנו | ודאות |
| --- | --- | --- |
| `*.ine.pt` | הלשכה לסטטיסטיקה — מחירי מכירה ושכירות למ״ר לפי רבעון ולפי רובע, וכל סדרות המפקד. גם `mapas.ine.pt` להורדות הגאוגרפיות | מאומת |
| `*.dgterritorio.gov.pt` | **`ogcapi.` — CAOP2025, כל מרשם ה-SRUP (REN, RAN, סכנת שריפות, נטורה 2000) ו-CRUS, הכול כ-GeoJSON עם סינון בצד השרת.** `pcgt.` הוא פורטל עיון בלבד | נמשך בפועל |
| `*.dgadr.gov.pt` | RAN — עתודת הקרקע החקלאית, Shapefile לפי NUTS III | מאומת |
| `*.apambiente.pt` | מפת אזורי ההצפה, לפי תקופות חזרה. הנתונים יושבים על `sniambgeoext.` (‏`sniamb.` הוא הפורטל בלבד), ושירותיו מחזירים 403 גם כשהוא נגיש; `geo2.` נדחה במדיניות | **לא הושג** |
| `*.icnf.pt` | מפת סכנת שריפות (perigosidade), חמש דרגות | מאומת |
| `*.arcgis.com` | חלק מהשירותים לעיל מוגשים דרך ArcGIS Online | מאומת |
| `overpass-api.de` | OpenStreetMap — הרצת שאילתות Overpass מכאן במקום ידנית ב-overpass-turbo | מאומת |
| `*.pordata.pt` | סדרות זמן ברמת עירייה — הכנסה, תעסוקה, כוח קנייה | מאומת |
| `epsg.io` | הגדרות מערכות קואורדינטות, לאימות המרות | מאומת |
| `cm-*.pt` | הגאופורטלים של 18 העיריות, ל-PDM שאינו ב-PCGT | **לא אומתו** — לפי המוסכמה הנפוצה. שורה שגויה לא מזיקה, היא פשוט לא תתאים לכלום; `check_network.py` יראה אילו נפתחו |

**הממצא המשמעותי הוא `ogcapi.dgterritorio.gov.pt`, לא PCGT.** PCGT הוא פורטל
לעיון ואין ממנו הורדת גאומטריה; ה-OGC API של DGT כן מגישה אותה. שם יושבות
CAOP2025, כל שכבות ה-SRUP, ו-CRUS — שבה לכל פוליגון יש `designacao_no_plano`,
כלומר הניסוח של תוכנית המתאר של אותה עירייה עצמה, לצד הסיווג הארצי המתואם של
DGT. זה חוסך את המסלול של שמונה-עשרה פורטלים נפרדים, ובלי לאחד מחלקות בין
עיריות — האזהרה בסעיף 7 של `DATA-REQUEST.md` נשארת בתוקף.

---

## אימות

הגדרת הרשת נקבעת כשהסשן מתחיל, ולכן שינוי לא משפיע על סשן שכבר רץ. פתח סשן
חדש והרץ בו:

```
git checkout claude/mobile-app-pdf-knowledge-aoomsp
python3 porto/scripts/check_network.py
```

הסקריפט מדפיס שורה לכל מארח — מה נפתח ומה לא. בסביבה שבה נכתב המסמך הזה
נפתח GitHub בלבד; בסביבה של 2026-09-07 נפתחים 16 מתוך 20 בלי לשנות דבר.
ראה את פסקת העדכון בראש הקובץ לפני שמסיקים מהמספר הזה משהו.

---

## מה משתנה ומה לא

**משתנה:** היום כל סבב נתונים דורש הורדה ידנית, העלאה ל-release וקליטה. אחרי
השינוי המשיכה נעשית בקוד ששמור במאגר וניתן להריץ שוב — עדכון רבעוני של מחירי
INE הופך לפקודה אחת.

**לא משתנה:** לכל שדה מספרי מקור ושנת ייחוס ב-`data/sources.json`, שדה חסר מוצג
כ״אין נתון״ ולא כאפס, וכל גזירה נבדקת מול מקור שני לפני שהיא מסומנת מאומתת.
הרשת קובעת מי מביא את הנתונים, לא איך הם נבדקים.

**ולגבי `Full`:** היא פותחת יציאה לכל האינטרנט מהסנדבוקס, ולא רק לרשימה. זו
הבחנה אמיתית ולא ניסוח. מה שנמשך בפועל נשאר המקורות הרשמיים המתועדים, וכל אחד
מהם נרשם ב-`sources.json` עם הכתובת שממנה הגיע.
