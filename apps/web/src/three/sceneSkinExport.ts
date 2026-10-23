import * as THREE from 'three'
import type { BuiltScene } from './sceneBuild.ts'
import { animatorForBinding, applyAnimatorPose, updateAnimator } from './sceneCharacterAnimator.ts'
import { bindRigs } from './sceneCharacterRig.ts'
import type { ThreeSceneDocument } from './sceneDocument.ts'
import { poseSkinHands } from './sceneSkin.ts'
import { createSprings } from './sceneSprings.ts'

export function bakeSkinMaterial(mesh: THREE.SkinnedMesh): { geometry: THREE.BufferGeometry; materials: THREE.MeshPhysicalMaterial[] } {
  const geometry = mesh.geometry.clone(), sources = Array.isArray(mesh.material) ? mesh.material : [mesh.material], materials: THREE.MeshPhysicalMaterial[] = []
  const colors = new Float32Array(geometry.getAttribute('position').count * 3), original = geometry.getAttribute('color'), index = geometry.index!, groups = [...geometry.groups]
  const slots = ['slotA', 'slotB', 'slotC'].map((name) => geometry.getAttribute(name)), known = new Map<string, number>()
  const triangles = new Map<number, number[]>()
  const winner = (vertex: number) => {
    let best = 0, distance = Infinity
    for (let i = 0; i < 12; i++) { const d = slots[Math.floor(i / 4)].getComponent(vertex, i % 4); if (d < distance) { distance = d; best = i } }
    return best
  }
  geometry.clearGroups()
  for (const group of groups) {
    const source = sources[group.materialIndex ?? 0] as THREE.MeshPhysicalMaterial
    const uniforms = source.userData.skinSlots as { slotColor: { value: THREE.Vector4[] }; slotProps: { value: THREE.Vector4[] }; slotGlow: { value: THREE.Vector4[] } }
    for (let i = group.start; i < group.start + group.count; i += 3) {
      const vertices = [index.getX(i), index.getX(i + 1), index.getX(i + 2)], winners = vertices.map(winner)
      const slot = winners.find((value, j) => winners.indexOf(value) !== j) ?? winners[0], key = `${group.materialIndex}:${slot}`
      let material = known.get(key)
      if (material === undefined) {
        const props = uniforms.slotProps.value[slot], glow = uniforms.slotGlow.value[slot]
        material = materials.length; known.set(key, material)
        materials.push(new THREE.MeshPhysicalMaterial({ name: `${source.name} ${slot + 1}`, color: '#ffffff', vertexColors: true, roughness: props.x, metalness: props.y,
          sheen: props.z, sheenColor: new THREE.Color(...uniforms.slotColor.value[slot].toArray().slice(0, 3) as [number, number, number]), clearcoat: props.w, side: source.side, emissive: new THREE.Color(glow.x, glow.y, glow.z) }))
      }
      vertices.forEach((vertex, j) => {
        const color = uniforms.slotColor.value[winners[j]]
        for (let k = 0; k < 3; k++) colors[vertex * 3 + k] = color.getComponent(k) * (original?.getComponent(vertex, k) ?? 1)
      })
      const bucket = triangles.get(material) ?? []
      bucket.push(...vertices); triangles.set(material, bucket)
    }
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const indices: number[] = []
  for (const [material, bucket] of triangles) { geometry.addGroup(indices.length, bucket.length, material); indices.push(...bucket) }
  geometry.setIndex(indices)
  delete geometry.userData.components
  for (const name of ['slotA', 'slotB', 'slotC']) geometry.deleteAttribute(name)
  return { geometry, materials }
}

export function prepareSkinExport(built: BuiltScene): () => void {
  const owned: { dispose: () => void }[] = []
  for (const skin of built.skins.values()) {
    skin.meshes.forEach((mesh, i) => { mesh.visible = i === 0 })
    const mesh = skin.meshes[0], baked = bakeSkinMaterial(mesh)
    mesh.geometry = baked.geometry; mesh.material = baked.materials
    owned.push(baked.geometry, ...baked.materials)
  }
  return () => owned.forEach((resource) => resource.dispose())
}

export function characterExportClips(doc: ThreeSceneDocument, built: BuiltScene): THREE.AnimationClip[] {
  const bindings = bindRigs(doc)
  if (!bindings.length) return []
  const objects = new Set<THREE.Object3D>()
  for (const binding of bindings) {
    binding.joints.forEach((joint) => { const holder = built.holders.get(joint.nodeId); if (holder) objects.add(holder) })
    built.skins.get(binding.rootId)?.meshes[0].skeleton.bones.forEach((bone) => { if (bone.parent instanceof THREE.Bone) objects.add(bone) })
  }
  const rest = [...objects].map((object) => ({ object, position: object.position.clone(), quaternion: object.quaternion.clone() }))
  const restore = () => rest.forEach(({ object, position, quaternion }) => { object.position.copy(position); object.quaternion.copy(quaternion) })
  const clips: THREE.AnimationClip[] = []
  try {
    for (const speed of [0, 1.6]) {
      restore()
      const duration = speed ? 2 : 4, frames = Math.max(2, Math.min(duration * 30, Math.floor(240_000 / Math.max(1, objects.size * 2))))
      const agents = bindings.map((binding) => ({ binding, animator: animatorForBinding(binding), skin: built.skins.get(binding.rootId), springs: createSprings(built.skins.get(binding.rootId)?.springs ?? []) }))
      const samples = [...objects].map((object) => ({ object, positions: [] as number[], rotations: [] as number[] })), times: number[] = []
      for (let frame = 0; frame <= frames; frame++) {
        const time = frame * duration / frames, dt = frame ? duration / frames : 0
        for (const { binding, animator, skin, springs } of agents) {
          const pose = updateAnimator(animator, { dt, time, speed, grounded: true, verticalSpeed: 0, dead: false, talk: false })
          applyAnimatorPose(binding, built.holders, pose)
          if (skin) { skin.setFace(pose.face); poseSkinHands(skin, pose.state) }
          springs.step(dt)
        }
        times.push(time)
        samples.forEach(({ object, positions, rotations }) => { positions.push(...object.position.toArray()); rotations.push(...object.quaternion.toArray()) })
      }
      clips.push(new THREE.AnimationClip(speed ? 'Personagens · caminhada' : 'Personagens · ociosidade', duration, samples.flatMap(({ object, positions, rotations }) => [
        new THREE.VectorKeyframeTrack(`${object.uuid}.position`, times, positions), new THREE.QuaternionKeyframeTrack(`${object.uuid}.quaternion`, times, rotations),
      ])))
    }
  } finally { restore(); built.root.updateMatrixWorld(true) }
  return clips
}
