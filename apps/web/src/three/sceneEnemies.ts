import * as THREE from 'three'
import type { PlayerBox, PlayerCollider } from './scenePlayer.ts'
import type { NpcActivity, NpcTask } from './sceneRoutines.ts'

export type EnemyMode = 'patrol' | 'chase' | 'search' | 'return'
export type EnemyAttack = 'touch' | 'melee' | 'ranged' | 'charge'
/** Attack cycle: windup before a melee strike or charge, dash while charging; pause/talk are NPC states. */
export type EnemyAction = 'idle' | 'windup' | 'dash' | 'pause' | 'talk'
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
  action: EnemyAction
  actionTime: number
  cooldown: number
  dash: THREE.Vector3
  clock: number
  /** Flyers: current offset from their base altitude while rising toward the player. */
  lift: number
  /** NPC life: greeting timer, fear of a threat (optionally the player after an attack), guard alarm and routine progress. */
  greet: number
  fear: number
  threat: THREE.Vector3 | null
  threatIsPlayer: boolean
  alarm: THREE.Vector3 | null
  alarmTime: number
  taskKey: string
  settled: boolean
  best: number
  stall: number
  leg: number
}
export type NpcReaction = 'greet' | 'ignore' | 'flee' | 'alert'
/**
 * `attack` defaults to touch (contact damage stays with the caller); NPCs wander and face the player, never chase or attack.
 * Optional navigation: `route` returns the next waypoint toward a goal (ground agents only) and `neighbors` are the feet of nearby agents
 * to keep apart from. NPC life: `task` is the active routine period, `threats` the feet of enemies chasing nearby, `guards` the feet of
 * guard NPCs an alerting NPC runs to, and `guard` marks this NPC as one who answers alarms.
 */
export interface EnemySettings { speed: number; range: number; radius?: number; height?: number; eyeHeight?: number; attack?: EnemyAttack; flying?: boolean; npc?: boolean
  route?: (from: THREE.Vector3, to: THREE.Vector3) => THREE.Vector3; neighbors?: THREE.Vector3[]
  task?: NpcTask | null; reaction?: NpcReaction; threats?: THREE.Vector3[]; guards?: THREE.Vector3[]; guard?: boolean }
/**
 * `attack` is set only on the step an attack is released; shots carry a unit `aim` direction starting at `muzzle`.
 * NPCs report an `activity` pose and a `face` point to look at; `anchor` is where the visual body belongs during the activity (seat,
 * counter), `alarm` the threat an alerting NPC reports to the guard it reached, and `indoors` a sleeper that reached its door.
 */
export interface EnemyStep { moved: boolean; seesPlayer: boolean; mode: EnemyMode; attack?: 'shoot' | 'melee' | 'charge'; aim?: THREE.Vector3; muzzle?: THREE.Vector3
  activity?: NpcActivity | null; face?: THREE.Vector3; anchor?: THREE.Vector3; alarm?: THREE.Vector3; indoors?: boolean }
export const ENEMY_COMBAT = { meleeReach: 1.3, meleeHit: 2, meleeWindup: 0.35, meleeCooldown: 1, chargeRange: 6, chargeWindup: 0.4, chargeTime: 0.6, chargeSpeed: 2.4, chargeCooldown: 1.6,
  shotCooldown: 1.6, preferred: 0.6, npcNear: 4, flyBob: 0.15, flyRise: 3, flyDrop: 1 } as const
export const NPC_LIFE = { greet: 1.2, fearRadius: 7, fearTime: 3, provoked: 6, alarmTime: 12, report: 1.8, guardStop: 2.5, arrive: 0.35, settle: 1.8, stall: 1.2, giveUp: 6,
  patrolPause: 2.5, separation: 0.35 } as const

export function createEnemyMotion(base: THREE.Vector3, ground: number, phase = 0): EnemyMotion {
  return { base: base.clone(), position: base.clone(), hover: Math.max(0, base.y - ground), heading: 0,
    phase, mode: 'patrol', lastSeen: null, memory: 0, perceptionIn: 0, seesPlayer: false, turnSide: Math.sin(phase) < 0 ? -1 : 1,
    action: 'idle', actionTime: 0, cooldown: 0, dash: new THREE.Vector3(), clock: 0, lift: 0,
    greet: 0, fear: 0, threat: null, threatIsPlayer: false, alarm: null, alarmTime: 0, taskKey: '', settled: false, best: Infinity, stall: 0, leg: 1 }
}

