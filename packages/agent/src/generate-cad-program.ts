import { Ajv2020 } from 'ajv/dist/2020.js'
import programSchema from '../../domain/schemas/cad-program.v3.schema.json' with { type: 'json' }
import { type CadProgramSpec, type CadProgramStep, validateCadProgram } from '../../domain/ts/src/cad-program.ts'
import { ProviderRequestError, type AgentMessage, type LLMProvider } from './provider.ts'

const strictSpecSchema = Object.fromEntries(Object.entries(programSchema).filter(([key]) => !['$schema', '$id', 'title', '$defs'].includes(key)))
const strictOutputSchema = {
  $defs: programSchema.$defs,
  type: 'object', additionalProperties: false,
  required: ['decision', 'spec', 'question', 'assumptions'],
  properties: {
    decision: { enum: ['create', 'clarify'] },
    spec: { anyOf: [strictSpecSchema, { type: 'null' }] },
    question: { type: 'string', maxLength: 240 },
    assumptions: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 180 } },
  },
}
const validateOutput = new Ajv2020().compile(strictOutputSchema)

const diagnostics = new Ajv2020()
const defs = programSchema.$defs
const shapeValidators: Readonly<Record<string, ReturnType<typeof diagnostics.compile>>> = Object.fromEntries(
  Object.entries({ box: 'box', cylinder: 'cylinder', sphere: 'sphere', cone: 'cone', polygon_prism: 'polygon', revolve_profile: 'revolve' })
    .map(([shape, def]) => [shape, diagnostics.compile({ $defs: defs, $ref: `#/$defs/${def}` })]))
const patternValidators = {
  circular: diagnostics.compile({ $defs: defs, ...defs.pattern.oneOf[0] }),
  linear: diagnostics.compile({ $defs: defs, ...defs.pattern.oneOf[1] }),
}

// Gemini's OpenAI compatibility layer rejects deeply nested construction
// unions. This smaller schema guides generation; strictOutputSchema and the
// domain/API validators still enforce the full discriminated shape contract.
const vectorHint = {
  type: 'object', additionalProperties: false, required: ['x', 'y', 'z'],
  properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
}
const stepHint = {
  type: 'object', additionalProperties: false,
  // A flat required list is accepted by Gemini; the strict parser removes
  // this hint field from spheres, whose geometry has no axial height.
  required: ['id', 'op', 'shape', 'position', 'rotation', 'height'],
  properties: {
    id: { type: 'string' }, op: { enum: ['base', 'union', 'cut'] },
    shape: { enum: ['box', 'cylinder', 'sphere', 'cone', 'polygon_prism', 'revolve_profile'] },
    position: vectorHint, rotation: vectorHint,
    width: { type: 'number' }, depth: { type: 'number' }, height: { type: 'number' },
    diameter: { type: 'number' }, bottomDiameter: { type: 'number' }, topDiameter: { type: 'number' },
    points: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['x', 'y'],
      properties: { x: { type: 'number' }, y: { type: 'number' } } } },
    pattern: { type: 'object', additionalProperties: false, required: ['kind', 'count'],
      properties: { kind: { enum: ['circular', 'linear'] }, count: { type: 'integer' },
        axis: { enum: ['x', 'y', 'z'] }, center: vectorHint, sweepAngle: { type: 'number' }, offset: vectorHint } },
  },
}
const generationSchema = {
  type: 'object', additionalProperties: false,
  required: ['decision', 'spec', 'question', 'assumptions'],
  properties: {
    decision: { enum: ['create', 'clarify'] },
    spec: { anyOf: [{ type: 'object', additionalProperties: false,
      required: ['schemaVersion', 'units', 'partId', 'steps'],
      properties: { schemaVersion: { enum: ['3.0'] }, units: { enum: ['mm'] },
        partId: { type: 'string' }, steps: { type: 'array', items: stepHint } },
    }, { type: 'null' }] },
    question: { type: 'string' },
    assumptions: { type: 'array', items: { type: 'string' } },
  },
}

export type CadProgramOutcome =
  | { readonly kind: 'create'; readonly spec: CadProgramSpec; readonly assumptions: readonly string[] }
  | { readonly kind: 'clarify'; readonly question: string }

const axes = ['x', 'y', 'z'] as const
type Axis = typeof axes[number]
type SolidBounds = Record<Axis, { min: number; max: number }>

const shapeFields: Readonly<Record<string, readonly string[]>> = {
  box: ['width', 'depth', 'height'],
  cylinder: ['diameter', 'height'],
  sphere: ['diameter'],
  cone: ['bottomDiameter', 'topDiameter', 'height'],
  polygon_prism: ['points', 'height'],
  revolve_profile: ['points'],
}
const allShapeFields = new Set(Object.values(shapeFields).flat())
const patternFields = { circular: ['count', 'axis', 'center', 'sweepAngle'], linear: ['count', 'offset'] } as const

function numeric(value: unknown): unknown {
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : value
}

function normalizeVector(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
  const vector = value as Record<string, unknown>
  return Object.fromEntries(['x', 'y', 'z'].map((axis) => [axis, vector[axis] == null ? 0 : numeric(vector[axis])]))
}

