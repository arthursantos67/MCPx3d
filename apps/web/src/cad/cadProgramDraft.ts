import type { CadProgramSpec } from '../../../../packages/domain/ts/src/cad-program.ts'

export const initialCadProgram: CadProgramSpec = {
  schemaVersion: '3.0', units: 'mm', partId: 'new_part',
  steps: [{ id: 'body', op: 'base', shape: 'box', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, width: 80, depth: 50, height: 10 }],
}
