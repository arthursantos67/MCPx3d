import { useEffect, useImperativeHandle, useRef, useState, type RefObject } from 'react'
import * as THREE from 'three'
import { createEnemyMotion,stepEnemyMotion,type EnemyMotion } from './sceneEnemies.ts'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { sampleNodeTransform } from './sceneAnimation.ts'
import { buildScene, createResources, HELPER_LAYER, pickNodeId, surfaceMatrix, type BuiltScene, type SceneResources } from './sceneBuild.ts'
import { createEmptyScene, createNode, defaultAnimation, hasSurface, INTERACTION_KEYS, subtreeIds, validateMaterial, validateScene, type avatarKinds, type PowerKind, type SceneNode, type ThreeSceneDocument, type Vector3Tuple } from './sceneDocument.ts'
import { createEnvironmentRig, SKY_LAYER } from './sceneEnvironment.ts'
import { createOcclusionPass } from './sceneOcclusion.ts'
import { createWeather, createWeatherPass } from './sceneWeather.ts'
import { createGradingPass } from './sceneGrading.ts'
import { animateWater, collectWaterMaterials } from './sceneWater.ts'
import { createAudioEngine, type AudioEmitter, type AudioEngine, type SfxName } from './sceneAudio.ts'
import { isTypingTarget, playControlList, playerKey } from './sceneKeyboard.ts'
import { boxFromMatrix, buildStaticCollider, capsuleTouches, emptyInput, findWalkableSpawn, PLAYER_EYE, stepPlayer, type PlayerBox, type PlayerCollider, type PlayerInput, type PlayerState } from './scenePlayer.ts'
import { actionLabels, activeEnemy, advanceRuntime, checkOutcome, createRuntime, damageEnemy, damagePlayer, dialogueState, drainEvents, enemyHealth, interactionAvailable, interactionBlocked, launchVelocity, objectiveLimit, objectiveStatus,
  playerModifiers, powerLabels, pressInteractionKey, reachCheckpoint, reachGoal, runtimePose, runtimeVisible, triggerInteraction, updateProximity, type RuntimeEvent, type SceneRuntime } from './sceneRuntime.ts'
import { enemyShot, fireWeapon, meleeTargets, stepProjectiles, weaponStats, type Projectile } from './sceneCombat.ts'
import { carry, findSupport } from './sceneMovingPlatforms.ts'
import { weaponLabels as weaponNames } from './sceneLabels.ts'
import { buildAvatar } from './sceneCharacters.ts'
import { applyRig, bindParts, bindRigs, strideRate, type LocomotionState, type RigBinding } from './sceneCharacterRig.ts'

