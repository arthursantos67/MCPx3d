import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { SceneNode } from './sceneDocument.ts'
import { fractalNoise, terrainHeights, type GeometrySpec } from './sceneGeometrySpec.ts'

export function geometryKey(node: SceneNode): string {
  const physicalSize = node.kind === 'terrain' && node.geometry.biome && node.geometry.biome !== 'none'
    ? node.dimensions.map((value, axis) => value * node.scale[axis]) : null
  return `${node.kind}:${JSON.stringify([node.geometry, physicalSize])}`
}
function terrainGeometry(spec: GeometrySpec, dimensions: SceneNode['dimensions']): THREE.BufferGeometry {
  const n = spec.segments, heights = terrainHeights(spec), positions: number[] = [], uvs: number[] = [], indices: number[] = []
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    positions.push(i / n - 0.5, heights[j * (n + 1) + i], j / n - 0.5)
    uvs.push(i / n, 1 - j / n)
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1
    indices.push(a, c, b, b, c, d)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  if (spec.biome && spec.biome !== 'none') {
    const palettes = {
      meadow: ['#b5a477', '#5d7d42', '#8e9460', '#77796e', '#b5b4a1'],
      alpine: ['#9b9873', '#58704b', '#7d8264', '#777d80', '#eef1ed'],
      desert: ['#cfab76', '#b48a55', '#d6b988', '#986b4e', '#e3c9a0'],
      volcanic: ['#3e4443', '#4c5141', '#62635a', '#45454b', '#8c8583'],
      forest: ['#6d6345', '#3f5a2e', '#5b6a3a', '#5f6158', '#7c8a66'],
      snow: ['#d9dee4', '#e8edf2', '#cfd6de', '#7d8590', '#f7f9fb'],
      tropical: ['#e2cf9c', '#4f8a3a', '#79a352', '#6f7266', '#5c8f45'],
      swamp: ['#4b4a33', '#4f5b2f', '#5e6038', '#545247', '#6b7048'],
      lunar: ['#8d8c88', '#a3a29e', '#96958f', '#6c6b68', '#bdbcb7'],
      alien: ['#4b3b6b', '#3f8c7d', '#7a5aa0', '#4a4458', '#b7e3d6'],
    } as const
    const [low, grass, dry, rock, peak] = palettes[spec.biome].map((hex) => new THREE.Color(hex))
    const colors: number[] = [], layers:number[]=[], terrainUvs:number[]=[], normals = geometry.getAttribute('normal'), normal = new THREE.Vector3(), color = new THREE.Color(), physicalSize = new THREE.Vector3(...dimensions)
    const smooth = (a: number, b: number, x: number) => THREE.MathUtils.smoothstep(x, a, b)
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const index = j * (n + 1) + i, h = heights[index] + 0.5
      normal.fromBufferAttribute(normals, index).divide(physicalSize).normalize()
      const slope = 1 - normal.y, patch = fractalNoise(i / n * 22, j / n * 22, spec.seed + 71, 3)
      color.copy(low).lerp(grass, smooth(0.08, 0.3, h)).lerp(dry, smooth(0.35, 0.75, patch) * 0.65)
      const exposed=smooth(0.06, 0.36, slope), summit=smooth(spec.biome === 'alpine' || spec.biome === 'snow' ? 0.72 : 0.85, 1.03, h + (patch - 0.5) * 0.13) * (1 - smooth(0.15, 0.5, slope))
      color.lerp(rock, exposed)
      color.lerp(peak, summit)
      color.multiplyScalar(0.9 + patch * 0.2)
      colors.push(color.r, color.g, color.b)
      layers.push(exposed,summit)
      terrainUvs.push(i/n*Math.abs(dimensions[0]),-j/n*Math.abs(dimensions[2]))
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    geometry.setAttribute('terrainLayers',new THREE.Float32BufferAttribute(layers,2))
    geometry.setAttribute('terrainUv',new THREE.Float32BufferAttribute(terrainUvs,2))
  }
  return geometry
}
function polyhedronGeometry(spec: GeometrySpec): THREE.BufferGeometry {
  const Shape = { icosahedron: THREE.IcosahedronGeometry, dodecahedron: THREE.DodecahedronGeometry, octahedron: THREE.OctahedronGeometry, tetrahedron: THREE.TetrahedronGeometry }[spec.variant]
  const geometry = new Shape(0.5, spec.detail)
  if (spec.bevel > 0) {
    // Displacement keyed by position keeps duplicated face vertices welded.
    const position = geometry.getAttribute('position'), point = new THREE.Vector3()
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i)
      const noise = fractalNoise(point.x * 4 + point.z * 1.7 + 3, point.y * 4 - point.z * 1.3 + 7, spec.seed, 3)
      const offset = 1 + (noise - 0.5) * spec.bevel * 4
      position.setXYZ(i, point.x * offset, point.y * offset, point.z * offset)
    }
    geometry.computeVertexNormals()
    if (spec.detail > 0) {
      // PolyhedronGeometry duplicates vertices for UV seams. Average coincident normals without losing UVs.
      const normals = geometry.getAttribute('normal'), sums = new Map<string, THREE.Vector3>(), keys: string[] = []
      for (let i = 0; i < position.count; i++) {
        const key = `${Math.round(position.getX(i) * 1e6)},${Math.round(position.getY(i) * 1e6)},${Math.round(position.getZ(i) * 1e6)}`
        keys.push(key)
        const sum = sums.get(key) ?? new THREE.Vector3()
        sum.add(new THREE.Vector3().fromBufferAttribute(normals, i)); sums.set(key, sum)
      }
      for (const sum of sums.values()) sum.normalize()
      keys.forEach((key, index) => { const normal = sums.get(key)!; normals.setXYZ(index, normal.x, normal.y, normal.z) })
    }
  }
  return geometry
}
/** All mesh coordinates are centered and normalized; dimensions are the exact local bounding box. */
export function buildNodeGeometry(node: SceneNode): THREE.BufferGeometry {
  const spec = node.geometry
  let geometry: THREE.BufferGeometry
  switch (node.kind) {
    case 'box': geometry = new THREE.BoxGeometry(1, 1, 1); break
    case 'roundedBox': geometry = new RoundedBoxGeometry(1, 1, 1, 4, Math.max(0.001, spec.bevel)); break
    case 'sphere': geometry = new THREE.SphereGeometry(0.5, spec.segments, Math.max(12, Math.floor(spec.segments * 0.75))); break
    case 'cylinder': geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, spec.segments); break
    case 'cone': geometry = new THREE.ConeGeometry(0.5, 1, spec.segments); break
    case 'capsule': geometry = new THREE.CapsuleGeometry(0.25, 0.5, 8, spec.segments); break
    case 'plane': geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2); break
    case 'text': geometry = new THREE.PlaneGeometry(1, 1); break
    case 'polyhedron': geometry = polyhedronGeometry(spec); break
    case 'terrain': geometry = terrainGeometry(spec, node.dimensions.map((value, axis) => value * node.scale[axis]) as SceneNode['dimensions']); break
    case 'torus': geometry = new THREE.TorusGeometry(0.5 - spec.radius, spec.radius, 24, spec.segments * 2); break
    case 'torusKnot': geometry = new THREE.TorusKnotGeometry(0.34, Math.min(spec.radius, 0.15), spec.segments * 4, 24); break
    case 'lathe': {
      const profile = spec.profile.map((point) => new THREE.Vector2(...point))
      if (spec.closed) profile.push(profile[0].clone())
      geometry = new THREE.LatheGeometry(profile, spec.segments)
      break
    }
    case 'extrude': {
      const shape = new THREE.Shape(spec.profile.map((point) => new THREE.Vector2(...point)))
      for (const hole of spec.holes) shape.holes.push(new THREE.Path(hole.map((point) => new THREE.Vector2(...point))))
      geometry = new THREE.ExtrudeGeometry(shape, { depth: 1, steps: 1, bevelEnabled: spec.bevel > 0, bevelSize: spec.bevel, bevelThickness: spec.bevel, bevelSegments: 3 })
      break
    }
    case 'tube': geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(spec.points.map((point) => new THREE.Vector3(...point)), spec.closed, 'centripetal'), spec.segments * 4, spec.radius, 24, spec.closed); break
    case 'mesh':
      geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(spec.vertices, 3))
      geometry.setIndex(spec.indices)
      if (spec.normals.length) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(spec.normals, 3))
      if (spec.uvs.length) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(spec.uvs, 2))
      if (!spec.normals.length) geometry.computeVertexNormals()
      break
    default: throw new Error('Grupos e luzes não possuem geometria.')
  }
  geometry.computeBoundingBox()
  // Terrain heights are already normalized; pads may lower the peaks, so rescaling would detach the mesh from terrainHeightAt.
  if (node.kind === 'terrain') { geometry.computeBoundingSphere(); return geometry }
  const bounds = geometry.boundingBox!
  const center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3())
  // Preserve planar custom meshes without division by zero.
  geometry.applyMatrix4(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z))
  geometry.applyMatrix4(new THREE.Matrix4().makeScale(1 / (size.x || 1), 1 / (size.y || 1), 1 / (size.z || 1)))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}
