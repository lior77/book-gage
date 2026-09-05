/* ============================================================================
   שמונה השכונות שאין להן נקודה בייצוא ה-OSM הקיים
   ----------------------------------------------------------------------------
   מריצים ב-https://overpass-turbo.eu  →  ▶ Run  →  Export ▾  →  data → GeoJSON
   שומרים בשם  porto_bairros_extra.geojson  ומחזירים לי.

   השמונה הן: Heroísmo, Campo 24 de Agosto, Matadouro, Costa Cabral,
   Salgueiros, Carvalhido, Parque da Cidade, Praia do Molhe / Ourigo.
   הן קיימות ב-OSM — רק לא כ-place=neighbourhood: חלקן תחנת מטרו, חלקן
   כיכר, פארק או חוף. השאילתה מחפשת אותן לפי שם בכל סוג של אובייקט.

   השאילתה סורקת כל אובייקט בעל שם בתוך העירייה, ולכן איטית יותר מהראשונה.
   אם היא נכשלת ב-timeout: להריץ אותה בשני חצאים — לחצות את הרשימה שבשורת
   ה-regex לשתי הרצות נפרדות.
   ========================================================================= */

[out:json][timeout:300];

area(3603372453)->.porto;
/* area["boundary"="administrative"]["admin_level"="7"]["name"="Porto"]->.porto; */

(
  nwr(area.porto)["name"~"^(Heroísmo|Campo 24 de Agosto|Matadouro|Costa Cabral|Salgueiros|Carvalhido|Parque da Cidade|Molhe|Ourigo)",i];
  nwr(area.porto)["name"~"(Praia do Molhe|Foz Velha|Bom Sucesso|Fernão de Magalhães|Estação de Campanhã)",i];
);

out center;
