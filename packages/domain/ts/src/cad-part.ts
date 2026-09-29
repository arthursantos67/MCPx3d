export interface CadPartSpec {
  readonly schemaVersion: '2.0' | '2.1' | '2.2' | '2.3' | '2.4'
  readonly units: 'mm'
  readonly partId: string
  readonly base: {
    readonly kind: 'extruded_rectangle' | 'extruded_disc'
    readonly width: number
    readonly depth: number
    readonly thickness: number
  }
  readonly features: readonly {
    readonly kind: 'through_hole'
    readonly id?: string | null
    readonly x: number
    readonly y: number
    readonly diameter: number
  }[]
  readonly cornerChamfer?: number | null
  readonly cornerRadius?: number | null
  readonly upright?: {
    readonly kind: 'upright_wall'
    readonly height: number
    readonly thickness: number
    readonly holes: readonly { readonly id: string; readonly x: number; readonly z: number; readonly diameter: number }[]
  } | null
  readonly bosses?: readonly {
    readonly kind: 'cylindrical_boss'
    readonly id: string
    readonly x: number
    readonly y: number
    readonly diameter: number
    readonly height: number
  }[]
}

export class CadPartValidationError extends Error {}

export function validateCadPartDomainRules(part: CadPartSpec): void {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(part.partId)) {
    throw new CadPartValidationError('Part ID must use 1–64 letters, digits, underscores or hyphens.')
  }
  if (part.features.length < 1 || part.features.length > 16) {
    throw new CadPartValidationError('A CAD plate requires 1–16 through-holes.')
  }
  for (const [name, value] of Object.entries({
    width: part.base.width,
    depth: part.base.depth,
    thickness: part.base.thickness,
  })) {
    if (!Number.isFinite(value) || value < 0.1 || value > 10_000) {
      throw new CadPartValidationError(`${name} must be between 0.1 and 10,000 mm.`)
    }
  }
  const chamfer = part.cornerChamfer ?? 0
  const cornerRadius = part.cornerRadius ?? 0
  if (part.schemaVersion !== '2.4' && (part.bosses?.length ?? 0) > 0) {
    throw new CadPartValidationError('Cylindrical bosses require CAD 2.4.')
  }
  if (part.schemaVersion !== '2.3' && part.schemaVersion !== '2.4' && (part.base.kind !== 'extruded_rectangle' || part.cornerRadius != null)) {
    throw new CadPartValidationError('This CAD version requires a rectangular base without corner radius.')
  }
  if (part.schemaVersion === '2.0') {
    if (part.features.length !== 1 || part.features[0].id != null || part.cornerChamfer != null || part.upright != null) {
      throw new CadPartValidationError('CAD 2.0 requires one unnamed hole and no corner chamfer.')
    }
  } else {
    const ids = part.features.map((hole) => hole.id)
    if (part.cornerChamfer == null || !Number.isFinite(chamfer) || chamfer < 0 || chamfer > 2500 ||
        chamfer > Math.min(part.base.width, part.base.depth) / 4) {
      throw new CadPartValidationError('Corner chamfer must be 0–2,500 mm and at most one quarter of the shortest side.')
    }
    if (ids.some((id) => !id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) || new Set(ids).size !== ids.length) {
      throw new CadPartValidationError('Each through-hole needs a unique ID.')
    }
    if (ids[0] !== 'hole_1') throw new CadPartValidationError('The first CAD hole ID must be hole_1.')
    if (part.schemaVersion === '2.1' && part.upright != null) {
      throw new CadPartValidationError('CAD 2.1 does not support an upright wall.')
    }
    if (part.schemaVersion === '2.2' && part.upright == null) {
      throw new CadPartValidationError('CAD 2.2 requires an upright wall.')
    }
    if (part.schemaVersion === '2.3') {
      if (part.upright != null || chamfer !== 0 || part.cornerRadius == null || !Number.isFinite(cornerRadius) || cornerRadius < 0 || cornerRadius > 5000) {
        throw new CadPartValidationError('CAD 2.3 requires a rounded base, zero chamfer and no upright wall.')
      }
      if (part.base.kind === 'extruded_disc') {
        if (part.base.width !== part.base.depth || cornerRadius !== 0) {
          throw new CadPartValidationError('A disc requires equal width and depth and zero corner radius.')
        }
      } else if (cornerRadius <= 0 || cornerRadius >= Math.min(part.base.width, part.base.depth) / 2) {
        throw new CadPartValidationError('Rounded rectangle corner radius must be positive and below half the shortest side.')
      }
    }
    if (part.schemaVersion === '2.4') {
      if (part.upright != null || chamfer !== 0 || part.cornerRadius == null || !Number.isFinite(cornerRadius) ||
          cornerRadius < 0 || cornerRadius > 5000 || !part.bosses?.length || part.bosses.length > 4) {
        throw new CadPartValidationError('CAD 2.4 requires a base, cylindrical bosses, zero chamfer and no upright wall.')
      }
      if (part.base.kind === 'extruded_disc') {
        if (part.base.width !== part.base.depth || cornerRadius !== 0) {
          throw new CadPartValidationError('A disc requires equal width and depth and zero corner radius.')
        }
      } else if (cornerRadius >= Math.min(part.base.width, part.base.depth) / 2) {
        throw new CadPartValidationError('Corner radius must be below half the shortest side.')
      }
      const ids = [...part.features.map((hole) => hole.id), ...part.bosses.map((boss) => boss.id)]
      if (ids.length !== new Set(ids).size) throw new CadPartValidationError('Boss IDs must be unique across the part.')
    }
  }
  if (part.upright) {
    const wall = part.upright
    if (wall.kind !== 'upright_wall' || ![wall.height, wall.thickness].every(Number.isFinite) ||
        wall.height <= part.base.thickness + 0.1 || wall.height > 10_000 ||
        wall.thickness < 0.1 || wall.thickness >= part.base.depth / 2 || chamfer !== 0) {
      throw new CadPartValidationError('The upright wall needs valid height, thickness and zero corner chamfer.')
    }
    if (wall.holes.length > 8 || part.features.length + wall.holes.length > 16) {
      throw new CadPartValidationError('A CAD part supports at most 16 holes, including up to 8 in the upright wall.')
    }
    const allIds = [...part.features.map((hole) => hole.id), ...wall.holes.map((hole) => hole.id)]
    if (new Set(allIds).size !== allIds.length) throw new CadPartValidationError('Base and upright hole IDs must be unique.')
    for (const [index, hole] of wall.holes.entries()) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(hole.id) || ![hole.x, hole.z, hole.diameter].every(Number.isFinite) ||
          hole.diameter < 0.1 || hole.diameter > 10_000) {
        throw new CadPartValidationError('Upright hole dimensions and ID must be valid.')
      }
      const radius = hole.diameter / 2
      if (part.base.width / 2 - Math.abs(hole.x) < radius + 0.1 ||
          hole.z - part.base.thickness < radius + 0.1 || wall.height - hole.z < radius + 0.1) {
        throw new CadPartValidationError('Upright hole must stay within the wall above the base.')
      }
      for (const other of wall.holes.slice(0, index)) {
        if (Math.hypot(hole.x - other.x, hole.z - other.z) < radius + other.diameter / 2 + 1) {
          throw new CadPartValidationError('Upright holes must keep at least 1 mm of material between them.')
        }
      }
    }
  }
  for (const [index, boss] of (part.bosses ?? []).entries()) {
    if (boss.kind !== 'cylindrical_boss' || !/^[A-Za-z0-9_-]{1,64}$/.test(boss.id) ||
        ![boss.x, boss.y, boss.diameter, boss.height].every(Number.isFinite) ||
        boss.diameter < 0.1 || boss.diameter > 10000 || boss.height < 0.1 || boss.height > 10000) {
      throw new CadPartValidationError('Cylindrical boss dimensions and ID must be valid.')
    }
    const radius = boss.diameter / 2
    let fits: boolean
    if (part.base.kind === 'extruded_disc') {
      fits = Math.hypot(boss.x, boss.y) + radius + 0.1 <= part.base.width / 2
    } else if (cornerRadius > 0) {
      const qx = Math.abs(boss.x) - (part.base.width / 2 - cornerRadius)
      const qy = Math.abs(boss.y) - (part.base.depth / 2 - cornerRadius)
      fits = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - cornerRadius <= -radius - 0.1
    } else {
      fits = Math.abs(boss.x) + radius + 0.1 <= part.base.width / 2 &&
        Math.abs(boss.y) + radius + 0.1 <= part.base.depth / 2
    }
    if (!fits) throw new CadPartValidationError('Cylindrical boss must fit entirely within the base profile.')
    for (const other of (part.bosses ?? []).slice(0, index)) {
      if (Math.hypot(boss.x - other.x, boss.y - other.y) < radius + other.diameter / 2 + 1) {
        throw new CadPartValidationError('Cylindrical bosses must keep at least 1 mm between them.')
      }
    }
  }
  for (const [index, hole] of part.features.entries()) {
    if (![hole.x, hole.y, hole.diameter].every(Number.isFinite) || hole.diameter < 0.1 || hole.diameter > 10_000) {
      throw new CadPartValidationError('Hole position and diameter must be finite and diameter must be 0.1–10,000 mm.')
    }
    const radius = hole.diameter / 2
    const distanceX = part.base.width / 2 - Math.abs(hole.x)
    const distanceY = part.base.depth / 2 - Math.abs(hole.y)
    if (distanceX < radius + 0.1 || distanceY < radius + 0.1 ||
        (chamfer > 0 && distanceX + distanceY < chamfer + Math.SQRT2 * (radius + 0.1))) {
      throw new CadPartValidationError('The hole must keep at least 0.1 mm clearance from every edge.')
    }
    if (part.upright && hole.y + radius + 0.1 > part.base.depth / 2 - part.upright.thickness) {
      throw new CadPartValidationError('Base through hole must not intersect the upright wall.')
    }
    if (part.base.kind === 'extruded_disc' && Math.hypot(hole.x, hole.y) + radius + 0.1 > part.base.width / 2) {
      throw new CadPartValidationError('Through hole must keep at least 0.1 mm from the circular edge.')
    }
    if (part.base.kind === 'extruded_rectangle' && cornerRadius > 0) {
      const qx = Math.abs(hole.x) - (part.base.width / 2 - cornerRadius)
      const qy = Math.abs(hole.y) - (part.base.depth / 2 - cornerRadius)
      const signedDistance = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - cornerRadius
      if (signedDistance > -radius - 0.1) {
        throw new CadPartValidationError('Through hole must keep at least 0.1 mm from the rounded edge.')
      }
    }
    for (const boss of part.bosses ?? []) {
      const distance = Math.hypot(hole.x - boss.x, hole.y - boss.y)
      const bossRadius = boss.diameter / 2
      if (distance > bossRadius - radius - 0.1 && distance < bossRadius + radius + 0.1) {
        throw new CadPartValidationError('Through hole must stay fully inside or outside each boss.')
      }
    }
    for (const other of part.features.slice(0, index)) {
      if (Math.hypot(hole.x - other.x, hole.y - other.y) < radius + other.diameter / 2 + 1) {
        throw new CadPartValidationError('Through-holes must keep at least 1 mm of material between them.')
      }
    }
  }
}