function normalizePoint(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
  const point = value as Record<string, unknown>
  return { x: numeric(point.x), y: numeric(point.y) }
}

function normalizePattern(value: Record<string, unknown>): Record<string, unknown> {
  const declared = typeof value.kind === 'string' ? value.kind.trim().toLowerCase() : ''
  const kind = declared === 'circular' || declared === 'linear' ? declared : value.offset != null ? 'linear' : 'circular'
  const pattern: Record<string, unknown> = { kind }
  for (const field of patternFields[kind]) {
    const raw = value[field]
    if (raw == null) continue
    pattern[field] = field === 'center' || field === 'offset' ? normalizeVector(raw)
      : field === 'axis' && typeof raw === 'string' ? raw.trim().toLowerCase()
      : numeric(raw)
  }
  return pattern
}

function normalizeGeneratedResponse(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw
  const output = raw as Record<string, unknown>
  if (typeof output.spec !== 'object' || output.spec === null || Array.isArray(output.spec)) return raw
  const spec = output.spec as Record<string, unknown>
  if (!Array.isArray(spec.steps)) return raw
  const steps = spec.steps.map((candidate: unknown) => {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) return candidate
    const step = candidate as Record<string, unknown>
    const dimensions = shapeFields[String(step.shape)]
    if (!dimensions) return candidate
    const normalized = Object.fromEntries(Object.entries(step)
      .filter(([field, value]) => (field !== 'pattern' || value != null) && (!allShapeFields.has(field) || dimensions.includes(field)))
      .map(([field, value]) => [field,
        field === 'position' || field === 'rotation' ? normalizeVector(value)
          : field === 'points' && Array.isArray(value) ? value.map(normalizePoint)
          : allShapeFields.has(field) ? numeric(value)
          : value]))
    const pattern = step.pattern
    if (typeof pattern === 'object' && pattern !== null && !Array.isArray(pattern)) {
      const repeated = normalizePattern(pattern as Record<string, unknown>)
      if (repeated.count === 0 || repeated.count === 1) delete normalized.pattern
      else normalized.pattern = repeated
    }
    return normalized
  })
  return {
    ...output,
    ...(output.decision === 'create' && output.question == null ? { question: '' } : {}),
    ...(output.assumptions == null ? { assumptions: [] } : {}),
    spec: { ...spec, steps },
  }
}

function describeError(error: { instancePath: string; message?: string; params: Record<string, unknown> }): string {
  const extra = error.params.additionalProperty
  return `${error.instancePath || '/'} ${error.message ?? 'is invalid'}${typeof extra === 'string' ? ` (${extra})` : ''}`
}

function validationIssue(candidate: unknown): string {
  if (typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)) {
    const spec = (candidate as Record<string, unknown>).spec
    if (typeof spec === 'object' && spec !== null && !Array.isArray(spec)) {
      const steps = (spec as Record<string, unknown>).steps
      if (Array.isArray(steps)) for (const [index, rawStep] of steps.entries()) {
        if (typeof rawStep !== 'object' || rawStep === null || Array.isArray(rawStep)) return `etapa ${index + 1} deve ser um objeto`
        const step = rawStep as Record<string, unknown>
        const dimensions = shapeFields[String(step.shape)]
        if (!dimensions) return `etapa ${index + 1} tem uma forma não suportada`
        for (const key of ['id', 'op', 'shape', 'position', 'rotation', ...dimensions]) {
          if (step[key] === undefined || step[key] === null) return `etapa ${index + 1} (${step.shape}) precisa de ${key}`
        }
        const pattern = step.pattern as Record<string, unknown> | undefined
        if (pattern?.kind === 'circular' || pattern?.kind === 'linear') {
          const checkPattern = patternValidators[pattern.kind]
          if (!checkPattern(pattern) && checkPattern.errors?.[0]) return `etapa ${index + 1} (${step.shape}) padrão ${pattern.kind}: ${describeError(checkPattern.errors[0])}`
        }
        const checkStep = shapeValidators[String(step.shape)]
        if (!checkStep(step) && checkStep.errors?.[0]) return `etapa ${index + 1} (${step.shape}): ${describeError(checkStep.errors[0])}`
      }
    }
  }
  const error = validateOutput.errors?.find((item) => item.instancePath.startsWith('/spec/steps')) ?? validateOutput.errors?.[0]
  return error ? `${error.instancePath || 'response'} ${error.message}` : 'the returned fields do not match the CAD construction format'
}

type DimensionGap = { readonly stepIndex: number; readonly stepId: string; readonly shape: string; readonly field: string; readonly key: string }

function missingDimensions(raw: unknown): { response: Record<string, unknown>; gaps: DimensionGap[] } | null {
  const response = normalizeGeneratedResponse(raw)
  if (typeof response !== 'object' || response === null || Array.isArray(response)) return null
  const output = response as Record<string, unknown>
  if (output.decision !== 'create' || typeof output.spec !== 'object' || output.spec === null || Array.isArray(output.spec)) return null
  const steps = (output.spec as Record<string, unknown>).steps
  if (!Array.isArray(steps)) return null
  const gaps = steps.flatMap((candidate: unknown, stepIndex) => {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) return []
    const step = candidate as Record<string, unknown>
    const shape = String(step.shape)
    return (shapeFields[shape] ?? [])
      .filter((field) => step[field] === undefined || step[field] === null)
      .map((field) => ({ stepIndex, stepId: String(step.id ?? `step_${stepIndex + 1}`), shape, field, key: `step${stepIndex + 1}_${field}` }))
  })
  return gaps.length > 0 ? { response: output, gaps } : null
}

