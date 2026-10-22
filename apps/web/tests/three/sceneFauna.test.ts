import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { createEmptyScene, createNode, type SceneNode, type ThreeSceneDocument, type Vector3Tuple } from '../../src/three/sceneDocument.ts'
import { prefabParts, prefabSpec, type PrefabType } from '../../src/three/scenePrefabs.ts'
import { createFauna, FAUNA_BUDGET, faunaCounts, faunaHabitat, faunaTotals, planFauna, stepFlock, type FaunaPlan, type FlockBoid, type FlockRules } from '../../src/three/sceneFauna.ts'

type Env = ThreeSceneDocument['environment']
let serial = 0
function prefab(type: PrefabType, position: Vector3Tuple, seed = 1): SceneNode[] {
  const spec = prefabSpec({ type, seed })!, id = `${type}${serial++}`
  const root: SceneNode = { ...createNode('group'), id, name: type, position, asset: spec }
  return [root, ...prefabParts(spec).map((part) => {
    const base = createNode(part.kind)
    return { ...base, id: `${id}.${part.id}`, parentId: part.parentId ? `${id}.${part.parentId}` : id, name: part.name, position: part.position, rotation: part.rotation ?? [0, 0, 0] as Vector3Tuple,
      dimensions: part.dimensions, assetPart: part.id, material: { ...base.material, ...part.material }, geometry: { ...base.geometry, ...part.geometry } }
  })]
}
function terrain(biome: NonNullable<SceneNode['geometry']['biome']>, size = 90): SceneNode {
  const node = createNode('terrain')
  return { ...node, id: `terrain${serial++}`, dimensions: [size, 4, size], geometry: { ...node.geometry, biome } }
}
function water(size: number, y = 0, depth = 0.01): SceneNode {
  const node = createNode(depth > 0.05 ? 'box' : 'plane')
  return { ...node, id: `water${serial++}`, position: [0, y - depth / 2, 0], dimensions: [size, depth, size], material: { ...node.material, texture: 'water' } }
}
function scene(env: Partial<Env>, nodes: SceneNode[], name = 'Nova cena'): ThreeSceneDocument {
  const doc = createEmptyScene()
  return { ...doc, name, nodes, environment: { ...doc.environment, ...env } }
}
const grove = (x: number, z: number, type: PrefabType = 'tree', count = 6) => Array.from({ length: count }, (_, i) => prefab(type, [x + (i % 3) * 4, 0, z + Math.floor(i / 3) * 4], i + 1)).flat()
const forest = (motion?: Env['motion']) => scene({ sky: 'day', ...(motion ? { motion } : {}) }, [terrain('forest'), ...grove(-20, -20), ...grove(20, 10, 'pine'), ...prefab('flowerBed', [4, 0, 4]), ...prefab('flowerBed', [6, 0, 5], 2), ...prefab('bush', [8, 0, 3])])
const sum = (list: number[]) => list.reduce((a, b) => a + b, 0)

test('forest and meadow scenes get songbird flocks over the trees and butterflies by the flower beds', () => {
  const plan = planFauna(forest())
  assert.equal(plan.habitat, 'forest')
  assert.ok(plan.birds.length >= 1 && plan.birds.every((flock) => flock.kind === 'songbird' && flock.count >= 2), JSON.stringify(plan.birds))
  for (const flock of plan.birds) {
    assert.ok(flock.altitude > 4, 'flocks circle above the treetops')
    assert.ok(flock.radius >= 12 && flock.radius <= 40)
  }
  assert.ok(plan.butterflies.some((swarm) => Math.hypot(swarm.center[0] - 5, swarm.center[2] - 4.5) < 6), 'a swarm hovers by the flower beds')
  assert.equal(plan.fish.length, 0, 'no water, no fish')
  const meadow = planFauna(scene({ sky: 'day' }, [terrain('meadow')]))
  assert.equal(meadow.habitat, 'meadow')
  assert.ok(meadow.birds.length === 1 && meadow.butterflies.length === 1, 'an open field still gets a flock and a swarm')
})

