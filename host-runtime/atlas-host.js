'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const VERSION = '0.1.0';
const REPO = 'eutopiacore-maker/atlas-window';
const RAW = `https://raw.githubusercontent.com/${REPO}/main`;
const DEFAULT_ROOT = process.platform === 'win32'
  ? path.join(process.env.ProgramData || 'C:\\ProgramData', 'Atlas')
  : path.join(os.tmpdir(), 'atlas-host');
const ROOT = process.env.ATLAS_ROOT || DEFAULT_ROOT;
const PORT = Number(process.env.ATLAS_PORT || 8765);
const TEST_MODE = process.argv.includes('--test-mode') || process.env.ATLAS_TEST_MODE === '1';
const NO_SERVER = process.argv.includes('--no-server');

const P = {
  root: ROOT,
  config: path.join(ROOT, 'config'),
  state: path.join(ROOT, 'state'),
  logs: path.join(ROOT, 'logs'),
  ui: path.join(ROOT, 'ui'),
  world: path.join(ROOT, 'world'),
  addons: path.join(ROOT, 'addons'),
  cache: path.join(ROOT, 'cache'),
  slots: path.join(ROOT, 'slots'),
  control: path.join(ROOT, 'control'),
};

const FILES = {
  nodeConfig: path.join(P.config, 'node.json'),
  localStatus: path.join(P.state, 'node-status.json'),
  activity: path.join(P.logs, 'activity.ndjson'),
  installedAddons: path.join(P.state, 'installed-addons.json'),
  processedJobs: path.join(P.state, 'processed-jobs.json'),
  desiredState: path.join(P.control, 'desired-state.json'),
  remoteJobs: path.join(P.control, 'remote-jobs.json'),
  catalog: path.join(P.control, 'catalog.json'),
  worldState: path.join(P.world, 'world-state.json'),
};

let nodeConfig = {};
let hardware = null;
let desiredState = null;
let catalog = { schema: 1, addons: [] };
let online = false;
let lastError = null;
let worldBusy = false;
let shuttingDown = false;
let server = null;