async function repairMissingDimensions(
  provider: LLMProvider, raw: unknown, request: string, previous: CadProgramSpec | undefined,
  options: { temperature: number; maxTokens: number }, allowCutRemoval: boolean,
): Promise<CadProgramOutcome | null> {
  const missing = missingDimensions(raw)
  if (!missing) return null
  const { response, gaps } = missing
  const spec = response.spec as Record<string, unknown>
  const schema = {
    type: 'object', additionalProperties: false,
    required: gaps.map((gap) => gap.key),
    properties: Object.fromEntries(gaps.map((gap) => [gap.key, gap.field === 'points' ? stepHint.properties.points : { type: 'number' }])),
  }
  const wanted = gaps.map((gap) => `${gap.key}: ${gap.field} of the ${gap.shape} step ${gap.stepIndex + 1} (${gap.stepId})`).join('\n')
  const filled = await provider.generateStructured<unknown>([
    { role: 'system', content: 'Supply only the missing dimensions of a mechanical CAD program, in millimeters. Use explicit values from the original request when present; otherwise choose values proportional to the surrounding steps. A cut must extend beyond the material it removes and a union must overlap the solid. A points value is a closed outline: x,y for polygon_prism, and nonnegative radius x with axial height y for revolve_profile. Return one JSON object with every requested key.' },
    { role: 'user', content: `Original request: ${request}\nCurrent program: ${JSON.stringify(spec)}\nMissing dimensions:\n${wanted}` },
  ], schema, { ...options, maxTokens: 256 + gaps.reduce((total, gap) => total + (gap.field === 'points' ? 512 : 24), 0) })
  if (typeof filled !== 'object' || filled === null || Array.isArray(filled)) return null
  const values = filled as Record<string, unknown>
  const steps = (spec.steps as Record<string, unknown>[]).map((step) => ({ ...step }))
  for (const gap of gaps) {
    const value = values[gap.key]
    if (gap.field === 'points') {
      if (!Array.isArray(value)) return null
    } else if (typeof value !== 'number' || !Number.isFinite(value) || value < (gap.field === 'topDiameter' ? 0 : 0.1) || value > 10000) {
      return null
    }
    steps[gap.stepIndex][gap.field] = value
  }
  return parseOutcome({ ...response, spec: { ...spec, steps } }, previous, request, allowCutRemoval)
}

function parseOutcome(raw: unknown, previous: CadProgramSpec | undefined, request: string, allowCutRemoval = false): CadProgramOutcome {
  const response = normalizeGeneratedResponse(raw)
  if (!validateOutput(response)) throw new Error(`Programa CAD inválido: ${validationIssue(response)}`)
  const result = response as { decision: 'create' | 'clarify'; spec: CadProgramSpec | null; question: string; assumptions: string[] }
  if (result.decision === 'clarify') {
    if (!result.question.trim()) throw new Error('The CAD clarification question is empty')
    return { kind: 'clarify', question: result.question }
  }
  if (!result.spec) throw new Error('The CAD program is missing')
  validateCadProgram(result.spec)
  if (previous && result.spec.partId !== previous.partId) throw new Error('Part ID cannot change')
  if (previous) {
    const returned = new Set(result.spec.steps.map((step) => step.id))
    const removed = previous.steps.filter((step) => !returned.has(step.id))
    const explicitRemoval = !allowCutRemoval && /\b(remov|exclu|apag|delet|substitu|replace|remove|delete|rebuild|refa[çc])/.test(request.toLowerCase())
    if (removed.length && !explicitRemoval && !(allowCutRemoval && removed.every((step) => step.op === 'cut'))) {
      throw new Error('The CAD edit unexpectedly removed an existing step')
    }
  }
  return { kind: 'create', spec: result.spec, assumptions: result.assumptions }
}

