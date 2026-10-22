import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { createNode } from '../../src/three/sceneDocument.ts'
import { expandSceneRecipe } from '../../src/three/sceneGeneration.ts'
import type { CharacterType } from '../../src/three/sceneCharacters.ts'
import { bindRigs } from '../../src/three/sceneCharacterRig.ts'
import { createSprings, rigSpringChains } from '../../src/three/sceneSprings.ts'
import type { SpringChainSpec } from '../../src/three/sceneRuntimeTypes.ts'

/** A body with a two-bone tail pointing back and up, plus a tip marker under the last bone. */
function tail(spec: Partial<SpringChainSpec> = {}) {
  const body = new THREE.Group(), a = new THREE.Object3D(), b = new THREE.Object3D(), tip = new THREE.Object3D()
  a.position.set(0, 0.2, -0.5); a.rotation.x = -2; b.position.set(0, 0.5, 0); tip.position.set(0, 0.5, 0)
  body.add(a); a.add(b); b.add(tip)
  body.updateMatrixWorld(true)
  const chain: SpringChainSpec = { bones: [a, b], stiffness: 60, damping: 8, gravity: 0, limit: 0.6, ...spec }
  return { body, a, b, tip, chain, rest: [a.quaternion.clone(), b.quaternion.clone()] }
}
const tipPos = (t: ReturnType<typeof tail>) => { t.body.updateMatrixWorld(true); return t.tip.getWorldPosition(new THREE.Vector3()) }
const finite = (q: THREE.Quaternion) => Number.isFinite(q.x + q.y + q.z + q.w)

test('a still chain without forces stays at its animated pose; gravity sags it to a stable rest within the limit', () => {
  const still = tail(), springs = createSprings([still.chain])
  for (let i = 0; i < 300; i++) springs.step(1 / 60)
  assert.ok(still.a.quaternion.angleTo(still.rest[0]) < 1e-3 && still.b.quaternion.angleTo(still.rest[1]) < 1e-3)
  const heavy = tail({ gravity: 9.8, limit: 0.5 }), sag = createSprings([heavy.chain]), tips: THREE.Vector3[] = []
  for (let i = 0; i < 600; i++) { sag.step(1 / 60); tips.push(tipPos(heavy)) }
  assert.ok(tips.at(-1)!.y < tail().tip.getWorldPosition(new THREE.Vector3()).y - 0.05, 'gravity pulls the tip down')
  assert.ok(tips.at(-1)!.distanceTo(tips.at(-2)!) < 1e-4, 'converges to rest')
  assert.ok(heavy.a.quaternion.angleTo(heavy.rest[0]) <= 0.5 + 1e-3 && heavy.b.quaternion.angleTo(heavy.rest[1]) <= 0.5 + 0.05, 'angular limit holds')
  sag.reset()
  assert.ok(heavy.a.quaternion.angleTo(heavy.rest[0]) < 1e-6, 'reset returns to the animated pose')
})

test('moving bodies make the chain trail and swing back; limits hold for sudden moves', () => {
  const t = tail({ limit: 0.7 }), springs = createSprings([t.chain]), lag: number[] = []
  springs.step(1 / 60)
  for (let i = 0; i < 240; i++) {
    t.body.position.x = i < 60 ? i * 0.08 : 4.8
    springs.step(1 / 60)
    lag.push(t.a.quaternion.angleTo(t.rest[0]))
    assert.ok(lag.at(-1)! <= 0.7 + 1e-3 && finite(t.a.quaternion) && finite(t.b.quaternion))
  }
  assert.ok(Math.max(...lag.slice(10, 60)) > 0.1, 'trails while the body moves')
  assert.ok(lag.at(-1)! < 0.01, 'settles after the body stops')
  t.body.position.set(50, -20, 30)
  springs.step(1 / 60)
  assert.ok(t.a.quaternion.angleTo(t.rest[0]) <= 0.7 + 1e-3, 'teleports stay within the limit')
})

