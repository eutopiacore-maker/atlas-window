'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert'),{spawnSync}=require('child_process');
const repo=path.resolve(__dirname,'../..');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'atlas-world-offline-'));
for(const f of ['world-engine.js','geodata-node.js','regional-nature-node.js','landscape-phase.js','nature-source-registry.json','world-state.json'])fs.copyFileSync(path.join(repo,f),path.join(dir,f));
const before=JSON.parse(fs.readFileSync(path.join(dir,'world-state.json'),'utf8'));
const start=new Date(before.updatedAt||Date.now());
const target=new Date(start.getTime()+20*60*1000).toISOString();
const r=spawnSync(process.execPath,[path.join(repo,'host-runtime/world-runner.js')],{
  cwd:dir,encoding:'utf8',timeout:180000,
  env:{...process.env,ATLAS_WORLD_DIR:dir,ATLAS_TARGET_TIME:target,ATLAS_TIME_SCALE:'1',ATLAS_OFFLINE:'1',ATLAS_MAX_CATCHUP_CYCLES:'20'}
});
if(r.error)throw r.error;
if(r.status!==0)throw new Error(`offline runner failed ${r.status}: ${r.stderr||r.stdout}`);
const after=JSON.parse(fs.readFileSync(path.join(dir,'world-state.json'),'utf8'));
assert(Number(after.cycle)>Number(before.cycle),'world cycle did not advance');
assert(new Date(after.updatedAt).getTime()>=new Date(target).getTime()-60000,'world did not catch up to target wall clock');
assert.strictEqual(Number(after.timeScale),1,'local world must default to real-time scale 1');
assert(after.landscape?.budget,'landscape phase did not execute');
console.log(JSON.stringify({ok:true,beforeCycle:before.cycle,afterCycle:after.cycle,beforeAt:before.updatedAt,afterAt:after.updatedAt,target},null,2));
