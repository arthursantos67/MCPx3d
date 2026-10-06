import { CAD_EDGE_SELECTORS, CAD_FEATURES, type CadEdgeSelector, type CadFaceSelector } from './cad-features.ts'
import { validateCadStructure } from './cad-schema.ts'

export type CadVector = { readonly x: number; readonly y: number; readonly z: number }
export type CadPattern =
  | { readonly kind: 'circular'; readonly count: number; readonly axis?: 'x' | 'y' | 'z'; readonly center?: CadVector; readonly sweepAngle?: number }
  | { readonly kind: 'linear'; readonly count: number; readonly offset: CadVector }
export type CadProgramStep = {
  readonly id: string
  readonly op: 'base' | 'union' | 'cut' | 'modify'
  readonly position: CadVector
  readonly rotation: CadVector
  readonly pattern?: CadPattern
} & (
  | { readonly shape: 'box'; readonly width: number; readonly depth: number; readonly height: number }
  | { readonly shape: 'cylinder'; readonly diameter: number; readonly height: number }
  | { readonly shape: 'sphere'; readonly diameter: number }
  | { readonly shape: 'cone'; readonly bottomDiameter: number; readonly topDiameter: number; readonly height: number }
  | { readonly shape: 'polygon_prism'; readonly points: readonly { readonly x: number; readonly y: number }[]; readonly height: number }
  | { readonly shape: 'revolve_profile'; readonly points: readonly { readonly x: number; readonly y: number }[] }
  | { readonly shape: 'tube'; readonly diameter: number; readonly innerDiameter: number; readonly height: number }
  | { readonly shape: 'torus'; readonly majorRadius: number; readonly minorRadius: number }
  | { readonly shape: 'slot'; readonly length: number; readonly width: number; readonly height: number }
  | { readonly shape: 'hole'; readonly diameter: number; readonly height: number; readonly holeType: 'plain' | 'counterbore' | 'countersink'; readonly headDiameter: number; readonly headDepth: number }
  | { readonly shape: 'thread'; readonly diameter: number; readonly pitch: number; readonly height: number; readonly profile: 'metric' | 'trapezoidal'; readonly handedness: 'right' | 'left'; readonly clearance: number; readonly starts?: number }
  | { readonly shape: 'loft'; readonly sections: readonly CadLoftSection[]; readonly ruled?: boolean }
  | { readonly shape: 'fillet'; readonly selector: CadEdgeSelector; readonly radius: number }
  | { readonly shape: 'chamfer'; readonly selector: CadEdgeSelector; readonly distance: number }
  | { readonly shape: 'shell'; readonly selector: CadFaceSelector; readonly thickness: number }
)

export type CadLoftSection = { readonly z: number } & (
  | { readonly kind: 'circle'; readonly diameter: number }
  | { readonly kind: 'rectangle'; readonly width: number; readonly depth: number }
)

export interface CadProgramSpec {
  readonly schemaVersion: '3.0'
  readonly units: 'mm'
  readonly partId: string
  readonly steps: readonly CadProgramStep[]
}

