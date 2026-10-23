import * as THREE from 'three'

export interface ShadowCaster { id:string; object:THREE.Object3D; dimensions:[number,number,number] }
export interface ShadowSource { id:string; light:THREE.PointLight|THREE.SpotLight }
const visible=(object:THREE.Object3D)=>{for(let p:THREE.Object3D|null=object;p;p=p.parent) if(!p.visible) return false;return true}
const release=(light:THREE.PointLight|THREE.SpotLight)=>{light.shadow.dispose();light.shadow.map=null;light.shadow.mapPass=null;light.castShadow=false}

/** Shadow maps of static fixtures are reused; the nearest useful lights own the GPU budget.
 * Slots are fixed per light type: shader programs depend on how many point and spot lights cast shadows, so a changing count would recompile every material mid-game. */
export function createShadowScheduler(sources:ShadowSource[],casters:ShadowCaster[],budget=4) {
  const history=new Map<string,{matrix:THREE.Matrix4;visible:boolean;bounds:THREE.Box3}>(),lightMatrices=new Map<string,THREE.Matrix4>()
  const points=sources.filter(({light})=>light instanceof THREE.PointLight).length,spots=sources.length-points
  const pointSlots=Math.min(points,budget-Math.min(spots,Math.floor(budget/2))),slots={point:pointSlots,spot:Math.min(spots,budget-pointSlots)}
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
      // Unlit lights (a day cycle dims practical lamps) keep their slot without redrawing; they still lose it to nearer lit ones.
      const ranked=sources.filter(({light})=>visible(light)).map(source=>({ ...source,lit:source.light.intensity>0,score:source.light.getWorldPosition(point).distanceTo(focus)/Math.max(4,source.light.distance||100) }))
        .sort((a,b)=>Number(b.lit)-Number(a.lit)||a.score-b.score||a.id.localeCompare(b.id))
      const candidates=[...ranked.filter(({light})=>light instanceof THREE.PointLight).slice(0,slots.point),...ranked.filter(({light})=>!(light instanceof THREE.PointLight)).slice(0,slots.spot)]
        .sort((a,b)=>Number(b.lit)-Number(a.lit)||a.score-b.score||a.id.localeCompare(b.id))
      const next=new Set(candidates.map(source=>source.id)),refreshed:string[]=[]
      for(const source of sources) if(active.has(source.id)&&!next.has(source.id)) release(source.light)
      for(const {id,light,lit} of candidates) {
        light.castShadow=true
        if(!lit) { lightMatrices.delete(id); continue }
        const moved=!lightMatrices.get(id)?.equals(light.matrixWorld),fresh=!active.has(id)
        const position=light.getWorldPosition(point)
        if(fresh || moved || changed.some(bounds=>bounds.distanceToPoint(position)<(light.distance||Infinity))) {light.shadow.needsUpdate=true;refreshed.push(id)}
        lightMatrices.set(id,light.matrixWorld.clone())
      }
      active=next
      return {active:[...active],refreshed}
    },
    dispose(){for(const {light} of sources) release(light);history.clear();lightMatrices.clear();active.clear()},
  }
}
