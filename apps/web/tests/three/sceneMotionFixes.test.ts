import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { buildAvatar } from '../../src/three/sceneCharacters.ts'
import { bindParts } from '../../src/three/sceneCharacterRig.ts'
import { animatorForBinding, applyAnimatorPose, createAnimator, updateAnimator } from '../../src/three/sceneCharacterAnimator.ts'
import { aimEquipment, bindEmitter, createEquipment, mountEquipment, poseFirstPersonEquipment } from '../../src/three/sceneEquipment.ts'
import { fireWeapon, meleePlayerContact, sweptMeleeTargets, type WeaponKind } from '../../src/three/sceneCombat.ts'
import { boxFromMatrix, buildStaticCollider, emptyInput, movementHeading, stepPlayer, type PlayerState } from '../../src/three/scenePlayer.ts'

const box = (x: number, y: number, z: number, w: number, h: number, d: number) => boxFromMatrix(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(w, h, d)))
const state = (): PlayerState => ({ position: new THREE.Vector3(0, 0, 0.48), velocity: new THREE.Vector3(), yaw: 0, pitch: 0, onGround: true, fly: false })

test('backward and diagonal movement turn the body along actual velocity while keeping camera yaw', () => {
  const player = state(), collider = { bvh: null, boxes: [], floor: 0 }
  let heading = Math.PI
  for (let i = 0; i < 90; i++) {
    stepPlayer(player, { ...emptyInput(), back: true, right: true }, collider, { speed: 4, jumpHeight: 1 }, 1 / 60)
    heading = movementHeading(heading, player.velocity, 1 / 60)
  }
  assert.equal(player.yaw, 0)
  assert.ok(Math.abs(heading - Math.PI / 4) < 0.001)
  assert.equal(movementHeading(heading, new THREE.Vector3(), 0.1), heading)
  assert.ok(Math.abs(movementHeading(Math.PI - 0.01, new THREE.Vector3(-0.01, 0, -1), 1 / 60) - (Math.PI - 0.01)) < 0.01, 'turns across the angle boundary by the short path')
})

for (const dynamic of [false, true]) for (const yaw of [0, Math.PI / 2]) test(`ladder exits onto ${dynamic ? 'moving box' : 'static BVH'} landing, yaw ${yaw}`, () => {
  const rotation = new THREE.Matrix4().makeRotationY(yaw), geometry = new THREE.BoxGeometry(4, 0.3, 3)
  const matrix = new THREE.Matrix4().multiplyMatrices(rotation, new THREE.Matrix4().makeTranslation(0, 2.85, -1.5))
  const bvh = dynamic ? null : buildStaticCollider([{ geometry, matrix }]).bvh
  const collider = { bvh, boxes: dynamic ? [boxFromMatrix(matrix.clone().scale(new THREE.Vector3(4, 0.3, 3)))] : [], floor: 0,
    climb: [boxFromMatrix(new THREE.Matrix4().multiplyMatrices(rotation, new THREE.Matrix4().compose(new THREE.Vector3(0, 1.5, 0), new THREE.Quaternion(), new THREE.Vector3(0.7, 3, 0.15))))] }
  const player = state(); player.position.applyMatrix4(rotation); player.yaw = yaw
  let climbed = false, exited = false
  for (let i = 0; i < 130; i++) {
    stepPlayer(player, { ...emptyInput(), forward: true }, collider, { speed: 2, jumpHeight: 1 }, 1 / 60)
    climbed ||= !!player.climbing
    if (climbed && !player.climbing && player.onGround && player.position.y >= 3) { exited = true; break }
  }
  assert.ok(exited, `stuck at ${player.position.toArray()}`)
  assert.ok(player.position.y < 3.1)
  bvh?.geometry.dispose(); geometry.dispose()
})