function nowIso() { return new Date().toISOString(); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function clampText(v, n = 6000) { return String(v ?? '').slice(0, n); }
function ensureDirs() { for (const d of Object.values(P)) fs.mkdirSync(d, { recursive: true }); }
function readJson(file, fallback = null) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
function writeJson(file, obj) { atomicWrite(file, JSON.stringify(obj, null, 2) + '\n'); }
function sha256Buffer(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function sha256File(file) { return sha256Buffer(fs.readFileSync(file)); }
function safeId(v) { return String(v || '').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 140); }
function isPathInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function journal(type, details = {}) {
  const entry = { at: nowIso(), type, ...details };
  fs.mkdirSync(path.dirname(FILES.activity), { recursive: true });
  fs.appendFileSync(FILES.activity, JSON.stringify(entry) + '\n');
  try {
    const lines = fs.readFileSync(FILES.activity, 'utf8').trim().split(/\r?\n/);
    if (lines.length > 1500) atomicWrite(FILES.activity, lines.slice(-1200).join('\n') + '\n');
  } catch {}
  return entry;
}

async function fetchBuffer(url, { timeoutMs = 12000, method = 'GET', headers = {}, body = null } = {}) {
  if (TEST_MODE && /^https?:/.test(url) && process.env.ATLAS_ALLOW_TEST_NETWORK !== '1') {
    throw new Error('network disabled in test mode');
  }
  return await new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.request(url, { method, headers }, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if ((res.statusCode || 500) >= 200 && (res.statusCode || 500) < 300) resolve(buf);
        else reject(new Error(`HTTP ${res.statusCode} ${url}: ${buf.toString('utf8').slice(0, 240)}`));
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout ${url}`)));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
async function fetchJson(url, opts) { return JSON.parse((await fetchBuffer(url, opts)).toString('utf8')); }
async function downloadVerified(url, dest, expectedSha256) {
  const data = await fetchBuffer(url, { timeoutMs: 60000 });
  const hash = sha256Buffer(data);
  if (expectedSha256 && hash.toLowerCase() !== String(expectedSha256).toLowerCase()) {
    throw new Error(`hash mismatch for ${url}`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  atomicWrite(dest, data);
  return hash;
}

async function detectHardware() {
  const base = {
    hostname: os.hostname(), platform: os.platform(), release: os.release(), arch: os.arch(),
    cpu: { model: os.cpus()?.[0]?.model || null, logicalCores: os.cpus()?.length || null },
    ramBytes: os.totalmem(), freeRamBytes: os.freemem(), gpu: [], node: process.version,
  };
  if (process.platform === 'win32') {
    try {
      const script = "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion | ConvertTo-Json -Compress";
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 10000, windowsHide: true });
      let g = JSON.parse(stdout.trim() || '[]');
      if (!Array.isArray(g)) g = [g];
      base.gpu = g.map(x => ({ name: x.Name || null, adapterRamBytes: Number(x.AdapterRAM || 0) || null, driverVersion: x.DriverVersion || null }));
    } catch (e) { base.gpuDetectionError = clampText(e.message, 500); }
  }
  return base;
}

function loadConfig() {
  nodeConfig = readJson(FILES.nodeConfig, {});
  if (!nodeConfig.nodeId) {
    nodeConfig.nodeId = `atlas-${crypto.randomBytes(10).toString('hex')}`;
    nodeConfig.createdAt = nowIso();
    nodeConfig.telemetryTopic = nodeConfig.telemetryTopic || null;
    nodeConfig.repo = REPO;
    writeJson(FILES.nodeConfig, nodeConfig);
  }
}

function currentWorldSummary() {
  const w = readJson(FILES.worldState, null);
  if (!w) return null;
  return {
    cycle: w.cycle ?? null,
    updatedAt: w.updatedAt ?? null,
    simMinutes: w.simMinutes ?? null,
    timeScale: w.timeScale ?? null,
    phase: w.phase?.current ?? w.metrics?.phase ?? null,
    population: w.metrics?.population ?? null,
    plants: w.metrics?.plants ?? (Array.isArray(w.plants) ? w.plants.length : null),
  };
}

function statusSnapshot() {
  const installed = readJson(FILES.installedAddons, { addons: {} });
  return {
    schema: 2,
    nodeId: nodeConfig.nodeId || null,
    state: shuttingDown ? 'STOPPING' : 'RUNNING',
    online,
    hostVersion: VERSION,
    startedAt: nodeConfig.lastStartedAt || null,
    lastSeen: nowIso(),
    hardware,
    world: currentWorldSummary(),
    installedAddons: Object.keys(installed.addons || {}),
    desiredGeneration: desiredState?.generation ?? null,
    lastError,
  };
}

function persistStatus() { writeJson(FILES.localStatus, statusSnapshot()); }

async function publishTelemetry(event = 'heartbeat', extra = {}) {
  const topic = nodeConfig.telemetryTopic;
  if (!topic || TEST_MODE) return;
  const payload = { event, ...statusSnapshot(), ...extra };
  try {
    await fetchBuffer(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: 'POST', timeoutMs: 7000,
      headers: { 'Content-Type': 'application/json', 'Title': `Atlas ${event}`, 'Tags': 'computer' },
      body: Buffer.from(JSON.stringify(payload)),
    });
  } catch (e) { /* telemetry is never allowed to break the host */ }
}

async function checkOnline() {
  try {
    await fetchBuffer(`${RAW}/pc-node/desired-state.json?ts=${Date.now()}`, { timeoutMs: 6000 });
    return true;
  } catch { return false; }
}

async function syncControlPlane() {
  try {
    const [d, c, j] = await Promise.all([
      fetchJson(`${RAW}/pc-node/desired-state.json?ts=${Date.now()}`, { timeoutMs: 10000 }),
      fetchJson(`${RAW}/addons/catalog.json?ts=${Date.now()}`, { timeoutMs: 10000 }),
      fetchJson(`${RAW}/pc-node/remote-jobs.json?ts=${Date.now()}`, { timeoutMs: 10000 }).catch(() => ({ schema: 1, generation: 0, jobs: [] })),
    ]);
    online = true;
    desiredState = d; catalog = c;
    writeJson(FILES.desiredState, d); writeJson(FILES.catalog, c); writeJson(FILES.remoteJobs, j);
    await processRemoteJobs(j);
    await maybeUpdateRuntime(d);
    lastError = null;
  } catch (e) {
    online = false;
    desiredState = desiredState || readJson(FILES.desiredState, null);
    catalog = readJson(FILES.catalog, catalog);
    lastError = `control: ${clampText(e.message, 600)}`;
  }
  persistStatus();
}

function processedState() { return readJson(FILES.processedJobs, { ids: {}, lastGeneration: 0 }); }
function markJob(id, result) {
  const s = processedState();
  s.ids[id] = { at: nowIso(), ...result };
  const keys = Object.keys(s.ids);
  if (keys.length > 500) for (const k of keys.slice(0, keys.length - 400)) delete s.ids[k];
  writeJson(FILES.processedJobs, s);
}

async function processRemoteJobs(doc) {
  if (!doc || !Array.isArray(doc.jobs)) return;
  const done = processedState().ids || {};
  for (const job of doc.jobs) {
    const id = safeId(job.id);
    if (!id || done[id]) continue;
    try {
      let result;
      switch (job.type) {
        case 'install-addon': result = await installAddon(job.addonId, { source: 'remote-job' }); break;
        case 'remove-addon': result = await removeAddon(job.addonId); break;
        case 'diagnostics': result = { hardware: await detectHardware(), world: currentWorldSummary() }; break;
        case 'world-cycle': result = await runWorldCycle({ reason: 'remote-job', force: true }); break;
        case 'sync-assets': result = await syncWorldAssets(); break;
        case 'restart-host':
          markJob(id, { ok: true, result: 'restart scheduled' });
          journal('remote-job', { id, jobType: job.type, ok: true });
          await publishTelemetry('restart-requested', { jobId: id });
          setTimeout(() => process.exit(42), 350);
          return;
        default: throw new Error(`unsupported job type: ${job.type}`);
      }
      markJob(id, { ok: true, result });
      journal('remote-job', { id, jobType: job.type, ok: true });
      await publishTelemetry('job-complete', { jobId: id, jobType: job.type });
    } catch (e) {
      markJob(id, { ok: false, error: clampText(e.message, 1200) });
      journal('remote-job', { id, jobType: job.type, ok: false, error: clampText(e.message, 800) });
      await publishTelemetry('job-failed', { jobId: id, jobType: job.type, error: clampText(e.message, 800) });
    }
  }
}

function addonById(id) { return (catalog.addons || []).find(a => a.id === id); }
async function installAddon(id, { source = 'ui' } = {}) {
  const addon = addonById(id);
  if (!addon) throw new Error(`addon not found: ${id}`);
  if (!addon.installable || !addon.manifest) throw new Error(`addon not installable: ${id}`);
  const manifestUrl = addon.manifest.startsWith('http') ? addon.manifest : `${RAW}/${addon.manifest.replace(/^\//, '')}`;
  const manifest = await fetchJson(manifestUrl, { timeoutMs: 15000 });
  if (manifest.id !== id) throw new Error('manifest id mismatch');
  const version = safeId(manifest.version);
  if (!version || !Array.isArray(manifest.files)) throw new Error('invalid addon manifest');
  const stage = path.join(P.addons, '.staging', `${safeId(id)}-${version}-${Date.now()}`);
  const finalDir = path.join(P.addons, safeId(id), 'versions', version);
  fs.mkdirSync(stage, { recursive: true });
  try {
    for (const f of manifest.files) {
      const rel = String(f.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
      if (!rel || rel.includes('..')) throw new Error(`unsafe addon path: ${rel}`);
      const dest = path.join(stage, rel);
      if (!isPathInside(stage, dest)) throw new Error(`unsafe addon destination: ${rel}`);
      const u = String(f.url || '').startsWith('http') ? f.url : `${RAW}/${String(f.url || '').replace(/^\//, '')}`;
      await downloadVerified(u, dest, f.sha256);
    }
    if (manifest.health?.type === 'file-exists') {
      const hp = path.join(stage, manifest.health.path || '');
      if (!isPathInside(stage, hp) || !fs.existsSync(hp)) throw new Error('addon health check failed');
    }
    fs.mkdirSync(path.dirname(finalDir), { recursive: true });
    if (!fs.existsSync(finalDir)) fs.renameSync(stage, finalDir); else fs.rmSync(stage, { recursive: true, force: true });
    const installed = readJson(FILES.installedAddons, { schema: 1, addons: {} });
    installed.addons[id] = { version, installedAt: nowIso(), source, path: finalDir, restartPolicy: manifest.restartPolicy || 'none' };
    writeJson(FILES.installedAddons, installed);
    journal('addon-installed', { addonId: id, version, source });
    await publishTelemetry('addon-installed', { addonId: id, version });
    return { addonId: id, version };
  } catch (e) {
    fs.rmSync(stage, { recursive: true, force: true });
    throw e;
  }
}
async function removeAddon(id) {
  const installed = readJson(FILES.installedAddons, { schema: 1, addons: {} });
  if (!installed.addons?.[id]) return { addonId: id, removed: false };
  delete installed.addons[id];
  writeJson(FILES.installedAddons, installed);
  journal('addon-disabled', { addonId: id });
  return { addonId: id, removed: true };
}

async function runChild(file, args = [], opts = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], {
      cwd: opts.cwd || path.dirname(file), env: { ...process.env, ...(opts.env || {}) }, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    child.stdout.on('data', d => out += d.toString()); child.stderr.on('data', d => err += d.toString());
    const timer = setTimeout(() => { child.kill(); reject(new Error(`timeout: ${path.basename(file)}`)); }, opts.timeoutMs || 120000);
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('exit', code => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout: out, stderr: err });
      else reject(new Error(`${path.basename(file)} exit ${code}: ${clampText(err || out, 2000)}`));
    });
  });
}

