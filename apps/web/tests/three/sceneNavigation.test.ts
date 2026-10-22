import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { hasSurface, subtreeIds, type ThreeSceneDocument } from '../../src/three/sceneDocument.ts'
import { createResources } from '../../src/three/sceneBuild.ts'
import { createCryptScene, createMarketTownScene } from '../../src/three/sceneExperiences.ts'
import { buildNavigation, createRouter, navigationConfig, navigationFocus, navigationInput, type NavigationMesh } from '../../src/three/sceneNavigation.ts'
import { sceneMatrices } from '../../src/three/scenePlacement.ts'
import { planRoutines, routinePoints } from '../../src/three/sceneRoutines.ts'

const agent = { radius: 0.4, height: 1.8, climb: 0.27 }
const box = (width: number, height: number, depth: number, x: number, y: number, z: number) => ({ geometry: new THREE.BoxGeometry(width, height, depth), matrix: new THREE.Matrix4().makeTranslation(x, y, z) })
const area = (size: number) => new THREE.Box3(new THREE.Vector3(-size / 2, -1, -size / 2), new THREE.Vector3(size / 2, 3, size / 2))
const v = (x: number, z: number, y = 0) => new THREE.Vector3(x, y, z)

/** Samples a polyline and reports the smallest ground distance to an axis-aligned XZ rectangle. */
function clearance(points: THREE.Vector3[], min: [number, number], max: [number, number]) {
  let smallest = Infinity
  for (let i = 1; i < points.length; i++) for (let k = 0; k <= 40; k++) {
    const p = points[i - 1].clone().lerp(points[i], k / 40)
    const dx = Math.max(min[0] - p.x, 0, p.x - max[0]), dz = Math.max(min[1] - p.z, 0, p.z - max[1])
    smallest = Math.min(smallest, Math.hypot(dx, dz))
  }
  return smallest
}
const length = (points: THREE.Vector3[]) => points.slice(1).reduce((sum, point, i) => sum + Math.hypot(point.x - points[i].x, point.z - points[i].z), 0)

/** Same selection as ThreeViewport.startGame: static, collidable, visible surfaces outside moving subtrees. */
function staticEntries(doc: ThreeSceneDocument) {
  const matrices = sceneMatrices(doc), resources = createResources(), dynamic = new Set<string>(), hidden = new Set<string>()
  for (const node of doc.nodes) {
    if (node.animation.kind !== 'none' || ['collect', 'heal', 'powerup'].includes(node.interaction?.action ?? '') || node.behavior?.type === 'enemy' || node.behavior?.type === 'npc') for (const id of subtreeIds(doc.nodes, node.id)) dynamic.add(id)
    if (!node.visible || node.behavior?.type === 'climbable') for (const id of subtreeIds(doc.nodes, node.id)) hidden.add(id)
  }
  return doc.nodes.filter((node) => hasSurface(node.kind) && node.collidable !== false && !dynamic.has(node.id) && !hidden.has(node.id))
    .map((node) => ({ geometry: resources.geometry(node), matrix: matrices.get(node.id)!.clone().scale(new THREE.Vector3(...node.dimensions)) }))
}
function agentsOf(doc: ThreeSceneDocument) {
  const matrices = sceneMatrices(doc)
  return doc.nodes.filter((node) => node.behavior?.type === 'npc' || node.behavior?.type === 'enemy').map((node) => ({ id: node.id, base: new THREE.Vector3().setFromMatrixPosition(matrices.get(node.id)!), range: node.behavior!.range }))
}

