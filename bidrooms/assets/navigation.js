// Actualizaciones solo en la superficie pública; no anuncia protección de flujos privados.
(function(){
"use strict";
const p=location.pathname,i=p.indexOf("/bidrooms"),base=i<0?"/bidrooms":p.slice(0,i)+"/bidrooms";
const build=document.querySelector('meta[name="bidrooms-build"]')?.content||"baseline";
const footer=document.querySelector(".footer");if(footer)footer.append(document.createTextNode(" · compilación "+build));
const caseId=document.body.dataset.roomId||new URLSearchParams(location.search).get("id")||"";
const key="bidrooms-public-draft:"+p+":"+caseId;
const selector="#globalSearch,#unitCost,#logistics,#otherCost,#contingency,#margin,#needObjective";
let bypass=false,checking=false;
const privateState=()=>["active","checking","unavailable"].includes(document.body.dataset.privateSessionState);
function save(){const data={};document.querySelectorAll(selector).forEach(e=>{if(e.id!=="needObjective"||!privateState())data[e.id]=e.value;});try{sessionStorage.setItem(key,JSON.stringify(data));return true;}catch{return false;}}
function restore(){try{const data=JSON.parse(sessionStorage.getItem(key)||"{}");Object.entries(data).forEach(([id,value])=>{if(id==="reviewComment"||id==="needObjective"&&privateState())return;const el=document.getElementById(id);if(el){el.value=value;el.dispatchEvent(new Event("input",{bubbles:true}));}});}catch{}}
document.addEventListener("bidrooms-private-session",e=>{if(e.detail?.restorePublicDraft&&!document.getElementById("needObjective")?.value)restore();else save();});
document.addEventListener("input",e=>{if(e.target.matches(selector))save();});
window.addEventListener("pagehide",save);
const observer=new MutationObserver(()=>{if(document.body.dataset.page!=="home"&&document.body.dataset.page!=="room"||document.querySelector("#directory .card,#roomTitle:not(:empty)")){restore();observer.disconnect();}});
observer.observe(document.body,{childList:true,subtree:true});
document.addEventListener("click",async e=>{
 if(bypass||checking||e.button!==0||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;
 const a=e.target.closest("a[href]"),tab=e.target.closest("button.tab");let next;
 if(tab){next=new URL(location.href);next.searchParams.set("section",tab.dataset.tab);}
 else if(a&&a.target!=="_blank"){next=new URL(a.href,location.href);if(next.origin!==location.origin||!next.pathname.startsWith(base+"/")||next.hash)return;}
 else return;
 // Los borradores privados los conserva su controlador por sesión, organización y caso.
 if(document.body.dataset.privateOperation==="active"||document.body.dataset.privateDraftSafe==="false"||document.querySelector('form:not([hidden]) input:focus')||[...document.querySelectorAll('input[type="file"]')].some(x=>x.files.length))return;
 e.preventDefault();e.stopImmediatePropagation();checking=true;
 try{
  const response=await fetch(base+"/data/manifest.json?_br_check="+Date.now(),{cache:"no-store",credentials:"omit"});
  const manifest=await response.json();
  // Toda navegación de la misma compilación conserva su clave de caché HTML.
  // Evita volver a un documento antiguo después de actualizar otra sección.
  if(response.ok&&manifest.build_id===build&&manifest.compatibility?.public_schema===1&&manifest.compatibility?.safe_navigation===true&&manifest.compatibility?.scope==="PUBLIC_REGISTRY_ONLY")next.searchParams.set("_br_build",build);
  if(response.ok&&manifest.build_id!==build&&manifest.compatibility?.public_schema===1&&manifest.compatibility?.safe_navigation===true&&manifest.compatibility?.scope==="PUBLIC_REGISTRY_ONLY"&&Array.isArray(manifest.assets)&&manifest.assets.every(x=>/^assets\/[a-z0-9.-]+$/.test(x))){
   const fetched=await Promise.all(manifest.assets.map(x=>fetch(base+"/"+x,{cache:"force-cache",credentials:"omit"})));
   if(fetched.every(x=>x.ok)&&save()){next.searchParams.set("_br_build",manifest.build_id);location.assign(next.href);return;}
  }
 }catch{/* Continúa navegación anterior ante fallos de red. */}
 checking=false;
 if(tab){bypass=true;tab.click();bypass=false;history.replaceState(null,"",next.href);}
 else location.assign(next.href);
},true);
})();
