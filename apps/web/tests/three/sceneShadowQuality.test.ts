import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { setShadowResolution } from '../../src/three/sceneShadows.ts'

test('shadow quality changes release old maps once while retaining the reserved light slot', () => {
  const light = new THREE.PointLight('#ffffff',3,10)
  light.castShadow = true; light.shadow.mapSize.set(1024,1024)
  const map = new THREE.WebGLRenderTarget(1024,1024); let releases = 0
  map.addEventListener('dispose',()=>releases++)
  light.shadow.map = map
  assert.equal(setShadowResolution(light,512),true)
  assert.equal(releases,1); assert.equal(light.shadow.map,null)
  assert.equal(light.shadow.mapSize.x,512); assert.equal(light.shadow.needsUpdate,true)
  assert.equal(light.castShadow,true,'changing a reserved light count would recompile scene shaders')
  assert.equal(setShadowResolution(light,512),false); assert.equal(releases,1)
})
