import type * as THREE from 'three'

/** Rendering budget chosen by the player (or detected for software WebGL); systems scale counts and resolution with it. */
export type QualityLevel = 'low' | 'medium' | 'high'
/** World height of the walkable surface below (x, z), probing downwards from `fromY`; null when nothing supports that point. */
export type GroundSampler = (x: number, z: number, fromY: number) => number | null
/** Facial channels, all normalised: blink 0 open → 1 closed, jaw 0 shut → 1 open, brow −1 frown → 1 raised, smile −1 → 1; gaze in radians (yaw, pitch). */
export interface FaceState { blink: number; jaw: number; brow: number; smile: number; gaze: [number, number] }
export const neutralFace = (): FaceState => ({ blink: 0, jaw: 0, brow: 0, smile: 0, gaze: [0, 0] })
/** Secondary-motion chain (hair, cape, tail): `bones` from root to tip, each rotating its child; stiffness/damping per second, limit in radians. */
export interface SpringChainSpec { bones: THREE.Object3D[]; stiffness: number; damping: number; gravity: number; limit: number; wind?: number }
/** Continuous skinned body generated for one character root; the renderer hides the rigid parts listed in `hidden`. */
export interface CharacterSkin {
  rootId: string
  object: THREE.Object3D
  meshes: THREE.SkinnedMesh[]
  hidden: Set<string>
  springs: SpringChainSpec[]
  setFace: (face: FaceState) => void
  dispose: () => void
}
