// Objetivo y documentos dentro de BidRooms. No anuncia un LLM ni facultades profesionales.
(function(){
"use strict";
const host=document.getElementById("needWorkspace");if(!host)return;
const p=location.pathname,i=p.indexOf("/bidrooms"),base=i<0?"/bidrooms":p.slice(0,i)+"/bidrooms";
const api=((window.BIDROOMS_CONFIG||{}).apiBase||"").replace(/\/$/,""),$=s=>host.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const norm=s=>s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
let ready=false,csrf="",current=null,busy=false,organization="",member="",draftSafe=true;
const status=$("#privateStatus"),result=$("#needResult"),message=t=>status.textContent=t;
async function call(path,{method="GET",body,headers={}}={}){
 const r=await fetch(api+"/api/v1/workspace"+path,{method,credentials:"include",cache:"no-store",headers:{...(csrf?{"X-BR-CSRF":csrf}:{}),...headers},body});
 const d=await r.json();if(!r.ok)throw Error(d.detail||"No se pudo completar la operación");return d;
}
function lock(on){busy=on;document.body.dataset.privateOperation=on?"active":"idle";host.querySelectorAll("button,#needObjective,#needFiles,#workspaceEmail,#workspacePassword,#reviewComment").forEach(b=>b.disabled=on);}
function sessionState(state,restorePublicDraft=false){document.body.dataset.privateSessionState=state;document.dispatchEvent(new CustomEvent("bidrooms-private-session",{detail:{restorePublicDraft}}));}
sessionState(api?"checking":"anonymous");
function draftKey(){return organization&&member?"bidrooms-private-draft:"+organization+":"+member+":"+(current?.id||"new"):null;}
function saveDraft(){const key=draftKey();if(!key)return true;try{
 sessionStorage.setItem(key,JSON.stringify({objective:$("#needObjective").value,comment:$("#reviewComment")?.value||""}));draftSafe=true;
 }catch{draftSafe=false;message("No se pudo proteger el borrador. Conserva esta vista hasta guardar el plan.");}
 document.body.dataset.privateDraftSafe=String(draftSafe);return draftSafe;
}
function restoreDraft(){const key=draftKey();if(!key)return;try{const saved=JSON.parse(sessionStorage.getItem(key)||"null");
 if(saved){$("#needObjective").value=saved.objective;if($("#reviewComment"))$("#reviewComment").value=saved.comment||"";}
 }catch{draftSafe=false;document.body.dataset.privateDraftSafe="false";}}
function clearDraft(){const key=draftKey();if(!key)return;try{sessionStorage.removeItem(key);draftSafe=true;}catch{draftSafe=false;}document.body.dataset.privateDraftSafe=String(draftSafe);}
host.addEventListener("input",e=>{if(e.target.matches("#needObjective,#reviewComment"))saveDraft();});
window.addEventListener("pagehide",saveDraft);
function goal(text){text=norm(text);return /oportunidad|participar|capacidades|ofertar/.test(text)?"OPORTUNIDADES":/contratar|comprar/.test(text)?"CONTRATAR":/plazos|planificar|distribuir|fechas/.test(text)?"PLANIFICAR":"ORGANIZAR";}
async function explore(objective){
 const m=await(await fetch(base+"/data/manifest.json",{cache:"no-store"})).json();
 const rooms=await Promise.all(m.rooms.map(async entry=>({entry,room:await(await fetch(base+"/data/rooms/"+entry.id+".json",{cache:"no-store"})).json()})));
 const ignore=new Set("tengo estas estos capacidades documentos necesito contratar trabajo aqui estan planos requisitos organizalo ordenalos oportunidades puedo participar ayudame planificar distribuir plazos".split(" "));
 const words=[...new Set(norm(objective).match(/[a-z0-9]{4,}/g)||[])].filter(w=>!ignore.has(w));
 const matches=rooms.map(x=>({...x,words:words.filter(w=>norm(x.room.title+" "+x.entry.number+" "+x.room.owner_acronym+" "+x.room.regime).includes(w))})).filter(x=>x.words.length).sort((a,b)=>b.words.length-a.words.length);
 const next=goal(objective)==="OPORTUNIDADES"?"Comparar tus capacidades con requisitos oficiales y vigencia. Sin esa evidencia, tu elegibilidad permanece desconocida.":goal(objective)==="CONTRATAR"?"Incorporar alcance y documentos. Un especialista deberá validar planos, régimen y facultades de aprobación.":goal(objective)==="PLANIFICAR"?"Incorporar la fuente de los plazos y confirmar su función, zona horaria y responsables. Tu texto no establece una fecha oficial.":"Incorporar documentos para obtener clasificación, citas y pendientes revisables.";
 result.innerHTML='<h2>Un punto de partida para tu objetivo</h2><p class="muted">Búsqueda por palabras y referencias públicas. No acredita elegibilidad ni analiza documentos privados.</p>'+
 (matches.length?'<div class="need-options">'+matches.map(({entry:r,room,words})=>{
 const source=room.documents.find(x=>x.url&&/^https:\/\//.test(x.url))?.url||room.official_system.url;
 return '<article class="card"><div class="eyebrow">'+esc(room.owner_acronym)+'</div><h3>'+esc(room.title)+'</h3><p>Coincide en: '+esc(words.join(", "))+'. Fuente: título y número del registro público, consulta '+esc(room.checked_at)+'.</p><p class="muted">'+(Date.parse(room.closes_at)<=Date.now()?'Referencia histórica: fecha de cierre alcanzada.':'Fecha de cierre observada; vigencia por confirmar.')+' Expediente y revisión profesional pendientes.</p><div class="actions"><a class="btn" href="'+esc(base+"/"+r.route)+'">Revisar expediente</a><a class="source-link" target="_blank" rel="noopener noreferrer" href="'+esc(source)+'">Consultar fuente oficial ↗</a></div></article>';
 }).join("")+'</div>':'<p class="notice">No hay una coincidencia documental suficiente en el registro actual. Precisa el tipo de obra, material o servicio; no se han confirmado oportunidades disponibles.</p>')+
 '<h3>Siguiente paso</h3><p>'+esc(next)+'</p><p class="muted">'+(ready?"Continúa en el espacio privado con tus documentos.":"La incorporación privada de documentos está pendiente de habilitación. Tu objetivo permanece en esta pestaña; no se envía a servicios externos.")+'</p>';
 result.hidden=false;
}
function pointer(){try{sessionStorage.setItem("bidrooms-private-case",JSON.stringify({id:current.id,organization:current.organization_id}));}catch{}}
function render(record){
 if(record.organization_id!==organization)throw Error("El expediente no pertenece a la sesión activa.");
 if(current&&current.id!==record.id)saveDraft();
 current=record;$("#needObjective").value=record.objective;
 const plan=record.plan;
 if(!plan){result.innerHTML='<p class="notice">Objetivo guardado. Incorpora documentos y genera el plan.</p>';result.hidden=false;restoreDraft();return;}
 result.innerHTML='<h2>Plan para tu objetivo</h2><p>'+esc(plan.objective)+'</p><p class="muted">Propuesta determinista y clasificación estadística; revisión humana pendiente. No certifica cumplimiento ni interpreta planos.</p>'+
 '<h3>Documentos organizados</h3><div class="need-documents">'+plan.documents.map(d=>'<article class="card"><strong>'+esc(d.filename)+'</strong><p>'+esc(d.requirements)+' candidatos · clasificación inferida</p><code class="hash">'+esc(d.sha256)+'</code><a class="source-link" href="'+esc(api+'/api/v1/workspace/cases/'+record.id+'/documents/'+d.id)+'">Recuperar original privado</a>'+d.warnings.map(w=>'<p class="muted">'+esc(w)+'</p>').join('')+'</article>').join('')+'</div>'+
 (plan.questions.length?'<h3>Solo falta aclarar</h3>'+plan.questions.map(q=>'<p><strong>'+esc(q.question)+'</strong><br><span class="muted">'+esc(q.reason)+'</span></p>').join(''):'')+
 plan.gaps.map(g=>'<p class="notice">Información desconocida: '+esc(g.detail||g.code)+'</p>').join('')+
 '<h3>Acciones propuestas</h3><div id="needActions">'+plan.actions.map(a=>'<article class="card"><span class="pill">Prioridad '+esc(a.priority)+' · pendiente</span><h4>'+esc(a.title)+'</h4><p>'+esc(a.specialty)+' · responsable por confirmar</p><blockquote>'+esc(a.source.quote)+'</blockquote><p class="muted">'+esc(a.source.filename)+' · '+esc(a.source.page!=null?'página '+a.source.page:a.source.section)+' · '+esc(a.certainty)+'</p><details><summary>Ver trazabilidad</summary><code class="hash">'+esc(a.source.document_sha256)+'</code><p>Versión: '+esc(a.source.source_version)+'</p><p>Entregable: '+esc(a.deliverable)+'</p><p>Aceptación: '+esc(a.acceptance)+'</p></details></article>').join('')+'</div>'+
 (plan.remaining_actions?'<p>Quedan '+esc(plan.remaining_actions)+' candidatos adicionales para revisión; no se han descartado.</p>':'')+
 (plan.dates.length?'<h3>Fechas para cotejar</h3>'+plan.dates.map(d=>'<p>'+esc(d.literal)+' · función por confirmar · '+esc(d.page!=null?'página '+d.page:d.section)+'</p>').join(''):'')+
 (record.review?'<p id="reviewState" class="notice">Revisión operativa guardada. No equivale a validación profesional o envío oficial.</p>':'<form id="reviewForm"><label for="reviewComment">Observación de revisión operativa</label><textarea id="reviewComment" minlength="8" maxlength="2000" required></textarea><p class="muted">Confirmar organiza el trabajo; las decisiones profesionales y asignaciones siguen pendientes.</p><div class="actions"><button class="btn gold" name="decision" value="ACEPTAR_PLAN_OPERATIVO">Confirmar plan operativo</button><button class="btn" name="decision" value="DEVOLVER_PARA_CORREGIR">Solicitar corrección</button></div></form>');
 result.hidden=false;restoreDraft();
 $("#reviewForm")?.addEventListener("submit",async e=>{e.preventDefault();if(busy)return;lock(true);try{
 if($("#needObjective").value.trim()!==current.objective)throw Error("Guarda el objetivo actualizado y genera el plan antes de revisar.");
 const review=await call("/cases/"+current.id+"/review",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({revision:current.revision,plan_sha256:current.plan_sha256,decision:e.submitter.value,comment:$("#reviewComment").value})});
 current.review=review;clearDraft();render(current);message("Revisión guardada con identidad y evidencia.");
 }catch(error){message(error.message);}finally{lock(false);}});
}
async function session(){
 try{
 const user=await call("/session");csrf=user.csrf;organization=user.user.organization_id;member=user.user.id;sessionState("active");$("#privateLogin").hidden=true;$("#privateDocuments").hidden=false;message("Sesión privada activa. Este acceso no verifica identidad legal.");
 let saved;try{saved=JSON.parse(sessionStorage.getItem("bidrooms-private-case")||"null");}catch{}
 if(saved?.organization===user.user.organization_id)render(await call("/cases/"+saved.id));else restoreDraft();
 $("#savedNeeds").innerHTML=(await call("/cases")).map(c=>'<button type="button" class="btn" data-case="'+esc(c.id)+'">'+esc(c.objective.slice(0,90))+'</button>').join('');
 $("#savedNeeds").querySelectorAll("[data-case]").forEach(b=>b.addEventListener("click",async()=>{if(busy)return;try{render(await call("/cases/"+b.dataset.case));pointer();}catch(e){message(e.message);}}));
 }catch{const hadPrivate=Boolean(organization);if(hadPrivate){saveDraft();result.replaceChildren();result.hidden=true;$("#needObjective").value="";}
 csrf="";current=null;organization="";member="";sessionState("anonymous",!hadPrivate);$("#privateLogin").hidden=false;$("#privateDocuments").hidden=true;}
}
$("#needForm").addEventListener("submit",async e=>{e.preventDefault();if(busy)return;lock(true);try{await explore($("#needObjective").value);}catch{message("No se pudieron consultar las fuentes. Tu objetivo se conserva.");}finally{lock(false);}});
host.querySelectorAll("[data-example]").forEach(b=>b.addEventListener("click",()=>{$("#needObjective").value=b.dataset.example;$("#needObjective").dispatchEvent(new Event("input",{bubbles:true}));$("#needObjective").focus();}));
$("#privateLogin").addEventListener("submit",async e=>{e.preventDefault();if(busy||!ready)return;lock(true);try{
 await call("/session",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:$("#workspaceEmail").value,password:$("#workspacePassword").value})});
 $("#workspacePassword").value="";await session();
 }catch(error){message(error.message);}finally{lock(false);}});
