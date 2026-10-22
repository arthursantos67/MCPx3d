import * as THREE from 'three'
import type { weaponKinds } from './sceneDocument.ts'
import { enemyCanSee } from './sceneEnemies.ts'
import { capsuleTouches, PLAYER_HEIGHT, PLAYER_RADIUS, type PlayerBox, type PlayerCollider } from './scenePlayer.ts'

export type WeaponKind = typeof weaponKinds[number]
/** Melee range guides targeting; damage requires animated contact. Projectiles fly at `speed` m/s for `range` metres. */
export interface WeaponStats { kind: 'melee' | 'projectile'; damage: number; cooldown: number; range: number; arc?: number; speed?: number; radius?: number; color: string; gravity?: number }
export const weaponStats: Record<WeaponKind, WeaponStats> = {
  none: { kind: 'melee', damage: 1, cooldown: 0.45, range: 0.85, arc: 50, color: '#ffd27a' },
  sword: { kind: 'melee', damage: 2, cooldown: 0.5, range: 1.6, arc: 110, color: '#dfe8ff' },
  blaster: { kind: 'projectile', damage: 1, cooldown: 0.22, range: 45, speed: 42, radius: 0.08, color: '#5ff2ff' },
  bow: { kind: 'projectile', damage: 2, cooldown: 0.75, range: 60, speed: 30, radius: 0.06, gravity: 12, color: '#d9b98c' },
  staff: { kind: 'projectile', damage: 2, cooldown: 0.9, range: 30, speed: 14, radius: 0.3, color: '#b57bff' },
}
/** Enemy shots: slow enough to dodge. Damage comes from the enemy behavior. */
export const ENEMY_SHOT = { speed: 16, radius: 0.15, life: 3, color: '#ff5a3c' } as const
export interface Projectile { id: number; owner: 'player' | string; position: THREE.Vector3; velocity: THREE.Vector3; radius: number; damage: number; life: number; color: string; gravity?: number }
export interface ProjectileHit { projectile: Projectile; target: string | 'player' | 'world'; point: THREE.Vector3 }
export interface CombatTarget { id: string; box: PlayerBox }

let nextId = 1
/** Player projectile from a weapon; `damage` multiplier comes from playerModifiers().damage. */
export function fireWeapon(weapon: WeaponKind, origin: THREE.Vector3, direction: THREE.Vector3, multiplier = 1): Projectile | null {
  const stats = weaponStats[weapon]
  if (stats.kind !== 'projectile') return null
  const speed = stats.speed ?? 30
  return { id: nextId++, owner: 'player', position: origin.clone(), velocity: direction.clone().normalize().multiplyScalar(speed), radius: stats.radius ?? 0.1,
    damage: stats.damage * multiplier, life: stats.range / speed, color: stats.color, ...(stats.gravity ? { gravity: stats.gravity } : {}) }
}
export function enemyShot(owner: string, origin: THREE.Vector3, aim: THREE.Vector3, damage: number): Projectile {
  return { id: nextId++, owner, position: origin.clone(), velocity: aim.clone().normalize().multiplyScalar(ENEMY_SHOT.speed), radius: ENEMY_SHOT.radius, damage, life: ENEMY_SHOT.life, color: ENEMY_SHOT.color }
}

/** Entry distance along a unit ray into a box inflated by `inflate`, or null. Starting inside counts as 0. */
function boxEntry(origin: THREE.Vector3, direction: THREE.Vector3, box: PlayerBox, inflate: number): number | null {
  const offset = origin.clone().sub(box.center)
  const local = new THREE.Vector3(...box.axes.map((axis) => offset.dot(axis)) as [number, number, number])
  const dir = new THREE.Vector3(...box.axes.map((axis) => direction.dot(axis)) as [number, number, number])
  const half = box.half.clone().addScalar(inflate)
  if (Math.abs(local.x) <= half.x && Math.abs(local.y) <= half.y && Math.abs(local.z) <= half.z) return 0
  const hit = new THREE.Ray(local, dir).intersectBox(new THREE.Box3(half.clone().negate(), half), new THREE.Vector3())
  return hit ? hit.distanceTo(local) : null
}

/** Closest approach along a segment to the player capsule; returns the distance along the segment where they first overlap. */
function capsuleEntry(origin: THREE.Vector3, direction: THREE.Vector3, length: number, feet: THREE.Vector3, radius: number): number | null {
  const a = feet.clone().add(new THREE.Vector3(0, PLAYER_RADIUS, 0)), b = feet.clone().add(new THREE.Vector3(0, PLAYER_HEIGHT - PLAYER_RADIUS, 0))
  const onRay = new THREE.Vector3(), reach = PLAYER_RADIUS + radius
  const squared = new THREE.Ray(origin, direction).distanceSqToSegment(a, b, onRay)
  if (squared > reach * reach) return null
  const along = onRay.distanceTo(origin), back = Math.sqrt(Math.max(0, reach * reach - squared))
  return along - back <= length ? Math.max(0, along - back) : null
}

/**
 * Advances projectiles with swept segments (≤1/30 s substeps), so thin walls and boxes never tunnel. Player shots hit `targets` and the world;
 * enemy shots hit the player capsule and the world. The collider should exclude target bodies; on a tie the target wins.
 */