export function validateCadProgram(spec: CadProgramSpec): void {
  if (!spec || spec.schemaVersion !== '3.0' || spec.units !== 'mm' || typeof spec.partId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(spec.partId)) throw new Error('Invalid CAD program header')
  if (!Array.isArray(spec.steps as unknown) || spec.steps.length < 1 || spec.steps.length > 32 || spec.steps[0]?.op !== 'base') throw new Error('A CAD program needs one base and at most 32 steps')
  const ids = new Set<string>()
  const scalar = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max
  let instances = 0
  let threadPitches = 0
  for (const [index, step] of spec.steps.entries()) {
    if (!step || typeof step.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(step.id) || ids.has(step.id)) throw new Error('CAD step IDs must be unique')
    ids.add(step.id)
    const feature = CAD_FEATURES[step.shape]
    if (!feature || !['base', 'union', 'cut', 'modify'].includes(step.op) || (index > 0 && step.op === 'base') ||
      (feature.mode === 'modifier') !== (step.op === 'modify') || (feature.mode === 'cut' && step.op !== 'cut')) throw new Error('Invalid CAD operation')
    if ([step.position.x, step.position.y, step.position.z].some((value) => !scalar(value, -10000, 10000)) ||
      [step.rotation.x, step.rotation.y, step.rotation.z].some((value) => !scalar(value, -360, 360))) throw new Error('Invalid CAD position or rotation')
    if (feature.mode === 'modifier' && (step.pattern || [...Object.values(step.position), ...Object.values(step.rotation)].some(Boolean))) throw new Error('CAD finishing cannot have a pattern or placement')
    if (step.pattern) {
      if (index === 0 || !Number.isInteger(step.pattern.count) || !scalar(step.pattern.count, 2, 64)) throw new Error('Invalid CAD pattern count or base pattern')
      if (step.pattern.kind === 'circular') {
        const center = step.pattern.center ?? { x: 0, y: 0, z: 0 }
        if (!['x', 'y', 'z'].includes(step.pattern.axis ?? 'z') ||
          (!Number.isFinite(step.pattern.sweepAngle ?? 360) || (step.pattern.sweepAngle ?? 360) <= 0 || (step.pattern.sweepAngle ?? 360) > 360) ||
          [center.x, center.y, center.z].some((value) => !scalar(value, -10000, 10000))) throw new Error('Invalid CAD circular pattern')
      } else if (step.pattern.kind === 'linear') {
        const offset = step.pattern.offset
        if (!offset || [offset.x, offset.y, offset.z].some((value) => !scalar(value, -10000, 10000)) ||
          (offset.x === 0 && offset.y === 0 && offset.z === 0)) throw new Error('Invalid CAD linear pattern')
      } else throw new Error('Invalid CAD pattern kind')
    }
    instances += step.pattern?.count ?? 1
    if (instances > 256) throw new Error('CAD program exceeds 256 patterned instances')
    const dimensions = step.shape === 'box' ? [step.width, step.depth, step.height] :
      step.shape === 'cylinder' ? [step.diameter, step.height] :
      step.shape === 'sphere' ? [step.diameter] :
      step.shape === 'cone' ? [step.bottomDiameter, step.height] :
      step.shape === 'polygon_prism' ? [step.height] :
      step.shape === 'tube' ? [step.diameter, step.height] :
      step.shape === 'torus' ? [step.majorRadius, step.minorRadius] :
      step.shape === 'slot' ? [step.length, step.width, step.height] :
      step.shape === 'hole' || step.shape === 'thread' ? [step.diameter, step.height] :
      step.shape === 'fillet' ? [step.radius] : step.shape === 'chamfer' ? [step.distance] :
      step.shape === 'shell' ? [step.thickness] : []
    if (dimensions.some((value) => !scalar(value, 0.1, 10000)) ||
      (step.shape === 'cone' && !scalar(step.topDiameter, 0, 10000))) throw new Error('Invalid CAD dimensions')
    if (step.shape === 'tube' && (!scalar(step.innerDiameter, Number.MIN_VALUE, 10000) || step.diameter - step.innerDiameter < 0.2)) throw new Error('Invalid CAD tube wall')
    if (step.shape === 'torus' && (step.majorRadius > 5000 || step.minorRadius > 5000 || step.majorRadius <= step.minorRadius)) throw new Error('Invalid CAD torus radii')
    if (step.shape === 'slot' && step.length <= step.width) throw new Error('Invalid CAD slot length')
    if (step.shape === 'hole') {
      if (!['plain', 'counterbore', 'countersink'].includes(step.holeType) ||
        !scalar(step.headDiameter, 0, 10000) || !scalar(step.headDepth, 0, 10000) ||
        (step.holeType === 'plain' ? step.headDiameter !== 0 || step.headDepth !== 0
          : step.headDiameter <= step.diameter || step.headDepth <= 0 || step.headDepth >= step.height)) throw new Error('Invalid CAD hole head')
    }
    if (step.shape === 'thread') {
      const starts = step.starts ?? 1
      if (!['metric', 'trapezoidal'].includes(step.profile) || !['right', 'left'].includes(step.handedness) ||
        !scalar(step.diameter, 1, 1000) || !scalar(step.pitch, 0.25, 100) ||
        step.diameter / 2 - step.pitch * (step.profile === 'metric' ? 0.613434654 : 0.5) < 0.1 ||
        step.height < step.pitch || step.height / step.pitch > 80 || !Number.isInteger(starts) || !scalar(starts, 1, 4) ||
        !scalar(step.clearance, 0, Math.min(2, step.pitch / 4)) || (step.op !== 'cut' && step.clearance !== 0)) throw new Error('Invalid CAD thread parameters')
      threadPitches += step.height / step.pitch * (step.pattern?.count ?? 1)
      if (threadPitches > 160) throw new Error('CAD program exceeds 160 thread pitches including patterns')
    }
    if (step.shape === 'loft') {
      if (step.sections.length < 2 || step.sections.length > 8 || (step.ruled !== undefined && typeof step.ruled !== 'boolean')) throw new Error('Invalid CAD loft sections')
      for (const [i, section] of step.sections.entries()) {
        const sizes = section.kind === 'circle' ? [section.diameter] : section.kind === 'rectangle' ? [section.width, section.depth] : []
        if (!sizes.length || sizes.some((v) => !scalar(v, 0.1, 10000)) || !scalar(section.z, -10000, 10000) ||
          (i > 0 && section.z - step.sections[i - 1].z < 0.1)) throw new Error('Invalid CAD loft section dimensions or order')
      }
      if (step.sections.at(-1)!.z - step.sections[0].z > 10000) throw new Error('Invalid CAD loft span')
    }
    if (step.shape === 'fillet' || step.shape === 'chamfer' || step.shape === 'shell') {
      const size = step.shape === 'fillet' ? step.radius : step.shape === 'chamfer' ? step.distance : step.thickness
      if (!Object.hasOwn(CAD_EDGE_SELECTORS, step.selector) || !scalar(size, 0.1, 1000) ||
        (step.shape === 'shell' && ['all', 'parallel_x', 'parallel_y', 'parallel_z', 'circular'].includes(step.selector))) throw new Error('Invalid CAD finishing selection or size')
    }
    if (step.shape === 'polygon_prism' || step.shape === 'revolve_profile') {
      if (step.points.length < 3 || step.points.length > 32 || step.points.some((point) => !scalar(point.x, -10000, 10000) || !scalar(point.y, -10000, 10000))) throw new Error('Invalid CAD polygon')
      if (step.shape === 'revolve_profile' && step.points.some((point) => point.x < 0)) throw new Error('Revolved profile radius cannot be negative')
      const area = step.points.reduce((sum, point, i) => {
        const next = step.points[(i + 1) % step.points.length]
        return sum + point.x * next.y - next.x * point.y
      }, 0) / 2
      if (Math.abs(area) < 0.01) throw new Error('CAD profile must enclose an area')
    }
  }
  validateCadStructure('program', spec)
}
