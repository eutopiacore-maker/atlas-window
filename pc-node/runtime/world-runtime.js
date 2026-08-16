'use strict';

const fs=require('fs');
const path=require('path');
const https=require('https');
const {spawnSync}=require('child_process');

const ROOT=process.env.ATLAS_ROOT||'C:/ProgramData/AtlasHost';
const WORLD=path.join(ROOT,'world');
const WEB=path.join(ROOT,'web');
const STATE=path.join(WORLD,'world-state.json');
const STATUS=path.join(WORLD,'runtime-status.json');
const CHECKPOINTS=path.join(WORLD,'checkpoints');
const PACKAGE_META=path.join(WORLD,'package-meta.json');
const AUTH_META=path.join(WORLD,'authority-meta.json');
const REPO='eutopiacore-maker/atlas-window';
const API=`https://api.github.com/repos/${REPO}`;
const TOKEN=process.env.ATLAS_GH_TOKEN||'';
const LOOP_MS=60*1000;
const REMOTE_PUBLISH_MS=15*60*1000;
const AUTH_RECHECK_MS=15*60*1000;
const WORLD_FILES=['world-engine.js','geodata-node.js','regional-nature-node.js','landscape-phase.js','nature-source-registry.json'];
for(const d of[WORLD,WEB,CHECKPOINTS])fs.mkdirSync(d,{recursive:true});

function readJson(f,d){try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return d}}
function atomic(f,t){fs.mkdirSync(path.dirname(f),{recursive:true});const x=f+'.tmp-'+process.pid;fs.writeFileSync(x,t);fs.renameSync(x,f)}
function mirror(){try{if(fs.existsSync(STATE))fs.copyFileSync(STATE,path.join(WEB,'world-state.json'));if(fs.existsSync(STATUS))fs.copyFileSync(STATUS,path.join(WEB,'world-runtime-status.json'))}catch{}}
function setStatus(extra={}){const w=readJson(STATE,{});atomic(STATUS,JSON.stringify({schema:4,state:'RUNNING',pid:process.pid,updatedAt:new Date().toISOString(),localWorldState:fs.existsSync(STATE),cycle:w.cycle??null,caughtUpThrough:w.updatedAt??null,timeScale:configuredTimeScale(),package:readJson(PACKAGE_META,null),...extra},null,2));mirror()}
function request(url,o={},body=null){return new Promise((resolve,reject)=>{const u=new URL(url),h={'User-Agent':'Atlas-World-Runtime/0.3','Accept':'application/vnd.github+json',...(o.headers||{})};if(TOKEN&&u.hostname==='api.github.com')h.Authorization=`Bearer ${TOKEN}`;const q=https.request(u,{method:o.method||'GET',headers:h,timeout:15000},r=>{const c=[];r.on('data',d=>c.push(d));r.on('end',()=>resolve({status:r.statusCode,body:Buffer.concat(c)}))});q.on('timeout',()=>q.destroy(new Error('timeout')));q.on('error',reject);if(body)q.write(body);q.end()})}
async function repoText(p){const r=await request(`${API}/contents/${p}?ref=main`);if(r.status<200||r.status>=300)throw new Error(`GET ${p} ${r.status}`);const j=JSON.parse(r.body.toString('utf8'));return{text:Buffer.from(j.content,'base64').toString('utf8'),sha:j.sha}}
async function putRepoText(p,text,msg){if(!TOKEN)return false;let sha=null;const g=await request(`${API}/contents/${p}?ref=main`);if(g.status>=200&&g.status<300)sha=JSON.parse(g.body.toString('utf8')).sha;const body=JSON.stringify({message:msg,content:Buffer.from(text).toString('base64'),branch:'main',...(sha?{sha}:{})});const r=await request(`${API}/contents/${p}`,{method:'PUT',headers:{'Content-Type':'application/json'}},body);if(r.status<200||r.status>=300)throw new Error(`PUT ${p} ${r.status}`);return true}
function configuredTimeScale(){const d=readJson(path.join(ROOT,'state','desired-state.json'),{});const n=Number(d?.worldRuntime?.timeScale??1);return Number.isFinite(n)&&n>0&&n<=100?n:1}
function nodeCheck(f){const r=spawnSync(process.execPath,['--check',f],{encoding:'utf8',timeout:30000});if(r.status!==0)throw new Error(`${path.basename(f)} syntax: ${r.stderr||r.stdout}`)}
function checkpoint(label){if(!fs.existsSync(STATE))return null;const f=path.join(CHECKPOINTS,label.replace(/[^a-zA-Z0-9_.-]/g,'_')+'.json');fs.copyFileSync(STATE,f);const all=fs.readdirSync(CHECKPOINTS).filter(x=>x.endsWith('.json')).sort();while(all.length>16)fs.rmSync(path.join(CHECKPOINTS,all.shift()),{force:true});return f}
function latestCheckpoint(){const a=fs.readdirSync(CHECKPOINTS).filter(x=>x.endsWith('.json')).sort();return a.length?path.join(CHECKPOINTS,a[a.length-1]):null}
function restoreCheckpoint(){const f=latestCheckpoint();if(!f)return false;fs.copyFileSync(f,STATE);mirror();return true}

