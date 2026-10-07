import type { CadProgramStep } from './cad-program.ts'

export const CAD_SOCKET_SCREWS = [
  { nominal: 3, clearance: 3.4, headDiameter: 5.5, headHeight: 3 },
  { nominal: 4, clearance: 4.5, headDiameter: 7, headHeight: 4 },
  { nominal: 5, clearance: 5.5, headDiameter: 8.5, headHeight: 5 },
  { nominal: 6, clearance: 6.6, headDiameter: 10, headHeight: 6 },
  { nominal: 8, clearance: 9, headDiameter: 13, headHeight: 8 },
  { nominal: 10, clearance: 11, headDiameter: 16, headHeight: 10 },
] as const

export function socketScrewRecess(nominal: number): Pick<Extract<CadProgramStep, { shape: 'hole' }>,
  'holeType' | 'diameter' | 'headDiameter' | 'headDepth'> {
  const screw = CAD_SOCKET_SCREWS.find((item) => item.nominal === nominal)
  if (!screw) throw new Error('Parafuso fora dos presets disponíveis')
  return { holeType: 'counterbore', diameter: screw.clearance,
    headDiameter: screw.headDiameter + 1, headDepth: screw.headHeight + .3 }
}

export const CAD_FASTENER_GUIDANCE = `Plan fastening holes together with the screw head and tool access. A through bore alone does not recess a screw head. Use holeType=counterbore for a cylindrical socket-head seat and countersink for a conical flush-head seat; use plain only when the head/washer may sit on the outer surface. Socket-head reference dimensions (nominal, clearance bore, head diameter, head height in mm): ${JSON.stringify(CAD_SOCKET_SCREWS)}. For an inferred socket-head recess, add 1 mm diametral allowance and 0.3 mm depth allowance; these are design assumptions, not certified fit classes. Choose the actual specified head type first; a socket-head preset is not suitable for a countersunk or hex head. Account for remaining stock below the seat and at least 1 mm radial material around the larger head opening. Place the ENTRY on the exposed mounting face, point the negative local Z into material, and place the recess on the accessible head side, never the mating contact face unless explicitly intended. For a 90 degree countersink, depth=(headDiameter-diameter)/2. Keep modeled bolt patterns aligned across every connected body; preserve required feature IDs and declare fasteners and assembly access.`