$("#makeNeedPlan").addEventListener("click",async()=>{if(busy||!ready||!csrf)return;lock(true);try{
 const objective=$("#needObjective").value.trim();if(objective.length<8)throw Error("Describe el resultado que necesitas conseguir.");
 if(!current){current=await call("/cases",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({objective})});pointer();saveDraft();}
 else if(current.objective!==objective){current=await call("/cases/"+current.id,{method:"PATCH",headers:{"Content-Type":"application/json","If-Match":String(current.revision)},body:JSON.stringify({objective})});pointer();}
 for(const file of $("#needFiles").files){
 if(file.size>20*1024*1024)throw Error("Cada archivo puede ocupar hasta 20 MiB.");
 message("Leyendo "+file.name+"… Conserva esta vista hasta finalizar.");
 const doc=await call("/cases/"+current.id+"/documents",{method:"POST",headers:{"X-Document-Name":encodeURIComponent(file.name),"If-Match":String(current.revision)},body:file});current.revision=doc.revision;
 }
 $("#needFiles").value="";Object.assign(current,await call("/cases/"+current.id+"/plan",{method:"POST"}));clearDraft();render(current);
 message("Plan guardado. Revisa citas, faltantes y autorizaciones antes de confirmar.");
 }catch(error){message(error.message);}finally{lock(false);}});
