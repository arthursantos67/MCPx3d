import { Ajv2020 } from 'ajv/dist/2020.js'
import programSchema from '../../domain/schemas/cad-program.v3.schema.json' with { type: 'json' }
import { type CadProgramSpec, validateCadProgram } from '../../domain/ts/src/cad-program.ts'
import type { AgentMessage, LLMProvider } from './provider.ts'

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
  | { readonly kind: 'create'; readonly spec: CadProgramSpec; readonly assumptions: readonly string[]; readonly geometryIssue?: string }
  | { readonly kind: 'clarify'; readonly question: string }

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
  options: { temperature: number; maxTokens: number },
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
  return parseOutcome({ ...response, spec: { ...spec, steps } }, previous, request)
}

function parseOutcome(raw: unknown, previous: CadProgramSpec | undefined, request: string): CadProgramOutcome {
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
  if (previous && !/\b(remov|exclu|apag|delet|substitu|replace|remove|delete|rebuild|refa[çc])/.test(request.toLowerCase())) {
    const returned = new Set(result.spec.steps.map((step) => step.id))
    if (previous.steps.some((step) => !returned.has(step.id))) throw new Error('The CAD edit unexpectedly removed an existing step')
  }
  return { kind: 'create', spec: result.spec, assumptions: result.assumptions }
}

export async function generateCadProgram(
  provider: LLMProvider, request: string, previous?: CadProgramSpec,
  checkGeometry?: (spec: CadProgramSpec) => Promise<string | null>,
): Promise<CadProgramOutcome> {
  let outcome = await generateOnce(provider, request, previous)
  for (let attempt = 0; outcome.kind === 'create' && checkGeometry; attempt++) {
    const issue = await checkGeometry(outcome.spec)
    if (!issue) return outcome
    if (attempt === 2) return { ...outcome, geometryIssue: issue }
    const correction = `${request}\n\nThe current program fails the solid check: ${issue}. Correct the position, size or rotation of the named step so every union overlaps the part and no cut splits it. Keep every requested feature.`
    const revised = await generateOnce(provider, correction, outcome.spec).catch(() => null)
    if (revised?.kind !== 'create') return { ...outcome, geometryIssue: issue }
    outcome = revised
  }
  return outcome
}

async function generateOnce(provider: LLMProvider, request: string, previous?: CadProgramSpec): Promise<CadProgramOutcome> {
  if (!request.trim()) throw new Error('Describe the CAD part first')
  const instructions = [
    'You are a mechanical CAD construction planner. Return a single connected manufacturable solid in millimeters.',
    'Build it from ordered primitives: box, cylinder, sphere, cone, polygon_prism, revolve_profile. The first step uses base; each later step uses union or cut.',
    'polygon_prism is an extruded closed XY outline: points are local x,y coordinates, height is centered around local Z. Use it for custom flat profiles.',
    'revolve_profile rotates a closed cross-section 360 degrees around local Z. Its points use x as nonnegative radius and y as axial Z height, both in mm. Use it for stepped axial forms, hubs, grooves, pulleys and turned profiles; do not provide a height field for it.',
    'Any non-base primitive may include a pattern: {kind:"circular",count,axis:"z",center:{x:0,y:0,z:0},sweepAngle:360} or {kind:"linear",count,offset:{x,y,z}}. The pattern count includes the original primitive. Use circular patterns for evenly spaced teeth, spokes, ribs, bolt holes or slots; use linear patterns for rows and repeated cuts. The same union or cut applies to every instance. Omit pattern entirely for a primitive that is not repeated; never use a count below 2.',
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
  const options = { temperature: 0, maxTokens: 9000 }
  const first = await provider.generateStructured<unknown>(messages, generationSchema, options)
  let candidate = first
  try {
    const initial = parseOutcome(first, previous, request)
    if (initial.kind !== 'clarify' || previous) return initial
    candidate = await provider.generateStructured<unknown>([
      ...messages,
      { role: 'assistant', content: JSON.stringify(first) },
      { role: 'user', content: 'Reconsider the clarification. If the request names a recognizable mechanical object, choose ordinary missing dimensions and build a useful solid with available primitives, boolean cuts and repeated patterns. List assumptions and approximations. Do not redirect the user to a simpler object or ask for routine measurements. Ask a question only if the object itself is unidentifiable or requirements conflict. Return the complete CAD program JSON.' },
    ], generationSchema, options)
    return parseOutcome(candidate, previous, request)
  } catch (error) {
    const issue = error instanceof Error ? error.message : 'Invalid CAD program response'
    const serialized = JSON.stringify(candidate) ?? ''
    const repairMessages: AgentMessage[] = [
      ...messages,
      ...(serialized.length <= 20_000 ? [{ role: 'assistant' as const, content: serialized }] : []),
      { role: 'user', content: `Correct the complete CAD program. The previous response failed validation: ${issue}. Each step needs id, op, shape, position, rotation and a numeric height in the compact output. Use box width/depth/height; cylinder diameter/height; sphere diameter; cone bottomDiameter/topDiameter/height; polygon_prism points/height; revolve_profile radius/axial points. Temporary height values on spheres and revolved profiles are ignored during validation. Preserve every pattern, requested feature and existing step. Return only the corrected JSON object.` },
    ]
    const repaired = await provider.generateStructured<unknown>(repairMessages, generationSchema, options)
    try {
      return parseOutcome(repaired, previous, request)
    } catch (repairedError) {
      const completed = await repairMissingDimensions(provider, repaired, request, previous, options)
      if (completed) return completed
      throw repairedError
    }
  }
}
