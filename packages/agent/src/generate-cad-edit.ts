import { Ajv2020 } from 'ajv/dist/2020.js'

import type { CadPartSpec } from '../../domain/ts/src/cad-part.ts'
import { validateCadPartDomainRules } from '../../domain/ts/src/cad-part.ts'
import type { CadEditPlan, CadOperation } from '../../domain/ts/src/cad-plan.ts'
import { validateCadEditPlan } from '../../domain/ts/src/cad-plan.ts'
import type { LLMProvider } from './provider.ts'

const outputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['decision', 'operations', 'question'],
  properties: {
    decision: { enum: ['edit', 'clarify'] },
    operations: {
      type: 'array', minItems: 0, maxItems: 6,
      items: {
        type: 'object', additionalProperties: false,
        required: ['op', 'parameter', 'value'],
        properties: {
          op: { const: 'set_parameter' },
          parameter: { enum: ['width', 'depth', 'thickness', 'hole_x', 'hole_y', 'hole_diameter'] },
          value: { type: 'number' },
        },
      },
    },
    question: { type: 'string', maxLength: 240 },
  },
} as const

const validateOutput = new Ajv2020().compile(outputSchema as object)

const v2OutputSchema = {
  ...outputSchema,
  properties: {
    ...outputSchema.properties,
    operations: {
      type: 'array', minItems: 0, maxItems: 20,
      items: {
        oneOf: [
          outputSchema.properties.operations.items,
          { type: 'object', additionalProperties: false, required: ['op', 'value'], properties: {
            op: { const: 'set_corner_chamfer' }, value: { type: 'number' },
          } },
          { type: 'object', additionalProperties: false, required: ['op', 'holeId', 'x', 'y', 'diameter'], properties: {
            op: { const: 'upsert_hole' }, holeId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' },
            x: { type: 'number' }, y: { type: 'number' }, diameter: { type: 'number' },
          } },
          { type: 'object', additionalProperties: false, required: ['op', 'holeId'], properties: {
            op: { const: 'remove_hole' }, holeId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' },
          } },
        ],
      },
    },
  },
} as const

const validateV2Output = new Ajv2020().compile(v2OutputSchema as object)

const v3OutputSchema = {
  ...v2OutputSchema,
  properties: {
    ...v2OutputSchema.properties,
    operations: {
      type: 'array', minItems: 0, maxItems: 20,
      items: { oneOf: [
        ...v2OutputSchema.properties.operations.items.oneOf,
        { type: 'object', additionalProperties: false, required: ['op', 'parameter', 'value'], properties: {
          op: { const: 'set_upright_parameter' }, parameter: { enum: ['height', 'thickness'] }, value: { type: 'number' },
        } },
        { type: 'object', additionalProperties: false, required: ['op', 'holeId', 'x', 'z', 'diameter'], properties: {
          op: { const: 'upsert_upright_hole' }, holeId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' },
          x: { type: 'number' }, z: { type: 'number' }, diameter: { type: 'number' },
        } },
        { type: 'object', additionalProperties: false, required: ['op', 'holeId'], properties: {
          op: { const: 'remove_upright_hole' }, holeId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' },
        } },
      ] },
    },
  },
} as const

const validateV3Output = new Ajv2020().compile(v3OutputSchema as object)

const v4OutputSchema = {
  ...v3OutputSchema,
  properties: {
    ...v3OutputSchema.properties,
    operations: {
      type: 'array', minItems: 0, maxItems: 20,
      items: { oneOf: [
        ...v3OutputSchema.properties.operations.items.oneOf,
        { type: 'object', additionalProperties: false, required: ['op', 'value'], properties: {
          op: { const: 'set_corner_radius' }, value: { type: 'number' },
        } },
        { type: 'object', additionalProperties: false, required: ['op', 'value'], properties: {
          op: { const: 'set_disc_diameter' }, value: { type: 'number' },
        } },
      ] },
    },
  },
} as const

const validateV4Output = new Ajv2020().compile(v4OutputSchema as object)

const v5OutputSchema = {
  ...v4OutputSchema,
  properties: {
    ...v4OutputSchema.properties,
    operations: {
      type: 'array', minItems: 0, maxItems: 20,
      items: { oneOf: [
        ...v4OutputSchema.properties.operations.items.oneOf,
        { type: 'object', additionalProperties: false,
          required: ['op', 'bossId', 'x', 'y', 'diameter', 'height'], properties: {
            op: { const: 'upsert_boss' }, bossId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' },
            x: { type: 'number' }, y: { type: 'number' }, diameter: { type: 'number' }, height: { type: 'number' },
          } },
        { type: 'object', additionalProperties: false, required: ['op', 'bossId'], properties: {
          op: { const: 'remove_boss' }, bossId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' },
        } },
      ] },
    },
  },
} as const

const validateV5Output = new Ajv2020().compile(v5OutputSchema as object)

interface CadAgentOutput {
  readonly decision: 'edit' | 'clarify'
  readonly operations: readonly CadOperation[]
  readonly question: string
}

