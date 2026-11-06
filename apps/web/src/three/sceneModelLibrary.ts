import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import type { CharacterSkin } from './sceneRuntimeTypes.ts'
import type { PrefabSpec } from './scenePrefabs.ts'
import type { ThreeSceneDocument } from './sceneDocument.ts'
import { characterModels } from './sceneCharacterModels.ts'
import { boxFromMatrix } from './scenePlayer.ts'

const BASE = `${(import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'}models/kaykit/`
export const modelLibrary = [
  { id: 'knight', name: 'Cavaleiro', category: 'Personagens', prefab: 'knight', height: 1.8 },
  { id: 'rogue', name: 'Viajante', category: 'Personagens', prefab: 'villager', height: 1.8 },
  { id: 'mage', name: 'Mago', category: 'Personagens', prefab: 'wizard', height: 1.8 },
  { id: 'barbarian', name: 'Bárbaro', category: 'Personagens', prefab: 'knight', height: 1.8 },
  { id: 'rogue_hooded', name: 'Viajante encapuzado', category: 'Personagens', prefab: 'villager', height: 1.8 },
  { id: 'skeleton_warrior', name: 'Esqueleto guerreiro', category: 'Personagens', prefab: 'skeleton', height: 1.8 },
  { id: 'skeleton_minion', name: 'Esqueleto servo', category: 'Personagens', prefab: 'skeleton', height: 1.8 },
  { id: 'skeleton_rogue', name: 'Esqueleto saqueador', category: 'Personagens', prefab: 'skeleton', height: 1.8 },
  { id: 'skeleton_mage', name: 'Esqueleto mago', category: 'Personagens', prefab: 'skeleton', height: 1.8 },
  { id: 'sword_1handed', name: 'Espada de uma mão', category: 'Equipamento', height: 1.05 },
  { id: 'axe_1handed', name: 'Machado de uma mão', category: 'Equipamento', height: 0.8 },
  { id: 'staff', name: 'Cajado', category: 'Equipamento', height: 1.7 },
  { id: 'hill_single_a', name: 'Colina gramada', category: 'Natureza', height: 6 },
  { id: 'rock_single_a', name: 'Rocha', category: 'Natureza', height: 1.5 },
  { id: 'tree_single_a', name: 'Árvore', category: 'Natureza', height: 5 },
  { id: 'dungeon_wall', name: 'Muralha da masmorra', category: 'Masmorras', height: 3 },
  { id: 'dungeon_wall_pillar', name: 'Muralha com pilar', category: 'Masmorras', height: 3 },
  { id: 'dungeon_floor_tile_large', name: 'Laje de pedra', category: 'Masmorras', height: 0.15 },
  { id: 'dungeon_barrel_large', name: 'Barril da masmorra', category: 'Masmorras', height: 1 },
  { id: 'dungeon_pillar', name: 'Pilar da masmorra', category: 'Masmorras', height: 3 },
  { id: 'dungeon_pillar_decorated', name: 'Pilar esculpido', category: 'Masmorras', height: 3 },
  { id: 'dungeon_chest', name: 'Baú da masmorra', category: 'Masmorras', height: 0.8 },
  { id: 'dungeon_torch', name: 'Tocha da masmorra', category: 'Masmorras', height: 1.6 },
] as const
export type LibraryModelId = typeof modelLibrary[number]['id']
export const modelUrl = (id: LibraryModelId) => `${BASE}${id}.glb`
const loaded = new Map<LibraryModelId, GLTF>(), pending = new Map<LibraryModelId, Promise<GLTF>>()

export function loadLibraryModel(id: LibraryModelId): Promise<GLTF> {
  if (loaded.has(id)) return Promise.resolve(loaded.get(id)!)
  if (pending.has(id)) return pending.get(id)!
  const request = fetch(modelUrl(id), { signal: AbortSignal.timeout(15_000) }).then(async response => {
    if (!response.ok) throw new Error(`Não foi possível carregar ${id} (${response.status}).`)
    return new GLTFLoader().parseAsync(await response.arrayBuffer(), '')
  }).then(model => { loaded.set(id, model); return model }).finally(() => pending.delete(id))
  pending.set(id, request)
  return request
}
export function characterModelId(spec: PrefabSpec, avatar?: string): LibraryModelId | null {
  // Explicitly authored palettes/archetypes keep their procedural/custom appearance.
  if (spec.character || spec.primary || spec.secondary || avatar === 'robot' || avatar === 'astronaut') return null
  if (!avatar && spec.model && characterModels[spec.model] === spec.type) return spec.model
  const type = avatar === 'explorer' ? 'villager' : avatar ?? spec.type
  return type === 'knight' ? 'knight' : type === 'wizard' ? 'mage' : type === 'villager' ? 'rogue' : type === 'skeleton' ? 'skeleton_warrior' : null
}
export async function prepareLibraryCharacters(scene: ThreeSceneDocument): Promise<void> {
  const ids = new Set(scene.nodes.flatMap(node => { const id = node.asset && characterModelId(node.asset); return id ? [id] : [] }))
  const avatar = scene.environment.player?.avatar ?? 'explorer'
  const id = characterModelId({} as PrefabSpec, avatar)
  if (id) ids.add(id)
  // Small equipment assets also cover weapons crafted or equipped later in the session.
  for (const weapon of ['sword_1handed', 'axe_1handed', 'staff'] as const) ids.add(weapon)
  // A failed local asset leaves the procedural character available; callers display the failure once.
  await Promise.all([...ids].map(loadLibraryModel))
}

