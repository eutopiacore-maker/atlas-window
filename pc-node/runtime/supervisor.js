'use strict';

const fs=require('fs');
const path=require('path');
const os=require('os');
const http=require('http');
const https=require('https');
const crypto=require('crypto');
const {spawn,spawnSync}=require('child_process');

const ROOT=process.env.ATLAS_ROOT||'C:/ProgramData/AtlasHost';
const REPO='eutopiacore-maker/atlas-window';
const API=`https://api.github.com/repos/${REPO}`;
const TOKEN=process.env.ATLAS_GH_TOKEN||'';
const SLOT=process.env.ATLAS_SLOT||'A';
const CURRENT=path.join(ROOT,'slots',SLOT);
const STATE=path.join(ROOT,'state');
const LOGS=path.join(ROOT,'logs');
const WEB=path.join(ROOT,'web');
const WORLD=path.join(ROOT,'world');
const ADDONS=path.join(ROOT,'addons');
const PORT=8765;
for(const d of[STATE,LOGS,WEB,WORLD,ADDONS])fs.mkdirSync(d,{recursive:true});

function log(...a){const s=`[${new Date().toISOString()}] ${a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ')}\n`;fs.appendFileSync(path.join(LOGS,'supervisor.log'),s);if(process.env.ATLAS_FOREGROUND==='1')process.stdout.write(s)}
function readJson(f,d=null){try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return d}}
function atomic(f,t){fs.mkdirSync(path.dirname(f),{recursive:true});const q=f+'.tmp-'+process.pid;fs.writeFileSync(q,t);fs.renameSync(q,f)}
function request(url,o={},body=null){return new Promise((resolve,reject)=>{const u=new URL(url),h={'User-Agent':'Atlas-Host/0.1','Accept':'application/vnd.github+json',...(o.headers||{})};if(TOKEN&&u.hostname==='api.github.com')h.Authorization=`Bearer ${TOKEN}`;const q=https.request(u,{method:o.method||'GET',headers:h,timeout:o.timeout||15000},r=>{const c=[];r.on('data',d=>c.push(d));r.on('end',()=>resolve({status:r.statusCode,body:Buffer.concat(c)}))});q.on('timeout',()=>q.destroy(Error('timeout')));q.on('error',reject);if(body)q.write(body);q.end()})}
async function getJson(url){const r=await request(url);if(r.status<200||r.status>=300)throw Error(`HTTP ${r.status} ${url}`);return JSON.parse(r.body.toString('utf8'))}
async function repoText(p){const j=await getJson(`${API}/contents/${p}?ref=main`);if(!j.content)throw Error(`No content ${p}`);return{text:Buffer.from(j.content,'base64').toString('utf8'),sha:j.sha}}
async function putRepoText(p,text,msg){if(!TOKEN)return false;let sha=null;try{sha=(await getJson(`${API}/contents/${p}?ref=main`)).sha}catch{}const body=JSON.stringify({message:msg,content:Buffer.from(text).toString('base64'),branch:'main',...(sha?{sha}:{})});const r=await request(`${API}/contents/${p}`,{method:'PUT',headers:{'Content-Type':'application/json'}},body);if(r.status<200||r.status>=300)throw Error(`PUT ${p} ${r.status}`);return true}
function nodeId(){const f=path.join(STATE,'node-id.txt');if(fs.existsSync(f))return fs.readFileSync(f,'utf8').trim();const id='atlas-'+crypto.randomBytes(8).toString('hex');atomic(f,id+'\n');return id}
function gpu(){if(process.platform!=='win32')return[];try{const r=spawnSync('powershell.exe',['-NoProfile','-Command','Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion | ConvertTo-Json -Compress'],{encoding:'utf8',timeout:10000});if(r.status!==0||!r.stdout.trim())return[];const j=JSON.parse(r.stdout);return Array.isArray(j)?j:[j]}catch{return[]}}
function inventory(){return{hostname:os.hostname(),platform:process.platform,arch:process.arch,cpuCount:os.cpus().length,cpuModel:os.cpus()[0]?.model||null,ramBytes:os.totalmem(),freeRamBytes:os.freemem(),gpus:gpu(),nodeVersion:process.version,uptimeSeconds:os.uptime()}}

