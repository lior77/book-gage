# README — DGADR Reserva Agrícola Nacional (RAN)

## Purpose

This folder preserves the **original municipal RAN vector ZIP files** manually downloaded from the official DGADR website. The ZIP files are raw source material and have not been clipped, dissolved, reprojected, simplified, normalized, or otherwise altered.

## Official source

- **Dataset / theme:** Reserva Agrícola Nacional (RAN) — municipal vector downloads (Shape files, Portugal Continental, grouped by NUTS III).
- **Source organization:** DGADR — Direção-Geral de Agricultura e Desenvolvimento Rural, Portugal.
- **Official source page:** https://www.dgadr.gov.pt/pt/cartografia/reserva-agricola-nacional
- **Retrieval method:** manual download from DGADR jDownloads municipality entries after accepting the site conditions; files were then uploaded to this Google Drive folder.
- **Retrieval / Drive upload date:** 2026-09-07. Exact per-file source publication dates are not inferred.
- **Important DGADR availability note:** "A informação em falta corresponde a municípios que não dispõem de RAN em formato vetorial ou em validação pela DGADR."
- **Licence / reuse terms:** not recorded here because the exact licence text was not independently verified. Do not infer a licence from this README.

## Verified technical characteristics

- **ZIP files currently in `RAN_RAW`:** 26
- **CRS:** EPSG:3763 — ETRS89 / Portugal TM06 (verified in every stored ZIP).
- **Encoding:** UTF-8 (verified in every stored ZIP).
- **Feature count:** 1 feature per municipal shapefile (verified in every stored ZIP).
- **Geometry:** the stored feature is a 3D MultiPolygon (`MultiPolygon Z`) in the inspected files; the Shapefile driver declares `Polygon Z`.
- **Common attribute fields, preserved exactly:** `OBJECTID_1`, `ID`, `SERVIDÃO`, `CONCELHO`, `DINÂMICA`, `AUTOR`, `RIGOR`, `DATA`, `AREA_HA`, `Shape_Leng`, `Shape_Area`.
- **Typical ZIP components:** `.shp`, `.dbf`, `.shx`, `.prj`, `.cpg`, metadata XML and, in some archives, additional shapefile index files. Exact members remain inside each original ZIP.
- **No calculated values were written back to the source files.** Values shown below are read directly from the single source feature in each archive; SHA-256 is the only derived integrity value.

### Meaning of date columns in this README

- **Retrieved:** 2026-09-07 = date the files were manually obtained/uploaded for this project.
- **`DATA` (source):** verbatim value from the DGADR shapefile attribute `DATA`. It may represent the underlying delimitation/revision/planning dataset date; this README does **not** relabel it as a publication or download date.

## Project coverage

- **Target municipalities:** 18 municipalities in the Porto district project.
- **Target RAN ZIPs present:** 17 of 18.
- **Target missing:** **Porto** (`RAN_Porto.zip`). No downloadable Porto ZIP was present in the three Área Metropolitana do Porto jDownloads pages reviewed on 2026-09-07. DGADR states generally that missing information corresponds to municipalities without vector RAN or whose information is under DGADR validation.
- **Extra raw municipalities:** 9 ZIPs outside the 18-municipality project scope are retained as unmodified raw source material and should not be included in the final 18-municipality GeoPackage unless the project scope is expanded.

## File inventory

All values below are raw source attributes except `size_bytes` and `sha256`. `Project` is this project's own scope label, not a DGADR field.

