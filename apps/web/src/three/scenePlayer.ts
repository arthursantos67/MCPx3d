import * as THREE from 'three'
import { MeshBVH, type ExtendedTriangle } from 'three-mesh-bvh'

export const PLAYER_RADIUS = 0.32, PLAYER_HEIGHT = 1.75, PLAYER_EYE = 1.62, GRAVITY = 24
export const MAX_COLLIDER_TRIANGLES = 1_500_000
export interface PlayerInput { forward: boolean; back: boolean; left: boolean; right: boolean; turnLeft: boolean; turnRight: boolean; up: boolean; down: boolean; sprint: boolean; jump: boolean }
export const emptyInput = (): PlayerInput => ({ forward: false, back: false, left: false, right: false, turnLeft: false, turnRight: false, up: false, down: false, sprint: false, jump: false })
export interface PlayerState { position: THREE.Vector3; velocity: THREE.Vector3; yaw: number; pitch: number; onGround: boolean; fly: boolean; climbing?: boolean }
/** Oriented box used for moving or interactive objects. */
export interface PlayerBox { center: THREE.Vector3; axes: [THREE.Vector3, THREE.Vector3, THREE.Vector3]; half: THREE.Vector3 }
export interface PlayerCollider { bvh: MeshBVH | null; boxes: PlayerBox[]; floor: number; climb?: PlayerBox[] }

/** Bakes world-space triangles into one BVH; returns the number of omitted triangles beyond the budget. */
export function buildStaticCollider(entries: { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }[]): { bvh: MeshBVH | null; omitted: number } {
  const positions: number[] = [], indices: number[] = [], point = new THREE.Vector3()
  let omitted = 0
  for (const { geometry, matrix } of entries) {
    const position = geometry.getAttribute('position'), index = geometry.index
    const triangles = (index ? index.count : position.count) / 3
    if (indices.length / 3 + triangles > MAX_COLLIDER_TRIANGLES) { omitted += triangles; continue }
    const offset = positions.length / 3
    for (let i = 0; i < position.count; i++) { point.fromBufferAttribute(position, i).applyMatrix4(matrix); positions.push(point.x, point.y, point.z) }
    if (index) for (let i = 0; i < index.count; i++) indices.push(index.getX(i) + offset)
    else for (let i = 0; i < position.count; i++) indices.push(i + offset)
  }
  if (!indices.length) return { bvh: null, omitted }
  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  merged.setIndex(indices)
  return { bvh: new MeshBVH(merged), omitted }
}

export function boxFromMatrix(matrix: THREE.Matrix4): PlayerBox {
  const center = new THREE.Vector3(), x = new THREE.Vector3(), y = new THREE.Vector3(), z = new THREE.Vector3()
  matrix.extractBasis(x, y, z)
  center.setFromMatrixPosition(matrix)
  const half = new THREE.Vector3(x.length() / 2, y.length() / 2, z.length() / 2)
  return { center, axes: [x.normalize(), y.normalize(), z.normalize()], half }
}

/** Distance from a point to an oriented box (0 inside). */
export function distanceToBox(point: THREE.Vector3, box: PlayerBox): number {
  const offset = point.clone().sub(box.center)
  let squared = 0
  for (let i = 0; i < 3; i++) { const excess = Math.max(Math.abs(offset.dot(box.axes[i])) - box.half.getComponent(i), 0); squared += excess * excess }
  return Math.sqrt(squared)
}
/** Whether the capsule (feet at `position`) is within `margin` of the box surface. */
export function capsuleTouches(position: THREE.Vector3, box: PlayerBox, margin = 0.05): boolean {
  for (const height of [PLAYER_RADIUS, PLAYER_HEIGHT / 2, PLAYER_HEIGHT - PLAYER_RADIUS]) if (distanceToBox(new THREE.Vector3(position.x, position.y + height, position.z), box) < PLAYER_RADIUS + margin) return true
  return false
}
/** Keeps each 1/120 s substep shorter than the capsule radius, so fast falls cannot tunnel through floors. */
const MAX_FALL_SPEED = 30
const segment = new THREE.Line3(), triPoint = new THREE.Vector3(), capsulePoint = new THREE.Vector3(), searchBox = new THREE.Box3()
const before = new THREE.Vector3(), delta = new THREE.Vector3(), away = new THREE.Vector3(), probe = new THREE.Vector3(), local = new THREE.Vector3(), closest = new THREE.Vector3()
function pushOutOfBox(box: PlayerBox) {
  for (let k = 0; k <= 5; k++) {
    segment.at(k / 5, probe)
    local.subVectors(probe, box.center)
    const coords = box.axes.map((axis) => local.dot(axis))
    const clamped = coords.map((value, i) => Math.min(box.half.getComponent(i), Math.max(-box.half.getComponent(i), value)))
    closest.copy(box.center)
    for (let i = 0; i < 3; i++) closest.addScaledVector(box.axes[i], clamped[i])
    const distance = probe.distanceTo(closest)
    if (distance >= PLAYER_RADIUS) continue
    if (distance > 1e-6) { delta.subVectors(probe, closest).multiplyScalar((PLAYER_RADIUS - distance) / distance) }
    else {
      let axis = 0, depth = Infinity
      for (let i = 0; i < 3; i++) { const d = box.half.getComponent(i) - Math.abs(coords[i]); if (d < depth) { depth = d; axis = i } }
      delta.copy(box.axes[axis]).multiplyScalar((depth + PLAYER_RADIUS) * Math.sign(coords[axis] || 1))
    }
    segment.start.add(delta); segment.end.add(delta)
  }
}

