/* ============================================================================
   פסגות מתויגות בכל מחוז פורטו — אופציונלי
   ----------------------------------------------------------------------------
   מריצים ב-https://overpass-turbo.eu  →  ▶ Run  →  Export ▾  →  data → GeoJSON
   שומרים בשם  porto_peaks.geojson.

   ⚠ חשוב: זה מחזיר את הפסגות ש*מישהו תייג* ב-OSM עם ele=*, ולא את
   הנקודה הגבוהה ביותר בעירייה. הכיסוי חלקי ולא אחיד, ואין שום ערובה
   שהנקודה הגבוהה באמת תויגה. אסור להציג את זה כ"הנקודה הגבוהה ביותר".
   לנתון האמיתי צריך מודל גבהים (DEM) — ראו scripts/overpass/README.md.
   ========================================================================= */

[out:json][timeout:180];

/* מחוז פורטו כולו, admin_level=6 */
area["boundary"="administrative"]["admin_level"="6"]["name"="Porto"]->.distrito;

(
  node(area.distrito)["natural"="peak"];
  node(area.distrito)["natural"="hill"];
  nwr(area.distrito)["ele"]["name"];
);

out center;
