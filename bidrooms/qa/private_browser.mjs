import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {createHash} from 'node:crypto';

const config = JSON.parse(await readFile(process.env.BIDROOMS_QA_CONFIG, 'utf8'));
const started = Date.now(), checks = [], errors = [], records = [];
const check = name => {checks.push(name); console.log('BIDROOMS_PRIVATE_BROWSER_PASS', name);};
const browser = await chromium.launch({headless:true,
  executablePath:process.env.BIDROOMS_CHROMIUM_EXECUTABLE || undefined});
try {
  const contexts = await Promise.all(config.users.map(() => browser.newContext({viewport:{width:390,height:844}})));
  for (const context of contexts) await context.addInitScript(() => {window.BIDROOMS_CONFIG={apiBase:location.origin};});
  const pages = await Promise.all(contexts.map(c => c.newPage()));
  for (const page of pages) page.on('pageerror', error => errors.push(error.message));
  await Promise.all(pages.map(async (page, i) => {
    await page.goto(config.origin + '/bidrooms/');
    await page.locator('#privateLogin').waitFor({state:'visible'});
    await page.locator('#workspaceEmail').fill(config.users[i].email);
    await page.locator('#workspacePassword').fill(config.users[i].password);
    await page.locator('#privateLogin button').click();
    await page.locator('#privateDocuments').waitFor({state:'visible'});
    assert.equal(await page.locator('#workspacePassword').inputValue(), '');
  }));
  check('autenticación real en dos organizaciones y contraseña retirada del formulario');
  await Promise.all(pages.map(async (page, i) => {
    const filename = ['mupa-pliego.pdf','unops-instructions.pdf'][i];
    const objective = ['Tengo documentos de materiales. Ordénalos y planifica las revisiones.',
      'Tengo documentos de puentes. Organiza los requisitos y el trabajo pendiente.'][i];
    await page.locator('#needObjective').fill(objective);
    await page.locator('#needFiles').setInputFiles(join(config.corpus, filename));
    await page.locator('#makeNeedPlan').click();
    await page.locator('#reviewForm').waitFor({state:'visible',timeout:120000});
    assert.ok(await page.locator('#needActions blockquote').count() > 0);
    assert.match(await page.locator('#needResult').innerText(), /revisión humana pendiente/i);
    assert.match(await page.locator('#needResult').innerText(), /página \d+/i);
    const pointer = await page.evaluate(() => JSON.parse(sessionStorage.getItem('bidrooms-private-case')));
    assert.equal(pointer.organization, config.users[i].organization_id);
    const record = await (await page.request.get(config.origin + '/api/v1/workspace/cases/' + pointer.id)).json();
    assert.equal(record.objective, objective);
    const link = await page.locator('.need-documents .source-link').getAttribute('href');
    const original = await page.request.get(link);
    assert.equal(original.status(), 200);
    const sha256 = createHash('sha256').update(await original.body()).digest('hex');
    assert.equal(sha256, createHash('sha256').update(await readFile(join(config.corpus,filename))).digest('hex'));
    records[i] = {case_id:pointer.id, organization_id:pointer.organization, filename, sha256, original_url:link};
  }));
  check('objetivo libre y PDF auténticos producen planes persistentes con citas y originales íntegros');
  for (let i=0;i<pages.length;i++) {
    const other = pages[1-i];
    assert.equal((await other.request.get(records[i].original_url)).status(),404);
    assert.equal((await other.request.get(config.origin+'/api/v1/workspace/cases/'+records[i].case_id)).status(),404);
    assert.equal((await other.request.get(config.origin+'/api/v1/workspace/cases/'+records[i].case_id+'/audit')).status(),404);
  }
  check('sesiones de navegador no permiten acceso cruzado a casos, documentos ni auditoría');
  const home = pages[0], sourceLink = '#directory a.result[href*="room/?id=unops-61896"]';
  async function navigateAndReturn() {
    await home.locator(sourceLink).click();
    await home.waitForURL(/\/bidrooms\/room\//);
    await home.locator('#analysisStatus').waitFor({state:'visible'});
    await home.locator('a.brand.js-home').click();
  }
  const reviewDraft = 'Necesito cotejar la garantía; esta observación todavía no está enviada.';
  await home.locator('#reviewComment').fill(reviewDraft);
  await navigateAndReturn();
  await home.locator('#reviewForm').waitFor({state:'visible'});
  assert.equal(await home.locator('#reviewComment').inputValue(),reviewDraft);
  check('observación de revisión conservada durante navegación, sin aprobación automática');
  const originalObjective = await home.locator('#needObjective').inputValue();
  await home.locator('#needObjective').fill('Necesito cambiar el alcance antes de aprobar el plan anterior.');
  await home.locator('button[value="ACEPTAR_PLAN_OPERATIVO"]').click();
  assert.match(await home.locator('#privateStatus').innerText(),/genera el plan antes de revisar/);
  const stillPending = await (await home.request.get(config.origin+'/api/v1/workspace/cases/'+records[0].case_id)).json();
  assert.equal(stillPending.review,null);
  await home.locator('#needObjective').fill(originalObjective);
  check('no se aprueba un plan mientras su objetivo tiene cambios pendientes');
  await Promise.all(pages.map(async page => {
    await page.locator('#reviewComment').fill('QA automatizado: revisión operativa; no validación profesional.');
    await page.locator('button[value="ACEPTAR_PLAN_OPERATIVO"]').click();
    await page.locator('#reviewState').waitFor({state:'visible'});
    await page.reload();
    await page.locator('#reviewState').waitFor({state:'visible'});
  }));
  check('confirmación operativa real y recuperación de sesión, documentos y revisión tras recarga');
  const draft = 'Necesito planificar un nuevo alcance; este objetivo todavía está sin guardar.';
  await home.locator('#needObjective').fill(draft);
  await navigateAndReturn();
  await home.locator('#reviewState').waitFor({state:'visible'});
  assert.equal(await home.locator('#needObjective').inputValue(),draft,
    'La navegación no debe sobrescribir un objetivo privado aún sin guardar');
  check('navegación conserva el objetivo privado sin guardar');
  await home.evaluate(() => {
    window.__qaSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key,value) {
      if(key.startsWith('bidrooms-private-draft:'))throw new DOMException('QA quota','QuotaExceededError');
      return window.__qaSetItem.call(this,key,value);
    };
  });
  const unsafeDraft = 'Este borrador debe conservarse cuando falla el almacenamiento local.';
  await home.locator('#needObjective').fill(unsafeDraft);
  const beforeFailure = home.url();
  await home.locator(sourceLink).click();
  assert.equal(home.url(),beforeFailure);
  assert.equal(await home.locator('#needObjective').inputValue(),unsafeDraft);
  await home.evaluate(() => {Storage.prototype.setItem=window.__qaSetItem;delete window.__qaSetItem;});
  await home.locator('#needObjective').fill(draft);
  check('fallo provocado de almacenamiento pospone navegación y conserva el trabajo activo');
  const root = config.public_root, manifestPath = join(root,'data/manifest.json');
  const initialManifest = JSON.parse(await readFile(manifestPath,'utf8'));
  const homePath = join(root,'index.html'), roomPath = join(root,'room/index.html');
  const initialHome = await readFile(homePath,'utf8'), initialRoom = await readFile(roomPath,'utf8');
  const oldAsset = initialManifest.assets.find(x=>x.startsWith('assets/needs.'));
  const updatedCode = (await readFile(join(root,'assets/needs.js'),'utf8'))+'\ndocument.body.dataset.qaPrivateComponent="updated";\n';
  const assetHash = createHash('sha1').update('blob '+Buffer.byteLength(updatedCode)+'\0'+updatedCode).digest('hex');
  const updatedAsset = 'assets/needs.'+assetHash+'.js';
  const nextManifest = structuredClone(initialManifest);
  nextManifest.build_id+='-private-qa';nextManifest.assets=nextManifest.assets.map(x=>x===oldAsset?updatedAsset:x);
  await writeFile(join(root,updatedAsset),updatedCode);
  await writeFile(homePath,initialHome.replace(oldAsset,updatedAsset).replaceAll(initialManifest.build_id,nextManifest.build_id));
  await writeFile(roomPath,initialRoom.replaceAll(initialManifest.build_id,nextManifest.build_id));
  await writeFile(manifestPath,JSON.stringify(nextManifest));
  await home.locator('#needFiles').setInputFiles(join(config.corpus,'unops-instructions.pdf'));
  const beforeFile = home.url();
  await home.locator(sourceLink).click();
  assert.equal(home.url(),beforeFile);
  assert.equal(await home.locator('#needFiles').evaluate(el=>el.files.length),1);
  assert.equal(await home.locator('#needObjective').inputValue(),draft);
  await home.locator('#needFiles').setInputFiles([]);
  check('nuevo despliegue local no descarta un archivo pendiente de incorporar');
  await navigateAndReturn();
  await home.locator('#reviewState').waitFor({state:'visible'});
  try {await home.waitForFunction(()=>document.body.dataset.qaPrivateComponent==='updated',{},{timeout:5000});}
  catch(error) {console.log('BIDROOMS_PRIVATE_UPGRADE_DIAGNOSTIC',JSON.stringify({url:home.url(),
    build:await home.locator('meta[name="bidrooms-build"]').getAttribute('content'),
    scripts:await home.locator('script[src]').evaluateAll(xs=>xs.map(x=>x.getAttribute('src'))),
    expectedBuild:nextManifest.build_id, expectedAsset:updatedAsset, errors}));throw error;}
  assert.equal(await home.locator('#needObjective').inputValue(),draft);
  assert.equal((await home.request.get(records[0].original_url)).status(),200);
  assert.equal((await pages[1].request.get(records[0].original_url)).status(),404);
  check('actualización compatible local durante navegación conserva sesión, borrador y permisos API v1');
  await writeFile(homePath,initialHome);await writeFile(roomPath,initialRoom);
  await writeFile(manifestPath,JSON.stringify(initialManifest));
  await navigateAndReturn();await home.locator('#reviewState').waitFor({state:'visible'});
  assert.equal(await home.locator('#needObjective').inputValue(),draft);
  assert.equal(await home.locator('meta[name="bidrooms-build"]').getAttribute('content'),initialManifest.build_id);
  check('reversión local compatible conserva sesión, revisión y borrador privado');
  await home.locator('#workspaceLogout').click();
  await home.locator('#privateLogin').waitFor({state:'visible'});
  assert.equal(await home.locator('#needObjective').inputValue(),'');
  assert.equal(await home.locator('#needResult').innerText(),'');
  assert.equal((await home.request.get(records[0].original_url)).status(),401);
  const publicDrafts = await home.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('bidrooms-public-draft:')).map(k=>sessionStorage.getItem(k)));
  assert.ok(publicDrafts.every(x=>!x.includes(draft)&&!x.includes(reviewDraft)));
  check('cierre de sesión limpia la vista privada y no coloca sus borradores en el espacio público');
  await home.locator('#workspaceEmail').fill(config.users[1].email);
  await home.locator('#workspacePassword').fill(config.users[1].password);
  await home.locator('#privateLogin button').click();
  await home.locator('#privateDocuments').waitFor({state:'visible'});
  assert.equal(await home.locator('#needObjective').inputValue(),'');
  assert.equal((await home.request.get(records[0].original_url)).status(),404);
  check('otra organización en el mismo navegador no recupera el objetivo ni documentos anteriores');
  assert.deepEqual(errors,[]);
  check('sin errores JavaScript observados');
  const report={schema:'bidrooms-private-browser-evidence/v1',observed_at:new Date().toISOString(),
    passed:true,checks,elapsed_ms:Date.now()-started,records,real_shared_inference:true,
    production_backend_tested:false,human_professional_evaluation:false,real_users_affected:false,
    scope:'LOCAL_CANONICAL_UI_AND_API; temporary QA users and organizations'};
  await mkdir(dirname(config.out),{recursive:true});
  await writeFile(config.out,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
} finally {await browser.close();}