export async function generateCadProgram(
  provider: LLMProvider, request: string, previous?: CadProgramSpec,
  checkGeometry?: (spec: CadProgramSpec) => Promise<string | null>,
  options?: { readonly maxOutputTokens?: number },
): Promise<CadProgramOutcome> {
  const maxOutputTokens = options?.maxOutputTokens ?? 9000
  const previousIssue = previous && checkGeometry ? await checkGeometry(previous) : null
  const generationRequest = previousIssue
    ? `${request}\n\nThe existing CAD draft failed validation: ${previousIssue}. Repair or rebuild it. You may remove or revise an unrequested earlier step if it prevents a requested feature from joining, cutting or retaining one connected solid. Preserve all requested features and dimensions.`
    : request
  const outcome = await generateOnce(provider, generationRequest, previous, !!previousIssue, maxOutputTokens)
  if (outcome.kind !== 'create' || !checkGeometry) return outcome
  let current: Extract<CadProgramOutcome, { kind: 'create' }> = outcome
  let issue = await checkGeometry(current.spec)
  const repairLocally = async () => {
    for (let remaining = current.spec.steps.length; issue && remaining > 0; remaining--) {
      const moved = await repairNoOpPattern(current.spec, issue, checkGeometry)
        ?? await repairMissedThroughCut(current.spec, request, issue, checkGeometry)
        ?? await repairSeparatedUnion(current.spec, request, issue, checkGeometry)
      if (!moved) break
      current = { ...current, spec: moved.spec, assumptions: [...current.assumptions, moved.assumption] }
      issue = moved.issue
    }
  }
  const ignoreInvalidCorrection = (error: unknown): null => {
    if (error instanceof ProviderRequestError ||
        (error instanceof DOMException && error.name === 'AbortError')) throw error
    return null
  }
  // A repair can reveal a later invalid step. Continue only when geometry has
  // changed, with a fixed budget so a stubborn provider cannot loop forever.
  for (let round = 0; issue && round < 4; round++) {
    const startingSpec = JSON.stringify(current.spec)
    await repairLocally()
    for (let attempt = 0; issue && attempt < 2; attempt++) {
      const repaired = await repairGeometryStep(provider, current.spec, request, issue).catch(ignoreInvalidCorrection)
      if (repaired) {
        const repairedIssue = await checkGeometry(repaired)
        if (!repairedIssue) return { ...current, spec: repaired }
        current = { ...current, spec: repaired }
        issue = repairedIssue
      }
      const baseGuidance = /^CAD step [A-Za-z0-9_-]+ \(base\) (?:produces an invalid or empty solid|(?:polygon_prism|revolve_profile) profile )/.test(issue)
        ? 'The base itself is invalid. For polygon_prism or revolve_profile, trace one simple boundary with no crossing, duplicate closing vertex or zero-length edge. If a complex outline remains unstable, rebuild it as a simple base plus overlapping unions and non-splitting cuts, keeping the requested opening and dimensions.'
        : ''
      const failingStep = current.spec.steps.find((step) => step.id === /^CAD step ([A-Za-z0-9_-]+)/.exec(issue ?? '')?.[1])
      const patternGuidance = failingStep?.op === 'union' && failingStep.pattern &&
        /CAD step [A-Za-z0-9_-]+ instance \d+ does not change the solid/.test(issue)
        ? 'A repeated instance adds no material. Check whether a diameter-spanning primitive centered on the rotation axis coincides with an earlier instance; instead place one shorter radial feature at the outer wall and repeat it, preserving the requested count.'
        : ''
      const cutGuidance = failingStep?.op === 'cut' &&
        /CAD step [A-Za-z0-9_-]+ instance \d+ does not change the solid/.test(issue)
        ? 'The cutter does not remove material. Compare the tool and solid bounds on X, Y and Z. Align the cutter across the intended wall thickness while preserving its opening location on the other two axes; every patterned instance must remove material.'
        : ''
      const correction = `${request}\n\nThe complete CAD program is ${JSON.stringify(current.spec)}. The CAD engine rejected it: ${issue}. ${baseGuidance} ${patternGuidance} ${cutGuidance} Fix the failed step and any dependencies, preserving every requested feature, dimension and the part ID. A union must intersect existing material by positive volume. A cut must remove positive volume without splitting the remaining solid. If an unrequested earlier cut, opening or clearance prevents this, you may remove or revise that step instead of moving a requested feature away from its intended location. Return a complete corrected program.`
      const revised = await generateOnce(provider, correction, current.spec, true, maxOutputTokens).catch(ignoreInvalidCorrection)
      if (revised?.kind === 'create') {
        current = revised
        issue = await checkGeometry(current.spec)
      }
    }
    await repairLocally()
    if (JSON.stringify(current.spec) === startingSpec) break
  }
  if (issue) throw new Error(`A geração automática não conseguiu validar a peça. O rascunho anterior foi preservado. Última falha: ${issue}`)
  return current
}

function parseSolidBounds(value: string): SolidBounds | null {
  const result = {} as SolidBounds
  for (const axis of axes) {
    const match = new RegExp(`${axis}=\\[(-?\\d+(?:\\.\\d+)?), (-?\\d+(?:\\.\\d+)?)\\]`).exec(value)
    if (!match) return null
    const min = Number(match[1])
    const max = Number(match[2])
    if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) return null
    result[axis] = { min, max }
  }
  return result
}

function parseDiagnosticPoint(value: string): { x: number; y: number; z: number } | null {
  const result = { x: 0, y: 0, z: 0 }
  for (const axis of axes) {
    const match = new RegExp(`\\b${axis}=(-?\\d+(?:\\.\\d+)?)`).exec(value)
    if (!match) return null
    result[axis] = Number(match[1])
    if (!Number.isFinite(result[axis])) return null
  }
  return result
}

