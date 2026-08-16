'use strict';

const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {spawnSync}=require('child_process');

const ROOT=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(ROOT,p));
const json=p=>JSON.parse(read(p).toString('utf8'));
const exists=p=>fs.existsSync(path.join(ROOT,p));
const fail=m=>{throw new Error(m)};
function blobSha(buf){const head=Buffer.from(`blob ${buf.length}\0`);return crypto.createHash('sha1').update(Buffer.concat([head,buf])).digest('hex')}
function assertBlob(p,sha){if(!exists(p))fail(`missing ${p}`);const got=blobSha(read(p));if(got!==sha)fail(`blob SHA mismatch ${p}: ${got} != ${sha}`)}
function checkJs(p){const r=spawnSync(process.execPath,['--check',path.join(ROOT,p)],{encoding:'utf8'});if(r.status!==0)fail(`${p} syntax: ${r.stderr||r.stdout}`)}
function selfTest(p){const r=spawnSync(process.execPath,[path.join(ROOT,p),'--self-test'],{encoding:'utf8',timeout:30000,env:{...process.env,ATLAS_ROOT:path.join(ROOT,'.atlas-test')}});if(r.status!==0)fail(`${p} self-test: ${r.stderr||r.stdout}`)}

for(const p of['pc-node/desired-state.json','pc-node/core-manifest.json','pc-node/world-manifest.json','pc-node/world-authority.json','pc-node/addon-requests.json','addons/catalog.json','appearance-decoder.json'])json(p);

const core=json('pc-node/core-manifest.json');
if(!core.version||!Number.isInteger(core.generation))fail('invalid core manifest identity');
for(const f of core.files||[])assertBlob(f.source,f.gitBlobSha);
for(const p of['pc-node/runtime/supervisor.js','pc-node/runtime/world-runtime.js','pc-node/runtime/addon-manager.js']){checkJs(p);selfTest(p)}

const boot=read('pc-node/bootstrap/Install-AtlasHost.ps1').toString('utf8');
const bv=boot.match(/\$BootstrapVersion='([^']+)'/)?.[1];
const bg=Number(boot.match(/\$BootstrapGeneration=(\d+)/)?.[1]);
if(bv!==core.version)fail(`bootstrap version ${bv} != core ${core.version}`);
if(bg!==core.generation)fail(`bootstrap generation ${bg} != core ${core.generation}`);
if(!boot.includes("atlas.host.diagnostics"))fail('bootstrap lacks real add-on validation');
if(!boot.includes('world-authority.json'))fail('bootstrap lacks causal authority validation');

const wm=json('pc-node/world-manifest.json');
for(const f of wm.files||[])assertBlob(f.source,f.gitBlobSha);
if(!read('pc-node/runtime/world-runtime.js').toString('utf8').includes("ATLAS_NOW"))fail('world runtime lacks deterministic clock injection');
if(!read('.github/workflows/world-heartbeat.yml').toString('utf8').includes("authority.outputs.mode != 'atlas-host'"))fail('GitHub heartbeat does not respect Host authority');

const catalog=json('addons/catalog.json');
const ids=new Set();
for(const a of catalog.addons||[]){
  if(ids.has(a.id))fail(`duplicate add-on id ${a.id}`);ids.add(a.id);
  if(a.installable){
    if(!a.manifest||!exists(a.manifest))fail(`installable add-on ${a.id} has no manifest`);
    const m=json(a.manifest);
    if(m.id!==a.id||m.version!==a.version)fail(`add-on identity mismatch ${a.id}`);
    for(const f of m.files||[])assertBlob(f.source,f.gitBlobSha);
    if(m.health?.type==='node-self-test'){
      const file=(m.files||[]).find(x=>x.target===m.health.entry);
      if(!file)fail(`health entry not packaged for ${a.id}`);
      const r=spawnSync(process.execPath,[path.join(ROOT,file.source),'--self-test'],{encoding:'utf8',timeout:30000});
      if(r.status!==0)fail(`add-on health failed ${a.id}: ${r.stderr||r.stdout}`);
    }
  }
}

const remote=read('pc-node/runtime/supervisor.js').toString('utf8');
if(!remote.includes('remoteStatus()'))fail('remote telemetry sanitizer missing');
if(remote.includes("putRepoText(`pc-node/nodes/${ID}.json`,JSON.stringify(local"))fail('full local status may be published remotely');
if(!remote.includes("path.join(WEB,'vendor','three.module.js')"))fail('offline Three.js cache missing');

const scene=read('appearance-scene.js').toString('utf8');
for(const m of scene.matchAll(/(?:import\s+(?:[^'\"]+from\s+)?|import\()\s*['\"](\.\/[^'\"]+)['\"]/g)){
  const target=path.normalize(path.join(ROOT,path.dirname('appearance-scene.js'),m[1]));
  if(!fs.existsSync(target)&&!fs.existsSync(target+'.js'))fail(`missing local import ${m[1]}`);
}

fs.rmSync(path.join(ROOT,'.atlas-test'),{recursive:true,force:true});
console.log(`Atlas Host repository validation OK — core ${core.version} generation ${core.generation}`);
