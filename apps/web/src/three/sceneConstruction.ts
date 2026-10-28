import { createEmptyScene, createNode, validateMaterial, validateScene, type Vector3Tuple } from './sceneDocument.ts'
import { prefabParts, type PrefabSpec } from './scenePrefabs.ts'
import type { PlacedStructure } from './sceneLoadout.ts'

export function constructionScene(kind: PlacedStructure['kind']) {
  const spec: PrefabSpec = { type: kind, size: 1, seed: 23, primary: null, secondary: null, text: '', lit: true, interactive: false }
  const parts = prefabParts(spec).filter(part => part.kind !== 'light'), ids = new Set(parts.map(part => part.id))
  return validateScene({ ...createEmptyScene(), nodes: parts.map(part => ({ ...createNode(part.kind), id: part.id, parentId: part.parentId && ids.has(part.parentId) ? part.parentId : null,
    name: part.name, position: part.position, rotation: part.rotation ?? [0, 0, 0], dimensions: part.dimensions, collidable: part.collidable ?? true,
    material: validateMaterial({ color: '#ad8b5d', roughness: 0.8, metalness: 0, ...part.material }), geometry: { ...createNode(part.kind).geometry, ...part.geometry } })) })
}
export function placementSupport(position: Vector3Tuple, radius: number, heightAt: (x: number, z: number) => number | null, waterAt: (x: number, z: number) => number | null): { valid: boolean; reason: string; height: number } {
  const [x, , z] = position, heights: number[] = []
  for (const [dx, dz] of [[0, 0], [-radius, -radius], [radius, -radius], [radius, radius], [-radius, radius]]) {
    const h = heightAt(x + dx, z + dz), water = waterAt(x + dx, z + dz)
    if (h === null || !Number.isFinite(h)) return { valid: false, reason: 'Não há apoio neste local', height: 0 }
    if (water !== null && water > h + 0.05) return { valid: false, reason: 'Escolha um local fora da água', height: h }
    heights.push(h)
  }
  const low = Math.min(...heights), high = Math.max(...heights)
  return { valid: high - low <= 0.45, reason: high - low > 0.45 ? 'O terreno está muito inclinado' : 'E ou clique para colocar · R gira', height: high }
}
