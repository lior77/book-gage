/* ============================================================================
   נ"צ בעיריית פורטו — מטרו, רכבת, בתי חולים, אוניברסיטה, מוזיאונים, אתרים
   ----------------------------------------------------------------------------
   מריצים ב-https://overpass-turbo.eu  →  ▶ Run  →  Export ▾  →  data → GeoJSON
   שומרים בשם  porto_pois.geojson  ומחזירים לי.

   הפלט הוא נקודה אחת לכל אתר (out center) — קטן ומהיר. שם, קטגוריה
   וקואורדינטה, בלי גיאומטריה מלאה.
   ========================================================================= */

[out:json][timeout:300];

/* עיריית פורטו לפי מזהה היחס ב-OSM (relation 3372453, admin_level=7).
   אם המזהה השתנה — למחוק את השורה הבאה ולהפעיל במקומה את השורה שמתחתיה. */
area(3603372453)->.porto;
/* area["boundary"="administrative"]["admin_level"="7"]["name"="Porto"]->.porto; */

(
  /* ---------- תחבורה מסילתית: מטרו ורכבת ---------- */
  nwr(area.porto)["railway"="station"];
  nwr(area.porto)["railway"="halt"];
  nwr(area.porto)["station"];                       /* subway / light_rail */
  nwr(area.porto)["public_transport"="station"];

  /* ---------- בריאות ---------- */
  nwr(area.porto)["amenity"="hospital"];
  nwr(area.porto)["healthcare"="hospital"];

  /* ---------- השכלה גבוהה ---------- */
  nwr(area.porto)["amenity"="university"];
  nwr(area.porto)["amenity"="college"];
  nwr(area.porto)["building"="university"]["name"];

  /* ---------- תרבות ---------- */
  nwr(area.porto)["tourism"="museum"];
  nwr(area.porto)["tourism"="gallery"]["name"];
  nwr(area.porto)["amenity"="theatre"]["name"];
  nwr(area.porto)["amenity"="arts_centre"]["name"];
  nwr(area.porto)["amenity"="library"]["name"];

  /* ---------- מורשת, תיירות ונקודות תצפית ---------- */
  nwr(area.porto)["tourism"="attraction"]["name"];
  nwr(area.porto)["tourism"="viewpoint"]["name"];
  nwr(area.porto)["historic"]["name"];
  nwr(area.porto)["heritage"]["name"];
  nwr(area.porto)["amenity"="place_of_worship"]["name"]["wikidata"];

  /* ---------- מנהל ומסחר ---------- */
  nwr(area.porto)["amenity"="townhall"];
  nwr(area.porto)["amenity"="marketplace"]["name"];

  /* ---------- שטחים פתוחים, כיכרות וגשרים ---------- */
  nwr(area.porto)["leisure"="park"]["name"];
  nwr(area.porto)["leisure"="garden"]["name"];
  nwr(area.porto)["natural"="beach"]["name"];
  nwr(area.porto)["place"="square"]["name"];
  nwr(area.porto)["man_made"="bridge"]["name"];
  nwr(area.porto)["bridge"="yes"]["name"];
);

out center;
