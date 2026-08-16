'use strict';

const fs=require('fs');
const path=require('path');
const os=require('os');
const https=require('https');
const {spawnSync}=require('child_process');

const ROOT=process.env.ATLAS_ROOT||'C:/ProgramData/AtlasHost';
const WORLD=path.join(ROOT,'world');
const WEB=path.join(ROOT,'web');
const STATE=path.join(WORLD,'world-state.json');
const STATUS=path.join(WORLD,'runtime-status.json');
const CHECKPOINTS=path.join(WORLD,'checkpoints');
const PACKAGE_META=path.join(WORLD,'package-meta.json');
const REPO='eutopiacore-maker/atlas-window';
const API=`https://api.github.com/repos/${REPO}`;
const TOKEN=process.env.ATLAS_GH_TOKEN||'';
const STEP_MS=15*60*1000;
const LOOP_MS=60*1000;
const REMOTE_PUBLISH_MS=15*60*1000;
for(const d of[WORLD,WEB,CHECKPOINTS])fs.mkdirSync(d,{recursive:true});

function readJson(f,d){try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return d}}
function atomic(f,t){fs.mkdirSync(path.dirname(f),{recursive:true});const x=f+'.tmp-'+process.pid;fs.writeFileSync(x,t);fs.renameSync(x,f)}
function status(extra={}){atomic(STATUS,JSON.stringify({schema:3,state:'RUNNING',pid:process.pid,updatedAt:new Date().toISOString(),localWorldState:fs.existsSync(STATE),package:readJson(PACKAGE_META,null),...extra},null,2));mirror()}
function mirror(){try{if(fs.existsSync(STATE))fs.copyFileSync(STATE,path.join(WEB,'world-state.json'));if(fs.existsSync(STATUS))fs.copyFileSync(STATUS,path.join(WEB,'world-runtime-status.json'))}catch{}}
function request(url,o={},body=null){return new Promise((resolve,reject)=>{const u=new URL(url),h={'User-Agent':'Atlas-World-Runtime/0.2','Accept':'application/vnd.github+json',...(o.headers||{})};if(TOKEN&&u.hostname==='api.github.com')h.Authorization=`Bearer ${TOKEN}`;const q=https.request(u,{method:o.method||'GET',headers:h,timeout:15000},r=>{const c=[];r.on('data',d=>c.push(d));r.on('end',()=>resolve({status:r.statusCode,body:Buffer.concat(c)}))});q.on('timeout',()=>q.destroy(Error('timeout')));q.on('error',reject);if(body)q.write(body);q.end()})}
async function repoText(p){const r=await request(`${API}/contents/${p}?ref=main`);if(r.status<200||r.status>=300)throw Error(`GET ${p} ${r.status}`);const j=JSON.parse(r.body.toString('utf8'));return{text:Buffer.from(j.content,'base64').toString('utf8'),sha:j.sha}}
async function putRepoText(p,text,msg){if(!TOKEN)return false;let sha=null;const g=await request(`${API}/contents/${p}?ref=main`);if(g.status>=200&&g.status<300)sha=JSON.parse(g.body.toString('utf8')).sha;const body=JSON.stringify({message:msg,content:Buffer.from(text).toString('base64'),branch:'main',...(sha?{sha}:{})});const r=await request(`${API}/contents/${p}`,{method:'PUT',headers:{'Content-Type':'application/json'}},body);if(r.status<200||r.status>=300)throw Error(`PUT ${p} ${r.status}`);return true}

