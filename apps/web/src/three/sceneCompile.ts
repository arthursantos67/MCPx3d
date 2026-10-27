import * as THREE from 'three'

type Drawable = THREE.Mesh | THREE.Line | THREE.Points | THREE.Sprite
/** Kept for the page's lifetime: disposing them would release the programs they share with the shadow pass. */
const DEFAULTS = { depth: new THREE.MeshDepthMaterial(), distance: new THREE.MeshDistanceMaterial() }
const SHADOW_SIDE: Record<THREE.Side, THREE.Side> = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide }

const drawable = (object: THREE.Object3D): object is Drawable => { const item = object as THREE.Mesh & THREE.Line & THREE.Points & THREE.Sprite; return !!(item.isMesh || item.isLine || item.isPoints || item.isSprite) }
const materialsOf = (object: Drawable) => (Array.isArray(object.material) ? object.material : [object.material]).filter(Boolean) as THREE.Material[]
const yieldTask = () => new Promise((resolve) => setTimeout(resolve, 0))

/** Impostor baking may still fill the GPU queue; poll a fence so the next texture upload does not wait on it synchronously. */
async function waitForGpu(renderer: THREE.WebGLRenderer, cancelled: () => boolean) {
  const gl = renderer.getContext() as WebGL2RenderingContext, fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
  if (!fence) return
  gl.flush()
  try { while (!cancelled() && gl.clientWaitSync(fence, 0, 0) === gl.TIMEOUT_EXPIRED) await yieldTask() } finally { gl.deleteSync(fence) }
}

/** What of an object, besides its material, enters a program's key. */
function objectKey(object: Drawable) {
  const item = object as THREE.InstancedMesh & THREE.SkinnedMesh & THREE.BatchedMesh, geometry = object.geometry
  return [object.type, !!item.instanceColor, !!item.morphTexture, !!geometry.morphAttributes.position, !!geometry.morphAttributes.normal, !!geometry.morphAttributes.color,
    geometry.getAttribute('color')?.itemSize ?? 0, !!geometry.getAttribute('tangent')].join('|')
}

/** A stand-in drawing `material` as `object` would: same geometry, instancing and skeleton, no children or lights. */
function proxyOf(object: Drawable, material: THREE.Material): THREE.Object3D {
  const item = object as THREE.InstancedMesh & THREE.SkinnedMesh
  if (item.isInstancedMesh) { const instanced = new THREE.InstancedMesh(object.geometry, material, 1); instanced.instanceColor = item.instanceColor; instanced.morphTexture = item.morphTexture; return instanced }
  if (item.isSkinnedMesh) { const skinned = new THREE.SkinnedMesh(object.geometry, material); skinned.bind(item.skeleton, item.bindMatrix); return skinned }
  if ((object as THREE.Line).isLine) return new THREE.Line(object.geometry, material)
  if ((object as THREE.Points).isPoints) return new THREE.Points(object.geometry, material)
  if ((object as THREE.Sprite).isSprite) return new THREE.Sprite(material as THREE.SpriteMaterial)
  return new THREE.Mesh(object.geometry, material)
}
const holding = (object: THREE.Object3D) => { const holder = new THREE.Scene(); holder.add(object); return holder }

/**
 * `compileAsync` for a scene, spread over tasks of about `budget` ms: creating programs is synchronous and a scene with
 * many materials would otherwise block the page for its whole warm-up. One draw per distinct material and object kind
 * is compiled, with the lights of `scene` (and `target` bound, whose type sets tone mapping and colour space), through
 * a stand-in without children: `compile` would otherwise walk the object's whole subtree in one call and count the
 * lights inside it a second time.
 */