test('ladder exit respects a low ceiling', () => {
  const collider = { bvh: null, boxes: [box(0, 2.85, -1.5, 4, 0.3, 3), box(0, 4.1, -1.5, 4, 0.15, 3)], floor: 0, climb: [box(0, 1.5, 0, 0.7, 3, 0.15)] }
  const player = state()
  for (let i = 0; i < 120; i++) stepPlayer(player, { ...emptyInput(), forward: true }, collider, { speed: 2, jumpHeight: 1 }, 1 / 60)
  assert.ok(player.position.z > 0.25, 'cannot enter the landing without headroom')
})

test('melee requires a swept blade contact, catches thin targets and cannot cross a wall', () => {
  const blade = (x: number) => new THREE.Line3(new THREE.Vector3(x, 1, 0.1), new THREE.Vector3(x, 1, 1.1))
  const targets = [{ id: 'thin', box: box(0, 1, 0.8, 0.025, 0.4, 0.1) }, { id: 'ghost', box: box(0, 1, 2.5, 0.4, 1, 0.4) }, { id: 'side', box: box(1.5, 1, 0.8, 0.2, 0.5, 0.2) }]
  assert.deepEqual(sweptMeleeTargets(blade(-0.5), blade(0.5), 0.035, targets), ['thin'])
  assert.deepEqual(sweptMeleeTargets(blade(-10), blade(10), 0.035, targets), [], 'teleports do not sweep damage across the level')
  assert.deepEqual(sweptMeleeTargets(blade(-0.5), blade(0.5), 0.035, targets, { bvh: null, boxes: [box(0, 1, 0.4, 4, 3, 0.1)], floor: 0 }, new THREE.Vector3(0, 1, 0)), [])
})

test('enemy melee needs contact with the player and cannot damage across a wall', () => {
  const feet = new THREE.Vector3(), source = new THREE.Vector3(0, 1, 1), empty = { bvh: null, boxes: [], floor: 0 }
  assert.equal(meleePlayerContact(feet, [box(0, 1, 1.2, 0.1, 0.1, 0.4)], source, empty), false)
  const blade = box(0, 1, 0.25, 0.1, 0.1, 0.4)
  assert.equal(meleePlayerContact(feet, [blade], source, empty), true)
  assert.equal(meleePlayerContact(feet, [blade], source, { ...empty, boxes: [box(0, 1, 0.5, 3, 3, 0.1)] }), false)
})

test('first person fists and sword contact nearby bodies during all three strikes', () => {
  for (const weapon of ['none', 'sword'] as const) {
    const equipment = createEquipment(weapon), a = createAnimator('biped', 0), camera = new THREE.Group(), hitCombos = new Set<number>()
    camera.position.y = 1.62; camera.add(equipment.object)
    let previous = equipment.segment()
    for (let i = 0; i < 130; i++) {
      updateAnimator(a, { dt: 1 / 60, time: i / 60, speed: 0, grounded: true, verticalSpeed: 0, dead: false, talk: false, attack: i % 40 === 0 ? 'light' : null })
      poseFirstPersonEquipment(equipment, a)
      const current = equipment.segment(), sw = a.swing
      if (sw && a.time >= sw.a && a.time - 1 / 60 <= sw.a + sw.s) {
        const hits = sweptMeleeTargets(previous, current, equipment.radius, [{ id: 'near', box: box(0, 1.3, weapon === 'none' ? -0.9 : -1.2, 0.6, 1.2, 0.3) }, { id: 'far', box: box(0, 1.3, -3, 0.6, 1.2, 0.3) }])
        assert.ok(!hits.includes('far'))
        if (hits.includes('near')) hitCombos.add(a.combo)
      }
      previous = current
    }
    assert.deepEqual([...hitCombos], [1, 2, 3], weapon)
    equipment.dispose()
  }
})

