# פתיחת גישה לאתרי המקור

הסביבה שבה אני רץ נמצאת ברמת **Trusted**, שמתירה מאגרי חבילות ו-GitHub בלבד.
כל אתרי המקור הפורטוגזיים חסומים, וזו הסיבה היחידה שאני לא מושך את הנתונים
בעצמי. `scripts/check_network.py` בודק מה נגיש ומה לא.

הרמה שצריך היא **Custom**, ואת רשימת המארחים מדביקים בשדה **Allowed domains**.

---

## מה בדיוק לעשות

לפי התיעוד של Anthropic, לבורר הסביבות **אין עמוד הגדרות ואין כתובת ישירה** —
מגיעים אליו רק מתוך `claude.ai/code`:

1. פתח **[claude.ai/code](https://claude.ai/code)**
2. בשורה **מעל תיבת ההודעה** יש **אייקון ענן** עם שם הסביבה הנוכחית — `Default`.
   לחץ עליו.
3. בתפריט שנפתח, תחת **Cloud**, רחף מעל `Default` — מימין מופיע **גלגל שיניים**.
   לחץ עליו. (זו עריכה של הסביבה הקיימת; אין צורך ליצור חדשה.)
4. בחלון שנפתח, בשדה **Network access**, החלף מ-`Trusted` ל-**`Custom`**.
5. בשדה **Allowed domains** שנפתח — הדבק את הרשימה שלמטה, שורה לכל מארח.
6. **סמן את התיבה `Also include default list of common package managers`.**
   בלעדיה נסגרים PyPI ו-npm, ואני לא אוכל להתקין ספריות כמו `pyproj` ו-`pyshp`
   שאני משתמש בהן לעיבוד הגאומטריה.
7. שמור.

**GitHub ימשיך לעבוד בכל מקרה** — הוא עובר דרך פרוקסי נפרד ולא דרך הרשימה הזו.

### אחרי השמירה

הגדרת הרשת נקבעת כשהסשן מתחיל. **פתח סשן חדש** על אותו מאגר ואותו ענף
(`claude/mobile-app-pdf-knowledge-aoomsp`) — הכול דחוף ל-GitHub, שום עבודה
לא הולכת לאיבוד. בסשן החדש הרץ:

```
python3 porto/scripts/check_network.py
```

והוא ידפיס שורה לכל מארח: מה נפתח ומה לא.

---

## הרשימה להדבקה

```
ine.pt
*.ine.pt
dgterritorio.gov.pt
*.dgterritorio.gov.pt
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

## מה כל אחד נותן

| מארח | מה מגיע ממנו | ודאות |
| --- | --- | --- |
| `*.ine.pt` | הלשכה לסטטיסטיקה — מחירי מכירה ושכירות למ״ר לפי רבעון ולפי רובע, וכל סדרות המפקד. גם `mapas.ine.pt` להורדות הגאוגרפיות | מאומת |
| `*.dgterritorio.gov.pt` | CAOP במהדורות הבאות; SNIT/SRUP ובו REN; **PCGT** — הפלטפורמה הארצית לתוכניות מתאר, שמרכזת PDM של כל העיריות במקום אחד | מאומת |
| `*.dgadr.gov.pt` | RAN — עתודת הקרקע החקלאית, Shapefile לפי NUTS III | מאומת |
| `*.apambiente.pt` | מפת אזורי ההצפה, לפי תקופות חזרה | מאומת |
| `*.icnf.pt` | מפת סכנת שריפות (perigosidade), חמש דרגות | מאומת |
| `*.arcgis.com` | חלק מהשירותים לעיל מוגשים דרך ArcGIS Online | מאומת |
| `overpass-api.de` | OpenStreetMap. כיום אתה מריץ את השאילתות ידנית ב-overpass-turbo ושולח לי את הפלט; עם המארח הזה אני מריץ אותן בעצמי | מאומת |
| `*.pordata.pt` | סדרות זמן ברמת עירייה — הכנסה, תעסוקה, כוח קנייה | מאומת |
| `epsg.io` | הגדרות מערכות קואורדינטות, לאימות המרות | מאומת |
| `cm-*.pt` | הגאופורטלים של 18 העיריות, ל-PDM שאינו ב-PCGT | **הדומיינים לא אומתו** — הם לפי המוסכמה הנפוצה. שורה שגויה לא מזיקה, היא פשוט לא תתאים לכלום; `check_network.py` יראה אילו נפתחו באמת |

**PCGT היא החדשה כאן.** בניגוד להנחה שאין מאגר PDM ארצי, `pcgt.dgterritorio.gov.pt`
מרכזת את תוכניות המתאר של כל העיריות. אם היא מספקת גאומטריה, היא חוסכת את
המסלול של שמונה-עשרה פורטלים נפרדים.

---

## מה זה משנה בפועל

היום: אתה מוריד ידנית, מעלה ל-release, ואני קולט. זה עובד — 746 MB עברו ככה
בשניות — אבל כל סבב דורש אותך.

אחרי השינוי: אני מושך בעצמי, בקוד שנשמר במאגר ואפשר להריץ שוב. עדכון רבעוני
של מחירי INE הופך לפקודה אחת במקום לסבב הורדות.

**מה שלא ישתנה:** לכל שדה מספרי יש מקור ושנת ייחוס ב-`data/sources.json`, שדה
חסר מוצג כ״אין נתון״ ולא כאפס, ומה שאני גוזר נבדק מול מקור שני לפני שהוא מסומן
מאומת. הרשת משנה מי מביא את הנתונים, לא איך הם נבדקים.
