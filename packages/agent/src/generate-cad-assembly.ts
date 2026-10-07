import { type CadAssemblySpec, type CadMotion, validateCadAssembly } from '../../domain/ts/src/cad-assembly.ts'
import type { CadProgramSpec } from '../../domain/ts/src/cad-program.ts'
import { generateCadProgram, CadProgramValidationError } from './generate-cad-program.ts'
import { ProviderRequestError, type LLMProvider } from './provider.ts'
import { assemblyIssueMessage, type CadAssemblyCheckResult } from '../../domain/ts/src/cad-assembly-diagnostics.ts'
import { reducesInterference, repairAssemblyLocally } from './assembly-repair.ts'
import { cylindricalFitStrategy } from './assembly-fits.ts'
import { threadedFitStrategy } from './assembly-thread-fits.ts'
import { motionClearanceStrategy } from './assembly-motion-clearance.ts'
import { cadResponseMetadataSchema, isCadResponseMetadata } from './cad-response-metadata.ts'
import { validateMechanicalReferences, type CadMechanics } from '../../domain/ts/src/cad-mechanics.ts'
import { generateCadDecision } from './cad-autonomy.ts'
import { mechanicalFitIssue, matingContext, repairMechanicalFitLocally } from './cad-mating.ts'
import type { CadDraftListener } from '../../domain/ts/src/cad-draft.ts'
import { requestedCadComponentCount } from './cad-component-count.ts'
import { CadDraftGenerationError } from './cad-draft-generation.ts'
import { CAD_DESIGN_GUIDANCE } from './cad-design-preparation.ts'
import { cadMechanismGuidance } from './cad-mechanism-guidance.ts'
import { CAD_FASTENER_GUIDANCE } from '../../domain/ts/src/cad-fasteners.ts'
import { cadIdentity } from './cad-identity.ts'

const mechanicsSchema = { type: 'object', additionalProperties: false, required: ['grounded', 'connections'], properties: {
  grounded: { type: 'string' }, connections: { type: 'array', minItems: 1, maxItems: 24, items: {
    type: 'object', additionalProperties: false,
    required: ['id', 'kind', 'first', 'second', 'firstFeature', 'secondFeature', 'maxClearance', 'minEngagement', 'fastening', 'fastenerDiameter'],
    properties: { id: { type: 'string' }, kind: { enum: ['fixed', 'linear', 'rotary', 'thread'] },
      first: { type: 'string' }, second: { type: 'string' }, firstFeature: { type: 'string' }, secondFeature: { type: 'string' },
      maxClearance: { type: 'number', minimum: 0, maximum: 1 }, minEngagement: { type: 'number', minimum: 0.1, maximum: 1000 },
      fastening: { enum: ['none', 'bonded', 'bolted', 'captured'] }, fastenerDiameter: { type: 'number', minimum: 0, maximum: 100 } },
  } },
} }

const vector = { type: 'object', additionalProperties: false, required: ['x', 'y', 'z'], properties: {
  x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' },
} }
const motion = { type: 'object', additionalProperties: false,
  required: ['kind', 'axis', 'minimum', 'maximum', 'value', 'pitch', 'group', 'factor'],
  properties: {
    kind: { enum: ['fixed', 'slider', 'screw', 'rotary'] }, axis: { enum: ['x', 'y', 'z'] },
    minimum: { type: 'number' }, maximum: { type: 'number' }, value: { type: 'number' },
    pitch: { type: 'number' }, group: { type: 'string' }, factor: { type: 'number' },
  },
}
const schema = { type: 'object', additionalProperties: false,
  required: ['decision', 'partId', 'question', 'assumptions', 'components', 'mechanics'],
  properties: {
    decision: { enum: ['create', 'clarify'] }, partId: { type: 'string' },
    ...cadResponseMetadataSchema,
    mechanics: { anyOf: [mechanicsSchema, { type: 'null' }] },
    components: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['id', 'action', 'description', 'position', 'motion'], properties: {
        id: { type: 'string' }, action: { enum: ['keep', 'build'] }, description: { type: 'string' }, position: vector, motion,
      } } },
  },
}

interface PlannedComponent {
  id: string
  action: 'keep' | 'build'
  description: string
  position: { x: number; y: number; z: number }
  motion: { kind: 'fixed' | 'slider' | 'screw' | 'rotary'; axis: 'x' | 'y' | 'z'; minimum: number; maximum: number; value: number; pitch: number; group: string; factor?: number }
}
interface AssemblyPlan {
  decision: 'create' | 'clarify'
  partId: string
  question: string
  assumptions: string[]
  components: PlannedComponent[]
  mechanics?: CadMechanics | null
}

function normalizeLinkedMotionGroups(plan: AssemblyPlan): AssemblyPlan {
  const members = new Map<string, PlannedComponent[]>()
  for (const component of plan.components) {
    const { motion } = component
    if (motion.kind === 'fixed' || !motion.group) continue
    const group = members.get(motion.group) ?? []
    group.push(component)
    members.set(motion.group, group)
  }
  if (![...members.values()].some((group) => group.length > 1)) return plan

  const replacements = new Map<PlannedComponent, PlannedComponent>()
  for (const group of members.values()) {
    if (group.length < 2) continue
    // A linked group has one command coordinate. Models frequently describe
    // its members in their physical units (mm versus degrees), despite each
    // member already carrying a factor that converts the shared command.
    // Keep the interval all members can honor, and choose an existing value
    // from that interval (zero when it is the natural common home position).
    let minimum = Math.max(...group.map((component) => component.motion.minimum))
    let maximum = Math.min(...group.map((component) => component.motion.maximum))
    if (!(minimum < maximum)) {
      throw new Error(`O grupo ${group[0].motion.group} tem cursos incompatíveis`)
    }
    const values = group.map((component) => component.motion.value)
    const value = values.find((candidate) => candidate >= minimum && candidate <= maximum)
      ?? (minimum <= 0 && maximum >= 0 ? 0 : Math.min(maximum, Math.max(minimum, values[0])))
    for (const component of group) replacements.set(component, {
      ...component,
      motion: { ...component.motion, minimum, maximum, value },
    })
  }
  return replacements.size ? { ...plan, components: plan.components.map((component) => replacements.get(component) ?? component) } : plan
}

interface AssemblyCheckpoint {
  readonly plan: AssemblyPlan
  readonly components: CadAssemblySpec['components'][number][]
  readonly assumptions: string[]
  readonly clarification?: { readonly componentId: string; readonly question: string }
  readonly componentFailures?: Record<string, string>
  readonly needsMechanicalPlan?: boolean
  readonly needsDesignReview?: boolean
}

const checkpoints = new WeakMap<LLMProvider, Map<string, AssemblyCheckpoint>>()

function checkpointStore(provider: LLMProvider): Map<string, AssemblyCheckpoint> {
  let store = checkpoints.get(provider)
  if (!store) { store = new Map(); checkpoints.set(provider, store) }
  return store
}

export type CadAssemblyOutcome =
  | { readonly kind: 'create'; readonly spec: CadAssemblySpec; readonly assumptions: readonly string[] }
  | { readonly kind: 'clarify'; readonly question: string }

