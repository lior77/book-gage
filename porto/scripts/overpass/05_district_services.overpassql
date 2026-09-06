/* ============================================================================
   5 · שירותים ומוסדות בכל 18 העיריות
   ----------------------------------------------------------------------------
   שומרים בשם  district_services.geojson  ומחזירים לי.

   תחנות רכבת ומטרו, בתי חולים, אוניברסיטאות, מוזיאונים, תיאטראות וספריות,
   שווקים, פארקים וחופים — הנקודות השחורות ברמה 3, לכל פרגזיה במחוז.

   כל הסינונים כאן הם על מפתח מאונדקס (railway, amenity, tourism, leisure,
   natural), ולכן Overpass לא סורק את כל אובייקטי התיבה. זו הסיבה שהשאילתה
   הזאת רצה גם על שטח של 76 על 52 ק״מ.
   ========================================================================= */

[out:json][timeout:180][bbox:40.991,-8.799,41.482,-7.866];

(
  /* ---------- תחבורה מסילתית ---------- */
  nwr["railway"="station"]["name"];
  nwr["railway"="halt"]["name"];
  nwr["station"]["name"];                      /* subway / light_rail */

  /* ---------- בריאות ---------- */
  nwr["amenity"="hospital"]["name"];
  nwr["healthcare"="hospital"]["name"];

  /* ---------- השכלה גבוהה ---------- */
  nwr["amenity"="university"]["name"];
  nwr["amenity"="college"]["name"];

  /* ---------- תרבות ---------- */
  nwr["tourism"="museum"]["name"];
  nwr["tourism"="gallery"]["name"];
  nwr["amenity"="theatre"]["name"];
  nwr["amenity"="library"]["name"];
  nwr["amenity"="arts_centre"]["name"];

  /* ---------- מנהל ומסחר ---------- */
  nwr["amenity"="townhall"]["name"];
  nwr["amenity"="marketplace"]["name"];

  /* ---------- שטחים פתוחים ---------- */
  nwr["leisure"="park"]["name"];
  nwr["natural"="beach"]["name"];
  nwr["tourism"="viewpoint"]["name"];
);

out center;
