import { useEffect, useImperativeHandle, useRef, useState, type RefObject } from 'react'
import * as THREE from 'three'
import { alertGuard, createEnemyMotion, enemyCanSee as enemyCanSeeMuzzle, provokeNpc, stepEnemyMotion, type EnemyMotion, type EnemyStep } from './sceneEnemies.ts'
import { buildNavigation, createRouter, navigationFocus, type NavigationMesh, type Router } from './sceneNavigation.ts'
import { isGuardPlan, planRoutines, routineHour, routinePoints, routineTask, type RoutinePlan } from './sceneRoutines.ts'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { sampleNodeTransform } from './sceneAnimation.ts'
import { buildScene, createResources, HELPER_LAYER, pickNodeId, surfaceMatrix, type BuiltScene, type SceneResources } from './sceneBuild.ts'
import { createEmptyScene, createNode, DEFAULT_MOTION, defaultAnimation, hasSurface, INTERACTION_KEYS, subtreeIds, validateMaterial, validateScene, type avatarKinds, type PowerKind, type SceneNode, type ThreeSceneDocument, type Vector3Tuple } from './sceneDocument.ts'
import { createEnvironmentRig, SKY_LAYER } from './sceneEnvironment.ts'
import { createOcclusionPass } from './sceneOcclusion.ts'
import { createWeather, createWeatherPass } from './sceneWeather.ts'
import { createGradingPass } from './sceneGrading.ts'
import { animateWater, collectWaterMaterials } from './sceneWater.ts'
import { createAudioEngine, type AudioEmitter, type AudioEngine, type SfxName } from './sceneAudio.ts'
import { isTypingTarget, playerKey } from './sceneKeyboard.ts'
import { boxFromMatrix, buildStaticCollider, capsuleTouches, emptyInput, findWalkableSpawn, movementHeading, PLAYER_EYE, stepPlayer, type PlayerBox, type PlayerCollider, type PlayerInput, type PlayerState } from './scenePlayer.ts'
import { actionLabels, activeEnemy, advanceRuntime, checkOutcome, createRuntime, damageEnemy, damagePlayer, dialogueState, drainEvents, enemyHealth, interactionAvailable, interactionBlocked, launchVelocity, objectiveLimit, objectiveStatus,
  playerModifiers, powerLabels, pressInteractionKey, POWER_SECONDS, reachCheckpoint, reachGoal, runtimePose, runtimeVisible, triggerInteraction, updateProximity, type RuntimeEvent, type SceneRuntime } from './sceneRuntime.ts'
