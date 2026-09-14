# הקבצים שנשלחו לפרויקט

כל מסמך וכל ייצוא ששלחת מתחילת השיחה, במקור ובלי שינוי. הסביבה שבה אני עובד
נמחקת בכל הפעלה, ולכן קובץ ששמור רק שם הולך לאיבוד — מה שכאן נמצא במאגר git
וישרוד. הקבצים המעובדים שהאפליקציה קוראת יושבים ב-`data/raw/`; כאן שמור
המקור, כדי שתמיד אפשר יהיה לבנות הכל מחדש מאפס ולבדוק מה בדיוק הגיע.

סך הכל 63 קבצים, 88.2 MB.


## INE — מפקד 2021

קבצים מהלשכה המרכזית לסטטיסטיקה של פורטוגל.

| קובץ | גודל | התקבל | מה זה |
| --- | ---: | --- | --- |
| `Censos2021_resumo.xls` | 163 KB | 2026-09-06 | מפקד 2021 — טבלת סיכום. ברמת NUTS II בלבד, ולכן לא שימושית לרמת עירייה או רובע. |
| `Censos2021_csv.zip` | 30 KB | 2026-09-06 | אותו סיכום כ-CSV (Q01–Q45). גם הוא NUTS II. |
| `Censos2021_anexo1.pdf` | 12.3 MB | 2026-09-06 | נספח 1 לפרסום התוצאות הסופיות של מפקד 2021. |
| `Censos2021_anexo2.pdf` | 15.8 MB | 2026-09-06 | נספח 2 לפרסום התוצאות הסופיות של מפקד 2021. |
| `Censos2021_infografia_populacao.pdf` | 3.8 MB | 2026-09-06 | אינפוגרפיקה — אוכלוסייה. |
| `Censos2021_infografia_habitacao.pdf` | 2.7 MB | 2026-09-06 | אינפוגרפיקה — דיור. |
| `Censos2021_infografia_familias.pdf` | 2.9 MB | 2026-09-06 | אינפוגרפיקה — משקי בית וגרעינים משפחתיים. |
| `FS2021_SeccaoTot.zip` | 13.4 MB | 2026-09-07 | **הקובץ המרכזי.** Ficheiro Síntese por Secção — מפקד 2021 ל-308 העיריות, 3,092 הרובעים ו-10,401 המקטעים הסטטיסטיים של פורטוגל, 179 משתנים, לפי קוד DICOFRE. |
| `FS2021_Seccao_variaveis.txt` | 15 KB | 2026-09-07 | מילון 179 המשתנים של קובץ המקטעים. |
| `FS2021_Seccao_variaveis.pdf` | 57 KB | 2026-09-07 | אותו מילון כ-PDF. |
| `GRID1K21_PORTUGAL.zip` | 11.3 MB | 2026-09-07 | רשת של קילומטר על קילומטר לכל פורטוגל (GeoPackage), 33 משתנים ממפקד 2021. |
| `GRID1K21_variaveis.txt` | 2 KB | 2026-09-07 | מילון 33 המשתנים של קובץ הרשת. |
| `Lugares2021_variaveis.csv` | 445 B | 2026-09-07 | מילון המשתנים של קובץ ה-Lugares — אוכלוסייה, בניינים, דירות ומשקי בית לכל יישוב, עם קוד וקוד רובע. **קובץ הנתונים עצמו אינו כאן**, אבל אותר ואומת ב-2026-09-14: `mapas.ine.pt/download/filesGPG/2021localitiesFregs/C21_LUGF_PT.zip`, ‏60,842,705 בתים — בדיוק הגודל של העותק שב-SharePoint ‏`גדול/`. לא הוכנס ל-git (61MB של כיסוי ארצי כשהאפליקציה צריכה מחוז 13). |
| `BGRI2021_to_CAOP2025_reassignment.csv` | 7 KB | 2026-09-07 | טבלת המרה: לאיזה רובע 2025 עבר כל תת-מקטע סטטיסטי של מפקד 2021, וכמה תושבים עברו איתו. ממנה מגיע פילוח האוכלוסייה של 25 היחידות שפורקו. |
| `Portugal_Property_Baseline_v2.csv` | 1.1 MB | 2026-09-07 | 3,049 רובעים על מפת 2025 עם גיל, הזדקנות, אזרחות, השכלה, אבטלה ובניינים — נגזר מתת-המקטעים בדרך אחרת. משמש כמקור שני לאימות, לא כמקור הנתונים עצמם (scripts/crosscheck_baseline.py). |

