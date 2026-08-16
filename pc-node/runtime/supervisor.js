'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const ROOT = process.env.ATLAS_ROOT || 'C:/ProgramData/AtlasHost';
const REPO = 'eutopiacore-maker/atlas-window';
const API = `https://api.github.com/repos/${REPO}`;
const RAW = `https://raw.githubusercontent.com/${REPO}/main`;
const TOKEN = process.env.ATLAS_GH_TOKEN || '';
const SLOT = process.env.ATLAS_SLOT || 'A';
const CURRENT = path.join(ROOT, 'slots', SLOT);
const STATE_DIR = path.join(ROOT, 'state');
const LOG_DIR = path.join(ROOT, 'logs');
const WEB_DIR = path.join(ROOT, 'web');
const WORLD_DIR = path.join(ROOT, 'world');
const LOCAL_PORT = 8765;
const POLL_MS = 20000;

for (const d of [STATE_DIR, LOG_DIR, WEB_DIR, WORLD_DIR]) fs.mkdirSync(d, { recursive: true });

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(v => typeof v === 'string' ? v : JSON.stringify(v)).join(' ')}\n`;
  fs.appendFileSync(path.join(LOG_DIR, 'supervisor.log'), line);
  if (process.env.ATLAS_FOREGROUND === '1') process.stdout.write(line);
}

function jsonRead(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

function request(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = {
      'User-Agent': 'Atlas-Host/0.1',
      'Accept': 'application/vnd.github+json',
      ...options.headers
    };
    if (TOKEN && u.hostname === 'api.github.com') headers.Authorization = `Bearer ${TOKEN}`;
    const req = https.request(u, { method: options.method || 'GET', headers, timeout: options.timeout || 15000 }, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getJson(url, auth = false) {
  const r = await request(url, { headers: auth && TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {} });
  if (r.status < 200 || r.status >= 300) throw new Error(`HTTP ${r.status} ${url}`);
  return JSON.parse(r.body.toString('utf8'));
}

async function getRepoText(repoPath) {
  const j = await getJson(`${API}/contents/${repoPath}?ref=main`);
  if (!j.content) throw new Error(`No content for ${repoPath}`);
  return { text: Buffer.from(j.content, 'base64').toString('utf8'), sha: j.sha };
}

async function putRepoText(repoPath, text, message) {
  if (!TOKEN) return false;
  let sha = null;
  try { sha = (await getJson(`${API}/contents/${repoPath}?ref=main`, true)).sha; } catch {}
  const payload = JSON.stringify({ message, content: Buffer.from(text, 'utf8').toString('base64'), branch: 'main', ...(sha ? { sha } : {}) });
  const r = await request(`${API}/contents/${repoPath}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' } }, payload);
  if (r.status < 200 || r.status >= 300) throw new Error(`PUT ${repoPath} -> ${r.status}: ${r.body.toString('utf8').slice(0, 300)}`);
  return true;
}

function getNodeId() {
  const f = path.join(STATE_DIR, 'node-id.txt');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  const id = `atlas-${crypto.randomBytes(8).toString('hex')}`;
  atomicWrite(f, `${id}\n`);
  return id;
}

function gpuInventory() {
  if (process.platform !== 'win32') return [];
  try {
    const ps = spawnSync('powershell.exe', ['-NoProfile', '-Command', "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion | ConvertTo-Json -Compress"], { encoding: 'utf8', timeout: 10000 });
    if (ps.status !== 0 || !ps.stdout.trim()) return [];
    const v = JSON.parse(ps.stdout.trim());
    return Array.isArray(v) ? v : [v];
  } catch { return []; }
}

function inventory() {
  return {
    hostname: os.hostname(),
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().map(c => c.model),
    cpuCount: os.cpus().length,
    ramBytes: os.totalmem(),
    freeRamBytes: os.freemem(),
    gpus: gpuInventory(),
    nodeVersion: process.version,
    uptimeSeconds: os.uptime()
  };
}

const nodeId = getNodeId();
let desired = null;
let catalog = null;
let worldProc = null;
let lastRepoStatus = 0;
let lastDesiredPull = 0;
let lastWebSync = 0;
let online = false;
let restartRequested = false;
let startedAt = new Date().toISOString();

function worldStatus() {
  return jsonRead(path.join(WORLD_DIR, 'runtime-status.json'), { state: 'STARTING' });
}

