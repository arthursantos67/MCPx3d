import * as THREE from 'three'
import type { PlayerBox, PlayerCollider } from './scenePlayer.ts'

export type EnemyMode = 'patrol' | 'chase' | 'search' | 'return'
/** All positions and headings are world-space; the renderer converts them to a parent-local pose. */
export interface EnemyMotion {
  base: THREE.Vector3
  position: THREE.Vector3
  hover: number
  heading: number
  phase: number
  mode: EnemyMode
  lastSeen: THREE.Vector3 | null
  memory: number
  perceptionIn: number
  seesPlayer: boolean
  turnSide: number
}
export interface EnemySettings { speed: number; range: number; radius?: number; height?: number; eyeHeight?: number }
export interface EnemyStep { moved: boolean; seesPlayer: boolean; mode: EnemyMode }

export function createEnemyMotion(base: THREE.Vector3, ground: number, phase = 0): EnemyMotion {
  return { base: base.clone(), position: base.clone(), hover: Math.max(0, base.y - ground), heading: 0,
    phase, mode: 'patrol', lastSeen: null, memory: 0, perceptionIn: 0, seesPlayer: false, turnSide: Math.sin(phase) < 0 ? -1 : 1 }
}

function boxRayDistance(ray: THREE.Ray, box: PlayerBox): number | null {
  const offset = ray.origin.clone().sub(box.center)
  const origin = new THREE.Vector3(...box.axes.map((axis) => offset.dot(axis)) as [number, number, number])
  const direction = new THREE.Vector3(...box.axes.map((axis) => ray.direction.dot(axis)) as [number, number, number])
  const hit = new THREE.Ray(origin, direction).intersectBox(new THREE.Box3(box.half.clone().negate(), box.half), new THREE.Vector3())
  return hit ? hit.distanceTo(origin) : null
}

/** Opaque colliders block perception, including moving doors supplied through collider.boxes. */
export function enemyCanSee(from: THREE.Vector3, target: THREE.Vector3, collider: PlayerCollider): boolean {
  const delta = target.clone().sub(from), distance = delta.length()
  if (distance < 0.01) return true
  const ray = new THREE.Ray(from.clone(), delta.divideScalar(distance))
  if (collider.bvh?.raycastFirst(ray, THREE.DoubleSide, 0.015, distance - 0.02)) return false
  return !collider.boxes.some((box) => { const hit = boxRayDistance(ray, box); return hit !== null && hit < distance - 0.02 })
}

function capsuleClear(feet: THREE.Vector3, collider: PlayerCollider, radius: number, height: number): boolean {
  const segment = new THREE.Line3(feet.clone().add(new THREE.Vector3(0, radius, 0)), feet.clone().add(new THREE.Vector3(0, height - radius, 0)))
  const bounds = new THREE.Box3().expandByPoint(segment.start).expandByPoint(segment.end).expandByScalar(radius)
  const trianglePoint = new THREE.Vector3(), capsulePoint = new THREE.Vector3()
  let clear = true
  if (collider.bvh) collider.bvh.shapecast({
    intersectsBounds: (box) => clear && box.intersectsBox(bounds),
    intersectsTriangle: (triangle) => {
      if (triangle.closestPointToSegment(segment, trianglePoint, capsulePoint) < radius - 0.003) { clear = false; return true }
      return false
    },
  })
  if (!clear) return false
  // Conservative samples along the capsule also cover arbitrarily rotated moving boxes.
  for (const box of collider.boxes) {
    if (box.center.distanceTo(feet) > box.half.length() + height + radius) continue
    for (let i = 0; i <= 4; i++) {
      const point = segment.at(i / 4, new THREE.Vector3()).sub(box.center)
      let squared = 0
      for (let axis = 0; axis < 3; axis++) { const d = Math.max(0, Math.abs(point.dot(box.axes[axis])) - box.half.getComponent(axis)); squared += d * d }
      if (squared < (radius - 0.003) ** 2) return false
    }
  }
  return true
}

function supportAt(point: THREE.Vector3, feetY: number, collider: PlayerCollider): number | null {
  if (!collider.bvh) return collider.floor
  const ray = new THREE.Ray(new THREE.Vector3(point.x, feetY + 0.27, point.z), new THREE.Vector3(0, -1, 0))
  const hit = collider.bvh.raycastFirst(ray, THREE.DoubleSide, 0, 0.92)
  if (hit && hit.face && hit.face.normal.y > 0.55) return hit.point.y
  // The universal safety floor is a support only when reachable; never snap over a ledge to it.
  if (!hit && feetY - collider.floor >= -0.27 && feetY - collider.floor <= 0.6) return collider.floor
  return null
}