async function runWorldCycle({ reason = 'timer', force = false } = {}) {
  if (worldBusy) return { skipped: 'busy' };
  const engine = path.join(P.world, 'world-engine.js');
  if (!fs.existsSync(engine) || !fs.existsSync(FILES.worldState)) return { skipped: 'world-not-installed' };
  worldBusy = true;
  const backup = path.join(P.world, '.checkpoints', `world-${Date.now()}.json`);
  try {
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.copyFileSync(FILES.worldState, backup);
    const target = nowIso();
    const env = {
      ATLAS_TARGET_TIME: target,
      ATLAS_TIME_SCALE: String(desiredState?.worldRuntime?.timeScale ?? 1),
      ATLAS_OFFLINE: online ? '0' : '1',
      ATLAS_LOCAL_HOST: '1',
    };
    const runner = path.join(__dirname, 'world-runner.js');
    if (!fs.existsSync(runner)) throw new Error('world-runner.js missing from active runtime slot');
    await runChild(runner, [], { cwd: P.world, env: { ...env, ATLAS_WORLD_DIR: P.world }, timeoutMs: 10 * 60 * 1000 });
    const parsed = readJson(FILES.worldState, null);
    if (!parsed || !Number.isFinite(Number(parsed.cycle))) throw new Error('invalid world state after cycle');
    const checkpoints = fs.readdirSync(path.dirname(backup)).sort();
    for (const f of checkpoints.slice(0, Math.max(0, checkpoints.length - 12))) fs.rmSync(path.join(path.dirname(backup), f), { force: true });
    journal('world-cycle', { reason, cycle: parsed.cycle, updatedAt: parsed.updatedAt, online });
    return { cycle: parsed.cycle, updatedAt: parsed.updatedAt };
  } catch (e) {
    try { fs.copyFileSync(backup, FILES.worldState); } catch {}
    lastError = `world: ${clampText(e.message, 900)}`;
    journal('world-rollback', { reason, error: clampText(e.message, 900) });
    await publishTelemetry('world-rollback', { error: clampText(e.message, 800) });
    throw e;
  } finally { worldBusy = false; persistStatus(); }
}

