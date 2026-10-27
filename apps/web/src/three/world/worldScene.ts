import { createEmptyScene, createNode, MAX_SCENE_NODES, validateScene, type SceneNode, type ThreeSceneDocument } from '../sceneDocument.ts'
import type { ThreeWorldDocument } from './worldDocument.ts'

/** Prefix of the group that holds a location's nodes in the composed world scene. */
export const LOCATION_GROUP = 'local:'
export const locationOfNode = (id: string) => { const at = id.indexOf('/'); return id.startsWith(LOCATION_GROUP) ? id.slice(LOCATION_GROUP.length) : at > 0 ? id.slice(0, at) : null }

/**
 * The 1.x scene played on a world: its environment, plus every detailed location as a group at the location's
 * position, ground level and yaw. Node IDs become `<location>/<id>` and every reference inside a location (parents,
 * contacts, interaction targets, routine places) follows. Locations are added nearest to the spawn first until the
 * 1.x node limit; the rest stay out (and are listed in `omitted`).
 */
export function composeWorldScene(world: ThreeWorldDocument): { scene: ThreeSceneDocument; omitted: string[] } {
  const spawn = world.environment.player?.spawn, origin = spawn ? [spawn[0], spawn[2]] : [0, 0]
  const detailed = world.locations.filter((location) => location.scene).sort((a, b) =>
    Math.hypot(a.position[0] - origin[0], a.position[1] - origin[1]) - Math.hypot(b.position[0] - origin[0], b.position[1] - origin[1]) || (a.id < b.id ? -1 : 1))
  const nodes: SceneNode[] = [], omitted: string[] = []
  for (const location of detailed) {
    const scene = location.scene!
    if (nodes.length + scene.nodes.length + 1 > MAX_SCENE_NODES) { omitted.push(location.id); continue }
    const local = (id: string) => `${location.id}/${id}`, group = `${LOCATION_GROUP}${location.id}`
    nodes.push({ ...createNode('group'), id: group, name: location.name, position: [location.position[0], location.elevation ?? 0, location.position[1]], rotation: [0, location.yaw, 0], role: 'structure' })
    for (const node of scene.nodes) nodes.push({ ...structuredClone(node), id: local(node.id), parentId: node.parentId ? local(node.parentId) : group, overlapWith: node.overlapWith.map(local),
      ...(node.interaction ? { interaction: { ...node.interaction, targetId: node.interaction.targetId === null ? null : local(node.interaction.targetId) } } : {}),
      ...(node.behavior?.routine ? { behavior: { ...node.behavior, routine: node.behavior.routine.map((step) => ({ ...step, target: step.target === null ? null : local(step.target) })) } } : {}) })
  }
  const timeline = Math.max(20, ...detailed.filter((location) => !omitted.includes(location.id)).map((location) => location.scene!.timeline.duration))
  return { scene: validateScene({ ...createEmptyScene(), name: world.name, nodes, timeline: { duration: Math.min(120, timeline) }, environment: world.environment }), omitted }
}
