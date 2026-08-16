'use strict';
const fs=require('fs');
const path=require('path');
const {spawnSync}=require('child_process');

const ROOT=process.cwd();
const STATE=path.join(ROOT,'world-state.json');
const SHIM=path.join(ROOT,'host-node','runtime','virtual-clock.js');
const ENGINE=path.join(ROOT,'world-engine.js');
const LANDSCAPE=path.join(ROOT,'landscape-phase.js');
const MAX_STEP_MINUTES=120;
const MAX_STEPS_PER_RUN=256;

function readState(){return JSON.parse(fs.readFileSync(STATE,'utf8'));}
function run(script,virtualNow){
  const env={...process.env,ATLAS_VIRTUAL_NOW:new Date(virtualNow).toISOString()};
  const r=spawnSync(process.execPath,['-r',SHIM,script],{cwd:ROOT,env,encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024});
  if(r.status!==0){
    const msg=(r.stderr||r.stdout||`exit ${r.status}`).trim();
    throw new Error(`${path.basename(script)} failed: ${msg}`);
  }
  return (r.stdout||'').trim();
}

function validTime(v){const n=Date.parse(v);return Number.isFinite(n)?n:null;}

function main(){
  if(!fs.existsSync(STATE)) throw new Error('world-state.json missing');
  if(!fs.existsSync(ENGINE)) throw new Error('world-engine.js missing');
  if(!fs.existsSync(SHIM)) throw new Error('virtual-clock.js missing');

  const target=Date.now();
  let state=readState();
  let cursor=validTime(state.updatedAt);
  if(cursor===null) cursor=target-MAX_STEP_MINUTES*60_000;
  if(cursor>target) cursor=target;

  let steps=0;
  while(cursor<target && steps<MAX_STEPS_PER_RUN){
    const next=Math.min(target,cursor+MAX_STEP_MINUTES*60_000);
    run(ENGINE,next);
    if(fs.existsSync(LANDSCAPE)) run(LANDSCAPE,next);
    state=readState();
    const observed=validTime(state.updatedAt);
    cursor=observed!==null && observed>cursor ? observed : next;
    steps++;
  }

  const remaining=Math.max(0,target-cursor);
  const result={
    ok:true,
    steps,
    caughtUp:remaining<60_000,
    remainingMinutes:+(remaining/60_000).toFixed(2),
    offline:process.env.ATLAS_OFFLINE==='1',
    cycle:state.cycle,
    updatedAt:state.updatedAt
  };
  process.stdout.write(JSON.stringify(result)+'\n');
}

try{main();}catch(e){console.error(e&&e.stack||String(e));process.exit(1);}
