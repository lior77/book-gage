# Felgueiras — PDM core zoning vector source

**Confidence: `UNRESOLVED`** — the official GIS host is behind a front proxy that returns
503 for every request. Nothing about what it publishes was determined.

| | |
| --- | --- |
| **Municipality** | Felgueiras |
| **Official portal** | https://sig.cm-felgueiras.pt/ — confirmed official: linked from the council's own *Cartografia / SIG* page |
| **Current effective PDM status** | not determined from the GIS host. The council site does carry a page titled *“Revisão do PDM em vigor”* (`/territorio-e-gestao/ordenamento-do-territorio/pdm-plano-diretor-municipal/revisao-do-pdm-em-vigor/`), which was **not** opened — it is a document page, and the brief's task is the vector service. |
| **Core zoning layer name** | “PO I — Planta de Ordenamento, Classificação e Qualificação do Solo”, per the brief; **not verified against the portal** |
| **Service technology** | unknown |
| **Exact service URL** | unknown |
| **Exact layer / ResourceId** | unknown |
| **MapDefinition / LayerDefinition / FeatureSource / Feature class / Geometry property** | unknown |
| **CRS** | unknown |
| **Attribute fields** | unknown |
| **Feature query URL** | none issued — no usable response |
| **Did feature query return geometry?** | **NO** |
| **Sample feature ID** | — |
| **Blocker** | `https://sig.cm-felgueiras.pt` resets the TLS connection; `http://sig.cm-felgueiras.pt` returns **HTTP 503** with an Envoy body: `upstream connect error or disconnect/reset before headers. retried and the latest reset reason: connection timeout`. The front proxy is up; the origin behind it does not answer. |

## What *was* established

The council's *Cartografia / SIG* page names the GIS host, so the target is confirmed
official and not guessed (`raw/felgueiras/02_cmfelgueiras_home.html` →
`raw/felgueiras/03_cartografia_sig.html`):

```
https://sig.cm-felgueiras.pt
```

Nothing further — no page from that host was ever retrieved, so no viewer technology,
WebLayout, MapDefinition or layer name could be derived. **No guess is recorded here**, not
even by analogy with the neighbouring municipalities.

## Failure evidence

| Attempt | Result |
| --- | --- |
| `https://sig.cm-felgueiras.pt/` | `Recv failure: Connection reset by peer` |
| same, browser User-Agent + Referer from the council's SIG page | identical reset |
| `http://sig.cm-felgueiras.pt/` | **503**, body: `upstream connect error or disconnect/reset before headers. retried and the latest reset reason: connection timeout` (`raw/felgueiras/01_http_503.txt`) |
| repeated over ~20 minutes | identical |

The browser-header retry matters: on Marco de Canaveses an identical-looking 403 turned out
to be a Referer allowlist, and adding the header opened the service. Here it changes
nothing — the reset happens during the TLS handshake, before any HTTP header is sent.

The outbound proxy's own diagnostics log four `ws_closed_mid_exchange` entries for
`sig.cm-felgueiras.pt:443` — `517 B sent, 39 B received` each time — i.e. the ClientHello
went out and the connection died mid-handshake. `www.cm-felgueiras.pt` answers normally
(HTTP 301 → 200) from the same environment, so this is host-specific, not a blanket block.

**This says nothing about what the portal publishes.** Retry on another day.

## Next step when the host answers

Felgueiras was not reached at all, so its stack is unknown. Test in this order, deriving
every identifier from the response before using it:

1. `GET https://sig.cm-felgueiras.pt/` — save the HTML, grep for `mapagent`,
   `mapviewerajax`, `WEBLAYOUT=`, `Library://`, `geoserver`, `/ows`, `rest/services`,
   `MapServer`, `FeatureServer`.
2. If MapGuide (the pattern of Maia, Gondomar, Baião): follow the WebLayout →
   MapDefinition → LayerDefinition → FeatureSource chain, **and** run
   `ENUMERATERESOURCES … TYPE=MapDefinition`, because on Gondomar the viewer's own map for
   the same sheet was a raster while the vector sat in a parallel library branch.
3. If GeoServer (the pattern of Trofa, Marco): `GetCapabilities` on the `/ows` the page
   names, then `DescribeFeatureType`, then `GetFeature … outputFormat=application/json`.
4. If ArcGIS: `…/MapServer?f=pjson`, then `/<id>?f=pjson`, then
   `/query?where=1%3D1&returnGeometry=true&f=json`.

## Raw files saved

`raw/felgueiras/01_http_503.txt` (the 503 body verbatim),
`raw/felgueiras/02_cmfelgueiras_home.html`, `raw/felgueiras/03_cartografia_sig.html`,
plus `.headers`. The zero-byte artefacts from the failed TLS attempts were removed rather
than kept as misleading empty "responses". Every attempt is recorded in `commands.log`.