function collide(state: PlayerState, collider: PlayerCollider) {
  segment.start.set(state.position.x, state.position.y + PLAYER_RADIUS, state.position.z)
  segment.end.set(state.position.x, state.position.y + PLAYER_HEIGHT - PLAYER_RADIUS, state.position.z)
  before.copy(segment.start)
  if (collider.bvh) {
    searchBox.makeEmpty().expandByPoint(segment.start).expandByPoint(segment.end)
    searchBox.min.addScalar(-PLAYER_RADIUS); searchBox.max.addScalar(PLAYER_RADIUS)
    collider.bvh.shapecast({
      intersectsBounds: (box) => box.intersectsBox(searchBox),
      intersectsTriangle: (triangle: ExtendedTriangle) => {
        const distance = triangle.closestPointToSegment(segment, triPoint, capsulePoint)
        if (distance < PLAYER_RADIUS) {
          // A segment crossing the triangle has no separation vector; push along the face normal, towards where the capsule came from.
          const direction = distance > 1e-6 ? capsulePoint.sub(triPoint).normalize() : triangle.getNormal(away)
          if (distance <= 1e-6 && direction.dot(capsulePoint.subVectors(before, triPoint)) < 0) direction.negate()
          segment.start.addScaledVector(direction, PLAYER_RADIUS - distance)
          segment.end.addScaledVector(direction, PLAYER_RADIUS - distance)
        }
      },
    })
  }
  for (const box of collider.boxes) {
    if (box.center.distanceTo(segment.start) > box.half.length() + PLAYER_HEIGHT + PLAYER_RADIUS) continue
    pushOutOfBox(box)
  }
  delta.subVectors(segment.start, before)
  state.position.set(segment.start.x, segment.start.y - PLAYER_RADIUS, segment.start.z)
  return delta
}

/** Prefer the floor under the requested feet, so an interior spawn never snaps onto the roof. */
export function findWalkableSpawn(collider: PlayerCollider, requested: THREE.Vector3, bounds: THREE.Box3, water: number | null, authored = true): THREE.Vector3 {
  if (!collider.bvh) return requested.clone()
  const candidate: PlayerState={position:new THREE.Vector3(),velocity:new THREE.Vector3(),yaw:0,pitch:0,onGround:false,fly:false}
  const support=(x:number,z:number,height:number,local:boolean) => {
    const ray=new THREE.Ray(new THREE.Vector3(x,height,z),new THREE.Vector3(0,-1,0))
    const hits=collider.bvh!.raycast(ray,THREE.DoubleSide).sort((a,b)=>a.distance-b.distance)
    for(const hit of hits) {
      if(!hit.face || hit.face.normal.y<0.55 || (local && requested.y-hit.point.y>3) || (water!==null && hit.point.y<=water+0.2)) continue
      candidate.position.set(x,hit.point.y+0.025,z)
      const feet=candidate.position.clone()
      collide(candidate,collider)
      if(candidate.position.distanceToSquared(feet)<0.0004) return feet
    }
    return null
  }
  if(authored) for(let radius=0;radius<=16;radius+=2) for(let k=0;k<(radius?24:1);k++) {
    const found=support(requested.x+Math.cos(k*Math.PI/12)*radius,requested.z+Math.sin(k*Math.PI/12)*radius,requested.y+0.3,true)
    if(found) return found
  }
  for(let radius=0;radius<=200;radius+=2) for(let k=0;k<(radius?24:1);k++) {
    const found=support(requested.x+Math.cos(k*Math.PI/12)*radius,requested.z+Math.sin(k*Math.PI/12)*radius,(bounds.isEmpty()?0:bounds.max.y)+50,false)
    if(found) return found
  }
  return requested.clone()
}

