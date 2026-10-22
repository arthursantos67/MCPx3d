import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { terrainHeightAt } from '../../src/three/sceneGeometrySpec.ts'
import { applyWind, buildGroundField, clothGeometry, createWind, windField, windKind, windKinds, windOffset, windShadowMaterials } from '../../src/three/sceneWind.ts'
import { meadow, node, prefab, scene } from './worldFixtures.ts'

test('ground field heights follow terrainHeightAt and the textures are RGBA8 with linear filtering', () => {
  const land = meadow(40), field = buildGroundField(scene([land]), 256)!
  assert.ok(field)
  assert.equal(field.texture.type, THREE.UnsignedByteType); assert.equal(field.texture.format, THREE.RGBAFormat)
  assert.equal(field.texture.magFilter, THREE.LinearFilter); assert.equal(field.texture.generateMipmaps, false)
  assert.equal(field.tint.type, THREE.UnsignedByteType); assert.equal(field.tint.colorSpace, THREE.SRGBColorSpace)
  assert.deepEqual(field.bounds.map((v) => Math.round(v * 1000) / 1000), [-20, -20, 40, 40])
  let worst = 0
  for (let k = 0; k < 400; k++) {
    const x = -19.5 + (k % 20) * 2.03, z = -19.5 + Math.floor(k / 20) * 2.03
    const exact = terrainHeightAt(land.geometry, x / 40, z / 40) * 4
    worst = Math.max(worst, Math.abs(field.heightAt(x, z) - exact))
  }
  assert.ok(worst < 0.08, `erro máximo ${worst}`)
  assert.ok(field.range[0] >= -2.01 && field.range[1] <= 2.01)
  assert.equal(field.coverAt(100, 100), 0); assert.equal(field.grassAt(100, 100), 0)
  field.dispose()
})

test('ground field returns null without ground and covers raised planes', () => {
  assert.equal(buildGroundField(scene([node('box', 'crate')])), null)
  const floor = node('plane', 'floor', { position: [5, 1.5, 0], dimensions: [10, 0.01, 6] })
  floor.material = { ...floor.material, texture: 'grass' }
  const field = buildGroundField(scene([floor]))!
  assert.ok(Math.abs(field.heightAt(5, 0) - 1.5) < 1e-3)
  assert.ok(field.grassAt(5, 0) > 0.95)
})

test('grass mask excludes structures, paths, water and steep or barren ground', () => {
  const land = meadow(60)
  land.geometry = { ...land.geometry, pads: [[0, 0, 0.12, 0.12, 0]] }
  const road = node('mesh', 'road', { role: 'path', path: { supportId: 'land', points: [[-25, 15], [25, 15]], width: 3 }, position: [0, 0, 15], dimensions: [50, 0.1, 3] })
  const sea = node('plane', 'sea', { position: [0, -0.4, 0], dimensions: [60, 0.01, 60] })
  sea.material = { ...sea.material, texture: 'water' }
  const house = node('box', 'house', { position: [0, 1.5, 0], dimensions: [5, 3, 5], role: 'structure' })
  const doc = scene([land, road, sea, house])
  const field = buildGroundField(doc, 256)!, open = buildGroundField(scene([land]), 256)!
  assert.ok(field.grassAt(0, 0) < 0.02, 'casa')
  assert.ok(field.grassAt(-10, 15) < 0.02 && field.grassAt(10, 15.8) < 0.05, 'estrada')
  let underwater = 0, dry = 0, kept = 0
  for (let x = -28; x <= 28; x += 1.5) for (let z = -28; z <= 28; z += 1.5) {
    if (field.heightAt(x, z) < -0.35) { underwater++; assert.ok(field.grassAt(x, z) < 0.02, `água ${x},${z}`) }
    else if (open.grassAt(x, z) > 0.5 && Math.abs(z - 15) > 3 && Math.hypot(x, z) > 6) { dry++; if (field.grassAt(x, z) > 0.3) kept++ }
  }
  assert.ok(underwater > 0 && dry > 50 && kept / dry > 0.8, `${underwater} ${dry} ${kept}`)
  const desert = meadow(40, { biome: 'desert' })
  assert.ok(buildGroundField(scene([desert]))!.grassAt(3, 3) === 0)
  const cliffs = meadow(20, { terrainStyle: 'ridged', detail: 4 })
  cliffs.dimensions = [20, 14, 20]
  const steep = buildGroundField(scene([cliffs]), 128)!
  let steepCount = 0, steepGrass = 0
  for (let x = -9; x <= 9; x += 0.5) for (let z = -9; z <= 9; z += 0.5) {
    const e = 0.08, s = Math.hypot(steep.heightAt(x + e, z) - steep.heightAt(x - e, z), steep.heightAt(x, z + e) - steep.heightAt(x, z - e)) / (2 * e)
    if (s > 1.2) { steepCount++; steepGrass += steep.grassAt(x, z) }
  }
  assert.ok(steepCount > 50 && steepGrass / steepCount < 0.05, `${steepCount} ${steepGrass / steepCount}`)
})

