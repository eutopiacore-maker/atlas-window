import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.168.0/build/three.module.js';
export function buildEutopia(scene,PX,PZ){
 const g=new THREE.Group();scene.add(g);
 const mat=(c,r=.8)=>new THREE.MeshStandardMaterial({color:c,roughness:r});
 // layered hills around Penonome
 for(let i=0;i<34;i++){const a=i*.83,r=32+(i%7)*8,h=3+(i%5)*2;const m=new THREE.Mesh(new THREE.ConeGeometry(10+(i%4)*4,h,16),mat(i%3?0x315f3b:0x4d7548));m.position.set(PX+Math.cos(a)*r,h/2-1,PZ+Math.sin(a)*r);m.scale.y=.55;g.add(m)}
 // civic green spine + water
 const park=new THREE.Mesh(new THREE.PlaneGeometry(55,13),mat(0x527a45));park.rotation.x=-Math.PI/2;park.position.set(PX,1.76,PZ);g.add(park);
 const water=new THREE.Mesh(new THREE.PlaneGeometry(7,70),new THREE.MeshPhysicalMaterial({color:0x3d91a3,roughness:.15,metalness:.05,transparent:true,opacity:.82}));water.rotation.x=-Math.PI/2;water.position.set(PX-17,1.8,PZ);g.add(water);
 // roads and walkable network
 const roadMat=mat(0x353a38,.95);for(const [x,z,w,d] of [[0,0,3,68],[-10,0,2.2,60],[10,0,2.2,60],[0,-14,46,2.4],[0,14,46,2.4]]){const q=new THREE.Mesh(new THREE.PlaneGeometry(w,d),roadMat);q.rotation.x=-Math.PI/2;q.position.set(PX+x,1.84,PZ+z);g.add(q)}
 // human-scale Eutopia buildings, terraces and courtyards
 const stone=mat(0xc7b98f),white=mat(0xd9d1b5),wood=mat(0x6d5135);for(let i=-4;i<=4;i++)for(let j=-4;j<=4;j++){if(Math.abs(i)<1||Math.abs(j)==2||(i+j)%5==0)continue;const h=2.8+((i*i+j*j)%4)*1.25;const b=new THREE.Mesh(new THREE.BoxGeometry(4.6,h,3.7),((i+j)&1)?stone:white);b.position.set(PX+i*5.4,h/2+1.9,PZ+j*5.2);g.add(b);const roof=new THREE.Mesh(new THREE.BoxGeometry(5,.18,4.1),wood);roof.position.set(b.position.x,h+1.95,b.position.z);g.add(roof)}
 // dense tropical canopy
 for(let i=0;i<120;i++){const a=i*2.399,r=8+(i%19)*3.2,x=PX+Math.cos(a)*r,z=PZ+Math.sin(a)*r;if(Math.abs(x-PX)<24&&Math.abs(z-PZ)<24&&i%3)continue;const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.12,.18,1.7,5),wood);trunk.position.set(x,2.6,z);g.add(trunk);const crown=new THREE.Mesh(new THREE.IcosahedronGeometry(.75+(i%4)*.13,1),mat(i%3?0x285f38:0x477a42));crown.position.set(x,3.7,z);g.add(crown)}
 // landmark civic ring
 const ring=new THREE.Mesh(new THREE.TorusGeometry(5.2,.28,10,40),mat(0xc9983d,.4));ring.rotation.x=Math.PI/2;ring.position.set(PX,2.1,PZ);g.add(ring);
 return g;
}