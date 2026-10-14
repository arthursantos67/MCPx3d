import type { SceneNode, Vector3Tuple } from './sceneDocument.ts'

/** Absolute sampling keeps playback, scrubbing and frame rates consistent. */
export function sampleNodeTransform(node: SceneNode, seconds: number): { position: Vector3Tuple; rotation: Vector3Tuple } {
  const position: Vector3Tuple = [...node.position], rotation: Vector3Tuple = [...node.rotation]
  const animation = node.animation
  const axis = { x: 0, y: 1, z: 2 }[animation.axis]
  const angle = ((seconds % animation.duration) / animation.duration + animation.phase / 360) * Math.PI * 2
  if (animation.kind === 'spin') rotation[axis] += angle * 180 / Math.PI
  if (animation.kind === 'float') position[axis] += animation.amplitude * Math.sin(angle)
  if (animation.kind === 'orbit') {
    const u = (axis + 1) % 3, v = (axis + 2) % 3
    position[u] += animation.amplitude * Math.cos(angle)
    position[v] += animation.amplitude * Math.sin(angle)
  }
  return { position, rotation }
}
