'use strict';

const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {spawnSync}=require('child_process');

const ROOT=path.resolve(__dirname,'../..');
const TEST_ROOT=path.join(ROOT,'.atlas-test');
const read=p=>fs.readFileSync(path.join(ROOT,p));
const text=p=>read(p).toString('utf8');
const json=p=>JSON.parse(text(p));
const exists=p=>fs.existsSync(path.join(ROOT,p));
const fail=m=>{throw new Error(m)};
function blobSha(buf){const head=Buffer.from(`blob ${buf.length}\0`);return crypto.createHash('sha1').update(Buffer.concat([head,buf])).digest('hex')}
function assertBlob(p,sha){if(!exists(p))fail(`missing ${p}`);const got=blobSha(read(p));if(got!==sha)fail(`blob SHA mismatch ${p}: ${got} != ${sha}`)}
function checkJs(p){const r=spawnSync(process.execPath,['--check',path.join(ROOT,p)],{encoding:'utf8'});if(r.status!==0)fail(`${p} syntax: ${r.stderr||r.stdout}`)}
function selfTest(p){const r=spawnSync(process.execPath,[path.join(ROOT,p),'--self-test'],{encoding:'utf8',timeout:30000,env:{...process.env,ATLAS_ROOT:TEST_ROOT}});if(r.status!==0)fail(`${p} self-test: ${r.stderr||r.stdout}`)}

try{
  for(const p of['pc-node/desired-state.json','pc-node/core-manifest.json','pc-node/world-manifest.json','pc-node/world-authority.json','pc-node/addon-requests.json','addons/catalog.json','appearance-decoder.json'])json(p);

  const core=json('pc-node/core-manifest.json');
  if(!core.version||!Number.isInteger(core.generation))fail('invalid core manifest identity');
  for(const f of core.files||[])assertBlob(f.source,f.gitBlobSha);
  if(!core.launcher?.source||!core.launcher?.gitBlobSha)fail('core launcher integrity contract missing');
  assertBlob(core.launcher.source,core.launcher.gitBlobSha);
  for(const name of core.activation?.requiredSyntaxChecks||[]){
    const spec=(core.files||[]).find(f=>f.target===name);
    if(!spec)fail(`syntax-check target not packaged: ${name}`);
    checkJs(spec.source);
  }
  for(const name of core.activation?.requiredSelfTests||[]){
    const target=`${name}.js`,spec=(core.files||[]).find(f=>f.target===target);
    if(!spec)fail(`self-test target not packaged: ${target}`);
    selfTest(spec.source);
  }

  const boot=text('pc-node/bootstrap/Install-AtlasHost.ps1');
  const bv=boot.match(/\$BootstrapVersion='([^']+)'/)?.[1];
  const bg=Number(boot.match(/\$BootstrapGeneration=(\d+)/)?.[1]);
  if(bv!==core.version)fail(`bootstrap version ${bv} != core ${core.version}`);
  if(bg!==core.generation)fail(`bootstrap generation ${bg} != core ${core.generation}`);
  if(!boot.includes('pc-node/core-manifest.json'))fail('bootstrap does not install from core manifest');
  if(!boot.includes('atlas.host.diagnostics'))fail('bootstrap lacks real add-on validation');
  if(!boot.includes('world-authority.json'))fail('bootstrap lacks causal authority validation');
  if(!boot.includes('DataProtectionScope]::LocalMachine'))fail('bootstrap token storage is not machine-encrypted');

  const desired=json('pc-node/desired-state.json');
  if(desired?.worldRuntime?.timeScale!==1)fail('Eutopia host world is not locked to real-time scale 1');
  if(desired?.worldRuntime?.browserAdvancesWorld!==false||desired?.worldRuntime?.githubAdvancesWorld!==false)fail('world writer authority policy is ambiguous');
  if(desired?.addons?.physicalPresenceRequiredAfterBootstrap!==false)fail('remote add-on autonomy contract regressed');

  const wm=json('pc-node/world-manifest.json');
  for(const f of wm.files||[])assertBlob(f.source,f.gitBlobSha);
  const wr=text('pc-node/runtime/world-runtime.js'),runner=text('pc-node/runtime/world-runner.js'),shim=text('pc-node/runtime/world-shim.js');
  if(!wr.includes('ATLAS_TARGET_TIME'))fail('world runtime lacks wall-clock target injection');
  if(!runner.includes('ATLAS_VIRTUAL_NOW'))fail('world runner lacks virtual-time propagation');
  if(!shim.includes('ATLAS_VIRTUAL_NOW'))fail('world shim lacks virtual clock');
  if(!shim.includes("ATLAS_OFFLINE==='1'"))fail('world shim lacks offline causal mode');
  if(!text('.github/workflows/world-heartbeat.yml').includes("authority.outputs.mode != 'atlas-host'"))fail('GitHub heartbeat does not respect Host authority');

  const catalog=json('addons/catalog.json'),ids=new Set();
  for(const a of catalog.addons||[]){
    if(ids.has(a.id))fail(`duplicate add-on id ${a.id}`);ids.add(a.id);
    if(a.installable){
      if(!a.manifest||!exists(a.manifest))fail(`installable add-on ${a.id} has no manifest`);
      const m=json(a.manifest);
      if(m.id!==a.id||m.version!==a.version)fail(`add-on identity mismatch ${a.id}`);
      for(const f of m.files||[])assertBlob(f.source,f.gitBlobSha);
      if(m.health?.type==='node-self-test'){
        const f=(m.files||[]).find(x=>x.target===m.health.entry);
        if(!f)fail(`health entry not packaged for ${a.id}`);
        const r=spawnSync(process.execPath,[path.join(ROOT,f.source),'--self-test'],{encoding:'utf8',timeout:30000});
        if(r.status!==0)fail(`add-on health failed ${a.id}: ${r.stderr||r.stdout}`);
      }
    }
  }

  const supervisor=text('pc-node/runtime/supervisor.js');
  if(!supervisor.includes('remoteStatus()'))fail('remote telemetry sanitizer missing');
  if(supervisor.includes("putRepoText(`pc-node/nodes/${ID}.json`,JSON.stringify(local"))fail('full local status may be published remotely');
  if(!supervisor.includes("path.join(WEB,'vendor','three.module.js')"))fail('offline Three.js cache missing');
  if(!text('pc-node/runtime/addon-manager.js').includes("pc-node/addon-requests.json"))fail('remote add-on request queue not wired');

  const scene=text('appearance-scene.js');
  for(const m of scene.matchAll(/(?:import\s+(?:[^'\"]+from\s+)?|import\()\s*['\"](\.\/[^'\"]+)['\"]/g)){
    const target=path.normalize(path.join(ROOT,path.dirname('appearance-scene.js'),m[1]));
    if(!fs.existsSync(target)&&!fs.existsSync(target+'.js'))fail(`missing local import ${m[1]}`);
  }

  console.log(`Atlas Host repository validation OK — core ${core.version} generation ${core.generation}`);
} finally {
  fs.rmSync(TEST_ROOT,{recursive:true,force:true});
}
