'use strict';
// Loads the canonical world-engine.js without modifying it on disk. The adapter only
// supplies a virtual wall clock, an optional real-time scale, and an offline mode.
const fs = require('fs');
const path = require('path');
const Module = require('module');

const worldDir = process.env.ATLAS_WORLD_DIR || process.cwd();
const engine = path.join(worldDir, 'world-engine.js');
if (!fs.existsSync(engine)) throw new Error(`world engine missing: ${engine}`);
const virtualNow = process.env.ATLAS_VIRTUAL_NOW || new Date().toISOString();
const realDate = Date;
const fixedMs = new realDate(virtualNow).getTime();
if (!Number.isFinite(fixedMs)) throw new Error('invalid ATLAS_VIRTUAL_NOW');
class AtlasDate extends realDate {
  constructor(...args) { super(...(args.length ? args : [fixedMs])); }
  static now() { return fixedMs; }
}
global.Date = AtlasDate;

let src = fs.readFileSync(engine, 'utf8');
const scale = Number(process.env.ATLAS_TIME_SCALE || 1);
if (!Number.isFinite(scale) || scale <= 0 || scale > 100) throw new Error('invalid ATLAS_TIME_SCALE');
src = src.replace("F='world-state.json',TARGET=4.5,SCALE=12,C=", `F='world-state.json',TARGET=4.5,SCALE=${scale},C=`);
if (process.env.ATLAS_OFFLINE === '1') {
  const needle = 's=await official(s);s=ensure(s);s=await enrich(s);s=pulse(s);';
  const replacement = "s=ensure(s);s=pulse(s);";
  if (!src.includes(needle)) throw new Error('world-engine offline patch contract changed');
  src = src.replace(needle, replacement);
}
const m = new Module(engine, module.parent);
m.filename = engine;
m.paths = Module._nodeModulePaths(worldDir);
m._compile(src, engine);
