import type { CadPlateInput } from '../../src/api/legacy-cad.ts'
import type { CadPartShape } from '../../../../packages/agent/src/generate-cad-part.ts'

export const initialCadPlate: CadPlateInput = {
  partId: 'mounting_plate',
  width: 120,
  depth: 80,
  thickness: 10,
  holeX: -40,
  holeY: -25,
  holeDiameter: 8,
  additionalHoles: [
    { id: 'hole_2', x: 40, y: -25, diameter: 8 },
    { id: 'hole_3', x: -40, y: 25, diameter: 8 },
    { id: 'hole_4', x: 40, y: 25, diameter: 8 },
  ],
  cornerChamfer: 4,
}

export const initialCadBracket: CadPlateInput = {
  partId: 'mounting_bracket',
  width: 120,
  depth: 80,
  thickness: 8,
  holeX: -40,
  holeY: -20,
  holeDiameter: 8,
  additionalHoles: [{ id: 'hole_2', x: 40, y: -20, diameter: 8 }],
  cornerChamfer: 0,
  upright: {
    height: 70,
    thickness: 8,
    holes: [
      { id: 'wall_hole_1', x: -40, z: 45, diameter: 10 },
      { id: 'wall_hole_2', x: 40, z: 45, diameter: 10 },
    ],
  },
}

export const initialCadRoundedPlate: CadPlateInput = {
  partId: 'rounded_plate', width: 120, depth: 80, thickness: 10,
  holeX: -35, holeY: 0, holeDiameter: 8,
  additionalHoles: [{ id: 'hole_2', x: 35, y: 0, diameter: 8 }],
  cornerChamfer: 0, cornerRadius: 12,
  baseKind: 'extruded_rectangle',
}

export const initialCadFlange: CadPlateInput = {
  partId: 'round_flange', width: 100, depth: 100, thickness: 12,
  holeX: 0, holeY: 0, holeDiameter: 20,
  additionalHoles: [
    { id: 'hole_2', x: -30, y: 0, diameter: 8 },
    { id: 'hole_3', x: 30, y: 0, diameter: 8 },
  ],
  cornerChamfer: 0, cornerRadius: 0,
  baseKind: 'extruded_disc',
}

export const initialCadComposite: CadPlateInput = {
  partId: 'composite_mount', width: 120, depth: 80, thickness: 10,
  holeX: 0, holeY: 0, holeDiameter: 10,
  additionalHoles: [
    { id: 'hole_2', x: -40, y: -20, diameter: 8 },
    { id: 'hole_3', x: 40, y: -20, diameter: 8 },
    { id: 'hole_4', x: -40, y: 20, diameter: 8 },
    { id: 'hole_5', x: 40, y: 20, diameter: 8 },
  ],
  cornerChamfer: 0, cornerRadius: 12, baseKind: 'extruded_rectangle',
  bosses: [{ id: 'boss_1', x: 0, y: 0, diameter: 40, height: 20 }],
}

export function initialCadPart(shape: CadPartShape): CadPlateInput {
  return shape === 'composite' ? initialCadComposite : shape === 'bracket' ? initialCadBracket : shape === 'rounded_plate' ? initialCadRoundedPlate
    : shape === 'flange' ? initialCadFlange : initialCadPlate
}

export function shapeFromCadPart(part: CadPlateInput): CadPartShape {
  return part.bosses ? 'composite' : part.upright ? 'bracket' : part.baseKind === 'extruded_disc' ? 'flange'
    : part.cornerRadius !== undefined ? 'rounded_plate' : 'plate'
}

export function cadShapeForRequest(request: string, selected: CadPartShape): CadPartShape {
  if (selected !== 'plate') return selected
  if (/\b(?:suporte\s+em\s+l|pe[çc]a\s+em\s+l|cantoneira|l[-\s]?bracket|l[-\s]?shaped|parede\s+vertical|upright\s+wall)\b/i.test(request)) return 'bracket'
  if (/\b(?:pe[çc]a\s+composta|corpo\s+composto|composite\s+part|placa.{0,60}(?:ressalto|cilindro|flange|boss)|flange.{0,40}(?:sobre|em\s+cima).{0,40}(?:placa|base)|ressalto\s+cil[ií]ndrico)\b/i.test(request)) return 'composite'
  if (/\b(?:flange|disco|anel|arruela|pe[çc]a\s+(?:circular|redonda|cil[ií]ndrica)|placa\s+(?:circular|redonda)|cilindro|cylinder|circular\s+flange|round\s+flange|disc)\b/i.test(request)) return 'flange'
  if (/\b(?:cantos?\s+arredondados?|bordas?\s+arredondadas?|pe[çc]a\s+arredondada|placa\s+arredondada|rounded\s+(?:corner|plate)|corner\s+radius|raio\s+(?:dos?\s+)?cantos?)\b/i.test(request)) return 'rounded_plate'
  return 'plate'
}
