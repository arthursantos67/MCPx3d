import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { createNode } from '../../src/three/sceneDocument.ts'
import { expandSceneRecipe } from '../../src/three/sceneGeneration.ts'
import type { CharacterType, RigKind } from '../../src/three/sceneCharacters.ts'
import { bindRigs } from '../../src/three/sceneCharacterRig.ts'
import { animatorForBinding, applyAnimatorPose, createAnimator, updateAnimator, type Animator, type AnimatorInput, type AnimatorPose } from '../../src/three/sceneCharacterAnimator.ts'

const kinds: RigKind[] = ['biped', 'quadruped', 'arachnid', 'flyer', 'hover']
let DT = 1 / 60
const base = (time: number): AnimatorInput => ({ dt: DT, time, speed: 0, grounded: true, verticalSpeed: 0, dead: false, talk: false })
const angle = (a: number, b: number) => Math.abs(a - b - 360 * Math.round((a - b) / 360))
function run(a: Animator, frames: number, make: (i: number, time: number) => Partial<AnimatorInput>, start = 0) {
  const poses: AnimatorPose[] = []
  for (let i = 0; i < frames; i++) { const time = start + i * DT; poses.push(updateAnimator(a, { ...base(time), ...make(i, time) })) }
  return poses
}
function jump(prev: AnimatorPose, next: AnimatorPose) {
  let max = 0
  for (const [joint, v] of next.joints) { const p = prev.joints.get(joint)!; for (let i = 0; i < 3; i++) max = Math.max(max, angle(v[i], p[i])) }
  return max
}
function check(pose: AnimatorPose) {
  for (const [joint, v] of pose.joints) assert.ok(v.every((x) => Number.isFinite(x) && Math.abs(x) <= 180), `${joint}: ${v}`)
  for (const x of [pose.bob, pose.collapse, pose.seat, pose.footIK, pose.look, pose.face.blink, pose.face.jaw, pose.face.brow, pose.face.smile, ...pose.face.gaze]) assert.ok(Number.isFinite(x))
  assert.ok(Math.abs(pose.bob) <= 1.2 && pose.collapse >= 0 && pose.collapse <= 1 && pose.face.blink >= 0 && pose.face.blink <= 1 && pose.face.jaw >= 0 && pose.face.jaw <= 1)
}
/** Random-ish but deterministic input script that exercises every trigger, activity and speed change. */
const script = (i: number, time: number): Partial<AnimatorInput> => {
  const k = Math.floor(time * 2) % 17
  return { speed: [0, 0.8, 1.6, 3.5, 6, 0, 2][k % 7], grounded: k !== 5 && k !== 6, verticalSpeed: k === 5 ? 4 : k === 6 ? -6 : 0, talk: k === 8,
    attack: i % 23 === 0 ? (k % 2 ? 'light' : 'heavy') : null, dodge: i % 97 === 0, hurt: i % 61 === 0, interact: i % 131 === 0, wave: i % 151 === 0, crouch: k === 9,
    activity: (['sit', 'work', 'sleep', 'chat', 'perform', 'guard', null] as const)[Math.floor(time / 3) % 7], mood: (['calm', 'happy', 'angry', 'afraid'] as const)[k % 4] }
}

