import * as THREE from 'three'
import { ExtendedTriangle, type ShapecastCallbacks } from 'three-mesh-bvh'
import { GRID, nodeSize } from './cdlod.ts'
import { tileHeight, type TileData } from './terrainTile.ts'

/** The part of three-mesh-bvh's MeshBVH that the game runtime uses for collision, line of sight and ground probes. */
export interface CollisionShape {
  raycastFirst(ray: THREE.Ray, side?: THREE.Side, near?: number, far?: number): THREE.Intersection | null
  raycast(ray: THREE.Ray, side?: THREE.Side, near?: number, far?: number): THREE.Intersection[]
  shapecast(callbacks: ShapecastCallbacks): boolean
}

const BLOCK = 8
const MAX_RAY = 2000

/**
 * Collision against the level-0 terrain tiles near the player, read directly from the streamed heights: the same
 * float32 samples and diagonal as the rendered mesh, so feet, shots and line of sight match what is drawn. Tiles
 * are grouped in 8×8-cell blocks with height bounds, giving a shallow hierarchy instead of a rebuilt BVH.
 */
export function createTerrainCollider(tiles: () => Iterable<TileData>, origin: [number, number]): CollisionShape {
  const blocks = new WeakMap<TileData, Float32Array>()
  const blockBounds = (tile: TileData) => {
    let bounds = blocks.get(tile)
    if (bounds) return bounds
    const count = GRID / BLOCK
    bounds = new Float32Array(count * count * 2)
    for (let bj = 0; bj < count; bj++) for (let bi = 0; bi < count; bi++) {
      let low = Infinity, high = -Infinity
      for (let j = bj * BLOCK; j <= (bj + 1) * BLOCK; j++) for (let i = bi * BLOCK; i <= (bi + 1) * BLOCK; i++) { const h = tileHeight(tile, i, j); if (h < low) low = h; if (h > high) high = h }
      bounds[(bj * count + bi) * 2] = low; bounds[(bj * count + bi) * 2 + 1] = high
    }
    blocks.set(tile, bounds)
    return bounds
  }
  const size = nodeSize(0), spacing = size / GRID, box = new THREE.Box3(), triangle = new ExtendedTriangle(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
  const corner = (tile: TileData, i: number, j: number, target: THREE.Vector3) => target.set(origin[0] + tile.ix * size + i * spacing, tileHeight(tile, i, j), origin[1] + tile.iz * size + j * spacing)
  /** Visits each triangle of the cells inside block boxes accepted by `accept`; stops when `visit` returns true. */
  const walk = (accept: (box: THREE.Box3) => boolean, visit: (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => boolean): boolean => {
    const count = GRID / BLOCK
    for (const tile of tiles()) {
      if (tile.level !== 0) continue
      const x0 = origin[0] + tile.ix * size, z0 = origin[1] + tile.iz * size
      box.min.set(x0, tile.minY, z0); box.max.set(x0 + size, tile.maxY, z0 + size)
      if (!accept(box)) continue
      const bounds = blockBounds(tile)
      for (let bj = 0; bj < count; bj++) for (let bi = 0; bi < count; bi++) {
        box.min.set(x0 + bi * BLOCK * spacing, bounds[(bj * count + bi) * 2], z0 + bj * BLOCK * spacing)
        box.max.set(box.min.x + BLOCK * spacing, bounds[(bj * count + bi) * 2 + 1], box.min.z + BLOCK * spacing)
        if (!accept(box)) continue
        for (let j = bj * BLOCK; j < (bj + 1) * BLOCK; j++) for (let i = bi * BLOCK; i < (bi + 1) * BLOCK; i++) {
          corner(tile, i, j, a)
          if (visit(a, corner(tile, i + 1, j + 1, c), corner(tile, i + 1, j, b))) return true
          if (visit(corner(tile, i, j, a), corner(tile, i, j + 1, b), corner(tile, i + 1, j + 1, c))) return true
        }
      }
    }
    return false
  }
  const hits = (ray: THREE.Ray, side: THREE.Side, near: number, far: number, first: boolean): THREE.Intersection[] => {
    const results: THREE.Intersection[] = [], point = new THREE.Vector3(), limit = Math.min(far, MAX_RAY), cull = side === THREE.FrontSide
    let best = limit
    walk((bounds) => { const at = ray.intersectBox(bounds, point); return !!at && ray.origin.distanceTo(at) <= (first ? best : limit) }, (p, q, r) => {
      const at = ray.intersectTriangle(p, q, r, cull, point)
      if (!at) return false
      const distance = ray.origin.distanceTo(at)
      if (distance < near || distance > (first ? best : limit)) return false
      const normal = new THREE.Vector3().subVectors(r, p).cross(new THREE.Vector3().subVectors(q, p)).normalize()
      if (normal.y < 0) normal.negate()
      const hit = { distance, point: at.clone(), face: { a: 0, b: 0, c: 0, normal, materialIndex: 0 }, object: null as unknown as THREE.Object3D }
      if (first) { results[0] = hit; best = distance } else results.push(hit)
      return false
    })
    return results
  }
  return {
    raycastFirst: (ray, side = THREE.FrontSide, near = 0, far = Infinity) => hits(ray, side, near, far, true)[0] ?? null,
    raycast: (ray, side = THREE.FrontSide, near = 0, far = Infinity) => hits(ray, side, near, far, false).sort((x, y) => x.distance - y.distance),
    shapecast: (callbacks) => walk((bounds) => !!callbacks.intersectsBounds(bounds, false, 0, 0, 0), (p, q, r) => {
      triangle.a.copy(p); triangle.b.copy(q); triangle.c.copy(r); triangle.needsUpdate = true
      return !!callbacks.intersectsTriangle?.(triangle, 0, false, 0)
    }),
  }
}

/** Several shapes queried as one (the location's static BVH plus streamed terrain). */
export function combineShapes(shapes: CollisionShape[]): CollisionShape {
  if (shapes.length === 1) return shapes[0]
  return {
    raycastFirst(ray, side, near, far) {
      let best: THREE.Intersection | null = null
      for (const shape of shapes) { const hit = shape.raycastFirst(ray, side, near, far); if (hit && (!best || hit.distance < best.distance)) best = hit }
      return best
    },
    raycast: (ray, side, near, far) => shapes.flatMap((shape) => shape.raycast(ray, side, near, far)).sort((x, y) => x.distance - y.distance),
    shapecast: (callbacks) => shapes.some((shape) => shape.shapecast(callbacks)),
  }
}
