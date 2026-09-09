// Fetch every LayerDefinition named in a MapDefinition, save each response
// unchanged under raw/<muni>/layerdefs/, and print the resolved chain:
//   LayerDefinition -> FeatureSource + FeatureName + Geometry + ToolTip
// Layer names come from the MapDefinition the server returned; none are guessed.
//
//   node trace_layers.js <muni> <mapdef.xml> <mapagent-base> <resourceid-filter-regex>
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const [muni, mapdefPath, base, filter] = process.argv.slice(2);
const outDir = path.join(__dirname, 'raw', muni, 'layerdefs');
fs.mkdirSync(outDir, { recursive: true });

const mapdef = fs.readFileSync(path.join(__dirname, mapdefPath), 'utf8');
const ids = [...new Set([...mapdef.matchAll(/<ResourceId>(Library:\/\/[^<]+\.LayerDefinition)<\/ResourceId>/g)]
  .map(m => m[1]))].filter(id => new RegExp(filter).test(id));

const AUTH = 'VERSION=1.0.0&USERNAME=Anonymous&PASSWORD=';
const rows = [];
for (const id of ids) {
  const url = `${base}?OPERATION=GETRESOURCECONTENT&${AUTH}&RESOURCEID=${encodeURIComponent(id)}&FORMAT=text/xml`;
  const name = id.split('/').pop().replace(/\.LayerDefinition$/, '').replace(/[^\w.-]/g, '_');
  const file = path.join(outDir, name + '.xml');
  let xml = '';
  try { xml = execFileSync('curl', ['-sS', '-m', '60', url], { encoding: 'utf8', maxBuffer: 1 << 26 }); }
  catch (e) { rows.push({ id, err: String(e.message).slice(0, 120) }); continue; }
  fs.writeFileSync(file, xml);
  const g = t => (xml.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)) || [, ''])[1].trim();
  rows.push({
    id,
    kind: xml.includes('<VectorLayerDefinition>') ? 'vector'
        : xml.includes('<GridLayerDefinition>') ? 'RASTER' : 'other',
    fs: g('ResourceId'), cls: g('FeatureName'), geom: g('Geometry'),
    tip: g('ToolTip').replace(/^'|'$/g, ''),
  });
}

fs.writeFileSync(path.join(__dirname, 'raw', muni, 'layerdefs_resolved.json'), JSON.stringify(rows, null, 1));
for (const r of rows) {
  if (r.err) { console.log(`ERR    ${r.id}  ${r.err}`); continue; }
  console.log(`${r.kind.padEnd(6)} ${r.cls.padEnd(58)} geom=${(r.geom || '-').padEnd(10)} ${r.tip}`);
}
const v = rows.filter(r => r.kind === 'vector');
console.log(`\n${v.length} vector / ${rows.length} layers; FeatureSources: ${[...new Set(v.map(r => r.fs))].join(', ')}`);
