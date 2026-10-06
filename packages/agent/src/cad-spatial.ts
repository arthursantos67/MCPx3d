import type { CadBounds, CadCollision } from '../../domain/ts/src/cad-assembly-diagnostics.ts'
import type { CadMotion } from '../../domain/ts/src/cad-assembly.ts'
import type { CadVector } from '../../domain/ts/src/cad-program.ts'

export const axes = ['x', 'y', 'z'] as const
export const dot = (a: CadVector, b: CadVector) => axes.reduce((sum, axis) => sum + a[axis] * b[axis], 0)
export const add = (a: CadVector, b: CadVector): CadVector => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
export const subtract = (a: CadVector, b: CadVector): CadVector => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
export const scale = (a: CadVector, value: number): CadVector => ({ x: a.x * value, y: a.y * value, z: a.z * value })

export function commandAtPose(motion: CadMotion, pose: CadCollision['pose']): number {
  if (pose === 'current') return motion.value
  const fraction = { minimum: 0, quarter: 0.25, middle: 0.5, three_quarters: 0.75, maximum: 1 }[pose]
  return motion.minimum + (motion.maximum - motion.minimum) * fraction
}

export function rotate(point: CadVector, rotation: CadVector): CadVector {
  const [x, y, z] = axes.map((axis) => rotation[axis] * Math.PI / 180)
  const a = { x: point.x, y: point.y * Math.cos(x) - point.z * Math.sin(x), z: point.y * Math.sin(x) + point.z * Math.cos(x) }
  const b = { x: a.x * Math.cos(y) + a.z * Math.sin(y), y: a.y, z: -a.x * Math.sin(y) + a.z * Math.cos(y) }
  const result = { x: b.x * Math.cos(z) - b.y * Math.sin(z), y: b.x * Math.sin(z) + b.y * Math.cos(z), z: b.z }
  for (const axis of axes) if (Math.abs(result[axis]) < 1e-12) result[axis] = 0
  return result
}

export const direction = (rotation: CadVector) => rotate({ x: 0, y: 0, z: 1 }, rotation)

export function axialRotation(rotation: CadVector, angle: number): CadVector {
  const x = rotate({ x: 1, y: 0, z: 0 }, rotation), y = rotate({ x: 0, y: 1, z: 0 }, rotation)
  const z = direction(rotation), radians = angle * Math.PI / 180
  const a = add(scale(x, Math.cos(radians)), scale(y, Math.sin(radians)))
  const b = add(scale(x, -Math.sin(radians)), scale(y, Math.cos(radians)))
  const tilt = Math.asin(Math.max(-1, Math.min(1, -a.z)))
  const result = Math.abs(Math.cos(tilt)) > 1e-8
    ? { x: Math.atan2(b.z, z.z), y: tilt, z: Math.atan2(a.y, a.x) }
    : { x: Math.atan2(-z.y, b.y), y: tilt, z: 0 }
  const degrees = (value: number) => Math.abs(value) < 1e-12 ? 0 : value * 180 / Math.PI
  return { x: degrees(result.x), y: degrees(result.y), z: degrees(result.z) }
}

export function lineDistance(a: CadVector, b: CadVector, axis: CadVector): number {
  const offset = subtract(a, b)
  return Math.sqrt(Math.max(0, dot(offset, offset) - dot(offset, axis) ** 2))
}

export function interval(bounds: CadBounds, axis: CadVector): readonly [number, number] {
  return [axes.reduce((sum, key) => sum + Math.min(...bounds[key].map((v) => v * axis[key])), 0),
    axes.reduce((sum, key) => sum + Math.max(...bounds[key].map((v) => v * axis[key])), 0)]
}