test('all player weapons attach to an animated hand and shots start at the visible muzzle', () => {
  for (const avatar of ['explorer', 'knight', 'wizard', 'robot'] as const) for (const weapon of ['none', 'sword', 'blaster', 'bow', 'staff'] as WeaponKind[]) {
    const parts = buildAvatar(avatar), holders = new Map<string, THREE.Object3D>(), root = new THREE.Group()
    for (const part of parts) { const holder = new THREE.Group(); holder.position.fromArray(part.position); holders.set(part.id, holder) }
    for (const part of parts) (part.parentId ? holders.get(part.parentId)! : root).add(holders.get(part.id)!)
    const binding = bindParts('avatar', 'biped', parts), a = animatorForBinding(binding), equipment = createEquipment(weapon)
    assert.ok(mountEquipment(equipment, binding, holders))
    const before = equipment.origin()
    for (let i = 0; i < 10; i++) {
      const pose = updateAnimator(a, { dt: 1 / 60, time: i / 60, speed: 0, grounded: true, verticalSpeed: 0, dead: false, talk: false, attack: i === 0 ? 'light' : null, ranged: ['blaster', 'bow', 'staff'].includes(weapon) })
      applyAnimatorPose(binding, holders, pose)
    }
    assert.ok(equipment.origin().distanceTo(before) > 0.05, `${avatar}/${weapon}: follows the arm`)
    const target = new THREE.Vector3(2, 1, 10)
    aimEquipment(equipment, target)
    const origin = equipment.origin(), direction = new THREE.Vector3(0, 0, 1).applyQuaternion(equipment.object.getWorldQuaternion(new THREE.Quaternion()))
    assert.ok(direction.dot(target.clone().sub(equipment.object.getWorldPosition(new THREE.Vector3())).normalize()) > 0.999)
    const shot = fireWeapon(weapon, origin, direction)
    if (shot) assert.ok(shot.position.equals(origin))
    assert.ok(root.children.length > 0 && equipment.object.children.length > 0)
    equipment.dispose(); assert.equal(equipment.object.parent, null)
  }
})

test('authored magic and natural emitters retain their actual origin under parent transforms', () => {
  const head = new THREE.Group(); head.position.set(2, 4, -1); head.rotation.y = 0.7; head.scale.setScalar(2)
  const offset = new THREE.Vector3(0, 0, 0.3), emitter = bindEmitter(head, offset)
  assert.ok(emitter.origin().distanceTo(head.localToWorld(offset.clone())) < 1e-8)
  emitter.dispose(); assert.equal(head.children.length, 0)
})

test('third person sword combos make physical contact with a nearby body and miss a distant body', () => {
  const parts = buildAvatar('knight'), holders = new Map<string, THREE.Object3D>(), root = new THREE.Group()
  for (const part of parts) {
    const holder = new THREE.Group(); holder.position.fromArray(part.position)
    holder.rotation.set(...(part.rotation ?? [0, 0, 0]).map(THREE.MathUtils.degToRad) as [number, number, number]); holders.set(part.id, holder)
  }
  for (const part of parts) (part.parentId ? holders.get(part.parentId)! : root).add(holders.get(part.id)!)
  const binding = bindParts('avatar', 'biped', parts), a = animatorForBinding(binding), equipment = createEquipment('sword'), counts = new Map<number, Set<string>>()
  mountEquipment(equipment, binding, holders)
  let previous = equipment.segment()
  for (let i = 0; i < 150; i++) {
    const pose = updateAnimator(a, { dt: 1 / 60, time: i / 60, speed: 0, grounded: true, verticalSpeed: 0, dead: false, talk: false, attack: i % 40 === 0 ? 'light' : null })
    applyAnimatorPose(binding, holders, pose)
    const current = equipment.segment(), sw = a.swing
    if (sw && a.time >= sw.a && a.time - 1 / 60 <= sw.a + sw.s) {
      const hit = sweptMeleeTargets(previous, current, equipment.radius, [{ id: 'near', box: box(0, 1, 1.2, 0.6, 1.7, 0.5) }, { id: 'far', box: box(0, 1, 3, 0.6, 1.7, 0.5) }])
      const targets = counts.get(a.combo) ?? new Set<string>(); hit.forEach((id) => targets.add(id)); counts.set(a.combo, targets)
    }
    previous = current
  }
  for (const combo of [1, 2, 3]) {
    assert.ok(counts.get(combo)?.has('near'), `combo ${combo} reaches the nearby body`)
    assert.ok(!counts.get(combo)?.has('far'))
  }
  equipment.dispose()
})
