# REN_FINAL — Reserva Ecológica Nacional, Região Norte

## 1. Objetivo

Esta pasta contém o produto consolidado para os 18 municípios-alvo do projeto, preparado exclusivamente a partir do serviço vetorial oficial WFS da **Direção-Geral do Território (DGT)** para **SRUP - Reserva Ecológica Nacional - Região Norte**. Os 36 GeoJSON brutos permanecem na pasta irmã `REN_RAW`; esta pasta separa os resultados finais dos dados raw.

Municípios-alvo: Amarante, Baião, Felgueiras, Gondomar, Lousada, Maia, Marco de Canaveses, Matosinhos, Paços de Ferreira, Paredes, Penafiel, Porto, Póvoa de Varzim, Santo Tirso, Trofa, Valongo, Vila do Conde e Vila Nova de Gaia.

## 2. Resultado principal

`dgt_ren.gpkg` contém:

- `ren_norte`: **31 features**, `GEOMETRYCOLLECTION`, EPSG:3763.
- `linhas_de_agua_norte`: **14 features**, `GEOMETRYCOLLECTION`, EPSG:3763.
- `download_status`: tabela não espacial com **36 registos**, um por pedido WFS município × FeatureType.

Não foi feita dissolução, clipping geométrico adicional, cálculo de área, arredondamento, interpolação, preenchimento de nulos, trimming de texto, normalização de classes ou reparação de geometria.

## 3. Fonte oficial

Organização: **Direção-Geral do Território (DGT)**
Catálogo: https://dados.gov.pt/pt/datasets/srup-reserva-ecologica-nacional/
Página DGT SRUP: https://www.dgterritorio.gov.pt/atividades/ordenamento/sgt/srup
WFS GetCapabilities: https://servicos.dgterritorio.pt/SDISNITWFSSRUP_REN_NORTE/WFService.aspx?service=WFS&request=getcapabilities
Endpoint GetFeature: https://servicos.dgterritorio.pt/SDISNITWFSSRUP_REN_NORTE/service.svc/get
Serviço: **OGC WFS 2.0.0**
CRS: **EPSG:3763 — PT-TM06/ETRS89**
Licença indicada no catálogo dados.gov.pt: **Creative Commons Attribution 4.0 - CC BY 4.0**.

Definição oficial do serviço WFS, preservada literalmente em `sources_ren.json`:

> A Reserva Ecológica Nacional (REN) é uma restrição de utilidade pública. A informação geográfica fornecida através do presente serviço WFS, relativa à área da Região Norte, foi produzida pela DGT a partir de informação legalmente depositada no SNIT relativa à delimitação da REN, sendo que a REN é uma estrutura biofísica que integra as áreas que são objeto de proteção especial por causa do seu valor e sensibilidade ecológicos ou pela sua susceptibilidade a riscos naturais. Informação no sistema de referência EPSG: 3763 (PT-TM06/ETRS89).

O catálogo mostra `Última atualização: 24 de novembro de 2021`; o texto atual da própria ficha indica que os metadados foram atualizados em **06 de março de 2026** e informa que a base geográfica pode ser atualizada frequentemente. Assim, este produto é um **snapshot descarregado em 08-09-2026**.

## 4. Estrutura de origem

### `gmgml:REN_Norte` → `ren_norte`
Campos preservados exatamente como atributos de origem:

`AREA_HA, CONCELHO, DEPOSITO, DESIGNACAO, DINAMICA, DTCC, GEOMETRIA_AUTOR, GEOMETRIA_DATA, GEOMETRIA_RIGOR, ID, IDESTADO, LEI_TIPO, ORIGEM_REN, REGIAO, SERVIDAO, SERV_DR, SERV_HIPERLINK, SERV_LEI, TIPOLOGIA, TUTELA`

### `gmgml:Linhas_de_Agua_Norte` → `linhas_de_agua_norte`
Campos preservados:

`ID, SERVIDAO, REGIAO, DTCC, CONCELHO, TIPOLOGIA, DINAMICA, ESTADO`

Os documentos XSD originais estão nesta pasta.

## 5. Processo executado

