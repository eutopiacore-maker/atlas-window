'use strict';

const fs = require('fs');
const F = 'world-state.json';
const TARGET_CELL_M = 4.5;
const TIME_SCALE = 12;
const C = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

const SI = Object.freeze({
  c_m_s: 299792458,
  h_J_s: 6.62607015e-34,
  e_C: 1.602176634e-19,
  k_B_J_K: 1.380649e-23,
  N_A_mol_1: 6.02214076e23,
  standardGravity_m_s2: 9.80665,
  standardAtmosphere_Pa: 101325
});

const SOURCES = Object.freeze({
  anatiDistrictHead: {
    authority: 'Instituto Geográfico Nacional Tommy Guardia / ANATI',
    title: 'Cabecera de Distrito de la República de Panamá, escala 1:25 000, Versión 2, año 2025',
    url: 'https://sigigntg.anati.gob.pa/arcgisserver/rest/services/Mapa_Web_de_Poblados_2025_MIL1/MapServer/2',
    role: 'official administrative anchor'
  },
  miambienteRelief: {
    authority: 'Ministerio de Ambiente de Panamá / SINIA',
    title: 'Base Relieve Batimetría — Relieve SRTM 30 m',
    url: 'https://geoportal.miambiente.gob.pa/server/rest/services/Hosted/Base_Relieve_Batimetria/MapServer',
    role: 'officially published relief reference'
  },
  miambienteLandCover: {
    authority: 'Ministerio de Ambiente de Panamá / SINIA',
    title: 'Cobertura de Bosque y Uso de Suelo 2021, escala 1:25 000',
    url: 'https://geoportal.miambiente.gob.pa/server/rest/services/Nodo_Suelos/MapServer/1',
    role: 'land-cover reference'
  },
  miambienteHydro: {
    authority: 'Ministerio de Ambiente de Panamá / SINIA',
    title: 'Nodo Característica General — Red Hídrica',
    url: 'https://geoportal.miambiente.gob.pa/server/rest/services/Nodo_Caracteristica_General/MapServer',
    role: 'hydrography and roads reference'
  },
  esaWorldCover: {
    authority: 'European Space Agency',
    title: 'ESA WorldCover 2021 v200, 10 m',
    url: 'https://esa-worldcover.org/en/data-access',
    role: 'open global land-cover cross-check',
    license: 'CC BY 4.0'
  }
});

const LINKS = [
  ['atmosphere','surface-water','precipitation'], ['surface-water','soil-water','infiltration'],
  ['soil-water','atmosphere','evapotranspiration'], ['terrain','surface-water','gravity-runoff'],
  ['solar-energy','atmosphere','radiative-heating'], ['solar-energy','plants','photosynthesis'],
  ['soil','plants','nutrient-availability'], ['soil-water','plants','water-availability'],
  ['seed-bank','plants','germination'], ['plants','seed-bank','reproduction'],
  ['plants','soil-water','uptake'], ['plants','soil','nutrient-uptake'],
  ['agents','soil','compaction'], ['terrain','agents','movement-context'],
  ['surface-water','agents','hydration-context'], ['official-geodata','terrain','calibration'],
  ['official-geodata','land-cover','calibration'], ['official-geodata','hydrography','calibration'],
  ['world-state','spatial-representation','projection'], ['spatial-representation','visual-decoder','observation']
];

