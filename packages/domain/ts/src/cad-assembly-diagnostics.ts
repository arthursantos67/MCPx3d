export type CadBounds = Readonly<Record<'x' | 'y' | 'z', readonly [number, number]>>

export interface CadCollision {
  readonly components: readonly [string, string]
  readonly pose: 'current' | 'minimum' | 'quarter' | 'middle' | 'three_quarters' | 'maximum'
  readonly message: string
  readonly overlapVolumeMm3: number
  readonly componentVolumesMm3: readonly [number, number]
  readonly overlapBoundsMm: CadBounds
  readonly componentBoundsMm: readonly [CadBounds, CadBounds]
}

export interface CadAssemblyIssue {
  readonly message: string
  readonly collisions: readonly CadCollision[]
  readonly mechanicalIssues?: readonly CadMechanicalIssue[]
}

export interface CadMechanicalIssue {
  readonly connectionId: string
  readonly components: readonly string[]
  readonly pose: CadCollision['pose']
  readonly message: string
}

export type CadAssemblyCheckResult = CadAssemblyIssue | string | null

export function assemblyIssueMessage(issue: CadAssemblyCheckResult): string | null {
  return typeof issue === 'string' || issue === null ? issue : issue.message
}

export function readAssemblyIssue(message: string, details: unknown): CadAssemblyIssue | null {
  const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
  const positive = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0
  const pair = (value: unknown): value is unknown[] => Array.isArray(value) && value.length === 2
  const mechanicalIssues = (value: unknown): value is CadMechanicalIssue[] => Array.isArray(value) && value.length <= 152 &&
    value.every((item: unknown) => record(item) && typeof item.connectionId === 'string' && /^[A-Za-z0-9_-]{0,64}$/.test(item.connectionId) &&
      Array.isArray(item.components) && item.components.length >= 1 && item.components.length <= 2 && item.components.every((id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id)) &&
      typeof item.message === 'string' && typeof item.pose === 'string' && ['current', 'minimum', 'quarter', 'middle', 'three_quarters', 'maximum'].includes(item.pose))
  const bounds = (value: unknown) => record(value) && ['x', 'y', 'z'].every((axis) => {
    const range = value[axis]
    return pair(range) && typeof range[0] === 'number' && typeof range[1] === 'number' &&
      Number.isFinite(range[0]) && Number.isFinite(range[1]) && range[0] <= range[1]
  })
  if (!Array.isArray(details)) return null
  const mechanical = details.find((item: unknown) => record(item) && item.check === 'assembly_mechanics' && item.schemaVersion === '1.0')
  if (record(mechanical) && mechanicalIssues(mechanical.issues) && mechanical.issues.length > 0) {
    return { message, collisions: [], mechanicalIssues: mechanical.issues }
  }
  const report = details.find((item: unknown) => record(item) && item.check === 'assembly_interference' && item.schemaVersion === '1.0')
  if (!record(report) || !Array.isArray(report.collisions) || !report.collisions.length || report.collisions.length > 168) return null
  if (!report.collisions.every((item: unknown) => record(item) && pair(item.components) &&
    item.components.every((id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id)) && item.components[0] !== item.components[1] &&
    typeof item.message === 'string' && typeof item.pose === 'string' && ['current', 'minimum', 'quarter', 'middle', 'three_quarters', 'maximum'].includes(item.pose) &&
    positive(item.overlapVolumeMm3) && pair(item.componentVolumesMm3) && item.componentVolumesMm3.every(positive) &&
    bounds(item.overlapBoundsMm) && pair(item.componentBoundsMm) && item.componentBoundsMm.every(bounds))) return null
  const collisions = report.collisions as unknown as CadCollision[]
  if (report.mechanicalIssues !== undefined && !mechanicalIssues(report.mechanicalIssues)) return null
  const keys = collisions.map((item) => JSON.stringify([[...item.components].sort(), item.pose]))
  if (new Set(keys).size !== keys.length) return null
  return { message, collisions, ...(Array.isArray(report.mechanicalIssues) && report.mechanicalIssues.length ? { mechanicalIssues: report.mechanicalIssues as CadMechanicalIssue[] } : {}) }
}