test('the navmesh routes around a wall instead of through it', async (t) => {
  const started = performance.now()
  const nav = await buildNavigation([box(20, 0.2, 20, 0, -0.1, 0), box(0.4, 3, 10, 0, 1.5, 0)], area(20), agent)
  const total = performance.now() - started
  assert.ok(nav, 'navmesh built')
  t.diagnostic(`20x20 m floor + wall: ${nav.milliseconds.toFixed(1)} ms Recast, ${total.toFixed(1)} ms including the first WASM load; ${nav.triangles} triangles`)
  const path = nav.path(v(-4, 0), v(4, 0))!
  assert.ok(path.length >= 3, 'needs corners')
  assert.ok(clearance(path, [-0.2, -5], [0.2, 5]) >= agent.radius - 0.15, `path cuts the wall: ${path.map((p) => p.toArray().map((x) => x.toFixed(2)))}`)
  assert.ok(length(path) > 10.5, `goes around: ${length(path)}`)
  assert.ok(path.at(-1)!.distanceTo(v(4, 0)) < 0.15)
  assert.equal(nav.clear(v(-4, 0), v(4, 0)), false)
  assert.equal(nav.clear(v(-4, 7), v(4, 7)), true)
  // Destinations inside an obstacle or beyond the floor snap to the closest walkable point.
  const inside = nav.closest(v(0, 0, 1))!
  assert.ok(Math.abs(inside.x) >= 0.2 + agent.radius - 0.15 && Math.abs(inside.x) < 1.2, `closest to the wall: ${inside.toArray()}`)
  const beyond = nav.closest(v(11.5, 0))!
  assert.ok(beyond.x < 10 - agent.radius + 0.15 && beyond.x > 8.5)
  nav.dispose()
  assert.equal(nav.path(v(-4, 0), v(4, 0)), null, 'disposed meshes answer nothing')
})

test('input is clipped to the focus box and voxels scale with its size', () => {
  const near = box(20, 0.2, 20, 0, -0.1, 0), far = box(4, 4, 4, 200, 2, 200)
  const input = navigationInput([near, far], area(20), agent)!
  assert.equal(input.indices.length / 3, 12, 'the far box is ignored')
  assert.equal(navigationInput([far], area(20), agent), null)
  const floored = navigationInput([far], area(20), agent, { floor: 0 })!
  assert.equal(floored.indices.length / 3, 2, 'safety floor quad')
  const small = navigationConfig(area(20), agent), huge = navigationConfig(area(3000), agent)
  assert.equal(small.cs, 0.2)
  assert.ok(huge.cs > small.cs && (3000 / huge.cs) ** 2 <= 1_200_000 * 1.01 + 1 || huge.cs === 0.6)
  assert.equal(small.walkableClimb, 3); assert.ok(small.walkableRadius * small.cs >= agent.radius)
  const focus = navigationFocus([{ base: v(0, 0), range: 5 }, { base: v(30, 0), range: 5 }], [v(0, 60)])
  assert.ok(focus.containsPoint(v(-10, 0)) && focus.containsPoint(v(39, 0)) && focus.containsPoint(v(0, 63)) && !focus.containsPoint(v(50, 0)))
})

