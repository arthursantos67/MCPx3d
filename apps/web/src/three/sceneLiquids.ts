import * as THREE from 'three'
import type {SceneNode} from './sceneDocument.ts'
import {buildStaticCollider} from './scenePlayer.ts'

export type LiquidKind='water'|'lava'|'acid'
export interface LiquidSpec {kind:LiquidKind;viscosity:number;damage:number}
export interface LiquidSample extends LiquidSpec {level:number;density:number}
export const liquidDefaults:Record<LiquidKind,{viscosity:number;damage:number;density:number}>={water:{viscosity:1,damage:0,density:1},lava:{viscosity:6,damage:30,density:2.8},acid:{viscosity:1.5,damage:12,density:1.2}}
export function validateLiquid(value:unknown):LiquidSpec|undefined {
  if(value==null)return undefined
  if(typeof value!=='object'||Array.isArray(value))throw new Error('Líquido inválido.')
  const data=value as Record<string,unknown>,kind=data.kind as LiquidKind
  if(!Object.hasOwn(liquidDefaults,kind))throw new Error('Tipo de líquido desconhecido.')
  const defaults=liquidDefaults[kind],viscosity=data.viscosity??defaults.viscosity,damage=data.damage??defaults.damage
  if(typeof viscosity!=='number'||!Number.isFinite(viscosity)||viscosity<.25||viscosity>20||typeof damage!=='number'||!Number.isFinite(damage)||damage<0||damage>1000)throw new Error('Propriedades de líquido fora do limite.')
  return{kind,viscosity,damage}
}
export const liquidSample=(spec:LiquidSpec|undefined,level:number):LiquidSample=>({...liquidDefaults[spec?.kind??'water'],kind:'water',...spec,level})
export function liquidMaterial(spec:LiquidSpec,source:unknown):Record<string,unknown> {
  const material=source&&typeof source==='object'&&!Array.isArray(source)?source as Record<string,unknown>:{}
  const hot=spec.kind==='lava',acid=spec.kind==='acid'
  return{...material,texture:'water',metalness:0,roughness:hot?.7:.34,normalStrength:hot?.2:.14,
    ...(hot||acid?{color:hot?'#923014':'#638a2e',emissive:hot?'#fa4b0b':'#7ac32f',emissiveIntensity:hot?1.3:.3,opacity:1,transparent:false}:{color:material.color??'#367785',opacity:.86,transparent:true})}
}

/** Query the actual transformed triangles, including banks/holes/slopes, instead of the height of an AABB. */
export function createLiquidQuery(entries:{node:SceneNode;geometry:THREE.BufferGeometry;matrix:THREE.Matrix4;visible:()=>boolean}[]) {
  const surfaces=entries.map(entry=>{const {bvh}=buildStaticCollider([entry]);const bounds=bvh?bvh.geometry.boundingBox??new THREE.Box3().setFromBufferAttribute(bvh.geometry.getAttribute('position') as THREE.BufferAttribute):null;return{...entry,bvh,bounds}})
  const ray=new THREE.Ray(new THREE.Vector3(),new THREE.Vector3(0,-1,0))
  return{
    at(x:number,z:number):LiquidSample|null {
      let found:LiquidSample|null=null
      for(const surface of surfaces){const box=surface.bounds;if(!box||!surface.bvh||!surface.visible()||x<box.min.x||x>box.max.x||z<box.min.z||z>box.max.z)continue
        ray.origin.set(x,box.max.y+1,z);const hit=surface.bvh.raycastFirst(ray,THREE.DoubleSide,0,box.max.y-box.min.y+2)
        if(hit&&(!found||hit.point.y>found.level))found=liquidSample(surface.node.liquid,hit.point.y)
      }
      return found
    },
    dispose(){for(const surface of surfaces)surface.bvh?.geometry.dispose()},
  }
}