/** Swept substeps stop fast enemies crossing a thin wall or walking over unsupported ledges. */
function moveCandidate(position: THREE.Vector3, direction: THREE.Vector3, distance: number, hover: number, collider: PlayerCollider, radius: number, height: number): THREE.Vector3 | null {
  const steps = Math.max(1, Math.ceil(distance / Math.min(0.16, radius * 0.5))), candidate = position.clone()
  for (let i = 0; i < steps; i++) {
    candidate.addScaledVector(direction, distance / steps)
    const previousFeet = candidate.y - hover, ground = supportAt(candidate, previousFeet, collider)
    if (ground === null || ground - previousFeet > 0.27 || previousFeet - ground > 0.6) return null
    candidate.y = ground + hover
    if (!capsuleClear(new THREE.Vector3(candidate.x, ground + 0.018, candidate.z), collider, radius, height)) return null
  }
  return candidate
}

/** One deterministic bounded update. The supplied collider must exclude enemy bodies themselves. */
export function stepEnemyMotion(state: EnemyMotion, settings: EnemySettings, playerFeet: THREE.Vector3, collider: PlayerCollider, seconds: number, active = true): EnemyStep {
  const dt = Math.max(0, Math.min(0.1, Number.isFinite(seconds) ? seconds : 0))
  if (!active || !dt) return { moved: false, seesPlayer: state.seesPlayer, mode: state.mode }
  const radius = Math.max(0.15, Math.min(1.5, settings.radius ?? 0.43)), height = Math.max(radius * 2, settings.height ?? 1.1)
  state.perceptionIn -= dt
  if (state.perceptionIn <= 0) {
    state.perceptionIn = 0.15
    const eyes = state.position.clone().add(new THREE.Vector3(0, (settings.eyeHeight ?? Math.max(0.55, height * 0.7)) - state.hover, 0))
    const target = playerFeet.clone().add(new THREE.Vector3(0, 1.4, 0))
    const inLeash = state.base.distanceTo(playerFeet) <= settings.range * 1.7
    state.seesPlayer = inLeash && eyes.distanceTo(target) <= settings.range && enemyCanSee(eyes, target, collider)
    if (state.seesPlayer) state.lastSeen = playerFeet.clone()
  }
  if (state.seesPlayer) { state.memory = 4; state.mode = 'chase' }
  else { state.memory = Math.max(0, state.memory - dt); state.mode = state.lastSeen && state.memory > 0 ? 'search' : state.mode === 'patrol' ? 'patrol' : 'return' }
  let target: THREE.Vector3
  if (state.mode === 'chase' || state.mode === 'search') target = state.lastSeen!.clone()
  else if (state.mode === 'return') {
    target = state.base.clone()
    if (Math.hypot(target.x - state.position.x, target.z - state.position.z) < 0.35) { state.mode = 'patrol'; state.lastSeen = null }
  } else {
    const patrol = Math.min(4, settings.range * 0.35)
    target = state.base.clone().add(new THREE.Vector3(Math.cos(state.phase) * patrol, 0, Math.sin(state.phase) * patrol))
    if (Math.hypot(target.x - state.position.x, target.z - state.position.z) < 0.4) state.phase += Math.PI * 0.6
  }
  const wish = target.sub(state.position).setY(0), remaining = wish.length()
  if (remaining < (state.mode === 'chase' ? 0.65 : 0.12) || settings.speed <= 0) return { moved: false, seesPlayer: state.seesPlayer, mode: state.mode }
  wish.divideScalar(remaining)
  const distance = Math.min(remaining, Math.max(0, settings.speed) * dt)
  // A stable preferred side prevents alternating left/right at the same obstacle every frame.
  const angles = [0, 0.55, 1.05, 1.55, -0.55, -1.05, -1.55, 2.15]
  for (const angle of angles) {
    const direction = wish.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), angle * state.turnSide)
    const candidate = moveCandidate(state.position, direction, distance, state.hover, collider, radius, height)
    if (!candidate || Math.hypot(candidate.x - state.base.x, candidate.z - state.base.z) > settings.range * 1.8 + 1) continue
    state.position.copy(candidate)
    state.heading = Math.atan2(direction.x, direction.z)
    return { moved: true, seesPlayer: state.seesPlayer, mode: state.mode }
  }
  return { moved: false, seesPlayer: state.seesPlayer, mode: state.mode }
}