export class CadAssemblyValidationError extends Error {
  readonly spec: CadAssemblySpec
  constructor(message: string, spec: CadAssemblySpec) {
    super(message)
    this.name = 'CadAssemblyValidationError'
    this.spec = spec
  }
}

export class CadAssemblyPausedError extends ProviderRequestError {
  readonly spec: CadAssemblySpec
  constructor(message: string, spec: CadAssemblySpec, cause?: unknown) {
    super(message, { cause })
    this.name = 'CadAssemblyPausedError'
    this.spec = structuredClone(spec)
  }
}

export interface CadAssemblyProgress {
  readonly activity?: 'generating-correction' | 'checking-component' | 'checking-assembly'
  readonly phase: 'classifying' | 'planning' | 'reviewing-plan' | 'building' | 'checking-component' | 'repairing-component' |
    'checking-assembly' | 'repairing-assembly' | 'complete'
  readonly components: readonly { readonly id: string; readonly action: 'keep' | 'build' }[]
  readonly completed: number
  readonly completedComponentIds?: readonly string[]
  readonly failedComponentIds?: readonly string[]
  readonly componentIndex?: number
  readonly validationAttempt?: number
  readonly resumed?: boolean
  readonly replanning?: boolean
}

export type CadAssemblyProgressListener = (progress: CadAssemblyProgress) => void

function parsePlan(raw: unknown, previous?: CadAssemblySpec, requireMechanics = false, expectedCount?: number, allowUnverifiedDrafts = false): AssemblyPlan {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Plano de conjunto CAD inválido')
  const plan = raw as AssemblyPlan
  if (!isCadResponseMetadata(plan)) throw new Error('Metadados do conjunto CAD inválidos: question deve ser texto e assumptions uma lista de textos')
  if (plan.decision === 'clarify' && typeof plan.question === 'string' && plan.question.trim()) return plan
  if (plan.decision !== 'create' || typeof plan.partId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(plan.partId) ||
    (previous && plan.partId !== previous.partId) ||
    !Array.isArray(plan.components) || plan.components.length < 2 || plan.components.length > 8 ||
    !Array.isArray(plan.assumptions)) throw new Error('Plano de conjunto CAD inválido')
  if (expectedCount !== undefined && plan.components.length !== expectedCount) throw new Error(`O pedido exige exatamente ${expectedCount} corpos físicos modelados; o plano devolveu ${plan.components.length}. Corrija a decomposição antes de construir peças.`)
  const ids = new Set<string>()
  let fixed = 0
  for (const component of plan.components) {
    if (!component || typeof component.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(component.id) || ids.has(component.id) ||
      !['keep', 'build'].includes(component.action) ||
      (component.action === 'keep' && !previous?.components.some((old) => old.id === component.id)) ||
      typeof component.description !== 'string' || !component.description.trim() ||
      !component.position || !['x', 'y', 'z'].every((axis) => Number.isFinite(component.position[axis as 'x' | 'y' | 'z']) && Math.abs(component.position[axis as 'x' | 'y' | 'z']) <= 10_000) ||
      !component.motion || !['fixed', 'slider', 'screw', 'rotary'].includes(component.motion.kind)) throw new Error('Componente CAD inválido')
    ids.add(component.id)
    if (component.motion.kind === 'fixed') fixed++
    else {
      const movement = component.motion
      if (!['x', 'y', 'z'].includes(movement.axis) || ![movement.minimum, movement.maximum, movement.value].every((value) => Number.isFinite(value) && Math.abs(value) <= 10_000) ||
        movement.minimum >= movement.maximum || movement.value < movement.minimum || movement.value > movement.maximum ||
        (movement.kind === 'screw' && !(Number.isFinite(movement.pitch) && movement.pitch > 0 && movement.pitch <= 1000)) ||
        (movement.group !== undefined && typeof movement.group !== 'string') ||
        (movement.group && !/^[A-Za-z0-9_-]{1,64}$/.test(movement.group)) ||
        (movement.group && movement.factor !== undefined && (!Number.isFinite(movement.factor) || movement.factor === 0 || Math.abs(movement.factor) > 1000))) throw new Error(`Movimento inválido: ${component.id}`)
    }
  }
  if (!fixed) throw new Error('O conjunto precisa de uma peça fixa')
  if (previous?.mechanics && !plan.mechanics) throw new Error('A edição não pode descartar os vínculos mecânicos existentes')
  if (requireMechanics && !plan.mechanics && !allowUnverifiedDrafts) throw new Error('O plano precisa declarar mechanics: peça ancorada e vínculos de fixação, guias, mancais e transmissão. Uma lista de movimentos não comprova montagem funcional.')
  if (requireMechanics && !allowUnverifiedDrafts && plan.components.some((component) => component.motion.kind === 'screw')) throw new Error('A verificação mecânica ainda não suporta movimento helicoidal de um corpo. Para um atuador, use fuso rotary estacionário e carro slider guiado; mecanismos que exigem screw precisam de esclarecimento.')
  const normalized = normalizeLinkedMotionGroups(plan)
  for (const component of normalized.components) {
    const movement = component.motion
    if (movement.kind !== 'fixed' && movement.kind !== 'rotary' && movement.group && movement.factor !== undefined &&
        Math.max(Math.abs(movement.minimum * movement.factor), Math.abs(movement.maximum * movement.factor)) > 10_000) {
      throw new Error(`Curso de movimento inválido: ${component.id}`)
    }
  }
  const envelope: CadAssemblySpec = { schemaVersion: '4.0', units: 'mm', partId: normalized.partId,
    components: normalized.components.map((component) => ({ id: component.id, position: component.position,
      steps: [{ id: 'planning_envelope', op: 'base', shape: 'box', width: 1, depth: 1, height: 1,
        position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }],
      motion: component.motion.kind === 'fixed' ? undefined : {
        kind: component.motion.kind, axis: component.motion.axis, minimum: component.motion.minimum,
        maximum: component.motion.maximum, value: component.motion.value,
        ...(component.motion.kind === 'screw' ? { pitch: component.motion.pitch } : {}),
        ...(component.motion.group ? { group: component.motion.group, ...(component.motion.factor !== undefined ? { factor: component.motion.factor } : {}) } : {}),
      },
    })) }
  validateCadAssembly(envelope)
  if (normalized.mechanics) validateMechanicalReferences({ ...envelope, mechanics: normalized.mechanics }, false)
  return normalized
}

function collisionTarget(spec: CadAssemblySpec, issue: string): string | null {
  const pair = /^CAD components ([A-Za-z0-9_-]+) and ([A-Za-z0-9_-]+) intersect at /.exec(issue)
  const first = spec.components.find((component) => component.id === pair?.[1])
  const second = spec.components.find((component) => component.id === pair?.[2])
  if (!first || !second) return null
  const fractions = /overlap fractions: [A-Za-z0-9_-]+=([\d.]+), [A-Za-z0-9_-]+=([\d.]+)/.exec(issue)
  const firstFraction = fractions ? Number(fractions[1]) : 0
  const secondFraction = fractions ? Number(fractions[2]) : 0
  // If the second body is almost entirely inside the first, the enclosing
  // body's missing clearance is the more useful first correction.
  if (secondFraction >= 0.8 && firstFraction < secondFraction) return first.id
  if (firstFraction >= 0.8 && secondFraction < firstFraction) return second.id
  if (!!first.motion !== !!second.motion) return first.motion ? second.id : first.id
  const internalThread = (component: typeof first) => component.steps.some((step) => step.op === 'cut' && step.shape === 'thread')
  if (internalThread(first) !== internalThread(second)) return internalThread(first) ? first.id : second.id
  const cutVolume = (component: typeof first) => component.steps.reduce((total, step) => {
    if (step.op !== 'cut') return total
    const count = step.pattern?.count ?? 1
    if (step.shape === 'box') return total + step.width * step.depth * step.height * count
    if (step.shape === 'cylinder') return total + Math.PI * (step.diameter / 2) ** 2 * step.height * count
    return total
  }, 0)
  const firstCuts = cutVolume(first)
  const secondCuts = cutVolume(second)
  if (firstCuts > secondCuts * 1.2) return first.id
  if (secondCuts > firstCuts * 1.2) return second.id
  return second.id
}