/** Native rig, textures and authored animation clips; shared GPU assets, independent skeleton per actor. */
export function libraryCharacter(rootId: string, spec: PrefabSpec, holders: Map<string, THREE.Object3D>, parts: Map<string, string>, options: { avatar?: string; shadows: boolean; height: number }): CharacterSkin | null {
  const id = characterModelId(spec, options.avatar), source = id && loaded.get(id), root = holders.get(rootId)
  if (!source || !root) return null
  const character = clone(source.scene), object = new THREE.Group(), meshes: THREE.SkinnedMesh[] = []
  const bounds = new THREE.Box3().setFromObject(character), size = bounds.getSize(new THREE.Vector3()), scale = options.height / Math.max(0.01, size.y)
  character.position.set(-(bounds.min.x + bounds.max.x) / 2, -bounds.min.y, -(bounds.min.z + bounds.max.z) / 2)
  object.scale.setScalar(scale); object.name = `KayKit · ${id}`; object.userData.libraryModel = id
  object.add(character); root.add(object)
  character.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return
    if ((options.avatar || spec.type==='skeleton') && /sword|shield|dagger|staff|crossbow|quiver|axe|blade/i.test(child.name)) child.visible = false
    child.castShadow = options.shadows; child.receiveShadow = true; child.userData.skinRoot = rootId
    if (child instanceof THREE.SkinnedMesh) { child.computeBoundingSphere(); if (child.boundingSphere) child.boundingSphere.radius *= 1.7; meshes.push(child) }
  })
  const clips = source.animations.map(original => {
    const clip = original.clone()
    clip.name = `${rootId} · ${original.name}`
    for (const track of clip.tracks) {
      const binding = THREE.PropertyBinding.parseTrackName(track.name), target = THREE.PropertyBinding.findNode(character, binding.nodeName)
      if (target instanceof THREE.Object3D) track.name = `${target.uuid}.${binding.propertyName}${binding.propertyIndex === undefined ? '' : `[${binding.propertyIndex}]`}`
    }
    return clip
  })
  root.updateMatrixWorld(true)
  const mapping: Record<string, string> = { j_hips: 'hips', j_spine: 'spine', j_head: 'head', j_shoulderL: 'upperarml', j_shoulderR: 'upperarmr', j_elbowL: 'lowerarml', j_elbowR: 'lowerarmr', j_hipL: 'upperlegl', j_hipR: 'upperlegr', j_kneeL: 'lowerlegl', j_kneeR: 'lowerlegr' }
  const retarget = Object.entries(mapping).flatMap(([joint, name]) => {
    const from = holders.get(parts.get(joint) ?? ''), to = character.getObjectByName(name)
    if (!from || !to) return []
    const basis = to.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(from.getWorldQuaternion(new THREE.Quaternion()))
    return [{ from, to, base: to.quaternion.clone(), inverse: from.quaternion.clone().invert(), basis, inverseBasis: basis.clone().invert() }]
  })
  const mixer = new THREE.AnimationMixer(character), actions = new Map(source.animations.map((original, i) => [original.name, mixer.clipAction(clips[i])]))
  let active: THREE.AnimationAction | null = null
  const play = (name: string, once = false, restart = false) => {
    const next = actions.get(name) ?? actions.get('Idle')!
    if (active === next && !restart) return
    next.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity)
    next.clampWhenFinished = once
    next.play()
    if (active && active !== next) { active.fadeOut(0.14); next.fadeIn(0.14) }
    active = next
  }
  play('Idle'); mixer.update(0)
  const grips: CharacterSkin['grips'] = {}
  for (const side of ['L', 'R'] as const) {
    const bone = character.getObjectByName(`handslot${side.toLowerCase()}`)
    if (bone) { const socket = new THREE.Object3D(); socket.rotation.x = -Math.PI / 2; bone.add(socket); grips[side] = socket }
  }
  return {
    rootId, object, meshes, hidden: new Set([...parts].filter(([part]) => !part.startsWith('j_')).map(([, node]) => node)),
    springs: [], restHands: { left: 'relaxed', right: 'relaxed' }, grips,
    setFace() {}, setHands() {}, setQuality(quality) { for (const mesh of meshes) mesh.castShadow = options.shadows && quality !== 'low' },
    nativeClips: clips, bodySize: { height:options.height,radius:options.height*.17 },
    hitboxes() {
      root.updateWorldMatrix(true,true)
      const rootScale = object.getWorldScale(new THREE.Vector3()).y, height = size.y * rootScale
      const result: ReturnType<typeof boxFromMatrix>[] = [], at = (name: string) => character.getObjectByName(name)?.getWorldPosition(new THREE.Vector3())
      const segment = (a: string,b: string,width: number) => {
        const start=at(a),end=at(b); if(!start||!end) return
        const length=start.distanceTo(end), orientation=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),end.clone().sub(start).normalize())
        result.push(boxFromMatrix(new THREE.Matrix4().compose(start.add(end).multiplyScalar(0.5),orientation,new THREE.Vector3(height*width,length+height*0.08,height*width))))
      }
      segment('hips','head',0.24)
      for(const side of ['l','r']) { segment(`upperleg${side}`,`lowerleg${side}`,0.13); segment(`lowerleg${side}`,`foot${side}`,0.11); segment(`upperarm${side}`,`lowerarm${side}`,0.1); segment(`lowerarm${side}`,`hand${side}`,0.09) }
      const head=at('head'); if(head) result.push(boxFromMatrix(new THREE.Matrix4().makeScale(height*0.28,height*0.3,height*0.25).setPosition(head.add(new THREE.Vector3(0,height*0.1,0)))))
      return result
    },
    animate(input, pose) {
      if (pose.state === 'climb' || pose.state === 'swim') {
        // The pack has no ladder/swim clips. Retarget the existing controller's solved joints onto its native rig.
        mixer.stopAllAction(); active = null
        for (const link of retarget) link.to.quaternion.copy(link.base).multiply(link.basis.clone().multiply(link.inverse.clone().multiply(link.from.quaternion)).multiply(link.inverseBasis))
        return
      }
      const name = pose.state === 'death' ? 'Death_A' : pose.state === 'hurt' ? 'Hit_A' : pose.state === 'dodge' ? 'Dodge_Forward'
        : pose.state === 'jump' ? 'Jump_Start' : pose.state === 'fall' ? 'Jump_Idle' : pose.state === 'land' ? 'Jump_Land'
          : pose.state === 'attack' ? input.ranged ? id === 'mage' ? 'Spellcast_Shoot' : '1H_Ranged_Shoot' : ['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Slice_Horizontal'][(pose.combo + 2) % 3]
            : input.activity === 'sit' ? 'Sit_Chair_Idle' : input.activity === 'sleep' ? 'Lie_Idle' : pose.state === 'interact' ? 'Interact' : input.speed > 3 ? 'Running_A' : input.speed > 0.25 ? 'Walking_A' : 'Idle'
      play(name, ['death', 'hurt', 'dodge', 'attack', 'land', 'interact'].includes(pose.state), pose.events.includes('attackStart'))
      if (active && (name === 'Walking_A' || name === 'Running_A')) active.setEffectiveTimeScale(THREE.MathUtils.clamp(input.speed / (name === 'Walking_A' ? 1.6 : 4), 0.65, 1.5))
      // Align the visible strike to the controller's windup/strike/recovery rather than truncating a one-second clip.
      if (active && pose.state === 'attack' && pose.attackTiming) {
        const {time,windup,strike,recovery}=pose.attackTiming, duration=active.getClip().duration
        const fraction=time<windup ? 0.3*time/Math.max(0.001,windup) : time<windup+strike ? 0.3+0.4*(time-windup)/Math.max(0.001,strike) : 0.7+0.3*(time-windup-strike)/Math.max(0.001,recovery)
        active.paused=true; active.time=Math.min(duration-0.001,Math.max(0,fraction*duration)); mixer.update(Math.max(0,input.dt))
      } else mixer.update(Math.max(0, input.dt))
    },
    dispose() { mixer.stopAllAction(); mixer.uncacheRoot(character); for (const skeleton of new Set(meshes.map(mesh => mesh.skeleton))) skeleton.dispose(); object.removeFromParent() },
  }
}

/** Weapons retain the runtime's handle origin and +Z aim convention. */
export function libraryEquipment(kind: string): THREE.Group | null {
  const id = kind === 'sword' ? 'sword_1handed' : kind === 'axe' ? 'axe_1handed' : kind === 'staff' ? 'staff' : null
  const source = id && loaded.get(id)
  if (!source) return null
  const object = new THREE.Group(), model = source.scene.clone(true)
  const top = kind === 'sword' ? 0.95 : kind === 'axe' ? 0.56 : 1.08
  const bounds = new THREE.Box3().setFromObject(model)
  object.scale.setScalar(top / bounds.max.y)
  object.rotation.x = Math.PI / 2
  if (kind === 'axe') model.rotation.y = Math.PI
  model.traverse(child => { if (child instanceof THREE.Mesh) { child.castShadow = true; child.receiveShadow = true } })
  object.userData.libraryModel = id; object.add(model)
  return object
}
