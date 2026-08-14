'use strict';
const fs=require('fs');
const F='world-state.json';
const C=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const now=()=>new Date().toISOString();
const s=JSON.parse(fs.readFileSync(F,'utf8'));

s.phase=s.phase||{};
s.phase.current='landscape';
s.phase.order=['landscape','animals','humans'];
s.phase.rule='environment must remain causally self-sustaining before fauna or humans become active';
s.phase.updatedAt=now();

// Preserve history without allowing humans/Atlas to alter Phase I.
if(!s.archive)s.archive={};
if(!s.archive.humans&&Array.isArray(s.agents)&&s.agents.length)s.archive.humans=structuredClone(s.agents);
if(!s.archive.atlas&&s.atlas)s.archive.atlas=structuredClone(s.atlas);
s.agents=[];
s.atlas=null;
if(s.representation?.entities){s.representation.entities.agents=[];s.representation.entities.atlas=null;}

const g=s.grid;
if(!g?.cells?.length)throw Error('Landscape phase requires causal grid state');
const area=(g.cellMeters||4.5)**2;
const dtHours=Math.max(0.25,Number(s.lastDtHours||1));
const bulkDensity=1300; // kg/m3 modeled mineral-soil bulk density prior, not a measured site fact
const activeDepth=0.10;

s.landscape=s.landscape||{version:1};
s.landscape.provenance={
  model:'coarse-grained landscape processes',
  note:'bulk density and active erosion depth are model parameters until site measurements exist; transfers remain internally conservative'
};
s.landscape.cells=s.landscape.cells||{};

// Initialize tracked reservoirs without changing the verified DEM.
for(const c of g.cells){
  const q=s.landscape.cells[c.id]||(s.landscape.cells[c.id]={});
  if(!Number.isFinite(q.erodibleSoilKg))q.erodibleSoilKg=area*activeDepth*bulkDensity;
  if(!Number.isFinite(q.mobileSedimentKg))q.mobileSedimentKg=0;
  if(!Number.isFinite(q.deadOrganicKg))q.deadOrganicKg=0;
  if(!Number.isFinite(q.stableOrganicKg))q.stableOrganicKg=Math.max(0,(c.soil?.organic||0)*area*4);
}

const plantByCell=new Map();
for(const p of s.plants||[]){const id=Number.isFinite(p.cell)?p.cell:Math.max(0,Math.min(g.cells.length-1,Math.floor((p.y||0)*g.h)*g.w+Math.floor((p.x||0)*g.w)));const v=plantByCell.get(id)||{bio:0,n:0};v.bio+=Math.max(0,+p.biomassKg||+p.biomass||0);v.n++;plantByCell.set(id,v)}

let eroded=0,deposited=0,organicTurnover=0,stabilized=0;
const sedimentDelta=Array(g.cells.length).fill(0),soilDelta=Array(g.cells.length).fill(0);
for(const c of g.cells){
  const q=s.landscape.cells[c.id],veg=plantByCell.get(c.id)||{bio:0,n:0};
  const cover=C(veg.bio/2.5,0,.95),water=Math.max(0,+c.waterMm||0),moist=C(c.soil?.moisture||0),comp=C(c.soil?.compaction||0);
  let target=null,best=0;
  for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const x=c.x+dx,y=c.y+dy;if(x<0||x>=g.w||y<0||y>=g.h)continue;const n=g.cells[y*g.w+x],drop=(+c.elevation||0)-(+n.elevation||0);if(drop>best){best=drop;target=n}}
  const slope=C(best/Math.max(0.1,g.cellMeters||4.5),0,1);
  const erosivity=C((water/20)+slope*.8,0,1);
  const detach=Math.min(q.erodibleSoilKg, q.erodibleSoilKg*(0.0000025+0.00004*erosivity)*(1-cover)*(1+comp*.4)*dtHours);
  if(detach>0&&target){soilDelta[c.id]-=detach;sedimentDelta[target.id]+=detach;eroded+=detach}
  // Biomass litterfall/turnover transfers living biomass into detrital pool conceptually.
  const litter=veg.bio*0.00012*dtHours;
  q.deadOrganicKg+=litter;organicTurnover+=litter;
  // Moist warm soil decomposes detritus into stable soil organic matter reservoir.
  const temp=+s.weather?.tempC||27,tempFactor=C((temp-10)/20,0,1.5);
  const dec=Math.min(q.deadOrganicKg,q.deadOrganicKg*0.0018*moist*tempFactor*dtHours);
  q.deadOrganicKg-=dec;q.stableOrganicKg+=dec;stabilized+=dec;
}
for(let i=0;i<g.cells.length;i++){
  const q=s.landscape.cells[i];
  if(soilDelta[i])q.erodibleSoilKg=Math.max(0,q.erodibleSoilKg+soilDelta[i]);
  if(sedimentDelta[i]){q.mobileSedimentKg+=sedimentDelta[i];deposited+=sedimentDelta[i]}
  // settle a fraction of mobile sediment; this remains in the same cell reservoir and does not mutate authoritative DEM yet
  const settle=q.mobileSedimentKg*Math.min(.35,.02*dtHours);q.mobileSedimentKg-=settle;q.erodibleSoilKg+=settle;
}

s.landscape.budget={
  erodedKg:+eroded.toFixed(6),
  transferredSedimentKg:+deposited.toFixed(6),
  sedimentTransferResidualKg:+(eroded-deposited).toFixed(9),
  litterTurnoverKg:+organicTurnover.toFixed(6),
  stabilizedOrganicKg:+stabilized.toFixed(6)
};
s.landscape.activeProcesses=['atmosphere','solar forcing','precipitation','surface runoff','infiltration','evapotranspiration','soil moisture','seed bank','germination','plant growth','plant death','seed dispersal','erosion','sediment transport','litter turnover','decomposition'];
s.landscape.gates={animals:false,humans:false,criteria:'activate only after landscape budgets remain stable and causal for sustained cycles'};

s.metrics=s.metrics||{};
s.metrics.population=0;
s.metrics.activeAnimals=0;
s.metrics.phase='landscape';
s.metrics.plants=(s.plants||[]).length;
s.events=s.events||[];
s.events.push({at:now(),type:'landscape-phase-heartbeat',cause:'Phase I autonomous environment',budget:s.landscape.budget});
if(s.events.length>2000)s.events=s.events.slice(-2000);

fs.writeFileSync(F,JSON.stringify(s,null,2)+'\n');
console.log(JSON.stringify({phase:s.phase.current,plants:s.metrics.plants,budget:s.landscape.budget,gates:s.landscape.gates},null,2));
