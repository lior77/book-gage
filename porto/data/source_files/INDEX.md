# הקבצים שנשלחו לפרויקט

כל מסמך וכל ייצוא ששלחת מתחילת השיחה, במקור ובלי שינוי. הסביבה שבה אני עובד
נמחקת בכל הפעלה, ולכן קובץ ששמור רק שם הולך לאיבוד — מה שכאן נמצא במאגר git
וישרוד. הקבצים המעובדים שהאפליקציה קוראת יושבים ב-`data/raw/`; כאן שמור
המקור, כדי שתמיד אפשר יהיה לבנות הכל מחדש מאפס ולבדוק מה בדיוק הגיע.

סך הכל 34 קבצים, 86.3 MB.


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
| `Lugares2021_variaveis.csv` | 445 B | 2026-09-07 | מילון המשתנים של קובץ ה-Lugares — אוכלוסייה, בניינים, דירות ומשקי בית לכל יישוב, עם קוד וקוד רובע. **קובץ הנתונים עצמו (`C21_LUGF_PT.gpkg`) עדיין לא הגיע — ההעלאה נכשלה.** |

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

## טביעות אצבע

`md5` של כל קובץ, כדי שאפשר יהיה לוודא שקובץ לא הוחלף או נפגם:

```
90a4efdd04d54ed08abb2636e6b332c4  app/porto_projeto.zip
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
f993d0fb2af09e0de14f1a7ce4b7d347  ine/Censos2021_resumo.xls
ec2df63c589d7501e14b79e0cbf430cc  ine/Censos2021_csv.zip
0f5de8ce0fbf286920179a296538350e  ine/Censos2021_anexo1.pdf
147defdc75c3d2ea3610424a300a5bc3  ine/Censos2021_anexo2.pdf
36a3822ceb47cb812cc54007f079975c  ine/Censos2021_infografia_populacao.pdf
2b84f97c36611648be0f48eae80ec56e  ine/Censos2021_infografia_habitacao.pdf
65b89a34f5cb1982dda4edb644cd5aa9  ine/Censos2021_infografia_familias.pdf
acb4a6263a0d23a5c9306410922b1c5f  ine/FS2021_SeccaoTot.zip
8a9161106b75a92e2e7fd74022584c32  ine/FS2021_Seccao_variaveis.txt
1c2b954512fc8b98f7b5b88fd0f92ade  ine/FS2021_Seccao_variaveis.pdf
a89e4d5888f9f93e94fdf692309d9694  ine/GRID1K21_PORTUGAL.zip
6c6a7c4c97dc840db831d0513ca0d25d  ine/GRID1K21_variaveis.txt
90a8dedc82798ba26f695f0f6dd8e2fb  screenshots/01_ine_produtos.jpg
39b115b9a32630edd4f3d4742832ae6a  screenshots/02_ine_search.jpg
51b9030993b0a8286afc90ad40f4b01f  screenshots/03_ine_downloads.jpg
786ee74148f7182403442c3be56ccde5  screenshots/04_location_permission.jpg
cab24c704b4b8b2a1882174704c79a8a  screenshots/05_app_layout.jpg
c87172131ce62e0b3c28cde70dfad9f0  screenshots/06_app_layout.jpg
ef3388d539d01f7b619aba8eca8aef9c  app/porto-standalone-1.1.html
f350578a4a0307040fa7701322e8e13b  ine/Lugares2021_variaveis.csv
```