1. Foram preservados o `GetCapabilities` e os dois `DescribeFeatureType` originais.
2. Foram usados pedidos municipais ao WFS regional Norte, evitando o download nacional/regional integral que o próprio catálogo avisa poder apresentar problemas devido ao volume.
3. Cada chamada usou `GetFeature`, `srsName=EPSG:3763`, `outputFormat=application/vnd.geo+json` e filtro FES `PropertyIsEqualTo` sobre `DTCC`.
4. Foram executadas **36 chamadas**: 18 municípios × 2 FeatureTypes.
5. Cada resposta foi guardada na íntegra em `../REN_RAW`.
6. Antes da consolidação, os **36 hashes SHA-256** foram comparados com o manifesto; todos coincidiram.
7. As contagens de features foram verificadas contra o manifesto; todas coincidiram.
8. Nos ficheiros não vazios, foi verificado que o `DTCC` devolvido era exatamente o solicitado.
9. As coordenadas não foram transformadas. O WFS foi solicitado em EPSG:3763 e os ficheiros DGT contêm `crs: EPSG:3763`; o GeoPackage regista EPSG:3763 diretamente.
10. Para garantir que nenhuma geometria de origem fosse silenciosamente reparada, o GeoPackage foi escrito preservando o WKB derivado diretamente das coordenadas GeoJSON, inclusive quando a geometria de origem é estruturalmente inválida.
11. O payload WKB armazenado no GeoPackage foi comparado **byte a byte** com o WKB gerado a partir das coordenadas de origem; atributos e ordem de campos foram igualmente validados por SQLite.

## 6. Resultados por município

| Município | DTCC | REN | Linhas de Água | Referência legal / DR e `GEOMETRIA_DATA` conforme WFS |
|---|---:|---:|---:|---|
| Amarante | 1301 | 2 | 0 | AVISO 4954/2024/2 | 48 IIS | 2024-05-17T00:00:00 |
| Baião | 1302 | 2 | 1 | AVISO 20794/2025/2 | 159 IIS | 2026-04-08T00:00:00 |
| Felgueiras | 1303 | 2 | 1 | AVISO 7304/2024/2 | 68 IIS | 2024-04-05T00:00:00 |
| Gondomar | 1304 | 2 | 1 | AVISO 19207/2019 | 230 IIS | 2023-02-23T00:00:00 |
| Lousada | 1305 | 2 | 1 | DESPACHO 3725/2024 | 68 IIS | 2024-10-09T00:00:00<br>DESPACHO 3725/2024 | 68 IIS | 2024-09-26T00:00:00 |
| Maia | 1306 | 2 | 1 | AVISO 23434/2025/2 | 183 IIS | 2026-04-09T00:00:00 |
| Marco de Canaveses | 1307 | 2 | 1 | PORTARIA 144/2016 | 95 IIS | 2021-01-01T00:00:00 |
| Matosinhos | 1308 | 2 | 1 | AVISO 11601/2023 | 116 IIS | 2023-07-21T00:00:00 |
| Paços de Ferreira | 1309 | 2 | 1 | DESPACHO 13583/2025 | 222 IIS | 2026-04-10T00:00:00 |
| Paredes | 1310 | 2 | 1 | AVISO 9299/2024/2 | 86 IIS | 2024-11-26T00:00:00 |
| Penafiel | 1311 | 1 | 0 | RCM 187/2007 | 246 IS | 2022-09-16T00:00:00 |
| Porto | 1312 | 0 | 0 | — |
| Póvoa de Varzim | 1313 | 2 | 1 | AVISO 1345/2020 | 18 IIS | 2022-09-06T00:00:00 |
| Santo Tirso | 1314 | 2 | 1 | DESPACHO 9867/2023 | 186 IIS | 2023-12-06T00:00:00 |
| Trofa | 1318 | 2 | 1 | AVISO 11583/2025/2 | 87 IIS | 2025-09-24T00:00:00 |
| Valongo | 1315 | 2 | 1 | AVISO 4789/2025/2 | 36 IIS | 2025-09-22T00:00:00 |
| Vila do Conde | 1316 | 0 | 0 | — |
| Vila Nova de Gaia | 1317 | 2 | 1 | DESPACHO 1991/2024 | 37 IIS | 2024-03-04T00:00:00 |

As referências acima vêm diretamente de `SERV_LEI`, `SERV_DR` e `GEOMETRIA_DATA`. Os links oficiais permanecem em `SERV_HIPERLINK`. Não foram reconciliados ou corrigidos com outras fontes.

## 7. Respostas vazias

O WFS devolveu FeatureCollections válidas com 0 features para:

- Amarante — `Linhas_de_Agua_Norte`.
- Penafiel — `Linhas_de_Agua_Norte`.
- Porto — `REN_Norte` e `Linhas_de_Agua_Norte`.
- Vila do Conde — `REN_Norte` e `Linhas_de_Agua_Norte`.

Isto significa apenas **0 features devolvidas pelo WFS neste snapshot**. Não foi convertido em geometrias zero, estimativas ou inferência de inexistência legal.

