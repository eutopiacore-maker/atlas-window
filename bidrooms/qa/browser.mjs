import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdtemp,cp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const remote=process.env.BIDROOMS_VERIFY_URL;
const scratch=remote?null:await mkdtemp(join(tmpdir(),'bidrooms-qa-'));
if(scratch)await cp('bidrooms',join(scratch,'bidrooms'),{recursive:true});
const server=scratch?spawn('python',['-m','http.server','8765','--bind','127.0.0.1','--directory',scratch],{stdio:'ignore'}):null;
const origin=remote||'http://127.0.0.1:8765/bidrooms/';
for(let i=0;i<50;i++){try{if((await fetch(origin)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
const browser=await chromium.launch({headless:true});let passed=0;
const check=name=>{passed++;console.log('BIDROOMS_BROWSER_PASS',name);};
try{
 const context=await browser.newContext({viewport:{width:390,height:844}});
 const home=await context.newPage(),errors=[];home.on('pageerror',e=>errors.push(e.message));
 await home.goto(origin);await home.waitForSelector('#directory .card');
 const manifest=await(await fetch(new URL('data/manifest.json',origin))).json();
 assert.equal(manifest.version,'1.1.0');assert.equal(manifest.rooms.length,4);check('directorio y ruta histórica conservada');
 assert.equal(await home.locator('input[name="id"]').count(),0);check('sin identificación personal ni correo con ID');
 await home.locator('#globalSearch').fill('UNOPS');
 assert.match(await home.locator('#directory').innerText(),/UNOPS/);
 assert.doesNotMatch(await home.locator('#directory').innerText(),/Reparación de losa/);check('búsqueda funcional');
 const pages=await Promise.all(['acp-215004','panama-mupa-268','unops-61896'].map(async id=>{
  const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));
  await p.goto(new URL('room/?id='+id,origin).href);await p.waitForSelector('#analysisStatus');
  assert.match(await p.locator('#analysisStatus').innerText(),/incompleto/i);
  await p.locator('[data-tab="documents"]').click();try{await p.waitForSelector('#documents.active',{timeout:5000});}catch(error){console.log("BIDROOMS_DIAGNOSTIC",JSON.stringify({id,errors,fatal:await p.locator("#fatal").innerText(),tabs:await p.locator(".tab").evaluateAll(xs=>xs.map(x=>({text:x.textContent,tab:x.dataset.tab,active:x.className}))),panels:await p.locator(".panel").evaluateAll(xs=>xs.map(x=>({id:x.id,active:x.className}))),build:await p.locator('meta[name="bidrooms-build"]').getAttribute("content")}));throw error;}
  assert.ok(await p.locator('#documents .doc').count()>0);
  assert.equal(await p.locator('input[name="id"]').count(),0);return p;
 }));
 assert.ok((await pages[0].title()).includes('215004'));
 assert.ok((await pages[1].title()).includes('000268'));
 assert.ok((await pages[2].title()).includes('61896'));check('tres salas públicas simultáneas; estados parciales explícitos');
 await pages[1].locator('[data-tab="amendments"]').click();
 assert.equal(await pages[2].locator('#documents.active').count(),1);
 assert.equal(await pages[0].locator('#documents.active').count(),1);check('navegación aislada entre salas');
 const legacy=await context.newPage();await legacy.goto(new URL('acp-215164/',origin).href);
 await legacy.waitForSelector('[data-ready]');await legacy.locator('#overview [data-ready]').first().check();
 await legacy.locator('[data-tab="finance"]').click();await legacy.locator('#unitCost').fill('10');
 assert.match(await legacy.locator('#priceResult').innerText(),/\$/);
 assert.equal(await legacy.locator('#finance input[name="id"]').count(),0);check('lista personal y calculadora histórica; sin simular aprobación');
 if(!remote){
  const root=join(scratch,'bidrooms'),manifestPath=join(root,'data/manifest.json');
  const initial=JSON.parse(await readFile(manifestPath,'utf8')),next=structuredClone(initial);next.build_id=initial.build_id+'-qa2';
  const code=(await readFile(join(root,'assets/app.js'),'utf8'))+'\ndocument.body.dataset.qaComponent="version2";\n';
  const hash=createHash('sha1').update('blob '+Buffer.byteLength(code)+'\0'+code).digest('hex');
  const newAsset='assets/app.'+hash+'.js';await writeFile(join(root,newAsset),code);
  const oldAsset=initial.assets.find(x=>x.startsWith('assets/app.'));
  next.assets=initial.assets.map(x=>x===oldAsset?newAsset:x);
  const legacyPath=join(root,'acp-215164/index.html'),html=await readFile(legacyPath,'utf8');
  await writeFile(legacyPath,html.replace(oldAsset,newAsset).replaceAll(initial.build_id,next.build_id));
  await writeFile(manifestPath,JSON.stringify(next));await legacy.locator('[data-tab="overview"]').click();
  await legacy.waitForFunction(()=>document.body.dataset.qaComponent==='version2');
  assert.equal(await legacy.locator('#overview [data-ready]').first().isChecked(),true);
  await legacy.locator('[data-tab="finance"]').click();
  assert.equal(await legacy.locator('#unitCost').inputValue(),'10');check('actualización compatible conserva borrador público y marcas');
  const incompatible=structuredClone(next);incompatible.build_id+='-incompatible';incompatible.compatibility.public_schema=2;
  await writeFile(manifestPath,JSON.stringify(incompatible));await legacy.locator('[data-tab="overview"]').click();
  await legacy.waitForSelector('#overview.active');
  assert.equal(await legacy.locator('meta[name="bidrooms-build"]').getAttribute('content'),next.build_id);check('actualización incompatible pospuesta');
  await writeFile(legacyPath,html);await writeFile(manifestPath,JSON.stringify(initial));
  await legacy.locator('[data-tab="finance"]').click();
  await legacy.waitForFunction(expected=>document.querySelector('meta[name="bidrooms-build"]').content===expected,initial.build_id);
  assert.equal(await legacy.locator('#unitCost').inputValue(),'10');
  assert.equal(await legacy.locator('#overview [data-ready]').first().isChecked(),true);check('reversión pública compatible conserva trabajo');
 }
 assert.deepEqual(errors,[]);check('sin errores JavaScript observados');
 console.log(JSON.stringify({schema:'bidrooms-browser-evidence/v1',passed,remote:!!remote,url:origin,private_backend_tested:false,human_approval_tested:false}));
}finally{await browser.close();server?.kill();if(scratch)await rm(scratch,{recursive:true,force:true});}