function currentStatus() {
  const w = worldStatus();
  return {
    schema: 2,
    nodeId,
    state: online ? 'ONLINE' : 'OFFLINE',
    online,
    startedAt,
    lastSeen: new Date().toISOString(),
    slot: SLOT,
    runtimeVersion: jsonRead(path.join(CURRENT, 'version.json'), { version: '0.1.0' }).version,
    inventory: inventory(),
    world: w,
    desiredGeneration: desired?.generation ?? null,
    requestedAddons: desired?.addons?.requested || [],
    translatorHealthy: false,
    transportHealthy: online,
    endpoint: `http://127.0.0.1:${LOCAL_PORT}`
  };
}

async function syncStatus() {
  const s = currentStatus();
  atomicWrite(path.join(STATE_DIR, 'node-status.json'), JSON.stringify(s, null, 2));
  if (TOKEN && Date.now() - lastRepoStatus > 60000) {
    try {
      await putRepoText(`pc-node/nodes/${nodeId}.json`, JSON.stringify(s, null, 2) + '\n', `Atlas node status ${nodeId}`);
      lastRepoStatus = Date.now();
    } catch (e) { log('status publish failed', e.message); }
  }
}

function ensureWorld() {
  if (worldProc && worldProc.exitCode === null) return;
  const entry = path.join(CURRENT, 'world-runtime.js');
  worldProc = spawn(process.execPath, [entry, '--daemon'], {
    cwd: CURRENT,
    env: { ...process.env, ATLAS_ROOT: ROOT, ATLAS_GH_TOKEN: TOKEN },
    stdio: ['ignore', 'ignore', 'ignore'],
    windowsHide: true
  });
  worldProc.on('exit', code => { log('world runtime exited', code); worldProc = null; });
  log('world runtime started');
}

async function pullDesired() {
  if (Date.now() - lastDesiredPull < POLL_MS) return;
  lastDesiredPull = Date.now();
  try {
    const d = JSON.parse((await getRepoText('pc-node/desired-state.json')).text);
    desired = d;
    const c = JSON.parse((await getRepoText('addons/catalog.json')).text);
    catalog = c;
    online = true;
    atomicWrite(path.join(STATE_DIR, 'desired-state.json'), JSON.stringify(d, null, 2));
  } catch (e) {
    online = false;
    log('desired-state pull failed', e.message);
    desired = desired || jsonRead(path.join(STATE_DIR, 'desired-state.json'), null);
  }
}

const WEB_FILES = [
  'index.html','world.html','world.js','dynamics.html','dynamics.js','appearance.html',
  'appearance-scene.js','appearance-decoder.json','eutopia-detail.js','host.html'
];

async function syncWeb() {
  if (!online || Date.now() - lastWebSync < 5 * 60 * 1000) return;
  lastWebSync = Date.now();
  for (const p of WEB_FILES) {
    try {
      const { text } = await getRepoText(p);
      atomicWrite(path.join(WEB_DIR, p), text);
    } catch (e) { log('web sync failed', p, e.message); }
  }
  try {
    const { text } = await getRepoText('addons/catalog.json');
    atomicWrite(path.join(WEB_DIR, 'addons-catalog.json'), text);
  } catch {}
}

function mime(file) {
  const e = path.extname(file).toLowerCase();
  return ({ '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml' })[e] || 'application/octet-stream';
}

function safeWebPath(urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0]);
  if (p === '/') p = '/host.html';
  p = p.replace(/^\/+/, '');
  const full = path.normalize(path.join(WEB_DIR, p));
  return full.startsWith(path.normalize(WEB_DIR)) ? full : null;
}

function sendJson(res, code, obj) {
  const b = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { 'Content-Type':'application/json; charset=utf-8','Content-Length':b.length,'Cache-Control':'no-store' });
  res.end(b);
}

function handleApi(req, res, body) {
  if (req.method === 'GET' && req.url.startsWith('/api/status')) return sendJson(res, 200, currentStatus());
  if (req.method === 'GET' && req.url.startsWith('/api/addons')) return sendJson(res, 200, catalog || { schema:1, addons:[] });
  if (req.method === 'POST' && req.url.startsWith('/api/addons/install')) {
    let j = null; try { j = JSON.parse(body || '{}'); } catch {}
    if (!j?.id) return sendJson(res, 400, { ok:false, error:'missing id' });
    const reqFile = path.join(STATE_DIR, 'local-addon-requests.json');
    const q = jsonRead(reqFile, { requested:[] });
    if (!q.requested.includes(j.id)) q.requested.push(j.id);
    atomicWrite(reqFile, JSON.stringify(q, null, 2));
    return sendJson(res, 202, { ok:true, queued:j.id, note:'Capability installer resolves approved packages from desired state/catalog.' });
  }
  return false;
}

