# Maia — PDM core zoning vector source

**Confidence: `VERIFIED_VECTOR`** — a real feature query returned real polygon geometry.

| | |
| --- | --- |
| **Municipality** | Maia |
| **Official portal** | https://websig.cm-maia.pt/ |
| **Current effective PDM status** | **PDM 2025, in force.** Regulamento published as *Aviso n.º 4731-2025/2*; 1.ª Correção as *Aviso 15161/2026*. Both linked from the portal's own PDM menu (`raw/maia/08_menu_webepl.html`). |
| **Core zoning layer name** | “1.1 Classificação e Qualificação” — menu checkbox `id='1_1'` under “1 - Planta de Ordenamento” |
| **Service technology** | Autodesk MapGuide 3.0 `mapagent` HTTP API over a PostGIS FeatureSource |
| **Exact service URL** | `https://websig.cm-maia.pt/mapguide30/mapagent/mapagent.fcgi` |
| **WebLayout** | `Library://DCTSIG/Maps/webepl/webepl.WebLayout` |
| **MapDefinition** | `Library://DCTSIG/Maps/webepl/mapa.MapDefinition` |
| **LayerDefinition** | `Library://DCTSIG/Layers/PDM2025/1_1/ord_1_1_*.LayerDefinition` (16 core, listed below) |
| **FeatureSource** | `Library://DCTSIG/Data/pdm2025_db.FeatureSource` — provider `OSGeo.PostgreSQL`, Service `dbsig:5433`, DataStore `pdm2025` |
| **Feature class** | schema `ord_1_1`, e.g. `ord_1_1:ord_1_1_SoloUrbanoHabitacional-trp` |
| **Geometry property** | `geom` |
| **CRS** | `PROJCS["ETRS89.PT-TM06", … central_meridian −8.13310833333333, latitude_of_origin 39.66825833333333, Meter]` — WKT verbatim from `GETSPATIALCONTEXTS`. Parameters are those of **EPSG:3763**; the server asserts no EPSG code. |
| **Attribute fields** | `id`, `geom`, `cat`, `AREA`, `LAYER` |
| **Did feature query return geometry?** | **YES** — 41 features, `POLYGON ((…))` |
| **Sample feature ID** | `id=1`, `cat=300`, `AREA=2234526`, `LAYER=PG-SoloUrbanoHabitacional-trp` |
| **Blocker** | none |

## Evidence chain — each step from a server response, none guessed

1. `https://websig.cm-maia.pt/` page source carries the viewer URL verbatim
   (`raw/maia/00_websig_root.html`, the `#erro` input and `var aa`):
   `…/mapguide/mapviewerajax/ajaxviewer.aspx?SESSION=…&WEBLAYOUT=Library://DCTSIG/Maps/webepl/webepl.WebLayout&LOCALE=pt`
   → confirms the WebLayout independently of the brief.
2. That viewer page (`raw/maia/01_ajaxviewer.html`) names the mapagent host
   `https://websig.cm-maia.pt/mapguide30/mapagent/mapagent.fcgi` and the map frame's
   `MAPDEFINITION=Library%3a%2f%2fDCTSIG%2fMaps%2fwebepl%2fmapa.MapDefinition`.
3. `GETRESOURCECONTENT` on that MapDefinition (`raw/maia/02_mapdefinition.xml`) lists
   the layer groups. Group `1_1`, parent `Plantas de Ordenamento`, holds 52 layers under
   `Library://DCTSIG/Layers/PDM2025/1_1/`.
4. The portal's PDM menu (`raw/maia/08_menu_webepl.html`) ties that group to the label:
   `<input … name='pdm' id='1_1' /><label…> 1.1 Classificação e Qualificação</label>`.
5. Each core LayerDefinition is a **`<VectorLayerDefinition>`** on
   `Library://DCTSIG/Data/pdm2025_db.FeatureSource` (`raw/maia/layerdefs/`, resolved in
   `raw/maia/layerdefs_resolved.json`).
6. `SELECTFEATURES` returned 41 polygons (`raw/maia/05_selectfeatures_SoloUrbanoHabitacional.xml`, 325 KB).

Authentication: the documented public account `USERNAME=Anonymous&PASSWORD=` works; no
page-minted `SESSION` is needed for the resource and feature operations.

## The 16 core classes (schema `ord_1_1`, FeatureSource `pdm2025_db`)

Labels are the `<ToolTip>` each LayerDefinition carries — the municipality's own wording.

