import * as THREE from 'three'
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js'

/** Spatial contact shading, with fresh depth every frame and no temporal accumulation. */
export function createOcclusionPass(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
  const pass = new SSAOPass(scene,camera,1,1,16)
  pass.kernelRadius = 0.7
  const render = pass.render.bind(pass)
  pass.render = (renderer,writeBuffer,readBuffer,delta,mask) => {
    const hidden: THREE.Object3D[] = [], shadowUpdate = renderer.shadowMap.autoUpdate
    scene.traverse(object => {
      if (object instanceof THREE.Mesh && object.visible) {
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        // The normal override has no alpha map: leaf cards would otherwise occlude as solid rectangles.
        if (materials.some(material => material.transparent || material.alphaTest > 0 || material instanceof THREE.ShadowMaterial)) { hidden.push(object); object.visible=false }
      }
    })
    const range = camera.far-camera.near
    pass.minDistance = 0.018/range; pass.maxDistance = 1.2/range
    pass.ssaoMaterial.uniforms.cameraNear.value = camera.near
    pass.ssaoMaterial.uniforms.cameraFar.value = camera.far
    pass.ssaoMaterial.uniforms.cameraProjectionMatrix.value.copy(camera.projectionMatrix)
    pass.ssaoMaterial.uniforms.cameraInverseProjectionMatrix.value.copy(camera.projectionMatrixInverse)
    renderer.shadowMap.autoUpdate=false
    try { render(renderer,writeBuffer,readBuffer,delta,mask) }
    finally { for(const object of hidden) object.visible=true; renderer.shadowMap.autoUpdate=shadowUpdate }
  }
  return pass
}
