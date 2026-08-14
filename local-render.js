'use strict';

// Atlas Local Appearance Runtime
// Goal: never regenerate a whole frame when only a small causal region changed.
// This module is observer-only: it consumes state/dynamics and never writes world truth.

const hasWebGL2=()=>{try{const c=document.createElement('canvas');return !!c.getContext('webgl2',{alpha:false,antialias:false,preserveDrawingBuffer:false})}catch{return false}};
const hasWasm=()=>typeof WebAssembly==='object'&&typeof WebAssembly.instantiate==='function';
const hasOffscreen=()=>typeof OffscreenCanvas!=='undefined';

function hash(s){let h=2166136261;for(const c of String(s||'')){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0}
function clamp(v,a=0,b=1){return Math.max(a,Math.min(b,v))}

function signature(packet){
  const h=packet.entities?.humans||[],p=packet.entities?.plants||[],a=packet.entities?.animals||[];
  const parts=[packet.frame?.cycle,packet.world?.weather?.tempC,packet.world?.weather?.rainMm,packet.world?.weather?.wind,h.length,p.length,a.length];
  for(const x of h)parts.push(x.id,+(x.position?.x||0).toFixed(3),+(x.position?.y||0).toFixed(3),x.dynamics?.pose||'');
  return hash(parts.join('|')).toString(16);
}

function dirtyTiles(packet,previous,tileCount=12){
  const now=new Map((packet.entities?.humans||[]).map(x=>[x.id,x]));
  const old=new Map((previous?.entities?.humans||[]).map(x=>[x.id,x]));
  const dirty=new Set();
  const mark=x=>{const ix=Math.max(0,Math.min(tileCount-1,Math.floor((x.position?.x||0)*tileCount)));const iy=Math.max(0,Math.min(tileCount-1,Math.floor((x.position?.y||0)*tileCount)));dirty.add(`${ix}:${iy}`)};
  for(const [id,x] of now){const y=old.get(id);if(!y||Math.hypot((x.position?.x||0)-(y.position?.x||0),(x.position?.y||0)-(y.position?.y||0))>.002||x.dynamics?.pose!==y.dynamics?.pose)mark(x)}
  for(const [id,x] of old)if(!now.has(id))mark(x);
  if(!previous||packet.world?.weather?.rainMm!==previous.world?.weather?.rainMm||packet.world?.light?.shadowStrength!==previous.world?.light?.shadowStrength){for(let y=0;y<tileCount;y++)for(let x=0;x<tileCount;x++)dirty.add(`${x}:${y}`)}
  return [...dirty];
}

function makeCanvas(){const c=document.createElement('canvas');c.id='atlas-local-render';Object.assign(c.style,{position:'fixed',inset:'0',width:'100%',height:'100%',zIndex:'2',display:'none',background:'#9db7c1'});document.body.appendChild(c);return c}

function palette(seed){const h=seed%360;return{skin:`hsl(${20+(h%14)} 35% ${38+(seed%28)}%)`,shirt:`hsl(${(h+120)%360} 24% ${35+(seed%22)}%)`,pants:`hsl(${(h+210)%360} 18% ${16+(seed%16)}%)`}}

function draw2D(ctx,c,packet,t){
  const w=c.width,h=c.height;const weather=packet.world?.weather||{};const rain=+weather.rainMm||0;const light=packet.world?.light||{};
  ctx.clearRect(0,0,w,h);
  const sky=ctx.createLinearGradient(0,0,0,h*.72);sky.addColorStop(0,`hsl(198 28% ${62-clamp(light.cloud||0)*12}%)`);sky.addColorStop(1,'hsl(194 20% 82%)');ctx.fillStyle=sky;ctx.fillRect(0,0,w,h);
  const groundY=h*.48;const grd=ctx.createLinearGradient(0,groundY,0,h);grd.addColorStop(0,rain>0?'#846e50':'#9b8056');grd.addColorStop(1,rain>0?'#5d513f':'#6f6048');ctx.fillStyle=grd;ctx.beginPath();ctx.moveTo(0,groundY);ctx.lineTo(w,groundY*.92);ctx.lineTo(w,h);ctx.lineTo(0,h);ctx.closePath();ctx.fill();
  // State-derived plants. No plant is drawn unless present in causal state.
  for(const p of packet.entities?.plants||[]){const x=(p.position?.x||0)*w,y=groundY+(p.position?.y||0)*(h-groundY)*.72;const biomass=Math.max(.3,Math.min(6,+p.biomassKg||1));const sway=Math.sin(t*.0015+(hash(p.id)%100))*Math.min(5,+weather.wind||0);ctx.save();ctx.translate(x,y);ctx.rotate(sway*.003);ctx.fillStyle='#274b2a';ctx.fillRect(-1,-8*biomass/3,2,8*biomass/3);ctx.restore()}
  // 2.5D causal impostors: lightweight, animated, stable by entity id.
  const humans=[...(packet.entities?.humans||[])].sort((a,b)=>(a.position?.y||0)-(b.position?.y||0));
  for(const a of humans){const x=(a.position?.x||0)*w,y=groundY+(a.position?.y||0)*(h-groundY)*.72;const depth=.55+.65*(a.position?.y||0);const H=Math.max(28,92*depth);const seed=hash(a.id),pal=palette(seed);const moving=a.dynamics?.pose==='walk';const phase=(t*.006+(seed%31));const bob=moving?Math.sin(phase)*2:Math.sin(phase*.22)*.5;const swing=moving?Math.sin(phase)*H*.08:0;
    ctx.save();ctx.translate(x,y+bob);ctx.globalAlpha=.25;ctx.fillStyle='#000';ctx.beginPath();ctx.ellipse(0,H*.05,H*.18,H*.055,0,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
    ctx.strokeStyle=pal.pants;ctx.lineWidth=Math.max(3,H*.07);ctx.lineCap='round';ctx.beginPath();ctx.moveTo(-H*.04,-H*.08);ctx.lineTo(-H*.06+swing*.12,H*.18);ctx.moveTo(H*.04,-H*.08);ctx.lineTo(H*.06-swing*.12,H*.18);ctx.stroke();
    ctx.fillStyle=pal.shirt;ctx.beginPath();ctx.roundRect(-H*.12,-H*.58,H*.24,H*.48,H*.08);ctx.fill();
    ctx.strokeStyle=pal.skin;ctx.lineWidth=Math.max(3,H*.06);ctx.beginPath();ctx.moveTo(-H*.1,-H*.46);ctx.lineTo(-H*.16+swing,-H*.18);ctx.moveTo(H*.1,-H*.46);ctx.lineTo(H*.16-swing,-H*.18);ctx.stroke();
    ctx.fillStyle=pal.skin;ctx.beginPath();ctx.arc(0,-H*.72,H*.13,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#21150f';ctx.beginPath();ctx.arc(0,-H*.77,H*.13,Math.PI,Math.PI*2);ctx.fill();ctx.restore();
  }
  if(rain>0){ctx.strokeStyle='rgba(220,235,245,.28)';ctx.lineWidth=1;for(let i=0;i<Math.min(160,Math.floor(rain*18));i++){const x=(hash(i+t|0)%w),y=(hash(`r${i}${t|0}`)%h);ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-2,y+9);ctx.stroke()}}
}

export class AtlasLocalRenderer{
  constructor(){this.canvas=makeCanvas();this.ctx=this.canvas.getContext('2d',{alpha:false,desynchronized:true});this.previous=null;this.lastSig=null;this.running=false;this.packet=null;this.raf=0;}
  capability(){return{webgl2:hasWebGL2(),wasm:hasWasm(),offscreenCanvas:hasOffscreen(),mode:'incremental-2.5d-local',policy:'observer-only'}}
  resize(){const d=Math.min(devicePixelRatio||1,1.5),w=Math.max(1,Math.floor(innerWidth*d)),h=Math.max(1,Math.floor(innerHeight*d));if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h}}
  render(packet){this.packet=packet;const sig=signature(packet),dirty=dirtyTiles(packet,this.previous);this.previous=packet;this.lastSig=sig;this.canvas.style.display='block';this.running=true;this.resize();const loop=t=>{if(!this.running)return;this.resize();draw2D(this.ctx,this.canvas,this.packet,t);this.raf=requestAnimationFrame(loop)};cancelAnimationFrame(this.raf);this.raf=requestAnimationFrame(loop);return{element:this.canvas,signature:sig,dirtyTiles:dirty,capability:this.capability()}}
  hide(){this.running=false;cancelAnimationFrame(this.raf);this.canvas.style.display='none'}
}

if(typeof window!=='undefined')window.AtlasLocalRenderer=AtlasLocalRenderer;