async function syncWorldAssets() {
  if (!online && !TEST_MODE) throw new Error('offline');
  const assets = [
    'world-engine.js', 'geodata-node.js', 'regional-nature-node.js', 'landscape-phase.js',
    'world.html', 'index.html', 'dynamics.html', 'dynamics.js', 'appearance.html', 'appearance-scene.js', 'appearance-decoder.json'
  ];
  const stage = path.join(P.cache, `world-assets-${Date.now()}`);
  fs.mkdirSync(stage, { recursive: true });
  try {
    for (const rel of assets) {
      const data = await fetchBuffer(`${RAW}/${rel}?ts=${Date.now()}`, { timeoutMs: 20000 });
      atomicWrite(path.join(stage, rel), data);
    }
    const three = await fetchBuffer('https://cdn.jsdelivr.net/npm/three@0.168.0/build/three.module.js', { timeoutMs: 30000 });
    fs.mkdirSync(path.join(stage, 'vendor'), { recursive: true });
    atomicWrite(path.join(stage, 'vendor', 'three.module.js'), three);
    const dynPath = path.join(stage, 'dynamics.html');
    let dyn = fs.readFileSync(dynPath, 'utf8');
    dyn = dyn.replace("https://cdn.jsdelivr.net/npm/three@0.168.0/build/three.module.js", './vendor/three.module.js');
    atomicWrite(dynPath, dyn);
    for (const rel of [...assets, 'vendor/three.module.js']) {
      const src = path.join(stage, rel), dest = path.join(P.world, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
    if (!fs.existsSync(FILES.worldState)) {
      const state = await fetchBuffer(`${RAW}/world-state.json?ts=${Date.now()}`, { timeoutMs: 30000 });
      atomicWrite(FILES.worldState, state);
    }
    journal('world-assets-synced', { count: assets.length + 1 });
    return { synced: assets.length + 1 };
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}

async function maybeUpdateRuntime(d) {
  if (TEST_MODE || !d?.updates?.automatic) return;
  try {
    const rel = await fetchJson(`${RAW}/host-runtime/release.json?ts=${Date.now()}`, { timeoutMs: 10000 });
    if (!rel?.version || rel.version === VERSION || !Array.isArray(rel.files)) return;
    const currentSlotFile = path.join(ROOT, 'current-slot.txt');
    const current = (fs.existsSync(currentSlotFile) ? fs.readFileSync(currentSlotFile, 'utf8').trim() : 'A').toUpperCase() === 'B' ? 'B' : 'A';
    const inactive = current === 'A' ? 'B' : 'A';
    const stage = path.join(P.slots, `${inactive}.stage-${Date.now()}`);
    fs.mkdirSync(stage, { recursive: true });
    for (const f of rel.files) {
      const relPath = String(f.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
      if (!relPath || relPath.includes('..')) throw new Error('unsafe runtime release path');
      await downloadVerified(`${RAW}/${f.source.replace(/^\//, '')}`, path.join(stage, relPath), f.sha256);
    }
    if (!fs.existsSync(path.join(stage, 'atlas-host.js'))) throw new Error('runtime health: atlas-host.js missing');
    const final = path.join(P.slots, inactive);
    const old = `${final}.old-${Date.now()}`;
    if (fs.existsSync(final)) fs.renameSync(final, old);
    fs.renameSync(stage, final);
    atomicWrite(currentSlotFile, inactive + '\n');
    journal('runtime-staged', { from: VERSION, to: rel.version, slot: inactive });
    await publishTelemetry('runtime-staged', { from: VERSION, to: rel.version });
    setTimeout(() => process.exit(42), 500);
  } catch (e) {
    journal('runtime-update-failed', { error: clampText(e.message, 1000) });
  }
}

function recentActivity(limit = 80) {
  try {
    const lines = fs.readFileSync(FILES.activity, 'utf8').trim().split(/\r?\n/).filter(Boolean);
    return lines.slice(-limit).reverse().map(x => { try { return JSON.parse(x); } catch { return { raw: x }; } });
  } catch { return []; }
}
function mergedCatalog() {
  const installed = readJson(FILES.installedAddons, { addons: {} }).addons || {};
  return (catalog.addons || []).map(a => ({ ...a, installedVersion: installed[a.id]?.version || null, installed: !!installed[a.id] }));
}

function contentType(file) {
  const e = path.extname(file).toLowerCase();
  return ({ '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon' })[e] || 'application/octet-stream';
}
function sendJson(res, code, obj) { const b = Buffer.from(JSON.stringify(obj)); res.writeHead(code, { 'Content-Type':'application/json; charset=utf-8', 'Content-Length':b.length, 'Cache-Control':'no-store' }); res.end(b); }
async function readBody(req, max = 128 * 1024) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > max) throw new Error('request too large'); chunks.push(c); }
  return Buffer.concat(chunks).toString('utf8');
}
function serveFile(res, base, rel, fallback = null) {
  const clean = decodeURIComponent(rel.split('?')[0]).replace(/^\/+/, '');
  const file = path.join(base, clean || 'host.html');
  if (!isPathInside(base, file) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (fallback && fs.existsSync(fallback)) return serveAbsolute(res, fallback);
    res.writeHead(404); return res.end('Not found');
  }
  return serveAbsolute(res, file);
}
function serveAbsolute(res, file) { const b = fs.readFileSync(file); res.writeHead(200, { 'Content-Type': contentType(file), 'Content-Length': b.length, 'Cache-Control': 'no-cache' }); res.end(b); }

async function requestHandler(req, res) {
  try {
    const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (u.pathname === '/api/status' && req.method === 'GET') return sendJson(res, 200, statusSnapshot());
    if (u.pathname === '/api/addons' && req.method === 'GET') return sendJson(res, 200, { schema: 1, addons: mergedCatalog() });
    if (u.pathname === '/api/activity' && req.method === 'GET') return sendJson(res, 200, { events: recentActivity(Number(u.searchParams.get('limit') || 80)) });
    if (u.pathname === '/api/world/status' && req.method === 'GET') return sendJson(res, 200, currentWorldSummary() || {});
    if (u.pathname === '/api/addons/install' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req) || '{}');
      const result = await installAddon(body.id, { source: 'local-ui' });
      return sendJson(res, 200, { ok: true, result });
    }
    if (u.pathname === '/api/world/cycle' && req.method === 'POST') {
      const result = await runWorldCycle({ reason: 'local-ui', force: true });
      return sendJson(res, 200, { ok: true, result });
    }
    if (u.pathname.startsWith('/world/')) return serveFile(res, P.world, u.pathname.slice('/world/'.length));
    return serveFile(res, P.ui, u.pathname, path.join(P.ui, 'host.html'));
  } catch (e) { return sendJson(res, 500, { ok: false, error: clampText(e.message, 1200) }); }
}

