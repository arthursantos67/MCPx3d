import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { createLightRegistry } from '../../src/three/sceneLightRegistry.ts'

test('hiding and restoring a collected light keeps the visible light count and its world attachment stable',()=>{
  const root=new THREE.Group(),token=new THREE.Group(),anchor=new THREE.Object3D(),light=new THREE.PointLight('#ffcc88',8,6)
  root.position.set(100,0,-50);root.rotation.y=.4;token.position.set(3,2,1);anchor.position.set(0,.5,0)
  root.add(token);token.add(anchor);anchor.add(light);root.updateMatrixWorld(true)
  const before=light.getWorldPosition(new THREE.Vector3()),registry=createLightRegistry(root,new Map([['light',light]]),new Map([['light',anchor]]))
  registry.update();assert.ok(light.getWorldPosition(new THREE.Vector3()).distanceTo(before)<1e-8)
  const count=()=>{let total=0;root.traverseVisible(object=>{if(object instanceof THREE.Light)total++});return total}
  assert.equal(count(),1);token.visible=false;registry.update()
  assert.equal(count(),1);assert.equal(light.color.getHex(),0);assert.equal(light.intensity,8)
  token.position.x+=2;token.visible=true;root.updateMatrixWorld(true);registry.update()
  assert.equal(count(),1);assert.equal(light.color.getHexString(),'ffcc88')
  assert.ok(light.getWorldPosition(new THREE.Vector3()).distanceTo(anchor.getWorldPosition(new THREE.Vector3()))<1e-8)
})
