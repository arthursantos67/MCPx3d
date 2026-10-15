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
import { buildScene, createResources, HELPER_LAYER, pickNodeId, surfaceMatrix, type BuiltScene } from './sceneBuild.ts'
import { hasSurface, INTERACTION_KEYS, subtreeIds, type SceneNode, type ThreeSceneDocument, type Vector3Tuple } from './sceneDocument.ts'
import { createEnvironmentRig, SKY_LAYER } from './sceneEnvironment.ts'
import { createOcclusionPass } from './sceneOcclusion.ts'
import { isTypingTarget, playControlList, playerKey } from './sceneKeyboard.ts'
import { boxFromMatrix, buildStaticCollider, capsuleTouches, emptyInput, findWalkableSpawn, PLAYER_EYE, stepPlayer, type PlayerBox, type PlayerCollider, type PlayerInput, type PlayerState } from './scenePlayer.ts'
import { actionLabels, advanceRuntime, checkOutcome, createRuntime, damagePlayer, defeatEnemy, interactionAvailable, objectiveStatus, pressInteractionKey, reachGoal, runtimePose, runtimeVisible, triggerInteraction, updateProximity, type SceneRuntime } from './sceneRuntime.ts'

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
interface HudState { locked: boolean; prompt: string; collected: number; total: number; fly: boolean; help: boolean; omitted: number; health: number; maxHealth: number; objective: string; time: number; limit: number; outcome: 'playing' | 'won' | 'lost'; view: 'first' | 'third'; hurt: number; enemies: string }
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
  const [hud, setHud] = useState<HudState>({ locked: false, prompt: '', collected: 0, total: 0, fly: false, help: false, omitted: 0, health: 100, maxHealth: 100, objective: '', time: 0, limit: 0, outcome: 'playing', view: 'first', hurt: 0, enemies: '' })
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
    composer.addPass(outline)
    const output = new OutputPass()
    composer.addPass(output)
    const resources = createResources(Math.min(8, renderer.capabilities.getMaxAnisotropy()))
    let doc: ThreeSceneDocument | null = null, built: BuiltScene | null = null
    let animatedNodes: SceneNode[] = [], byId = new Map<string, SceneNode>()
    let playback = false, time = 0, duration = 20
    let lastTimestamp: number | null = null, lastReport = 0, fpsFrames = 0, fpsStarted = 0
    let selected: string | null = null, gizmoMode: GizmoMode = 'translate', snapping = false
    let proxies: THREE.Mesh[] = [], suppressed = new Set<string>()
    let enabled = false, lost = false, disposed = false, frame = 0
    interface EnemyState extends EnemyMotion { radius:number; height:number; eyeHeight:number }
    let game: { runtime: SceneRuntime; player: PlayerState; input: PlayerInput; collider: PlayerCollider; saved: { position: THREE.Vector3; target: THREE.Vector3; fov: number; near: number; far: number }; last: number | null; aim: string | null; strike: string | null; hud: string; locked: boolean; help: boolean
      view: 'first' | 'third'; spawn: THREE.Vector3; enemies: Map<string, EnemyState>; enemyParts:Set<string>; parts: Map<string, SceneNode[]>; water: number | null; avatar: THREE.Group; hurt: number; goalCooldown: number } | null = null
    const avatarMaterials = [new THREE.MeshStandardMaterial({ color: '#3d6fae', roughness: 0.6 }), new THREE.MeshStandardMaterial({ color: '#f1c9a5', roughness: 0.7 }), new THREE.MeshStandardMaterial({ color: '#1d2433', roughness: 0.4 })]
    const avatarGeometries = [new THREE.CapsuleGeometry(0.28, 0.75, 6, 12), new THREE.SphereGeometry(0.22, 16, 12), new THREE.BoxGeometry(0.3, 0.08, 0.06)]
    const createAvatar = () => {
      const avatar = new THREE.Group(), body = new THREE.Mesh(avatarGeometries[0], avatarMaterials[0]), head = new THREE.Mesh(avatarGeometries[1], avatarMaterials[1]), visor = new THREE.Mesh(avatarGeometries[2], avatarMaterials[2])
      body.position.y = 0.72; head.position.y = 1.48; visor.position.set(0, 1.5, -0.2)
      for (const part of [body, head, visor]) { part.castShadow = true; avatar.add(part) }
      avatar.visible = false
      return avatar
    }
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
    const gameFrame = (timestamp: number) => {
      const state = game!, delta = state.last === null ? 0 : Math.min(0.1, (timestamp - state.last) / 1000)
      state.last = timestamp
      advanceRuntime(state.runtime, delta)
      for (const node of animatedNodes) {
        const pose = runtimePose(state.runtime, node), holder = built!.holders.get(node.id)!
        holder.position.fromArray(pose.position)
        holder.rotation.set(...pose.rotation.map(THREE.MathUtils.degToRad) as [number, number, number])
        holder.scale.fromArray(pose.scale)
      }
      for (const id of built!.dynamic) built!.holders.get(id)!.visible = runtimeVisible(state.runtime, byId.get(id)!)
      scene.updateMatrixWorld(true)
      const runtime = state.runtime, player = state.player
      const enemyCollider={...state.collider,boxes:[...built!.dynamic].filter(id=>!state.enemyParts.has(id)).flatMap(id=>{const node=byId.get(id)!,holder=built!.holders.get(id)!;return hasSurface(node.kind)&&node.collidable!==false&&visible(holder)?[boxFromMatrix(surfaceMatrix(holder,node))]:[]})}
      for (const [id, enemy] of state.enemies) {
        if (runtime.defeated.has(id)||!visible(built!.holders.get(id)!)) continue
        const behavior = byId.get(id)!.behavior!, holder = built!.holders.get(id)!
        stepEnemyMotion(enemy,{...behavior,radius:enemy.radius,height:enemy.height,eyeHeight:enemy.eyeHeight},player.position,enemyCollider,delta,runtime.outcome==='playing')
        const world=enemy.position.clone(),heading=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),enemy.heading)
        if(holder.parent) {holder.position.copy(holder.parent.worldToLocal(world));heading.premultiply(holder.parent.getWorldQuaternion(new THREE.Quaternion()).invert())}
        else holder.position.copy(world)
        holder.quaternion.copy(heading)
      }
      scene.updateMatrixWorld(true)
      state.collider.boxes=[...built!.dynamic].flatMap(id=>{const node=byId.get(id)!,holder=built!.holders.get(id)!;return hasSurface(node.kind)&&node.collidable!==false&&visible(holder)?[boxFromMatrix(surfaceMatrix(holder,node))]:[]})
      const partBoxes = (id: string) => (state.parts.get(id) ?? []).flatMap((node) => { const holder = built!.holders.get(node.id)!; return visible(holder) ? [boxFromMatrix(surfaceMatrix(holder, node))] : [] })
      const fall = player.velocity.y
      if (runtime.outcome !== 'lost') stepPlayer(player, state.input, state.collider, doc!.environment.player!, delta)
      state.goalCooldown = Math.max(0, state.goalCooldown - delta)
      const hurt = (amount: number, away: THREE.Vector3 | null) => {
        if (!damagePlayer(runtime, amount)) return
        state.hurt++
        if (away) { away.setY(0).normalize().multiplyScalar(6); player.velocity.set(away.x, 4, away.z) }
      }
      for (const [id, parts] of state.parts) {
        const behavior = byId.get(id)?.behavior
        if (!behavior || runtime.hidden.has(id) || !parts.length || runtime.outcome !== 'playing') continue
        const boxes: PlayerBox[] = partBoxes(id)
        const touching = (margin: number) => boxes.some((box) => capsuleTouches(player.position, box, margin))
        if (behavior.type === 'enemy' && !runtime.defeated.has(id) && touching(0.08)) {
          const top = Math.max(...boxes.map((box) => box.center.y + box.half.y))
          if (Math.min(fall, player.velocity.y) < -1 && player.position.y > top - 0.6) { defeatEnemy(runtime, id); player.velocity.y = 7; toast(`${byId.get(id)!.name} derrotado!`) }
          else hurt(behavior.damage, player.position.clone().sub(boxes[0].center))
        }
        if (behavior.type === 'hazard' && touching(0.02)) { hurt(behavior.damage, null); if (player.velocity.y < 5) player.velocity.y = 5 }
        if (behavior.type === 'checkpoint' && touching(0.4) && !runtime.checkpoints.has(id)) { runtime.checkpoints.add(id); runtime.checkpoint = player.position.toArray(); toast('Ponto de controle salvo.') }
        if (behavior.type === 'goal' && touching(0.3) && !state.goalCooldown) { state.goalCooldown = 2; const message = reachGoal(runtime); if (message) toast(message) }
      }
      if (state.water !== null && !player.fly && player.position.y < state.water - 0.7) { runtime.invulnerable = 0; hurt(25, null); toast('Você caiu na água!'); player.position.copy(runtime.checkpoint ? new THREE.Vector3(...runtime.checkpoint) : state.spawn); player.velocity.set(0, 0, 0) }
      if (runtime.health <= 0 && runtime.outcome === 'playing') {
        runtime.health = runtime.maxHealth
        player.position.copy(runtime.checkpoint ? new THREE.Vector3(...runtime.checkpoint) : state.spawn); player.velocity.set(0, 0, 0)
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
        state.avatar.rotation.y = player.yaw
      } else { camera.position.copy(head); state.avatar.visible = false }
      camera.updateMatrixWorld()
      const positions = new Map<string, Vector3Tuple>()
      for (const node of state.runtime.nodes) if (node.interaction?.trigger === 'proximity') positions.set(node.id, built!.holders.get(node.id)!.getWorldPosition(new THREE.Vector3()).toArray())
      for (const message of updateProximity(state.runtime, [state.player.position.x, state.player.position.y + 0.9, state.player.position.z], positions)) toast(message)
      raycaster.set(head, new THREE.Vector3(0, 0, -1).applyEuler(orientation))
      raycaster.far = 50
      const hit = raycaster.intersectObjects(built!.pickables, false).find((item) => visible(item.object) && !(item.object.layers.mask === 1 << HELPER_LAYER))
      const chain = hit ? nodeChain(pickNodeId(hit)) : []
      const foe = hit && hit.distance <= 2.8 ? chain.find((node) => node.behavior?.type === 'enemy' && !runtime.defeated.has(node.id)) : undefined
      const source = hit && !foe ? chain.find((node) => node.interaction && node.interaction.trigger === 'click' && interactionAvailable(runtime, node) && hit.distance <= node.interaction.radius) : undefined
      state.aim = source?.id ?? null
      state.strike = foe?.id ?? null
      const status = objectiveStatus(runtime)
      const next: HudState = { locked: state.locked, prompt: foe ? `Atacar · ${foe.name}` : source ? `${actionLabels[source.interaction!.action]} · ${source.name}` : '', collected: runtime.collected.size, total: runtime.collectibles, fly: player.fly, help: state.help, omitted: 0,
        health: Math.ceil(runtime.health), maxHealth: runtime.maxHealth, objective: status.text, time: Math.floor(runtime.elapsed), limit: runtime.objective.timeLimit, outcome: runtime.outcome, view: state.view, hurt: state.hurt,
        enemies: runtime.enemies.length ? `${runtime.defeated.size}/${runtime.enemies.length}` : '' }
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
      for (const node of animatedNodes) {
        const holder = built.holders.get(node.id)!, pose = sampleNodeTransform(node, time)
        holder.position.fromArray(pose.position)
        holder.rotation.set(...pose.rotation.map(THREE.MathUtils.degToRad) as [number, number, number])
        holder.scale.fromArray(pose.scale)
      }
      scene.updateMatrixWorld(true)
      render()
      if (playback) { countFrame(timestamp); if (timestamp - lastReport > 100) { lastReport = timestamp; callbacks.current.onTimeChange(time) } }
      if (playback && enabled && !lost && !disposed) frame = requestAnimationFrame(draw)
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
      if (game.strike) { const name = byId.get(game.strike)?.name ?? 'Inimigo'; if (defeatEnemy(game.runtime, game.strike)) toast(`${name} derrotado!`); return }
      if (game.aim) { const message = triggerInteraction(game.runtime, game.aim); if (message) toast(message) }
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
      for (const node of doc.nodes) if (node.behavior?.type === 'enemy'&&visible(built.holders.get(node.id)!)) {
        const base = built.holders.get(node.id)!.getWorldPosition(new THREE.Vector3())
        let ground = floor
        if (bvh) { probe.origin.set(base.x, base.y + 0.27, base.z); probe.direction.set(0, -1, 0); const hit = bvh.raycastFirst(probe, THREE.DoubleSide); if (hit) ground = hit.point.y }
        const dimensions=new THREE.Box3().setFromObject(built.holders.get(node.id)!).getSize(new THREE.Vector3())
        const height=Math.max(0.5,dimensions.y),radius=Math.max(0.15,Math.min(0.8,Math.max(dimensions.x,dimensions.z)*0.4,height*0.45))
        enemies.set(node.id,{...createEnemyMotion(base,ground,enemies.size*1.7),radius,height,eyeHeight:Math.max(0.3,dimensions.y*0.8)})
      }
      const avatar = createAvatar()
      scene.add(avatar)
      game = { runtime: createRuntime(doc, time), input: emptyInput(), collider: { bvh, boxes: [], floor, climb },
        player: { position: spawn, velocity: new THREE.Vector3(), yaw: settings.spawn ? THREE.MathUtils.degToRad(settings.yaw) : 0, pitch: -0.05, onGround: false, fly: settings.mode === 'fly' && settings.allowFly !== false },
        saved: { position: camera.position.clone(), target: controls.target.clone(), fov: camera.fov, near: camera.near, far: camera.far }, last: null, aim: null, strike: null, hud: '', locked: false, help: false,
        view: settings.camera ?? 'first', spawn: spawn.clone(), enemies, enemyParts:new Set([...enemies.keys()].flatMap(id=>[...subtreeIds(doc!.nodes,id)])),parts, water, avatar, hurt: 0, goalCooldown: 0 }
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
      game = null
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
        duration = next.timeline.duration
        time = Math.min(time, duration)
        const env = next.environment
        const exposure = rig.apply(env)
        bloom.enabled = (env.bloom ?? 0) > 0
        bloom.strength = env.bloom ?? 0
        bloom.threshold = Math.max(1, 1 / exposure)
        occlusion.enabled = !!env.ambientOcclusion
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
      built?.dispose()
      resources.dispose()
      rig.dispose()
      composer.dispose()
      bloom.dispose(); outline.dispose(); occlusion.dispose(); output.dispose()
      target.dispose()
      ground.geometry.dispose()
      ground.material.dispose()
      for (const item of [...avatarGeometries, ...avatarMaterials]) item.dispose()
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
        <span>{hud.fly ? 'Voo' : hud.view === 'third' ? '3ª pessoa' : '1ª pessoa'}{!presentation ? ` · ${stats.fps} FPS` : ''}</span>
        <button type="button" onClick={() => callbacks.current.onExitPlay()}>Sair do jogo</button>
      </div>
      {hud.prompt && <p className="three-hud__prompt"><kbd>E</kbd> {hud.prompt}</p>}
      {!hud.locked && <button type="button" className="three-hud__capture" onClick={() => lockRequest.current()}>Clique para capturar o mouse · ou arraste para olhar</button>}
      <ul className="three-hud__toasts" role="status">{toasts.map((item) => <li key={item.id}>{item.text}</li>)}</ul>
      {hud.omitted > 0 && <p className="three-hud__warning">{hud.omitted.toLocaleString('pt-BR')} triângulos ficaram fora da colisão para respeitar o orçamento.</p>}
      {hud.outcome !== 'playing' && dismissed !== hud.outcome && <div className="three-hud__outcome" role="dialog" aria-label={hud.outcome === 'won' ? 'Vitória' : 'Fim de jogo'}>
        <strong>{hud.outcome === 'won' ? 'Vitória!' : 'Tempo esgotado'}</strong>
        <p>{`${Math.floor(hud.time / 60)}:${String(hud.time % 60).padStart(2, '0')}`}{hud.total ? ` · itens ${hud.collected}/${hud.total}` : ''}{hud.enemies ? ` · inimigos ${hud.enemies}` : ''}</p>
        <div>{hud.outcome === 'won' && <button type="button" onClick={() => setDismissed('won')}>Continuar explorando</button>}<button type="button" onClick={() => { setDismissed(null); restartRequest.current() }}>Jogar de novo</button><button type="button" onClick={() => callbacks.current.onExitPlay()}>Sair</button></div>
      </div>}
      {hud.help && <dl className="three-hud__help" aria-label="Controles do jogo">{playControlList.map(([keys, label]) => <div key={keys}><dt>{keys}</dt><dd>{label}</dd></div>)}</dl>}
      {!hud.help && <p className="three-hud__controls">WASD mover · Mouse olhar · Espaço pular · E interagir · H ajuda · Esc sair</p>}
    </div>}
    <div className="three-viewport__footer"><span>{playMode ? 'WASD anda · mouse olha · E interage/ataca · V câmera · H ajuda · Esc sai' : 'Arraste para orbitar · Scroll para zoom · Botão direito para mover · ? atalhos'}</span>
      <span aria-label="Estatísticas do renderer">{stats.triangles.toLocaleString('pt-BR')} triângulos · {stats.calls} draw calls{stats.fps ? ` · ${stats.fps} FPS` : ''}</span></div>
  </section>
}
