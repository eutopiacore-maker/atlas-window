'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-host-test-'));
process.env.ATLAS_ROOT = root;
process.env.ATLAS_TEST_MODE = '1';
const host = require('../atlas-host.js');
host.ensureDirs();
host.writeJson(host.FILES.nodeConfig, { nodeId: 'test-node' });
host._setNodeConfig({ nodeId: 'test-node' });

assert(host.isPathInside(root, path.join(root, 'a', 'b')));
assert(!host.isPathInside(root, path.resolve(root, '..', 'escape')));
assert.strictEqual(host.safeId('../../bad'), '....bad');

const addonDir = path.join(root, 'fixture');
fs.mkdirSync(addonDir, { recursive: true });
const payload = Buffer.from('atlas diagnostics fixture\n');
const payloadSha = crypto.createHash('sha256').update(payload).digest('hex');
fs.writeFileSync(path.join(addonDir, 'diagnostics.txt'), payload);

const http = require('http');
let port;
const manifest = {
  schema: 1, id: 'atlas.host.diagnostics', version: '0.1.0', restartPolicy: 'none',
  files: [{ path: 'diagnostics.txt', url: '', sha256: payloadSha }],
  health: { type: 'file-exists', path: 'diagnostics.txt' }
};
const srv = http.createServer((req,res) => {
  if (req.url === '/manifest.json') { const x=Buffer.from(JSON.stringify(manifest)); res.writeHead(200,{'content-type':'application/json'}); return res.end(x); }
  if (req.url === '/diagnostics.txt') { res.writeHead(200); return res.end(payload); }
  res.writeHead(404);res.end();
});

(async()=>{
  await new Promise(r => srv.listen(0,'127.0.0.1',r)); port = srv.address().port;
  process.env.ATLAS_ALLOW_TEST_NETWORK = '1';
  manifest.files[0].url = `http://127.0.0.1:${port}/diagnostics.txt`;
  host._setCatalog({ addons:[{ id:'atlas.host.diagnostics', name:'Diagnostics', installable:true, manifest:`http://127.0.0.1:${port}/manifest.json` }] });
  const installed = await host.installAddon('atlas.host.diagnostics', { source:'test' });
  assert.strictEqual(installed.version, '0.1.0');
  const state = host.readJson(host.FILES.installedAddons, {addons:{}});
  assert(state.addons['atlas.host.diagnostics']);
  const hw = await host.detectHardware(); assert(hw.platform); assert(hw.cpu.logicalCores > 0);
  srv.close();
  console.log('Atlas Host smoke tests passed');
})().catch(e=>{console.error(e);srv.close();process.exit(1)});