/** The player attacked this NPC: it flees from (or, with 'alert', reports) the player for a while. 'ignore' NPCs do not react. */
export function provokeNpc(state: EnemyMotion, playerFeet: THREE.Vector3, reaction: NpcReaction = 'greet'): void {
  if (reaction === 'ignore') return
  state.fear = NPC_LIFE.provoked; state.threat = playerFeet.clone(); state.threatIsPlayer = true; state.settled = false
}
/** A guard receives an alarm (from EnemyStep.alarm) and heads to the threat. */
export function alertGuard(state: EnemyMotion, threat: THREE.Vector3): void {
  state.alarm = threat.clone(); state.alarmTime = NPC_LIFE.alarmTime; state.settled = false
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

/** Flyers need no ground support, but their capsule (feet at the body origin) is still blocked by colliders. */
function flyCandidate(position: THREE.Vector3, direction: THREE.Vector3, distance: number, collider: PlayerCollider, radius: number, height: number): THREE.Vector3 | null {
  const steps = Math.max(1, Math.ceil(distance / Math.min(0.16, radius * 0.5))), candidate = position.clone()
  for (let i = 0; i < steps; i++) {
    candidate.addScaledVector(direction, distance / steps)
    if (!capsuleClear(candidate, collider, radius, height)) return null
  }
  return candidate
}

const UP = new THREE.Vector3(0, 1, 0), ANGLES = [0, 0.55, 1.05, 1.55, -0.55, -1.05, -1.55, 2.15]
const facing = (from: THREE.Vector3, to: THREE.Vector3, fallback: number) => Math.hypot(to.x - from.x, to.z - from.z) > 1e-4 ? Math.atan2(to.x - from.x, to.z - from.z) : fallback
const hash = (value: number) => { const x = Math.sin(value * 12.9898) * 43758.5453; return x - Math.floor(x) }
const flatDistance = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z)
const nearest = (points: THREE.Vector3[] | undefined, from: THREE.Vector3, limit: number) => {
  let best: THREE.Vector3 | null = null, distance = limit
  for (const point of points ?? []) { const d = flatDistance(point, from); if (d <= distance && Math.abs(point.y - from.y) < 3) { best = point; distance = d } }
  return best
}
const routinePose: Record<NpcTask['activity'], NpcActivity | null> = { wander: null, work: 'work', sit: 'sit', chat: 'chat', patrol: 'guard', guard: 'guard', sleep: 'sleep', perform: 'perform' }

