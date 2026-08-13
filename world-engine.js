'use strict';

const fs = require('fs');
const F = 'world-state.json';
const W = 10, H = 8, TIME_SCALE = 12;
const C = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

function R(n) {
  return () => {
    n |= 0; n = n + 1831565813 | 0;
    let t = Math.imul(n ^ n >>> 15, 1 | n);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const LINKS = [
  ['atmosphere','surface-water','precipitation'],
  ['surface-water','soil-water','infiltration'],
  ['soil-water','atmosphere','evaporation'],
  ['terrain','surface-water','gravity-runoff'],
  ['solar-energy','atmosphere','heating'],
  ['solar-energy','plants','photosynthesis'],
  ['soil','plants','nutrient-availability'],
  ['soil-water','plants','water-availability'],
  ['seed-bank','plants','germination'],
  ['plants','seed-bank','reproduction'],
  ['plants','soil-water','uptake'],
  ['plants','soil','nutrient-uptake'],
  ['agents','soil','compaction'],
  ['terrain','agents','movement-context'],
  ['surface-water','agents','hydration-context'],
  ['atlas','plants','observation'],
  ['atlas','agents','observation'],
  ['atlas','surface-water','observation']
];

function ensure(s, r) {
  if (!s.grid?.cells?.length) {
    const cells = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const organic = .2 + r() * .3;
      cells.push({
        id: y * W + x, x, y,
        elevation: +(.12 + .35 * Math.sin(x / 9 * Math.PI) * Math.sin(y / 7 * Math.PI) + r() * .08).toFixed(3),
        soil: { sand: +(.35 + r() * .3).toFixed(2), organic: +organic.toFixed(2), nutrients: +(.45 + organic * .4).toFixed(2), moisture: +(.4 + r() * .22).toFixed(2), compaction: +(.05 + r() * .08).toFixed(2) },
        waterMm: 0,
        seeds: { grass: Math.floor(r() * 5), tree: r() < .1 ? 1 : 0 }
      });
    }
    s.grid = { w: W, h: H, cellMeters: 18, cells };
  }

  s.schema = 5;
  s.timeScale = TIME_SCALE;
  s.grid.w = s.grid.w || W; s.grid.h = s.grid.h || H; s.grid.cellMeters = s.grid.cellMeters || 18;
  for (const c of s.grid.cells) {
    c.soil = c.soil || { sand: .5, organic: .3, nutrients: .6, moisture: .5, compaction: .1 };
    c.seeds = c.seeds || { grass: 0, tree: 0 };
    c.waterMm = Number(c.waterMm || 0);
    c.fieldCapacityMm = Number(c.fieldCapacityMm || 55 + 25 * Number(c.soil.organic || .3));
    c.soilWaterMm = Number.isFinite(c.soilWaterMm) ? c.soilWaterMm : C(Number(c.soil.moisture || .5)) * c.fieldCapacityMm;
    c.soil.moisture = C(c.soilWaterMm / c.fieldCapacityMm);
  }

  s.plants = Array.isArray(s.plants) ? s.plants : [];
  s.ecology = s.ecology || { next: 1, germinations: 0, deaths: 0, dispersals: 0 };
  s.ecology.next = Number(s.ecology.next || 1);
  s.weather = { cloud: s.weather?.cloud ?? .5, humidity: s.weather?.humidity ?? .76, wind: s.weather?.wind ?? .2, rainMm: 0, tempC: s.weather?.tempC ?? 27, solar: s.weather?.solar ?? 0 };
  for (const a of s.agents || []) {
    a.hydration = Number.isFinite(a.hydration) ? a.hydration : .6 + r() * .3;
    a.tx = Number.isFinite(a.tx) ? a.tx : a.x;
    a.ty = Number.isFinite(a.ty) ? a.ty : a.y;
  }
  s.events = Array.isArray(s.events) ? s.events : [];
  s.rizoma = {
    version: 2,
    topology: 'synchronized-causal-rhizome',
    nodes: ['atmosphere','solar-energy','surface-water','soil-water','soil','seed-bank','plants','agents','atlas','terrain'].map(id => ({ id })),
    links: LINKS.map(([from,to,relation]) => ({ from,to,relation })),
    settlement: 'all causal nodes read the same prior snapshot; their deltas are merged once per pulse',
    renderer: 'observer-only'
  };
  s.laws = {
    version: 2,
    models: {
      waterMassBalance: 'storage(t+dt)=storage(t)+precipitation-evaporation+internal transfers',
      gravityRunoff: 'surface-water flux follows lower hydraulic head',
      infiltration: 'limited by soil texture and compaction',
      solarCycle: 'diurnal forcing attenuated by cloud cover',
      biologicalGrowth: 'growth is limited by water, nutrients, temperature and stored biomass',
      agentMotion: 'movement changes position and may compact occupied soil'
    }
  };
  return s;
}

function atmosphereNode(prev, dtHours, r, nextSimMinutes) {
  const w = prev.weather;
  const day = (nextSimMinutes / 1440) % 1;
  const cloud = C(w.cloud + (r() - .48) * .12);
  const humidity = C(w.humidity + (r() - .5) * .08, .4, .98);
  const wind = C(w.wind + (r() - .5) * .06, .03, .85);
  const solarRaw = Math.max(0, Math.sin((day - .25) * Math.PI * 2));
  const solar = C(solarRaw * (1 - cloud * .72));
  const rainMm = +(cloud > .62 && humidity > .7 ? ((cloud - .55) * 8 + (humidity - .68) * 10 + r() * 2) * dtHours : 0).toFixed(3);
  const tempC = +(27.2 + 2.4 * Math.sin((day - .25) * Math.PI * 2) - cloud * 1.3 - r() * .5).toFixed(2);
  return { cloud, humidity, wind, solar: +solar.toFixed(4), rainMm, tempC };
}

function waterNode(prev, weather, dtHours) {
  const cells = prev.grid.cells;
  const surfaceDelta = new Array(cells.length).fill(0);
  const soilDelta = new Array(cells.length).fill(0);
  let rainTotal = 0, evaporationTotal = 0, runoffTotal = 0, infiltrationTotal = 0;

  for (const c of cells) {
    const available = Number(c.waterMm || 0) + weather.rainMm;
    rainTotal += weather.rainMm;
    const permeability = (.35 + Number(c.soil.sand || .5) * .55) * (1 - Number(c.soil.compaction || 0));
    let infiltration = Math.max(0, dtHours * permeability);
    let surfaceEvap = Math.max(0, dtHours * (.025 + .08 * weather.solar) * (1 - weather.humidity) * (1 + weather.wind));

    let target = null, targetHead = c.elevation + available / 1000;
    for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const x = c.x + dx, y = c.y + dy;
      if (x < 0 || x >= prev.grid.w || y < 0 || y >= prev.grid.h) continue;
      const n = cells[y * prev.grid.w + x];
      const head = n.elevation + Number(n.waterMm || 0) / 1000;
      if (head < targetHead) { targetHead = head; target = n; }
    }
    let runoff = target ? available * C((c.elevation - target.elevation) * 5, 0, .35) * C(dtHours / 3, 0, 1) : 0;
    const requested = infiltration + surfaceEvap + runoff;
    const scale = requested > available && requested > 0 ? available / requested : 1;
    infiltration *= scale; surfaceEvap *= scale; runoff *= scale;

    const soilEvap = Math.min(Number(c.soilWaterMm || 0), dtHours * (.015 + .055 * weather.solar) * (1 - weather.humidity) * (1 + weather.wind));
    surfaceDelta[c.id] += weather.rainMm - infiltration - surfaceEvap - runoff;
    soilDelta[c.id] += infiltration - soilEvap;
    if (target) surfaceDelta[target.id] += runoff;
    infiltrationTotal += infiltration; evaporationTotal += surfaceEvap + soilEvap; runoffTotal += runoff;
  }
  return { surfaceDelta, soilDelta, rainTotal, evaporationTotal, runoffTotal, infiltrationTotal };
}