$("#workspaceLogout").addEventListener("click",async()=>{if(busy)return;lock(true);try{
 saveDraft();await call("/session",{method:"DELETE"});csrf="";current=null;organization="";member="";try{sessionStorage.removeItem("bidrooms-private-case");}catch{}
 $("#needObjective").value="";$("#needFiles").value="";$("#savedNeeds").replaceChildren();result.replaceChildren();result.hidden=true;sessionState("anonymous");
 $("#privateDocuments").hidden=true;$("#privateLogin").hidden=false;message("Sesión cerrada; los documentos permanecen en tu organización.");
 }catch(e){message(e.message);}finally{lock(false);}});
window.addEventListener("beforeunload",e=>{if(busy||$("#needFiles").files.length||!saveDraft()){e.preventDefault();e.returnValue="";}});
document.addEventListener("click",e=>{if((busy||$("#needFiles").files.length||!draftSafe)&&e.target.closest("a[href]")){e.preventDefault();e.stopImmediatePropagation();message("Termina la operación o retira el archivo seleccionado antes de cambiar de vista.");}},true);
(async()=>{if(!api){message("El espacio privado aún no está habilitado. Puedes explorar el registro sin cuenta.");return;}
 try{const url=new URL(api,location.href);if(url.protocol!=="https:"&&!(url.hostname===location.hostname&&["localhost","127.0.0.1"].includes(url.hostname)))throw Error();
 if(!(await call("/status")).ready)throw Error();ready=true;await session();
 }catch{sessionState("unavailable");message("El espacio privado no está disponible. No incorpores documentos confidenciales; el registro público sigue accesible.");}
})();
})();
