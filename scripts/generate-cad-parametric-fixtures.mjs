import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CAD_DESIGNS, compileCadDesign, newCadDesign } from '../packages/domain/ts/src/cad-parametric.ts'

// Shared contract vectors: TypeScript checks source compilation, Python checks actual geometry.
export function parametricCases() {
  const variants = {
    plate: [{ width: 120, depth: 45, thickness: 3, holeDiameter: 4.2, edgeOffset: 9 }, { width: 20, depth: 20, thickness: 1, holeDiameter: 2, edgeOffset: 3 }],
    bracket: [{ width: 100, depth: 70, height: 90, thickness: 4, holeDiameter: 8, edgeOffset: 18 }, { width: 12, depth: 8, height: 8, thickness: 2, holeDiameter: 2, edgeOffset: 3 }],
    flange: [{ diameter: 140, thickness: 12, boreDiameter: 40, boltCircleDiameter: 96, holeDiameter: 9, holeCount: 8 }, { diameter: 30, thickness: 1, boreDiameter: 8, boltCircleDiameter: 20, holeDiameter: 2, holeCount: 12 }],
    enclosure: [{ width: 110, depth: 75, height: 50, wall: 2.4 }, { width: 4, depth: 4, height: 3, wall: 1 }],
    spacer: [{ diameter: 45, boreDiameter: 32, height: 12.5 }, { diameter: 3, boreDiameter: 1, height: 1 }],
  }
  return Object.keys(CAD_DESIGNS).flatMap((kind) => {
    const initial = newCadDesign(kind)
    return [initial.parameters, ...variants[kind]].map((parameters, index) => ({
      id: `${kind}-${index}`, ...compileCadDesign({ ...initial, parameters }),
    }))
  })
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const destination = resolve('tests/fixtures/cad-parametric.json')
  mkdirSync(resolve(destination, '..'), { recursive: true })
  writeFileSync(destination, JSON.stringify(parametricCases(), null, 2) + '\n')
  console.log(`Wrote ${parametricCases().length} CAD contract cases to ${destination}`)
}
