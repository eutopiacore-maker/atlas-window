(function(){
const root=document.body; const page=root.dataset.page||"home";
const p=location.pathname; const i=p.indexOf("/bidrooms"); const BASE=i>=0?p.slice(0,i)+"/bidrooms":"/bidrooms";
const $=(s,e=document)=>e.querySelector(s), $$=(s,e=document)=>[...e.querySelectorAll(s)];
const json=async u=>{const r=await fetch(u,{cache:"no-store"});if(!r.ok)throw new Error("HTTP "+r.status);return r.json()};
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const fmt=d=>new Intl.DateTimeFormat("es-PA",{dateStyle:"medium",timeStyle:"short"}).format(new Date(d));
function shellLinks(){ $$(".js-home").forEach(a=>a.href=BASE+"/"); $$(".js-rooms").forEach(a=>a.href=BASE+"/rooms/"); }
shellLinks();

async function home(){
 const m=await json(BASE+"/data/manifest.json");
 const list=$("#directory"); const input=$("#globalSearch");
 function render(q=""){q=q.toLowerCase().trim(); const items=[
  ...m.organizations.map(x=>({kind:"Organización",title:x.name,sub:x.type+" · "+x.status,url:x.profile?BASE+"/"+x.profile:"#"})),
  ...m.rooms.map(x=>({kind:"Licitación",title:x.title,sub:"ACP "+x.number+" · "+x.status+" · cierre "+fmt(x.closes_at),url:BASE+"/"+x.route}))
 ].filter(x=>!q||[x.title,x.sub,x.kind].join(" ").toLowerCase().includes(q));
 list.innerHTML=items.map(x=>'<a class="result" href="'+esc(x.url)+'"><article class="card"><div class="eyebrow">'+esc(x.kind)+'</div><h2 class="section-title">'+esc(x.title)+'</h2><div class="muted">'+esc(x.sub)+'</div></article></a>').join("")||'<div class="notice">Sin coincidencias.</div>';
 }
 render(); input.addEventListener("input",e=>render(e.target.value));
}
async function rooms(){
 const m=await json(BASE+"/data/manifest.json"); const box=$("#roomsList");
 box.innerHTML=m.rooms.map(x=>'<a class="result" href="'+BASE+'/'+x.route+'"><article class="card blue"><div class="eyebrow">'+esc(x.owner_id.toUpperCase())+' · '+esc(x.number)+'</div><h2 class="section-title">'+esc(x.title)+'</h2><div class="muted">'+esc(x.status)+' · '+esc(x.phase)+' · cierre '+esc(fmt(x.closes_at))+'</div></article></a>').join("");
}
async function organization(){
 const id=root.dataset.organizationId; const o=await json(BASE+"/data/organizations/"+id+".json"); const m=await json(BASE+"/data/manifest.json");
 $("#orgName").textContent=o.name; $("#orgMeta").textContent=o.type+" · "+o.jurisdiction+" · "+o.status;
 $("#orgSources").innerHTML=o.sources.map(s=>'<div class="row"><div><strong>'+esc(s.name)+'</strong><div class="muted">'+esc(s.kind)+'</div></div><a class="btn" target="_blank" rel="noopener" href="'+esc(s.url)+'">Abrir ↗</a></div>').join("");
 const rs=m.rooms.filter(r=>o.room_ids.includes(r.id)); $("#orgRooms").innerHTML=rs.map(r=>'<a class="result" href="'+BASE+'/'+r.route+'"><article class="card blue"><div class="eyebrow">Room · '+esc(r.number)+'</div><h3 class="section-title">'+esc(r.title)+'</h3><div class="muted">'+esc(r.status)+' · '+esc(r.phase)+'</div></article></a>').join("");
}
async function room(){
 const id=root.dataset.roomId||new URLSearchParams(location.search).get("id"); const r=await json(BASE+"/data/rooms/"+id+".json");
 document.title="BIDROOMS · "+r.owner_acronym+" "+r.number+" · "+r.title;
 $("#owner").textContent=r.owner_name; $("#roomTitle").textContent=r.title; $("#roomDesc").innerHTML='Adquisición de <b>'+esc(r.item.quantity)+'</b> '+esc(r.item.unit)+' · '+esc(r.item.code)+' · entrega '+esc(r.delivery.incoterm)+' en '+esc(r.delivery.location)+'.';
 $("#roomChips").innerHTML='<span class="chip">'+esc(r.owner_acronym+" "+r.number)+'</span><span class="chip blue">'+esc(r.status)+'</span><span class="chip">'+esc(r.method)+'</span>';
 $("#heroMeta").innerHTML=r.meta.map(x=>'<div class="row"><div><span>'+esc(x.label)+'</span><strong style="display:block;margin-top:4px">'+esc(x.value)+'</strong></div></div>').join("");
 const metrics=[
  ["Cantidad",r.item.quantity+" "+r.item.unit,r.item.code],
  ["Entrega",r.delivery.incoterm,r.delivery.location],
  ["Pago",r.payment_terms,"Observado en SLI"],
  ["Estado",r.status,"Consulta "+r.checked_at],
  ["Tiempo restante","", "Hasta cierre observado"]
 ];
 $("#metrics").innerHTML=metrics.map((x,idx)=>'<div class="metric '+(idx===4?"red":"")+'"><div><small>'+esc(x[0])+'</small><b '+(idx===4?'id="countdown"':'')+'>'+esc(x[1]||"Calculando…")+'</b><em>'+esc(x[2])+'</em></div></div>').join("");
 function countdown(){const d=new Date(r.closes_at)-Date.now(),el=$("#countdown");if(!el)return;if(d<=0){el.textContent="Cierre alcanzado";return}const days=Math.floor(d/86400000),h=Math.floor((d%86400000)/3600000),m=Math.floor((d%3600000)/60000);el.textContent=days+" d · "+h+" h · "+m+" min"} countdown();setInterval(countdown,60000);
 $("#timelineList").innerHTML=r.timeline.map(x=>'<div class="row"><strong>'+esc(x.label)+'</strong><span>'+esc(x.date)+'</span></div>').join("");
 const docHtml=r.documents.map(x=>'<div class="row doc"><div><strong>'+esc(x.title)+'</strong><div class="muted">'+esc(x.kind)+'</div></div><a target="_blank" rel="noopener" href="'+esc(x.url)+'">Abrir ↗</a></div>').join(""); $$(".js-docs").forEach(e=>e.innerHTML=docHtml);
 const reqHtml=r.requirements.map(x=>'<div class="row req"><input type="checkbox" data-ready="'+esc(x.id)+'"><div><strong>'+esc(x.title)+'</strong><div class="muted">'+esc(x.detail)+'</div></div><span class="pill">'+esc(x.state)+'</span></div>').join(""); $$(".js-reqs").forEach(e=>e.innerHTML=reqHtml);
 $("#amendmentsList").innerHTML=r.amendments.length?r.amendments.map(x=>'<div class="row"><strong>'+esc(x.title)+'</strong><span>'+esc(x.date)+'</span></div>').join(""):'<div class="notice">Sin enmiendas observadas al '+esc(r.checked_at)+'.</div>';
 $("#clarificationsList").innerHTML=r.clarifications.length?r.clarifications.map(x=>'<div class="row"><strong>'+esc(x.title)+'</strong></div>').join(""):'<div class="notice">Sin aclaraciones públicas cargadas.</div>';
 $("#competitionList").innerHTML=r.public_participants.length?r.public_participants.map(x=>'<div class="row"><strong>'+esc(x.name)+'</strong></div>').join(""):'<div class="notice">No hay participantes importados como hechos públicos. BIDROOMS no infiere competidores.</div>';
 $("#evidenceList").innerHTML=r.evidence.map(x=>'<div class="row"><div><strong>'+esc(x.label)+'</strong><div class="muted">'+esc(x.detail)+'</div></div><span class="pill">'+esc(x.state)+'</span></div>').join("");
 $$(".officialLink").forEach(a=>a.href=r.official_system.url);
 const tabs=$$(".tab"), panels=$$(".panel"); tabs.forEach(t=>t.addEventListener("click",()=>{tabs.forEach(x=>x.classList.remove("active"));panels.forEach(x=>x.classList.remove("active"));t.classList.add("active");$("#"+t.dataset.tab).classList.add("active")}));
 const readyKey="bidrooms-ready-"+r.id; let state={}; try{state=JSON.parse(localStorage.getItem(readyKey)||"{}")}catch(e){}
 function syncReady(){const boxes=$$("[data-ready]");boxes.forEach(b=>{if(state[b.dataset.ready])b.checked=true;b.addEventListener("change",()=>{state[b.dataset.ready]=b.checked;localStorage.setItem(readyKey,JSON.stringify(state));$$('[data-ready="'+b.dataset.ready+'"]').forEach(x=>x.checked=b.checked);updateReady()})});updateReady()}
 function updateReady(){const ids=[...new Set($$("[data-ready]").map(x=>x.dataset.ready))],n=ids.filter(id=>state[id]).length;const e=$("#readyState");if(e)e.textContent=n+" / "+ids.length+" controles marcados."} syncReady();
 const rep=$("#repForm"); if(rep)rep.addEventListener("submit",e=>{e.preventDefault();const f=new FormData(rep),ref="BR-"+r.number+"-"+Date.now().toString(36).toUpperCase(),body="BIDROOMS | REPRESENTATIVE | "+ref+"\n\nLicitación: "+r.number+" — "+r.title+"\nNombre legal: "+f.get("name")+"\nCorreo: "+f.get("email")+"\nCédula/ID: "+f.get("id")+"\nEmpresa: "+f.get("company")+"\nCargo: "+f.get("role");location.href="mailto:eutopiacore@gmail.com?subject="+encodeURIComponent("BIDROOMS | "+r.number+" | "+ref)+"&body="+encodeURIComponent(body)});
 const calc=()=>{const n=id=>parseFloat(($("#"+id)?.value||"0").replace(",","."))||0,base=n("unitCost")*r.item.quantity+n("logistics")+n("otherCost"),cost=base*(1+n("contingency")/100),m=n("margin")/100,total=m>=.99?0:cost/(1-m);if($("#priceResult"))$("#priceResult").textContent=total.toLocaleString("en-US",{style:"currency",currency:"USD"})};["unitCost","logistics","otherCost","contingency","margin"].forEach(id=>$("#"+id)?.addEventListener("input",calc));calc();
}
(async()=>{try{if(page==="home")await home();if(page==="rooms")await rooms();if(page==="organization")await organization();if(page==="room")await room()}catch(e){const box=$("#fatal");if(box){box.hidden=false;box.textContent="No se pudo cargar el sistema: "+e.message}console.error(e)}})();
})();