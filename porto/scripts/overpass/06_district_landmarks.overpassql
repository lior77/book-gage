/* ============================================================================
   6 · אתרי מורשת בכל 18 העיריות
   ----------------------------------------------------------------------------
   שומרים בשם  district_landmarks.geojson  ומחזירים לי.

   הסינון כאן מכוון: כל אובייקט חייב לשאת גם ["name"] וגם ["wikidata"] או
   ["heritage"]. בלי התנאי הזה ב-OSM יש במחוז אלפי רשומות historic=* שרובן
   פרט אדריכלי בודד — כתובת מגולפת, מזוזת דלת — ומפה שמסמנת את כולן היא מפה
   שלא אומרת כלום. עם התנאי נשארים המנזרים, הכנסיות הרומנסקיות, הגשרים,
   הטירות והפילוריות שבאמת מסמנים מקום. אף אחד לא בחר אותם ידנית.
   ========================================================================= */

[out:json][timeout:180][bbox:40.991,-8.799,41.482,-7.866];

(
  nwr["historic"]["name"]["wikidata"];
  nwr["historic"]["name"]["heritage"];
  nwr["tourism"="attraction"]["name"]["wikidata"];
  nwr["amenity"="place_of_worship"]["name"]["wikidata"];
  nwr["amenity"="place_of_worship"]["name"]["heritage"];
  nwr["man_made"="bridge"]["name"]["wikidata"];
  nwr["historic"="castle"]["name"];
  nwr["historic"="monastery"]["name"];
  nwr["building"="monastery"]["name"];
);

out center;