function biologyNode(prev, weather, dtHours, r, at) {
  const seedDelta = prev.grid.cells.map(() => ({ grass: 0, tree: 0 }));
  const soilWaterDelta = new Array(prev.grid.cells.length).fill(0);
  const nutrientDelta = new Array(prev.grid.cells.length).fill(0);
  const events = [];
  const plants = [];
  let germinations = 0, deaths = 0, dispersals = 0, nextId = Number(prev.ecology.next || 1);

  for (const c of prev.grid.cells) for (const species of ['grass','tree']) {
    const seeds = Number(c.seeds?.[species] || 0);
    const threshold = species === 'grass' ? .34 : .42;
    const chance = species === 'grass' ? .32 : .055;
    if (seeds > 0 && c.soil.moisture > threshold && weather.tempC > 19 && r() < chance * dtHours / 24) {
      const id = `pl${nextId++}`;
      seedDelta[c.id][species] -= 1;
      plants.push({ id, species, x: +((c.x + r()) / prev.grid.w).toFixed(4), y: +((c.y + r()) / prev.grid.h).toFixed(4), cell: c.id, ageHours: 0, biomass: .04, health: .82, stage: 'seedling', bornAt: at, bornFrom: 'seed-bank' });
      events.push({ at, type: 'germination', entity: id, cause: `${species} seed + viable soil-water-temperature state`, cell: c.id });
      germinations++;
    }
  }

  for (const old of prev.plants) {
    const p = { ...old };
    const c = prev.grid.cells[p.cell];
    if (!c) continue;
    const tree = p.species === 'tree';
    const waterFactor = C((c.soil.moisture - (tree ? .42 : .34)) / .4);
    const nutrientFactor = C(Number(c.soil.nutrients || 0) / .55);
    const tempFactor = C(1 - Math.abs(weather.tempC - 26) / 14);
    const resourceFactor = Math.min(waterFactor, nutrientFactor, tempFactor);
    p.ageHours = Number(p.ageHours || 0) + dtHours;
    p.biomass = C(Number(p.biomass || .04) + (tree ? .004 : .032) * dtHours / 24 * resourceFactor, 0, tree ? 7 : 1);
    p.health = C(Number(p.health || .8) + (resourceFactor - .38) * .02 * dtHours / 24);
    p.stage = p.ageHours < 24 ? 'seedling' : p.ageHours < (tree ? 3600 : 48) ? 'juvenile' : 'mature';
    soilWaterDelta[c.id] -= p.biomass * .0007 * dtHours;
    nutrientDelta[c.id] -= p.biomass * .00018 * dtHours;
    if (p.health < .07) { deaths++; events.push({ at, type: 'plant-death', entity: p.id, cause: 'resource/health limit', cell: c.id }); continue; }
    if (p.stage === 'mature' && r() < (tree ? .018 : .16) * dtHours / 24) {
      const x = C(c.x + Math.round((r() - .5) * 3), 0, prev.grid.w - 1);
      const y = C(c.y + Math.round((r() - .5) * 3), 0, prev.grid.h - 1);
      seedDelta[y * prev.grid.w + x][p.species] += 1;
      dispersals++;
    }
    plants.push(p);
  }

  return { plants: plants.slice(0, 400), seedDelta, soilWaterDelta, nutrientDelta, events, germinations, deaths, dispersals, nextId };
}

