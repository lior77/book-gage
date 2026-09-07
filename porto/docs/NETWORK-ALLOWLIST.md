# פתיחת גישה לאתרי המקור

הסביבה שבה הסשן רץ קובעת לאילו אתרים אפשר לצאת. ברמת ברירת המחדל,
**Trusted**, מותרים מאגרי חבילות ו-GitHub בלבד — וכל אתרי המקור הפורטוגזיים
חסומים. זו הסיבה היחידה שהנתונים מגיעים בהורדה ידנית ולא נמשכים כאן.

`scripts/check_network.py` מדפיס בכל רגע מה נגיש ומה לא.

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
| `*.dgterritorio.gov.pt` | CAOP במהדורות הבאות; SNIT/SRUP ובו REN; **PCGT** — הפלטפורמה הארצית לתוכניות מתאר, שמרכזת PDM של כל העיריות במקום אחד | מאומת |
| `*.dgadr.gov.pt` | RAN — עתודת הקרקע החקלאית, Shapefile לפי NUTS III | מאומת |
| `*.apambiente.pt` | מפת אזורי ההצפה, לפי תקופות חזרה | מאומת |
| `*.icnf.pt` | מפת סכנת שריפות (perigosidade), חמש דרגות | מאומת |
| `*.arcgis.com` | חלק מהשירותים לעיל מוגשים דרך ArcGIS Online | מאומת |
| `overpass-api.de` | OpenStreetMap — הרצת שאילתות Overpass מכאן במקום ידנית ב-overpass-turbo | מאומת |
| `*.pordata.pt` | סדרות זמן ברמת עירייה — הכנסה, תעסוקה, כוח קנייה | מאומת |
| `epsg.io` | הגדרות מערכות קואורדינטות, לאימות המרות | מאומת |
| `cm-*.pt` | הגאופורטלים של 18 העיריות, ל-PDM שאינו ב-PCGT | **לא אומתו** — לפי המוסכמה הנפוצה. שורה שגויה לא מזיקה, היא פשוט לא תתאים לכלום; `check_network.py` יראה אילו נפתחו |

**PCGT היא הממצא המשמעותי.** בניגוד להנחה שאין מאגר PDM ארצי,
`pcgt.dgterritorio.gov.pt` מרכזת את תוכניות המתאר של כל העיריות. אם יש בה
גאומטריה, היא חוסכת את המסלול של שמונה-עשרה פורטלים נפרדים.

---

## אימות

הגדרת הרשת נקבעת כשהסשן מתחיל, ולכן שינוי לא משפיע על סשן שכבר רץ. פתח סשן
חדש והרץ בו:

```
git checkout claude/mobile-app-pdf-knowledge-aoomsp
python3 porto/scripts/check_network.py
```

הסקריפט מדפיס שורה לכל אחד מ-17 המארחים — מה נפתח ומה לא. לפני השינוי הוא
מדפיס 1 מתוך 17, ואותו אחד הוא GitHub.

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