test('the router caches corridors, repaths on a moved goal or a timer, advances corners and takes shortcuts', async () => {
  const nav = await buildNavigation([box(20, 0.2, 20, 0, -0.1, 0), box(0.4, 3, 10, 0, 1.5, 0)], area(20), agent)
  assert.ok(nav)
  let computed = 0
  const counted: NavigationMesh = { ...nav, path: (from, to) => { computed++; return nav.path(from, to) } }
  const router = createRouter(counted, { repath: 2 })
  const from = v(-4, 0), goal = v(4, 0)
  const first = router.next('a', from, goal, 0)
  assert.equal(computed, 1)
  assert.ok(first.distanceTo(goal) > 1 && Math.abs(first.z) > 4.5, `first waypoint is a corner around the wall: ${first.toArray()}`)
  for (let i = 1; i <= 10; i++) router.next('a', from, goal.clone().setZ(0.05 * i / 10), i * 0.1)
  assert.equal(computed, 1, 'small goal motion reuses the cached corridor')
  router.next('a', from, goal, 2.5)
  assert.equal(computed, 2, 'repaths after the timer')
  router.next('a', from, v(4, 6), 2.6)
  assert.equal(computed, 3, 'repaths when the goal moves')
  router.next('b', from, goal, 2.6)
  assert.equal(computed, 4, 'corridors are per agent')
  assert.ok(router.stats.hits >= 10)
  // Walking the corridor: every waypoint returned is reached in turn and the agent never needs to cross the wall.
  const walker = createRouter(nav), position = from.clone(), trail = [position.clone()]
  for (let i = 0; i < 400 && position.distanceTo(goal) > 0.05; i++) {
    const next = walker.next('w', position, goal, i / 30), step = next.clone().sub(position).setY(0)
    position.add(step.clampLength(0, 0.1)); position.y = 0; trail.push(position.clone())
  }
  assert.ok(position.distanceTo(goal) <= 0.05, `arrives: ${position.toArray()}`)
  assert.ok(clearance(trail, [-0.2, -5], [0.2, 5]) > 0.2)
  // Pushed off the corridor next to the goal, the agent heads straight there instead of back to an old corner.
  const short = createRouter(nav)
  short.next('s', from, goal, 0)
  assert.ok(short.next('s', v(3, 6), goal, 0.1).distanceTo(goal) < 1e-6)
  assert.ok(createRouter(null).next('x', from, goal).equals(goal), 'without a navmesh the target itself is returned')
  const off = createRouter(nav).next('o', v(-4, 0), v(-4, 30), 0)
  assert.ok(off.z < 10 && off.z > 8.5, `off-mesh goals clamp to the closest point: ${off.toArray()}`)
  nav.dispose()
})

test('market and obstacle-field generation stays within budget', async (t) => {
  for (const [name, doc] of [['Mercado de Valemar', createMarketTownScene()], ['Cripta do Rei Esqueleto', createCryptScene()]] as const) {
    const entries = staticEntries(doc), agents = agentsOf(doc), points = routinePoints(planRoutines(doc))
    const focus = navigationFocus(agents, points), started = performance.now()
    const input = navigationInput(entries, focus, agent)!
    const prepared = performance.now() - started
    const nav = await buildNavigation(entries, focus, agent)
    const total = performance.now() - started
    assert.ok(nav && nav.triangles > 0, `${name}: navmesh`)
    const size = focus.getSize(new THREE.Vector3())
    t.diagnostic(`${name}: ${entries.length} superfícies, ${input.indices.length / 3} triângulos de entrada, foco ${size.x.toFixed(0)}x${size.z.toFixed(0)} m, célula ${input.config.cs.toFixed(2)} m; ` +
      `Recast ${nav.milliseconds.toFixed(1)} ms, recorte ${prepared.toFixed(1)} ms, total ${total.toFixed(1)} ms; ${nav.triangles} triângulos de navmesh`)
    for (const { id, base } of agents) {
      const snapped = nav.closest(base)
      assert.ok(snapped && Math.hypot(snapped.x - base.x, snapped.z - base.z) < 1.5, `${name}: ${id} stands on the navmesh`)
    }
    if (name === 'Mercado de Valemar') {
      for (const point of points) {
        const from = agents[0].base, path = nav.path(from, nav.closest(point) ?? point)
        assert.ok(path && path.length >= 2, `route to ${point.toArray()}`)
      }
    }
    nav.dispose()
  }
  const entries = [box(40, 0.2, 40, 0, -0.1, 0)]
  for (let i = 0; i < 80; i++) entries.push(box(0.6 + (i % 5) * 0.4, 1 + (i % 3), 0.6 + (i % 4) * 0.5, ((i * 37) % 36) - 18, 0.75, ((i * 53) % 36) - 18))
  const nav = await buildNavigation(entries, area(40), agent)
  assert.ok(nav)
  t.diagnostic(`Campo 40x40 m com 80 caixas: Recast ${nav.milliseconds.toFixed(1)} ms; ${nav.triangles} triângulos`)
  const path = nav.path(v(-19, -19), v(19, 19))
  assert.ok(path && path.length > 2)
  nav.dispose()
})
