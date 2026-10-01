import { type CadProgramStep, type CadVector, validateCadProgram } from './cad-program.ts'

export interface CadMotion {
  readonly kind: 'slider' | 'screw' | 'rotary'
  readonly axis: 'x' | 'y' | 'z'
  readonly minimum: number
  readonly maximum: number
  readonly value: number
  readonly pitch?: number
  readonly group?: string
}

export interface CadComponent {
  readonly id: string
  readonly position: CadVector
  readonly steps: readonly CadProgramStep[]
  readonly motion?: CadMotion | null
}

export interface CadAssemblySpec {
  readonly schemaVersion: '4.0'
  readonly units: 'mm'
  readonly partId: string
  readonly components: readonly CadComponent[]
}

export function validateCadAssembly(spec: CadAssemblySpec): void {
  if (spec.schemaVersion !== '4.0' || spec.units !== 'mm' || !/^[A-Za-z0-9_-]{1,64}$/.test(spec.partId)) throw new Error('Invalid CAD assembly header')
  if (spec.components.length < 2 || spec.components.length > 8 || !spec.components.some((component) => !component.motion)) throw new Error('A CAD assembly needs 2–8 components and one fixed component')
  const ids = new Set<string>()
  let steps = 0
  const groups = new Map<string, string>()
  for (const component of spec.components) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(component.id) || ids.has(component.id)) throw new Error('CAD component IDs must be unique')
    ids.add(component.id)
    steps += component.steps.length
    if (component.steps.length > 32 || steps > 128) throw new Error('CAD assembly exceeds its construction limits')
    validateCadProgram({ schemaVersion: '3.0', units: 'mm', partId: component.id, steps: component.steps })
    if (Object.values(component.position).some((value) => !Number.isFinite(value) || Math.abs(value) > 10_000)) throw new Error('Invalid CAD component position')
    if (component.motion) {
      const motion = component.motion
      if (!['slider', 'screw', 'rotary'].includes(motion.kind) || !['x', 'y', 'z'].includes(motion.axis) ||
        ![motion.minimum, motion.maximum, motion.value].every((value) => Number.isFinite(value) && Math.abs(value) <= 10_000) ||
        motion.minimum >= motion.maximum || motion.value < motion.minimum || motion.value > motion.maximum ||
        (motion.kind === 'screw' ? !(motion.pitch && Number.isFinite(motion.pitch) && motion.pitch > 0 && motion.pitch <= 1000) : motion.pitch !== undefined)) {
        throw new Error(`Invalid CAD motion for ${component.id}`)
      }
      if (motion.group !== undefined) {
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(motion.group)) throw new Error(`Invalid CAD motion group for ${component.id}`)
        const range = JSON.stringify([motion.minimum, motion.maximum, motion.value, motion.kind === 'rotary' ? 'degrees' : 'mm'])
        if (groups.has(motion.group) && groups.get(motion.group) !== range) throw new Error(`CAD motion group ${motion.group} must share range and value`)
        groups.set(motion.group, range)
      }
    }
  }
}