async function clearLocalizedOverlap(
  spec: CadAssemblySpec, issue: string,
  checkComponent: (spec: CadProgramSpec) => Promise<string | null>,
  checkAssembly: (spec: CadAssemblySpec) => Promise<string | null>,
  onAttempt?: () => void,
): Promise<CadAssemblySpec | null> {
  if (!/^CAD components [A-Za-z0-9_-]+ and [A-Za-z0-9_-]+ intersect at posição atual by /.test(issue)) return null
  const targetId = collisionTarget(spec, issue)
  const target = spec.components.find((component) => component.id === targetId)
  const bounds = /overlap bounds: x=\[([\d.-]+), ([\d.-]+)\], y=\[([\d.-]+), ([\d.-]+)\], z=\[([\d.-]+), ([\d.-]+)\]/.exec(issue)
  const volumes = /component volumes: [A-Za-z0-9_-]+=([\d.]+), [A-Za-z0-9_-]+=([\d.]+)/.exec(issue)
  const fractions = /overlap fractions: [A-Za-z0-9_-]+=([\d.]+), [A-Za-z0-9_-]+=([\d.]+)/.exec(issue)
  if (!target || !bounds || !volumes || !fractions || target.motion || target.steps.length >= 32 ||
      target.steps.some((step) => step.shape === 'thread') ||
      !target.steps.some((step) => step.op === 'cut')) return null
  const pair = /^CAD components ([A-Za-z0-9_-]+) and ([A-Za-z0-9_-]+) intersect at /.exec(issue)!
  const targetIndex = target.id === pair[1] ? 1 : 2
  const targetVolume = Number(volumes[targetIndex])
  const targetFraction = Number(fractions[targetIndex])
  const edges = [1, 3, 5].map((index) => [Number(bounds[index]), Number(bounds[index + 1])])
  const lengths = edges.map(([minimum, maximum]) => maximum - minimum + 2)
  if (!Number.isFinite(targetVolume) || targetVolume <= 0 || targetFraction > 0.1 ||
      lengths.some((length) => !Number.isFinite(length) || length <= 2) ||
      Math.min(...lengths) > Math.max(...lengths) * 0.25 ||
      lengths.reduce((volume, length) => volume * length, 1) > targetVolume * 0.15) return null
  const usedIds = new Set(target.steps.map((step) => step.id))
  let index = 1
  while (usedIds.has(`assembly_relief_${index}`)) index++
  const tool = { id: `assembly_relief_${index}`, op: 'cut' as const, shape: 'box' as const,
    position: { x: (edges[0][0] + edges[0][1]) / 2 - target.position.x,
      y: (edges[1][0] + edges[1][1]) / 2 - target.position.y,
      z: (edges[2][0] + edges[2][1]) / 2 - target.position.z },
    rotation: { x: 0, y: 0, z: 0 }, width: lengths[0], depth: lengths[1], height: lengths[2] }
  const steps = [...target.steps, tool]
  const revised: CadAssemblySpec = { ...spec, components: spec.components.map((component) =>
    component.id === target.id ? { ...component, steps } : component) }
  try {
    validateCadAssembly(revised)
  } catch {
    return null
  }
  onAttempt?.()
  const program: CadProgramSpec = { schemaVersion: '3.0', units: 'mm', partId: target.id, steps }
  if (await checkComponent(program) || await checkAssembly(revised)) return null
  return revised
}

function readBounds(text: string): Record<'x' | 'y' | 'z', readonly [number, number]> | null {
  const match = /x=\[([\d.-]+), ([\d.-]+)\], y=\[([\d.-]+), ([\d.-]+)\], z=\[([\d.-]+), ([\d.-]+)\]/.exec(text)
  if (!match) return null
  const values = match.slice(1).map(Number)
  if (values.some((value) => !Number.isFinite(value))) return null
  return { x: [values[0], values[1]], y: [values[2], values[3]], z: [values[4], values[5]] }
}

async function seatAxialComponent(
  spec: CadAssemblySpec, issue: string,
  checkAssembly: (spec: CadAssemblySpec) => Promise<string | null>,
  onAttempt?: () => void,
): Promise<CadAssemblySpec | null> {
  const pair = /^CAD components ([A-Za-z0-9_-]+) and ([A-Za-z0-9_-]+) intersect at posição atual by /.exec(issue)
  const overlap = readBounds(issue.split('overlap bounds: ')[1] ?? '')
  const details = issue.split('component bounds: ')[1]
  if (!pair || !overlap || !details) return null
  const bounds = pair.slice(1, 3).map((id) => {
    const entry = details.split('; ').find((item) => item.startsWith(`${id} x=`))
    return readBounds(entry ?? '')
  })
  if (!bounds[0] || !bounds[1]) return null
  const axes = ['x', 'y', 'z'] as const
  const extent = (box: NonNullable<typeof bounds[number]>, axis: typeof axes[number]) => box[axis][1] - box[axis][0]
  const axial = axes.reduce((smallest, axis) => extent(overlap, axis) < extent(overlap, smallest) ? axis : smallest)
  if (extent(overlap, axial) > Math.max(...axes.map((axis) => extent(overlap, axis))) * 0.25) return null
  const indices = [0, 1].sort((a, b) => extent(bounds[a]!, axial) - extent(bounds[b]!, axial))
  for (const index of indices) {
    const cap = spec.components.find((component) => component.id === pair[index + 1])
    const body = spec.components.find((component) => component.id === pair[2 - index])
    const capBounds = bounds[index]!
    const bodyBounds = bounds[1 - index]!
    if (!cap || !body || cap.motion || body.motion ||
        (cap.steps.some((step) => step.shape === 'thread') && body.steps.some((step) => step.shape === 'thread')) ||
        extent(capBounds, axial) > extent(bodyBounds, axial) * 0.5 ||
        extent(overlap, axial) < extent(capBounds, axial) * 0.2 ||
        axes.some((axis) => axis !== axial && extent(overlap, axis) < extent(bodyBounds, axis) * 0.5)) continue
    const capCenter = (capBounds[axial][0] + capBounds[axial][1]) / 2
    const bodyCenter = (bodyBounds[axial][0] + bodyBounds[axial][1]) / 2
    const direction = capCenter >= bodyCenter ? 1 : -1
    const exposed = direction > 0 ? bodyBounds[axial][1] : bodyBounds[axial][0]
    const overlapEdge = direction > 0 ? overlap[axial][1] : overlap[axial][0]
    if (Math.abs(exposed - overlapEdge) > 1) continue
    const travel = direction > 0
      ? exposed - capBounds[axial][0] + 0.5
      : exposed - capBounds[axial][1] - 0.5
    if (Math.abs(travel) < 0.01 || Math.abs(travel) > Math.min(30, extent(bodyBounds, axial) * 0.25)) continue
    const revised: CadAssemblySpec = { ...spec, components: spec.components.map((component) =>
      component.id === cap.id ? { ...component,
        position: { ...component.position, [axial]: component.position[axial] + travel } } : component) }
    try {
      validateCadAssembly(revised)
    } catch {
      continue
    }
    onAttempt?.()
    if (!await checkAssembly(revised)) return revised
  }
  return null
}

