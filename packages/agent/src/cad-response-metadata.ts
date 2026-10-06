/** Explanatory text is independent of geometry; preserve it without clipping. */
export const cadResponseMetadataSchema = {
  question: { type: 'string' },
  assumptions: { type: 'array', items: { type: 'string' } },
} as const

export function isCadResponseMetadata(value: { question?: unknown; assumptions?: unknown }): boolean {
  return typeof value.question === 'string' && Array.isArray(value.assumptions) &&
    value.assumptions.every((item: unknown) => typeof item === 'string')
}