async function ensureState(){if(fs.existsSync(STATE)){mirror();return}const g=await repoText('world-state.json');atomic(STATE,g.text);checkpoint('initial-'+Date.now());mirror()}
async function ensureWorldPackage(){
  const local=readJson(PACKAGE_META,null);let manifest=null;
  try{manifest=JSON.parse((await repoText('pc-node/world-manifest.json')).text)}catch{if(local&&WORLD_FILES.every(f=>fs.existsSync(path.join(WORLD,f))))return;throw new Error('No verified local causal package and repository unavailable')}
  if(local?.generation===manifest.generation&&WORLD_FILES.every(f=>fs.existsSync(path.join(WORLD,f))))return;
  const stage=path.join(WORLD,'package-stage'),backup=path.join(WORLD,'code-last-known-good');fs.rmSync(stage,{recursive:true,force:true});fs.mkdirSync(stage,{recursive:true});
  try{
    for(const f of manifest.files||[]){const g=await repoText(f.source);if(f.gitBlobSha&&g.sha!==f.gitBlobSha)throw new Error(`world package hash mismatch ${f.source}`);const out=path.join(stage,f.target);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,g.text)}
    for(const f of manifest.files||[])if(f.target.endsWith('.js'))nodeCheck(path.join(stage,f.target));
    checkpoint('pre-world-package-'+Date.now());fs.rmSync(backup,{recursive:true,force:true});fs.mkdirSync(backup,{recursive:true});
    for(const f of WORLD_FILES)if(fs.existsSync(path.join(WORLD,f)))fs.copyFileSync(path.join(WORLD,f),path.join(backup,f));
    if(fs.existsSync(PACKAGE_META))fs.copyFileSync(PACKAGE_META,path.join(backup,'package-meta.json'));
    for(const f of fs.readdirSync(stage))fs.copyFileSync(path.join(stage,f),path.join(WORLD,f));
    atomic(PACKAGE_META,JSON.stringify({schema:1,generation:manifest.generation,version:manifest.version,activatedAt:new Date().toISOString()},null,2));fs.rmSync(stage,{recursive:true,force:true})
  }catch(e){fs.rmSync(stage,{recursive:true,force:true});throw e}
}
function rollbackWorldCode(){const b=path.join(WORLD,'code-last-known-good');if(!fs.existsSync(b))return false;for(const f of WORLD_FILES)if(fs.existsSync(path.join(b,f)))fs.copyFileSync(path.join(b,f),path.join(WORLD,f));const m=path.join(b,'package-meta.json');if(fs.existsSync(m))fs.copyFileSync(m,PACKAGE_META);return true}
function runTo(target){const runner=path.join(__dirname,'world-runner.js');const env={...process.env,ATLAS_WORLD_DIR:WORLD,ATLAS_TARGET_TIME:new Date(target).toISOString(),ATLAS_TIME_SCALE:String(configuredTimeScale()),ATLAS_OFFLINE:'1'};const r=spawnSync(process.execPath,[runner],{cwd:WORLD,env,encoding:'utf8',timeout:30*60*1000,windowsHide:true});if(r.error)throw r.error;if(r.status!==0)throw new Error(`world-runner exit ${r.status}: ${(r.stderr||r.stdout||'').slice(0,2200)}`);return JSON.parse((r.stdout||'{}').trim()||'{}')}
async function catchUp(){checkpoint('pre-catchup-'+Date.now());try{const result=runTo(Date.now()),w=readJson(STATE,{});setStatus({state:'IDLE',cycle:w.cycle??null,caughtUpThrough:w.updatedAt??null,backlogMs:0,lastCatchupCycles:result.cycles??0});return result}catch(e){restoreCheckpoint();rollbackWorldCode();setStatus({state:'ERROR',error:e.message,rolledBack:true});throw e}}
async function claim(){if(!TOKEN)return false;const idf=path.join(ROOT,'state','node-id.txt'),id=fs.existsSync(idf)?fs.readFileSync(idf,'utf8').trim():null,meta=readJson(AUTH_META,{}),last=Date.parse(meta.checkedAt||0);if(meta.nodeId===id&&meta.claimed===true&&Date.now()-last<AUTH_RECHECK_MS)return true;try{let remote=null;try{remote=JSON.parse((await repoText('pc-node/world-authority.json')).text)}catch{}if(remote?.authority==='atlas-host'&&remote?.nodeId===id){atomic(AUTH_META,JSON.stringify({claimed:true,nodeId:id,checkedAt:new Date().toISOString()},null,2));return true}const d={schema:1,authority:'atlas-host',nodeId:id,claimedAt:new Date().toISOString(),rule:'single-writer causal authority; GitHub heartbeat becomes observer-only while Atlas Host is authoritative'};await putRepoText('pc-node/world-authority.json',JSON.stringify(d,null,2)+'\n','Atlas Host claims causal world authority');atomic(AUTH_META,JSON.stringify({claimed:true,nodeId:id,checkedAt:new Date().toISOString()},null,2));return true}catch{return false}}
async function publish(force=false){if(!TOKEN)return false;const mf=path.join(WORLD,'publish-meta.json'),m=readJson(mf,{});if(!force&&Date.now()-Date.parse(m.at||0)<REMOTE_PUBLISH_MS)return false;try{await putRepoText('world-state.json',fs.readFileSync(STATE,'utf8'),'Eutopia host world sync');await putRepoText('pc-node/world-runtime-status.json',fs.readFileSync(STATUS,'utf8'),'Eutopia host runtime status');atomic(mf,JSON.stringify({at:new Date().toISOString()},null,2));return true}catch(e){setStatus({state:'WAITING_NETWORK',error:e.message});return false}}
async function cycle(){await ensureState();await ensureWorldPackage();await catchUp();await claim();await publish();mirror()}
async function selfTest(){for(const f of['world-runner.js','world-shim.js','virtual-runner.js']){const p=path.join(__dirname,f);if(!fs.existsSync(p))throw new Error(`${f} missing`);nodeCheck(p)}const engine=path.resolve(__dirname,'../../world-engine.js');if(fs.existsSync(engine)){const src=fs.readFileSync(engine,'utf8');if(!src.includes("F='world-state.json',TARGET=4.5,SCALE=12,C="))throw new Error('world-engine time-scale contract changed');if(!src.includes('s=await official(s);s=ensure(s);s=await enrich(s);s=pulse(s);'))throw new Error('world-engine offline contract changed')}console.log('Atlas world runtime self-test OK')}
async function daemon(){setStatus({state:'STARTING'});while(true){try{await cycle()}catch(e){setStatus({state:'ERROR',error:e.message})}await new Promise(r=>setTimeout(r,LOOP_MS))}}
if(process.argv.includes('--self-test'))selfTest().catch(e=>{console.error(e);process.exit(1)});else if(process.argv.includes('--daemon'))daemon();else cycle().catch(e=>{console.error(e);process.exit(1)});
