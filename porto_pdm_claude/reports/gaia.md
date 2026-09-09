# Vila Nova de Gaia — PDM core zoning vector source

**Confidence: `UNRESOLVED`** — the official GIS host did not complete a single TCP/TLS
exchange from this environment. Nothing about what it publishes was determined.

| | |
| --- | --- |
| **Municipality** | Vila Nova de Gaia |
| **Official portal** | https://sig.gaiurb.pt/ — confirmed as the official GIS from Gaiurb's own site |
| **Current effective PDM status** | not determined |
| **Core zoning layer name** | “Carta de Qualificação de Solo”, per the brief; **not verified against the portal** |
| **Service technology** | unknown |
| **Exact service URL** | unknown |
| **Exact layer / ResourceId** | unknown |
| **MapDefinition / LayerDefinition / FeatureSource / Feature class / Geometry property** | unknown |
| **CRS** | unknown |
| **Attribute fields** | unknown |
| **Feature query URL** | none issued — no connection |
| **Did feature query return geometry?** | **NO** |
| **Sample feature ID** | — |
| **Blocker** | Host `sig.gaiurb.pt` unreachable: TLS `SSL_ERROR_SYSCALL` on :443, connection timeout on :80. Reproduced over ~25 minutes with curl (TLS 1.3 and TLS 1.2) and via a second, independent fetch path. |

## What *was* established

Gaiurb's own site names the GIS entry points, so the target URL is confirmed official and
not guessed (`raw/gaia/01_gaiurb_home.html` → `raw/gaia/02_geoportal_page.html`):

```
https://sig.gaiurb.pt/geoportal
https://sig.gaiurb.pt/geoportal?webepl
https://sig.gaiurb.pt/geoportal?webpdm
```

The `/geoportal?webpdm` URL pattern is **identical to Gondomar's**
(`https://pdm.cm-gondomar.pt/geoportal?webpdm`) and to Baião's and Maia's portals — the
same vendor product (ASP.NET + dhtmlx + `jsDraw2D` front end over an Autodesk MapGuide
`mapagent`). So the playbook that solved Maia and Gondomar should transfer directly once
the host answers:

1. `GET /geoportal?webpdm` → read `WEBLAYOUT=Library://…` out of the page source
2. `GET …/mapviewerajax/ajaxviewer.aspx?…` → read the `mapagent.fcgi` host and `MAPDEFINITION=`
3. `GETRESOURCECONTENT` on the MapDefinition → layer groups
4. `ENUMERATERESOURCES … TYPE=MapDefinition` — **do this**; on Gondomar the viewer's own
   `ord_1_1` map was a raster and the vector was in a parallel library branch
5. `GETRESOURCECONTENT` on each LayerDefinition → confirm `<VectorLayerDefinition>`
6. `GETSPATIALCONTEXTS` + `SELECTFEATURES` with `USERNAME=Anonymous&PASSWORD=`

The site also links `https://gaia-invest-gaiurb.hub.arcgis.com/`. That is an ArcGIS Hub
site for an investment product, not the PDM zoning source, and rule 4 puts the municipal
original first — it was not pursued.

## Failure evidence

| Attempt | Result |
| --- | --- |
| `https://sig.gaiurb.pt/` | `OpenSSL SSL_connect: SSL_ERROR_SYSCALL` |
| `https://sig.gaiurb.pt/` with `--tls-max 1.2` | same |
| `https://sig.gaiurb.pt/geoportal?webpdm`, browser UA | same |
| `http://sig.gaiurb.pt/` (:80) | `Operation timed out after 45s, 0 bytes received` |
| `http://sig.gaiurb.pt/geoportal` (:80) | `Operation timed out after 60s, 0 bytes received` |
| second, independent fetch path | HTTP 503 |

DNS resolves normally — `sig.gaiurb.pt → 62.28.113.173` — so this is not a name-resolution
problem. `www.gaiurb.pt` (193.126.238.123) and `gaiurb.pt` (62.28.113.169) both answer
fine from the same environment, which is how the entry-point URLs above were obtained.
The failure is specific to the `sig` host.

**This says nothing about what the portal publishes.** Retry on another day before drawing
any conclusion.

## Raw files saved

`raw/gaia/01_gaiurb_home.html`, `raw/gaia/02_geoportal_page.html`, plus `.headers`.
No response body was ever received from `sig.gaiurb.pt`; the zero-byte artefacts from the
failed attempts were removed rather than kept as misleading empty "responses". Every
attempt, successful or not, is recorded in `commands.log`.
