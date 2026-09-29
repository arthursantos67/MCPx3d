import { Ajv2020 } from 'ajv/dist/2020.js'

import partSchemaSource from '../../domain/schemas/cad-part.v2.1.schema.json' with { type: 'json' }
import bracketSchemaSource from '../../domain/schemas/cad-part.v2.2.schema.json' with { type: 'json' }
import curvedSchemaSource from '../../domain/schemas/cad-part.v2.3.schema.json' with { type: 'json' }
import compositeSchemaSource from '../../domain/schemas/cad-part.v2.4.schema.json' with { type: 'json' }
import { type CadPartSpec, validateCadPartDomainRules } from '../../domain/ts/src/cad-part.ts'
import type { LLMProvider } from './provider.ts'

const partSchema = Object.fromEntries(Object.entries(partSchemaSource).filter(([key]) =>
  !['$schema', '$id', 'title', '$comment'].includes(key)))
const bracketSchema = Object.fromEntries(Object.entries(bracketSchemaSource).filter(([key]) =>
  !['$schema', '$id', 'title', '$comment'].includes(key)))
const curvedSchema = Object.fromEntries(Object.entries(curvedSchemaSource).filter(([key]) =>
  !['$schema', '$id', 'title', '$comment'].includes(key)))
const compositeSchema = Object.fromEntries(Object.entries(compositeSchemaSource).filter(([key]) =>
  !['$schema', '$id', 'title', '$comment'].includes(key)))
const roundedSchema = {
  ...curvedSchema,
  properties: {
    ...curvedSchemaSource.properties,
    base: { ...curvedSchemaSource.properties.base, properties: {
      ...curvedSchemaSource.properties.base.properties, kind: { const: 'extruded_rectangle' },
    } },
    cornerRadius: { type: 'number', exclusiveMinimum: 0, maximum: 5000 },
  },
}
const flangeSchema = {
  ...curvedSchema,
  properties: {
    ...curvedSchemaSource.properties,
    base: { ...curvedSchemaSource.properties.base, properties: {
      ...curvedSchemaSource.properties.base.properties, kind: { const: 'extruded_disc' },
    } },
    cornerRadius: { const: 0 },
  },
}

function outputSchemaFor(shape: CadPartShape) { return {
  type: 'object',
  additionalProperties: false,
  required: ['decision', 'spec', 'question', 'assumptions'],
  properties: {
    decision: { enum: ['create', 'clarify'] },
    spec: { anyOf: [shape === 'bracket' ? bracketSchema : shape === 'plate' ? partSchema
      : shape === 'flange' ? flangeSchema : shape === 'composite' ? compositeSchema : roundedSchema, { type: 'null' }] },
    question: { type: 'string', maxLength: 240 },
    assumptions: { type: 'array', minItems: 0, maxItems: 10, items: { type: 'string', minLength: 1, maxLength: 180 } },
  },
} }

export type CadPartShape = 'plate' | 'bracket' | 'rounded_plate' | 'flange' | 'composite'

interface CadCreateOutput {
  readonly decision: 'create' | 'clarify'
  readonly spec: CadPartSpec | null
  readonly question: string
  readonly assumptions: readonly string[]
}

export type CadCreateOutcome =
  | { readonly kind: 'create'; readonly spec: CadPartSpec; readonly assumptions: readonly string[] }
  | { readonly kind: 'clarify'; readonly question: string }

export class CadPartGenerationError extends Error {}

function requestedHoleCount(request: string): number | null {
  const match = request.toLowerCase().match(/\b(1[0-6]|[1-9]|um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:furos?|holes?)\b/)
  if (!match) return null
  const words: Record<string, number> = {
    um: 1, uma: 1, dois: 2, duas: 2, tres: 3, três: 3, quatro: 4, cinco: 5,
    seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, one: 1, two: 2,
    three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  }
  return words[match[1]] ?? Number(match[1])
}

function requestedFaceHoleCount(request: string, face: 'base' | 'wall'): number | null {
  const number = '(1[0-6]|[1-9]|um|uma|dois|duas|três|tres|quatro|cinco|seis|sete|oito|nove|dez|one|two|three|four|five|six|seven|eight|nine|ten)'
  const location = face === 'base' ? '(?:base|placa horizontal|horizontal plate)' : '(?:parede|wall|vertical|upright)'
  const diameter = '(?:\\s+(?:(?:de\\s+)?(?:di[aâ]metro\\s*|[Øø⌀]\\s*))?\\d+(?:[.,]\\d+)?\\s*(?:mm)?)?'
  const match = request.toLowerCase().match(new RegExp(`\\b${number}\\s+(?:furos?|holes?)?${diameter}\\s*(?:na|no|on|in)\\s+${location}\\b`))
  if (!match) return null
  return requestedHoleCount(`${match[1]} furos`)
}