## ייצואים מ-overpass-turbo

פלט של השאילתות ב-scripts/overpass/. השמות כאן הם לפי מספר השאילתה, לא לפי שם ההורדה.

| קובץ | גודל | התקבל | מה זה |
| --- | ---: | --- | --- |
| `export_02_porto_pois.geojson` | 1.4 MB | 2026-09-05 | שאילתה 01 — אתרים ומוסדות בתוך העיר פורטו. נמצא גם ב-data/raw/osm_porto_pois.geojson. |
| `export_03_district_elevation.geojson` | 352 KB | 2026-09-05 | שאילתה 03 — כל מה שמתויג בגובה במחוז. נמצא גם ב-data/raw/osm_district_ele.geojson. |
| `export_04_matadouro.geojson` | 0 KB | 2026-09-06 | שאילתה 02c — בית המטבחיים ההיסטורי של פורטו. נמצא גם ב-data/raw/porto_matadouro.geojson. |
| `export_05_porto_places.geojson` | 287 KB | 2026-09-06 | שאילתה 02a — נקודות place בתוך פורטו. נמצא גם ב-data/raw/porto_places.geojson. |
| `export_06_porto_streets.geojson` | 20 KB | 2026-09-06 | שאילתה 02b — רחובות פורטו. נמצא גם ב-data/raw/porto_streets.geojson. |
| `export_07_heritage_superseded.geojson` | 1.4 MB | 2026-09-06 | הרצה מוקדמת של שאילתה 01 (מורשת ומבנים). הוחלפה על ידי export_02 ולא בשימוש. |
| `export_08_elevation_superseded.geojson` | 352 KB | 2026-09-06 | הרצה מוקדמת של שאילתה 03 (גבהים). הוחלפה על ידי export_03 ולא בשימוש. |
| `export_09_district_places.geojson` | 1.5 MB | 2026-09-06 | שאילתה 04 — יישובים ושכונות בכל המחוז, הבסיס לרמה 3. data/raw/district_places.geojson. |
| `export_10_district_services.geojson` | 955 KB | 2026-09-06 | שאילתה 05 — שירותים ומוסדות בכל המחוז. data/raw/district_services.geojson. |
| `export_11_district_landmarks.geojson` | 554 KB | 2026-09-06 | שאילתה 06 — אתרים ונקודות ציון בכל המחוז. data/raw/district_landmarks.geojson. |
| `export_12_district_water.geojson` | 3.0 MB | 2026-09-06 | שאילתה 07 — נהרות, נחלים ומאגרים. data/raw/district_water.geojson. |
| `export_13_district_green.geojson` | 8.6 MB | 2026-09-06 | שאילתה 08 — שטחים ירוקים. נקלט בזמנו, ושכבת הירוק בוטלה ב-1.3 לבקשתך; הקובץ נשמר. |
| `export_14_freguesia_codes.geojson` | 347 KB | 2026-09-06 | שאילתה 09 — קודי ref:ine של הרובעים. ממנו הגיעו הקודים הרשמיים. data/raw/freguesia_codes.geojson. |

## הפרויקט עצמו

מה שנשלח מהאפליקציה או אליה.

| קובץ | גודל | התקבל | מה זה |
| --- | ---: | --- | --- |
| `porto_projeto.zip` | 757 KB | 2026-09-05 | המסמך המקורי והקוד שממנו התחיל הפרויקט, כפי שנשלח בהודעה הראשונה. |
| `porto-standalone-1.1.html` | 1.8 MB | 2026-09-06 | גרסת הקובץ הבודד שהורדת לנייד, כפי שנשלחה חזרה לבדיקה. |

## צילומי מסך

צילומים ששלחת במהלך העבודה, נשמרים כתיעוד של מה שנראה על המסך באותו רגע.