async function repairAssemblyCollision(
  provider: LLMProvider, request: string, spec: CadAssemblySpec, initialIssue: Exclude<CadAssemblyCheckResult, null>,
  checkComponent: (spec: CadProgramSpec) => Promise<string | null>,
  checkAssembly: (spec: CadAssemblySpec) => Promise<CadAssemblyCheckResult>,
  onActivity?: (activity: NonNullable<CadAssemblyProgress['activity']>) => void,
  noQuestions = false,
  maxRepairAttempts?: number,
  onDraft?: (components: CadAssemblySpec['components'], issue?: string, pendingComponentId?: string) => void,
): Promise<CadAssemblyOutcome | { kind: 'progress'; spec: CadAssemblySpec; issue: CadAssemblyCheckResult; assumptions: readonly string[] } | null> {
  const issue = assemblyIssueMessage(initialIssue)!
  const targetId = collisionTarget(spec, issue)
  if (!targetId) return null
  const target = spec.components.find((component) => component.id === targetId)!
  const current: CadProgramSpec = { schemaVersion: '3.0', units: 'mm', partId: target.id, steps: target.steps }
  const replace = (program: CadProgramSpec): CadAssemblySpec => ({ ...spec,
    components: spec.components.map((component) => component.id === targetId
      ? { ...component, steps: program.steps } : component),
  })
  const inspect = async (program: CadProgramSpec): Promise<string | null> => {
    onActivity?.('checking-component')
    const componentIssue = await checkComponent(program)
    return componentIssue
  }
  const correction = [
    `Original request: ${request}`,
    `Complete mechanical assembly: ${JSON.stringify(spec)}`,
    `Assembly collision: ${issue}`,
    ...(typeof initialIssue === 'string' ? [] : [
      `All collisions involving this component, including travel poses: ${JSON.stringify(initialIssue.collisions.filter((item) => item.components.includes(targetId)))}`,
    ]),
    `Edit ONLY component ${targetId} to eliminate the solid-volume interference while keeping the intended physical arrangement and all unrelated components.`,
    'When a stationary body surrounds another, add or enlarge a real cavity or bore with a small positive clearance; do not simply translate an internal component outside the mechanism.',
    'A cut or flat attached to a rotating body rotates away from a stationary obstruction. Provide clearance in the stationary body for the full rotating envelope. Preserve the existing motion range and all thread parameters.',
    'Preserve the external mounting geometry, component identity and one connected solid. Infer a sensible ordinary clearance when none was specified. Return the complete corrected CAD program.',
  ].join('\n\n')
  const outcome = await generateCadProgram(provider, correction, current, inspect, {
    maxOutputTokens: 6500, onGeneration: () => onActivity?.('generating-correction'), noQuestions, maxRepairAttempts,
    onDraft: (candidate, issue) => onDraft?.(replace(candidate).components, issue, targetId),
  })
  if (outcome.kind === 'clarify') return { kind: 'clarify', question: `${targetId}: ${outcome.question}` }
  const revised = replace(outcome.spec)
  validateCadAssembly(revised)
  onActivity?.('checking-assembly')
  const remaining = await checkAssembly(revised)
  if (remaining) {
    if (!reducesInterference(initialIssue, remaining)) throw new ProviderRequestError('A correção não demonstrou redução das interferências do conjunto. O rascunho anterior foi conservado; nenhuma nova chamada automática será feita.')
    return { kind: 'progress', spec: revised, issue: remaining,
      assumptions: outcome.assumptions.map((item) => `${targetId}: ${item}`) }
  }
  return { kind: 'create', spec: revised,
    assumptions: [...outcome.assumptions.map((item) => `${targetId}: ${item}`),
      `Folga entre componentes corrigida em ${targetId} e validada no conjunto.`] }
}