test('beach water gets fish below the surface and gulls; desert gets a few raptors and no insects', () => {
  const beach = planFauna(scene({ sky: 'sunset' }, [water(60, 0.5), ...grove(30, 30, 'palm', 3)], 'Praia'))
  assert.equal(beach.habitat, 'beach')
  assert.ok(beach.fish.length >= 1)
  for (const school of beach.fish) { assert.ok(Math.abs(school.center[1] - 0.5) < 0.02, 'centre is the water surface'); assert.ok(school.depth > 0 && school.depth <= 1.4 && school.count >= 4) }
  assert.ok(beach.birds.length >= 1 && beach.birds.every((flock) => flock.kind === 'gull'))
  const pond = planFauna(scene({ sky: 'day' }, [terrain('forest'), water(12, 1, 1.2), ...grove(10, 10)]))
  assert.ok(pond.fish.length === 1 && pond.fish[0].depth <= 0.6 + 1e-9, 'shallow ponds keep fish within half their depth')
  const desert = planFauna(scene({ sky: 'day' }, [terrain('desert'), ...prefab('cactus', [3, 0, 3]), ...prefab('cactus', [6, 0, 2], 2)]))
  assert.equal(desert.habitat, 'desert')
  assert.ok(faunaTotals(desert).birds > 0 && faunaTotals(desert).birds <= 6 && desert.birds.every((flock) => flock.kind === 'raptor' && flock.altitude > 15))
  assert.equal(desert.butterflies.length, 0)
  const swamp = planFauna(scene({ sky: 'day' }, [terrain('swamp'), water(20, 0.2)]))
  assert.ok(swamp.butterflies.length >= 1 && swamp.butterflies.every((swarm) => swarm.kind === 'dragonfly' && swarm.glow === 1), 'swamps get insects that glow at night')
})

test('space, caves, dungeons, sci-fi, the moon, studio and density none have no wildlife', () => {
  const empty = (plan: FaunaPlan) => faunaTotals(plan).birds + faunaTotals(plan).fish + faunaTotals(plan).butterflies === 0
  assert.ok(empty(planFauna(scene({ sky: 'space' }, [...prefab('planet', [0, 0, 0]), ...grove(0, 0)]))))
  assert.ok(empty(planFauna(scene({ sky: 'night' }, [...prefab('rock', [0, 0, 0]), ...grove(0, 0), water(20)], 'Caverna de cristal'))))
  assert.ok(empty(planFauna(scene({ sky: 'day' }, [...grove(0, 0)], 'Masmorra do rei'))))
  assert.ok(empty(planFauna(scene({ sky: 'day' }, [...grove(0, 0)], 'Estação espacial'))))
  assert.ok(empty(planFauna(scene({ sky: 'day' }, [terrain('lunar')]))))
  assert.ok(empty(planFauna(scene({ sky: 'studio' }, [terrain('forest'), ...grove(0, 0)]))), 'studio product scenes stay still under auto')
  assert.ok(empty(planFauna(forest({ wind: 0.6, grass: 'auto', fauna: 'none' }))), 'environment.motion.fauna none is respected')
  assert.ok(empty(planFauna(forest(), 'none')))
  assert.equal(faunaHabitat(scene({ sky: 'space' }, [])), 'none')
  const reef = planFauna(scene({ sky: 'day', weather: 'bubbles' }, [...prefab('coral', [0, 0, 0]), ...prefab('seaweed', [2, 0, 1])]))
  assert.equal(reef.habitat, 'underwater')
  assert.ok(reef.fish.length >= 1 && reef.birds.length === 0 && reef.butterflies.length === 0)
})

