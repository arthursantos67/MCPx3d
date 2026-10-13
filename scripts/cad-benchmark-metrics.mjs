import cadSchema from '../packages/domain/schemas/cad-program.v3.schema.json' with { type: 'json' }
import { direction } from '../packages/agent/src/cad-spatial.ts'

const defaultsByShape = Object.fromEntries(Object.values(cadSchema.$defs).filter((definition) => definition.properties?.shape?.const)
  .map((definition) => [definition.properties.shape.const, Object.fromEntries(Object.entries(definition.properties)
    .filter(([, property]) => Object.hasOwn(property, 'default')).map(([key, property]) => [key, property.default]))]))

export function lowerSuccessBound(successes, trials, confidence = .95) {
  if (!Number.isInteger(trials) || trials < 0 || !Number.isInteger(successes) || successes < 0 || successes > trials ||
    !Number.isFinite(confidence) || confidence <= 0 || confidence >= 1) throw new Error('Invalid benchmark counts or confidence')
  if (successes === 0) return 0
  if (successes === trials) return (1 - confidence) ** (1 / trials)
  let logChoose = 0
  for (let index = 1; index <= successes; index++) logChoose += Math.log((trials - index + 1) / index)
  const tail = (p) => {
    let logTerm = logChoose + successes * Math.log(p) + (trials - successes) * Math.log1p(-p)
    const terms = [logTerm]
    for (let index = successes; index < trials; index++) {
      logTerm += Math.log((trials - index) / (index + 1)) + Math.log(p) - Math.log1p(-p)
      terms.push(logTerm)
    }
    const maximum = Math.max(...terms)
    return Math.exp(maximum) * terms.reduce((sum, term) => sum + Math.exp(term - maximum), 0)
  }
  let low = 0, high = successes / trials
  for (let iteration = 0; iteration < 64; iteration++) {
    const middle = (low + high) / 2
    if (tail(middle) < 1 - confidence) low = middle
    else high = middle
  }
  return (low + high) / 2
}

function matches(actual, expected, tolerance) {
  if (typeof expected === 'number') return typeof actual === 'number' && Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((item, index) => matches(actual[index], item, tolerance))
  if (expected !== null && typeof expected === 'object') return actual !== null && typeof actual === 'object' &&
    Object.entries(expected).every(([key, value]) => matches(actual[key], value, tolerance))
  return actual === expected
}

export function evaluateCadRequirements(spec, expectations = {}, inspection) {
  const issues = []
  const tolerance = expectations.toleranceMm ?? 1e-6
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new Error('Invalid requirement tolerance')
  if (expectations.components !== undefined && spec.components?.length !== expectations.components) issues.push(`Expected ${expectations.components} components`)
  const steps = spec.components ? spec.components.flatMap((component) => component.steps.map((step) => ({ step, componentId: component.id })))
    : spec.steps.map((step) => ({ step, componentId: spec.partId }))
  for (const feature of expectations.features ?? []) {
    const { count = 1, componentId, axisDirection, ...fields } = feature
    const matching = steps.filter((entry) => (componentId === undefined || entry.componentId === componentId) &&
      matches({ ...defaultsByShape[entry.step.shape], ...entry.step }, fields, tolerance) &&
      (axisDirection === undefined || matches(direction(entry.step.rotation ?? { x: 0, y: 0, z: 0 }), axisDirection, tolerance)))
    const actual = matching.reduce((sum, { step }) => sum + (step.pattern?.count ?? 1), 0)
    if (actual !== count) issues.push(`Expected ${count} instances of ${JSON.stringify(fields)}${componentId ? ` in ${componentId}` : ''}; found ${actual}`)
  }
  if (expectations.fastening && !spec.mechanics?.connections.some((joint) => joint.fastening === expectations.fastening)) issues.push(`Expected ${expectations.fastening} fastening`)
  if (expectations.boundsMm && !matches(inspection?.boundsMm, expectations.boundsMm, tolerance)) issues.push(`Expected measured bounds ${JSON.stringify(expectations.boundsMm)}; found ${JSON.stringify(inspection?.boundsMm)}`)
  if (expectations.volumeMm3) {
    const volume = inspection?.volumeMm3
    const { min = 0, max = Infinity } = expectations.volumeMm3
    if (!Number.isFinite(volume) || volume < min - tolerance || volume > max + tolerance) issues.push(`Expected measured volume in [${min}, ${max}]; found ${volume}`)
  }
  if (expectations.mechanicalStatus && inspection?.mechanicalStatus !== expectations.mechanicalStatus) issues.push(`Expected mechanical status ${expectations.mechanicalStatus}; found ${inspection?.mechanicalStatus}`)
  return issues
}

export function summarizeCadBenchmark(cases, planned, target = .99) {
  if (!Number.isInteger(planned) || planned < cases.length || !Number.isFinite(target) || target <= 0 || target >= 1) throw new Error('Invalid planned trials or reliability target')
  const trials = cases.length
  const geometricSuccesses = cases.filter((item) => item.status === 'validated').length
  const successes = cases.filter((item) => item.status === 'validated' && !(item.requirementIssues?.length) && item.draftZipBytes > 0 && !item.exportError).length
  const exportSuccesses = cases.filter((item) => item.status === 'validated' && item.draftZipBytes > 0 && !item.exportError).length
  const durations = cases.map((item) => item.durationMs).sort((a, b) => a - b)
  const percentile = (fraction) => durations.length ? durations[Math.ceil(durations.length * fraction) - 1] : null
  const lowerBound = lowerSuccessBound(successes, trials)
  return { planned, attempted: trials, unattempted: planned - trials, geometricSuccesses, exportSuccesses, successes,
    observedSuccessRate: trials ? successes / trials : null, target, confidence: .95,
    confidenceMethod: 'one-sided exact Clopper-Pearson lower bound', lowerBound,
    sampleSupportsTarget: trials === planned && lowerBound >= target,
    medianDurationMs: percentile(.5), p95DurationMs: percentile(.95),
    aiCalls: cases.reduce((sum, item) => sum + (item.stats?.aiCalls ?? 0), 0),
    cadChecks: cases.reduce((sum, item) => sum + (item.stats?.cadChecks ?? 0), 0),
    scope: 'Native validity, declared recipe/measured requirements and attempted export for these prompts/model/action budgets; not general engineering correctness. Repeated cases may be correlated.' }
}
