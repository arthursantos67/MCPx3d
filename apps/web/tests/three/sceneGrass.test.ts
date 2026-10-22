import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { bladeRoot, bladeScale, createGrass, grassBudget, grassSeeds, MAX_GRASS_BLADES } from '../../src/three/sceneGrass.ts'
import { buildGroundField, createWind } from '../../src/three/sceneWind.ts'
import { meadow, node, scene } from './worldFixtures.ts'

test('grass budgets scale with quality and density and stay under the instanced maximum', () => {
  const low = grassBudget('low', 'auto'), medium = grassBudget('medium', 'auto'), high = grassBudget('high', 'auto'), dense = grassBudget('high', 'dense')
  assert.deepEqual([low.count, medium.count, high.count, dense.count], [7000, 20000, 48000, 72000])
  assert.ok(low.count < medium.count && medium.count < high.count && high.count < dense.count && dense.count <= MAX_GRASS_BLADES)
  for (const b of [low, medium, high, dense]) { assert.ok(b.fadeStart < b.fadeEnd && b.fadeEnd < b.area / 2); assert.ok(b.count / b.area ** 2 > 10, 'lâminas por m²') }
})

test('blade tiles wrap around the camera but stay fixed in the world', () => {
  const seeds = grassSeeds(2000), area = 32
  for (let i = 0; i < 2000; i++) {
    const [x, z] = bladeRoot(seeds, i, [100.3, -40.7], area)
    assert.ok(Math.abs(x - 100.3) <= area / 2 && Math.abs(z + 40.7) <= area / 2)
    const [x2, z2] = bladeRoot(seeds, i, [101.1, -40.2], area)
    if (Math.abs(x - 101.1) < area / 2 - 1 && Math.abs(z + 40.2) < area / 2 - 1) assert.ok(Math.hypot(x2 - x, z2 - z) < 1e-9)
  }
})

test('blades appear only where the mask allows and thin out with distance', () => {
  const land = meadow(80, { pads: [[0, 0, 0.06, 0.06, 0]] }), house = node('box', 'house', { position: [0, 1.5, 0], dimensions: [8, 3, 8] })
  const field = buildGroundField(scene([land, house]), 256)!, budget = grassBudget('high', 'auto'), seeds = grassSeeds(budget.count)
  let inside = 0, near = 0, far = 0, nearTotal = 0, farTotal = 0
  for (let i = 0; i < budget.count; i++) {
    const [x, z] = bladeRoot(seeds, i, [6, 6], budget.area), s = bladeScale(field, seeds, i, [6, 6], budget), d = Math.hypot(x - 6, z - 6)
    if (Math.abs(x) < 3.8 && Math.abs(z) < 3.8 && s > 0) inside++
    if (field.grassAt(x, z) > 0.8 && d < budget.fadeStart) { nearTotal++; if (s > 0) near++ }
    if (field.grassAt(x, z) > 0.8 && d > budget.fadeEnd) { farTotal++; if (s > 0) far++ }
  }
  assert.equal(inside, 0)
  assert.ok(near / nearTotal > 0.7, `${near}/${nearTotal}`)
  assert.equal(far, 0); assert.ok(farTotal > 0)
})

test('createGrass builds one instanced draw, follows quality and skips barren fields', () => {
  const wind = createWind(), field = buildGroundField(scene([meadow(40)]))!
  const grass = createGrass(field, wind, { density: 'auto', quality: 'medium' })!
  const mesh = grass.object as THREE.Mesh, geometry = mesh.geometry as THREE.InstancedBufferGeometry
  assert.equal(geometry.instanceCount, 20000); assert.equal(mesh.castShadow, false); assert.equal(mesh.receiveShadow, true)
  assert.equal(wind.uniforms.groundMap.value, field.texture)
  grass.setQuality('low'); assert.equal(geometry.instanceCount, 7000)
  const camera = new THREE.PerspectiveCamera()
  grass.update(camera, 1, new THREE.Vector3(1, 0, 1)); grass.update(camera, 1.5, new THREE.Vector3(3, 0, 1))
  const material = mesh.material as THREE.MeshStandardMaterial, shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader } as unknown as THREE.WebGLProgramParametersWithUniforms
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer)
  assert.match(shader.vertexShader, /vec3 transformed = bladePosition/); assert.match(shader.fragmentShader, /diffuseColor\.rgb \*= vGrassColor/)
  const trail = (shader.uniforms as Record<string, THREE.IUniform>).grassTrail.value as THREE.Vector4[]
  assert.equal(trail[0].x, 3); assert.ok(trail.some((p) => p.x === 1 && p.w > 0 && p.w < 1))
  grass.dispose()
  assert.equal(createGrass(buildGroundField(scene([meadow(40, { biome: 'desert' })]))!, wind, { density: 'auto', quality: 'high' }), null)
})