async function repairMissedThroughCut(
  spec: CadProgramSpec, request: string, issue: string,
  checkGeometry: (spec: CadProgramSpec) => Promise<string | null>,
): Promise<{ spec: CadProgramSpec; issue: string | null; assumption: string } | null> {
  const match = /^CAD step ([A-Za-z0-9_-]+) instance \d+ does not change the solid; current solid bounds: ([^;]+); tool bounds: ([^;]+)/.exec(issue)
  if (!match) return null
  const index = spec.steps.findIndex((step) => step.id === match[1])
  if (index < 0 || spec.steps[index].op !== 'cut') return null
  const solid = parseSolidBounds(match[2])
  const tool = parseSolidBounds(match[3])
  if (!solid || !tool) return null
  const separated = axes.filter((axis) => tool[axis].min >= solid[axis].max || tool[axis].max <= solid[axis].min)
  if (separated.length !== 1) return null
  const axis = separated[0]
  const solidSpan = solid[axis].max - solid[axis].min
  const toolSpan = tool[axis].max - tool[axis].min
  const gap = tool[axis].min >= solid[axis].max
    ? tool[axis].min - solid[axis].max : solid[axis].min - tool[axis].max
  // Centering a cutter through thin stock is safe to propose only when its
  // length can span that stock and the missed distance is small relative to it.
  if (toolSpan < solidSpan + 0.5 || gap > toolSpan / 2 ||
      new RegExp(`\\b${axis}\\s*[:=]\\s*-?\\d`, 'i').test(request) ||
      axes.some((other) => other !== axis &&
        Math.min(tool[other].max, solid[other].max) <= Math.max(tool[other].min, solid[other].min))) return null

  const old = spec.steps[index]
  const offset = (solid[axis].min + solid[axis].max - tool[axis].min - tool[axis].max) / 2
  const position = { ...old.position, [axis]: Number((old.position[axis] + offset).toFixed(6)) }
  const revised: CadProgramSpec = { ...spec, steps: spec.steps.map((step, stepIndex) =>
    stepIndex === index ? { ...step, position } as CadProgramStep : step) }
  try { validateCadProgram(revised) } catch { return null }
  const nextIssue = await checkGeometry(revised)
  const nextIndex = spec.steps.findIndex((step) => step.id === /^CAD step ([A-Za-z0-9_-]+)/.exec(nextIssue ?? '')?.[1])
  if (nextIssue && nextIndex <= index) return null
  return { spec: revised, issue: nextIssue,
    assumption: `O corte ${old.id} foi centralizado na espessura da peça ao longo de ${axis.toUpperCase()} e validado pelo motor CAD.` }
}

async function repairNoOpPattern(
  spec: CadProgramSpec, issue: string,
  checkGeometry: (spec: CadProgramSpec) => Promise<string | null>,
): Promise<{ spec: CadProgramSpec; issue: string | null; assumption: string } | null> {
  const match = /^CAD step ([A-Za-z0-9_-]+) instance (\d+) does not change the solid; current solid bounds: ([^;]+); tool bounds:/.exec(issue)
  if (!match) return null
  const index = spec.steps.findIndex((step) => step.id === match[1])
  if (index < 0) return null
  const step = spec.steps[index]
  if (step.op !== 'union' || step.shape !== 'box' || step.pattern?.kind !== 'circular' ||
      Object.values(step.rotation).some((angle) => Math.abs(angle) > 1e-6)) return null
  const solid = parseSolidBounds(match[3])
  if (!solid) return null
  const pivot = step.pattern.center ?? { x: 0, y: 0, z: 0 }
  const radialAxes = axes.filter((axis) => axis !== (step.pattern?.kind === 'circular' ? step.pattern.axis ?? 'z' : 'z'))
  const dimension = { x: 'width', y: 'depth', z: 'height' } as const
  for (const axis of radialAxes) {
    const field = dimension[axis]
    const extent = step[field]
    const hostSpan = solid[axis].max - solid[axis].min
    if (extent < hostSpan * 0.8 || Math.abs(step.position[axis] - pivot[axis]) > Math.max(1, extent * 0.1)) continue
    // A centered feature spanning the diameter repeats onto itself after half a turn.
    // Model one outward radial feature instead, then validate every patterned instance.
    for (const fraction of [0.25, 0.33]) {
      for (const side of [1, -1]) {
        const position = { ...step.position, [axis]: side > 0 ? solid[axis].max : solid[axis].min }
        const revisedStep = { ...step, [field]: Math.max(1, Math.min(extent * fraction, hostSpan / 3)), position }
        const revised: CadProgramSpec = { ...spec, steps: spec.steps.map((item, itemIndex) => itemIndex === index ? revisedStep : item) }
        try { validateCadProgram(revised) } catch { continue }
        const nextIssue = await checkGeometry(revised)
        const nextIndex = spec.steps.findIndex((item) => item.id === /^CAD step ([A-Za-z0-9_-]+)/.exec(nextIssue ?? '')?.[1])
        if (!nextIssue || nextIndex > index) {
          return { spec: revised, issue: nextIssue,
            assumption: `A repetição de ${step.id} foi corrigida para usar um recurso radial externo, preservando a quantidade de instâncias.` }
        }
      }
    }
  }
  return null
}

