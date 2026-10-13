import { CAD_FEATURES } from '../../domain/ts/src/cad-features.ts'
import schema from '../../domain/schemas/cad-program.v3.schema.json' with { type: 'json' }
import type { CadProgramSpec } from '../../domain/ts/src/cad-program.ts'
import { originalCadRequest } from './cad-design-preparation.ts'

// Only literal supported operation names and field=value statements are
// interpreted here. Free-language dimensions still require engineering review.
export function explicitCadProgramIssue(spec: CadProgramSpec, request: string): string | null {
  for (const clause of originalCadRequest(request).split(/[;\n!?]|\.(?!\d)/)) {
    const names = [...clause.matchAll(/\b(?:use|utilize|utilizar|usando|using)\s+(?:(?:a|o|um|uma|the|an?)\s+)?([a-z_]+)\b/gi)]
      .filter((match) => !/\b(?:n[aã]o|not|never|without|sem|don['’]t)\s*$/i.test(clause.slice(0, match.index)))
      .map((match) => match[1].toLowerCase()).filter((name) => Object.hasOwn(CAD_FEATURES, name))
    for (const name of new Set(names)) {
      const steps = spec.steps.filter((step) => step.shape === name)
      if (!steps.length) return `CAD requirement: the user explicitly requested ${name}; retain this real feature instead of an unrelated primitive.`
      if (new Set(names).size !== 1) continue
      const feature = CAD_FEATURES[name as keyof typeof CAD_FEATURES]
      const fields = feature.fields as readonly string[]
      const definition = (schema.$defs as Record<string, { properties: Record<string, { default?: unknown }> }>)[feature.schema]
      const expected = Object.fromEntries([...clause.matchAll(/\b([a-zA-Z]+)\s*=\s*(-?\d+(?:[.,]\d+)?)\b/g)]
        .filter((match) => fields.includes(match[1])).map((match) => [match[1], Number(match[2].replace(',', '.'))]))
      if (!steps.some((step) => Object.entries(expected).every(([key, value]) => {
        const actual = (step as unknown as Record<string, unknown>)[key] ?? definition.properties[key]?.default
        return typeof actual === 'number' && Math.abs(actual - value) <= 1e-6
      }))) return `CAD requirement: no ${name} feature matches the explicit fields ${JSON.stringify(expected)}; preserve the requested dimensions.`
    }
  }
  return null
}
