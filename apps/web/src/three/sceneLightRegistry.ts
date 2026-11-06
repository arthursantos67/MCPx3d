import * as THREE from 'three'

/** Keep light counts stable when a collectible, door or wave changes visibility: those counts are shader constants. */
export function createLightRegistry(root:THREE.Group,lights:Map<string,THREE.PointLight|THREE.SpotLight>,holders:Map<string,THREE.Object3D>) {
  const bindings=[...lights].map(([id,light])=>{
    light.updateMatrix()
    const binding={light,anchor:holders.get(id)!,local:light.matrix.clone(),color:light.color.clone()}
    root.add(light);light.matrixAutoUpdate=false
    return binding
  })
  const inverse=new THREE.Matrix4(),black=new THREE.Color(0,0,0)
  return {
    update(){
      if(!bindings.length)return
      root.updateWorldMatrix(true,false);inverse.copy(root.matrixWorld).invert()
      for(const {light,anchor,local,color}of bindings){
        let enabled=true
        for(let parent:THREE.Object3D|null=anchor;parent;parent=parent.parent)if(!parent.visible){enabled=false;break}
        light.userData.sourceVisible=enabled
        light.color.copy(enabled?color:black)
        light.matrix.multiplyMatrices(inverse,anchor.matrixWorld).multiply(local)
        light.matrix.decompose(light.position,light.quaternion,light.scale)
        light.updateMatrixWorld(true)
      }
    },
  }
}
