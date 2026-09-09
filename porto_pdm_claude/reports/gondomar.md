# Gondomar — PDM core zoning vector source

**Confidence: `VERIFIED_VECTOR`** — a real feature query returned real polygon geometry.

| | |
| --- | --- |
| **Municipality** | Gondomar |
| **Official portal** | https://pdm.cm-gondomar.pt/ → redirects to `/geoportal?webpdm` |
| **Current effective PDM status** | The portal presents this tree as the municipality's Plano Diretor Municipal → Planta de Ordenamento. **A Diário da República publication reference was NOT found in any reachable portal resource** — unlike Maia, whose menu links its Avisos. Legal effectiveness is therefore *not* independently established here; see *Not done*. |
| **Core zoning layer name** | “Qualificação do Solo” — menu checkbox `id='ord_1_1'` under “Plano Diretor Municipal → Planta de Ordenamento” |
| **Service technology** | Autodesk MapGuide 3.1 `mapagent` HTTP API over a PostGIS FeatureSource |
| **Exact service URL** | `https://pdm.cm-gondomar.pt/mapguide31/mapagent/mapagent.fcgi` |
| **WebLayout** | `Library://Visualizador/Layouts/mapa.WebLayout` |
| **MapDefinition** | `Library://Gismat/Layers/pdm/ord_1_1/total.MapDefinition` (the vector one — see the trap below) |
| **LayerDefinition** | `Library://Gismat/Layers/pdm/ord_1_1/{SRURAL*,SURBANO*}.LayerDefinition` (22 core, listed below) |
| **FeatureSource** | `Library://Gismat/Data/pdm_db.FeatureSource` |
| **Feature class** | schema `ord_1_1`, e.g. `ord_1_1:SURBANOurbanizadoESPACOCENTRALtr` |
| **Geometry property** | `geom_etrs` |
| **CRS** | `PROJCS["ETRS89.PT-TM06", …]` — WKT verbatim from `GETSPATIALCONTEXTS`. Parameters are those of **EPSG:3763**; the server asserts no EPSG code. |
| **Attribute fields** | `gid`, `Layer`, `geom_etrs` |
| **Did feature query return geometry?** | **YES** — 65 features, `POLYGON ((…))` |
| **Sample feature ID** | `gid=19`, `Layer="Solo Urbano - Solo Urbanizado, Espaços Centrais"` |
| **Blocker** | none for feature access; see the legal-status caveat above |

## Evidence chain — each step from a server response, none guessed

1. `https://pdm.cm-gondomar.pt/` is a 3-second meta-refresh to
   `https://pdm.cm-gondomar.pt/geoportal?webpdm` (`raw/gondomar/00_portal.html`).
2. That page's source (`raw/gondomar/01_geoportal_webpdm.html`) carries the viewer URL
   with `WEBLAYOUT=Library://Visualizador/Layouts/mapa.WebLayout`.
3. The viewer page (`raw/gondomar/02_ajaxviewer.html`) names the mapagent host
   `https://pdm.cm-gondomar.pt/mapguide31/mapagent/mapagent.fcgi`.
4. `ENUMERATERESOURCES … TYPE=MapDefinition` (`raw/gondomar/04_enum_mapdefinitions.xml`)
   returns 31 MapDefinitions, among them both `Library://Visualizador/Maps/webepl/ord_1_1.MapDefinition`
   and `Library://Gismat/Layers/pdm/ord_1_1/total.MapDefinition`.
5. The portal's PDM menu (`raw/gondomar/07_menu_webpdm.html`) ties the id to the label:
   `<input … name='pdm' id='ord_1_1' /><label…> Qualificação do Solo</label>`
   directly under `Plano Diretor Municipal` → `Planta de Ordenamento`.
6. Each core LayerDefinition is a **`<VectorLayerDefinition>`** on
   `Library://Gismat/Data/pdm_db.FeatureSource` (`raw/gondomar/layerdefs/`, resolved in
   `raw/gondomar/layerdefs_resolved.json`).
7. `SELECTFEATURES` returned 65 polygons (`raw/gondomar/09_selectfeatures_ESPACOCENTRAL.xml`, 200 KB).

## The trap: two `ord_1_1` MapDefinitions, one of them raster

`Library://Visualizador/Maps/webepl/ord_1_1.MapDefinition` — the one reachable from the
public viewer's own map list — contains exactly **one** layer:
`Library://Gismat/Layers/Raster/ord_1_1_2015.LayerDefinition`, a georeferenced image of
the plan sheet (`raw/gondomar/05_mapdef_ord_1_1.xml`). Stopping there would have produced
"raster only", and the brief's *no raster-to-vector* rule would have closed Gondomar.

The vector lives in the parallel `Gismat` branch, `Library://Gismat/Layers/pdm/ord_1_1/total.MapDefinition`,
found only by enumerating MapDefinitions from the server (`raw/gondomar/06_…`).

## The 22 core classes (schema `ord_1_1`, FeatureSource `pdm_db`)