function requestedFlangeHoleCount(request: string): number | null {
  const lower = request.toLowerCase()
  if (!/\b(?:furo\s+(?:central|no\s+centro)|central\s+bore|center\s+bore)\b/.test(lower)) return requestedHoleCount(request)
  const number = '(1[0-6]|[1-9]|um|uma|dois|duas|três|tres|quatro|cinco|seis|sete|oito|nove|dez|one|two|three|four|five|six|seven|eight|nine|ten)'
  const mounting = lower.match(new RegExp(`\\b${number}\\s+(?:furos?|holes?)\\s+(?:de\\s+)?(?:fixação|montagem|mounting)\\b`))
  if (mounting) return (requestedHoleCount(`${mounting[1]} furos`) ?? 0) + 1
  const additional = lower.match(new RegExp(`\\b(?:e|mais|and|plus)\\s+${number}\\s+(?:furos?|holes?)\\b`))
  if (additional) return (requestedHoleCount(`${additional[1]} furos`) ?? 0) + 1
  return requestedHoleCount(request)
}

export async function generateCadPart(provider: LLMProvider, request: string, shape: CadPartShape = 'plate'): Promise<CadCreateOutcome> {
  if (!request.trim() || request.length > 1000) {
    throw new CadPartGenerationError('Describe a CAD part in up to 1,000 characters.')
  }
  const outputSchema = outputSchemaFor(shape)
  const validateOutput = new Ajv2020().compile(outputSchema)
  const raw = await provider.generateStructured<unknown>([
    { role: 'system', content: [
      shape === 'bracket' ? 'Create a single fused L-shaped mechanical bracket from a horizontal base and a vertical rear wall.'
        : shape === 'composite' ? 'Create one mechanical composite solid by fusing cylindrical bosses onto a plate or disc and cutting axial through-holes.'
          : shape === 'rounded_plate' ? 'Create one rounded rectangular mechanical plate with four equal curved XY corner radii.'
          : shape === 'flange' ? 'Create one circular mechanical flange or disc with through holes.'
            : 'Create a new mechanical CAD plate from the user request.',
      'Output only the supplied JSON schema.',
      shape === 'bracket'
        ? 'Use schemaVersion 2.2. The base is a centered rectangular plate; the upright_wall spans the full width along the positive Y rear edge. It is fused to the base as one solid. The base bottom is Z=0. The wall height and wall-hole Z positions are measured from that bottom. cornerChamfer must be 0. Include at least one base hole, at most 8 wall holes and at most 16 holes total. No threads, slots, countersinks, fillets, bend radius, separate bodies or assemblies.'
        : shape === 'composite' ? 'Use schemaVersion 2.4. Choose base.kind extruded_rectangle or extruded_disc. For a disc width=depth=outside diameter and cornerRadius=0; for a rounded rectangular base choose a positive cornerRadius below half the shortest side. cornerChamfer=0. Add 1 to 4 cylindrical_boss features fused above the base, with stable IDs boss_1 etc. Include 1 to 16 axial through_hole cuts. A hole fully inside a boss passes through both boss and base; a hole outside bosses passes through the base only. Bosses must fit fully inside the base, must not overlap each other, and holes must not partially cross boss boundaries. No separate bodies, blind pockets, slots, threads, top edge fillets or assemblies.'
          : shape === 'rounded_plate' ? 'Use schemaVersion 2.3, base.kind extruded_rectangle, cornerChamfer 0 and a positive cornerRadius below half the shortest side. Corners curve in the XY outline through the full thickness. Include 1 to 16 plain through holes. No top or bottom edge fillets, slots, threads, bends or assemblies.'
          : shape === 'flange' ? 'Use schemaVersion 2.3, base.kind extruded_disc, width=depth=the outside diameter, cornerChamfer=0, cornerRadius=0, no upright. Include 1 to 16 plain axial through holes, such as a center bore and mounting holes. No raised hub, countersinks, threads, slots or assemblies.'
            : 'Supported geometry is one centered extruded rectangular plate with 1 to 16 plain through-holes and four equal straight corner chamfers. No threads, slots, countersinks, fillets, bends or assemblies.',
      'If the requested geometry needs unsupported features, return clarify with spec null and a short question or explanation. Do not pretend to create them.',
      'Write the question and assumptions in the same language as the user.',
      'All dimensions and coordinates are millimeters; convert other stated units. The base center is X=0,Y=0. Include all required fields and stable IDs hole_1, hole_2, wall_hole_1, etc.',
      'Respect every explicitly requested size, position and hole count. If values are missing, choose practical example dimensions and record each inferred choice in assumptions.',
      shape === 'bracket'
        ? 'For an underspecified L bracket use base width 120, depth 80, thickness 8; upright height 70 and thickness 8; two base diameter 8 holes at X +/-40,Y=-20; and two wall diameter 10 holes at X +/-40,Z=45. Adapt to stated dimensions and clearances.'
        : shape === 'composite' ? 'For an underspecified composite mounting part use a rounded rectangular base width 120, depth 80, thickness 10, cornerRadius 12; one centered boss diameter 40 and height 20; one center bore diameter 10 plus four diameter 8 mounting holes at X +/-40,Y +/-20. Adapt to stated dimensions and clearances.'
          : shape === 'rounded_plate' ? 'For an underspecified rounded plate use width 120, depth 80, thickness 10, cornerRadius 12, and two diameter 8 holes at X +/-35,Y=0. Adapt to stated dimensions and clearances.'
          : shape === 'flange' ? 'For an underspecified circular flange use outside diameter 100, thickness 12, center bore diameter 20 and two mounting holes diameter 8 at X +/-30,Y=0. Adapt to stated dimensions and clearances.'
            : 'For an underspecified four-hole plate, use width 120, depth 80, thickness 10, four diameter 8 holes at X +/-40 and Y +/-25, and cornerChamfer 4 as a starting example. Adapt this layout to stated dimensions and clearances.',
      'Keep at least 0.1 mm between each hole and the outer edge or chamfer and at least 1 mm of material between holes. Base holes must stay in front of the upright wall; wall holes must be wholly above the base top and below the wall top. Return create, an empty question and a complete spec when feasible.',
      'The spec is a proposed geometry, not a statement about strength, tolerances, fasteners or manufacturing suitability.',
    ].join(' ') },
    { role: 'user', content: request },
  ], outputSchema, { temperature: 0, maxTokens: 2048 })
  if (!validateOutput(raw)) throw new CadPartGenerationError('The AI returned an invalid CAD part proposal.')
  const output = raw as unknown as CadCreateOutput
  if (output.decision === 'clarify') {
    if (output.spec !== null || !output.question.trim() || output.assumptions.length > 0) {
      throw new CadPartGenerationError('The CAD clarification was incomplete.')
    }
    return { kind: 'clarify', question: output.question.trim() }
  }
  if (output.spec === null || output.question !== '') {
    throw new CadPartGenerationError('The CAD proposal mixed a question with a part.')
  }
  try {
    validateCadPartDomainRules(output.spec)
  } catch (error) {
    throw new CadPartGenerationError(error instanceof Error ? error.message : 'The proposed CAD part is invalid.')
  }
  if ((shape === 'composite' && output.spec.schemaVersion !== '2.4') ||
      (shape === 'rounded_plate' && (output.spec.schemaVersion !== '2.3' || output.spec.base.kind !== 'extruded_rectangle')) ||
      (shape === 'flange' && (output.spec.schemaVersion !== '2.3' || output.spec.base.kind !== 'extruded_disc'))) {
    throw new CadPartGenerationError('The AI proposed a different CAD shape than requested.')
  }
  const holeCount = shape === 'flange' || shape === 'composite' ? requestedFlangeHoleCount(request) : requestedHoleCount(request)
  const proposedHoles = output.spec.features.length + (output.spec.upright?.holes.length ?? 0)
  const baseCount = shape === 'bracket' ? requestedFaceHoleCount(request, 'base') : null
  const wallCount = shape === 'bracket' ? requestedFaceHoleCount(request, 'wall') : null
  if (baseCount !== null && output.spec.features.length !== baseCount) {
    throw new CadPartGenerationError(`The AI proposed ${output.spec.features.length} base holes, but the request specified ${baseCount}. The part was not saved.`)
  }
  if (wallCount !== null && output.spec.upright?.holes.length !== wallCount) {
    throw new CadPartGenerationError(`The AI proposed ${output.spec.upright?.holes.length ?? 0} upright holes, but the request specified ${wallCount}. The part was not saved.`)
  }
  if ((shape === 'plate' || (baseCount === null && wallCount === null)) && holeCount !== null && proposedHoles !== holeCount) {
    throw new CadPartGenerationError(`The AI proposed ${proposedHoles} holes, but the request specified ${holeCount}. The part was not saved.`)
  }
  return { kind: 'create', spec: output.spec, assumptions: output.assumptions }
}
