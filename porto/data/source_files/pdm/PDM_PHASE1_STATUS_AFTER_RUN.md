# PDM Phase 1 — verified status after successful resume

Checked: 2026-09-08

## Verified latest layer status

- Matosinhos: 89/89 selected feature layers — latest status `ok`.
- Paredes: 101/101 selected feature layers — latest status `ok`.
- Valongo — Ordenamento: 24/24 selected feature layers — latest status `ok`.
- Valongo — Condicionantes: 30/30 selected feature layers — latest status `ok`.
- Total latest completed ArcGIS feature layers across these services: 244/244 — all latest status `ok`.

## Porto

- Official municipal Soil Qualification GeoPackage downloaded successfully.
- File: `porto/porto_carta_qualificacao_solo_pdm2021.gpkg`
- Drive size observed: 139,554,816 bytes.
- The separate official CCGD WFS GetCapabilities request still returned HTTP 500. This is non-blocking for the soil-qualification GeoPackage, but the conditioning side still needs a separate source/acquisition path.

## Póvoa de Varzim

- The municipal ArcGIS service still has no completed Phase 1 layer download in the manifest.
- The recorded failure is a connection timeout at service metadata access.
- It must be retried separately rather than treated as unavailable.

## Next phase

1. Retry Póvoa de Varzim with a dedicated, slower/retry-heavy downloader.
2. Resolve and acquire official vector endpoints/files for the remaining municipalities: Amarante, Baião, Felgueiras, Gondomar, Lousada, Maia, Marco de Canaveses, Paços de Ferreira, Penafiel, Santo Tirso, Trofa, Vila do Conde and Vila Nova de Gaia.
3. Complete Porto conditioning data from an official source.
4. After all municipalities are exhausted, validate counts/CRS/source fields, create per-municipality GeoPackages without reclassification, and produce `PDM_FINAL` with detailed README, sources metadata and checksums.

## Preservation rules

No reclassification, dissolve, interpolation, inferred values, or raster-to-vector conversion. Draft/pending revisions remain excluded until legally effective.
