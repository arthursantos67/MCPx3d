import type { ThreeSceneDocument } from './sceneDocument.ts'
import type { SceneInspection } from './sceneInspection.ts'
import type { SceneAudit } from './sceneLayout.ts'

/** Content that a refinement must repair in place, rather than delete to improve its collision count. */
export function sceneContentInventory(scene: ThreeSceneDocument): Map<string, number> {
  const inventory = new Map<string, number>(), byId = new Map(scene.nodes.map(node => [node.id, node]))
  const revealable = new Set(scene.nodes.filter(node => node.interaction?.action === 'toggleVisibility').map(node => node.interaction!.targetId ?? node.id))
  const add = (key: string) => inventory.set(key, (inventory.get(key) ?? 0) + 1)
  for (const node of scene.nodes) {
    let available = true
    for (let current: typeof node | undefined = node; current; current = current.parentId ? byId.get(current.parentId) : undefined) {
      if (!current.visible && !revealable.has(current.id)) { available = false; break }
    }
    if (!available) continue
    if (node.asset) add(`prefab:${node.asset.type}`)
    if (node.behavior) add(`behavior:${node.behavior.type}`)
    if (node.interaction) {
      const action = node.interaction
      add(`interaction:${action.action}:${action.item ?? ''}:${action.requires ?? ''}:${action.power ?? ''}`)
    }
    if (node.resource) add(`resource:${node.resource.item}`)
  }
  const objective = scene.environment.objective?.type
  if (objective && objective !== 'explore') add(`objective:${objective}`)
  return inventory
}

export function lostSceneContent(before: ThreeSceneDocument, after: ThreeSceneDocument): string[] {
  const expected = sceneContentInventory(before), actual = sceneContentInventory(after)
  return [...expected].filter(([key, count]) => (actual.get(key) ?? 0) < count).map(([key, count]) => `${key} (${count} → ${actual.get(key) ?? 0})`)
}

export interface CandidateQuality { inspection: SceneInspection | null; audit: SceneAudit; direction: readonly string[] }
/** Gameplay defects outrank cosmetic/spatial counts; incomplete inspection never counts as zero defects. */
export function betterSceneCandidate(next: CandidateQuality, previous: CandidateQuality): boolean {
  const rank = ({ inspection, audit, direction }: CandidateQuality) => [
    Number(!inspection?.complete) + Number(inspection?.surfaceCheckComplete === false),
    audit.unreachable.length + Number(audit.spawnInWater) + (audit.groundProblems?.length ?? 0),
    audit.inWater.length + audit.buried.length + audit.floating.length + audit.uneven.length,
    (inspection?.intersections.length ?? 0) + (inspection?.surfaceConflicts?.length ?? 0),
    direction.length,
  ]
  const a = rank(next), b = rank(previous)
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]
  return false
}
