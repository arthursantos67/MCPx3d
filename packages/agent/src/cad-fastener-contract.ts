import type { CadAssemblySpec } from '../../domain/ts/src/cad-assembly.ts'
import { validateCadAssembly } from '../../domain/ts/src/cad-assembly.ts'

export function prepareFastenerContract(spec: CadAssemblySpec, request: string): { spec: CadAssemblySpec; assumptions: string[] } {
  // An explicit maximum is authoritative. A specified thread clearance can
  // coexist with a larger, explicitly dimensioned screw passage.
  if (!spec.mechanics || /\bmaxClearance\b|\b(?:folgas?|clearances?|toler[aâ]ncias?|tolerances?)\s+(?:radial\s+)?(?:m[aá]xim|maximum|limitad)|\b(?:maximum|maximal|m[aá]xim[oa]|limite)\s+(?:de\s+)?(?:radial\s+)?(?:folgas?|clearances?|toler[aâ]ncias?|tolerances?)/i.test(request)) return { spec, assumptions: [] }
  const specifiedClearance = /\b(?:folgas?|clearances?|toler[aâ]ncias?|tolerances?)\b/i.test(request)
  const explicitPassages = [...request.matchAll(/\b(?:furos?|passagens?|passagem|holes?|bores?|passages?)\b[^;\n]{0,60}?(\d+(?:[.,]\d+)?)\s*mm\b/gi)]
    .map((match) => Number(match[1].replace(',', '.')))
  const assumptions: string[] = []
  const connections = spec.mechanics.connections.map((joint) => {
    if (joint.kind !== 'fixed' || !['bolted', 'threaded'].includes(joint.fastening)) return joint
    const first = spec.components.find((component) => component.id === joint.first)?.steps.find((step) => step.id === joint.firstFeature)
    const second = spec.components.find((component) => component.id === joint.second)?.steps.find((step) => step.id === joint.secondFeature)
    const bore = (step: typeof first) => step?.op === 'cut' && (step.shape === 'hole' || step.shape === 'cylinder') ? step.diameter : null
    const diameter = bore(first)
    if (diameter === null) return joint
    if (specifiedClearance && !explicitPassages.some((value) => Math.abs(value - diameter) <= 1e-6)) return joint
    let required = (diameter - joint.fastenerDiameter) / 2
    if (joint.fastening === 'bolted') {
      const other = bore(second)
      if (other === null || other < joint.fastenerDiameter) return joint
      if (specifiedClearance && !explicitPassages.some((value) => Math.abs(value - other) <= 1e-6)) return joint
      required = Math.max(required, (other - joint.fastenerDiameter) / 2)
    } else {
      if (second?.op !== 'cut' || second.shape !== 'thread' || second.profile !== 'metric' || (second.starts ?? 1) !== 1 ||
        Math.abs(second.diameter - joint.fastenerDiameter) > 1e-6) return joint
      required = Math.max(required, second.clearance)
    }
    // Only reconcile a small inferred bound with already dimensioned screw
    // passages. Oversized/undersized bores still require explicit correction.
    if (diameter < joint.fastenerDiameter || required <= joint.maxClearance + 1e-6 ||
      required > Math.min(.5, joint.fastenerDiameter * .1)) return joint
    assumptions.push(`A folga radial máxima inferida de ${joint.id} foi ajustada de ${joint.maxClearance} para ${required} mm para corresponder às passagens existentes do parafuso Ø${joint.fastenerDiameter} mm. Geometria e engate foram conservados e a montagem exige inspeção completa.`)
    return { ...joint, maxClearance: required }
  })
  if (!assumptions.length) return { spec, assumptions }
  const revised = { ...spec, mechanics: { ...spec.mechanics, connections } }
  try { validateCadAssembly(revised) } catch { return { spec, assumptions: [] } }
  return { spec: revised, assumptions }
}