const ID=nodeId();
let desired=null,catalog=null,online=false,lastPull=0,lastWeb=0,lastPublish=0,restart=false;
let worldProc=null,addonProc=null;
function worldStatus(){return readJson(path.join(WORLD,'runtime-status.json'),{state:'STARTING'})}
function addonStatus(){return readJson(path.join(STATE,'addon-status.json'),{state:'STARTING',installed:{}})}
function mergedCatalog(){const installed=readJson(path.join(ADDONS,'installed.json'),{addons:{}}).addons||{};return{schema:catalog?.schema||1,updatedAt:catalog?.updatedAt||null,addons:(catalog?.addons||[]).filter(a=>!a.internalOnly).map(a=>{const i=installed[a.id];return{...a,status:i?(i.version===a.version?'installed':'update'):a.status}})}}
function status(){return{schema:3,nodeId:ID,state:online?'ONLINE':'OFFLINE',online,slot:SLOT,runtimeVersion:readJson(path.join(CURRENT,'version.json'),{version:'0.1.0'}).version,lastSeen:new Date().toISOString(),inventory:inventory(),world:worldStatus(),addons:addonStatus(),desiredGeneration:desired?.generation??null,requestedAddons:desired?.addons?.requested||[],translatorHealthy:false,transportHealthy:online,endpoint:`http://127.0.0.1:${PORT}`}}

function spawnDaemon(file,args=['--daemon']){const p=spawn(process.execPath,[path.join(CURRENT,file),...args],{cwd:CURRENT,env:{...process.env,ATLAS_ROOT:ROOT,ATLAS_GH_TOKEN:TOKEN},stdio:['ignore','ignore','ignore'],windowsHide:true});p.on('exit',c=>log(file,'exited',c));return p}
function ensureChildren(){if(!worldProc||worldProc.exitCode!==null){worldProc=spawnDaemon('world-runtime.js');log('world runtime started')}if(!addonProc||addonProc.exitCode!==null){addonProc=spawnDaemon('addon-manager.js');log('addon manager started')}}

async function pull(){if(Date.now()-lastPull<20000)return;lastPull=Date.now();try{desired=JSON.parse((await repoText('pc-node/desired-state.json')).text);catalog=JSON.parse((await repoText('addons/catalog.json')).text);online=true;atomic(path.join(STATE,'desired-state.json'),JSON.stringify(desired,null,2));atomic(path.join(WEB,'addons-catalog.json'),JSON.stringify(catalog,null,2))}catch(e){online=false;desired=desired||readJson(path.join(STATE,'desired-state.json'),null);catalog=catalog||readJson(path.join(WEB,'addons-catalog.json'),{addons:[]});log('pull failed',e.message)}}
const WEB_FILES=['index.html','world.html','world.js','dynamics.html','dynamics.js','appearance.html','appearance-scene.js','appearance-decoder.json','eutopia-detail.js','host.html'];
async function syncWeb(){if(!online||Date.now()-lastWeb<300000)return;lastWeb=Date.now();for(const f of WEB_FILES){try{atomic(path.join(WEB,f),(await repoText(f)).text)}catch(e){log('web sync',f,e.message)}}}
async function publish(){const s=status();atomic(path.join(STATE,'node-status.json'),JSON.stringify(s,null,2));if(TOKEN&&Date.now()-lastPublish>60000){try{await putRepoText(`pc-node/nodes/${ID}.json`,JSON.stringify(s,null,2)+'\n',`Atlas node status ${ID}`);lastPublish=Date.now()}catch(e){log('status publish failed',e.message)}}}

