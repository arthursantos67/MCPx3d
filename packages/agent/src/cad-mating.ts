import type { CadComponent } from '../../domain/ts/src/cad-assembly.ts'
import type { CadMechanicalConnection } from '../../domain/ts/src/cad-mechanics.ts'
import type { CadCollision } from '../../domain/ts/src/cad-assembly-diagnostics.ts'
import { add, scale, dot, direction, rotate, lineDistance, commandAtPose } from './cad-spatial.ts'

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