function patchEngine(dir){const f=path.join(dir,'world-engine.js'),out=path.join(dir,'world-engine.local.js');let s=fs.readFileSync(f,'utf8');const a='function pulse(s){const now=new Date(),r=R(',b="function pulse(s){const now=new Date(process.env.ATLAS_NOW||Date.now()),r=R(";if(s.includes(a))s=s.replace(a,b);else if(!s.includes('process.env.ATLAS_NOW'))throw Error('world-engine clock patch point missing');const c='s=await official(s);s=ensure(s);s=await enrich(s);s=pulse(s);',d="if(process.env.ATLAS_SKIP_REMOTE!=='1')s=await official(s);s=ensure(s);if(process.env.ATLAS_SKIP_REMOTE!=='1')s=await enrich(s);s=pulse(s);";if(s.includes(c))s=s.replace(c,d);else if(!s.includes('ATLAS_SKIP_REMOTE'))throw Error('world-engine remote patch point missing');fs.writeFileSync(out,s)}
function nodeCheck(f){const r=spawnSync(process.execPath,['--check',f],{encoding:'utf8',timeout:30000});if(r.status!==0)throw Error(`${path.basename(f)} syntax: ${r.stderr||r.stdout}`)}
function nodeRun(f,env={}){const r=spawnSync(process.execPath,[f],{cwd:WORLD,env:{...process.env,...env},encoding:'utf8',timeout:10*60*1000});if(r.status!==0)throw Error(`${path.basename(f)} failed: ${r.stderr||r.stdout}`)}
function checkpoint(label){if(!fs.existsSync(STATE))return null;const f=path.join(CHECKPOINTS,label.replace(/[^a-zA-Z0-9_.-]/g,'_')+'.json');fs.copyFileSync(STATE,f);const all=fs.readdirSync(CHECKPOINTS).filter(x=>x.endsWith('.json')).sort();while(all.length>12)fs.rmSync(path.join(CHECKPOINTS,all.shift()),{force:true});return f}
function latestCheckpoint(){const a=fs.readdirSync(CHECKPOINTS).filter(x=>x.endsWith('.json')).sort();return a.length?path.join(CHECKPOINTS,a[a.length-1]):null}
function restoreCheckpoint(){const f=latestCheckpoint();if(f){fs.copyFileSync(f,STATE);mirror();return true}return false}

async function ensureState(){if(fs.existsSync(STATE)){mirror();return}const g=await repoText('world-state.json');atomic(STATE,g.text);checkpoint('initial-'+Date.now());mirror()}
async function ensureWorldPackage(){
  const local=readJson(PACKAGE_META,null);let manifest=null;
  try{manifest=JSON.parse((await repoText('pc-node/world-manifest.json')).text)}catch{if(local&&fs.existsSync(path.join(WORLD,'world-engine.local.js')))return;if(fs.existsSync(path.join(WORLD,'world-engine.js'))){patchEngine(WORLD);return}throw Error('No local causal package and repository unavailable')}
  if(local?.generation===manifest.generation&&fs.existsSync(path.join(WORLD,'world-engine.local.js')))return;
  const stage=path.join(WORLD,'package-stage'),backup=path.join(WORLD,'code-last-known-good');fs.rmSync(stage,{recursive:true,force:true});fs.mkdirSync(stage,{recursive:true});
  try{
    for(const f of manifest.files||[]){const g=await repoText(f.source);if(f.gitBlobSha&&g.sha!==f.gitBlobSha)throw Error(`world package hash mismatch ${f.source}`);const out=path.join(stage,f.target);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,g.text)}
    for(const f of manifest.files||[])if(f.target.endsWith('.js'))nodeCheck(path.join(stage,f.target));patchEngine(stage);nodeCheck(path.join(stage,'world-engine.local.js'));
    checkpoint('pre-world-package-'+Date.now());fs.rmSync(backup,{recursive:true,force:true});fs.mkdirSync(backup,{recursive:true});
    if(local)for(const f of fs.readdirSync(WORLD)){if(['world-engine.js','world-engine.local.js','geodata-node.js','regional-nature-node.js','landscape-phase.js','nature-source-registry.json'].includes(f)&&fs.statSync(path.join(WORLD,f)).isFile())fs.copyFileSync(path.join(WORLD,f),path.join(backup,f))}
    for(const f of fs.readdirSync(stage))fs.copyFileSync(path.join(stage,f),path.join(WORLD,f));atomic(PACKAGE_META,JSON.stringify({schema:1,generation:manifest.generation,version:manifest.version,activatedAt:new Date().toISOString()},null,2));fs.rmSync(stage,{recursive:true,force:true})
  }catch(e){fs.rmSync(stage,{recursive:true,force:true});throw e}
}
function rollbackWorldCode(){const b=path.join(WORLD,'code-last-known-good');if(!fs.existsSync(b))return false;for(const f of fs.readdirSync(b))fs.copyFileSync(path.join(b,f),path.join(WORLD,f));return true}
function readWorld(){return JSON.parse(fs.readFileSync(STATE,'utf8'))}
function runStep(at,remote=false){const env={ATLAS_NOW:new Date(at).toISOString(),ATLAS_SKIP_REMOTE:remote?'0':'1'};nodeRun(path.join(WORLD,'world-engine.local.js'),env);for(const f of['regional-nature-node.js','landscape-phase.js']){const p=path.join(WORLD,f);if(fs.existsSync(p))nodeRun(p,env)}mirror()}

