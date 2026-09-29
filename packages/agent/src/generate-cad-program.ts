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

const shapeFields: Readonly<Record<string, readonly string[]>> = {
  box: ['width', 'depth', 'height'],
  cylinder: ['diameter', 'height'],
  sphere: ['diameter'],
  cone: ['bottomDiameter', 'topDiameter', 'height'],
  polygon_prism: ['points', 'height'],
  revolve_profile: ['points'],
}
const allShapeFields = new Set(Object.values(shapeFields).flat())

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
    const normalized = Object.fromEntries(Object.entries(step).filter(([field, value]) =>
      (field !== 'pattern' || value != null) && (!allShapeFields.has(field) || dimensions.includes(field))))
    const pattern = step.pattern
    if (typeof pattern === 'object' && pattern !== null && !Array.isArray(pattern)) {
      const patternFields = pattern as Record<string, unknown>
      const fields = patternFields.kind === 'circular'
        ? new Set(['kind', 'count', 'axis', 'center', 'sweepAngle'])
        : patternFields.kind === 'linear' ? new Set(['kind', 'count', 'offset']) : null
      if (fields) normalized.pattern = Object.fromEntries(Object.entries(pattern).filter(([field, value]) => fields.has(field) && value != null))
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
      }
    }
  }
  const error = validateOutput.errors?.find((item) => item.instancePath.startsWith('/spec/steps')) ?? validateOutput.errors?.[0]
  return error ? `${error.instancePath || 'response'} ${error.message}` : 'the returned fields do not match the CAD construction format'
}

function singleMissingCylinderHeight(raw: unknown): { response: Record<string, unknown>; stepIndex: number; stepId: string } | null {
  const response = normalizeGeneratedResponse(raw)
  if (typeof response !== 'object' || response === null || Array.isArray(response)) return null
  const output = response as Record<string, unknown>
  if (output.decision !== 'create' || typeof output.spec !== 'object' || output.spec === null || Array.isArray(output.spec)) return null
  const steps = (output.spec as Record<string, unknown>).steps
  if (!Array.isArray(steps)) return null
  const missing = steps.flatMap((candidate, index) =>
    typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate) &&
    candidate.shape === 'cylinder' && (candidate.height === undefined || candidate.height === null)
      ? [{ stepIndex: index, stepId: String(candidate.id ?? `step_${index + 1}`) }]
      : [])
  return missing.length === 1 ? { response: output, ...missing[0] } : null
}

async function repairOneCylinderHeight(
  provider: LLMProvider, raw: unknown, request: string, previous: CadProgramSpec | undefined,
  options: { temperature: number; maxTokens: number },
): Promise<CadProgramOutcome | null> {
  const missing = singleMissingCylinderHeight(raw)
  if (!missing) return null
  const { response, stepIndex, stepId } = missing
  const spec = response.spec as Record<string, unknown>
  const steps = spec.steps as Record<string, unknown>[]
  const heightResponse = await provider.generateStructured<unknown>([
    { role: 'system', content: 'Supply only the missing axial height, in millimeters, for one cylinder in a mechanical CAD program. Use an explicit value from the original request when present. For a through cut, make the cylinder longer than the material along its axis. Return one JSON object with a numeric height.' },
    { role: 'user', content: `Original request: ${request}\nCurrent program: ${JSON.stringify(spec)}\nThe cylinder step ${stepIndex + 1} (${stepId}) has no height. What is its axial height in mm?` },
  ], { type: 'object', additionalProperties: false, required: ['height'], properties: { height: { type: 'number' } } }, { ...options, maxTokens: 128 })
  if (typeof heightResponse !== 'object' || heightResponse === null || Array.isArray(heightResponse)) return null
  const height = (heightResponse as Record<string, unknown>).height
  if (typeof height !== 'number' || !Number.isFinite(height) || height < 0.1 || height > 10000) return null
  const correctedSteps = steps.map((step, index) => index === stepIndex ? { ...step, height } : step)
  return parseOutcome({ ...response, spec: { ...spec, steps: correctedSteps } }, previous, request)
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

export async function generateCadProgram(provider: LLMProvider, request: string, previous?: CadProgramSpec): Promise<CadProgramOutcome> {
  if (!request.trim()) throw new Error('Describe the CAD part first')
  const instructions = [
    'You are a mechanical CAD construction planner. Return a single connected manufacturable solid in millimeters.',
    'Build it from ordered primitives: box, cylinder, sphere, cone, polygon_prism, revolve_profile. The first step uses base; each later step uses union or cut.',
    'polygon_prism is an extruded closed XY outline: points are local x,y coordinates, height is centered around local Z. Use it for custom flat profiles.',
    'revolve_profile rotates a closed cross-section 360 degrees around local Z. Its points use x as nonnegative radius and y as axial Z height, both in mm. Use it for stepped axial forms, hubs, grooves, pulleys and turned profiles; do not provide a height field for it.',
    'Any non-base primitive may include a pattern: {kind:"circular",count,axis:"z",center:{x:0,y:0,z:0},sweepAngle:360} or {kind:"linear",count,offset:{x,y,z}}. The pattern count includes the original primitive. Use circular patterns for evenly spaced teeth, spokes, ribs, bolt holes or slots; use linear patterns for rows and repeated cuts. The same union or cut applies to every instance.',
    'Each primitive is centered at its position. Cylinder and cone axes start along Z. Rotation x, y, z is in degrees and applied in that order.',
    'Every union must overlap the current solid by positive volume; every cut must remove positive volume and keep one connected solid.',
    'Respect every explicit dimension, hole count, position and angle in the user request; never silently omit a requested feature.',
    'For holes, use a cylinder cut longer than the material. For tubes, union the outside then cut the inside.',
    'Every cylinder needs both diameter and axial height in millimeters, including cylindrical cuts. Every box, cone and polygon prism also needs height. The compact output schema asks for height on spheres and revolved profiles too; that hint is ignored for those shapes.',
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
      const completed = await repairOneCylinderHeight(provider, repaired, request, previous, options)
      if (completed) return completed
      throw repairedError
    }
  }
}