async function repairSeparatedUnion(
  spec: CadProgramSpec, request: string, issue: string,
  checkGeometry: (spec: CadProgramSpec) => Promise<string | null>,
): Promise<{ spec: CadProgramSpec; issue: string | null; assumption: string } | null> {
  const match = /^CAD step ([A-Za-z0-9_-]+)(?: instance \d+)? \(union\) leaves \d+ separate solids; current solid bounds: ([^;]+); tool bounds: ([^;]+); bounding boxes (?:do not overlap|overlap, but the solids may be separated by an opening or earlier cut)/.exec(issue)
  if (!match) return null
  const index = spec.steps.findIndex((step) => step.id === match[1])
  if (index < 0 || spec.steps[index].op !== 'union') return null
  const solid = parseSolidBounds(match[2])
  const tool = parseSolidBounds(match[3])
  if (!solid || !tool) return null
  const separated = axes.filter((axis) => tool[axis].min >= solid[axis].max || tool[axis].max <= solid[axis].min)
  // Exact coordinates from the request take precedence over an automatic placement guess.
  const explicitCoordinate = (axis: Axis) => new RegExp(`\\b${axis}\\s*[:=]\\s*-?\\d`, 'i').test(request)
  if (separated.some(explicitCoordinate)) return null

  const tryPosition = async (position: { x: number; y: number; z: number }) => {
    const revised = {
      ...spec,
      steps: spec.steps.map((step, stepIndex) => stepIndex === index ? { ...step, position } as CadProgramStep : step),
    }
    try {
      validateCadProgram(revised)
    } catch {
      return null
    }
    const nextIssue = await checkGeometry(revised)
    if (!nextIssue || spec.steps.findIndex((step) => step.id === /^CAD step ([A-Za-z0-9_-]+)/.exec(nextIssue)?.[1]) > index) {
      return { spec: revised, issue: nextIssue, assumption: `A posição de ${match[1]} foi ajustada para conectar a peça.` }
    }
    return null
  }

  const nearest = /nearest solid point: ([^;]+); nearest tool point: ([^;]+)/.exec(issue)
  const solidPoint = nearest ? parseDiagnosticPoint(nearest[1]) : null
  const toolPoint = nearest ? parseDiagnosticPoint(nearest[2]) : null
  if (solidPoint && toolPoint) {
    const direction = { x: solidPoint.x - toolPoint.x, y: solidPoint.y - toolPoint.y, z: solidPoint.z - toolPoint.z }
    const distance = Math.hypot(direction.x, direction.y, direction.z)
    if (distance > 0.01 && axes.every((axis) => Math.abs(direction[axis]) < 0.01 || !explicitCoordinate(axis))) {
      for (const requestedOverlap of [1, 3, 5]) {
        const overlap = Math.min(requestedOverlap, ...axes.map((axis) => (tool[axis].max - tool[axis].min) / 3))
        const position = { ...spec.steps[index].position }
        for (const axis of axes) position[axis] = Number((position[axis] + direction[axis] * (1 + overlap / distance)).toFixed(6))
        const result = await tryPosition(position)
        if (result) return result
      }
    }
  }

  for (const requestedOverlap of [1, 5, 10]) {
    const position = { ...spec.steps[index].position }
    for (const axis of separated) {
      const overlap = Math.min(requestedOverlap, (tool[axis].max - tool[axis].min) / 4, (solid[axis].max - solid[axis].min) / 4)
      position[axis] += tool[axis].min >= solid[axis].max
        ? solid[axis].max - overlap - tool[axis].min
        : solid[axis].min + overlap - tool[axis].max
    }
    const result = await tryPosition(position)
    if (result) return result
  }
  return null
}