| Classificação | Feature class | Qualificação (ToolTip) |
| --- | --- | --- |
| Solo Rústico | `ord_1_1_SoloRusticoAglomeradoRural-trp` | SoloRustico - Aglomerado Rural |
| Solo Rústico | `ord_1_1_SoloRusticoAgricola-tr` | Solo Rustico - Agricola |
| Solo Rústico | `ord_1_1_SoloRusticoEquipamentosInfraestruturas-trp` | Solo Rustico - Espaços de Equipamentos e Infraestruturas |
| Solo Rústico | `ord_1_1_SoloRusticoFlorestaisRecreioLazer-trp` | Solo Rustico - Espaços Florestais - Recreio e Valorização da Paisagem |
| Solo Rústico | `ord_1_1_SoloRusticoFlorestaProducao-trp` | Solo Rustico - Espaços Florestais - Produção |
| Solo Rústico | `ord_1_1_SoloRusticoFlorestaProtecao-trp` | Solo Rustico - Espaços Florestais - Proteção |
| Solo Rústico | `ord_1_1_SoloRusticoNatural-trp` | Solo Rustico - Espaços Naturais e Paisagísticos |
| Solo Urbano | `ord_1_1_SoloUrbanoAtiviEconomicas-Indust-trp` | Solo Urbano - Espaços de Atividades Económicas - Industrial e logística |
| Solo Urbano | `ord_1_1_SoloUrbanoAtiviEconomicas-Terciario-trp` | Solo Urbano - Espaços de Atividades Económicas -Terciario |
| Solo Urbano | `ord_1_1_SoloUrbanoBaixaDensidade-trp` | Solo Urbano - Espaços Urbanos de Baixa Densidade |
| Solo Urbano | `ord_1_1_SoloUrbanoEquipamentosEstruturantes-trp` | Espaços de Uso Especial - Espaços de Equipamentos |
| Solo Urbano | `ord_1_1_SoloUrbanoEspacosCentrais-trp` | Solo Urbano - Espaços Centrais |
| Solo Urbano | `ord_1_1_SoloUrbanoHabitacional-trp` | **Solo Urbano - Espaços Habitacionais** (41 features pulled) |
| Solo Urbano | `ord_1_1_SoloUrbanoVerdeLogradouro-trp` | Espaços Verdes - Logradouro |
| Solo Urbano | `ord_1_1_SoloUrbanoVerdeUtilizacaoColetiva-trp` | Espaços Verdes - Espaços Verdes de Utilização Coletiva |
| Uso Especial | `ord_1_1_UsoEspecial-AeroportoAerodromo-trp` | Infraestruturas - Aeronáuticas |

The other 36 layers in group `1_1` are roads (`RV-*`), rail and metro (`RF-*`,
`Estacoes*`), UOPG limits (`Programar-*`) and `*_text` annotation — overlays, out of
scope by the brief's own rule 7.

## ⚠️ Attribute caveat

The published attributes are `id`, `cat`, `AREA`, `LAYER` only. **There is no
`classificacao` field and no `qualificacao` field.** Both are carried by *which feature
class the polygon belongs to*, and the human wording lives in the LayerDefinition's
`ToolTip` — a portal artefact, not a data column. `LAYER` repeats the class name
(`PG-SoloUrbanoHabitacional-trp`); `cat` is an integer whose code list was not published
anywhere reachable.

So a `classificacao` / `qualificacao` column in a derived GeoPackage is a **derivation
from layer membership**, and must be recorded as one — not presented as a read field.

## Reproducing

```
BASE=https://websig.cm-maia.pt/mapguide30/mapagent/mapagent.fcgi
AUTH="VERSION=1.0.0&USERNAME=Anonymous&PASSWORD="
FS=Library://DCTSIG/Data/pdm2025_db.FeatureSource

curl "$BASE?OPERATION=GETSPATIALCONTEXTS&$AUTH&RESOURCEID=$FS&ACTIVEONLY=0"
curl "$BASE?OPERATION=SELECTFEATURES&$AUTH&RESOURCEID=$FS&CLASSNAME=ord_1_1%3Aord_1_1_SoloUrbanoHabitacional-trp&FORMAT=text/xml"
```

`MAXFEATURES` is accepted but **ignored** — the query returned the full class.

## Not done

- Per-class feature counts for the other 15 core classes: each needs a full
  `SELECTFEATURES` (that is the download step, not discovery). Only
  `SoloUrbanoHabitacional` was pulled: 41 features.
- The `cat` integer code list was not found in any reachable resource.
- Coverage (do the 16 classes tile the municipality without gaps/overlaps?) — unverified.
- The `CQS` group in the same MapDefinition points at
  `Library://DCTSIG/Maps/revpdm/Layers/QUALIFICAÇÃO_polygon.LayerDefinition` and a
  `PDM2024_Ord` raster. `revpdm` is the revision workspace that produced PDM 2025;
  it was **not** used, per rule 8.

## Raw files saved

`raw/maia/00_websig_root.html`, `01_ajaxviewer.html`, `02_mapdefinition.xml`,
`03_ld_SoloUrbanoHabitacional.xml`, `04_featuresource_pdm2025_db.xml`,
`05_selectfeatures_SoloUrbanoHabitacional.xml`, `06_spatialcontexts.xml`,
`07_menu_webpdm.html`, `08_menu_webepl.html`, `layerdefs/*.xml` (16),
`layerdefs_resolved.json`, plus a `.headers` file beside each response.