function agentsNode(prev, dtHours, r) {
  const compactionDelta = new Array(prev.grid.cells.length).fill(0);
  const cells = prev.grid.cells;
  const wet = cells.slice().sort((a,b) => (Number(b.waterMm||0)+b.soil.moisture*8) - (Number(a.waterMm||0)+a.soil.moisture*8))[0];
  const agents = (prev.agents || []).map(old => {
    const a = { ...old };
    a.energy = C((a.energy ?? .7) - .002 * dtHours);
    a.hydration = C((a.hydration ?? .7) - .0035 * dtHours);
    if (a.hydration < .34) { a.need = 'water'; a.tx = (wet.x + .5) / prev.grid.w; a.ty = (wet.y + .5) / prev.grid.h; }
    else if (a.energy < .28) a.need = 'rest';
    else if (r() < .18) { a.need = 'explore'; a.tx = r(); a.ty = r(); }
    if (a.need === 'rest') a.energy = C(a.energy + .009 * dtHours);
    else {
      const dx = a.tx - a.x, dy = a.ty - a.y, distance = Math.hypot(dx,dy) || 1;
      const move = Math.min(distance, .0035 * dtHours);
      a.x = C(a.x + dx / distance * move, .02, .98);
      a.y = C(a.y + dy / distance * move, .02, .98);
    }
    const cellId = C(Math.floor(a.y * prev.grid.h), 0, prev.grid.h - 1) * prev.grid.w + C(Math.floor(a.x * prev.grid.w), 0, prev.grid.w - 1);
    compactionDelta[cellId] += .0004 * dtHours;
    const c = cells[cellId];
    if (a.need === 'water' && (Number(c.waterMm || 0) > .4 || c.soil.moisture > .67)) a.hydration = C(a.hydration + .08 * dtHours);
    return a;
  });
  return { agents, compactionDelta };
}