test('rich adds wildlife, rain grounds insects, plans are deterministic and within the high budget', () => {
  const auto = faunaTotals(planFauna(forest())), rich = faunaTotals(planFauna(forest(), 'rich'))
  assert.ok(rich.birds > auto.birds && rich.butterflies >= auto.butterflies, `${JSON.stringify(auto)} → ${JSON.stringify(rich)}`)
  assert.deepEqual(planFauna(forest()), planFauna(forest()))
  const rainy = planFauna(scene({ sky: 'overcast', weather: 'rain' }, forest().nodes))
  assert.equal(rainy.butterflies.length, 0)
  assert.ok(faunaTotals(rainy).birds <= auto.birds)
  const crowded = scene({ sky: 'day' }, [terrain('meadow', 400), ...Array.from({ length: 12 }, (_, i) => [...grove(i * 40 - 240, (i % 3) * 40, 'tree', 6), ...prefab('flowerBed', [i * 40 - 240, 0, 20 + (i % 3) * 40], i), { ...water(16), position: [i * 40 - 240, 0, -60] as Vector3Tuple }]).flat()])
  const big = faunaTotals(planFauna(crowded, 'rich'))
  assert.ok(big.birds <= FAUNA_BUDGET.high.birds && big.fish <= FAUNA_BUDGET.high.fish && big.butterflies <= FAUNA_BUDGET.high.insects, JSON.stringify(big))
})

test('quality budgets cap the active individuals proportionally', () => {
  const plan: FaunaPlan = { habitat: 'forest', seed: 1, birds: [30, 20, 14].map((count) => ({ center: [0, 0, 0], radius: 20, altitude: 8, count, kind: 'songbird' as const })),
    fish: [40, 40, 16].map((count) => ({ center: [0, 0, 0], radius: 5, depth: 0.5, count, color: '#888888' })), butterflies: [30, 34].map((count) => ({ center: [0, 0, 0], radius: 4, count, glow: 0.5, kind: 'butterfly' as const })) }
  for (const quality of ['low', 'medium', 'high'] as const) {
    const counts = faunaCounts(plan, quality), budget = FAUNA_BUDGET[quality]
    assert.ok(sum(counts.birds) <= budget.birds && sum(counts.fish) <= budget.fish && sum(counts.butterflies) <= budget.insects, quality)
    assert.equal(sum(counts.birds), Math.min(budget.birds, 64))
    counts.birds.forEach((count, i) => assert.ok(count <= plan.birds[i].count && count > 0))
  }
  assert.ok(FAUNA_BUDGET.low.birds < FAUNA_BUDGET.medium.birds && FAUNA_BUDGET.medium.birds < FAUNA_BUDGET.high.birds)
  assert.deepEqual(faunaCounts({ ...plan, birds: [{ ...plan.birds[0], count: 5 }] }, 'low').birds, [5])
})

