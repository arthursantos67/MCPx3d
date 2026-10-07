export function cadIdentity(value: unknown): string {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical)
    : item !== null && typeof item === 'object' ? Object.fromEntries(Object.entries(item)
      .filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, canonical(value)])) : item
  return JSON.stringify(canonical(value))
}
