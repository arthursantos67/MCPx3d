import { CAD_FEATURES } from '../../../../packages/domain/ts/src/cad-features.ts'
import type { CadProgramStep } from '../../../../packages/domain/ts/src/cad-program.ts'

export function createCadFeature(shape: CadProgramStep['shape'], id: string, requestedOp: 'union' | 'cut'): CadProgramStep {
  const mode = CAD_FEATURES[shape].mode
  const op = mode === 'modifier' ? 'modify' : mode === 'cut' ? 'cut' : requestedOp
  const common = { id, op, position: { x: 0, y: 0, z: mode === 'modifier' ? 0 : op === 'union' ? 5 : 0 }, rotation: { x: 0, y: 0, z: 0 } } as const
  switch (shape) {
    case 'box': return { ...common, shape, width: 20, depth: 20, height: 10 }
    case 'cylinder': return { ...common, shape, diameter: 12, height: 20 }
    case 'sphere': return { ...common, shape, diameter: 20 }
    case 'cone': return { ...common, shape, bottomDiameter: 20, topDiameter: 10, height: 20 }
    case 'polygon_prism': return { ...common, shape, points: [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }], height: 10 }
    case 'revolve_profile': return { ...common, shape, points: [{ x: 0, y: -10 }, { x: 20, y: -10 }, { x: 20, y: 10 }, { x: 0, y: 10 }] }
    case 'tube': return { ...common, shape, diameter: 20, innerDiameter: 16, height: 10 }
    case 'torus': return { ...common, shape, majorRadius: 10, minorRadius: 2 }
    case 'slot': return { ...common, shape, length: 20, width: 6, height: 10 }
    case 'hole': return { ...common, shape, holeType: 'counterbore', diameter: 5, height: 20, headDiameter: 9, headDepth: 3 }
    case 'thread': return { ...common, shape, diameter: 10, pitch: 1.5, height: 12, profile: 'metric', handedness: 'right', clearance: op === 'cut' ? 0.1 : 0, starts: 1 }
    case 'loft': return { ...common, shape, sections: [{ kind: 'circle', z: -5, diameter: 12 }, { kind: 'circle', z: 5, diameter: 20 }], ruled: true }
    case 'fillet': return { ...common, shape, selector: 'parallel_z', radius: 1 }
    case 'chamfer': return { ...common, shape, selector: 'top', distance: 1 }
    case 'shell': return { ...common, shape, selector: 'top', thickness: 2 }
  }
}