async function repairGeometryStep(
  provider: LLMProvider, spec: CadProgramSpec, request: string, issue: string,
): Promise<CadProgramSpec | null> {
  const profileMatch = /^CAD step ([A-Za-z0-9_-]+) \((?:base|union|cut)\) (?:produces an invalid or empty solid|(?:polygon_prism|revolve_profile) profile )/.exec(issue)
  if (profileMatch) {
    const index = spec.steps.findIndex((step) => step.id === profileMatch[1])
    if (index >= 0 && (spec.steps[index].shape === 'polygon_prism' || spec.steps[index].shape === 'revolve_profile')) {
      const step = spec.steps[index] as Extract<CadProgramStep, { shape: 'polygon_prism' | 'revolve_profile' }>
      const cleaned = step.points.filter((point, pointIndex) => {
        if (pointIndex === 0) return true
        const previous = step.points[pointIndex - 1]
        if (point.x === previous.x && point.y === previous.y) return false
        const first = step.points[0]
        return pointIndex !== step.points.length - 1 || point.x !== first.x || point.y !== first.y
      })
      if (cleaned.length >= 3 && cleaned.length < step.points.length) {
        const revised = { ...spec, steps: spec.steps.map((current, i) => i === index ? { ...step, points: cleaned } : current) }
        validateCadProgram(revised)
        return revised
      }
      const patch = await provider.generateStructured<unknown>([
        { role: 'system', content: 'Repair one invalid CAD profile. Return only a points array of local x,y millimeter coordinates. List the outline vertices once in continuous boundary order, without repeating the first vertex at the end. Edges must not cross, touch non-neighboring edges, overlap or have zero length. Preserve the requested outer size, opening and overall profile; for a revolved profile, x is a nonnegative radius and y is axial Z. Do not change unrelated steps.' },
        { role: 'user', content: `Original request: ${request}\nFailed step: ${step.id} (${step.shape})\nCAD engine error: ${issue}\nCurrent points: ${JSON.stringify(step.points)}\nComplete ordered program: ${JSON.stringify(spec)}` },
      ], { type: 'object', additionalProperties: false, required: ['points'],
        properties: { points: stepHint.properties.points } }, { temperature: 0, maxTokens: 1800 })
      if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return null
      const points = (patch as Record<string, unknown>).points
      if (!Array.isArray(points)) return null
      const revised = { ...spec, steps: spec.steps.map((current, i) => i === index ? { ...step, points } as CadProgramStep : current) }
      validateCadProgram(revised)
      return revised
    }
  }
  const match = /^CAD step ([A-Za-z0-9_-]+)(?: instance \d+)? (does not change the solid|\((?:union|cut)\) leaves \d+ separate solids)/.exec(issue)
  if (!match) return null
  const index = spec.steps.findIndex((step) => step.id === match[1])
  if (index < 0) return null
  const step = spec.steps[index]
  const union = step.op === 'union'
  const splitCut = match[2].startsWith('(cut)')
  const noOpPattern = step.pattern && match[2] === 'does not change the solid'
  const fields = union && !noOpPattern ? [] : shapeFields[step.shape].filter((field) => field !== 'points')
  const schema = {
    type: 'object', additionalProperties: false, required: ['position', 'rotation'],
    properties: {
      position: vectorHint, rotation: vectorHint,
      ...Object.fromEntries(fields.map((field) => [field, { type: 'number' }])),
    },
  }
  const patch = await provider.generateStructured<unknown>([
    { role: 'system', content: noOpPattern
      ? 'Repair one patterned CAD feature whose named instance adds no material. Return corrected position, rotation and shape dimensions for the named step. Preserve the pattern count and axis. Every repeated instance must add positive volume; a feature centered on the rotation axis and spanning the full diameter can repeat onto itself. Make one short radial feature that overlaps the host wall and extends outside it before repeating. Preserve explicitly requested dimensions.'
      : union
        ? 'Repair the placement of one disconnected CAD union. Return corrected position and rotation for the named step. Coordinates are absolute millimeters; cylinders start along Z. The feature must intersect the already built solid by positive volume, not just touch its surface. Preserve requested dimensions and axis. If an earlier cut or opening separates the pieces, placement alone may not solve it; the full-program repair will then revise that earlier step.'
      : splitCut
        ? 'Repair one CAD cutting step that disconnected the remaining solid. Return its corrected position, rotation and optional dimensions. The cut must still remove the requested material while leaving a continuous material bridge. Respect explicit dimensions and do not replace the requested feature with an unrelated cut.'
      : 'Repair one CAD construction step. Return only corrected position, rotation and optional dimensions for the named step. Coordinates are absolute millimeters. Cylinders start along Z and rotations are degrees. A cut must intersect the solid that exists before that step; changing only Z is insufficient if X, Y, rotation or length is wrong. Preserve the requested feature, its explicitly requested location and all other steps. Do not move a bore into another component merely to make the Boolean operation pass.' },
    { role: 'user', content: `Original request: ${request}\nFailed step: ${step.id} (step ${index + 1})\nCAD engine error: ${issue}\nComplete ordered program: ${JSON.stringify(spec)}\nReturn a corrected placement for ${step.id}.` },
  ], schema, { temperature: 0, maxTokens: 1200 })
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return null
  const values = patch as Record<string, unknown>
  if (!vectorHintValid(values.position) || !vectorHintValid(values.rotation)) return null
  const dimensions = Object.fromEntries(fields.filter((field) => values[field] !== undefined).map((field) => [field, values[field]]))
  const revised = {
    ...spec,
    steps: spec.steps.map((current, i) => i === index
      ? { ...current, position: values.position, rotation: values.rotation, ...dimensions } as CadProgramStep
      : current),
  }
  validateCadProgram(revised)
  return revised
}

function vectorHintValid(value: unknown): value is { x: number; y: number; z: number } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const vector = value as Record<string, unknown>
  return ['x', 'y', 'z'].every((axis) => typeof vector[axis] === 'number' && Number.isFinite(vector[axis]))
}