| קובץ | גודל | התקבל | מה זה |
| --- | ---: | --- | --- |
| `01_ine_produtos.jpg` | 411 KB | 2026-09-06 | צילום מסך — תפריט Produtos באתר censos.ine.pt שלא הגיב. |
| `02_ine_search.jpg` | 167 KB | 2026-09-06 | צילום מסך — תוצאות חיפוש באתר INE. |
| `03_ine_downloads.jpg` | 315 KB | 2026-09-06 | צילום מסך — עמוד ההורדות של INE. |
| `04_location_permission.jpg` | 311 KB | 2026-09-06 | צילום מסך — הרשאת מיקום בכרום על הנייד. |
| `05_app_layout.jpg` | 845 KB | 2026-09-06 | צילום מסך — האפליקציה בנייד, בדיווח על בעיות עיצוב. |
| `06_app_layout.jpg` | 277 KB | 2026-09-06 | צילום מסך — האפליקציה בנייד, באותו דיווח. |

## מה קיים ב-SharePoint וטרם הגיע

> **עדכון 2026-09-07:** הפריט בדחיפות ראשונה כבר לא נדרש — CAOP2025 נמשך
> ישירות מ-`ogcapi.dgterritorio.gov.pt`. שאר הפריטים עדיין רלוונטיים, כי הם
> קבצי INE של מפקד 2021 ברזולוציות שאין להן API. שווה לבדוק מול
> `mapas.ine.pt`, שנגיש מכאן — הבדיקה הקודמת דיווחה עליו כחסום בטעות.

התיקייה `sites/lioravital/DocLib1/Portoland/גדול` (808 MB) מכילה את הקבצים
הבאים. אני רואה את רשימת התיקייה דרך מחבר Microsoft 365 וקורא ממנה מסמכי טקסט,
אבל ארכיונים בינאריים בסדרי הגודל האלה לא יכולים לעבור דרך המחבר, וגישה ישירה
ל-sharepoint.com חסומה במדיניות הרשת של הסביבה. הדרך שכן עובדת: להעלות אותם
כ-assets לשחרור (release) במאגר הזה — משם אני מוריד ב-curl.

| קובץ | גודל | למה הוא חשוב | דחיפות |
| --- | ---: | --- | --- |
| ~~`CAOP_Continente_2025-gpkg.zip`~~ | 111.6 MB | **כבר לא נדרש.** הגבולות נמשכו ישירות מה-OGC API של DGT — `data/raw/dgt/caop_freguesias.geojson`, 275 רובעים עם DICOFRE. ראה `docs/DATA-ACQUIRED.md` | — |
| `C21_LUGF_PT.zip` | 60.8 MB | שכבת היישובים (lugares) עם אוכלוסייה, בניינים ודירות לכל יישוב — 1,771 היישובים ברמה 3 יקבלו מספרים רשמיים | שנייה |
| `FS2021SubSeccaoTot.zip` | 44.5 MB | מפקד 2021 ברמת תת-מקטע, הרזולוציה הדקה ביותר; מאפשר לסכם כל גבול חדש | שלישית |
| `C2021_SECCOES_PT.zip` | 67.6 MB | הגאומטריה של המקטעים הסטטיסטיים | רביעית |
| `LUGARES21_PORTUGAL.zip` | 61.6 MB | ככל הנראה חופף ל-C21_LUGF_PT | לבדיקה |
| `Portugal_Property_Baseline_v2.gpkg` | 55.3 MB | אותו קובץ בסיס שכבר יש כ-CSV, בתוספת גאומטריה | נמוכה |
| `portugal2021.zip` | 258.6 MB | כנראה חבילה כוללת של כל הנ״ל | לא נדרש בנפרד |

## טביעות אצבע

`md5` של כל קובץ, כדי שאפשר יהיה לוודא שקובץ לא הוחלף או נפגם:


## ‏DGT ו-DGADR — מגבלות הבנייה (REN ו-RAN)

יובאו מ-SharePoint ‏`GPT/` ב-2026-09-14. אלה הראיה מאחורי אחוזי מגבלות הבנייה
שהאפליקציה מציגה, ומאחורי ה״אין נתון״ של פורטו ושל ווילה דו קונדה.

