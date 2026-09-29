export type CadParameter = 'width' | 'depth' | 'thickness' | 'hole_x' | 'hole_y' | 'hole_diameter'

export interface SetCadParameter {
  readonly op: 'set_parameter'
  readonly parameter: CadParameter
  readonly value: number
}

export interface SetCornerChamfer {
  readonly op: 'set_corner_chamfer'
  readonly value: number
}

export interface SetCornerRadius {
  readonly op: 'set_corner_radius'
  readonly value: number
}

export interface SetDiscDiameter {
  readonly op: 'set_disc_diameter'
  readonly value: number
}

export interface UpsertBoss {
  readonly op: 'upsert_boss'
  readonly bossId: string
  readonly x: number
  readonly y: number
  readonly diameter: number
  readonly height: number
}

export interface RemoveBoss {
  readonly op: 'remove_boss'
  readonly bossId: string
}

export interface UpsertHole {
  readonly op: 'upsert_hole'
  readonly holeId: string
  readonly x: number
  readonly y: number
  readonly diameter: number
}

export interface RemoveHole {
  readonly op: 'remove_hole'
  readonly holeId: string
}

export interface SetUprightParameter {
  readonly op: 'set_upright_parameter'
  readonly parameter: 'height' | 'thickness'
  readonly value: number
}

export interface UpsertUprightHole {
  readonly op: 'upsert_upright_hole'
  readonly holeId: string
  readonly x: number
  readonly z: number
  readonly diameter: number
}

export interface RemoveUprightHole {
  readonly op: 'remove_upright_hole'
  readonly holeId: string
}

export type CadOperation = SetCadParameter | SetCornerChamfer | UpsertHole | RemoveHole |
  SetUprightParameter | UpsertUprightHole | RemoveUprightHole | SetCornerRadius | SetDiscDiameter |
  UpsertBoss | RemoveBoss

export interface CadEditPlan {
  readonly schemaVersion: '1.0' | '2.0' | '3.0' | '4.0' | '5.0'
  readonly operations: readonly CadOperation[]
}

export class CadPlanValidationError extends Error {}

export function validateCadEditPlan(plan: CadEditPlan): void {
  if (plan.operations.length < 1 || plan.operations.length > (plan.schemaVersion === '1.0' ? 6 : 20)) {
    throw new CadPlanValidationError('A CAD edit has an invalid number of operations.')
  }
  const targets = new Set<string>()
  for (const operation of plan.operations) {
    if (plan.schemaVersion === '1.0' && operation.op !== 'set_parameter') {
      throw new CadPlanValidationError('CAD plan 1.0 supports parameter changes only.')
    }
    if (plan.schemaVersion === '2.0' && ['set_upright_parameter', 'upsert_upright_hole', 'remove_upright_hole'].includes(operation.op)) {
      throw new CadPlanValidationError('CAD plan 2.0 does not support upright wall edits.')
    }
    if (plan.schemaVersion !== '4.0' && plan.schemaVersion !== '5.0' && (operation.op === 'set_corner_radius' || operation.op === 'set_disc_diameter')) {
      throw new CadPlanValidationError('Rounded profile edits require CAD plan 4.0 or later.')
    }
    if (plan.schemaVersion !== '5.0' && (operation.op === 'upsert_boss' || operation.op === 'remove_boss')) {
      throw new CadPlanValidationError('Composite boss edits require CAD plan 5.0.')
    }
    const target = operation.op === 'set_parameter' ? `parameter:${operation.parameter}`
      : operation.op === 'set_upright_parameter' ? `upright:${operation.parameter}`
      : operation.op === 'set_corner_chamfer' ? 'corner_chamfer'
      : operation.op === 'set_corner_radius' ? 'corner_radius'
      : operation.op === 'set_disc_diameter' ? 'disc_diameter'
      : operation.op === 'upsert_boss' || operation.op === 'remove_boss' ? `boss:${operation.bossId}`
      : operation.op === 'upsert_upright_hole' || operation.op === 'remove_upright_hole'
        ? `upright_hole:${operation.holeId}` : `hole:${operation.holeId}`
    if (targets.has(target)) throw new CadPlanValidationError('Each CAD target may be changed only once.')
    targets.add(target)
    if (operation.op === 'remove_hole' || operation.op === 'remove_upright_hole' || operation.op === 'remove_boss') {
      const id = operation.op === 'remove_boss' ? operation.bossId : operation.holeId
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new CadPlanValidationError('Invalid feature ID.')
    } else if (operation.op === 'upsert_boss') {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(operation.bossId) ||
          ![operation.x, operation.y, operation.diameter, operation.height].every(Number.isFinite)) {
        throw new CadPlanValidationError('Invalid boss dimensions or ID.')
      }
    } else if (operation.op === 'upsert_hole' || operation.op === 'upsert_upright_hole') {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(operation.holeId) ||
          ![operation.x, operation.op === 'upsert_hole' ? operation.y : operation.z, operation.diameter].every(Number.isFinite)) {
        throw new CadPlanValidationError('Invalid hole dimensions or ID.')
      }
    } else if (!Number.isFinite(operation.value)) {
      throw new CadPlanValidationError('CAD parameter values must be finite numbers.')
    }
  }
}
