# רשימת האתרים לפתיחה בסביבת ההרצה

הסביבה שבה אני רץ חוסמת את כל האינטרנט חוץ מ-GitHub וממאגרי חבילות. זו הסיבה
היחידה שאני לא מושך את הנתונים לבד. אם המארחים האלה ייפתחו, כל שרשרת האיסוף
עוברת אליי ולא תצטרך להוריד ולהעלות דבר.

הרשימה להדבקה:

```
www.ine.pt
ine.pt
www.dgterritorio.gov.pt
snit.dgterritorio.gov.pt
geo2.dgterritorio.gov.pt
www.dgadr.gov.pt
sniamb.apambiente.pt
geo2.apambiente.pt
apambiente.pt
www.icnf.pt
services.arcgis.com
services2.arcgis.com
services3.arcgis.com
websig.cm-amarante.pt
cm-baiao.pt
www.cm-marco-canaveses.pt
overpass-api.de
www.pordata.pt
```

## מה כל אחד נותן

| מארח | מה מגיע ממנו |
| --- | --- |
| `www.ine.pt` | ה-API של הלשכה לסטטיסטיקה — מחירי מכירה ושכירות למ״ר לפי רבעון ולפי רובע, וכל שאר המדדים. הקובץ שכבר יש לנו הוא הורדה ידנית; ה-API הוא סדרות מלאות |
| `www.dgterritorio.gov.pt`, `snit.dgterritorio.gov.pt` | CAOP במהדורות הבאות, ו-SRUP — שירותי WFS של מגבלות ציבוריות, ובהן REN |
| `www.dgadr.gov.pt` | RAN — עתודת הקרקע החקלאית, Shapefile לפי NUTS III |
| `sniamb.apambiente.pt`, `geo2.apambiente.pt` | מפת אזורי ההצפה של הסוכנות לאיכות הסביבה, לפי תקופות חזרה |
| `www.icnf.pt` | מפת סכנת שריפות (perigosidade), חמש דרגות |
| `services*.arcgis.com` | חלק מהשירותים הנ״ל מוגשים דרך ArcGIS Online |
| `websig.cm-amarante.pt`, `cm-baiao.pt`, `www.cm-marco-canaveses.pt` | הגאופורטלים של העיריות — PDM: סיווג הקרקע ומה מותר לבנות עליה |
| `overpass-api.de` | OpenStreetMap. כרגע אתה מריץ את השאילתות ידנית ב-overpass-turbo ושולח לי את הפלט; עם המארח הזה אני מריץ אותן בעצמי |
| `www.pordata.pt` | סדרות זמן ברמת עירייה — הכנסה, תעסוקה, כוח קנייה |

## איפה משנים

מדיניות הרשת היא תכונה של **סביבת ההרצה**, ולא של הסשן הזה. יש בחשבון שלך
סביבה אחת בשם `Default — trusted network access`. את ההגדרה קובעים בממשק
הסביבות ב-claude.ai; התיעוד:

https://code.claude.com/docs/en/claude-code-on-the-web

שים לב: המדיניות נבחרת כשהסביבה נוצרת, ולכן ייתכן שהשינוי מחייב **יצירת סביבה
חדשה** ולא עריכה של הקיימת. אם כך — צור סביבה חדשה עם המארחים האלה, ופתח בה
סשן; המאגר והענף נשארים אותם.

## מה לא ישתנה גם אז

הכללים של הפרויקט לא תלויים ברשת: לכל שדה מספרי יש מקור ושנת ייחוס
ב-`data/sources.json`, שדה חסר מוצג כ״אין נתון״ ולא כאפס, ומה שאני גוזר בעצמי
נבדק מול מקור שני לפני שהוא מסומן מאומת.