## 8. Valores nulos e integridade do raw

- Um `TIPOLOGIA = NULL` existente numa feature de Maia foi mantido como `NULL`.
- Espaços finais e grafia dos textos de origem não foram normalizados.
- `AREA_HA` é o valor fornecido pela DGT; não foi recalculado.
- Nenhum valor ausente foi substituído.

## 9. Anomalias geométricas de origem preservadas

- `dgt_ren_felgueiras.geojson` / `REN_Norte.173010` / `geometry.geometries[164].coordinates[0]`: anel de polígono com 3 tuplos de coordenadas. Foi **preservado sem reparação**.
- `dgt_ren_paredes.geojson` / `REN_Norte.173016` / `geometry.geometries[147].coordinates[1]`: anel de polígono com 2 tuplos de coordenadas. Foi **preservado sem reparação**.

Esta anomalia pertence ao GeoJSON oficial recebido. Como o objetivo é preservar raw/source data, **não foi fechada, removida, simplificada nem reparada**. Alguns softwares baseados em GEOS podem recusar ou sinalizar essa feature como inválida. O raw correspondente continua em `../REN_RAW`.

## 10. Aviso jurídico/cartográfico da DGT

A DGT alerta que, para a REN, a informação vetorial deve ser confirmada com a imagem georreferenciada da delimitação municipal publicada em **Diário da República**. Os limites publicados na versão em vigor prevalecem sobre dúvidas resultantes do vetor disponibilizado.

Por isso, `dgt_ren.gpkg` é uma consolidação fiel do WFS oficial no momento do download, mas não substitui a carta publicada para decisões jurídicas, licenciamento ou verificação de um prédio específico.

## 11. Controlo de qualidade final

- 36/36 raw GeoJSON presentes.
- 36/36 SHA-256 coincidentes com `ren_download_manifest.json`.
- 36/36 contagens coincidentes.
- Todos os DTCC não vazios correspondem ao filtro solicitado.
- `ren_norte`: 31 features; EPSG:3763; atributos exatos; WKB exato.
- `linhas_de_agua_norte`: 14 features; EPSG:3763; atributos exatos; WKB exato.
- `download_status`: 36 registos.
- `resultType=hits` não devolveu `numberMatched` útil; nenhum valor foi inventado.

## 12. Inventário — uma linha por ficheiro

- `dgt_ren.gpkg` — produto GIS consolidado; DGT WFS; 31 REN + 14 Linhas de Água; 36 registos de auditoria; EPSG:3763.
- `sources_ren.json` — metadados/proveniência; DGT + dados.gov.pt; inclui 36 URLs WFS, hashes raw, resultados municipais, validações e anomalia geométrica preservada.
- `ren_download_manifest.json` — manifesto raw de download; 36 registos de chamadas WFS com URL, contagem, DTCC, tamanho e SHA-256.
- `dgt_ren_norte_wfs_capabilities.xml` — GetCapabilities original DGT; metadados de serviço; sem features.
- `dgt_ren_norte_schema_ren.xsd` — DescribeFeatureType original de `gmgml:REN_Norte`; esquema de campos/geometria; sem features.
- `dgt_ren_norte_schema_linhas_agua.xsd` — DescribeFeatureType original de `gmgml:Linhas_de_Agua_Norte`; esquema de campos/geometria; sem features.
- `checksums.sha256` — checksums SHA-256 dos restantes ficheiros finais desta pasta.
- `README.md` — este documento; fontes, processo, resultados, validações, limitações e inventário.

## 13. Localização dos dados raw

Os 36 GeoJSON originais permanecem em:

`../REN_RAW/`

A separação `REN_RAW` / `REN_FINAL` mantém a cadeia de proveniência clara e evita duplicar os raw.

## 14. Indisponível / limitações finais

- Porto: 0 REN e 0 Linhas de Água devolvidas pelo WFS neste snapshot; não se inferiu ausência legal.
- Vila do Conde: 0 REN e 0 Linhas de Água devolvidas pelo WFS neste snapshot; não se inferiu ausência legal.
- Amarante e Penafiel: 0 Linhas de Água devolvidas pelo WFS.
- `numberMatched` do pedido `hits`: indisponível no comportamento observado do servidor.
- Não foi efetuada confirmação visual, município a município, contra a imagem legal publicada em Diário da República; essa confirmação continua necessária quando houver dúvida ou para uso jurídico.
- Não foram criadas estimativas, médias, percentagens, geometrias sintéticas, áreas derivadas ou valores de substituição.
