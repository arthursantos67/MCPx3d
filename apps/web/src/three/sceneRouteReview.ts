import { Vector3 } from 'three'
import type { SceneNode, ThreeSceneDocument } from './sceneDocument.ts'
import { buildNodeGeometry } from './sceneGeometry.ts'
import { sceneMatrices } from './scenePlacement.ts'
import { buildingPlan } from './sceneArchitecture.ts'
import type { ScenePlan } from './scenePlanning.ts'

/** Rasterize the union of the actual visible route surfaces, including curved and joined meshes. */
export function reviewPlannedRoutes(scene: ThreeSceneDocument, plan: ScenePlan): string[] {
  const byId = new Map(scene.nodes.map(node => [node.id, node])), matrices = sceneMatrices(scene)
  const visible = (node: SceneNode): boolean => node.visible && (!node.parentId || visible(byId.get(node.parentId)!))
  const paths = scene.nodes.filter(node => visible(node) && (node.role === 'path' || node.path) && ['mesh', 'box', 'roundedBox', 'plane'].includes(node.kind))
  if (!paths.length) return ['O plano define rotas entre as zonas, mas nenhuma superfície de caminho foi construída.']
  // At most 200×200 cells for a 150 m plan. Geometry and searches stay bounded by the scene budget.
  const step = 0.75, columns = Math.ceil(plan.extent[0] / step), rows = Math.ceil(plan.extent[1] / step)
  const heights = new Float32Array(columns * rows).fill(NaN), components = new Int32Array(columns * rows).fill(-1)
  const point = new Vector3(), a = new Vector3(), b = new Vector3(), c = new Vector3()
  let inspectedTriangles = 0, rasterSamples = 0
  for (const node of paths) {
    const geometry = buildNodeGeometry(node)
    try {
      const position = geometry.getAttribute('position'), index = geometry.getIndex(), matrix = matrices.get(node.id)!.clone().scale(new Vector3(...node.dimensions))
      const count = index ? index.count : position.count
      for (let i = 0; i + 2 < count; i += 3) {
        if (++inspectedTriangles > 200000) return ['A revisão de conexões atingiu o orçamento de 200 mil triângulos; não confirmou todas as rotas.']
        a.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(matrix)
        b.fromBufferAttribute(position, index ? index.getX(i + 1) : i + 1).applyMatrix4(matrix)
        c.fromBufferAttribute(position, index ? index.getX(i + 2) : i + 2).applyMatrix4(matrix)
        const denominator = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z)
        if (Math.abs(denominator) < 1e-8) continue // No walkable footprint on a vertical face.
        const minX = Math.max(0, Math.ceil((Math.min(a.x, b.x, c.x) + plan.extent[0] / 2) / step - 0.5))
        const maxX = Math.min(columns - 1, Math.floor((Math.max(a.x, b.x, c.x) + plan.extent[0] / 2) / step - 0.5))
        const minZ = Math.max(0, Math.ceil((Math.min(a.z, b.z, c.z) + plan.extent[1] / 2) / step - 0.5))
        const maxZ = Math.min(rows - 1, Math.floor((Math.max(a.z, b.z, c.z) + plan.extent[1] / 2) / step - 0.5))
        for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
          if (++rasterSamples > 2000000) return ['A revisão de conexões atingiu o orçamento de amostras; não confirmou todas as rotas.']
          point.set((x + 0.5) * step - plan.extent[0] / 2, 0, (z + 0.5) * step - plan.extent[1] / 2)
          const u = ((b.z - c.z) * (point.x - c.x) + (c.x - b.x) * (point.z - c.z)) / denominator
          const v = ((c.z - a.z) * (point.x - c.x) + (a.x - c.x) * (point.z - c.z)) / denominator
          if (u < -1e-5 || v < -1e-5 || u + v > 1.00001) continue
          const y = u * a.y + v * b.y + (1 - u - v) * c.y, offset = z * columns + x
          if (!Number.isFinite(heights[offset]) || y > heights[offset]) heights[offset] = y
        }
      }
    } finally { geometry.dispose() }
  }
  // A road texture beneath an entire house is not a traversable village connection.
  for (const house of scene.nodes.filter(node => visible(node) && node.asset?.type === 'house')) {
    const building = buildingPlan(house.asset!), inverse = matrices.get(house.id)!.clone().invert()
    for (let index = 0; index < heights.length; index++) if (Number.isFinite(heights[index])) {
      point.set((index % columns + 0.5) * step - plan.extent[0] / 2, heights[index], (Math.floor(index / columns) + 0.5) * step - plan.extent[1] / 2).applyMatrix4(inverse)
      if (Math.abs(point.x) < building.width / 2 + 0.35 && Math.abs(point.z) < building.depth / 2 + 0.35) heights[index] = NaN
    }
  }
  let component = 0
  const queue = new Int32Array(heights.length)
  for (let index = 0; index < heights.length; index++) {
    if (!Number.isFinite(heights[index]) || components[index] >= 0) continue
    let head = 0, tail = 1; queue[0] = index; components[index] = component
    while (head < tail) {
      const current = queue[head++], x = current % columns, z = Math.floor(current / columns)
      for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        if (x + dx < 0 || x + dx >= columns || z + dz < 0 || z + dz >= rows) continue
        const next = current + dx + dz * columns
        if (components[next] >= 0 || !Number.isFinite(heights[next]) || Math.abs(heights[current] - heights[next]) > step * 0.65 + 0.08) continue
        components[next] = component; queue[tail++] = next
      }
    }
    component++
  }
  const zoneComponents = new Map<string, Set<number>>()
  for (const zone of plan.zones) {
    const found = new Set<number>(), radius = Math.min(12, zone.radius * 0.75)
    for (let index = 0; index < components.length; index++) if (components[index] >= 0) {
      const x = (index % columns + 0.5) * step - plan.extent[0] / 2, z = (Math.floor(index / columns) + 0.5) * step - plan.extent[1] / 2
      if (Math.hypot(x - zone.center[0], z - zone.center[1]) <= radius) found.add(components[index])
    }
    zoneComponents.set(zone.id, found)
  }
  return plan.routes.flatMap(route => {
    const from = plan.zones.find(zone => zone.id === route.from)!, to = plan.zones.find(zone => zone.id === route.to)!
    const connected = [...zoneComponents.get(from.id)!].some(id => zoneComponents.get(to.id)!.has(id))
    return connected ? [] : [`A rota ${from.name} → ${to.name} não possui um caminho contínuo caminhável; há uma lacuna, declive excessivo ou falta acesso a uma das zonas.`]
  })
}
