import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.168.0/build/three.module.js';

const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const hash=s=>{let h=2166136261;for(const c of String(s||'')){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0};

function dispose(root){root.traverse?.(o=>{o.geometry?.dispose?.();if(o.material){(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose?.())}})}

export class AtlasPhotorealLandscape{
  constructor(){
    this.scene=new THREE.Scene();
    this.camera=new THREE.PerspectiveCamera(58,innerWidth/innerHeight,.1,1000);
    this.renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));
    this.renderer.setSize(innerWidth,innerHeight);
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure=1.05;
    this.renderer.shadowMap.enabled=true;
    this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    Object.assign(this.renderer.domElement.style,{position:'fixed',inset:'0',width:'100%',height:'100%',zIndex:'2',display:'none'});
    document.body.appendChild(this.renderer.domElement);
    this.world=new THREE.Group();this.scene.add(this.world);
    this.hemi=new THREE.HemisphereLight(0xcfe7ff,0x3a3027,1.25);this.scene.add(this.hemi);
    this.sun=new THREE.DirectionalLight(0xffdfb5,3.2);this.sun.position.set(-28,34,18);this.sun.castShadow=true;this.sun.shadow.mapSize.set(1024,1024);this.sun.shadow.camera.left=-35;this.sun.shadow.camera.right=35;this.sun.shadow.camera.top=35;this.sun.shadow.camera.bottom=-35;this.scene.add(this.sun);
    this.camera.position.set(10,8,14);this.camera.lookAt(0,1,0);
    this.running=false;this.raf=0;this.wind=0;
    addEventListener('resize',()=>this.resize());
  }
  resize(){this.camera.aspect=innerWidth/innerHeight;this.camera.updateProjectionMatrix();this.renderer.setSize(innerWidth,innerHeight)}
  hide(){this.running=false;cancelAnimationFrame(this.raf);this.renderer.domElement.style.display='none'}
  clear(){dispose(this.world);while(this.world.children.length)this.world.remove(this.world.children[0])}
  build(packet){
    this.clear();
    const terr=packet.world?.terrain?.cells||[], cellM=packet.world?.terrain?.cellMeters||4.5;
    const state=packet.__state; if(!state?.grid?.cells?.length) throw Error('missing causal grid');
    const g=state.grid,w=g.w,h=g.h,scale=.12,base=Math.min(...g.cells.map(c=>+c.elevation||0));
    const pos=[],col=[],idx=[];
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const c=g.cells[y*w+x], moist=clamp(c.soil?.moisture||0), org=clamp(c.soil?.organic||0);
      pos.push((x-(w-1)/2)*cellM*scale,((+c.elevation||0)-base)*scale,(y-(h-1)/2)*cellM*scale);
      const dry=new THREE.Color(0x8a7754),wet=new THREE.Color(0x514737),green=new THREE.Color(0x4f6239);let cc=dry.clone().lerp(wet,moist*.65).lerp(green,org*.25);col.push(cc.r,cc.g,cc.b)
    }
    for(let y=0;y<h-1;y++)for(let x=0;x<w-1;x++){const a=y*w+x,b=a+1,d=a+w,e=d+1;idx.push(a,d,b,b,d,e)}
    const geom=new THREE.BufferGeometry();geom.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geom.setAttribute('color',new THREE.Float32BufferAttribute(col,3));geom.setIndex(idx);geom.computeVertexNormals();
    const ground=new THREE.Mesh(geom,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.96,metalness:0}));ground.receiveShadow=true;this.world.add(ground);

    const grassGeom=new THREE.PlaneGeometry(.055,.5,1,4);grassGeom.translate(0,.25,0);
    const grassMat=new THREE.MeshStandardMaterial({color:0x38572f,roughness:.9,side:THREE.DoubleSide});
    const grasses=(packet.entities?.plants||[]).filter(p=>(p.species||'').includes('grass'));
    const gi=new THREE.InstancedMesh(grassGeom,grassMat,Math.max(1,grasses.length*3));const m=new THREE.Matrix4(),q=new THREE.Quaternion(),scl=new THREE.Vector3();let ii=0;
    for(const p of grasses){for(let k=0;k<3;k++){const seed=hash(p.id+':'+k),x=(p.position.x-.5)*(w-1)*cellM*scale+(seed%37-18)*.006,z=(p.position.y-.5)*(h-1)*cellM*scale+((seed>>>7)%37-18)*.006,gy=this.sampleY(state,p.position.x,p.position.y,base,scale),hh=.16+clamp((p.biomassKg||.02)*3,0,.45);q.setFromEuler(new THREE.Euler(0,(seed%628)/100,((seed>>>5)%20-10)/180));scl.set(.8+((seed>>>3)%50)/100,hh/.5,.8);m.compose(new THREE.Vector3(x,gy,z),q,scl);gi.setMatrixAt(ii++,m)}}gi.count=ii;gi.castShadow=true;gi.receiveShadow=true;this.world.add(gi);

    const trees=(packet.entities?.plants||[]).filter(p=>!(p.species||'').includes('grass'));
    for(const p of trees){const x=(p.position.x-.5)*(w-1)*cellM*scale,z=(p.position.y-.5)*(h-1)*cellM*scale,y=this.sampleY(state,p.position.x,p.position.y,base,scale),bio=Math.max(.1,p.biomassKg||p.biomass||.2),H=.7+Math.min(3.2,Math.sqrt(bio)*.8),trunk=new THREE.Mesh(new THREE.CylinderGeometry(.08,.12,H*.55,7),new THREE.MeshStandardMaterial({color:0x5f4731,roughness:1}));trunk.position.set(x,y+H*.275,z);trunk.castShadow=true;const crown=new THREE.Mesh(new THREE.IcosahedronGeometry(H*.32,2),new THREE.MeshStandardMaterial({color:0x2d5733,roughness:.88}));crown.scale.set(1,1.18,1);crown.position.set(x,y+H*.72,z);crown.castShadow=true;this.world.add(trunk,crown)}

    for(const c of g.cells){if((c.waterMm||0)<.15)continue;const wp=new THREE.Mesh(new THREE.PlaneGeometry(cellM*scale*.96,cellM*scale*.96),new THREE.MeshPhysicalMaterial({color:0x496f79,roughness:.15,metalness:0,transmission:.05,transparent:true,opacity:.78}));wp.rotation.x=-Math.PI/2;wp.position.set((c.x-(w-1)/2)*cellM*scale,((+c.elevation||0)-base)*scale+.012,(c.y-(h-1)/2)*cellM*scale);wp.receiveShadow=true;this.world.add(wp)}

    const weather=packet.world?.weather||{},light=packet.world?.light||{};const cloud=clamp(weather.cloud??.5),solar=clamp(light.solar??weather.solar??.5),sky=new THREE.Color().setHSL(.56-.025*solar,.36,.62+.12*solar-.10*cloud);this.scene.background=sky;this.scene.fog=new THREE.FogExp2(sky,.018+.018*cloud);this.hemi.intensity=.9+solar*1.7;this.sun.intensity=.6+solar*3.7;this.wind=+weather.wind||0;
    const extX=(w-1)*cellM*scale,extZ=(h-1)*cellM*scale;this.camera.position.set(extX*.12,Math.max(5,extX*.22),extZ*.72);this.camera.lookAt(0,Math.max(.6,extX*.035),0)
  }
  sampleY(state,x,y,base,scale){const g=state.grid,ix=Math.max(0,Math.min(g.w-1,Math.round(x*(g.w-1)))),iy=Math.max(0,Math.min(g.h-1,Math.round(y*(g.h-1))));return((+g.cells[iy*g.w+ix].elevation||0)-base)*scale}
  render(packet,state){packet.__state=state;this.build(packet);this.renderer.domElement.style.display='block';this.running=true;const loop=t=>{if(!this.running)return;this.world.rotation.y=Math.sin(t*.00008)*.004;this.renderer.render(this.scene,this.camera);this.raf=requestAnimationFrame(loop)};cancelAnimationFrame(this.raf);this.raf=requestAnimationFrame(loop);return{mode:'pbr-landscape-local',webgl2:!!this.renderer.capabilities.isWebGL2}}
}

if(typeof window!=='undefined')window.AtlasPhotorealLandscape=AtlasPhotorealLandscape;
