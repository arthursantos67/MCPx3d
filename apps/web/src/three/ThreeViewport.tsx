import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { buildNodeGeometry, geometryKey } from './sceneGeometry.ts'
import { proceduralTexture } from './sceneTextures.ts'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { sampleNodeTransform } from './sceneAnimation.ts'
import type { SceneNode, ThreeSceneDocument } from './sceneDocument.ts'

interface Props { document: ThreeSceneDocument; selectedId: string | null; active: boolean; fitRequest: number; playing: boolean; seekTime: number; seekRequest: number; onTimeChange: (time: number) => void; onSelect: (id: string | null) => void }
interface ViewportEngine {
  update: (document: ThreeSceneDocument) => void
  select: (id: string | null) => void
  fit: () => void
  play: (playing: boolean) => void
  seek: (seconds: number) => void
  activate: (active: boolean) => void
}
export default function ThreeViewport({ document, selectedId, active, fitRequest, playing, seekTime, seekRequest, onTimeChange, onSelect }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const engine = useRef<ViewportEngine | null>(null)
  const timeCallback = useRef(onTimeChange)
  useEffect(() => { timeCallback.current = onTimeChange }, [onTimeChange])
  const selectCallback = useRef(onSelect)
  useEffect(() => { selectCallback.current = onSelect }, [onSelect])
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState({ calls: 0, triangles: 0 })

  useEffect(() => {
    const container = host.current!
    let renderer: THREE.WebGLRenderer
    try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }) }
    // The graphics context is an external resource; expose initialization failure.
    // oxlint-disable-next-line react/set-state-in-effect
    catch { setError('WebGL2 indisponível. Ative a aceleração gráfica ou use outro navegador. Você ainda pode editar e exportar o projeto.'); return }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    const room = new RoomEnvironment()
    const pmrem = new THREE.PMREMGenerator(renderer)
    const reflection = pmrem.fromScene(room, 0.04)
    room.dispose()
    pmrem.dispose()
    renderer.domElement.setAttribute('aria-label', 'Cena Three.js interativa')
    renderer.domElement.setAttribute('role', 'img')
    container.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    const content = new THREE.Group()
    scene.add(content)
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000)
    camera.position.set(16, 11, 18)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 1, 0)
    // Drawing on change avoids a permanent animation loop while the editor is idle.
    controls.enableDamping = false
    controls.minDistance = 0.1
    const sky = new THREE.HemisphereLight('#ffffff', '#657583', 2)
    const sun = new THREE.DirectionalLight('#fff1dd', 3)
    sun.position.set(6, 12, 8)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.normalBias = 0.025
    sun.shadow.bias = -0.0001
    scene.add(sky, sun, sun.target)
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.24 }))
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    scene.add(ground)
    const grid = new THREE.GridHelper(40, 40, '#8fadb8', '#c5d3db')
    grid.position.y = -0.005
    scene.add(grid)
    const highlight = new THREE.BoxHelper(new THREE.Object3D(), '#e7a83e')
    highlight.visible = false
    scene.add(highlight)
    const geometries = new Map<string, THREE.BufferGeometry>()
    const materials = new Map<string, THREE.MeshPhysicalMaterial>()
    const textures = new Map<string, THREE.Texture>()
    let objects = new Map<string, THREE.Object3D>()
    let meshes: THREE.Mesh[] = []
    let animatedNodes: SceneNode[] = []
    let playback = false, time = 0, duration = 20
    let lastTimestamp: number | null = null, lastReport = 0
    let selected: string | null = null
    let enabled = false
    let lost = false
    let disposed = false
    let frame = 0
    const visible = (object: THREE.Object3D): boolean => {
      for (let current: THREE.Object3D | null = object; current; current = current.parent) if (!current.visible) return false
      return true
    }
    const updateHighlight = () => {
      const object = objects.get(selected ?? '')
      highlight.visible = !!object && visible(object) && !new THREE.Box3().setFromObject(object).isEmpty()
      if (highlight.visible && object) highlight.setFromObject(object)
    }
    const draw = (timestamp: number) => {
      frame = 0
      if (!enabled || lost || disposed || !container.clientWidth || !container.clientHeight) return
      if (playback) {
        if (lastTimestamp !== null) time = (time + Math.min((timestamp - lastTimestamp) / 1000, 0.1)) % duration
        lastTimestamp = timestamp
      }
      for (const node of animatedNodes) {
        const object = objects.get(node.id)!
        const pose = sampleNodeTransform(node, time)
        object.position.fromArray(pose.position)
        object.rotation.set(...pose.rotation.map(THREE.MathUtils.degToRad) as [number, number, number])
      }
      scene.updateMatrixWorld(true)
      updateHighlight()
      renderer.render(scene, camera)
      const { calls, triangles } = renderer.info.render
      setStats((previous) => previous.calls === calls && previous.triangles === triangles ? previous : { calls, triangles })
      if (playback && timestamp - lastReport > 100) { lastReport = timestamp; timeCallback.current(time) }
      if (playback && enabled && !lost && !disposed) frame = requestAnimationFrame(draw)
    }
    const invalidate = () => { if (enabled && !lost && !disposed && !frame) frame = requestAnimationFrame(draw) }
    const resize = () => {
      const width = container.clientWidth, height = container.clientHeight
      if (!width || !height) return
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      invalidate()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    controls.addEventListener('change', invalidate)
    const raycaster = new THREE.Raycaster()
    let pointerStart: [number, number] | null = null
    const down = (event: PointerEvent) => { pointerStart = event.button === 0 ? [event.clientX, event.clientY] : null }
    const up = (event: PointerEvent) => {
      const start = pointerStart
      pointerStart = null
      if (!start || Math.hypot(event.clientX - start[0], event.clientY - start[1]) > 4) return
      const rect = renderer.domElement.getBoundingClientRect()
      raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera)
      scene.updateMatrixWorld(true)
      const hit = raycaster.intersectObjects(meshes, false).find((intersection) => visible(intersection.object))
      selectCallback.current(hit ? hit.object.userData.nodeId as string : null)
    }
    const cancel = () => { pointerStart = null }
    const contextLost = (event: Event) => {
      event.preventDefault()
      lost = true
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      setError('O contexto gráfico foi perdido. Seu projeto está preservado; recarregue a página para recuperar o viewport.')
    }
    const contextRestored = () => { lost = false; setError(null); invalidate() }
    renderer.domElement.addEventListener('pointerdown', down)
    renderer.domElement.addEventListener('pointerup', up)
    renderer.domElement.addEventListener('pointercancel', cancel)
    renderer.domElement.addEventListener('webglcontextlost', contextLost)
    renderer.domElement.addEventListener('webglcontextrestored', contextRestored)
    engine.current = {
      update(doc) {
        content.clear()
        objects = new Map()
        meshes = []
        animatedNodes = doc.nodes.filter((node) => node.animation.kind !== 'none')
        duration = doc.timeline.duration
        time = Math.min(time, duration)
        const usedGeometries = new Set<string>(), usedMaterials = new Set<string>()
        for (const node of doc.nodes) {
          let object: THREE.Object3D
          if (node.kind === 'group') object = new THREE.Group()
          else {
            const key = geometryKey(node)
            usedGeometries.add(key)
            let geometry = geometries.get(key)
            if (!geometry) { geometry = buildNodeGeometry(node); geometries.set(key, geometry) }
            const materialKey = JSON.stringify([node.material, doc.environment.wireframe])
            usedMaterials.add(materialKey)
            let material = materials.get(materialKey)
            if (!material) {
              const { texture, textureScale, textureImage, doubleSided, ...physical } = node.material
              const textureKey = textureImage || (texture && texture !== 'none' ? `${texture}:${textureScale}` : '')
              let map = textureKey ? textures.get(textureKey) : undefined
              if (textureKey && !map) {
                map = textureImage ? new THREE.TextureLoader().load(textureImage, invalidate, undefined, () => setError('Uma textura do projeto não pôde ser carregada.')) : proceduralTexture(texture, textureScale)
                map.colorSpace = THREE.SRGBColorSpace
                if (textureImage) map.flipY = false
                map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
                textures.set(textureKey, map)
              }
              material = new THREE.MeshPhysicalMaterial({ ...physical, map: map ?? null, wireframe: doc.environment.wireframe, transparent: physical.transparent || (physical.opacity ?? 1) < 1, side: doubleSided || node.kind === 'tube' ? THREE.DoubleSide : THREE.FrontSide })
              materials.set(materialKey, material)
            }
            const mesh = new THREE.Mesh(geometry, material)
            mesh.scale.fromArray(node.dimensions)
            mesh.castShadow = true
            mesh.receiveShadow = true
            meshes.push(mesh)
            object = mesh
          }
          object.scale.multiply(new THREE.Vector3(...node.scale))
          object.position.fromArray(node.position)
          object.rotation.set(...node.rotation.map(THREE.MathUtils.degToRad) as [number, number, number])
          object.visible = node.visible
          object.name = node.name
          object.userData.nodeId = node.id
          objects.set(node.id, object)
        }
        for (const node of doc.nodes) (objects.get(node.parentId ?? '') ?? content).add(objects.get(node.id)!)
        for (const [key, geometry] of geometries) if (!usedGeometries.has(key)) { geometry.dispose(); geometries.delete(key) }
        for (const [key, material] of materials) if (!usedMaterials.has(key)) { material.dispose(); materials.delete(key) }
        const activeTextures = new Set([...materials.values()].flatMap((material) => material.map ? [material.map] : []))
        for (const [key, texture] of textures) if (!activeTextures.has(texture)) { texture.dispose(); textures.delete(key) }
        scene.environment = doc.environment.reflections ? reflection.texture : null
        renderer.shadowMap.enabled = doc.environment.shadows ?? true
        ground.visible = !!doc.environment.shadows && doc.nodes.length > 0
        scene.updateMatrixWorld(true)
        const bounds = new THREE.Box3().setFromObject(content)
        if (!bounds.isEmpty()) {
          const center = bounds.getCenter(new THREE.Vector3()), radius = Math.min(2000, Math.max(3, bounds.getSize(new THREE.Vector3()).length() / 2))
          sun.position.copy(center).add(new THREE.Vector3(1, 2, 1.5).multiplyScalar(radius))
          sun.target.position.copy(center)
          Object.assign(sun.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius, near: 0.1, far: radius * 6 })
          sun.shadow.camera.updateProjectionMatrix()
          ground.position.set(center.x, bounds.min.y - 0.01, center.z)
          ground.scale.set(radius * 4, radius * 4, 1)
        }
        scene.background = new THREE.Color(doc.environment.background)
        renderer.toneMappingExposure = doc.environment.exposure
        sky.intensity = doc.environment.lightIntensity
        sun.intensity = doc.environment.lightIntensity * 2
        grid.visible = doc.environment.grid
        scene.updateMatrixWorld(true)
        invalidate()
      },
      select(id) { selected = id; invalidate() },
      fit() {
        const object = objects.get(selected ?? '') ?? content
        const box = new THREE.Box3().setFromObject(object)
        const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3())
        const radius = box.isEmpty() ? 8 : Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.5)
        const direction = camera.position.clone().sub(controls.target).normalize()
        if (!direction.lengthSq()) direction.set(1, 0.7, 1.1).normalize()
        const right = new THREE.Vector3().crossVectors(camera.up, direction).normalize(), up = new THREE.Vector3().crossVectors(direction, right).normalize()
        const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
        let distance = box.isEmpty() ? 12 : 1
        if (!box.isEmpty()) for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
          const corner = new THREE.Vector3(x, y, z).sub(center)
          distance = Math.max(distance, corner.dot(direction) + Math.max(Math.abs(corner.dot(right)) / (tangent * camera.aspect), Math.abs(corner.dot(up)) / tangent))
        }
        distance *= 1.12
        camera.position.copy(center).add(direction.multiplyScalar(distance))
        camera.near = Math.max(0.001, radius / 1000)
        camera.far = Math.max(1000, distance * 100)
        camera.updateProjectionMatrix()
        controls.maxDistance = distance * 20
        controls.target.copy(center)
        controls.update()
        invalidate()
      },
      play(value) { playback = value; lastTimestamp = null; invalidate() },
      seek(seconds) { time = Math.min(duration, Math.max(0, seconds)); lastTimestamp = null; timeCallback.current(time); invalidate() },
      activate(value) {
        enabled = value
        lastTimestamp = null
        if (!value && frame) { cancelAnimationFrame(frame); frame = 0 }
        if (value) { resize(); invalidate() }
      },
    }
    return () => {
      disposed = true
      engine.current = null
      if (frame) cancelAnimationFrame(frame)
      observer.disconnect()
      controls.removeEventListener('change', invalidate)
      controls.dispose()
      renderer.domElement.removeEventListener('pointerdown', down)
      renderer.domElement.removeEventListener('pointerup', up)
      renderer.domElement.removeEventListener('pointercancel', cancel)
      renderer.domElement.removeEventListener('webglcontextlost', contextLost)
      renderer.domElement.removeEventListener('webglcontextrestored', contextRestored)
      for (const geometry of geometries.values()) geometry.dispose()
      for (const material of materials.values()) material.dispose()
      reflection.dispose()
      ground.geometry.dispose()
      ground.material.dispose()
      for (const texture of textures.values()) texture.dispose()
      grid.geometry.dispose()
      for (const material of Array.isArray(grid.material) ? grid.material : [grid.material]) material.dispose()
      highlight.geometry.dispose()
      highlight.material.dispose()
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

  return <section className="three-viewport" aria-label="Viewport Three.js">
    <div className="three-viewport__canvas" ref={host} />
    <div className="three-viewport__label"><span className="three-dot" /> PERSPECTIVA <span>Y ↑ · metros</span></div>
    {error && <p className="three-viewport__error" role="alert">{error}</p>}
    <div className="three-viewport__footer"><span>Arraste para orbitar · Scroll para zoom · Botão direito para mover</span>
      <span aria-label="Estatísticas do renderer">{stats.triangles.toLocaleString('pt-BR')} triângulos · {stats.calls} draw calls</span></div>
  </section>
}