| קובץ | גודל | מה זה |
| --- | ---: | --- |
| `dgt/sources_ren.json` | 103 KB | פרוור­נס ברזולוציה של קריאה בודדת: 36 קריאות WFS עם URL, ספירה, DTCC וגודל, ו-SHA-256 לכל תשובה. |
| `dgt/ren_download_manifest.json` | 61 KB | מניפסט ההורדה של אותן 36 הקריאות. **עם זה אפשר לשחזר את ה-REN הגולמי מהשירות החי ולאמת בית-בית.** |
| `dgt/REN_FINAL_README.md` | 11 KB | התהליך, החוקים לכל עירייה, שתי אנומליות גאומטריה שנשמרו בכוונה, ואזהרת DGT שהווקטור אינו מחליף את המפה שפורסמה ב-Diário da República. |
| `dgt/sources_ran.json` | 29 KB | פרוורננס ל-17 העיריות + ה-gpkg, ו**ההסבר של DGADR עצמו** למה שחסר. |
| `dgt/README_RAN.md` | 14 KB | 26 קובצי RAN עם SHA-256 — 17 במחוז ו-9 מחוצה לו. |
| `dgt/dgt_ren_norte_wfs_capabilities.xml` | 18 KB | ‏GetCapabilities המקורי. הורד מחדש מהשירות החי ב-2026-09-14 וחזר **בדיוק 18,494 בתים**. |
| `dgt/dgt_ren_norte_schema_ren.xsd`, `dgt/dgt_ren_norte_schema_linhas_agua.xsd` | 10 KB | ‏DescribeFeatureType המקוריים. |

## ‏APA — זונות שיטפון

| קובץ | גודל | מה זה |
| --- | ---: | --- |
| `apa/sources_apa.json` | 2 KB | מקור, הגדרה מקורית ו-SHA-256. |
| `apa/apa_zonas_inundaveis_metadata_original.xml` | 28 KB | מטא-דאטה ISO. **נלקח מתוך ההורדה הרשמית עצמה**, לא מ-SharePoint. |
| `apa/README_APA.md` | 1 KB | פילוח שלושת מחזורי החזרה: ‏T0020=47, T0100=63, T1000=47. |

> **האפליקציה אינה משתמשת בשיטפונות.** ‏`layers_manifest.json` מכיל `ren`
> ו-`ran` בלבד. החומר כאן הוא ראיה למה שנבדק, לא נתון שמוצג.

## ‏ICNF — סכנת שריפה

| קובץ | גודל | מה זה |
| --- | ---: | --- |
| `icnf/icnf_perigosidade_wfs_capabilities.xml` | 23 KB | שש מחלקות הסכנה כפי שהשירות מגדיר אותן. הורד מחדש מהשירות החי וחזר **בדיוק 23,202 בתים**. |
| `icnf/icnf_perigosidade_evidence.json` | 4 KB | תמצית רשומת SNIG, עם כל עובדה שההחלטה נשענת עליה, וחמש הכתובות שנבדקו חיות. |

> **‏★ ממצא שעשוי לפתוח מחדש החלטה סגורה.** האפליקציה דוחה את סכנת השריפה
> כי `serv_data` הוא תאריך החוק ולא שנת המפה, ובלי שנת ייחוס הנתון נופל בכלל
> הראשון. ‏`icnf_perigosidade_evidence.json` מראה שהשירות של ICNF נקרא
> **`perigosidade_estrutural_2020_2030`** ושרשומת SNIG נוקבת בתאריך יצירה
> ‏2022-03-28. **לא פעלתי על זה** — אם שם שירות ותאריך יצירה מספיקים ככלל
> הראשון היא שאלה על המוצר, לא על הנתון.

## ‏PDM — תוכניות המתאר

| קובץ | גודל | מה זה |
| --- | ---: | --- |
| `pdm/pdm_register_merged.json` | — | **שני חצאי העבודה, ממוזגים.** 18 עיריות; 4 עם בדיקה עמוקה מ-`porto_pdm_claude/` (2 `VERIFIED_VECTOR`), 5 עם גרסה חוקית מאומתת, 5 עם מצב איסוף. |
| `pdm/pdm_source_inventory.json`, `pdm/pdm_source_inventory_v2.json` | 16 KB | הרישום המקורי: פורטל ומצב לכל אחת מ-18. |
| `pdm/pdm_legal_status_updates_2026-09-08.json` | 2 KB | חמש גרסאות חוקיות מאומתות מול Diário da República. |
| `pdm/PDM_PHASE1_STATUS.md`, `pdm/PDM_PHASE1_STATUS_AFTER_RUN.md`, `pdm/README.md` | 8 KB | מה נאסף, מה נכשל ומה חייב ניסיון חוזר. |

> **הווקטורים עצמם אינם כאן ואינם ב-SharePoint** — הם ב-Google Drive,
> ‏`עבור got/PDM_RAW`: ‏244 שכבות, ועוד gpkg של פורטו בגודל 139,554,816 בתים.
> ‏**המיזוג מאשר אפס חפיפה** בין שני החצאים.

