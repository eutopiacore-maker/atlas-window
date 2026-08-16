'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const worldDir = process.env.ATLAS_WORLD_DIR || process.cwd();
const stateFile = path.join(worldDir, 'world-state.json');
const shim = path.join(__dirname, 'world-shim.js');
const virtualRunner = path.join(__dirname, 'virtual-runner.js');
const timeScale = Number(process.env.ATLAS_TIME_SCALE || 1);
const offline = process.env.ATLAS_OFFLINE === '1';
const target = new Date(process.env.ATLAS_TARGET_TIME || new Date().toISOString());
if (!fs.existsSync(stateFile)) throw new Error('world-state.json missing');
if (!fs.existsSync(shim)) throw new Error('world-shim.js missing');
if (!fs.existsSync(virtualRunner)) throw new Error('virtual-runner.js missing');
if (!Number.isFinite(target.getTime())) throw new Error('invalid target time');

function state() { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); }
function runNode(file, virtualNow, args = []) {
  const env = { ...process.env, ATLAS_WORLD_DIR: worldDir, ATLAS_VIRTUAL_NOW: virtualNow.toISOString(), ATLAS_TIME_SCALE: String(timeScale), ATLAS_OFFLINE: offline ? '1':'0' };
  const r = spawnSync(process.execPath, [file, ...args], { cwd: worldDir, env, encoding: 'utf8', timeout: 180000, windowsHide: true });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${path.basename(file)} exit ${r.status}: ${(r.stderr || r.stdout || '').slice(0,1600)}`);
}
function runPlain(rel, virtualNow) {
  const file = path.join(worldDir, rel);
  if (!fs.existsSync(file)) return;
  const env = { ...process.env, ATLAS_SCRIPT: file, ATLAS_OFFLINE: offline ? '1':'0', ATLAS_VIRTUAL_NOW: virtualNow.toISOString() };
  const r = spawnSync(process.execPath, [virtualRunner], { cwd: worldDir, env, encoding: 'utf8', timeout: 120000, windowsHide: true });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${rel} exit ${r.status}: ${(r.stderr || r.stdout || '').slice(0,1600)}`);
}

let s = state();
let cursor = new Date(s.updatedAt || target);
if (!Number.isFinite(cursor.getTime())) cursor = new Date(target);
const originalTarget = new Date(target);
let remainingMin = Math.max(0, (target - cursor) / 60000);
let cycles = 0;
const maxCycles = Number(process.env.ATLAS_MAX_CATCHUP_CYCLES || 1200);
while (remainingMin >= 0.5 && cycles < maxCycles) {
  let stepMin = Math.min(15, remainingMin);
  if (remainingMin > 7 * 24 * 60) stepMin = Math.min(120, remainingMin);
  else if (remainingMin > 3 * 24 * 60) stepMin = Math.min(60, remainingMin);
  const step = new Date(cursor.getTime() + stepMin * 60000);
  runNode(shim, step);
  runPlain('regional-nature-node.js', step);
  runPlain('landscape-phase.js', step);
  cursor = step;
  remainingMin = Math.max(0, (target - cursor) / 60000);
  cycles++;
}
if (cycles === 0) {
  const step = new Date(Math.max(target.getTime(), cursor.getTime() + 60000));
  runNode(shim, step);
  runPlain('regional-nature-node.js', step);
  runPlain('landscape-phase.js', step);
  cursor = step; cycles = 1;
}
if (remainingMin >= 0.5) throw new Error(`catch-up exceeded ${maxCycles} cycles; ${Math.round(remainingMin)} real minutes remain`);
const out = state();
process.stdout.write(JSON.stringify({ ok:true, cycles, target:originalTarget.toISOString(), updatedAt:out.updatedAt, worldCycle:out.cycle, timeScale:out.timeScale }) + '\n');