**Solo Rústico (10):** `SRURALAGLOMERADOSRURAIStra`, `SRURALEQUIPAMENTOSOUTRASESTRUTURAStr`,
`SRURALESPACOSAGRICOLAStra`, `SRURALESPACOSCULTURAIS_TR`,
`SRURALESPACOSDEUSOMuLTIPLOAGRICOLAEFLORESTAtra`, `SRURALESPACOSFLORESTAISDECONSERVACAOtra`,
`SRURALESPACOSFLORESTAISDEPRODUCAOtra`, `SRURALESPACOSRECREIOLAZERtr`,
`SRURALTURISMOexistente_TR`, `SRURALTURISMOpropostotr`

**Solo Urbano — urbanizado (8):** `SURBANOurbanizadoESPACOCENTRALtr`,
`SURBANOurbanizadoESPACOSDEACTIVIDADESECONoMICAStra`,
`SURBANOurbanizadoESPACOSDEEQUIPAMENTOSESTRUTURANTEStra`,
`SURBANOurbanizadoESPACOSRESIDENCIAISTIPOITR`, `SURBANOurbanizadoESPACOSRESIDENCIAISTIPOIItr`,
`SURBANOurbanizadoURBANOBAIXADENSIDADEtr`, `SURBANOurbanizadoVERDEENQUADRAMENTOtr`,
`SURBANOurbanizadoVERDEUTILICOLECTIVAtr`

**Solo Urbano — urbanizável (4):** `SURBANOurbanizavelESPACOCENTRALtr`,
`SURBANOurbanizavelESPACOSDEACTIVIDADESECONoMICAStra`,
`SURBANOurbanizavelESPACOSRESIDENCIAISTIPOItr`, `SURBANOurbanizavelESPACOSRESIDENCIAISTIPOIITR`

The remaining ~20 layers in that MapDefinition are roads (`distribuidoras*`, `EN_PROPOSTAS`),
rail/metro (`CAMINHOFERRO`, `METRO`), reservoirs, UOPG and `*TEXTO` annotation, plus
orthophoto rasters — overlays, out of scope by rule 7.

## ✅ Attribute note — Gondomar publishes the label as data

Unlike Maia and Marco de Canaveses, the `Layer` **field carries the full
Classificação + Qualificação string**, e.g.

```
Solo Urbano - Solo Urbanizado, Espaços Centrais
```

All 65 features in the sampled class carry that one value, so it is a per-class constant
rather than a per-feature attribute — but it is published data, not a portal artefact, and
splitting it on `" - "` / `","` recovers *Classificação* → *sub-classe* → *Qualificação*
without inventing anything. That split is still a derivation and should be recorded as one.

There is no area, no `dicofre`, no `freguesia` and no code field.

## Reproducing

```
BASE=https://pdm.cm-gondomar.pt/mapguide31/mapagent/mapagent.fcgi
AUTH="VERSION=1.0.0&USERNAME=Anonymous&PASSWORD="
FS=Library://Gismat/Data/pdm_db.FeatureSource

curl "$BASE?OPERATION=GETSPATIALCONTEXTS&$AUTH&RESOURCEID=$FS&ACTIVEONLY=0"
curl "$BASE?OPERATION=SELECTFEATURES&$AUTH&RESOURCEID=$FS&CLASSNAME=ord_1_1%3ASURBANOurbanizadoESPACOCENTRALtr&FORMAT=text/xml"
```

## Not done

- **The brief's “model ID 50” was not corroborated.** No `model`/`modelo` identifier with
  the value 50 appears in any reachable portal resource. The only `ModeloPDM` reference in
  the application is `/geoportal/pt/Home/ModeloPDM`, which is the **print** route (it takes
  `ne_lat/ne_long/sw_lat/sw_long/scale` and opens a printable document —
  `raw/gondomar/01_geoportal_webpdm.html` line ~3174). The link to “Qualificação do Solo”
  was instead established through the menu checkbox `id='ord_1_1'`, which is stronger
  evidence than the model number would have been. If model 50 comes from a different
  interface, that interface was not found.
- **Legal effectiveness not established.** No Aviso / Diário da República reference is
  exposed anywhere in the portal's reachable resources. The raster sheet is named
  `ord_1_1_2015`, suggesting a 2015 plan, but that is a filename, not a citation, and is
  not treated as evidence here.
- Per-class feature counts for the other 21 classes.
- Coverage check (gaps/overlaps against the CAOP municipality polygon).

## Raw files saved

`raw/gondomar/00_portal.html`, `01_geoportal_webpdm.html`, `02_ajaxviewer.html`,
`03_mapdefinition.xml`, `04_enum_mapdefinitions.xml`, `05_mapdef_ord_1_1.xml`,
`06_mapdef_gismat_ord_1_1_total.xml`, `07_menu_webpdm.html`,
`08_ld_SURBANO_ESPACOCENTRAL.xml`, `09_selectfeatures_ESPACOCENTRAL.xml`,
`10_spatialcontexts.xml`, `layerdefs/*.xml` (22), `layerdefs_resolved.json`,
plus a `.headers` file beside each response.