---

# ‏★ החומר ב-SharePoint — מה קרה לכל פריט

**‏https://lioravital.sharepoint.com/sites/lioravital/DocLib1/Portoland**

נבדק פריט-פריט ב-2026-09-14. לכל פריט אחד משלושה מצבים:

- **במאגר** — הקובץ כאן. מחיקת SharePoint אינה מאבדת דבר.
- **ניתן להורדה מחדש** — לא כאן, אבל המקור הרשמי נבדק **חי היום** והכתובת למטה.
  היכן שכתוב ״גודל תואם״, ההורדה החוזרת החזירה **בדיוק** את גודל העותק שב-SharePoint.
- **★ ייאבד** — אין מקור חי ואינו במאגר. **אלה הפריטים שמונעים מחיקה.**

## ‏GPT/

| פריט | מצב |
|---|---|
| ‏`sources_ren.json`, `sources_ran.json`, `ren_download_manifest.json`, שני ה-README, ‏2 XSD | **במאגר** |
| ‏`sources_apa.json`, `sources_ine.json`, `README_APA.md`, `README_INE.md` | **במאגר** |
| ‏`apa_zonas_inundaveis_metadata_original.xml` | **במאגר** (מתוך ההורדה הרשמית, גודל תואם) |
| ‏`icnf_perigosidade_wfs_capabilities.xml` | **במאגר** (הורד מחדש, גודל תואם) |
| ‏`icnf_perigosidade_metadata_original.html` | **ניתן להורדה מחדש** — רשומת SNIG `97ff884a-b0a8-41a7-865f-129b88110988`, נבדקה 200. התמצית ב-`icnf/icnf_perigosidade_evidence.json` |
| כל ‏`PDM_RAW/` פרט ל-notebooks | **במאגר** |
| ‏`ine_precos_venda.csv`, `ine_rendas.csv` | **במאגר, בגרסה טובה יותר** — 72,618 ו-15,950 שורות מול 9,282 ו-2,975 |
| ‏`ine_*_metadata_raw.json` | **במאגר** — הורדו מ-INE ב-228,193 וב-155,503 בתים, **גודל תואם** |
| ‏`ine_raw_quarters/` ‏(52 קבצים, 17MB) | **ניתן להורדה מחדש** — `pindica.jsp?varcd=…&Dim1=<רבעון>`, נבדק 200. הקלט ל-CSV שכבר במאגר עם sha256 |
| ‏`REN_RAW/` ‏(36 GeoJSON, 46MB), `dgt_ren.gpkg` | **ניתן לשחזור ולאימות** — ‏WFS נבדק חי (18,494 בתים), ו-`ren_download_manifest.json` שבמאגר מחזיק את 36 הכתובות ואת ה-SHA-256 של כל תשובה |
| ‏`apa_zonas_inundaveis.gpkg` + `_package.zip` | **ניתן להורדה מחדש** — הורדתי את המקור במלואו: 12,139,476 בתים, כל חבר עובר CRC, **157 מצולעים PolygonZ ב-EPSG:3763**, בדיוק כמתואר |
| ‏`RAN_RAW/` ‏(26 zip, 10MB), `dgadr_ran.gpkg` | ⚠️ **חלקית.** עמוד DGADR נבדק חי, וכל 26 ה-SHA-256 במאגר — אבל הקישורים הישירים לא תועדו, וההורדה שם עוברת טופס. שחזור אפשרי, לא אוטומטי |
| ‏**4 ה-notebooks של PDM** ‏(79KB) | ★ **ייאבד.** מוגשים כ-`application/octet-stream` והמחבר דוחה אותם. אין להם מקור אחר |

## ‏גדול/

