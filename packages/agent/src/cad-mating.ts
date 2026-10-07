import type { CadComponent } from '../../domain/ts/src/cad-assembly.ts'
import type { CadMechanicalConnection } from '../../domain/ts/src/cad-mechanics.ts'
import type { CadCollision } from '../../domain/ts/src/cad-assembly-diagnostics.ts'
import { add, scale, dot, direction, rotate, lineDistance, commandAtPose } from './cad-spatial.ts'
import { validateCadProgram, type CadProgramSpec, type CadProgramStep, type CadVector } from '../../domain/ts/src/cad-program.ts'

const zero = { x: 0, y: 0, z: 0 }
const poses: CadCollision['pose'][] = ['current', 'minimum', 'quarter', 'middle', 'three_quarters', 'maximum']

function frame(component: CadComponent, id: string, pose: CadCollision['pose']) {
  const step = component.steps.find((item) => item.id === id)
  if (!step || step.pattern || !['cylinder', 'hole', 'thread'].includes(step.shape) || !('height' in step)) return null
  let axis = direction(step.rotation)
  let center = step.shape === 'hole' ? add(step.position, scale(axis, -step.height / 2)) : step.position
  const motion = component.motion
  if (motion) {
    const command = commandAtPose(motion, pose) * (motion.factor ?? 1)
    if (motion.kind !== 'slider') {
      const rotation = { ...zero, [motion.axis]: motion.kind === 'rotary' ? command : command * 360 / motion.pitch! }
      axis = rotate(axis, rotation); center = rotate(center, rotation)
    }
    if (motion.kind !== 'rotary') center = add(center, scale({ ...zero, [motion.axis]: 1 }, command))
  }
  return { axis, center: add(component.position, center), height: step.height }
}

export function mechanicalFitIssue(target: CadComponent, built: readonly CadComponent[], joints: readonly CadMechanicalConnection[]): string | null {
  for (const joint of joints) {
    if (joint.kind === 'fixed' && joint.fastening !== 'bonded') continue
    const first = joint.first === target.id ? target : built.find((item) => item.id === joint.first)
    const second = joint.second === target.id ? target : built.find((item) => item.id === joint.second)
    if (!first || !second || !joint.firstFeature || !joint.secondFeature) continue
    for (const pose of poses) {
      const a = frame(first, joint.firstFeature, pose), b = frame(second, joint.secondFeature, pose)
      if (!a || !b) continue
      if (Math.abs(dot(a.axis, b.axis)) < 1 - 1e-6 || lineDistance(a.center, b.center, a.axis) > 1e-5) {
        return `Mechanical connection ${joint.id} at ${pose}: mating axes are not coaxial. Adjust the current component's local feature to the validated mating geometry; keep the required feature IDs.`
      }
      const centers = [dot(a.center, a.axis), dot(b.center, a.axis)]
      const intervals = [a, b].map((item, index) => [centers[index] - item.height / 2, centers[index] + item.height / 2])
      const engagement = Math.max(0, Math.min(...intervals.map((item) => item[1])) - Math.max(...intervals.map((item) => item[0])))
      if (engagement < joint.minEngagement - 1e-5) {
        return `Mechanical connection ${joint.id} at ${pose}: insufficient axial engagement ${engagement.toFixed(3)} mm; need ${joint.minEngagement.toFixed(3)} mm. Global axial intervals: ${JSON.stringify(intervals)}. Adjust the current feature length or local position autonomously while preserving completed components, clearance and the mating axis. Partial engagement alone is not evidence of collision.`
      }
    }
  }
  return null
}

function unpose(component: CadComponent, point: CadVector): CadVector {
  let local = add(point, scale(component.position, -1))
  const motion = component.motion
  if (!motion) return local
  const value = motion.value * (motion.factor ?? 1)
  if (motion.kind !== 'rotary') local = add(local, scale({ ...zero, [motion.axis]: 1 }, -value))
  if (motion.kind !== 'slider') local = rotate(local, { ...zero, [motion.axis]: -(motion.kind === 'rotary' ? value : value * 360 / motion.pitch!) })
  return local
}

