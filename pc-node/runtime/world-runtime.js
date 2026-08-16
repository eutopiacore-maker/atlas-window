'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { spawnSync } = require('child_process');

const ROOT = process.env.ATLAS_ROOT || 'C:/ProgramData/AtlasHost';
const WORLD = path.join(ROOT, 'world');
const STATE = path.join(WORLD, 'world-state.json');
const STATUS = path.join(WORLD, 'runtime-status.json');
const CHECKPOINTS = path.join(WORLD, 'checkpoints');
const REPO = 'eutopiacore-maker/atlas-window';
const API = `https://api.github.com/repos/${REPO}`;
const TOKEN = process.env.ATLAS_GH_TOKEN || '';
const STEP_MS = 15 * 60 * 1000;
const LOOP_MS = 60 * 1000;
const SUPPORT = ['world-engine.js','geodata-node.js','regional-nature-node.js','landscape-phase.js','nature-source-registry.json'];

for (const d of [WORLD, CHECKPOINTS]) fs.mkdirSync(d, { recursive:true });

function writeStatus(extra = {}) {
  const base = {
    schema:2,
    state:'RUNNING',
    pid:process.pid,
    updatedAt:new Date().toISOString(),
    localWorldState:fs.existsSync(STATE),
    ...extra
  };
  const tmp = `${STATUS}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(base, null, 2));
  fs.renameSync(tmp, STATUS);
}

function request(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = { 'User-Agent':'Atlas-World-Runtime/0.1','Accept':'application/vnd.github+json', ...options.headers };
    if (TOKEN && u.hostname === 'api.github.com') headers.Authorization = `Bearer ${TOKEN}`;
    const req = https.request(u, { method:options.method || 'GET', headers, timeout:15000 }, res => {
      const chunks=[]; res.on('data',d=>chunks.push(d)); res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks)}));
    });
    req.on('timeout',()=>req.destroy(new Error('timeout'))); req.on('error',reject); if(body)req.write(body); req.end();
  });
}

async function getRepoText(repoPath) {
  const r = await request(`${API}/contents/${repoPath}?ref=main`);
  if (r.status < 200 || r.status >= 300) throw new Error(`GET ${repoPath} ${r.status}`);
  const j = JSON.parse(r.body.toString('utf8'));
  return Buffer.from(j.content, 'base64').toString('utf8');
}

async function putRepoText(repoPath, text, message) {
  if (!TOKEN) return false;
  let sha = null;
  const g = await request(`${API}/contents/${repoPath}?ref=main`);
  if (g.status >= 200 && g.status < 300) sha = JSON.parse(g.body.toString('utf8')).sha;
  const payload = JSON.stringify({ message, content:Buffer.from(text).toString('base64'), branch:'main', ...(sha?{sha}:{}) });
  const r = await request(`${API}/contents/${repoPath}`, { method:'PUT', headers:{'Content-Type':'application/json'} }, payload);
  if (r.status < 200 || r.status >= 300) throw new Error(`PUT ${repoPath} ${r.status}: ${r.body.toString('utf8').slice(0,200)}`);
  return true;
}

async function bootstrapWorldFiles() {
  if (!fs.existsSync(STATE)) {
    const text = await getRepoText('world-state.json');
    fs.writeFileSync(STATE, text);
  }
  for (const f of SUPPORT) {
    try {
      const text = await getRepoText(f);
      fs.writeFileSync(path.join(WORLD, f), text);
    } catch (e) {
      if (!fs.existsSync(path.join(WORLD, f))) throw e;
    }
  }
  patchEngine();
}

function patchEngine() {
  const srcFile = path.join(WORLD, 'world-engine.js');
  const outFile = path.join(WORLD, 'world-engine.local.js');
  let s = fs.readFileSync(srcFile, 'utf8');
  const beforePulse = 'function pulse(s){const now=new Date(),r=R(';
  const afterPulse = "function pulse(s){const now=new Date(process.env.ATLAS_NOW||Date.now()),r=R(";
  if (s.includes(beforePulse)) s = s.replace(beforePulse, afterPulse);
  else if (!s.includes('process.env.ATLAS_NOW')) throw new Error('world-engine pulse patch point missing');

  const beforeMain = 's=await official(s);s=ensure(s);s=await enrich(s);s=pulse(s);';
  const afterMain = "if(process.env.ATLAS_SKIP_REMOTE!=='1')s=await official(s);s=ensure(s);if(process.env.ATLAS_SKIP_REMOTE!=='1')s=await enrich(s);s=pulse(s);";
  if (s.includes(beforeMain)) s = s.replace(beforeMain, afterMain);
  else if (!s.includes('ATLAS_SKIP_REMOTE')) throw new Error('world-engine remote patch point missing');
  fs.writeFileSync(outFile, s);
}

function nodeRun(file, env = {}) {
  const r = spawnSync(process.execPath, [file], { cwd:WORLD, env:{...process.env,...env}, encoding:'utf8', timeout:10*60*1000 });
  if (r.status !== 0) throw new Error(`${path.basename(file)} failed: ${r.stderr || r.stdout}`);
}

function checkpoint(label) {
  if (!fs.existsSync(STATE)) return;
  const safe = label.replace(/[^a-zA-Z0-9_.-]/g,'_');
  fs.copyFileSync(STATE, path.join(CHECKPOINTS, `${safe}.json`));
  const files = fs.readdirSync(CHECKPOINTS).filter(x=>x.endsWith('.json')).sort();
  while (files.length > 12) fs.rmSync(path.join(CHECKPOINTS, files.shift()), {force:true});
}

function readWorld() { return JSON.parse(fs.readFileSync(STATE, 'utf8')); }

function runCausalStep(at, remote = false) {
  const iso = new Date(at).toISOString();
  const env = { ATLAS_NOW:iso, ATLAS_SKIP_REMOTE:remote?'0':'1' };
  nodeRun(path.join(WORLD, 'world-engine.local.js'), env);
  for (const f of ['regional-nature-node.js','landscape-phase.js']) {
    const p = path.join(WORLD, f);
    if (fs.existsSync(p)) nodeRun(p, env);
  }
}

async function catchUp() {
  const before = readWorld();
  const now = Date.now();
  let cursor = Date.parse(before.updatedAt || new Date(now).toISOString());
  if (!Number.isFinite(cursor)) cursor = now;
  if (cursor > now + 60000) cursor = now;
  const gap = Math.max(0, now - cursor);
  if (gap < 60000) {
    writeStatus({ state:'IDLE', cycle:before.cycle, caughtUpThrough:before.updatedAt, backlogMs:gap });
    return false;
  }

  checkpoint(`pre-catchup-${Date.now()}`);
  let steps = 0;
  try {
    while (cursor + 60000 < now) {
      cursor = Math.min(now, cursor + STEP_MS);
      runCausalStep(cursor, false);
      steps++;
      if (steps % 8 === 0) writeStatus({ state:'CATCHING_UP', steps, caughtUpThrough:new Date(cursor).toISOString(), backlogMs:Math.max(0,now-cursor) });
    }
    const w = readWorld();
    writeStatus({ state:'IDLE', cycle:w.cycle, caughtUpThrough:w.updatedAt, backlogMs:0, lastCatchupSteps:steps });
    return steps > 0;
  } catch (e) {
    writeStatus({ state:'ERROR', error:e.message, lastCatchupSteps:steps });
    throw e;
  }
}

async function refreshRemoteContextIfUseful() {
  if (!TOKEN) return false;
  const metaFile = path.join(WORLD, 'remote-refresh.json');
  let meta = {}; try { meta = JSON.parse(fs.readFileSync(metaFile,'utf8')); } catch {}
  if (Date.now() - Date.parse(meta.at || 0) < 6*60*60*1000) return false;
  try {
    const t = Date.now();
    runCausalStep(t, true);
    fs.writeFileSync(metaFile, JSON.stringify({at:new Date(t).toISOString()},null,2));
    return true;
  } catch { return false; }
}

async function publishWorld() {
  if (!TOKEN) return false;
  try {
    const text = fs.readFileSync(STATE, 'utf8');
    await putRepoText('world-state.json', text, 'Eutopia host world sync');
    const status = fs.existsSync(STATUS) ? fs.readFileSync(STATUS,'utf8') : '{}';
    await putRepoText('pc-node/world-runtime-status.json', status, 'Eutopia host runtime status');
    return true;
  } catch (e) {
    writeStatus({ state:'WAITING_NETWORK', error:e.message });
    return false;
  }
}

async function claimAuthority() {
  if (!TOKEN) return false;
  const nodeIdFile = path.join(ROOT,'state','node-id.txt');
  const nodeId = fs.existsSync(nodeIdFile) ? fs.readFileSync(nodeIdFile,'utf8').trim() : null;
  const doc = { schema:1, authority:'atlas-host', nodeId, claimedAt:new Date().toISOString(), rule:'single-writer causal authority; GitHub heartbeat becomes observer-only while Atlas Host is authoritative' };
  try { await putRepoText('pc-node/world-authority.json', JSON.stringify(doc,null,2)+'\n', 'Atlas Host claims causal world authority'); return true; }
  catch { return false; }
}

async function cycle() {
  await bootstrapWorldFiles();
  await catchUp();
  await refreshRemoteContextIfUseful();
  await claimAuthority();
  await publishWorld();
}

async function selfTest() {
  const sample = "function pulse(s){const now=new Date(),r=R(1);return s}\nasync function main(){let s={};s=await official(s);s=ensure(s);s=await enrich(s);s=pulse(s);}";
  let p = sample.replace('function pulse(s){const now=new Date(),r=R(', "function pulse(s){const now=new Date(process.env.ATLAS_NOW||Date.now()),r=R(");
  p = p.replace('s=await official(s);s=ensure(s);s=await enrich(s);s=pulse(s);', "if(process.env.ATLAS_SKIP_REMOTE!=='1')s=await official(s);s=ensure(s);if(process.env.ATLAS_SKIP_REMOTE!=='1')s=await enrich(s);s=pulse(s);");
  if (!p.includes('ATLAS_NOW') || !p.includes('ATLAS_SKIP_REMOTE')) throw new Error('patch self-test failed');
  console.log('Atlas world runtime self-test OK');
}

async function daemon() {
  writeStatus({state:'STARTING'});
  while (true) {
    try { await cycle(); }
    catch (e) { writeStatus({state:'ERROR',error:e.message}); }
    await new Promise(r=>setTimeout(r,LOOP_MS));
  }
}

if (process.argv.includes('--self-test')) selfTest().catch(e=>{console.error(e);process.exit(1)});
else if (process.argv.includes('--daemon')) daemon();
else cycle().catch(e=>{console.error(e);process.exit(1)});
