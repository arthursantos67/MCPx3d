import type { SceneNode, Vector3Tuple } from './sceneDocument.ts'

export interface ScenePose { position: Vector3Tuple; rotation: Vector3Tuple; scale: Vector3Tuple }
export const isTriggered = (node: SceneNode) => node.animation.kind !== 'none' && node.animation.start === 'trigger'
export const playsOnce = (node: SceneNode) => isTriggered(node) && node.animation.kind === 'keyframes'

/** Pose at a normalized cycle progress (0–1). Base transforms remain the editable values. */
export function samplePose(node: SceneNode, progress: number): ScenePose {
  const position: Vector3Tuple = [...node.position], rotation: Vector3Tuple = [...node.rotation], scale: Vector3Tuple = [...node.scale]
  const animation = node.animation
  const axis = { x: 0, y: 1, z: 2 }[animation.axis]
  if (animation.kind === 'keyframes') {
    const keys = animation.keys ?? []
    if (!keys.length) return { position, rotation, scale }
    const p = Math.min(1, Math.max(0, progress))
    let a = keys[0], b = keys[0], t = 0
    if (p >= keys.at(-1)!.at) a = b = keys.at(-1)!
    else if (p > keys[0].at) for (let i = 1; i < keys.length; i++) if (p <= keys[i].at) { a = keys[i - 1]; b = keys[i]; t = (p - a.at) / (b.at - a.at); break }
    const eased = animation.easing === 'step' ? 0 : animation.easing === 'linear' ? t : t * t * (3 - 2 * t)
    for (let i = 0; i < 3; i++) {
      position[i] += a.move[i] + (b.move[i] - a.move[i]) * eased
      rotation[i] += a.turn[i] + (b.turn[i] - a.turn[i]) * eased
      scale[i] = Math.max(0.01, scale[i] * (a.scale[i] + (b.scale[i] - a.scale[i]) * eased))
    }
    return { position, rotation, scale }
  }
  const angle = (progress + animation.phase / 360) * Math.PI * 2
  if (animation.kind === 'spin') rotation[axis] += angle * 180 / Math.PI
  if (animation.kind === 'float') position[axis] += animation.amplitude * Math.sin(angle)
  if (animation.kind === 'bounce') position[axis] += animation.amplitude * Math.abs(Math.sin(angle))
  if (animation.kind === 'swing') rotation[axis] += animation.amplitude * Math.sin(angle)
  if (animation.kind === 'pulse') { const factor = Math.max(0.05, 1 + Math.min(animation.amplitude, 0.95) * Math.sin(angle)); for (let i = 0; i < 3; i++) scale[i] = Math.max(0.01, scale[i] * factor) }
  if (animation.kind === 'orbit') {
    const u = (axis + 1) % 3, v = (axis + 2) % 3
    position[u] += animation.amplitude * Math.cos(angle)
    position[v] += animation.amplitude * Math.sin(angle)
  }
  return { position, rotation, scale }
}

export function cycleProgress(node: SceneNode, seconds: number): number {
  const progress = (seconds % node.animation.duration) / node.animation.duration
  return node.animation.kind === 'keyframes' ? (progress + node.animation.phase / 360) % 1 : progress
}

/**
 * Absolute sampling keeps playback, scrubbing and frame rates consistent. Animations started by
 * interactions rest at their initial pose unless `triggered` provides a play-once progress.
 */
export function sampleNodeTransform(node: SceneNode, seconds: number, triggered?: number): ScenePose {
  if (isTriggered(node) && triggered === undefined) return samplePose(node, 0)
  if (playsOnce(node)) return samplePose(node, triggered!)
  return samplePose(node, cycleProgress(node, seconds))
}
