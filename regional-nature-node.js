'use strict';
const fs=require('fs');
const F='world-state.json';
const s=JSON.parse(fs.readFileSync(F,'utf8'));
const month=new Date(s.updatedAt||Date.now()).getUTCMonth()+1;
const pacificSeason=(month>=5&&month<=11)?((month===7||month===8)?'rainy-with-veranillo-window':'rainy'):'dry';
const sources={
  imhpaRain:{authority:'Instituto de Meteorologia e Hidrologia de Panama (IMHPA)',url:'https://www.imhpa.gob.pa/es/regimen-pluviometrico-panama',scope:'Panama/Pacific rainfall regime',claim:'Pacific rainy season broadly May-November; dry season December-April; veranillo often July-August; afternoon convection common in rainy season'},
  miambienteLand:{authority:'MiAmbiente / SINIA',url:'https://geoportal.miambiente.gob.pa/server/rest/services/Hosted/Cobertura_Boscosa_y_Uso_de_Suelo__año_2021__1_25_000__WTL1/MapServer',scope:'Panama land cover',claim:'official 2021 land-cover/use map at 1:25,000'},
  miambienteSoils:{authority:'MiAmbiente / SINIA',url:'https://geoportal.miambiente.gob.pa/server/rest/services/Nodo_Suelos/MapServer',scope:'Panama soils/geomorphology/lithology',claim:'official soil, geomorphology, lithology and historical land-cover layers'},
  miambienteHydro:{authority:'MiAmbiente / SINIA',url:'https://geoportal.miambiente.gob.pa/server/rest/services/Hosted/Cuencas_hidrograficas/FeatureServer',scope:'Panama watersheds',claim:'official hydrographic basin context where available'},
  nasaEnergy:{authority:'NASA Science',url:'https://science.nasa.gov/earth/earth-observatory/climate-and-earths-energy-budget/',scope:'Earth energy balance',claim:'solar forcing, reflection, absorption, evaporation, convection and longwave emission must respect energy conservation'}
};
s.regionalNature={
  schema:1,
  region:'Penonome, Cocle, Panama',
  hemisphere:'northern-tropics',
  climateContext:{coast:'Pacific side of Panama',month,pacificSeason,confidence:'regional prior only; not a substitute for station observations',rules:['measured/observed weather overrides this prior','do not force rain merely because the season is rainy','season context may modulate probabilities only after calibration against station data']},
  physicalRules:{energy:'conserve tracked energy; solar forcing enters, storage/phase change/longwave/convection remove or redistribute it',water:'conserve tracked water mass across precipitation, storage, infiltration, runoff, uptake and evaporation',sediment:'erosion is a transfer between tracked soil/sediment reservoirs, not creation/destruction of mass',biology:'germination and growth require local water/temperature/resource viability; death returns matter to detrital/soil pools'},
  sourcePolicy:'official Panama sources first; primary scientific sources for universal physics; unknown site-specific values stay unknown until observed or calibrated',
  sources
};
if(s.rizoma?.nodes&&!s.rizoma.nodes.some(n=>n.id==='regional-natural-context'))s.rizoma.nodes.push({id:'regional-natural-context'});
if(s.rizoma?.links){const add=(from,to,relation)=>{if(!s.rizoma.links.some(x=>x.from===from&&x.to===to&&x.relation===relation))s.rizoma.links.push({from,to,relation})};add('regional-natural-context','atmosphere','regional-prior');add('regional-natural-context','soil','regional-calibration');add('regional-natural-context','land-cover','regional-calibration');add('regional-natural-context','hydrography','regional-calibration')}
fs.writeFileSync(F,JSON.stringify(s,null,2)+'\n');
console.log(JSON.stringify({regionalNature:s.regionalNature.climateContext,sources:Object.keys(sources)},null,2));