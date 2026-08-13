import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.168.0/build/three.module.js';
export function buildEutopia(scene,PX,PZ){
 const M=(c,r=.85)=>new THREE.MeshStandardMaterial({color:c,roughness:r});
 const add=(geo,mat,x,y,z)=>{const m=new THREE.Mesh(geo,mat);m.position.set(PX+x,y,PZ+z);m.castShadow=true;m.receiveShadow=true;scene.add(m);return m};
 const green=M(0x4b7143,.98),dark=M(0x315b38,.98),road=M(0x343a39,.96),stone=M(0xc8b991,.88),cream=M(0xd9d2b8,.86),wood=M(0x6c5034,.9),leaf=M(0x2d6939,.92);
 add(new THREE.PlaneGeometry(120,95),green,0,0,0).rotation.x=-Math.PI/2;
 for(let i=0;i<18;i++){const a=i/18*Math.PI*2,r=40+(i%4)*7,h=7+(i%5)*2;const q=add(new THREE.ConeGeometry(9+(i%3)*3,h,18),i%2?dark:leaf,Math.cos(a)*r,h*.34-1,Math.sin(a)*r);q.scale.y=.72}
 const flat=(w,d,x,z,mat,y=.12)=>{const q=add(new THREE.PlaneGeometry(w,d),mat,x,y,z);q.rotation.x=-Math.PI/2;return q};
 const water=new THREE.MeshPhysicalMaterial({color:0x3e91a2,roughness:.18,transparent:true,opacity:.9});
 for(let z=-44;z<=44;z+=5){flat(10,5.4,-20+Math.sin(z*.1)*3,z,water,.16)}
 flat(5,70,0,0,road,.18);flat(66,5,0,-7,road,.18);flat(40,3,9,16,stone,.2);
 add(new THREE.CylinderGeometry(9,9,.35,40),stone,8,.2,1);
 const ring=add(new THREE.TorusGeometry(5.4,.34,10,40),M(0xd0a243,.42),8,.5,1);ring.rotation.x=Math.PI/2;
 for(const z of [-7,18])add(new THREE.BoxGeometry(16,.5,4),stone,-20,.55,z);
 function tree(x,z,s=.8){add(new THREE.CylinderGeometry(.12*s,.19*s,1.7*s,6),wood,x,.9*s,z);add(new THREE.IcosahedronGeometry(.9*s,1),leaf,x,2.05*s,z)}
 for(let z=-30;z<=30;z+=5.5){tree(-4.5,z);tree(4.5,z)}
 for(let i=0;i<48;i++){const a=i*2.399,r=25+(i%10)*2.6,x=Math.cos(a)*r,z=Math.sin(a)*r;if(Math.abs(x)<7||Math.abs(x+20)<6)continue;tree(x,z,.7+(i%4)*.09)}
 const lots=[[-12,-23,7,7,8],[-3,-23,7,7,11],[10,-23,8,7,7],[22,-22,8,8,10],[-12,-14,7,6,6],[-3,-14,7,6,8],[22,-14,8,6,7],[-12,8,7,7,7],[-3,8,7,7,10],[23,8,8,7,8],[-12,19,7,7,9],[-2,20,7,7,6],[23,20,8,7,11]];
 lots.forEach((p,i)=>{const [x,z,w,d,h]=p;add(new THREE.BoxGeometry(w,h,d),i%2?cream:stone,x,h/2+.25,z);add(new THREE.BoxGeometry(w*1.05,.3,d*1.05),wood,x,h+.42,z)});
 const civic=add(new THREE.CylinderGeometry(4.2,5.2,7,24),cream,8,3.7,1);civic.castShadow=true;add(new THREE.SphereGeometry(4.25,22,12,0,Math.PI*2,0,Math.PI/2),M(0x73a7ad,.28),8,7.2,1);
 return true;
}