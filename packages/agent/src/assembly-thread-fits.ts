import { validateCadAssembly, type CadAssemblySpec } from '../../domain/ts/src/cad-assembly.ts'
import type { CadProgramStep, CadVector } from '../../domain/ts/src/cad-program.ts'
import type { AssemblyRepairStrategy } from './assembly-repair.ts'
import { add, subtract, scale, dot, direction, rotate, axialRotation, lineDistance, interval, commandAtPose } from './cad-spatial.ts'
import type { CadBounds, CadCollision } from '../../domain/ts/src/cad-assembly-diagnostics.ts'

type Component = CadAssemblySpec['components'][number]
type Thread = Extract<CadProgramStep, { shape: 'thread' }>
const origin = { x: 0, y: 0, z: 0 }
const unit = (axis: 'x' | 'y' | 'z'): CadVector => ({ ...origin, [axis]: 1 })
const close = (a: number, b: number) => Math.abs(a - b) < 1e-6
const threads = (component: Component, internal: boolean) => component.steps.filter((step): step is Thread =>
  step.shape === 'thread' && !step.pattern && (internal ? step.op === 'cut' : step.op === 'base' || step.op === 'union'))

function placement(component: Component, axis: CadVector, rotating: boolean, pose: CadCollision['pose']): CadVector | null {
  const motion = component.motion
  if (!motion) return component.position
  if (Math.abs(dot(unit(motion.axis), axis)) < 1 - 1e-6 || (!rotating && motion.kind !== 'slider')) return null
  return motion.kind === 'rotary' ? component.position :
    add(component.position, scale(unit(motion.axis), commandAtPose(motion, pose) * (motion.factor ?? 1)))
}

function rate(component: Component, axis: CadVector, angular: boolean): number {
  const motion = component.motion
  if (!motion || (angular ? motion.kind === 'slider' : motion.kind === 'rotary')) return 0
  return (motion.maximum - motion.minimum) * (motion.factor ?? 1) * dot(unit(motion.axis), axis) *
    (angular && motion.kind === 'screw' ? 360 / motion.pitch! : 1)
}

function receiverInterval(host: Component, position: CadVector, axis: CadVector, bounds: CadBounds): readonly [number, number] {
  const base = host.steps[0]
  if (host.steps.slice(1).some((step) => step.op !== 'cut' && step.op !== 'modify')) return interval(bounds, axis)
  const center = dot(add(position, base.position), axis)
  if ((base.shape === 'cylinder' || base.shape === 'tube') && Math.abs(dot(direction(base.rotation), axis)) > 1 - 1e-6) {
    return [center - base.height / 2, center + base.height / 2]
  }
  if (base.shape === 'box') {
    const half = (Math.abs(dot(rotate(unit('x'), base.rotation), axis)) * base.width +
      Math.abs(dot(rotate(unit('y'), base.rotation), axis)) * base.depth +
      Math.abs(dot(direction(base.rotation), axis)) * base.height) / 2
    return [center - half, center + half]
  }
  return interval(bounds, axis)
}

function coreRelief(source: Component, thread: Thread): readonly CadProgramStep[] | null {
  const index = source.steps.indexOf(thread), axis = direction(thread.rotation)
  const root = thread.diameter - 2 * thread.pitch * (thread.profile === 'metric' ? 0.613434654 : 0.5)
  const spans = (step: Extract<CadProgramStep, { shape: 'cylinder' }>) =>
    Math.abs(dot(direction(step.rotation), axis)) > 1 - 1e-6 && lineDistance(step.position, thread.position, axis) < 1e-6 &&
    Math.abs(dot(subtract(step.position, thread.position), axis)) + thread.height / 2 <= step.height / 2 + 1e-6
  const cores = source.steps.filter((step): step is Extract<CadProgramStep, { shape: 'cylinder' }> =>
    step.shape === 'cylinder' && (step.op === 'base' || step.op === 'union') && !step.pattern && step.diameter > root + 1e-6 && spans(step))
  if (!cores.length) return source.steps
  if (cores.some((step) => source.steps.indexOf(step) >= index || step.diameter >= thread.diameter)) return null
  for (const step of source.steps.slice(0, index)) {
    if (step.op === 'cut' || step.op === 'modify') continue
    if (step.pattern || (step.shape !== 'cylinder' && step.shape !== 'cone') ||
        Math.abs(dot(direction(step.rotation), axis)) < 1 - 1e-6 || lineDistance(step.position, thread.position, axis) > 1e-6) return null
    const separation = Math.abs(dot(subtract(step.position, thread.position), axis))
    const diameter = step.shape === 'cylinder' ? step.diameter : Math.max(step.bottomDiameter, step.topDiameter)
    if (separation < (step.height + thread.height) / 2 - 1e-6 && diameter > root &&
        (step.shape !== 'cylinder' || !cores.includes(step))) return null
  }
  const diameter = Math.max(...cores.map((step) => step.diameter)) + 0.02
  if (source.steps.slice(0, index).some((step) => step.op === 'cut' && step.shape === 'tube' && !step.pattern &&
      step.innerDiameter <= root + 1e-6 && step.diameter >= diameter - 0.02 &&
      Math.abs(dot(direction(step.rotation), axis)) > 1 - 1e-6 && lineDistance(step.position, thread.position, axis) < 1e-6 &&
      Math.abs(dot(subtract(step.position, thread.position), axis)) + thread.height / 2 <= step.height / 2 + 1e-6)) return source.steps
  let number = 1
  while (source.steps.some((step) => step.id === `assembly_thread_core_${number}`)) number++
  const relief: CadProgramStep = { id: `assembly_thread_core_${number}`, op: 'cut', shape: 'tube',
    diameter, innerDiameter: root - 0.002, height: thread.height, position: thread.position, rotation: thread.rotation }
  return [...source.steps.slice(0, index), relief, ...source.steps.slice(index)]
}