async function generateOnce(provider: LLMProvider, request: string, previous?: CadProgramSpec, allowCutRemoval = false, maxOutputTokens = 9000): Promise<CadProgramOutcome> {
  if (!request.trim()) throw new Error('Describe the CAD part first')
  const instructions = [
    'You are a mechanical CAD construction planner. Return a single connected manufacturable solid in millimeters.',
    'Build it from ordered primitives: box, cylinder, sphere, cone, polygon_prism, revolve_profile. The first step uses base; each later step uses union or cut.',
    'polygon_prism is an extruded closed XY outline: points are local x,y coordinates, height is centered around local Z. List vertices once in continuous boundary order, without repeating the first vertex; non-neighboring edges must never cross or touch. Use it for custom flat profiles.',
    'revolve_profile rotates a closed cross-section 360 degrees around local Z. Its points use x as nonnegative radius and y as axial Z height, both in mm. Use a simple non-self-intersecting profile without a duplicate closing point. Use it for stepped axial forms, hubs, grooves, pulleys and turned profiles; do not provide a height field for it.',
    'Any non-base primitive may include a pattern: {kind:"circular",count,axis:"z",center:{x:0,y:0,z:0},sweepAngle:360} or {kind:"linear",count,offset:{x,y,z}}. The pattern count includes the original primitive. Use circular patterns for evenly spaced teeth, spokes, ribs, bolt holes or slots; use linear patterns for rows and repeated cuts. The same union or cut applies to every instance. For circular ribs, fins or teeth, model ONE short feature offset radially from the rotation axis, reaching into the host by positive volume and extending outward. A full-diameter feature centered on the axis repeats onto itself. Omit pattern entirely for a primitive that is not repeated; never use a count below 2.',
    'Each primitive is centered at its position. Cylinder and cone axes start along Z. Rotation x, y, z is in degrees and applied in that order.',
    'Every union must overlap the current solid by positive volume; every cut must remove positive volume and keep one connected solid.',
    'Respect every explicit dimension, hole count, position and angle in the user request; never silently omit a requested feature.',
    'For holes, use a cylinder cut longer than the material. For tubes, union the outside then cut the inside.',
    'Every step must carry every dimension of its shape, in millimeters: box needs width, depth and height; cylinder needs diameter and axial height, including cylindrical cuts; cone needs bottomDiameter, topDiameter and height; sphere needs diameter; polygon_prism needs points and height; revolve_profile needs points. The compact output schema marks only height as required, so supply the other dimensions yourself; the height hint on spheres and revolved profiles is ignored.',
    'Use descriptive unique IDs, at most 32 steps and 256 total patterned instances. A short request naming a recognizable mechanical object is enough: infer reasonable size, thickness, feature count and placement, then list those assumptions. Do not demand that the user supply routine dimensions or choose a simpler part.',
    'If exact geometry needs operations not available here, build the closest useful solid from the supported primitives, cuts, custom profiles and patterns; identify the approximation in assumptions and do not claim unverified manufacturing tolerances. Ask one concise question only when incompatible requirements or an unidentifiable object prevent even a useful approximation.',
    previous ? 'Edit the existing program while preserving unrelated steps and the partId. Return the complete revised program.' : 'Create a new program.',
  ].join(' ')
  const messages: AgentMessage[] = [
    { role: 'system', content: instructions },
    { role: 'user', content: previous ? `Current CAD program:\n${JSON.stringify(previous)}\n\nRequested change: ${request}` : request },
  ]
  const options = { temperature: 0, maxTokens: maxOutputTokens }
  const first = await provider.generateStructured<unknown>(messages, generationSchema, options)
  let candidate = first
  try {
    const initial = parseOutcome(first, previous, request, allowCutRemoval)
    if (initial.kind !== 'clarify' || previous) return initial
    candidate = await provider.generateStructured<unknown>([
      ...messages,
      { role: 'assistant', content: JSON.stringify(first) },
      { role: 'user', content: 'Reconsider the clarification. If the request names a recognizable mechanical object, choose ordinary missing dimensions and build a useful solid with available primitives, boolean cuts and repeated patterns. List assumptions and approximations. Do not redirect the user to a simpler object or ask for routine measurements. Ask a question only if the object itself is unidentifiable or requirements conflict. Return the complete CAD program JSON.' },
    ], generationSchema, options)
    return parseOutcome(candidate, previous, request, allowCutRemoval)
  } catch (error) {
    const issue = error instanceof Error ? error.message : 'Invalid CAD program response'
    const serialized = JSON.stringify(candidate) ?? ''
    const repairMessages: AgentMessage[] = [
      ...messages,
      ...(serialized.length <= 20_000 ? [{ role: 'assistant' as const, content: serialized }] : []),
      { role: 'user', content: `Correct the complete CAD program. The previous response failed validation: ${issue}. Each step needs id, op, shape, position, rotation and a numeric height in the compact output. Use box width/depth/height; cylinder diameter/height; sphere diameter; cone bottomDiameter/topDiameter/height; polygon_prism points/height; revolve_profile radius/axial points. Temporary height values on spheres and revolved profiles are ignored during validation. Preserve every pattern and requested feature. ${allowCutRemoval ? 'Preserve existing base and union steps; remove an unrequested cut only if it prevents a valid connected solid.' : 'Preserve every existing step unless the user explicitly requested its removal.'} Return only the corrected JSON object.` },
    ]
    const repaired = await provider.generateStructured<unknown>(repairMessages, generationSchema, options)
    try {
      return parseOutcome(repaired, previous, request, allowCutRemoval)
    } catch (repairedError) {
      const completed = await repairMissingDimensions(provider, repaired, request, previous, options, allowCutRemoval)
      if (completed) return completed
      throw repairedError
    }
  }
}