export type GizmoMode = 'translate' | 'rotate' | 'scale' | null
export type CameraView = 'front' | 'right' | 'top' | 'perspective'
export interface TransformPatch { position: Vector3Tuple; rotation: Vector3Tuple; scale: Vector3Tuple }
export interface ViewportController {
  view: (view: CameraView) => void
  capture: () => Promise<Blob>
  cameraSpawn: () => { spawn: Vector3Tuple; yaw: number }
}
interface Props {
  document: ThreeSceneDocument; selectedId: string | null; active: boolean; fitRequest: number; playing: boolean; seekTime: number; seekRequest: number
  gizmo: GizmoMode; snap: boolean; playMode: boolean; presentation?: boolean; controller?: RefObject<ViewportController | null>
  onTimeChange: (time: number) => void; onSelect: (id: string | null) => void; onTransform: (id: string, patch: TransformPatch) => void; onExitPlay: () => void
}
interface HudDialogue { name: string; line: string; step: string }
interface HudState { score: number; items: string; effects: string; weapon: string; dialogue: HudDialogue | null; muted: boolean; locked: boolean; prompt: string; collected: number; total: number; fly: boolean; help: boolean; omitted: number; health: number; maxHealth: number; objective: string; time: number; limit: number; outcome: 'playing' | 'won' | 'lost'; view: 'first' | 'third'; hurt: number; enemies: string }
interface ViewportEngine {
  update: (document: ThreeSceneDocument) => void
  select: (id: string | null) => void
  fit: () => void
  play: (playing: boolean) => void
  seek: (seconds: number) => void
  activate: (active: boolean) => void
  tools: (gizmo: GizmoMode, snap: boolean) => void
  game: (enabled: boolean) => void
  present: (enabled: boolean) => void
}
const round = (value: number, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits

export default function ThreeViewport({ document, selectedId, active, fitRequest, playing, seekTime, seekRequest, gizmo, snap, playMode, presentation = false, controller, onTimeChange, onSelect, onTransform, onExitPlay }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const engine = useRef<ViewportEngine | null>(null)
  const callbacks = useRef({ onTimeChange, onSelect, onTransform, onExitPlay })
  useEffect(() => { callbacks.current = { onTimeChange, onSelect, onTransform, onExitPlay } }, [onTimeChange, onSelect, onTransform, onExitPlay])
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState({ calls: 0, triangles: 0, fps: 0 })
  const [hud, setHud] = useState<HudState>({ score: 0, items: '', effects: '', weapon: '', dialogue: null, muted: false, locked: false, prompt: '', collected: 0, total: 0, fly: false, help: false, omitted: 0, health: 100, maxHealth: 100, objective: '', time: 0, limit: 0, outcome: 'playing', view: 'first', hurt: 0, enemies: '' })
  const restartRequest = useRef<() => void>(() => {})
  const [dismissed, setDismissed] = useState<HudState['outcome'] | null>(null)
  const [session, setSession] = useState(playMode)
  if (session !== playMode) {
    setSession(playMode)
    if (playMode) { setDismissed(null); setHud((previous) => ({ ...previous, outcome: 'playing' })) }
  }
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([])
  const lockRequest = useRef<() => void>(() => {})
  const handle = useRef<ViewportController | null>(null)
  useImperativeHandle(controller, () => ({
    view: (view) => handle.current?.view(view),
    capture: () => handle.current ? handle.current.capture() : Promise.reject(new Error('O viewport WebGL não está disponível.')),
    cameraSpawn: () => handle.current?.cameraSpawn() ?? { spawn: [0, 0, 6], yaw: 0 },
  }), [])

  useEffect(() => {
    const container = host.current!
    let renderer: THREE.WebGLRenderer
    try { renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' }) }
    // The graphics context is an external resource; expose initialization failure.
    // oxlint-disable-next-line react/set-state-in-effect
    catch { setError('WebGL2 indisponível. Ative a aceleração gráfica ou use outro navegador. Você ainda pode editar e exportar o projeto.'); return }
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
    renderer.setPixelRatio(pixelRatio)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.info.autoReset = false
    renderer.domElement.setAttribute('aria-label', 'Cena Three.js interativa')
    renderer.domElement.setAttribute('role', 'img')
    renderer.domElement.tabIndex = 0
    container.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    const content = new THREE.Group()
    scene.add(content)
    const rig = createEnvironmentRig(renderer, scene)
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000)
    camera.position.set(16, 11, 18)
    camera.layers.enable(HELPER_LAYER)
    let presenting = false
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 1, 0)
    // Drawing on change avoids a permanent animation loop while the editor is idle.
    controls.enableDamping = false
    controls.minDistance = 0.1
    const transform = new TransformControls(camera, renderer.domElement)
    const transformHelper = transform.getHelper()
    scene.add(transformHelper)
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.24, depthWrite: false }))
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    scene.add(ground)
    const grid = new THREE.GridHelper(40, 40, '#8fadb8', '#c5d3db')
    grid.position.y = -0.005
    scene.add(grid)
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 })
    const composer = new EffectComposer(renderer, target)
    const occlusion = createOcclusionPass(scene,camera)
    occlusion.enabled = false
    composer.setPixelRatio(pixelRatio)
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.25, 1)
    bloom.enabled = false
    // Keep only the energy above the threshold and cap it, so grazing sun glints cannot flood the frame.
    bloom.materialHighPassFilter.fragmentShader = bloom.materialHighPassFilter.fragmentShader.replace('gl_FragColor = mix( outputColor, texel, alpha );',
      'gl_FragColor = vec4( min( texel.rgb * clamp( ( v - luminosityThreshold ) / max( v, 1e-4 ), 0.0, 1.0 ), vec3( 1.5 ) ), 1.0 );')
    bloom.materialHighPassFilter.needsUpdate = true
    const outline = new OutlinePass(new THREE.Vector2(1, 1), scene, camera)
    outline.visibleEdgeColor.set('#f2a93b'); outline.hiddenEdgeColor.set('#6d4512'); outline.edgeStrength = 4; outline.edgeThickness = 1.2
    outline.enabled = false
    const skyCamera = new THREE.PerspectiveCamera()
    const skyPass = new RenderPass(scene, skyCamera)
    skyPass.clear = false
    composer.addPass(new RenderPass(scene, camera))
    composer.addPass(occlusion)
    composer.addPass(bloom)
    composer.addPass(skyPass)
    const weather = createWeather(), weatherPass = createWeatherPass(weather, scene, camera), grading = createGradingPass()
    composer.addPass(weatherPass)
    composer.addPass(outline)
    const output = new OutputPass()
    composer.addPass(output)
    composer.addPass(grading.pass)
    let waterMaterials: THREE.Material[] = [], ambientMotion = false
    let audio: AudioEngine | null = null, audioMuted = false
    const sfx = (name: SfxName, position?: THREE.Vector3) => audio?.sfx(name, position ? [position.x, position.y, position.z] : undefined)
    const resources = createResources(Math.min(8, renderer.capabilities.getMaxAnisotropy()))
    let doc: ThreeSceneDocument | null = null, built: BuiltScene | null = null
    let animatedNodes: SceneNode[] = [], byId = new Map<string, SceneNode>()
    let playback = false, time = 0, duration = 20
    let lastTimestamp: number | null = null, lastReport = 0, fpsFrames = 0, fpsStarted = 0
    let selected: string | null = null, gizmoMode: GizmoMode = 'translate', snapping = false
    let proxies: THREE.Mesh[] = [], suppressed = new Set<string>()
    let enabled = false, lost = false, disposed = false, frame = 0
    interface EnemyState extends EnemyMotion { radius:number; height:number; eyeHeight:number; moved: boolean; attackTime: number }
    let game: { runtime: SceneRuntime; player: PlayerState; input: PlayerInput; collider: PlayerCollider; saved: { position: THREE.Vector3; target: THREE.Vector3; fov: number; near: number; far: number }; last: number | null; aim: string | null; strike: string | null; hud: string; locked: boolean; help: boolean
      view: 'first' | 'third'; spawn: THREE.Vector3; stride: number; sounds: SceneNode[]; projectiles: Projectile[]; attackCooldown: number; swing: number; platforms: Map<string, THREE.Matrix4>
      modes: Map<string, string>; rigMotion: Map<string, { last: THREE.Vector3; speed: number; cycle: number; attack: number; hurt: number; dead: number }>; avatarRig: { built: BuiltScene; resources: SceneResources; binding: RigBinding; cycle: number; hurt: number; seenHurt: number }; dialogue: { name: string; line: string; index: number; total: number; until: number } | null; spawnNotice: number; enemies: Map<string, EnemyState>; enemyParts:Set<string>; parts: Map<string, SceneNode[]>; water: number | null; avatar: THREE.Group; hurt: number; goalCooldown: number } | null = null
    /** The third-person avatar is compiled from the same procedural parts and rig as scene characters, with its own GPU resources. */
    const createAvatar = (kind: typeof avatarKinds[number]) => {
      const parts = buildAvatar(kind), id = (part: string) => `avatar.${part}`
      const avatarDoc = validateScene({ ...createEmptyScene(), nodes: parts.map((part) => ({ ...createNode(part.kind), id: id(part.id), parentId: part.parentId ? id(part.parentId) : null, name: part.name,
        position: part.position, rotation: part.rotation ?? [0, 0, 0], dimensions: part.dimensions, collidable: false, assetPart: part.id,
        material: validateMaterial({ color: '#cccccc', metalness: 0, roughness: 0.6, ...part.material }), geometry: { ...createNode(part.kind).geometry, ...part.geometry },
        animation: { ...defaultAnimation(), ...part.animation }, ...(part.light ? { light: part.light } : {}) })) })
      const avatarResources = createResources(4), avatarBuilt = buildScene(avatarDoc, avatarResources, { instancing: false, helpers: false })
      avatarBuilt.root.visible = false
      avatarBuilt.root.traverse((object) => { if (object instanceof THREE.Mesh) object.castShadow = !(object.material as THREE.MeshPhysicalMaterial).map })
      return { built: avatarBuilt, resources: avatarResources, binding: bindParts('avatar', 'biped', parts, 1, id), cycle: 0, hurt: 0, seenHurt: 0 }
    }
    let rigs: RigBinding[] = []
    const idle = (seconds: number, airborne = false): LocomotionState => ({ time: seconds, speed: 0, airborne, attack: -1, hurt: 0, dead: 0 })
    const flyingRig = (binding: RigBinding) => binding.kind === 'flyer' || binding.kind === 'hover' || !!byId.get(binding.rootId)?.behavior?.flying
    const ray = new THREE.Ray()
    const raycaster = new THREE.Raycaster()
    raycaster.layers.enableAll()
    const visible = (object: THREE.Object3D): boolean => {
      for (let current: THREE.Object3D | null = object; current; current = current.parent) if (!current.visible) return false
      return true
    }
    const toast = (text: string) => {
      const id = performance.now() + Math.random()
      setToasts((items) => [...items.slice(-3), { id, text }])
      setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 3500)
    }
    const render = () => {
      renderer.info.reset()
      if (game) rig.frame(game.player.position,24)
      rig.follow(camera)
      built?.updateShadows(game?game.player.position:controls.target)
      skyPass.enabled = rig.skyVisible()
      skyCamera.copy(camera)
      skyCamera.layers.set(SKY_LAYER)
      const seconds = performance.now() / 1000
      weather.update(camera, seconds)
      grading.setTime(seconds)
      if (waterMaterials.length) animateWater(waterMaterials, seconds)
      composer.render()
      const { calls, triangles } = renderer.info.render
      setStats((previous) => previous.calls === calls && previous.triangles === triangles ? previous : { ...previous, calls, triangles })
    }
    const countFrame = (timestamp: number) => {
      if (!fpsStarted) fpsStarted = timestamp
      fpsFrames++
      if (timestamp - fpsStarted > 500) { const fps = Math.round(fpsFrames * 1000 / (timestamp - fpsStarted)); fpsFrames = 0; fpsStarted = timestamp; setStats((previous) => previous.fps === fps ? previous : { ...previous, fps }) }
    }
    const nodeChain = (id: string | null): SceneNode[] => {
      const chain: SceneNode[] = []
      for (let node = id ? byId.get(id) : undefined; node; node = node.parentId ? byId.get(node.parentId) : undefined) chain.push(node)
      return chain
    }
    const animateCharacters = (state: NonNullable<typeof game>, delta: number) => {
      const runtime = state.runtime, seconds = runtime.elapsed
      for (const binding of rigs) {
        const id = binding.rootId, holder = built!.holders.get(id)
        if (!holder) continue
        const enemy = state.enemies.get(id), world = holder.getWorldPosition(new THREE.Vector3())
        const motion = state.rigMotion.get(id) ?? { last: world.clone(), speed: 0, cycle: 0, attack: -1, hurt: 0, dead: 0 }
        const measured = delta > 0 ? Math.hypot(world.x - motion.last.x, world.z - motion.last.z) / delta : 0
        motion.speed += (Math.min(12, measured) - motion.speed) * Math.min(1, delta * 10)
        motion.last.copy(world)
        motion.cycle += strideRate(binding.kind, motion.speed) * delta
        if (enemy) {
          if (enemy.attackTime < 1) { enemy.attackTime = Math.min(1, enemy.attackTime + delta * 2.2); motion.attack = 0.35 + enemy.attackTime * 0.65 }
          else motion.attack = enemy.action === 'windup' ? 0.25 : -1
        }
        motion.hurt = Math.max(0, motion.hurt - delta * 3)
        if (runtime.defeated.has(id)) motion.dead = Math.min(1, motion.dead + delta * 1.4)
        state.rigMotion.set(id, motion)
        applyRig(binding, built!.holders, { time: seconds, speed: motion.speed, airborne: flyingRig(binding), attack: motion.attack, hurt: motion.hurt, dead: motion.dead,
          talk: enemy?.action === 'talk', cycle: motion.cycle })
      }
      const avatar = state.avatarRig, player = state.player, speed = player.fly ? 0 : Math.hypot(player.velocity.x, player.velocity.z)
      if (state.hurt !== avatar.seenHurt) { avatar.seenHurt = state.hurt; avatar.hurt = 1 }
      avatar.hurt = Math.max(0, avatar.hurt - delta * 3)
      avatar.cycle += strideRate('biped', speed) * delta
      avatar.built.root.visible = state.avatar.visible
      if (state.avatar.visible) applyRig(avatar.binding, avatar.built.holders, { time: seconds, speed, airborne: !player.onGround && !player.climbing, attack: state.swing > 0 ? 1 - state.swing : -1, hurt: avatar.hurt, dead: 0, cycle: avatar.cycle })
    }
    const partBoxes = (state: NonNullable<typeof game>, id: string) => (state.parts.get(id) ?? []).flatMap((node) => { const holder = built!.holders.get(node.id)!; return visible(holder) ? [boxFromMatrix(surfaceMatrix(holder, node))] : [] })
    const foeTargets = (state: NonNullable<typeof game>) => [...state.enemies.keys()].filter((id) => byId.get(id)?.behavior?.type === 'enemy' && activeEnemy(state.runtime, id)).flatMap((id) => partBoxes(state, id).map((box) => ({ id, box })))
    const worldOf = (id: string | undefined) => id ? built?.holders.get(id)?.getWorldPosition(new THREE.Vector3()) : undefined
    const strikeEnemy = (state: NonNullable<typeof game>, id: string, amount: number) => {
      if (damageEnemy(state.runtime, id, amount) === 'defeated') toast(`${byId.get(id)?.name ?? 'Inimigo'} derrotado!`)
    }
    const showDialogue = (state: NonNullable<typeof game>, node: SceneNode, line: string | null) => {
      const progress = dialogueState(state.runtime, node.id)
      if (line) state.dialogue = { name: node.name, line, index: (progress?.index ?? 0) + 1, total: progress?.total ?? 1, until: state.runtime.elapsed + 7 }
    }
    const interact = (state: NonNullable<typeof game>, id: string) => {
      const node = byId.get(id)!, message = triggerInteraction(state.runtime, id)
      if (node.interaction?.action === 'dialogue' && !state.runtime.blocked.has(id)) showDialogue(state, node, message)
      else if (message) toast(message)
    }
    const attack = (state: NonNullable<typeof game>) => {
      if (state.attackCooldown > 0 || state.runtime.outcome !== 'playing') return
      const weapon = doc?.environment.player?.weapon ?? 'none', stats = weaponStats[weapon], modifiers = playerModifiers(state.runtime)
      state.attackCooldown = stats.cooldown
      state.swing = 1
      const orientation = new THREE.Euler(state.player.pitch, state.player.yaw, 0, 'YXZ'), direction = new THREE.Vector3(0, 0, -1).applyEuler(orientation)
      const origin = state.player.position.clone().add(new THREE.Vector3(0, 1.35, 0))
      if (stats.kind === 'projectile') {
        const shot = fireWeapon(weapon, origin.clone().addScaledVector(direction, 0.6), direction, modifiers.damage)
        if (shot) state.projectiles.push(shot)
        sfx(weapon === 'staff' ? 'magic' : 'shoot', origin)
        return
      }
      sfx('swing', origin)
      const flat = direction.clone().setY(0).normalize(), hits = meleeTargets(state.player.position.clone().add(new THREE.Vector3(0, 0.9, 0)), flat, stats.range, stats.arc ?? 60, foeTargets(state), state.collider)
      for (const id of weapon === 'sword' ? hits.slice(0, 3) : hits.slice(0, 1)) strikeEnemy(state, id, stats.damage * modifiers.damage)
    }
    const projectileGroup = new THREE.Group(), projectileGeometry = new THREE.SphereGeometry(1, 10, 8), projectileMaterials = new Map<string, THREE.MeshBasicMaterial>()
    scene.add(projectileGroup)
    const syncProjectiles = (list: Projectile[]) => {
      while (projectileGroup.children.length < list.length) projectileGroup.add(new THREE.Mesh(projectileGeometry))
      projectileGroup.children.forEach((child, index) => {
        const mesh = child as THREE.Mesh, shot = list[index]
        mesh.visible = !!shot
        if (!shot) return
        if (!projectileMaterials.has(shot.color)) projectileMaterials.set(shot.color, new THREE.MeshBasicMaterial({ color: new THREE.Color(shot.color).multiplyScalar(3), toneMapped: false }))
        mesh.material = projectileMaterials.get(shot.color)!
        mesh.position.copy(shot.position)
        mesh.scale.setScalar(Math.max(0.05, shot.radius * 1.4))
      })
    }
    const eventSounds: Partial<Record<RuntimeEvent['kind'], SfxName>> = { collect: 'collect', unlock: 'unlock', locked: 'locked', heal: 'heal', powerup: 'powerup', hit: 'enemyHit', defeat: 'enemyDefeat', spawn: 'alert',
      checkpoint: 'checkpoint', dialogue: 'talk', message: 'talk', toggle: 'mechanism', hurt: 'hurt', shield: 'magic', victory: 'victory', 'defeat-player': 'defeat', timeout: 'defeat' }
    const gameFrame = (timestamp: number) => {
      const state = game!, delta = state.last === null ? 0 : Math.min(0.1, (timestamp - state.last) / 1000)
      state.last = timestamp
      const runtime = state.runtime, player = state.player, settings = doc!.environment.player!
      advanceRuntime(runtime, delta)
      state.attackCooldown = Math.max(0, state.attackCooldown - delta)
      state.swing = Math.max(0, state.swing - delta * 3)
      for (const node of animatedNodes) {
        const pose = runtimePose(runtime, node), holder = built!.holders.get(node.id)!
        holder.position.fromArray(pose.position)
        holder.rotation.set(...pose.rotation.map(THREE.MathUtils.degToRad) as [number, number, number])
        holder.scale.fromArray(pose.scale)
      }
      for (const id of built!.dynamic) built!.holders.get(id)!.visible = runtimeVisible(runtime, byId.get(id)!)
      for (const [id, motion] of state.rigMotion) if (runtime.defeated.has(id) && motion.dead < 1) built!.holders.get(id)!.visible = true
      scene.updateMatrixWorld(true)
      const surfaces = (include: (id: string) => boolean) => [...built!.dynamic].filter(include).flatMap((id) => {
        const node = byId.get(id)!, holder = built!.holders.get(id)!
        if (!hasSurface(node.kind) || node.collidable === false || !visible(holder)) return []
        const matrix = surfaceMatrix(holder, node)
        return [{ id, matrix, box: boxFromMatrix(matrix) }]
      })
      const moving = surfaces((id) => !state.enemyParts.has(id)), enemyCollider = { ...state.collider, boxes: moving.map((item) => item.box) }
      // Platforms carry the player: support is measured against last frame's pose, then the platform's motion is applied.
      if (!player.fly && state.platforms.size) {
        const support = findSupport(player.position, [...state.platforms].map(([id, matrix]) => ({ id, box: boxFromMatrix(matrix) })))
        const current = support ? moving.find((item) => item.id === support) : undefined
        if (support && current) { const carried = carry(state.platforms.get(support)!, current.matrix, player.position); player.position.copy(carried.position); player.yaw += carried.yaw }
      }
      state.platforms = new Map(moving.map((item) => [item.id, item.matrix]))
      const hurt = (amount: number, away: THREE.Vector3 | null) => {
        if (!damagePlayer(runtime, amount)) return
        state.hurt++
        if (away && away.lengthSq() > 1e-6) { away.setY(0).normalize().multiplyScalar(6); player.velocity.set(away.x, 4, away.z) }
      }
      for (const [id, enemy] of state.enemies) {
        const holder = built!.holders.get(id)!
        if (runtime.defeated.has(id) || !runtimeVisible(runtime, byId.get(id)!) || !visible(holder)) continue
        const behavior = byId.get(id)!.behavior!
        const step = stepEnemyMotion(enemy, { ...behavior, radius: enemy.radius, height: enemy.height, eyeHeight: enemy.eyeHeight, npc: behavior.type === 'npc' }, player.position, enemyCollider, delta, runtime.outcome === 'playing')
        enemy.moved = step.moved
        if (behavior.type === 'enemy') {
          const was = state.modes.get(id)
          state.modes.set(id, step.mode)
          if (step.mode === 'chase' && was !== 'chase' && was !== 'search') sfx('alert', enemy.position)
          if (step.attack === 'shoot' && step.muzzle && step.aim) { state.projectiles.push(enemyShot(id, step.muzzle, step.aim, behavior.damage)); sfx('shoot', step.muzzle) }
          if (step.attack === 'melee') { sfx('swing', enemy.position); hurt(behavior.damage, player.position.clone().sub(enemy.position)) }
          if (step.attack === 'charge') sfx('alert', enemy.position)
          if (step.attack) enemy.attackTime = 0
        }
        const world = enemy.position.clone(), heading = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), enemy.heading)
        if (holder.parent) { holder.position.copy(holder.parent.worldToLocal(world)); heading.premultiply(holder.parent.getWorldQuaternion(new THREE.Quaternion()).invert()) }
        else holder.position.copy(world)
        holder.quaternion.copy(heading)
      }
      scene.updateMatrixWorld(true)
      state.collider.boxes = surfaces(() => true).map((item) => item.box)
      const modifiers = playerModifiers(runtime)
      const fall = player.velocity.y, wasGrounded = player.onGround, wantsJump = state.input.jump
      if (runtime.outcome !== 'lost') stepPlayer(player, state.input, state.collider, { speed: settings.speed * modifiers.speed, jumpHeight: settings.jumpHeight * modifiers.jump }, delta)
      if (wasGrounded && wantsJump && !player.onGround && player.velocity.y > 0) sfx('jump', player.position)
      if (!wasGrounded && player.onGround && fall < -5) sfx('land', player.position)
      state.stride += player.onGround && !player.fly ? Math.hypot(player.velocity.x, player.velocity.z) * delta : 0
      if (state.stride > 1.9) { state.stride = 0; sfx('step', player.position) }
      state.goalCooldown = Math.max(0, state.goalCooldown - delta)
      if (state.projectiles.length) {
        const result = stepProjectiles(state.projectiles, delta, enemyCollider, foeTargets(state), { position: player.position })
        state.projectiles = result.alive
        for (const hit of result.hits) {
          if (hit.target === 'player') hurt(hit.projectile.damage, hit.projectile.velocity.clone())
          else if (hit.target !== 'world') strikeEnemy(state, hit.target, hit.projectile.damage)
        }
      }
      syncProjectiles(state.projectiles)
      for (const [id, parts] of state.parts) {
        const behavior = byId.get(id)?.behavior
        if (!behavior || runtime.hidden.has(id) || !parts.length || runtime.outcome !== 'playing') continue
        const boxes: PlayerBox[] = partBoxes(state, id)
        if (!boxes.length) continue
        const touching = (margin: number) => boxes.some((box) => capsuleTouches(player.position, box, margin))
        if (behavior.type === 'enemy' && !runtime.defeated.has(id) && touching(0.08)) {
          const top = Math.max(...boxes.map((box) => box.center.y + box.half.y))
          if (Math.min(fall, player.velocity.y) < -1 && player.position.y > top - 0.6) { strikeEnemy(state, id, 2 * modifiers.damage); player.velocity.y = 7 }
          else if (!behavior.attack || behavior.attack === 'touch' || behavior.attack === 'charge') hurt(behavior.damage, player.position.clone().sub(boxes[0].center))
        }
        if (behavior.type === 'hazard' && touching(0.02)) { hurt(behavior.damage, null); if (player.velocity.y < 5) player.velocity.y = 5 }
        if (behavior.type === 'launcher' && touching(0.06) && player.velocity.y < 1 && !player.fly) { player.velocity.y = launchVelocity(behavior); player.onGround = false; sfx('launch', player.position) }
        if (behavior.type === 'checkpoint' && touching(0.4) && reachCheckpoint(runtime, id, player.position.toArray())) toast('Ponto de controle salvo.')
        if (behavior.type === 'goal' && touching(0.3) && !state.goalCooldown) { state.goalCooldown = 2; const message = reachGoal(runtime); if (message) toast(message) }
      }
      if (state.water !== null && !player.fly && player.position.y < state.water - 0.7) { runtime.invulnerable = 0; hurt(25, null); sfx('splash', player.position); toast('Você caiu na água!'); player.position.copy(runtime.checkpoint ? new THREE.Vector3(...runtime.checkpoint) : state.spawn); player.velocity.set(0, 0, 0) }
      if (runtime.health <= 0 && runtime.outcome === 'playing') {
        runtime.health = runtime.maxHealth
        state.projectiles = []
        player.position.copy(runtime.checkpoint ? new THREE.Vector3(...runtime.checkpoint) : state.spawn); player.velocity.set(0, 0, 0)
        sfx('respawn', player.position)
        toast(runtime.checkpoint ? 'Você foi derrotado. De volta ao último ponto de controle.' : 'Você foi derrotado. De volta ao início.')
      }
      checkOutcome(runtime)
      const head = player.position.clone().add(new THREE.Vector3(0, state.view === 'third' ? 1.55 : PLAYER_EYE, 0)), orientation = new THREE.Euler(player.pitch, player.yaw, 0, 'YXZ')
      camera.quaternion.setFromEuler(orientation)
      if (state.view === 'third') {
        const back = new THREE.Vector3(0, 0, 1).applyEuler(orientation)
        let distance = 4.2
        if (state.collider.bvh) { ray.origin.copy(head); ray.direction.copy(back); const hit = state.collider.bvh.raycastFirst(ray, THREE.DoubleSide); if (hit) distance = Math.max(0.6, Math.min(distance, hit.distance - 0.3)) }
        camera.position.copy(head).addScaledVector(back, distance).add(new THREE.Vector3(0, 0.3, 0))
        state.avatar.visible = true
        state.avatar.position.copy(player.position)
        state.avatar.rotation.y = player.yaw + Math.PI
        state.avatar.updateMatrixWorld(true)
      } else { camera.position.copy(head); state.avatar.visible = false }
      camera.updateMatrixWorld()
      animateCharacters(state, delta)
      const positions = new Map<string, Vector3Tuple>()
      for (const node of runtime.nodes) if (node.interaction?.trigger === 'proximity') positions.set(node.id, built!.holders.get(node.id)!.getWorldPosition(new THREE.Vector3()).toArray())
      for (const message of updateProximity(runtime, [player.position.x, player.position.y + 0.9, player.position.z], positions)) toast(message)
      for (const event of drainEvents(runtime)) {
        const sound = eventSounds[event.kind]
        if (sound) sfx(sound, event.kind === 'hurt' || event.kind === 'shield' ? player.position : worldOf(event.id))
        if (event.kind === 'hit' && event.id) { const motion = state.rigMotion.get(event.id); if (motion) motion.hurt = 1 }
        if (event.kind === 'powerdown') toast(`${powerLabels[event.id as PowerKind] ?? 'Poder'} acabou.`)
        if (event.kind === 'spawn' && runtime.elapsed - state.spawnNotice > 3) { state.spawnNotice = runtime.elapsed; toast('Novos inimigos chegaram!') }
      }
      if (audio) {
        const forward = camera.getWorldDirection(new THREE.Vector3()), emitters: AudioEmitter[] = []
        for (const node of state.sounds) { const holder = built!.holders.get(node.id)!; if (visible(holder) && !runtime.hidden.has(node.id)) emitters.push({ id: node.id, position: holder.getWorldPosition(new THREE.Vector3()).toArray(), sound: node.sound! }) }
        audio.update({ position: camera.position.toArray(), forward: forward.toArray() }, emitters, delta)
        audio.setIntensity([...state.modes.values()].some((mode) => mode === 'chase') ? 'danger' : 'calm')
      }
      raycaster.set(head, new THREE.Vector3(0, 0, -1).applyEuler(orientation))
      raycaster.far = 50
      const hit = raycaster.intersectObjects(built!.pickables, false).find((item) => visible(item.object) && !(item.object.layers.mask === 1 << HELPER_LAYER) )
      const chain = hit ? nodeChain(pickNodeId(hit)) : []
      const weapon = settings.weapon ?? 'none', reach = weaponStats[weapon].kind === 'melee' ? weaponStats[weapon].range : weaponStats[weapon].range
      const foe = hit && hit.distance <= reach ? chain.find((node) => node.behavior?.type === 'enemy' && activeEnemy(runtime, node.id)) : undefined
      const source = hit && !foe ? chain.find((node) => node.interaction && node.interaction.trigger === 'click' && interactionAvailable(runtime, node) && hit.distance <= node.interaction.radius) : undefined
      state.aim = source?.id ?? null
      state.strike = foe?.id ?? null
      if (state.dialogue && runtime.elapsed > state.dialogue.until) state.dialogue = null
      const status = objectiveStatus(runtime), blocked = source ? interactionBlocked(runtime, source) : null, foeHealth = foe ? enemyHealth(runtime, foe.id) : null
      const next: HudState = { muted: audioMuted, locked: state.locked,
        prompt: foe ? `${weaponStats[weapon].kind === 'melee' ? 'Atacar' : 'Mirar'} · ${foe.name}${foeHealth && foeHealth.max > 1 ? ` (${foeHealth.health}/${foeHealth.max})` : ''}` : source ? blocked ? `🔒 ${source.name} · ${blocked}` : `${actionLabels[source.interaction!.action]} · ${source.name}` : '',
        collected: runtime.collected.size, total: runtime.collectibles, fly: player.fly, help: state.help, omitted: 0,
        health: Math.ceil(runtime.health), maxHealth: runtime.maxHealth, objective: status.text, time: Math.floor(runtime.elapsed), limit: objectiveLimit(runtime), outcome: runtime.outcome, view: state.view, hurt: state.hurt,
        enemies: runtime.enemies.length ? `${runtime.defeated.size}/${runtime.enemies.length}` : '', score: runtime.score,
        items: [...runtime.items].map(([name, count]) => count > 1 ? `${name} ×${count}` : name).join(' · '),
        effects: [...runtime.effects].filter(([, seconds]) => seconds > 0).map(([power, seconds]) => `${powerLabels[power]} ${Math.ceil(seconds)} s`).join(' · '),
        weapon: weaponNames[weapon], dialogue: state.dialogue ? { name: state.dialogue.name, line: state.dialogue.line, step: `${state.dialogue.index}/${state.dialogue.total}` } : null }
      const key = JSON.stringify(next)
      if (key !== state.hud) { state.hud = key; setHud((previous) => ({ ...next, omitted: previous.omitted })) }
      render()
      countFrame(timestamp)
    }
    const draw = (timestamp: number) => {
      frame = 0
      if (!enabled || lost || disposed || !container.clientWidth || !container.clientHeight || !built) return
      if (game) { gameFrame(timestamp); frame = requestAnimationFrame(draw); return }
      if (playback) {
        if (lastTimestamp !== null) time = (time + Math.min((timestamp - lastTimestamp) / 1000, 0.1)) % duration
        lastTimestamp = timestamp
      }
      for (const binding of rigs) applyRig(binding, built.holders, idle(time, flyingRig(binding)))
      for (const node of animatedNodes) {
        const holder = built.holders.get(node.id)!, pose = sampleNodeTransform(node, time)
        holder.position.fromArray(pose.position)
        holder.rotation.set(...pose.rotation.map(THREE.MathUtils.degToRad) as [number, number, number])
        holder.scale.fromArray(pose.scale)
      }
      scene.updateMatrixWorld(true)
      render()
      if (playback) { countFrame(timestamp); if (timestamp - lastReport > 100) { lastReport = timestamp; callbacks.current.onTimeChange(time) } }
      if ((playback || (presenting && ambientMotion)) && enabled && !lost && !disposed) frame = requestAnimationFrame(draw)
    }
    const invalidate = () => { if (enabled && !lost && !disposed && !frame) frame = requestAnimationFrame(draw) }
    const resize = () => {
      const width = container.clientWidth, height = container.clientHeight
      if (!width || !height) return
      renderer.setSize(width, height, false)
      composer.setSize(width, height)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      invalidate()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    controls.addEventListener('change', invalidate)
    const clearSelection = () => {
      for (const proxy of proxies) proxy.removeFromParent()
      proxies = []
      if (suppressed.size) { suppressed = new Set(); built?.sync(suppressed) }
      outline.selectedObjects = []
      outline.enabled = false
    }
    const applySelection = () => {
      clearSelection()
      transform.detach()
      if (!selected || !built || !doc || game || !byId.has(selected)) return
      const objects: THREE.Object3D[] = []
      for (const id of subtreeIds(doc.nodes, selected)) {
        const node = byId.get(id)!, holder = built.holders.get(id)!, instance = built.instances.get(id)
        if (built.meshes.has(id)) objects.push(built.meshes.get(id)!)
        else if (instance) {
          const proxy = new THREE.Mesh(instance.mesh.geometry, instance.mesh.material)
          proxy.scale.fromArray(node.dimensions)
          proxy.castShadow = proxy.receiveShadow = true
          proxy.userData.nodeId = id
          holder.add(proxy)
          proxies.push(proxy)
          objects.push(proxy)
          suppressed.add(id)
        }
        for (const child of holder.children) if (child.layers.mask === 1 << HELPER_LAYER) objects.push(child)
      }
      if (suppressed.size) built.sync(suppressed)
      outline.selectedObjects = objects
      outline.enabled = objects.length > 0
      const node = byId.get(selected)!
      if (gizmoMode && node.animation.kind === 'none') {
        transform.attach(built.holders.get(selected)!)
        transform.setMode(gizmoMode)
        transform.setSpace(gizmoMode === 'translate' ? 'world' : 'local')
      }
    }
    transform.addEventListener('change', invalidate)
    transform.addEventListener('objectChange', () => { built?.sync(suppressed); invalidate() })
    transform.addEventListener('dragging-changed', (event) => {
      controls.enabled = !event.value && !game
      const object = transform.object
      if (event.value || !object) return
      const id = object.userData.nodeId as string
      callbacks.current.onTransform(id, { position: object.position.toArray().map((v) => THREE.MathUtils.clamp(round(v), -10000, 10000)) as Vector3Tuple,
        rotation: [object.rotation.x, object.rotation.y, object.rotation.z].map((v) => round(THREE.MathUtils.radToDeg(v), 2)) as Vector3Tuple,
        scale: object.scale.toArray().map((v) => THREE.MathUtils.clamp(round(v), 0.01, 100)) as Vector3Tuple })
    })
    let pointerStart: [number, number] | null = null, dragLook: [number, number] | null = null
    const down = (event: PointerEvent) => {
      if (game) {
        if (game.locked) act()
        else { dragLook = [event.clientX, event.clientY]; lockRequest.current() }
        return
      }
      pointerStart = event.button === 0 && !transform.axis ? [event.clientX, event.clientY] : null
    }
    const move = (event: PointerEvent) => {
      if (!game || game.locked || !dragLook) return
      game.player.yaw -= (event.clientX - dragLook[0]) * 0.005
      game.player.pitch = THREE.MathUtils.clamp(game.player.pitch - (event.clientY - dragLook[1]) * 0.005, -1.5, 1.5)
      dragLook = [event.clientX, event.clientY]
    }
    const up = (event: PointerEvent) => {
      dragLook = null
      const start = pointerStart
      pointerStart = null
      if (game || !start || !built || Math.hypot(event.clientX - start[0], event.clientY - start[1]) > 4) return
      const rect = renderer.domElement.getBoundingClientRect()
      raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera)
      raycaster.far = Infinity
      scene.updateMatrixWorld(true)
      const hit = raycaster.intersectObjects([...built.pickables, ...proxies], false).find((intersection) => visible(intersection.object))
      callbacks.current.onSelect(hit ? pickNodeId(hit) : null)
    }
    const cancel = () => { pointerStart = null; dragLook = null }
    const mouseLook = (event: MouseEvent) => {
      if (!game?.locked) return
      game.player.yaw -= event.movementX * 0.0023
      game.player.pitch = THREE.MathUtils.clamp(game.player.pitch - event.movementY * 0.0023, -1.5, 1.5)
    }
    const lockChanged = () => { if (game) { game.locked = window.document.pointerLockElement === renderer.domElement; game.hud = '' } }
    restartRequest.current = () => { if (game) { stopGame(true); startGame() } }
    lockRequest.current = () => {
      renderer.domElement.focus()
      try { void Promise.resolve(renderer.domElement.requestPointerLock()).catch(() => {}) } catch { /* Pointer lock is optional; drag-to-look remains available. */ }
    }
    const act = () => {
      if (!game) return
      if (game.aim && !game.strike) interact(game, game.aim)
      else attack(game)
    }
    const keyDown = (event: KeyboardEvent) => {
      if (!game || isTypingTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) return
      const input = playerKey(event.code)
      if (input) { game.input[input] = true; event.preventDefault(); return }
      if (event.repeat) return
      if (event.code === 'Escape') { event.preventDefault(); callbacks.current.onExitPlay(); return }
      if (event.code === 'KeyF') {
        if (doc?.environment.player?.allowFly === false) { toast('O voo está desativado nesta fase.'); return }
        game.player.fly = !game.player.fly; game.player.velocity.set(0, 0, 0); toast(game.player.fly ? 'Voo livre: Espaço sobe, C desce.' : 'Caminhada com gravidade e colisão.'); return
      }
      if (event.code === 'KeyV') { game.view = game.view === 'first' ? 'third' : 'first'; toast(game.view === 'third' ? 'Câmera em terceira pessoa.' : 'Câmera em primeira pessoa.'); return }
      if (event.code === 'KeyH') { game.help = !game.help; return }
      if (event.code === 'KeyM') { audioMuted = !audioMuted; audio?.setMuted(audioMuted); game.hud = ''; toast(audioMuted ? 'Som desligado (M).' : 'Som ligado.'); return }
      if (event.code === 'KeyE') { event.preventDefault(); act(); return }
      if (INTERACTION_KEYS.test(event.key.toLowerCase())) for (const message of pressInteractionKey(game.runtime, event.key)) toast(message)
    }
    const keyUp = (event: KeyboardEvent) => {
      const input = playerKey(event.code)
      if (game && input) { game.input[input] = false; if (input !== 'jump') event.preventDefault() }
    }
    const blur = () => { if (game) game.input = emptyInput() }
    const contextLost = (event: Event) => {
      event.preventDefault()
      lost = true
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      setError('O contexto gráfico foi perdido. Seu projeto está preservado; recarregue a página para recuperar o viewport.')
    }
    const contextRestored = () => { lost = false; setError(null); invalidate() }
    renderer.domElement.addEventListener('pointerdown', down)
    renderer.domElement.addEventListener('pointermove', move)
    renderer.domElement.addEventListener('pointerup', up)
    renderer.domElement.addEventListener('pointercancel', cancel)
    renderer.domElement.addEventListener('webglcontextlost', contextLost)
    renderer.domElement.addEventListener('webglcontextrestored', contextRestored)
    window.document.addEventListener('mousemove', mouseLook)
    window.document.addEventListener('pointerlockchange', lockChanged)
    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    window.addEventListener('blur', blur)
    const sceneBounds = (framing = false) => {
      const box = new THREE.Box3(), backdrops = framing && doc ? doc.nodes.some((node) => hasSurface(node.kind) && node.kind !== 'plane') : false
      if (built) for (const [id, holder] of built.holders) if (hasSurface(byId.get(id)!.kind) && visible(holder) && !(backdrops && byId.get(id)!.kind === 'plane')) {
        box.union(new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5)).applyMatrix4(surfaceMatrix(holder, byId.get(id)!)))
      }
      return box
    }
    const frameBox = (box: THREE.Box3, direction: THREE.Vector3) => {
      const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3())
      const radius = box.isEmpty() ? 8 : Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.5)
      const right = new THREE.Vector3().crossVectors(Math.abs(direction.y) > 0.99 ? new THREE.Vector3(0, 0, -1) : camera.up, direction).normalize(), upward = new THREE.Vector3().crossVectors(direction, right).normalize()
      const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
      let distance = box.isEmpty() ? 12 : 1
      if (!box.isEmpty()) for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        const corner = new THREE.Vector3(x, y, z).sub(center)
        distance = Math.max(distance, corner.dot(direction) + Math.max(Math.abs(corner.dot(right)) / (tangent * camera.aspect), Math.abs(corner.dot(upward)) / tangent))
      }
      distance *= 1.12
      camera.position.copy(center).add(direction.clone().multiplyScalar(distance))
      // Tight clip planes keep depth precision for decals, text and thin parts seen from afar.
      camera.near = Math.max(0.005, distance / 2000)
      camera.far = distance * 6 + radius * 6
      camera.updateProjectionMatrix()
      controls.maxDistance = distance * 4
      controls.target.copy(center)
      controls.update()
      invalidate()
    }
    const selectionBox = () => {
      scene.updateMatrixWorld(true)
      if (!selected || !built?.holders.has(selected)) return sceneBounds(true)
      const box = new THREE.Box3()
      for (const id of subtreeIds(doc!.nodes, selected)) {
        const node = byId.get(id)!, holder = built.holders.get(id)!
        if (node.kind !== 'group') box.union(new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5)).applyMatrix4(surfaceMatrix(holder, node)))
      }
      return box.isEmpty() ? new THREE.Box3().setFromCenterAndSize(built.holders.get(selected)!.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(1, 1, 1)) : box
    }
    const presentationBox = () => {
      if (!doc?.nodes.some((node) => node.kind === 'terrain') || !built) return selectionBox()
      // Frame the authored architecture rather than the entire terrain/backdrop. Repeated forest props stay peripheral.
      const focus = new THREE.Box3()
      for (const node of doc.nodes.filter((node) => node.kind === 'group' && !node.parentId && node.visible)) {
        const descendants = subtreeIds(doc.nodes, node.id)
        if ([...descendants].filter((id) => hasSurface(byId.get(id)!.kind)).length < 12) continue
        for (const id of descendants) {
          const part = byId.get(id)!, holder = built.holders.get(id)!
          if (hasSurface(part.kind) && visible(holder)) focus.union(new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5)).applyMatrix4(surfaceMatrix(holder, part)))
        }
      }
      return focus.isEmpty() ? selectionBox() : focus.expandByScalar(3)
    }
    const startGame = () => {
      if (!built || !doc || game) return
      clearSelection()
      transform.detach()
      controls.enabled = false
      camera.layers.disable(HELPER_LAYER)
      grid.visible = false
      playback = false
      scene.updateMatrixWorld(true)
      const climbable = (node: SceneNode) => nodeChain(node.id).some((item) => item.behavior?.type === 'climbable')
      const entries = doc.nodes.filter((node) => hasSurface(node.kind) && node.collidable !== false && !built!.dynamic.has(node.id) && !climbable(node) && visible(built!.holders.get(node.id)!))
        .map((node) => ({ geometry: resources.geometry(node), matrix: surfaceMatrix(built!.holders.get(node.id)!, node) }))
      const climb = doc.nodes.filter((node) => hasSurface(node.kind) && climbable(node) && visible(built!.holders.get(node.id)!)).map((node) => boxFromMatrix(surfaceMatrix(built!.holders.get(node.id)!, node)))
      const parts = new Map<string, SceneNode[]>()
      for (const node of doc.nodes) if (node.behavior && node.behavior.type !== 'climbable') parts.set(node.id, [...subtreeIds(doc.nodes, node.id)].map((id) => byId.get(id)!).filter((item) => hasSurface(item.kind)))
      let water: number | null = null
      for (const node of doc.nodes) if (node.kind === 'plane' && !node.parentId && node.material.texture === 'water') water = Math.max(water ?? -Infinity, node.position[1])
      const { bvh, omitted } = buildStaticCollider(entries)
      const bounds = sceneBounds(), settings = doc.environment.player!
      const floor = bounds.isEmpty() ? 0 : bounds.min.y
      const center = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3())
      const spawn = settings.spawn ? new THREE.Vector3(...settings.spawn) : new THREE.Vector3(center.x, floor, bounds.isEmpty() ? 6 : bounds.max.z + 4)
      if (!(settings.mode === 'fly' && settings.allowFly !== false)) spawn.copy(findWalkableSpawn({ bvh, boxes: [], floor },spawn,bounds,water,!!settings.spawn))
      const enemies = new Map<string, EnemyState>()
      const probe = new THREE.Ray()
      for (const node of doc.nodes) if ((node.behavior?.type === 'enemy' || node.behavior?.type === 'npc')&&visible(built.holders.get(node.id)!)) {
        const base = built.holders.get(node.id)!.getWorldPosition(new THREE.Vector3())
        let ground = floor
        if (bvh) { probe.origin.set(base.x, base.y + 0.27, base.z); probe.direction.set(0, -1, 0); const hit = bvh.raycastFirst(probe, THREE.DoubleSide); if (hit) ground = hit.point.y }
        const dimensions=new THREE.Box3().setFromObject(built.holders.get(node.id)!).getSize(new THREE.Vector3())
        const height=Math.max(0.5,dimensions.y),radius=Math.max(0.15,Math.min(0.8,Math.max(dimensions.x,dimensions.z)*0.4,height*0.45))
        enemies.set(node.id,{...createEnemyMotion(base,ground,enemies.size*1.7),radius,height,eyeHeight:Math.max(0.3,dimensions.y*0.8),moved:false,attackTime:1})
      }
      const avatarRig = createAvatar(settings.avatar ?? 'explorer'), avatar = new THREE.Group()
      avatar.add(avatarRig.built.root)
      avatar.visible = false
      scene.add(avatar)
      audio ??= createAudioEngine()
      audio?.setMuted(audioMuted)
      audio?.start(doc)
      game = { runtime: createRuntime(doc, time), input: emptyInput(), collider: { bvh, boxes: [], floor, climb },
        player: { position: spawn, velocity: new THREE.Vector3(), yaw: settings.spawn ? THREE.MathUtils.degToRad(settings.yaw) : 0, pitch: -0.05, onGround: false, fly: settings.mode === 'fly' && settings.allowFly !== false },
        saved: { position: camera.position.clone(), target: controls.target.clone(), fov: camera.fov, near: camera.near, far: camera.far }, last: null, aim: null, strike: null, hud: '', locked: false, help: false,
        view: settings.camera ?? 'first', spawn: spawn.clone(), stride: 0, sounds: doc.nodes.filter((node) => node.sound), projectiles: [], attackCooldown: 0, swing: 0, platforms: new Map(), modes: new Map(), rigMotion: new Map(), avatarRig, dialogue: null, spawnNotice: -10, enemies, enemyParts:new Set([...enemies.keys()].flatMap(id=>[...subtreeIds(doc!.nodes,id)])),parts, water, avatar, hurt: 0, goalCooldown: 0 }
      setHud((previous) => ({ ...previous, omitted }))
      camera.fov = 70
      camera.near = 0.08
      camera.far = Math.max(400, bounds.isEmpty() ? 400 : bounds.getSize(new THREE.Vector3()).length() * 3)
      camera.updateProjectionMatrix()
      renderer.domElement.focus()
      if (frame) { cancelAnimationFrame(frame); frame = 0 }
      invalidate()
    }
    const stopGame = (rebuild = true) => {
      if (!game) return
      const saved = game.saved
      game.collider.bvh?.geometry.dispose()
      game.avatar.removeFromParent()
      game.avatarRig.built.dispose(); game.avatarRig.resources.dispose()
      syncProjectiles([])
      game = null
      audio?.stop()
      if (window.document.pointerLockElement === renderer.domElement) window.document.exitPointerLock()
      camera.position.copy(saved.position)
      Object.assign(camera, { fov: saved.fov, near: saved.near, far: saved.far })
      camera.updateProjectionMatrix()
      if (!presenting) camera.layers.enable(HELPER_LAYER)
      controls.target.copy(saved.target)
      controls.enabled = true
      controls.update()
      if (rebuild && doc) engine.current?.update(doc)
    }
    engine.current = {
      update(next) {
        if (game) { stopGame(false); callbacks.current.onExitPlay() }
        doc = next
        byId = new Map(next.nodes.map((node) => [node.id, node]))
        clearSelection()
        transform.detach()
        built?.root.removeFromParent()
        built?.dispose()
        built = buildScene(next, resources, { instancing: true, helpers: true })
        content.add(built.root)
        animatedNodes = next.nodes.filter((node) => node.animation.kind !== 'none')
        rigs = bindRigs(next)
        duration = next.timeline.duration
        time = Math.min(time, duration)
        const env = next.environment
        const exposure = rig.apply(env)
        bloom.enabled = (env.bloom ?? 0) > 0
        bloom.strength = env.bloom ?? 0
        bloom.threshold = Math.max(1, 1 / exposure)
        occlusion.enabled = !!env.ambientOcclusion
        weather.apply(env.weather ?? 'none', env)
        grading.apply(env.grade ?? 'none')
        waterMaterials = collectWaterMaterials(built.root)
        ambientMotion = (env.weather ?? 'none') !== 'none'
        renderer.shadowMap.enabled = env.shadows ?? true
        renderer.shadowMap.needsUpdate = true
        grid.visible = env.grid && !game && !presenting
        scene.updateMatrixWorld(true)
        const bounds = sceneBounds()
        ground.visible = !!env.shadows && !bounds.isEmpty()
        if (!bounds.isEmpty()) {
          const center = bounds.getCenter(new THREE.Vector3()), radius = Math.min(2000, Math.max(3, bounds.getSize(new THREE.Vector3()).length() / 2))
          rig.frame(center, radius)
          ground.position.set(center.x, bounds.min.y - 0.01, center.z)
          ground.scale.set(radius * 4, radius * 4, 1)
        }
        applySelection()
        invalidate()
      },
      select(id) { selected = id; applySelection(); invalidate() },
      fit() {
        const direction = camera.position.clone().sub(controls.target).normalize()
        if (!direction.lengthSq()) direction.set(1, 0.7, 1.1).normalize()
        frameBox(presenting && !selected ? presentationBox() : selectionBox(), direction)
      },
      play(value) { playback = value && !game; lastTimestamp = null; invalidate() },
      seek(seconds) { time = Math.min(duration, Math.max(0, seconds)); lastTimestamp = null; callbacks.current.onTimeChange(time); invalidate() },
      activate(value) {
        enabled = value
        lastTimestamp = null
        if (!value && frame) { cancelAnimationFrame(frame); frame = 0 }
        if (!value && game) callbacks.current.onExitPlay()
        if (value) { resize(); invalidate() }
      },
      tools(mode, snap) {
        gizmoMode = mode
        snapping = snap
        transform.setTranslationSnap(snapping ? 0.25 : null)
        transform.setRotationSnap(snapping ? THREE.MathUtils.degToRad(15) : null)
        transform.setScaleSnap(snapping ? 0.1 : null)
        applySelection()
        invalidate()
      },
      game(value) { if (value) startGame(); else stopGame() },
      present(value) {
        presenting = value
        if (value || game) camera.layers.disable(HELPER_LAYER); else camera.layers.enable(HELPER_LAYER)
        grid.visible = !!doc?.environment.grid && !game && !value
        if (value && !game) frameBox(presentationBox(), new THREE.Vector3(0.42, 0.28, 1.1).normalize())
        invalidate()
      },
    }
    handle.current = {
      view(view) {
        const directions = { front: [0, 0.0001, 1], right: [1, 0.0001, 0], top: [0, 1, 0.0001], perspective: [1, 0.7, 1.1] } as const
        frameBox(selectionBox(), new THREE.Vector3(...directions[view]).normalize())
      },
      capture() {
        const helpers = [transformHelper.visible, grid.visible, outline.enabled], layers = camera.layers.mask
        transformHelper.visible = false; grid.visible = false; outline.enabled = false
        camera.layers.disable(HELPER_LAYER)
        scene.updateMatrixWorld(true)
        render()
        const promise = new Promise<Blob>((resolve, reject) => renderer.domElement.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Não foi possível capturar a imagem.')), 'image/png'))
        ;[transformHelper.visible, grid.visible, outline.enabled] = helpers
        camera.layers.mask = layers
        invalidate()
        return promise
      },
      cameraSpawn() {
        const direction = controls.target.clone().sub(camera.position)
        return { spawn: [round(camera.position.x, 2), round(Math.max(-10000, camera.position.y - PLAYER_EYE), 2), round(camera.position.z, 2)], yaw: round(THREE.MathUtils.radToDeg(Math.atan2(-direction.x, -direction.z)), 1) }
      },
    }
    return () => {
      disposed = true
      engine.current = null
      handle.current = null
      if (frame) cancelAnimationFrame(frame)
      observer.disconnect()
      controls.removeEventListener('change', invalidate)
      controls.dispose()
      transform.detach()
      transform.dispose()
      renderer.domElement.removeEventListener('pointerdown', down)
      renderer.domElement.removeEventListener('pointermove', move)
      renderer.domElement.removeEventListener('pointerup', up)
      renderer.domElement.removeEventListener('pointercancel', cancel)
      renderer.domElement.removeEventListener('webglcontextlost', contextLost)
      renderer.domElement.removeEventListener('webglcontextrestored', contextRestored)
      window.document.removeEventListener('mousemove', mouseLook)
      window.document.removeEventListener('pointerlockchange', lockChanged)
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
      window.removeEventListener('blur', blur)
      game?.collider.bvh?.geometry.dispose()
      audio?.dispose()
      projectileGeometry.dispose()
      for (const material of projectileMaterials.values()) material.dispose()
      built?.dispose()
      resources.dispose()
      rig.dispose()
      composer.dispose()
      bloom.dispose(); outline.dispose(); occlusion.dispose(); output.dispose(); weatherPass.dispose(); weather.dispose(); grading.dispose()
      target.dispose()
      ground.geometry.dispose()
      ground.material.dispose()
      grid.geometry.dispose()
      for (const material of Array.isArray(grid.material) ? grid.material : [grid.material]) material.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
    }
  }, [])
  useEffect(() => { engine.current?.update(document) }, [document])
  useEffect(() => { engine.current?.select(selectedId) }, [selectedId, document])
  useEffect(() => { engine.current?.activate(active) }, [active])
  useEffect(() => { engine.current?.fit() }, [fitRequest])
  useEffect(() => { engine.current?.play(playing) }, [playing])
  useEffect(() => { engine.current?.seek(seekTime) }, [seekTime, seekRequest])
  useEffect(() => { engine.current?.tools(gizmo, snap) }, [gizmo, snap])
  useEffect(() => { engine.current?.game(playMode) }, [playMode])
  useEffect(() => { engine.current?.present(presentation) }, [presentation])

  return <section className={`three-viewport${playMode ? ' three-viewport--game' : ''}`} aria-label="Viewport Three.js">
    <div className="three-viewport__canvas" ref={host} />
    {!playMode && <div className="three-viewport__label"><span className="three-dot" /> PERSPECTIVA <span>Y ↑ · metros</span></div>}
    {error && <p className="three-viewport__error" role="alert">{error}</p>}
    {playMode && <div className="three-hud" role="region" aria-label="Modo jogo">
      <div className="three-hud__crosshair" aria-hidden="true" />
      {hud.hurt > 0 && <div key={hud.hurt} className="three-hud__hurt" aria-hidden="true" />}
      <div className="three-hud__top">
        <span className="three-hud__health" role="meter" aria-label="Vida" aria-valuemin={0} aria-valuemax={hud.maxHealth} aria-valuenow={hud.health}><i style={{ width: `${Math.max(0, hud.health) / hud.maxHealth * 100}%` }} />{hud.health}</span>
        <span aria-label="Objetivo">{hud.objective}</span>
        {hud.total > 0 && <span aria-label="Itens coletados">Itens {hud.collected}/{hud.total}</span>}
        {hud.enemies && <span aria-label="Inimigos derrotados">Inimigos {hud.enemies}</span>}
        <span aria-label="Tempo de jogo">{hud.limit ? `${Math.max(0, hud.limit - hud.time)} s restantes` : `${Math.floor(hud.time / 60)}:${String(hud.time % 60).padStart(2, '0')}`}</span>
        <span>{hud.muted ? '🔇 ' : ''}{hud.fly ? 'Voo' : hud.view === 'third' ? '3ª pessoa' : '1ª pessoa'}{!presentation ? ` · ${stats.fps} FPS` : ''}</span>
        <button type="button" onClick={() => callbacks.current.onExitPlay()}>Sair do jogo</button>
      </div>
      {(hud.items || hud.effects || hud.weapon || hud.score > 0) && <div className="three-hud__status" aria-label="Inventário e estado">
        {hud.weapon && <span>⚔ {hud.weapon}</span>}{hud.score > 0 && <span>★ {hud.score.toLocaleString('pt-BR')}</span>}
        {hud.items && <span aria-label="Inventário">🎒 {hud.items}</span>}{hud.effects && <span aria-label="Poderes ativos">✦ {hud.effects}</span>}</div>}
      {hud.prompt && <p className="three-hud__prompt"><kbd>E</kbd> {hud.prompt}</p>}
      {hud.dialogue && <div className="three-hud__dialogue" role="dialog" aria-label={`Diálogo com ${hud.dialogue.name}`}><strong>{hud.dialogue.name}</strong><p>{hud.dialogue.line}</p><small>{hud.dialogue.step} · E continua</small></div>}
      {!hud.locked && <button type="button" className="three-hud__capture" onClick={() => lockRequest.current()}>Clique para capturar o mouse · ou arraste para olhar</button>}
      <ul className="three-hud__toasts" role="status">{toasts.map((item) => <li key={item.id}>{item.text}</li>)}</ul>
      {hud.omitted > 0 && <p className="three-hud__warning">{hud.omitted.toLocaleString('pt-BR')} triângulos ficaram fora da colisão para respeitar o orçamento.</p>}
      {hud.outcome !== 'playing' && dismissed !== hud.outcome && <div className="three-hud__outcome" role="dialog" aria-label={hud.outcome === 'won' ? 'Vitória' : 'Fim de jogo'}>
        <strong>{hud.outcome === 'won' ? 'Vitória!' : 'Tempo esgotado'}</strong>
        <p>{`${Math.floor(hud.time / 60)}:${String(hud.time % 60).padStart(2, '0')}`}{hud.score ? ` · ${hud.score.toLocaleString('pt-BR')} pontos` : ''}{hud.total ? ` · itens ${hud.collected}/${hud.total}` : ''}{hud.enemies ? ` · inimigos ${hud.enemies}` : ''}</p>
        <div>{hud.outcome === 'won' && <button type="button" onClick={() => setDismissed('won')}>Continuar explorando</button>}<button type="button" onClick={() => { setDismissed(null); restartRequest.current() }}>Jogar de novo</button><button type="button" onClick={() => callbacks.current.onExitPlay()}>Sair</button></div>
      </div>}
      {hud.help && <dl className="three-hud__help" aria-label="Controles do jogo">{playControlList.map(([keys, label]) => <div key={keys}><dt>{keys}</dt><dd>{label}</dd></div>)}</dl>}
      {!hud.help && <p className="three-hud__controls">WASD mover · Mouse olhar · Espaço pular · E interagir · M som · H ajuda · Esc sair</p>}
    </div>}
    <div className="three-viewport__footer"><span>{playMode ? 'WASD anda · mouse olha · E interage/ataca · V câmera · H ajuda · Esc sai' : 'Arraste para orbitar · Scroll para zoom · Botão direito para mover · ? atalhos'}</span>
      <span aria-label="Estatísticas do renderer">{stats.triangles.toLocaleString('pt-BR')} triângulos · {stats.calls} draw calls{stats.fps ? ` · ${stats.fps} FPS` : ''}</span></div>
  </section>
}
