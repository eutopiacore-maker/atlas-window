'use strict';

const fs=require('fs');
const path=require('path');
const os=require('os');
const https=require('https');
const {spawnSync}=require('child_process');

const ROOT=process.env.ATLAS_ROOT||'C:/ProgramData/AtlasHost';
const REPO='eutopiacore-maker/atlas-window';
const API=`https://api.github.com/repos/${REPO}`;
const TOKEN=process.env.ATLAS_GH_TOKEN||'';
const ADDONS=path.join(ROOT,'addons');
const STATE=path.join(ROOT,'state');
const REGISTRY=path.join(ADDONS,'installed.json');
const STATUS=path.join(STATE,'addon-status.json');
for(const d of [ADDONS,STATE])fs.mkdirSync(d,{recursive:true});

function readJson(f,d){try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return d}}
function atomic(f,t){fs.mkdirSync(path.dirname(f),{recursive:true});const x=f+'.tmp-'+process.pid;fs.writeFileSync(x,t);fs.renameSync(x,f)}
function request(url){return new Promise((resolve,reject)=>{const u=new URL(url);const h={'User-Agent':'Atlas-Addon-Manager/0.1','Accept':'application/vnd.github+json'};if(TOKEN&&u.hostname==='api.github.com')h.Authorization=`Bearer ${TOKEN}`;const q=https.request(u,{headers:h,timeout:15000},r=>{const c=[];r.on('data',d=>c.push(d));r.on('end',()=>resolve({status:r.statusCode,body:Buffer.concat(c)}))});q.on('timeout',()=>q.destroy(new Error('timeout')));q.on('error',reject);q.end()})}
async function repoText(p){const r=await request(`${API}/contents/${p}?ref=main`);if(r.status<200||r.status>=300)throw Error(`GET ${p} ${r.status}`);const j=JSON.parse(r.body.toString('utf8'));return{text:Buffer.from(j.content,'base64').toString('utf8'),sha:j.sha}}
function registry(){return readJson(REGISTRY,{schema:1,addons:{}})}
function saveRegistry(r){atomic(REGISTRY,JSON.stringify(r,null,2))}
function setStatus(x){atomic(STATUS,JSON.stringify({schema:1,updatedAt:new Date().toISOString(),...x},null,2))}

async function loadInputs(){
  let desired=readJson(path.join(STATE,'desired-state.json'),{}),catalog=null;
  try{desired=JSON.parse((await repoText('pc-node/desired-state.json')).text);atomic(path.join(STATE,'desired-state.json'),JSON.stringify(desired,null,2))}catch{}
  try{catalog=JSON.parse((await repoText('addons/catalog.json')).text)}catch{catalog=readJson(path.join(ROOT,'web','addons-catalog.json'),{addons:[]})}
  const local=readJson(path.join(STATE,'local-addon-requests.json'),{requested:[]});
  const requested=[...new Set([...(desired?.addons?.requested||[]),...(local.requested||[])])];
  return{desired,catalog,local,requested};
}

async function installOne(id,catalog,stack=new Set()){
  if(stack.has(id))throw Error(`dependency cycle at ${id}`);stack.add(id);
  const entry=(catalog.addons||[]).find(a=>a.id===id);
  if(!entry)throw Error(`unknown add-on ${id}`);
  if(!entry.installable||!entry.manifest)throw Error(`${id} is not installable yet`);
  const reg=registry();
  if(reg.addons[id]?.version===entry.version&&reg.addons[id]?.healthy)return reg.addons[id];
  const manifest=JSON.parse((await repoText(entry.manifest)).text);
  if(manifest.id!==id||manifest.version!==entry.version)throw Error(`manifest identity mismatch for ${id}`);
  for(const dep of manifest.dependencies||[])await installOne(dep,catalog,new Set(stack));

  const base=path.join(ADDONS,id),stage=base+'.staging-'+Date.now(),target=path.join(base,manifest.version);
  fs.rmSync(stage,{recursive:true,force:true});fs.mkdirSync(stage,{recursive:true});
  try{
    for(const f of manifest.files||[]){const got=await repoText(f.source);if(f.gitBlobSha&&got.sha!==f.gitBlobSha)throw Error(`hash mismatch ${f.source}`);const out=path.join(stage,f.target);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,got.text)}
    if(manifest.health?.type==='node-self-test'){
      const entryPath=path.join(stage,manifest.health.entry);
      const r=spawnSync(process.execPath,[entryPath,'--self-test'],{encoding:'utf8',timeout:30000,env:{...process.env,ATLAS_ADDON_ROOT:stage}});
      if(r.status!==0)throw Error(`health test failed: ${r.stderr||r.stdout}`);
    }else if(manifest.health?.type){throw Error(`unsupported health type ${manifest.health.type}`)}
    fs.mkdirSync(base,{recursive:true});fs.rmSync(target,{recursive:true,force:true});fs.renameSync(stage,target);
    atomic(path.join(base,'current.json'),JSON.stringify({version:manifest.version,path:target,activatedAt:new Date().toISOString()},null,2));
    const next=registry();next.addons[id]={version:manifest.version,healthy:true,installedAt:new Date().toISOString(),capabilities:manifest.capabilities||[],restartPolicy:manifest.restartPolicy||'none'};saveRegistry(next);
    if((manifest.restartPolicy||'none')!=='none')atomic(path.join(STATE,'restart-request.json'),JSON.stringify({scope:manifest.restartPolicy,addon:id,at:new Date().toISOString()},null,2));
    return next.addons[id];
  }catch(e){fs.rmSync(stage,{recursive:true,force:true});throw e}
}

async function cycle(){
  const {catalog,local,requested}=await loadInputs();
  const results=[];
  for(const id of requested){try{const x=await installOne(id,catalog);results.push({id,state:'installed',version:x.version})}catch(e){results.push({id,state:'waiting-or-failed',error:e.message})}}
  const installed=registry();
  const done=new Set(Object.keys(installed.addons||{}));
  const remain=(local.requested||[]).filter(id=>!done.has(id));
  atomic(path.join(STATE,'local-addon-requests.json'),JSON.stringify({requested:remain},null,2));
  setStatus({state:'IDLE',requested,results,installed:installed.addons});
}

async function selfTest(){
  const t=fs.mkdtempSync(path.join(os.tmpdir(),'atlas-addon-'));
  const r={schema:1,addons:{x:{version:'1',healthy:true}}};
  const f=path.join(t,'r.json');fs.writeFileSync(f,JSON.stringify(r));if(readJson(f,{}).addons.x.version!=='1')throw Error('registry test failed');fs.rmSync(t,{recursive:true,force:true});console.log('Atlas add-on manager self-test OK')
}
async function daemon(){while(true){try{await cycle()}catch(e){setStatus({state:'ERROR',error:e.message})}await new Promise(r=>setTimeout(r,30000))}}
if(process.argv.includes('--self-test'))selfTest().catch(e=>{console.error(e);process.exit(1)});else if(process.argv.includes('--daemon'))daemon();else cycle().catch(e=>{console.error(e);process.exit(1)});
