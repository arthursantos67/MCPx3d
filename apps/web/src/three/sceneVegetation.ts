import { Vector3 } from 'three'
import { hashNoise } from './sceneGeometrySpec.ts'
import type { PrefabPart, PrefabSpec } from './scenePrefabs.ts'
import type { SceneMaterial, Vector3Tuple } from './sceneDocument.ts'

/** Compact material batches: tapered branch geometry and cutout leaf clusters with real depth. */
class PlantMesh {
  vertices:number[]=[];indices:number[]=[];uvs:number[]=[]
  vertex(point:Vector3,u:number,v:number){const i=this.vertices.length/3;this.vertices.push(...point.toArray().map(n=>Math.round(n*10000)/10000||0));this.uvs.push(Math.round(u*10000)/10000,Math.round(v*10000)/10000);return i}
  stem(a:Vector3,b:Vector3,radius:number,tip:number,sides=8){
    const axis=b.clone().sub(a).normalize(),right=new Vector3().crossVectors(axis,Math.abs(axis.y)>0.95?new Vector3(1,0,0):new Vector3(0,1,0)).normalize(),up=new Vector3().crossVectors(axis,right),length=a.distanceTo(b),base=this.vertices.length/3
    for(let ring=0;ring<2;ring++) for(let i=0;i<=sides;i++) {const angle=i/sides*Math.PI*2,r=ring?tip:radius;this.vertex((ring?b:a).clone().addScaledVector(right,Math.cos(angle)*r).addScaledVector(up,Math.sin(angle)*r),i/sides,length*ring)}
    for(let i=0;i<sides;i++){const p=base+i,q=p+sides+1;this.indices.push(p,p+1,q,p+1,q+1,q)}
    for(const ring of [0,1]) {const center=this.vertex(ring?b:a,0.5,0.5),start=base+ring*(sides+1);for(let i=0;i<sides;i++) this.indices.push(center,start+(ring?i:i+1),start+(ring?i+1:i))}
  }
  card(center:Vector3,normal:Vector3,width:number,height:number){
    const right=new Vector3().crossVectors(normal,Math.abs(normal.y)>0.95?new Vector3(1,0,0):new Vector3(0,1,0)).normalize(),up=new Vector3().crossVectors(normal,right).normalize(),base=this.vertices.length/3
    for(const [x,y] of [[-1,-1],[1,-1],[1,1],[-1,1]]) this.vertex(center.clone().addScaledVector(right,x*width/2).addScaledVector(up,y*height/2),(x+1)/2,(y+1)/2)
    this.indices.push(base,base+1,base+2,base,base+2,base+3)
  }
  part(id:string,name:string,material:Partial<SceneMaterial>,collidable:boolean):PrefabPart {
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity]
    this.vertices.forEach((v,i)=>{min[i%3]=Math.min(min[i%3],v);max[i%3]=Math.max(max[i%3],v)})
    return {id,parentId:null,name,kind:'mesh',position:min.map((v,i)=>(v+max[i])/2) as Vector3Tuple,dimensions:min.map((v,i)=>Math.max(0.01,max[i]-v)) as Vector3Tuple,
      geometry:{vertices:this.vertices,indices:this.indices,uvs:this.uvs,normals:[]},material,collidable}
  }
}
export function buildVegetation(spec:PrefabSpec,conifer=false,simplified=false):PrefabPart[] {
  const random=(k:number)=>hashNoise(spec.seed,k,821),trunk=new PlantMesh(),branches=new PlantMesh(),foliage=Array.from({length:conifer?3:4},()=>new PlantMesh())
  const height=(conifer?7.4:6.2)*(0.9+random(1)*0.2),leanX=(random(2)-0.5)*0.45,leanZ=(random(3)-0.5)*0.4
  const sections=simplified?3:5
  for(let i=0;i<sections;i++) trunk.stem(new Vector3(leanX*i/sections,height*i/sections,leanZ*i/sections),new Vector3(leanX*(i+1)/sections,height*(i+1)/sections,leanZ*(i+1)/sections),(conifer?0.2:0.24)*(1-(simplified?i/sections*0.75:i*0.15)),(conifer?0.2:0.24)*(1-(simplified?(i+1)/sections*0.75:(i+1)*0.15)),simplified?5:10)
  if(conifer) {
    for(let tier=0;tier<7;tier++) for(let branch=0;branch<6;branch++) {
      const k=tier*6+branch,angle=branch/6*Math.PI*2+tier*1.83+random(k+10)*0.2,y=height*(0.24+tier*0.1),reach=(1-tier/8)*(1.9+random(k+60)*0.5)
      const start=new Vector3(leanX*y/height,y,leanZ*y/height),end=start.clone().add(new Vector3(Math.cos(angle)*reach,-0.12+random(k+110)*0.2,Math.sin(angle)*reach))
      if(!simplified) branches.stem(start,end,0.055*(1-tier*0.08),0.01,6)
      for(let j=0;j<5;j++) {
        if(simplified&&j!==1&&j!==4) continue
        const point=start.clone().lerp(end,0.25+j*0.17).add(new Vector3((random(k*7+j+210)-0.5)*0.35,0.12+(random(k*7+j+310)-0.5)*0.3,(random(k*7+j+410)-0.5)*0.35))
        const normal=new Vector3(Math.cos(angle+j*1.9),0.5+random(k*7+j+510)*0.5,Math.sin(angle+j*1.9)).normalize()
        const spread=simplified?1.5:1
        foliage[k%3].card(point,normal,0.75*(1-tier*0.055)*spread,0.85*(1-tier*0.055)*spread)
      }
    }
    for(let i=0;i<8;i++) foliage[i%3].card(new Vector3(leanX,height-0.35+i*0.045,leanZ),new Vector3(Math.cos(i*2.4),0.2,Math.sin(i*2.4)).normalize(),0.6,0.9)
  } else {
    for(let i=0;i<18;i++) {
      const angle=i*2.39996+random(12)*6.28,reach=1.2+random(i+20)*1.35,y=height*(0.47+random(i+50)*0.25)
      const start=new Vector3(leanX*y/height,y,leanZ*y/height),end=new Vector3(Math.cos(angle)*reach+leanX,height*(0.62+random(i+80)*0.29),Math.sin(angle)*reach+leanZ)
      if(!simplified) branches.stem(start,end,0.075,0.018,7)
      for(let j=0;j<10;j++) {
        if(simplified&&j%3!==0) continue
        const k=i*11+j,theta=random(k+200)*Math.PI*2,z=random(k+400)*2-1,r=Math.sqrt(1-z*z),offset=new Vector3(Math.cos(theta)*r,z,Math.sin(theta)*r).multiplyScalar(0.25+random(k+600)*0.65)
        const spread=simplified?1.5:1
        foliage[i%4].card(end.clone().add(offset),new Vector3(Math.cos(theta),0.15+random(k+800),Math.sin(theta)).normalize(),(0.72+random(k+1000)*0.3)*spread,(0.8+random(k+1200)*0.3)*spread)
      }
    }
  }
  const wood:Partial<SceneMaterial>={color:conifer?'#8d7c68':'#968472',texture:'wood',textureScale:0.7,normalStrength:0.35,roughness:0.95,metalness:0}
  return [trunk.part('trunk','Tronco ramificado',wood,true),...(simplified?[]:[branches.part('branches','Galhos secundários',wood,false)]),...foliage.map((mesh,i)=>mesh.part(`foliage${i}`,conifer?'Ramos com agulhas':'Folhas em agrupamentos',
    {color:i%2?(spec.secondary??'#b8c79d'):(spec.primary??'#d0d7b5'),texture:conifer?'needles':'foliage',textureScale:1,normalStrength:0.12,alphaTest:0.45,doubleSided:true,roughness:0.9,metalness:0},false))]
}
