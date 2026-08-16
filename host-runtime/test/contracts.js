'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert');
const repo=path.resolve(__dirname,'../..');
const engine=fs.readFileSync(path.join(repo,'world-engine.js'),'utf8');
assert(engine.includes("F='world-state.json',TARGET=4.5,SCALE=12,C="),'world-engine scale patch contract changed');
assert(engine.includes('s=await official(s);s=ensure(s);s=await enrich(s);s=pulse(s);'),'world-engine offline patch contract changed');
const rel=JSON.parse(fs.readFileSync(path.join(repo,'host-runtime/release.json'),'utf8'));
const checks=[...rel.files,...['launcher','ui'].map(k=>rel[k])];
let bad=0;
for(const f of checks){const p=path.join(repo,f.source);const h=crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');console.log(`${f.source} actual=${h} expected=${f.sha256}`);if(h!==f.sha256)bad++}
assert.strictEqual(bad,0,`${bad} release hashes do not match`);
console.log('Atlas Host contract tests passed');