| file | NUTS III group | Project | CONCELHO | DINÂMICA | AUTOR | RIGOR | DATA (source) | AREA_HA | features | geometry | CRS | size_bytes | sha256 |
|---|---|---|---|---|---|---|---|---:|---:|---|---|---:|---|
| RAN_Amarante.zip | Tâmega e Sousa | TARGET | AMARANTE | Aprovação PU | CM Vetor | 1/10000 | 2026/04/17 | 5643.25307889 | 1 | MultiPolygon Z | EPSG:3763 | 731093 | dbe50b63362feb8ed9c526e1dfb59afb305a96c117f72f86aeef136710c1be68 |
| RAN_Baiao.zip | Tâmega e Sousa | TARGET | BAIÃO | Revisão | CM_Vetor | 1/10000 | 2025/07/17 | 4609.18653213 | 1 | MultiPolygon Z | EPSG:3763 | 738659 | 474358b8f7f8800be3c59e7c9b6963434e85056bf5af3caf568751179d889528 |
| RAN_Castelo_Paiva.zip | Tâmega e Sousa | EXTRA | CASTELO DE PAIVA | 3ª Correção Material | CM Vetor | 1/10000 | 2026/07/13 | 1661.62179495 | 1 | MultiPolygon Z | EPSG:3763 | 354087 | ecf9ae304f7b23ff57276aa35949c85dcf77acd940d22bd1714e3ff754cec8cb |
| RAN_Celorico_Basto.zip | Tâmega e Sousa | EXTRA | CELORICO DE BASTO | Revisão | CM_Vetor | 1/25000 | 2025/06/05 | 3849.46587417 | 1 | MultiPolygon Z | EPSG:3763 | 714382 | 78bc4a9da6141409f4a7f841ddc583509aa6f57765c725703391bd42b234fb23 |
| RAN_Cinfaes.zip | Tâmega e Sousa | EXTRA | CINFÃES | Revisão | CM_Vetor | 1/25000 | 2020/08/08 00:00:00.000 | 2208.58096062 | 1 | MultiPolygon Z | EPSG:3763 | 321023 | 54c508be79a9c5cc344942030fd4852f076cf476b7666a29acd28bc4ef1f88e0 |
| RAN_Felgueiras.zip | Tâmega e Sousa | TARGET | FELGUEIRAS | Revisão | CM_Vetor_2021 | 1/10000 | 2022/06/07 00:00:00.000 | 4662.10916998 | 1 | MultiPolygon Z | EPSG:3763 | 573890 | 98e85a6a8c67e6eadf38a747eef75e8b9d8400509257e1444a1a2636ed7d6fd8 |
| RAN_Lousada.zip | Tâmega e Sousa | TARGET | LOUSADA | Revisão | CM_Vetor | 1/25000 | 2020/08/08 00:00:00.000 | 2521.40061098 | 1 | MultiPolygon Z | EPSG:3763 | 128532 | f4008ada2420d86742b82f7a4b757bcc85d637bf958894e1ce6698acc03856f6 |
| RAN_Marco_Canaveses.zip | Tâmega e Sousa | TARGET | MARCO DE CANAVESES | Revisão | CM_Vetor_2015 | 1/10000 | 2015/06/08 00:00:00.000 | 6296.27805218 | 1 | MultiPolygon Z | EPSG:3763 | 463873 | 26e92044c1e0db920ea249edda25e5ece210063ae41874b769f5622aca30f532 |
| RAN_Pacos_Ferreira.zip | Tâmega e Sousa | TARGET | PAÇOS DE FERREIRA | Revisão | CM_Vetor | 1/10000 | 2019/03/08 00:00:00.000 | 1461.58259858 | 1 | MultiPolygon Z | EPSG:3763 | 94305 | 10554ca5ef04ce045568df2b26cf90f4fbb921e6435303a389f856f446472ede |
| RAN_Penafiel.zip | Tâmega e Sousa | TARGET | PENAFIEL | Revisão | CM_Vetor | 1/10000 | 2019/03/08 00:00:00.000 | 3399.09276144 | 1 | MultiPolygon Z | EPSG:3763 | 207338 | 4a46dcedf80a264576e8ddeadc28c2aee661031954bd8092dd41987b423d8742 |
| RAN_Resende.zip | Tâmega e Sousa | EXTRA | RESENDE | Revisão | CM_Vetor | 1/25000 | 2021/06/23 00:00:00.000 | 2523.71965804 | 1 | MultiPolygon Z | EPSG:3763 | 337851 | 01143325dd32274c009031932df2bfd14f2b8acd127998f3cf7c0ca868038d37 |
| RAN_Espinho.zip | Área Metropolitana do Porto | EXTRA | ESPINHO | Revisão | CM_Vetor | 1/25000 | 2020/08/08 00:00:00.000 | 135.958215746 | 1 | MultiPolygon Z | EPSG:3763 | 27794 | 34589dec9bebc995b7e7d7837558e271fb42d5ccf575ef88ff66d7e09100df1b |
| RAN_Gondomar.zip | Área Metropolitana do Porto | TARGET | GONDOMAR | Revisão | CM_Vetor_2016 | 1/25000 | 2016/07/17 00:00:00.000 | 1181.72341642 | 1 | MultiPolygon Z | EPSG:3763 | 498695 | 0acd11557104427143adfd29d97d6252294dea3c6409644f72d903ed694589f4 |
| RAN_Maia.zip | Área Metropolitana do Porto | TARGET | MAIA | 2ª Revisão | CM_Vetor | 1/10000 | 2025/02/19 | 1653.72717021 | 1 | MultiPolygon Z | EPSG:3763 | 258399 | 03703be3e6b969fefa5e9c91de5ef87512bc63b3f555f722d76cbcfe15c71f06 |
| RAN_Matosinhos.zip | Área Metropolitana do Porto | TARGET | MATOSINHOS | Revisão | CM_Vetor | 1/25000 | 2020/08/08 00:00:00.000 | 1202.29237761 | 1 | MultiPolygon Z | EPSG:3763 | 132367 | 5162b8f37b6b601e45d7aa9ddc10de822e00a49b03cd372e69cb57281c03ef67 |
| RAN_Oliveira_Azemeis.zip | Área Metropolitana do Porto | EXTRA | OLIVEIRA DE AZEMÉIS | Revisão | CM_Vetor_2016 | 1/25000 | 2016/07/17 00:00:00.000 | 2558.10837599 | 1 | MultiPolygon Z | EPSG:3763 | 422408 | e464f7020d608c0047a81334d7dfbc5c2341b6777794ffe6a48e91fa5da77d6b |
| RAN_Paredes.zip | Área Metropolitana do Porto | TARGET | PAREDES | Revisão | CM_Vetor_13975_SSAIGT | 1/25000 | 2024/11/25 00:00:00.000 | 3232.79537702 | 1 | MultiPolygon Z | EPSG:3763 | 742735 | 6eb7e48bf62062bc9a88fe3fe28b51650cc97a68bb6af4927c2f731c19fdaa95 |
| RAN_Povoa_Varzim.zip | Área Metropolitana do Porto | TARGET | PÓVOA DE VARZIM | Revisão | DGADR_2019 | 1/25000 | 2019/03/08 00:00:00.000 | 3234.62072502 | 1 | MultiPolygon Z | EPSG:3763 | 121678 | 542189f7b4873c825cc8d6840465b0e2e5585b4872fc10c7a305361049aaccac |
| RAN_Santa_Maria_Feira.zip | Área Metropolitana do Porto | EXTRA | SANTA MARIA DA FEIRA | Revisão | CM_Vetor_2015 | 1/25000 | 2015/03/08 00:00:00.000 | 2744.70131004 | 1 | MultiPolygon Z | EPSG:3763 | 596145 | 336219d107b56ab9b67f44d8e4ffe40bca2d3b48942fb1980ef034b2a25899a2 |
| RAN_Santo_Tirso.zip | Área Metropolitana do Porto | TARGET | SANTO TIRSO | 2ª Revisão | CM Vetor | 1/10000 | 2026/07/02 | 3190.62246207 | 1 | MultiPolygon Z | EPSG:3763 | 625638 | 2b5fb70da4df4e05f254a63ae873b2a3ec82d5eeffba674f7243507c4db8c65b |
| RAN_Sao_Joao_Madeira.zip | Área Metropolitana do Porto | EXTRA | SÃO JOÃO DA MADEIRA | Revisão | CM_Vetor | 1/25000 | 2020/08/08 00:00:00.000 | 29.0130417281 | 1 | MultiPolygon Z | EPSG:3763 | 511312 | 4436a18fec8d3605d79b5ee264274e925fbf1a596d0af4a1d0ad7e4ae7a3bc45 |
| RAN_Trofa.zip | Área Metropolitana do Porto | TARGET | TROFA | Revisão | CM_Vetor | 1/25000 | 2025/03/31 | 1585.28071695 | 1 | MultiPolygon Z | EPSG:3763 | 230897 | 11c52927c80c248c39e56567cc20518139fb66adc6b6c2a5f75211a29d57e371 |
| RAN_Vale_Cambra.zip | Área Metropolitana do Porto | EXTRA | VALE DE CAMBRA | Revisão | CM_Vetor | 1/10000 | 2025/08/13 | 2086.94397349 | 1 | MultiPolygon Z | EPSG:3763 | 498936 | a33ad97cb6aaac09a0d3aaa009481f5e92bdd3708672af836fb0a519f2c8f002 |
| RAN_Valongo.zip | Área Metropolitana do Porto | TARGET | VALONGO | 2ª Revisão | CM_Vetor | 1/10000 | 2025/02/21 | 645.260837412 | 1 | MultiPolygon Z | EPSG:3763 | 87659 | 59c4ea1f83b7da455f5496a525fcf6bb13b9ce9979b7b14a3f92852a2fdf65bb |
| RAN_Vila_Conde.zip | Área Metropolitana do Porto | TARGET | VILA DO CONDE | Delimitação | CM_Vetor | 1/10000 | 2019/09/18 | 6299.70920149 | 1 | MultiPolygon Z | EPSG:3763 | 304821 | 54606ef74b40051d84c3c336a8aa5fe93ea04921b13392d24f8a17256f46d643 |
| RAN_Vila_Nova_Gaia.zip | Área Metropolitana do Porto | TARGET | VILA NOVA DE GAIA | Revisão | CM_Vetor | 1/10000 | 2019/03/08 00:00:00.000 | 1512.79175895 | 1 | MultiPolygon Z | EPSG:3763 | 196871 | 5b8efa4c8ed849efa34e36704de1d846bd1731bbee88daf91b0f311ee4020a18 |