import { enemyShot, fireWeapon, meleePlayerContact, sweptMeleeTargets, stepProjectiles, weaponStats, type Projectile, type WeaponKind } from './sceneCombat.ts'
import { aimEquipment, bindEmitter, createEquipment, mountEquipment, poseFirstPersonEquipment, type Equipment } from './sceneEquipment.ts'
import { carry, findSupport } from './sceneMovingPlatforms.ts'
import { weaponLabels as weaponNames } from './sceneLabels.ts'
import { buildAvatar } from './sceneCharacters.ts'
import { applyRig, bindParts, bindRigs, type LocomotionState, type RigBinding } from './sceneCharacterRig.ts'
import { animatorForBinding, applyAnimatorPose, updateAnimator, type Animator, type AnimatorInput } from './sceneCharacterAnimator.ts'
import { createFootIKMemory, createLookMemory, solveFootIK, solveLookAt, type FootIKMemory, type LookMemory } from './sceneCharacterIK.ts'
import { createSprings, rigSpringChains, type SpringSystem } from './sceneSprings.ts'
import type { GroundSampler, QualityLevel } from './sceneRuntimeTypes.ts'
import { createFauna, planFauna, type FaunaSystem } from './sceneFauna.ts'
import { applyWind, attachWindShadows, buildGroundField, clothGeometry, createWind, windKey, windKinds, type GroundField, type WindSpec } from './sceneWind.ts'
import { createGrass, type GrassSystem } from './sceneGrass.ts'
import { emitterSources, sceneEmitters, createParticles } from './sceneParticles.ts'
import { prepareWater, waterGeometry } from './sceneWater.ts'
import { geometryKey } from './sceneGeometry.ts'
import { buildCharacterSkins } from './sceneSkin.ts'
import { dayState, formatHour, nightAmount, practicalLightFactor } from './sceneDayCycle.ts'
import ThreeHud, { type ThreeHudHandle } from './ThreeHud.tsx'
import { compassMarker, headingFromYaw, hudPhase, hurtAngle, nearestTarget, portraitFor, screenFromNdc, selectBoss, type HudAnchor, type HudModel } from './sceneHud.ts'
import { createGamepadState, lookDelta, mergeInput, pollGamepad, readGamepad, type GamepadState } from './sceneGamepad.ts'
import { loadSettings, mouseScale, saveSettings, type PlaySettings } from './sceneSettings.ts'

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
  const [hud, setHud] = useState<HudModel | null>(null)
  const restartRequest = useRef<() => void>(() => {})
  const pauseRequest = useRef<(paused: boolean) => void>(() => {})
  const dismissRequest = useRef<() => void>(() => {})
  const overlay = useRef<ThreeHudHandle>(null)
  const [settings, setSettings] = useState<PlaySettings>(() => loadSettings())
  const settingsRef = useRef(settings)
  const settingsChanged = useRef<(settings: PlaySettings) => void>(() => {})
  useEffect(() => { settingsRef.current = settings; saveSettings(settings); settingsChanged.current(settings) }, [settings])
  const [session, setSession] = useState(playMode)
  if (session !== playMode) {
    setSession(playMode)
    if (playMode) setHud(null)
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
    const ratioFor = (preference: PlaySettings['quality']) => Math.min(window.devicePixelRatio || 1, preference === 'low' ? 1 : preference === 'high' ? 2 : 1.5)
    const pixelRatio = ratioFor(settingsRef.current.quality)
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
    const softwareGl = (() => { try { const gl = renderer.getContext(), info = gl.getExtension('WEBGL_debug_renderer_info'); return /swiftshader|llvmpipe|software/i.test(String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))) } catch { return false } })()
    let quality: QualityLevel = settingsRef.current.quality === 'auto' ? softwareGl ? 'low' : 'medium' : settingsRef.current.quality
    let fauna: FaunaSystem | null = null, lifeClock = 0
    const wind = createWind(), particles = createParticles(wind), windVector = new THREE.Vector3()
    scene.add(particles.object)
    let grass: GrassSystem | null = null, field: GroundField | null = null, windSpecs = new Map<string, WindSpec>()
    let worldGeometries = new Map<string, THREE.BufferGeometry>(), usedGeometries = new Set<string>()
    const worldGeometry = (node: SceneNode) => {
      const spec = windSpecs.get(node.id), key = spec?.kind === 'flag' ? JSON.stringify(['cloth', geometryKey(node), windKey(spec), node.position, node.rotation, node.dimensions]) : `water:${geometryKey(node)}:${node.dimensions.join(',')}`
      usedGeometries.add(key)
      if (!worldGeometries.has(key)) { const geometry = spec?.kind === 'flag' ? clothGeometry(node, spec) : waterGeometry(node); if (!geometry) { usedGeometries.delete(key); return null } worldGeometries.set(key, geometry) }
      return worldGeometries.get(key)!
    }
    let practical: { light: THREE.PointLight | THREE.SpotLight; base: number }[] = [], glowing: { material: THREE.MeshPhysicalMaterial; base: number }[] = []
    const applyDay = (env: ThreeSceneDocument['environment'], elapsed: number) => {
      const day = dayState(env, elapsed)
      if (day) rig.setTimeOfDay(env, day)
      const factor = practicalLightFactor(day)
      for (const item of practical) item.light.intensity = item.base * factor
      for (const item of glowing) item.material.emissiveIntensity = item.base * (0.2 + 0.8 * factor)
      return day
    }
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000)
    scene.add(camera)
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
    let lastTimestamp: number | null = null, lastReport = 0, fpsFrames = 0, fpsStarted = 0, statsReported = 0
    let selected: string | null = null, gizmoMode: GizmoMode = 'translate', snapping = false
    let proxies: THREE.Mesh[] = [], suppressed = new Set<string>()
    let enabled = false, lost = false, disposed = false, frame = 0
    interface EnemyState extends EnemyMotion { radius:number; height:number; eyeHeight:number; moved: boolean; attackTime: number; step: EnemyStep | null; shown: THREE.Vector3 | null; equipment?: Equipment; shotPending?: boolean; strikeHit?: boolean }
    let game: { runtime: SceneRuntime; player: PlayerState; input: PlayerInput; collider: PlayerCollider; saved: { position: THREE.Vector3; target: THREE.Vector3; fov: number; near: number; far: number }; last: number | null; aim: string | null; strike: string | null; hud: string; locked: boolean; help: boolean
      view: 'first' | 'third'; spawn: THREE.Vector3; stride: number; sounds: SceneNode[]; projectiles: Projectile[]; attackCooldown: number; swing: number; hudAt: number; platforms: Map<string, THREE.Matrix4>
      modes: Map<string, string>; rigMotion: Map<string, CharacterMotion>; avatarRig: { built: BuiltScene; resources: SceneResources; binding: RigBinding; animator: Animator; feet: FootIKMemory; springs: SpringSystem; equipment: Equipment; seenHurt: number; seenSwing: number }; swings: number; heavy: boolean; meleeHits: Set<string>; blade: THREE.Line3 | null; dialogue: { id: string; name: string; line: string; index: number; total: number; until: number } | null; spawnNotice: number; enemies: Map<string, EnemyState>; enemyParts:Set<string>; parts: Map<string, SceneNode[]>; water: number | null; avatar: THREE.Group; hurt: number; goalCooldown: number; nav: NavigationMesh | null; router: Router; routines: Map<string, RoutinePlan>; guards: Set<string>
      paused: boolean; dismissed: boolean; interacted: boolean; device: 'keyboard' | 'gamepad'; pad: GamepadState; stamina: number; dodge: number; dodged: boolean; damageTaken: number; falls: number; lastHealth: number
      subtitle: { speaker: string; text: string; until: number } | null; greeted: Map<string, number>; omitted: number } | null = null
    /** The third-person avatar is compiled from the same procedural parts and rig as scene characters, with its own GPU resources. */
    const createAvatar = (kind: typeof avatarKinds[number], weapon: WeaponKind) => {
      const authored = buildAvatar(kind), removed = new Set(authored.filter((part) => /^(sword|weapon|staff|bow)/i.test(part.id)).map((part) => part.id))
      for (const part of authored) if (part.parentId && removed.has(part.parentId)) removed.add(part.id)
      const parts = authored.filter((part) => !removed.has(part.id)), id = (part: string) => `avatar.${part}`
      const avatarDoc = validateScene({ ...createEmptyScene(), nodes: parts.map((part) => ({ ...createNode(part.kind), id: id(part.id), parentId: part.parentId ? id(part.parentId) : null, name: part.name,
        position: part.position, rotation: part.rotation ?? [0, 0, 0], dimensions: part.dimensions, collidable: false, assetPart: part.id,
        material: validateMaterial({ color: '#cccccc', metalness: 0, roughness: 0.6, ...part.material }), geometry: { ...createNode(part.kind).geometry, ...part.geometry },
        animation: { ...defaultAnimation(), ...part.animation }, ...(part.light ? { light: part.light } : {}) })) })
      const avatarResources = createResources(4), avatarBuilt = buildScene(avatarDoc, avatarResources, { instancing: false, helpers: false })
      avatarBuilt.root.visible = false
      avatarBuilt.root.traverse((object) => { if (object instanceof THREE.Mesh) object.castShadow = !(object.material as THREE.MeshPhysicalMaterial).map })
      const binding = bindParts('avatar', 'biped', parts, 1, id)
      const equipment = createEquipment(weapon)
      mountEquipment(equipment, binding, avatarBuilt.holders)
      return { built: avatarBuilt, resources: avatarResources, binding, animator: animatorForBinding(binding), feet: createFootIKMemory(), springs: createSprings([...(avatarBuilt.skins.get('avatar')?.springs ?? [])]), equipment, seenHurt: 0, seenSwing: 0 }
    }
    let rigs: RigBinding[] = []
    interface CharacterMotion { animator: Animator; feet: FootIKMemory; look: LookMemory; springs: SpringSystem; last: THREE.Vector3; lastY: number; speed: number; action: string; hit: boolean; collapse: number }
    const groundRay = new THREE.Ray()
    const groundFor = (collider: PlayerCollider): GroundSampler => (x, z, fromY) => {
      if (!collider.bvh) return collider.floor
      groundRay.origin.set(x, fromY, z); groundRay.direction.set(0, -1, 0)
      const hit = collider.bvh.raycastFirst(groundRay, THREE.DoubleSide, 0, 3)
      return hit && hit.face && hit.face.normal.y > 0.5 ? hit.point.y : null
    }
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
      const player = game ? game.player.position : null
      wind.update(seconds, player)
      grass?.update(camera, seconds, player)
      particles.update(camera, seconds, lifeClock ? Math.min(0.1, seconds - lifeClock) : 0)
      weather.update(camera, seconds, wind.vector(windVector))
      grading.setTime(seconds)
      if (waterMaterials.length) animateWater(waterMaterials, seconds)
      const delta = lifeClock ? Math.min(0.1, seconds - lifeClock) : 0, day = doc && game ? applyDay(doc.environment, game.runtime.elapsed) : null
      lifeClock = seconds
      if (doc) fauna?.update(camera, seconds, delta, game ? game.player.position : null, nightAmount(doc.environment, day))
      if (game && day) audio?.setTimeOfDay(day.night)
      composer.render()
      const { calls, triangles } = renderer.info.render
      if (seconds - statsReported > 0.5) {
        statsReported = seconds
        setStats((previous) => previous.calls === calls && previous.triangles === triangles ? previous : { ...previous, calls, triangles })
      }
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
    const animateCharacters = (state: NonNullable<typeof game>, delta: number, combatCollider: PlayerCollider, takeDamage: (amount: number, away: THREE.Vector3 | null) => void) => {
      const runtime = state.runtime, seconds = runtime.elapsed, wind = new THREE.Vector3(0.6, 0, 0.2), ground = groundFor(state.collider)
      for (const binding of rigs) {
        const id = binding.rootId, holder = built!.holders.get(id)
        if (!holder || !visible(holder)) continue
        const enemy = state.enemies.get(id), step = enemy?.step, world = holder.getWorldPosition(new THREE.Vector3())
        const motion = state.rigMotion.get(id) ?? { animator: animatorForBinding(binding), feet: createFootIKMemory(), look: createLookMemory(),
          springs: createSprings([...rigSpringChains(binding, built!.holders), ...(built!.skins.get(id)?.springs ?? [])]), last: world.clone(), lastY: world.y, speed: 0, action: 'idle', hit: false, collapse: 0 }
        const measured = delta > 0 ? Math.min(12, Math.hypot(world.x - motion.last.x, world.z - motion.last.z) / delta) : 0
        motion.speed += (measured - motion.speed) * Math.min(1, delta * 10)
        const verticalSpeed = delta > 0 ? (world.y - motion.lastY) / delta : 0
        motion.last.copy(world); motion.lastY = world.y
        const activity = step?.activity, heavy = binding.kind === 'flyer' || ['orc', 'golem'].includes(byId.get(id)?.asset?.type ?? '')
        const input: AnimatorInput = { dt: delta, time: seconds, speed: motion.speed, grounded: !flyingRig(binding), verticalSpeed, dead: runtime.defeated.has(id), talk: false, ranged: !!enemy?.equipment }
        if (enemy) Object.assign(input, {
          attack: enemy.action === 'windup' && motion.action !== 'windup' ? heavy ? 'heavy' : 'light' : step?.attack === 'shoot' ? 'light' : null,
          talk: enemy.action === 'talk' || activity === 'greet', wave: activity === 'greet' && motion.action !== 'talk',
          activity: activity === 'sit' || activity === 'work' || activity === 'sleep' || activity === 'chat' || activity === 'perform' || activity === 'guard' ? activity : null,
          mood: activity === 'flee' || activity === 'alert' ? 'afraid' : enemy.mode === 'chase' ? 'angry' : 'calm', hurt: motion.hit })
        motion.hit = false
        if (enemy) motion.action = enemy.action
        const pose = updateAnimator(motion.animator, input)
        motion.collapse = pose.collapse
        applyAnimatorPose(binding, built!.holders, pose)
        if (enemy && byId.get(id)?.behavior?.attack === 'melee') {
          if (pose.events.includes('attackStart')) enemy.strikeHit = false
          const a = motion.animator, sw = a.swing
          if (!enemy.strikeHit && sw && a.time >= sw.a && a.time - delta <= sw.a + sw.s && !runtime.defeated.has(id)) {
            const striking = (state.parts.get(id) ?? []).filter((node) => /^(swordBlade|weapon|axe|club|spear|fist|palm|forearm|snout|jaw|paw|hoof)/i.test(node.assetPart ?? ''))
            const boxes = striking.map((node) => boxFromMatrix(surfaceMatrix(built!.holders.get(node.id)!, node)))
            if (meleePlayerContact(state.player.position, boxes, enemy.position.clone().add(new THREE.Vector3(0, enemy.height * 0.6, 0)), combatCollider)) {
              takeDamage(byId.get(id)!.behavior!.damage, state.player.position.clone().sub(enemy.position)); enemy.strikeHit = true
            }
          }
        }
        if (!flyingRig(binding)) solveFootIK(binding, built!.holders, ground, pose.footIK, motion.feet, delta)
        const target = step?.face ?? (enemy && (enemy.seesPlayer || enemy.action === 'talk') ? state.player.position.clone().add(new THREE.Vector3(0, 1.6, 0)) : null)
        solveLookAt(binding, built!.holders, target, pose.look, motion.look, delta)
        motion.springs.step(delta, wind)
        built!.skins.get(id)?.setFace(pose.face)
        if (enemy?.equipment) {
          const target = state.player.position.clone().add(new THREE.Vector3(0, 1.1, 0))
          aimEquipment(enemy.equipment, target)
          if (enemy.shotPending && pose.events.includes('impact')) {
            const muzzle = enemy.equipment.origin()
            if (enemyCanSeeMuzzle(muzzle, target, combatCollider)) {
              state.projectiles.push(enemyShot(id, muzzle, target.sub(muzzle), byId.get(id)!.behavior!.damage)); sfx('shoot', muzzle)
            }
            enemy.shotPending = false
          }
        }
        state.rigMotion.set(id, motion)
      }
      const avatar = state.avatarRig, player = state.player, speed = player.fly ? 0 : Math.hypot(player.velocity.x, player.velocity.z)
      const hurt = state.hurt !== avatar.seenHurt, swing = state.swings !== avatar.seenSwing
      avatar.seenHurt = state.hurt; avatar.seenSwing = state.swings
      const equipment = avatar.equipment, stats = weaponStats[equipment.kind]
      const pose = updateAnimator(avatar.animator, { dt: delta, time: seconds, speed, grounded: player.onGround || !!player.climbing || player.fly, verticalSpeed: player.velocity.y,
        dead: false, talk: !!state.dialogue, attack: swing ? state.heavy ? 'heavy' : 'light' : null, hurt, dodge: state.dodged, climbing: player.climbing, ranged: stats.kind === 'projectile' })
      state.dodged = false
      avatar.built.root.visible = state.avatar.visible
      if (state.avatar.visible) {
        applyAnimatorPose(avatar.binding, avatar.built.holders, pose)
        if (!player.fly && !player.climbing) solveFootIK(avatar.binding, avatar.built.holders, ground, pose.footIK, avatar.feet, delta)
        avatar.springs.step(delta, wind)
        avatar.built.skins.get('avatar')?.setFace(pose.face)
      }
      if (state.view === 'third') {
        equipment.object.scale.setScalar(1)
        mountEquipment(equipment, avatar.binding, avatar.built.holders)
        if (stats.kind === 'projectile') aimEquipment(equipment, player.position.clone().add(new THREE.Vector3(0, 1.35, 0)).addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion), 40))
      } else {
        camera.add(equipment.object)
        poseFirstPersonEquipment(equipment, avatar.animator)
      }
      equipment.object.visible = !state.paused && runtime.outcome === 'playing' && !player.climbing
      if (pose.events.includes('attackStart')) { state.meleeHits.clear(); state.blade = null }
      const blade = equipment.segment(), a = avatar.animator, sw = a.swing
      if (stats.kind === 'projectile' && pose.events.includes('impact')) {
        const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion), origin = equipment.origin()
        const source = player.position.clone().add(new THREE.Vector3(0, 1.35, 0))
        if (enemyCanSeeMuzzle(source, origin, combatCollider)) {
          const shot = fireWeapon(equipment.kind, origin, direction, playerModifiers(runtime).damage * (a.heavy ? 1.8 : 1))
          if (shot) state.projectiles.push(shot)
          sfx(equipment.kind === 'staff' ? 'magic' : 'shoot', origin)
        }
      }
      if (stats.kind === 'melee' && sw && a.time >= sw.a && a.time - delta <= sw.a + sw.s) {
        const source = player.position.clone().add(new THREE.Vector3(0, 1.1, 0)), previous = state.blade ?? blade
        const targets = foeTargets(state), npcs = [...state.enemies.keys()].filter((id) => byId.get(id)?.behavior?.type === 'npc' && !runtime.hidden.has(id)).flatMap((id) => partBoxes(state, id, true).map((box) => ({ id, box })))
        for (const id of sweptMeleeTargets(previous, blade, equipment.radius, [...targets, ...npcs], combatCollider, source)) {
          if (state.meleeHits.has(id)) continue
          state.meleeHits.add(id)
          if (byId.get(id)?.behavior?.type === 'npc') provokeNpc(state.enemies.get(id)!, player.position, byId.get(id)!.behavior!.reaction)
          else strikeEnemy(state, id, stats.damage * playerModifiers(runtime).damage * (a.heavy ? 1.8 : 1))
        }
      }
      state.blade = blade
    }
    const partBoxes = (state: NonNullable<typeof game>, id: string, bodyOnly = false) => (state.parts.get(id) ?? []).flatMap((node) => {
      if (bodyOnly && (node.collidable === false || nodeChain(node.id).some((part) => /^(sword|weapon|staff|bow)/i.test(part.assetPart ?? '')))) return []
      const holder = built!.holders.get(node.id)!; return visible(holder) ? [boxFromMatrix(surfaceMatrix(holder, node))] : []
    })
    const foeTargets = (state: NonNullable<typeof game>) => [...state.enemies.keys()].filter((id) => byId.get(id)?.behavior?.type === 'enemy' && activeEnemy(state.runtime, id)).flatMap((id) => partBoxes(state, id, true).map((box) => ({ id, box })))
    const worldOf = (id: string | undefined) => id ? built?.holders.get(id)?.getWorldPosition(new THREE.Vector3()) : undefined
    const screenOf = (point: THREE.Vector3) => { const ndc = point.clone().project(camera); return screenFromNdc(ndc.x, ndc.y, ndc.z, container.clientWidth, container.clientHeight) }
    const strikeEnemy = (state: NonNullable<typeof game>, id: string, amount: number) => {
      const result = damageEnemy(state.runtime, id, amount), enemy = state.enemies.get(id)
      if (result) {
        const point = screenOf((enemy?.position.clone() ?? worldOf(id) ?? new THREE.Vector3()).add(new THREE.Vector3(0, (enemy?.height ?? 1) * 0.8, 0)))
        if (point) overlay.current?.damage(point.x, point.y, Math.round(amount * 10), amount > 1.5 ? 'crit' : 'dealt')
        if (enemy) particles.burst(result === 'defeated' ? 'dust' : 'impact', enemy.position.clone().add(new THREE.Vector3(0, enemy.height * 0.6, 0)))
        overlay.current?.hit(result === 'defeated' ? 'kill' : 'hit')
      }
      if (result === 'defeated') toast(`${byId.get(id)?.name ?? 'Inimigo'} derrotado!`)
    }
    const showDialogue = (state: NonNullable<typeof game>, node: SceneNode, line: string | null) => {
      const progress = dialogueState(state.runtime, node.id)
      if (line) state.dialogue = { id: node.id, name: node.name, line, index: (progress?.index ?? 0) + 1, total: progress?.total ?? 1, until: state.runtime.elapsed + 7 }
    }
    const interact = (state: NonNullable<typeof game>, id: string) => {
      const node = byId.get(id)!, message = triggerInteraction(state.runtime, id)
      if (node.interaction?.action === 'dialogue' && !state.runtime.blocked.has(id)) showDialogue(state, node, message)
      else if (message) toast(message)
    }
    const attack = (state: NonNullable<typeof game>, heavy = false) => {
      if (state.attackCooldown > 0 || state.runtime.outcome !== 'playing' || state.paused || state.player.climbing) return
      const weapon = doc?.environment.player?.weapon ?? 'none', stats = weaponStats[weapon]
      state.attackCooldown = stats.cooldown * (heavy ? 1.6 : 1)
      state.heavy = heavy
      state.swing = 1
      state.swings++
      const origin = state.player.position.clone().add(new THREE.Vector3(0, 1.35, 0))
      if (stats.kind === 'melee') sfx('swing', origin)
      fauna?.scare(state.player.position, 8)
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
        const radius = Math.max(0.05, shot.radius * 1.4)
        mesh.scale.set(radius, radius, Math.max(radius, Math.min(0.35, shot.velocity.length() / 120)))
        if (shot.velocity.lengthSq() > 1e-8) mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), shot.velocity.clone().normalize())
      })
    }
    const eventSounds: Partial<Record<RuntimeEvent['kind'], SfxName>> = { collect: 'collect', unlock: 'unlock', locked: 'locked', heal: 'heal', powerup: 'powerup', hit: 'enemyHit', defeat: 'enemyDefeat', spawn: 'alert',
      checkpoint: 'checkpoint', dialogue: 'talk', message: 'talk', toggle: 'mechanism', hurt: 'hurt', shield: 'magic', victory: 'victory', 'defeat-player': 'defeat', timeout: 'defeat' }
    const gameFrame = (timestamp: number) => {
      const state = game!, elapsed = state.last === null ? 0 : Math.min(0.1, (timestamp - state.last) / 1000)
      state.last = timestamp
      const runtime = state.runtime, player = state.player, settings = doc!.environment.player!
      const pad = readGamepad(pollGamepad(), state.pad)
      if (pad.active) { if (state.device !== 'gamepad') state.hud = ''; state.device = 'gamepad'; state.interacted = true }
      if (pad.pressed.has('pause')) togglePause()
      const menu = state.paused || (runtime.outcome !== 'playing' && !state.dismissed)
      if (menu) for (const [action, move] of [['menuUp', 'up'], ['menuDown', 'down'], ['confirm', 'confirm'], ['back', 'back']] as const) { if (pad.pressed.has(action)) overlay.current?.menu(move) }
      else {
        const look = lookDelta(pad.look, elapsed, settingsRef.current.sensitivity, settingsRef.current.invertY)
        player.yaw += look.yaw; player.pitch = THREE.MathUtils.clamp(player.pitch + look.pitch, -1.5, 1.5)
        if (pad.pressed.has('interact')) act()
        if (pad.pressed.has('attack')) attack(state)
        if (pad.pressed.has('heavy')) attack(state, true)
        if (pad.pressed.has('dodge')) dodge(state)
        if (pad.pressed.has('camera')) toggleView(state)
        if (pad.pressed.has('help')) state.help = !state.help
        if (pad.pressed.has('fly')) toggleFly(state)
        if (pad.pressed.has('mute')) toggleMute(state)
      }
      const delta = state.paused ? 0 : elapsed, input = state.paused ? emptyInput() : mergeInput(state.input, pad.input)
      const running = Math.hypot(player.velocity.x, player.velocity.z) > 0.5
      state.stamina = THREE.MathUtils.clamp(state.stamina + (input.sprint && running && !player.fly ? -22 : state.dodge > 0 ? 0 : 16) * delta, 0, 100)
      if (state.stamina < 1) input.sprint = false
      state.dodge = Math.max(0, state.dodge - delta)
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
      for (const [id, motion] of state.rigMotion) if (runtime.defeated.has(id) && motion.collapse < 1) built!.holders.get(id)!.visible = true
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
        if (state.dodge > 0.15 || !damagePlayer(runtime, amount)) return
        state.hurt++
        overlay.current?.damage(container.clientWidth * 0.2, container.clientHeight * 0.78, Math.round(amount), 'taken')
        if (away && away.lengthSq() > 1e-6) overlay.current?.hurtFrom(hurtAngle(player.position, player.position.clone().sub(away), headingFromYaw(player.yaw)))
        if (away && away.lengthSq() > 1e-6) { away.setY(0).normalize().multiplyScalar(6); player.velocity.set(away.x, 4, away.z) }
      }
      const hour = routineHour(doc!.environment, runtime.elapsed)
      const live = [...state.enemies].filter(([id]) => !runtime.defeated.has(id) && runtimeVisible(runtime, byId.get(id)!))
      const threats = live.filter(([id, enemy]) => byId.get(id)!.behavior!.type === 'enemy' && enemy.mode === 'chase').map(([, enemy]) => enemy.position)
      for (const [id, enemy] of state.enemies) {
        const holder = built!.holders.get(id)!
        if (runtime.defeated.has(id) || !runtimeVisible(runtime, byId.get(id)!) || !visible(holder)) continue
        const behavior = byId.get(id)!.behavior!, npc = behavior.type === 'npc', guards = [...state.guards].filter((other) => other !== id && state.enemies.has(other))
        const step = stepEnemyMotion(enemy, { ...behavior, radius: enemy.radius, height: enemy.height, eyeHeight: enemy.eyeHeight, npc,
          ...(state.nav ? { route: (from: THREE.Vector3, to: THREE.Vector3) => state.router.next(id, from, to, runtime.elapsed) } : {}),
          neighbors: live.filter(([other, item]) => other !== id && item.position.distanceToSquared(enemy.position) < 9).map(([, item]) => item.position),
          ...(npc ? { task: routineTask(state.routines.get(id), hour, runtime.elapsed), threats, guards: guards.map((other) => state.enemies.get(other)!.position), guard: state.guards.has(id) } : {}) },
          player.position, enemyCollider, delta, runtime.outcome === 'playing')
        enemy.step = step
        if (step.alarm) {
          const nearest = guards.sort((a, b) => state.enemies.get(a)!.position.distanceTo(enemy.position) - state.enemies.get(b)!.position.distanceTo(enemy.position))[0]
          if (nearest) alertGuard(state.enemies.get(nearest)!, step.alarm)
        }
        enemy.moved = step.moved
        if (behavior.type === 'enemy') {
          const was = state.modes.get(id)
          state.modes.set(id, step.mode)
          if (step.mode === 'chase' && was !== 'chase' && was !== 'search') sfx('alert', enemy.position)
          if (step.attack === 'shoot') enemy.shotPending = true
          if (step.attack === 'melee') {
            sfx('swing', enemy.position)
            if (!rigs.some((binding) => binding.rootId === id) && meleePlayerContact(player.position, partBoxes(state, id, true), enemy.position.clone().add(new THREE.Vector3(0, enemy.height * 0.6, 0)), enemyCollider)) hurt(behavior.damage, player.position.clone().sub(enemy.position))
          }
          if (step.attack === 'charge') sfx('alert', enemy.position)
          if (step.attack) enemy.attackTime = 0
        }
        const settled = step.anchor && ['sit', 'work', 'sleep'].includes(step.activity ?? '') ? step.anchor : null
        enemy.shown = (enemy.shown ?? enemy.position.clone()).lerp(settled ?? enemy.position, settled || enemy.shown?.distanceToSquared(enemy.position) ? Math.min(1, delta * 4) : 1)
        if (!settled && enemy.shown.distanceToSquared(enemy.position) < 1e-4) enemy.shown.copy(enemy.position)
        const world = enemy.shown.clone(), heading = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), enemy.heading)
        if (holder.parent) { holder.position.copy(holder.parent.worldToLocal(world)); heading.premultiply(holder.parent.getWorldQuaternion(new THREE.Quaternion()).invert()) }
        else holder.position.copy(world)
        holder.quaternion.copy(heading)
      }
      scene.updateMatrixWorld(true)
      state.collider.boxes = surfaces(() => true).map((item) => item.box)
      const modifiers = playerModifiers(runtime)
      const fall = player.velocity.y, wasGrounded = player.onGround, wantsJump = input.jump
      if (runtime.outcome !== 'lost') stepPlayer(player, input, state.collider, { speed: settings.speed * modifiers.speed, jumpHeight: settings.jumpHeight * modifiers.jump }, delta)
      if (wasGrounded && wantsJump && !player.onGround && player.velocity.y > 0) sfx('jump', player.position)
      if (!wasGrounded && player.onGround && fall < -5) sfx('land', player.position)
      state.stride += player.onGround && !player.fly ? Math.hypot(player.velocity.x, player.velocity.z) * delta : 0
      if (state.stride > 1.9) { state.stride = 0; sfx('step', player.position); particles.burst('footstep', player.position) }
      state.goalCooldown = Math.max(0, state.goalCooldown - delta)
      if (state.projectiles.length) {
        const result = stepProjectiles(state.projectiles, delta, enemyCollider, foeTargets(state), { position: player.position })
        state.projectiles = result.alive
        for (const hit of result.hits) {
          if (hit.target === 'player') hurt(hit.projectile.damage, hit.projectile.velocity.clone())
          else if (hit.target !== 'world') strikeEnemy(state, hit.target, hit.projectile.damage)
        }
      }
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
      if (state.water !== null && !player.fly && player.position.y < state.water - 0.7) { runtime.invulnerable = 0; hurt(25, null); sfx('splash', player.position); toast('Você caiu na água!'); state.falls++; particles.burst('splash', player.position); player.position.copy(runtime.checkpoint ? new THREE.Vector3(...runtime.checkpoint) : state.spawn); player.velocity.set(0, 0, 0) }
      if (runtime.health <= 0 && runtime.outcome === 'playing') {
        runtime.health = runtime.maxHealth
        state.projectiles = []
        player.position.copy(runtime.checkpoint ? new THREE.Vector3(...runtime.checkpoint) : state.spawn); player.velocity.set(0, 0, 0)
        sfx('respawn', player.position)
        state.falls++
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
        state.avatar.rotation.y = player.climbing || state.attackCooldown > 0 ? player.yaw + Math.PI : movementHeading(state.avatar.rotation.y, player.velocity, delta)
        state.avatar.updateMatrixWorld(true)
      } else { camera.position.copy(head); state.avatar.visible = false }
      camera.updateMatrixWorld()
      animateCharacters(state, delta, enemyCollider, hurt)
      for (const [id, enemy] of state.enemies) if (enemy.shotPending && enemy.equipment && !rigs.some((binding) => binding.rootId === id)) {
        const target = player.position.clone().add(new THREE.Vector3(0, 1.1, 0))
        aimEquipment(enemy.equipment, target)
        const muzzle = enemy.equipment.origin()
        if (enemyCanSeeMuzzle(muzzle, target, enemyCollider)) { state.projectiles.push(enemyShot(id, muzzle, target.sub(muzzle), byId.get(id)!.behavior!.damage)); sfx('shoot', muzzle) }
        enemy.shotPending = false
      }
      syncProjectiles(state.projectiles)
      const positions = new Map<string, Vector3Tuple>()
      for (const node of runtime.nodes) if (node.interaction?.trigger === 'proximity') positions.set(node.id, built!.holders.get(node.id)!.getWorldPosition(new THREE.Vector3()).toArray())
      for (const message of updateProximity(runtime, [player.position.x, player.position.y + 0.9, player.position.z], positions)) toast(message)
      for (const event of drainEvents(runtime)) {
        const sound = eventSounds[event.kind]
        if (sound) sfx(sound, event.kind === 'hurt' || event.kind === 'shield' ? player.position : worldOf(event.id))
        if (event.kind === 'hit' && event.id) { const motion = state.rigMotion.get(event.id); if (motion) motion.hit = true }
        if (event.kind === 'collect' && event.id) { const item = byId.get(event.id)?.interaction?.item; if (item) overlay.current?.pickup({ name: item, count: runtime.items.get(item) ?? 1, icon: '' }) }
        if (event.kind === 'heal') overlay.current?.damage(container.clientWidth * 0.2, container.clientHeight * 0.78, Math.max(1, Math.round(runtime.health - state.lastHealth)), 'heal')
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
      for (const [id, enemy] of state.enemies) if (enemy.step?.activity === 'greet' && runtime.elapsed - (state.greeted.get(id) ?? -99) > 25) {
        state.greeted.set(id, runtime.elapsed)
        state.subtitle = { speaker: byId.get(id)!.name, text: ['Olá, viajante!', 'Bom dia!', 'Seja bem-vindo!', 'Que bom ver você por aqui.'][state.greeted.size % 4], until: runtime.elapsed + 2.6 }
      }
      if (state.dialogue && state.dialogue.line !== state.subtitle?.text) state.subtitle = null
      state.damageTaken += Math.max(0, state.lastHealth - runtime.health)
      state.lastHealth = runtime.health
      const flat = { x: player.position.x, z: player.position.z }, place = (id: string) => { const point = worldOf(id) ?? new THREE.Vector3(); return { x: point.x, z: point.z } }
      const objectiveType = doc!.environment.objective?.type
      const pending = objectiveType === 'collectAll' ? runtime.nodes.filter((node) => node.interaction?.action === 'collect' && !runtime.collected.has(node.id) && !runtime.hidden.has(node.id)).map((node) => ({ label: node.name, ...place(node.id) }))
        : objectiveType === 'defeatEnemies' ? [...state.enemies.keys()].filter((id) => activeEnemy(runtime, id)).map((id) => ({ label: byId.get(id)!.name, ...place(id) }))
          : runtime.nodes.filter((node) => node.behavior?.type === 'goal').map((node) => ({ label: node.name, ...place(node.id) }))
      const tracker = status.done ? null : nearestTarget(flat, pending), whole = (value: number) => Math.round(value)
      const markers = [...pending.slice(0, 3).map((target, index) => compassMarker(`o${index}`, 'objective', target.label, flat, target)),
        ...[...state.enemies.keys()].filter((id) => byId.get(id)!.behavior!.type === 'npc' || activeEnemy(runtime, id)).slice(0, 12).map((id) => compassMarker(id, byId.get(id)!.behavior!.type === 'npc' ? 'npc' : 'enemy', byId.get(id)!.name, flat, place(id)))]
      const boss = selectBoss([...state.enemies.keys()].filter((id) => byId.get(id)?.behavior?.type === 'enemy').map((id) => {
        const health = enemyHealth(runtime, id) ?? { health: 0, max: 1 }, at = place(id)
        return { id, name: byId.get(id)!.name, health: health.health, max: health.max, distance: Math.hypot(at.x - flat.x, at.z - flat.z), boss: byId.get(id)!.asset?.type === 'dragon', active: activeEnemy(runtime, id), engaged: state.modes.get(id) === 'chase' } }))
      const day = dayState(doc!.environment, runtime.elapsed), speaker = state.dialogue ? byId.get(state.dialogue.id) : undefined
      const next: HudModel = {
        phase: hudPhase({ outcome: runtime.outcome, paused: state.paused, elapsed: runtime.elapsed, interacted: state.interacted, dismissed: state.dismissed }),
        title: { name: doc!.name, premise: doc!.environment.premise ?? '', objective: status.text },
        health: Math.ceil(runtime.health), maxHealth: runtime.maxHealth, stamina: Math.round(state.stamina), maxStamina: 100, objective: status.text, objectiveDone: status.done,
        tracker: tracker && { ...tracker, distance: whole(tracker.distance), bearing: Math.round(tracker.bearing * 60) / 60 },
        compass: { heading: Math.round(headingFromYaw(player.yaw) * 120) / 120, markers: markers.map((marker) => ({ ...marker, distance: whole(marker.distance), bearing: Math.round(marker.bearing * 90) / 90 })) },
        score: runtime.score, collected: runtime.collected.size, total: runtime.collectibles, defeated: runtime.defeated.size, enemyTotal: runtime.enemies.length,
        time: Math.floor(runtime.elapsed), limit: objectiveLimit(runtime), clock: day ? formatHour(day.hour) : null,
        weapon, weaponLabel: weaponNames[weapon], items: [...runtime.items].map(([name, count]) => ({ name, count })),
        effects: [...runtime.effects].filter(([, seconds]) => seconds > 0).map(([power, seconds]) => ({ power, seconds: Math.ceil(seconds), total: POWER_SECONDS })),
        prompt: foe ? { verb: weaponStats[weapon].kind === 'melee' ? 'Atacar' : 'Mirar', target: foe.name, locked: null, enemy: true, health: foeHealth && foeHealth.max > 1 ? { value: foeHealth.health, max: foeHealth.max } : null }
          : source ? { verb: actionLabels[source.interaction!.action], target: source.name, locked: blocked, enemy: false, health: null } : null,
        boss, dialogue: state.dialogue && { name: state.dialogue.name, line: state.dialogue.line, index: state.dialogue.index, total: state.dialogue.total,
          portrait: speaker?.asset ? portraitFor(speaker.asset.type, speaker.asset.seed, { ...(speaker.asset.character?.skin ? { skin: speaker.asset.character.skin } : {}), ...(speaker.asset.character?.hair ? { hair: speaker.asset.character.hair } : {}), ...(speaker.asset.primary ? { outfit: speaker.asset.primary } : {}) }) : null, options: [] },
        subtitle: settingsRef.current.subtitles && state.subtitle && runtime.elapsed < state.subtitle.until ? { speaker: state.subtitle.speaker, text: state.subtitle.text } : null,
        stats: { time: Math.floor(runtime.elapsed), score: runtime.score, collected: runtime.collected.size, total: runtime.collectibles, defeated: runtime.defeated.size, enemyTotal: runtime.enemies.length, damageTaken: Math.round(state.damageTaken), falls: state.falls },
        fly: player.fly, view: state.view, muted: audioMuted, pointerLocked: state.locked, help: state.help, device: state.device, omitted: state.omitted, fps: null, hurt: state.hurt }
      const key = JSON.stringify(next)
      if (key !== state.hud && (!state.hud || timestamp - state.hudAt >= 100)) { state.hud = key; state.hudAt = timestamp; setHud(next) }
      const anchors: HudAnchor[] = []
      for (const [id, enemy] of state.enemies) {
        const node = byId.get(id)!
        if (runtime.defeated.has(id) || runtime.hidden.has(id) || !visible(built!.holders.get(id)!) || enemy.position.distanceTo(player.position) > 40) continue
        const point = screenOf(enemy.position.clone().setY(enemy.position.y + enemy.height + 0.25))
        if (!point) continue
        const health = node.behavior!.type === 'enemy' ? enemyHealth(runtime, id) : null
        anchors.push({ id, ...point, distance: enemy.position.distanceTo(player.position), name: node.name, kind: node.behavior!.type === 'npc' ? 'npc' : boss?.id === id ? 'boss' : 'enemy', health: health?.health ?? null, max: health?.max ?? null, focus: state.strike === id || state.aim === id })
      }
      overlay.current?.frame(anchors)
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
        objects.push(...built.skins.get(id)?.meshes ?? [])
        if (built.meshes.has(id)) { if (built.meshes.get(id)!.visible) objects.push(built.meshes.get(id)!) }
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
        if (game.paused) return
        game.interacted = true
        if (game.locked) { if (event.button === 2) attack(game, true); else act() }
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
      if (!game?.locked || game.paused) return
      const scale = mouseScale(settingsRef.current)
      game.player.yaw -= event.movementX * scale.x
      game.player.pitch = THREE.MathUtils.clamp(game.player.pitch - event.movementY * scale.y, -1.5, 1.5)
      if (game.device !== 'keyboard') { game.device = 'keyboard'; game.hud = '' }
      game.interacted = true
    }
    const togglePause = (paused = !game?.paused) => {
      if (!game || (game.runtime.outcome !== 'playing' && !game.dismissed)) return
      game.paused = paused
      game.input = emptyInput()
      game.hud = ''
      if (paused && window.document.pointerLockElement === renderer.domElement) window.document.exitPointerLock()
      if (!paused) renderer.domElement.focus()
    }
    const lockChanged = () => {
      if (!game) return
      const locked = window.document.pointerLockElement === renderer.domElement
      if (game.locked && !locked && !game.paused && game.runtime.outcome === 'playing') togglePause(true)
      game.locked = locked; game.hud = ''
    }
    const dodge = (state: NonNullable<typeof game>) => {
      if (state.paused || state.dodge > 0 || state.stamina < 25 || state.player.fly || !state.player.onGround || state.runtime.outcome === 'lost') return
      const input = state.input, side = Number(input.right) - Number(input.left), forward = Number(input.forward) - Number(input.back)
      const direction = new THREE.Vector3(side, 0, -(forward || (side ? 0 : -1))).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), state.player.yaw)
      state.player.velocity.set(direction.x * 9, 2.5, direction.z * 9)
      state.player.onGround = false
      state.stamina -= 25; state.dodge = 0.45; state.dodged = true
      sfx('jump', state.player.position)
    }
    const toggleView = (state: NonNullable<typeof game>) => { state.view = state.view === 'first' ? 'third' : 'first'; state.blade = null; toast(state.view === 'third' ? 'Câmera em terceira pessoa.' : 'Câmera em primeira pessoa.') }
    const toggleFly = (state: NonNullable<typeof game>) => {
      if (doc?.environment.player?.allowFly === false) { toast('O voo está desativado nesta fase.'); return }
      state.player.fly = !state.player.fly; state.player.velocity.set(0, 0, 0); toast(state.player.fly ? 'Voo livre: Espaço sobe, C desce.' : 'Caminhada com gravidade e colisão.')
    }
    const toggleMute = (state: NonNullable<typeof game>) => { audioMuted = !audioMuted; audio?.setMuted(audioMuted || settingsRef.current.volume === 0); state.hud = ''; toast(audioMuted ? 'Som desligado (M).' : 'Som ligado.') }
    pauseRequest.current = (paused) => togglePause(paused)
    dismissRequest.current = () => { if (game) { game.dismissed = true; game.hud = '' } }
    settingsChanged.current = (next) => {
      audio?.setMuted(audioMuted || next.volume === 0)
      quality = next.quality === 'auto' ? softwareGl ? 'low' : 'medium' : next.quality
      const ratio = ratioFor(next.quality)
      renderer.setPixelRatio(ratio); composer.setPixelRatio(ratio)
      fauna?.setQuality(quality); grass?.setQuality(quality); particles.setQuality(quality)
    }
    restartRequest.current = () => { if (game) { stopGame(true); startGame() } }
    lockRequest.current = () => {
      renderer.domElement.focus()
      try { void Promise.resolve(renderer.domElement.requestPointerLock()).catch(() => {}) } catch { /* Pointer lock is optional; drag-to-look remains available. */ }
    }
    const act = () => {
      if (!game || game.paused) return
      if (game.dialogue && overlay.current?.skipTyping()) return
      if (game.aim && !game.strike) interact(game, game.aim)
      else attack(game)
    }
    const keyDown = (event: KeyboardEvent) => {
      if (!game || isTypingTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) return
      if (game.device !== 'keyboard') { game.device = 'keyboard'; game.hud = '' }
      game.interacted = true
      if (event.code === 'Escape') { event.preventDefault(); if (!event.repeat) togglePause(); return }
      if (game.paused) return
      const input = playerKey(event.code)
      if (input) { game.input[input] = true; event.preventDefault(); return }
      if (event.repeat) return
      if (event.code === 'KeyF') { toggleFly(game); return }
      if (event.code === 'KeyV') { toggleView(game); return }
      if (event.code === 'KeyQ') { event.preventDefault(); dodge(game); return }
      if (event.code === 'KeyH') { game.help = !game.help; return }
      if (event.code === 'KeyM') { toggleMute(game); return }
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
    const menu = (event: Event) => { if (game) event.preventDefault() }
    renderer.domElement.addEventListener('contextmenu', menu)
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
        enemies.set(node.id,{...createEnemyMotion(base,ground,enemies.size*1.7),radius,height,eyeHeight:Math.max(0.3,dimensions.y*0.8),moved:false,attackTime:1,step:null,shown:null})
      }
      const routines = planRoutines(doc)
      const focus = navigationFocus([...enemies].map(([id, enemy]) => ({ base: enemy.base, range: byId.get(id)!.behavior!.range })), routinePoints(routines))
      for (const [id, enemy] of enemies) if (byId.get(id)!.behavior?.attack === 'ranged') {
        const binding = rigs.find((item) => item.rootId === id), body = parts.get(id) ?? []
        const tip = body.find((node) => /^(staffGem|muzzle|barrelTip)$/i.test(node.assetPart ?? ''))
          ?? (binding && ['quadruped', 'arachnid', 'flyer'].includes(binding.kind) ? body.find((node) => /^(snout|nose|jaw|head)$/i.test(node.assetPart ?? '')) : undefined)
        if (tip) {
          enemy.equipment = bindEmitter(built!.holders.get(tip.id)!, new THREE.Vector3(0, 0, tip.dimensions[2] * 0.5 + 0.04))
          continue
        }
        const equipment = createEquipment('blaster')
        if (!binding || !mountEquipment(equipment, binding, built!.holders)) {
          built!.holders.get(id)!.add(equipment.object)
          equipment.object.position.set(0, enemy.height * 0.55, enemy.radius)
        }
        enemy.equipment = equipment
      }
      const avatarRig = createAvatar(settings.avatar ?? 'explorer', settings.weapon ?? 'none'), avatar = new THREE.Group()
      avatar.add(avatarRig.built.root)
      avatar.rotation.y = THREE.MathUtils.degToRad(settings.yaw) + Math.PI
      avatar.visible = false
      scene.add(avatar)
      audio ??= createAudioEngine()
      audio?.setMuted(audioMuted || settingsRef.current.volume === 0)
      audio?.start(doc)
      game = { runtime: createRuntime(doc, time), input: emptyInput(), collider: { bvh, boxes: [], floor, climb },
        player: { position: spawn, velocity: new THREE.Vector3(), yaw: settings.spawn ? THREE.MathUtils.degToRad(settings.yaw) : 0, pitch: -0.05, onGround: false, fly: settings.mode === 'fly' && settings.allowFly !== false },
        saved: { position: camera.position.clone(), target: controls.target.clone(), fov: camera.fov, near: camera.near, far: camera.far }, last: null, aim: null, strike: null, hud: '', locked: false, help: false,
        view: settings.camera ?? 'first', spawn: spawn.clone(), stride: 0, sounds: doc.nodes.filter((node) => node.sound), projectiles: [], attackCooldown: 0, swing: 0, hudAt: 0, platforms: new Map(), modes: new Map(), rigMotion: new Map(), avatarRig, swings: 0, heavy: false, meleeHits: new Set(), blade: null, dialogue: null, spawnNotice: -10, enemies, enemyParts:new Set([...enemies.keys()].flatMap(id=>[...subtreeIds(doc!.nodes,id)])),parts, water, avatar, hurt: 0, goalCooldown: 0,
        nav: null, router: createRouter(null), routines, paused: false, dismissed: false, interacted: false, device: 'keyboard', pad: createGamepadState(), stamina: 100, dodge: 0, dodged: false,
        damageTaken: 0, falls: 0, lastHealth: settings.health ?? 100, subtitle: null, greeted: new Map(), omitted, guards: new Set([...enemies.keys()].filter((id) => isGuardPlan(routines.get(id)))) }
      const session = game
      if (enemies.size) void buildNavigation(entries, focus, { radius: 0.35, height: 1.7, climb: 0.27 }, { floor }).then((nav) => {
        if (game === session && nav) { game.nav = nav; game.router = createRouter(nav) } else nav?.dispose()
      })
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
      game.nav?.dispose()
      game.avatar.removeFromParent()
      game.avatarRig.equipment.dispose()
      for (const enemy of game.enemies.values()) enemy.equipment?.dispose()
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
        windSpecs = windKinds(next); usedGeometries = new Set()
        const isWater = (node: SceneNode) => node.material.texture === 'water' && !node.material.textureImage
        built = buildScene(next, resources, { instancing: true, helpers: true,
          variant: (node) => { const spec = windSpecs.get(node.id); return spec ? { key: `wind:${windKey(spec)}`, prepare: (material) => applyWind(material, wind, spec.kind, spec.stiffness) } : null },
          geometry: (node) => windSpecs.get(node.id)?.kind === 'flag' || isWater(node) ? worldGeometry(node) : null,
          skins: (document, holders) => buildCharacterSkins(document, holders, { quality, shadows: document.environment.shadows ?? true }) })
        attachWindShadows(built.root)
        for (const [key, geometry] of worldGeometries) if (!usedGeometries.has(key)) { geometry.dispose(); worldGeometries.delete(key) }
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
        field?.dispose(); field = buildGroundField(next)
        wind.setGround(field); wind.setStrength(env.motion?.wind ?? DEFAULT_MOTION.wind)
        for (const material of waterMaterials) if (material instanceof THREE.MeshPhysicalMaterial) prepareWater(material, wind, field)
        grass?.object.removeFromParent(); grass?.dispose(); grass = null
        const density = env.motion?.grass ?? 'auto'
        if (field && density !== 'none' && env.sky !== 'space') { grass = createGrass(field, wind, { density, quality }); if (grass) scene.add(grass.object) }
        particles.setEmitters(emitterSources(sceneEmitters(next), built.holders))
        fauna?.object.removeFromParent(); fauna?.dispose()
        fauna = createFauna(planFauna(next), null, quality)
        scene.add(fauna.object)
        practical = []; glowing = []
        if (next.environment.dayCycle?.enabled) for (const node of next.nodes) {
          const owner = node.parentId ? byId.get(node.parentId) : undefined
          if (!owner?.asset?.lit) continue
          const holder = built.holders.get(node.id)
          if (node.kind === 'light') holder?.traverse((object) => { if (object instanceof THREE.PointLight || object instanceof THREE.SpotLight) practical.push({ light: object, base: object.intensity }) })
          const material = built.meshes.get(node.id)?.material
          if (material instanceof THREE.MeshPhysicalMaterial && material.emissiveIntensity > 0.5 && !glowing.some((item) => item.material === material)) glowing.push({ material, base: material.emissiveIntensity })
        }
        applyDay(env, 0)
        ambientMotion = (env.weather ?? 'none') !== 'none' || fauna.object.children.length > 0 || (env.motion?.wind ?? DEFAULT_MOTION.wind) > 0 || !!grass
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
      renderer.domElement.removeEventListener('contextmenu', menu)
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
      game?.nav?.dispose()
      game?.avatarRig.equipment.dispose()
      game?.avatarRig.built.dispose(); game?.avatarRig.resources.dispose()
      if (game) for (const enemy of game.enemies.values()) enemy.equipment?.dispose()
      audio?.dispose()
      projectileGeometry.dispose()
      for (const material of projectileMaterials.values()) material.dispose()
      built?.dispose()
      resources.dispose()
      rig.dispose()
      composer.dispose()
      fauna?.dispose(); grass?.dispose(); particles.dispose(); wind.dispose(); field?.dispose()
      for (const geometry of worldGeometries.values()) geometry.dispose()
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
    {playMode && hud && <ThreeHud model={{ ...hud, fps: settings.showFps && !presentation ? stats.fps || null : null }} toasts={toasts} overlay={overlay} settings={settings} presentation={presentation}
      onResume={() => pauseRequest.current(false)} onRestart={() => restartRequest.current()} onExit={() => callbacks.current.onExitPlay()}
      onDismissOutcome={() => dismissRequest.current()} onCaptureMouse={() => lockRequest.current()} onPause={() => pauseRequest.current(true)} onSettings={setSettings} />}
    <div className="three-viewport__footer"><span>{playMode ? 'WASD anda · mouse olha · E interage/ataca · V câmera · H ajuda · Esc sai' : 'Arraste para orbitar · Scroll para zoom · Botão direito para mover · ? atalhos'}</span>
      <span aria-label="Estatísticas do renderer">{stats.triangles.toLocaleString('pt-BR')} triângulos · {stats.calls} draw calls{stats.fps ? ` · ${stats.fps} FPS` : ''}</span></div>
  </section>
}