async function catchUp(){const before=readWorld(),now=Date.now();let cursor=Date.parse(before.updatedAt||new Date(now).toISOString());if(!Number.isFinite(cursor)||cursor>now+60000)cursor=now;const gap=Math.max(0,now-cursor);if(gap<60000){status({state:'IDLE',cycle:before.cycle,caughtUpThrough:before.updatedAt,backlogMs:gap});return false}checkpoint('pre-catchup-'+Date.now());let steps=0;try{while(cursor+60000<now){cursor=Math.min(now,cursor+STEP_MS);runStep(cursor,false);steps++;if(steps%8===0)status({state:'CATCHING_UP',steps,caughtUpThrough:new Date(cursor).toISOString(),backlogMs:Math.max(0,now-cursor)})}const w=readWorld();status({state:'IDLE',cycle:w.cycle,caughtUpThrough:w.updatedAt,backlogMs:0,lastCatchupSteps:steps});return steps>0}catch(e){restoreCheckpoint();rollbackWorldCode();status({state:'ERROR',error:e.message,lastCatchupSteps:steps,rolledBack:true});throw e}}
async function refreshRemote(){if(!TOKEN)return false;const f=path.join(WORLD,'remote-refresh.json'),m=readJson(f,{});if(Date.now()-Date.parse(m.at||0)<6*60*60*1000)return false;try{runStep(Date.now(),true);atomic(f,JSON.stringify({at:new Date().toISOString()},null,2));return true}catch{return false}}
async function claim(){if(!TOKEN)return false;const idf=path.join(ROOT,'state','node-id.txt'),id=fs.existsSync(idf)?fs.readFileSync(idf,'utf8').trim():null;const d={schema:1,authority:'atlas-host',nodeId:id,claimedAt:new Date().toISOString(),rule:'single-writer causal authority; GitHub heartbeat becomes observer-only while Atlas Host is authoritative'};try{await putRepoText('pc-node/world-authority.json',JSON.stringify(d,null,2)+'\n','Atlas Host claims causal world authority');return true}catch{return false}}
async function publish(force=false){if(!TOKEN)return false;const meta=path.join(WORLD,'publish-meta.json'),m=readJson(meta,{});if(!force&&Date.now()-Date.parse(m.at||0)<REMOTE_PUBLISH_MS)return false;try{await putRepoText('world-state.json',fs.readFileSync(STATE,'utf8'),'Eutopia host world sync');await putRepoText('pc-node/world-runtime-status.json',fs.readFileSync(STATUS,'utf8'),'Eutopia host runtime status');atomic(meta,JSON.stringify({at:new Date().toISOString()},null,2));return true}catch(e){status({state:'WAITING_NETWORK',error:e.message});return false}}
async function cycle(){await ensureState();await ensureWorldPackage();await catchUp();await refreshRemote();await claim();await publish();mirror()}
async function selfTest(){const sample="function pulse(s){const now=new Date(),r=R(1);return s}\nasync function main(){let s={};s=await official(s);s=ensure(s);s=await enrich(s);s=pulse(s);}";let p=sample.replace('function pulse(s){const now=new Date(),r=R(',"function pulse(s){const now=new Date(process.env.ATLAS_NOW||Date.now()),r=R(");p=p.replace('s=await official(s);s=ensure(s);s=await enrich(s);s=pulse(s);',"if(process.env.ATLAS_SKIP_REMOTE!=='1')s=await official(s);s=ensure(s);if(process.env.ATLAS_SKIP_REMOTE!=='1')s=await enrich(s);s=pulse(s);");if(!p.includes('ATLAS_NOW')||!p.includes('ATLAS_SKIP_REMOTE'))throw Error('patch self-test failed');console.log('Atlas world runtime self-test OK')}
async function daemon(){status({state:'STARTING'});while(true){try{await cycle()}catch(e){status({state:'ERROR',error:e.message})}await new Promise(r=>setTimeout(r,LOOP_MS))}}
if(process.argv.includes('--self-test'))selfTest().catch(e=>{console.error(e);process.exit(1)});else if(process.argv.includes('--daemon'))daemon();else cycle().catch(e=>{console.error(e);process.exit(1)});