export type CadEditOutcome =
  | { readonly kind: 'edit'; readonly plan: CadEditPlan }
  | { readonly kind: 'clarify'; readonly question: string }

export class CadEditGenerationError extends Error {}

function validateCandidate(spec: CadPartSpec, plan: CadEditPlan): void {
  let width = spec.base.width
  let depth = spec.base.depth
  let thickness = spec.base.thickness
  let chamfer = spec.cornerChamfer ?? 0
  let cornerRadius = spec.cornerRadius ?? 0
  const features = spec.features.map((hole, index) => ({ ...hole, id: hole.id ?? `hole_${index + 1}` }))
  const upright = spec.upright ? { ...spec.upright, holes: spec.upright.holes.map((hole) => ({ ...hole })) } : null
  const bosses = (spec.bosses ?? []).map((boss) => ({ ...boss }))
  for (const operation of plan.operations) {
    if (operation.op === 'set_parameter') {
      switch (operation.parameter) {
        case 'width': width = operation.value; break
        case 'depth': depth = operation.value; break
        case 'thickness': thickness = operation.value; break
        case 'hole_x': features[0].x = operation.value; break
        case 'hole_y': features[0].y = operation.value; break
        case 'hole_diameter': features[0].diameter = operation.value; break
      }
    } else if (operation.op === 'set_corner_chamfer') {
      chamfer = operation.value
    } else if (operation.op === 'set_corner_radius') {
      if (spec.base.kind !== 'extruded_rectangle' || !['2.3', '2.4'].includes(spec.schemaVersion)) throw new CadEditGenerationError('Corner radius needs a rounded plate.')
      cornerRadius = operation.value
    } else if (operation.op === 'set_disc_diameter') {
      if (spec.base.kind !== 'extruded_disc' || !['2.3', '2.4'].includes(spec.schemaVersion)) throw new CadEditGenerationError('Disc diameter needs a circular flange.')
      width = operation.value
      depth = operation.value
    } else if (operation.op === 'upsert_boss') {
      if (spec.schemaVersion !== '2.4') throw new CadEditGenerationError('Boss edits need a composite CAD part.')
      const boss = { kind: 'cylindrical_boss' as const, id: operation.bossId, x: operation.x,
        y: operation.y, diameter: operation.diameter, height: operation.height }
      const index = bosses.findIndex((current) => current.id === operation.bossId)
      if (index < 0) bosses.push(boss)
      else bosses[index] = boss
    } else if (operation.op === 'remove_boss') {
      if (spec.schemaVersion !== '2.4') throw new CadEditGenerationError('Boss edits need a composite CAD part.')
      const index = bosses.findIndex((boss) => boss.id === operation.bossId)
      if (index < 0) throw new CadEditGenerationError(`Boss ${operation.bossId} does not exist.`)
      bosses.splice(index, 1)
    } else if (operation.op === 'upsert_hole') {
      const index = features.findIndex((hole) => hole.id === operation.holeId)
      const hole = { kind: 'through_hole' as const, id: operation.holeId, x: operation.x, y: operation.y, diameter: operation.diameter }
      if (index < 0) features.push(hole)
      else features[index] = hole
    } else if (operation.op === 'remove_hole') {
      const index = features.findIndex((hole) => hole.id === operation.holeId)
      if (index < 0) throw new CadEditGenerationError(`Hole ${operation.holeId} does not exist.`)
      features.splice(index, 1)
    } else if (operation.op === 'set_upright_parameter') {
      if (!upright) throw new CadEditGenerationError('This CAD part has no upright wall.')
      upright[operation.parameter] = operation.value
    } else if (operation.op === 'upsert_upright_hole') {
      if (!upright) throw new CadEditGenerationError('This CAD part has no upright wall.')
      const hole = { id: operation.holeId, x: operation.x, z: operation.z, diameter: operation.diameter }
      const index = upright.holes.findIndex((current) => current.id === operation.holeId)
      if (index < 0) upright.holes.push(hole)
      else upright.holes[index] = hole
    } else if (operation.op === 'remove_upright_hole') {
      if (!upright) throw new CadEditGenerationError('This CAD part has no upright wall.')
      const index = upright.holes.findIndex((hole) => hole.id === operation.holeId)
      if (index < 0) throw new CadEditGenerationError(`Upright hole ${operation.holeId} does not exist.`)
      upright.holes.splice(index, 1)
    }
  }
  validateCadPartDomainRules({
    ...spec,
    schemaVersion: plan.schemaVersion === '2.0' ? '2.1' : spec.schemaVersion,
    base: { ...spec.base, width, depth, thickness },
    features: plan.schemaVersion === '1.0' && spec.schemaVersion === '2.0' ? features.map(({ id: _id, ...hole }) => hole) : features,
    ...(plan.schemaVersion !== '1.0' ? { cornerChamfer: chamfer } : {}),
    ...(plan.schemaVersion === '4.0' || plan.schemaVersion === '5.0' ? { cornerRadius } : {}),
    ...(upright ? { upright } : {}),
    ...(spec.schemaVersion === '2.4' ? { bosses } : {}),
  })
}

