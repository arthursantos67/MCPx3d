import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { buildNodeGeometry } from '../../src/three/sceneGeometry.ts'
import { animateWater, prepareWater, waterGeometry, waterSegments, waveScale } from '../../src/three/sceneWater.ts'
import { buildGroundField, createWind } from '../../src/three/sceneWind.ts'
import { meadow, node, scene } from './worldFixtures.ts'

const water = (dimensions: [number, number, number]) => { const n = node('plane', 'sea', { dimensions }); n.material = { ...n.material, texture: 'water' }; return n }

test('water planes become tessellated grids with the same footprint and UVs', () => {
  const sea = water([60, 0.01, 30]), grid = waterGeometry(sea)!, flat = buildNodeGeometry(sea)
  assert.deepEqual(waterSegments(sea), [50, 25])
  assert.equal(grid.getAttribute('position').count, 51 * 26)
  grid.computeBoundingBox(); flat.computeBoundingBox()
  for (const axis of ['x', 'z'] as const) assert.ok(Math.abs(grid.boundingBox!.min[axis] - flat.boundingBox!.min[axis]) < 1e-6 && Math.abs(grid.boundingBox!.max[axis] - flat.boundingBox!.max[axis]) < 1e-6)
  assert.ok(Math.abs(grid.boundingBox!.max.y) < 1e-9, 'plano plano: as ondas entram no shader')
  const corner = (g: THREE.BufferGeometry, x: number, z: number) => { const p = g.getAttribute('position'), uv = g.getAttribute('uv'); for (let i = 0; i < p.count; i++) if (Math.abs(p.getX(i) - x) < 1e-6 && Math.abs(p.getZ(i) - z) < 1e-6) return [uv.getX(i), uv.getY(i)]; return null }
  assert.deepEqual(corner(grid, -0.5, -0.5), corner(flat, -0.5, -0.5)); assert.deepEqual(corner(grid, 0.5, 0.5), corner(flat, 0.5, 0.5))
  assert.equal(grid.getAttribute('waterSwell').getX(0), waveScale(sea))
  assert.deepEqual(waterSegments(water([5000, 0.01, 5000])), [160, 160])
  assert.ok(waveScale(water([2, 0.01, 2])) < waveScale(sea))
  assert.equal(waterGeometry(node('plane', 'floor')), null)
  assert.equal(waterGeometry(node('cylinder', 'pool', { material: { ...node('box', 'x').material, texture: 'water' } })), null)
})

test('river meshes flow along their route', () => {
  const river = node('mesh', 'river', { role: 'path', position: [5, 0, 0], dimensions: [10, 0.1, 2], path: { supportId: 'land', points: [[0, 0], [10, 0]], width: 2 } })
  river.material = { ...river.material, texture: 'water' }
  river.geometry = { ...river.geometry, vertices: [0, 0, -1, 10, 0, -1, 10, 0, 1, 0, 0, 1], indices: [0, 2, 1, 0, 3, 2], uvs: [0, -0.5, 5, -0.5, 5, 0.5, 0, 0.5], normals: [] }
  const flow = waterGeometry(river)!.getAttribute('waterFlow')
  for (let i = 0; i < flow.count; i++) { assert.ok(flow.getX(i) > 0.39 && flow.getX(i) < 0.41); assert.ok(Math.abs(flow.getY(i)) < 1e-6) }
})

test('prepareWater is idempotent, keeps animateWater and injects waves, foam and flow', () => {
  const wind = createWind(), field = buildGroundField(scene([meadow(30)]))!
  const texture = () => { const t = new THREE.Texture(); t.offset.set(0.1, 0.2); return t }
  const material = new THREE.MeshPhysicalMaterial({ normalMap: texture(), roughnessMap: texture(), normalScale: new THREE.Vector2(0.8, 0.8) })
  material.userData.water = true
  prepareWater(material, wind, field, { flow: [0.02, 0] })
  const hook = material.onBeforeCompile
  prepareWater(material, wind, null, { flow: [0, 0.03] })
  assert.equal(material.onBeforeCompile, hook)
  assert.equal(material.customProgramCacheKey().endsWith('|water-v1'), true)
  assert.equal(wind.uniforms.groundMap.value, field.texture)
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader } as unknown as THREE.WebGLProgramParametersWithUniforms
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer)
  const uniforms = shader.uniforms as Record<string, THREE.IUniform>
  assert.equal(uniforms.waterShore.value, 0); assert.deepEqual((uniforms.waterFlowDefault.value as THREE.Vector2).toArray(), [0, 0.03])
  for (const pattern of [/waterLift/, /worldPosition\.y \+= waterLift/]) assert.match(shader.vertexShader, pattern)
  for (const pattern of [/waterFoam/, /roughnessFactor = mix\( roughnessFactor, 0\.75, waterFoam \)/, /vWaterFlow \* waterPhaseA/, /#include <normal_fragment_maps>/]) assert.match(shader.fragmentShader, pattern)
  animateWater([material], 10)
  assert.notDeepEqual(material.normalMap!.offset.toArray(), [0.1, 0.2])
  animateWater([material], 0)
  assert.deepEqual(material.normalMap!.offset.toArray(), [0.1, 0.2])
})
