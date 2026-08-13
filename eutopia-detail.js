import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.168.0/build/three.module.js';
export function buildEutopia(scene,PX,PZ){
 const M=(c,r=.82)=>new THREE.MeshStandardMaterial({color:c,roughness:r});
 const add=(g,m,x,y,z)=>{const o=new THREE.Mesh(g,m);o.position.set(PX+x,y,PZ+z);o.castShadow=o.receiveShadow=true;scene.add(o);return o};
 const grass=M(0x527547,.98),forest=M(0x285938,.98),road=M(0x343938,.95),walk=M(0xc8b98f,.88),cream=M(0xded5ba,.82),stone=M(0xb9a47d,.9),wood=M(0x6b4b2f,.9),leaf=M(0x2f6b3d,.9),gold=M(0xc89a43,.45);
 const ground=add(new THREE.PlaneGeometry(150,115),grass,0,0,0);ground.rotation.x=-Math.PI/2;
 for(let i=0;i<22;i++){const a=i/22*Math.PI*2,r=45+(i%5)*6,h=8+(i%6)*2;const q=add(new THREE.ConeGeometry(11+(i%4)*2.8,h,18),i%2?forest:leaf,Math.cos(a)*r,h*.34-1,Math.sin(a)*r);q.scale.y=.7}
 const flat=(w,d,x,z,mat,y=.13)=>{const q=add(new THREE.PlaneGeometry(w,d),mat,x,y,z);q.rotation.x=-Math.PI/2;return q};
 const water=new THREE.MeshPhysicalMaterial({color:0x3d8fa1,roughness:.16,metalness:.02,transparent:true,opacity:.92});
 for(let z=-50;z<=50;z+=4.5)flat(12,5,-22+Math.sin(z*.09)*3.5,z,water,.18);
 flat(5.5,86,0,0,road,.2);flat(76,5.5,0,-8,road,.2);flat(44,3,10,17,walk,.22);flat(30,3,-7,-28,walk,.22);
 add(new THREE.BoxGeometry(18,.55,4.6),walk,-21,.58,-8);add(new THREE.BoxGeometry(18,.55,4.6),walk,-21,.58,17);
 const plaza=add(new THREE.CylinderGeometry(10,10,.45,48),walk,10,.25,2);const ring=add(new THREE.TorusGeometry(6.3,.38,12,48),gold,10,.55,2);ring.rotation.x=Math.PI/2;
 function tree(x,z,s=1){add(new THREE.CylinderGeometry(.14*s,.22*s,2*s,7),wood,x,1*s,z);add(new THREE.IcosahedronGeometry(1.05*s,1),leaf,x,2.35*s,z)}
 for(let z=-36;z<=36;z+=5.2){tree(-4.8,z,.92);tree(4.8,z,.92)}
 for(let i=0;i<76;i++){const a=i*2.399,r=24+(i%14)*2.8,x=Math.cos(a)*r,z=Math.sin(a)*r;if(Math.abs(x)<8||Math.abs(x+22)<7)continue;tree(x,z,.72+(i%4)*.1)}
 const lots=[[-14,-25,8,8,9],[-4,-25,7,8,12],[11,-25,9,8,8],[24,-24,9,9,12],[-14,-15,8,7,7],[-4,-15,7,7,9],[24,-15,9,7,8],[-14,8,8,8,8],[-4,8,7,8,11],[25,8,9,8,9],[-14,20,8,8,10],[-3,21,8,8,7],[25,21,9,8,13],[12,31,10,8,8],[-9,32,9,8,9]];
 lots.forEach((p,i)=>{const [x,z,w,d,h]=p;add(new THREE.BoxGeometry(w,h,d),i%3?cream:stone,x,h/2+.3,z);add(new THREE.BoxGeometry(w*1.06,.32,d*1.06),wood,x,h+.5,z);if(i%3===0){const aw=add(new THREE.BoxGeometry(w*.7,.18,d*.55),leaf,x,h+.72,z);aw.rotation.y=(i%2)*.25}});
 const civic=add(new THREE.CylinderGeometry(5,6.2,9,28),cream,10,4.7,2);add(new THREE.SphereGeometry(5.05,24,14,0,Math.PI*2,0,Math.PI/2),new THREE.MeshPhysicalMaterial({color:0x72a8b0,roughness:.2,transparent:true,opacity:.72}),10,9.2,2);
 for(const z of [-20,-4,12,28]){add(new THREE.CylinderGeometry(.09,.12,3.2,6),M(0x3d413d,.7),3,1.6,z);add(new THREE.SphereGeometry(.22,8,6),gold,3,3.25,z)}
 return true;
}