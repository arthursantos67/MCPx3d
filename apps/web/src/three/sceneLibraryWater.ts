import * as THREE from 'three'
import {Water} from 'three/addons/objects/Water2.js'

let renderingLiquidPass=false
/** Three.js' maintained flow/reflection/refraction addon, with bounded capture cost. */
export function createLibraryWater(geometry:THREE.BufferGeometry,normal:THREE.Texture,extent:number,level:number) {
  const normal0=normal.clone(),normal1=normal.clone();normal1.rotation=Math.PI/2
  const water=new Water(geometry,{color:'#709da4',textureWidth:256,textureHeight:256,normalMap0:normal0,normalMap1:normal1,flowDirection:new THREE.Vector2(.8,.3),flowSpeed:.012,reflectivity:.02,scale:Math.max(1,extent/12)})
  water.rotation.x=-Math.PI/2;water.position.y=level;water.material.side=THREE.DoubleSide
  water.userData.liquidLibrary='three/Water2'
  const capture=water.onBeforeRender,at=new THREE.Vector3()
  let last=-Infinity,quality:'low'|'medium'|'high'='medium',disposed=false,captureEnabled=false
  const flow=(now:number)=>{const config=water.material.uniforms.config.value as THREE.Vector4;config.x=(now*.000012)%.15;config.y=(config.x+.075)%.15}
  water.onBeforeRender=function(renderer,scene,camera,...args){
    if(disposed||renderingLiquidPass)return
    const now=performance.now(),interval=quality==='low'?1000:quality==='medium'?200:100
    camera.getWorldPosition(at)
    if(!captureEnabled||now-last<interval||at.y<level-.1){flow(now);return}
    last=now;renderingLiquidPass=true
    const shadows=renderer.shadowMap.autoUpdate;renderer.shadowMap.autoUpdate=false
    try{capture.call(this,renderer,scene,camera,...args)}finally{flow(now);renderer.shadowMap.autoUpdate=shadows;renderingLiquidPass=false}
  }
  return {object:water,setQuality(value:typeof quality){quality=value},setCaptureEnabled(value:boolean){captureEnabled=value},dispose(){
    if(disposed)return;disposed=true
    // Water2 owns two capture targets, exposed by their uniform textures.
    // Dispose render targets as well: texture disposal alone leaves framebuffer allocations alive.
    for(const name of ['tReflectionMap','tRefractionMap']){
      const texture=water.material.uniforms[name].value as THREE.Texture
      if(texture.renderTarget)texture.renderTarget.dispose();else texture.dispose()
    }
    normal0.dispose();normal1.dispose();water.material.dispose()
  }}
}
