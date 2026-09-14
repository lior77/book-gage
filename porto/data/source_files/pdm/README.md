# PDM_RAW — working source inventory

## Purpose

This folder is the working area for collecting the legally effective **Plano Diretor Municipal (PDM)** data for the 18 target municipalities in Porto district.

The final objective is to preserve the original municipal zoning / land-use classes and the official planning constraints without harmonizing or reclassifying them.

## Target municipalities

Amarante, Baião, Felgueiras, Gondomar, Lousada, Maia, Marco de Canaveses, Matosinhos, Paços de Ferreira, Paredes, Penafiel, Porto, Póvoa de Varzim, Santo Tirso, Trofa, Valongo, Vila do Conde, Vila Nova de Gaia.

## Data sought for every municipality

Primary:
- Planta de Ordenamento / Classificação e Qualificação do Solo
- Planta de Condicionantes

Also retained when officially published as vector data:
- programming/execution units;
- safeguards and risk layers;
- ecological structure;
- heritage;
- road/transport structure;
- acoustic zoning;
- other official PDM cartographic components.

Legal documents:
- regulation in force;
- Diário da República publication / notice;
- later effective alterations/adaptations/corrections.

## Collection rules

1. Official source data only.
2. Original municipal classes and fields are preserved.
3. No class normalization.
4. No inferred values.
5. No raster-to-vector conversion.
6. A revision under preparation, consultation or local approval is not treated as effective until the legal publication makes it effective.
7. If only WMS, interactive map, or PDF is available and no official vector endpoint/file can be obtained, the vector item is marked unavailable.
8. The national harmonized CRUS product may be retained only as a secondary reference; it does not replace original PDM zoning.
9. Each downloaded source will receive SHA-256, retrieval date, source URL, service/API call, CRS, feature count and legal-version note.

## Source-discovery status — 2026-09-08

### Official vector services already identified

- **Matosinhos** — official municipal ArcGIS REST directory; PDM services are being enumerated.
- **Paredes** — official PDM 2024 ArcGIS REST service identified.
- **Póvoa de Varzim** — official municipal ArcGIS REST PDM service identified. Ordering/conditioning layers expose vector queries and EPSG:3763.
- **Valongo** — official PDM2024 ArcGIS REST services identified for classification/qualification, execution, safeguards, risks, mobility and conditioning.
- **Porto** — official PDM/open-data services found; exact WFS layer endpoints are being validated.

### Official geoportals found; underlying vector endpoint still being resolved

Amarante, Baião, Felgueiras, Lousada, Paços de Ferreira, Penafiel, Santo Tirso, Trofa and Vila Nova de Gaia.

### Official PDM documentation found; vector endpoint still being resolved

Gondomar, Maia, Marco de Canaveses and Vila do Conde.

## Important legal-version notes

- **Paços de Ferreira:** municipal PDM page distinguishes the plan in force from the revision in progress.
- **Penafiel:** a simplified alteration procedure was in public consultation in 2026; it is not treated as effective unless formally published.
- **Santo Tirso:** the newer revision reported in 2026 is not used until its legal effectiveness is confirmed.
- **Felgueiras:** an alteration procedure still in progress is not used as final PDM data.
- **Marco de Canaveses / Vila do Conde:** revision work does not replace the existing legally effective PDM until publication.

## Files currently expected during collection

- `pdm_source_inventory.json` — working inventory of official sources and acquisition status.
- Raw service descriptions / capabilities / schemas where available.
- Raw vector files or raw API/WFS/REST responses by municipality.
- Official regulation and legal-publication documents when downloadable.

## Final output plan

After source acquisition and validation a separate `PDM_FINAL` folder will contain:
- GeoPackage files with the original source classes;
- `sources_pdm.json`;
- detailed `README.md`;
- SHA-256 checksums;
- official legal/regulation documents that can be retained;
- an explicit unavailable-items section for municipalities/layers lacking an official vector source.

## Current limitation

This is a **working source-discovery inventory**, not a completed PDM dataset. No municipality should be considered complete until its legally effective cartographic version and vector source have both been verified.