test('poses stay finite, bounded and continuous for any input, including garbage', () => {
  for (const kind of kinds) for (const seed of [0, 7, 991]) {
    const a = createAnimator(kind, seed * 0.137, seed), poses = run(a, 60 * 40, script)
    poses.forEach(check)
    for (let i = 1; i < poses.length; i++) assert.ok(jump(poses[i - 1], poses[i]) < 45, `${kind}/${seed} frame ${i} (${poses[i - 1].state}→${poses[i].state}) jumps ${jump(poses[i - 1], poses[i])}`)
  }
  DT = 1 / 240
  for (const kind of kinds) {
    const fine = run(createAnimator(kind, 0.4, 3), 240 * 20, script)
    for (let i = 1; i < fine.length; i++) assert.ok(Math.abs(fine[i].bob - fine[i - 1].bob) < 0.025 && Math.abs(fine[i].seat - fine[i - 1].seat) < 0.05 && Math.abs(fine[i].collapse - fine[i - 1].collapse) < 0.05, `${kind} root jumps at ${i}`)
    for (let i = 1; i < fine.length; i++) assert.ok(jump(fine[i - 1], fine[i]) < 14, `${kind} at 240 Hz frame ${i} (${fine[i - 1].state}→${fine[i].state}) jumps ${jump(fine[i - 1], fine[i])}: not continuous`)
  }
  DT = 1 / 60
  const a = createAnimator('biped', 0.3, 1)
  for (const bad of [Number.NaN, Infinity, -5, 1e9]) check(updateAnimator(a, { dt: bad, time: bad, speed: bad, grounded: true, verticalSpeed: bad, dead: false, talk: true, attack: 'light' }))
})

test('the blend tree is deterministic and walks with a continuous stride across speed changes', () => {
  const a = createAnimator('biped', 0.2, 5), b = createAnimator('biped', 0.2, 5)
  assert.deepEqual(run(a, 600, script), run(b, 600, script))
  DT = 1 / 240
  const fine = run(createAnimator('biped', 0.2, 5), 1440, (_, t) => ({ speed: Math.min(6, t * 2) }))
  for (let i = 1; i < fine.length; i++) assert.ok(jump(fine[i - 1], fine[i]) < 5, `speed ramp jumps ${jump(fine[i - 1], fine[i])} at ${i}`)
  DT = 1 / 60
  const c = createAnimator('biped', 0.2, 5), ramp = run(c, 360, (_, t) => ({ speed: Math.min(6, t * 2) }))
  const steps = ramp.flatMap((pose) => pose.events.filter((e) => e === 'footL' || e === 'footR'))
  assert.ok(steps.length > 10 && steps.every((e, i) => i === 0 || e !== steps[i - 1]), 'footsteps alternate')
  const idle = createAnimator('biped', 0.2, 5), still = run(idle, 120, () => ({}))
  assert.ok(still.every((pose) => !pose.events.length || pose.events.every((e) => !e.startsWith('foot'))), 'no steps while standing')
  const hip = (pose: AnimatorPose) => pose.joints.get('j_hipL')![0]
  assert.ok(Math.max(...ramp.slice(200).map(hip)) - Math.min(...ramp.slice(200).map(hip)) > 40, 'running swings the legs')
})

test('jump has an impulse, rises and falls distinctly, and lands with compression proportional to the fall', () => {
  const landing = (fall: number) => {
    const a = createAnimator('biped', 0, 3)
    run(a, 30, () => ({}))
    const air = run(a, 60, (i) => ({ grounded: false, verticalSpeed: 5 - i * (5 + fall) / 60 }), 0.5)
    assert.equal(air[0].state, 'jump'); assert.ok(air[0].events.includes('jump'))
    assert.ok(air[1].bob < 0, 'push-off crouch')
    assert.equal(air.at(-1)!.state, 'fall')
    assert.ok(air[20].joints.get('j_kneeL')![0] > air.at(-1)!.joints.get('j_kneeL')![0], 'tucked rising, legs reach down falling')
    const land = run(a, 40, () => ({}), 1.5)
    assert.equal(land[0].state, 'land'); assert.ok(land[0].events.includes('land'))
    assert.equal(land.at(-1)!.state, 'locomotion')
    return Math.min(...land.map((pose) => pose.bob))
  }
  const soft = landing(3), hard = landing(12)
  assert.ok(hard < soft - 0.03 && hard < -0.1, `compression ${soft} vs ${hard}`)
  const a = createAnimator('biped', 0, 3)
  const step = run(a, 6, () => ({ grounded: false, verticalSpeed: -0.5 }))
  assert.ok(step.every((pose) => pose.state === 'locomotion'), 'a brief ungrounded step is not a fall')
})

