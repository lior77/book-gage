# PDM Phase 1 — current recovery status

Checked: 2026-09-08

## Current verified progress

- Matosinhos: 89/89 selected feature layers have latest status `ok`.
- Paredes: 1/101 selected feature layers completed (`layer 3`). The interrupted run had already written metadata for layer 4 but no completed data file, so layer 4 and the remaining selected Paredes layers still need to be resumed.
- Póvoa de Varzim: no selected PDM feature layer was completed in the previous run because the municipal service timed out before layer download.
- Valongo — Ordenamento: 22/24 feature layers have latest status `ok`; 2 layers remain failed from the earlier run and require retry.
- Valongo — Condicionantes: 29/30 feature layers have latest status `ok`; 1 layer remains failed from the earlier run and requires retry.
- Porto: the earlier CCGD WFS GetCapabilities attempt returned an HTTP 500. The recovery notebook now also tries the municipality's official GeoPackage resource for the Soil Qualification Map, so failure of the WFS metadata request does not block acquisition of that core PDM layer.

## Recovery notebook

`PDM_phase1_resume_missing_only.ipynb`

The notebook:
- skips completed layers whose output files still exist;
- resumes only incomplete or failed layers;
- checkpoints every 50 source object IDs so another interruption does not lose the completed chunks;
- retries temporary server failures;
- uses POST requests to avoid overlong URLs;
- falls back to short GET requests where needed;
- preserves official Esri JSON when GeoJSON cannot be returned rather than converting it;
- does not reclassify, dissolve, interpolate, or raster-to-vector convert any source data;
- updates `pdm_phase1_download_manifest.json` after each completed layer.

## Important

The interrupted run did not corrupt the completed Matosinhos or Valongo files. The new run should be started with **Runtime → Run all** and can itself be re-run safely if it is interrupted again.