| פריט | מצב |
|---|---|
| ‏`CAOP_Continente_2025-gpkg.zip` ‏(112MB) | **ניתן להורדה מחדש** — `https://geo2.dgterritorio.gov.pt/caop/CAOP_Continente_2025-gpkg.zip`, **גודל תואם**. ובנוסף האוספים `municipios`/`freguesias` חיים ב-OGC API |
| ‏`FS2021SeccaoTot.zip` | **במאגר**, וגם ניתן להורדה מחדש, גודל תואם |
| ‏`FS2021SubSeccaoTot.zip` ‏(45MB) | **ניתן להורדה מחדש** — `mapas.ine.pt/download/2021FicheiroSintese/FS2021SubSeccaoTot.zip`, גודל תואם |
| ‏`C21_LUGF_PT.zip` ‏(61MB) | **ניתן להורדה מחדש** — `mapas.ine.pt/download/filesGPG/2021localitiesFregs/C21_LUGF_PT.zip`, **גודל תואם**. ‏★ זה הקובץ שהמסמך הזה תיעד כ״לא הגיע — ההעלאה נכשלה״ |
| ‏`LUGARES21_PORTUGAL.zip` ‏(62MB) | **ניתן להורדה מחדש** — `…/filesGPG/2021localities/LUGARES21_PORTUGAL.zip`, גודל תואם |
| ‏`GRID1K21_PORTUGAL.zip` | **במאגר**, וגם ניתן להורדה מחדש, גודל תואם |
| ‏`BGRI2021_to_CAOP2025_reassignment.csv`, `C2021_FSINTESE_VARIAVEIS*`, `Portugal_Property_Baseline_v2.csv` | **במאגר** (בשמות אחרים — ראה הטבלאות למעלה) |
| ‏`Portugal_Property_Baseline_v2.gpkg` ‏(55MB) | ⚠️ **תוצר נגזר, לא מקור רשמי.** ה-CSV במאגר ומשמש ב-`crosscheck_baseline.py`. ה-gpkg אינו ניתן להורדה משום מקום |
| ‏`portugal2021.zip` ‏(259MB), `C2021_SECCOES_PT.zip` ‏(68MB) | ⚠️ **לא אותרה כתובת.** ‏`BGRI21_CONT.zip` ב-INE הוא 246,754,080 בתים — **לא** אותו גודל. ייתכן שאלה שמות מקומיים לקבצים שכן קיימים שם, אבל לא אימתתי |

## מה זה אומר בפועל

**‏`GPT/`** — הכול חוץ מארבעת ה-notebooks. אם תעתיק אותם ידנית (או תוותר
עליהם), אפשר למחוק.

**‏`גדול/`** — שישה מתוך תשעה אומתו כניתנים להורדה מחדש בגודל מדויק. שלושה לא:
‏`Portugal_Property_Baseline_v2.gpkg` שהוא תוצר נגזר, ושני קובצי המפקד הגדולים
שלא אותרה להם כתובת.

**‏`RAN_RAW`** — ה-SHA-256 של כל 26 הקבצים כאן, כך שאפשר לאמת הורדה חוזרת;
אבל ההורדה עצמה מ-DGADR ידנית.

