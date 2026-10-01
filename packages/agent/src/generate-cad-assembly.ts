import { type CadAssemblySpec, type CadMotion, validateCadAssembly } from '../../domain/ts/src/cad-assembly.ts'
import type { CadProgramSpec } from '../../domain/ts/src/cad-program.ts'
import { generateCadProgram } from './generate-cad-program.ts'
import { ProviderRequestError, type LLMProvider } from './provider.ts'

const vector = { type: 'object', additionalProperties: false, required: ['x', 'y', 'z'], properties: {
  x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' },
} }
const motion = { type: 'object', additionalProperties: false,
  required: ['kind', 'axis', 'minimum', 'maximum', 'value', 'pitch', 'group'],
  properties: {
    kind: { enum: ['fixed', 'slider', 'screw', 'rotary'] }, axis: { enum: ['x', 'y', 'z'] },
    minimum: { type: 'number' }, maximum: { type: 'number' }, value: { type: 'number' },
    pitch: { type: 'number' }, group: { type: 'string' },
  },
}
const schema = { type: 'object', additionalProperties: false,
  required: ['decision', 'partId', 'question', 'assumptions', 'components'],
  properties: {
    decision: { enum: ['create', 'clarify'] }, partId: { type: 'string' }, question: { type: 'string' },
    assumptions: { type: 'array', items: { type: 'string' } },
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
  motion: { kind: 'fixed' | 'slider' | 'screw' | 'rotary'; axis: 'x' | 'y' | 'z'; minimum: number; maximum: number; value: number; pitch: number; group: string }
}
interface AssemblyPlan {
  decision: 'create' | 'clarify'
  partId: string
  question: string
  assumptions: string[]
  components: PlannedComponent[]
}

interface AssemblyCheckpoint {
  readonly plan: AssemblyPlan
  readonly components: CadAssemblySpec['components'][number][]
  readonly assumptions: string[]
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

export interface CadAssemblyProgress {
  readonly phase: 'classifying' | 'planning' | 'building' | 'checking-component' | 'repairing-component' |
    'checking-assembly' | 'repairing-assembly' | 'complete'
  readonly components: readonly { readonly id: string; readonly action: 'keep' | 'build' }[]
  readonly completed: number
  readonly componentIndex?: number
  readonly validationAttempt?: number
  readonly resumed?: boolean
  readonly replanning?: boolean
}

export type CadAssemblyProgressListener = (progress: CadAssemblyProgress) => void

function parsePlan(raw: unknown, previous?: CadAssemblySpec): AssemblyPlan {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Plano de conjunto CAD inválido')
  const plan = raw as AssemblyPlan
  if (plan.decision === 'clarify' && typeof plan.question === 'string' && plan.question.trim()) return plan
  if (plan.decision !== 'create' || !/^[A-Za-z0-9_-]{1,64}$/.test(plan.partId) ||
    (previous && plan.partId !== previous.partId) ||
    !Array.isArray(plan.components) || plan.components.length < 2 || plan.components.length > 8 ||
    !Array.isArray(plan.assumptions)) throw new Error('Plano de conjunto CAD inválido')
  const ids = new Set<string>()
  let fixed = 0
  for (const component of plan.components) {
    if (!component || !/^[A-Za-z0-9_-]{1,64}$/.test(component.id) || ids.has(component.id) ||
      !['keep', 'build'].includes(component.action) ||
      (component.action === 'keep' && !previous?.components.some((old) => old.id === component.id)) ||
      typeof component.description !== 'string' || !component.description.trim() ||
      !component.position || !['x', 'y', 'z'].every((axis) => Number.isFinite(component.position[axis as 'x' | 'y' | 'z'])) ||
      !component.motion || !['fixed', 'slider', 'screw', 'rotary'].includes(component.motion.kind)) throw new Error('Componente CAD inválido')
    ids.add(component.id)
    if (component.motion.kind === 'fixed') fixed++
    else {
      const movement = component.motion
      if (!['x', 'y', 'z'].includes(movement.axis) || ![movement.minimum, movement.maximum, movement.value].every(Number.isFinite) ||
        movement.minimum >= movement.maximum || movement.value < movement.minimum || movement.value > movement.maximum ||
        (movement.kind === 'screw' && !(movement.pitch > 0))) throw new Error(`Movimento inválido: ${component.id}`)
    }
  }
  if (!fixed) throw new Error('O conjunto precisa de uma peça fixa')
  return plan
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

async function clearContainedCylinder(
  spec: CadAssemblySpec, issue: string,
  checkComponent: (spec: CadProgramSpec) => Promise<string | null>,
  checkAssembly: (spec: CadAssemblySpec) => Promise<string | null>,
): Promise<CadAssemblySpec | null> {
  const pair = /^CAD components ([A-Za-z0-9_-]+) and ([A-Za-z0-9_-]+) intersect at /.exec(issue)
  const fractions = /overlap fractions: [A-Za-z0-9_-]+=([\d.]+), [A-Za-z0-9_-]+=([\d.]+)/.exec(issue)
  const targetId = collisionTarget(spec, issue)
  if (!pair || !fractions || !targetId) return null
  const targetIndex = targetId === pair[1] ? 1 : 2
  const enclosedIndex = targetIndex === 1 ? 2 : 1
  if (Number(fractions[enclosedIndex]) < 0.8 ||
      Number(fractions[targetIndex]) >= Number(fractions[enclosedIndex])) return null
  const housing = spec.components.find((item) => item.id === pair[targetIndex])
  const enclosed = spec.components.find((item) => item.id === pair[enclosedIndex])
  const base = housing?.steps[0]
  const core = enclosed?.steps[0]
  if (!housing || !enclosed || housing.motion || enclosed.motion ||
      !base || !core || (base.shape !== 'box' && base.shape !== 'cylinder') ||
      core.shape !== 'cylinder' || core.pattern ||
      Object.values(base.rotation).some(Boolean) || Object.values(core.rotation).some(Boolean) ||
      housing.steps.length >= 32) return null

  const clearance = 1 // millimeters on each radial side
  const openingId = 'assembly_clearance'
  if (housing.steps.some((step) => step.id === openingId)) return null
  const tool = {
    id: openingId, op: 'cut' as const, shape: 'cylinder' as const,
    position: {
      x: enclosed.position.x + core.position.x - housing.position.x,
      y: enclosed.position.y + core.position.y - housing.position.y,
      z: base.position.z,
    },
    rotation: core.rotation,
    diameter: core.diameter + 2 * clearance,
    height: base.height + 2 * clearance,
  }
  const revised = { ...spec, components: spec.components.map((item) => item.id === housing.id
    ? { ...item, steps: [...item.steps, tool] } : item) }
  try {
    validateCadAssembly(revised)
    const component: CadProgramSpec = { schemaVersion: '3.0', units: 'mm', partId: housing.id,
      steps: revised.components.find((item) => item.id === housing.id)!.steps }
    if (await checkComponent(component) || await checkAssembly(revised)) return null
    return revised
  } catch {
    return null
  }
}

async function enlargeExistingClearance(
  spec: CadAssemblySpec, issue: string,
  checkComponent: (spec: CadProgramSpec) => Promise<string | null>,
  checkAssembly: (spec: CadAssemblySpec) => Promise<string | null>,
  onAttempt?: () => void,
): Promise<CadAssemblySpec | null> {
  const pair = /^CAD components ([A-Za-z0-9_-]+) and ([A-Za-z0-9_-]+) intersect at /.exec(issue)
  if (!pair) return null
  const candidates = spec.components
    .filter((component) => component.id === pair[1] || component.id === pair[2])
    .flatMap((component) => component.steps.flatMap((step, index) =>
      step.op === 'cut' && step.shape === 'cylinder' && !step.pattern
        ? [{ component, step, index }] : []))
    .sort((left, right) => right.step.diameter - left.step.diameter)
    .slice(0, 2)
  for (const { component, step, index } of candidates) {
    // A small change to an existing bore is preferable to moving or deleting a body.
    // The real CAD validators decide whether it preserves a connected part and clears all poses.
    const limit = Math.min(10, step.diameter * 0.15)
    for (const increase of [2, 4, 6, 10]) {
      if (increase > limit) continue
      onAttempt?.()
      const steps = component.steps.map((item, itemIndex) => itemIndex === index
        ? { ...step, diameter: step.diameter + increase } : item)
      const revised: CadAssemblySpec = { ...spec, components: spec.components.map((item) =>
        item.id === component.id ? { ...item, steps } : item) }
      try {
        validateCadAssembly(revised)
      } catch {
        continue
      }
      const program: CadProgramSpec = { schemaVersion: '3.0', units: 'mm', partId: component.id, steps }
      if (await checkComponent(program)) continue
      if (!await checkAssembly(revised)) return revised
    }
  }
  return null
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
  provider: LLMProvider, request: string, spec: CadAssemblySpec, issue: string,
  checkComponent: (spec: CadProgramSpec) => Promise<string | null>,
  checkAssembly: (spec: CadAssemblySpec) => Promise<string | null>,
): Promise<CadAssemblyOutcome | null> {
  const targetId = collisionTarget(spec, issue)
  if (!targetId) return null
  const target = spec.components.find((component) => component.id === targetId)!
  const current: CadProgramSpec = { schemaVersion: '3.0', units: 'mm', partId: target.id, steps: target.steps }
  const replace = (program: CadProgramSpec): CadAssemblySpec => ({ ...spec,
    components: spec.components.map((component) => component.id === targetId
      ? { ...component, steps: program.steps } : component),
  })
  const inspect = async (program: CadProgramSpec): Promise<string | null> =>
    await checkComponent(program) ?? await checkAssembly(replace(program))
  const correction = [
    `Original request: ${request}`,
    `Complete mechanical assembly: ${JSON.stringify(spec)}`,
    `Assembly collision: ${issue}`,
    `Edit ONLY component ${targetId} to eliminate the solid-volume interference while keeping the intended physical arrangement and all unrelated components.`,
    'When a stationary body surrounds another, add or enlarge a real cavity or bore with a small positive clearance; do not simply translate an internal component outside the mechanism.',
    'Preserve the external mounting geometry, component identity and one connected solid. Infer a sensible ordinary clearance when none was specified. Return the complete corrected CAD program.',
  ].join('\n\n')
  const outcome = await generateCadProgram(provider, correction, current, inspect, { maxOutputTokens: 3500 })
  if (outcome.kind === 'clarify') return { kind: 'clarify', question: `${targetId}: ${outcome.question}` }
  const revised = replace(outcome.spec)
  validateCadAssembly(revised)
  const remaining = await checkAssembly(revised)
  if (remaining) throw new Error(remaining)
  return { kind: 'create', spec: revised,
    assumptions: [...outcome.assumptions.map((item) => `${targetId}: ${item}`),
      `Folga entre componentes corrigida em ${targetId} e validada no conjunto.`] }
}

export async function generateCadAssembly(
  provider: LLMProvider, request: string,
  checkComponent: (spec: CadProgramSpec) => Promise<string | null>,
  checkAssembly?: (spec: CadAssemblySpec) => Promise<string | null>,
  previous?: CadAssemblySpec,
  onProgress?: CadAssemblyProgressListener,
  repairAttempt = 0,
): Promise<CadAssemblyOutcome> {
  if (!request.trim()) throw new Error('Descreva o conjunto CAD')
  const instructions = [
    'Plan a real mechanical CAD assembly in millimeters. A recognizable object needs no routine dimensions from the user: infer useful values and list assumptions.',
    'Decompose it into 2–8 physically separate, individually connected solid components. Never fuse parts that must move relative to each other.',
    'Give each component a detailed local-geometry description, with dimensions, holes, clearances and its intended absolute position. Its construction steps will be generated separately; local coordinates should be centered near the component origin.',
    'Define consistent mating envelopes across components. A housing around another body needs a real cavity or bore larger than the enclosed body. Stationary components may touch at interfaces but must not occupy the same solid volume; moving components need clearance throughout travel.',
    'Use motion.kind fixed for immobile bodies, slider for pure translation in mm, rotary for rotation in degrees, screw for translation coupled with rotation. The motion axis is global; screw pitch is mm per full revolution.',
    'For linked moving components, give the same nonempty group, minimum, maximum and value. Their control then moves them together. Set value 0 when possible.',
    'Always include motion object. For fixed bodies set kind=fixed, axis=z, minimum=0, maximum=0, value=0, pitch=0, group empty. For slider and rotary set pitch=0. For independent movement set group empty.',
    'The geometry is a design concept; do not claim thread profiles, fits, strength or safety certification. If dimensions are absent, choose proportional millimeter values.',
    'Only ask for clarification if the requested object is unidentifiable or requirements conflict. Return concise component descriptions; do not emit CAD construction steps yet.',
    previous ? 'Edit the current assembly. Keep its partId and every component unrelated to the request. Return the COMPLETE component list. Set action=keep to reuse existing geometry; action=build only for new or modified geometry. You may still change position or motion with action=keep. Remove a component only if the user explicitly requests removal.' : 'Create a new assembly. Set action=build on every component.',
  ].join(' ')
  const userRequest = previous
    ? `Current assembly: ${JSON.stringify(previous)}\n\nRequested change: ${request}`
    : request
  const key = JSON.stringify([userRequest, repairAttempt])
  const store = checkpointStore(provider)
  const checkpoint = store.get(key)
  let plan: AssemblyPlan
  onProgress?.({ phase: 'planning', components: checkpoint?.plan.components ?? [],
    completed: checkpoint?.components.length ?? 0, resumed: !!checkpoint, replanning: repairAttempt > 0 })
  if (checkpoint) plan = checkpoint.plan
  else {
    const rawPlan = await provider.generateStructured<unknown>([
      { role: 'system', content: instructions }, { role: 'user', content: userRequest },
    ], schema, { temperature: 0, maxTokens: 3000 })
    try {
      plan = parsePlan(rawPlan, previous)
    } catch (error) {
      const issue = error instanceof Error ? error.message : String(error)
      plan = parsePlan(await provider.generateStructured<unknown>([
        { role: 'system', content: instructions }, { role: 'user', content: userRequest },
        { role: 'user', content: `The component plan was invalid: ${issue}. Return the complete plan with valid IDs, one fixed body and 2–8 components.` },
      ], schema, { temperature: 0, maxTokens: 3000 }), previous)
    }
  }
  if (plan.decision === 'clarify') return { kind: 'clarify', question: plan.question }
  if (previous && previous.components.some((old) => !plan.components.some((item) => item.id === old.id)) &&
      !/\b(?:remov\w*|exclu\w*|apag\w*|delet\w*|retir\w*|delete|remove)\b/i.test(request)) {
    throw new Error('A edição CAD removeu um componente sem solicitação explícita')
  }
  const components: CadAssemblySpec['components'][number][] = [...checkpoint?.components ?? []]
  const assumptions = [...checkpoint?.assumptions ?? plan.assumptions]
  const planned = plan.components.map(({ id, action }) => ({ id, action }))
  const emit = (phase: CadAssemblyProgress['phase'], extra: Partial<CadAssemblyProgress> = {}) =>
    onProgress?.({ phase, components: planned, completed: components.length,
      resumed: !!checkpoint, replanning: repairAttempt > 0, ...extra })
  store.set(key, { plan, components: [...components], assumptions: [...assumptions] })
  if (store.size > 4) store.delete(store.keys().next().value!)
  for (const component of plan.components.slice(components.length)) {
    const componentIndex = components.length
    emit('building', { componentIndex })
    const prior = previous?.components.find((item) => item.id === component.id)
    let steps = prior?.steps
    if (component.action === 'build') {
      const builtContext = components.map((item) => ({ id: item.id, position: item.position,
        base: item.steps[0], cuts: item.steps.filter((step) => step.op === 'cut') }))
      const partRequest = `Build ONLY component ${component.id} of this mechanical assembly. Overall request: ${request}. Component construction: ${component.description}. The component will be placed at global position ${JSON.stringify(component.position)} after construction, so use local coordinates near origin. Previously validated components and their main envelopes: ${JSON.stringify(builtContext)}. Match their dimensions and add real clearance where bodies mate; no two components may occupy the same solid volume. It must be ONE connected solid. Do not construct any other component. Include bores and clearances named in its description. Infer unspecified ordinary dimensions.`
      let result: Awaited<ReturnType<typeof generateCadProgram>>
      let validationAttempt = 0
      const inspectComponent = async (candidate: CadProgramSpec): Promise<string | null> => {
        validationAttempt++
        emit('checking-component', { componentIndex, validationAttempt })
        const issue = await checkComponent(candidate)
        if (issue) emit('repairing-component', { componentIndex, validationAttempt })
        return issue
      }
      try {
        result = await generateCadProgram(provider, partRequest, prior ? {
          schemaVersion: '3.0', units: 'mm', partId: component.id, steps: prior.steps,
        } : undefined, inspectComponent, { maxOutputTokens: 3500 })
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        if (error instanceof ProviderRequestError) {
          throw new ProviderRequestError(`Componente ${component.id}: ${detail}`, { cause: error })
        }
        store.delete(key)
        if (repairAttempt === 0 && /CAD step [A-Za-z0-9_-]+/.test(detail)) {
          return await generateCadAssembly(provider,
            `${request}\n\nA construção do componente ${component.id} falhou: ${detail}. Replaneje os corpos e a geometria de modo genérico. Corrija recursos repetidos que não acrescentam material, cortes que não atingem a peça e uniões desconectadas. Se um recurso for uma peça física independente, represente-o como outro componente e vincule seu movimento aos corpos correspondentes. Se ele for integral ao mesmo corpo, descreva uma conexão com material real e revise cortes anteriores que a impedem. Preserve todas as funções pedidas.`,
            checkComponent, checkAssembly, previous, onProgress, 1)
        }
        throw new Error(`Componente ${component.id}: ${detail}`)
      }
      if (result.kind === 'clarify') { store.delete(key); return { kind: 'clarify', question: `${component.id}: ${result.question}` } }
      steps = result.spec.steps
      assumptions.push(...result.assumptions.map((item) => `${component.id}: ${item}`))
    }
    const movement = component.motion
    const componentMotion: CadMotion | undefined = movement.kind === 'fixed' ? undefined : {
      kind: movement.kind, axis: movement.axis, minimum: movement.minimum, maximum: movement.maximum,
      value: movement.value, ...(movement.kind === 'screw' ? { pitch: movement.pitch } : {}),
      ...(movement.group ? { group: movement.group } : {}),
    }
    components.push({ id: component.id, position: component.position, steps: steps!,
      ...(componentMotion ? { motion: componentMotion } : {}) })
    store.set(key, { plan, components: [...components], assumptions: [...assumptions] })
  }
  const spec: CadAssemblySpec = { schemaVersion: '4.0', units: 'mm', partId: plan.partId, components }
  let issue: string | null | undefined
  try {
    validateCadAssembly(spec)
    emit('checking-assembly')
    issue = await checkAssembly?.(spec)
  } catch (error) {
    store.delete(key)
    throw error
  }
  if (issue) {
    emit('repairing-assembly')
    if (checkAssembly && collisionTarget(spec, issue)) {
      let validationAttempt = 0
      const showAttempt = () => emit('repairing-assembly', { validationAttempt: ++validationAttempt })
      const cleared = await clearContainedCylinder(spec, issue, checkComponent, checkAssembly)
      if (cleared) {
        store.delete(key)
        emit('complete')
        return { kind: 'create', spec: cleared, assumptions: [...assumptions,
          'Folga radial de 1 mm aberta na peça envolvente e validada no conjunto.'] }
      }
      const seated = await seatAxialComponent(spec, issue, checkAssembly, showAttempt)
      if (seated) {
        store.delete(key)
        emit('complete')
        return { kind: 'create', spec: seated, assumptions: [...assumptions,
          'Um componente axial curto foi reposicionado na face externa com 0,5 mm de folga e validado no conjunto.'] }
      }
      const enlarged = await enlargeExistingClearance(spec, issue, checkComponent, checkAssembly, showAttempt)
      if (enlarged) {
        store.delete(key)
        emit('complete')
        return { kind: 'create', spec: enlarged, assumptions: [...assumptions,
          'Uma cavidade existente foi ampliada e validada em todas as posições do conjunto.'] }
      }
      const relieved = await clearLocalizedOverlap(spec, issue, checkComponent, checkAssembly, showAttempt)
      if (relieved) {
        store.delete(key)
        emit('complete')
        return { kind: 'create', spec: relieved, assumptions: [...assumptions,
          'Uma folga localizada foi aberta na região de interseção e validada nas posições amostradas.'] }
      }
      if (repairAttempt === 0) {
        try {
          const corrected = await repairAssemblyCollision(provider, request, spec, issue, checkComponent, checkAssembly)
          if (corrected) { store.delete(key); emit('complete'); return { ...corrected,
            ...(corrected.kind === 'create' ? { assumptions: [...assumptions, ...corrected.assumptions] } : {}) } }
        } catch (error) {
          if (error instanceof ProviderRequestError) throw error
        }
      }
    }
    if (repairAttempt === 0) {
      try {
        const revised = await generateCadAssembly(provider,
          `${request}\n\nO conjunto inicial falhou na validação geométrica: ${issue}. Corrija somente os componentes, folgas ou limites de movimento necessários. Preserve a finalidade e todos os detalhes pedidos pelo usuário.`,
          checkComponent, checkAssembly, spec, onProgress, 1)
        store.delete(key)
        return revised
      } catch (error) {
        if (error instanceof ProviderRequestError) throw error
        const last = error instanceof Error ? error.message : String(error)
        throw new CadAssemblyValidationError(`O conjunto CAD ainda falha na validação: ${last}`,
          error instanceof CadAssemblyValidationError ? error.spec : spec)
      }
    }
    throw new CadAssemblyValidationError(`O conjunto CAD foi gerado, mas falhou na validação: ${issue}`, spec)
  }
  store.delete(key)
  emit('complete')
  return { kind: 'create', spec, assumptions }
}