function pulse(s) {
  const now = new Date();
  const r = R((Number(s.cycle || 0) + 1) * 7919 + Math.floor(now / 9e5));
  s = ensure(s, r);
  const elapsedRealMin = Math.max(1, Math.min(120, (now - new Date(s.updatedAt || now)) / 6e4 || 15));
  const dtHours = elapsedRealMin * TIME_SCALE / 60;
  const nextSimMinutes = Number(s.simMinutes || 0) + dtHours * 60;

  const prev = structuredClone(s);
  const weather = atmosphereNode(prev, dtHours, r, nextSimMinutes);
  const water = waterNode(prev, weather, dtHours);
  const biology = biologyNode(prev, weather, dtHours, r, now.toISOString());
  const agents = agentsNode(prev, dtHours, r);

  s.cycle = Number(s.cycle || 0) + 1;
  s.simMinutes = nextSimMinutes;
  s.updatedAt = now.toISOString();
  s.weather = weather;
  s.agents = agents.agents;
  s.plants = biology.plants;
  s.ecology.next = biology.nextId;
  s.ecology.germinations = Number(s.ecology.germinations || 0) + biology.germinations;
  s.ecology.deaths = Number(s.ecology.deaths || 0) + biology.deaths;
  s.ecology.dispersals = Number(s.ecology.dispersals || 0) + biology.dispersals;

  for (const c of s.grid.cells) {
    c.waterMm = Math.max(0, Number(prev.grid.cells[c.id].waterMm || 0) + water.surfaceDelta[c.id]);
    c.soilWaterMm = Math.max(0, Number(prev.grid.cells[c.id].soilWaterMm || 0) + water.soilDelta[c.id] + biology.soilWaterDelta[c.id]);
    c.soil.moisture = C(c.soilWaterMm / c.fieldCapacityMm);
    c.soil.nutrients = C(Number(prev.grid.cells[c.id].soil.nutrients || 0) + biology.nutrientDelta[c.id]);
    c.soil.compaction = C(Number(prev.grid.cells[c.id].soil.compaction || 0) + agents.compactionDelta[c.id]);
    c.seeds.grass = Math.max(0, Number(prev.grid.cells[c.id].seeds.grass || 0) + biology.seedDelta[c.id].grass);
    c.seeds.tree = Math.max(0, Number(prev.grid.cells[c.id].seeds.tree || 0) + biology.seedDelta[c.id].tree);
  }

  const storageBefore = prev.grid.cells.reduce((n,c) => n + Number(c.waterMm||0) + Number(c.soilWaterMm||0), 0);
  const storageAfter = s.grid.cells.reduce((n,c) => n + Number(c.waterMm||0) + Number(c.soilWaterMm||0), 0);
  const plantUptake = -biology.soilWaterDelta.reduce((n,v) => n + Math.min(0,v), 0);
  const expectedAfter = storageBefore + water.rainTotal - water.evaporationTotal - plantUptake;
  const residual = storageAfter - expectedAfter;

  if (weather.rainMm > 0) s.events.push({ at: s.updatedAt, type: 'rainfall', cause: 'atmospheric humidity + cloud forcing', rainMm: weather.rainMm });
  s.events.push(...biology.events);
  s.events = s.events.slice(-160);
  const lastEvent = s.events.at(-1);
  if (s.atlas && lastEvent) { s.atlas.attention = lastEvent.type; s.atlas.intent = 'observe causal network state'; }

  s.physics = {
    waterBalance: {
      storageBeforeMm: +storageBefore.toFixed(4),
      precipitationMm: +water.rainTotal.toFixed(4),
      evaporationMm: +water.evaporationTotal.toFixed(4),
      plantUptakeMm: +plantUptake.toFixed(4),
      internalRunoffTransferMm: +water.runoffTotal.toFixed(4),
      infiltrationTransferMm: +water.infiltrationTotal.toFixed(4),
      storageAfterMm: +storageAfter.toFixed(4),
      residualMm: +residual.toFixed(6)
    }
  };

  s.metrics = {
    population: (s.agents?.length || 0) + (s.atlas ? 1 : 0),
    plants: s.plants.length,
    germinations: s.ecology.germinations,
    deaths: s.ecology.deaths,
    seeds: s.grid.cells.reduce((n,c) => n + Number(c.seeds.grass||0) + Number(c.seeds.tree||0), 0),
    surfaceWaterMm: +s.grid.cells.reduce((n,c) => n + Number(c.waterMm||0), 0).toFixed(2),
    soilWaterMm: +s.grid.cells.reduce((n,c) => n + Number(c.soilWaterMm||0), 0).toFixed(2),
    meanSoilMoisture: +(s.grid.cells.reduce((n,c) => n + c.soil.moisture, 0) / s.grid.cells.length).toFixed(3),
    solar: weather.solar,
    waterMassResidualMm: +residual.toFixed(6)
  };
  return s;
}

let state;
try { state = JSON.parse(fs.readFileSync(F, 'utf8')); }
catch { state = { schema: 0, world: 'Eutopia/Penonome', bornAt: new Date().toISOString(), updatedAt: new Date().toISOString(), cycle: 0, simMinutes: 0, agents: [], atlas: { x: .5, y: .5, energy: .9 }, events: [] }; }
state = pulse(state);
fs.writeFileSync(F, JSON.stringify(state, null, 2) + '\n');
console.log(JSON.stringify({ schema: state.schema, topology: state.rizoma?.topology, cycle: state.cycle, weather: state.weather, metrics: state.metrics, waterBalance: state.physics?.waterBalance, recent: state.events.slice(-5) }, null, 2));
