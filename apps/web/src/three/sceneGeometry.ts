import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { SceneNode } from './sceneDocument.ts'

export function geometryKey(node: SceneNode): string { return `${node.kind}:${JSON.stringify(node.geometry)}` }
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
    default: throw new Error('Grupos não possuem geometria.')
  }
  geometry.computeBoundingBox()
  const bounds = geometry.boundingBox!
  const center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3())
  // Preserve planar custom meshes without division by zero.
  geometry.applyMatrix4(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z))
  geometry.applyMatrix4(new THREE.Matrix4().makeScale(1 / (size.x || 1), 1 / (size.y || 1), 1 / (size.z || 1)))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}