## Target municipalities — status

- **Amarante: PRESENT** — `RAN_Amarante.zip`
- **Baiao: PRESENT** — `RAN_Baiao.zip`
- **Felgueiras: PRESENT** — `RAN_Felgueiras.zip`
- **Gondomar: PRESENT** — `RAN_Gondomar.zip`
- **Lousada: PRESENT** — `RAN_Lousada.zip`
- **Maia: PRESENT** — `RAN_Maia.zip`
- **Marco Canaveses: PRESENT** — `RAN_Marco_Canaveses.zip`
- **Matosinhos: PRESENT** — `RAN_Matosinhos.zip`
- **Pacos Ferreira: PRESENT** — `RAN_Pacos_Ferreira.zip`
- **Paredes: PRESENT** — `RAN_Paredes.zip`
- **Penafiel: PRESENT** — `RAN_Penafiel.zip`
- **Porto: MISSING** — no raw ZIP available in this folder; see availability note above.
- **Povoa Varzim: PRESENT** — `RAN_Povoa_Varzim.zip`
- **Santo Tirso: PRESENT** — `RAN_Santo_Tirso.zip`
- **Trofa: PRESENT** — `RAN_Trofa.zip`
- **Valongo: PRESENT** — `RAN_Valongo.zip`
- **Vila Conde: PRESENT** — `RAN_Vila_Conde.zip`
- **Vila Nova Gaia: PRESENT** — `RAN_Vila_Nova_Gaia.zip`

