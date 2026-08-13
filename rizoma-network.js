'use strict';
const fs=require('fs'),F='world-state.json';
const s=JSON.parse(fs.readFileSync(F,'utf8'));
const nodes=['atmosphere','solar-energy','surface-water','soil-water','soil','seed-bank','plants','agents','atlas','terrain'];
const links=[
 ['atmosphere','surface-water','precipitation'],['surface-water','soil-water','infiltration'],['soil-water','atmosphere','evapotranspiration'],['terrain','surface-water','gravity-runoff'],['solar-energy','atmosphere','heating'],['solar-energy','plants','photosynthetic-energy'],['soil','plants','nutrients'],['soil-water','plants','water-uptake'],['plants','seed-bank','reproduction'],['seed-bank','plants','germination'],['agents','soil','compaction'],['terrain','agents','movement-cost'],['surface-water','agents','hydration'],['plants','atmosphere','transpiration'],['atlas','agents','observation'],['atlas','plants','observation'],['atlas','surface-water','observation']
];
s.rizoma={version:1,authority:'distributed causal network',nodes:nodes.map(id=>({id})),links:links.map(([from,to,relation])=>({from,to,relation})),principles:['no linear pipeline authority','bidirectional feedback allowed','state changes require causal provenance','renderer observes network state only']};
fs.writeFileSync(F,JSON.stringify(s,null,2)+'\n');