function R(n) { return () => { n|=0; n=n+1831565813|0; let t=Math.imul(n^n>>>15,1|n); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function stableIndex(seed, n) { let x=(seed*2654435761)>>>0; x ^= x>>>16; return n ? x%n : 0; }
function clone(v){ return structuredClone(v); }

async function fetchJson(url, ms=4500){
  const ctrl=new AbortController(); const timer=setTimeout(()=>ctrl.abort(),ms);
  try { const res=await fetch(url,{headers:{'user-agent':'Atlas-Reality-Stack/1.0'},signal:ctrl.signal}); if(!res.ok) throw new Error(`HTTP ${res.status}`); return await res.json(); }
  finally { clearTimeout(timer); }
}

async function refreshOfficialContext(s){
  const checkedAt=new Date().toISOString();
  s.provenance=s.provenance||{};
  s.provenance.sources=clone(SOURCES);
  s.provenance.checks=s.provenance.checks||{};
  const p=new URLSearchParams({where:"NOMBRE_TOPONIMO='Penonomé'",outFields:'NOMBRE_TOPONIMO,LMPR_NOMB_1,LMDI_NOMB_1,LMCO_NOMB_1,Cod_Distrito,Cod_Provincia',returnGeometry:'true',outSR:'4326',f:'json'});
  const query=`${SOURCES.anatiDistrictHead.url}/query?${p}`;
  try {
    const j=await fetchJson(query); const f=j.features?.[0];
    if(f?.geometry && Number.isFinite(f.geometry.x) && Number.isFinite(f.geometry.y)){
      s.geo=s.geo||{};
      s.geo.anchor={lon:+f.geometry.x.toFixed(7),lat:+f.geometry.y.toFixed(7),crs:'EPSG:4326',source:'anatiDistrictHead',verifiedAt:checkedAt};
      s.geo.admin={province:f.attributes?.LMPR_NOMB_1||'Coclé',district:f.attributes?.LMDI_NOMB_1||'Penonomé',corregimiento:f.attributes?.LMCO_NOMB_1||null,codes:{district:f.attributes?.Cod_Distrito||null,province:f.attributes?.Cod_Provincia||null}};
      s.provenance.checks.anatiDistrictHead={ok:true,checkedAt};
    } else throw new Error('official feature not returned');
  } catch(e){ s.provenance.checks.anatiDistrictHead={ok:false,checkedAt,error:String(e.message||e)}; }
  for(const id of ['miambienteRelief','miambienteLandCover','miambienteHydro']){
    try { await fetchJson(`${SOURCES[id].url}?f=json`,3000); s.provenance.checks[id]={ok:true,checkedAt}; }
    catch(e){ s.provenance.checks[id]={ok:false,checkedAt,error:String(e.message||e)}; }
  }
  return s;
}

function distributeSeeds(parent, childCells){
  for(const species of ['grass','tree']){
    const total=Math.max(0,Math.floor(Number(parent.seeds?.[species]||0)));
    for(let i=0;i<total;i++) childCells[stableIndex(parent.id*131+i*17+(species==='tree'?7:3),childCells.length)].seeds[species]++;
  }
}

function bilinearOld(old,x,y,key){
  const gx=C(x,0,old.w-1), gy=C(y,0,old.h-1), x0=Math.floor(gx), y0=Math.floor(gy), x1=Math.min(old.w-1,x0+1), y1=Math.min(old.h-1,y0+1), tx=gx-x0, ty=gy-y0;
  const v=(xx,yy)=>Number(key(old.cells[yy*old.w+xx])||0);
  return v(x0,y0)*(1-tx)*(1-ty)+v(x1,y0)*tx*(1-ty)+v(x0,y1)*(1-tx)*ty+v(x1,y1)*tx*ty;
}

function refineGrid(s){
  const g=s.grid; if(!g?.cells?.length || Number(g.cellMeters||18)<=TARGET_CELL_M+1e-9) return s;
  const factor=Math.max(2,Math.round(Number(g.cellMeters||18)/TARGET_CELL_M));
  const old={w:g.w,h:g.h,cellMeters:g.cellMeters,cells:g.cells};
  const nw=old.w*factor, nh=old.h*factor, cellMeters=old.cellMeters/factor, cells=[];
  for(let y=0;y<nh;y++) for(let x=0;x<nw;x++){
    const px=Math.min(old.w-1,Math.floor(x/factor)), py=Math.min(old.h-1,Math.floor(y/factor)), p=old.cells[py*old.w+px];
    const ox=(x+.5)/factor-.5, oy=(y+.5)/factor-.5;
    const elevation=bilinearOld(old,px+ox,py+oy,c=>c.elevation);
    cells.push({id:y*nw+x,x,y,elevation:+elevation.toFixed(6),soil:{sand:Number(p.soil?.sand||.5),organic:Number(p.soil?.organic||.3),nutrients:Number(p.soil?.nutrients||.6),moisture:Number(p.soil?.moisture||.5),compaction:Number(p.soil?.compaction||.1)},fieldCapacityMm:Number(p.fieldCapacityMm||62.5),soilWaterMm:Number(p.soilWaterMm||0),waterMm:Number(p.waterMm||0),seeds:{grass:0,tree:0},provenance:{terrain:'legacy-v5-interpolated',soil:'legacy-v5-preserved'}});
  }
  for(const p of old.cells){ const kids=[]; const bx=p.x*factor, by=p.y*factor; for(let yy=0;yy<factor;yy++) for(let xx=0;xx<factor;xx++) kids.push(cells[(by+yy)*nw+(bx+xx)]); distributeSeeds(p,kids); }
  s.grid={w:nw,h:nh,cellMeters:+cellMeters.toFixed(4),cells,extentMeters:{width:nw*cellMeters,height:nh*cellMeters},provenance:{terrainStatus:'legacy-synthetic-prior-preserved-not-geographic-truth',refinedFrom:{w:old.w,h:old.h,cellMeters:old.cellMeters},method:'deterministic bilinear refinement; no new terrain facts invented'}};
  for(const p of s.plants||[]) p.cell=C(Math.floor(p.y*nh),0,nh-1)*nw+C(Math.floor(p.x*nw),0,nw-1);
  s.migrations=s.migrations||[]; s.migrations.push({at:new Date().toISOString(),type:'conservative-grid-refinement',from:`${old.w}x${old.h}@${old.cellMeters}m`,to:`${nw}x${nh}@${cellMeters}m`,historyPreserved:true});
  return s;
}

function ensure(s,r){
  s.schema=6; s.timeScale=TIME_SCALE; s.events=Array.isArray(s.events)?s.events:[]; s.plants=Array.isArray(s.plants)?s.plants:[]; s.ecology=s.ecology||{next:1,germinations:0,deaths:0,dispersals:0};
  s.geo=s.geo||{anchor:{lat:8.51208,lon:-80.35468,crs:'EPSG:4326',source:'legacy-reference-unverified'}};
  s.physicsConstants={system:'SI',values:clone(SI),scalePolicy:'Use exact/conventional constants where defined; numerical models are scale-appropriate approximations that must conserve tracked quantities.'};
  s.matter={model:'coarse-grained continuum',rule:'microscopic laws are not replaced; they are coarse-grained into conserved macroscopic state until a finer scale is activated',materials:{water:{formula:'H2O',state:'liquid continuum'},soil:{state:'porous multiphase mixture'},biomass:{state:'living organic matter, aggregate composition unresolved'},air:{state:'gas mixture, composition unresolved at current scale'}}};
  s.weather={cloud:s.weather?.cloud??.5,humidity:s.weather?.humidity??.76,wind:s.weather?.wind??.2,rainMm:0,tempC:s.weather?.tempC??27,solar:s.weather?.solar??0,provenance:s.weather?.provenance||'internal-evolving-state'};
  for(const c of s.grid?.cells||[]){ c.soil=c.soil||{sand:.5,organic:.3,nutrients:.6,moisture:.5,compaction:.1}; c.seeds=c.seeds||{grass:0,tree:0}; c.waterMm=Number(c.waterMm||0); c.fieldCapacityMm=Number(c.fieldCapacityMm||55+25*Number(c.soil.organic||.3)); c.soilWaterMm=Number.isFinite(c.soilWaterMm)?c.soilWaterMm:C(Number(c.soil.moisture||.5))*c.fieldCapacityMm; c.soil.moisture=C(c.soilWaterMm/c.fieldCapacityMm); }
  for(const a of s.agents||[]){ a.hydration=Number.isFinite(a.hydration)?a.hydration:.7; a.tx=Number.isFinite(a.tx)?a.tx:a.x; a.ty=Number.isFinite(a.ty)?a.ty:a.y; }
  s.rizoma={version:3,topology:'synchronized-causal-rhizome',nodes:['official-geodata','atmosphere','solar-energy','surface-water','soil-water','soil','seed-bank','plants','agents','atlas','terrain','world-state','spatial-representation','visual-decoder'].map(id=>({id})),links:LINKS.map(([from,to,relation])=>({from,to,relation})),settlement:'all causal nodes read the same prior snapshot; deltas merge once per pulse',renderer:'observer-only'};
  s.laws={version:3,active:{gravity:{constant:'standardGravity_m_s2',model:'kinematic shallow-runoff approximation'},massConservation:{water:true,seedCount:true},energy:{solarForcing:true,biologicalStorage:true},thermodynamics:{status:'coarse-grained'},matter:{status:'continuum coarse-grained'}},nonNegotiable:'No visual entity may be created without a world-state referent; unresolved physical detail remains unknown rather than invented.'};
  refineGrid(s);
  return s;
}

function atmosphereNode(prev,dtHours,r,nextSimMinutes){ const w=prev.weather,day=(nextSimMinutes/1440)%1,cloud=C(w.cloud+(r()-.48)*.12),humidity=C(w.humidity+(r()-.5)*.08,.4,.98),wind=C(w.wind+(r()-.5)*.06,.03,.85),solarRaw=Math.max(0,Math.sin((day-.25)*Math.PI*2)),solar=C(solarRaw*(1-cloud*.72)),rainMm=+(cloud>.62&&humidity>.7?((cloud-.55)*8+(humidity-.68)*10+r()*2)*dtHours:0).toFixed(3),tempC=+(27.2+2.4*Math.sin((day-.25)*Math.PI*2)-cloud*1.3-r()*.5).toFixed(2); return{cloud,humidity,wind,solar:+solar.toFixed(4),rainMm,tempC,provenance:'internal-evolving-state'}; }

function waterNode(prev,weather,dtHours){
  const cells=prev.grid.cells,ds=new Array(cells.length).fill(0),dw=new Array(cells.length).fill(0),g=SI.standardGravity_m_s2,dt=dtHours*3600,L=prev.grid.cellMeters; let rain=0,evap=0,runoff=0,infil=0;
  for(const c of cells){
    const available=Number(c.waterMm||0)+weather.rainMm; rain+=weather.rainMm;
    let infiltration=Math.max(0,dtHours*(.35+Number(c.soil.sand||.5)*.55)*(1-Number(c.soil.compaction||0)));
    let surfaceEvap=Math.max(0,dtHours*(.025+.08*weather.solar)*(1-weather.humidity)*(1+weather.wind));
    let target=null,best=0;
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){ const x=c.x+dx,y=c.y+dy;if(x<0||x>=prev.grid.w||y<0||y>=prev.grid.h)continue;const n=cells[y*prev.grid.w+x],drop=Number(c.elevation||0)-Number(n.elevation||0)+(available-Number(n.waterMm||0))/1000;if(drop>best){best=drop;target=n;} }
    const velocity=target?Math.sqrt(Math.max(0,2*g*best)):0,travel=C(velocity*dt/Math.max(L,1),0,1),flow=target?available*Math.min(.45,travel):0;
    const requested=infiltration+surfaceEvap+flow,scale=requested>available&&requested>0?available/requested:1; infiltration*=scale;surfaceEvap*=scale;const q=flow*scale;
    const soilEvap=Math.min(Number(c.soilWaterMm||0),dtHours*(.015+.055*weather.solar)*(1-weather.humidity)*(1+weather.wind));
    ds[c.id]+=weather.rainMm-infiltration-surfaceEvap-q; dw[c.id]+=infiltration-soilEvap; if(target)ds[target.id]+=q; infil+=infiltration;evap+=surfaceEvap+soilEvap;runoff+=q;
  }
  return{surfaceDelta:ds,soilDelta:dw,rainTotal:rain,evaporationTotal:evap,runoffTotal:runoff,infiltrationTotal:infil};
}

function biologyNode(prev,weather,dtHours,r,at){
  const seedDelta=prev.grid.cells.map(()=>({grass:0,tree:0})),soilWaterDelta=new Array(prev.grid.cells.length).fill(0),nutrientDelta=new Array(prev.grid.cells.length).fill(0),events=[],plants=[]; let germinations=0,deaths=0,dispersals=0,nextId=Number(prev.ecology.next||1);
  for(const c of prev.grid.cells) for(const species of ['grass','tree']){ const seeds=Number(c.seeds?.[species]||0),threshold=species==='grass'?.34:.42,chance=species==='grass'?.32:.055;if(seeds>0&&c.soil.moisture>threshold&&weather.tempC>19&&r()<chance*dtHours/24){const id=`pl${nextId++}`;seedDelta[c.id][species]--;plants.push({id,species,x:+((c.x+r())/prev.grid.w).toFixed(6),y:+((c.y+r())/prev.grid.h).toFixed(6),cell:c.id,ageHours:0,biomassKg:.04,biomass:.04,health:.82,stage:'seedling',bornAt:at,bornFrom:'seed-bank',provenance:{causeEvent:'germination'}});events.push({at,type:'germination',entity:id,cause:`${species} seed + viable soil-water-temperature state`,cell:c.id});germinations++;} }
  for(const old of prev.plants){const p={...old},c=prev.grid.cells[p.cell];if(!c)continue;const tree=p.species==='tree',wf=C((c.soil.moisture-(tree?.42:.34))/.4),nf=C(Number(c.soil.nutrients||0)/.55),tf=C(1-Math.abs(weather.tempC-26)/14),rf=Math.min(wf,nf,tf);p.ageHours=Number(p.ageHours||0)+dtHours;p.biomass=C(Number(p.biomass||p.biomassKg||.04)+(tree?.004:.032)*dtHours/24*rf,0,tree?7:1);p.biomassKg=p.biomass;p.health=C(Number(p.health||.8)+(rf-.38)*.02*dtHours/24);p.stage=p.ageHours<24?'seedling':p.ageHours<(tree?3600:48)?'juvenile':'mature';soilWaterDelta[c.id]-=p.biomass*.0007*dtHours;nutrientDelta[c.id]-=p.biomass*.00018*dtHours;if(p.health<.07){deaths++;events.push({at,type:'plant-death',entity:p.id,cause:'resource/health limit',cell:c.id});continue;}if(p.stage==='mature'&&r()<(tree?.018:.16)*dtHours/24){const x=C(c.x+Math.round((r()-.5)*3),0,prev.grid.w-1),y=C(c.y+Math.round((r()-.5)*3),0,prev.grid.h-1);seedDelta[y*prev.grid.w+x][p.species]++;dispersals++;}plants.push(p);}
  return{plants:plants.slice(0,4000),seedDelta,soilWaterDelta,nutrientDelta,events,germinations,deaths,dispersals,nextId};
}

function agentsNode(prev,dtHours,r){const dc=new Array(prev.grid.cells.length).fill(0),cells=prev.grid.cells,wet=cells.slice().sort((a,b)=>(Number(b.waterMm||0)+b.soil.moisture*8)-(Number(a.waterMm||0)+a.soil.moisture*8))[0];const agents=(prev.agents||[]).map(old=>{const a={...old};a.energy=C((a.energy??.7)-.002*dtHours);a.hydration=C((a.hydration??.7)-.0035*dtHours);if(a.hydration<.34){a.need='water';a.tx=(wet.x+.5)/prev.grid.w;a.ty=(wet.y+.5)/prev.grid.h;}else if(a.energy<.28)a.need='rest';else if(r()<.18){a.need='explore';a.tx=r();a.ty=r();}if(a.need==='rest')a.energy=C(a.energy+.009*dtHours);else{const dx=a.tx-a.x,dy=a.ty-a.y,d=Math.hypot(dx,dy)||1,m=Math.min(d,.0035*dtHours);a.x=C(a.x+dx/d*m,.02,.98);a.y=C(a.y+dy/d*m,.02,.98);}const id=C(Math.floor(a.y*prev.grid.h),0,prev.grid.h-1)*prev.grid.w+C(Math.floor(a.x*prev.grid.w),0,prev.grid.w-1);dc[id]+=.0004*dtHours;const c=cells[id];if(a.need==='water'&&(Number(c.waterMm||0)>.4||c.soil.moisture>.67))a.hydration=C(a.hydration+.08*dtHours);return a;});return{agents,compactionDelta:dc};}

function buildRepresentation(s){
  const a=s.geo?.anchor||{lat:8.51208,lon:-80.35468}; const width=s.grid.w*s.grid.cellMeters,height=s.grid.h*s.grid.cellMeters,latM=111320,lonM=111320*Math.cos((a.lat||0)*Math.PI/180);
  const geo=(x,y)=>({lat:+(a.lat+((.5-y)*height)/latM).toFixed(7),lon:+(a.lon+((x-.5)*width)/lonM).toFixed(7)});
  s.representation={schema:1,type:'spatial-intermediate-representation',frame:{anchor:a,localExtentMeters:{width,height},cellMeters:s.grid.cellMeters,orientation:{x:'east',y:'south'}},fields:{terrain:{path:'grid.cells[].elevation',units:'legacy-relative-height',truthStatus:s.grid.provenance?.terrainStatus||'unknown'},surfaceWater:{path:'grid.cells[].waterMm',units:'mm'},soilMoisture:{path:'grid.cells[].soil.moisture',units:'fraction'},landCover:{status:'official-source-linked-not-yet-sampled',source:'miambienteLandCover'}},entities:{plants:(s.plants||[]).map(p=>({id:p.id,kind:p.species,x:p.x,y:p.y,geo:geo(p.x,p.y),biomassKg:p.biomassKg??p.biomass,health:p.health,stage:p.stage,source:'world-state'})),agents:(s.agents||[]).map(p=>({id:p.id,kind:'human-agent',x:p.x,y:p.y,geo:geo(p.x,p.y),need:p.need,source:'world-state'})),atlas:s.atlas?{id:'atlas',kind:'atlas',x:s.atlas.x,y:s.atlas.y,geo:geo(s.atlas.x,s.atlas.y),source:'world-state'}:null},visualDecoderContract:{mode:'neural-ready',inputs:['semantic entities','terrain field','water field','soil field','weather','solar state','camera pose'],hardRule:'decoder may change appearance only; it may not create, delete or relocate world entities',fallback:'lightweight WebGL field renderer'}};
  return s;
}

function pulse(s){
  const now=new Date(),r=R((Number(s.cycle||0)+1)*7919+Math.floor(now/9e5)); s=ensure(s,r); const elapsed=Math.max(1,Math.min(120,(now-new Date(s.updatedAt||now))/6e4||15)),dtHours=elapsed*TIME_SCALE/60,nextSim=Number(s.simMinutes||0)+dtHours*60,prev=clone(s),weather=atmosphereNode(prev,dtHours,r,nextSim),water=waterNode(prev,weather,dtHours),bio=biologyNode(prev,weather,dtHours,r,now.toISOString()),agents=agentsNode(prev,dtHours,r);
  s.cycle=Number(s.cycle||0)+1;s.simMinutes=nextSim;s.updatedAt=now.toISOString();s.weather=weather;s.agents=agents.agents;s.plants=bio.plants;s.ecology.next=bio.nextId;s.ecology.germinations=Number(s.ecology.germinations||0)+bio.germinations;s.ecology.deaths=Number(s.ecology.deaths||0)+bio.deaths;s.ecology.dispersals=Number(s.ecology.dispersals||0)+bio.dispersals;
  for(const c of s.grid.cells){const p=prev.grid.cells[c.id];c.waterMm=Math.max(0,Number(p.waterMm||0)+water.surfaceDelta[c.id]);c.soilWaterMm=Math.max(0,Number(p.soilWaterMm||0)+water.soilDelta[c.id]+bio.soilWaterDelta[c.id]);c.soil.moisture=C(c.soilWaterMm/c.fieldCapacityMm);c.soil.nutrients=C(Number(p.soil.nutrients||0)+bio.nutrientDelta[c.id]);c.soil.compaction=C(Number(p.soil.compaction||0)+agents.compactionDelta[c.id]);c.seeds.grass=Math.max(0,Number(p.seeds.grass||0)+bio.seedDelta[c.id].grass);c.seeds.tree=Math.max(0,Number(p.seeds.tree||0)+bio.seedDelta[c.id].tree);}
  const area=s.grid.cellMeters*s.grid.cellMeters,storageBefore=prev.grid.cells.reduce((n,c)=>n+(Number(c.waterMm||0)+Number(c.soilWaterMm||0))*area,0),storageAfter=s.grid.cells.reduce((n,c)=>n+(Number(c.waterMm||0)+Number(c.soilWaterMm||0))*area,0),rainVol=water.rainTotal*area,evapVol=water.evaporationTotal*area,uptake=-bio.soilWaterDelta.reduce((n,v)=>n+Math.min(0,v),0)*area,residual=storageAfter-(storageBefore+rainVol-evapVol-uptake);
  if(weather.rainMm>0)s.events.push({at:s.updatedAt,type:'rainfall',cause:'atmospheric humidity + cloud forcing',rainMm:weather.rainMm});s.events.push(...bio.events);s.events=s.events.slice(-300);const last=s.events.at(-1);if(s.atlas&&last){s.atlas.attention=last.type;s.atlas.intent='observe causal network state';}
  s.physics={waterBalance:{cellAreaM2:+area.toFixed(4),storageBefore_L:+storageBefore.toFixed(4),precipitation_L:+rainVol.toFixed(4),evaporation_L:+evapVol.toFixed(4),plantUptake_L:+uptake.toFixed(4),internalRunoffTransfer_L:+(water.runoffTotal*area).toFixed(4),infiltrationTransfer_L:+(water.infiltrationTotal*area).toFixed(4),storageAfter_L:+storageAfter.toFixed(4),residual_L:+residual.toFixed(6)}};
  s.metrics={population:(s.agents?.length||0)+(s.atlas?1:0),plants:s.plants.length,germinations:s.ecology.germinations,deaths:s.ecology.deaths,seeds:s.grid.cells.reduce((n,c)=>n+Number(c.seeds.grass||0)+Number(c.seeds.tree||0),0),surfaceWater_L:+(s.grid.cells.reduce((n,c)=>n+Number(c.waterMm||0),0)*area).toFixed(2),soilWater_L:+(s.grid.cells.reduce((n,c)=>n+Number(c.soilWaterMm||0),0)*area).toFixed(2),meanSoilMoisture:+(s.grid.cells.reduce((n,c)=>n+c.soil.moisture,0)/s.grid.cells.length).toFixed(3),solar:weather.solar,waterMassResidual_L:+residual.toFixed(6),cells:s.grid.cells.length,cellMeters:s.grid.cellMeters};
  buildRepresentation(s); return s;
}

async function main(){
  let state; try{state=JSON.parse(fs.readFileSync(F,'utf8'));}catch{state={schema:0,world:'Eutopia/Penonome',bornAt:new Date().toISOString(),updatedAt:new Date().toISOString(),cycle:0,simMinutes:0,agents:[],atlas:{x:.5,y:.5,energy:.9},events:[],grid:{w:10,h:8,cellMeters:18,cells:[]}};}
  if(!state.grid?.cells?.length) throw new Error('Refusing to invent new terrain: no preserved grid state exists. Seed from verified geodata before first boot.');
  state=await refreshOfficialContext(state); state=pulse(state); fs.writeFileSync(F,JSON.stringify(state,null,2)+'\n');
  console.log(JSON.stringify({schema:state.schema,topology:state.rizoma?.topology,cycle:state.cycle,geo:state.geo,grid:{w:state.grid.w,h:state.grid.h,cellMeters:state.grid.cellMeters,cells:state.grid.cells.length,terrainTruth:state.grid.provenance?.terrainStatus},metrics:state.metrics,waterBalance:state.physics?.waterBalance,provenanceChecks:state.provenance?.checks,representation:state.representation?.type},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