export function matingContext(target: CadComponent, built: readonly CadComponent[], joints: readonly CadMechanicalConnection[]): string {
  const entries = joints.flatMap((joint) => {
    const first = joint.first === target.id
    const other = built.find((component) => component.id === (first ? joint.second : joint.first))
    const otherFeature = first ? joint.secondFeature : joint.firstFeature
    const at = other && frame(other, otherFeature, 'current')
    if (!other || !at) return []
    const axial = dot(at.center, at.axis)
    return [{ joint: joint.id, targetFeature: first ? joint.firstFeature : joint.secondFeature,
      counterpart: other.id, counterpartFeature: otherFeature, globalAxis: at.axis, globalCenter: at.center,
      globalAxialInterval: [axial - at.height / 2, axial + at.height / 2],
      targetLocalCenterAtCurrentPose: unpose(target, at.center), minEngagement: joint.minEngagement,
      maxRadialClearance: joint.maxClearance,
      counterpartStep: other.steps.find((step) => step.id === otherFeature) }]
  })
  return JSON.stringify(entries)
}

export async function repairMechanicalFitLocally(
  target: CadComponent, built: readonly CadComponent[], joints: readonly CadMechanicalConnection[], originalRequest: string,
  inspect: (spec: CadProgramSpec) => Promise<string | null>,
): Promise<{ spec: CadProgramSpec; issue: null; assumption: string } | null> {
  if (!mechanicalFitIssue(target, built, joints)) return null
  if (/\b[xyz]\s*[:=]\s*-?\d/i.test(originalRequest)) return null
  const explicitDimensions = /\d\s*(?:mm|cm)\b|[Ø⌀]\s*\d|\b(?:altura|comprimento|height|length)\s*[:=]\s*\d/i.test(originalRequest)
  const steps = [...target.steps]
  let changed = false
  for (const step of target.steps) {
    if (!('height' in step) || step.pattern || !['cylinder', 'hole'].includes(step.shape)) continue
    const paired = joints.filter((joint) => joint.kind !== 'thread' && (joint.kind !== 'fixed' || joint.fastening === 'bonded') &&
      (joint.first === target.id ? joint.firstFeature : joint.second === target.id ? joint.secondFeature : '') === step.id)
    const current = frame(target, step.id, 'current')
    if (!current || !paired.length) continue
    const matched = paired.flatMap((joint) => {
      const first = joint.first === target.id
      const other = built.find((component) => component.id === (first ? joint.second : joint.first))
      return other ? [{ joint, other, feature: first ? joint.secondFeature : joint.firstFeature }] : []
    })
    if (!matched.length) continue
    const counterpart = frame(matched[0].other, matched[0].feature, 'current')
    if (!counterpart || Math.abs(dot(current.axis, counterpart.axis)) < 1 - 1e-6) continue
    const difference = add(counterpart.center, scale(current.center, -1))
    const perpendicular = add(difference, scale(current.axis, -dot(difference, current.axis)))
    let lower = -Infinity, upper = Infinity, minimum = 0
    let usable = true
    for (const { joint, other, feature } of matched) {
      minimum = Math.max(minimum, joint.minEngagement)
      for (const pose of poses) {
        const a = frame(target, step.id, pose), b = frame(other, feature, pose)
        if (!a || !b || b.height + 1e-5 < joint.minEngagement || Math.abs(dot(a.axis, b.axis)) < 1 - 1e-6) { usable = false; break }
        const offset = dot(add(b.center, scale(a.center, -1)), a.axis)
        lower = Math.max(lower, offset - b.height / 2 + joint.minEngagement)
        upper = Math.min(upper, offset + b.height / 2 - joint.minEngagement)
      }
    }
    if (!usable) continue
    const height = Math.max(step.height, minimum, lower - upper)
    if (height > 10_000 || (explicitDimensions && height > step.height + 1e-5)) continue
    const shift = Math.max(lower - height / 2, Math.min(0, upper + height / 2))
    if (explicitDimensions && Math.abs(shift) > 1e-5) continue
    const center = unpose(target, add(add(current.center, perpendicular), scale(current.axis, shift)))
    const position = step.shape === 'hole' ? add(center, scale(direction(step.rotation), height / 2)) : center
    const replacement = { ...step, height: Number(height.toFixed(6)), position: Object.fromEntries(
      Object.entries(position).map(([axis, value]) => [axis, Number(value.toFixed(6))])) as unknown as CadVector } as CadProgramStep
    if (JSON.stringify(step) === JSON.stringify(replacement)) continue
    steps[steps.findIndex((current) => current.id === step.id)] = replacement
    changed = true
  }
  if (!changed) return null
  const candidate: CadProgramSpec = { schemaVersion: '3.0', units: 'mm', partId: target.id, steps }
  try { validateCadProgram(candidate) } catch { return null }
  if (await inspect(candidate)) return null
  return { spec: candidate, issue: null, assumption: 'Encaixes inferidos foram alinhados e dimensionados matematicamente a partir das peças disponíveis, com engate nas seis poses e verificação do sólido. Peças concluídas e roscas foram conservadas.' }
}