test('attack combos chain only inside the window and expose the combo index', () => {
  const a = createAnimator('biped', 0, 2)
  run(a, 10, () => ({}))
  const first = updateAnimator(a, { ...base(1), attack: 'light' })
  assert.equal(first.state, 'attack'); assert.equal(first.combo, 1)
  const early = run(a, 5, (i) => ({ attack: i === 3 ? 'light' : null }), 1)
  assert.ok(early.every((pose) => pose.combo === 1), 'pressing during the windup does not chain')
  const swing = run(a, 14, () => ({}), 1.2)
  assert.ok(swing.some((pose) => pose.events.includes('swing')) && swing.some((pose) => pose.events.includes('impact')))
  const second = updateAnimator(a, { ...base(1.5), attack: 'light' })
  assert.equal(second.combo, 2)
  run(a, 16, () => ({}), 1.6)
  assert.equal(updateAnimator(a, { ...base(2), attack: 'light' }).combo, 3)
  const after = run(a, 120, () => ({}), 2.1)
  assert.equal(after.at(-1)!.state, 'locomotion')
  assert.equal(updateAnimator(a, { ...base(4), attack: 'heavy' }).combo, 1, 'a late press starts a new combo')
  const heavy = run(a, 60, () => ({}), 4)
  const shoulder = heavy.map((pose) => pose.joints.get('j_shoulderR')![0])
  assert.ok(Math.min(...shoulder.slice(0, 26)) < -140, 'heavy raises the weapon overhead')
  assert.ok(heavy.findIndex((pose) => pose.events.includes('swing')) >= 24, 'heavy has a long anticipation')
  for (const kind of ['quadruped', 'arachnid', 'flyer', 'hover'] as const) {
    const c = createAnimator(kind, 0, 1)
    run(c, 5, () => ({}))
    const idle = updateAnimator(c, base(0.1))
    const poses = [updateAnimator(c, { ...base(0.12), attack: 'light' }), ...run(c, 20, () => ({}), 0.13)]
    assert.ok(poses.some((pose) => jump(idle, pose) > 15), `${kind} attacks visibly`)
  }
})

test('hurt is additive, death is terminal and dodges, interactions and waves play out', () => {
  const a = createAnimator('biped', 0, 4), b = createAnimator('biped', 0, 4)
  for (const x of [a, b]) { run(x, 10, () => ({})); updateAnimator(x, { ...base(0.2), attack: 'heavy' }) }
  const plain = run(a, 8, () => ({}), 0.3), hit = run(b, 8, (i) => ({ hurt: i === 0 }), 0.3)
  assert.ok(hit.every((pose) => pose.state === 'attack' && pose.combo === 1), 'hurt does not interrupt the attack')
  assert.ok(hit[0].events.includes('hurt'))
  assert.ok(hit[6].joints.get('j_spine')![0] < plain[6].joints.get('j_spine')![0] - 8, 'recoil adds on top of the swing')
  const loco = createAnimator('biped', 0, 4)
  run(loco, 10, () => ({}))
  assert.equal(run(loco, 6, (i) => ({ hurt: i === 0 }))[5].state, 'hurt')

  const d = createAnimator('biped', 0, 8), dying = run(d, 120, (i) => ({ dead: i >= 5 }))
  assert.equal(dying[5].state, 'death'); assert.ok(dying[5].events.includes('death'))
  assert.ok(dying.some((pose) => pose.events.includes('bodyfall')))
  const collapse = dying.slice(5).map((pose) => pose.collapse)
  assert.ok(collapse.every((v, i) => i === 0 || v >= collapse[i - 1] - 1e-9) && collapse.at(-1)! > 0.99, 'collapse goes 0 → 1')
  const revived = run(d, 60, () => ({ dead: false, attack: 'light', speed: 3, dodge: true }), 3)
  assert.ok(revived.every((pose) => pose.state === 'death' && pose.collapse > 0.99), 'death never returns')
  assert.ok(revived.at(-1)!.face.blink > 0.9, 'eyes close')

  const r = createAnimator('biped', 0, 9)
  run(r, 30, () => ({ speed: 3 }))
  const roll = run(r, 45, (i) => ({ speed: 3, dodge: i === 0 }), 0.5)
  assert.equal(roll[0].state, 'dodge'); assert.ok(roll[0].events.includes('dodge'))
  assert.ok(Math.min(...roll.map((pose) => pose.bob)) < -0.3, 'the roll lowers the body')
  assert.ok(roll.some((pose) => Math.abs(pose.joints.get('j_hips')![0]) > 150), 'the roll turns over')
  assert.equal(roll.at(-1)!.state, 'locomotion')
  const s = createAnimator('biped', 0, 9)
  const side = run(s, 30, (i) => ({ dodge: i === 0 }))
  assert.ok(side.some((pose) => Math.abs(pose.joints.get('j_hips')![2]) > 10) && side.every((pose) => Math.abs(pose.joints.get('j_hips')![0]) < 30), 'standing dodge is a side step')

  const h = createAnimator('biped', 0, 9), reach = run(h, 60, (i) => ({ interact: i === 0 }))
  assert.equal(reach[0].state, 'interact'); assert.ok(reach.some((pose) => pose.events.includes('interact')))
  assert.ok(Math.min(...reach.map((pose) => pose.joints.get('j_shoulderR')![0])) < -55, 'reaches out')
  const w = createAnimator('biped', 0, 9), waving = run(w, 100, (i) => ({ wave: i === 0 }))
  assert.ok(waving[0].events.includes('wave') && Math.max(...waving.map((pose) => pose.joints.get('j_shoulderL')![2])) > 80, 'raises the hand to wave')
})