test('boids stay finite and inside their area under any step, threat and spacing', () => {
  let seed = 7
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
  const boids: FlockBoid[] = Array.from({ length: 30 }, () => ({ position: new THREE.Vector3(rnd() * 10 - 5, 10 + rnd() * 4, rnd() * 10 - 5), velocity: new THREE.Vector3(rnd() - 0.5, 0, rnd() - 0.5) }))
  boids[1].position.copy(boids[0].position)
  const rules: FlockRules = { center: new THREE.Vector3(0, 0, 0), radius: 15, minY: 4, maxY: 22, target: new THREE.Vector3(8, 12, 0), seek: 1.2, cohesion: 0.6, alignment: 1.4, separation: 2.5, spacing: 1.2, view: 6,
    minSpeed: 2, maxSpeed: 6, maxAccel: 12, threat: null, threatRadius: 12, threatStrength: 30, vertical: 1 }
  let spread = 0
  for (let frame = 0; frame < 900; frame++) {
    const angle = frame * 0.01
    rules.target!.set(Math.cos(angle) * 9, 12, Math.sin(angle) * 9)
    rules.threat = frame % 200 < 40 ? new THREE.Vector3(0, 12, 0) : null
    const dt = frame === 100 ? Number.NaN : frame === 101 ? 5 : frame % 7 === 0 ? 0.1 : 1 / 60
    stepFlock(boids, rules, dt)
    for (const boid of boids) {
      assert.ok([boid.position.x, boid.position.y, boid.position.z, boid.velocity.x, boid.velocity.y, boid.velocity.z].every(Number.isFinite), `finite at frame ${frame}`)
      assert.ok(Math.hypot(boid.position.x, boid.position.z) <= rules.radius * 1.25 + 1e-6, 'inside the horizontal area')
      assert.ok(boid.position.y >= rules.minY - 1e-9 && boid.position.y <= rules.maxY + 1e-9, 'inside the altitude band')
      assert.ok(boid.velocity.length() <= rules.maxSpeed + 1e-6)
    }
  }
  for (let i = 0; i < boids.length; i++) for (let j = i + 1; j < boids.length; j++) spread = Math.max(spread, boids[i].position.distanceTo(boids[j].position))
  let closest = Infinity
  for (let i = 0; i < boids.length; i++) for (let j = i + 1; j < boids.length; j++) closest = Math.min(closest, boids[i].position.distanceTo(boids[j].position))
  assert.ok(closest > 0.05, `separation keeps birds apart (${closest.toFixed(3)} m)`)
  assert.ok(spread < 30, 'cohesion keeps the flock together')
  const before = boids.map((boid) => boid.position.clone())
  stepFlock(boids, rules, 0)
  assert.deepEqual(boids.map((boid) => boid.position), before, 'zero dt does not move anything')
})

function instances(mesh: THREE.InstancedMesh) {
  const matrix = new THREE.Matrix4(), column = new THREE.Vector3(), list: { position: THREE.Vector3; scale: number }[] = []
  for (let i = 0; i < mesh.count; i++) { mesh.getMatrixAt(i, matrix); list.push({ position: new THREE.Vector3().setFromMatrixPosition(matrix), scale: column.setFromMatrixColumn(matrix, 0).length() }) }
  return list
}

