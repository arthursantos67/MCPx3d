import { validateCadAssembly, type CadAssemblySpec } from '../../domain/ts/src/cad-assembly.ts'
import type { CadProgramStep, CadVector } from '../../domain/ts/src/cad-program.ts'
import type { CadCollision } from '../../domain/ts/src/cad-assembly-diagnostics.ts'
import type { AssemblyRepairStrategy } from './assembly-repair.ts'
import { add, subtract, scale, dot, direction, lineDistance, interval, commandAtPose } from './cad-spatial.ts'

function diskIntersection(first: number, second: number, distance: number): number {
  if (distance >= first + second) return 0
  if (distance <= Math.abs(first - second)) return Math.PI * Math.min(first, second) ** 2
  const angle = (a: number, b: number) => Math.acos(Math.max(-1, Math.min(1, (distance ** 2 + a ** 2 - b ** 2) / (2 * distance * a))))
  return first ** 2 * angle(first, second) + second ** 2 * angle(second, first) -
    Math.sqrt(Math.max(0, (-distance + first + second) * (distance + first - second) *
      (distance - first + second) * (distance + first + second))) / 2
}

type Component = CadAssemblySpec['components'][number]
function cylindricalEnvelope(source: Component): Extract<CadProgramStep, { shape: 'cylinder' }> | null {
  const shaft = source.steps[0]
  if (shaft.shape !== 'cylinder' || shaft.pattern) return null
  const axis = direction(shaft.rotation)
  for (const step of source.steps.slice(1)) {
    if (step.op === 'cut' || step.shape === 'fillet' || step.shape === 'chamfer') continue
    if (step.op !== 'union' || step.pattern || (step.shape !== 'cone' && step.shape !== 'cylinder')) return null
    const diameter = step.shape === 'cone' ? Math.max(step.bottomDiameter, step.topDiameter) : step.diameter
    if (diameter > shaft.diameter || Math.abs(dot(direction(step.rotation), axis)) < 1 - 1e-6 ||
        lineDistance(step.position, shaft.position, axis) > 1e-6) return null
  }
  return shaft
}
function translation(component: Component, axis: CadVector, pose: CadCollision['pose'], rotating = false): CadVector | null {
  const motion = component.motion
  if (!motion) return component.position
  const motionAxis = { x: 0, y: 0, z: 0, [motion.axis]: 1 }
  if (Math.abs(dot(motionAxis, axis)) < 1 - 1e-6) return null
  if (motion.kind === 'rotary') return rotating ? component.position : null
  if (motion.kind !== 'slider') return null
  return add(component.position, scale(motionAxis, commandAtPose(motion, pose) * (motion.factor ?? 1)))
}

export const cylindricalFitStrategy: AssemblyRepairStrategy = {
  assumption: 'Encaixe cilíndrico alinhado à peça correspondente, com folga radial inferida de 0,2 mm e furo atravessando o corpo receptor; geometria e curso novamente verificados.',
  propose: async (spec, _message, checkPart, assess, collision) => {
    if (!collision) return null
    for (const sourceIndex of [0, 1] as const) {
      const hostIndex = 1 - sourceIndex
      const source = spec.components.find((item) => item.id === collision.components[sourceIndex])!
      const host = spec.components.find((item) => item.id === collision.components[hostIndex])!
      if (!source || !host) continue
      const shaft = cylindricalEnvelope(source)
      if (!shaft) continue
      if (host.steps.some((step) => step.shape === 'thread' && step.pattern)) continue
      const axis = direction(shaft.rotation)
      const sourceTranslation = translation(source, axis, collision.pose, true)
      const hostTranslation = translation(host, axis, collision.pose)
      if (!sourceTranslation || !hostTranslation) continue
      if (source.motion?.kind === 'rotary' && lineDistance(shaft.position, { x: 0, y: 0, z: 0 }, axis) > 1e-6) continue
      const center = subtract(add(sourceTranslation, shaft.position), hostTranslation)
      const hostBounds = collision.componentBoundsMm[hostIndex]
      const [low, high] = interval(hostBounds, axis)
      const length = high - low
      if (length < 1 || length > 10_000 - 2) continue
      const nearby = host.steps.filter((step) => step.op === 'cut' && !step.pattern &&
        (step.shape === 'cylinder' || step.shape === 'hole' || step.shape === 'thread') &&
        Math.abs(dot(direction(step.rotation), axis)) > 1 - 1e-6 &&
        lineDistance(step.position, center, axis) <= Math.max(1, shaft.diameter / 4))
      if (nearby.some((step) => step.shape === 'thread')) continue
      const bore = nearby.find((step) => step.shape === 'cylinder')
      const contained = collision.overlapVolumeMm3 / collision.componentVolumesMm3[sourceIndex] >= 0.8
      if (!nearby.length && !contained && shaft.height < 3 * shaft.diameter) continue
      const diameter = Math.max(shaft.diameter + 0.4, bore?.shape === 'cylinder' ? bore.diameter : 0)
      const removal = Math.PI * (diameter / 2) ** 2 * length
      const existing = Math.max(0, ...nearby.map((step) => {
        if (step.shape !== 'cylinder' && step.shape !== 'hole') return 0
        const boreAxis = direction(step.rotation)
        const boreCenter = add(hostTranslation, step.shape === 'hole'
          ? add(step.position, scale(boreAxis, -step.height / 2)) : step.position)
        const axial = dot(boreCenter, axis)
        const covered = Math.max(0, Math.min(high, axial + step.height / 2) - Math.max(low, axial - step.height / 2))
        return diskIntersection(diameter / 2, step.diameter / 2, lineDistance(step.position, center, axis)) * covered
      }))
      if (Math.max(0, removal - existing) > collision.componentVolumesMm3[hostIndex] * (contained ? 0.6 : 0.15)) continue
      const usedIds = new Set(host.steps.map((step) => step.id))
      let number = 1
      while (usedIds.has(`assembly_fit_${number}`)) number++
      const worldCenter = add(sourceTranslation, shaft.position)
      const placement = subtract(add(worldCenter, scale(axis, (low + high) / 2 - dot(worldCenter, axis))), hostTranslation)
      const tool: CadProgramStep = { id: bore?.id ?? `assembly_fit_${number}`, op: 'cut', shape: 'cylinder',
        position: placement, rotation: shaft.rotation, diameter, height: length + 2 }
      const steps = bore ? host.steps.map((step) => step === bore ? tool : step) : [...host.steps, tool]
      const candidate = { ...spec, components: spec.components.map((component) => component === host ? { ...host, steps } : component) }
      try { validateCadAssembly(candidate) } catch { continue }
      if (await checkPart({ schemaVersion: '3.0', units: 'mm', partId: host.id, steps })) continue
      if (!await assess(candidate)) return candidate
    }
    return null
  },
}