export const threadedFitStrategy: AssemblyRepairStrategy = {
  assumption: 'Roscas compatíveis alinhadas em eixo, comprimento e fase helicoidal; núcleo liso aliviado somente no trecho roscado quando necessário, conservando roscas e munhões. Sólidos e curso novamente verificados.',
  propose: async (spec, _message, checkPart, assess, collision) => {
    if (!collision) return null
    for (const sourceIndex of [0, 1] as const) {
      const source = spec.components.find((item) => item.id === collision.components[sourceIndex])
      const host = spec.components.find((item) => item.id === collision.components[1 - sourceIndex])
      if (!source || !host || threads(source, false).length !== 1 || threads(host, true).length !== 1) continue
      const male = threads(source, false)[0], female = threads(host, true)[0]
      if (!close(male.diameter, female.diameter) || !close(male.pitch, female.pitch) || male.profile !== female.profile ||
          male.handedness !== female.handedness || (male.starts ?? 1) !== (female.starts ?? 1)) continue
      const axis = direction(male.rotation), lead = male.pitch * (male.starts ?? 1), sign = male.handedness === 'right' ? 1 : -1
      const sourcePosition = placement(source, axis, true, collision.pose), hostPosition = placement(host, axis, false, collision.pose)
      if (!sourcePosition || !hostPosition) continue
      if (source.motion && source.motion.kind !== 'slider' && lineDistance(male.position, origin, axis) > 1e-6) continue
      if (source.motion && host.motion && (!source.motion.group || source.motion.group !== host.motion.group)) continue
      if (!close(rate(source, axis, true) + sign * 360 / lead * (rate(host, axis, false) - rate(source, axis, false)), 0)) continue
      const center = add(sourcePosition, male.position), hostCenter = add(hostPosition, female.position)
      if (lineDistance(hostCenter, center, axis) > male.diameter / 2) continue
      const [low, high] = receiverInterval(host, hostPosition, axis, collision.componentBoundsMm[1 - sourceIndex])
      const length = high - low, axial = dot(center, axis)
      if (length < 0.1 || low < axial - male.height / 2 - 1e-6 || high > axial + male.height / 2 + 1e-6) continue
      const target = add(center, scale(axis, (low + high) / 2 - axial))
      const command = source.motion ? commandAtPose(source.motion, collision.pose) * (source.motion.factor ?? 1) : 0
      const angular = source.motion?.kind === 'rotary' ? command :
        source.motion?.kind === 'screw' ? command * 360 / source.motion.pitch! : 0
      const phase = angular * (source.motion ? dot(unit(source.motion.axis), axis) : 0) + sign * 360 * dot(subtract(target, center), axis) / lead
      const revised: Thread = { ...female, position: subtract(target, hostPosition), rotation: axialRotation(male.rotation, phase),
        height: Math.max(female.height, length + 2), clearance: Math.max(female.clearance, Math.min(0.1, female.pitch / 4)) }
      const sourceSteps = coreRelief(source, male)
      if (!sourceSteps) continue
      const candidate: CadAssemblySpec = { ...spec, components: spec.components.map((component) => component === host
        ? { ...host, steps: host.steps.map((step) => step === female ? revised : step) }
        : component === source && sourceSteps !== source.steps ? { ...source, steps: sourceSteps } : component) }
      if (JSON.stringify(candidate) === JSON.stringify(spec)) continue
      try { validateCadAssembly(candidate) } catch { continue }
      let invalid = false
      for (const component of candidate.components.filter((item) => item !== spec.components.find((old) => old.id === item.id))) {
        if (await checkPart({ schemaVersion: '3.0', units: 'mm', partId: component.id, steps: component.steps })) { invalid = true; break }
      }
      if (!invalid && !await assess(candidate)) return candidate
    }
    return null
  },
}