/** One deterministic bounded update. The supplied collider must exclude enemy bodies themselves. */
export function stepEnemyMotion(state: EnemyMotion, settings: EnemySettings, playerFeet: THREE.Vector3, collider: PlayerCollider, seconds: number, active = true): EnemyStep {
  const dt = Math.max(0, Math.min(0.1, Number.isFinite(seconds) ? seconds : 0))
  if (!active || !dt) return { moved: false, seesPlayer: state.seesPlayer, mode: state.mode }
  const radius = Math.max(0.15, Math.min(1.5, settings.radius ?? 0.43)), height = Math.max(radius * 2, settings.height ?? 1.1), flying = !!settings.flying
  const attack = settings.attack ?? 'touch', speed = Math.max(0, settings.speed)
  state.clock += dt
  state.cooldown = Math.max(0, state.cooldown - dt)
  let moved = false
  const travel = (wish: THREE.Vector3, distance: number, angles: readonly number[], turn = true) => {
    for (const angle of angles) {
      const direction = wish.clone().applyAxisAngle(UP, angle * state.turnSide)
      const candidate = flying ? flyCandidate(state.position, direction, distance, collider, radius, height) : moveCandidate(state.position, direction, distance, state.hover, collider, radius, height)
      if (!candidate || Math.hypot(candidate.x - state.base.x, candidate.z - state.base.z) > settings.range * 1.8 + 1) continue
      state.position.copy(candidate)
      if (turn) state.heading = Math.atan2(direction.x, direction.z)
      moved = true
      return true
    }
    return false
  }
  const step = (extra: Partial<EnemyStep> = {}): EnemyStep => ({ moved, seesPlayer: state.seesPlayer, mode: state.mode, ...extra })
  if (flying) {
    // Hover at the base altitude with a slight bob; chasing flyers rise or dip toward the player's chest within limits.
    const wanted = state.mode === 'chase' && !settings.npc ? Math.min(ENEMY_COMBAT.flyRise, Math.max(-ENEMY_COMBAT.flyDrop, playerFeet.y + 1.2 - state.base.y)) : 0
    state.lift += Math.sign(wanted - state.lift) * Math.min(Math.abs(wanted - state.lift), Math.max(1, speed * 0.5) * dt)
    const y = state.base.y + state.lift + ENEMY_COMBAT.flyBob * Math.sin(state.clock * 2.2 + state.phase)
    if (Math.abs(y - state.position.y) > 1e-6 && capsuleClear(state.position.clone().setY(y), collider, radius, height)) { state.position.y = y; moved = true }
  }
  if (settings.npc) {
    // NPCs wander between deterministic points around their base, pause, and stop to face a nearby player.
    state.mode = 'patrol'
    state.seesPlayer = Math.hypot(playerFeet.x - state.position.x, playerFeet.z - state.position.z) <= ENEMY_COMBAT.npcNear && Math.abs(playerFeet.y - (state.position.y - state.hover)) < 3
    if (state.seesPlayer) { state.action = 'talk'; state.heading = facing(state.position, playerFeet, state.heading); return step() }
    if (state.action === 'talk') state.action = 'idle'
    if (state.action === 'pause') { state.actionTime -= dt; if (state.actionTime > 0) return step(); state.action = 'idle' }
    const reach = Math.min(4, settings.range) * (0.35 + 0.65 * hash(state.phase))
    const wish = state.base.clone().add(new THREE.Vector3(Math.cos(state.phase) * reach, 0, Math.sin(state.phase) * reach)).sub(state.position).setY(0), remaining = wish.length()
    const rest = (seconds: number) => { state.phase += 2.39996; state.action = 'pause'; state.actionTime = seconds; return step() }
    if (remaining < 0.2 || !speed) return rest(1.5 + hash(state.phase + 1))
    return travel(wish.divideScalar(remaining), Math.min(remaining, Math.min(1.5, speed * 0.5) * dt), ANGLES.slice(0, 4)) ? step() : rest(1)
  }
  state.perceptionIn -= dt
  if (state.perceptionIn <= 0) {
    state.perceptionIn = 0.15
    const eyes = flying ? state.position.clone().add(new THREE.Vector3(0, Math.min(settings.eyeHeight ?? height * 0.5, height * 0.5), 0))
      : state.position.clone().add(new THREE.Vector3(0, (settings.eyeHeight ?? Math.max(0.55, height * 0.7)) - state.hover, 0))
    const target = playerFeet.clone().add(new THREE.Vector3(0, 1.4, 0))
    const inLeash = state.base.distanceTo(playerFeet) <= settings.range * 1.7 + (flying ? state.hover + ENEMY_COMBAT.flyRise : 0)
    state.seesPlayer = inLeash && eyes.distanceTo(target) <= settings.range && enemyCanSee(eyes, target, collider)
    if (state.seesPlayer) state.lastSeen = playerFeet.clone()
  }
  if (state.seesPlayer) { state.memory = 4; state.mode = 'chase' }
  else { state.memory = Math.max(0, state.memory - dt); state.mode = state.lastSeen && state.memory > 0 ? 'search' : state.mode === 'patrol' ? 'patrol' : 'return' }
  const flat = Math.hypot(playerFeet.x - state.position.x, playerFeet.z - state.position.z)
  if (state.action === 'dash') {
    state.actionTime -= dt
    if (state.actionTime <= 0 || !travel(state.dash, speed * ENEMY_COMBAT.chargeSpeed * dt, [0])) { state.action = 'idle'; state.cooldown = ENEMY_COMBAT.chargeCooldown }
    return step()
  }
  if (state.action === 'windup') {
    state.actionTime -= dt
    if (attack === 'melee') state.heading = facing(state.position, playerFeet, state.heading)
    if (state.actionTime > 0) return step()
    state.action = 'idle'
    if (attack === 'charge') {
      state.action = 'dash'; state.actionTime = ENEMY_COMBAT.chargeTime
      state.dash.set(Math.sin(state.heading), 0, Math.cos(state.heading))
      return step({ attack: 'charge' })
    }
    state.cooldown = ENEMY_COMBAT.meleeCooldown
    const vertical = Math.abs(playerFeet.y - (state.position.y - (flying ? 0 : state.hover)))
    return flat <= ENEMY_COMBAT.meleeHit && vertical < 2 ? step({ attack: 'melee' }) : step()
  }
  const ready = state.mode === 'chase' && state.seesPlayer && !state.cooldown
  if (ready && ((attack === 'melee' && flat <= ENEMY_COMBAT.meleeReach + 0.1) || (attack === 'charge' && speed > 0 && flat <= ENEMY_COMBAT.chargeRange))) {
    state.action = 'windup'; state.actionTime = attack === 'melee' ? ENEMY_COMBAT.meleeWindup : ENEMY_COMBAT.chargeWindup
    state.heading = facing(state.position, playerFeet, state.heading)
    return step()
  }
  let shot: Partial<EnemyStep> = {}
  if (ready && attack === 'ranged') {
    state.cooldown = ENEMY_COMBAT.shotCooldown
    const muzzle = state.position.clone().add(new THREE.Vector3(0, flying ? height * 0.5 : Math.max(0.4, height * 0.6) - state.hover, 0))
    shot = { attack: 'shoot', muzzle, aim: playerFeet.clone().add(new THREE.Vector3(0, 1.1, 0)).sub(muzzle).normalize() }
  }
  const ranged = attack === 'ranged' && state.mode === 'chase'
  let target: THREE.Vector3
  if (ranged) {
    // Keep a preferred distance from the last seen position and strafe sideways around it.
    const seen = state.lastSeen!, away = state.position.clone().sub(seen).setY(0), distance = away.length()
    if (distance > 1e-4) away.divideScalar(distance); else away.set(Math.sin(state.heading + Math.PI), 0, Math.cos(state.heading + Math.PI))
    const side = new THREE.Vector3(-away.z, 0, away.x).multiplyScalar(Math.sin(state.clock * 1.3 + state.phase) >= 0 ? 1.2 : -1.2)
    target = seen.clone().addScaledVector(away, settings.range * ENEMY_COMBAT.preferred).add(side)
  } else if (state.mode === 'chase' || state.mode === 'search') target = state.lastSeen!.clone()
  else if (state.mode === 'return') {
    target = state.base.clone()
    if (Math.hypot(target.x - state.position.x, target.z - state.position.z) < 0.35) { state.mode = 'patrol'; state.lastSeen = null }
  } else {
    const patrol = Math.min(4, settings.range * 0.35)
    target = state.base.clone().add(new THREE.Vector3(Math.cos(state.phase) * patrol, 0, Math.sin(state.phase) * patrol))
    if (Math.hypot(target.x - state.position.x, target.z - state.position.z) < 0.4) state.phase += Math.PI * 0.6
  }
  const wish = target.sub(state.position).setY(0), remaining = wish.length()
  const stop = state.mode !== 'chase' ? 0.12 : ranged ? 0.25 : attack === 'melee' ? ENEMY_COMBAT.meleeReach - 0.2 : 0.65
  if (ranged) state.heading = facing(state.position, state.lastSeen!, state.heading)
  if (remaining < stop || speed <= 0) return step(shot)
  wish.divideScalar(remaining)
  // A stable preferred side prevents alternating left/right at the same obstacle every frame.
  travel(wish, Math.min(attack === 'melee' && state.mode === 'chase' ? remaining - stop + 0.05 : remaining, speed * (ranged ? 0.75 : 1) * dt), ANGLES, !ranged)
  return step(shot)
}