test('fauna builds headless in at most four draw calls, lands, takes off when scared and swaps butterflies for fireflies at night', () => {
  const doc = scene({ sky: 'day' }, [terrain('forest'), ...grove(-10, -10), ...prefab('flowerBed', [4, 0, 4]), ...prefab('flowerBed', [6, 0, 5], 2), ...prefab('bush', [8, 0, 3]), water(14, 0.3, 1)])
  const plan = planFauna(doc, 'rich'), fauna = createFauna(plan, () => 0, 'high')
  const meshes = fauna.object.children as THREE.Mesh[]
  assert.ok(meshes.length >= 3 && meshes.length <= 4, `draw calls ${meshes.length}`)
  for (const mesh of meshes) { assert.equal(mesh.frustumCulled, false); assert.equal(mesh.castShadow, false) }
  const birds = fauna.object.getObjectByName('fauna-birds') as THREE.InstancedMesh, fish = fauna.object.getObjectByName('fauna-fish') as THREE.InstancedMesh
  const insects = fauna.object.getObjectByName('fauna-insects') as THREE.InstancedMesh, glow = fauna.object.getObjectByName('fauna-fireflies') as THREE.Mesh<THREE.InstancedBufferGeometry>
  assert.ok(birds && fish && insects && glow)
  assert.equal(birds.count, faunaTotals(plan).birds)
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500)
  camera.position.set(0, 2, 30); camera.updateMatrixWorld()
  let landed = 0
  for (let frame = 0; frame < 60 * 90; frame++) {
    fauna.update(camera, frame / 60, 1 / 60, null, 0)
    if (frame % 30 === 0) landed = Math.max(landed, instances(birds).filter((bird) => bird.scale > 0 && bird.position.y < 0.2).length)
  }
  for (const bird of instances(birds)) assert.ok([bird.position.x, bird.position.y, bird.position.z].every(Number.isFinite))
  assert.ok(landed > 0, 'flocks land on the ground from time to time')
  const swimming = instances(fish).filter((item) => item.scale > 0)
  assert.ok(swimming.length > 0 && swimming.every((item) => item.position.y < 0.3 - 0.1 && item.position.y > 0.3 - 1.2), 'fish stay under the surface')
  const center = new THREE.Vector3(...plan.birds[0].center)
  fauna.scare(center.clone().setY(1), 60)
  for (let frame = 0; frame < 90; frame++) fauna.update(camera, 100 + frame / 60, 1 / 60, null, 0)
  assert.equal(instances(birds).filter((bird) => bird.scale > 0 && bird.position.y < 0.2).length, 0, 'scared birds take off')
  const day = instances(insects).filter((item) => item.scale > 0).length
  assert.ok(day > 0 && glow.visible === false)
  for (let frame = 0; frame < 60 * 20; frame++) fauna.update(camera, 200 + frame / 60, 1 / 60, null, 1)
  assert.equal(instances(insects).filter((item) => item.scale > 0).length, 0, 'butterflies rest at night')
  assert.ok(glow.visible && glow.geometry.instanceCount > 0, 'fireflies glow at night')
  assert.equal(instances(birds).filter((item) => item.scale > 0.01).length, 0, 'birds roost at night')
  fauna.setQuality('low')
  fauna.update(camera, 300, 1 / 60, null, 0)
  for (let frame = 0; frame < 60 * 20; frame++) fauna.update(camera, 300 + frame / 60, 1 / 60, null, 0)
  assert.ok(instances(birds).filter((item) => item.scale > 0).length <= FAUNA_BUDGET.low.birds)
  assert.ok(instances(fish).filter((item) => item.scale > 0).length <= FAUNA_BUDGET.low.fish)
  fauna.update(camera, 400, Number.NaN, new THREE.Vector3(Number.NaN, 0, 0), Number.NaN)
  fauna.dispose()
  assert.equal(fauna.object.parent, null)
})

test('an empty plan creates an empty, inert object', () => {
  const fauna = createFauna(planFauna(scene({ sky: 'space' }, [])), null)
  assert.equal(fauna.object.children.length, 0)
  fauna.update(new THREE.PerspectiveCamera(), 1, 0.016, null, 0.5)
  fauna.scare(new THREE.Vector3(), 10)
  fauna.dispose()
})

test('wing and tail shaders patch the Lambert chunks they rely on', () => {
  const plan = planFauna(scene({ sky: 'day' }, [terrain('forest'), ...grove(0, 0), water(12, 0.3, 1)]), 'rich'), fauna = createFauna(plan, null)
  for (const name of ['fauna-birds', 'fauna-fish']) {
    const material = (fauna.object.getObjectByName(name) as THREE.InstancedMesh).material as THREE.MeshLambertMaterial
    const shader = { vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader, uniforms: {} as Record<string, THREE.IUniform> }
    material.onBeforeCompile(shader as unknown as Parameters<THREE.Material['onBeforeCompile']>[0], undefined as unknown as THREE.WebGLRenderer)
    assert.match(shader.vertexShader, /faunaBend\(faunaPosition, objectNormal\)/)
    assert.match(shader.vertexShader, /vec3 transformed = faunaPosition;/)
    assert.doesNotMatch(shader.vertexShader, /#include <begin_vertex>/)
    assert.ok(shader.vertexShader.indexOf('faunaBend(faunaPosition') > shader.vertexShader.indexOf('#include <beginnormal_vertex>'))
    assert.ok(shader.uniforms.uFaunaTime)
    assert.notEqual(material.customProgramCacheKey(), new THREE.MeshLambertMaterial().customProgramCacheKey())
  }
  fauna.dispose()
})