export async function generateCadEdit(
  provider: LLMProvider, request: string, spec: CadPartSpec,
): Promise<CadEditOutcome> {
  if (!request.trim() || request.length > 1000) {
    throw new CadEditGenerationError('Describe one specific CAD parameter edit in up to 1,000 characters.')
  }
  const isV2 = spec.schemaVersion === '2.1'
  const isV3 = spec.schemaVersion === '2.2'
  const isV4 = spec.schemaVersion === '2.3'
  const isV5 = spec.schemaVersion === '2.4'
  const schema = isV5 ? v5OutputSchema : isV4 ? v4OutputSchema : isV3 ? v3OutputSchema : isV2 ? v2OutputSchema : outputSchema
  const raw = await provider.generateStructured<unknown>([
    { role: 'system', content: [
      isV5
        ? 'You edit one fused composite mechanical part with a base and cylindrical bosses. Output only the supplied JSON schema.'
        : isV4
        ? spec.base.kind === 'extruded_disc' ? 'You edit a circular flange with axial through holes. Output only the supplied JSON schema.' : 'You edit a rounded rectangular plate with through holes. Output only the supplied JSON schema.'
        : isV3
        ? 'You edit one fused mechanical L bracket with a horizontal base and vertical rear wall. Output only the JSON schema supplied.'
        : isV2
        ? 'You edit one parametric mounting plate with identified through-holes and four equal corner chamfers. Output only the JSON schema supplied.'
        : 'You edit one parametric plate with one through-hole. Output only the JSON schema supplied.',
      'All coordinates and dimensions are millimeters. Return absolute parameter values; convert centimeters if needed.',
      isV5
        ? 'Use upsert_boss with all coordinates, diameter and height to add or change a fused cylinder; use remove_boss to delete one while retaining at least one. Use upsert_hole and remove_hole for axial through cuts. A hole fully inside a boss cuts through boss and base; a hole outside cuts the base only. Do not let holes partially cross boss boundaries. Use set_corner_radius or set_disc_diameter for the base profile when applicable. Keep all unmentioned features. No blind pockets, separate bodies, slots, threads or code.'
        : isV4
        ? spec.base.kind === 'extruded_disc' ? 'Use set_disc_diameter for the outside diameter; width and depth must stay equal. Use set_parameter for thickness or the first hole, and upsert_hole or remove_hole for other holes. Do not create threads, slots, raised hubs, extra bodies or code.' : 'Use set_corner_radius for the four XY profile corners, set_parameter for width, depth, thickness or the first hole, and upsert_hole or remove_hole for other holes. Do not create top or bottom edge fillets, threads, slots, extra bodies or code.'
        : isV3
        ? 'Use set_upright_parameter for height or wall thickness; upsert_upright_hole with X,Z,diameter to add or change a wall hole; remove_upright_hole to delete one. Use existing base-hole and base-parameter operations for the base. The wall height and Z hole coordinates are measured from the base bottom. Preserve every unmentioned dimension and hole. Do not create threads, slots, radii, separate bodies or code.'
        : isV2
        ? 'Use upsert_hole with all coordinates and diameter to add or change a hole, remove_hole to delete one, set_corner_chamfer for all four corners, and set_parameter for base or first-hole values. Preserve other holes. Do not create other feature types, code, sketches or assemblies.'
        : 'Change only parameters explicitly requested. Do not create other features, code, sketches or assemblies.',
      'If the target, direction, amount or unit is unclear, choose clarify with no operations and one short question.',
      'For an edit, choose edit, include only changed parameters and use an empty question.',
    ].join(' ') },
    { role: 'user', content: `Current CAD part: ${JSON.stringify(spec)}\nRequest: ${request}` },
  ], schema as unknown as Record<string, unknown>, { temperature: 0, maxTokens: 1024 })
  if (!(isV5 ? validateV5Output(raw) : isV4 ? validateV4Output(raw) : isV3 ? validateV3Output(raw) : isV2 ? validateV2Output(raw) : validateOutput(raw))) throw new CadEditGenerationError('The AI returned an invalid CAD command.')
  const output = raw as CadAgentOutput
  if (output.decision === 'clarify') {
    if (output.operations.length > 0 || !output.question.trim()) {
      throw new CadEditGenerationError('The CAD clarification was incomplete.')
    }
    return { kind: 'clarify', question: output.question.trim() }
  }
  if (output.question !== '') throw new CadEditGenerationError('The CAD edit mixed a question with parameter changes.')
  const plan: CadEditPlan = { schemaVersion: isV5 ? '5.0' : isV4 ? '4.0' : isV3 ? '3.0' : isV2 ? '2.0' : '1.0', operations: output.operations }
  try {
    validateCadEditPlan(plan)
    validateCandidate(spec, plan)
  } catch (error) {
    throw new CadEditGenerationError(error instanceof Error ? error.message : 'The CAD edit is invalid.')
  }
  return { kind: 'edit', plan }
}
