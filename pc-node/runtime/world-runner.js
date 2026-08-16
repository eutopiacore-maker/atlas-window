'use strict';
const fs=require('fs');
const path=require('path');
const {spawnSync}=require('child_process');

const worldDir=process.env.ATLAS_WORLD_DIR||process.cwd();
const stateFile=path.join(worldDir,'world-state.json');
const shim=path.join(__dirname,'world-shim.js');
const virtualRunner=path.join(__dirname,'virtual-runner.js');
const timeScale=Number(process.env.ATLAS_TIME_SCALE||1);
const offline=process.env.ATLAS_OFFLINE==='1';
const target=new Date(process.env.ATLAS_TARGET_TIME||new Date().toISOString());
if(!fs.existsSync(stateFile))throw new Error('world-state.json missing');
if(!fs.existsSync(shim)||!fs.existsSync(virtualRunner))throw new Error('virtual clock runtime missing');
if(!Number.isFinite(target.getTime()))throw new Error('invalid target time');
if(!Number.isFinite(timeScale)||timeScale<=0||timeScale>100)throw new Error('invalid time scale');

function state(){return JSON.parse(fs.readFileSync(stateFile,'utf8'))}
function runNode(file,virtualNow,args=[]){const env={...process.env,ATLAS_WORLD_DIR:worldDir,ATLAS_VIRTUAL_NOW:virtualNow.toISOString(),ATLAS_TIME_SCALE:String(timeScale),ATLAS_OFFLINE:offline?'1':'0'};const r=spawnSync(process.execPath,[file,...args],{cwd:worldDir,env,encoding:'utf8',timeout:180000,windowsHide:true});if(r.error)throw r.error;if(r.status!==0)throw new Error(`${path.basename(file)} exit ${r.status}: ${(r.stderr||r.stdout||'').slice(0,1800)}`)}
function runPlain(rel,virtualNow){const file=path.join(worldDir,rel);if(!fs.existsSync(file))return;const env={...process.env,ATLAS_SCRIPT:file,ATLAS_OFFLINE:offline?'1':'0',ATLAS_VIRTUAL_NOW:virtualNow.toISOString()};const r=spawnSync(process.execPath,[virtualRunner],{cwd:worldDir,env,encoding:'utf8',timeout:120000,windowsHide:true});if(r.error)throw r.error;if(r.status!==0)throw new Error(`${rel} exit ${r.status}: ${(r.stderr||r.stdout||'').slice(0,1800)}`)}

let s=state(),cursor=new Date(s.updatedAt||target);if(!Number.isFinite(cursor.getTime()))cursor=new Date(target);if(cursor>target)cursor=new Date(target);
let remaining=Math.max(0,(target-cursor)/60000),cycles=0;const maxCycles=Number(process.env.ATLAS_MAX_CATCHUP_CYCLES||10000);
while(remaining>=0.5&&cycles<maxCycles){let stepMin=Math.min(15,remaining);if(remaining>7*24*60)stepMin=Math.min(120,remaining);else if(remaining>3*24*60)stepMin=Math.min(60,remaining);const step=new Date(cursor.getTime()+stepMin*60000);runNode(shim,step);runPlain('regional-nature-node.js',step);runPlain('landscape-phase.js',step);cursor=step;remaining=Math.max(0,(target-cursor)/60000);cycles++}
if(remaining>=0.5)throw new Error(`catch-up exceeded ${maxCycles} cycles; ${Math.round(remaining)} real minutes remain`);
const out=state();process.stdout.write(JSON.stringify({ok:true,cycles,target:target.toISOString(),updatedAt:out.updatedAt,worldCycle:out.cycle,timeScale})+'\n');