test('wind displacement is continuous in space, zero at the base, grows with height and stays bounded', () => {
  const tree = { kind: 'tree' as const, stiffness: 0.55 }, foliage = { kind: 'foliage' as const, stiffness: 0.55 }, dir: [number, number] = [0.8, 0.6]
  for (const spec of [tree, foliage, { kind: 'grass' as const, stiffness: 0.3 }]) assert.deepEqual(windOffset([3, 0, 4], 0, 12, spec, 2, dir).map((v) => Math.abs(v) < 1e-12 ? 0 : v), [0, 0, 0])
  for (let t = 0; t < 40; t += 1.7) {
    const low = Math.hypot(...windOffset([5, 1, 2], 0, t, tree, 1, dir)), high = Math.hypot(...windOffset([5, 5, 2], 0, t, tree, 1, dir))
    assert.ok(high >= low, `t=${t}`)
    const a = windOffset([5, 4, 2], 0, t, foliage, 1, dir), b = windOffset([5.01, 4.01, 2.01], 0, t, foliage, 1, dir)
    assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 0.005, 'contínuo')
    // Trunk tip and crown base at the same point share the main bend (flutter only adds a few centimetres).
    const trunk = windOffset([5, 4, 2], 0, t, tree, 1, dir)
    assert.ok(Math.hypot(a[0] - trunk[0], a[1] - trunk[1], a[2] - trunk[2]) <= 0.03 * 0.505 * 1.6 + 1e-9)
  }
  for (let t = 0; t < 60; t += 0.37) for (const h of [0.3, 2, 8, 30]) {
    const d = windOffset([t * 3, h, -t], 0, t, { kind: 'grass', stiffness: 0 }, 2, dir)
    assert.ok(Math.hypot(d[0], d[2]) <= Math.min(0.4 * h, 1.5) + 1e-9)
    assert.ok(d.every(Number.isFinite))
  }
  const f = windField(0, 0, 3, dir, 0)
  assert.deepEqual(f.map(Math.abs), [0, 0])
  const flag = windOffset([0, 3, 0], 0, 2, { kind: 'flag', stiffness: 0.2 }, 1, dir, { reach: 0, normal: [0, 0, 1] })
  assert.deepEqual(flag.map(Math.abs), [0, 0, 0])
  const tip = windOffset([0, 1.5, 0], 0, 2, { kind: 'flag', stiffness: 0.2 }, 2, dir, { reach: 1.8, normal: [0, 0, 1] })
  assert.ok(Math.hypot(...tip) <= 1.08 + 1e-9)
})

test('windKind picks plants, crowns and flags, never characters or rocks', () => {
  const doc = scene([...prefab('tree', 't', [0, 0, 0]), ...prefab('pine', 'p', [5, 0, 0]), ...prefab('banner', 'b', [9, 0, 0]), ...prefab('rock', 'r', [12, 0, 0]), ...prefab('villager', 'v', [15, 0, 0]), ...prefab('checkpoint', 'c', [18, 0, 0])])
  const kinds = windKinds(doc)
  assert.equal(kinds.get('t.trunk')?.kind, 'tree'); assert.equal(kinds.get('t.foliage0')?.kind, 'foliage')
  assert.equal(kinds.get('t.trunk')?.stiffness, kinds.get('t.foliage2')?.stiffness)
  assert.ok(kinds.get('p.trunk')!.stiffness > kinds.get('t.trunk')!.stiffness)
  assert.deepEqual(kinds.get('b.flag'), { kind: 'flag', stiffness: 0.2, anchor: 'top' })
  assert.equal(kinds.get('b.pole'), undefined)
  assert.equal(kinds.get('c.flag')?.anchor, 'side')
  assert.ok(![...kinds.keys()].some((id) => id.startsWith('r.') || id.startsWith('v.')))
  const authored = node('sphere', 'canopy', { parentId: 'grove' })
  assert.equal(windKind(authored, node('group', 'grove', { role: 'vegetation' }))?.kind, 'tree')
  authored.material = { ...authored.material, texture: 'leaves' }
  assert.equal(windKind(authored, node('group', 'grove', { role: 'vegetation' }))?.kind, 'foliage')
  assert.equal(windKind(node('box', 'wall'), undefined), null)
})

