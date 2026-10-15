import * as THREE from 'three'

export interface ShadowCaster { id:string; object:THREE.Object3D; dimensions:[number,number,number] }
export interface ShadowSource { id:string; light:THREE.PointLight|THREE.SpotLight }
const visible=(object:THREE.Object3D)=>{for(let p:THREE.Object3D|null=object;p;p=p.parent) if(!p.visible) return false;return true}
const release=(light:THREE.PointLight|THREE.SpotLight)=>{light.shadow.dispose();light.shadow.map=null;light.shadow.mapPass=null;light.castShadow=false}

/** Shadow maps of static fixtures are reused; the four nearest useful lights own the GPU budget. */
export function createShadowScheduler(sources:ShadowSource[],casters:ShadowCaster[],budget=4) {
  const history=new Map<string,{matrix:THREE.Matrix4;visible:boolean;bounds:THREE.Box3}>(),lightMatrices=new Map<string,THREE.Matrix4>()
  let active=new Set<string>()
  for(const {light} of sources) {
    light.castShadow=false;light.shadow.autoUpdate=false;light.shadow.mapSize.set(1024,1024)
    light.shadow.bias=-0.0005;light.shadow.normalBias=0.015
  }
  return {
    update(focus:THREE.Vector3) {
      const changed:THREE.Box3[]=[],point=new THREE.Vector3()
      for(const caster of casters) {
        const old=history.get(caster.id),shown=visible(caster.object)
        if(old && old.visible===shown && old.matrix.equals(caster.object.matrixWorld)) continue
        const matrix=caster.object.matrixWorld.clone(),bounds=new THREE.Box3(new THREE.Vector3(-0.5,-0.5,-0.5),new THREE.Vector3(0.5,0.5,0.5)).applyMatrix4(matrix.clone().scale(new THREE.Vector3(...caster.dimensions)))
        if(old?.visible) changed.push(old.bounds)
        if(shown) changed.push(bounds)
        history.set(caster.id,{matrix,visible:shown,bounds})
      }
      const candidates=sources.filter(({light})=>visible(light)&&light.intensity>0).map(source=>({ ...source,score:source.light.getWorldPosition(new THREE.Vector3()).distanceTo(focus)/Math.max(4,source.light.distance||100) }))
        .sort((a,b)=>a.score-b.score||a.id.localeCompare(b.id)).slice(0,budget)
      const next=new Set(candidates.map(source=>source.id)),refreshed:string[]=[]
      for(const source of sources) if(active.has(source.id)&&!next.has(source.id)) release(source.light)
      for(const {id,light} of candidates) {
        const moved=!lightMatrices.get(id)?.equals(light.matrixWorld),fresh=!active.has(id)
        const position=light.getWorldPosition(point)
        if(fresh || moved || changed.some(bounds=>bounds.distanceToPoint(position)<(light.distance||Infinity))) {light.shadow.needsUpdate=true;refreshed.push(id)}
        light.castShadow=true
        lightMatrices.set(id,light.matrixWorld.clone())
      }
      active=next
      return {active:[...active],refreshed}
    },
    dispose(){for(const {light} of sources) release(light);history.clear();lightMatrices.clear();active.clear()},
  }
}