async function startServer() {
  if (NO_SERVER) return;
  server = http.createServer((req, res) => requestHandler(req, res));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
  journal('local-api-listening', { port: PORT });
}

async function bootstrapRuntime() {
  ensureDirs(); loadConfig();
  nodeConfig.lastStartedAt = nowIso(); writeJson(FILES.nodeConfig, nodeConfig);
  hardware = await detectHardware();
  if (!fs.existsSync(FILES.installedAddons)) writeJson(FILES.installedAddons, { schema: 1, addons: {} });
  if (!fs.existsSync(FILES.processedJobs)) writeJson(FILES.processedJobs, { schema: 1, ids: {} });
  desiredState = readJson(FILES.desiredState, null);
  catalog = readJson(FILES.catalog, catalog);
  online = TEST_MODE ? false : await checkOnline();
  persistStatus(); journal('host-started', { version: VERSION, nodeId: nodeConfig.nodeId, online });
  if (!TEST_MODE) {
    if (online) {
      await syncControlPlane();
      if (!fs.existsSync(path.join(P.world, 'world-engine.js'))) await syncWorldAssets().catch(e => journal('world-assets-sync-failed', { error: clampText(e.message, 800) }));
    }
    await runWorldCycle({ reason: 'startup-catchup' }).catch(() => {});
  }
  await startServer();
  await publishTelemetry('host-started');
}