test('talk moves the jaw in syllables and gestures; activities loop with their own postures', () => {
  const a = createAnimator('biped', 0.1, 12), talk = run(a, 600, () => ({ talk: true }))
  assert.equal(talk.at(-1)!.state, 'talk')
  const jaw = talk.map((pose) => pose.face.jaw)
  assert.ok(Math.max(...jaw) > 0.4 && jaw.filter((v) => v < 0.05).length > 30, 'jaw opens and closes')
  const elbows = talk.map((pose) => pose.joints.get('j_elbowR')![0])
  assert.ok(Math.max(...elbows) - Math.min(...elbows) > 30, 'arms gesture')
  const activity = (name: 'sit' | 'work' | 'sleep' | 'chat' | 'perform' | 'guard', seed = 1) => {
    const b = createAnimator('biped', 0.1, seed)
    return run(b, 600, () => ({ activity: name }))
  }
  const sit = activity('sit').at(-1)!
  assert.equal(sit.state, 'activity'); assert.equal(sit.seat, 1); assert.ok(sit.footIK < 0.05)
  assert.ok(sit.joints.get('j_hipL')![0] < -80 && sit.joints.get('j_kneeL')![0] > 80, 'thighs level, knees at about 90°')
  const work = activity('work')
  assert.ok(new Set(work.map((pose) => Math.round(pose.joints.get('j_shoulderR')![0] / 10))).size > 3, 'work loops')
  const sleeps = [1, 2, 3, 4, 5, 6].map((seed) => activity('sleep', seed).at(-1)!)
  assert.ok(sleeps.every((pose) => pose.face.blink > 0.95 && (pose.collapse > 0.9 || pose.seat > 0.9)), 'asleep: eyes shut, lying or slumped')
  const guard = activity('guard').map((pose) => pose.joints.get('j_head')![1])
  assert.ok(Math.max(...guard) > 20 && Math.min(...guard) < -20, 'guards scan around')
  for (const name of ['chat', 'perform'] as const) assert.ok(activity(name).every((pose) => pose.state === 'activity' || pose.state === 'locomotion'))
  const walkAway = createAnimator('biped', 0, 1)
  run(walkAway, 120, () => ({ activity: 'sit' }))
  const up = run(walkAway, 60, () => ({ activity: 'sit', speed: 2 }), 2)
  assert.equal(up.at(-1)!.state, 'locomotion'); assert.ok(up.at(-1)!.seat < 0.05, 'moving stands up')
})