export async function compileInSlices(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, target: THREE.WebGLRenderTarget | null, cancelled: () => boolean, budget = 10): Promise<void> {
  const seen = new Set<string>(), draws: [Drawable, THREE.Material][] = []
  scene.traverse((object) => {
    if (!drawable(object)) return
    const key = objectKey(object)
    for (const material of materialsOf(object)) if (!seen.has(`${material.uuid}|${key}`)) { seen.add(`${material.uuid}|${key}`); draws.push([object, material]) }
  })
  const pending: Promise<unknown>[] = [], textures = new Set<THREE.Texture>()
  // The caller also prepares the sky, shadows and output; the first slice gets its own task.
  await yieldTask()
  await waitForGpu(renderer, cancelled)
  let slice = performance.now()
  for (const [object, material] of draws) {
    if (cancelled()) return
    const output = renderer.getRenderTarget()
    renderer.setRenderTarget(target)
    // Batched meshes keep their own draw state and hold no children or lights: they compile as they are.
    try { pending.push(renderer.compileAsync((object as THREE.BatchedMesh).isBatchedMesh ? object : holding(proxyOf(object, material)), camera, scene)) } finally { renderer.setRenderTarget(output) }
    if (performance.now() - slice > budget) { await yieldTask(); slice = performance.now() }
    // Compilation runs onBeforeCompile, exposing the terrain and wind textures as well as ordinary material maps.
    const { uniforms } = renderer.properties.get(material) as { uniforms?: Record<string, THREE.IUniform> }
    const values = [...Object.values(material), ...Object.values(uniforms ?? {}).map((uniform) => uniform.value)]
    for (const value of values) for (const candidate of Array.isArray(value) ? value : [value]) {
      const texture = candidate as THREE.Texture | null
      if (!texture?.isTexture || texture.isRenderTargetTexture || textures.has(texture)) continue
      if (cancelled()) return
      textures.add(texture)
      renderer.initTexture(texture)
      if (performance.now() - slice > budget) { await yieldTask(); slice = performance.now() }
    }
  }
  await Promise.all(pending)
}

/**
 * Links the shadow-pass programs of every caster in parallel, as `compileAsync` does for the main pass. WebGLShadowMap
 * draws casters with depth (or, for point lights, distance) materials it configures per object from the caster's
 * material; programs first met there link synchronously and block the frame. Each distinct configuration is reproduced
 * on a stand-in compiled from the light's shadow camera into an offscreen target, with the scene's lights and without
 * its fog, as the shadow pass draws. Invisible casters are included: vegetation tiers and streamed meshes become
 * visible later without a new warm-up.
 */
export function compileShadowPrograms(renderer: THREE.WebGLRenderer, scene: THREE.Scene): Promise<unknown> {
  if (!renderer.shadowMap.enabled) return Promise.resolve()
  const lights: (THREE.DirectionalLight | THREE.SpotLight | THREE.PointLight)[] = [], casters: Drawable[] = []
  scene.traverseVisible((object) => { const light = object as THREE.DirectionalLight; if (light.isLight && light.castShadow && light.shadow) lights.push(light) })
  scene.traverse((object) => { if (drawable(object) && !(object as THREE.Sprite).isSprite && object.castShadow) casters.push(object) })
  if (!lights.length || !casters.length) return Promise.resolve()
  const vsm = renderer.shadowMap.type === THREE.VSMShadowMap, target = new THREE.WebGLRenderTarget(1, 1), output = renderer.getRenderTarget()
  const seen = new Set<string>(), pending: Promise<unknown>[] = [], fog = scene.fog
  scene.fog = null
  renderer.setRenderTarget(target)
  try {
    for (const light of lights) {
      const point = (light as THREE.PointLight).isPointLight === true
      for (const caster of casters) for (const material of materialsOf(caster)) {
        if (!material.visible) continue
        const custom = point ? caster.customDistanceMaterial : caster.customDepthMaterial, depth = (custom ?? (point ? DEFAULTS.distance : DEFAULTS.depth)) as THREE.MeshDepthMaterial
        const side = material.shadowSide ?? (vsm ? material.side : SHADOW_SIDE[material.side]), source = material as THREE.MeshStandardMaterial, alpha = source.alphaToCoverage ? 0.5 : material.alphaTest
        const key = [point, custom?.uuid ?? 'default', side, alpha > 0, !!source.map, !!source.alphaMap, !!source.displacementMap && source.displacementScale !== 0, source.wireframe, objectKey(caster)].join('|')
        if (seen.has(key)) continue
        seen.add(key)
        Object.assign(depth, { side, wireframe: source.wireframe, alphaTest: alpha, map: source.map ?? null, alphaMap: source.alphaMap ?? null,
          displacementMap: source.displacementMap ?? null, displacementScale: source.displacementScale ?? 1, displacementBias: source.displacementBias ?? 0 })
        // compileAsync prepares programs synchronously before waiting, so the shared depth material can be reconfigured next.
        pending.push(renderer.compileAsync(holding(proxyOf(caster, depth)), light.shadow.camera, scene))
      }
    }
  } finally { renderer.setRenderTarget(output); scene.fog = fog }
  return Promise.all(pending).finally(() => target.dispose())
}