export async function generateCadAssembly(
  provider: LLMProvider, request: string,
  checkComponent: (spec: CadProgramSpec) => Promise<string | null>,
  checkAssembly?: (spec: CadAssemblySpec) => Promise<CadAssemblyCheckResult>,
  previous?: CadAssemblySpec,
  onProgress?: CadAssemblyProgressListener,
  repairAttempt = 0,
  options?: { readonly repairOnly?: boolean; readonly requireMechanics?: boolean; readonly noQuestions?: boolean; readonly maxRepairAttempts?: number;
    readonly onDraft?: CadDraftListener; readonly allowUnverifiedDrafts?: boolean; readonly prepareDesign?: boolean; readonly reviewPlan?: boolean;
    readonly repairLimits?: { readonly steps: number; readonly validations: number } },
): Promise<CadAssemblyOutcome> {
  if (!request.trim()) throw new Error('Descreva o conjunto CAD')
  if (options?.requireMechanics && !checkAssembly) throw new Error('A criação mecânica exige verificação do conjunto no motor CAD')
  if (options?.repairOnly) {
    if (!previous || !checkAssembly) throw new Error('A correção precisa de um conjunto existente e do motor CAD')
    validateCadAssembly(previous)
  }
  if (checkAssembly && provider.generationPolicy) {
    const inspect = checkAssembly
    checkAssembly = async (spec) => {
      try { return await inspect(spec) }
      catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error
        throw new ProviderRequestError(`A verificação do conjunto foi interrompida. Os componentes disponíveis foram conservados nesta aba; nenhuma correção com IA foi solicitada para essa falha. ${error instanceof Error ? error.message : 'Falha no motor CAD.'}`, { cause: error })
      }
    }
  }
  const instructions = [
    cadMechanismGuidance(request),
    CAD_DESIGN_GUIDANCE,
    CAD_FASTENER_GUIDANCE,
    'Plan a real mechanical CAD assembly in millimeters. A recognizable object needs no routine dimensions from the user: infer useful values and list assumptions.',
    'Decompose it into 2–8 physically separate, individually connected solid components. Never fuse parts that must move relative to each other.',
    'Respect an explicitly requested component count exactly, counting modeled physical bodies rather than holes/features or unmodeled commercial hardware. The complete assembly has at most 128 construction steps, with at most 32 per component; use patterns and plan a practical feature budget across all bodies.',
    'Give each component a detailed local-geometry description, with dimensions, holes, clearances and its intended absolute position. Its construction steps will be generated separately; local coordinates should be centered near the component origin.',
    'Choose one global assembly datum and a principal motion axis. Build anchoring/reference geometry before dependent parts. Component position is its local origin in the assembly, not a feature offset; state local feature coordinates separately. Derive fixed contact from opposing faces, journal/bore engagement from intersecting axial intervals and wall thickness from cavity radius plus axis offset. Before prescribing a dimension, check the entire travel envelope. Never independently invent mating dimensions for opposite sides of the same connection. Design simple connected stock and critical interfaces first, real threads next, selective cosmetic finishes last only where the kernel supports them.',
    'Define consistent mating envelopes across components. A housing around another body needs a real cavity or bore larger than the enclosed body. Stationary components may touch at interfaces but must not occupy the same solid volume; moving components need clearance throughout travel.',
    'Treat dimensions inferred by this plan as adjustable design choices, not user constraints. Compute matching global shaft/journal and bore intervals before prescribing local positions. Resolve inconsistencies in your own inferred layout without asking authorization; preserve dimensions explicitly required by the original user. Record fit decisions and assumptions.',
    options?.requireMechanics
      ? 'REQUIRED: return mechanics with grounded (one fixed component ID) and a connected graph of connections. Every fixed component must reach ground through fixed fastenings. Every slider rigid cluster needs two separated parallel linear guides; every rotary shaft needs smooth bearing journals and opposed modeled shoulders/retainers preventing axial drift. Coaxial rotary parts may have fixed fastenings when they share group, axis and factor; retainers on that verified rigid cluster provide axial stops. Plan installation explicitly: avoid trapping a closed bearing between integral oversized shoulders, use a removable retained handwheel/shoulder when needed, and keep insertion journals smaller than the female thread minor diameter. Report fastening requirements and installation order; sampled verification does not prove an assembly path. A screw thread alone is not a guide or axial bearing. Currently verified mechanisms support a stationary rotary screw driving a guided nonrotating slider; do not use combined screw motion for this mode. Unsupported mechanisms require clarification rather than a claim of functionality.'
      : 'Geometry concept mode: mechanics may be null. Such a result has no mechanical verification. If editing a mechanically verified assembly, preserve its complete mechanics contract.',
    'For each mechanical connection return id, kind (fixed/linear/rotary/thread), first, second, firstFeature, secondFeature, maxClearance (radial mm, <=1), minEngagement (axial mm), fastening (none/bonded/bolted/captured), fastenerDiameter. Feature IDs must match the separately generated steps: explicitly prescribe these IDs in component descriptions. For linear/rotary/thread the first feature is a positive shaft/thread, second is a cut bore/thread, fastening=none and fastenerDiameter=0. Bore origin for a hole is its entry face, extruding along NEGATIVE local Z; other cylinders/threads are centered. Compute GLOBAL mating axes from component position PLUS local feature position; never repeat a global offset in both. Use adequate radial wall material and engagement at every travel extremity.',
    'Fixed joints: fastening=bonded requires opposing planar surfaces sharing >=1 mm² contact (empty feature IDs), OR a positive smooth shaft and a cut receiving bore with matching feature IDs, radial material and sufficient engagement. Declare the adhesive assembly assumption. Bolted requires touching planar mounting surfaces plus matching linear patterns of at least two clearance holes, and positive fastenerDiameter with small clearance. List required screw sizes, counts and assembly assumptions; hardware strength and preload are not checked. Captured requires physical stops against translations in all directions and geometric antirotation; a round loose cavity or synchronized animation is insufficient. Return empty feature IDs for captured joints and fastenerDiameter=0 for bonded/captured. Two parts in a fixed joint must share identical rigid motion. Do not solve a collision by cutting away mounting faces, bearing walls, stops or engagement.',
    'For shaft/bore joints prefer separate feature IDs. A receiving linear pattern may share its ID across connections only when each individual shaft matches exactly one coaxial instance. Patterns on positive shafts, circular receiving patterns and multiple coaxial receiving instances are unsupported; use individual features. Engagement, material and clearance are still checked for each selected receiving instance.',
    'All primitives are centered on their local position. Compute placement from actual faces, including local offsets: a fixed cap outside a centered body of length L needs its center at +(L/2 + capThickness/2 + clearance) or the negative equivalent. Never place a cap center on the body face. Account for bores and every sampled motion position.',
    'Use motion.kind fixed for immobile bodies, slider for pure translation in mm, rotary for rotation in degrees, screw for translation coupled with rotation. The motion axis is global; screw pitch is mm per full revolution.',
    'For linked moving components, give the same nonempty group, minimum, maximum and value. Set factor on EVERY member: physical displacement (mm) or rotation (degrees) = value * factor. This permits a rotary shaft and translating carriage in one group. For a right-hand threaded shaft driving a nonrotating nut, shaft factor = -360/(pitch*starts) degrees per mm and nut/carriage factor = 1; reverse the rotation sign for left-hand threads. Keep mating thread diameter, pitch, profile, starts, handedness and phase consistent. Set value 0 when possible. A screw motion rotates AND translates its own body; use rotary for an axially stationary lead screw.',
    'Always include motion object. For fixed bodies set kind=fixed, axis=z, minimum=0, maximum=0, value=0, pitch=0, group empty, factor=1. For slider and rotary set pitch=0. For independent movement set group empty and factor=1.',
    'The geometry is a design concept; do not claim thread profiles, fits, strength or safety certification. If dimensions are absent, choose proportional millimeter values.',
    'Only ask for clarification if the requested object is unidentifiable or requirements conflict. Return concise component descriptions; do not emit CAD construction steps yet.',
    previous ? 'Edit the current assembly. Keep its partId and every component unrelated to the request. Return the COMPLETE component list. Set action=keep to reuse existing geometry; action=build only for new or modified geometry. You may still change position or motion with action=keep. Remove a component only if the user explicitly requests removal.' : 'Create a new assembly. Set action=build on every component.',
  ].join(' ')
  const userRequest = previous
    ? `Current assembly: ${JSON.stringify(previous)}\n\nRequested change: ${request}`
    : request
  const planMaxTokens = options?.requireMechanics || previous?.mechanics ? 9000 : 4500
  const key = JSON.stringify([userRequest, repairAttempt, options?.repairOnly ? 'repair-only' : 'plan', options?.requireMechanics ?? false,
    options?.noQuestions ?? false, options?.allowUnverifiedDrafts ?? false, options?.maxRepairAttempts ?? null,
    options?.prepareDesign ?? false, options?.reviewPlan ?? false])
  const store = checkpointStore(provider)
  let checkpoint = store.get(key)
  const resumed = !!checkpoint
  let plan: AssemblyPlan
  onProgress?.({ phase: options?.repairOnly ? 'checking-assembly' : 'planning',
    components: checkpoint?.plan.components ?? (options?.repairOnly ? previous!.components.map(({ id }) => ({ id, action: 'keep' as const })) : []),
    completed: checkpoint?.components.length ?? (options?.repairOnly ? previous!.components.length : 0),
    resumed: !!checkpoint, replanning: repairAttempt > 0 })
  if (checkpoint?.needsMechanicalPlan) {
    const available: CadAssemblySpec = { schemaVersion: '4.0', units: 'mm', partId: checkpoint.plan.partId,
      components: checkpoint.components }
    plan = parsePlan(await generateCadDecision(provider, [
      { role: 'system', content: instructions }, { role: 'user', content: userRequest },
      { role: 'user', content: `The available draft lacks the required mechanical connections. Complete the verified mechanics plan using these available bodies: ${JSON.stringify(available)}. Keep all unrelated geometry with action=keep; build only bodies whose geometry must change to make the assembly functional. Return the complete connected mechanics contract and preserve every component ID.` },
    ], schema, { temperature: 0, maxTokens: planMaxTokens }, options?.noQuestions), available, true, requestedCadComponentCount(request))
    const reusable = new Set(plan.components.filter((item) => item.action === 'keep').map((item) => item.id))
    previous = available
    checkpoint = { plan, components: available.components.filter((item) => reusable.has(item.id)),
      assumptions: [...checkpoint.assumptions, ...plan.assumptions],
      needsDesignReview: options?.reviewPlan,
      componentFailures: Object.fromEntries(Object.entries(checkpoint.componentFailures ?? {}).filter(([id]) => reusable.has(id))) }
    store.set(key, checkpoint)
  } else if (checkpoint) plan = checkpoint.plan
  else if (options?.repairOnly && previous) {
    plan = { decision: 'create', partId: previous.partId, question: '', assumptions: [], mechanics: previous.mechanics,
      components: previous.components.map((component) => ({ id: component.id, action: 'keep',
        description: 'Preserve existing geometry, placement and motion.', position: component.position,
        motion: component.motion ? { ...component.motion, pitch: component.motion.pitch ?? 0,
          group: component.motion.group ?? '' } : {
          kind: 'fixed', axis: 'z', minimum: 0, maximum: 0, value: 0, pitch: 0, group: '', factor: 1,
        } })) }
  }
  else {
    const rawPlan = await generateCadDecision(provider, [
      { role: 'system', content: instructions }, { role: 'user', content: userRequest },
    ], schema, { temperature: 0, maxTokens: planMaxTokens }, options?.noQuestions)
    try {
      plan = parsePlan(rawPlan, previous, options?.requireMechanics, requestedCadComponentCount(request), options?.allowUnverifiedDrafts)
    } catch (error) {
      const issue = error instanceof Error ? error.message : String(error)
      if (provider.generationPolicy?.retryInvalidStructuredOutput === false && !(options?.maxRepairAttempts && options.maxRepairAttempts > 0)) {
        throw new ProviderRequestError(`O cliente local devolveu um plano de conjunto inválido. Nenhuma retentativa automática foi feita. ${issue}`, { cause: error })
      }
      plan = parsePlan(await generateCadDecision(provider, [
        { role: 'system', content: instructions }, { role: 'user', content: userRequest },
        { role: 'user', content: `The component plan was invalid: ${issue}. Return the complete plan with valid IDs, one fixed body and 2–8 components.` },
      ], schema, { temperature: 0, maxTokens: planMaxTokens }, options?.noQuestions), previous, options?.requireMechanics, requestedCadComponentCount(request), options?.allowUnverifiedDrafts)
    }
  }
  if (plan.decision === 'clarify') return { kind: 'clarify', question: plan.question }
  if (options?.reviewPlan && !options.repairOnly && plan.components.length >= 3 && (!checkpoint || checkpoint.needsDesignReview)) {
    store.set(key, { plan, components: [...checkpoint?.components ?? []], assumptions: [...checkpoint?.assumptions ?? plan.assumptions], needsDesignReview: true })
    onProgress?.({ phase: 'reviewing-plan', components: plan.components, completed: checkpoint?.components.length ?? 0 })
    const reviewed = parsePlan(await generateCadDecision(provider, [
      { role: 'system', content: instructions }, { role: 'user', content: userRequest },
      { role: 'user', content: `Review this mechanical construction plan BEFORE any body is built: ${JSON.stringify(plan)}. Independently calculate local/global mating axes, opposing mounting faces, journal/bore intervals at both travel extremes, material remaining around cavities and screw-head recesses, guide spacing, threaded core dimensions and installation/head/tool access. Correct inconsistent inferred dimensions now. Keep this exact partId and exact component ID set; preserve explicitly requested dimensions/functions and existing unrelated geometry. Choose an order with reference stock before dependent interfaces. Return the COMPLETE corrected construction plan and no questions. ${plan.mechanics ? 'Preserve a complete mechanics contract with mechanically connected ground.' : 'Preserve geometry concept mode with mechanics=null; do not claim functional verification.'} Every description must state local feature locations and matched dimensions, including named connection features and any necessary head recess. A cosmetic finish is not a priority; do not add one unless requested or needed for installation.` },
    ], schema, { temperature: 0, maxTokens: planMaxTokens }, options?.noQuestions), previous, options?.requireMechanics, plan.components.length, options?.allowUnverifiedDrafts)
    if (reviewed.decision === 'clarify') return { kind: 'clarify', question: reviewed.question }
    if (reviewed.partId !== plan.partId || reviewed.components.some((item) => !plan.components.some((original) => item.id === original.id)) ||
        (!!reviewed.mechanics !== !!plan.mechanics))
      throw new ProviderRequestError('A revisão do planejamento alterou a identidade das peças. Nenhum corpo foi reconstruído; o plano foi conservado para retomada.')
    const reusable = [...checkpoint?.components ?? []].filter((body) => {
      const current = plan.components.find((item) => item.id === body.id)!
      const updated = reviewed.components.find((item) => item.id === body.id)!
      return updated.action === 'keep' && cadIdentity([current.position, current.motion]) === cadIdentity([updated.position, updated.motion])
    })
    plan = { ...reviewed, assumptions: [...plan.assumptions, ...reviewed.assumptions] }
    checkpoint = { plan, components: reusable, assumptions: [...checkpoint?.assumptions ?? plan.assumptions],
      componentFailures: checkpoint?.componentFailures }
    store.set(key, checkpoint)
  }
  if (previous && previous.components.some((old) => !plan.components.some((item) => item.id === old.id)) &&
      !request.split(/[\n.!?;]/).some((clause) => {
        const removal = /\b(?:remov\w*|exclu\w*|apag\w*|delet\w*|retir\w*)\b/i.exec(clause)
        return removal && !/\b(?:n[aã]o|sem|not|never|without|don['’]t)\b/i.test(clause.slice(0, removal.index))
      })) {
    throw new Error('A edição CAD removeu um componente sem solicitação explícita')
  }
  const components: CadAssemblySpec['components'][number][] = [...checkpoint?.components ??
    (options?.repairOnly ? previous!.components : [])]
  const assumptions = [...checkpoint?.assumptions ?? plan.assumptions]
  const failures = new Map(Object.entries(checkpoint?.componentFailures ?? {}))
  const publish = (available: readonly CadAssemblySpec['components'][number][], issue?: string, pendingComponentId?: string) => {
    const existing = new Map(previous?.components.filter((item) => plan.components.some((planned) => planned.id === item.id)).map((item) => [item.id, item]))
    for (const item of available) existing.set(item.id, item)
    if (!existing.size) return
    options?.onDraft?.({ request, issue, pendingComponentId, plannedComponentIds: plan.components.map((item) => item.id),
      spec: { schemaVersion: '4.0', units: 'mm', partId: plan.partId,
        components: plan.components.flatMap((item) => existing.has(item.id) ? [existing.get(item.id)!] : []),
        ...(plan.mechanics ? { mechanics: plan.mechanics } : {}) } })
  }
  const planned = plan.components.map(({ id, action }) => ({ id, action }))
  const emit = (phase: CadAssemblyProgress['phase'], extra: Partial<CadAssemblyProgress> = {}) =>
    onProgress?.({ phase, components: planned, completed: components.length - failures.size,
      completedComponentIds: components.filter((item) => !failures.has(item.id)).map((item) => item.id),
      failedComponentIds: [...failures.keys()],
      resumed, replanning: repairAttempt > 0, ...extra })
  store.set(key, { plan, components: [...components], assumptions: [...assumptions],
    componentFailures: Object.fromEntries(failures),
    ...(checkpoint?.clarification ? { clarification: checkpoint.clarification } : {}) })
  if (store.size > 4) store.delete(store.keys().next().value!)
  for (const component of plan.components.filter((item) => !components.some((available) => available.id === item.id) || failures.has(item.id))) {
    const componentIndex = plan.components.findIndex((item) => item.id === component.id)
    const movement = component.motion
    const componentMotion: CadMotion | undefined = movement.kind === 'fixed' ? undefined : {
      kind: movement.kind, axis: movement.axis, minimum: movement.minimum, maximum: movement.maximum,
      value: movement.value, ...(movement.kind === 'screw' ? { pitch: movement.pitch } : {}),
      ...(movement.group ? { group: movement.group } : {}),
      ...(movement.group && movement.factor !== undefined ? { factor: movement.factor } : {}),
    }
    emit('building', { componentIndex })
    const prior = (failures.has(component.id) ? components.find((item) => item.id === component.id) : undefined) ?? previous?.components.find((item) => item.id === component.id)
    let steps = prior?.steps
    if (component.action === 'build' || failures.has(component.id)) {
      const validatedComponents = components.filter((item) => item.id !== component.id && !failures.has(item.id))
      const builtContext = validatedComponents.map((item) => ({ id: item.id, position: item.position, motion: item.motion, steps: item.steps }))
      const joints = plan.mechanics?.connections.filter((joint) => joint.first === component.id || joint.second === component.id) ?? []
      const clarification = checkpoint?.clarification?.componentId === component.id ? checkpoint.clarification.question : undefined
      const matingTargets = matingContext({ id: component.id, position: component.position, steps: [], motion: componentMotion }, validatedComponents, joints)
      const partRequest = `Build ONLY component ${component.id} of this mechanical assembly. Overall request: ${request}. Component construction: ${component.description}. Mechanical connections (preserve exact required feature IDs, mounting faces, journals, engagement and retention): ${JSON.stringify(joints)}. Computed mating targets from validated components (centers are not hole entry points; convert center to entry with +axis*height/2): ${matingTargets}. Complete component placement plan: ${JSON.stringify(plan.components)}. Its motion is ${JSON.stringify(component.motion)}; placement applies after motion about the local origin. The component will be placed at global position ${JSON.stringify(component.position)} after construction, so use local coordinates near origin. Previously validated components with complete features and motion: ${JSON.stringify(builtContext)}. Match their dimensions and add real clearance where bodies mate throughout travel; no two components may occupy the same solid volume. A flat on a rotating body rotates away: stationary obstructions require clearance for the entire rotating envelope. It must be ONE connected solid. Do not construct any other component. Include bores and clearances named in its description. Infer unspecified ordinary dimensions.${clarification ? ` Earlier component clarification: ${clarification}. Re-evaluate this question against the original user constraints. Resolve conflicts between inferred design choices by adjusting this component to the actual completed mating geometry; list the decision in assumptions. Keep a question only for a remaining conflict in explicit user requirements or unsupported mechanics.` : ''}`
      let result: Awaited<ReturnType<typeof generateCadProgram>>
      let validationAttempt = 0
      const inspectComponent = async (candidate: CadProgramSpec): Promise<string | null> => {
        validationAttempt++
        emit('checking-component', { componentIndex, validationAttempt })
        const requiredFeatures = joints.map((joint) => joint.first === component.id ? joint.firstFeature : joint.secondFeature).filter(Boolean)
        const missing = requiredFeatures.filter((id) => !candidate.steps.some((step) => step.id === id))
        const issue = missing.length ? `Mechanical connection requires feature IDs: ${missing.join(', ')}. Preserve the plan's mating geometry and exact IDs.`
          : mechanicalFitIssue({ id: component.id, position: component.position, steps: candidate.steps,
            ...(componentMotion ? { motion: componentMotion } : {}) }, validatedComponents, joints) ?? await checkComponent(candidate)
        if (issue) emit('repairing-component', { componentIndex, validationAttempt })
        return issue
      }
      try {
        result = await generateCadProgram(provider, partRequest, prior ? {
          schemaVersion: '3.0', units: 'mm', partId: component.id, steps: prior.steps,
        } : undefined, inspectComponent, { maxOutputTokens: 6500, assemblyComponent: true, noQuestions: options?.noQuestions,
          maxRepairAttempts: options?.maxRepairAttempts,
          prepareDesign: options?.prepareDesign,
          localRepair: (candidate, issue, inspect) => issue.startsWith('Mechanical connection ')
            ? repairMechanicalFitLocally({ id: component.id, position: component.position, steps: candidate.steps, motion: componentMotion }, validatedComponents, joints, request, inspect) : Promise.resolve(null),
          onDraft: (candidate, issue) => publish([...components,
            { id: component.id, position: component.position, steps: candidate.steps, motion: componentMotion }], issue, component.id),
        })
        failures.delete(component.id)
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        if (error instanceof DOMException && error.name === 'AbortError') throw error
        if (options?.allowUnverifiedDrafts && error instanceof CadProgramValidationError) {
          failures.set(component.id, detail)
          result = { kind: 'create', spec: error.spec, assumptions: ['Geometria pendente de correção; conservada apenas como rascunho.'] }
        } else if (error instanceof ProviderRequestError) {
          throw new ProviderRequestError(`Componente ${component.id}: ${detail}`, { cause: error })
        } else if (repairAttempt === 0 && /CAD step [A-Za-z0-9_-]+/.test(detail)) {
          store.delete(key)
          return await generateCadAssembly(provider,
            `${request}\n\nA construção do componente ${component.id} falhou: ${detail}. Replaneje os corpos e a geometria de modo genérico. Corrija recursos repetidos que não acrescentam material, cortes que não atingem a peça e uniões desconectadas. Se um recurso for uma peça física independente, represente-o como outro componente e vincule seu movimento aos corpos correspondentes. Se ele for integral ao mesmo corpo, descreva uma conexão com material real e revise cortes anteriores que a impedem. Preserve todas as funções pedidas.`,
            checkComponent, checkAssembly, previous, onProgress, 1, options)
        } else { store.delete(key); throw new Error(`Componente ${component.id}: ${detail}`) }
      }
      if (result.kind === 'clarify') {
        store.set(key, { plan, components: [...components], assumptions: [...assumptions],
          clarification: { componentId: component.id, question: result.question } })
        return { kind: 'clarify', question: `${component.id}: ${result.question}` }
      }
      steps = result.spec.steps
      assumptions.push(...result.assumptions.map((item) => `${component.id}: ${item}`))
    }
    const completedComponent = { id: component.id, position: component.position, steps: steps!,
      ...(componentMotion ? { motion: componentMotion } : {}) }
    const existingIndex = components.findIndex((item) => item.id === component.id)
    if (existingIndex < 0) components.push(completedComponent)
    else components[existingIndex] = completedComponent
    store.set(key, { plan, components: [...components], assumptions: [...assumptions], componentFailures: Object.fromEntries(failures) })
    publish(components)
  }
  let spec: CadAssemblySpec = { schemaVersion: '4.0', units: 'mm', partId: plan.partId, components,
    ...(plan.mechanics ? { mechanics: plan.mechanics } : {}) }
  publish(spec.components)
  if (failures.size || (options?.requireMechanics && !spec.mechanics)) {
    emit('checking-assembly')
    if (options?.requireMechanics && !spec.mechanics) store.set(key, {
      plan, components: [...components], assumptions: [...assumptions],
      componentFailures: Object.fromEntries(failures), needsMechanicalPlan: true,
    })
    const issue = failures.size ? `Geometria disponível para exportação como rascunho. ${failures.size} componente(s) ainda precisam de correção: ${[...failures.keys()].join(', ')}. As demais peças foram conservadas; retome para reparar somente as pendentes.`
      : 'Geometria construída, mas o plano não declarou vínculos mecânicos. O rascunho pode ser exportado; a montagem não recebeu aprovação funcional.'
    publish(spec.components, issue)
    throw new CadDraftGenerationError(issue, { request, spec, issue, plannedComponentIds: plan.components.map((item) => item.id) })
  }
  let issue: CadAssemblyCheckResult = null
  try {
    validateCadAssembly(spec)
    emit('checking-assembly')
    issue = await checkAssembly?.(spec) ?? null
  } catch (error) {
    if (!(error instanceof ProviderRequestError) && !(error instanceof DOMException && error.name === 'AbortError')) store.delete(key)
    if (provider.generationPolicy && error instanceof ProviderRequestError) throw new CadAssemblyPausedError(error.message, spec, error)
    throw error
  }
  if (issue) {
    emit('repairing-assembly')
    if (checkAssembly && collisionTarget(spec, assemblyIssueMessage(issue)!)) {
      const repaired = await repairAssemblyLocally(spec, issue, [
        threadedFitStrategy,
        cylindricalFitStrategy,
        motionClearanceStrategy,
        { assumption: 'Componente axial curto reposicionado na face externa com 0,5 mm de folga.',
          propose: (candidate, message, _checkPart, assess) => seatAxialComponent(candidate, message, assess) },
        { assumption: 'Folga localizada aberta na região de interseção.',
          propose: (candidate, message, checkPart, assess) => clearLocalizedOverlap(candidate, message, checkPart, assess) },
      ], async (program) => { emit('repairing-assembly', { activity: 'checking-component' }); return await checkComponent(program) },
      async (candidate) => { emit('repairing-assembly', { activity: 'checking-assembly' }); return await checkAssembly(candidate) },
      (validationAttempt) => emit('repairing-assembly', { validationAttempt }), options?.repairLimits,
      (progress) => { store.set(key, { plan, components: [...progress.spec.components],
        assumptions: [...assumptions, ...new Set(progress.assumptions)] }); publish(progress.spec.components) }).catch((error: unknown) => {
        if (provider.generationPolicy && error instanceof ProviderRequestError) {
          const completed = store.get(key)?.components ?? spec.components
          throw new CadAssemblyPausedError(error.message, { ...spec, components: completed }, error)
        }
        throw error
      })
      spec = repaired.spec
      issue = repaired.issue
      publish(spec.components, issue ? assemblyIssueMessage(issue) ?? undefined : undefined)
      assumptions.push(...new Set(repaired.assumptions))
      store.set(key, { plan, components: [...spec.components], assumptions: [...assumptions] })
      if (!issue) {
        store.delete(key)
        emit('complete')
        return { kind: 'create', spec, assumptions }
      }
      if (repairAttempt === 0) {
        try {
          const corrected = await repairAssemblyCollision(provider, request, spec, issue, checkComponent,
            checkAssembly, (activity) => emit('repairing-assembly', { activity }), options?.noQuestions,
            options?.maxRepairAttempts, publish)
          if (corrected?.kind === 'progress') {
            spec = corrected.spec
            issue = corrected.issue
            publish(spec.components, issue ? assemblyIssueMessage(issue) ?? undefined : undefined)
            assumptions.push(...corrected.assumptions)
            store.set(key, { plan, components: [...spec.components], assumptions: [...assumptions] })
            if (!issue) { store.delete(key); emit('complete'); return { kind: 'create', spec, assumptions } }
          } else if (corrected) { store.delete(key); emit('complete'); return { ...corrected,
            ...(corrected.kind === 'create' ? { assumptions: [...assumptions, ...corrected.assumptions] } : {}) } }
        } catch (error) {
          if (provider.generationPolicy && error instanceof ProviderRequestError) throw new CadAssemblyPausedError(error.message, spec, error)
          if (error instanceof ProviderRequestError || (error instanceof DOMException && error.name === 'AbortError')) throw error
        }
      }
    }
    const mechanicalFailure = typeof issue !== 'string' && !!issue?.mechanicalIssues?.length
    if (provider.generationPolicy && (!options?.noQuestions || options.repairOnly)) throw new CadAssemblyPausedError(`O conjunto ainda não passou na validação. Componentes e correções locais foram conservados nesta aba; nenhum replanejamento automático foi solicitado. ${mechanicalFailure ? 'Use Corrigir montagem com IA para tratar os vínculos pendentes, reutilizando as peças disponíveis.' : 'Retome o mesmo pedido para tratar a interferência pendente.'} ${assemblyIssueMessage(issue)}`, spec)
    if (options?.repairOnly) throw new CadAssemblyValidationError(`O conjunto ainda contém ${mechanicalFailure ? 'falhas de montagem' : 'interferências'}. A correção conservou os componentes disponíveis, sem replanejar o conjunto. ${assemblyIssueMessage(issue)}`, spec)
    if (repairAttempt === 0) {
      try {
        const revised = await generateCadAssembly(provider,
          `${request}\n\nO conjunto inicial falhou na validação geométrica/mecânica: ${assemblyIssueMessage(issue)}. Corrija somente os componentes, vínculos, apoios, posições, folgas ou limites de movimento necessários. Preserve a finalidade e todos os detalhes pedidos pelo usuário.`,
          checkComponent, checkAssembly, spec, onProgress, 1, options)
        store.delete(key)
        return revised
      } catch (error) {
        if (error instanceof ProviderRequestError && provider.generationPolicy) throw new CadAssemblyPausedError(error.message, spec, error)
        if (error instanceof ProviderRequestError || (error instanceof DOMException && error.name === 'AbortError')) throw error
        const last = error instanceof Error ? error.message : String(error)
        throw new CadAssemblyValidationError(`O conjunto CAD ainda falha na validação: ${last}`,
          error instanceof CadAssemblyValidationError ? error.spec : spec)
      }
    }
    throw new CadAssemblyValidationError(`O conjunto CAD foi gerado, mas falhou na validação: ${assemblyIssueMessage(issue)}`, spec)
  }
  store.delete(key)
  emit('complete')
  return { kind: 'create', spec, assumptions }
}