```
969764db854fcac1881b2e5629835187  apa/README_APA.md
93553f3482bf6678ed9311684c439d30  apa/apa_zonas_inundaveis_metadata_original.xml
e692c26392aceeb6579ca0cdde79de81  apa/sources_apa.json
ef3388d539d01f7b619aba8eca8aef9c  app/porto-standalone-1.1.html
90a4efdd04d54ed08abb2636e6b332c4  app/porto_projeto.zip
34012fb11f7bfbf97f4464a826a571a7  dgt/README_RAN.md
9671220c5da1d6a422a774f8c0bf60d6  dgt/REN_FINAL_README.md
81f5dbd8785788cb621dd9de100716af  dgt/dgt_ren_norte_schema_linhas_agua.xsd
6a00f49b565fc06fc8d4b1f5fe5ada02  dgt/dgt_ren_norte_schema_ren.xsd
c3ac2b00bf550341a68b5d6f8de6ead8  dgt/dgt_ren_norte_wfs_capabilities.xml
00743fe3aa7f21027e14dfc06f1ee1ad  dgt/ren_download_manifest.json
126fad270100036395c3a7ed60640b61  dgt/sources_ran.json
903ee366e2fcbd2925e76bdb21a95a3b  dgt/sources_ren.json
8a6c9961b75b7e93c3d39289e953161a  icnf/icnf_perigosidade_evidence.json
4aa06d5ef0393c7c178412011ffbd551  icnf/icnf_perigosidade_wfs_capabilities.xml
3dd0c77568c66d4b2ff9084b294b47a5  ine/BGRI2021_to_CAOP2025_reassignment.csv
0f5de8ce0fbf286920179a296538350e  ine/Censos2021_anexo1.pdf
147defdc75c3d2ea3610424a300a5bc3  ine/Censos2021_anexo2.pdf
ec2df63c589d7501e14b79e0cbf430cc  ine/Censos2021_csv.zip
65b89a34f5cb1982dda4edb644cd5aa9  ine/Censos2021_infografia_familias.pdf
2b84f97c36611648be0f48eae80ec56e  ine/Censos2021_infografia_habitacao.pdf
36a3822ceb47cb812cc54007f079975c  ine/Censos2021_infografia_populacao.pdf
f993d0fb2af09e0de14f1a7ce4b7d347  ine/Censos2021_resumo.xls
acb4a6263a0d23a5c9306410922b1c5f  ine/FS2021_SeccaoTot.zip
1c2b954512fc8b98f7b5b88fd0f92ade  ine/FS2021_Seccao_variaveis.pdf
8a9161106b75a92e2e7fd74022584c32  ine/FS2021_Seccao_variaveis.txt
a89e4d5888f9f93e94fdf692309d9694  ine/GRID1K21_PORTUGAL.zip
6c6a7c4c97dc840db831d0513ca0d25d  ine/GRID1K21_variaveis.txt
f350578a4a0307040fa7701322e8e13b  ine/Lugares2021_variaveis.csv
5f60326de997bd12d8e2369c43fae677  ine/Portugal_Property_Baseline_v2.csv
e9ea133f39adc9dd79f1d3fe09880115  ine/README_INE.md
649f9c23eeab7f04aa1d8e7f544211cd  ine/ine_0012234_geo_availability.json
c16c4764a4d2708068d8149c7bb4a16d  ine/ine_0012234_metadata_raw.json
649f9c23eeab7f04aa1d8e7f544211cd  ine/ine_0014696_geo_availability.json
4bfd0c1416ab5187a16e1acadb04cdc7  ine/ine_0014696_metadata_raw.json
8c6df5e8d175cea3bfb52961bebc64bd  ine/sources_ine.json
8eee285699cd7be57134e4712acd8e82  overpass/export_02_porto_pois.geojson
3cb257840ea41afee9b9a38c66b155f4  overpass/export_03_district_elevation.geojson
42f3d4f3e2fcf0eaff38a8da70ee74ec  overpass/export_04_matadouro.geojson
c06f247f6c0200e6c53e56c4817781ad  overpass/export_05_porto_places.geojson
49d195de870c3e96dff38895a619f6f9  overpass/export_06_porto_streets.geojson
46086d81d72ffc6c6e844c98073989ec  overpass/export_07_heritage_superseded.geojson
8ed4ebd33a1e468a6d51369804a8fe69  overpass/export_08_elevation_superseded.geojson
9d9d6a0c85d0e49d23fbc3e022a29234  overpass/export_09_district_places.geojson
8e5e043ef5fbcb08ecf4155ce4283270  overpass/export_10_district_services.geojson
2b3d5306aa32b24b145de1f32bc0e232  overpass/export_11_district_landmarks.geojson
40858e4be840f8ee2fca9e6499635139  overpass/export_12_district_water.geojson
93731dcfedd6318fd3fb556910b34813  overpass/export_13_district_green.geojson
5a9f5e6c92b17d40f3dc87e5027b06eb  overpass/export_14_freguesia_codes.geojson
87a67227256f613b7986cb9613651b20  pdm/PDM_PHASE1_STATUS.md
c608bb568eeb0c096e8242e3318fcfc1  pdm/PDM_PHASE1_STATUS_AFTER_RUN.md
b91dacda194e85e3e4bdc3d1dc29624e  pdm/README.md
68ed4579bcb764ced2e545a68b7fbaf1  pdm/pdm_legal_status_updates_2026-09-08.json
c3bced7e083780999662d95a00329309  pdm/pdm_register_merged.json
542876e8e6737450c4eae822157e46e7  pdm/pdm_source_inventory.json
56cb6138f0ed949df909a4576c1e87f0  pdm/pdm_source_inventory_v2.json
90a8dedc82798ba26f695f0f6dd8e2fb  screenshots/01_ine_produtos.jpg
39b115b9a32630edd4f3d4742832ae6a  screenshots/02_ine_search.jpg
51b9030993b0a8286afc90ad40f4b01f  screenshots/03_ine_downloads.jpg
786ee74148f7182403442c3be56ccde5  screenshots/04_location_permission.jpg
cab24c704b4b8b2a1882174704c79a8a  screenshots/05_app_layout.jpg
c87172131ce62e0b3c28cde70dfad9f0  screenshots/06_app_layout.jpg
```
