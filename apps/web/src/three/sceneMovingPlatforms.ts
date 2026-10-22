import * as THREE from 'three'
import type { PlayerBox } from './scenePlayer.ts'

/** Feet may rest up to `above` over the top face (or sink `below` into it) and overhang the footprint by `margin`. */
export const PLATFORM_SUPPORT = { above: 0.12, below: 0.08, margin: 0.15, minUp: 0.7 } as const

/** Height of the feet over the box's upward face, or null when outside its footprint or the face is too steep to stand on. */
export function heightAboveTop(feet: THREE.Vector3, box: PlayerBox, margin: number = PLATFORM_SUPPORT.margin): number | null {
  let up = 0
  for (let i = 1; i < 3; i++) if (Math.abs(box.axes[i].y) > Math.abs(box.axes[up].y)) up = i
  if (Math.abs(box.axes[up].y) < PLATFORM_SUPPORT.minUp) return null
  const offset = feet.clone().sub(box.center)
  for (let i = 0; i < 3; i++) if (i !== up && Math.abs(offset.dot(box.axes[i])) > box.half.getComponent(i) + margin) return null
  return offset.dot(box.axes[up]) * Math.sign(box.axes[up].y) - box.half.getComponent(up)
}

/** The supporting box under the feet (closest top face), or null. */
export function findSupport(feet: THREE.Vector3, boxes: { id: string; box: PlayerBox }[]): string | null {
  let best: string | null = null, gap = Infinity
  for (const { id, box } of boxes) {
    const height = heightAboveTop(feet, box)
    if (height === null || height > PLATFORM_SUPPORT.above || height < -PLATFORM_SUPPORT.below || Math.abs(height) >= gap) continue
    best = id; gap = Math.abs(height)
  }
  return best
}

/** Moves the feet rigidly with the platform (current · previous⁻¹); `yaw` is the platform's rotation about +Y to add to the player's yaw. */
export function carry(previous: THREE.Matrix4, current: THREE.Matrix4, feet: THREE.Vector3): { position: THREE.Vector3; yaw: number } {
  const delta = current.clone().multiply(previous.clone().invert()), axis = new THREE.Vector3(1, 0, 0).transformDirection(delta)
  return { position: feet.clone().applyMatrix4(delta), yaw: Math.hypot(axis.x, axis.z) > 1e-6 ? Math.atan2(-axis.z, axis.x) : 0 }
}