function startHttp() {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', d => chunks.push(d));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      if (req.url.startsWith('/api/') && handleApi(req, res, body) !== false) return;
      const full = safeWebPath(req.url);
      if (!full || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
        res.writeHead(404, { 'Content-Type':'text/plain; charset=utf-8' });
        return res.end('Not found');
      }
      const b = fs.readFileSync(full);
      res.writeHead(200, { 'Content-Type':mime(full),'Content-Length':b.length,'Cache-Control':'no-store' });
      res.end(b);
    });
  });
  server.listen(LOCAL_PORT, '127.0.0.1', () => log('local UI listening', LOCAL_PORT));
  return server;
}

async function checkCoreUpdate() {
  if (!online) return;
  let manifest;
  try { manifest = JSON.parse((await getRepoText('pc-node/core-manifest.json')).text); } catch { return; }
  const local = jsonRead(path.join(CURRENT, 'version.json'), { version:'0.0.0' });
  if (!manifest.version || manifest.version === local.version) return;
  const inactive = SLOT === 'A' ? 'B' : 'A';
  const stage = path.join(ROOT, 'slots', inactive);
  const tmp = `${stage}.staging`;
  try {
    fs.rmSync(tmp, { recursive:true, force:true });
    fs.mkdirSync(tmp, { recursive:true });
    for (const f of manifest.files || []) {
      const { text, sha } = await getRepoText(f.source);
      if (f.gitBlobSha && f.gitBlobSha !== sha) throw new Error(`hash mismatch ${f.source}`);
      const out = path.join(tmp, f.target);
      fs.mkdirSync(path.dirname(out), { recursive:true });
      fs.writeFileSync(out, text);
    }
    fs.writeFileSync(path.join(tmp, 'version.json'), JSON.stringify({ version:manifest.version, generation:manifest.generation, installedAt:new Date().toISOString() }, null, 2));
    for (const js of ['supervisor.js','world-runtime.js']) {
      const r = spawnSync(process.execPath, ['--check', path.join(tmp, js)], { encoding:'utf8' });
      if (r.status !== 0) throw new Error(`${js} syntax check failed: ${r.stderr}`);
    }
    const self = spawnSync(process.execPath, [path.join(tmp, 'supervisor.js'), '--self-test'], { env:{...process.env, ATLAS_ROOT:ROOT, ATLAS_SLOT:inactive}, encoding:'utf8', timeout:15000 });
    if (self.status !== 0) throw new Error(`self-test failed: ${self.stderr || self.stdout}`);
    fs.rmSync(stage, { recursive:true, force:true });
    fs.renameSync(tmp, stage);
    atomicWrite(path.join(ROOT, 'state', 'last-known-good-slot.txt'), `${SLOT}\n`);
    atomicWrite(path.join(ROOT, 'state', 'active-slot.txt'), `${inactive}\n`);
    log('core update staged and activated', manifest.version, inactive);
    restartRequested = true;
  } catch (e) {
    fs.rmSync(tmp, { recursive:true, force:true });
    log('core update rejected', e.message);
  }
}

async function tick() {
  await pullDesired();
  await syncWeb();
  ensureWorld();
  await syncStatus();
  await checkCoreUpdate();
  if (restartRequested) process.exit(75);
}

async function selfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-supervisor-'));
  atomicWrite(path.join(tmp, 'a.txt'), 'ok');
  if (fs.readFileSync(path.join(tmp, 'a.txt'), 'utf8') !== 'ok') throw new Error('atomic write failed');
  const inv = inventory();
  if (!inv.arch || !inv.cpuCount) throw new Error('inventory failed');
  fs.rmSync(tmp, { recursive:true, force:true });
  console.log('Atlas supervisor self-test OK');
}

if (process.argv.includes('--self-test')) {
  selfTest().catch(e => { console.error(e); process.exit(1); });
} else {
  startHttp();
  tick().catch(e => log('initial tick failed', e.message));
  setInterval(() => tick().catch(e => log('tick failed', e.message)), 5000);
  process.on('SIGTERM', () => { try { worldProc?.kill(); } catch {} process.exit(0); });
  process.on('uncaughtException', e => log('uncaughtException', e.stack || e.message));
  process.on('unhandledRejection', e => log('unhandledRejection', String(e?.stack || e)));
}
