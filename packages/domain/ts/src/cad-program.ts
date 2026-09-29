export type CadVector = { readonly x: number; readonly y: number; readonly z: number }
export type CadPattern =
  | { readonly kind: 'circular'; readonly count: number; readonly axis?: 'x' | 'y' | 'z'; readonly center?: CadVector; readonly sweepAngle?: number }
  | { readonly kind: 'linear'; readonly count: number; readonly offset: CadVector }
export type CadProgramStep = {
  readonly id: string
  readonly op: 'base' | 'union' | 'cut'
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
)

export interface CadProgramSpec {
  readonly schemaVersion: '3.0'
  readonly units: 'mm'
  readonly partId: string
  readonly steps: readonly CadProgramStep[]
}

export function validateCadProgram(spec: CadProgramSpec): void {
  if (spec.schemaVersion !== '3.0' || spec.units !== 'mm' || !/^[A-Za-z0-9_-]{1,64}$/.test(spec.partId)) throw new Error('Invalid CAD program header')
  if (spec.steps.length < 1 || spec.steps.length > 32 || spec.steps[0]?.op !== 'base') throw new Error('A CAD program needs one base and at most 32 steps')
  const ids = new Set<string>()
  const scalar = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max
  let instances = 0
  for (const [index, step] of spec.steps.entries()) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(step.id) || ids.has(step.id)) throw new Error('CAD step IDs must be unique')
    ids.add(step.id)
    if (!['base', 'union', 'cut'].includes(step.op) || (index > 0 && step.op === 'base')) throw new Error('Invalid CAD operation')
    if ([step.position.x, step.position.y, step.position.z].some((value) => !scalar(value, -10000, 10000)) ||
      [step.rotation.x, step.rotation.y, step.rotation.z].some((value) => !scalar(value, -360, 360))) throw new Error('Invalid CAD position or rotation')
    if (step.pattern) {
      if (index === 0 || !Number.isInteger(step.pattern.count) || !scalar(step.pattern.count, 2, 64)) throw new Error('Invalid CAD pattern count or base pattern')
      if (step.pattern.kind === 'circular') {
        const center = step.pattern.center ?? { x: 0, y: 0, z: 0 }
        if (!['x', 'y', 'z'].includes(step.pattern.axis ?? 'z') ||
          !scalar(step.pattern.sweepAngle ?? 360, 0.000001, 360) ||
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
      step.shape === 'polygon_prism' ? [step.height] : []
    if ((step.shape !== 'revolve_profile' && !dimensions.length) || dimensions.some((value) => !scalar(value, 0.1, 10000)) ||
      (step.shape === 'cone' && !scalar(step.topDiameter, 0, 10000))) throw new Error('Invalid CAD dimensions')
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
}