/** Fixed sub-steps keep collisions stable at low frame rates. */
export function stepPlayer(state: PlayerState, input: PlayerInput, collider: PlayerCollider, settings: { speed: number; jumpHeight: number }, seconds: number): void {
  const dt = Math.min(seconds, 0.1), steps = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / steps
  state.yaw += ((input.turnLeft ? 1 : 0) - (input.turnRight ? 1 : 0)) * 2.2 * dt
  const speed = settings.speed * (input.sprint ? 1.8 : 1)
  const forward = new THREE.Vector3(-Math.sin(state.yaw), 0, -Math.cos(state.yaw)), right = new THREE.Vector3(Math.cos(state.yaw), 0, -Math.sin(state.yaw))
  const wish = new THREE.Vector3().addScaledVector(forward, (input.forward ? 1 : 0) - (input.back ? 1 : 0)).addScaledVector(right, (input.right ? 1 : 0) - (input.left ? 1 : 0))
  if (wish.lengthSq()) wish.normalize().multiplyScalar(speed)
  if (state.fly) {
    const vertical = ((input.up || input.jump ? 1 : 0) - (input.down ? 1 : 0)) * speed
    state.velocity.set(wish.x, vertical, wish.z)
    state.position.addScaledVector(state.velocity, dt)
    state.onGround = false
    return
  }
  // Ladders: pressing forward/back next to a climbable surface moves vertically without gravity.
  state.climbing = !!collider.climb?.length && (input.forward || input.back) && collider.climb.some((box) => capsuleTouches(state.position, box, 0.35))
  if (state.climbing) {
    state.velocity.set(0, input.forward ? 2.6 : -2.6, 0)
    state.position.addScaledVector(state.velocity, dt)
    collide(state, collider)
    if (state.position.y <= collider.floor) state.position.y = collider.floor
    state.onGround = false
    return
  }
  const control = state.onGround ? 1 : 0.25
  state.velocity.x += (wish.x - state.velocity.x) * Math.min(1, dt * 12 * control)
  state.velocity.z += (wish.z - state.velocity.z) * Math.min(1, dt * 12 * control)
  if (input.jump && state.onGround) { state.velocity.y = Math.sqrt(2 * GRAVITY * settings.jumpHeight); state.onGround = false }
  for (let i = 0; i < steps; i++) {
    const previous = state.position.clone(), grounded = state.onGround
    state.velocity.y = Math.max(-MAX_FALL_SPEED, state.velocity.y - GRAVITY * h)
    state.position.addScaledVector(state.velocity, h)
    const push = collide(state, collider)
    // Try a small step only when grounded and horizontal progress was blocked.
    // The raised capsule must fit, and must find a supporting tread on descent.
    const intendedX = state.velocity.x * h, intendedZ = state.velocity.z * h
    const intended = Math.hypot(intendedX, intendedZ)
    const progress = Math.hypot(state.position.x-previous.x,state.position.z-previous.z)
    if (grounded && state.velocity.y <= 0 && intended > 0.0001 && progress < intended * 0.85) {
      const resolved = state.position.clone(), rise = 0.26
      state.position.copy(previous).add(new THREE.Vector3(0,rise,0))
      const headroom = collide(state,collider).lengthSq() < 1e-8
      state.position.x += intendedX; state.position.z += intendedZ
      const clearance = collide(state,collider).lengthSq() < 1e-8
      state.position.y -= rise + 0.035
      const landing = collide(state,collider).y > 0.01
      const gained = state.position.y-previous.y
      if (!headroom || !clearance || !landing || gained <= 0.001 || gained > rise + 0.005) state.position.copy(resolved)
      else { push.set(0,Math.max(0.01,gained),0); state.velocity.y=0 }
    }
    state.onGround = push.y > Math.abs(h * state.velocity.y * 0.25)
    if (state.position.y <= collider.floor) { state.position.y = collider.floor; state.onGround = true }
    if (state.onGround) state.velocity.y = Math.max(0, state.velocity.y)
    else if (push.lengthSq() > 1e-10) { push.normalize(); state.velocity.addScaledVector(push, -Math.min(0, push.dot(state.velocity))) }
  }
}