test('stable for any dt, stiffness and wind; animated bones keep their fresh pose as reference', () => {
  for (const stiffness of [5, 60, 800, 5000]) {
    const t = tail({ stiffness, damping: 2, gravity: 9.8, limit: 1.2, wind: 1 }), springs = createSprings([t.chain])
    for (let i = 0; i < 400; i++) {
      t.body.position.y = Math.sin(i * 0.7) * 0.5
      springs.step([1 / 240, 1 / 30, 0.5, 2, Number.NaN, -1, 0][i % 7], new THREE.Vector3(Math.sin(i), 0, 3))
      const p = tipPos(t)
      assert.ok(Number.isFinite(p.x + p.y + p.z) && p.distanceTo(t.body.position) <= 1.55, `stiffness ${stiffness}: ${p.toArray()}`)
    }
  }
  const windy = tail({ wind: 1 }), calm = tail({ wind: 1 }), w = createSprings([windy.chain]), c = createSprings([calm.chain])
  for (let i = 0; i < 300; i++) { w.step(1 / 60, new THREE.Vector3(6, 0, 0)); c.step(1 / 60) }
  assert.ok(tipPos(windy).x > tipPos(calm).x + 0.05, 'wind pushes the chain')
  const wag = tail(), springs = createSprings([wag.chain])
  for (let i = 0; i < 600; i++) { wag.a.rotation.set(-2, Math.sin(i / 60 * 3) * 0.4, 0); springs.step(1 / 60) }
  const animated = new THREE.Quaternion().setFromEuler(new THREE.Euler(-2, Math.sin(599 / 60 * 3) * 0.4, 0))
  assert.ok(wag.a.quaternion.angleTo(animated) < 0.35, 'springs add lag on top of the animation instead of accumulating')
  assert.equal(createSprings([]).count, 0)
})

const single = { mode: 'linear', count: 1, offset: [0, 0, 0], radius: 0, axis: 'y', columns: 1, jitter: 0, seed: 1, onto: null }
function rig(type: CharacterType, size = 1) {
  const box = createNode('box'), doc = expandSceneRecipe({ name: type, background: '#112233', exposure: 1, lightIntensity: 1, duration: 12, nodes: [{ id: type, parentId: null, name: type, kind: 'group', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], dimensions: [1, 1, 1],
    color: box.material.color, metalness: 0, roughness: 0.5, animation: box.animation, repeat: single, overlapWith: [], prefab: { type, size, seed: 2, primary: null, secondary: null, text: '', lit: false, interactive: true } }] })
  const holders = new Map<string, THREE.Object3D>(), world = new THREE.Group()
  for (const node of doc.nodes) { const o = new THREE.Object3D(); o.position.set(...node.position); o.rotation.set(...node.rotation.map(THREE.MathUtils.degToRad) as [number, number, number]); holders.set(node.id, o) }
  for (const node of doc.nodes) (node.parentId ? holders.get(node.parentId)! : world).add(holders.get(node.id)!)
  world.updateMatrixWorld(true)
  return { binding: bindRigs(doc)[0], holders, world }
}

test('rig chains cover tails of the wolf, deer and dragon and simulate on the real rig', () => {
  const chains = (type: CharacterType, size = 1) => { const r = rig(type, size); return { ...r, chains: rigSpringChains(r.binding, r.holders) } }
  assert.deepEqual(chains('wolf').chains.map((chain) => chain.bones.length), [1])
  assert.deepEqual(chains('deer').chains.map((chain) => chain.bones.length), [1])
  assert.deepEqual(chains('dragon').chains.map((chain) => chain.bones.length), [2])
  assert.equal(chains('villager').chains.length, 0)
  assert.ok(chains('wolf', 3).chains[0].stiffness < chains('wolf', 1).chains[0].stiffness, 'bigger tails are slower')
  const dragon = chains('dragon'), springs = createSprings(dragon.chains), root = dragon.holders.get(dragon.binding.rootId)!
  const rest = dragon.chains[0].bones.map((bone) => bone.quaternion.clone())
  for (let i = 0; i < 300; i++) { root.position.z = Math.min(i, 120) * 0.05; root.rotation.y = Math.sin(i / 40); springs.step(1 / 60) }
  dragon.chains[0].bones.forEach((bone, i) => { assert.ok(finite(bone.quaternion)); assert.ok(bone.quaternion.angleTo(rest[i]) <= dragon.chains[0].limit + 0.15) })
})