## Extra raw files outside the 18-municipality scope

- `RAN_Castelo_Paiva.zip` — CASTELO DE PAIVA — Tâmega e Sousa; retained as raw source only.
- `RAN_Celorico_Basto.zip` — CELORICO DE BASTO — Tâmega e Sousa; retained as raw source only.
- `RAN_Cinfaes.zip` — CINFÃES — Tâmega e Sousa; retained as raw source only.
- `RAN_Espinho.zip` — ESPINHO — Área Metropolitana do Porto; retained as raw source only.
- `RAN_Oliveira_Azemeis.zip` — OLIVEIRA DE AZEMÉIS — Área Metropolitana do Porto; retained as raw source only.
- `RAN_Resende.zip` — RESENDE — Tâmega e Sousa; retained as raw source only.
- `RAN_Santa_Maria_Feira.zip` — SANTA MARIA DA FEIRA — Área Metropolitana do Porto; retained as raw source only.
- `RAN_Sao_Joao_Madeira.zip` — SÃO JOÃO DA MADEIRA — Área Metropolitana do Porto; retained as raw source only.
- `RAN_Vale_Cambra.zip` — VALE DE CAMBRA — Área Metropolitana do Porto; retained as raw source only.

## Folder housekeeping

- `test/` and `dummy2/` are empty transfer-test folders created during file-upload troubleshooting. They are **not** RAN datasets and should be ignored.
- `RAN_Arouca.zip` was provided separately in the chat and inspected, but it is not currently stored in `RAN_RAW`; Arouca is also outside the 18-municipality target scope.

## Data handling rules for downstream processing

- Preserve each original ZIP unchanged.
- If creating `dgadr_ran.gpkg`, include only the 17 present target municipalities unless explicitly instructed otherwise.
- Do not fabricate a Porto geometry and do not replace missing Porto RAN with an estimate or a non-DGADR source while representing it as the official DGADR vector.
- Preserve original attribute values, accents, missing values, CRS, and municipality boundaries. Do not normalize `SERVIDÃO`, `DINÂMICA`, `AUTOR`, `RIGOR`, or `DATA` without retaining the raw originals.
- Record source URL, retrieval date, CRS, file checksum and any missing/unavailable source explicitly in project metadata.

## Integrity

The SHA-256 values in the inventory were calculated from the exact ZIP bytes received in this project. They can be used later to confirm that raw archives have not changed.

## Final RAN project outputs

- `dgadr_ran.gpkg` — GeoPackage assembled from the 17 available TARGET municipal DGADR shapefiles. It contains 17 separate layers, one per target municipality. No clipping, dissolving, reprojection, simplification, normalization, interpolation, or area calculation was performed.
- `sources_ran.json` — machine-readable provenance metadata for the final GeoPackage, the 17 included raw source ZIP files, and the unavailable Porto source.
- `dgadr_ran.gpkg` validation: 17 layers; 1 feature per layer; geometry `MultiPolygon Z`; CRS `EPSG:3763`; original source attribute fields and values preserved; geometry topology matched the original municipal shapefiles after writing.
- `dgadr_ran.gpkg` SHA-256: `9a941293285b62505a572735176c2a531e2c3e3f33a2fe6ae8060dbbdbfbae6d`
- `sources_ran.json` SHA-256: `f81197d496376b56fb33e884810cbfb0168872e3851b737a1dde5ee78a4511fc`
- Output creation date: 2026-09-07.
- Porto remains unavailable from the official DGADR vector download reviewed on 2026-09-07 and is not fabricated or substituted.
