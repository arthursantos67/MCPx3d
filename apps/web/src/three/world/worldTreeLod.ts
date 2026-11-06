import { hashNoise } from '../sceneGeometrySpec.ts'
import type { PrefabPart, PrefabSpec } from '../scenePrefabs.ts'

/** Distant trees keep a rooted, volumetric silhouette; no camera-facing foliage cards. */
export function distantTreeParts(spec:PrefabSpec):PrefabPart[] {
  const random=(k:number)=>hashNoise(spec.seed,k,821),pine=spec.type==='pine',palm=spec.type==='palm'
  const height=palm?5.8:(pine?7.4:6.2)*(.9+random(1)*.2)
  const wood={color:'#69513b',roughness:1,metalness:0,flatShading:true}
  const leaves={color:spec.primary??(pine?'#607657':'#7f955a'),roughness:1,metalness:0,flatShading:true}
  const parts:PrefabPart[]=[{id:'trunk',parentId:null,name:'Tronco distante',kind:'cylinder',position:[0,height/2,0],dimensions:[palm?.25:.42,height,palm?.25:.42],geometry:{segments:8},material:wood}]
  if(pine)for(let tier=0;tier<4;tier++){
    const width=4.3-tier*.85,y=height*(.3+tier*.17)
    parts.push({id:`crown${tier}`,parentId:null,name:'Copa distante',kind:'cone',position:[0,y+height*.14,0],dimensions:[width,height*.36,width],geometry:{segments:8},material:leaves})
  }
  else if(palm)for(let i=0;i<6;i++){
    const angle=i*Math.PI/3
    parts.push({id:`frond${i}`,parentId:null,name:'Folha distante',kind:'polyhedron',position:[Math.cos(angle),height-.15,Math.sin(angle)],rotation:[0,-angle*180/Math.PI,15],dimensions:[2.7,.3,.9],geometry:{detail:0},material:leaves})
  }
  else for(let i=0;i<4;i++){
    const angle=i*2.39996,offset=i===3?0:1.05
    parts.push({id:`crown${i}`,parentId:null,name:'Copa distante',kind:'polyhedron',position:[Math.cos(angle)*offset,height*(i===3?.83:.67),Math.sin(angle)*offset],dimensions:[3.2,2.7,3.2],geometry:{detail:0},material:leaves})
  }
  return parts
}