export function stepProjectiles(list: Projectile[], seconds: number, collider: PlayerCollider, targets: CombatTarget[], player?: { position: THREE.Vector3 }): { alive: Projectile[]; hits: ProjectileHit[] } {
  const total = Math.max(0, Math.min(0.25, Number.isFinite(seconds) ? seconds : 0)), steps = Math.max(1, Math.ceil(total / (1 / 30))), dt = total / steps
  const alive: Projectile[] = [], hits: ProjectileHit[] = [], ray = new THREE.Ray()
  for (const projectile of list) {
    let done = false
    for (let i = 0; i < steps && !done; i++) {
      projectile.velocity.y -= (projectile.gravity ?? 0) * dt
      const travel = projectile.velocity.clone().multiplyScalar(dt), length = travel.length()
      projectile.life -= dt
      if (length < 1e-9) { if (projectile.life <= 0) done = true; continue }
      const direction = travel.clone().divideScalar(length)
      let best = length + 1e-9, target: ProjectileHit['target'] | null = null
      if (projectile.owner === 'player') {
        for (const item of targets) { const at = boxEntry(projectile.position, direction, item.box, projectile.radius); if (at !== null && at <= best) { best = at; target = item.id } }
      } else if (player) { const at = capsuleEntry(projectile.position, direction, length, player.position, projectile.radius); if (at !== null && at <= best) { best = at; target = 'player' } }
      ray.set(projectile.position, direction)
      const world = collider.bvh?.raycastFirst(ray, THREE.DoubleSide, 0, best)
      if (world && world.distance < best - 1e-3) { best = world.distance; target = 'world' }
      for (const box of collider.boxes) { const at = boxEntry(projectile.position, direction, box, 0); if (at !== null && at < best - 1e-3) { best = at; target = 'world' } }
      if (target !== null) {
        const point = projectile.position.clone().addScaledVector(direction, best)
        projectile.position.copy(point)
        hits.push({ projectile, target, point })
        done = true
        continue
      }
      projectile.position.add(travel)
      if (projectile.life <= 0 || projectile.position.y < collider.floor - 20) done = true
    }
    if (!done) alive.push(projectile)
  }
  return { alive, hits }
}

function closestOnBox(point: THREE.Vector3, box: PlayerBox): THREE.Vector3 {
  const offset = point.clone().sub(box.center), result = box.center.clone()
  for (let i = 0; i < 3; i++) { const half = box.half.getComponent(i); result.addScaledVector(box.axes[i], Math.max(-half, Math.min(half, offset.dot(box.axes[i])))) }
  return result
}

export function sweptMeleeTargets(previous: THREE.Line3, current: THREE.Line3, radius: number, targets: CombatTarget[], collider?: PlayerCollider, source = current.start): string[] {
  if (Math.max(previous.start.distanceTo(current.start), previous.end.distanceTo(current.end)) > 3) previous = current
  const motion = Math.max(previous.start.distanceTo(current.start), previous.end.distanceTo(current.end))
  const steps = Math.max(1, Math.ceil(motion / Math.max(0.02, radius))), hits = new Set<string>()
  for (let i = 0; i <= steps; i++) {
    const start = previous.start.clone().lerp(current.start, i / steps), end = previous.end.clone().lerp(current.end, i / steps)
    const direction = end.clone().sub(start), length = direction.length()
    if (length < 1e-8) continue
    direction.divideScalar(length)
    for (const { id, box } of targets) {
      if (hits.has(id)) continue
      const entry = boxEntry(start, direction, box, radius)
      if (entry === null || entry > length) continue
      const contact = start.clone().addScaledVector(direction, entry)
      if (collider && !enemyCanSee(source, contact, collider)) continue
      hits.add(id)
    }
  }
  return [...hits]
}

export function meleePlayerContact(feet: THREE.Vector3, striking: PlayerBox[], source: THREE.Vector3, collider: PlayerCollider): boolean {
  return striking.some((box) => capsuleTouches(feet, box, 0.02)) && enemyCanSee(source, feet.clone().add(new THREE.Vector3(0, 0.9, 0)), collider)
}

/** Target ids within `range` (to the nearest box point) inside a cone of `arcDegrees`, nearest first; a collider adds a line-of-sight check. */
export function meleeTargets(origin: THREE.Vector3, forward: THREE.Vector3, range: number, arcDegrees: number, targets: CombatTarget[], collider?: PlayerCollider): string[] {
  const best = new Map<string, number>(), aim = forward.clone().normalize(), cos = Math.cos(THREE.MathUtils.degToRad(Math.min(360, arcDegrees)) / 2)
  for (const { id, box } of targets) {
    const point = closestOnBox(origin, box), offset = point.clone().sub(origin), distance = offset.length()
    if (distance > range || (best.get(id) ?? Infinity) <= distance) continue
    if (distance > 0.6) {
      // Aim at the nearest point or at the box centre, so wide bodies stay hittable at their edges.
      const toCenter = box.center.clone().sub(origin).normalize()
      if (offset.divideScalar(distance).dot(aim) < cos && toCenter.dot(aim) < cos) continue
      if (collider && !enemyCanSee(origin, point, collider)) continue
    }
    best.set(id, distance)
  }
  return [...best].sort((a, b) => a[1] - b[1]).map(([id]) => id)
}
