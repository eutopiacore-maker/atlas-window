import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const origin='https://eutopiacore-maker.github.io/atlas-window/bidrooms/';
const target='bidrooms-public-20261013-r2';
const manifest=async()=>{const response=await fetch(new URL('data/manifest.json?_live='+Date.now(),origin),{cache:'no-store'});assert.ok(response.ok);return response.json();};
const initial=await manifest();
assert.notEqual(initial.build_id,target,'La versión anterior debe observarse realmente; no simular actualización');
const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext({viewport:{width:390,height:844}});
 const page=await context.newPage();
 await page.goto(new URL('acp-215164/',origin).href);await page.waitForSelector('[data-ready]');
 const oldBuild=await page.locator('meta[name="bidrooms-build"]').getAttribute('content');
 assert.equal(oldBuild,initial.build_id);
 await page.locator('#overview [data-ready]').first().check();
 await page.locator('[data-tab="finance"]').click();await page.locator('#unitCost').fill('23.45');
 console.log('BIDROOMS_LIVE_OLD_VERSION_HELD',JSON.stringify({oldBuild,target,scope:'PUBLIC_REGISTRY_ONLY',private_authentication:false}));
 let seen=false;
 for(let i=0;i<300;i++){
  const next=await manifest();
  if(next.build_id===target){assert.equal(next.compatibility.public_schema,1);seen=true;break;}
  await new Promise(r=>setTimeout(r,2000));
 }
 assert.ok(seen,'No se observó publicación objetivo dentro del plazo; no aprobar');
 await page.locator('[data-tab="overview"]').click();
 await page.waitForFunction(expected=>document.querySelector('meta[name="bidrooms-build"]').content===expected,target);
 assert.equal(await page.locator('#overview [data-ready]').first().isChecked(),true);
 await page.locator('[data-tab="finance"]').click();assert.equal(await page.locator('#unitCost').inputValue(),'23.45');
 await page.locator('a.brand.js-home').click();await page.waitForSelector('#needObjective');
 assert.equal(await page.locator('meta[name="bidrooms-build"]').getAttribute('content'),target);
 await page.locator('#needObjective').fill('Tengo capacidades de construcción de puentes. ¿En qué oportunidades puedo participar?');
 await page.locator('#needForm button[type="submit"]').click();await page.waitForSelector('#needResult .need-options');
 assert.match(await page.locator('#needResult').innerText(),/elegibilidad permanece desconocida/i);
 await page.locator('#globalSearch').fill('215164');
 await page.locator('#directory a.result[href$="acp-215164/"]').click();await page.waitForSelector('[data-ready]');
 await page.locator('[data-tab="finance"]').click();assert.equal(await page.locator('#unitCost').inputValue(),'23.45');
 assert.equal(await page.locator('#overview [data-ready]').first().isChecked(),true);
 console.log('BIDROOMS_LIVE_UPGRADE_PASS',JSON.stringify({schema:'bidrooms-live-public-upgrade/v1',oldBuild,newBuild:target,url:origin,public_draft_preserved:true,personal_checklist_preserved:true,new_need_component_observed:true,private_sessions_tested:false,professional_review:false}));
}finally{await browser.close();}
