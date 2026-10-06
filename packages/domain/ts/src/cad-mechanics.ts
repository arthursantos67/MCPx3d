import type { CadAssemblySpec } from './cad-assembly.ts'

export interface CadMechanicalConnection {
  readonly id: string
  readonly kind: 'fixed' | 'linear' | 'rotary' | 'thread'
  readonly first: string
  readonly second: string
  readonly firstFeature: string
  readonly secondFeature: string
  readonly maxClearance: number
  readonly minEngagement: number
  readonly fastening: 'none' | 'bonded' | 'bolted' | 'captured'
  readonly fastenerDiameter: number
}

export interface CadMechanics {
  readonly grounded: string
  readonly connections: readonly CadMechanicalConnection[]
}

export function validateMechanicalReferences(spec: CadAssemblySpec, checkFeatures = true): void {
  const mechanics = spec.mechanics
  if (!mechanics) return
  const components = new Map(spec.components.map((component) => [component.id, component]))
  if (!components.has(mechanics.grounded) || components.get(mechanics.grounded)!.motion) throw new Error('Mechanical ground must reference a fixed component')
  if (!Array.isArray(mechanics.connections) || mechanics.connections.length < 1 || mechanics.connections.length > 24) throw new Error('Mechanical connections must contain 1–24 entries')
  const ids = new Set<string>(), graph = new Map(spec.components.map((component) => [component.id, new Set<string>()]))
  for (const joint of mechanics.connections) {
    if (!joint || typeof joint.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(joint.id) || ids.has(joint.id)) throw new Error('Mechanical connection IDs must be unique')
    ids.add(joint.id)
    if (!components.has(joint.first) || !components.has(joint.second) || joint.first === joint.second) throw new Error('Mechanical connection needs distinct existing components')
    if (!['fixed', 'linear', 'rotary', 'thread'].includes(joint.kind) || !['none', 'bonded', 'bolted', 'captured'].includes(joint.fastening) ||
      (joint.kind === 'fixed') !== (joint.fastening !== 'none') || !Number.isFinite(joint.maxClearance) || joint.maxClearance < 0 || joint.maxClearance > 1 ||
      !Number.isFinite(joint.minEngagement) || joint.minEngagement < 0.1 || joint.minEngagement > 1000 ||
      !Number.isFinite(joint.fastenerDiameter) || joint.fastenerDiameter < 0 || joint.fastenerDiameter > 100 ||
      (joint.fastening === 'bolted') !== (joint.fastenerDiameter > 0)) throw new Error(`Invalid mechanical connection ${joint.id}`)
    if (!!joint.firstFeature !== !!joint.secondFeature) throw new Error('Mechanical connection must supply both feature IDs or neither')
    for (const [componentId, featureId] of [[joint.first, joint.firstFeature], [joint.second, joint.secondFeature]]) {
      if (typeof featureId !== 'string' || !/^[A-Za-z0-9_-]{0,64}$/.test(featureId) ||
        ((!featureId) && (joint.kind !== 'fixed' || joint.fastening === 'bolted'))) throw new Error(`Mechanical connection ${joint.id} needs feature IDs`)
      if (checkFeatures && featureId && !components.get(componentId)!.steps.some((step) => step.id === featureId)) throw new Error(`Mechanical connection ${joint.id} references unknown feature ${componentId}/${featureId}`)
    }
    graph.get(joint.first)!.add(joint.second); graph.get(joint.second)!.add(joint.first)
  }
  const reached = new Set([mechanics.grounded]), pending = [mechanics.grounded]
  while (pending.length) for (const next of graph.get(pending.pop()!)!) if (!reached.has(next)) { reached.add(next); pending.push(next) }
  if (reached.size !== components.size) throw new Error('Every mechanical component needs a connection path to ground')
}