function mime(f){return({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'})[path.extname(f).toLowerCase()]||'application/octet-stream'}
function webPath(u){let p=decodeURIComponent(u.split('?')[0]);if(p==='/')p='/host.html';p=p.replace(/^\/+/, '');const f=path.normalize(path.join(WEB,p));return f.startsWith(path.normalize(WEB))?f:null}
function send(res,code,obj){const b=Buffer.from(JSON.stringify(obj));res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Content-Length':b.length,'Cache-Control':'no-store'});res.end(b)}
function api(req,res,body){if(req.method==='GET'&&req.url.startsWith('/api/status')){send(res,200,status());return true}if(req.method==='GET'&&req.url.startsWith('/api/addons')){send(res,200,mergedCatalog());return true}if(req.method==='POST'&&req.url.startsWith('/api/addons/install')){let j={};try{j=JSON.parse(body||'{}')}catch{}const entry=(catalog?.addons||[]).find(a=>a.id===j.id);if(!entry||!entry.installable){send(res,409,{ok:false,error:'Add-on is not installable'});return true}const f=path.join(STATE,'local-addon-requests.json'),q=readJson(f,{requested:[]});if(!q.requested.includes(j.id))q.requested.push(j.id);atomic(f,JSON.stringify(q,null,2));send(res,202,{ok:true,queued:j.id});return true}return false}
function serve(){const s=http.createServer((req,res)=>{const c=[];req.on('data',d=>c.push(d));req.on('end',()=>{const b=Buffer.concat(c).toString('utf8');if(req.url.startsWith('/api/')&&api(req,res,b))return;const f=webPath(req.url);if(!f||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end('Not found')}const x=fs.readFileSync(f);res.writeHead(200,{'Content-Type':mime(f),'Content-Length':x.length,'Cache-Control':'no-store'});res.end(x)})});s.listen(PORT,'127.0.0.1',()=>log('UI listening',PORT));return s}

async function coreUpdate(){if(!online)return;let m;try{m=JSON.parse((await repoText('pc-node/core-manifest.json')).text)}catch{return}const local=readJson(path.join(CURRENT,'version.json'),{version:'0.0.0'});if(!m.version||m.version===local.version)return;const inactive=SLOT==='A'?'B':'A',target=path.join(ROOT,'slots',inactive),stage=target+'.staging';try{fs.rmSync(stage,{recursive:true,force:true});fs.mkdirSync(stage,{recursive:true});for(const f of m.files||[]){const g=await repoText(f.source);if(f.gitBlobSha&&g.sha!==f.gitBlobSha)throw Error(`hash mismatch ${f.source}`);const out=path.join(stage,f.target);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,g.text)}fs.writeFileSync(path.join(stage,'version.json'),JSON.stringify({version:m.version,generation:m.generation,installedAt:new Date().toISOString()},null,2));for(const js of['supervisor.js','world-runtime.js','addon-manager.js']){const r=spawnSync(process.execPath,['--check',path.join(stage,js)],{encoding:'utf8'});if(r.status!==0)throw Error(`${js} syntax failed`);const t=spawnSync(process.execPath,[path.join(stage,js),'--self-test'],{env:{...process.env,ATLAS_ROOT:ROOT,ATLAS_SLOT:inactive},encoding:'utf8',timeout:30000});if(t.status!==0)throw Error(`${js} self-test failed: ${t.stderr||t.stdout}`)}fs.rmSync(target,{recursive:true,force:true});fs.renameSync(stage,target);atomic(path.join(STATE,'last-known-good-slot.txt'),SLOT+'\n');atomic(path.join(STATE,'active-slot.txt'),inactive+'\n');log('core update activated',m.version,inactive);restart=true}catch(e){fs.rmSync(stage,{recursive:true,force:true});log('core update rejected',e.message)}}
function honorRestart(){const f=path.join(STATE,'restart-request.json');const r=readJson(f,null);if(!r)return;if(r.scope==='host-service'){fs.rmSync(f,{force:true});restart=true}else if(r.scope==='atlas-shell'||r.scope==='capability'){fs.rmSync(f,{force:true})}}
async function tick(){await pull();await syncWeb();ensureChildren();await publish();honorRestart();await coreUpdate();if(restart)process.exit(75)}
async function selfTest(){const t=fs.mkdtempSync(path.join(os.tmpdir(),'atlas-supervisor-'));atomic(path.join(t,'x'),'ok');if(fs.readFileSync(path.join(t,'x'),'utf8')!=='ok')throw Error('atomic test failed');if(!inventory().cpuCount)throw Error('inventory failed');fs.rmSync(t,{recursive:true,force:true});console.log('Atlas supervisor self-test OK')}
if(process.argv.includes('--self-test'))selfTest().catch(e=>{console.error(e);process.exit(1)});else{serve();tick().catch(e=>log('initial tick',e.message));setInterval(()=>tick().catch(e=>log('tick',e.message)),5000);process.on('SIGTERM',()=>{try{worldProc?.kill();addonProc?.kill()}catch{}process.exit(0)});process.on('uncaughtException',e=>log('uncaught',e.stack||e.message));process.on('unhandledRejection',e=>log('rejection',String(e?.stack||e)))}