function scheduleLoops() {
  if (TEST_MODE) return;
  setInterval(() => syncControlPlane().catch(() => {}), Number(desiredState?.updates?.pollSeconds || 20) * 1000).unref();
  setInterval(() => runWorldCycle({ reason: 'clock' }).catch(() => {}), 15 * 60 * 1000).unref();
  setInterval(() => { hardware = detectHardware().catch(() => hardware); persistStatus(); }, 5 * 60 * 1000).unref();
  setInterval(() => publishTelemetry('heartbeat').catch(() => {}), 5 * 60 * 1000).unref();
}

async function shutdown(signal) {
  if (shuttingDown) return; shuttingDown = true;
  journal('host-stopping', { signal }); persistStatus();
  try { await publishTelemetry('host-stopping', { signal }); } catch {}
  if (server) await new Promise(r => server.close(() => r()));
  process.exit(0);
}

async function main() {
  await bootstrapRuntime(); scheduleLoops();
  if (TEST_MODE) return statusSnapshot();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', e => { lastError = `uncaught: ${clampText(e.stack || e.message, 1600)}`; journal('uncaught-exception', { error: lastError }); persistStatus(); });
process.on('unhandledRejection', e => { lastError = `unhandled: ${clampText(e?.stack || e, 1600)}`; journal('unhandled-rejection', { error: lastError }); persistStatus(); });

if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });

module.exports = {
  VERSION, ROOT, P, FILES, ensureDirs, readJson, writeJson, sha256Buffer, safeId,
  statusSnapshot, installAddon, removeAddon, processRemoteJobs, detectHardware,
  runWorldCycle, main, addonById, mergedCatalog, isPathInside,
  _setCatalog: c => { catalog = c; }, _setNodeConfig: c => { nodeConfig = c; },
};
