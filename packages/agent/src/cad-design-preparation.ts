import { validateCadProgram, type CadProgramSpec, type CadProgramStep } from '../../domain/ts/src/cad-program.ts'
import { direction, axes } from './cad-spatial.ts'

export function originalCadRequest(request: string): string {
  return request.includes('Overall request: ') ? request.split('Overall request: ')[1].split('. Component construction: ')[0]
    : request.split('\n\nThe CAD engine')[0]
}

export function prepareCadDesign(spec: CadProgramSpec, request: string): { spec: CadProgramSpec; assumptions: string[] } {
  const original = originalCadRequest(request)
  const base = spec.steps[0]
  if (base.shape !== 'box' || Object.values(base.rotation).some((angle) => Math.abs(angle) > 1e-6) ||
      spec.steps.some((step) => step.op === 'union')) return { spec, assumptions: [] }
  const explicitStock = /\d\s*(?:mm|cm)\b|\d\s*[x×]\s*\d|\b(?:altura|largura|comprimento|height|width|length)\s*[:=]\s*\d|\b[xyz]\s*[:=]\s*-?\d/i.test(original)
  const openCut = /\b(?:abert[oa]|ranhura|entalhe|canal|open|notch|groove)\b/i.test(original)
  const dimensions = { x: 'width', y: 'depth', z: 'height' } as const
  const revised = { ...base }
  const assumptions: string[] = []
  for (const step of spec.steps.slice(1)) {
    if (step.op !== 'cut' || step.pattern || !('diameter' in step) || !('height' in step) ||
        !(step.shape === 'hole' || step.shape === 'thread' || step.shape === 'cylinder' && /bore|cavity|cavidade|furo/i.test(step.id))) continue
    const unit = direction(step.rotation)
    const axial = axes.find((axis) => Math.abs(unit[axis]) > 1 - 1e-6)
    if (!axial || explicitStock || openCut) continue
    const radius = Math.max(step.diameter, step.shape === 'hole' ? step.headDiameter : 0) / 2
    for (const radial of axes.filter((axis) => axis !== axial)) {
      const needed = Math.ceil(2 * (Math.abs(step.position[radial] - base.position[radial]) + radius + 1))
      const field = dimensions[radial]
      if (spec.steps.some((feature) => feature.shape === 'thread' && feature.op === 'cut' &&
          Math.abs(direction(feature.rotation)[radial]) > 1 - 1e-6)) continue
      if (needed > revised[field] && needed <= base[field] * 2 && needed <= 10_000) revised[field] = needed
    }
  }
  const resized = axes.filter((axis) => revised[dimensions[axis]] !== base[dimensions[axis]])
  if (resized.length) assumptions.push(`O bloco inferido foi ampliado em ${resized.join('/').toUpperCase()} para conservar parede ao redor dos furos/cavidades, mantendo seus eixos.`)
  const steps: CadProgramStep[] = [revised, ...spec.steps.slice(1).map((step): CadProgramStep => {
    if (step.shape !== 'hole' || step.holeType === 'plain' || explicitStock) return step
    const unit = direction(step.rotation)
    const axial = axes.find((axis) => Math.abs(unit[axis]) > 1 - 1e-6)
    if (!axial) return step
    if (step.pattern && (step.pattern.kind === 'linear' ? Math.abs(step.pattern.offset[axial]) > 1e-6
      : (step.pattern.axis ?? 'z') !== axial)) return step
    const field = dimensions[axial]
    const beforeFace = base.position[axial] + Math.sign(unit[axial]) * base[field] / 2
    const afterFace = revised.position[axial] + Math.sign(unit[axial]) * revised[field] / 2
    const internalEntry = Math.abs(step.position[axial] - base.position[axial]) < 1e-6
    if (!internalEntry && Math.abs(step.position[axial] - beforeFace) > 1e-5) return step
    if (Math.abs(step.position[axial] - afterFace) < 1e-6) return step
    assumptions.push(`A entrada de ${step.id} foi colocada na face externa ${axial.toUpperCase()} para tornar o alojamento da cabeça acessível.`)
    return { ...step, position: { ...step.position, [axial]: afterFace }, height: Math.max(step.height, revised[field] + .5) }
  })]
  const candidate = { ...spec, steps }
  try { validateCadProgram(candidate) } catch { return { spec, assumptions: [] } }
  return { spec: candidate, assumptions }
}

export function cadStockDesignIssue(spec: CadProgramSpec): string | null {
  const base = spec.steps[0]
  if (base.shape !== 'box' || Object.values(base.rotation).some((value) => Math.abs(value) > 1e-6) ||
      spec.steps.some((step) => step.op === 'union' || step.shape === 'shell' ||
        step.op === 'cut' && step.shape !== 'hole' && step.shape !== 'thread')) return null
  const dimensions = { x: 'width', y: 'depth', z: 'height' } as const
  for (const step of spec.steps.slice(1)) {
    if (step.shape !== 'hole' || step.holeType === 'plain') continue
    const unit = direction(step.rotation)
    const axial = axes.find((axis) => Math.abs(unit[axis]) > 1 - 1e-6)
    if (!axial || step.pattern && (step.pattern.kind === 'linear' ? Math.abs(step.pattern.offset[axial]) > 1e-6
      : (step.pattern.axis ?? 'z') !== axial)) continue
    const stockSize = base[dimensions[axial]]
    const face = base.position[axial] + Math.sign(unit[axial]) * stockSize / 2
    const entranceOffset = (step.position[axial] - face) * Math.sign(unit[axial])
    if (entranceOffset < -1e-5)
      return `CAD step ${step.id} (hole) screw-head entrance is buried ${(-entranceOffset).toFixed(3)} mm inside the stock; place its entrance on the exposed ${axial.toUpperCase()} face at ${face.toFixed(3)} mm, preserving the radial axis and hole dimensions`
    if (entranceOffset >= step.headDepth - 1e-5)
      return `CAD step ${step.id} (hole) screw-head recess is entirely outside the stock; place its entrance on the exposed ${axial.toUpperCase()} face at ${face.toFixed(3)} mm so the head recess actually removes material`
    const seatDepth = step.headDepth - entranceOffset
    if (seatDepth >= stockSize - 1e-5)
      return `CAD step ${step.id} (hole) screw-head recess crosses the complete stock thickness ${stockSize.toFixed(3)} mm; no head-supporting seat remains. Preserve required head dimensions, enlarge inferred stock or choose compatible hardware explicitly in assumptions`
  }
  return null
}

export const CAD_DESIGN_GUIDANCE = 'Design functional stock and interface dimensions before writing operations. For every bore, calculate radial wall = stock half-size minus axis offset minus bore radius on both perpendicular axes; keep positive wall (normally >=1 mm), or enlarge inferred stock while preserving the mating axis. Include the larger screw-head recess in that calculation. A cavity centered off-axis can break the lower wall even when its diameter is smaller than the block height. Separate bearing journals from threads and guide holes from bolt holes. Build connected load-carrying material first, machine interfaces and actual threads next. Do not add cosmetic fillets/chamfers unless requested or necessary for assembly; if needed, select a few accessible edges while their supporting stock exists. Never apply all/circular finishing to a completed threaded shaft. Avoid redundant cuts/unions, full-diameter features repeated onto themselves, cuts that isolate requested material and excessive thread lengths. Prefer simple machinable stock and patterns with every instance adding/removing real material. Review each planned operation against the geometry that exists at that exact point in the sequence. Return all decisions in assumptions; unsupported functions remain explicitly unverified.'