test('cloth geometry is tessellated and measures reach from the anchor, emblems included', () => {
  const doc = scene(prefab('banner', 'b', [0, 0, 0], { seed: 3 })), kinds = windKinds(doc)
  const flagNode = doc.nodes.find((n) => n.id === 'b.flag')!, emblem = doc.nodes.find((n) => n.id === 'b.emblem')!
  const flag = clothGeometry(flagNode, kinds.get('b.flag')!), reach = flag.getAttribute('clothReach')
  assert.ok(flag.getAttribute('position').count >= 150)
  let min = Infinity, max = -Infinity
  for (let i = 0; i < reach.count; i++) { min = Math.min(min, reach.getX(i)); max = Math.max(max, reach.getX(i)) }
  assert.ok(min < 0.01 && Math.abs(max - flagNode.dimensions[1]) < 0.02, `${min} ${max}`)
  flag.computeBoundingBox()
  assert.ok(flag.boundingBox!.min.distanceTo(new THREE.Vector3(-0.5, -0.5, -0.5)) < 1e-3 && flag.boundingBox!.max.distanceTo(new THREE.Vector3(0.5, 0.5, 0.5)) < 1e-3)
  const sewn = clothGeometry(emblem, kinds.get('b.emblem')!), r = sewn.getAttribute('clothReach'), axis = sewn.getAttribute('clothAxis')
  for (let i = 0; i < r.count; i++) assert.ok(r.getX(i) > 0.3 && r.getX(i) < 1.0)
  // The emblem is rotated 90° about X; its local axis must still map to the banner's Z.
  const world = new THREE.Vector3(axis.getX(0), axis.getY(0), axis.getZ(0)).multiply(new THREE.Vector3(...emblem.dimensions)).applyEuler(new THREE.Euler(...emblem.rotation.map(THREE.MathUtils.degToRad) as [number, number, number])).normalize()
  assert.ok(Math.abs(world.z) > 0.999)
})

test('applyWind patches with a cache key, keeps earlier hooks, and offers matching shadow materials', () => {
  const wind = createWind(), material = new THREE.MeshPhysicalMaterial()
  let earlier = 0
  material.onBeforeCompile = () => { earlier++ }
  material.customProgramCacheKey = () => 'terrain-layers-v2:meadow'
  applyWind(material, wind, 'foliage', 0.4)
  applyWind(material, wind, 'foliage', 0.5)
  assert.equal(material.customProgramCacheKey(), 'terrain-layers-v2:meadow|wind-v1:foliage')
  const shader = { uniforms: {}, defines: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: '' } as unknown as THREE.WebGLProgramParametersWithUniforms
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer)
  assert.equal(earlier, 1)
  assert.match(shader.vertexShader, /windDisplace\( windWorld\.xyz/); assert.match(shader.vertexShader, /worldPosition\.xyz \+= windDelta/)
  assert.ok(!shader.vertexShader.includes('#include <project_vertex>'))
  assert.equal((shader.uniforms as Record<string, THREE.IUniform>).windStiffness.value, 0.5)
  assert.equal((shader.defines as Record<string, number>).WIND_KIND, 1)
  const shadow = windShadowMaterials(material)!
  for (const [target, lib] of [[shadow.depth, THREE.ShaderLib.depth], [shadow.distance, THREE.ShaderLib.distance]] as const) {
    const s = { uniforms: {}, defines: {}, vertexShader: lib.vertexShader, fragmentShader: '' } as unknown as THREE.WebGLProgramParametersWithUniforms
    target.onBeforeCompile(s, {} as THREE.WebGLRenderer)
    assert.match(s.vertexShader, /windDisplace/)
  }
  const field = buildGroundField(scene([meadow(20)]))!
  wind.setGround(field); wind.setStrength(5); wind.update(10, new THREE.Vector3(1, 2, 3))
  assert.equal(wind.uniforms.windStrength.value, 2); assert.equal(wind.uniforms.groundEnabled.value, 1); assert.equal(wind.uniforms.groundMap.value, field.texture)
  assert.deepEqual((wind.uniforms.windPlayer.value as THREE.Vector4).toArray(), [1, 2, 3, 1])
  assert.ok(Math.abs(wind.vector().length() - 2) < 1e-6)
})