test('blinks and idles are natural, seeded and not synchronised across a crowd', () => {
  const blinks = (seed: number) => {
    const a = createAnimator('biped', 0, seed), times: number[] = []
    run(a, 60 * 60, () => ({})).forEach((pose, i, all) => { if (pose.face.blink > 0.5 && (i === 0 || all[i - 1].face.blink <= 0.5)) times.push(i * DT) })
    return times
  }
  const one = blinks(1)
  assert.deepEqual(one, blinks(1))
  assert.ok(one.length >= 8 && one.length <= 40, `${one.length} blinks per minute`)
  const gaps = one.slice(1).map((t, i) => t - one[i])
  assert.ok(gaps.some((g) => g < 0.5), 'occasional double blink')
  assert.ok(new Set(gaps.map((g) => Math.round(g * 10))).size > 5, 'irregular intervals')
  assert.notDeepEqual(one, blinks(2))
  const head = (seed: number) => run(createAnimator('biped', seed * 0.31, seed), 60 * 30, () => ({})).map((pose) => pose.joints.get('j_head')![1])
  const [h1, h2] = [head(1), head(2)]
  assert.ok(h1.some((v, i) => Math.abs(v - h2[i]) > 5), 'crowds fidget differently')
  const arms = run(createAnimator('biped', 0, 3), 60 * 40, () => ({})).map((pose) => pose.joints.get('j_shoulderR')![0])
  assert.ok(Math.min(...arms) < -40, 'idles include arm fidgets')
})

test('applyAnimatorPose writes rest + delta, root bob, seat and collapse on real characters', () => {
  const single = { mode: 'linear', count: 1, offset: [0, 0, 0], radius: 0, axis: 'y', columns: 1, jitter: 0, seed: 1, onto: null }
  const box = createNode('box')
  for (const type of ['villager', 'golem', 'wolf', 'spider', 'dragon', 'drone'] as CharacterType[]) {
    const doc = expandSceneRecipe({ name: type, background: '#112233', exposure: 1, lightIntensity: 1, duration: 12, nodes: [{ id: type, parentId: null, name: type, kind: 'group', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], dimensions: [1, 1, 1],
      color: box.material.color, metalness: 0, roughness: 0.5, animation: box.animation, repeat: single, overlapWith: [], prefab: { type, size: 1, seed: 2, primary: null, secondary: null, text: '', lit: false, interactive: true } }] })
    const before = structuredClone(doc), [binding] = bindRigs(doc), holders = new Map(doc.nodes.map((node) => [node.id, new THREE.Object3D()]))
    const animator = animatorForBinding(binding), root = binding.joints.find((joint) => joint.joint === (binding.kind === 'biped' ? 'j_hips' : 'j_body'))!
    let pose = updateAnimator(animator, base(0))
    applyAnimatorPose(binding, holders, pose)
    const rootHolder = holders.get(root.nodeId)!
    assert.ok(Math.abs(rootHolder.position.y - root.basePosition[1]) < 0.06, `${type} rests at its height`)
    for (const joint of binding.joints) { const delta = pose.joints.get(joint.joint); if (delta) assert.ok(Math.abs(holders.get(joint.nodeId)!.rotation.x - THREE.MathUtils.degToRad(joint.base[0] + delta[0])) < 1e-9) }
    for (let i = 1; i < 120; i++) pose = updateAnimator(animator, { ...base(i * DT), dead: true })
    applyAnimatorPose(binding, holders, pose)
    assert.ok(rootHolder.position.y < root.basePosition[1] * 0.7, `${type} collapses`)
    assert.deepEqual(doc, before)
    if (type === 'villager') {
      const sitter = animatorForBinding(binding)
      for (let i = 0; i < 120; i++) pose = updateAnimator(sitter, { ...base(i * DT), activity: 'sit' })
      applyAnimatorPose(binding, holders, pose)
      assert.ok(Math.abs(rootHolder.position.y - 0.55) < 0.03, `pelvis on a 0.45 m seat: ${rootHolder.position.y}`)
    }
  }
})
